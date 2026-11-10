import { getPool } from "../lib/db";
import { AppError } from "../lib/errors";

export async function listAssignedTournaments(userId: string, includeOwnDrafts = true): Promise<{
  items: Array<{ id: string; name: string; status: string }>;
  total: number;
}> {
  const result = await getPool().query<{ id: string; name: string; status: string }>(
    `SELECT t.id, t.name, t.status
     FROM tournaments t
     JOIN tournament_organizers o ON o.tournament_id = t.id
     WHERE o.user_id = $1
       AND (t.status <> 'DRAFT' OR ($2::boolean AND t.created_by = $1))
     ORDER BY t.start_date DESC NULLS LAST, t.name`,
    [userId, includeOwnDrafts],
  );
  return { items: result.rows, total: result.rowCount ?? 0 };
}

export async function hasTournamentAssignment(
  tournamentId: string,
  userId: string,
): Promise<boolean> {
  const result = await getPool().query(
    "SELECT 1 FROM tournament_organizers WHERE tournament_id = $1 AND user_id = $2",
    [tournamentId, userId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function listTournamentOrganizers(tournamentId: string): Promise<string[]> {
  const result = await getPool().query<{ user_id: string }>(
    `SELECT user_id FROM tournament_organizers
     WHERE tournament_id = $1 ORDER BY assigned_at, user_id`,
    [tournamentId],
  );
  return result.rows.map((row) => row.user_id);
}

export async function assignTournamentOrganizer(
  tournamentId: string,
  userId: string,
  assignedBy: string,
): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query(
      `INSERT INTO tournament_organizers (tournament_id, user_id, assigned_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (tournament_id, user_id) DO NOTHING
       RETURNING user_id`,
      [tournamentId, userId, assignedBy],
    );
    if (inserted.rowCount) {
      await client.query(
        `INSERT INTO tournament_organizer_history (tournament_id, user_id, action, actor_id)
         VALUES ($1, $2, 'ASSIGNED', $3)`,
        [tournamentId, userId, assignedBy],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function removeTournamentOrganizer(
  tournamentId: string,
  userId: string,
  revokedBy: string,
): Promise<boolean> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const tournament = await client.query(
      "SELECT id FROM tournaments WHERE id = $1 FOR UPDATE",
      [tournamentId],
    );
    if (!tournament.rowCount) {
      await client.query("COMMIT");
      return false;
    }
    const assignmentCount = await client.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM tournament_organizers WHERE tournament_id = $1",
      [tournamentId],
    );
    const existing = await client.query(
      "SELECT 1 FROM tournament_organizers WHERE tournament_id = $1 AND user_id = $2",
      [tournamentId, userId],
    );
    if (!existing.rowCount) {
      await client.query("COMMIT");
      return false;
    }
    if (Number(assignmentCount.rows[0]?.count ?? 0) <= 1) {
      throw new AppError(409, "A tournament must retain at least one organizer", "LAST_TOURNAMENT_ORGANIZER");
    }
    await client.query(
      "DELETE FROM tournament_organizers WHERE tournament_id = $1 AND user_id = $2",
      [tournamentId, userId],
    );
    await client.query(
      `INSERT INTO tournament_organizer_history (tournament_id, user_id, action, actor_id)
       VALUES ($1, $2, 'REVOKED', $3)`,
      [tournamentId, userId, revokedBy],
    );
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
