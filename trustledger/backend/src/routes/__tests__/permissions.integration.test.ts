/// <reference types="jest" />

import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { ethers } from "ethers";

import { createPermissionsRouter } from "../permissions";
import {
  getConfig,
  _resetConfigCacheForTests,
} from "../../config";
import {
  getRelayerSigner,
  _resetAccessControlServiceForTests,
} from "../../services/accessControlService";
import { _resetIdentityRegistryServiceForTests } from "../../services/identityRegistryService";
import IdentityRegistryArtifact from "../../abi/IdentityRegistry.json";

describe("permissions routes (integration, real chain)", () => {
  let provider: ethers.JsonRpcProvider;
  let identityRegistry: ethers.Contract;
  let relayer: ethers.Wallet;
  let identityRegistryWithRelayer: ethers.Contract;
  let app: express.Express;
  let assetIdCounter = 900000;

  beforeAll(async () => {
    _resetConfigCacheForTests();
    _resetAccessControlServiceForTests();
    _resetIdentityRegistryServiceForTests();

    const config = getConfig();

    provider = new ethers.JsonRpcProvider(config.hardhatRpcUrl);
    identityRegistry = new ethers.Contract(
      config.identityRegistryAddress,
      IdentityRegistryArtifact.abi,
      provider
    );

    relayer = getRelayerSigner();
    identityRegistryWithRelayer = identityRegistry.connect(
      relayer
    ) as ethers.Contract;

    app = express();
    app.use(express.json());
    app.use("/api/permissions", createPermissionsRouter());
  });

  afterAll(async () => {
    _resetAccessControlServiceForTests();
    _resetIdentityRegistryServiceForTests();
    _resetConfigCacheForTests();
    if (provider) provider.destroy();
  });

  // Unique per test to avoid the real contract's permission-history
  // "closes out the previous current record" behavior from one test
  // interfering with another's expected validUntil == 0 check.
  function freshAssetId(): number {
    assetIdCounter += 1;
    return assetIdCounter;
  }

  async function registerFreshIdentity(
    role: number
  ): Promise<{ wallet: ethers.HDNodeWallet; did: string }> {
    const wallet = ethers.Wallet.createRandom();
    const did = `did:trustledger:permissions-route-${wallet.address}`;
    const registerFn = identityRegistryWithRelayer.getFunction(
      "registerIdentity"
    );
    const tx = await registerFn(wallet.address, did, "0xbeef", role);
    await tx.wait();
    return { wallet, did };
  }

  function signJwtFor(input: {
    did: string;
    address: string;
    role: string;
  }): string {
    const config = getConfig();
    const nowSeconds = Math.floor(Date.now() / 1000);
    return jwt.sign(
      {
        did: input.did,
        address: input.address,
        role: input.role,
        iat: nowSeconds,
        exp: nowSeconds + 15 * 60,
      },
      config.backendSigningPrivateKey,
      { algorithm: "HS256" }
    );
  }

  test("allows a currently-active MANAGER to grant a permission", async () => {
    const manager = await registerFreshIdentity(2); // 2 = MANAGER
    const token = signJwtFor({
      did: manager.did,
      address: manager.wallet.address,
      role: "MANAGER",
    });
    const subject = await registerFreshIdentity(4); // 4 = USER
    const assetId = freshAssetId();

    const response = await request(app)
      .post("/api/permissions")
      .set("Authorization", `Bearer ${token}`)
      .send({
        assetId,
        subjectDID: subject.did,
        action: "READ",
        state: "GRANTED",
      });

    expect(response.status).toBe(201);
    expect(typeof response.body.permissionId).toBe("number");
    expect(response.body.permissionId).toBeGreaterThan(0);
    expect(typeof response.body.validFrom).toBe("number");
    expect(typeof response.body.txHash).toBe("string");
  });

  /**
   * THE MANDATORY TEST (same requirement as identities.integration.test.ts
   * — see BACKEND_SPEC.md's Authorization Trust Boundary section): a
   * still-valid, unexpired JWT for a subject revoked AFTER issuance must
   * be rejected on this privileged write too. This is a SEPARATE code
   * path from the identities route's own version of this test (different
   * route, different requireCurrentRole call site) and is not satisfied
   * by that test passing.
   */
  test("rejects granting a permission from a JWT whose subject was revoked after issuance", async () => {
    const manager = await registerFreshIdentity(2);
    const token = signJwtFor({
      did: manager.did,
      address: manager.wallet.address,
      role: "MANAGER",
    });

    const revokeFn = identityRegistryWithRelayer.getFunction(
      "revokeIdentity"
    );
    const revokeTx = await revokeFn(manager.wallet.address);
    await revokeTx.wait();

    const subject = await registerFreshIdentity(4);
    const assetId = freshAssetId();

    const response = await request(app)
      .post("/api/permissions")
      .set("Authorization", `Bearer ${token}`)
      .send({
        assetId,
        subjectDID: subject.did,
        action: "READ",
        state: "GRANTED",
      });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("IDENTITY_REVOKED");
  });

  test("rejects a currently-active USER attempting to set a permission", async () => {
    const user = await registerFreshIdentity(4);
    const token = signJwtFor({
      did: user.did,
      address: user.wallet.address,
      role: "USER",
    });
    const subject = await registerFreshIdentity(4);
    const assetId = freshAssetId();

    const response = await request(app)
      .post("/api/permissions")
      .set("Authorization", `Bearer ${token}`)
      .send({
        assetId,
        subjectDID: subject.did,
        action: "READ",
        state: "GRANTED",
      });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("INSUFFICIENT_ROLE");
  });

  test("returns 401 with no Authorization header", async () => {
    const response = await request(app).post("/api/permissions").send({});
    expect(response.status).toBe(401);
  });

  describe("GET /api/permissions/verify", () => {
    test("returns wasLegitimate: true for a timestamp covered by a GRANTED record", async () => {
      const manager = await registerFreshIdentity(2);
      const token = signJwtFor({
        did: manager.did,
        address: manager.wallet.address,
        role: "MANAGER",
      });
      const subject = await registerFreshIdentity(4);
      const assetId = freshAssetId();

      const setResponse = await request(app)
        .post("/api/permissions")
        .set("Authorization", `Bearer ${token}`)
        .send({
          assetId,
          subjectDID: subject.did,
          action: "READ",
          state: "GRANTED",
        });
      expect(setResponse.status).toBe(201);

      const atTimestamp = setResponse.body.validFrom + 5;

      const verifyResponse = await request(app).get(
        "/api/permissions/verify"
      ).query({
        assetId,
        subjectDID: subject.did,
        action: "READ",
        atTimestamp,
      });

      expect(verifyResponse.status).toBe(200);
      expect(verifyResponse.body.wasLegitimate).toBe(true);
      expect(verifyResponse.body.permissionVersionUsed.permissionId).toBe(
        setResponse.body.permissionId
      );
      expect(verifyResponse.body.permissionVersionUsed.state).toBe(
        "GRANTED"
      );
    });

    test("returns wasLegitimate: false, permissionId 0, for a subject/asset/action with no permission history at all", async () => {
      const subject = await registerFreshIdentity(4);
      const assetId = freshAssetId(); // never had setPermission called for it

      const verifyResponse = await request(app).get(
        "/api/permissions/verify"
      ).query({
        assetId,
        subjectDID: subject.did,
        action: "READ",
        atTimestamp: Math.floor(Date.now() / 1000),
      });

      expect(verifyResponse.status).toBe(200);
      expect(verifyResponse.body.wasLegitimate).toBe(false);
      expect(verifyResponse.body.permissionVersionUsed.permissionId).toBe(
        0
      );
      expect(verifyResponse.body.permissionVersionUsed.state).toBe(
        "REVOKED"
      );
    });

    test("does not require authentication", async () => {
      const subject = await registerFreshIdentity(4);
      const assetId = freshAssetId();

      const verifyResponse = await request(app).get(
        "/api/permissions/verify"
      ).query({
        assetId,
        subjectDID: subject.did,
        action: "READ",
        atTimestamp: Math.floor(Date.now() / 1000),
      });

      // No Authorization header sent at all — should not 401.
      expect(verifyResponse.status).toBe(200);
    });

    test("returns 400 for a missing required query param", async () => {
      const verifyResponse = await request(app).get(
        "/api/permissions/verify"
      ).query({
        assetId: 1,
        subjectDID: "did:trustledger:whatever",
        // action omitted
        atTimestamp: 123,
      });

      expect(verifyResponse.status).toBe(400);
      expect(verifyResponse.body.code).toBe("INVALID_REQUEST");
    });
  });
});
