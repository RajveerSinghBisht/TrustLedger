import { ethers } from "ethers";
import { getConfig } from "../config";
import AssetRegistryArtifact from "../abi/AssetRegistry.json";
import { getRelayerSigner } from "./accessControlService";

/**
 * Thin wrapper around the deployed AssetRegistry contract, mirroring the
 * pattern established in identityRegistryService.ts: read functions use
 * a plain JsonRpcProvider, writes go through getRelayerSigner() (shared
 * with accessControlService.ts's own writes, so every relayed
 * transaction across this backend shares one serialized nonce queue).
 *
 * The ABI is copied directly from contracts/artifacts/contracts/
 * AssetRegistry.sol/AssetRegistry.json, the real Hardhat compilation
 * output — same re-sync caveat as IdentityRegistry.json and
 * AccessControl.json: if AssetRegistry.sol changes and is recompiled,
 * re-copy this file by hand before trusting this service again.
 */

export type AssetClassification = "PUBLIC" | "INTERNAL" | "CONFIDENTIAL";

export interface AssetRecord {
  assetId: bigint;
  assetHash: string;
  ownerDID: string;
  metadataURI: string;
  classification: AssetClassification;
  status: "ACTIVE" | "REVOKED";
  version: bigint;
  createdAt: bigint;
}

let cachedProvider: ethers.JsonRpcProvider | null = null;
let cachedReadContract: ethers.Contract | null = null;

function getProvider(): ethers.JsonRpcProvider {
  if (!cachedProvider) {
    const config = getConfig();
    cachedProvider = new ethers.JsonRpcProvider(config.hardhatRpcUrl);
  }
  return cachedProvider;
}

function getReadContract(): ethers.Contract {
  if (!cachedReadContract) {
    const config = getConfig();
    cachedReadContract = new ethers.Contract(
      config.assetRegistryAddress,
      AssetRegistryArtifact.abi,
      getProvider()
    );
  }
  return cachedReadContract;
}

/**
 * Deliberately does NOT cache its own QueuedRelayerWallet the way
 * accessControlService.ts's getWriteContract() does — it reuses
 * getRelayerSigner() from that module instead, which already returns a
 * cached singleton wallet, so every relayer-signed write across the
 * whole backend (identity registration, permission changes, and now
 * asset registration) shares exactly one nonce-serialization queue. A
 * second, independently-cached QueuedRelayerWallet here would defeat
 * that serialization guarantee — see the extended nonce-race comments
 * in accessControlService.ts for why that matters.
 */
function getWriteContract(): ethers.Contract {
  const config = getConfig();
  return new ethers.Contract(
    config.assetRegistryAddress,
    AssetRegistryArtifact.abi,
    getRelayerSigner()
  );
}

/**
 * AssetRegistry.sol's Classification enum ordering:
 * PUBLIC = 0, INTERNAL = 1, CONFIDENTIAL = 2
 */
const CLASSIFICATION_TO_ENUM: Record<AssetClassification, number> = {
  PUBLIC: 0,
  INTERNAL: 1,
  CONFIDENTIAL: 2,
};

const ENUM_TO_CLASSIFICATION: Record<number, AssetClassification> = {
  0: "PUBLIC",
  1: "INTERNAL",
  2: "CONFIDENTIAL",
};

/** AssetRegistry.sol's AssetStatus enum ordering: ACTIVE = 0, REVOKED = 1 */
const ENUM_TO_STATUS: Record<number, "ACTIVE" | "REVOKED"> = {
  0: "ACTIVE",
  1: "REVOKED",
};

function normalizeAsset(asset: any): AssetRecord {
  return {
    assetId: BigInt(asset.assetId),
    assetHash: String(asset.assetHash),
    ownerDID: String(asset.ownerDID),
    metadataURI: String(asset.metadataURI),
    classification:
      ENUM_TO_CLASSIFICATION[Number(asset.classification)] ?? "PUBLIC",
    status: ENUM_TO_STATUS[Number(asset.status)] ?? "ACTIVE",
    version: BigInt(asset.version),
    createdAt: BigInt(asset.createdAt),
  };
}

/**
 * Returns the full on-chain Asset struct. Per AssetRegistry.sol, this
 * REVERTS if assetId does not exist (require(assetExists[assetId], ...))
 * — there is no "return null/zeroed" fallback the way
 * checkPermissionAtTime has. Callers must catch and treat any rejection
 * as "not found."
 */
export async function getAsset(
  assetId: bigint | number | string
): Promise<AssetRecord> {
  const contract = getReadContract();
  const asset = await contract.getAsset(assetId);
  return normalizeAsset(asset);
}

/**
 * Registers a new asset on-chain via AssetRegistry.registerAsset,
 * relayed through the shared relayer signer.
 *
 * PRIVILEGED WRITE per BACKEND_SPEC.md's Authorization Trust Boundary
 * section, same as identityRegistryService.registerIdentity — the
 * CALLER is responsible for the mandatory fresh requireCurrentRole()
 * check before invoking this. Per AssetRegistry.sol's onlyActiveAdmin
 * modifier, this is ADMIN-only (not ADMIN-or-MANAGER) — narrower than
 * Permissions' ADMIN-or-MANAGER rule. Do not relax this without
 * re-checking the contract; the modifier is the actual authority here.
 *
 * registerAsset's Solidity signature is `returns (uint256 assetId)`, but
 * — confirmed by reading contracts/test/AssetRegistry.test.js, which
 * does NOT rely on this return value and instead reads the assetId back
 * off the AssetRegistered event (or hardcodes it as 1 for a fresh
 * fixture with a one-line comment explaining why) — ethers does not
 * surface a state-changing function's Solidity return value through a
 * signer-connected call; it returns a TransactionResponse. So the
 * assetId here is recovered the same way setPermissionAndDecode recovers
 * permissionId: by waiting for the receipt and parsing the emitted
 * AssetRegistered event, not from any return value of the call itself.
 */
export async function registerAssetAndDecode(input: {
  assetHash: string;
  ownerDID: string;
  metadataURI: string;
  classification: AssetClassification;
}): Promise<{ assetId: bigint; txHash: string }> {
  const contract = getWriteContract();

  const tx = await contract.registerAsset(
    input.assetHash,
    input.ownerDID,
    input.metadataURI,
    CLASSIFICATION_TO_ENUM[input.classification]
  );
  const receipt = await tx.wait();

  if (!receipt) {
    throw new Error(
      "registerAsset transaction did not produce a receipt"
    );
  }

  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog({
        topics: log.topics as string[],
        data: log.data,
      });
      if (parsed?.name === "AssetRegistered") {
        return {
          assetId: BigInt(parsed.args.assetId),
          txHash: receipt.hash,
        };
      }
    } catch {
      continue;
    }
  }

  throw new Error(
    "AssetRegistered event not found in registerAsset transaction receipt"
  );
}

/**
 * For tests only: clears cached provider/contracts so fresh instances
 * are built on next access. Mirrors the pattern already used in
 * identityRegistryService.ts and accessControlService.ts.
 */
export function _resetAssetRegistryServiceForTests(): void {
  cachedProvider = null;
  cachedReadContract = null;
}
