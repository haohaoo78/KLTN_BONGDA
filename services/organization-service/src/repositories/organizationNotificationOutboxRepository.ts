import { getPool } from "../lib/db";

export type OrganizationNotificationInput = {
  userId: string;
  type: "TEAM_MEMBERSHIP" | "TOURNAMENT_INVITATION" | "TOURNAMENT_REGISTRATION" | "SYSTEM";
  title: string; body: string; data?: Record<string, unknown>; idempotencyKey?: string;
};
export type OrganizationNotificationOutboxItem = OrganizationNotificationInput & { id: string; attempts: number };

export async function enqueueOrganizationNotifications(items: OrganizationNotificationInput[]): Promise<void> {
  if (!items.length) return;
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    for (const item of items) await client.query(
      `INSERT INTO organization_notification_outbox(user_id,type,title,body,data,idempotency_key)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6)
       ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
      [item.userId,item.type,item.title,item.body,JSON.stringify(item.data ?? {}),item.idempotencyKey ?? null],
    );
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function claimOrganizationNotification(): Promise<OrganizationNotificationOutboxItem | null> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT id,user_id,type,title,body,data,attempts,idempotency_key FROM organization_notification_outbox
       WHERE (state='PENDING' AND next_attempt_at<=NOW()) OR (state='PROCESSING' AND locked_at<NOW()-INTERVAL '2 minutes')
       ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`,
    );
    if (!result.rowCount) { await client.query("COMMIT"); return null; }
    const row = result.rows[0];
    await client.query("UPDATE organization_notification_outbox SET state='PROCESSING',attempts=attempts+1,locked_at=NOW() WHERE id=$1", [row.id]);
    await client.query("COMMIT");
    return { id: row.id, userId: row.user_id, type: row.type, title: row.title, body: row.body, data: row.data ?? {}, attempts: Number(row.attempts)+1, idempotencyKey: row.idempotency_key ?? undefined };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function completeOrganizationNotification(id: string): Promise<void> {
  await getPool().query(`UPDATE organization_notification_outbox SET state='SENT',delivered_at=NOW(),locked_at=NULL,last_error=NULL WHERE id=$1`,[id]);
}

export async function retryOrganizationNotification(id: string, error: unknown, attempts: number): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const delaySeconds = Math.min(3600, 15 * (2 ** Math.min(attempts - 1, 8)));
  await getPool().query(
    `UPDATE organization_notification_outbox SET state='PENDING',locked_at=NULL,last_error=$2,next_attempt_at=NOW()+($3::text||' seconds')::interval WHERE id=$1`,
    [id,message.slice(0,2000),delaySeconds],
  );
}
