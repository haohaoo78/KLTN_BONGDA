import { Pool, type PoolClient } from "pg";
import { createHash } from "node:crypto";
import type { RefereeAccessDelivery, RefereeAccessEmailInput, RefereeAccountEnsureInput, RefereeAccountEnsureResult, RefereeAccountSummary } from "../models/refereeAccount";
import { AppError } from "../lib/errors";
import { getPool } from "../lib/db";
import { config } from "../config";

let dispatchLockPool: Pool | undefined;
function getDispatchLockPool(): Pool {
  // Dispatch callbacks use the normal account pool to create/read tokens.
  // Waiting advisory-lock connections must not exhaust that same pool.
  return dispatchLockPool ??= new Pool({ connectionString: config.databaseUrl, max: 2, connectionTimeoutMillis: 5_000 });
}
export async function closeRefereeDispatchPool(): Promise<void> {
  const pool = dispatchLockPool; dispatchLockPool = undefined;
  await pool?.end();
}

const accountColumns = `u.id AS "userId", u.email, u.full_name AS "fullName", u.is_active AS "isActive",
  u.email_verified AS "emailVerified", u.account_status AS "accountStatus",
  (SELECT profile_data->>'phone' FROM account_profiles WHERE user_id=u.id) AS phone,
  ARRAY(SELECT role FROM user_roles WHERE user_id=u.id ORDER BY role) AS roles`;
const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function assertRefereeAccountAvailable(account: RefereeAccountSummary): void {
  if (account.accountStatus !== "ACTIVE" || (!account.isActive && account.emailVerified)) {
    throw new AppError(409, "Tài khoản đã bị khóa hoặc vô hiệu hóa; không thể thêm quyền trọng tài.", "REFEREE_ACCOUNT_UNAVAILABLE");
  }
}

export class RefereeAccountRepository {
  constructor(private readonly pool: Pool = getPool()) {}

  async findByEmail(email: string): Promise<RefereeAccountSummary | null> {
    const result = await this.pool.query<RefereeAccountSummary>(`SELECT ${accountColumns} FROM users u WHERE LOWER(u.email)=LOWER($1)`, [email]);
    return result.rows[0] ?? null;
  }

  async resolve(userIds: string[]): Promise<RefereeAccountSummary[]> {
    if (!userIds.length) return [];
    return (await this.pool.query<RefereeAccountSummary>(`SELECT ${accountColumns} FROM users u WHERE u.id=ANY($1::uuid[]) ORDER BY u.id`, [userIds])).rows;
  }

  private async account(client: PoolClient, userId: string): Promise<RefereeAccountSummary> {
    const result = await client.query<RefereeAccountSummary>(`SELECT ${accountColumns} FROM users u WHERE u.id=$1`, [userId]);
    if (!result.rows[0]) throw new AppError(404, "Account not found", "ACCOUNT_NOT_FOUND");
    return result.rows[0];
  }

  async ensure(input: RefereeAccountEnsureInput, placeholderPasswordHash: string): Promise<RefereeAccountEnsureResult> {
    const client = await this.pool.connect();
    const requestHash = fingerprint([input.email, input.fullName ?? null, input.phone ?? null]);
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [`referee-request:${input.actorUserId}:${input.tournamentId}:${input.idempotencyKey}`]);
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [`referee-account:${input.email}`]);
      const previous = await client.query<{ userId: string; requestHash: string; created: boolean; roleAdded: boolean }>(
        `SELECT user_id AS "userId", request_hash AS "requestHash", account_created AS created, role_added AS "roleAdded"
         FROM referee_account_requests WHERE actor_user_id=$1 AND tournament_id=$2 AND idempotency_key=$3 FOR UPDATE`,
        [input.actorUserId, input.tournamentId, input.idempotencyKey]);
      if (previous.rows[0]) {
        const row = previous.rows[0];
        if (row.requestHash !== requestHash) throw new AppError(409, "Idempotency key was already used for another account request", "IDEMPOTENCY_KEY_REUSED");
        const account = await this.account(client, row.userId);
        assertRefereeAccountAvailable(account);
        await client.query("COMMIT");
        return { account, created: row.created, roleAdded: row.roleAdded };
      }
      const existing = await client.query<{ id: string }>("SELECT id FROM users WHERE LOWER(email)=LOWER($1) FOR UPDATE", [input.email]);
      let userId = existing.rows[0]?.id;
      let created = false;
      if (!userId) {
        if (!input.fullName) throw new AppError(400, "Họ tên bắt buộc khi tạo tài khoản trọng tài mới.", "REFEREE_FULL_NAME_REQUIRED");
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO users(email,password_hash,full_name,student_id,institution_id,is_active,email_verified,account_status)
           VALUES($1,$2,$3,NULL,NULL,FALSE,FALSE,'ACTIVE') ON CONFLICT DO NOTHING RETURNING id`,
          [input.email, placeholderPasswordHash, input.fullName]);
        userId = inserted.rows[0]?.id;
        created = Boolean(userId);
        if (!userId) userId = (await client.query<{ id: string }>("SELECT id FROM users WHERE LOWER(email)=LOWER($1) FOR UPDATE", [input.email])).rows[0]?.id;
        if (!userId) throw new AppError(409, "Account changed concurrently; retry the request", "ACCOUNT_REVISION_CONFLICT");
        if (created && input.phone) await client.query("INSERT INTO account_profiles(user_id,profile_data) VALUES($1,$2::jsonb)", [userId, JSON.stringify({ phone: input.phone })]);
      }
      const before = await this.account(client, userId);
      assertRefereeAccountAvailable(before);
      const added = await client.query("INSERT INTO user_roles(user_id,role) VALUES($1,'REFEREE') ON CONFLICT DO NOTHING", [userId]);
      const roleAdded = added.rowCount === 1;
      if (created || roleAdded) await client.query(
        `INSERT INTO account_profile_history(user_id,changes) VALUES($1,$2::jsonb)`,
        [userId, JSON.stringify({ action: created ? "REFEREE_ACCOUNT_PROVISIONED" : "REFEREE_ROLE_ADDED", actorUserId: input.actorUserId, tournamentId: input.tournamentId, before: { roles: before.roles }, after: { roles: [...new Set([...before.roles, "REFEREE"])] } })]);
      await client.query(`INSERT INTO referee_account_requests(actor_user_id,tournament_id,idempotency_key,request_hash,user_id,account_created,role_added) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [input.actorUserId, input.tournamentId, input.idempotencyKey, requestHash, userId, created, roleAdded]);
      const account = await this.account(client, userId);
      await client.query("COMMIT");
      return { account, created, roleAdded };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  async reserveDelivery(input: RefereeAccessEmailInput): Promise<{ reserved: boolean; delivery: RefereeAccessDelivery }> {
    const requestHash = fingerprint([input.actorUserId, input.tournamentId, input.userId, input.tournamentName]);
    const inserted = await this.pool.query(`INSERT INTO referee_account_access_deliveries(event_key,actor_user_id,tournament_id,user_id,request_hash,status)
      VALUES($1,$2,$3,$4,$5,'PENDING') ON CONFLICT DO NOTHING`, [input.eventKey, input.actorUserId, input.tournamentId, input.userId, requestHash]);
    if (inserted.rowCount === 1) return { reserved: true, delivery: { status: "PENDING" } };
    const previous = await this.pool.query<{ requestHash: string; status: RefereeAccessDelivery["status"]; errorCode: string | null; sentAt: Date | null }>(
      `SELECT request_hash AS "requestHash",status,error_code AS "errorCode",sent_at AS "sentAt" FROM referee_account_access_deliveries WHERE event_key=$1`, [input.eventKey]);
    const row = previous.rows[0];
    if (!row || row.requestHash !== requestHash) throw new AppError(409, "Event key was already used for another delivery", "IDEMPOTENCY_KEY_REUSED");
    return { reserved: false, delivery: { status: row.status, ...(row.errorCode ? { errorCode: row.errorCode } : {}), ...(row.sentAt ? { sentAt: row.sentAt.toISOString() } : {}) } };
  }

  async withAccessDispatchLock<T>(userId: string, dispatch: () => Promise<T>): Promise<T> {
    const client = await getDispatchLockPool().connect();
    try {
      await client.query("BEGIN");
      // Keep token creation and its SMTP attempt ordered for one recipient.
      // No account row lock is held while the notification service is called.
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [`referee-access:${userId}`]);
      const result = await dispatch();
      await client.query("COMMIT");
      return result;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  async completeDelivery(eventKey: string, delivery: RefereeAccessDelivery): Promise<void> {
    await this.pool.query(`UPDATE referee_account_access_deliveries SET status=$2,error_code=$3,sent_at=$4,updated_at=NOW() WHERE event_key=$1 AND status='PENDING'`,
      [eventKey, delivery.status, delivery.errorCode ?? null, delivery.status === "SENT" ? delivery.sentAt ?? new Date().toISOString() : null]);
  }
}
