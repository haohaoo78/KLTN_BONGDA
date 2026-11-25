import express from "express";
import { ServiceName, type HealthResponse } from "@sfl/shared";
import { config } from "./config";
import { closePool } from "./lib/db";
import { errorHandler } from "./middleware/errorHandler";
import { teamRoutes } from "./routes/teamRoutes";
import { sendOverdueLeaveReminders } from "./services/playerMembershipService";
import { expireClosedConflictAdjustments, expireClosedSupplementRegistrations, finalizeUnselectedWaitlistRegistrations, processPendingRegistrationDecisions, reconcileExistingApprovedPlayerClaims } from "./services/teamService";
import { processOrganizationNotifications } from "./services/organizationNotificationOutboxService";

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
  let registrationSyncRunInProgress = false;
  let notificationRunInProgress = false;
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
  const runRegistrationSync = (): void => {
    if (registrationSyncRunInProgress) return;
    registrationSyncRunInProgress = true;
    void processPendingRegistrationDecisions()
      .finally(() => {
        registrationSyncRunInProgress = false;
      });
  };
  runRegistrationSync();
  setInterval(runRegistrationSync, 10_000);
  let conflictExpiryRunInProgress = false;
  const runConflictExpiry = (): void => {
    if (conflictExpiryRunInProgress) return;
    conflictExpiryRunInProgress = true;
    void expireClosedConflictAdjustments()
      .catch((error: unknown) => console.error("[organization-service] conflict adjustment expiry failed", error))
      .finally(() => { conflictExpiryRunInProgress = false; });
  };
  runConflictExpiry();
  setInterval(runConflictExpiry, 30_000);
  let waitlistFinalizationInProgress = false;
  const runWaitlistFinalization = (): void => {
    if (waitlistFinalizationInProgress) return;
    waitlistFinalizationInProgress = true;
    void finalizeUnselectedWaitlistRegistrations()
      .catch((error: unknown) => console.error("[organization-service] waitlist finalization failed", error))
      .finally(() => { waitlistFinalizationInProgress = false; });
  };
  runWaitlistFinalization();
  setInterval(runWaitlistFinalization, 30_000);
  let supplementExpiryInProgress = false;
  const runSupplementExpiry = (): void => {
    if (supplementExpiryInProgress) return;
    supplementExpiryInProgress = true;
    void expireClosedSupplementRegistrations()
      .catch((error: unknown) => console.error("[organization-service] supplement expiry failed", error))
      .finally(() => { supplementExpiryInProgress = false; });
  };
  runSupplementExpiry();
  // Run often enough that a manual close promptly ends unfinished
  // supplementation, while the in-progress guard prevents overlapping sweeps.
  setInterval(runSupplementExpiry, 5_000);
  let playerClaimReconcileInProgress = false;
  let playerClaimsReconciled = false;
  const runPlayerClaimReconcile = (): void => {
    if (playerClaimReconcileInProgress || playerClaimsReconciled) return;
    playerClaimReconcileInProgress = true;
    void reconcileExistingApprovedPlayerClaims()
      .then(() => { playerClaimsReconciled = true; })
      .catch((error: unknown) => console.error("[organization-service] approved player-claim reconciliation failed", error))
      .finally(() => { playerClaimReconcileInProgress = false; });
  };
  runPlayerClaimReconcile();
  setInterval(runPlayerClaimReconcile, 60_000);
  const runNotificationOutbox = (): void => {
    if (notificationRunInProgress) return;
    notificationRunInProgress = true;
    void processOrganizationNotifications()
      .catch((error: unknown) => console.error("[organization-service] notification outbox processing failed", error))
      .finally(() => { notificationRunInProgress = false; });
  };
  runNotificationOutbox();
  setInterval(runNotificationOutbox, 10_000);
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
