import express from "express";
import { ServiceName, type HealthResponse } from "@sfl/shared";
import { config } from "./config";
import { Pool } from "pg";
import { NotificationRepository } from "./repositories/notificationRepository";
import { NotificationService } from "./services/notificationService";
import { notificationController } from "./controllers/notificationController";
import { notificationRoutes } from "./routes/notificationRoutes";
import { errorHandler } from "./middleware/errorHandler";
import { EmailDeliveryService } from "./services/emailDeliveryService";
import { InternalEmailController } from "./controllers/internalEmailController";
import { createInternalRoutes } from "./routes/internalRoutes";
import { InternalNotificationController } from "./controllers/internalNotificationController";

const app = express();
let pool: Pool | null = null;

app.use(express.json());

app.get("/health", (_req, res) => {
  const body: HealthResponse = {
    status: "ok",
    service: ServiceName.NOTIFICATION,
    timestamp: new Date().toISOString(),
  };
  res.json(body);
});

async function main(): Promise<void> {
  // Connect to PostgreSQL
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });
  await pool.query("SELECT 1");

  // Initialize NotificationService
  const notificationRepository = new NotificationRepository(pool);
  const notificationService = new NotificationService(notificationRepository);
  notificationController.setNotificationService(notificationService);
  const emailDeliveryService = new EmailDeliveryService(pool);
  const internalEmailController = new InternalEmailController(emailDeliveryService);
  const internalNotificationController = new InternalNotificationController(notificationService);

  app.use("/internal", createInternalRoutes(internalEmailController, internalNotificationController));
  app.use("/notifications", notificationRoutes);
  app.use(errorHandler);
  app.listen(config.port, () => {
    console.log(`[${ServiceName.NOTIFICATION}] listening on ${config.port}`);
  });
}

main().catch((err) => {
  console.error("[notification-service] failed to start", err);
  process.exit(1);
});

async function shutdown(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
