import type { Pool } from "pg";
import nodemailer from "nodemailer";
import { AppError } from "../lib/errors";
import { config } from "../config";

export type AccountEmailType = "verification" | "password_reset" | "account_activation" | "email_change";

function getMailConfiguration() {
  const missing = [
    ["SMTP_HOST", config.smtpHost],
    ["MAIL_FROM", config.mailFrom],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length) {
    throw new AppError(
      503,
      `Email delivery is not configured. Set: ${missing.join(", ")}`,
      "EMAIL_DELIVERY_NOT_CONFIGURED",
    );
  }
  if (!Number.isInteger(config.smtpPort) || config.smtpPort < 1 || config.smtpPort > 65535) {
    throw new AppError(503, "SMTP_PORT must be a valid TCP port", "EMAIL_DELIVERY_NOT_CONFIGURED");
  }
  if (Boolean(config.smtpUser) !== Boolean(config.smtpPassword)) {
    throw new AppError(
      503,
      "SMTP_USER and SMTP_PASS must both be configured or both be empty",
      "EMAIL_DELIVERY_NOT_CONFIGURED",
    );
  }

  let clientUrl: URL;
  try {
    clientUrl = new URL(config.clientUrl);
  } catch {
    throw new AppError(
      503,
      "CLIENT_URL must be a valid HTTP(S) URL",
      "EMAIL_DELIVERY_NOT_CONFIGURED",
    );
  }
  if (
    !["http:", "https:"].includes(clientUrl.protocol) ||
    (config.isProduction && clientUrl.protocol !== "https:")
  ) {
    throw new AppError(
      503,
      "CLIENT_URL must use HTTPS in production",
      "EMAIL_DELIVERY_NOT_CONFIGURED",
    );
  }

  return {
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    ...(config.smtpUser && config.smtpPassword
      ? { auth: { user: config.smtpUser, pass: config.smtpPassword } }
      : {}),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  };
}

function safeErrorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code.slice(0, 64);
  }
  return "UNKNOWN";
}

function createEmailContent(
  type: AccountEmailType,
  token: string,
  staffRole?: "BTC" | "REFEREE",
) {
  const verification = type === "verification";
  const emailChange = type === "email_change";
  const action = verification ? "verify" : "reset";
  const link = new URL("/", config.clientUrl);
  if (type === "account_activation") {
    link.searchParams.set("activate", token);
  } else if (emailChange) {
    link.searchParams.set("email-change", token);
  } else {
    link.searchParams.set(action, token);
  }
  const url = link.toString();
  const activation = type === "account_activation";
  const emailChangeTitle = "Xác nhận địa chỉ email mới";
  const title = emailChange
    ? emailChangeTitle
    : activation
    ? "Kích hoạt tài khoản SFTMS"
    : verification
      ? "Xác minh email của bạn"
      : "Đặt lại mật khẩu";
  const button = emailChange
    ? "Xác nhận email mới"
    : activation
    ? "Thiết lập mật khẩu và kích hoạt"
    : verification
      ? "Xác minh địa chỉ email"
      : "Đặt lại mật khẩu";
  const intro = emailChange
    ? "Bạn đã yêu cầu đổi email tài khoản SFTMS. Xác nhận địa chỉ mới bằng liên kết bên dưới; email hiện tại được giữ nguyên cho đến khi xác nhận."
    : activation
    ? `Quản trị viên đã cấp cho bạn tài khoản ${staffRole === "REFEREE" ? "Trọng tài" : "Ban tổ chức"}. Thiết lập mật khẩu qua liên kết bên dưới để xác minh email và kích hoạt tài khoản.`
    : verification
      ? "Cảm ơn bạn đã tạo tài khoản. Nhấn nút bên dưới để xác minh email và hoàn tất đăng ký."
      : "Nhấn nút bên dưới để đặt mật khẩu mới cho tài khoản của bạn.";
  const expiry = activation || verification || emailChange ? "24 giờ" : "1 giờ";

  return {
    subject: emailChange
      ? "Xác nhận địa chỉ email mới — Sân Cỏ"
      : activation
      ? `Kích hoạt tài khoản ${staffRole === "REFEREE" ? "Trọng tài" : "Ban tổ chức"} — Sân Cỏ`
      : verification
        ? "Xác minh địa chỉ email — Sân Cỏ"
        : "Đặt lại mật khẩu — Sân Cỏ",
    text: [
      "Xin chào,",
      "",
      intro,
      url,
      "",
      `Liên kết có hiệu lực trong ${expiry}. Nếu bạn không yêu cầu thao tác này, hãy bỏ qua email.`,
    ].join("\n"),
    html: `<!doctype html><html lang="vi"><body style="margin:0;background:#f4f6f1;font-family:Arial,sans-serif;color:#17241f"><div style="max-width:560px;margin:32px auto;padding:32px;background:#fff;border:1px solid #e7eae4;border-radius:8px"><p style="color:#157449;font-size:12px;font-weight:bold;letter-spacing:2px">SÂN CỎ · STUDENT FOOTBALL</p><h1 style="font-size:24px">${title}</h1><p style="line-height:1.6;color:#59645d">${intro}</p><p style="margin:28px 0"><a href="${url}" style="display:inline-block;padding:13px 20px;border-radius:4px;background:#157449;color:#fff;text-decoration:none;font-weight:bold">${button}</a></p><p style="font-size:12px;color:#78827c;line-height:1.6">Liên kết có hiệu lực trong ${expiry}. Nếu nút không hoạt động, hãy mở liên kết này:<br><a href="${url}" style="color:#157449;word-break:break-all">${url}</a></p><p style="font-size:12px;color:#78827c">Nếu bạn không yêu cầu thao tác này, hãy bỏ qua email.</p></div></body></html>`,
  };
}

export class EmailDeliveryService {
  constructor(private readonly pool: Pool) {}

  async sendAccountEmail(
    type: AccountEmailType,
    email: string,
    token: string,
    staffRole?: "BTC" | "REFEREE",
  ): Promise<void> {
    const configuration = getMailConfiguration();
    const content = createEmailContent(type, token, staffRole);
    const log = await this.pool.query<{ id: string }>(
      `INSERT INTO email_delivery_logs (recipient, message_type, status)
       VALUES ($1, $2, 'PENDING')
       RETURNING id`,
      [email, type],
    );
    const logId = log.rows[0]?.id;
    if (!logId) {
      throw new AppError(500, "Could not record email delivery attempt", "EMAIL_LOG_FAILED");
    }

    const transport = nodemailer.createTransport(configuration);
    try {
      const result = await transport.sendMail({
        from: config.mailFromName
          ? { name: config.mailFromName, address: config.mailFrom }
          : config.mailFrom,
        to: email,
        ...content,
      });
      await this.pool.query(
        `UPDATE email_delivery_logs
         SET status = 'SENT', provider_message_id = $2, updated_at = NOW()
         WHERE id = $1`,
        [logId, result.messageId.slice(0, 255)],
      );
    } catch (error) {
      const code = safeErrorCode(error);
      await this.pool.query(
        `UPDATE email_delivery_logs
         SET status = 'FAILED', error_code = $2, updated_at = NOW()
         WHERE id = $1`,
        [logId, code],
      );
      console.error("[notification-service] account email delivery failed", { code });
      throw new AppError(
        502,
        "Could not deliver the email. Check SMTP settings and try again.",
        "EMAIL_DELIVERY_FAILED",
      );
    } finally {
      transport.close();
    }
  }
}
