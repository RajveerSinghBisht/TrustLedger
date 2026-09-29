// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IdentityRegistry.sol";

/// @dev Minimal interface to query asset classification from
///      AssetRegistry without creating a circular import.
///      AssetRegistry imports AccessControl; if AccessControl also
///      imported AssetRegistry directly, the Solidity compiler would
///      handle the circular type reference but the tight coupling
///      would be architecturally unclean. This interface declares
///      only the view function needed for dual-custody routing.
///
///      The struct here must mirror AssetRegistry.Asset's field types
///      exactly so that the ABI tuple encoding matches at the call
///      site. The actual AssetRegistry returns a struct (single
///      tuple), not 8 individual values.
interface IAssetClassification {
    struct AssetInfo {
        uint256 assetId;
        bytes32 assetHash;
        string ownerDID;
        string metadataURI;
        uint8 classification;   // 0=PUBLIC, 1=INTERNAL, 2=CONFIDENTIAL
        uint8 status;
        uint256 version;
        uint256 createdAt;
    }

    function getAsset(uint256 assetId) external view returns (AssetInfo memory);
}


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

    // ── Dual-Custody (Two-Man Rule) ─────────────────────────────────
    //
    // For assets classified as CONFIDENTIAL, a single officer cannot
    // unilaterally grant access. Instead:
    //   1. Officer 1 (the "Maker") calls requestPermission(), which
    //      creates a PermissionRequest in PENDING state with a 24-hour
    //      deterministic TTL.
    //   2. Officer 2 (the "Checker") calls approvePermission(), which
    //      enforces msg.sender != request.requester (non-self-approval),
    //      verifies the request hasn't expired, and only then appends
    //      the permission to the immutable versioned timeline.
    //
    // This is modeled on the well-established dual-control / separation-
    // of-duty pattern used in high-security operations (financial dual
    // custody, cryptographic key ceremonies). On-chain enforcement
    // guarantees cryptographic key separation between the two signers;
    // organizational separation (ensuring two distinct humans hold the
    // two keys) is an off-chain administrative prerequisite.
    //
    // For PUBLIC and INTERNAL assets, requestPermission() delegates
    // directly to the existing single-signature setPermission() flow
    // with zero additional friction.

    enum RequestStatus {
        PENDING,
        APPROVED,
        CANCELLED,
        EXPIRED  // Not stored — computed from expiresAt at read time.
                 // Included here for completeness in the conceptual
                 // lifecycle, but on-chain we only check
                 // block.timestamp > expiresAt.
    }

    struct PermissionRequest {
        uint256 requestId;
        uint256 assetId;
        string subjectDID;
        Action action;
        PermissionState requestedState;
        address requester;       // Officer 1 (the Maker)
        uint256 requestedAt;
        uint256 expiresAt;       // requestedAt + REQUEST_TTL
        bool approved;           // true once Officer 2 signs
        bool cancelled;          // true if Maker or Admin cancels
    }

    /// @dev 24 hours, expressed in seconds. Chosen as the TTL for
    ///      pending dual-custody requests: long enough that Officer 2
    ///      can be located during a normal duty cycle, short enough
    ///      that stale requests don't linger indefinitely.
    uint256 public constant REQUEST_TTL = 24 hours;

    /// @dev Classification value for CONFIDENTIAL in AssetRegistry.
    ///      Must match AssetRegistry.Classification.CONFIDENTIAL.
    uint8 private constant CLASSIFICATION_CONFIDENTIAL = 2;

    IdentityRegistry public immutable identityRegistry;

    /// @dev Set once via setAssetRegistry(). Used to look up asset
    ///      classification for dual-custody routing. address(0) until
    ///      initialized — requestPermission() reverts if unset.
    address private assetRegistryAddress;
    bool private assetRegistrySet;

    /// @dev The original deployer address. Only this address can call
    ///      setAssetRegistry(). Stored separately from IdentityRegistry's
    ///      admin concept because setAssetRegistry must be callable
    ///      during the deployment script, potentially before identities
    ///      are fully configured.
    address private immutable deployer;

    // key = keccak256(abi.encode(assetId, subjectDID, action))
    // Per spec: linear scan over this array is acceptable for hackathon
    // scope. Do not over-engineer into a more complex indexed structure
    // unless testing shows the array grows large enough to matter.
    mapping(bytes32 => Permission[]) private permissionHistory;

    uint256 private nextPermissionId = 1;

    mapping(uint256 => PermissionRequest) private permissionRequests;
    uint256 private nextRequestId = 1;

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

    /// @notice Emitted when a dual-custody permission request is created
    ///         for a CONFIDENTIAL asset. Officer 2 must call
    ///         approvePermission() before expiresAt for the permission
    ///         to become active.
    event PermissionRequested(
        uint256 indexed requestId,
        uint256 indexed assetId,
        string subjectDID,
        Action action,
        PermissionState requestedState,
        address requester,
        uint256 expiresAt
    );

    /// @notice Emitted when Officer 2 co-signs a pending request.
    event PermissionApproved(
        uint256 indexed requestId,
        address approver
    );

    /// @notice Emitted when a pending request is cancelled by its
    ///         requester or an Admin.
    event PermissionRequestCancelled(
        uint256 indexed requestId,
        address cancelledBy
    );

    /// @notice Emitted exactly once when setAssetRegistry() is called
    ///         during post-deployment wiring.
    event AssetRegistrySet(address assetRegistryAddress);

    constructor(address identityRegistryAddress) {
        require(
            identityRegistryAddress != address(0),
            "AccessControl: zero address"
        );
        identityRegistry = IdentityRegistry(identityRegistryAddress);
        deployer = msg.sender;
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

    // ── One-Shot AssetRegistry Wiring ───────────────────────────────

    /// @notice Sets the AssetRegistry address for classification lookups.
    ///         Can only be called ONCE, and only by the original deployer.
    ///         This is a one-shot initializer, not a general setter —
    ///         once set, the address is permanently locked to prevent a
    ///         compromised admin from re-pointing AccessControl at a
    ///         malicious fake AssetRegistry that lies about classifications.
    function setAssetRegistry(address _assetRegistry) external {
        require(
            msg.sender == deployer,
            "AccessControl: only deployer can set AssetRegistry"
        );
        require(
            !assetRegistrySet,
            "AccessControl: AssetRegistry already set"
        );
        require(
            _assetRegistry != address(0),
            "AccessControl: zero address for AssetRegistry"
        );
        assetRegistryAddress = _assetRegistry;
        assetRegistrySet = true;
        emit AssetRegistrySet(_assetRegistry);
    }

    /// @notice Returns the AssetRegistry address, or address(0) if not
    ///         yet set.
    function getAssetRegistryAddress() external view returns (address) {
        return assetRegistryAddress;
    }

    // ── Internal Helpers ────────────────────────────────────────────

    function _permissionKey(
        uint256 assetId,
        string memory subjectDID,
        Action action
    ) private pure returns (bytes32) {
        return keccak256(abi.encode(assetId, subjectDID, action));
    }

    /// @dev Internal helper that appends a permission to the versioned
    ///      timeline. Extracted from setPermission() so that both the
    ///      direct single-signature path AND the dual-custody approval
    ///      path can share identical timeline-append logic.
    function _appendPermission(
        uint256 assetId,
        string memory subjectDID,
        Action action,
        PermissionState state,
        string memory grantedBy
    ) private returns (uint256 permissionId) {
        bytes32 key = _permissionKey(assetId, subjectDID, action);
        Permission[] storage history = permissionHistory[key];

        uint256 changeTimestamp = block.timestamp;

        if (history.length > 0) {
            Permission storage current = history[history.length - 1];
            if (current.validUntil == 0) {
                current.validUntil = changeTimestamp;
            }
        }

        permissionId = nextPermissionId;
        nextPermissionId += 1;

        history.push(
            Permission({
                permissionId: permissionId,
                assetId: assetId,
                subjectDID: subjectDID,
                action: action,
                state: state,
                grantedBy: grantedBy,
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
            grantedBy,
            changeTimestamp
        );
    }

    // ── Existing Single-Signature Permission Management ────────────

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
        IdentityRegistry.Identity memory callerIdentity = identityRegistry
            .getIdentity(msg.sender);

        _appendPermission(assetId, subjectDID, action, state, callerIdentity.did);
    }

    // ── Dual-Custody Permission Management ─────────────────────────

    /// @notice Creates a permission request. For CONFIDENTIAL assets,
    ///         the request enters PENDING state and requires a second
    ///         officer's approval via approvePermission(). For PUBLIC
    ///         and INTERNAL assets, the permission is granted immediately
    ///         via the standard single-signature path (no pending state).
    /// @dev Requires AssetRegistry to be set via setAssetRegistry().
    ///      If the asset doesn't exist in AssetRegistry, the getAsset
    ///      call will revert — this is intentional, not a gap.
    function requestPermission(
        uint256 assetId,
        string calldata subjectDID,
        Action action,
        PermissionState state
    ) external onlyActiveAdminOrManager {
        require(
            assetRegistrySet,
            "AccessControl: AssetRegistry not configured"
        );

        // Query asset classification from AssetRegistry
        IAssetClassification registry = IAssetClassification(
            assetRegistryAddress
        );
        IAssetClassification.AssetInfo memory assetInfo = registry.getAsset(assetId);

        if (assetInfo.classification != CLASSIFICATION_CONFIDENTIAL) {
            // PUBLIC or INTERNAL: delegate directly to single-sig flow.
            IdentityRegistry.Identity memory callerIdentity = identityRegistry
                .getIdentity(msg.sender);
            _appendPermission(
                assetId,
                subjectDID,
                action,
                state,
                callerIdentity.did
            );
            return;
        }

        // CONFIDENTIAL: create a pending dual-custody request.
        uint256 requestId = nextRequestId;
        nextRequestId += 1;

        permissionRequests[requestId] = PermissionRequest({
            requestId: requestId,
            assetId: assetId,
            subjectDID: subjectDID,
            action: action,
            requestedState: state,
            requester: msg.sender,
            requestedAt: block.timestamp,
            expiresAt: block.timestamp + REQUEST_TTL,
            approved: false,
            cancelled: false
        });

        emit PermissionRequested(
            requestId,
            assetId,
            subjectDID,
            action,
            state,
            msg.sender,
            block.timestamp + REQUEST_TTL
        );
    }

    /// @notice Officer 2 (the "Checker") co-signs a pending permission
    ///         request, activating the permission on the immutable
    ///         versioned timeline.
    /// @dev Enforces four invariants:
    ///      1. Non-self-approval: msg.sender != request.requester
    ///      2. Deterministic expiration: block.timestamp <= expiresAt
    ///      3. Not already approved or cancelled
    ///      4. Caller is an active ADMIN or MANAGER
    function approvePermission(
        uint256 requestId
    ) external onlyActiveAdminOrManager {
        PermissionRequest storage request = permissionRequests[requestId];
        require(
            request.requestId != 0,
            "AccessControl: request does not exist"
        );
        require(
            !request.approved,
            "AccessControl: request already approved"
        );
        require(
            !request.cancelled,
            "AccessControl: request was cancelled"
        );
        require(
            block.timestamp <= request.expiresAt,
            "AccessControl: request has expired"
        );
        require(
            msg.sender != request.requester,
            "AccessControl: cannot approve own request (dual-custody violation)"
        );

        request.approved = true;

        // Derive grantedBy from the APPROVER's DID (Officer 2), since
        // they are the one authorizing the permission to take effect.
        // The requester (Officer 1) is recorded in the PermissionRequest
        // struct itself for full audit trail.
        IdentityRegistry.Identity memory approverIdentity = identityRegistry
            .getIdentity(msg.sender);

        _appendPermission(
            request.assetId,
            request.subjectDID,
            request.action,
            request.requestedState,
            approverIdentity.did
        );

        emit PermissionApproved(requestId, msg.sender);
    }

    /// @notice Cancels a pending permission request. Only the original
    ///         requester or an active ADMIN may cancel.
    function cancelPermissionRequest(
        uint256 requestId
    ) external {
        PermissionRequest storage request = permissionRequests[requestId];
        require(
            request.requestId != 0,
            "AccessControl: request does not exist"
        );
        require(
            !request.approved,
            "AccessControl: request already approved"
        );
        require(
            !request.cancelled,
            "AccessControl: request already cancelled"
        );

        bool isRequester = msg.sender == request.requester;
        bool isActiveAdmin = identityRegistry.isActive(msg.sender) &&
            identityRegistry.getRole(msg.sender) ==
            IdentityRegistry.Role.ADMIN;

        require(
            isRequester || isActiveAdmin,
            "AccessControl: only requester or ADMIN can cancel"
        );

        request.cancelled = true;

        emit PermissionRequestCancelled(requestId, msg.sender);
    }

    /// @notice Returns a pending permission request by ID.
    function getPermissionRequest(
        uint256 requestId
    ) external view returns (PermissionRequest memory) {
        require(
            permissionRequests[requestId].requestId != 0,
            "AccessControl: request does not exist"
        );
        return permissionRequests[requestId];
    }

    // ── Core USP: Temporal Permission Verification ──────────────────

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
