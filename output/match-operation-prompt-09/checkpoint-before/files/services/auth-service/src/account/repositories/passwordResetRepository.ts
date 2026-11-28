import { Pool } from "pg";
import { createHash } from "crypto";
import type { PasswordResetRecord } from "../models/user";

export class PasswordResetRepository {
  constructor(private pool: Pool) {}

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  async createPasswordReset(
    userId: string,
    token: string,
    expiresAt: Date,
  ): Promise<PasswordResetRecord> {
    const result = await this.pool.query<PasswordResetRecord>(
      `INSERT INTO password_resets (user_id, token, expires_at)
       VALUES ($1, $2, $3)
       RETURNING id, user_id AS "userId", token, expires_at AS "expiresAt",
                 used_at AS "usedAt", created_at AS "createdAt", updated_at AS "updatedAt"`,
      [userId, this.hashToken(token), expiresAt],
    );
    return result.rows[0];
  }

  async findPasswordResetByToken(
    token: string,
  ): Promise<PasswordResetRecord | null> {
    const result = await this.pool.query<PasswordResetRecord>(
      `SELECT id, user_id AS "userId", token, expires_at AS "expiresAt",
              used_at AS "usedAt", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM password_resets
       WHERE token = $1 AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP`,
      [this.hashToken(token)],
    );
    return result.rows[0] || null;
  }

  async resetPassword(token: string, passwordHash: string): Promise<string | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const reset = await client.query<{ userId: string }>(
        `UPDATE password_resets
         SET used_at = CURRENT_TIMESTAMP
         WHERE token = $1 AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP
         RETURNING user_id AS "userId"`,
        [this.hashToken(token)],
      );
      if (!reset.rows[0]) {
        await client.query("ROLLBACK");
        return null;
      }

      await client.query(
        "UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
        [passwordHash, reset.rows[0].userId],
      );
      await client.query("COMMIT");
      return reset.rows[0].userId;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeAllUserPasswordResets(userId: string): Promise<void> {
    await this.pool.query(
      `UPDATE password_resets
       SET used_at = CURRENT_TIMESTAMP
       WHERE user_id = $1 AND used_at IS NULL`,
      [userId],
    );
  }

  async cleanupExpiredRecords(): Promise<void> {
    await this.pool.query(
      `DELETE FROM password_resets
       WHERE expires_at < CURRENT_TIMESTAMP - INTERVAL '30 days'`,
    );
  }
}
