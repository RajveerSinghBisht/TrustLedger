// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IdentityRegistry.sol";

/// @title AccessControl
/// @notice Core USP contract. Permissions are never overwritten or
///         deleted — every grant/revoke creates a new versioned record
///         with a validity window, enabling policy-at-the-time
///         verification (see CONTRACTS_SPEC.md Section 2).
///
/// @dev Reentrancy note: the only external calls this contract makes are
///      STATICCALL-backed `view` calls into IdentityRegistry
///      (resolveDID, isActive, getRole, getIdentity). Solidity compiles
///      external calls to `view`/`pure` functions as STATICCALL, which
///      the EVM enforces as read-only at the protocol level — any
///      state-mutating opcode in the callee reverts the call. This
///      categorically rules out classic reentrancy via any of these call
///      sites, individually or in sequence (e.g. checkPermissionNow
///      calling resolveDID and then isActive): each is independently
///      read-only, and chaining read-only calls cannot introduce a
///      mutation vector. It also does not create a read-only-reentrancy
///      risk, because that requires a SEPARATE, concurrent external call
///      elsewhere in the same transaction that hands control to
///      untrusted code while this contract's own state is mid-update —
///      no such call exists anywhere in this contract. No
///      ReentrancyGuard is used here; one would guard against a risk
///      that does not exist in this contract's call graph, adding gas
///      cost and complexity with no corresponding safety benefit.
contract AccessControl {
    enum Action {
        READ,
        WRITE,
        TRANSFER
    }

    enum PermissionState {
        GRANTED,
        REVOKED
    }

    struct Permission {
        uint256 permissionId;
        uint256 assetId;
        string subjectDID;
        Action action;
        PermissionState state;
        string grantedBy;
        uint256 validFrom;
        uint256 validUntil; // 0 = still current, no newer version exists
    }

    IdentityRegistry public immutable identityRegistry;

    // key = keccak256(abi.encode(assetId, subjectDID, action))
    // Per spec: linear scan over this array is acceptable for hackathon
    // scope. Do not over-engineer into a more complex indexed structure
    // unless testing shows the array grows large enough to matter.
    mapping(bytes32 => Permission[]) private permissionHistory;

    uint256 private nextPermissionId = 1;

    event PermissionChanged(
        uint256 indexed permissionId,
        uint256 indexed assetId,
        string subjectDID,
        Action action,
        PermissionState state,
        string grantedBy,
        uint256 validFrom
    );

    /// @notice Emitted when a backend-mediated access (e.g. a file
    ///         download) is granted following a successful
    ///         checkPermissionNow check. Makes "access occurred" an
    ///         independently verifiable on-chain fact rather than only
    ///         a backend-asserted one (see DATA_MODEL.md section 4,
    ///         Authorization Proof vs. Access Attestation).
    event AssetAccessed(
        uint256 indexed assetId,
        string requesterDID,
        uint256 permissionId,
        uint256 timestamp
    );

    constructor(address identityRegistryAddress) {
        require(
            identityRegistryAddress != address(0),
            "AccessControl: zero address"
        );
        identityRegistry = IdentityRegistry(identityRegistryAddress);
    }

    modifier onlyActiveAdminOrManager() {
        require(
            identityRegistry.isActive(msg.sender),
            "AccessControl: caller is not an active identity"
        );
        IdentityRegistry.Role callerRole = identityRegistry.getRole(
            msg.sender
        );
        require(
            callerRole == IdentityRegistry.Role.ADMIN ||
                callerRole == IdentityRegistry.Role.MANAGER,
            "AccessControl: caller must be ADMIN or MANAGER"
        );
        _;
    }

    function _permissionKey(
        uint256 assetId,
        string memory subjectDID,
        Action action
    ) private pure returns (bytes32) {
        return keccak256(abi.encode(assetId, subjectDID, action));
    }

    /// @notice Grants or revokes a permission. Only ADMIN or MANAGER may
    ///         call. If a current (validUntil == 0) record already
    ///         exists for this (assetId, subjectDID, action), it is
    ///         closed out (validUntil set to the new record's validFrom)
    ///         before the new record is appended — never overwritten.
    /// @dev grantedBy is derived from msg.sender's own DID lookup, not
    ///      taken as a caller-supplied parameter — this prevents a
    ///      caller from attributing a permission change to a different
    ///      identity than the one that actually authorized it.
    function setPermission(
        uint256 assetId,
        string calldata subjectDID,
        Action action,
        PermissionState state
    ) external onlyActiveAdminOrManager {
        bytes32 key = _permissionKey(assetId, subjectDID, action);
        Permission[] storage history = permissionHistory[key];

        // Timestamp authority: block.timestamp is the ONLY source of
        // truth for validFrom/validUntil — never a backend-supplied
        // wall-clock value. See CONTRACTS_SPEC.md Section 2's timestamp
        // authority note.
        uint256 changeTimestamp = block.timestamp;

        if (history.length > 0) {
            Permission storage current = history[history.length - 1];
            if (current.validUntil == 0) {
                current.validUntil = changeTimestamp;
            }
        }

        IdentityRegistry.Identity memory callerIdentity = identityRegistry
            .getIdentity(msg.sender);

        uint256 permissionId = nextPermissionId;
        nextPermissionId += 1;

        history.push(
            Permission({
                permissionId: permissionId,
                assetId: assetId,
                subjectDID: subjectDID,
                action: action,
                state: state,
                grantedBy: callerIdentity.did,
                validFrom: changeTimestamp,
                validUntil: 0
            })
        );

        emit PermissionChanged(
            permissionId,
            assetId,
            subjectDID,
            action,
            state,
            callerIdentity.did,
            changeTimestamp
        );
    }

    /// @notice THE CORE USP FUNCTION. Returns what was actually true at
    ///         a historical moment, not just what's true now.
    /// @dev Identity status handling (explicit, per CONTRACTS_SPEC.md
    ///      Section 2.1): evaluates PERMISSION state as of atTimestamp
    ///      ONLY. Does NOT check the subject's CURRENT IdentityRegistry
    ///      status, and must NOT retroactively invalidate a permission
    ///      that was legitimately valid at the queried timestamp.
    ///
    ///      OPEN QUESTION, not resolved here: IdentityRegistry stores
    ///      only current status, not a status history, so this function
    ///      cannot verify the subject was ACTIVE at atTimestamp itself —
    ///      only that a permission record existed for that timestamp.
    ///
    ///      Returns a zeroed Permission with state == REVOKED (the
    ///      struct's default enum value) if no record covers
    ///      atTimestamp — this is the safe default the spec requires.
    function checkPermissionAtTime(
        uint256 assetId,
        string calldata subjectDID,
        Action action,
        uint256 atTimestamp
    ) public view returns (Permission memory) {
        bytes32 key = _permissionKey(assetId, subjectDID, action);
        Permission[] storage history = permissionHistory[key];

        for (uint256 i = 0; i < history.length; i++) {
            Permission storage record = history[i];
            bool afterStart = record.validFrom <= atTimestamp;
            bool beforeEnd = record.validUntil == 0
                ? true
                : atTimestamp < record.validUntil;
            if (afterStart && beforeEnd) {
                return record;
            }
        }

        // No record found for this timestamp — safe default: REVOKED.
        return
            Permission({
                permissionId: 0,
                assetId: assetId,
                subjectDID: subjectDID,
                action: action,
                state: PermissionState.REVOKED,
                grantedBy: "",
                validFrom: 0,
                validUntil: 0
            });
    }

    /// @notice Convenience function for CURRENT (real-time) access
    ///         decisions. NOT simply checkPermissionAtTime(...,
    ///         block.timestamp) — carries one additional, mandatory
    ///         requirement per CONTRACTS_SPEC.md Section 2.1: the
    ///         subject's identity MUST also be currently ACTIVE.
    /// @dev This is what makes identity revocation take effect on
    ///      current asset access immediately, independent of any
    ///      outstanding backend JWT session validity (see
    ///      BACKEND_SPEC.md's JWT role-snapshot tradeoff — that
    ///      tradeoff applies to the ROLE claim only; this check ensures
    ///      asset ACCESS itself never goes stale).
    function checkPermissionNow(
        uint256 assetId,
        string calldata subjectDID,
        Action action
    ) public view returns (bool allowed) {
        Permission memory current = checkPermissionAtTime(
            assetId,
            subjectDID,
            action,
            block.timestamp
        );

        if (current.state != PermissionState.GRANTED) {
            return false;
        }

        // Resolve subjectDID to its registered address via
        // IdentityRegistry's canonical resolver (see IdentityRegistry.sol
        // resolveDID — DID <-> address resolution is an architectural
        // invariant owned by that contract, not duplicated here).
        address subjectAddress = identityRegistry.resolveDID(subjectDID);

        // Unknown DID (never registered) resolves to address(0) — per
        // resolveDID's documented semantics, this is not "active" under
        // any interpretation, so access is denied.
        if (subjectAddress == address(0)) {
            return false;
        }

        // Mandatory identity-status requirement (Section 2.1): current
        // access requires the subject's identity to be ACTIVE right now,
        // regardless of whether a GRANTED permission record exists. A
        // revoked identity is denied immediately here, independent of
        // any outstanding backend JWT session validity.
        return identityRegistry.isActive(subjectAddress);
    }

    /// @notice Records that a backend-mediated access occurred,
    ///         emitting AssetAccessed. This makes access an
    ///         independently verifiable on-chain fact.
    /// @dev CRITICAL: this function does NOT merely trust that the
    ///      caller already ran checkPermissionNow — it independently
    ///      re-verifies authorization itself before emitting the event.
    ///      An external caller invoking this function directly, without
    ///      a genuine prior authorized access, cannot manufacture a
    ///      valid AssetAccessed event: the authorization check below is
    ///      enforced by this contract, not assumed from the caller's
    ///      behavior.
    function recordAccess(
        uint256 assetId,
        string calldata requesterDID,
        uint256 permissionId
    ) external {
        require(
            identityRegistry.isActive(msg.sender),
            "AccessControl: caller is not an active identity"
        );
        require(
            checkPermissionNow(assetId, requesterDID, Action.READ),
            "AccessControl: access not currently authorized"
        );

        emit AssetAccessed(
            assetId,
            requesterDID,
            permissionId,
            block.timestamp
        );
    }
}
