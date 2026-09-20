const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  anyValue,
} = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

describe("IdentityRegistry", function () {
  const BOOTSTRAP_DID = "did:trustledger:bootstrap";
  const BOOTSTRAP_PUBKEY = "0x1234";

  const Role = {
    NONE: 0,
    ADMIN: 1,
    MANAGER: 2,
    AUDITOR: 3,
    USER: 4,
  };

  const IdentityStatus = {
    ACTIVE: 0,
    REVOKED: 1,
  };

  async function deployFixture() {
    const [deployer, admin2, manager1, user1, outsider] =
      await ethers.getSigners();

    const IdentityRegistry = await ethers.getContractFactory(
      "IdentityRegistry"
    );
    const registry = await IdentityRegistry.deploy(
      BOOTSTRAP_DID,
      BOOTSTRAP_PUBKEY
    );
    await registry.waitForDeployment();

    return { registry, deployer, admin2, manager1, user1, outsider };
  }

  describe("Bootstrap (constructor)", function () {
    it("registers the deployer as ACTIVE ADMIN with the supplied did/publicKey", async function () {
      const { registry, deployer } = await deployFixture();

      const identity = await registry.getIdentity(deployer.address);
      expect(identity.did).to.equal(BOOTSTRAP_DID);
      expect(identity.publicKey).to.equal(BOOTSTRAP_PUBKEY);
      expect(identity.role).to.equal(Role.ADMIN);
      expect(identity.status).to.equal(IdentityStatus.ACTIVE);
    });

    it("emits IdentityRegistered for the bootstrap admin, same as any other registration", async function () {
      const IdentityRegistry = await ethers.getContractFactory(
        "IdentityRegistry"
      );
      const [deployer] = await ethers.getSigners();

      const registry = await IdentityRegistry.deploy(
        BOOTSTRAP_DID,
        BOOTSTRAP_PUBKEY
      );

      await expect(registry.deploymentTransaction())
        .to.emit(registry, "IdentityRegistered")
        .withArgs(deployer.address, BOOTSTRAP_DID, Role.ADMIN, anyValue);
    });

    it("isActive() and getRole() reflect the bootstrap admin correctly", async function () {
      const { registry, deployer } = await deployFixture();

      expect(await registry.isActive(deployer.address)).to.equal(true);
      expect(await registry.getRole(deployer.address)).to.equal(Role.ADMIN);
    });
  });

  describe("registerIdentity", function () {
    it("allows an active admin to register a new identity", async function () {
      const { registry, deployer, manager1 } = await deployFixture();

      await expect(
        registry
          .connect(deployer)
          .registerIdentity(
            manager1.address,
            "did:trustledger:manager1",
            "0xabcd",
            Role.MANAGER
          )
      )
        .to.emit(registry, "IdentityRegistered")
        .withArgs(
          manager1.address,
          "did:trustledger:manager1",
          Role.MANAGER,
          anyValue
        );

      expect(await registry.getRole(manager1.address)).to.equal(Role.MANAGER);
      expect(await registry.isActive(manager1.address)).to.equal(true);
    });

    it("rejects registration from a non-admin caller", async function () {
      const { registry, deployer, manager1, user1 } = await deployFixture();

      // register manager1 as MANAGER first (not ADMIN)
      await registry
        .connect(deployer)
        .registerIdentity(
          manager1.address,
          "did:trustledger:manager1",
          "0xabcd",
          Role.MANAGER
        );

      // manager1 (non-admin) attempts to register user1 — must revert
      await expect(
        registry
          .connect(manager1)
          .registerIdentity(
            user1.address,
            "did:trustledger:user1",
            "0xbeef",
            Role.USER
          )
      ).to.be.revertedWith("IdentityRegistry: caller is not an active admin");
    });

    it("rejects registration from a completely unregistered caller", async function () {
      const { registry, outsider, user1 } = await deployFixture();

      await expect(
        registry
          .connect(outsider)
          .registerIdentity(
            user1.address,
            "did:trustledger:user1",
            "0xbeef",
            Role.USER
          )
      ).to.be.revertedWith("IdentityRegistry: caller is not an active admin");
    });

    it("rejects double-registration of the same address", async function () {
      const { registry, deployer, user1 } = await deployFixture();

      await registry
        .connect(deployer)
        .registerIdentity(
          user1.address,
          "did:trustledger:user1",
          "0xbeef",
          Role.USER
        );

      await expect(
        registry
          .connect(deployer)
          .registerIdentity(
            user1.address,
            "did:trustledger:user1-again",
            "0xbeef",
            Role.MANAGER
          )
      ).to.be.revertedWith("IdentityRegistry: identity already registered");
    });
  });

  describe("revokeIdentity", function () {
    it("allows an active admin to revoke an identity", async function () {
      const { registry, deployer, user1 } = await deployFixture();

      await registry
        .connect(deployer)
        .registerIdentity(
          user1.address,
          "did:trustledger:user1",
          "0xbeef",
          Role.USER
        );

      await expect(registry.connect(deployer).revokeIdentity(user1.address))
        .to.emit(registry, "IdentityRevoked")
        .withArgs(user1.address, anyValue);

      expect(await registry.isActive(user1.address)).to.equal(false);
    });

    it("does NOT delete the record on revocation — role/did/createdAt remain queryable", async function () {
      const { registry, deployer, user1 } = await deployFixture();

      await registry
        .connect(deployer)
        .registerIdentity(
          user1.address,
          "did:trustledger:user1",
          "0xbeef",
          Role.USER
        );
      await registry.connect(deployer).revokeIdentity(user1.address);

      const identity = await registry.getIdentity(user1.address);
      expect(identity.did).to.equal("did:trustledger:user1");
      expect(identity.role).to.equal(Role.USER);
      expect(identity.status).to.equal(IdentityStatus.REVOKED);
      // getRole still returns the role, NOT NONE, distinguishing
      // "revoked" from "never registered"
      expect(await registry.getRole(user1.address)).to.equal(Role.USER);
    });

    it("rejects revocation from a non-admin caller", async function () {
      const { registry, deployer, manager1, user1 } = await deployFixture();

      await registry
        .connect(deployer)
        .registerIdentity(
          manager1.address,
          "did:trustledger:manager1",
          "0xabcd",
          Role.MANAGER
        );
      await registry
        .connect(deployer)
        .registerIdentity(
          user1.address,
          "did:trustledger:user1",
          "0xbeef",
          Role.USER
        );

      await expect(
        registry.connect(manager1).revokeIdentity(user1.address)
      ).to.be.revertedWith("IdentityRegistry: caller is not an active admin");
    });

    it("CRITICAL: a revoked admin immediately loses admin rights (role==ADMIN && status==ACTIVE check)", async function () {
      const { registry, deployer, admin2, user1 } = await deployFixture();

      // deployer (original admin) promotes admin2 to ADMIN
      await registry
        .connect(deployer)
        .registerIdentity(
          admin2.address,
          "did:trustledger:admin2",
          "0xdead",
          Role.ADMIN
        );

      // deployer then revokes admin2
      await registry.connect(deployer).revokeIdentity(admin2.address);

      // admin2 still has role == ADMIN in storage, but status == REVOKED —
      // this must be enough to deny admin actions, proving the modifier
      // checks BOTH role and status, not role alone
      expect(await registry.getRole(admin2.address)).to.equal(Role.ADMIN);
      expect(await registry.isActive(admin2.address)).to.equal(false);

      await expect(
        registry
          .connect(admin2)
          .registerIdentity(
            user1.address,
            "did:trustledger:user1",
            "0xbeef",
            Role.USER
          )
      ).to.be.revertedWith("IdentityRegistry: caller is not an active admin");
    });

    it("rejects revoking an already-revoked identity", async function () {
      const { registry, deployer, user1 } = await deployFixture();

      await registry
        .connect(deployer)
        .registerIdentity(
          user1.address,
          "did:trustledger:user1",
          "0xbeef",
          Role.USER
        );
      await registry.connect(deployer).revokeIdentity(user1.address);

      await expect(
        registry.connect(deployer).revokeIdentity(user1.address)
      ).to.be.revertedWith("IdentityRegistry: identity already revoked");
    });
  });

  describe("getRole for unregistered addresses", function () {
    it("returns Role.NONE for an address that was never registered", async function () {
      const { registry, outsider } = await deployFixture();

      expect(await registry.getRole(outsider.address)).to.equal(Role.NONE);
      expect(await registry.isActive(outsider.address)).to.equal(false);
    });

    it("getIdentity reverts for an address that was never registered", async function () {
      const { registry, outsider } = await deployFixture();

      await expect(
        registry.getIdentity(outsider.address)
      ).to.be.revertedWith("IdentityRegistry: identity not registered");
    });
  });

  describe("resolveDID — canonical DID <-> address resolver", function () {
    it("returns address(0) for an unknown DID", async function () {
      const { registry } = await deployFixture();

      expect(await registry.resolveDID("did:trustledger:nobody")).to.equal(
        ethers.ZeroAddress
      );
    });

    it("resolves the bootstrap admin's DID to the deployer address", async function () {
      const { registry, deployer } = await deployFixture();

      expect(await registry.resolveDID(BOOTSTRAP_DID)).to.equal(
        deployer.address
      );
    });

    it("resolves a newly registered identity's DID to its address", async function () {
      const { registry, deployer, user1 } = await deployFixture();

      await registry
        .connect(deployer)
        .registerIdentity(
          user1.address,
          "did:trustledger:user1",
          "0xbeef",
          Role.USER
        );

      expect(await registry.resolveDID("did:trustledger:user1")).to.equal(
        user1.address
      );
    });

    it("rejects registering a DID that is already mapped to a different address", async function () {
      const { registry, deployer, user1, admin2 } = await deployFixture();

      await registry
        .connect(deployer)
        .registerIdentity(
          user1.address,
          "did:trustledger:duplicate",
          "0xbeef",
          Role.USER
        );

      await expect(
        registry
          .connect(deployer)
          .registerIdentity(
            admin2.address,
            "did:trustledger:duplicate",
            "0xdead",
            Role.MANAGER
          )
      ).to.be.revertedWith(
        "IdentityRegistry: DID already registered to another address"
      );

      // confirm the mapping still points to the ORIGINAL address, not
      // overwritten or ambiguous
      expect(
        await registry.resolveDID("did:trustledger:duplicate")
      ).to.equal(user1.address);
    });

    it("CRITICAL: revoking an identity does NOT clear its DID resolution — same address remains resolvable", async function () {
      const { registry, deployer, user1 } = await deployFixture();

      await registry
        .connect(deployer)
        .registerIdentity(
          user1.address,
          "did:trustledger:user1",
          "0xbeef",
          Role.USER
        );

      const addressBeforeRevocation = await registry.resolveDID(
        "did:trustledger:user1"
      );

      await registry.connect(deployer).revokeIdentity(user1.address);

      const addressAfterRevocation = await registry.resolveDID(
        "did:trustledger:user1"
      );

      expect(addressAfterRevocation).to.equal(addressBeforeRevocation);
      expect(addressAfterRevocation).to.equal(user1.address);
      expect(addressAfterRevocation).to.not.equal(ethers.ZeroAddress);

      // confirm the FULL intended semantics table from the spec:
      // Known revoked DID -> same registered address (unchanged)
      expect(await registry.isActive(user1.address)).to.equal(false);
      expect(await registry.getRole(user1.address)).to.equal(Role.USER);
    });

    it("a DID freed by revocation is still NOT reusable by a different address (revocation does not free the DID for reassignment)", async function () {
      const { registry, deployer, user1, admin2 } = await deployFixture();

      await registry
        .connect(deployer)
        .registerIdentity(
          user1.address,
          "did:trustledger:user1",
          "0xbeef",
          Role.USER
        );
      await registry.connect(deployer).revokeIdentity(user1.address);

      // attempting to register the SAME did string to a DIFFERENT
      // address must still be rejected — the did->address mapping is
      // not cleared by revocation, so this remains a duplicate
      await expect(
        registry
          .connect(deployer)
          .registerIdentity(
            admin2.address,
            "did:trustledger:user1",
            "0xdead",
            Role.MANAGER
          )
      ).to.be.revertedWith(
        "IdentityRegistry: DID already registered to another address"
      );
    });
  });
});
