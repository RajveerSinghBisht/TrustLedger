import { Router, Request, Response } from "express";
import { verifyProofBundle, ProofBundle } from "../services/proofBundle";
import { publicVerifyLimiter } from "../middleware/rateLimiter";
import {
  validateBody,
  proofBundleVerifySchema,
} from "../middleware/inputValidation";

/**
 * POST /api/proof-bundles/verify — NOT authenticated per
 * BACKEND_SPEC.md ("verification is meant to be usable by anyone
 * holding a bundle, including someone with no account in this system at
 * all"). Accepts the raw proof bundle JSON as the request body.
 */
export function createProofBundlesRouter() {
  const router = Router();

  router.post(
    "/verify",
    // OWASP: public verification rate limiter (30 req/15min per IP)
    publicVerifyLimiter,
    // OWASP: schema-based structural validation of the proof bundle
    // body — enforces types, nested shape, length limits; rejects
    // unexpected fields via .strict().
    validateBody(proofBundleVerifySchema),
    async (req: Request, res: Response) => {
      // req.body is now validated and stripped by Zod — safe to cast.
      try {
        const result = await verifyProofBundle(req.body as ProofBundle);
        return res.status(200).json(result);
      } catch {
        // verifyProofBundle is designed to return {valid: false, reason}
        // for every expected failure mode rather than throw — a throw
        // escaping it here means something genuinely unexpected happened
        // (e.g. the RPC endpoint itself unreachable), not a bundle-content
        // problem. Still responding 200 with valid: false rather than a
        // 500, since BACKEND_SPEC.md's documented response shape for this
        // endpoint is only the two {valid, reason} forms — no separate
        // error-status contract is specified for this particular route.
        return res.status(200).json({
          valid: false,
          reason: "verification failed unexpectedly",
        });
      }
    }
  );

  return router;
}
