import { Pool } from "pg";
import { createHash } from "crypto";
import type {
  EmailVerificationRecord,
  RefreshTokenRecord,
} from "../models/auth";

export class AuthRepository {
  constructor(private pool: Pool) {}

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  // Email Verification
  async createEmailVerification(
    userId: string,
    email: string,
    token: string,
    expiresAt: Date,
  ): Promise<EmailVerificationRecord> {
    const result = await this.pool.query<EmailVerificationRecord>(
      `INSERT INTO email_verifications (user_id, email, token, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id, user_id AS "userId", email, token, expires_at AS "expiresAt",
                 verified_at AS "verifiedAt", created_at AS "createdAt", updated_at AS "updatedAt"`,
      [userId, email, this.hashToken(token), expiresAt],
    );
    return result.rows[0];
  }

  async findPendingEmailVerificationByEmail(
    email: string,
  ): Promise<EmailVerificationRecord | null> {
    const result = await this.pool.query<EmailVerificationRecord>(
      `SELECT id, user_id AS "userId", email, token, expires_at AS "expiresAt",
              verified_at AS "verifiedAt", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM email_verifications
       WHERE LOWER(email) = LOWER($1) AND verified_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [email],
    );
    return result.rows[0] ?? null;
  }

  async expirePendingEmailVerifications(email: string): Promise<void> {
    await this.pool.query(
      `UPDATE email_verifications
       SET expires_at = CURRENT_TIMESTAMP
       WHERE LOWER(email) = LOWER($1) AND verified_at IS NULL AND expires_at > CURRENT_TIMESTAMP`,
      [email],
    );
  }

  async getLatestEmailVerificationCreatedAt(email: string): Promise<Date | null> {
    const result = await this.pool.query<{ createdAt: Date }>(
      `SELECT created_at AS "createdAt"
       FROM email_verifications
       WHERE LOWER(email) = LOWER($1)
        AND verified_at IS NULL
        AND expires_at > CURRENT_TIMESTAMP
       ORDER BY created_at DESC
       LIMIT 1`,
      [email],
    );
    return result.rows[0]?.createdAt ?? null;
  }

  async findEmailVerificationByToken(
    token: string,
  ): Promise<EmailVerificationRecord | null> {
    const result = await this.pool.query<EmailVerificationRecord>(
      `SELECT id, user_id AS "userId", email, token, expires_at AS "expiresAt",
              verified_at AS "verifiedAt", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM email_verifications
       WHERE token = $1 AND verified_at IS NULL AND expires_at > CURRENT_TIMESTAMP`,
      [this.hashToken(token)],
    );
    return result.rows[0] || null;
  }

  async verifyEmail(token: string): Promise<EmailVerificationRecord | null> {
    const result = await this.pool.query<EmailVerificationRecord>(
      `UPDATE email_verifications
       SET verified_at = CURRENT_TIMESTAMP
       WHERE token = $1 AND verified_at IS NULL AND expires_at > CURRENT_TIMESTAMP
       RETURNING id, user_id AS "userId", email, token, expires_at AS "expiresAt",
                 verified_at AS "verifiedAt", created_at AS "createdAt", updated_at AS "updatedAt"`,
      [this.hashToken(token)],
    );
    return result.rows[0] || null;
  }

  async findPendingEmailVerificationByUserId(
    userId: string,
  ): Promise<EmailVerificationRecord | null> {
    const result = await this.pool.query<EmailVerificationRecord>(
      `SELECT id, user_id AS "userId", email, token, expires_at AS "expiresAt",
              verified_at AS "verifiedAt", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM email_verifications
       WHERE user_id = $1 AND verified_at IS NULL AND expires_at > CURRENT_TIMESTAMP
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId],
    );
    return result.rows[0] || null;
  }

  // Refresh Tokens
  async createRefreshToken(
    userId: string,
    token: string,
    expiresAt: Date,
  ): Promise<RefreshTokenRecord> {
    const result = await this.pool.query<RefreshTokenRecord>(
      `INSERT INTO refresh_tokens (user_id, token, expires_at)
       VALUES ($1, $2, $3)
       RETURNING id, user_id AS "userId", token, expires_at AS "expiresAt",
                 revoked_at AS "revokedAt", replaced_by_token AS "replacedByToken",
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      [userId, this.hashToken(token), expiresAt],
    );
    return result.rows[0];
  }

  async findRefreshTokenByToken(
    token: string,
  ): Promise<RefreshTokenRecord | null> {
    const result = await this.pool.query<RefreshTokenRecord>(
      `SELECT id, user_id AS "userId", token, expires_at AS "expiresAt",
              revoked_at AS "revokedAt", replaced_by_token AS "replacedByToken",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM refresh_tokens
       WHERE token = $1 AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP`,
      [this.hashToken(token)],
    );
    return result.rows[0] || null;
  }

  async revokeRefreshToken(token: string): Promise<void> {
    await this.pool.query(
      `UPDATE refresh_tokens
       SET revoked_at = CURRENT_TIMESTAMP
       WHERE token = $1`,
      [this.hashToken(token)],
    );
  }

  async revokeAllUserRefreshTokens(userId: string): Promise<void> {
    await this.pool.query(
      `UPDATE refresh_tokens
       SET revoked_at = CURRENT_TIMESTAMP
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
  }

  async rotateRefreshToken(
    oldToken: string,
    newToken: string,
    newExpiresAt: Date,
  ): Promise<RefreshTokenRecord | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{ userId: string }>(
        `UPDATE refresh_tokens
         SET revoked_at = CURRENT_TIMESTAMP, replaced_by_token = $2
         WHERE token = $1 AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP
         RETURNING user_id AS "userId"`,
        [this.hashToken(oldToken), this.hashToken(newToken)],
      );

      if (!result.rows[0]) {
        await client.query("ROLLBACK");
        return null;
      }

      const inserted = await client.query<RefreshTokenRecord>(
        `INSERT INTO refresh_tokens (user_id, token, expires_at)
         VALUES ($1, $2, $3)
         RETURNING id, user_id AS "userId", token, expires_at AS "expiresAt",
                   revoked_at AS "revokedAt", replaced_by_token AS "replacedByToken",
                   created_at AS "createdAt", updated_at AS "updatedAt"`,
        [result.rows[0].userId, this.hashToken(newToken), newExpiresAt],
      );
      await client.query("COMMIT");
      return inserted.rows[0] ?? null;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async cleanupExpiredRecords(): Promise<void> {
    await this.pool.query(
      `DELETE FROM email_verifications
       WHERE expires_at < CURRENT_TIMESTAMP - INTERVAL '30 days'`,
    );

    await this.pool.query(
      `DELETE FROM refresh_tokens
       WHERE expires_at < CURRENT_TIMESTAMP - INTERVAL '30 days'`,
    );
  }
}
