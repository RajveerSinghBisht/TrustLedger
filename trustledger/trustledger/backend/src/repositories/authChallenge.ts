import { PrismaClient } from "@prisma/client";

/**
 * Data-access layer for authentication challenges (see BACKEND_SPEC.md
 * Authentication section). Isolated here, separate from route handlers,
 * so the atomic-consumption logic has one home and one set of tests.
 */

export interface CreateChallengeInput {
  nonce: string;
  did: string;
  expectedAddress: string;
  issuedAt: Date;
  expiresAt: Date;
}

export interface ChallengeRecord {
  id: number;
  nonce: string;
  did: string;
  expectedAddress: string;
  issuedAt: Date;
  expiresAt: Date;
  consumed: boolean;
}

export class ChallengeAlreadyConsumedOrMissingError extends Error {
  constructor(nonce: string) {
    super(
      `Challenge with nonce ${nonce} was already consumed, does not ` +
        `exist, or was concurrently consumed by another request.`
    );
    this.name = "ChallengeAlreadyConsumedOrMissingError";
  }
}

export class AuthChallengeRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateChallengeInput): Promise<ChallengeRecord> {
    return this.prisma.authChallenge.create({ data: input });
  }

  async findByNonce(nonce: string): Promise<ChallengeRecord | null> {
    return this.prisma.authChallenge.findUnique({ where: { nonce } });
  }

  /**
   * Atomically marks a challenge as consumed, IF AND ONLY IF it is
   * currently unconsumed. This is the mechanism that prevents two
   * concurrent /verify requests from both successfully consuming the
   * same challenge.
   *
   * CRITICAL implementation detail: this uses updateMany with `consumed:
   * false` as part of the WHERE clause, not a plain update(). Prisma's
   * update() only accepts unique fields in its where clause and would
   * succeed unconditionally as long as the row exists by id/nonce —  it
   * does NOT let you condition the update on the CURRENT value of the
   * field you're changing, so it cannot detect or prevent a race.
   * updateMany's affected-row count is what lets us distinguish "I won
   * the race and actually flipped consumed: false -> true" from
   * "someone else already consumed this, or it never existed."
   *
   * If two requests call this simultaneously for the same nonce, the
   * database's own row-level locking during the UPDATE ensures only one
   * of them can match `consumed: false` and actually update the row —
   * the second one's WHERE clause no longer matches (consumed is now
   * true), so its affected count is 0, and it throws.
   *
   * @throws ChallengeAlreadyConsumedOrMissingError if the challenge does
   *   not exist, or was already consumed (by this call or a concurrent
   *   one that won the race).
   */
  async consumeIfUnconsumed(nonce: string): Promise<void> {
    const result = await this.prisma.authChallenge.updateMany({
      where: { nonce, consumed: false },
      data: { consumed: true },
    });

    if (result.count === 0) {
      throw new ChallengeAlreadyConsumedOrMissingError(nonce);
    }
  }

  /**
   * Deletes expired challenge records. Not called automatically anywhere
   * yet — intended to be invoked by a periodic cleanup job (e.g. a cron
   * task or a startup sweep). Not wiring this into anything yet; this
   * method existing is sufficient for now, per the MVP scope.
   */
  async deleteExpired(now: Date = new Date()): Promise<number> {
    const result = await this.prisma.authChallenge.deleteMany({
      where: { expiresAt: { lt: now } },
    });
    return result.count;
  }
}
