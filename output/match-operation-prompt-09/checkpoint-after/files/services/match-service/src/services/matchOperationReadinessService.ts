import type { PoolClient } from "pg";
import type { MatchOperationReadiness, TournamentOperationReadiness } from "@sfl/shared";
import { getPool } from "../lib/db";
import { config } from "../config";
import { matchOperationNow } from "./matchOperationTime";
import { AppError } from "../lib/errors";
import { configuredCrewHasCapability, type CrewCapability } from "../scheduling/crewValidation";
import { crewConfigurationIssues } from "../scheduling/services/refereeConfigurationValidation";
import { refereeScheduleSignature } from "../scheduling/services/refereeScheduleSignature";
import { getTournamentScheduleSettings } from "../scheduling/services/schedulingService";
import { getPublishedDraw } from "./fixtureGenerationService";
import { draftCompleteness } from "../scheduling/services/refereeAssignmentValidation";
import { getEffectiveMatchRules } from "./matchOperationRulesService";
import { preparation } from "./matchSquadService";
import { listOperationSchedules, readOperationSchedule, withOperationScheduleLock, type OperationScheduleContext } from "../scheduling/repositories/matchOperationReadinessRepository";
import type { AuthenticatedRequest } from "../middleware/gatewayUser";

type Query = Pick<PoolClient, "query">;
type Fixture = { id: string; tournament_id: string; status: string; home_team_id: string | null; away_team_id: string | null; draw_version_id: string | null; fixture_published: boolean };
type Account = { userId: string; roles: string[]; isActive: boolean; emailVerified: boolean; accountStatus: string };
const fixtureSql = `SELECT m.id,m.tournament_id,m.status,m.home_team_id,m.away_team_id,m.draw_version_id,
  COALESCE(g.publication_status='PUBLISHED',FALSE) AS fixture_published FROM matches m
  LEFT JOIN match_fixture_generations g ON g.draw_version_id=m.draw_version_id AND g.stage=m.stage`;
const issue = (code: string, message: string) => ({ code, message });

async function accountAccess(userId: string): Promise<Account | null> {
  let response: Response;
  try { response = await fetch(new URL(`/internal/users/${encodeURIComponent(userId)}/organizational-access`, config.authServiceUrl), { headers: { "x-gateway-internal-key": config.internalApiKey }, signal: AbortSignal.timeout(5000) }); }
  catch { throw new AppError(503, "Không xác minh được quyền tài khoản trọng tài.", "MATCH_OPERATION_AUTH_UNAVAILABLE"); }
  if (response.status === 404) return null;
  if (!response.ok) throw new AppError(503, "Không xác minh được quyền tài khoản trọng tài.", "MATCH_OPERATION_AUTH_UNAVAILABLE");
  const account = await response.json() as Account;
  if (account.userId !== userId || !Array.isArray(account.roles) || typeof account.isActive !== "boolean" || typeof account.emailVerified !== "boolean") throw new AppError(502, "Thông tin quyền trọng tài không hợp lệ.", "MATCH_OPERATION_AUTH_INVALID");
  return account;
}
const activeAccount = (account: Account | null | undefined) => Boolean(account?.isActive && account.emailVerified && account.accountStatus === "ACTIVE" && account.roles.includes("REFEREE"));

export function crewReadiness(context: OperationScheduleContext | null) {
  if (!context || context.schedule.status !== "PUBLISHED") return { valid: false, issues: [issue("PUBLISHED_SCHEDULE_REQUIRED", "Chưa công bố lịch thi đấu của trận.")] };
  const { publication, schedule, crew } = context;
  if (!publication || publication.voided) return { valid: false, issues: [issue("PUBLISHED_REFEREE_ASSIGNMENT_REQUIRED", context.hasDraft ? "Phân công đang là bản nháp hoặc cần công bố lại." : "Chưa công bố tổ trọng tài của trận.")] };
  const issues: Array<{ code: string; message: string }> = [];
  if (new Set(crew.map(member => member.refereeId)).size !== crew.length || new Set(crew.map(member => member.position)).size !== crew.length) issues.push(issue("DUPLICATE_CREW_ASSIGNMENT", "Một người hoặc vị trí bị trùng trong tổ trọng tài."));
  if (publication.scheduleSignature !== refereeScheduleSignature(schedule)) issues.push(issue("MATCH_OPERATION_SCHEDULE_CHANGED", "Lịch đã thay đổi so với phiên bản công bố phân công."));
  const actual = crew.map(c => `${c.position}:${c.refereeId}`).sort();
  const published = publication.slots.map(c => `${c.position}:${c.refereeId}`).sort();
  if (JSON.stringify(actual) !== JSON.stringify(published)) issues.push(issue("PUBLISHED_CREW_CHANGED", "Tổ trọng tài hiện tại khác bản đã công bố; cần kiểm tra lại."));
  for (const message of crewConfigurationIssues(publication.positions, crew)) issues.push(issue("REFEREE_CONFIG_ASSIGNMENT_CONFLICT", message));
  const final = crew.filter(c => c.isFinalAuthority === true);
  if (final.length !== 1 || !configuredCrewHasCapability(final[0]?.position ?? "", true, "FINALIZE", publication.positions)) issues.push(issue("FINAL_AUTHORITY_REQUIRED", "Cần đúng một người có quyền xác nhận kết quả cuối cùng."));
  return { valid: !issues.length, issues };
}

export async function assertOperationActor(context: OperationScheduleContext, actorId: string, capability: CrewCapability): Promise<void> {
  const own = context.crew.find(c => c.refereeId === actorId);
  const publication = context.publication;
  if (!own || !publication || publication.voided || !publication.slots.some(slot => slot.refereeId === actorId && slot.position === own.position)) throw new AppError(403, "Bạn không còn thuộc tổ trọng tài đã công bố của trận này.", "REFEREE_MATCH_FORBIDDEN");
  if (!configuredCrewHasCapability(own.position, own.isFinalAuthority === true, capability, publication.positions)) throw new AppError(403, "Nhiệm vụ được giao không có quyền thực hiện thao tác này.", capability === "FINALIZE" ? "FINAL_AUTHORITY_REQUIRED" : "EVENT_PERMISSION_REQUIRED");
  if (!activeAccount(await accountAccess(actorId))) throw new AppError(403, "Tài khoản trọng tài chưa đủ điều kiện tác nghiệp.", "REFEREE_ACCOUNT_INACTIVE");
  if (capability !== "READ") {
    const crew = crewReadiness(context);
    if (!crew.valid) throw new AppError(409, crew.issues.map(i => i.message).join(" "), crew.issues[0].code);
  }
}

async function tournamentBasis(tournamentId: string) {
  const [tournament, draw] = await Promise.all([getTournamentScheduleSettings(tournamentId), getPublishedDraw(tournamentId).catch(error => {
    if (error instanceof AppError && error.code === "PUBLISHED_DRAW_REQUIRED") return null;
    throw error;
  })]);
  return { status: tournament.status, drawId: draw?.id ?? null };
}

async function evaluate(fixture: Fixture, context: OperationScheduleContext | null, basis: Awaited<ReturnType<typeof tournamentBasis>>, query: Query, accounts: Map<string, Account | null>): Promise<MatchOperationReadiness> {
  const crew = crewReadiness(context), issues = [...crew.issues];
  const fixturePublished = fixture.fixture_published && fixture.draw_version_id === basis.drawId;
  const teamsResolved = Boolean(fixture.home_team_id && fixture.away_team_id && fixture.home_team_id !== fixture.away_team_id);
  const schedulePublished = context?.schedule.status === "PUBLISHED";
  if (!fixturePublished) issues.push(issue("PUBLISHED_FIXTURE_REQUIRED", "Trận không thuộc sơ đồ chính thức hiện hành."));
  if (!teamsResolved) issues.push(issue("MATCH_TEAMS_UNRESOLVED", "Chưa xác định đủ hai đội thi đấu."));
  const inactive = context?.crew.some(member => !activeAccount(accounts.get(member.refereeId))) ?? false;
  if (crew.valid && inactive) issues.push(issue("REFEREE_ACCOUNT_INACTIVE", "Có tài khoản trong tổ trọng tài chưa đủ điều kiện tác nghiệp."));
  const crewPublished = crew.valid && !inactive;
  const allowedTournament = ["PREPARING", "IN_PROGRESS", "PAUSED"].includes(basis.status);
  const allowedMatch = ["SCHEDULED", "LINEUP_CONFIRMED", "IN_PROGRESS"].includes(fixture.status);
  if (!allowedTournament) issues.push(issue("MATCH_OPERATION_TOURNAMENT_STATE", "Trạng thái giải chưa cho phép tác nghiệp trận."));
  if (basis.status === "PREPARING") issues.push(issue("TOURNAMENT_NOT_STARTED", "BTC cần bắt đầu giải trước khi bắt đầu thi đấu; vẫn được xem và chuẩn bị trận."));
  if (basis.status === "PAUSED") issues.push(issue("TOURNAMENT_PAUSED", "Giải đang tạm dừng; chỉ được xem thông tin chuẩn bị."));
  if (!allowedMatch) issues.push(issue("MATCH_OPERATION_MATCH_STATE", "Trạng thái trận chỉ cho phép xem, chưa cho phép tác nghiệp."));
  const conflicts=await query.query(`WITH RECURSIVE ancestors AS (
    SELECT s.id,s.match_id,s.home_source_slot_id,s.away_source_slot_id FROM match_bracket_slots s WHERE s.match_id=$1
    UNION SELECT p.id,p.match_id,p.home_source_slot_id,p.away_source_slot_id FROM match_bracket_slots p JOIN ancestors a ON p.id=a.home_source_slot_id OR p.id=a.away_source_slot_id
   ) SELECT 1 FROM competition_projection_conflicts c WHERE c.resolved_at IS NULL AND c.tournament_id=$2 AND (c.match_id=$1 OR c.match_id IN(SELECT match_id FROM ancestors)) LIMIT 1`,[fixture.id,fixture.tournament_id]);
  if(conflicts.rowCount)issues.push(issue('MATCH_OPERATION_QUALIFICATION_CONFLICT','Nguồn đội đi tiếp thay đổi sau công bố; BTC cần xử lý ảnh hưởng nhánh/lịch trước khi tác nghiệp.'));
  const canPrepare = fixturePublished && teamsResolved && schedulePublished && crewPublished && allowedTournament && allowedMatch && !conflicts.rowCount;
  const lineups = await query.query(`SELECT team_id,COUNT(*)::int AS total,COUNT(*) FILTER(WHERE confirmed_at IS NOT NULL)::int AS confirmed,
    COUNT(*) FILTER(WHERE is_starting=TRUE)::int AS starters,COUNT(*) FILTER(WHERE is_starting=TRUE AND UPPER(position) IN ('GK','GOALKEEPER'))::int AS goalkeepers
    FROM lineups WHERE match_id=$1 GROUP BY team_id`, [fixture.id]);
  const submittedPlayers = [fixture.home_team_id, fixture.away_team_id].every(id => lineups.rows.some(row => row.team_id === id && row.total > 0 && row.total === row.confirmed));
  let lineupsConfirmed = false;
  let knownStartRules = false;
  if (submittedPlayers || fixture.status === "LINEUP_CONFIRMED") {
    const checked=await preparation(fixture.id,query);
    lineupsConfirmed=checked.ready;
    issues.push(...checked.squads.flatMap(s=>s.issues));
    if(checked.inconsistent)issues.push(issue("MATCH_LINEUPS_INCONSISTENT","Trạng thái sẵn sàng không khớp hồ sơ đội hình. BTC cần xử lý mở lại chuẩn bị có lý do."));
    if(checked.issues.some(i=>!i.resolvedAt))issues.push(issue("MATCH_PREPARATION_ISSUES","Có vấn đề trước trận đang chờ BTC xử lý."));
    const rules = await getEffectiveMatchRules(fixture.id, query);
    knownStartRules = rules.missing.CLOCK.length === 0 && rules.missing.LINEUP.length === 0;
    const v = rules.rules.values;
    if (rules.missing.LINEUP.length) lineupsConfirmed = false;
    else lineupsConfirmed = lineupsConfirmed && lineups.rows.every(row => row.starters >= Number(v.minimumPlayers) && row.starters <= Number(v.startingPlayers) && row.total - row.starters <= Number(v.maxSubstitutes) && row.goalkeepers === Number(v.goalkeepers));
    if (!knownStartRules) issues.push(issue("MATCH_RULES_UNDEFINED", "Cần bổ sung quy tắc đội hình/đồng hồ trước khi bắt đầu trận."));
  }
  const kickoffReached = Boolean(schedulePublished && Date.parse(context!.schedule.scheduledDate) <= (await matchOperationNow(fixture.id,query)).getTime());
  if (!lineupsConfirmed) issues.push(issue("MATCH_LINEUPS_NOT_READY", "Hai đội chưa có đội hình hợp lệ đã xác nhận."));
  if (!kickoffReached) issues.push(issue("MATCH_KICKOFF_NOT_REACHED", "Chưa đến giờ thi đấu theo lịch chính thức."));
  const assignmentStatus = crewPublished ? "PUBLISHED" : context?.publication ? "CONFLICT" : context?.draftSlotCount ? draftCompleteness(context.draftPositions, context.draftSlots).complete ? "COMPLETE" : "PARTIAL" : "UNASSIGNED";
  return { matchId: fixture.id, tournamentId: fixture.tournament_id, tournamentStatus: basis.status, matchStatus: fixture.status, assignmentStatus,
    fixturePublished, teamsResolved, schedulePublished, crewPublished, publicationRevision: context?.publication?.revision ?? null, scheduledDate: context?.schedule.scheduledDate ?? null,
    canPrepare, canConfirmLineup: canPrepare && basis.status !== "PAUSED" && fixture.status === "SCHEDULED" && lineupsConfirmed,
    canStart: canPrepare && basis.status === "IN_PROGRESS" && fixture.status === "LINEUP_CONFIRMED" && lineupsConfirmed && knownStartRules && kickoffReached,
    lineupsConfirmed, kickoffReached, issues };
}

async function accountsFor(contexts: Array<OperationScheduleContext | null>) {
  const ids = [...new Set(contexts.flatMap(context => context?.crew.map(member => member.refereeId) ?? []))];
  return new Map(await Promise.all(ids.map(async id => [id, await accountAccess(id)] as const)));
}

export async function getMatchOperationReadiness(matchId: string, context?: OperationScheduleContext, query: Query = getPool()): Promise<MatchOperationReadiness> {
  const result = await query.query<Fixture>(`${fixtureSql} WHERE m.id=$1`, [matchId]);
  const fixture = result.rows[0];
  if (!fixture) throw new AppError(404, "Không tìm thấy trận.", "MATCH_NOT_FOUND");
  const schedule = context ?? await readOperationSchedule(matchId);
  const [basis, accounts] = await Promise.all([tournamentBasis(fixture.tournament_id), accountsFor([schedule])]);
  return evaluate(fixture, schedule, basis, query, accounts);
}

export async function getTournamentOperationReadiness(tournamentId: string): Promise<TournamentOperationReadiness> {
  const [result, schedules, basis] = await Promise.all([getPool().query<Fixture>(`${fixtureSql} WHERE m.tournament_id=$1 ORDER BY m.id`, [tournamentId]), listOperationSchedules(tournamentId), tournamentBasis(tournamentId)]);
  const accounts = await accountsFor([...schedules.values()]);
  const fixtures = result.rows.filter(row => row.draw_version_id === basis.drawId);
  const matches = await Promise.all(fixtures.map(fixture => evaluate(fixture, schedules.get(fixture.id) ?? null, basis, getPool(), accounts)));
  const stats = { total: matches.length, unassigned: matches.filter(m => m.assignmentStatus === "UNASSIGNED").length,
    draft: matches.filter(m => ["PARTIAL", "COMPLETE"].includes(m.assignmentStatus)).length, published: matches.filter(m => m.crewPublished).length,
    needsReview: matches.filter(m => m.assignmentStatus === "CONFLICT").length, ready: matches.filter(m => m.canPrepare && m.matchStatus !== "IN_PROGRESS").length,
    inProgress: matches.filter(m => m.matchStatus === "IN_PROGRESS").length, finished: matches.filter(m => ["FINISHED", "VERIFIED", "LOCKED"].includes(m.matchStatus)).length };
  return { tournamentId, tournamentStatus: basis.status, matches, stats, allAssignmentsPublished: matches.length > 0 && matches.every(m => m.fixturePublished && m.schedulePublished && m.crewPublished),
    canOpenOperations: matches.some(m => m.canPrepare || ["FINISHED", "VERIFIED", "LOCKED"].includes(m.matchStatus)) };
}

export async function withRefereeOperation<T>(actor: AuthenticatedRequest, matchId: string, capability: CrewCapability, task: (context: OperationScheduleContext) => Promise<T>): Promise<T> {
  if (!actor.userId || !actor.userRoles?.includes("REFEREE")) throw new AppError(403, "Thao tác chuyên môn yêu cầu trọng tài được phân công cho trận.", "REFEREE_MATCH_FORBIDDEN");
  return withOperationScheduleLock(matchId, async context => {
    await assertOperationActor(context, actor.userId!, capability);
    const readiness = await getMatchOperationReadiness(matchId, context);
    if (!readiness.fixturePublished || !readiness.teamsResolved || readiness.issues.some(i=>i.code==='MATCH_OPERATION_QUALIFICATION_CONFLICT') || !["PREPARING", "IN_PROGRESS"].includes(readiness.tournamentStatus) || ["CANCELLED", "POSTPONED", "VERIFIED", "LOCKED"].includes(readiness.matchStatus)) throw new AppError(409, "Trận hoặc giải chưa cho phép tác nghiệp chuyên môn.", "MATCH_OPERATION_NOT_READY");
    return task(context);
  });
}
