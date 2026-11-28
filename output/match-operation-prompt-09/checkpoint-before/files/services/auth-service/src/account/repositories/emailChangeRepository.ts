import { createHash } from "node:crypto";
import { AppError } from "../../lib/errors";
import { getPool } from "../lib/db";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createEmailChangeRequest(input: {
  userId: string;
  email: string;
  token: string;
  expiresAt: Date;
}): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const account = await client.query<{ email: string; email_verified: boolean; is_active: boolean }>(
      "SELECT email, email_verified, is_active FROM users WHERE id = $1 FOR UPDATE",
      [input.userId],
    );
    if (!account.rowCount || !account.rows[0].is_active || !account.rows[0].email_verified) {
      throw new AppError(403, "An active verified account is required", "ACCOUNT_NOT_VERIFIED");
    }
    if (account.rows[0].email.toLowerCase() === input.email.toLowerCase()) {
      throw new AppError(409, "The new email is already your current email", "EMAIL_UNCHANGED");
    }
    const recentRequest = await client.query(
      `SELECT 1 FROM email_change_requests
       WHERE user_id = $1 AND created_at > NOW() - INTERVAL '1 minute'
       LIMIT 1`,
      [input.userId],
    );
    if (recentRequest.rowCount) {
      throw new AppError(429, "Wait a minute before requesting another email change", "EMAIL_CHANGE_RATE_LIMITED");
    }
    await client.query(
      `UPDATE email_change_requests
       SET used_at = NOW()
       WHERE LOWER(new_email) = LOWER($1) AND used_at IS NULL AND expires_at <= NOW()`,
      [input.email],
    );
    const inUse = await client.query(
      "SELECT 1 FROM users WHERE LOWER(email) = LOWER($1) AND id <> $2",
      [input.email, input.userId],
    );
    if (inUse.rowCount) {
      throw new AppError(409, "This email address is already in use", "EMAIL_ALREADY_EXISTS");
    }
    await client.query(
      `UPDATE email_change_requests
       SET used_at = NOW()
       WHERE user_id = $1 AND used_at IS NULL`,
      [input.userId],
    );
    await client.query(
      `INSERT INTO email_change_requests (user_id, new_email, token_hash, expires_at)
       VALUES ($1, LOWER($2), $3, $4)`,
      [input.userId, input.email, hashToken(input.token), input.expiresAt],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "23505") {
      throw new AppError(409, "This email address already has a pending verification", "EMAIL_CHANGE_PENDING");
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function expireEmailChangeRequest(userId: string, token: string): Promise<void> {
  await getPool().query(
    `UPDATE email_change_requests SET used_at = NOW()
     WHERE user_id = $1 AND token_hash = $2 AND used_at IS NULL`,
    [userId, hashToken(token)],
  );
}

export async function confirmEmailChange(token: string): Promise<string> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const request = await client.query<{ id: string; user_id: string; new_email: string }>(
      `SELECT id, user_id, new_email FROM email_change_requests
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
       FOR UPDATE`,
      [hashToken(token)],
    );
    if (!request.rowCount) {
      throw new AppError(400, "Invalid or expired email-change link", "INVALID_TOKEN");
    }
    const item = request.rows[0];
    const user = await client.query(
      "SELECT id FROM users WHERE id = $1 AND is_active = TRUE FOR UPDATE",
      [item.user_id],
    );
    if (!user.rowCount) {
      throw new AppError(404, "Account is unavailable", "ACCOUNT_UNAVAILABLE");
    }
    const duplicate = await client.query(
      "SELECT 1 FROM users WHERE LOWER(email) = LOWER($1) AND id <> $2",
      [item.new_email, item.user_id],
    );
    if (duplicate.rowCount) {
      throw new AppError(409, "This email address is already in use", "EMAIL_ALREADY_EXISTS");
    }
    await client.query(
      `UPDATE users SET email = $1, email_verified = TRUE, updated_at = NOW()
       WHERE id = $2`,
      [item.new_email, item.user_id],
    );
    await client.query(
      "UPDATE email_change_requests SET used_at = NOW() WHERE id = $1",
      [item.id],
    );
    await client.query("COMMIT");
    return item.user_id;
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "23505") {
      throw new AppError(409, "This email address is already in use", "EMAIL_ALREADY_EXISTS");
    }
    throw error;
  } finally {
    client.release();
  }
}
