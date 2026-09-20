/// <reference types="jest" />

import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { ethers } from "ethers";
import { PrismaClient } from "@prisma/client";

import { createIdentitiesRouter } from "../identities";
import { UserRepository } from "../../repositories/user";
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

/**
 * Covers BACKEND_SPEC.md's MANDATORY test coverage requirement (see
 * "Authorization Trust Boundary" section): the backend must reject a
 * privileged write carrying a still-valid, unexpired JWT whose subject
 * was revoked AFTER the JWT was issued. This is a real route + real
 * chain test, deliberately not satisfied by authorizationService's own
 * unit tests (which mock getRole/isActive) or by AccessControl's
 * contract-level tests (which prove the CONTRACT's behavior, not this
 * backend's separate relay-path check) — see the doc's own explanation
 * of why those don't count as covering this.
 */
describe("POST /api/identities (integration, real chain)", () => {
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
    const userRepository = new UserRepository(prisma);

    app = express();
    app.use(express.json());
    app.use("/api/identities", createIdentitiesRouter(userRepository));
  });

  afterAll(async () => {
    _resetAccessControlServiceForTests();
    _resetIdentityRegistryServiceForTests();
    _resetConfigCacheForTests();
    if (provider) provider.destroy();
    if (prisma) await prisma.$disconnect();
  });

  /**
   * Registers a fresh identity on-chain directly (bypassing the route,
   * using the same relayer-connected contract the accessControlService
   * integration tests already use) so each test starts from a known,
   * real on-chain state rather than a mock.
   */
  async function registerFreshAdmin(): Promise<{
    wallet: ethers.HDNodeWallet;
    did: string;
  }> {
    const wallet = ethers.Wallet.createRandom();
    const did = `did:trustledger:identities-route-${wallet.address}`;

    const registerFn = identityRegistryWithRelayer.getFunction(
      "registerIdentity"
    );
    const tx = await registerFn(wallet.address, did, "0xbeef", 1); // 1 = ADMIN
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

  test("allows a currently-active ADMIN to register a new identity", async () => {
    const admin = await registerFreshAdmin();
    const token = signJwtFor({
      did: admin.did,
      address: admin.wallet.address,
      role: "ADMIN",
    });

    const newIdentityWallet = ethers.Wallet.createRandom();
    const newDid = `did:trustledger:new-${newIdentityWallet.address}`;

    const response = await request(app)
      .post("/api/identities")
      .set("Authorization", `Bearer ${token}`)
      .send({
        identityAddress: newIdentityWallet.address,
        did: newDid,
        publicKey: "0xcafe",
        role: "USER",
        displayName: "Test User",
      });

    expect(response.status).toBe(201);
    expect(response.body.did).toBe(newDid);
    expect(response.body.role).toBe("USER");
    expect(response.body.status).toBe("ACTIVE");
    expect(typeof response.body.txHash).toBe("string");

    const isActiveFn = identityRegistry.getFunction("isActive");
    expect(await isActiveFn(newIdentityWallet.address)).toBe(true);
  });

  /**
   * THE MANDATORY TEST: a JWT that was valid and unexpired at issuance,
   * for a subject who WAS an active ADMIN at that moment, must be
   * rejected once that subject is revoked — even though the JWT itself
   * has not expired and would still pass ordinary signature/expiry
   * checks. This proves the backend's own fresh on-chain check (not the
   * JWT's cached role) is the actual enforcement point, per
   * BACKEND_SPEC.md.
   */
  test("rejects a privileged write from a JWT whose subject was revoked after the JWT was issued", async () => {
    const admin = await registerFreshAdmin();
    const token = signJwtFor({
      did: admin.did,
      address: admin.wallet.address,
      role: "ADMIN",
    });

    // Revoke AFTER the JWT was issued. The token itself is untouched —
    // still validly signed, still unexpired.
    const revokeFn = identityRegistryWithRelayer.getFunction(
      "revokeIdentity"
    );
    const revokeTx = await revokeFn(admin.wallet.address);
    await revokeTx.wait();

    const isActiveFn = identityRegistry.getFunction("isActive");
    expect(await isActiveFn(admin.wallet.address)).toBe(false);

    const newIdentityWallet = ethers.Wallet.createRandom();

    const response = await request(app)
      .post("/api/identities")
      .set("Authorization", `Bearer ${token}`)
      .send({
        identityAddress: newIdentityWallet.address,
        did: `did:trustledger:should-not-register-${newIdentityWallet.address}`,
        publicKey: "0xcafe",
        role: "USER",
        displayName: "Should Not Register",
      });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("IDENTITY_REVOKED");

    // Confirm the write genuinely did not happen on-chain — not just
    // that the HTTP layer returned an error while the relay still fired.
    const resolveDIDFn = identityRegistry.getFunction("resolveDID");
    const resolved = await resolveDIDFn(
      `did:trustledger:should-not-register-${newIdentityWallet.address}`
    );
    expect(resolved).toBe(ethers.ZeroAddress);
  });

  test("rejects a non-ADMIN (currently-active USER) attempting to register an identity", async () => {
    const userWallet = ethers.Wallet.createRandom();
    const userDid = `did:trustledger:plain-user-${userWallet.address}`;

    const registerFn = identityRegistryWithRelayer.getFunction(
      "registerIdentity"
    );
    const tx = await registerFn(userWallet.address, userDid, "0xbeef", 4); // 4 = USER
    await tx.wait();

    // Deliberately claim ADMIN in the JWT's role claim — this must not
    // matter, since the route re-checks the CURRENT on-chain role, not
    // this claim.
    const token = signJwtFor({
      did: userDid,
      address: userWallet.address,
      role: "ADMIN",
    });

    const newIdentityWallet = ethers.Wallet.createRandom();

    const response = await request(app)
      .post("/api/identities")
      .set("Authorization", `Bearer ${token}`)
      .send({
        identityAddress: newIdentityWallet.address,
        did: `did:trustledger:blocked-${newIdentityWallet.address}`,
        publicKey: "0xcafe",
        role: "USER",
        displayName: "Blocked",
      });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("INSUFFICIENT_ROLE");
  });

  test("returns 401 with no Authorization header", async () => {
    const response = await request(app).post("/api/identities").send({});
    expect(response.status).toBe(401);
  });

  test("GET /api/identities/:did returns a registered identity without authentication", async () => {
    const admin = await registerFreshAdmin();

    const response = await request(app).get(
      `/api/identities/${encodeURIComponent(admin.did)}`
    );

    expect(response.status).toBe(200);
    expect(response.body.did).toBe(admin.did);
    expect(response.body.role).toBe("ADMIN");
    expect(response.body.status).toBe("ACTIVE");
  });

  test("GET /api/identities/:did returns 404 for an unknown DID", async () => {
    const response = await request(app).get(
      "/api/identities/did:trustledger:definitely-does-not-exist"
    );
    expect(response.status).toBe(404);
    expect(response.body.code).toBe("IDENTITY_NOT_FOUND");
  });
});
