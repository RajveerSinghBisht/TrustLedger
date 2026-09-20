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

  try {
    const config = getConfig();

    const decoded = jwt.verify(
      token,
      config.backendSigningPrivateKey,
      {
        algorithms: ["HS256"],
      }
    );

    if (
      typeof decoded !== "object" ||
      decoded === null
    ) {
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
  } catch {
    unauthorizedResponse(res);
  }
}