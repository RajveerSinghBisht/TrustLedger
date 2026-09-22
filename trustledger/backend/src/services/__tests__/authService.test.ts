import { Wallet } from "ethers";
import { _resetConfigCacheForTests } from "../../config";
import { AuthChallengeRepository } from "../../repositories/authChallenge";
import { createAuthService, buildCanonicalAuthMessage, CHALLENGE_TTL_MS, JWT_TTL_SECONDS } from "../authService";

jest.mock("../../services/identityRegistryService", () => ({
  resolveDID: jest.fn(),
  isActive: jest.fn(),
  getRole: jest.fn(),
}));

import { resolveDID, isActive, getRole } from "../identityRegistryService";

const VALID_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const wallet = new Wallet(VALID_PRIVATE_KEY);
const DID = `did:trustledger:${wallet.address}`;
const NOW = new Date("2026-09-18T15:00:00.000Z");

function setValidEnv() {
  process.env.HARDHAT_RPC_URL = "http://127.0.0.1:8545";
  process.env.IDENTITY_REGISTRY_ADDRESS = wallet.address;
  process.env.ACCESS_CONTROL_ADDRESS = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
  process.env.ASSET_REGISTRY_ADDRESS = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0";
  process.env.RELAYER_PRIVATE_KEY = VALID_PRIVATE_KEY;
  process.env.BACKEND_SIGNING_PRIVATE_KEY = "backend-test-signing-secret";
  process.env.DOCUMENT_MASTER_KEY = "master-key";
  process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
  process.env.PORT = "3000";
  process.env.AUTH_DOMAIN = "trustledger.local";
}

function mockRepository() {
  return {
    create: jest.fn(),
    findByNonce: jest.fn(),
    consumeIfUnconsumed: jest.fn(),
    deleteExpired: jest.fn(),
  } as unknown as jest.Mocked<AuthChallengeRepository>;
}

describe("authService", () => {
  beforeEach(() => {
    setValidEnv();
    _resetConfigCacheForTests();
    jest.clearAllMocks();
    (resolveDID as jest.Mock).mockResolvedValue(wallet.address);
    (isActive as jest.Mock).mockResolvedValue(true);
    (getRole as jest.Mock).mockResolvedValue(4);
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it("creates a domain-separated 5-minute challenge bound to the resolved address", async () => {
    const repo = mockRepository();
    const service = createAuthService({ challengeRepository: repo, now: () => NOW });

    const result = await service.createChallenge(DID);

    expect(result.expiresAt).toBe(new Date(NOW.getTime() + CHALLENGE_TTL_MS).toISOString());
    expect(result.message).toContain("PRAMAAN Authentication Request");
    expect(result.message).toContain("Domain: trustledger.local");
    expect(result.message).toContain(`DID: ${DID}`);
    expect(result.message).toContain("Purpose: Authenticate to PRAMAAN backend");
    expect(result.message).toMatch(/\nNonce: [0-9a-f]{32}\n/);
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({
      did: DID,
      expectedAddress: wallet.address,
      issuedAt: NOW,
      expiresAt: new Date(NOW.getTime() + CHALLENGE_TTL_MS),
      nonce: expect.stringMatching(/^[0-9a-f]{32}$/),
    }));
  });

  it("rejects an unknown DID before creating a challenge", async () => {
    const repo = mockRepository();
    const service = createAuthService({ challengeRepository: repo, now: () => NOW });
    (resolveDID as jest.Mock).mockResolvedValue("0x0000000000000000000000000000000000000000");
    await expect(service.createChallenge(DID)).rejects.toMatchObject({ code: "DID_NOT_FOUND" });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("verifies the exact canonical message, recovered address, active status, consumes first, then issues a 15-minute JWT", async () => {
    const repo = mockRepository();
    const issuedAt = NOW;
    const expiresAt = new Date(NOW.getTime() + CHALLENGE_TTL_MS);
    const nonce = "0123456789abcdef0123456789abcdef";
    const message = buildCanonicalAuthMessage(DID, nonce, issuedAt, expiresAt, "trustledger.local");
    const signature = await wallet.signMessage(message);
    const challenge = {
      id: 1,
      nonce,
      did: DID,
      expectedAddress: wallet.address,
      issuedAt,
      expiresAt,
      consumed: false,
    };
    repo.findByNonce.mockResolvedValue(challenge);
    const order: string[] = [];
    repo.consumeIfUnconsumed.mockImplementation(async () => { order.push("consume"); });
    (getRole as jest.Mock).mockImplementation(async () => { order.push("role"); return 4; });

    const service = createAuthService({ challengeRepository: repo, now: () => NOW });
    const result = await service.verify({ did: DID, message, signature });
    order.push("returned");

    expect(order).toEqual(["role", "consume", "returned"]);
    expect(result.token).toEqual(expect.any(String));
    const decoded = JSON.parse(Buffer.from(result.token.split(".")[1], "base64url").toString("utf8"));
    expect(decoded.did).toBe(DID);
    expect(decoded.address).toBe(wallet.address);
    expect(decoded.role).toBe("USER");
    expect(decoded.exp - decoded.iat).toBe(JWT_TTL_SECONDS);
    expect(result.expiresAt).toBe(new Date((decoded.exp) * 1000).toISOString());
  });

  it("rejects message tampering before signature recovery", async () => {
    const repo = mockRepository();
    const issuedAt = NOW;
    const expiresAt = new Date(NOW.getTime() + CHALLENGE_TTL_MS);
    const nonce = "0123456789abcdef0123456789abcdef";
    const original = buildCanonicalAuthMessage(DID, nonce, issuedAt, expiresAt, "trustledger.local");
    const signature = await wallet.signMessage(original);
    repo.findByNonce.mockResolvedValue({ id: 1, nonce, did: DID, expectedAddress: wallet.address, issuedAt, expiresAt, consumed: false });

    const service = createAuthService({ challengeRepository: repo, now: () => NOW });
    await expect(service.verify({ did: DID, message: original.replace("Purpose: Authenticate", "Purpose: Tampered"), signature }))
      .rejects.toMatchObject({ code: "AUTHENTICATION_FAILED" });
    expect(repo.consumeIfUnconsumed).not.toHaveBeenCalled();
  });

  it("rejects an expired, consumed, wrong-DID, or wrong-signer challenge", async () => {
    const repo = mockRepository();
    const issuedAt = new Date(NOW.getTime() - CHALLENGE_TTL_MS - 1);
    const expiresAt = new Date(NOW.getTime() - 1);
    const nonce = "0123456789abcdef0123456789abcdef";
    const message = buildCanonicalAuthMessage(DID, nonce, issuedAt, expiresAt, "trustledger.local");
    const signature = await wallet.signMessage(message);
    const service = createAuthService({ challengeRepository: repo, now: () => NOW });

    repo.findByNonce.mockResolvedValue({ id: 1, nonce, did: DID, expectedAddress: wallet.address, issuedAt, expiresAt, consumed: false });
    await expect(service.verify({ did: DID, message, signature })).rejects.toMatchObject({ code: "AUTHENTICATION_FAILED" });

    repo.findByNonce.mockResolvedValue({ id: 1, nonce, did: DID, expectedAddress: wallet.address, issuedAt: NOW, expiresAt: new Date(NOW.getTime() + CHALLENGE_TTL_MS), consumed: true });
    await expect(service.verify({ did: DID, message: buildCanonicalAuthMessage(DID, nonce, NOW, new Date(NOW.getTime() + CHALLENGE_TTL_MS), "trustledger.local"), signature })).rejects.toMatchObject({ code: "AUTHENTICATION_FAILED" });

    const freshExpires = new Date(NOW.getTime() + CHALLENGE_TTL_MS);
    const freshMessage = buildCanonicalAuthMessage(DID, nonce, NOW, freshExpires, "trustledger.local");
    repo.findByNonce.mockResolvedValue({ id: 1, nonce, did: DID, expectedAddress: wallet.address, issuedAt: NOW, expiresAt: freshExpires, consumed: false });
    await expect(service.verify({ did: "did:trustledger:other", message: freshMessage, signature })).rejects.toMatchObject({ code: "AUTHENTICATION_FAILED" });

    const otherWallet = Wallet.createRandom();
    repo.findByNonce.mockResolvedValue({ id: 1, nonce, did: DID, expectedAddress: wallet.address, issuedAt: NOW, expiresAt: freshExpires, consumed: false });
    await expect(service.verify({ did: DID, message: freshMessage, signature: await otherWallet.signMessage(freshMessage) })).rejects.toMatchObject({ code: "AUTHENTICATION_FAILED" });
    expect(repo.consumeIfUnconsumed).not.toHaveBeenCalled();
  });
});
