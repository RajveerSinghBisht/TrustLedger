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

// Read-only. Used by other contracts (AccessControl, AssetRegistry) to check
// role and active status before allowing an operation.
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
function setPermission(
    uint256 assetId,
    string calldata subjectDID,
    Action action,
    PermissionState state
) external; // emits PermissionChanged

// THE CORE FUNCTION. Given an asset, subject, action, and a historical
// timestamp, walk the permission history and return what was true AT
// THAT MOMENT. This must NOT simply return current state — it must find
// the permission record where validFrom <= atTimestamp < validUntil
// (or validUntil == 0 AND validFrom <= atTimestamp for the current one).
// Returns PermissionState.REVOKED (safe default) if no record is found
// for that timestamp (i.e., permission didn't exist yet at that time).
function checkPermissionAtTime(
    uint256 assetId,
    string calldata subjectDID,
    Action action,
    uint256 atTimestamp
) external view returns (Permission memory);

// Convenience function: same as above but atTimestamp = block.timestamp
// (i.e., "is this allowed right now"). Used for real-time access checks;
// checkPermissionAtTime is used for audits/historical verification.
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
```

**Implementation note for whoever builds this:** the straightforward way to
support `checkPermissionAtTime` efficiently is to keep an array (or mapping
to array) of all Permission records per `(assetId, subjectDID, action)` key,
appended to (never removed from), and linearly scan for the record whose
`[validFrom, validUntil)` range contains `atTimestamp`. For hackathon scope,
a linear scan is fine — do not over-engineer this into a more complex data
structure unless the array grows large enough in testing to matter.

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
// AccessControl.checkPermissionNow(), may call. Updates ownerDID on-chain.
// Must NOT delete or reuse the assetId — ownership history stays queryable
// via the AssetOwnershipTransferred events.
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
- Registering an asset, transferring it, confirming `getAsset` reflects the
  new owner and that ownership events fire correctly

Put tests in `contracts/test/`. Name files `IdentityRegistry.test.js`,
`AccessControl.test.js`, `AssetRegistry.test.js`.

## What NOT to build in this phase

- No testnet deployment
- No multisig/threshold signing (explicitly future work per the pitch)
- No physical component/parts tracking (explicitly future work)
- No gas optimization pass — correctness first, optimize later if time allows
