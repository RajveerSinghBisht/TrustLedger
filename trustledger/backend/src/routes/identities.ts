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

      const body = req.body ?? {};
      if (
        typeof body.identityAddress !== "string" ||
        !body.identityAddress.trim() ||
        typeof body.did !== "string" ||
        !body.did.trim() ||
        typeof body.publicKey !== "string" ||
        !body.publicKey.trim() ||
        !isValidRole(body.role) ||
        typeof body.displayName !== "string" ||
        !body.displayName.trim()
      ) {
        return res.status(400).json({
          error:
            "identityAddress, did, publicKey, role, and displayName are all required",
          code: "INVALID_REQUEST",
        });
      }

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
  router.get("/:did", async (req: Request, res: Response) => {
    const did = req.params.did;

    if (typeof did !== "string" || !did.trim()) {
      return res.status(400).json({
        error: "did is required",
        code: "INVALID_REQUEST",
      });
    }

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
  });

  return router;
}
