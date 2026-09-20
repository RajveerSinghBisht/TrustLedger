import { Router, Request, Response } from "express";
import { createAuthService } from "../services/authService";

export function createAuthRouter(authService: ReturnType<typeof createAuthService>) {
  const router = Router();

  router.post("/challenge", async (req: Request, res: Response) => {
    try {
      if (!req.body || typeof req.body.did !== "string" || !req.body.did.trim()) {
        return res.status(400).json({ error: "did is required", code: "INVALID_REQUEST" });
      }
      const result = await authService.createChallenge(req.body.did);
      return res.status(200).json(result);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "DID_NOT_FOUND") {
        return res.status(404).json({ error: "Unknown DID", code });
      }
      return res.status(500).json({ error: "Internal server error", code: "INTERNAL_ERROR" });
    }
  });

  router.post("/verify", async (req: Request, res: Response) => {
    try {
      if (
        !req.body ||
        typeof req.body.did !== "string" ||
        typeof req.body.message !== "string" ||
        typeof req.body.signature !== "string"
      ) {
        return res.status(400).json({ error: "did, message, and signature are required", code: "INVALID_REQUEST" });
      }
      const result = await authService.verify(req.body);
      return res.status(200).json(result);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "AUTHENTICATION_FAILED") {
        return res.status(401).json({ error: "Authentication failed", code });
      }
      return res.status(500).json({ error: "Internal server error", code: "INTERNAL_ERROR" });
    }
  });

  return router;
}
