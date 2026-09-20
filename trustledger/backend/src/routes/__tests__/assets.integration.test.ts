/// <reference types="jest" />

import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { ethers } from "ethers";
import { PrismaClient } from "@prisma/client";

import { createAssetsRouter } from "../assets";
import { createProofBundlesRouter } from "../proofBundles";
import { createPermissionsRouter } from "../permissions";
import { EncryptedRecordRepository } from "../../repositories/encryptedRecord";
import { AuditLogRepository } from "../../repositories/auditLog";
import {
  getConfig,
  _resetConfigCacheForTests,
} from "../../config";
import {
  getRelayerSigner,
  _resetAccessControlServiceForTests,
} from "../../services/accessControlService";
import { _resetIdentityRegistryServiceForTests } from "../../services/identityRegistryService";
import { _resetAssetRegistryServiceForTests } from "../../services/assetRegistryService";
import { _resetDocumentEncryptionForTests } from "../../services/documentEncryption";
import IdentityRegistryArtifact from "../../abi/IdentityRegistry.json";

describe("assets + proof-bundles routes (integration, real chain, real crypto)", () => {
  let provider: ethers.JsonRpcProvider;
  let identityRegistry: ethers.Contract;
  let relayer: ethers.Wallet;
  let identityRegistryWithRelayer: ethers.Contract;
  let prisma: PrismaClient;
  let app: express.Express;

  beforeAll(async () => {
    _resetConfigCacheForTests();
    _resetAccessControlServiceForTests();
    _resetIdentityRegistryServiceForTests();
    _resetAssetRegistryServiceForTests();
    _resetDocumentEncryptionForTests();

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

    prisma = new PrismaClient();
    const encryptedRecordRepository = new EncryptedRecordRepository(prisma);
    const auditLogRepository = new AuditLogRepository(prisma);

    app = express();
    app.use(express.json());
    app.use(
      "/api/assets",
      createAssetsRouter(encryptedRecordRepository, auditLogRepository)
    );
    app.use("/api/proof-bundles", createProofBundlesRouter());
    // Needed to grant READ permission in the download tests below —
    // reusing the already-verified permissions route rather than
    // reaching around it into accessControlService directly, so these
    // tests exercise the same code path a real client would.
    app.use("/api/permissions", createPermissionsRouter());
  });

  afterAll(async () => {
    _resetAccessControlServiceForTests();
    _resetIdentityRegistryServiceForTests();
    _resetAssetRegistryServiceForTests();
    _resetDocumentEncryptionForTests();
    _resetConfigCacheForTests();
    if (provider) provider.destroy();
    if (prisma) await prisma.$disconnect();
  });

  async function registerFreshIdentity(
    role: number
  ): Promise<{ wallet: ethers.HDNodeWallet; did: string }> {
    const wallet = ethers.Wallet.createRandom();
    const did = `did:trustledger:assets-route-${wallet.address}`;
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

  async function uploadSampleAsset(input: {
    adminToken: string;
    ownerDID: string;
    classification?: string;
    content?: string;
  }): Promise<request.Response> {
    return request(app)
      .post("/api/assets")
      .set("Authorization", `Bearer ${input.adminToken}`)
      .field("ownerDID", input.ownerDID)
      .field("classification", input.classification ?? "INTERNAL")
      .attach(
        "file",
        Buffer.from(input.content ?? "sample document contents"),
        "test.txt"
      );
  }

  describe("POST /api/assets", () => {
    test("allows a currently-active ADMIN to register an asset with an uploaded file", async () => {
      const admin = await registerFreshIdentity(1); // 1 = ADMIN
      const owner = await registerFreshIdentity(4); // 4 = USER
      const token = signJwtFor({
        did: admin.did,
        address: admin.wallet.address,
        role: "ADMIN",
      });

      const response = await uploadSampleAsset({
        adminToken: token,
        ownerDID: owner.did,
        content: "hello trustledger",
      });

      expect(response.status).toBe(201);
      expect(typeof response.body.assetId).toBe("number");
      expect(response.body.assetHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(response.body.metadataURI).toMatch(/^local:\/\/records\//);
      expect(typeof response.body.txHash).toBe("string");
    });

    test("rejects an upload from a JWT whose ADMIN subject was revoked after issuance", async () => {
      const admin = await registerFreshIdentity(1);
      const owner = await registerFreshIdentity(4);
      const token = signJwtFor({
        did: admin.did,
        address: admin.wallet.address,
        role: "ADMIN",
      });

      const revokeFn = identityRegistryWithRelayer.getFunction(
        "revokeIdentity"
      );
      const revokeTx = await revokeFn(admin.wallet.address);
      await revokeTx.wait();

      const response = await uploadSampleAsset({
        adminToken: token,
        ownerDID: owner.did,
      });

      expect(response.status).toBe(403);
      expect(response.body.code).toBe("IDENTITY_REVOKED");
    });

    test("rejects a currently-active MANAGER (contract is ADMIN-only, not ADMIN-or-MANAGER)", async () => {
      const manager = await registerFreshIdentity(2); // 2 = MANAGER
      const owner = await registerFreshIdentity(4);
      const token = signJwtFor({
        did: manager.did,
        address: manager.wallet.address,
        role: "MANAGER",
      });

      const response = await uploadSampleAsset({
        adminToken: token,
        ownerDID: owner.did,
      });

      expect(response.status).toBe(403);
      expect(response.body.code).toBe("INSUFFICIENT_ROLE");
    });

    test("returns 400 when no file is attached", async () => {
      const admin = await registerFreshIdentity(1);
      const owner = await registerFreshIdentity(4);
      const token = signJwtFor({
        did: admin.did,
        address: admin.wallet.address,
        role: "ADMIN",
      });

      const response = await request(app)
        .post("/api/assets")
        .set("Authorization", `Bearer ${token}`)
        .field("ownerDID", owner.did)
        .field("classification", "INTERNAL");

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("INVALID_REQUEST");
    });

    test("returns 401 with no Authorization header", async () => {
      const response = await request(app).post("/api/assets").send({});
      expect(response.status).toBe(401);
    });
  });

  describe("GET /api/assets/:assetId", () => {
    test("returns merged on-chain + Postgres metadata without authentication", async () => {
      const admin = await registerFreshIdentity(1);
      const owner = await registerFreshIdentity(4);
      const token = signJwtFor({
        did: admin.did,
        address: admin.wallet.address,
        role: "ADMIN",
      });

      const uploadResponse = await uploadSampleAsset({
        adminToken: token,
        ownerDID: owner.did,
        classification: "CONFIDENTIAL",
      });
      expect(uploadResponse.status).toBe(201);

      const response = await request(app).get(
        `/api/assets/${uploadResponse.body.assetId}`
      );

      expect(response.status).toBe(200);
      expect(response.body.assetId).toBe(uploadResponse.body.assetId);
      expect(response.body.assetHash).toBe(uploadResponse.body.assetHash);
      expect(response.body.ownerDID).toBe(owner.did);
      expect(response.body.classification).toBe("CONFIDENTIAL");
      expect(response.body.status).toBe("ACTIVE");
      expect(response.body.originalFilename).toBe("test.txt");
      // No Authorization header sent — should not 401.
    });

    test("returns 404 for a non-existent assetId", async () => {
      const response = await request(app).get("/api/assets/999999999");
      expect(response.status).toBe(404);
      expect(response.body.code).toBe("ASSET_NOT_FOUND");
    });
  });

  describe("GET /api/assets/:assetId/download", () => {
    test("decrypts and returns the original file bytes, with a valid X-Proof-Bundle header, for an authorized READ", async () => {
      const admin = await registerFreshIdentity(1);
      const adminToken = signJwtFor({
        did: admin.did,
        address: admin.wallet.address,
        role: "ADMIN",
      });

      const owner = await registerFreshIdentity(4);
      const reader = await registerFreshIdentity(4);
      const readerToken = signJwtFor({
        did: reader.did,
        address: reader.wallet.address,
        role: "USER",
      });

      const originalContent = "this is the real file content, byte for byte";

      const uploadResponse = await uploadSampleAsset({
        adminToken,
        ownerDID: owner.did,
        content: originalContent,
      });
      expect(uploadResponse.status).toBe(201);
      const assetId = uploadResponse.body.assetId;

      // Grant the reader READ permission via the permissions route
      // (reusing the already-verified path rather than reaching into
      // accessControlService directly).
      const grantResponse = await request(app)
        .post("/api/permissions")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          assetId,
          subjectDID: reader.did,
          action: "READ",
          state: "GRANTED",
        });
      expect(grantResponse.status).toBe(201);

      const downloadResponse = await request(app)
        .get(`/api/assets/${assetId}/download`)
        .set("Authorization", `Bearer ${readerToken}`);

      expect(downloadResponse.status).toBe(200);
      expect(downloadResponse.text).toBe(originalContent);
      expect(downloadResponse.headers["x-proof-bundle"]).toBeDefined();

      // Decode and sanity-check the bundle's own shape before feeding it
      // to the verify endpoint below.
      const decodedBundle = JSON.parse(
        Buffer.from(
          downloadResponse.headers["x-proof-bundle"],
          "base64"
        ).toString("utf8")
      );
      expect(decodedBundle.assetId).toBe(assetId);
      expect(decodedBundle.accessedBy).toBe(reader.did);
      expect(decodedBundle.permissionVersionUsed.state).toBe("GRANTED");
      expect(typeof decodedBundle.onChainTxRef).toBe("string");
      expect(decodedBundle.onChainTxRef.length).toBeGreaterThan(0);
      expect(typeof decodedBundle.signature).toBe("string");

      // THE CORE END-TO-END CHECK: feed the exact bundle the download
      // endpoint produced into the independent verify endpoint, and
      // confirm it comes back valid. This is the real proof that
      // generation and verification actually agree with each other,
      // not just that each one individually runs without throwing.
      const verifyResponse = await request(app)
        .post("/api/proof-bundles/verify")
        .send(decodedBundle);

      expect(verifyResponse.status).toBe(200);
      expect(verifyResponse.body.valid).toBe(true);
      expect(verifyResponse.body.reason).toBeNull();
    });

    test("returns 403 for a reader with no granted permission", async () => {
      const admin = await registerFreshIdentity(1);
      const adminToken = signJwtFor({
        did: admin.did,
        address: admin.wallet.address,
        role: "ADMIN",
      });
      const owner = await registerFreshIdentity(4);
      const stranger = await registerFreshIdentity(4);
      const strangerToken = signJwtFor({
        did: stranger.did,
        address: stranger.wallet.address,
        role: "USER",
      });

      const uploadResponse = await uploadSampleAsset({
        adminToken,
        ownerDID: owner.did,
      });
      expect(uploadResponse.status).toBe(201);

      const downloadResponse = await request(app)
        .get(`/api/assets/${uploadResponse.body.assetId}/download`)
        .set("Authorization", `Bearer ${strangerToken}`);

      expect(downloadResponse.status).toBe(403);
      expect(downloadResponse.body.code).toBe("ACCESS_DENIED");
    });

    test("returns 401 with no Authorization header", async () => {
      const response = await request(app).get(
        "/api/assets/1/download"
      );
      expect(response.status).toBe(401);
    });
  });

  describe("POST /api/proof-bundles/verify", () => {
    test("returns valid: false for a tampered field (assetHash changed after signing)", async () => {
      const admin = await registerFreshIdentity(1);
      const adminToken = signJwtFor({
        did: admin.did,
        address: admin.wallet.address,
        role: "ADMIN",
      });
      const owner = await registerFreshIdentity(4);
      const reader = await registerFreshIdentity(4);
      const readerToken = signJwtFor({
        did: reader.did,
        address: reader.wallet.address,
        role: "USER",
      });

      const uploadResponse = await uploadSampleAsset({
        adminToken,
        ownerDID: owner.did,
      });
      const assetId = uploadResponse.body.assetId;

      await request(app)
        .post("/api/permissions")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          assetId,
          subjectDID: reader.did,
          action: "READ",
          state: "GRANTED",
        });

      const downloadResponse = await request(app)
        .get(`/api/assets/${assetId}/download`)
        .set("Authorization", `Bearer ${readerToken}`);

      const bundle = JSON.parse(
        Buffer.from(
          downloadResponse.headers["x-proof-bundle"],
          "base64"
        ).toString("utf8")
      );

      // Tamper with a field AFTER the signature was computed over the
      // original — the signature no longer matches this modified JSON.
      bundle.assetHash =
        "0x0000000000000000000000000000000000000000000000000000000000ff";

      const verifyResponse = await request(app)
        .post("/api/proof-bundles/verify")
        .send(bundle);

      expect(verifyResponse.status).toBe(200);
      expect(verifyResponse.body.valid).toBe(false);
      expect(verifyResponse.body.reason).toBe("signature mismatch");
    });

    test("returns valid: false for a bundle claiming a permissionId that doesn't match on-chain state", async () => {
      const admin = await registerFreshIdentity(1);
      const adminToken = signJwtFor({
        did: admin.did,
        address: admin.wallet.address,
        role: "ADMIN",
      });
      const owner = await registerFreshIdentity(4);
      const reader = await registerFreshIdentity(4);
      const readerToken = signJwtFor({
        did: reader.did,
        address: reader.wallet.address,
        role: "USER",
      });

      const uploadResponse = await uploadSampleAsset({
        adminToken,
        ownerDID: owner.did,
      });
      const assetId = uploadResponse.body.assetId;

      await request(app)
        .post("/api/permissions")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          assetId,
          subjectDID: reader.did,
          action: "READ",
          state: "GRANTED",
        });

      const downloadResponse = await request(app)
        .get(`/api/assets/${assetId}/download`)
        .set("Authorization", `Bearer ${readerToken}`);

      const bundle = JSON.parse(
        Buffer.from(
          downloadResponse.headers["x-proof-bundle"],
          "base64"
        ).toString("utf8")
      );

      // This bundle is now internally inconsistent (signed content no
      // longer matches claimed content) — expect a signature mismatch
      // specifically, since signature verification runs before the
      // permissionId cross-check per verifyProofBundle's own ordering.
      bundle.permissionVersionUsed.permissionId += 9999;

      const verifyResponse = await request(app)
        .post("/api/proof-bundles/verify")
        .send(bundle);

      expect(verifyResponse.status).toBe(200);
      expect(verifyResponse.body.valid).toBe(false);
      expect(verifyResponse.body.reason).toBe("signature mismatch");
    });

    test("returns valid: false for a well-formed but entirely fabricated bundle (wrong signer)", async () => {
      // Not signed by this backend's actual BACKEND_SIGNING_PRIVATE_KEY
      // at all — a plausible-looking forgery.
      const fabricated = {
        assetId: 1,
        assetHash:
          "0x0000000000000000000000000000000000000000000000000000000000aa",
        accessedBy: "did:trustledger:someone",
        accessTimestamp: Math.floor(Date.now() / 1000),
        permissionVersionUsed: {
          permissionId: 1,
          state: "GRANTED",
          validFrom: 1,
          validUntil: 0,
        },
        onChainTxRef: "0xdeadbeef",
        signature: "0xnotarealsignature",
      };

      const verifyResponse = await request(app)
        .post("/api/proof-bundles/verify")
        .send(fabricated);

      expect(verifyResponse.status).toBe(200);
      expect(verifyResponse.body.valid).toBe(false);
    });

    test("returns 400 for a non-object request body", async () => {
      const response = await request(app)
        .post("/api/proof-bundles/verify")
        .send("just a string");

      expect(response.status).toBe(400);
    });
  });
});
