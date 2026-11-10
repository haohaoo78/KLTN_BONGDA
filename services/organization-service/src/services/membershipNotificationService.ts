import { AppError } from "../lib/errors";
import { config } from "../config";

type MembershipNotification = {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
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
        type: "TEAM_MEMBERSHIP",
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
