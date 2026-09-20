import { ethers } from "ethers";
import { getConfig } from "../config";
import IdentityRegistryArtifact from "../abi/IdentityRegistry.json";
import { getRelayerSigner } from "./accessControlService";
import type { JwtRole } from "./authService";

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
 * Returns a Contract instance bound to the shared relayer wallet
 * (getRelayerSigner(), from accessControlService.ts), so writes here go
 * through the same serialized nonce-management queue as every other
 * relayed transaction in this backend. Deliberately NOT cached at module
 * scope the way getContract() (read-only) is above — getRelayerSigner()
 * already returns a cached singleton wallet internally, so caching a
 * second layer here would only risk the two caches drifting if
 * accessControlService.ts's relayer wallet is ever reset independently
 * (see _resetAccessControlServiceForTests) while this module's own cache
 * was not.
 */
function getWriteContract(): ethers.Contract {
  const config = getConfig();
  return new ethers.Contract(
    config.identityRegistryAddress,
    IdentityRegistryArtifact.abi,
    getRelayerSigner()
  );
}

/**
 * IdentityRegistry.sol's authoritative Role enum ordering (also
 * documented in authorizationService.ts's roleFromContractValue, which
 * maps the same values in the read direction — keep both in sync if the
 * contract's enum ever changes):
 *
 * NONE    = 0
 * ADMIN   = 1
 * MANAGER = 2
 * AUDITOR = 3
 * USER    = 4
 */
const ROLE_TO_CONTRACT_VALUE: Record<JwtRole, number> = {
  ADMIN: 1,
  MANAGER: 2,
  AUDITOR: 3,
  USER: 4,
};

export function roleToContractValue(role: JwtRole): number {
  return ROLE_TO_CONTRACT_VALUE[role];
}

/**
 * Registers a new identity on-chain via IdentityRegistry.registerIdentity,
 * relayed through the backend's own signing key (see BACKEND_SPEC.md's
 * Privileged Write Path section — the CALLER of this function, not this
 * function itself, is responsible for performing the mandatory fresh
 * requireCurrentRole() check before invoking it; this function does not
 * re-check authorization on its own, since it has no access to the
 * requesting JWT).
 *
 * Does not touch Postgres — storing the off-chain displayName is the
 * caller's responsibility (see POST /api/identities in routes/identities.ts),
 * kept separate here so this service function has exactly one
 * responsibility and can be tested against a mocked contract without a
 * database.
 *
 * Throws whatever ethers throws for a reverted/failed transaction (e.g.
 * the contract's own "DID already registered" revert) — the caller
 * translates that into the route's error response shape.
 */
export async function registerIdentity(input: {
  identityAddress: string;
  did: string;
  publicKey: string;
  role: JwtRole;
}): Promise<{ txHash: string }> {
  const contract = getWriteContract();
  const tx = await contract.registerIdentity(
    input.identityAddress,
    input.did,
    input.publicKey,
    roleToContractValue(input.role)
  );
  const receipt = await tx.wait();
  return { txHash: receipt.hash };
}

/**
 * Returns the full on-chain Identity struct. Per CONTRACTS_SPEC.md, this
 * REVERTS for an address that was never registered — distinct from
 * getRole()/isActive() above, which return NONE/false instead. Callers
 * needing to distinguish "not found" from other errors should catch and
 * treat any rejection here as "not found" (there is no other revert
 * condition on this view function per the contract spec).
 */
export async function getIdentity(address: string): Promise<{
  did: string;
  publicKey: string;
  role: number;
  status: number;
  createdAt: bigint;
}> {
  const contract = getContract();
  const identity = await contract.getIdentity(address);
  return {
    did: identity.did,
    publicKey: identity.publicKey,
    role: Number(identity.role),
    status: Number(identity.status),
    createdAt: identity.createdAt,
  };
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
