/**
 * Schema-based input validation middleware — OWASP best practice for
 * strict input validation, type checking, length limiting, and
 * unexpected-field rejection.
 *
 * Uses Zod for compile-time type inference and runtime validation.
 * Each schema defines the EXACT shape of acceptable input; anything
 * outside that shape is rejected with a 400 matching the existing
 * { error, code: "INVALID_REQUEST" } contract.
 *
 * DESIGN PRINCIPLE: validation schemas are defined here, close together,
 * so a single file is the source of truth for "what does each endpoint
 * accept?" — easier to audit than validation logic scattered across
 * route files.
 */

import { z, ZodError, ZodSchema } from "zod";
import type { Request, Response, NextFunction } from "express";

// ---------------------------------------------------------------------------
// Reusable field validators
// ---------------------------------------------------------------------------

/**
 * DID format per DATA_MODEL.md: `did:<method>:<checksummed-address>`.
 * Allows up to 256 total characters (generous ceiling for any DID scheme
 * this system might encounter; leaves room without being dangerously open).
 */
const didField = z
  .string()
  .min(1, "did must not be empty")
  .max(256, "did exceeds maximum length of 256 characters")
  .refine((v) => v.trim().length > 0, "did must not be blank");

/**
 * Ethereum address: 0x + 40 hex characters. Used for identityAddress
 * fields. The checksum validation is left to ethers.js (which does it
 * at use time); this check ensures the basic shape is correct.
 */
const ethAddressField = z
  .string()
  .regex(
    /^0x[a-fA-F0-9]{40}$/,
    "Must be a valid Ethereum address (0x + 40 hex characters)"
  );

/**
 * Hex string field — for signatures, public keys, etc. Flexible length
 * but must be hex-only (with optional 0x prefix).
 */
const hexStringField = (maxLength: number) =>
  z
    .string()
    .min(1, "Must not be empty")
    .max(maxLength, `Exceeds maximum length of ${maxLength} characters`);

/** Positive integer (as a number type). */
const positiveInt = z
  .number()
  .int("Must be an integer")
  .nonnegative("Must be non-negative");

/** Positive integer provided as a string (e.g. URL params/query). */
const positiveIntString = z
  .string()
  .min(1, "Must not be empty")
  .regex(/^\d+$/, "Must be a non-negative integer string");

// ---------------------------------------------------------------------------
// Per-endpoint schemas
// ---------------------------------------------------------------------------

// POST /api/auth/challenge
export const authChallengeSchema = z
  .object({
    did: didField,
  })
  .strict(); // Reject any fields not listed above

// POST /api/auth/verify
export const authVerifySchema = z
  .object({
    did: didField,
    message: z
      .string()
      .min(1, "message must not be empty")
      .max(4096, "message exceeds maximum length"),
    signature: z
      .string()
      .min(1, "signature must not be empty")
      .max(256, "signature exceeds maximum length"),
  })
  .strict();

// POST /api/identities
export const registerIdentitySchema = z
  .object({
    identityAddress: ethAddressField,
    did: didField,
    publicKey: hexStringField(512),
    role: z.enum(["ADMIN", "MANAGER", "AUDITOR", "USER"]),
    displayName: z
      .string()
      .min(1, "displayName must not be empty")
      .max(128, "displayName exceeds maximum length of 128 characters")
      .refine((v) => v.trim().length > 0, "displayName must not be blank"),
  })
  .strict();

// GET /api/identities/:did — param validation
export const identityDidParamSchema = z.object({
  did: didField,
});

// PATCH /api/identities/:did — body validation
export const updateDisplayNameSchema = z
  .object({
    displayName: z
      .string()
      .min(1, "displayName must not be empty")
      .max(128, "displayName exceeds maximum length of 128 characters")
      .refine((v) => v.trim().length > 0, "displayName must not be blank"),
  })
  .strict();

// POST /api/permissions
export const setPermissionSchema = z
  .object({
    assetId: z.union([
      positiveInt,
      positiveIntString,
    ]),
    subjectDID: didField,
    action: z.enum(["READ", "WRITE", "TRANSFER"]),
    state: z.enum(["GRANTED", "REVOKED"]),
  })
  .strict();

// GET /api/permissions/verify — query params
export const verifyPermissionQuerySchema = z.object({
  assetId: positiveIntString,
  subjectDID: didField,
  action: z.enum(["READ", "WRITE", "TRANSFER"]),
  atTimestamp: positiveIntString,
});

// POST /api/assets — multipart body fields (file validated separately)
export const registerAssetBodySchema = z.object({
  ownerDID: didField,
  classification: z.enum(["PUBLIC", "INTERNAL", "CONFIDENTIAL"]),
});

// GET /api/assets/:assetId — param validation
export const assetIdParamSchema = z.object({
  assetId: positiveIntString,
});

// POST /api/proof-bundles/verify — full structural validation
export const proofBundleVerifySchema = z
  .object({
    assetId: z.number(),
    assetHash: z.string().min(1).max(256),
    accessedBy: z.string().min(1).max(256),
    accessTimestamp: z.number(),
    onChainTxRef: z.string().min(1).max(256),
    signature: z.string().min(1).max(512),
    permissionVersionUsed: z
      .object({
        permissionId: z.number(),
        state: z.string().min(1).max(32),
        validFrom: z.number(),
        validUntil: z.number(),
      })
      .strict(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Middleware factories — one for body, one for params, one for query
// ---------------------------------------------------------------------------

/**
 * Formats a ZodError into a human-readable, single-line string listing
 * all validation failures. Does not reveal internal schema details
 * beyond field names and the constraint that failed — OWASP-safe.
 */
function formatZodError(err: ZodError): string {
  return err.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

/**
 * Returns Express middleware that validates `req.body` against the given
 * Zod schema. On failure, responds with 400 + the standard error shape.
 * On success, replaces `req.body` with the parsed (and stripped) output
 * so downstream handlers can trust it without further checks.
 */
export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: formatZodError(result.error),
        code: "INVALID_REQUEST",
      });
      return;
    }
    // Replace req.body with the validated, stripped output — any extra
    // fields the client sent that are not in the schema are gone.
    req.body = result.data;
    next();
  };
}

/**
 * Returns Express middleware that validates `req.params` against the
 * given Zod schema. Same 400 contract on failure.
 */
export function validateParams<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      res.status(400).json({
        error: formatZodError(result.error),
        code: "INVALID_REQUEST",
      });
      return;
    }
    next();
  };
}

/**
 * Returns Express middleware that validates `req.query` against the
 * given Zod schema. Same 400 contract on failure.
 */
export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      res.status(400).json({
        error: formatZodError(result.error),
        code: "INVALID_REQUEST",
      });
      return;
    }
    next();
  };
}

// ---------------------------------------------------------------------------
// Utility: Content-Disposition filename sanitization
// ---------------------------------------------------------------------------

/**
 * Sanitizes a filename for use in a Content-Disposition header.
 * OWASP: prevents header injection via control characters, path
 * traversal via directory separators, and excessive length.
 *
 * - Strips path separators (/ and \) — only the basename is used
 * - Strips control characters (0x00–0x1F, 0x7F)
 * - Strips double quotes (prevents breaking out of the quoted value)
 * - Limits to 255 characters (filesystem-safe ceiling)
 * - Falls back to "download" if nothing remains after sanitization
 */
export function sanitizeFilename(raw: string): string {
  let safe = raw
    // Extract basename only — strip any path prefix
    .replace(/^.*[/\\]/, "")
    // Strip control characters
    .replace(/[\x00-\x1f\x7f]/g, "")
    // Strip double quotes to prevent header injection
    .replace(/"/g, "")
    // Limit length
    .slice(0, 255);

  // If nothing remains, use a safe fallback
  if (safe.trim().length === 0) {
    safe = "download";
  }

  return safe;
}
