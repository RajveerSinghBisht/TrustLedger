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

Target: Solidity ^0.8.20. Target network for this phase: **local Hardhat
network only.** Do not add testnet deployment scripts yet — that's a later
phase once the core logic is tested and working.

## 1. IdentityRegistry.sol

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

// Only an existing ADMIN can call this. The very first Admin is set in the
// constructor (deployer becomes the first Admin) — bootstrapping problem,
// solved simply for this scope.
function registerIdentity(
    address identityAddress,
    string calldata did,
    bytes calldata publicKey,
    Role role
) external; // emits IdentityRegistered

// Only ADMIN can call. Sets status to REVOKED. Does not delete the record —
// history must remain queryable.
function revokeIdentity(address identityAddress) external; // emits IdentityRevoked

// Read-only. Returns the full Identity struct.
function getIdentity(address identityAddress) external view returns (Identity memory);

// Read-only. Used by other contracts (AccessControl, AssetRegistry) and by
// the backend's auth flow to check role and active status before allowing
// an operation.
function isActive(address identityAddress) external view returns (bool);
function getRole(address identityAddress) external view returns (Role);

event IdentityRegistered(address indexed identityAddress, string did, Role role, uint256 timestamp);
event IdentityRevoked(address indexed identityAddress, uint256 timestamp);
```

**Enforcement rule:** every other contract's state-changing functions must
call `isActive()` (and, where relevant, `getRole()`) on `IdentityRegistry`
before proceeding. Do not duplicate role-storage in other contracts — this
contract is the single source of truth for who someone is and what role
they hold.

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
// MUST also call IdentityRegistry.isActive() for the subject's registered
// address and return false if the identity is REVOKED, regardless of any
// GRANTED permission record. This means identity revocation takes effect
// on current asset access immediately, independent of any outstanding
// backend JWT session validity (see BACKEND_SPEC.md Authentication
// section for why this matters: JWT role claims can go stale for up to
// 15 minutes, but this check ensures asset ACCESS never does).
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

Add a function (name and exact placement of the emit call are an
implementation detail, but the event must be `AssetAccessed` as defined
above) that the backend calls when granting a download, e.g.:

```solidity
function recordAccess(
    uint256 assetId,
    string calldata requesterDID,
    uint256 permissionId
) external; // emits AssetAccessed; caller must be a registered, active
            // identity; does not re-run the permission check itself —
            // the backend calls this AFTER checkPermissionNow already
            // returned true, this function only records the fact
```

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

// Only ADMIN may call. Mints a new NFT, assigns it to ownerDID, stores the
// Asset struct. assetId is auto-incremented starting from 1.
function registerAsset(
    bytes32 assetHash,
    string calldata ownerDID,
    string calldata metadataURI,
    Classification classification
) external returns (uint256 assetId); // emits AssetRegistered

// Only ADMIN, or the current owner if they hold TRANSFER permission per
// AccessControl.checkPermissionNow(), may call.
//
// OWNERSHIP CONSISTENCY REQUIREMENT (explicit fix to an earlier gap in
// this spec): this asset is an ERC-721 token, and ERC-721 tracks
// ownership via an address (ownerOf(tokenId) returns an address, not a
// string). An earlier version of this function updated only the
// ownerDID string field, which could desynchronize from the actual
// ERC-721 token owner — two disagreeing sources of truth about who owns
// an asset. This function MUST update both atomically in a single
// transaction:
//   1. Call the internal ERC-721 transfer function to move the actual
//      token to the address corresponding to newOwnerDID (resolve via
//      IdentityRegistry — the DID's registered address is the ERC-721
//      owner).
//   2. Update the ownerDID field to match.
// ownerDID is therefore a derived/canonical human-readable representation
// of the real ERC-721 owner, not an independently-settable field. Do not
// implement a path where ownerDID can be set without the corresponding
// ERC-721 owner also changing, or vice versa.
//
// Must NOT delete or reuse the assetId — ownership history stays
// queryable via the AssetOwnershipTransferred events.
function transferAsset(uint256 assetId, string calldata newOwnerDID) external;
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

`AssetRegistry` and `AccessControl` both need to check identity status/role
via `IdentityRegistry`. Deploy `IdentityRegistry` first, pass its address into
the constructors of the other two. Do not hardcode addresses — use
constructor injection so tests can deploy fresh instances each time.

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

## What NOT to build in this phase

- No testnet deployment
- No multisig/threshold signing (explicitly future work per the pitch)
- No physical component/parts tracking (explicitly future work)
- No gas optimization pass — correctness first, optimize later if time allows
- No historical identity-status tracking in IdentityRegistry (see the open
  question in Section 2) — raise with the team before building around an
  assumed answer either way
