import express from "express";
import { ServiceName, type HealthResponse } from "@sfl/shared";
import { config } from "./config";
import { closePool } from "./lib/db";
import { errorHandler } from "./middleware/errorHandler";
import { teamRoutes } from "./routes/teamRoutes";
import { sendOverdueLeaveReminders } from "./services/playerMembershipService";

const app = express();

app.use(express.json());

app.get("/health", (_req, res) => {
  const body: HealthResponse = {
    status: "ok",
    service: ServiceName.ORGANIZATION,
    timestamp: new Date().toISOString(),
  };
  res.json(body);
});

app.use("/", teamRoutes);

app.use(errorHandler);

async function main(): Promise<void> {
  let reminderRunInProgress = false;
  setInterval(() => {
    if (reminderRunInProgress) return;
    reminderRunInProgress = true;
    void sendOverdueLeaveReminders()
      .catch((error: unknown) => {
        console.error("[organization-service] overdue leave reminder failed", error);
      })
      .finally(() => {
        reminderRunInProgress = false;
      });
  }, 60_000);
  app.listen(config.port, () => {
    console.log(`[${ServiceName.ORGANIZATION}] listening on ${config.port}`);
  });
}

main().catch((err) => {
  console.error("[organization-service] failed to start", err);
  process.exit(1);
});

async function shutdown(): Promise<void> {
  await closePool();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
