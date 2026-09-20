import { PrismaClient } from "@prisma/client";

/**
 * Data-access layer for the off-chain `users` table (display names only —
 * see DATA_MODEL.md section 1 and the comment on the User model in
 * schema.prisma: role/status/did are NOT authoritative here, they live
 * on-chain in IdentityRegistry. This table exists solely to hold what
 * must never be written to the chain.
 */

export interface CreateUserInput {
  did: string;
  displayName: string;
  email?: string;
}

export interface UserRecord {
  did: string;
  displayName: string;
  email: string | null;
  createdAt: Date;
}

export class UserRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateUserInput): Promise<UserRecord> {
    return this.prisma.user.create({
      data: {
        did: input.did,
        displayName: input.displayName,
        email: input.email,
      },
    });
  }

  async findByDid(did: string): Promise<UserRecord | null> {
    return this.prisma.user.findUnique({ where: { did } });
  }
}
