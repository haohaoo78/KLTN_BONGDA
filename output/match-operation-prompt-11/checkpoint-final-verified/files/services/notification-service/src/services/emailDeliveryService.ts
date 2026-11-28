import type { Pool } from "pg";
import { createHash } from "node:crypto";
import nodemailer from "nodemailer";
import addressparser from "nodemailer/lib/addressparser";
import { AppError } from "../lib/errors";
import { config } from "../config";

export type AccountEmailType = "verification" | "password_reset" | "account_activation" | "email_change";
export type TournamentInvitationEmailInput = {
  email: string;
  fullName: string;
  teamName: string;
  tournamentName: string;
  invitationId: string;
  expiresAt: string;
};

export type RefereeTeamAccessEmailInput = {
  eventKey: string;
  email: string;
  fullName: string;
  tournamentName: string;
  accessType: "login" | "account_activation" | "verification";
  token?: string;
};
export type RefereeTeamAccessEmailResult = {
  status: "PENDING" | "SENT" | "FAILED";
  errorCode?: string;
  sentAt?: string;
};

export interface RefereeAssignmentEmailInput {
  eventKey: string; email: string; fullName: string; tournamentId: string; tournamentName: string;
  matchId: string; matchLabel: string; position: string; scheduledAt: string; venueName: string; location: string;
  kind: "PUBLISHED" | "REPLACED_IN" | "REPLACED_OUT"; reason?: string;
}

export function refereeAssignmentEmailContent(input: RefereeAssignmentEmailInput) {
  const link = new URL("/referee", config.clientUrl);
  link.searchParams.set("match", input.matchId);
  const removed = input.kind === "REPLACED_OUT";
  const title = removed ? "Thông báo thay thế trọng tài" : "Công bố phân công trọng tài";
  const lines = [`Xin chào ${input.fullName},`, title, `Giải: ${input.tournamentName}`, `Trận: ${input.matchLabel} (${input.matchId})`,
    `Vị trí: ${input.position}`, `Ngày giờ: ${new Date(input.scheduledAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}`,
    `Sân: ${input.venueName}`, `Địa điểm: ${input.location || input.venueName}`,
    ...(removed ? ["BTC đã thay thế bạn ở vị trí này; quyền điều hành tương ứng đã được cập nhật."] : ["Đây là phân công chính thức; không cần xác nhận nhận việc."]),
    ...(input.reason ? [`Lý do thay thế: ${input.reason}`] : []), `Đăng nhập tài khoản hiện có để xem nhiệm vụ: ${link.toString()}`];
  return { subject: `${title} · ${input.tournamentName} — Sân Cỏ`, text: lines.join("\n"),
    html: `<!doctype html><html lang="vi"><body style="font-family:Arial,sans-serif;color:#203c2d"><main style="max-width:620px;margin:32px auto;padding:24px;border:1px solid #dce7dd;border-radius:12px"><h1 style="font-size:24px">${title}</h1>${lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}<a href="${escapeHtml(link.toString())}">Xem nhiệm vụ trên Sân Cỏ</a></main></body></html>` };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  })[character] ?? character);
}

function getMailConfiguration() {
  if (config.mailDeliveryMode === "disabled") {
    throw new AppError(503, "Email delivery is disabled in the isolated test environment", "EMAIL_DELIVERY_DISABLED");
  }
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

function safeSmtpDiagnostic(error: unknown): Record<string, string | number> {
  if (typeof error !== "object" || !error) return {};
  const fields = error as { responseCode?: unknown; command?: unknown; response?: unknown };
  const command = typeof fields.command === "string" ? fields.command.toUpperCase() : "";
  const enhancedCode = typeof fields.response === "string" ? fields.response.match(/\b[245]\.\d{1,3}\.\d{1,3}\b/)?.[0] : undefined;
  return {
    ...(typeof fields.responseCode === "number" && Number.isInteger(fields.responseCode) ? { smtpResponseCode: fields.responseCode } : {}),
    ...(["API", "MAIL FROM", "RCPT TO", "DATA", "CONN", "AUTH PLAIN", "AUTH LOGIN"].includes(command) ? { smtpCommand: command } : {}),
    ...(enhancedCode ? { smtpEnhancedCode: enhancedCode } : {}),
  };
}

function getMailSender(): { name: string; address: string } {
  // MAIL_FROM / EMAIL_FROM may use the standard "Display name <mailbox>" form.
  // An Address object's address field must contain only the mailbox itself.
  const senders = addressparser(config.mailFrom);
  const sender = senders[0];
  if (/[\r\n]/.test(config.mailFrom) || senders.length !== 1 || !sender || !("address" in sender) || typeof sender.address !== "string" ||
      !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(sender.address)) {
    throw new AppError(503, "MAIL_FROM must contain one valid sender email address", "EMAIL_DELIVERY_NOT_CONFIGURED");
  }
  return { name: config.mailFromName || sender.name || "", address: sender.address };
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

  async sendRefereeAssignmentEmail(input: RefereeAssignmentEmailInput): Promise<RefereeTeamAccessEmailResult> {
    const fingerprint = createHash("sha256").update(JSON.stringify(input, Object.keys(input).filter((key) => key !== "eventKey").sort())).digest("hex");
    const claim = await this.pool.query(`INSERT INTO referee_assignment_email_deliveries(event_key,recipient,payload_hash,status)
      VALUES($1,$2,$3,'PENDING') ON CONFLICT(event_key) DO NOTHING RETURNING event_key`, [input.eventKey, input.email, fingerprint]);
    const read = async (): Promise<RefereeTeamAccessEmailResult> => {
      const row = (await this.pool.query("SELECT * FROM referee_assignment_email_deliveries WHERE event_key=$1", [input.eventKey])).rows[0];
      if (!row || row.payload_hash !== fingerprint) throw new AppError(409, "Email event belongs to another request", "IDEMPOTENCY_CONFLICT");
      return { status: row.status, ...(row.error_code ? { errorCode: row.error_code } : {}), ...(row.sent_at ? { sentAt: new Date(row.sent_at).toISOString() } : {}) };
    };
    if (!claim.rowCount) return read();
    let transport: ReturnType<typeof nodemailer.createTransport> | undefined;
    let started = false, accepted = false;
    try {
      transport = nodemailer.createTransport(getMailConfiguration());
      const content = refereeAssignmentEmailContent(input);
      const from = getMailSender(); started = true;
      const result = await transport.sendMail({ from, to: input.email, ...content });
      if (!(result.accepted ?? []).some((to: string | { address: string }) => (typeof to === "string" ? to : to.address).toLowerCase() === input.email.toLowerCase())) {
        throw new AppError(502, "SMTP did not accept the recipient", "SMTP_RECIPIENT_REJECTED");
      }
      accepted = true;
      await this.pool.query("UPDATE referee_assignment_email_deliveries SET status='SENT',sent_at=NOW(),provider_message_id=$2,error_code=NULL,updated_at=NOW() WHERE event_key=$1", [input.eventKey, String(result.messageId ?? "").slice(0, 255)]);
    } catch (error) {
      const diagnostic = safeSmtpDiagnostic(error), code = safeErrorCode(error);
      const definiteFailure = !started || ["EAUTH", "SMTP_RECIPIENT_REJECTED"].includes(code) || Number(diagnostic.smtpResponseCode) >= 400;
      if (accepted || !definiteFailure) {
        await this.pool.query("UPDATE referee_assignment_email_deliveries SET error_code='EMAIL_STATUS_UNCERTAIN',updated_at=NOW() WHERE event_key=$1", [input.eventKey]);
      } else {
        await this.pool.query("UPDATE referee_assignment_email_deliveries SET status='FAILED',error_code=$2,updated_at=NOW() WHERE event_key=$1", [input.eventKey, code]);
      }
      console.error("[notification-service] referee assignment email outcome", { code, ...diagnostic, uncertain: accepted || !definiteFailure });
    } finally { transport?.close(); }
    return read();
  }

  async sendRefereeTeamAccessEmail(input: RefereeTeamAccessEmailInput): Promise<RefereeTeamAccessEmailResult> {
    // A delivery event is claimed once, before SMTP. A timeout/reload must never send it again.
    // Tokens deliberately never enter this ledger, logs or any public API response.
    const fingerprint = createHash("sha256").update(JSON.stringify([
      input.email.toLowerCase(), input.fullName, input.tournamentName, input.accessType,
    ])).digest("hex");
    const claim = await this.pool.query(
      `INSERT INTO referee_access_email_deliveries(event_key, recipient, payload_hash, status)
       VALUES ($1, $2, $3, 'PENDING') ON CONFLICT (event_key) DO NOTHING RETURNING event_key`,
      [input.eventKey, input.email, fingerprint],
    );
    const readResult = async (): Promise<RefereeTeamAccessEmailResult> => {
      const result = await this.pool.query<{
        payload_hash: string; status: RefereeTeamAccessEmailResult["status"];
        error_code: string | null; sent_at: Date | string | null;
      }>(`SELECT payload_hash, status, error_code, sent_at FROM referee_access_email_deliveries WHERE event_key=$1`, [input.eventKey]);
      const row = result.rows[0];
      if (!row) throw new AppError(500, "Could not read email delivery status", "EMAIL_LOG_FAILED");
      if (row.payload_hash !== fingerprint) throw new AppError(409, "Email event already belongs to another request", "IDEMPOTENCY_CONFLICT");
      return { status: row.status, ...(row.error_code ? { errorCode: row.error_code } : {}),
        ...(row.sent_at ? { sentAt: new Date(row.sent_at).toISOString() } : {}) };
    };
    if (!claim.rowCount) return readResult();

    let transport: ReturnType<typeof nodemailer.createTransport> | undefined;
    let smtpAccepted = false;
    try {
      const configuration = getMailConfiguration();
      const link = new URL("/", config.clientUrl);
      const needsAccess = input.accessType !== "login";
      if (needsAccess) link.searchParams.set(input.accessType === "account_activation" ? "activate" : "verify", input.token!);
      else link.hash = "login";
      const url = link.toString();
      const action = input.accessType === "account_activation" ? "Thiết lập mật khẩu và kích hoạt"
        : input.accessType === "verification" ? "Xác minh email" : "Đăng nhập hệ thống";
      const intro = `BTC đã thêm bạn vào đội ngũ trọng tài của giải ${input.tournamentName}. Đây là thông báo sử dụng hệ thống; bạn không cần xác nhận nhận việc.`;
      const guidance = needsAccess
        ? `${action} bằng liên kết an toàn bên dưới (có hiệu lực 24 giờ). Bạn cần tài khoản hoạt động và email đã xác minh để điều hành trận đấu.`
        : "Sử dụng tài khoản hiện có để đăng nhập. Các vai trò khác của bạn được giữ nguyên.";
      transport = nodemailer.createTransport(configuration);
      const result = await transport.sendMail({
        from: getMailSender(),
        to: input.email,
        subject: `Đội ngũ trọng tài · ${input.tournamentName} — Sân Cỏ`,
        text: [`Xin chào ${input.fullName},`, "", intro, guidance, "", `${action}: ${url}`].join("\n"),
        html: `<!doctype html><html lang="vi"><body style="margin:0;background:#f4f6f1;font-family:Arial,sans-serif;color:#17241f"><div style="max-width:560px;margin:32px auto;padding:32px;background:#fff;border:1px solid #e7eae4;border-radius:12px"><p style="color:#157449;font-size:12px;font-weight:bold">SÂN CỎ · ĐỘI NGŨ TRỌNG TÀI</p><h1 style="font-size:24px">Thông báo sử dụng hệ thống</h1><p>Xin chào ${escapeHtml(input.fullName)},</p><p style="line-height:1.6">${escapeHtml(intro)}</p><p style="line-height:1.6">${escapeHtml(guidance)}</p><p style="margin:28px 0"><a href="${escapeHtml(url)}" style="display:inline-block;padding:13px 20px;border-radius:8px;background:#157449;color:#fff;text-decoration:none;font-weight:bold">${action}</a></p><p style="font-size:12px;word-break:break-all"><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p></div></body></html>`,
      });
      const accepted = (result.accepted ?? []).some((recipient: string | { address: string }) =>
        (typeof recipient === "string" ? recipient : recipient.address).toLowerCase() === input.email.toLowerCase());
      if (!accepted) throw new AppError(502, "SMTP did not accept the recipient", "SMTP_RECIPIENT_REJECTED");
      smtpAccepted = true;
      await this.pool.query(
        `UPDATE referee_access_email_deliveries SET status='SENT', error_code=NULL, provider_message_id=$2,
          sent_at=NOW(), updated_at=NOW() WHERE event_key=$1`,
        [input.eventKey, String(result.messageId ?? "").slice(0, 255)],
      );
    } catch (error) {
      // If SMTP accepted but persistence failed, leave PENDING: delivery is uncertain and must not be repeated automatically.
      if (smtpAccepted) throw new AppError(502, "SMTP accepted the email but its persisted status is uncertain", "EMAIL_STATUS_UNCERTAIN");
      const code = safeErrorCode(error);
      await this.pool.query(
        `UPDATE referee_access_email_deliveries SET status='FAILED', error_code=$2, updated_at=NOW() WHERE event_key=$1`,
        [input.eventKey, code],
      );
      // Keep useful SMTP diagnostics without logging addresses, credentials, links or provider message text.
      console.error("[notification-service] referee access email failed", { code, ...safeSmtpDiagnostic(error) });
    } finally {
      transport?.close();
    }
    return readResult();
  }

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
        from: getMailSender(),
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

  async sendTournamentInvitationEmail(input: TournamentInvitationEmailInput): Promise<void> {
    const configuration = getMailConfiguration();
    const link = new URL("/player", config.clientUrl);
    link.searchParams.set("invitation", input.invitationId);
    const url = link.toString();
    const safeName = escapeHtml(input.fullName);
    const safeTeamName = escapeHtml(input.teamName);
    const safeTournamentName = escapeHtml(input.tournamentName);
    const expiry = new Date(input.expiresAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
    const intro = `${input.fullName}, đội ${input.teamName} mời bạn tham gia giải ${input.tournamentName}. Đăng nhập để xem thông tin lời mời, vai trò, vị trí và số áo dự kiến rồi xác nhận.`;
    const content = {
      subject: `${input.teamName} mời bạn tham gia giải đấu — Sân Cỏ`,
      text: [
        `Xin chào ${input.fullName},`,
        "",
        intro,
        `Đội bóng: ${input.teamName}`,
        `Giải đấu: ${input.tournamentName}`,
        `Hạn phản hồi: ${expiry}`,
        "",
        `Mở lời mời: ${url}`,
        "",
        "Nếu bạn chưa đăng nhập, hãy đăng nhập tài khoản cầu thủ rồi lời mời sẽ được mở tự động.",
      ].join("\n"),
      html: `<!doctype html><html lang="vi"><body style="margin:0;background:#f4f6f1;font-family:Arial,sans-serif;color:#17241f"><div style="max-width:560px;margin:32px auto;padding:32px;background:#fff;border:1px solid #e7eae4;border-radius:12px"><p style="color:#157449;font-size:12px;font-weight:bold;letter-spacing:2px">SÂN CỎ · STUDENT FOOTBALL</p><h1 style="font-size:24px">Lời mời tham gia giải đấu</h1><p style="line-height:1.6;color:#59645d">Xin chào ${safeName}, đội <strong>${safeTeamName}</strong> mời bạn tham gia giải <strong>${safeTournamentName}</strong>. Đăng nhập để xem vai trò, vị trí và số áo dự kiến trước khi phản hồi.</p><p style="font-size:14px;color:#59645d">Hạn phản hồi: <strong>${escapeHtml(expiry)}</strong></p><p style="margin:28px 0"><a href="${escapeHtml(url)}" style="display:inline-block;padding:13px 20px;border-radius:8px;background:#157449;color:#fff;text-decoration:none;font-weight:bold">Mở lời mời và xác nhận</a></p><p style="font-size:12px;color:#78827c;line-height:1.6">Nếu nút không hoạt động, hãy mở liên kết này:<br><a href="${escapeHtml(url)}" style="color:#157449;word-break:break-all">${escapeHtml(url)}</a></p><p style="font-size:12px;color:#78827c">Nếu bạn không quen biết đội bóng này, hãy bỏ qua email.</p></div></body></html>`,
    };
    const log = await this.pool.query<{ id: string }>(
      `INSERT INTO email_delivery_logs (recipient, message_type, status)
       VALUES ($1, 'tournament_invitation', 'PENDING') RETURNING id`,
      [input.email],
    );
    const logId = log.rows[0]?.id;
    if (!logId) throw new AppError(500, "Could not record email delivery attempt", "EMAIL_LOG_FAILED");
    const transport = nodemailer.createTransport(configuration);
    try {
      const result = await transport.sendMail({
        from: getMailSender(),
        to: input.email,
        ...content,
      });
      await this.pool.query(
        `UPDATE email_delivery_logs SET status='SENT', provider_message_id=$2, updated_at=NOW() WHERE id=$1`,
        [logId, result.messageId.slice(0, 255)],
      );
    } catch (error) {
      const code = safeErrorCode(error);
      await this.pool.query(
        `UPDATE email_delivery_logs SET status='FAILED', error_code=$2, updated_at=NOW() WHERE id=$1`,
        [logId, code],
      );
      console.error("[notification-service] tournament invitation email delivery failed", { code });
      throw new AppError(502, "Could not deliver the invitation email. The in-app notification remains available.", "EMAIL_DELIVERY_FAILED");
    } finally {
      transport.close();
    }
  }
}
