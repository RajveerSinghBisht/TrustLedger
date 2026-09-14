const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  anyValue,
} = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

describe("AssetRegistry", function () {
  const BOOTSTRAP_DID = "did:trustledger:bootstrap";
  const BOOTSTRAP_PUBKEY = "0x1234";

  const Role = {
    NONE: 0,
    ADMIN: 1,
    MANAGER: 2,
    AUDITOR: 3,
    USER: 4,
  };

  const Action = {
    READ: 0,
    WRITE: 1,
    TRANSFER: 2,
  };

  const PermissionState = {
    GRANTED: 0,
    REVOKED: 1,
  };

  const Classification = {
    PUBLIC: 0,
    INTERNAL: 1,
    CONFIDENTIAL: 2,
  };

  const AssetStatus = {
    ACTIVE: 0,
    REVOKED: 1,
  };

  const SAMPLE_HASH = ethers.keccak256(ethers.toUtf8Bytes("sample-document"));
  const SAMPLE_URI = "local://records/sample-uuid";

  async function deployFixture() {
    const [deployer, user1, user2, outsider] = await ethers.getSigners();

    const IdentityRegistry = await ethers.getContractFactory(
      "IdentityRegistry"
    );
    const identityRegistry = await IdentityRegistry.deploy(
      BOOTSTRAP_DID,
      BOOTSTRAP_PUBKEY
    );
    await identityRegistry.waitForDeployment();

    const AccessControl = await ethers.getContractFactory("AccessControl");
    const accessControl = await AccessControl.deploy(
      await identityRegistry.getAddress()
    );
    await accessControl.waitForDeployment();

    const AssetRegistry = await ethers.getContractFactory("AssetRegistry");
    const assetRegistry = await AssetRegistry.deploy(
      await identityRegistry.getAddress(),
      await accessControl.getAddress()
    );
    await assetRegistry.waitForDeployment();

    // Register user1 and user2 as USER identities
    await identityRegistry
      .connect(deployer)
      .registerIdentity(
        user1.address,
        "did:trustledger:user1",
        "0xbeef",
        Role.USER
      );
    await identityRegistry
      .connect(deployer)
      .registerIdentity(
        user2.address,
        "did:trustledger:user2",
        "0xcafe",
        Role.USER
      );

    return {
      identityRegistry,
      accessControl,
      assetRegistry,
      deployer,
      user1,
      user2,
      outsider,
    };
  }

  async function registerSampleAsset(
    assetRegistry,
    deployer,
    ownerDID = "did:trustledger:user1"
  ) {
    const tx = await assetRegistry
      .connect(deployer)
      .registerAsset(SAMPLE_HASH, ownerDID, SAMPLE_URI, Classification.INTERNAL);
    await tx.wait();
    // assetId is always 1 for the first registration in a fresh fixture
    return 1;
  }

  describe("registerAsset", function () {
    it("allows ADMIN to register an asset and mints the ERC-721 token to ownerDID's address", async function () {
      const { assetRegistry, deployer, user1 } = await deployFixture();

      await expect(
        assetRegistry
          .connect(deployer)
          .registerAsset(
            SAMPLE_HASH,
            "did:trustledger:user1",
            SAMPLE_URI,
            Classification.CONFIDENTIAL
          )
      )
        .to.emit(assetRegistry, "AssetRegistered")
        .withArgs(1, "did:trustledger:user1", SAMPLE_HASH, anyValue);

      expect(await assetRegistry.ownerOf(1)).to.equal(user1.address);

      const asset = await assetRegistry.getAsset(1);
      expect(asset.ownerDID).to.equal("did:trustledger:user1");
      expect(asset.assetHash).to.equal(SAMPLE_HASH);
      expect(asset.classification).to.equal(Classification.CONFIDENTIAL);
      expect(asset.status).to.equal(AssetStatus.ACTIVE);
      expect(asset.version).to.equal(1);
    });

    it("rejects registration from a non-admin caller", async function () {
      const { assetRegistry, user1 } = await deployFixture();

      await expect(
        assetRegistry
          .connect(user1)
          .registerAsset(
            SAMPLE_HASH,
            "did:trustledger:user1",
            SAMPLE_URI,
            Classification.PUBLIC
          )
      ).to.be.revertedWith("AssetRegistry: caller must be ADMIN");
    });

    it("rejects registration when ownerDID is not a registered identity", async function () {
      const { assetRegistry, deployer } = await deployFixture();

      await expect(
        assetRegistry
          .connect(deployer)
          .registerAsset(
            SAMPLE_HASH,
            "did:trustledger:ghost",
            SAMPLE_URI,
            Classification.PUBLIC
          )
      ).to.be.revertedWith(
        "AssetRegistry: ownerDID is not a registered identity"
      );
    });

    it("rejects registration when ownerDID's identity is revoked", async function () {
      const { assetRegistry, identityRegistry, deployer, user1 } =
        await deployFixture();

      await identityRegistry.connect(deployer).revokeIdentity(user1.address);

      await expect(
        assetRegistry
          .connect(deployer)
          .registerAsset(
            SAMPLE_HASH,
            "did:trustledger:user1",
            SAMPLE_URI,
            Classification.PUBLIC
          )
      ).to.be.revertedWith("AssetRegistry: ownerDID identity is not active");
    });
  });

  describe("transferAsset", function () {
    it("Admin transfer succeeds, regardless of TRANSFER permission", async function () {
      const { assetRegistry, deployer, user1, user2 } = await deployFixture();
      const assetId = await registerSampleAsset(assetRegistry, deployer);

      await expect(
        assetRegistry.connect(deployer).transferAsset(assetId, user2.address)
      )
        .to.emit(assetRegistry, "AssetOwnershipTransferred")
        .withArgs(
          assetId,
          "did:trustledger:user1",
          "did:trustledger:user2",
          anyValue
        );

      expect(await assetRegistry.ownerOf(assetId)).to.equal(user2.address);
    });

    it("Unauthorized non-owner (not admin, not current owner) fails", async function () {
      const { assetRegistry, deployer, user2 } = await deployFixture();
      const assetId = await registerSampleAsset(assetRegistry, deployer);

      // user2 is neither admin nor the current owner (user1 is)
      await expect(
        assetRegistry.connect(user2).transferAsset(assetId, user2.address)
      ).to.be.revertedWith(
        "AssetRegistry: caller not authorized to transfer this asset"
      );
    });

    it("Owner WITHOUT TRANSFER permission fails", async function () {
      const { assetRegistry, deployer, user1, user2 } = await deployFixture();
      const assetId = await registerSampleAsset(assetRegistry, deployer);

      // user1 is the genuine current owner but has no TRANSFER
      // permission record set via AccessControl
      await expect(
        assetRegistry.connect(user1).transferAsset(assetId, user2.address)
      ).to.be.revertedWith(
        "AssetRegistry: caller not authorized to transfer this asset"
      );
    });

    it("Owner WITH TRANSFER permission succeeds", async function () {
      const { assetRegistry, accessControl, deployer, user1, user2 } =
        await deployFixture();
      const assetId = await registerSampleAsset(assetRegistry, deployer);

      // Grant TRANSFER permission to user1's OWN DID — per the
      // documented authorization model, TRANSFER is evaluated against
      // the current owner's own DID, not a delegate's.
      await accessControl
        .connect(deployer)
        .setPermission(
          assetId,
          "did:trustledger:user1",
          Action.TRANSFER,
          PermissionState.GRANTED
        );

      await expect(
        assetRegistry.connect(user1).transferAsset(assetId, user2.address)
      ).to.not.be.reverted;

      expect(await assetRegistry.ownerOf(assetId)).to.equal(user2.address);
    });

    it("Inactive destination identity fails", async function () {
      const { assetRegistry, identityRegistry, deployer, user1, user2 } =
        await deployFixture();
      const assetId = await registerSampleAsset(assetRegistry, deployer);

      await identityRegistry.connect(deployer).revokeIdentity(user2.address);

      await expect(
        assetRegistry.connect(deployer).transferAsset(assetId, user2.address)
      ).to.be.revertedWith("AssetRegistry: newOwner is not an active identity");
    });

    it("Unregistered destination address fails", async function () {
      const { assetRegistry, deployer, outsider } = await deployFixture();
      const assetId = await registerSampleAsset(assetRegistry, deployer);

      await expect(
        assetRegistry
          .connect(deployer)
          .transferAsset(assetId, outsider.address)
      ).to.be.revertedWith("AssetRegistry: newOwner is not an active identity");
    });

    it("CRITICAL: ownerOf(tokenId) and ownerDID remain synchronized after transfer", async function () {
      const { assetRegistry, identityRegistry, deployer, user1, user2 } =
        await deployFixture();
      const assetId = await registerSampleAsset(assetRegistry, deployer);

      await assetRegistry
        .connect(deployer)
        .transferAsset(assetId, user2.address);

      const erc721Owner = await assetRegistry.ownerOf(assetId);
      const asset = await assetRegistry.getAsset(assetId);

      expect(erc721Owner).to.equal(user2.address);
      expect(asset.ownerDID).to.equal("did:trustledger:user2");

      // Explicitly confirm these two representations agree — this is
      // the exact bug class this design fixes: the ERC-721 owner and
      // ownerDID must never disagree about who owns the asset.
      const identityOfErc721Owner = await identityRegistry.getIdentity(
        erc721Owner
      );
      expect(identityOfErc721Owner.did).to.equal(asset.ownerDID);
    });

    it("CRITICAL: resolved ownerDID comes from IdentityRegistry, not any caller input — transferAsset takes an address, not a DID string", async function () {
      const { assetRegistry, deployer, user1, user2 } = await deployFixture();
      const assetId = await registerSampleAsset(assetRegistry, deployer);

      // transferAsset's signature only accepts an address for the
      // destination — there is no newOwnerDID parameter to supply a
      // caller-controlled string at all, which is itself the guarantee
      // this test names. Confirm the resulting ownerDID matches
      // IdentityRegistry's own record for that address.
      await assetRegistry
        .connect(deployer)
        .transferAsset(assetId, user2.address);

      const asset = await assetRegistry.getAsset(assetId);
      expect(asset.ownerDID).to.equal("did:trustledger:user2");
    });

    it("rejects transferring a non-existent asset", async function () {
      const { assetRegistry, deployer, user2 } = await deployFixture();

      await expect(
        assetRegistry.connect(deployer).transferAsset(999, user2.address)
      ).to.be.revertedWith("AssetRegistry: asset does not exist");
    });
  });

  describe("updateAssetVersion", function () {
    it("allows ADMIN to update version, hash, and metadataURI, keeping the same assetId", async function () {
      const { assetRegistry, deployer } = await deployFixture();
      const assetId = await registerSampleAsset(assetRegistry, deployer);

      const newHash = ethers.keccak256(ethers.toUtf8Bytes("updated-document"));
      const newUri = "local://records/updated-uuid";

      await expect(
        assetRegistry
          .connect(deployer)
          .updateAssetVersion(assetId, newHash, newUri)
      )
        .to.emit(assetRegistry, "AssetVersionUpdated")
        .withArgs(assetId, 2, newHash, anyValue);

      const asset = await assetRegistry.getAsset(assetId);
      expect(asset.assetId).to.equal(assetId);
      expect(asset.version).to.equal(2);
      expect(asset.assetHash).to.equal(newHash);
      expect(asset.metadataURI).to.equal(newUri);
    });

    it("rejects version update from a non-admin caller", async function () {
      const { assetRegistry, deployer, user1 } = await deployFixture();
      const assetId = await registerSampleAsset(assetRegistry, deployer);

      const newHash = ethers.keccak256(ethers.toUtf8Bytes("updated-document"));

      await expect(
        assetRegistry
          .connect(user1)
          .updateAssetVersion(assetId, newHash, SAMPLE_URI)
      ).to.be.revertedWith("AssetRegistry: caller must be ADMIN");
    });

    it("does not affect ownership", async function () {
      const { assetRegistry, deployer, user1 } = await deployFixture();
      const assetId = await registerSampleAsset(assetRegistry, deployer);

      const newHash = ethers.keccak256(ethers.toUtf8Bytes("updated-document"));
      await assetRegistry
        .connect(deployer)
        .updateAssetVersion(assetId, newHash, SAMPLE_URI);

      expect(await assetRegistry.ownerOf(assetId)).to.equal(user1.address);
      const asset = await assetRegistry.getAsset(assetId);
      expect(asset.ownerDID).to.equal("did:trustledger:user1");
    });
  });

  describe("getAsset", function () {
    it("reverts for a non-existent assetId", async function () {
      const { assetRegistry } = await deployFixture();

      await expect(assetRegistry.getAsset(999)).to.be.revertedWith(
        "AssetRegistry: asset does not exist"
      );
    });
  });
});
