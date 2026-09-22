import { Router, Request, Response } from "express";
import { createAuthService } from "../services/authService";
import { authLimiter } from "../middleware/rateLimiter";
import {
  validateBody,
  authChallengeSchema,
  authVerifySchema,
} from "../middleware/inputValidation";

export function createAuthRouter(authService: ReturnType<typeof createAuthService>) {
  const router = Router();

  // OWASP: auth endpoints get a tighter rate limit (10 req/15min per IP)
  // to mitigate brute-force and credential-stuffing attacks.
  router.use(authLimiter);

  router.post(
    "/challenge",
    // OWASP: schema-based validation — enforces type, length, format;
    // rejects unexpected fields via .strict()
    validateBody(authChallengeSchema),
    async (req: Request, res: Response) => {
      try {
        // req.body is now validated and stripped by Zod — safe to use directly.
        const result = await authService.createChallenge(req.body.did);
        return res.status(200).json(result);
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === "DID_NOT_FOUND") {
          return res.status(404).json({ error: "Unknown DID", code });
        }
        return res.status(500).json({ error: "Internal server error", code: "INTERNAL_ERROR" });
      }
    }
  );

  router.post(
    "/verify",
    // OWASP: schema-based validation — did, message, signature all
    // validated for type and length; unexpected fields rejected.
    validateBody(authVerifySchema),
    async (req: Request, res: Response) => {
      try {
        // req.body is now validated and stripped by Zod — safe to use directly.
        const result = await authService.verify(req.body);
        return res.status(200).json(result);
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === "AUTHENTICATION_FAILED") {
          return res.status(401).json({ error: "Authentication failed", code });
        }
        return res.status(500).json({ error: "Internal server error", code: "INTERNAL_ERROR" });
      }
    }
  );

  return router;
}
