import { getPool } from "../lib/db";

export type ScheduleTestSnapshot = { state: Record<string, unknown>; revision: number; updatedAt: string; diagramVersion: string };

export async function getScheduleTestSnapshot(tournamentId: string): Promise<ScheduleTestSnapshot | null> {
  const result = await getPool().query<{ state: Record<string, unknown>; revision: string; updated_at: Date; diagram_version: string }>(
    "SELECT state,revision,updated_at,diagram_version FROM match_schedule_test_snapshots WHERE tournament_id=$1",
    [tournamentId],
  );
  const row = result.rows[0];
  return row ? { state: row.state, revision: Number(row.revision), updatedAt: row.updated_at.toISOString(), diagramVersion: row.diagram_version } : null;
}

export async function saveScheduleTestSnapshot(
  tournamentId: string,
  diagramVersion: string,
  state: Record<string, unknown>,
  userId: string,
  expectedRevision: number | null,
): Promise<ScheduleTestSnapshot | null> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('schedule-test:' || $1)::bigint)", [tournamentId]);
    const current = await client.query<{ revision: string }>(
      "SELECT revision FROM match_schedule_test_snapshots WHERE tournament_id=$1 FOR UPDATE",
      [tournamentId],
    );
    const currentRevision = current.rows[0] ? Number(current.rows[0].revision) : null;
    if (currentRevision !== expectedRevision) { await client.query("ROLLBACK"); return null; }
    const result = await client.query<{ state: Record<string, unknown>; revision: string; updated_at: Date; diagram_version: string }>(
      `INSERT INTO match_schedule_test_snapshots (tournament_id,diagram_version,state,revision,updated_by)
       VALUES ($1,$2,$3::jsonb,1,$4)
       ON CONFLICT (tournament_id) DO UPDATE SET diagram_version=EXCLUDED.diagram_version,state=EXCLUDED.state,
         revision=match_schedule_test_snapshots.revision+1,updated_by=EXCLUDED.updated_by,updated_at=NOW()
       RETURNING state,revision,updated_at,diagram_version`,
      [tournamentId, diagramVersion, JSON.stringify(state), userId],
    );
    await client.query("COMMIT");
    const row = result.rows[0];
    return { state: row.state, revision: Number(row.revision), updatedAt: row.updated_at.toISOString(), diagramVersion: row.diagram_version };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function deleteScheduleTestSnapshot(tournamentId: string, expectedRevision: number): Promise<boolean> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('schedule-test:' || $1)::bigint)", [tournamentId]);
    const current = await client.query<{ revision: string }>("SELECT revision FROM match_schedule_test_snapshots WHERE tournament_id=$1 FOR UPDATE", [tournamentId]);
    const currentRevision = current.rows[0] ? Number(current.rows[0].revision) : 0;
    if (currentRevision !== expectedRevision) { await client.query("ROLLBACK"); return false; }
    await client.query("DELETE FROM match_schedule_test_snapshots WHERE tournament_id=$1", [tournamentId]);
    await client.query("COMMIT");
    return true;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
