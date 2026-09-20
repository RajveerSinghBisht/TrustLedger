import { PrismaClient } from "@prisma/client";

/**
 * Data-access layer for the off-chain `encrypted_records` table — the
 * actual encrypted file bytes and key-wrapping material (see
 * documentEncryption.ts for what wraps/unwraps this data; this
 * repository never encrypts/decrypts anything itself, only persists and
 * retrieves already-processed bytes).
 */

export interface CreateEncryptedRecordInput {
  metadataUri: string;
  assetId: bigint;
  encryptedBlob: Buffer;
  iv: Buffer;
  authTag: Buffer;
  wrappedDataKey: Buffer;
  originalFilename?: string;
  mimeType?: string;
}

export interface EncryptedRecordData {
  metadataUri: string;
  assetId: bigint;
  encryptedBlob: Buffer;
  iv: Buffer;
  authTag: Buffer;
  wrappedDataKey: Buffer;
  originalFilename: string | null;
  mimeType: string | null;
}

export class EncryptedRecordRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    input: CreateEncryptedRecordInput
  ): Promise<EncryptedRecordData> {
    return this.prisma.encryptedRecord.create({
      data: {
        metadataUri: input.metadataUri,
        assetId: input.assetId,
        encryptedBlob: input.encryptedBlob,
        iv: input.iv,
        authTag: input.authTag,
        wrappedDataKey: input.wrappedDataKey,
        originalFilename: input.originalFilename,
        mimeType: input.mimeType,
      },
    });
  }

  async findByMetadataUri(
    metadataUri: string
  ): Promise<EncryptedRecordData | null> {
    return this.prisma.encryptedRecord.findUnique({
      where: { metadataUri },
    });
  }
}
