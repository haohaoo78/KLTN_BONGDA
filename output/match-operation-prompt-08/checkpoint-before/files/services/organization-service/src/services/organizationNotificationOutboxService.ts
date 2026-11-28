import { sendMembershipNotification, sendTournamentInvitationEmail } from "./membershipNotificationService";
import { AppError } from "../lib/errors";
import {
  claimOrganizationNotification,
  completeOrganizationNotification,
  enqueueOrganizationNotifications,
  retryOrganizationNotification,
  type OrganizationNotificationInput,
} from "../repositories/organizationNotificationOutboxRepository";

export async function queueOrganizationNotifications(items: OrganizationNotificationInput[]): Promise<void> {
  await enqueueOrganizationNotifications(items);
}

export async function processOrganizationNotifications(limit = 30): Promise<void> {
  for (let index = 0; index < limit; index += 1) {
    const item = await claimOrganizationNotification();
    if (!item) return;
    try {
      await sendMembershipNotification({
        userId: item.userId, type: item.type, title: item.title, body: item.body, data: item.data,
        ...(item.idempotencyKey ? { idempotencyKey: item.idempotencyKey } : {}),
      });
      if (
        item.type === "TOURNAMENT_INVITATION" &&
        typeof item.data?.invitationId === "string" &&
        typeof item.data?.teamName === "string" &&
        typeof item.data?.tournamentName === "string" &&
        typeof item.data?.expiresAt === "string" &&
        item.data.status === undefined
      ) {
        try {
          await sendTournamentInvitationEmail({
            userId: item.userId,
            teamName: item.data.teamName,
            tournamentName: item.data.tournamentName,
            invitationId: item.data.invitationId,
            expiresAt: item.data.expiresAt,
          });
        } catch (error) {
          // Keep the in-app invitation actionable when SMTP is unavailable.
          console.error("[organization-service] invitation email failed; in-app notification remains available", {
            outboxId: item.id,
            code: error instanceof AppError ? error.code : "UNKNOWN",
          });
        }
      }
      await completeOrganizationNotification(item.id);
    } catch (error) {
      await retryOrganizationNotification(item.id, error, item.attempts);
      console.error("[organization-service] notification delivery deferred", { outboxId: item.id, attempt: item.attempts });
    }
  }
}
