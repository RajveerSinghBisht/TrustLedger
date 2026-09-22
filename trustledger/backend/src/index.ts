import express from "express";
import cors from "cors";
import helmet from "helmet";
import { PrismaClient } from "@prisma/client";
import { AuthChallengeRepository } from "./repositories/authChallenge";
import { UserRepository } from "./repositories/user";
import { EncryptedRecordRepository } from "./repositories/encryptedRecord";
import { AuditLogRepository } from "./repositories/auditLog";
import { createAuthRouter } from "./routes/auth";
import { createIdentitiesRouter } from "./routes/identities";
import { createPermissionsRouter } from "./routes/permissions";
import { createAssetsRouter } from "./routes/assets";
import { createProofBundlesRouter } from "./routes/proofBundles";
import { createAuthService } from "./services/authService";
import { getConfig, verifyContractsDeployed } from "./config";
import { globalLimiter } from "./middleware/rateLimiter";

const config = getConfig();

async function start(): Promise<void> {
  // Confirms a contract actually exists at each configured address on
  // the CURRENT chain before accepting any requests. Without this, a
  // stale .env (e.g. after a local Hardhat node restart wiped all chain
  // state) lets the server start "successfully" and only fail later,
  // confusingly, deep inside whatever request first touches the chain —
  // see the extended comment on verifyContractsDeployed() in config.ts.
  try {
    await verifyContractsDeployed(config);
  } catch (error) {
    console.error("");
    console.error("Startup check failed:");
    console.error(
      error instanceof Error ? error.message : String(error)
    );
    console.error("");
    process.exit(1);
  }

  const prisma = new PrismaClient();
  const challengeRepository = new AuthChallengeRepository(prisma);
  const userRepository = new UserRepository(prisma);
  const encryptedRecordRepository = new EncryptedRecordRepository(prisma);
  const auditLogRepository = new AuditLogRepository(prisma);
  const authService = createAuthService({ challengeRepository });

  const app = express();

  // -----------------------------------------------------------------------
  // OWASP: Security headers via helmet — sets HSTS, X-Content-Type-Options,
  // X-Frame-Options (DENY), X-XSS-Protection, CSP defaults, etc.
  // Applied BEFORE any route handler runs.
  // -----------------------------------------------------------------------
  app.use(helmet());

  // -----------------------------------------------------------------------
  // OWASP: Global IP-based rate limiter — 100 req/15min per IP by default.
  // Applied BEFORE routing so even 404s and preflight requests count
  // toward the limit, preventing reconnaissance-based abuse.
  // -----------------------------------------------------------------------
  app.use(globalLimiter);

  // Allow the frontend dev server to communicate with the backend.
  // Defaults to Vite's standard development origin.
  app.use(
    cors({
      origin: process.env.FRONTEND_ORIGIN || "http://localhost:5173",
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    })
  );

  // OWASP: limit JSON body size to 1MB to prevent large-payload DoS.
  // The default (~100KB) is already reasonable, but making it explicit
  // documents the intent and makes it visible in the code.
  app.use(express.json({ limit: "1mb" }));

  app.use("/api/auth", createAuthRouter(authService));
  app.use("/api/identities", createIdentitiesRouter(userRepository));
  app.use("/api/permissions", createPermissionsRouter());

  app.use(
    "/api/assets",
    createAssetsRouter(encryptedRecordRepository, auditLogRepository)
  );

  app.use("/api/proof-bundles", createProofBundlesRouter());

  const server = app.listen(config.port, () => {
    console.log(`PRAMAAN backend listening on port ${config.port}`);
  });

  async function shutdown(signal: string) {
    console.log(`Received ${signal}, shutting down...`);

    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
  }

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

void start();