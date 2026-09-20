import { ethers } from "ethers";
import { getConfig } from "../config";
import IdentityRegistryArtifact from "../abi/IdentityRegistry.json";

/**
 * Thin read-only wrapper around the deployed IdentityRegistry contract.
 *
 * The ABI used here is copied directly from the real Hardhat compilation
 * output (contracts/artifacts/contracts/IdentityRegistry.sol/
 * IdentityRegistry.json), NOT hand-retyped from the spec or handoff docs.
 * This is a deliberate choice, made explicitly to avoid ABI drift between
 * this service and the actual on-chain contract.
 *
 * IMPORTANT: if IdentityRegistry.sol changes and is recompiled, the copy
 * at backend/src/abi/IdentityRegistry.json must be re-synced by hand
 * (there is no automated step doing this yet — contracts/ and backend/
 * are separate npm workspaces and contracts/artifacts/ is gitignored
 * build output, not committed). Re-copy the artifact after any contract
 * change, before trusting this service again. It lives under src/ (not
 * a top-level backend/abi/) specifically so tsconfig's existing
 * src-only "include" glob, combined with resolveJsonModule, can pick it
 * up without a tsconfig change.
 *
 * Only read (view) functions are exposed here. Nothing in this file signs
 * or sends transactions — that is RELAYER_PRIVATE_KEY's job, for a later
 * chunk of work (privileged writes), not this one.
 */

// This service only needs read access, so a plain JsonRpcProvider is
// sufficient — no Signer/Wallet is constructed here, deliberately, since
// nothing in this file writes to chain.
let cachedProvider: ethers.JsonRpcProvider | null = null;
let cachedContract: ethers.Contract | null = null;

function getProvider(): ethers.JsonRpcProvider {
  if (!cachedProvider) {
    const config = getConfig();
    cachedProvider = new ethers.JsonRpcProvider(config.hardhatRpcUrl);
  }
  return cachedProvider;
}

function getContract(): ethers.Contract {
  if (!cachedContract) {
    const config = getConfig();
    cachedContract = new ethers.Contract(
      config.identityRegistryAddress,
      IdentityRegistryArtifact.abi,
      getProvider()
    );
  }
  return cachedContract;
}

/**
 * Resolves a DID string to its registered on-chain address.
 *
 * Per IdentityRegistry.sol / CONTRACTS_SPEC.md: an unknown DID is NOT an
 * error condition and does NOT revert — it is a normal, expected result
 * represented by the zero address. Callers must check for
 * ethers.ZeroAddress explicitly; do not wrap this call in a try/catch
 * expecting an unknown-DID revert, there isn't one. (This is distinct
 * from getIdentity(), which DOES revert for an unregistered address —
 * that function is not used by this service.)
 */
export async function resolveDID(did: string): Promise<string> {
  const contract = getContract();
  const address: string = await contract.resolveDID(did);
  return address;
}

/**
 * Returns whether the given address's identity is currently ACTIVE.
 * Per IdentityRegistry.sol, this returns false (not a revert) for an
 * address that was never registered at all, same as for a REVOKED one —
 * this function does not distinguish "never existed" from "revoked."
 * Callers needing that distinction must call resolveDID first and check
 * for the zero address separately.
 */
export async function isActive(address: string): Promise<boolean> {
  const contract = getContract();
  const active: boolean = await contract.isActive(address);
  return active;
}

/**
 * Returns the current on-chain role for an identity address. The raw enum
 * value is intentionally returned here; authentication maps it to the
 * canonical human-readable JWT role name using IdentityRegistry.sol's
 * authoritative enum ordering.
 */
export async function getRole(address: string): Promise<number> {
  const contract = getContract();
  const role: bigint | number = await contract.getRole(address);
  return Number(role);
}

/**
 * Convenience combined check for the /challenge route's needs: resolves
 * a DID and reports whether it maps to a known, currently-active
 * identity. Returns the resolved address alongside the active flag so
 * the caller (the route handler) can store the correct expectedAddress
 * without a second resolveDID call.
 */
export async function resolveActiveIdentity(
  did: string
): Promise<{ address: string; known: boolean; active: boolean }> {
  const address = await resolveDID(did);
  const known = address !== ethers.ZeroAddress;
  if (!known) {
    return { address, known: false, active: false };
  }
  const active = await isActive(address);
  return { address, known: true, active };
}

/**
 * For tests only: clears cached provider/contract so a fresh instance is
 * built (e.g. against a mocked provider) on next access. Mirrors the
 * pattern already used in config.ts's _resetConfigCacheForTests.
 */
export function _resetIdentityRegistryServiceForTests(): void {
  cachedProvider = null;
  cachedContract = null;
}
