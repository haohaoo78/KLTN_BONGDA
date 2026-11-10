import express from "express";
import { ServiceName, type HealthResponse } from "@sfl/shared";
import { config } from "./config";
import { closePool as closeMatchPool, getPool as getMatchPool } from "./lib/db";
import { errorHandler } from "./middleware/errorHandler";
import { matchRoutes } from "./routes/matchRoutes";
import { schedulingRoutes } from "./scheduling/routes/schedulingRoutes";
import {
  closePool as closeSchedulingPool,
  getPool as getSchedulingPool,
} from "./scheduling/lib/db";
import { disciplineRoutes } from "./discipline/routes/disciplineRoutes";
import {
  closePool as closeDisciplinePool,
  getPool as getDisciplinePool,
} from "./discipline/lib/db";

const app = express();

app.use(express.json());

app.get("/health", (_req, res) => {
  const body: HealthResponse = {
    status: "ok",
    service: ServiceName.MATCH,
    timestamp: new Date().toISOString(),
  };
  res.json(body);
});

app.use((req, res, next) => {
  const isSchedulingRoute =
    /^\/(?:venues|venue-availability|schedules)(?:\/|$)/.test(req.path) ||
    req.path === "/my/schedules" ||
    /^\/tournaments\/[^/]+\/schedules(?:\/|$)/.test(req.path) ||
    /^\/matches\/[^/]+\/schedule(?:\/|$)/.test(req.path);
  if (isSchedulingRoute) {
    schedulingRoutes(req, res, next);
    return;
  }
  next();
});
app.use((req, res, next) => {
  const isDisciplineRoute =
    /^\/(?:cards|suspensions|complaints|disciplinary-decisions)(?:\/|$)/.test(req.path) ||
    /^\/players\/[^/]+\/tournaments\/[^/]+\/suspension(?:\/|$)/.test(req.path) ||
    /^\/tournaments\/[^/]+\/(?:cards|suspensions|complaints)(?:\/|$)/.test(req.path);
  if (isDisciplineRoute) {
    disciplineRoutes(req, res, next);
    return;
  }
  next();
});
app.use("/", matchRoutes);

app.use(errorHandler);

async function main(): Promise<void> {
  await Promise.all([
    getMatchPool().query("SELECT 1"),
    getSchedulingPool().query("SELECT 1"),
    getDisciplinePool().query("SELECT 1"),
  ]);
  app.listen(config.port, () => {
    console.log(`[${ServiceName.MATCH}] listening on ${config.port}`);
  });
}

main().catch((err) => {
  console.error("[match-service] failed to start", err);
  process.exit(1);
});

async function shutdown(): Promise<void> {
  await Promise.all([
    closeMatchPool(),
    closeSchedulingPool(),
    closeDisciplinePool(),
  ]);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
