import { AppError } from "../lib/errors";
import { config } from "../config";

type AccountEmailType = "verification" | "password_reset" | "account_activation" | "email_change";

function getEmailEndpoint(): string {
  if (!config.internalApiKey) {
    throw new AppError(
      503,
      "Notification service authentication is not configured",
      "EMAIL_DELIVERY_NOT_CONFIGURED",
    );
  }

  try {
    const baseUrl = new URL(config.notificationServiceUrl);
    if (!["http:", "https:"].includes(baseUrl.protocol)) {
      throw new Error("invalid protocol");
    }
    return new URL("/internal/email/send", baseUrl).toString();
  } catch {
    throw new AppError(
      503,
      "Notification service URL is not configured",
      "EMAIL_DELIVERY_NOT_CONFIGURED",
    );
  }
}

async function sendAccountEmail(
  type: AccountEmailType,
  email: string,
  token: string,
  staffRole?: "BTC" | "REFEREE",
): Promise<void> {
  const endpoint = getEmailEndpoint();
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-api-key": config.internalApiKey,
      },
      body: JSON.stringify({
        type,
        email,
        token,
        ...(staffRole ? { staffRole } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : "NOTIFICATION_UNAVAILABLE";
    console.error("[auth-service] notification request failed", { code });
    throw new AppError(
      502,
      "Could not deliver the email. Try again later.",
      "EMAIL_DELIVERY_FAILED",
    );
  }

  if (!response.ok) {
    console.error("[auth-service] notification service rejected email", {
      status: response.status,
    });
    throw new AppError(
      502,
      "Could not deliver the email. Check notification service and SMTP settings.",
      "EMAIL_DELIVERY_FAILED",
    );
  }
}

export function assertEmailDeliveryConfigured(): void {
  getEmailEndpoint();
}

export async function sendVerificationEmail(email: string, token: string): Promise<void> {
  await sendAccountEmail("verification", email, token);
}

export async function sendPasswordResetEmail(email: string, token: string): Promise<void> {
  await sendAccountEmail("password_reset", email, token);
}

export async function sendStaffActivationEmail(
  email: string,
  token: string,
  staffRole: "BTC" | "REFEREE",
): Promise<void> {
  await sendAccountEmail("account_activation", email, token, staffRole);
}

export async function sendEmailChangeVerification(email: string, token: string): Promise<void> {
  await sendAccountEmail("email_change", email, token);
}

export async function sendAccountStatusNotification(input: {
  userId: string;
  action: "locked" | "opened";
  reason?: string | null;
}): Promise<void> {
  if (!config.internalApiKey) {
    throw new AppError(503, "Notification service authentication is not configured", "NOTIFICATION_NOT_CONFIGURED");
  }
  let endpoint: string;
  try {
    endpoint = new URL("/internal/notifications", config.notificationServiceUrl).toString();
  } catch {
    throw new AppError(503, "Notification service URL is not configured", "NOTIFICATION_NOT_CONFIGURED");
  }
  const bodyText = input.action === "locked"
    ? "Tài khoản của bạn đã bị khóa bởi quản trị viên."
    : "Tài khoản của bạn đã được mở khóa lại.";
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-api-key": config.internalApiKey,
      },
      body: JSON.stringify({
        userId: input.userId,
        type: "SYSTEM",
        title: input.action === "locked" ? "Tài khoản bị khóa" : "Tài khoản được mở khóa",
        body: `${bodyText}${input.reason ? ` Lý do: ${input.reason}` : ""}`,
        data: {
          action: input.action,
          reason: input.reason ?? null,
        },
      }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new AppError(503, "Notification service is unavailable", "UPSTREAM_UNAVAILABLE");
  }
  if (!response.ok) {
    throw new AppError(502, "Could not create account status notification", "UPSTREAM_ERROR");
  }
}

export async function sendRoleApplicationNotification(input: {
  userId: string;
  role: "PLAYER" | "TEAM_CAPTAIN";
  status: "APPROVED" | "REJECTED";
  decisionNote: string | null;
}): Promise<void> {
  if (!config.internalApiKey) {
    throw new AppError(503, "Notification service authentication is not configured", "NOTIFICATION_NOT_CONFIGURED");
  }
  let endpoint: string;
  try {
    endpoint = new URL("/internal/notifications", config.notificationServiceUrl).toString();
  } catch {
    throw new AppError(503, "Notification service URL is not configured", "NOTIFICATION_NOT_CONFIGURED");
  }
  const approved = input.status === "APPROVED";
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-api-key": config.internalApiKey,
      },
      body: JSON.stringify({
        userId: input.userId,
        type: "SYSTEM",
        title: approved ? "Yêu cầu vai trò đã được duyệt" : "Yêu cầu vai trò chưa được duyệt",
        body: `${input.role}: ${approved ? "đã cấp quyền" : "bị từ chối"}${input.decisionNote ? `. Ghi chú: ${input.decisionNote}` : "."}`,
        data: {
          role: input.role,
          status: input.status,
          decisionNote: input.decisionNote,
        },
      }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new AppError(503, "Notification service is unavailable", "UPSTREAM_UNAVAILABLE");
  }
  if (!response.ok) {
    throw new AppError(502, "Could not create role application notification", "UPSTREAM_ERROR");
  }
}

export async function sendAdminAccountChangeNotification(input: {
  userId: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
}): Promise<void> {
  if (!config.internalApiKey) {
    throw new AppError(503, "Notification service authentication is not configured", "NOTIFICATION_NOT_CONFIGURED");
  }
  let endpoint: string;
  try {
    endpoint = new URL("/internal/notifications", config.notificationServiceUrl).toString();
  } catch {
    throw new AppError(503, "Notification service URL is not configured", "NOTIFICATION_NOT_CONFIGURED");
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
        userId: input.userId,
        type: "SYSTEM",
        title: input.title,
        body: input.body,
        data: input.data,
      }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new AppError(503, "Notification service is unavailable", "UPSTREAM_UNAVAILABLE");
  }
  if (!response.ok) {
    throw new AppError(502, "Could not create account change notification", "UPSTREAM_ERROR");
  }
}
