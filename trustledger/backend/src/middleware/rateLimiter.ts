/**
 * Rate limiting middleware — OWASP best practice against brute-force,
 * credential-stuffing, and API abuse attacks.
 *
 * Design:
 *   - IP-based limiters at multiple tiers (global, auth, public reads,
 *     public verification)
 *   - User-based limiter for authenticated/privileged write endpoints
 *     (keyed on the JWT's `did`, extracted AFTER authenticateJWT runs)
 *   - All limiters return a consistent JSON error body matching the
 *     existing { error, code } contract, with a standard Retry-After
 *     header
 *   - In-memory store (suitable for single-instance deployment; swap
 *     to a Redis store for multi-instance)
 *
 * All window/max values are overridable via environment variables so
 * operators can tune without code changes.
 */

import rateLimit from "express-rate-limit";
import type { Request, Response } from "express";
import type { AuthenticatedRequest } from "./authenticateJWT";

// ---------------------------------------------------------------------------
// Shared handler for 429 responses — keeps the JSON shape identical to
// every other error response this API returns ({ error, code }).
// ---------------------------------------------------------------------------

function rateLimitHandler(_req: Request, res: Response): void {
  // OWASP: return a clear, non-leaking error message. Do not reveal
  // per-IP counters or internal limits in the response body.
  res.status(429).json({
    error: "Too many requests. Please try again later.",
    code: "RATE_LIMITED",
  });
}

// ---------------------------------------------------------------------------
// Helper: parse an env var as a positive integer, or fall back to a default.
// ---------------------------------------------------------------------------

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// ---------------------------------------------------------------------------
// 1. Global IP-based limiter — applied to every request before routing.
//    Generous default: 100 requests per 15-minute window.
// ---------------------------------------------------------------------------

export const globalLimiter = rateLimit({
  windowMs: envInt("RATE_LIMIT_GLOBAL_WINDOW_MS", 15 * 60 * 1000),
  max: envInt("RATE_LIMIT_GLOBAL_MAX", 100),
  standardHeaders: true, // Return RateLimit-* headers (draft-6)
  legacyHeaders: false, // Disable X-RateLimit-* headers
  handler: rateLimitHandler,
  // OWASP: use the leftmost non-private IP from X-Forwarded-For when
  // behind a reverse proxy. Express 5's trust-proxy setting controls
  // whether req.ip reflects this; if not behind a proxy, req.ip is the
  // direct client IP, which is correct.
  keyGenerator: (req: Request) => req.ip ?? "unknown",
});

// ---------------------------------------------------------------------------
// 2. Auth-specific limiter — tighter, applied to /api/auth/* only.
//    10 requests per 15-minute window per IP — limits brute-force
//    challenge/verify cycles.
// ---------------------------------------------------------------------------

export const authLimiter = rateLimit({
  windowMs: envInt("RATE_LIMIT_AUTH_WINDOW_MS", 15 * 60 * 1000),
  max: envInt("RATE_LIMIT_AUTH_MAX", 10),
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: (req: Request) => req.ip ?? "unknown",
});

// ---------------------------------------------------------------------------
// 3. Public-read limiter — for unauthenticated lookup endpoints like
//    GET /api/identities/:did and GET /api/assets/:assetId.
//    60 requests per 15-minute window per IP.
// ---------------------------------------------------------------------------

export const publicReadLimiter = rateLimit({
  windowMs: envInt("RATE_LIMIT_PUBLIC_READ_WINDOW_MS", 15 * 60 * 1000),
  max: envInt("RATE_LIMIT_PUBLIC_READ_MAX", 60),
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: (req: Request) => req.ip ?? "unknown",
});

// ---------------------------------------------------------------------------
// 4. Public-verify limiter — for /api/permissions/verify and
//    /api/proof-bundles/verify. 30 requests per 15-minute window per IP.
//    Slightly tighter than general reads because these hit the chain.
// ---------------------------------------------------------------------------

export const publicVerifyLimiter = rateLimit({
  windowMs: envInt("RATE_LIMIT_VERIFY_WINDOW_MS", 15 * 60 * 1000),
  max: envInt("RATE_LIMIT_VERIFY_MAX", 30),
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: (req: Request) => req.ip ?? "unknown",
});

// ---------------------------------------------------------------------------
// 5. Authenticated-write limiter — keyed on the JWT's `did` claim
//    (set by authenticateJWT middleware before this runs). This means a
//    single compromised/malicious authenticated user cannot flood
//    privileged write endpoints even from multiple IPs.
//    20 requests per 15-minute window per user.
//
//    IMPORTANT: this middleware must run AFTER authenticateJWT in the
//    middleware chain, because it reads req.auth.did for the key.
// ---------------------------------------------------------------------------

export const authenticatedWriteLimiter = rateLimit({
  windowMs: envInt("RATE_LIMIT_WRITE_WINDOW_MS", 15 * 60 * 1000),
  max: envInt("RATE_LIMIT_WRITE_MAX", 20),
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: (req: Request) => {
    // After authenticateJWT, req.auth.did is always set for
    // authenticated requests. Fall back to IP if somehow missing
    // (defensive — should not happen in practice).
    const authedReq = req as AuthenticatedRequest;
    return authedReq.auth?.did ?? req.ip ?? "unknown";
  },
});
