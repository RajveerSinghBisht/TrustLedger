import { Router, Request, Response } from "express";
import { authenticateJWT, AuthenticatedRequest } from "../middleware/authenticateJWT";
import { UserRepository } from "../repositories/user";
import {
  registerIdentity,
  getIdentity,
  resolveDID,
} from "../services/identityRegistryService";
import { authorizationService } from "../services/authorizationService";
import { ethers } from "ethers";
import { getConfig } from "../config";
import { authenticatedWriteLimiter, publicReadLimiter } from "../middleware/rateLimiter";
import {
  validateBody,
  validateParams,
  registerIdentitySchema,
  identityDidParamSchema,
  updateDisplayNameSchema,
} from "../middleware/inputValidation";

/**
 * IdentityRegistry.sol's authoritative enum orderings — see the
 * duplicated documentation of these same values in authorizationService.ts
 * and identityRegistryService.ts. Kept here too (rather than importing a
 * shared constant) because this file only needs the reverse direction
 * (numeric -> display string) for the GET response, and a third copy of
 * a 4-line lookup table is a smaller risk than adding a new shared-const
 * module for a single reverse mapping — but if this enum needs to be
 * used a fourth time anywhere, extract it instead of copying it again.
 */
const CONTRACT_ROLE_NAMES: Record<number, string> = {
  0: "NONE",
  1: "ADMIN",
  2: "MANAGER",
  3: "AUDITOR",
  4: "USER",
};

const CONTRACT_STATUS_NAMES: Record<number, string> = {
  0: "ACTIVE",
  1: "REVOKED",
};

const VALID_ROLES = new Set(["ADMIN", "MANAGER", "AUDITOR", "USER"]);

function isValidRole(value: unknown): value is "ADMIN" | "MANAGER" | "AUDITOR" | "USER" {
  return typeof value === "string" && VALID_ROLES.has(value);
}

export function createIdentitiesRouter(
  userRepository: UserRepository
) {
  const router = Router();

  /**
   * POST /api/identities — registers a new identity.
   *
   * This is a PRIVILEGED WRITE per BACKEND_SPEC.md's Authorization Trust
   * Boundary section: it is NOT covered by the "no per-request getRole()
   * re-verification" MVP tradeoff (that tradeoff is scoped to ordinary
   * protected endpoints relying on the JWT's cached role for coarse
   * routing). Privileged writes are explicitly carved out and MUST
   * re-check the caller's CURRENT on-chain role/status immediately
   * before relaying — hence the authorizationService.requireCurrentRole
   * call below, using req.auth.address (from the verified JWT), never
   * req.auth.role.
   */
  router.post(
    "/",
    authenticateJWT,
    // OWASP: user-based rate limiter keyed on JWT did — prevents a
    // compromised account from flooding privileged write endpoints.
    authenticatedWriteLimiter,
    // OWASP: schema-based validation — enforces types, lengths, format,
    // enum values; rejects unexpected fields via .strict().
    validateBody(registerIdentitySchema),
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
            error: "Not authorized to register identities",
            code,
          });
        }
        return res.status(500).json({
          error: "Internal server error",
          code: "INTERNAL_ERROR",
        });
      }

      // req.body is now validated and stripped by Zod — safe to use directly.
      const body = req.body;

      try {
        const { txHash } = await registerIdentity({
          identityAddress: body.identityAddress,
          did: body.did,
          publicKey: body.publicKey,
          role: body.role,
        });

        // Store the off-chain display name only after the on-chain write
        // succeeds — if the chain call fails/reverts (e.g. duplicate
        // DID), we deliberately do not create an orphaned Postgres row
        // for an identity that doesn't actually exist on-chain.
        await userRepository.create({
          did: body.did,
          displayName: body.displayName,
        });

        return res.status(201).json({
          did: body.did,
          role: body.role,
          status: "ACTIVE",
          txHash,
        });
      } catch (error) {
        // Not distinguishing specific revert reasons (e.g. "duplicate
        // DID" vs. other on-chain reverts) here — ethers' revert error
        // shape for a require() without a custom error selector is not
        // reliably parseable into a specific machine code without
        // decoding revert data we have not built decoding for yet. A
        // generic 400 is honest about what we actually know: the
        // request was rejected, not necessarily why.
        return res.status(400).json({
          error: "Identity registration failed",
          code: "REGISTRATION_FAILED",
        });
      }
    }
  );

  /**
   * GET /api/identities/:did — not authenticated, per BACKEND_SPEC.md
   * ("identity lookups are not sensitive in this scope").
   */
  router.get(
    "/:did",
    // OWASP: public read rate limiter (60 req/15min per IP)
    publicReadLimiter,
    // OWASP: validate the DID param format and length
    validateParams(identityDidParamSchema),
    async (req: Request, res: Response) => {
      // After Zod validation, did is guaranteed to be a string.
      const did = req.params.did as string;

      try {
        // resolveDID/getIdentity both live in identityRegistryService.
        // resolveDID gives us the address first since getIdentity takes an
        // address, not a DID.
        const address = await resolveDID(did);

        if (address === ethers.ZeroAddress) {
          return res.status(404).json({
            error: "Unknown DID",
            code: "IDENTITY_NOT_FOUND",
          });
        }

        const identity = await getIdentity(address);
        const user = await userRepository.findByDid(did);

        return res.status(200).json({
          did: identity.did,
          role: CONTRACT_ROLE_NAMES[identity.role] ?? "UNKNOWN",
          status: CONTRACT_STATUS_NAMES[identity.status] ?? "UNKNOWN",
          displayName: user?.displayName ?? null,
          createdAt: identity.createdAt.toString(),
        });
      } catch {
        return res.status(404).json({
          error: "Unknown DID",
          code: "IDENTITY_NOT_FOUND",
        });
      }
    }
  );

  /**
   * PATCH /api/identities/:did — updates off-chain display name for an identity.
   * Privileged write: Only ADMIN (or the identity themselves if active) can rename.
   */
  router.patch(
    "/:did",
    authenticateJWT,
    authenticatedWriteLimiter,
    validateParams(identityDidParamSchema),
    validateBody(updateDisplayNameSchema),
    async (req: Request, res: Response) => {
      const authedReq = req as AuthenticatedRequest;
      const did = req.params.did as string;

      const isSelf = authedReq.auth.did === did;
      try {
        if (!isSelf) {
          await authorizationService.requireCurrentRole(
            authedReq.auth.address,
            ["ADMIN"]
          );
        } else {
          await authorizationService.requireCurrentRole(
            authedReq.auth.address,
            ["ADMIN", "MANAGER", "AUDITOR", "USER"]
          );
        }
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === "IDENTITY_REVOKED" || code === "INSUFFICIENT_ROLE") {
          return res.status(403).json({
            error: "Not authorized to update this identity",
            code,
          });
        }
        return res.status(500).json({
          error: "Internal server error",
          code: "INTERNAL_ERROR",
        });
      }

      try {
        const address = await resolveDID(did);
        if (address === ethers.ZeroAddress) {
          return res.status(404).json({
            error: "Unknown DID",
            code: "IDENTITY_NOT_FOUND",
          });
        }

        // Lock Account #0 (Root Bootstrap Admin) from being renamed
        const config = getConfig();
        const rootAdminAddress = new ethers.Wallet(config.relayerPrivateKey).address.toLowerCase();
        if (address.toLowerCase() === rootAdminAddress) {
          return res.status(403).json({
            error: "The Root Admin (Account #0) identity is immutable and cannot be renamed",
            code: "ROOT_ADMIN_IMMUTABLE",
          });
        }

        const identity = await getIdentity(address);
        const updated = await userRepository.updateDisplayName(did, req.body.displayName);

        return res.status(200).json({
          did: identity.did,
          role: CONTRACT_ROLE_NAMES[identity.role] ?? "UNKNOWN",
          status: CONTRACT_STATUS_NAMES[identity.status] ?? "UNKNOWN",
          displayName: updated.displayName,
          createdAt: identity.createdAt.toString(),
        });
      } catch {
        return res.status(500).json({
          error: "Failed to update identity",
          code: "UPDATE_FAILED",
        });
      }
    }
  );

  return router;
}
