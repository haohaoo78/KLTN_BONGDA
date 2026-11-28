import { getPool } from "../lib/db";
import type {
  DrawGroup,
  DrawPlanInput,
  DrawVersion,
  DrawWorkflowStatus,
} from "../models/drawWorkflow";
import type { PoolClient } from "pg";
import { AppError } from "../lib/errors";
import { sameUniqueTeamSet, uniqueTeamIdsAreSubset } from "../services/rosterWithdrawal";

async function lockDrawReadyTournament(client: PoolClient, tournamentId: string): Promise<void> {
  const result = await client.query<{ status: string }>(
    "SELECT status FROM tournaments WHERE id = $1 FOR UPDATE",
    [tournamentId],
  );
  if (!result.rows[0]) {
    throw new AppError(404, "Không tìm thấy giải đấu", "TOURNAMENT_NOT_FOUND");
  }
  if (result.rows[0].status !== "ROSTER_LOCKED") {
    throw new AppError(409, "Chỉ được chia hoặc chỉnh bản chia khi roster đã chốt và giải chưa chuyển sang chuẩn bị lịch", "DRAW_STAGE_NOT_READY");
  }
}

async function assertAllocationMethodsUnlocked(client: PoolClient, tournamentId: string): Promise<void> {
  const published = await client.query<{ id: string }>("SELECT id FROM tournament_draw_versions WHERE tournament_id=$1 AND status='PUBLISHED' LIMIT 1 FOR UPDATE", [tournamentId]);
  const scheduled = await client.query<{ id: string; status: string }>("SELECT id,status FROM tournament_live_draw_sessions WHERE tournament_id=$1 AND status IN ('SCHEDULED','POSTPONED','LIVE','PAUSED') ORDER BY created_at DESC LIMIT 1 FOR UPDATE", [tournamentId]);
  if (published.rowCount) throw new AppError(409, "Kết quả phân bổ chính thức đã được công bố và không thể thay đổi", "DRAW_ALREADY_PUBLISHED");
  if (scheduled.rowCount) throw new AppError(409, "Phương thức phân bổ đã bị khóa bởi lịch/phiên bốc thăm trực tiếp", "DRAW_METHOD_LOCKED_BY_LIVE_SESSION");
}

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
  groups: Array<{ name: string; maxTeams: number; assignments: Array<{ teamId: string; seedGroup: number | null; position?: number }> }>,
  userId: string,
): Promise<DrawVersion> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [tournamentId]);
    await lockDrawReadyTournament(client, tournamentId);
    await assertAllocationMethodsUnlocked(client, tournamentId);
    const registered = await client.query<{ team_id: string }>(
      `SELECT team_id FROM tournament_registration_reservations
       WHERE tournament_id = $1 AND status = 'APPROVED' AND persisted_in_organization = TRUE
       FOR UPDATE`,
      [tournamentId],
    );
    const assignedTeamIds = groups.flatMap((group) => group.assignments.map((assignment) => assignment.teamId));
    if (!uniqueTeamIdsAreSubset(registered.rows.map((row) => row.team_id), assignedTeamIds)) {
      throw new AppError(409, "Danh sách đội đã thay đổi sau khi xem trước. Tải lại hồ sơ hợp lệ và tạo lại bản chia.", "ROSTER_CHANGED_DURING_DRAW");
    }
    const latest = await findLatestVersion(client, tournamentId);
    const methodDraftResult = await client.query<VersionRow>(
      `SELECT id, tournament_id, version, status, method, config, change_reason,
              created_by, created_at, confirmed_by, confirmed_at, published_by, published_at
       FROM tournament_draw_versions WHERE tournament_id=$1 AND method=$2 AND status='DRAFT'
       ORDER BY version DESC LIMIT 1 FOR UPDATE`, [tournamentId, input.method],
    );
    let versionId = methodDraftResult.rows[0]?.id ?? "";
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
      const versionNumberResult = await client.query<{ next_version: number }>(
        `SELECT COALESCE(MAX(version), 0)::INTEGER + 1 AS next_version
         FROM tournament_draw_versions WHERE tournament_id = $1`,
        [tournamentId],
      );
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
          [versionId, groupId, assignment.teamId, assignment.position ?? positionIndex + 1, assignment.seedGroup],
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
  method: DrawVersion["method"],
  nextStatus: "CONFIRMED" | "PUBLISHED",
  userId: string,
  regulationSnapshot?: Record<string, unknown>,
): Promise<DrawVersion | null> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [tournamentId]);
    await lockDrawReadyTournament(client, tournamentId);
    await assertAllocationMethodsUnlocked(client, tournamentId);
    const expectedStatus = nextStatus === "CONFIRMED" ? "DRAFT" : "CONFIRMED";
    const methodVersionResult = await client.query<VersionRow>(
      `SELECT id, tournament_id, version, status, method, config, change_reason,
              created_by, created_at, confirmed_by, confirmed_at, published_by, published_at
       FROM tournament_draw_versions WHERE tournament_id=$1 AND method=$2 AND status=$3
       ORDER BY version DESC LIMIT 1 FOR UPDATE`, [tournamentId, method, expectedStatus],
    );
    const latest = methodVersionResult.rows[0] ?? null;
    if (!latest || latest.status !== expectedStatus) {
      await client.query("ROLLBACK");
      return null;
    }
    const registered = await client.query<{ team_id: string }>(
      `SELECT team_id FROM tournament_registration_reservations
       WHERE tournament_id = $1 AND status = 'APPROVED' AND persisted_in_organization = TRUE
       FOR UPDATE`,
      [tournamentId],
    );
    const assignments = await client.query<{ team_id: string }>(
      "SELECT team_id FROM tournament_draw_assignments WHERE draw_version_id = $1 FOR UPDATE",
      [latest.id],
    );
    if (!sameUniqueTeamSet(registered.rows.map((row) => row.team_id), assignments.rows.map((row) => row.team_id))) {
      throw new AppError(409, "Bản chia không còn khớp danh sách đội đã duyệt. Hãy tải lại và lập bản chia mới trước khi xác nhận.", "ROSTER_CHANGED_DURING_DRAW");
    }
    if (nextStatus === "PUBLISHED") {
      const alreadyPublished = await client.query("SELECT 1 FROM tournament_draw_versions WHERE tournament_id=$1 AND status='PUBLISHED' LIMIT 1 FOR UPDATE", [tournamentId]);
      if (alreadyPublished.rowCount) throw new AppError(409, "Giải đã có kết quả phân bổ chính thức; không thể công bố phương án khác", "DRAW_ALREADY_PUBLISHED");
      await client.query(
        `UPDATE tournament_draw_versions SET status='ARCHIVED'
         WHERE tournament_id=$1 AND status IN ('DRAFT','CONFIRMED') AND id<>$2`, [tournamentId, latest.id],
      );
    }
    await client.query(
      `UPDATE tournament_draw_versions
         SET status = $1::varchar,
             config = CASE WHEN $1::varchar = 'PUBLISHED'::varchar AND $4::jsonb IS NOT NULL
               THEN config || jsonb_build_object('fixtureRegulationSnapshot', $4::jsonb) ELSE config END,
             confirmed_by = CASE WHEN $1::varchar = 'CONFIRMED'::varchar THEN $2 ELSE confirmed_by END,
             confirmed_at = CASE WHEN $1::varchar = 'CONFIRMED'::varchar THEN NOW() ELSE confirmed_at END,
             published_by = CASE WHEN $1::varchar = 'PUBLISHED'::varchar THEN $2 ELSE published_by END,
             published_at = CASE WHEN $1::varchar = 'PUBLISHED'::varchar THEN NOW() ELSE published_at END
       WHERE id = $3`,
      [nextStatus, userId, latest.id, regulationSnapshot ? JSON.stringify(regulationSnapshot) : null],
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
