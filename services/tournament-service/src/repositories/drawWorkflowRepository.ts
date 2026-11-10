import { getPool } from "../lib/db";
import type {
  DrawGroup,
  DrawPlanInput,
  DrawVersion,
  DrawWorkflowStatus,
} from "../models/drawWorkflow";
import type { PoolClient } from "pg";

type VersionRow = {
  id: string;
  tournament_id: string;
  version: number;
  status: DrawWorkflowStatus;
  method: DrawVersion["method"];
  config: Record<string, unknown>;
  change_reason: string | null;
  created_by: string;
  created_at: string;
  confirmed_by: string | null;
  confirmed_at: string | null;
  published_by: string | null;
  published_at: string | null;
};

async function loadGroups(drawVersionId: string, client?: PoolClient): Promise<DrawGroup[]> {
  const pool = getPool();
  const groupQuery = `SELECT id, name, max_teams FROM tournament_draw_groups
     WHERE draw_version_id = $1 ORDER BY name`;
  const assignmentQuery = `SELECT team_id, group_id, position, seed_group
     FROM tournament_draw_assignments
     WHERE draw_version_id = $1
     ORDER BY group_id, position`;
  const groupResult = client
    ? await client.query<{ id: string; name: string; max_teams: number }>(groupQuery, [drawVersionId])
    : await pool.query<{ id: string; name: string; max_teams: number }>(groupQuery, [drawVersionId]);
  const assignmentResult = client
    ? await client.query<{
        team_id: string;
        group_id: string;
        position: number;
        seed_group: number | null;
      }>(assignmentQuery, [drawVersionId])
    : await pool.query<{
        team_id: string;
        group_id: string;
        position: number;
        seed_group: number | null;
      }>(assignmentQuery, [drawVersionId]);
  return groupResult.rows.map((group) => ({
    id: group.id,
    name: group.name,
    maxTeams: group.max_teams,
    assignments: assignmentResult.rows
      .filter((assignment) => assignment.group_id === group.id)
      .map((assignment) => ({
        teamId: assignment.team_id,
        groupId: assignment.group_id,
        groupName: group.name,
        position: assignment.position,
        seedGroup: assignment.seed_group,
      })),
  }));
}

function mapVersion(row: VersionRow, groups: DrawGroup[]): DrawVersion {
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    version: row.version,
    status: row.status,
    method: row.method,
    config: row.config,
    changeReason: row.change_reason,
    createdBy: row.created_by,
    createdAt: row.created_at,
    confirmedBy: row.confirmed_by,
    confirmedAt: row.confirmed_at,
    publishedBy: row.published_by,
    publishedAt: row.published_at,
    groups,
  };
}

async function findLatestVersion(client: PoolClient, tournamentId: string): Promise<VersionRow | null> {
  const result = await client.query<VersionRow>(
    `SELECT id, tournament_id, version, status, method, config, change_reason,
            created_by, created_at, confirmed_by, confirmed_at, published_by, published_at
     FROM tournament_draw_versions
     WHERE tournament_id = $1
     ORDER BY version DESC
     LIMIT 1
     FOR UPDATE`,
    [tournamentId],
  );
  return result.rows[0] ?? null;
}

export async function getLatestDrawVersion(tournamentId: string): Promise<DrawVersion | null> {
  const result = await getPool().query<VersionRow>(
    `SELECT id, tournament_id, version, status, method, config, change_reason,
            created_by, created_at, confirmed_by, confirmed_at, published_by, published_at
     FROM tournament_draw_versions
     WHERE tournament_id = $1
     ORDER BY version DESC
     LIMIT 1`,
    [tournamentId],
  );
  const row = result.rows[0];
  return row ? mapVersion(row, await loadGroups(row.id)) : null;
}

export async function listDrawVersions(tournamentId: string): Promise<DrawVersion[]> {
  const result = await getPool().query<VersionRow>(
    `SELECT id, tournament_id, version, status, method, config, change_reason,
            created_by, created_at, confirmed_by, confirmed_at, published_by, published_at
     FROM tournament_draw_versions
     WHERE tournament_id = $1
     ORDER BY version DESC`,
    [tournamentId],
  );
  return Promise.all(
    result.rows.map(async (row) => mapVersion(row, await loadGroups(row.id))),
  );
}

export async function getPublishedDrawVersion(tournamentId: string): Promise<DrawVersion | null> {
  const result = await getPool().query<VersionRow>(
    `SELECT id, tournament_id, version, status, method, config, change_reason,
            created_by, created_at, confirmed_by, confirmed_at, published_by, published_at
     FROM tournament_draw_versions
     WHERE tournament_id = $1 AND status = 'PUBLISHED'
     ORDER BY version DESC
     LIMIT 1`,
    [tournamentId],
  );
  const row = result.rows[0];
  return row ? mapVersion(row, await loadGroups(row.id)) : null;
}

export async function saveDrawDraft(
  tournamentId: string,
  input: DrawPlanInput,
  groups: Array<{ name: string; maxTeams: number; assignments: Array<{ teamId: string; seedGroup: number | null }> }>,
  userId: string,
): Promise<DrawVersion> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [tournamentId]);
    const latest = await findLatestVersion(client, tournamentId);
    let versionId = latest?.status === "DRAFT" ? latest.id : "";
    if (versionId) {
      await client.query("DELETE FROM tournament_draw_assignments WHERE draw_version_id = $1", [versionId]);
      await client.query("DELETE FROM tournament_draw_groups WHERE draw_version_id = $1", [versionId]);
      await client.query(
        `UPDATE tournament_draw_versions
         SET method = $1, config = $2, change_reason = COALESCE($3, change_reason)
         WHERE id = $4`,
        [input.method, JSON.stringify(input), input.changeReason?.trim() || null, versionId],
      );
    } else {
      if (
        (latest?.status === "CONFIRMED" || latest?.status === "PUBLISHED") &&
        !input.changeReason?.trim()
      ) {
        throw new Error("DRAW_CHANGE_REASON_REQUIRED");
      }
      const versionNumberResult = await client.query<{ next_version: number }>(
        `SELECT COALESCE(MAX(version), 0)::INTEGER + 1 AS next_version
         FROM tournament_draw_versions WHERE tournament_id = $1`,
        [tournamentId],
      );
      if (latest?.status === "CONFIRMED") {
        await client.query(
          "UPDATE tournament_draw_versions SET status = 'ARCHIVED' WHERE id = $1",
          [latest.id],
        );
      }
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO tournament_draw_versions
           (tournament_id, version, status, method, config, change_reason, created_by)
         VALUES ($1, $2, 'DRAFT', $3, $4, $5, $6)
         RETURNING id`,
        [
          tournamentId,
          versionNumberResult.rows[0].next_version,
          input.method,
          JSON.stringify(input),
          input.changeReason?.trim() || null,
          userId,
        ],
      );
      versionId = inserted.rows[0].id;
    }

    for (const group of groups) {
      const insertedGroup = await client.query<{ id: string }>(
        `INSERT INTO tournament_draw_groups (draw_version_id, name, max_teams)
         VALUES ($1, $2, $3) RETURNING id`,
        [versionId, group.name, group.maxTeams],
      );
      const groupId = insertedGroup.rows[0].id;
      for (const [positionIndex, assignment] of group.assignments.entries()) {
        await client.query(
          `INSERT INTO tournament_draw_assignments
             (draw_version_id, group_id, team_id, position, seed_group)
           VALUES ($1, $2, $3, $4, $5)`,
          [versionId, groupId, assignment.teamId, positionIndex + 1, assignment.seedGroup],
        );
      }
    }

    const versionResult = await client.query<VersionRow>(
      `SELECT id, tournament_id, version, status, method, config, change_reason,
              created_by, created_at, confirmed_by, confirmed_at, published_by, published_at
       FROM tournament_draw_versions WHERE id = $1`,
      [versionId],
    );
    const savedGroups = await loadGroups(versionId, client);
    await client.query("COMMIT");
    return mapVersion(versionResult.rows[0], savedGroups);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function changeDrawVersionStatus(
  tournamentId: string,
  nextStatus: "CONFIRMED" | "PUBLISHED",
  userId: string,
): Promise<DrawVersion | null> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [tournamentId]);
    const latest = await findLatestVersion(client, tournamentId);
    const expectedStatus = nextStatus === "CONFIRMED" ? "DRAFT" : "CONFIRMED";
    if (!latest || latest.status !== expectedStatus) {
      await client.query("ROLLBACK");
      return null;
    }
    if (nextStatus === "PUBLISHED") {
      await client.query(
        `UPDATE tournament_draw_versions
         SET status = 'ARCHIVED'
         WHERE tournament_id = $1 AND status = 'PUBLISHED'`,
        [tournamentId],
      );
    }
    await client.query(
      `UPDATE tournament_draw_versions
       SET status = $1,
           confirmed_by = CASE WHEN $1 = 'CONFIRMED' THEN $2 ELSE confirmed_by END,
           confirmed_at = CASE WHEN $1 = 'CONFIRMED' THEN NOW() ELSE confirmed_at END,
           published_by = CASE WHEN $1 = 'PUBLISHED' THEN $2 ELSE published_by END,
           published_at = CASE WHEN $1 = 'PUBLISHED' THEN NOW() ELSE published_at END
       WHERE id = $3`,
      [nextStatus, userId, latest.id],
    );
    const versionResult = await client.query<VersionRow>(
      `SELECT id, tournament_id, version, status, method, config, change_reason,
              created_by, created_at, confirmed_by, confirmed_at, published_by, published_at
       FROM tournament_draw_versions WHERE id = $1`,
      [latest.id],
    );
    const groups = await loadGroups(latest.id, client);
    await client.query("COMMIT");
    return mapVersion(versionResult.rows[0], groups);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
