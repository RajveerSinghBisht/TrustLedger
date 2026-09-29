const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const {
  anyValue,
} = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

describe("AccessControl", function () {
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

  const ASSET_ID = 1042;

  async function deployFixture() {
    const [deployer, manager1, user1, user2, outsider] =
      await ethers.getSigners();

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

    // Register manager1 as MANAGER
    await identityRegistry
      .connect(deployer)
      .registerIdentity(
        manager1.address,
        "did:trustledger:manager1",
        "0xabcd",
        Role.MANAGER
      );

    // Register user1 as USER (the subject whose access we'll test)
    await identityRegistry
      .connect(deployer)
      .registerIdentity(
        user1.address,
        "did:trustledger:user1",
        "0xbeef",
        Role.USER
      );

    // Register user2 as USER (a second subject, kept unauthorized by
    // default, used for negative tests)
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
      deployer,
      manager1,
      user1,
      user2,
      outsider,
    };
  }

  describe("setPermission", function () {
    it("allows an ADMIN to grant a permission", async function () {
      const { accessControl, deployer } = await deployFixture();

      await expect(
        accessControl
          .connect(deployer)
          .setPermission(
            ASSET_ID,
            "did:trustledger:user1",
            Action.READ,
            PermissionState.GRANTED
          )
      )
        .to.emit(accessControl, "PermissionChanged")
        .withArgs(
          1,
          ASSET_ID,
          "did:trustledger:user1",
          Action.READ,
          PermissionState.GRANTED,
          BOOTSTRAP_DID,
          anyValue
        );
    });

    it("allows a MANAGER to grant a permission", async function () {
      const { accessControl, manager1 } = await deployFixture();

      await expect(
        accessControl
          .connect(manager1)
          .setPermission(
            ASSET_ID,
            "did:trustledger:user1",
            Action.READ,
            PermissionState.GRANTED
          )
      ).to.not.be.reverted;
    });

    it("rejects a USER attempting to set a permission", async function () {
      const { accessControl, user1 } = await deployFixture();

      await expect(
        accessControl
          .connect(user1)
          .setPermission(
            ASSET_ID,
            "did:trustledger:user1",
            Action.READ,
            PermissionState.GRANTED
          )
      ).to.be.revertedWith("AccessControl: caller must be ADMIN or MANAGER");
    });

    it("rejects a completely unregistered caller", async function () {
      const { accessControl, outsider } = await deployFixture();

      await expect(
        accessControl
          .connect(outsider)
          .setPermission(
            ASSET_ID,
            "did:trustledger:user1",
            Action.READ,
            PermissionState.GRANTED
          )
      ).to.be.revertedWith("AccessControl: caller is not an active identity");
    });

    it("derives grantedBy from the caller's own DID, not a caller-supplied value", async function () {
      const { accessControl, manager1 } = await deployFixture();

      await accessControl
        .connect(manager1)
        .setPermission(
          ASSET_ID,
          "did:trustledger:user1",
          Action.READ,
          PermissionState.GRANTED
        );

      const current = await accessControl.checkPermissionAtTime(
        ASSET_ID,
        "did:trustledger:user1",
        Action.READ,
        await time.latest()
      );

      expect(current.grantedBy).to.equal("did:trustledger:manager1");
    });

    it("closes out the previous current record when a new one is created for the same key", async function () {
      const { accessControl, deployer } = await deployFixture();

      await accessControl
        .connect(deployer)
        .setPermission(
          ASSET_ID,
          "did:trustledger:user1",
          Action.READ,
          PermissionState.GRANTED
        );

      const grantTimestamp = await time.latest();

      await time.increase(3600); // advance 1 hour

      await accessControl
        .connect(deployer)
        .setPermission(
          ASSET_ID,
          "did:trustledger:user1",
          Action.READ,
          PermissionState.REVOKED
        );

      const revokeTimestamp = await time.latest();

      // Querying AT the original grant timestamp must still show
      // GRANTED — the old record was closed out (validUntil set), not
      // overwritten or deleted.
      const atGrantTime = await accessControl.checkPermissionAtTime(
        ASSET_ID,
        "did:trustledger:user1",
        Action.READ,
        grantTimestamp
      );
      expect(atGrantTime.state).to.equal(PermissionState.GRANTED);

      // Querying at the current (revoked) time must show REVOKED.
      const atRevokeTime = await accessControl.checkPermissionAtTime(
        ASSET_ID,
        "did:trustledger:user1",
        Action.READ,
        revokeTimestamp
      );
      expect(atRevokeTime.state).to.equal(PermissionState.REVOKED);
    });
  });

  describe("checkPermissionAtTime — the core USP", function () {
    it("CRITICAL: proves historical authorization survives a later revocation (the canonical example from CONTRACTS_SPEC.md)", async function () {
      const { accessControl, deployer } = await deployFixture();

      // 10:00 AM — Policy v4 created: Manager -> READ access -> GRANTED
      await accessControl
        .connect(deployer)
        .setPermission(
          ASSET_ID,
          "did:trustledger:user1",
          Action.READ,
          PermissionState.GRANTED
        );
      const grantTime = await time.latest();

      // 11:32 AM — Manager accesses Calibration Record #C-2041
      await time.increase(5520); // ~1h32m later
      const accessTime = await time.latest();

      // 12:00 PM — Policy v5 created: Manager -> READ access -> REVOKED
      await time.increase(1680); // ~28m later
      await accessControl
        .connect(deployer)
        .setPermission(
          ASSET_ID,
          "did:trustledger:user1",
          Action.READ,
          PermissionState.REVOKED
        );

      // 2:00 PM — Auditor investigates the 11:32 AM access
      await time.increase(7200); // 2h later

      // A conventional system can only report "no access now."
      const now = await accessControl.checkPermissionNow(
        ASSET_ID,
        "did:trustledger:user1",
        Action.READ
      );
      expect(now).to.equal(false);

      // TrustLedger proves: "At 11:32 AM, under the policy in effect at
      // that exact moment, this access was authorized."
      const atAccessTime = await accessControl.checkPermissionAtTime(
        ASSET_ID,
        "did:trustledger:user1",
        Action.READ,
        accessTime
      );
      expect(atAccessTime.state).to.equal(PermissionState.GRANTED);

      // Sanity: grant time itself is also GRANTED
      const atGrantTime = await accessControl.checkPermissionAtTime(
        ASSET_ID,
        "did:trustledger:user1",
        Action.READ,
        grantTime
      );
      expect(atGrantTime.state).to.equal(PermissionState.GRANTED);
    });

    it("returns REVOKED (safe default) for a timestamp before any permission record exists", async function () {
      const { accessControl, deployer } = await deployFixture();

      const beforeAnyGrant = await time.latest();
      await time.increase(100);

      await accessControl
        .connect(deployer)
        .setPermission(
          ASSET_ID,
          "did:trustledger:user1",
          Action.READ,
          PermissionState.GRANTED
        );

      const result = await accessControl.checkPermissionAtTime(
        ASSET_ID,
        "did:trustledger:user1",
        Action.READ,
        beforeAnyGrant
      );
      expect(result.state).to.equal(PermissionState.REVOKED);
      expect(result.permissionId).to.equal(0);
    });

    it("does NOT retroactively invalidate a historically valid permission when the subject is later revoked (identity status is NOT applied retroactively)", async function () {
      const { accessControl, identityRegistry, deployer, user1 } =
        await deployFixture();

      await accessControl
        .connect(deployer)
        .setPermission(
          ASSET_ID,
          "did:trustledger:user1",
          Action.READ,
          PermissionState.GRANTED
        );
      const grantTime = await time.latest();

      await time.increase(3600);

      // user1's IDENTITY is revoked (not the permission)
      await identityRegistry.connect(deployer).revokeIdentity(user1.address);

      // Historical check for the grant time must still show GRANTED —
      // per CONTRACTS_SPEC.md Section 2.1, checkPermissionAtTime does
      // NOT apply current identity status retroactively.
      const historical = await accessControl.checkPermissionAtTime(
        ASSET_ID,
        "did:trustledger:user1",
        Action.READ,
        grantTime
      );
      expect(historical.state).to.equal(PermissionState.GRANTED);
    });
  });

  describe("checkPermissionNow — current authorization with mandatory identity-status check", function () {
    it("returns true when permission is GRANTED and identity is ACTIVE", async function () {
      const { accessControl, deployer } = await deployFixture();

      await accessControl
        .connect(deployer)
        .setPermission(
          ASSET_ID,
          "did:trustledger:user1",
          Action.READ,
          PermissionState.GRANTED
        );

      expect(
        await accessControl.checkPermissionNow(
          ASSET_ID,
          "did:trustledger:user1",
          Action.READ
        )
      ).to.equal(true);
    });

    it("returns false when no permission has ever been granted", async function () {
      const { accessControl } = await deployFixture();

      expect(
        await accessControl.checkPermissionNow(
          ASSET_ID,
          "did:trustledger:user2",
          Action.READ
        )
      ).to.equal(false);
    });

    it("returns false for an unknown/never-registered DID, even if a permission record somehow exists for it", async function () {
      const { accessControl, deployer } = await deployFixture();

      // Grant a permission to a DID that was never registered in
      // IdentityRegistry — setPermission itself does not require the
      // subjectDID to be a registered identity (only the CALLER must be
      // ADMIN/MANAGER), so this is a legitimate state to test.
      await accessControl
        .connect(deployer)
        .setPermission(
          ASSET_ID,
          "did:trustledger:ghost",
          Action.READ,
          PermissionState.GRANTED
        );

      expect(
        await accessControl.checkPermissionNow(
          ASSET_ID,
          "did:trustledger:ghost",
          Action.READ
        )
      ).to.equal(false);
    });

    it("CRITICAL: returns false immediately after identity revocation, even though the GRANTED permission record still exists", async function () {
      const { accessControl, identityRegistry, deployer, user1 } =
        await deployFixture();

      await accessControl
        .connect(deployer)
        .setPermission(
          ASSET_ID,
          "did:trustledger:user1",
          Action.READ,
          PermissionState.GRANTED
        );

      // Confirm access works before revocation
      expect(
        await accessControl.checkPermissionNow(
          ASSET_ID,
          "did:trustledger:user1",
          Action.READ
        )
      ).to.equal(true);

      // Revoke the IDENTITY (not the permission)
      await identityRegistry.connect(deployer).revokeIdentity(user1.address);

      // The permission record is UNCHANGED and still GRANTED — confirm
      // this directly, so the following false result is attributable
      // ONLY to identity status, not to any permission-side side effect
      const stillGranted = await accessControl.checkPermissionAtTime(
        ASSET_ID,
        "did:trustledger:user1",
        Action.READ,
        await time.latest()
      );
      expect(stillGranted.state).to.equal(PermissionState.GRANTED);

      // Yet current access must now be denied
      expect(
        await accessControl.checkPermissionNow(
          ASSET_ID,
          "did:trustledger:user1",
          Action.READ
        )
      ).to.equal(false);
    });

    it("returns false when the permission state is explicitly REVOKED", async function () {
      const { accessControl, deployer } = await deployFixture();

      await accessControl
        .connect(deployer)
        .setPermission(
          ASSET_ID,
          "did:trustledger:user1",
          Action.READ,
          PermissionState.GRANTED
        );
      await accessControl
        .connect(deployer)
        .setPermission(
          ASSET_ID,
          "did:trustledger:user1",
          Action.READ,
          PermissionState.REVOKED
        );

      expect(
        await accessControl.checkPermissionNow(
          ASSET_ID,
          "did:trustledger:user1",
          Action.READ
        )
      ).to.equal(false);
    });

    it("distinguishes between different Actions on the same asset/subject", async function () {
      const { accessControl, deployer } = await deployFixture();

      await accessControl
        .connect(deployer)
        .setPermission(
          ASSET_ID,
          "did:trustledger:user1",
          Action.READ,
          PermissionState.GRANTED
        );

      // READ is granted, but WRITE was never touched — must be false
      expect(
        await accessControl.checkPermissionNow(
          ASSET_ID,
          "did:trustledger:user1",
          Action.WRITE
        )
      ).to.equal(false);
    });
  });

  describe("recordAccess — self-enforced authorization, not caller-trusted", function () {
    it("emits AssetAccessed when the requester genuinely has current access", async function () {
      const { accessControl, deployer, user1 } = await deployFixture();

      await accessControl
        .connect(deployer)
        .setPermission(
          ASSET_ID,
          "did:trustledger:user1",
          Action.READ,
          PermissionState.GRANTED
        );

      await expect(
        accessControl
          .connect(deployer)
          .recordAccess(ASSET_ID, "did:trustledger:user1", 1)
      )
        .to.emit(accessControl, "AssetAccessed")
        .withArgs(ASSET_ID, "did:trustledger:user1", 1, anyValue);
    });

    it("CRITICAL: rejects recordAccess for a requester with NO granted permission — cannot manufacture a valid event", async function () {
      const { accessControl, deployer } = await deployFixture();

      await expect(
        accessControl
          .connect(deployer)
          .recordAccess(ASSET_ID, "did:trustledger:user2", 999)
      ).to.be.revertedWith("AccessControl: access not currently authorized");
    });

    it("CRITICAL: rejects recordAccess for a requester whose identity was revoked, even with a GRANTED permission record", async function () {
      const { accessControl, identityRegistry, deployer, user1 } =
        await deployFixture();

      await accessControl
        .connect(deployer)
        .setPermission(
          ASSET_ID,
          "did:trustledger:user1",
          Action.READ,
          PermissionState.GRANTED
        );
      await identityRegistry.connect(deployer).revokeIdentity(user1.address);

      await expect(
        accessControl
          .connect(deployer)
          .recordAccess(ASSET_ID, "did:trustledger:user1", 1)
      ).to.be.revertedWith("AccessControl: access not currently authorized");
    });

    it("rejects recordAccess from a caller whose OWN identity is not active, regardless of the requester's authorization", async function () {
      const { accessControl, deployer, user1, outsider } =
        await deployFixture();

      await accessControl
        .connect(deployer)
        .setPermission(
          ASSET_ID,
          "did:trustledger:user1",
          Action.READ,
          PermissionState.GRANTED
        );

      // outsider (unregistered) attempts to call recordAccess on behalf
      // of user1, who IS genuinely authorized — the caller's own status
      // is checked independently and must also pass
      await expect(
        accessControl
          .connect(outsider)
          .recordAccess(ASSET_ID, "did:trustledger:user1", 1)
      ).to.be.revertedWith("AccessControl: caller is not an active identity");
    });
  });

  // ── Dual-Custody (Two-Man Rule) Tests ──────────────────────────────
  //
  // These tests require the full three-contract stack because
  // requestPermission() queries AssetRegistry for asset classification.

  const Classification = {
    PUBLIC: 0,
    INTERNAL: 1,
    CONFIDENTIAL: 2,
  };

  async function deployWithAssetRegistryFixture() {
    const [deployer, manager1, manager2, user1, user2, outsider] =
      await ethers.getSigners();

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

    // Wire AccessControl → AssetRegistry (one-shot initializer)
    await accessControl
      .connect(deployer)
      .setAssetRegistry(await assetRegistry.getAddress());

    // Register manager1 as MANAGER
    await identityRegistry
      .connect(deployer)
      .registerIdentity(
        manager1.address,
        "did:trustledger:manager1",
        "0xabcd",
        Role.MANAGER
      );

    // Register manager2 as MANAGER (Officer 2 for dual-custody)
    await identityRegistry
      .connect(deployer)
      .registerIdentity(
        manager2.address,
        "did:trustledger:manager2",
        "0xdead",
        Role.MANAGER
      );

    // Register user1 as USER (the subject whose access we'll test)
    await identityRegistry
      .connect(deployer)
      .registerIdentity(
        user1.address,
        "did:trustledger:user1",
        "0xbeef",
        Role.USER
      );

    // Register a CONFIDENTIAL asset (assetId = 1)
    const confidentialHash = ethers.keccak256(
      ethers.toUtf8Bytes("classified-radar-manual-v1")
    );
    await assetRegistry
      .connect(deployer)
      .registerAsset(
        confidentialHash,
        BOOTSTRAP_DID,
        "ipfs://classified",
        Classification.CONFIDENTIAL
      );

    // Register a PUBLIC asset (assetId = 2)
    const publicHash = ethers.keccak256(
      ethers.toUtf8Bytes("public-maintenance-log-v1")
    );
    await assetRegistry
      .connect(deployer)
      .registerAsset(
        publicHash,
        BOOTSTRAP_DID,
        "ipfs://public",
        Classification.PUBLIC
      );

    return {
      identityRegistry,
      accessControl,
      assetRegistry,
      deployer,
      manager1,
      manager2,
      user1,
      user2,
      outsider,
      confidentialAssetId: 1,
      publicAssetId: 2,
    };
  }

  describe("setAssetRegistry — one-shot initializer", function () {
    it("can be called once by the deployer", async function () {
      const { accessControl, assetRegistry } =
        await deployWithAssetRegistryFixture();

      // Already set in the fixture — confirm it's set
      expect(await accessControl.getAssetRegistryAddress()).to.equal(
        await assetRegistry.getAddress()
      );
    });

    it("reverts if called a second time (one-shot invariant)", async function () {
      const { accessControl, deployer } =
        await deployWithAssetRegistryFixture();

      // Already set in fixture — attempting a second set must revert
      await expect(
        accessControl
          .connect(deployer)
          .setAssetRegistry(ethers.ZeroAddress.replace(/0$/, "1"))
      ).to.be.revertedWith("AccessControl: AssetRegistry already set");
    });

    it("reverts if called by a non-deployer", async function () {
      // Deploy fresh contracts WITHOUT calling setAssetRegistry
      const [deployer, nonDeployer] = await ethers.getSigners();

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

      await expect(
        accessControl
          .connect(nonDeployer)
          .setAssetRegistry(ethers.ZeroAddress.replace(/0$/, "1"))
      ).to.be.revertedWith(
        "AccessControl: only deployer can set AssetRegistry"
      );
    });
  });

  describe("requestPermission — classification-based routing", function () {
    it("creates a PENDING request for a CONFIDENTIAL asset (does NOT grant immediately)", async function () {
      const { accessControl, manager1, confidentialAssetId } =
        await deployWithAssetRegistryFixture();

      await expect(
        accessControl
          .connect(manager1)
          .requestPermission(
            confidentialAssetId,
            "did:trustledger:user1",
            Action.READ,
            PermissionState.GRANTED
          )
      )
        .to.emit(accessControl, "PermissionRequested")
        .withArgs(
          1, // requestId
          confidentialAssetId,
          "did:trustledger:user1",
          Action.READ,
          PermissionState.GRANTED,
          manager1.address,
          anyValue // expiresAt
        );

      // Permission should NOT be active yet — it's pending
      expect(
        await accessControl.checkPermissionNow(
          confidentialAssetId,
          "did:trustledger:user1",
          Action.READ
        )
      ).to.equal(false);

      // The request should be retrievable
      const request = await accessControl.getPermissionRequest(1);
      expect(request.assetId).to.equal(confidentialAssetId);
      expect(request.approved).to.equal(false);
      expect(request.cancelled).to.equal(false);
    });

    it("grants immediately (single-sig) for a PUBLIC asset", async function () {
      const { accessControl, manager1, publicAssetId } =
        await deployWithAssetRegistryFixture();

      await accessControl
        .connect(manager1)
        .requestPermission(
          publicAssetId,
          "did:trustledger:user1",
          Action.READ,
          PermissionState.GRANTED
        );

      // Permission should be active immediately — no pending state
      expect(
        await accessControl.checkPermissionNow(
          publicAssetId,
          "did:trustledger:user1",
          Action.READ
        )
      ).to.equal(true);
    });
  });

  describe("approvePermission — dual-custody enforcement", function () {
    it("CRITICAL: rejects self-approval (Officer 1 cannot approve their own request)", async function () {
      const { accessControl, manager1, confidentialAssetId } =
        await deployWithAssetRegistryFixture();

      await accessControl
        .connect(manager1)
        .requestPermission(
          confidentialAssetId,
          "did:trustledger:user1",
          Action.READ,
          PermissionState.GRANTED
        );

      await expect(
        accessControl.connect(manager1).approvePermission(1)
      ).to.be.revertedWith(
        "AccessControl: cannot approve own request (dual-custody violation)"
      );
    });

    it("succeeds when a DIFFERENT active ADMIN/MANAGER approves", async function () {
      const { accessControl, manager1, manager2, confidentialAssetId } =
        await deployWithAssetRegistryFixture();

      // Officer 1 (manager1) creates the request
      await accessControl
        .connect(manager1)
        .requestPermission(
          confidentialAssetId,
          "did:trustledger:user1",
          Action.READ,
          PermissionState.GRANTED
        );

      // Officer 2 (manager2) approves
      await expect(accessControl.connect(manager2).approvePermission(1))
        .to.emit(accessControl, "PermissionApproved")
        .withArgs(1, manager2.address);

      // NOW the permission should be active
      expect(
        await accessControl.checkPermissionNow(
          confidentialAssetId,
          "did:trustledger:user1",
          Action.READ
        )
      ).to.equal(true);

      // The request should be marked as approved
      const request = await accessControl.getPermissionRequest(1);
      expect(request.approved).to.equal(true);
    });

    it("rejects approval after the 24-hour TTL has expired", async function () {
      const { accessControl, manager1, manager2, confidentialAssetId } =
        await deployWithAssetRegistryFixture();

      await accessControl
        .connect(manager1)
        .requestPermission(
          confidentialAssetId,
          "did:trustledger:user1",
          Action.READ,
          PermissionState.GRANTED
        );

      // Fast-forward past the 24-hour TTL
      await time.increase(24 * 60 * 60 + 1);

      await expect(
        accessControl.connect(manager2).approvePermission(1)
      ).to.be.revertedWith("AccessControl: request has expired");
    });

    it("the approved permission integrates into the versioned timeline and is queryable via checkPermissionAtTime", async function () {
      const { accessControl, manager1, manager2, confidentialAssetId } =
        await deployWithAssetRegistryFixture();

      await accessControl
        .connect(manager1)
        .requestPermission(
          confidentialAssetId,
          "did:trustledger:user1",
          Action.READ,
          PermissionState.GRANTED
        );

      await accessControl.connect(manager2).approvePermission(1);

      const approvalTime = await time.latest();

      // The temporal verification USP must work with dual-custody
      // approved permissions identically to single-sig permissions
      const atApprovalTime = await accessControl.checkPermissionAtTime(
        confidentialAssetId,
        "did:trustledger:user1",
        Action.READ,
        approvalTime
      );
      expect(atApprovalTime.state).to.equal(PermissionState.GRANTED);
      // grantedBy should be the APPROVER (Officer 2), not the requester
      expect(atApprovalTime.grantedBy).to.equal("did:trustledger:manager2");
    });

    it("rejects approval from a revoked officer", async function () {
      const {
        accessControl,
        identityRegistry,
        deployer,
        manager1,
        manager2,
        confidentialAssetId,
      } = await deployWithAssetRegistryFixture();

      await accessControl
        .connect(manager1)
        .requestPermission(
          confidentialAssetId,
          "did:trustledger:user1",
          Action.READ,
          PermissionState.GRANTED
        );

      // Deployer (admin) revokes manager2 before they can approve
      await identityRegistry.connect(deployer).revokeIdentity(manager2.address);

      await expect(
        accessControl.connect(manager2).approvePermission(1)
      ).to.be.revertedWith("AccessControl: caller is not an active identity");
    });

    it("CRITICAL: self-approval reverts when the requester is a real officer address, not a relayer", async function () {
      const { accessControl, manager1, confidentialAssetId } =
        await deployWithAssetRegistryFixture();

      // Real officer 1 requests access directly
      await accessControl
        .connect(manager1)
        .requestPermission(
          confidentialAssetId,
          "did:trustledger:user1",
          Action.READ,
          PermissionState.GRANTED
        );

      const request = await accessControl.getPermissionRequest(1);
      // Verify requester on-chain is manager1's real address
      expect(request.requester).to.equal(manager1.address);

      // Attempt self-approval from the same officer
      await expect(
        accessControl.connect(manager1).approvePermission(1)
      ).to.be.revertedWith(
        "AccessControl: cannot approve own request (dual-custody violation)"
      );
    });
  });

  describe("cancelPermissionRequest", function () {
    it("allows the original requester to cancel", async function () {
      const { accessControl, manager1, confidentialAssetId } =
        await deployWithAssetRegistryFixture();

      await accessControl
        .connect(manager1)
        .requestPermission(
          confidentialAssetId,
          "did:trustledger:user1",
          Action.READ,
          PermissionState.GRANTED
        );

      await expect(
        accessControl.connect(manager1).cancelPermissionRequest(1)
      )
        .to.emit(accessControl, "PermissionRequestCancelled")
        .withArgs(1, manager1.address);

      const request = await accessControl.getPermissionRequest(1);
      expect(request.cancelled).to.equal(true);
    });

    it("allows an active ADMIN (not the requester) to cancel", async function () {
      const { accessControl, deployer, manager1, confidentialAssetId } =
        await deployWithAssetRegistryFixture();

      await accessControl
        .connect(manager1)
        .requestPermission(
          confidentialAssetId,
          "did:trustledger:user1",
          Action.READ,
          PermissionState.GRANTED
        );

      // deployer is ADMIN, not the requester
      await expect(
        accessControl.connect(deployer).cancelPermissionRequest(1)
      )
        .to.emit(accessControl, "PermissionRequestCancelled")
        .withArgs(1, deployer.address);
    });

    it("rejects cancellation from an outsider who is neither requester nor ADMIN", async function () {
      const { accessControl, manager1, user1, confidentialAssetId } =
        await deployWithAssetRegistryFixture();

      await accessControl
        .connect(manager1)
        .requestPermission(
          confidentialAssetId,
          "did:trustledger:user1",
          Action.READ,
          PermissionState.GRANTED
        );

      // user1 is a registered USER (not ADMIN, not the requester)
      await expect(
        accessControl.connect(user1).cancelPermissionRequest(1)
      ).to.be.revertedWith(
        "AccessControl: only requester or ADMIN can cancel"
      );
    });
  });
});
