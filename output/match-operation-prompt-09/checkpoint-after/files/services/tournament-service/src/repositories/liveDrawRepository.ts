import type { PoolClient } from "pg";
import { getPool } from "../lib/db";
import { AppError } from "../lib/errors";
import type { DrawVersion, LiveDrawPick, LiveDrawState, LiveDrawStatus } from "../models/drawWorkflow";
import { sameUniqueTeamSet } from "../services/rosterWithdrawal";
import { getLatestDrawVersion } from "./drawWorkflowRepository";

export type LiveDrawScheduleInput = {
  eventName: string;
  scheduledAt: string;
  timeZone: string;
  announcement: string;
  location?: string;
};

type LiveDrawPlan = {
  noSameInstitution?: boolean;
  maxTeamsPerGroup?: number;
  changeReason?: string;
  seededTeamIds?: string[];
  groups: Array<{
    name: string;
    maxTeams: number;
    assignments: Array<{ teamId: string; position: number; seedGroup: number | null }>;
  }>;
  drawOrder?: Array<{ groupIndex: number; groupName: string; teamId: string; position: number; seedGroup: number | null }>;
};

type SessionRow = {
  id: string;
  tournament_id: string;
  created_by: string;
  method: "RANDOM" | "SEEDED";
  status: LiveDrawStatus;
  total_picks: number;
  revealed_count: number;
  hidden_plan: LiveDrawPlan;
  event_name: string;
  scheduled_at: Date;
  time_zone: string;
  announcement: string;
  location: string;
  cancellation_reason: string | null;
  created_at: Date;
  completed_at: Date | null;
  finalized_at: Date | null;
};

type PickRow = {
  sequence: number;
  group_index: number;
  group_name: string;
  team_id: string;
  position: number;
  seed_group: number | null;
  drawn_at: Date;
};

function validateSchedule(input: LiveDrawScheduleInput, requireFuture = true): Date {
  const eventName = input.eventName?.trim();
  const announcement = input.announcement ?? "";
  const scheduledAt = new Date(input.scheduledAt);
  if (!eventName || eventName.length > 200 || !Number.isFinite(scheduledAt.getTime())) {
    throw new AppError(400, "Tên buổi lễ và thời điểm tổ chức hợp lệ là bắt buộc", "INVALID_LIVE_DRAW_SCHEDULE");
  }
  if (announcement.length > 5000) throw new AppError(400, "Thông báo tối đa 5000 ký tự", "INVALID_LIVE_DRAW_SCHEDULE");
  if ((input.location ?? "").length > 300) throw new AppError(400, "Địa điểm tối đa 300 ký tự", "INVALID_LIVE_DRAW_SCHEDULE");
  try { new Intl.DateTimeFormat("en-US", { timeZone: input.timeZone }).format(scheduledAt); }
  catch { throw new AppError(400, "Múi giờ của buổi lễ không hợp lệ", "INVALID_LIVE_DRAW_TIME_ZONE"); }
  if (requireFuture && scheduledAt.getTime() <= Date.now()) {
    throw new AppError(409, "Thời gian bốc thăm phải ở tương lai theo giờ máy chủ", "LIVE_DRAW_SCHEDULE_MUST_BE_FUTURE");
  }
  return scheduledAt;
}

async function addEvent(client: PoolClient, sessionId: string, actorId: string, type: string, detail = "", sequence: number | null = null) {
  await client.query(
    "INSERT INTO tournament_live_draw_events (session_id, actor_id, event_type, detail, sequence) VALUES ($1,$2,$3,$4,$5)",
    [sessionId, actorId, type, detail, sequence],
  );
}

async function notify(client: PoolClient, tournamentId: string, sessionId: string, type: string, sequence?: number) {
  await client.query("SELECT pg_notify('sfl_tournament_live_draw', $1)", [JSON.stringify({ tournamentId, sessionId, type, sequence })]);
}

async function loadState(client: PoolClient, row: SessionRow): Promise<LiveDrawState> {
  const [picksResult, historyResult] = await Promise.all([
    client.query<PickRow>(
      `SELECT sequence, group_index, group_name, team_id, position, seed_group, drawn_at
       FROM tournament_live_draw_picks WHERE session_id = $1 ORDER BY sequence`, [row.id],
    ),
    client.query<{ created_at: Date; event_type: string; actor_id: string; detail: string; sequence: number | null }>(
      `SELECT created_at, event_type, actor_id, detail, sequence FROM tournament_live_draw_events
       WHERE session_id=$1 ORDER BY id`, [row.id],
    ),
  ]);
  const picks: LiveDrawPick[] = picksResult.rows.map((pick) => ({
    sequence: pick.sequence, groupIndex: pick.group_index, groupName: pick.group_name,
    teamId: pick.team_id, position: pick.position, seedGroup: pick.seed_group,
    drawnAt: pick.drawn_at.toISOString(),
  }));
  return {
    sessionId: row.id, tournamentId: row.tournament_id, status: row.status, method: row.method,
    eventName: row.event_name, scheduledAt: row.scheduled_at.toISOString(), timeZone: row.time_zone,
    announcement: row.announcement, location: row.location, totalPicks: row.total_picks, revealedCount: row.revealed_count,
    createdAt: row.created_at.toISOString(), completedAt: row.completed_at?.toISOString() ?? null,
    finalizedAt: row.finalized_at?.toISOString() ?? null,
    groups: row.hidden_plan.groups.map(({ name, maxTeams }) => ({ name, maxTeams })), picks,
    history: historyResult.rows.map((event) => ({
      at: event.created_at.toISOString(), type: event.event_type, actorId: event.actor_id,
      detail: event.detail, sequence: event.sequence,
    })),
  };
}

async function lockTournament(client: PoolClient, tournamentId: string) {
  const tournament = await client.query<{ status: string }>("SELECT status FROM tournaments WHERE id = $1 FOR UPDATE", [tournamentId]);
  if (!tournament.rowCount) throw new AppError(404, "Không tìm thấy giải đấu", "TOURNAMENT_NOT_FOUND");
  if (tournament.rows[0].status !== "ROSTER_LOCKED") throw new AppError(409, "Chỉ được bốc thăm sau khi roster đã khóa", "DRAW_STAGE_NOT_READY");
}

export async function createLiveDrawSession(
  tournamentId: string,
  createdBy: string,
  method: "RANDOM" | "SEEDED",
  plan: LiveDrawPlan,
  schedule: LiveDrawScheduleInput,
): Promise<LiveDrawState> {
  const scheduledAt = validateSchedule(schedule);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [tournamentId]);
    await lockTournament(client, tournamentId);
    const registered = await client.query<{ team_id: string }>(
      `SELECT team_id FROM tournament_registration_reservations
       WHERE tournament_id=$1 AND status='APPROVED' AND persisted_in_organization=TRUE FOR UPDATE`, [tournamentId],
    );
    const plannedTeamIds = plan.groups.flatMap((group) => group.assignments.map((assignment) => assignment.teamId));
    if (!sameUniqueTeamSet(registered.rows.map((row) => row.team_id), plannedTeamIds)) {
      throw new AppError(409, "Danh sách đội đã thay đổi. Tải lại đội chính thức và lập phiên bốc mới.", "ROSTER_CHANGED_DURING_DRAW");
    }
    const existing = await client.query<{ status: LiveDrawStatus }>(
      "SELECT status FROM tournament_live_draw_sessions WHERE tournament_id=$1 ORDER BY created_at DESC LIMIT 1 FOR UPDATE", [tournamentId],
    );
    if (existing.rows[0] && ["SCHEDULED", "POSTPONED", "LIVE", "PAUSED", "COMPLETED"].includes(existing.rows[0].status)) {
      throw new AppError(409, "Giải đang có phiên bốc thăm chưa kết thúc", "LIVE_DRAW_ALREADY_ACTIVE");
    }
    const official = await client.query("SELECT 1 FROM tournament_draw_versions WHERE tournament_id=$1 AND status='PUBLISHED' LIMIT 1 FOR UPDATE", [tournamentId]);
    if (official.rowCount) throw new AppError(409, "Giải đã có kết quả phân bổ chính thức", "DRAW_ALREADY_PUBLISHED");
    const totalPicks = plan.drawOrder?.length ?? plan.groups.reduce((sum, group) => sum + group.assignments.length, 0);
    if (totalPicks < 1) throw new AppError(409, "Phiên bốc thăm cần tối thiểu một đội chưa được xếp", "NO_UNSEEDED_TEAMS");
    const inserted = await client.query<SessionRow>(
      `INSERT INTO tournament_live_draw_sessions
         (tournament_id, created_by, method, status, total_picks, hidden_plan, event_name, scheduled_at, time_zone, announcement, location)
       VALUES ($1,$2,$3,'SCHEDULED',$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [tournamentId, createdBy, method, totalPicks, JSON.stringify(plan), schedule.eventName.trim(), scheduledAt.toISOString(), schedule.timeZone, schedule.announcement ?? "", schedule.location?.trim() ?? ""],
    );
    await addEvent(client, inserted.rows[0].id, createdBy, "SCHEDULED", `${schedule.eventName.trim()} · ${scheduledAt.toISOString()}`);
    await notify(client, tournamentId, inserted.rows[0].id, "scheduled");
    const state = await loadState(client, inserted.rows[0]);
    await client.query("COMMIT");
    return state;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function getLatestLiveDrawState(tournamentId: string): Promise<LiveDrawState | null> {
  const client = await getPool().connect();
  try {
    const result = await client.query<SessionRow>("SELECT * FROM tournament_live_draw_sessions WHERE tournament_id=$1 ORDER BY created_at DESC LIMIT 1", [tournamentId]);
    return result.rows[0] ? await loadState(client, result.rows[0]) : null;
  } finally { client.release(); }
}

export async function getLiveDrawStateForManager(tournamentId: string): Promise<{ state: LiveDrawState | null; plan: LiveDrawPlan | null }> {
  const client = await getPool().connect();
  try {
    const result = await client.query<SessionRow>("SELECT * FROM tournament_live_draw_sessions WHERE tournament_id=$1 ORDER BY created_at DESC LIMIT 1", [tournamentId]);
    const row = result.rows[0];
    return row ? { state: await loadState(client, row), plan: row.hidden_plan } : { state: null, plan: null };
  } finally { client.release(); }
}

export async function startScheduledLiveDraw(tournamentId: string, actorId: string): Promise<LiveDrawState> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [tournamentId]);
    const found = await client.query<SessionRow>(
      `SELECT * FROM tournament_live_draw_sessions WHERE tournament_id=$1 AND status IN ('SCHEDULED','POSTPONED','LIVE')
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [tournamentId],
    );
    const session = found.rows[0];
    if (!session) throw new AppError(404, "Không tìm thấy lịch bốc thăm đang chờ", "LIVE_DRAW_NOT_FOUND");
    if (session.status === "LIVE") { const state = await loadState(client, session); await client.query("COMMIT"); return state; }
    if (session.status === "POSTPONED") throw new AppError(409, "Buổi lễ đang hoãn; BTC cần công bố lại lịch trước khi bắt đầu", "LIVE_DRAW_POSTPONED");
    if (session.scheduled_at.getTime() > Date.now()) throw new AppError(409, "Chưa đến giờ theo đồng hồ máy chủ", "LIVE_DRAW_NOT_DUE");
    await lockTournament(client, tournamentId);
    const updated = await client.query<SessionRow>("UPDATE tournament_live_draw_sessions SET status='LIVE', updated_at=NOW() WHERE id=$1 RETURNING *", [session.id]);
    await addEvent(client, session.id, actorId, "STARTED", "BTC chủ động bắt đầu buổi lễ.");
    await notify(client, tournamentId, session.id, "live");
    const state = await loadState(client, updated.rows[0]);
    await client.query("COMMIT");
    return state;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function updateLiveDrawSchedule(
  tournamentId: string,
  actorId: string,
  status: "SCHEDULED" | "POSTPONED" | "CANCELLED",
  schedule?: LiveDrawScheduleInput,
  cancellationReason?: string,
): Promise<LiveDrawState> {
  if (status === "CANCELLED" && !cancellationReason?.trim()) throw new AppError(400, "Nhập lý do hủy lịch", "LIVE_DRAW_CANCELLATION_REASON_REQUIRED");
  const scheduledAt = schedule ? validateSchedule(schedule) : null;
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [tournamentId]);
    const found = await client.query<SessionRow>(
      `SELECT * FROM tournament_live_draw_sessions WHERE tournament_id=$1 AND status IN ('SCHEDULED','POSTPONED')
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [tournamentId],
    );
    const session = found.rows[0];
    if (!session) throw new AppError(409, "Chỉ có thể đổi, hoãn hoặc hủy lịch trước khi buổi lễ bắt đầu", "LIVE_DRAW_SCHEDULE_LOCKED");
    const picks = await client.query("SELECT 1 FROM tournament_live_draw_picks WHERE session_id=$1 LIMIT 1 FOR UPDATE", [session.id]);
    if (status === "CANCELLED" && picks.rowCount) throw new AppError(409, "Không thể hủy lịch sau khi đã có lượt bốc được ghi nhận", "LIVE_DRAW_ALREADY_HAS_PICKS");
    const updated = await client.query<SessionRow>(
      `UPDATE tournament_live_draw_sessions SET
         status=$2,
         event_name=COALESCE($3,event_name), scheduled_at=COALESCE($4,scheduled_at),
         time_zone=COALESCE($5,time_zone), announcement=COALESCE($6,announcement),
         location=COALESCE($7,location), cancellation_reason=CASE WHEN $9::boolean THEN $8::text ELSE cancellation_reason END, updated_at=NOW()
       WHERE id=$1 RETURNING *`,
      [session.id, status, schedule?.eventName.trim() ?? null, scheduledAt?.toISOString() ?? null, schedule?.timeZone ?? null, schedule?.announcement ?? null, schedule?.location?.trim() ?? null, cancellationReason?.trim() ?? null, status === "CANCELLED"],
    );
    await addEvent(client, session.id, actorId, status, status === "CANCELLED" ? cancellationReason!.trim() : schedule ? `${schedule.eventName.trim()} · ${scheduledAt?.toISOString()}` : "BTC cập nhật trạng thái lịch.");
    await notify(client, tournamentId, session.id, status.toLowerCase());
    const state = await loadState(client, updated.rows[0]);
    await client.query("COMMIT");
    return state;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

async function publishCompletedDraw(client: PoolClient, session: SessionRow, actorId: string): Promise<string> {
  await lockTournament(client, session.tournament_id);
  const registered = await client.query<{ team_id: string }>(
    `SELECT team_id FROM tournament_registration_reservations
     WHERE tournament_id=$1 AND status='APPROVED' AND persisted_in_organization=TRUE FOR UPDATE`, [session.tournament_id],
  );
  const plannedTeamIds = session.hidden_plan.groups.flatMap((group) => group.assignments.map((assignment) => assignment.teamId));
  if (!sameUniqueTeamSet(registered.rows.map((row) => row.team_id), plannedTeamIds)) {
    throw new AppError(409, "Danh sách đội chính thức đã thay đổi; kết quả bốc thăm chưa thể công bố", "ROSTER_CHANGED_DURING_DRAW");
  }
  const published = await client.query("SELECT 1 FROM tournament_draw_versions WHERE tournament_id=$1 AND status='PUBLISHED' LIMIT 1 FOR UPDATE", [session.tournament_id]);
  if (published.rowCount) throw new AppError(409, "Giải đã có kết quả phân bổ chính thức", "DRAW_ALREADY_PUBLISHED");
  const latest = await client.query<{ id: string; version: number; status: string }>(
    "SELECT id, version, status FROM tournament_draw_versions WHERE tournament_id=$1 ORDER BY version DESC LIMIT 1 FOR UPDATE", [session.tournament_id],
  );
  await client.query("UPDATE tournament_draw_versions SET status='ARCHIVED' WHERE tournament_id=$1 AND status IN ('DRAFT','CONFIRMED')", [session.tournament_id]);
  if (latest.rows[0]) {
    await client.query("UPDATE tournament_draw_versions SET status='ARCHIVED' WHERE id=$1", [latest.rows[0].id]);
  }
  const nextVersion = (latest.rows[0]?.version ?? 0) + 1;
  const version = await client.query<{ id: string }>(
    `INSERT INTO tournament_draw_versions
       (tournament_id, version, status, method, config, change_reason, created_by, confirmed_by, confirmed_at, published_by, published_at)
     VALUES ($1,$2,'PUBLISHED',$3,$4,$5,$6,$7,NOW(),$7,NOW()) RETURNING id`,
    [session.tournament_id, nextVersion, session.method, JSON.stringify(session.hidden_plan), null, session.created_by, actorId],
  );
  for (const group of session.hidden_plan.groups) {
    const insertedGroup = await client.query<{ id: string }>(
      "INSERT INTO tournament_draw_groups (draw_version_id,name,max_teams) VALUES ($1,$2,$3) RETURNING id",
      [version.rows[0].id, group.name, group.maxTeams],
    );
    for (const assignment of group.assignments) {
      await client.query(
        `INSERT INTO tournament_draw_assignments (draw_version_id,group_id,team_id,position,seed_group)
         VALUES ($1,$2,$3,$4,$5)`,
        [version.rows[0].id, insertedGroup.rows[0].id, assignment.teamId, assignment.position, assignment.seedGroup],
      );
    }
  }
  return version.rows[0].id;
}

export async function advanceLiveDraw(
  tournamentId: string,
  expectedSequence: number,
  actorId: string,
  requestKey: string,
): Promise<{ state: LiveDrawState; draw: DrawVersion | null; idempotentReplay: boolean }> {
  const client = await getPool().connect();
  let published = false;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [tournamentId]);
    const found = await client.query<SessionRow>(
      `SELECT * FROM tournament_live_draw_sessions WHERE tournament_id=$1
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [tournamentId],
    );
    const session = found.rows[0];
    if (!session) throw new AppError(404, "Không tìm thấy phiên bốc thăm", "LIVE_DRAW_NOT_FOUND");
    const replay = await client.query("SELECT 1 FROM tournament_live_draw_picks WHERE session_id=$1 AND request_key=$2", [session.id, requestKey]);
    if (replay.rowCount) {
      const state = await loadState(client, session);
      await client.query("COMMIT");
      const draw = session.status === "FINALIZED" ? await getLatestDrawVersion(tournamentId) : null;
      return { state, draw, idempotentReplay: true };
    }
    if (session.status !== "LIVE") {
      if (session.status === "PAUSED") throw new AppError(409, "Phiên bốc thăm đang tạm dừng", "LIVE_DRAW_PAUSED");
      if (["FINALIZED", "COMPLETED"].includes(session.status)) throw new AppError(409, "Phiên bốc thăm đã hoàn tất", "LIVE_DRAW_COMPLETED");
      throw new AppError(409, "BTC chưa bắt đầu buổi bốc thăm", "LIVE_DRAW_NOT_STARTED");
    }
    if (session.revealed_count !== expectedSequence) throw new AppError(409, "Phiên bốc thăm vừa được cập nhật ở nơi khác. Đồng bộ trạng thái trước khi tiếp tục.", "LIVE_DRAW_SEQUENCE_CONFLICT");
    if (session.revealed_count >= session.total_picks) throw new AppError(409, "Phiên bốc thăm đã hoàn tất", "LIVE_DRAW_COMPLETED");
    const flattened = session.hidden_plan.drawOrder ?? session.hidden_plan.groups.flatMap((group, groupIndex) => group.assignments.map((assignment) => ({ groupIndex, groupName: group.name, ...assignment })));
    const assignment = flattened[session.revealed_count];
    if (!assignment) throw new AppError(500, "Dữ liệu phiên bốc thăm không đầy đủ", "LIVE_DRAW_PLAN_CORRUPT");
    const sequence = session.revealed_count + 1;
    await client.query(
      `INSERT INTO tournament_live_draw_picks (session_id,sequence,group_index,group_name,team_id,position,seed_group,request_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [session.id, sequence, assignment.groupIndex, assignment.groupName, assignment.teamId, assignment.position, assignment.seedGroup, requestKey],
    );
    await addEvent(client, session.id, actorId, "PICK", `${assignment.teamId} → ${assignment.groupName} ${assignment.position}`, sequence);
    let nextStatus: LiveDrawStatus = sequence === session.total_picks ? "FINALIZED" : "LIVE";
    if (sequence === session.total_picks) {
      await publishCompletedDraw(client, session, actorId);
      published = true;
      await addEvent(client, session.id, actorId, "PUBLISHED", "Kết quả đã được xác lập và công bố tự động sau lượt cuối.", sequence);
    }
    const updated = await client.query<SessionRow>(
      `UPDATE tournament_live_draw_sessions SET revealed_count=$2,status=$3,
         completed_at=CASE WHEN $2=total_picks THEN NOW() ELSE completed_at END,
         finalized_at=CASE WHEN $2=total_picks THEN NOW() ELSE finalized_at END,updated_at=NOW()
       WHERE id=$1 RETURNING *`, [session.id, sequence, nextStatus],
    );
    await notify(client, tournamentId, session.id, published ? "published" : "pick", sequence);
    const state = await loadState(client, updated.rows[0]);
    await client.query("COMMIT");
    return { state, draw: published ? await getLatestDrawVersion(tournamentId) : null, idempotentReplay: false };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function setLiveDrawStatus(tournamentId: string, actorId: string, status: "PAUSED" | "LIVE" | "CANCELLED"): Promise<LiveDrawState> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [tournamentId]);
    const found = await client.query<SessionRow>(
      `SELECT * FROM tournament_live_draw_sessions WHERE tournament_id=$1 AND status IN ('LIVE','PAUSED')
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [tournamentId],
    );
    const current = found.rows[0];
    if (!current) throw new AppError(404, "Không tìm thấy phiên đang diễn ra", "LIVE_DRAW_NOT_FOUND");
    if (status === "CANCELLED") throw new AppError(409, "Không thể hủy sau khi bắt đầu; hãy tạm dừng và liên hệ quản trị hệ thống để xử lý sự cố", "LIVE_DRAW_ALREADY_STARTED");
    if (status === "PAUSED" && current.status !== "LIVE") throw new AppError(409, "Phiên đã tạm dừng", "LIVE_DRAW_PAUSED");
    if (status === "LIVE" && current.status !== "PAUSED") throw new AppError(409, "Chỉ có thể tiếp tục phiên đang tạm dừng", "LIVE_DRAW_NOT_PAUSED");
    const updated = await client.query<SessionRow>("UPDATE tournament_live_draw_sessions SET status=$2,updated_at=NOW() WHERE id=$1 RETURNING *", [current.id, status]);
    await addEvent(client, current.id, actorId, status, status === "PAUSED" ? "BTC tạm dừng buổi lễ." : "BTC tiếp tục buổi lễ.");
    await notify(client, tournamentId, current.id, status.toLowerCase());
    const state = await loadState(client, updated.rows[0]);
    await client.query("COMMIT");
    return state;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function finalizeLiveDraw(tournamentId: string, sessionId: string): Promise<LiveDrawState> {
  const client = await getPool().connect();
  try {
    const result = await client.query<SessionRow>("SELECT * FROM tournament_live_draw_sessions WHERE id=$1 AND tournament_id=$2", [sessionId, tournamentId]);
    if (!result.rows[0] || result.rows[0].status !== "FINALIZED") throw new AppError(409, "Phiên chỉ tự hoàn tất sau khi công bố lượt cuối", "LIVE_DRAW_NOT_COMPLETED");
    return await loadState(client, result.rows[0]);
  } finally { client.release(); }
}
