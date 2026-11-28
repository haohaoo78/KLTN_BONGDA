import { getPool } from "../lib/db";

export type DrawTestSnapshot = {
  state: Record<string, unknown>;
  revision: number;
  updatedAt: string;
};

export async function getDrawTestSnapshot(tournamentId: string): Promise<DrawTestSnapshot | null> {
  const result = await getPool().query<{ state: Record<string, unknown>; revision: string; updated_at: Date }>(
    `SELECT state, revision, updated_at FROM tournament_draw_test_snapshots WHERE tournament_id=$1`,
    [tournamentId],
  );
  const row = result.rows[0];
  return row ? { state: row.state, revision: Number(row.revision), updatedAt: row.updated_at.toISOString() } : null;
}

export async function saveDrawTestSnapshot(
  tournamentId: string,
  state: Record<string, unknown>,
  userId: string,
  expectedRevision: number | null,
): Promise<DrawTestSnapshot | null> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('draw-test:' || $1)::bigint)", [tournamentId]);
    await client.query("SELECT id FROM tournaments WHERE id=$1 FOR UPDATE", [tournamentId]);
    const current = await client.query<{ revision: string }>(
      "SELECT revision FROM tournament_draw_test_snapshots WHERE tournament_id=$1 FOR UPDATE",
      [tournamentId],
    );
    const currentRevision = current.rows[0] ? Number(current.rows[0].revision) : null;
    if (currentRevision !== expectedRevision) {
      await client.query("ROLLBACK");
      return null;
    }
    const result = await client.query<{ state: Record<string, unknown>; revision: string; updated_at: Date }>(
      `INSERT INTO tournament_draw_test_snapshots (tournament_id,state,revision,updated_by)
       VALUES ($1,$2::jsonb,1,$3)
       ON CONFLICT (tournament_id) DO UPDATE SET state=EXCLUDED.state,
         revision=tournament_draw_test_snapshots.revision+1, updated_by=EXCLUDED.updated_by, updated_at=NOW()
       RETURNING state,revision,updated_at`,
      [tournamentId, JSON.stringify(state), userId],
    );
    await client.query("COMMIT");
    const row = result.rows[0];
    return { state: row.state, revision: Number(row.revision), updatedAt: row.updated_at.toISOString() };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function deleteDrawTestSnapshot(tournamentId: string): Promise<void> {
  await getPool().query("DELETE FROM tournament_draw_test_snapshots WHERE tournament_id=$1", [tournamentId]);
}
