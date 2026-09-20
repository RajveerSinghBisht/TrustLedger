import express, { type Request, type Response } from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { describe, expect, test } from "@jest/globals";

import { getConfig } from "../../config";
import {
  authenticateJWT,
  type AuthenticatedRequest,
} from "../authenticateJWT";

function createTestApp() {
  const app = express();

  app.get(
    "/protected",
    authenticateJWT,
    (req: Request, res: Response) => {
      const authenticatedRequest = req as AuthenticatedRequest;

      return res.status(200).json(authenticatedRequest.auth);
    }
  );

  return app;
}

function createToken(
  overrides: Record<string, unknown> = {}
): string {
  const config = getConfig();
  const now = Math.floor(Date.now() / 1000);

  return jwt.sign(
    {
      did: "did:trustledger:0x123",
      address: "0x1234567890123456789012345678901234567890",
      role: "USER",
      iat: now,
      exp: now + 900,
      ...overrides,
    },
    config.backendSigningPrivateKey,
    {
      algorithm: "HS256",
    }
  );
}

describe("authenticateJWT", () => {
  const app = createTestApp();

  test("rejects a request without Authorization header", async () => {
    const response = await request(app).get("/protected");

    expect(response.status).toBe(401);
    expect(response.body.code).toBe("AUTHENTICATION_REQUIRED");
  });

  test("rejects a malformed Authorization header", async () => {
    const response = await request(app)
      .get("/protected")
      .set("Authorization", "Basic abc123");

    expect(response.status).toBe(401);
    expect(response.body.code).toBe("AUTHENTICATION_REQUIRED");
  });

  test("rejects an invalid JWT", async () => {
    const response = await request(app)
      .get("/protected")
      .set("Authorization", "Bearer this-is-not-a-jwt");

    expect(response.status).toBe(401);
    expect(response.body.code).toBe("AUTHENTICATION_REQUIRED");
  });

  test("rejects an expired JWT", async () => {
    const now = Math.floor(Date.now() / 1000);

    const token = createToken({
      iat: now - 1000,
      exp: now - 100,
    });

    const response = await request(app)
      .get("/protected")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(401);
    expect(response.body.code).toBe("AUTHENTICATION_REQUIRED");
  });

  test("rejects a token signed with the wrong secret", async () => {
    const now = Math.floor(Date.now() / 1000);

    const token = jwt.sign(
      {
        did: "did:trustledger:0x123",
        address: "0x1234567890123456789012345678901234567890",
        role: "USER",
        iat: now,
        exp: now + 900,
      },
      "wrong-secret",
      {
        algorithm: "HS256",
      }
    );

    const response = await request(app)
      .get("/protected")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(401);
    expect(response.body.code).toBe("AUTHENTICATION_REQUIRED");
  });

  test("rejects a token with an unsupported role", async () => {
    const token = createToken({
      role: "NONE",
    });

    const response = await request(app)
      .get("/protected")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(401);
    expect(response.body.code).toBe("AUTHENTICATION_REQUIRED");
  });

  test("rejects a token missing the DID claim", async () => {
    const token = createToken({
      did: undefined,
    });

    const response = await request(app)
      .get("/protected")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(401);
    expect(response.body.code).toBe("AUTHENTICATION_REQUIRED");
  });

  test("rejects a token missing the address claim", async () => {
    const token = createToken({
      address: undefined,
    });

    const response = await request(app)
      .get("/protected")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(401);
    expect(response.body.code).toBe("AUTHENTICATION_REQUIRED");
  });

  test("accepts a valid JWT and exposes verified claims on req.auth", async () => {
    const token = createToken();

    const response = await request(app)
      .get("/protected")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);

    expect(response.body.did).toBe(
      "did:trustledger:0x123"
    );

    expect(response.body.address).toBe(
      "0x1234567890123456789012345678901234567890"
    );

    expect(response.body.role).toBe("USER");

    expect(typeof response.body.iat).toBe("number");
    expect(typeof response.body.exp).toBe("number");
    expect(response.body.exp - response.body.iat).toBe(900);
  });

  test("accepts each canonical JWT role", async () => {
    const roles = [
      "ADMIN",
      "MANAGER",
      "AUDITOR",
      "USER",
    ] as const;

    for (const role of roles) {
      const token = createToken({ role });

      const response = await request(app)
        .get("/protected")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.role).toBe(role);
    }
  });
});