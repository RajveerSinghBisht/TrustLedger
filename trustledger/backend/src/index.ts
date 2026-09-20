import express from "express";
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
  app.use(express.json());
  app.use("/api/auth", createAuthRouter(authService));
  app.use("/api/identities", createIdentitiesRouter(userRepository));
  app.use("/api/permissions", createPermissionsRouter());
  app.use(
    "/api/assets",
    createAssetsRouter(encryptedRecordRepository, auditLogRepository)
  );
  app.use("/api/proof-bundles", createProofBundlesRouter());

  const server = app.listen(config.port, () => {
    console.log(`TrustLedger backend listening on port ${config.port}`);
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
