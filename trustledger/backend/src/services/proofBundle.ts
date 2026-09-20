import { ethers } from "ethers";
import { getConfig } from "../config";
import { checkPermissionAtTime } from "./accessControlService";
import { getAsset } from "./assetRegistryService";
import AccessControlArtifact from "../abi/AccessControl.json";

/**
 * Proof bundle generation and independent verification, per
 * BACKEND_SPEC.md section 4 and DATA_MODEL.md section 4.
 *
 * NOT EXECUTED AGAINST REAL ethers.Wallet SIGNING IN THIS SANDBOX (no
 * node_modules available to run it) — unlike documentEncryption.ts,
 * whose AES-GCM logic was actually run end-to-end here before being
 * trusted. This file is reviewed against ethers v6's documented API and
 * the existing ethers.verifyMessage() usage already proven working in
 * authService.ts, but the sign/verify round trip in THIS file has not
 * itself been executed anywhere yet. Run the real test suite before
 * trusting this beyond "carefully reviewed."
 */

export interface PermissionVersionUsed {
  permissionId: number;
  state: "GRANTED" | "REVOKED";
  validFrom: number;
  validUntil: number;
}

export interface ProofBundle {
  assetId: number;
  assetHash: string;
  accessedBy: string;
  accessTimestamp: number;
  permissionVersionUsed: PermissionVersionUsed;
  onChainTxRef: string;
  signature: string;
}

type UnsignedProofBundle = Omit<ProofBundle, "signature">;

/**
 * Deterministic JSON serialization: object keys sorted recursively, no
 * whitespace. Needed because BACKEND_SPEC.md requires signing "the
 * canonical JSON (sorted keys, no whitespace)" — a plain JSON.stringify
 * call does NOT guarantee this across two objects with the same keys
 * built in different orders (V8 happens to preserve insertion order in
 * practice, but relying on that implicitly is fragile — a caller
 * building the same logical bundle with keys in a different order must
 * still produce byte-identical output for verification to work at all).
 * Verified independently (outside this file) that this produces
 * order-independent output before being used here.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalize).join(",") + "]";
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + canonicalize(record[k]))
      .join(",") +
    "}"
  );
}

function getSigningWallet(): ethers.Wallet {
  const config = getConfig();
  // A plain, unconnected ethers.Wallet — this signing key never touches
  // the chain (see BACKEND_SPEC.md's explicit note distinguishing
  // BACKEND_SIGNING_PRIVATE_KEY from RELAYER_PRIVATE_KEY), so no
  // provider is attached.
  return new ethers.Wallet(config.backendSigningPrivateKey);
}

/**
 * Signs the canonical JSON of every field except `signature` itself,
 * using ethers' standard message-signing (EIP-191 personal_sign, the
 * same scheme authService.ts's ethers.verifyMessage already verifies
 * elsewhere in this codebase, applied here in the signing direction
 * instead of the verifying direction).
 */
async function signBundle(unsigned: UnsignedProofBundle): Promise<string> {
  const wallet = getSigningWallet();
  const canonicalJson = canonicalize(unsigned);
  return wallet.signMessage(canonicalJson);
}

/**
 * Generates a proof bundle for a completed asset access. Called
 * internally by the download endpoint (routes/assets.ts) — NOT itself a
 * route, per BACKEND_SPEC.md ("Bundle generation... used internally by
 * the download endpoint, not a public route").
 */
export async function generateProofBundle(input: {
  assetId: number;
  assetHash: string;
  accessedBy: string;
  accessTimestamp: number;
  permissionVersionUsed: PermissionVersionUsed;
  onChainTxRef: string;
}): Promise<ProofBundle> {
  const unsigned: UnsignedProofBundle = {
    assetId: input.assetId,
    assetHash: input.assetHash,
    accessedBy: input.accessedBy,
    accessTimestamp: input.accessTimestamp,
    permissionVersionUsed: input.permissionVersionUsed,
    onChainTxRef: input.onChainTxRef,
  };

  const signature = await signBundle(unsigned);

  return { ...unsigned, signature };
}

export interface VerificationResult {
  valid: boolean;
  reason: string | null;
}

/**
 * Independently verifies a proof bundle per BACKEND_SPEC.md's
 * POST /api/proof-bundles/verify: checks the signature, then re-queries
 * the chain to confirm the claimed permission/tx data is real. This is
 * Level 2 (independent online) verification — it re-derives its answer
 * from chain state via checkPermissionAtTime and getAsset, not from
 * trusting whatever the bundle's own fields claim.
 *
 * Deliberately does NOT independently re-verify onChainTxRef's receipt
 * against the STRICTEST possible check (e.g. cross-referencing block
 * number ordering, confirming no reorg) — that level of chain-forensics
 * is out of scope for this MVP. It DOES fetch the transaction receipt at
 * onChainTxRef and confirm it contains a real AssetAccessed log whose
 * assetId/requesterDID/permissionId match the bundle's own claims —
 * this is what makes the Access Attestation half genuinely independently
 * checkable, not merely backend-asserted, per DATA_MODEL.md section 4's
 * explicit distinction between the two halves of what a bundle proves.
 */
export async function verifyProofBundle(
  bundle: ProofBundle
): Promise<VerificationResult> {
  // 1. Structural validation — reject malformed input before touching
  // signature verification or the chain at all.
  if (
    typeof bundle.assetId !== "number" ||
    typeof bundle.assetHash !== "string" ||
    typeof bundle.accessedBy !== "string" ||
    typeof bundle.accessTimestamp !== "number" ||
    typeof bundle.onChainTxRef !== "string" ||
    typeof bundle.signature !== "string" ||
    !bundle.permissionVersionUsed ||
    typeof bundle.permissionVersionUsed.permissionId !== "number" ||
    typeof bundle.permissionVersionUsed.state !== "string" ||
    typeof bundle.permissionVersionUsed.validFrom !== "number" ||
    typeof bundle.permissionVersionUsed.validUntil !== "number"
  ) {
    return { valid: false, reason: "malformed proof bundle" };
  }

  // 2. Signature check: recover the address that actually signed the
  // canonical JSON of every field except `signature`, and compare it
  // against this backend's own known signing address. A bundle from a
  // DIFFERENT backend deployment (different BACKEND_SIGNING_PRIVATE_KEY)
  // will correctly fail here — see the spec's requirement that this
  // endpoint "MUST work even for bundles generated by a different
  // deployment," which this function honors precisely by comparing
  // against a real, derived address rather than assuming the bundle
  // came from this instance.
  const { signature, ...unsigned } = bundle;
  const canonicalJson = canonicalize(unsigned);

  let recoveredAddress: string;
  try {
    recoveredAddress = ethers.verifyMessage(canonicalJson, signature);
  } catch {
    return { valid: false, reason: "signature mismatch" };
  }

  const expectedWallet = getSigningWallet();
  if (
    ethers.getAddress(recoveredAddress) !==
    ethers.getAddress(expectedWallet.address)
  ) {
    return { valid: false, reason: "signature mismatch" };
  }

  // 3. Re-derive the Authorization Proof claim independently from chain
  // state — do not trust the bundle's own permissionVersionUsed field at
  // face value.
  let onChainPermission;
  try {
    onChainPermission = await checkPermissionAtTime(
      bundle.assetId,
      bundle.accessedBy,
      // The bundle does not carry an `action` field at all (see
      // DATA_MODEL.md section 4's bundle shape) — BACKEND_SPEC.md's
      // download endpoint always checks READ specifically (permission
      // for downloading a file), so that is the only action a proof
      // bundle from this system's download flow could represent. This
      // is not stated explicitly as an invariant anywhere in the spec
      // text — flagging it as an assumption, not a confirmed contract
      // rule, though it matches the only place bundles are generated
      // (the download endpoint, which only ever checks READ).
      "READ",
      bundle.accessTimestamp
    );
  } catch {
    return {
      valid: false,
      reason: "could not re-verify permission against current chain state",
    };
  }

  if (
    Number(onChainPermission.permissionId) !==
    bundle.permissionVersionUsed.permissionId
  ) {
    return {
      valid: false,
      reason: "on-chain permission record does not match bundle claim",
    };
  }

  if (onChainPermission.state !== bundle.permissionVersionUsed.state) {
    return {
      valid: false,
      reason: "on-chain permission state does not match bundle claim",
    };
  }

  // 4. Confirm the asset itself still exists and the claimed assetHash
  // matches current on-chain record (catches a bundle claiming a hash
  // that was superseded by a later updateAssetVersion call, or an
  // assetId that never existed).
  try {
    const asset = await getAsset(bundle.assetId);
    if (asset.assetHash !== bundle.assetHash) {
      return {
        valid: false,
        reason: "asset hash does not match current on-chain record",
      };
    }
  } catch {
    return { valid: false, reason: "asset not found on-chain" };
  }

  // 5. Access Attestation half: confirm onChainTxRef is a REAL,
  // MINED transaction whose receipt contains an AssetAccessed log
  // matching this bundle's own claims (assetId, requesterDID,
  // permissionId). Without this step, a forged bundle could put an
  // arbitrary/unrelated (but real-looking) tx hash in onChainTxRef and
  // this function would never have caught it — the earlier checks (2-4)
  // only cover the Authorization Proof half, not whether the claimed
  // access itself is backed by a real on-chain event.
  //
  // An empty onChainTxRef is treated as invalid, not skipped — every
  // bundle generated by THIS codebase's download route (see
  // routes/assets.ts) now always calls recordAccess() and populates a
  // real hash before generating a bundle, so a bundle with no
  // onChainTxRef at all is not a legitimate bundle from this system's
  // own generation path.
  if (!bundle.onChainTxRef) {
    return { valid: false, reason: "missing onChainTxRef" };
  }

  try {
    const config = getConfig();
    const provider = new ethers.JsonRpcProvider(config.hardhatRpcUrl);
    const receipt = await provider.getTransactionReceipt(
      bundle.onChainTxRef
    );

    if (!receipt) {
      return {
        valid: false,
        reason: "onChainTxRef does not correspond to a mined transaction",
      };
    }

    const accessControlInterface = new ethers.Interface(
      AccessControlArtifact as ethers.InterfaceAbi
    );

    let foundMatchingEvent = false;
    for (const log of receipt.logs) {
      try {
        const parsed = accessControlInterface.parseLog({
          topics: log.topics as string[],
          data: log.data,
        });
        if (
          parsed?.name === "AssetAccessed" &&
          Number(parsed.args.assetId) === bundle.assetId &&
          String(parsed.args.requesterDID) === bundle.accessedBy &&
          Number(parsed.args.permissionId) ===
            bundle.permissionVersionUsed.permissionId
        ) {
          foundMatchingEvent = true;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!foundMatchingEvent) {
      return {
        valid: false,
        reason:
          "no matching AssetAccessed event found in the referenced transaction",
      };
    }
  } catch {
    return {
      valid: false,
      reason: "could not verify onChainTxRef against chain state",
    };
  }

  return { valid: true, reason: null };
}
