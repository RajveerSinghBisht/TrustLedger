// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IdentityRegistry
/// @notice Single source of truth for identity role and active/revoked
///         status across the TrustLedger system, AND the canonical
///         resolver between DID strings and addresses (see resolveDID
///         and the didToAddress mapping below — this is an explicit
///         architectural invariant, not a convenience feature). Per
///         CONTRACTS_SPEC.md Section 1: every other contract's
///         state-changing functions must check isActive() (and
///         getRole() where relevant) here before proceeding. No other
///         contract duplicates this state or maintains its own
///         DID/address mapping.
///
/// @dev Known, documented scope limitation (see CONTRACTS_SPEC.md Section 1
///      and Section 2's note on checkPermissionAtTime): this contract
///      stores only CURRENT status, not a history of status changes over
///      time. Historical authorization checks in AccessControl cannot
///      currently verify whether a subject was ACTIVE at a past timestamp
///      — only that a permission record existed for that timestamp. This
///      is an open question, not resolved by this contract.
contract IdentityRegistry {
    enum Role {
        NONE,
        ADMIN,
        MANAGER,
        AUDITOR,
        USER
    }

    enum IdentityStatus {
        ACTIVE,
        REVOKED
    }

    struct Identity {
        string did;
        bytes publicKey;
        Role role;
        IdentityStatus status;
        uint256 createdAt;
    }

    mapping(address => Identity) private identities;
    mapping(address => bool) private registered;

    /// @dev Architectural invariant, not a convenience mapping: this
    ///      contract is the canonical resolver between DID strings and
    ///      addresses for the entire system.
    ///          DID ↔ IdentityRegistry ↔ address
    ///      Both AccessControl and AssetRegistry resolve DIDs through
    ///      this single mapping rather than maintaining their own —
    ///      this is deliberate, not incidental. See resolveDID() below.
    ///
    ///      Semantics (explicit, do not assume otherwise):
    ///        Unknown DID       -> address(0)
    ///        Known active DID  -> registered address
    ///        Known revoked DID -> SAME registered address (unchanged)
    ///        Duplicate DID     -> registration rejected (see
    ///                             registerIdentity's uniqueness check)
    ///      Revoking an identity does NOT clear this mapping — historical
    ///      permissions, ownership records, and audit events must remain
    ///      resolvable after revocation.
    mapping(string => address) private didToAddress;

    event IdentityRegistered(
        address indexed identityAddress,
        string did,
        Role role,
        uint256 timestamp
    );

    event IdentityRevoked(address indexed identityAddress, uint256 timestamp);

    /// @dev Admin check requires BOTH role == ADMIN AND status == ACTIVE.
    ///      A revoked Admin loses admin rights immediately — this is a
    ///      deliberate design decision (agreed explicitly, not merely
    ///      implied by the spec text) for internal consistency with how
    ///      AccessControl.checkPermissionNow treats revoked identities
    ///      elsewhere in the system: revocation should mean revocation,
    ///      everywhere, not just for asset access.
    modifier onlyActiveAdmin() {
        Identity storage caller = identities[msg.sender];
        require(
            caller.role == Role.ADMIN && caller.status == IdentityStatus.ACTIVE,
            "IdentityRegistry: caller is not an active admin"
        );
        _;
    }

    /// @param did The bootstrap Admin's DID (did:trustledger:<address>).
    /// @param publicKey The bootstrap Admin's public key, used later for
    ///        challenge-response authentication (see BACKEND_SPEC.md).
    /// @dev The deployer becomes the first ADMIN, registered as ACTIVE,
    ///      using REAL initialization data supplied at deployment — not
    ///      placeholder values. This solves the bootstrapping problem: an
    ///      empty registry has no existing Admin who could otherwise call
    ///      registerIdentity for anyone.
    ///
    ///      The bootstrap identity emits the SAME IdentityRegistered event
    ///      that every subsequent registerIdentity call emits, so it is
    ///      not a special, invisible case in the event history — the
    ///      audit trail (see CONTRACTS_SPEC.md Section 12.2 in the wider
    ///      project docs: on-chain events are authoritative) has a
    ///      complete, consistent record starting from identity #1.
    constructor(string memory did, bytes memory publicKey) {
        address deployer = msg.sender;

        identities[deployer] = Identity({
            did: did,
            publicKey: publicKey,
            role: Role.ADMIN,
            status: IdentityStatus.ACTIVE,
            createdAt: block.timestamp
        });
        registered[deployer] = true;
        didToAddress[did] = deployer;

        emit IdentityRegistered(deployer, did, Role.ADMIN, block.timestamp);
    }

    /// @notice Registers a new identity. Only callable by an existing,
    ///         active ADMIN (see onlyActiveAdmin modifier above).
    /// @dev Per CONTRACTS_SPEC.md Section 1: emits IdentityRegistered.
    function registerIdentity(
        address identityAddress,
        string calldata did,
        bytes calldata publicKey,
        Role role
    ) external onlyActiveAdmin {
        require(
            identityAddress != address(0),
            "IdentityRegistry: zero address"
        );
        require(
            !registered[identityAddress],
            "IdentityRegistry: identity already registered"
        );
        require(role != Role.NONE, "IdentityRegistry: role must not be NONE");
        require(
            didToAddress[did] == address(0),
            "IdentityRegistry: DID already registered to another address"
        );

        identities[identityAddress] = Identity({
            did: did,
            publicKey: publicKey,
            role: role,
            status: IdentityStatus.ACTIVE,
            createdAt: block.timestamp
        });
        registered[identityAddress] = true;
        didToAddress[did] = identityAddress;

        emit IdentityRegistered(identityAddress, did, role, block.timestamp);
    }

    /// @notice Revokes an identity. Only ADMIN may call. Sets status to
    ///         REVOKED — per spec, does NOT delete the record, so history
    ///         (including the identity's original registration event and
    ///         createdAt) remains queryable.
    function revokeIdentity(address identityAddress) external onlyActiveAdmin {
        require(
            registered[identityAddress],
            "IdentityRegistry: identity not registered"
        );
        require(
            identities[identityAddress].status == IdentityStatus.ACTIVE,
            "IdentityRegistry: identity already revoked"
        );

        identities[identityAddress].status = IdentityStatus.REVOKED;

        emit IdentityRevoked(identityAddress, block.timestamp);
    }

    /// @notice Returns the full Identity struct for a given address.
    function getIdentity(
        address identityAddress
    ) external view returns (Identity memory) {
        require(
            registered[identityAddress],
            "IdentityRegistry: identity not registered"
        );
        return identities[identityAddress];
    }

    /// @notice Returns whether the given address is a registered, ACTIVE
    ///         identity. Used by AccessControl and AssetRegistry before
    ///         any state-changing operation, and by the backend's
    ///         challenge-response auth flow (see BACKEND_SPEC.md).
    function isActive(address identityAddress) external view returns (bool) {
        return
            registered[identityAddress] &&
            identities[identityAddress].status == IdentityStatus.ACTIVE;
    }

    /// @notice Returns the role of the given address. Returns Role.NONE
    ///         for an address that was never registered.
    function getRole(address identityAddress) external view returns (Role) {
        if (!registered[identityAddress]) {
            return Role.NONE;
        }
        return identities[identityAddress].role;
    }

    /// @notice Resolves a DID string to its registered address. This is
    ///         the canonical DID -> address resolution mechanism for the
    ///         whole system (see the architectural invariant noted at
    ///         the top of this contract) — AccessControl and
    ///         AssetRegistry both use this rather than maintaining their
    ///         own DID/address mappings.
    /// @return The registered address for this DID, or address(0) if
    ///         the DID has never been registered. Returns the SAME
    ///         address for a revoked identity's DID — revocation does
    ///         not clear this mapping, so historical permissions,
    ///         ownership records, and audit events remain resolvable.
    function resolveDID(string calldata did) external view returns (address) {
        return didToAddress[did];
    }
}
