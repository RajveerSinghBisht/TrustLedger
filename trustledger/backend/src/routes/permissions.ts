import { Router, Request, Response } from "express";
import { authenticateJWT, AuthenticatedRequest } from "../middleware/authenticateJWT";
import {
  setPermissionAndDecode,
  checkPermissionAtTime,
  requestPermissionAndDecode,
  approvePermissionAndDecode,
  cancelPermissionRequestAndDecode,
  getPermissionRequest,
  getPermissionRequests,
  AccessAction,
  PermissionState,
  PermissionRequestRecord,
  PermissionRequestStatus,
} from "../services/accessControlService";
import { authorizationService } from "../services/authorizationService";
import { authenticatedWriteLimiter, publicVerifyLimiter } from "../middleware/rateLimiter";
import {
  validateBody,
  validateQuery,
  validateParams,
  setPermissionSchema,
  verifyPermissionQuerySchema,
  requestPermissionSchema,
  requestIdParamSchema,
  listRequestsQuerySchema,
} from "../middleware/inputValidation";
import { getConfig } from "../config";

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
 * plain Number() conversion here is safe.
 */
function bigintToNumber(value: bigint): number {
  return Number(value);
}

function serializePermissionRequest(
  req: PermissionRequestRecord & { status: PermissionRequestStatus }
) {
  return {
    requestId: bigintToNumber(req.requestId),
    assetId: bigintToNumber(req.assetId),
    subjectDID: req.subjectDID,
    action: req.action,
    requestedState: req.requestedState,
    requester: req.requester,
    requestedAt: bigintToNumber(req.requestedAt),
    expiresAt: bigintToNumber(req.expiresAt),
    approved: req.approved,
    cancelled: req.cancelled,
    status: req.status,
  };
}

export function createPermissionsRouter() {
  const router = Router();

  // ── Dual-Custody Endpoints ──────────────────────────────────────────

  /**
   * POST /api/permissions/request
   * Creates a permission grant/revoke. For CONFIDENTIAL assets, creates a
   * PENDING request requiring Officer 2 approval (dual-custody). For PUBLIC
   * and INTERNAL assets, delegates directly to single-sig on-chain.
   */
  router.post(
    "/request",
    authenticateJWT,
    authenticatedWriteLimiter,
    validateBody(requestPermissionSchema),
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
            error: "Not authorized to request permissions",
            code,
          });
        }
        return res.status(500).json({
          error: "Internal server error",
          code: "INTERNAL_ERROR",
        });
      }

      const body = req.body;

      try {
        const result = await requestPermissionAndDecode(
          body.assetId,
          body.subjectDID,
          body.action,
          body.state ?? "GRANTED"
        );

        if (result.isDualCustody) {
          return res.status(201).json({
            isDualCustody: true,
            requestId: bigintToNumber(result.requestId),
            assetId: bigintToNumber(result.assetId),
            subjectDID: result.subjectDID,
            action: result.action,
            requestedState: result.requestedState,
            requester: result.requester,
            expiresAt: bigintToNumber(result.expiresAt),
            txHash: result.txHash,
          });
        } else {
          return res.status(201).json({
            isDualCustody: false,
            permissionId: bigintToNumber(result.permissionId),
            validFrom: bigintToNumber(result.validFrom),
            txHash: result.txHash,
          });
        }
      } catch (err: any) {
        return res.status(400).json({
          error: "Requesting permission failed",
          code: "REQUEST_PERMISSION_FAILED",
          ...(process.env.NODE_ENV === "development" && { details: err?.message || String(err) }),
        });
      }
    }
  );

  /**
   * GET /api/permissions/requests
   * Lists dual-custody permission requests with computed lifecycle status.
   */
  router.get(
    "/requests",
    authenticateJWT,
    validateQuery(listRequestsQuerySchema),
    async (req: Request, res: Response) => {
      try {
        const status = req.query.status as PermissionRequestStatus | "ALL" | undefined;
        const requests = await getPermissionRequests({ status });
        return res.status(200).json({
          requests: requests.map(serializePermissionRequest),
        });
      } catch (err: any) {
        return res.status(500).json({
          error: "Failed to list permission requests",
          code: "INTERNAL_ERROR",
        });
      }
    }
  );

  /**
   * GET /api/permissions/requests/:requestId
   * Returns a single dual-custody permission request by ID.
   */
  router.get(
    "/requests/:requestId",
    authenticateJWT,
    validateParams(requestIdParamSchema),
    async (req: Request, res: Response) => {
      try {
        const requestIdStr = Array.isArray(req.params.requestId) ? req.params.requestId[0] : req.params.requestId;
        const request = await getPermissionRequest(requestIdStr);
        return res.status(200).json(serializePermissionRequest(request));
      } catch (err: any) {
        const msg = err?.message || String(err);
        if (msg.includes("request does not exist")) {
          return res.status(404).json({
            error: "Permission request does not exist",
            code: "REQUEST_NOT_FOUND",
          });
        }
        return res.status(500).json({
          error: "Failed to fetch permission request",
          code: "INTERNAL_ERROR",
        });
      }
    }
  );

  /**
   * Handler for co-signing / approving a pending request.
   * Enforces dual-custody non-self-approval on-chain.
   */
  const handleApprove = async (req: Request, res: Response) => {
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
          error: "Not authorized to approve permissions",
          code,
        });
      }
      return res.status(500).json({
        error: "Internal server error",
        code: "INTERNAL_ERROR",
      });
    }

    try {
      const requestIdStr = Array.isArray(req.params.requestId) ? req.params.requestId[0] : req.params.requestId;

      let existingReq;
      try {
        existingReq = await getPermissionRequest(requestIdStr);
      } catch (checkErr: any) {
        if (checkErr?.message?.includes("request does not exist")) {
          return res.status(404).json({
            error: "Permission request does not exist.",
            code: "REQUEST_NOT_FOUND",
          });
        }
        throw checkErr;
      }

      if (
        existingReq &&
        existingReq.requester &&
        existingReq.requester.toLowerCase() === authedReq.auth.address.toLowerCase()
      ) {
        return res.status(400).json({
          error: "Dual-custody violation: Officer 1 cannot approve their own request.",
          code: "DUAL_CUSTODY_SELF_APPROVAL_VIOLATION",
        });
      }

      const nowSeconds = Math.floor(Date.now() / 1000);
      if (existingReq && existingReq.expiresAt && Number(existingReq.expiresAt) <= nowSeconds) {
        return res.status(400).json({
          error: "Permission request has expired (24-hour TTL elapsed).",
          code: "REQUEST_EXPIRED",
        });
      }

      // Security enforcement: The backend server no longer holds or executes
      // approvals. The second officer must sign and submit directly on-chain.
      return res.status(400).json({
        error:
          "Dual-custody approvals must be signed and broadcast directly by the approving officer's wallet to the smart contract. Server-side co-signing is disabled to prevent single-operator compromise.",
        code: "DIRECT_WALLET_SIGNING_REQUIRED",
      });
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (
        msg.includes("dual-custody violation") ||
        msg.includes("cannot approve own request")
      ) {
        return res.status(400).json({
          error: "Dual-custody violation: Officer 1 cannot approve their own request.",
          code: "DUAL_CUSTODY_SELF_APPROVAL_VIOLATION",
        });
      }
      if (msg.includes("request has expired")) {
        return res.status(400).json({
          error: "Permission request has expired (24-hour TTL elapsed).",
          code: "REQUEST_EXPIRED",
        });
      }
      if (msg.includes("request already approved")) {
        return res.status(400).json({
          error: "Permission request has already been approved.",
          code: "REQUEST_ALREADY_APPROVED",
        });
      }
      if (msg.includes("request was cancelled")) {
        return res.status(400).json({
          error: "Permission request was cancelled.",
          code: "REQUEST_CANCELLED",
        });
      }
      if (msg.includes("request does not exist")) {
        return res.status(404).json({
          error: "Permission request does not exist.",
          code: "REQUEST_NOT_FOUND",
        });
      }
      return res.status(400).json({
        error: "Approving permission failed",
        code: "APPROVE_PERMISSION_FAILED",
        ...(process.env.NODE_ENV === "development" && { details: msg }),
      });
    }
  };

  /**
   * Handler for cancelling a pending request.
   */
  const handleCancel = async (req: Request, res: Response) => {
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
          error: "Not authorized to cancel permissions",
          code,
        });
      }
      return res.status(500).json({
        error: "Internal server error",
        code: "INTERNAL_ERROR",
      });
    }

    try {
      const requestIdStr = Array.isArray(req.params.requestId) ? req.params.requestId[0] : req.params.requestId;
      const result = await cancelPermissionRequestAndDecode(requestIdStr);
      return res.status(200).json({
        requestId: bigintToNumber(result.requestId),
        cancelledBy: result.cancelledBy,
        txHash: result.txHash,
      });
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (msg.includes("only requester or ADMIN can cancel")) {
        return res.status(403).json({
          error: "Only the original requester or an active ADMIN can cancel this request.",
          code: "INSUFFICIENT_ROLE",
        });
      }
      if (msg.includes("request already approved")) {
        return res.status(400).json({
          error: "Permission request has already been approved and cannot be cancelled.",
          code: "REQUEST_ALREADY_APPROVED",
        });
      }
      if (msg.includes("request already cancelled")) {
        return res.status(400).json({
          error: "Permission request has already been cancelled.",
          code: "REQUEST_ALREADY_CANCELLED",
        });
      }
      if (msg.includes("request does not exist")) {
        return res.status(404).json({
          error: "Permission request does not exist.",
          code: "REQUEST_NOT_FOUND",
        });
      }
      return res.status(400).json({
        error: "Cancelling permission failed",
        code: "CANCEL_PERMISSION_FAILED",
        ...(process.env.NODE_ENV === "development" && { details: msg }),
      });
    }
  };

  // Support both /requests/:requestId/approve AND /:requestId/approve
  router.post(
    "/requests/:requestId/approve",
    authenticateJWT,
    authenticatedWriteLimiter,
    validateParams(requestIdParamSchema),
    handleApprove
  );
  router.post(
    "/:requestId/approve",
    authenticateJWT,
    authenticatedWriteLimiter,
    validateParams(requestIdParamSchema),
    handleApprove
  );

  // Support both /requests/:requestId/cancel AND /:requestId/cancel
  router.post(
    "/requests/:requestId/cancel",
    authenticateJWT,
    authenticatedWriteLimiter,
    validateParams(requestIdParamSchema),
    handleCancel
  );
  router.post(
    "/:requestId/cancel",
    authenticateJWT,
    authenticatedWriteLimiter,
    validateParams(requestIdParamSchema),
    handleCancel
  );

  // ── Existing Endpoints (Preserved 100%) ─────────────────────────────

  /**
   * POST /api/permissions — sets a permission directly (single-sig).
   * PRIVILEGED WRITE per BACKEND_SPEC.md. ADMIN or MANAGER on-chain role.
   */
  router.post(
    "/",
    authenticateJWT,
    authenticatedWriteLimiter,
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
    publicVerifyLimiter,
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
        return res.status(500).json({
          error: "Failed to verify permission",
          code: "INTERNAL_ERROR",
        });
      }
    }
  );

  /**
   * GET /api/permissions/config
   * Public config endpoint returning contract addresses for client-side interactions.
   */
  router.get("/config", (_req: Request, res: Response) => {
    const config = getConfig();
    return res.status(200).json({
      accessControlAddress: config.accessControlAddress,
      identityRegistryAddress: config.identityRegistryAddress,
      assetRegistryAddress: config.assetRegistryAddress,
    });
  });

  return router;
}
