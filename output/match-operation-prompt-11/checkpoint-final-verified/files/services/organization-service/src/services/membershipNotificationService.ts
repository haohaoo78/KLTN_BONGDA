import { AppError } from "../lib/errors";
import { config } from "../config";

type MembershipNotification = {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  idempotencyKey?: string;
  type?: "TEAM_MEMBERSHIP" | "TOURNAMENT_INVITATION" | "TOURNAMENT_REGISTRATION" | "SYSTEM";
};

export async function sendMembershipNotification(
  notification: MembershipNotification,
): Promise<void> {
  if (!config.internalApiKey) {
    throw new AppError(503, "Notification authentication is not configured", "SERVICE_MISCONFIGURED");
  }
  let endpoint: string;
  try {
    endpoint = new URL("/internal/notifications", config.notificationServiceUrl).toString();
  } catch {
    throw new AppError(503, "Notification service URL is invalid", "SERVICE_MISCONFIGURED");
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-api-key": config.internalApiKey,
      },
      body: JSON.stringify({
        ...notification,
        type: notification.type ?? "TEAM_MEMBERSHIP",
      }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new AppError(503, "Notification service is unavailable", "UPSTREAM_UNAVAILABLE");
  }
  if (!response.ok) {
    throw new AppError(502, "Could not create membership notification", "UPSTREAM_ERROR");
  }
}

export async function sendTournamentInvitationEmail(input: {
  userId: string;
  teamName: string;
  tournamentName: string;
  invitationId: string;
  expiresAt: string;
}): Promise<void> {
  if (!config.internalApiKey) {
    throw new AppError(503, "Notification authentication is not configured", "SERVICE_MISCONFIGURED");
  }
  const authUrl = new URL(`/internal/users/${encodeURIComponent(input.userId)}/notification-contact`, config.authServiceUrl);
  let contactResponse: Response;
  try {
    contactResponse = await fetch(authUrl, {
      headers: { "x-gateway-internal-key": config.internalApiKey },
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new AppError(503, "Account service is unavailable", "UPSTREAM_UNAVAILABLE");
  }
  if (!contactResponse.ok) {
    throw new AppError(502, "Could not load the verified invitation recipient", "UPSTREAM_ERROR");
  }
  const contact = await contactResponse.json() as { email?: unknown; fullName?: unknown };
  if (typeof contact.email !== "string" || typeof contact.fullName !== "string") {
    throw new AppError(502, "Account service returned an invalid notification contact", "UPSTREAM_ERROR");
  }
  let endpoint: string;
  try {
    endpoint = new URL("/internal/email/tournament-invitation", config.notificationServiceUrl).toString();
  } catch {
    throw new AppError(503, "Notification service URL is invalid", "SERVICE_MISCONFIGURED");
  }
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-api-key": config.internalApiKey },
      body: JSON.stringify({
        email: contact.email,
        fullName: contact.fullName,
        teamName: input.teamName,
        tournamentName: input.tournamentName,
        invitationId: input.invitationId,
        expiresAt: input.expiresAt,
      }),
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    throw new AppError(503, "Email service is unavailable", "UPSTREAM_UNAVAILABLE");
  }
  if (!response.ok) {
    throw new AppError(502, "Could not deliver the tournament invitation email", "EMAIL_DELIVERY_FAILED");
  }
}
