import { getSchedulingPool } from "../../lib/db";

export type ScheduleResourcePreset = { state: Record<string, unknown>; version: number; updatedAt: string };

export async function getScheduleResourcePreset(managerUserId: string): Promise<ScheduleResourcePreset | null> {
  const result = await getSchedulingPool().query<{ state: Record<string, unknown>; version: string; updated_at: Date }>(
    "SELECT state,version,updated_at FROM match_schedule_resource_presets WHERE manager_user_id=$1",
    [managerUserId],
  );
  const row = result.rows[0];
  return row ? { state: row.state, version: Number(row.version), updatedAt: row.updated_at.toISOString() } : null;
}

export async function saveScheduleResourcePreset(
  managerUserId: string,
  state: Record<string, unknown>,
  expectedVersion: number,
): Promise<ScheduleResourcePreset | null> {
  const client = await getSchedulingPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('schedule-resource-preset:' || $1)::bigint)", [managerUserId]);
    const current = await client.query<{ version: string }>(
      "SELECT version FROM match_schedule_resource_presets WHERE manager_user_id=$1 FOR UPDATE",
      [managerUserId],
    );
    const version = current.rows[0] ? Number(current.rows[0].version) : 0;
    if (version !== expectedVersion) { await client.query("ROLLBACK"); return null; }
    const saved = await client.query<{ state: Record<string, unknown>; version: string; updated_at: Date }>(
      `INSERT INTO match_schedule_resource_presets (manager_user_id,state,version,updated_at)
       VALUES ($1,$2::jsonb,1,NOW())
       ON CONFLICT (manager_user_id) DO UPDATE SET state=EXCLUDED.state,
         version=match_schedule_resource_presets.version+1,updated_at=NOW()
       RETURNING state,version,updated_at`,
      [managerUserId, JSON.stringify(state)],
    );
    await client.query("COMMIT");
    const row = saved.rows[0];
    return { state: row.state, version: Number(row.version), updatedAt: row.updated_at.toISOString() };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
