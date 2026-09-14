// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "./IdentityRegistry.sol";
import "./AccessControl.sol";

/// @title AssetRegistry
/// @notice NFT-backed asset records (ERC-721-based). The NFT represents
///         an asset's ownership/provenance record — NOT the document
///         itself (see CONTRACTS_SPEC.md Section 3 and the wider
///         project's "not an NFT marketplace" framing).
///
/// @dev Ownership consistency invariant (CONTRACTS_SPEC.md Section 3):
///      ownerDID is a DERIVED, canonical representation of the real
///      ERC-721 token owner — never an independently-settable field.
///          ERC-721 owner address -> IdentityRegistry.getIdentity() ->
///          Identity.did -> Asset.ownerDID
///      transferAsset() updates both atomically in one transaction: the
///      actual ERC-721 owner changes, then ownerDID is DERIVED from that
///      new owner's address — never trusted from a caller-supplied
///      value. This is the fix for the two-disagreeing-sources-of-truth
///      bug identified against an earlier version of this spec.
///
/// @dev Reentrancy note: unlike IdentityRegistry and AccessControl, this
///      contract makes a genuinely state-mutating external call:
///      _safeMint / the internal ERC-721 transfer mechanism can invoke
///      onERC721Received on the recipient if it is a contract — this is
///      NOT a STATICCALL, and a malicious recipient contract could
///      attempt to re-enter during that hook. This contract follows
///      checks-effects-interactions ordering to neutralize that risk:
///      all of this contract's OWN state (the Asset struct fields,
///      including ownerDID) is fully updated BEFORE the ERC-721
///      transfer call that could trigger the hook — see transferAsset()
///      and registerAsset() below. A reentrant call back into this
///      contract during the hook would therefore only ever observe
///      already-consistent, fully-updated state, not a half-updated one.
contract AssetRegistry is ERC721 {
    enum AssetStatus {
        ACTIVE,
        REVOKED
    }

    enum Classification {
        PUBLIC,
        INTERNAL,
        CONFIDENTIAL
    }

    struct Asset {
        uint256 assetId; // same as the ERC-721 tokenId
        bytes32 assetHash;
        string ownerDID; // DERIVED — see contract-level note above
        string metadataURI;
        Classification classification;
        AssetStatus status;
        uint256 version;
        uint256 createdAt;
    }

    IdentityRegistry public immutable identityRegistry;
    AccessControl public immutable accessControl;

    mapping(uint256 => Asset) private assets;
    mapping(uint256 => bool) private assetExists;

    uint256 private nextAssetId = 1;

    event AssetRegistered(
        uint256 indexed assetId,
        string ownerDID,
        bytes32 assetHash,
        uint256 timestamp
    );

    event AssetOwnershipTransferred(
        uint256 indexed assetId,
        string previousOwnerDID,
        string newOwnerDID,
        uint256 timestamp
    );

    event AssetVersionUpdated(
        uint256 indexed assetId,
        uint256 newVersion,
        bytes32 newAssetHash,
        uint256 timestamp
    );

    constructor(
        address identityRegistryAddress,
        address accessControlAddress
    ) ERC721("TrustLedger Asset", "TLA") {
        require(
            identityRegistryAddress != address(0),
            "AssetRegistry: zero address for IdentityRegistry"
        );
        require(
            accessControlAddress != address(0),
            "AssetRegistry: zero address for AccessControl"
        );
        identityRegistry = IdentityRegistry(identityRegistryAddress);
        accessControl = AccessControl(accessControlAddress);
    }

    modifier onlyActiveAdmin() {
        require(
            identityRegistry.isActive(msg.sender),
            "AssetRegistry: caller is not an active identity"
        );
        require(
            identityRegistry.getRole(msg.sender) ==
                IdentityRegistry.Role.ADMIN,
            "AssetRegistry: caller must be ADMIN"
        );
        _;
    }

    /// @notice Registers a new asset. Only ADMIN may call. Mints the
    ///         corresponding ERC-721 token to ownerDID's registered
    ///         address.
    /// @dev Checks-effects-interactions: this contract's own state
    ///      (the Asset struct) is written BEFORE _safeMint is called,
    ///      so any reentrant call during _safeMint's onERC721Received
    ///      hook observes fully consistent state for this assetId.
    function registerAsset(
        bytes32 assetHash,
        string calldata ownerDID,
        string calldata metadataURI,
        Classification classification
    ) external onlyActiveAdmin returns (uint256 assetId) {
        address ownerAddress = identityRegistry.resolveDID(ownerDID);
        require(
            ownerAddress != address(0),
            "AssetRegistry: ownerDID is not a registered identity"
        );
        require(
            identityRegistry.isActive(ownerAddress),
            "AssetRegistry: ownerDID identity is not active"
        );

        assetId = nextAssetId;
        nextAssetId += 1;

        // Effects: write this contract's own state first.
        assets[assetId] = Asset({
            assetId: assetId,
            assetHash: assetHash,
            ownerDID: ownerDID,
            metadataURI: metadataURI,
            classification: classification,
            status: AssetStatus.ACTIVE,
            version: 1,
            createdAt: block.timestamp
        });
        assetExists[assetId] = true;

        emit AssetRegistered(assetId, ownerDID, assetHash, block.timestamp);

        // Interaction: mint last. _safeMint can call onERC721Received on
        // ownerAddress if it is a contract — by this point, assets[assetId]
        // is already fully consistent, so a reentrant call observes valid
        // state, not a half-written one.
        _safeMint(ownerAddress, assetId);
    }

    /// @notice Transfers asset ownership. Callable by ADMIN, or by the
    ///         current owner if they hold TRANSFER permission per
    ///         AccessControl.checkPermissionNow().
    /// @dev Ownership consistency (CONTRACTS_SPEC.md Section 3): updates
    ///      both the actual ERC-721 owner AND the ownerDID field
    ///      atomically in this single transaction. ownerDID is DERIVED
    ///      from newOwner's registered identity via IdentityRegistry —
    ///      NOT taken as a caller-supplied string. The invariant:
    ///          ERC-721 owner(address) -> IdentityRegistry -> DID ->
    ///          Asset.ownerDID
    ///      newOwnerDID is deliberately NOT a parameter of this function
    ///      — the destination address is the source of truth; DID is
    ///      derived metadata, never trusted from the caller.
    ///
    ///      Authorization model (explicit, not redesigned from spec):
    ///      TRANSFER permission is evaluated against the CURRENT OWNER'S
    ///      OWN DID (asset.ownerDID) via AccessControl.checkPermissionNow.
    ///      This means a non-admin transfer requires the owner to hold a
    ///      TRANSFER permission record naming themselves as subject —
    ///      this is the literal behavior of the current
    ///      CONTRACTS_SPEC.md wording ("current owner... holding
    ///      TRANSFER permission"), not a redesign. AccessControl's API
    ///      is keyed by subjectDID with no separate "delegate" concept,
    ///      so this is the only shape this MVP supports. Documented here
    ///      explicitly rather than left implicit.
    ///
    ///      Sequence (checks-effects-interactions, in this exact order):
    ///        1. Verify asset exists
    ///        2. Read current owner
    ///        3. Determine caller authorization (ADMIN, or current
    ///           owner + TRANSFER permission)
    ///        4. Verify newOwner is a registered, ACTIVE identity
    ///        5. Resolve newOwner -> DID via IdentityRegistry.getIdentity
    ///           (authoritative — never caller-supplied)
    ///        6. EFFECT: update Asset.ownerDID to the resolved DID
    ///        7. Emit AssetOwnershipTransferred
    ///        8. INTERACTION: perform the actual ERC-721 transfer LAST
    ///      Steps 6-7 (this contract's own state) are deliberately
    ///      ordered BEFORE step 8 (the external-call-capable ERC-721
    ///      transfer, which can invoke onERC721Received on newOwner if
    ///      it is a contract) — effects before interactions. A reentrant
    ///      call during that hook observes Asset.ownerDID already
    ///      reflecting the new owner, never a stale value.
    function transferAsset(uint256 assetId, address newOwner) external {
        require(assetExists[assetId], "AssetRegistry: asset does not exist");

        Asset storage asset = assets[assetId];
        address currentOwnerAddress = ownerOf(assetId);

        bool callerIsActiveAdmin = identityRegistry.isActive(msg.sender) &&
            identityRegistry.getRole(msg.sender) ==
            IdentityRegistry.Role.ADMIN;

        bool callerIsAuthorizedCurrentOwner = (msg.sender ==
            currentOwnerAddress) &&
            accessControl.checkPermissionNow(
                assetId,
                asset.ownerDID,
                AccessControl.Action.TRANSFER
            );

        require(
            callerIsActiveAdmin || callerIsAuthorizedCurrentOwner,
            "AssetRegistry: caller not authorized to transfer this asset"
        );

        require(
            newOwner != address(0),
            "AssetRegistry: newOwner is the zero address"
        );
        require(
            identityRegistry.isActive(newOwner),
            "AssetRegistry: newOwner is not an active identity"
        );

        // Resolve newOwner -> DID via IdentityRegistry — authoritative,
        // never caller-supplied. getIdentity is safe to call here
        // because isActive(newOwner) just confirmed registration.
        IdentityRegistry.Identity memory newOwnerIdentity = identityRegistry
            .getIdentity(newOwner);
        string memory previousOwnerDID = asset.ownerDID;
        string memory newOwnerDID = newOwnerIdentity.did;

        // Effect: update this contract's own state BEFORE the
        // interaction (ERC-721 transfer) below.
        asset.ownerDID = newOwnerDID;

        emit AssetOwnershipTransferred(
            assetId,
            previousOwnerDID,
            newOwnerDID,
            block.timestamp
        );

        // Interaction: perform the actual ERC-721 transfer LAST. This
        // can invoke onERC721Received on newOwner if it is a contract —
        // by this point, asset.ownerDID already reflects the new owner,
        // so a reentrant call observes fully consistent state.
        _safeTransfer(currentOwnerAddress, newOwner, assetId, "");
    }

    /// @notice Registers a new version of an existing asset (e.g. a
    ///         corrected/updated document). Only ADMIN may call.
    ///         Increments version, updates hash/metadataURI, keeps the
    ///         same assetId. Does not touch ownership.
    function updateAssetVersion(
        uint256 assetId,
        bytes32 newAssetHash,
        string calldata newMetadataURI
    ) external onlyActiveAdmin {
        require(assetExists[assetId], "AssetRegistry: asset does not exist");

        Asset storage asset = assets[assetId];
        asset.assetHash = newAssetHash;
        asset.metadataURI = newMetadataURI;
        asset.version += 1;

        emit AssetVersionUpdated(
            assetId,
            asset.version,
            newAssetHash,
            block.timestamp
        );
    }

    /// @notice Returns the full Asset struct for a given assetId.
    function getAsset(uint256 assetId) external view returns (Asset memory) {
        require(assetExists[assetId], "AssetRegistry: asset does not exist");
        return assets[assetId];
    }
}
