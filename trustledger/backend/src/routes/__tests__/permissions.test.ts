/// <reference types="jest" />

import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

// Mock services before importing router
jest.mock("../../services/accessControlService");
jest.mock("../../services/authorizationService");

import { createPermissionsRouter } from "../permissions";
import * as accessControlService from "../../services/accessControlService";
import { authorizationService } from "../../services/authorizationService";
import { getConfig, _resetConfigCacheForTests } from "../../config";

describe("permissions router (unit tests)", () => {
  let app: express.Express;
  const dummySigningKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  beforeAll(() => {
    process.env.BACKEND_SIGNING_PRIVATE_KEY = dummySigningKey;
    process.env.JWT_SECRET = dummySigningKey;
    _resetConfigCacheForTests();

    app = express();
    app.use(express.json());
    app.use("/api/permissions", createPermissionsRouter());
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  function createToken(role = "ADMIN", address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266") {
    return jwt.sign(
      {
        did: `did:trustledger:${address}`,
        address,
        role,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 900,
      },
      dummySigningKey,
      { algorithm: "HS256" }
    );
  }

  describe("POST /api/permissions/request", () => {
    test("rejects unauthenticated request with 401", async () => {
      const res = await request(app)
        .post("/api/permissions/request")
        .send({
          assetId: 10,
          subjectDID: "did:trustledger:0x123",
          action: "READ",
        });

      expect(res.status).toBe(401);
    });

    test("rejects invalid request body with 400", async () => {
      const token = createToken("ADMIN");
      const res = await request(app)
        .post("/api/permissions/request")
        .set("Authorization", `Bearer ${token}`)
        .send({
          assetId: -5, // Invalid negative integer
          subjectDID: "",
          action: "FLY", // Invalid action
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("INVALID_REQUEST");
    });

    test("successfully creates dual-custody request for CONFIDENTIAL asset", async () => {
      const token = createToken("ADMIN");
      (authorizationService.requireCurrentRole as jest.Mock).mockResolvedValueOnce(undefined);
      (accessControlService.requestPermissionAndDecode as jest.Mock).mockResolvedValueOnce({
        isDualCustody: true,
        requestId: 42n,
        assetId: 10n,
        subjectDID: "did:trustledger:0x456",
        action: "READ",
        requestedState: "GRANTED",
        requester: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        expiresAt: 1735689600n,
        txHash: "0xabc123",
      });

      const res = await request(app)
        .post("/api/permissions/request")
        .set("Authorization", `Bearer ${token}`)
        .send({
          assetId: 10,
          subjectDID: "did:trustledger:0x456",
          action: "READ",
          state: "GRANTED",
        });

      expect(res.status).toBe(201);
      expect(res.body.isDualCustody).toBe(true);
      expect(res.body.requestId).toBe(42);
      expect(res.body.assetId).toBe(10);
      expect(res.body.expiresAt).toBe(1735689600);
      expect(res.body.txHash).toBe("0xabc123");
    });

    test("returns single-sig result for PUBLIC asset", async () => {
      const token = createToken("MANAGER");
      (authorizationService.requireCurrentRole as jest.Mock).mockResolvedValueOnce(undefined);
      (accessControlService.requestPermissionAndDecode as jest.Mock).mockResolvedValueOnce({
        isDualCustody: false,
        permissionId: 88n,
        validFrom: 1735600000n,
        txHash: "0xdef456",
      });

      const res = await request(app)
        .post("/api/permissions/request")
        .set("Authorization", `Bearer ${token}`)
        .send({
          assetId: 5,
          subjectDID: "did:trustledger:0x789",
          action: "WRITE",
          state: "GRANTED",
        });

      expect(res.status).toBe(201);
      expect(res.body.isDualCustody).toBe(false);
      expect(res.body.permissionId).toBe(88);
      expect(res.body.validFrom).toBe(1735600000);
    });

    test("handles revoked identity with 403", async () => {
      const token = createToken("ADMIN");
      (authorizationService.requireCurrentRole as jest.Mock).mockRejectedValueOnce({
        code: "IDENTITY_REVOKED",
      });

      const res = await request(app)
        .post("/api/permissions/request")
        .set("Authorization", `Bearer ${token}`)
        .send({
          assetId: 1,
          subjectDID: "did:trustledger:0x123",
          action: "READ",
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("IDENTITY_REVOKED");
    });
  });

  describe("POST /api/permissions/:requestId/approve", () => {
    test("rejects server-side approval with DIRECT_WALLET_SIGNING_REQUIRED", async () => {
      const token = createToken("MANAGER", "0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
      (authorizationService.requireCurrentRole as jest.Mock).mockResolvedValueOnce(undefined);
      (accessControlService.getPermissionRequest as jest.Mock).mockResolvedValueOnce({
        requestId: 42n,
        requester: "0x1111111111111111111111111111111111111111",
      });

      const res = await request(app)
        .post("/api/permissions/42/approve")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("DIRECT_WALLET_SIGNING_REQUIRED");
    });

    test("catches dual-custody self-approval violation with code DUAL_CUSTODY_SELF_APPROVAL_VIOLATION", async () => {
      const token = createToken("ADMIN", "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
      (authorizationService.requireCurrentRole as jest.Mock).mockResolvedValueOnce(undefined);
      (accessControlService.getPermissionRequest as jest.Mock).mockResolvedValueOnce({
        requestId: 42n,
        requester: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      });

      const res = await request(app)
        .post("/api/permissions/42/approve")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("DUAL_CUSTODY_SELF_APPROVAL_VIOLATION");
    });

    test("catches expired request with code REQUEST_EXPIRED", async () => {
      const token = createToken("ADMIN", "0x2222222222222222222222222222222222222222");
      (authorizationService.requireCurrentRole as jest.Mock).mockResolvedValueOnce(undefined);
      (accessControlService.getPermissionRequest as jest.Mock).mockResolvedValueOnce({
        requestId: 42n,
        requester: "0x1111111111111111111111111111111111111111",
        expiresAt: 1000n,
      });

      const res = await request(app)
        .post("/api/permissions/requests/42/approve")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("REQUEST_EXPIRED");
    });
  });

  describe("POST /api/permissions/:requestId/cancel", () => {
    test("cancels request successfully", async () => {
      const token = createToken("ADMIN");
      (authorizationService.requireCurrentRole as jest.Mock).mockResolvedValueOnce(undefined);
      (accessControlService.cancelPermissionRequestAndDecode as jest.Mock).mockResolvedValueOnce({
        requestId: 42n,
        cancelledBy: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        txHash: "0xcancelTx",
      });

      const res = await request(app)
        .post("/api/permissions/42/cancel")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.requestId).toBe(42);
      expect(res.body.cancelledBy).toBe("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
      expect(res.body.txHash).toBe("0xcancelTx");
    });

    test("handles non-requester/non-admin cancellation rejection", async () => {
      const token = createToken("MANAGER");
      (authorizationService.requireCurrentRole as jest.Mock).mockResolvedValueOnce(undefined);
      (accessControlService.cancelPermissionRequestAndDecode as jest.Mock).mockRejectedValueOnce(
        new Error("execution reverted: AccessControl: only requester or ADMIN can cancel")
      );

      const res = await request(app)
        .post("/api/permissions/requests/42/cancel")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("INSUFFICIENT_ROLE");
    });
  });

  describe("GET /api/permissions/requests", () => {
    test("lists requests with computed lifecycle status", async () => {
      const token = createToken("ADMIN");
      (accessControlService.getPermissionRequests as jest.Mock).mockResolvedValueOnce([
        {
          requestId: 1n,
          assetId: 10n,
          subjectDID: "did:trustledger:0x111",
          action: "READ",
          requestedState: "GRANTED",
          requester: "0x222",
          requestedAt: 1735600000n,
          expiresAt: 1735686400n,
          approved: false,
          cancelled: false,
          status: "PENDING",
        },
      ]);

      const res = await request(app)
        .get("/api/permissions/requests")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.requests).toHaveLength(1);
      expect(res.body.requests[0].requestId).toBe(1);
      expect(res.body.requests[0].status).toBe("PENDING");
    });
  });

  describe("GET /api/permissions/requests/:requestId", () => {
    test("returns single request", async () => {
      const token = createToken("ADMIN");
      (accessControlService.getPermissionRequest as jest.Mock).mockResolvedValueOnce({
        requestId: 5n,
        assetId: 20n,
        subjectDID: "did:trustledger:0x333",
        action: "WRITE",
        requestedState: "GRANTED",
        requester: "0x444",
        requestedAt: 1735600000n,
        expiresAt: 1735686400n,
        approved: true,
        cancelled: false,
        status: "APPROVED",
      });

      const res = await request(app)
        .get("/api/permissions/requests/5")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.requestId).toBe(5);
      expect(res.body.status).toBe("APPROVED");
    });

    test("returns 404 for non-existent request", async () => {
      const token = createToken("ADMIN");
      (accessControlService.getPermissionRequest as jest.Mock).mockRejectedValueOnce(
        new Error("execution reverted: AccessControl: request does not exist")
      );

      const res = await request(app)
        .get("/api/permissions/requests/999")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe("REQUEST_NOT_FOUND");
    });
  });
});
