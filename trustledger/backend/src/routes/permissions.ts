import { Router, Request, Response } from "express";
import { authenticateJWT, AuthenticatedRequest } from "../middleware/authenticateJWT";
import {
  setPermissionAndDecode,
  checkPermissionAtTime,
  AccessAction,
  PermissionState,
} from "../services/accessControlService";
import { authorizationService } from "../services/authorizationService";
import { authenticatedWriteLimiter, publicVerifyLimiter } from "../middleware/rateLimiter";
import {
  validateBody,
  validateQuery,
  setPermissionSchema,
  verifyPermissionQuerySchema,
} from "../middleware/inputValidation";

const VALID_ACTIONS = new Set(["READ", "WRITE", "TRANSFER"]);
const VALID_STATES = new Set(["GRANTED", "REVOKED"]);

function isValidAction(value: unknown): value is AccessAction {
  return typeof value === "string" && VALID_ACTIONS.has(value);
}

function isValidState(value: unknown): value is PermissionState {
  return typeof value === "string" && VALID_STATES.has(value);
}

/**
 * Serializes a bigint field for a JSON response as a plain number.
 * Every bigint value returned by AccessControl in this route (assetId,
 * permissionId, validFrom, validUntil, atTimestamp) is a Solidity
 * uint256 in practice populated from either a small user-supplied
 * integer or a block timestamp — both comfortably within
 * Number.MAX_SAFE_INTEGER for any realistic use of this system, so a
 * plain Number() conversion here is safe. This would NOT be safe for an
 * arbitrary uint256 (e.g. a token amount in wei) — do not copy this
 * helper into a context where the underlying value could be
 * arbitrarily large.
 */
function bigintToNumber(value: bigint): number {
  return Number(value);
}

export function createPermissionsRouter() {
  const router = Router();

  /**
   * POST /api/permissions — sets a permission. PRIVILEGED WRITE per
   * BACKEND_SPEC.md's Authorization Trust Boundary section — same
   * mandatory fresh on-chain re-check as POST /api/identities (see the
   * extended comment there). ADMIN or MANAGER, checked against the
   * CURRENT on-chain role via req.auth.address, never req.auth.role.
   */
  router.post(
    "/",
    authenticateJWT,
    // OWASP: user-based rate limiter keyed on JWT did
    authenticatedWriteLimiter,
    // OWASP: schema-based validation — enforces types, enum values,
    // integer format for assetId; rejects unexpected fields.
    validateBody(setPermissionSchema),
    async (req: Request, res: Response) => {
      const authedReq = req as AuthenticatedRequest;

      try {
        await authorizationService.requireCurrentRole(
          authedReq.auth.address,
          ["ADMIN", "MANAGER"]
        );
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === "IDENTITY_REVOKED" || code === "INSUFFICIENT_ROLE") {
          return res.status(403).json({
            error: "Not authorized to set permissions",
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
        const result = await setPermissionAndDecode(
          body.assetId,
          body.subjectDID,
          body.action,
          body.state
        );

        return res.status(201).json({
          permissionId: bigintToNumber(result.permissionId),
          validFrom: bigintToNumber(result.validFrom),
          txHash: result.txHash,
        });
      } catch {
        // Same reasoning as identities.ts's REGISTRATION_FAILED: not
        // attempting to decode a specific on-chain revert reason without
        // custom-error ABI decoding support, which doesn't exist yet.
        return res.status(400).json({
          error: "Setting permission failed",
          code: "SET_PERMISSION_FAILED",
        });
      }
    }
  );

  /**
   * GET /api/permissions/verify — NOT authenticated per BACKEND_SPEC.md
   * ("explicitly meant to be a public verifiability feature"). Read-only,
   * calls AccessControl.checkPermissionAtTime.
   */
  router.get(
    "/verify",
    // OWASP: public verification rate limiter (30 req/15min per IP)
    publicVerifyLimiter,
    // OWASP: schema-based query param validation — validates all four
    // required params (assetId, subjectDID, action, atTimestamp) for
    // type and format.
    validateQuery(verifyPermissionQuerySchema),
    async (req: Request, res: Response) => {
      const { assetId, subjectDID, action, atTimestamp } = req.query;

      try {
        const permission = await checkPermissionAtTime(
          assetId as string,
          subjectDID as string,
          action as AccessAction,
          atTimestamp as string
        );

        // Per AccessControl.sol's checkPermissionAtTime (view function,
        // confirmed by reading its body — it never reverts): if no
        // permission record covers atTimestamp at all, the contract
        // returns a synthetic zeroed Permission with permissionId: 0 and
        // state: REVOKED, not a revert. So "no record found" and "a real
        // record found in REVOKED state" both surface identically here as
        // wasLegitimate: false, distinguishable only by permissionId being
        // 0 in the former case. This route deliberately returns 200 with
        // wasLegitimate: false for both — not a 404 — since the contract
        // itself treats "no record" as a normal, well-defined answer
        // ("REVOKED by default"), not an error condition.
        const wasLegitimate = permission.state === "GRANTED";

        return res.status(200).json({
          assetId: bigintToNumber(permission.assetId),
          subjectDID: permission.subjectDID,
          action: permission.action,
          atTimestamp: Number(atTimestamp),
          wasLegitimate,
          permissionVersionUsed: {
            permissionId: bigintToNumber(permission.permissionId),
            state: permission.state,
            validFrom: bigintToNumber(permission.validFrom),
            validUntil: bigintToNumber(permission.validUntil),
          },
        });
      } catch {
        // A genuine, unexpected failure (RPC error, contract call itself
        // reverting for a reason unrelated to "no record found" — e.g. a
        // malformed assetId that fails ABI encoding before the call is
        // even sent). NOT used for "no permission record" — see above.
        return res.status(500).json({
          error: "Failed to verify permission",
          code: "INTERNAL_ERROR",
        });
      }
    }
  );

  return router;
}
