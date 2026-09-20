# Smart Contracts Specification

Read `DATA_MODEL.md` first — every struct and field referenced here is
defined there. Do not invent additional fields or rename existing ones
without updating that document and notifying the team.

## Scope for this build

Three contracts. Keep them separate — do not merge them into one giant
contract, and do not split them further than this without discussion.

1. `IdentityRegistry.sol`
2. `AccessControl.sol` (this is where policy-at-the-time verification lives)
3. `AssetRegistry.sol` (NFT-backed asset records)

Target: Solidity ^0.8.20 (pinned in `hardhat.config.js` to exactly `0.8.24`
as of this revision — see the compiler/EVM note below). Target network for
this phase: **local Hardhat network only.** Do not add testnet deployment
scripts yet — that's a later phase once the core logic is tested and
working.

**Compiler and EVM target (explicit, hard-won — do not silently change):**
`hardhat.config.js` pins Solidity `0.8.24` and sets
`settings.evmVersion: "cancun"` explicitly, rather than relying on
Hardhat's default. This is necessary, not incidental: OpenZeppelin
`^5.0.0` resolves to a `5.x` release whose `Bytes.sol` uses the `mcopy`
opcode (EIP-5656, introduced in the Cancun hard fork). Hardhat defaults to
the older `paris` EVM target for solc `>= 0.8.20` specifically to avoid
opcode-support issues on real-world chains that don't yet support newer
opcodes — but since this project only targets a local Hardhat network in
this phase (no testnet, no mainnet), targeting `cancun` is safe and
required for `AssetRegistry.sol`'s ERC-721 import to compile at all.
Compiling without this setting fails with `DeclarationError: Function
"mcopy" not found`.

## 1. IdentityRegistry.sol

Canonical resolver between DID strings and addresses for the entire
system, in ADDITION to the role/status source-of-truth role described
below. This is an explicit architectural invariant, not a convenience
feature — `AccessControl` and `AssetRegistry` both resolve DIDs through
this single contract rather than maintaining their own mappings.

```solidity
enum Role { NONE, ADMIN, MANAGER, AUDITOR, USER }
enum IdentityStatus { ACTIVE, REVOKED }

struct Identity {
    string did;
    bytes publicKey;
    Role role;
    IdentityStatus status;
    uint256 createdAt;
}

// Constructor: the deployer becomes the first ADMIN, registered as
// ACTIVE, using REAL initialization data supplied at deployment — not
// placeholder values. Solves the bootstrapping problem: an empty
// registry has no existing Admin who could otherwise call
// registerIdentity for anyone. Emits the SAME IdentityRegistered event
// that every subsequent registration emits — the bootstrap identity is
// not a special, invisible case in the audit trail.
constructor(string memory did, bytes memory publicKey);

// Only an existing, ACTIVE ADMIN can call this (role == ADMIN AND
// status == ACTIVE — a revoked Admin loses admin rights immediately;
// this is deliberate, for consistency with how AccessControl treats
// revoked identities elsewhere).
//
// Rejects a DID that is already mapped to a different, non-zero
// address (see resolveDID below) — a DID must be unique and must not
// be silently reassigned.
function registerIdentity(
    address identityAddress,
    string calldata did,
    bytes calldata publicKey,
    Role role
) external; // emits IdentityRegistered

// Only ADMIN can call. Sets status to REVOKED. Does not delete the record —
// history must remain queryable. Does NOT clear the DID->address mapping
// (see resolveDID) — historical permissions, ownership records, and audit
// events must remain resolvable after revocation.
function revokeIdentity(address identityAddress) external; // emits IdentityRevoked

// Read-only. Returns the full Identity struct. Reverts if the address was
// never registered (this is NOT the same behavior as getRole, which
// returns Role.NONE instead — see below).
function getIdentity(address identityAddress) external view returns (Identity memory);

// Read-only. Used by other contracts (AccessControl, AssetRegistry) and by
// the backend's auth flow to check role and active status before allowing
// an operation.
function isActive(address identityAddress) external view returns (bool);

// Returns Role.NONE for an address that was never registered, rather
// than reverting — callers can safely check this without a try/catch.
function getRole(address identityAddress) external view returns (Role);

// Resolves a DID string to its registered address. THE canonical
// DID -> address resolution mechanism for the whole system.
//   Unknown DID       -> address(0)
//   Known active DID  -> registered address
//   Known revoked DID -> SAME registered address (unchanged by revocation)
//   Duplicate DID     -> registration rejected (see registerIdentity)
function resolveDID(string calldata did) external view returns (address);

event IdentityRegistered(address indexed identityAddress, string did, Role role, uint256 timestamp);
event IdentityRevoked(address indexed identityAddress, uint256 timestamp);
```

**Enforcement rule:** every other contract's state-changing functions must
call `isActive()` (and, where relevant, `getRole()`) on `IdentityRegistry`
before proceeding. Do not duplicate role-storage in other contracts — this
contract is the single source of truth for who someone is and what role
they hold, AND for resolving between their DID and address representations.

**Note:** this contract stores only CURRENT status (ACTIVE/REVOKED), not a
history of status changes over time. This has a direct consequence for
historical authorization — see Section 2's note on `checkPermissionAtTime`.

## 2. AccessControl.sol — the core USP, read this section carefully

This is where policy-at-the-time verification lives. The critical design
rule: **permissions are never overwritten or deleted.** Granting or revoking
creates a NEW permission record; the old one is closed out by setting its
`validUntil` to the new record's `validFrom`. This is what makes historical
verification possible.

```solidity
enum Action { READ, WRITE, TRANSFER }
enum PermissionState { GRANTED, REVOKED }

struct Permission {
    uint256 permissionId;
    uint256 assetId;
    string subjectDID;
    Action action;
    PermissionState state;
    string grantedBy;
    uint256 validFrom;
    uint256 validUntil; // 0 means "still current, no newer version exists"
}

// Only ADMIN or MANAGER may call. Creates a new Permission record.
// If a permission already exists for this (assetId, subjectDID, action)
// combination with validUntil == 0, that existing record's validUntil
// MUST be set to block.timestamp before the new record is created.
// The caller (msg.sender, resolved to a DID/role via IdentityRegistry)
// MUST be isActive() — see enforcement rule in Section 1.
function setPermission(
    uint256 assetId,
    string calldata subjectDID,
    Action action,
    PermissionState state
) external; // emits PermissionChanged

// Given an asset, subject, action, and a historical timestamp, walk the
// permission history and return what was true AT THAT MOMENT. This must
// NOT simply return current state — it must find the permission record
// where validFrom <= atTimestamp < validUntil (or validUntil == 0 AND
// validFrom <= atTimestamp for the current one). Returns
// PermissionState.REVOKED (safe default) if no record is found for that
// timestamp (i.e., permission didn't exist yet at that time).
//
// IDENTITY STATUS HANDLING (explicit, do not assume otherwise): this
// function evaluates PERMISSION state as of the historical timestamp only.
// It does NOT check the subject's CURRENT IdentityRegistry status, and
// must NOT retroactively invalidate a permission that was legitimately
// valid at the queried timestamp just because the subject was later
// revoked. Example: if a subject was ACTIVE and granted READ access on
// Jan 12, then revoked on Jan 13, a query for Jan 12 must still report
// that access as legitimate at that time.
//
// OPEN QUESTION, not resolved by this spec: IdentityRegistry (Section 1)
// stores only CURRENT status, not a status history. This function
// therefore cannot verify whether the subject was ACTIVE at the
// historical timestamp itself — only that a permission record existed
// for that timestamp. Whether this gap matters for MVP correctness is
// undecided and should be raised with the team before assuming either
// answer.
function checkPermissionAtTime(
    uint256 assetId,
    string calldata subjectDID,
    Action action,
    uint256 atTimestamp
) external view returns (Permission memory);

// Convenience function for CURRENT (real-time) access decisions — this is
// what protected backend endpoints call, e.g. before releasing a file
// download. NOT simply checkPermissionAtTime(..., block.timestamp) — it
// carries one additional, mandatory requirement:
//
// MUST resolve subjectDID to an address via IdentityRegistry.resolveDID(),
// then call IdentityRegistry.isActive() on that address, returning false
// if the DID doesn't resolve (address(0)) or the identity is REVOKED —
// regardless of any GRANTED permission record. This means identity
// revocation takes effect on current asset access immediately, independent
// of any outstanding backend JWT session validity (see BACKEND_SPEC.md
// Authentication section for why this matters: JWT role claims can go
// stale for up to 15 minutes, but this check ensures asset ACCESS never
// does).
function checkPermissionNow(
    uint256 assetId,
    string calldata subjectDID,
    Action action
) external view returns (bool allowed);

event PermissionChanged(
    uint256 indexed permissionId,
    uint256 indexed assetId,
    string subjectDID,
    Action action,
    PermissionState state,
    string grantedBy,
    uint256 validFrom
);

// Emitted whenever a backend-mediated access (e.g. a file download) is
// granted following a successful checkPermissionNow check. This makes
// "access occurred" an independently verifiable on-chain fact rather than
// only a backend-asserted one (see DATA_MODEL.md section 4, Authorization
// Proof vs. Access Attestation). The backend's download endpoint must
// call the function that emits this event as part of granting access,
// not merely log it in Postgres.
event AssetAccessed(
    uint256 indexed assetId,
    string requesterDID,
    uint256 permissionId,
    uint256 timestamp
);
```

### 2.1 Current vs. Historical Authorization — Identity Status Handling

Stated explicitly here because the distinction is easy to lose across two
separate function comments:

- **`checkPermissionNow`** — permission state AND current identity status
  are BOTH required. `isActive()` check applies. A revoked identity is
  denied immediately regardless of permission records.
- **`checkPermissionAtTime`** — permission state as of the historical
  timestamp only. Current identity status is explicitly NOT applied
  retroactively. See the open question noted above about historical
  identity status, which this spec does not resolve.

### 2.2 Recording access on-chain

```solidity
function recordAccess(
    uint256 assetId,
    string calldata requesterDID,
    uint256 permissionId
) external; // emits AssetAccessed
```

**CRITICAL, corrected from an earlier draft of this spec:** this function
does NOT merely trust that the caller already ran `checkPermissionNow` —
it independently RE-VERIFIES authorization itself before emitting the
event, by calling `checkPermissionNow(assetId, requesterDID, READ)`
internally. An earlier version of this spec described `recordAccess` as
trusting the caller's prior check ("does not re-run the permission check
itself"); that description was rejected as a genuine vulnerability — a
function that only trusts the caller's word is a way for any caller to
manufacture a valid-looking `AssetAccessed` event without a real
authorized access ever having occurred. The event must represent a
legitimate access operation, not merely someone invoking an endpoint that
emits an event. `recordAccess` also independently requires its OWN caller
(`msg.sender` — typically the backend's on-chain relay identity) to be a
registered, active identity — this is a distinct check from the
`requesterDID` authorization check, since the caller and the subject of
the access are different identities.

This was previously an open question in earlier drafts (which contract
should own this event). Resolved here: it lives in `AccessControl.sol`,
since access-gating is this contract's functional domain and the event is
emitted as a direct consequence of a `checkPermissionNow` result, not of
any `AssetRegistry` state change.

**Implementation note for whoever builds `checkPermissionAtTime`:** the
straightforward way to support it efficiently is to keep an array (or
mapping to array) of all Permission records per `(assetId, subjectDID,
action)` key, appended to (never removed from), and linearly scan for the
record whose `[validFrom, validUntil)` range contains `atTimestamp`. For
hackathon scope, a linear scan is fine — do not over-engineer this into a
more complex data structure unless the array grows large enough in testing
to matter.

**Known, accepted limitation (not scheduled for a fix):** if two
transactions affecting the same permission key land in the same block,
they may share an identical `block.timestamp`, making relative ordering
ambiguous from timestamp alone. For stronger historical ordering, a future
version could additionally record `blockNumber`/`transactionIndex`. Not
required for the hackathon build.

## 3. AssetRegistry.sol

Implements a standard NFT (ERC-721) where the token represents ownership of
an asset record. Use OpenZeppelin's ERC-721 as the base — do not write ERC-721
from scratch.

```solidity
enum AssetStatus { ACTIVE, REVOKED }
enum Classification { PUBLIC, INTERNAL, CONFIDENTIAL }

struct Asset {
    uint256 assetId; // same as the ERC-721 tokenId
    bytes32 assetHash;
    string ownerDID;
    string metadataURI;
    Classification classification;
    AssetStatus status;
    uint256 version;
    uint256 createdAt;
}

// Constructor takes BOTH IdentityRegistry's and AccessControl's
// addresses — this contract depends on both (identity/role checks via
// IdentityRegistry, TRANSFER permission checks via AccessControl). This
// means the required deployment order is strictly IdentityRegistry ->
// AccessControl -> AssetRegistry, not merely "IdentityRegistry first,
// the other two in either order" (see Cross-contract dependency below).
constructor(address identityRegistryAddress, address accessControlAddress);

// Only ADMIN may call. Mints a new NFT, assigns it to ownerDID, stores the
// Asset struct. assetId is auto-incremented starting from 1. Rejects if
// ownerDID does not resolve to a registered, active identity.
function registerAsset(
    bytes32 assetHash,
    string calldata ownerDID,
    string calldata metadataURI,
    Classification classification
) external returns (uint256 assetId); // emits AssetRegistered

// Callable by ADMIN, or by the current owner if they hold TRANSFER
// permission per AccessControl.checkPermissionNow(). Takes the
// destination as an ADDRESS, not a DID string — the address is the
// source of truth, DID is derived metadata (see the ownership
// consistency requirement above). newOwnerDID was REMOVED as a
// parameter in this revision, precisely to prevent a caller from
// supplying a DID that might not match the actual destination address.
//
// OWNERSHIP CONSISTENCY REQUIREMENT: this asset is an ERC-721 token,
// and ERC-721 tracks ownership via an address (ownerOf(tokenId) returns
// an address, not a string). This function updates both the actual
// ERC-721 owner and the ownerDID field atomically in a single
// transaction — ownerDID is DERIVED from newOwner's registered identity
// (via IdentityRegistry.getIdentity(newOwner).did) after confirming
// newOwner is active, never taken as a caller-supplied string.
//
// AUTHORIZATION MODEL (explicit, not a redesign of the literal spec
// wording above): TRANSFER permission is evaluated against the CURRENT
// OWNER'S OWN DID via checkPermissionNow — i.e. a non-admin transfer
// requires the owner to hold a TRANSFER permission record naming
// themselves as subject. AccessControl's permission API is keyed by
// subjectDID with no separate "delegate" concept, so this is the only
// shape this MVP supports; a genuinely distinct "authorize a third
// party to transfer on my behalf" model is out of scope.
//
// SEQUENCE, checks-effects-interactions (do not reorder — this exact
// order is required, not a style preference):
//   1. Verify asset exists
//   2. Read current owner (ownerOf)
//   3. Determine caller authorization (ADMIN, or current owner + TRANSFER
//      permission on their own DID)
//   4. Verify newOwner is a registered, ACTIVE identity
//   5. Resolve newOwner -> DID via IdentityRegistry.getIdentity
//      (authoritative — never caller-supplied)
//   6. EFFECT: update Asset.ownerDID to the resolved DID
//   7. Emit AssetOwnershipTransferred
//   8. INTERACTION: perform the actual ERC-721 transfer LAST
// Steps 6-7 (this contract's own state) are deliberately ordered BEFORE
// step 8 (the external-call-capable ERC-721 transfer, which can invoke
// onERC721Received on newOwner if it is a contract) — effects before
// interactions. An earlier draft of this function ordered the ERC-721
// transfer before the ownerDID update; that ordering was corrected
// because it left a window, during the transfer call, where
// ownerOf(assetId) and Asset.ownerDID could disagree if the recipient's
// onERC721Received hook re-entered this contract.
//
// Must NOT delete or reuse the assetId — ownership history stays
// queryable via the AssetOwnershipTransferred events.
function transferAsset(uint256 assetId, address newOwner) external;
    // emits AssetOwnershipTransferred

// Only ADMIN may call. Registers a new version of an existing asset (e.g.
// a corrected/updated document). Increments version, updates assetHash and
// metadataURI, keeps the same assetId.
function updateAssetVersion(
    uint256 assetId,
    bytes32 newAssetHash,
    string calldata newMetadataURI
) external; // emits AssetVersionUpdated

function getAsset(uint256 assetId) external view returns (Asset memory);

event AssetRegistered(uint256 indexed assetId, string ownerDID, bytes32 assetHash, uint256 timestamp);
event AssetOwnershipTransferred(uint256 indexed assetId, string previousOwnerDID, string newOwnerDID, uint256 timestamp);
event AssetVersionUpdated(uint256 indexed assetId, uint256 newVersion, bytes32 newAssetHash, uint256 timestamp);
```

**Deferred, explicitly not adopted for this spec revision:** using
`address` internally instead of `string subjectDID`/`ownerDID`/`grantedBy`
throughout the contracts would be cleaner and cheaper Solidity (avoids
unnecessary string storage/comparison costs). This is a valid observation
but requires a deliberate team decision to change the frozen data shapes in
`DATA_MODEL.md` — not done here. DID strings remain as currently specified.

## Cross-contract dependency

Deployment order is strict, not "IdentityRegistry first, then the other
two in either order":

```
IdentityRegistry
      |
      v
AccessControl
      |
      v
AssetRegistry
```

`AccessControl` depends on `IdentityRegistry` (identity/role checks).
`AssetRegistry` depends on BOTH `IdentityRegistry` (identity/role checks)
AND `AccessControl` (TRANSFER permission checks in `transferAsset`) — so
it must be deployed last. Do not hardcode addresses — use constructor
injection so tests can deploy fresh instances each time. Do not weaken
this by duplicating `AccessControl`'s authorization logic inside
`AssetRegistry` — it must call into the real deployed `AccessControl`
contract.

## Testing requirement (not optional)

Write Hardhat tests for, at minimum:
- Registering an identity, then confirming a non-Admin cannot register others
- Setting a permission, then changing it, then confirming
  `checkPermissionAtTime` returns the correct historical state for a
  timestamp before AND after the change (this is the test that proves the
  core USP actually works — do not skip it)
- Revoking an identity, then confirming `checkPermissionNow` returns false
  for that identity even though a GRANTED permission record still exists —
  this is the test that proves the current-authorization identity-status
  requirement (Section 2.1) actually works — do not skip it
- Confirming `checkPermissionAtTime` for a timestamp BEFORE a subsequent
  revocation still returns the permission state as it was at that time
  (i.e. revocation does not retroactively rewrite history)
- Registering an asset, transferring it, confirming `getAsset` reflects the
  new owner, that ownership events fire correctly, AND that the ERC-721
  `ownerOf(assetId)` matches the new owner's registered address (not just
  that `ownerDID` was updated — see the ownership consistency requirement
  in Section 3)

Put tests in `contracts/test/`. Name files `IdentityRegistry.test.js`,
`AccessControl.test.js`, `AssetRegistry.test.js`.

**Status as of this revision:** all three contracts are implemented and
all three test files exist, with 56 tests passing across the full suite
(20 IdentityRegistry, 19 AccessControl, 17 AssetRegistry) — including
every test in the list above. This is not a target anymore; it's
confirmed via an actual `npx hardhat test` run, not merely written and
assumed correct.

## What NOT to build in this phase

- No testnet deployment
- No multisig/threshold signing (explicitly future work per the pitch)
- No physical component/parts tracking (explicitly future work)
- No gas optimization pass — correctness first, optimize later if time allows
- No historical identity-status tracking in IdentityRegistry (see the open
  question in Section 2) — raise with the team before building around an
  assumed answer either way
