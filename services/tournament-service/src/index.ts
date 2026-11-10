import express from "express";
import { ServiceName, type HealthResponse } from "@sfl/shared";
import { config } from "./config";
import { closePool } from "./lib/db";
import { errorHandler } from "./middleware/errorHandler";
import { tournamentRoutes } from "./routes/tournamentRoutes";

const app = express();

app.use(express.json());

app.get("/health", (_req, res) => {
  const body: HealthResponse = {
    status: "ok",
    service: ServiceName.TOURNAMENT,
    timestamp: new Date().toISOString(),
  };
  res.json(body);
});

app.use("/", tournamentRoutes);

app.use(errorHandler);

async function main(): Promise<void> {
  app.listen(config.port, () => {
    console.log(`[${ServiceName.TOURNAMENT}] listening on ${config.port}`);
  });
}

main().catch((err) => {
  console.error("[tournament-service] failed to start", err);
  process.exit(1);
});

async function shutdown(): Promise<void> {
  await closePool();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
