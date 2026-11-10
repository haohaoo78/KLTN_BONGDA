import { createHash } from "node:crypto";
import type { Pool } from "pg";

export class StaffInvitationRepository {
  constructor(private readonly pool: Pool) {}

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  async create(userId: string, token: string, expiresAt: Date): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE staff_account_invites
         SET expires_at = NOW()
         WHERE user_id = $1 AND used_at IS NULL AND expires_at > NOW()`,
        [userId],
      );
      await client.query(
        `INSERT INTO staff_account_invites (user_id, token_hash, expires_at)
         VALUES ($1, $2, $3)`,
        [userId, this.hashToken(token), expiresAt],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async expire(token: string): Promise<void> {
    await this.pool.query(
      `UPDATE staff_account_invites
       SET expires_at = NOW()
       WHERE token_hash = $1 AND used_at IS NULL`,
      [this.hashToken(token)],
    );
  }

  async activate(token: string, passwordHash: string): Promise<string | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const invitation = await client.query<{ userId: string }>(
        `SELECT user_id AS "userId"
         FROM staff_account_invites
         WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
         FOR UPDATE`,
        [this.hashToken(token)],
      );
      const userId = invitation.rows[0]?.userId;
      if (!userId) {
        await client.query("ROLLBACK");
        return null;
      }

      const updated = await client.query(
        `UPDATE users
         SET password_hash = $2, is_active = TRUE, email_verified = TRUE, updated_at = NOW()
         WHERE id = $1
           AND EXISTS (
             SELECT 1 FROM user_roles
             WHERE user_roles.user_id = users.id
               AND user_roles.role IN ('BTC', 'REFEREE')
           )`,
        [userId, passwordHash],
      );
      if (updated.rowCount !== 1) {
        await client.query("ROLLBACK");
        return null;
      }

      await client.query(
        `UPDATE staff_account_invites
         SET used_at = NOW()
         WHERE user_id = $1 AND used_at IS NULL`,
        [userId],
      );
      await client.query("COMMIT");
      return userId;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
