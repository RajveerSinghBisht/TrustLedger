import { Router, Request, Response } from "express";
import multer from "multer";
import { createHash, randomUUID } from "crypto";
import { ethers } from "ethers";
import { getConfig } from "../config";
import { authenticateJWT, AuthenticatedRequest } from "../middleware/authenticateJWT";
import { EncryptedRecordRepository } from "../repositories/encryptedRecord";
import { AuditLogRepository } from "../repositories/auditLog";
import {
  registerAssetAndDecode,
  getAsset,
  AssetClassification,
} from "../services/assetRegistryService";
import { checkPermissionNow, checkPermissionAtTime, recordAccess } from "../services/accessControlService";
import { encryptDocument, decryptDocument } from "../services/documentEncryption";
import { generateProofBundle } from "../services/proofBundle";
import { authorizationService } from "../services/authorizationService";
import { authenticatedWriteLimiter, publicReadLimiter } from "../middleware/rateLimiter";
import {
  validateParams,
  assetIdParamSchema,
  sanitizeFilename,
} from "../middleware/inputValidation";

// OWASP: limit file upload size to 50MB to prevent large-payload DoS.
// This is enforced at the multer level, before file bytes are buffered
// in memory.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB
  },
});

const VALID_CLASSIFICATIONS = new Set(["PUBLIC", "INTERNAL", "CONFIDENTIAL"]);

function isValidClassification(
  value: unknown
): value is AssetClassification {
  return typeof value === "string" && VALID_CLASSIFICATIONS.has(value);
}

/**
 * Same reasoning/limits as identities.ts and permissions.ts's
 * bigintToNumber — every bigint surfaced here (assetId, permission
 * fields, timestamps) is a small integer or a block timestamp in
 * practice, comfortably within Number.MAX_SAFE_INTEGER. Not safe for an
 * arbitrary uint256.
 */
function bigintToNumber(value: bigint): number {
  return Number(value);
}

export function createAssetsRouter(
  encryptedRecordRepository: EncryptedRecordRepository,
  auditLogRepository: AuditLogRepository
) {
  const router = Router();

  /**
   * POST /api/assets — registers a new asset (on-chain metadata) and
   * stores the encrypted file bytes off-chain.
   *
   * PRIVILEGED WRITE per BACKEND_SPEC.md's Authorization Trust Boundary
   * — mandatory fresh on-chain re-check, same pattern as identities.ts
   * and permissions.ts. NARROWER than Permissions: AssetRegistry.sol's
   * registerAsset is ADMIN-only (onlyActiveAdmin modifier — confirmed by
   * reading the contract source directly), not ADMIN-or-MANAGER. Do not
   * widen this to MANAGER without first changing the contract; the
   * contract's own modifier would reject a MANAGER-relayed call anyway,
   * so widening the check here alone would just produce a confusing
   * REGISTRATION_FAILED response instead of the correct 403.
   *
   * Processing order matters here and is deliberate:
   *   1. Auth check (fail fast, no file processing wasted on a
   *      request that was never going to be allowed)
   *   2. Validate multipart body present
   *   3. Compute assetHash = SHA-256 of the ORIGINAL, unencrypted bytes
   *      (per DATA_MODEL.md: "SHA-256 of the original (unencrypted)
   *      file" — hashing the ciphertext instead would be wrong, since
   *      the whole point is a verifiable link to the actual document
   *      content, and re-encrypting later would need to reproduce the
   *      same hash)
   *   4. Encrypt the file (documentEncryption.ts)
   *   5. Register on-chain FIRST, using a metadataURI computed before
   *      any Postgres write — if the on-chain call fails/reverts, no
   *      Postgres row is created for an asset that doesn't actually
   *      exist, same reasoning as identities.ts's ordering
   *   6. Only after the on-chain write succeeds, persist the encrypted
   *      blob to Postgres keyed by that same metadataURI
   */
  router.post(
    "/",
    authenticateJWT,
    // OWASP: user-based rate limiter keyed on JWT did
    authenticatedWriteLimiter,
    upload.single("file"),
    async (req: Request, res: Response) => {
      const authedReq = req as AuthenticatedRequest;

      try {
        await authorizationService.requireCurrentRole(
          authedReq.auth.address,
          ["ADMIN"]
        );
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === "IDENTITY_REVOKED" || code === "INSUFFICIENT_ROLE") {
          return res.status(403).json({
            error: "Not authorized to register assets",
            code,
          });
        }
        return res.status(500).json({
          error: "Internal server error",
          code: "INTERNAL_ERROR",
        });
      }

      const file = (req as Request & { file?: Express.Multer.File }).file;
      const body = req.body ?? {};

      // OWASP: validate multipart body fields. Note: for multipart form
      // data, Zod's .strict() doesn't apply because multer parses form
      // fields into req.body as strings. Validation is done inline here.
      if (
        !file ||
        typeof body.ownerDID !== "string" ||
        !body.ownerDID.trim() ||
        body.ownerDID.length > 256 ||
        !isValidClassification(body.classification)
      ) {
        return res.status(400).json({
          error:
            "A file upload plus ownerDID (max 256 chars) and classification (PUBLIC|INTERNAL|CONFIDENTIAL) are required",
          code: "INVALID_REQUEST",
        });
      }

      const assetHash =
        "0x" + createHash("sha256").update(file.buffer).digest("hex");
      const metadataURI = `local://records/${randomUUID()}`;

      let encrypted;
      try {
        encrypted = encryptDocument(file.buffer);
      } catch {
        return res.status(500).json({
          error: "Failed to encrypt document",
          code: "ENCRYPTION_FAILED",
        });
      }

      let registration;
      try {
        registration = await registerAssetAndDecode({
          assetHash,
          ownerDID: body.ownerDID,
          metadataURI,
          classification: body.classification,
        });
      } catch {
        // Same reasoning as identities.ts/permissions.ts: not decoding a
        // specific on-chain revert reason without custom-error ABI
        // decoding support.
        return res.status(400).json({
          error: "Asset registration failed",
          code: "REGISTRATION_FAILED",
        });
      }

      try {
        await encryptedRecordRepository.create({
          metadataUri: metadataURI,
          assetId: registration.assetId,
          encryptedBlob: encrypted.encryptedBlob,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
          wrappedDataKey: encrypted.wrappedDataKey,
          originalFilename: file.originalname,
          mimeType: file.mimetype,
        });
      } catch {
        // The asset now exists on-chain but its encrypted bytes failed
        // to persist — a real, if rare, partial-failure state (no
        // cross-system transaction spans Postgres and the chain here).
        // Surfacing this distinctly rather than reusing
        // REGISTRATION_FAILED, since retrying this exact request would
        // create a SECOND on-chain asset rather than fixing the first.
        return res.status(500).json({
          error:
            "Asset was registered on-chain but storing its encrypted content failed",
          code: "STORAGE_FAILED",
          assetId: bigintToNumber(registration.assetId),
          txHash: registration.txHash,
        });
      }

      return res.status(201).json({
        assetId: bigintToNumber(registration.assetId),
        assetHash,
        metadataURI,
        txHash: registration.txHash,
      });
    }
  );

  /**
   * GET /api/assets/:assetId — not authenticated per BACKEND_SPEC.md
   * ("asset metadata lookup is not itself sensitive"). Merges the
   * on-chain Asset struct with non-sensitive Postgres metadata
   * (original_filename, mime_type) — never the encrypted blob itself.
   */
  router.get(
    "/:assetId",
    // OWASP: public read rate limiter (60 req/15min per IP)
    publicReadLimiter,
    // OWASP: validate assetId param is a non-negative integer string
    validateParams(assetIdParamSchema),
    async (req: Request, res: Response) => {
      // After Zod validation, assetId is guaranteed to be a string.
      const assetIdParam = req.params.assetId as string;

      try {
        const asset = await getAsset(assetIdParam);
        const record = await encryptedRecordRepository.findByMetadataUri(
          asset.metadataURI
        );

        return res.status(200).json({
          assetId: bigintToNumber(asset.assetId),
          assetHash: asset.assetHash,
          ownerDID: asset.ownerDID,
          metadataURI: asset.metadataURI,
          classification: asset.classification,
          status: asset.status,
          version: bigintToNumber(asset.version),
          createdAt: bigintToNumber(asset.createdAt),
          originalFilename: record?.originalFilename ?? null,
          mimeType: record?.mimeType ?? null,
        });
      } catch {
        return res.status(404).json({
          error: "Asset not found",
          code: "ASSET_NOT_FOUND",
        });
      }
    }
  );

  /**
   * GET /api/assets/:assetId/download — requires a valid JWT. Per
   * BACKEND_SPEC.md's exact 4-step sequence:
   *   1. Extract did from the verified JWT (never a client-supplied
   *      header — authedReq.auth.did, set by authenticateJWT middleware
   *      from the verified token, not from any request header)
   *   2. checkPermissionNow(assetId, did, READ)
   *   3. If not allowed, 403
   *   4. If allowed: decrypt, return file bytes, write an audit_log row
   *      (ASSET_ACCESSED), generate a proof bundle, return it in
   *      X-Proof-Bundle header (base64-encoded JSON) alongside the body
   *
   * NOTE ON checkPermissionNow VS checkPermissionAtTime HERE: step 2 uses
   * checkPermissionNow deliberately, per the spec's literal endpoint
   * text — this checks CURRENT permission state AND current identity
   * active status together (see accessControlService.ts's own
   * documented distinction between the two functions). The proof
   * bundle's permissionVersionUsed field, however, needs the SPECIFIC
   * permission record version that was in effect (for embedding
   * validFrom/validUntil/permissionId) — checkPermissionNow's boolean
   * return doesn't carry that. So checkPermissionAtTime is called a
   * SECOND time, at the current timestamp, purely to recover that
   * record's fields for the bundle — not as a second authorization
   * check. This does mean two chain reads happen where one might
   * eventually be optimizable, but correctness (matching the two
   * functions' documented distinct semantics exactly) came first here,
   * not call-count minimization.
   */
  router.get(
    "/:assetId/download",
    authenticateJWT,
    // OWASP: validate assetId param is a non-negative integer string
    validateParams(assetIdParamSchema),
    async (req: Request, res: Response) => {
      const authedReq = req as AuthenticatedRequest;
      // After Zod validation, assetId is guaranteed to be a string.
      const assetIdParam = req.params.assetId as string;

      let allowed: boolean;
      try {
        allowed = await checkPermissionNow(
          assetIdParam,
          authedReq.auth.did,
          "READ"
        );
      } catch {
        return res.status(500).json({
          error: "Failed to check permission",
          code: "INTERNAL_ERROR",
        });
      }

      if (!allowed) {
        return res.status(403).json({
          error: "Not authorized to access this asset",
          code: "ACCESS_DENIED",
        });
      }

      let asset;
      let record;
      try {
        asset = await getAsset(assetIdParam);
        record = await encryptedRecordRepository.findByMetadataUri(
          asset.metadataURI
        );
      } catch {
        return res.status(404).json({
          error: "Asset not found",
          code: "ASSET_NOT_FOUND",
        });
      }

      if (!record) {
        return res.status(404).json({
          error: "Asset content not found",
          code: "ASSET_CONTENT_NOT_FOUND",
        });
      }

      let plaintext: Buffer;
      try {
        plaintext = decryptDocument({
          encryptedBlob: record.encryptedBlob,
          iv: record.iv,
          authTag: record.authTag,
          wrappedDataKey: record.wrappedDataKey,
        });
      } catch {
        return res.status(500).json({
          error: "Failed to decrypt document",
          code: "DECRYPTION_FAILED",
        });
      }

      /**
       * BUG FOUND AND FIXED HERE (an earlier version of this route used
       * Math.floor(Date.now() / 1000) — Node's wall clock — as
       * accessTimestamp, then passed that straight to
       * checkPermissionAtTime). checkPermissionAtTime's Solidity
       * condition compares against record.validFrom, which is set from
       * the CHAIN's block.timestamp at grant time (see
       * AccessControl.sol) — not wall-clock time. Hardhat's local node's
       * block.timestamp can drift from (in practice, lag behind) the
       * actual test machine's system clock. When Node's
       * Date.now()-derived accessTimestamp ended up EARLIER than the
       * grant's own block.timestamp, checkPermissionAtTime's
       * `record.validFrom <= atTimestamp` check failed for every real
       * record, silently falling through to the contract's synthetic
       * "no record found" REVOKED default — even though a real GRANTED
       * record existed. Caught via a real, run integration test
       * (assets.integration.test.ts), not by review — this specific
       * class of bug (chain time vs. wall-clock time) would not have
       * been visible from reading the code alone.
       *
       * Fixed by using the chain's OWN current block timestamp
       * (provider.getBlock("latest")) instead of Node's clock for the
       * FIRST checkPermissionAtTime call — this determines the real
       * permissionId, which recordAccess then needs as an argument.
       * recordAccess is deliberately called SECOND, using that real
       * permissionId — calling it first (an earlier draft's ordering)
       * would mean not yet knowing the true permissionId to pass it,
       * forcing a placeholder value that would then desync the emitted
       * AssetAccessed event's own permissionId from the bundle's claimed
       * permissionId, which the new receipt-verification step in
       * proofBundle.ts's verifyProofBundle would then correctly reject
       * as a mismatch. The bundle's FINAL accessTimestamp is re-read
       * from recordAccess's own mined block (not the earlier "latest"
       * read) so it reflects the exact block the access was actually
       * recorded in, not an approximation from a moment earlier.
       */
      const config = getConfig();
      const provider = new ethers.JsonRpcProvider(config.hardhatRpcUrl);

      const latestBlock = await provider.getBlock("latest");
      if (!latestBlock) {
        return res.status(500).json({
          error: "Could not read current chain block timestamp",
          code: "INTERNAL_ERROR",
        });
      }

      let permissionForBundle;
      try {
        permissionForBundle = await checkPermissionAtTime(
          assetIdParam,
          authedReq.auth.did,
          "READ",
          latestBlock.timestamp
        );
      } catch {
        return res.status(500).json({
          error: "Failed to determine current permission record",
          code: "INTERNAL_ERROR",
        });
      }

      let proofBundle;
      try {
        // Call recordAccess with the REAL permissionId determined above,
        // so the bundle's onChainTxRef points to a genuine AssetAccessed
        // transaction whose emitted event's permissionId matches what
        // the bundle claims (see the extended note above and
        // verifyProofBundle's receipt-checking step 5, which cross-
        // checks exactly this).
        //
        // NOTE ON recordAccess's own on-chain checks (read directly from
        // AccessControl.sol): its FIRST require checks
        // identityRegistry.isActive(msg.sender) — msg.sender here is the
        // RELAYER's address (this call is relayed, same as every other
        // write in this backend), NOT authedReq.auth.did's own identity.
        // That check is therefore a relayer-liveness check, not a second
        // verification of the actual requester — this route's earlier
        // checkPermissionNow call above is what verifies the requester.
        // recordAccess's SECOND require re-runs checkPermissionNow
        // itself, on the real requesterDID — genuinely redundant with
        // this route's own earlier check, and could in principle revert
        // here if something changed on-chain in the brief window between
        // the two calls (narrow, not eliminated). Not specially handled
        // as a distinct error case below — falls into the generic catch
        // as INTERNAL_ERROR rather than the more accurate "access
        // revoked mid-request," which would need its own revert-reason
        // decoding this codebase doesn't have yet (same limitation noted
        // elsewhere for REGISTRATION_FAILED/SET_PERMISSION_FAILED).
        const accessTx = await recordAccess(
          assetIdParam,
          authedReq.auth.did,
          permissionForBundle.permissionId
        );
        const accessReceipt = await accessTx.wait();

        if (!accessReceipt) {
          return res.status(500).json({
            error: "recordAccess transaction did not produce a receipt",
            code: "INTERNAL_ERROR",
          });
        }

        const accessBlock = await provider.getBlock(
          accessReceipt.blockNumber
        );
        const accessTimestamp = accessBlock
          ? accessBlock.timestamp
          : latestBlock.timestamp;

        proofBundle = await generateProofBundle({
          assetId: bigintToNumber(asset.assetId),
          assetHash: asset.assetHash,
          accessedBy: authedReq.auth.did,
          accessTimestamp,
          permissionVersionUsed: {
            permissionId: bigintToNumber(permissionForBundle.permissionId),
            state: permissionForBundle.state,
            validFrom: bigintToNumber(permissionForBundle.validFrom),
            validUntil: bigintToNumber(permissionForBundle.validUntil),
          },
          onChainTxRef: accessReceipt.hash,
        });
      } catch {
        return res.status(500).json({
          error: "Failed to record access and generate proof bundle",
          code: "INTERNAL_ERROR",
        });
      }

      try {
        await auditLogRepository.create({
          eventType: "ASSET_ACCESSED",
          actorDid: authedReq.auth.did,
          assetId: asset.assetId,
          details: { action: "READ" },
        });
      } catch {
        // An audit-log write failure should not block returning the
        // file to an already-authorized requester — this table is
        // explicitly documented (schema.prisma, DATA_MODEL.md) as a
        // convenience index, not the authoritative record. Falling
        // through rather than failing the whole request.
      }

      const proofBundleHeader = Buffer.from(
        JSON.stringify(proofBundle)
      ).toString("base64");

      res.setHeader("X-Proof-Bundle", proofBundleHeader);
      res.setHeader(
        "Content-Type",
        record.mimeType ?? "application/octet-stream"
      );
      if (record.originalFilename) {
        // OWASP: sanitize the filename before inserting into the
        // Content-Disposition header to prevent header injection
        // attacks via control characters or path traversal.
        const safeName = sanitizeFilename(record.originalFilename);
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${safeName}"`
        );
      }
      return res.status(200).send(plaintext);
    }
  );

  return router;
}
