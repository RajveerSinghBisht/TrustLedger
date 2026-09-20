import { PrismaClient } from "@prisma/client";

/**
 * Data-access layer for the off-chain `audit_log` table. Per
 * schema.prisma's own comment on this model and DATA_MODEL.md section 5/
 * section 12.2: on-chain events remain the source of truth for anything
 * disputed — this table is a queryable convenience index, not the
 * authoritative record. This repository does not attempt to reconcile
 * or verify against on-chain events; it just writes what it's told.
 */

export interface CreateAuditLogInput {
  eventType: string;
  actorDid: string;
  assetId?: bigint;
  txHash?: string;
  details?: unknown;
}

export class AuditLogRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateAuditLogInput): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        eventType: input.eventType,
        actorDid: input.actorDid,
        assetId: input.assetId,
        txHash: input.txHash,
        details: input.details as any,
      },
    });
  }
}
