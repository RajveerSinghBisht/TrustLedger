import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { getConfig } from "../config";
import type { JwtRole } from "../services/authService";

export interface AuthenticatedUser {
  did: string;
  address: string;
  role: JwtRole;
  iat: number;
  exp: number;
}

export interface AuthenticatedRequest extends Request {
  auth: AuthenticatedUser;
}

const VALID_ROLES = new Set<JwtRole>([
  "ADMIN",
  "MANAGER",
  "AUDITOR",
  "USER",
]);

function isJwtRole(value: unknown): value is JwtRole {
  return (
    typeof value === "string" &&
    VALID_ROLES.has(value as JwtRole)
  );
}

function unauthorizedResponse(res: Response): Response {
  return res.status(401).json({
    error: "Authentication required",
    code: "AUTHENTICATION_REQUIRED",
  });
}

export function authenticateJWT(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const authorization = req.header("Authorization");

  if (!authorization) {
    unauthorizedResponse(res);
    return;
  }

  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    unauthorizedResponse(res);
    return;
  }

  const token = match[1];

  // OWASP: key rotation support — try the current JWT_SECRET first,
  // then fall back to JWT_SECRET_PREVIOUS if set. This enables
  // zero-downtime key rotation: deploy with new key → wait for all
  // old JWTs to expire (15 min) → remove the previous key.
  const config = getConfig();
  const keysToTry: string[] = [config.jwtSecret];
  if (config.jwtSecretPrevious) {
    keysToTry.push(config.jwtSecretPrevious);
  }

  let decoded: jwt.JwtPayload | null = null;

  for (const secret of keysToTry) {
    try {
      const result = jwt.verify(token, secret, {
        algorithms: ["HS256"],
      });
      if (typeof result === "object" && result !== null) {
        decoded = result;
        break;
      }
    } catch {
      // Try the next key (if any). Only if ALL keys fail do we
      // return 401 below.
      continue;
    }
  }

  if (!decoded) {
    unauthorizedResponse(res);
    return;
  }

  const {
    did,
    address,
    role,
    iat,
    exp,
  } = decoded;

  if (
    typeof did !== "string" ||
    did.trim() === "" ||
    typeof address !== "string" ||
    address.trim() === "" ||
    !isJwtRole(role) ||
    typeof iat !== "number" ||
    !Number.isFinite(iat) ||
    typeof exp !== "number" ||
    !Number.isFinite(exp)
  ) {
    unauthorizedResponse(res);
    return;
  }

  const authenticatedRequest =
    req as AuthenticatedRequest;

  authenticatedRequest.auth = {
    did,
    address,
    role,
    iat,
    exp,
  };

  next();
}