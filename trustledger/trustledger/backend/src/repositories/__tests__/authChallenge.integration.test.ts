import { PrismaClient } from "@prisma/client";
import {
  AuthChallengeRepository,
  ChallengeAlreadyConsumedOrMissingError,
} from "../authChallenge";

/**
 * These are INTEGRATION tests — they require a real Postgres instance
 * reachable via DATABASE_URL (see backend/docker-compose.yml: run
 * `docker compose up -d` and `npx prisma migrate dev` before running
 * this file). They are not mocked, deliberately: the entire point of
 * the atomic-consumption test below is to prove real database-level
 * row locking prevents a double-consume race — a mock would only prove
 * the mock's own behavior, not the database's.
 */

const prisma = new PrismaClient();
const repo = new AuthChallengeRepository(prisma);

function makeChallengeInput(nonceSuffix: string) {
  const now = new Date();
  return {
    nonce: `test-nonce-${nonceSuffix}-${Date.now()}-${Math.random()}`,
    did: "did:trustledger:0xTestAddress",
    expectedAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    issuedAt: now,
    expiresAt: new Date(now.getTime() + 5 * 60 * 1000),
  };
}

describe("AuthChallengeRepository (integration)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates and finds a challenge by nonce", async () => {
    const input = makeChallengeInput("create-find");
    await repo.create(input);

    const found = await repo.findByNonce(input.nonce);

    expect(found).not.toBeNull();
    expect(found?.did).toBe(input.did);
    expect(found?.expectedAddress).toBe(input.expectedAddress);
    expect(found?.consumed).toBe(false);
  });

  it("returns null for a nonce that was never created", async () => {
    const found = await repo.findByNonce("nonexistent-nonce-xyz");
    expect(found).toBeNull();
  });

  it("successfully consumes an unconsumed challenge exactly once", async () => {
    const input = makeChallengeInput("single-consume");
    await repo.create(input);

    await expect(repo.consumeIfUnconsumed(input.nonce)).resolves.not.toThrow();

    const after = await repo.findByNonce(input.nonce);
    expect(after?.consumed).toBe(true);
  });

  it("throws when attempting to consume an already-consumed challenge", async () => {
    const input = makeChallengeInput("double-consume-sequential");
    await repo.create(input);

    await repo.consumeIfUnconsumed(input.nonce);

    await expect(repo.consumeIfUnconsumed(input.nonce)).rejects.toThrow(
      ChallengeAlreadyConsumedOrMissingError
    );
  });

  it("throws when attempting to consume a nonce that was never created", async () => {
    await expect(
      repo.consumeIfUnconsumed("never-existed-nonce-abc")
    ).rejects.toThrow(ChallengeAlreadyConsumedOrMissingError);
  });

  it("CRITICAL: under real concurrent consumption attempts, exactly ONE succeeds and the rest fail", async () => {
    const input = makeChallengeInput("concurrent-race");
    await repo.create(input);

    // Fire 10 concurrent consumption attempts for the SAME nonce. This is
    // the actual test of the atomic updateMany-with-count-check pattern —
    // without it (e.g. if this used a naive findUnique-then-update
    // pattern), multiple of these could succeed.
    const attempts = Array.from({ length: 10 }, () =>
      repo.consumeIfUnconsumed(input.nonce).then(
        () => "succeeded" as const,
        () => "failed" as const
      )
    );

    const results = await Promise.all(attempts);

    const succeeded = results.filter((r) => r === "succeeded").length;
    const failed = results.filter((r) => r === "failed").length;

    expect(succeeded).toBe(1);
    expect(failed).toBe(9);

    // Confirm the final state is consistent: consumed exactly once, not
    // left in some ambiguous state.
    const final = await repo.findByNonce(input.nonce);
    expect(final?.consumed).toBe(true);
  });

  it("deleteExpired removes only expired challenges, leaves valid ones intact", async () => {
    const now = new Date();

    const expiredInput = {
      ...makeChallengeInput("expired"),
      expiresAt: new Date(now.getTime() - 60 * 1000), // 1 minute ago
    };
    const validInput = makeChallengeInput("still-valid");

    await repo.create(expiredInput);
    await repo.create(validInput);

    const deletedCount = await repo.deleteExpired(now);

    expect(deletedCount).toBeGreaterThanOrEqual(1);

    const expiredStillThere = await repo.findByNonce(expiredInput.nonce);
    const validStillThere = await repo.findByNonce(validInput.nonce);

    expect(expiredStillThere).toBeNull();
    expect(validStillThere).not.toBeNull();
  });
});
