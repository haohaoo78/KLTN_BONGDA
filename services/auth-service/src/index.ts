import express from "express";
import { ServiceName, type HealthResponse } from "@sfl/shared";
import { config } from "./config";
import { connectRedis, disconnectRedis } from "./lib/redis";
import { errorHandler } from "./middleware/errorHandler";
import { authRoutes } from "./routes/authRoutes";
import { Pool } from "pg";
import { AuthRepository } from "./repositories/authRepository";
import { AuthService } from "./services/authService";
import { authController } from "./controllers/authController";
import { setAuthService } from "./services/authService";
import { userRoutes } from "./account/routes/userRoutes";
import { internalRoutes } from "./account/routes/internalRoutes";
import { userController } from "./account/controllers/userController";
import { getPool as getAccountPool, closePool as closeAccountPool } from "./account/lib/db";
import { PasswordResetRepository } from "./account/repositories/passwordResetRepository";
import { PasswordResetService } from "./account/services/passwordResetService";

const app = express();
let authPool: Pool | null = null;

app.use(express.json());

app.get("/health", (_req, res) => {
  const body: HealthResponse = {
    status: "ok",
    service: ServiceName.AUTH,
    timestamp: new Date().toISOString(),
  };
  res.json(body);
});

app.use("/auth", authRoutes);
app.use("/users", userRoutes);
app.use("/internal", internalRoutes);

app.use(errorHandler);

async function main(): Promise<void> {
  // Connect to Redis
  await connectRedis();

  // Connect to PostgreSQL
  authPool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  // Initialize AuthRepository and AuthService
  const authRepository = new AuthRepository(authPool);
  const authService = new AuthService(authRepository);
  userController.setPasswordResetService(
    new PasswordResetService(new PasswordResetRepository(getAccountPool())),
  );
  userController.setAuthService(authService);

  // Set authService instance
  setAuthService(authService);
  authController.setAuthService(authService);

  app.listen(config.port, () => {
    console.log(`[${ServiceName.AUTH}] listening on ${config.port}`);
  });
}

main().catch((err) => {
  console.error("[auth-service] failed to start", err);
  process.exit(1);
});

async function shutdown(): Promise<void> {
  await disconnectRedis();
  await closeAccountPool();
  if (authPool) {
    await authPool.end();
    authPool = null;
  }
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
