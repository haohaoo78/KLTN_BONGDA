import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { AppError } from "../../lib/errors";
import { assertCanManageTournament } from "../authorization";
import type { AuthenticatedRequest } from "../middleware/gatewayUser";
import { getPool } from "../lib/db";
import { getMatch } from "../../services/matchService";
import { findRefereeConfiguration, lockRefereeConfiguration, saveRefereeConfiguration } from "../repositories/refereeConfigurationRepository";
import { listRefereeDrafts, publishedRefereeCrews, refereeDuties } from "../repositories/refereeAssignmentRepository";
import { effectiveRefereePositions, parseRefereePositions } from "./refereeConfigurationValidation";
import { parseRefereeRequestId } from "./refereeTeamValidation";
import { getTournamentRefereeTeam } from "./refereeTeamService";
import { getOfficialScheduleContext, getTournamentScheduleSettings } from "./schedulingService";
import { draftCompleteness, parseRefereeDraft, refereeEligibility } from "./refereeAssignmentValidation";
import type { RefereeAssignmentCandidate, RefereeAssignmentState, RefereeDraftSlot, RefereeEligibilityIssue } from "../models/refereeAssignment";
import type { RefereePosition } from "../models/refereeConfiguration";
import type { DemoFixture } from "@sfl/shared";
import { refereePublications, refereeDeliveryViews } from "../repositories/refereePublicationRepository";

type Actor = AuthenticatedRequest;
type Context = Awaited<ReturnType<typeof getOfficialScheduleContext>>;
type Schedule = Context["schedules"][number];
import { refereeScheduleSignature } from "./refereeScheduleSignature";
export { refereeScheduleSignature } from "./refereeScheduleSignature";
async function access(actor: Actor, tournamentId: string) {
  parseRefereeRequestId(tournamentId); await assertCanManageTournament(actor, tournamentId);
  const tournament = await getTournamentScheduleSettings(tournamentId);
  let context: Context | null = null;
  try { context = await getOfficialScheduleContext(tournamentId); }
  catch (error) { if (!(error instanceof AppError) || !["PUBLISHED_DRAW_REQUIRED", "PUBLISHED_FIXTURES_REQUIRED"].includes(error.code)) throw error; }
  return { context, readOnlyReason: ["COMPLETED", "CANCELLED"].includes(tournament.status) ? "Giải đã kết thúc hoặc đã hủy; chỉ được xem phân công."
    : !context?.schedulePublishedAt ? "Quay lại Bước 5 và công bố đầy đủ lịch thi đấu trước khi phân công trọng tài." : null };
}
function publishedMatches(context: Context | null) {
  if (!context) return [];
  return context.fixtures.filter((fixture) => !fixture.bye).flatMap((fixture) => {
    const schedule = context.schedules.find((row) => row.matchId === fixture.id && row.status === "PUBLISHED");
    return schedule ? [{ fixture, schedule }] : [];
  });
}
export function refereeDutyWindow(context: Context, fixture: DemoFixture, schedule: Schedule) {
  const timing = fixture.stage === "GROUP" ? context.resources?.groupTiming : context.resources?.knockoutTiming;
  if (!timing || !Number.isFinite(Date.parse(schedule.scheduledDate)) || !Number.isFinite(schedule.durationMinutes) || schedule.durationMinutes <= 0) throw new AppError(409, "Thiếu cấu hình thời lượng hoặc lịch chính thức hợp lệ từ Bước 5.", "REFEREE_DRAFT_SCHEDULE_INVALID");
  return { occupiedFrom: new Date(Date.parse(schedule.scheduledDate) - timing.preparationBeforeMinutes * 60000).toISOString(),
    occupiedTo: new Date(Date.parse(schedule.scheduledDate) + (schedule.durationMinutes + timing.transitionAfterMinutes) * 60000).toISOString() };
}
function eligibilityContext(context: Context, fixture: DemoFixture, schedule: Schedule, minimumRestMinutes: number, duties: Awaited<ReturnType<typeof refereeDuties>>) {
  return { ...refereeDutyWindow(context, fixture, schedule), scheduleId: schedule.id, venueId: schedule.venueId, format: context.pitchType,
    minimumRestMinutes, travelMinutes: context.resources?.travelBufferMinutes ?? 0, duties };
}
async function data(actor: Actor, tournamentId: string) {
  const authorization = await access(actor, tournamentId);
  const [saved, drafts, published, team, publications, deliveries] = await Promise.all([findRefereeConfiguration(tournamentId), listRefereeDrafts(tournamentId), publishedRefereeCrews(tournamentId), getTournamentRefereeTeam(actor, tournamentId), refereePublications(tournamentId), refereeDeliveryViews(tournamentId)]);
  const duties = await refereeDuties(team.members.map((member) => member.userId));
  return { ...authorization, saved, drafts, published, team, duties, publications, deliveries };
}
type Data = Awaited<ReturnType<typeof data>>;
function assignmentRow(loaded: Data, fixture: DemoFixture, schedule: Schedule) {
  const draft = loaded.drafts.find((row) => row.scheduleId === schedule.id);
  const publication = loaded.publications.get(schedule.id);
  const positions = publication?.positions ?? (loaded.saved ? effectiveRefereePositions(loaded.saved.configuration, fixture).positions : []);
  const published = loaded.published.get(schedule.id);
  const slots: RefereeDraftSlot[] = published?.map((slot) => ({ position: slot.position, refereeId: slot.refereeId })) ?? draft?.slots ?? [];
  const completeness = draftCompleteness(positions, slots);
  const issues: RefereeEligibilityIssue[] = [];
  if (slots.length && !loaded.saved) issues.push({ code: "CONFIGURATION_MISSING", message: "Chưa có cấu hình trọng tài đã lưu cho giải." });
  if (loaded.context && loaded.saved) {
    const candidateContext = eligibilityContext(loaded.context, fixture, schedule, loaded.saved.configuration.minimumRestMinutes ?? 0, loaded.duties);
    for (const slot of slots) {
      const position = positions.find((row) => row.code === slot.position);
      const candidate = loaded.team.members.find((member) => member.userId === slot.refereeId);
      if (!position || !candidate) issues.push({ code: "DRAFT_RECHECK_REQUIRED", message: `Vị trí ${slot.position} hoặc trọng tài không còn thuộc cấu hình/đội ngũ giải.` });
      else issues.push(...refereeEligibility(candidate, position, candidateContext).issues);
    }
    if (draft && (draft.occupiedFrom !== candidateContext.occupiedFrom || draft.occupiedTo !== candidateContext.occupiedTo)) issues.push({ code: "SCHEDULE_CHANGED", message: "Lịch hoặc thời gian chiếm dụng đã đổi; cần kiểm tra và lưu lại phân công." });
  }
  const isPublished = Boolean(published || publication || draft?.publishedAt);
  if (publication && JSON.stringify([...publication.slots].sort((a, b) => a.position.localeCompare(b.position))) !== JSON.stringify([...slots].sort((a, b) => a.position.localeCompare(b.position)))) issues.push({ code: "PUBLISHED_CREW_CHANGED", message: "Tổ trọng tài hiện tại khác phiên bản công bố; cần kiểm tra lịch sử." });
  const status: RefereeAssignmentState = issues.length ? "CONFLICT" : isPublished ? "PUBLISHED" : !slots.length ? "UNASSIGNED" : positions.length && completeness.complete ? "COMPLETE" : "PARTIAL";
  const venue = loaded.context?.resources?.venues.find((row) => row.id === schedule.venueId);
  return { matchId: fixture.id, scheduleId: schedule.id, fixture, schedule, venueName: venue?.name ?? schedule.venueId,
    positions, slots, revision: draft?.revision ?? 0, configurationRevision: loaded.saved?.revision ?? 0, scheduleSignature: refereeScheduleSignature(schedule),
    ...completeness, status, issues, isPublished, publication: publication ? { revision: publication.revision, publishedBy: publication.publishedBy, publishedAt: publication.publishedAt } : null,
    crew: slots.map((slot) => ({ ...slot, label: positions.find((p) => p.code === slot.position)?.label ?? slot.position, fullName: loaded.team.members.find((member) => member.userId === slot.refereeId)?.identity.fullName ?? slot.refereeId })),
    deliveries: loaded.deliveries.filter((item) => item.scheduleId === schedule.id && item.publicationRevision === publication?.revision), updatedAt: draft?.updatedAt ?? null };
}

export async function getRefereeAssignmentWorkspace(actor: Actor, tournamentId: string) {
  const loaded = await data(actor, tournamentId);
  const matches = publishedMatches(loaded.context).map(({ fixture, schedule }) => assignmentRow(loaded, fixture, schedule));
  const complete = matches.filter((match) => match.complete && ["COMPLETE", "PUBLISHED"].includes(match.status)).length;
  const context = loaded.context;
  return { tournamentId, readOnly: Boolean(loaded.readOnlyReason), readOnlyReason: loaded.readOnlyReason,
    configurationRequired: !loaded.saved, configurationRevision: loaded.saved?.revision ?? 0,
    people: loaded.team.members.map((member) => ({ userId: member.userId, fullName: member.identity.fullName })),
    minimumRestMinutes: loaded.saved?.configuration.minimumRestMinutes ?? 0,
    matches, stats: { total: matches.length, complete, missing: matches.filter((match) => !match.complete).length, conflicts: matches.filter((match) => match.issues.length).length, published: matches.filter((match) => match.isPublished).length, completionRate: matches.length ? Math.round(complete / matches.length * 100) : 0 },
    scheduleContext: context ? { tournamentId, drawVersionId: context.drawVersionId, diagramVersion: context.diagramVersion, fixtures: matches.map((row) => row.fixture),
      entries: Object.fromEntries(matches.map((row) => [row.matchId, context.entries[row.matchId]])), resources: context.resources,
      schedulePublishedAt: context.schedulePublishedAt, tournamentContext: context.tournamentContext, rules: context.rules } : null };
}

export async function getRefereeAssignmentSuggestions(actor: Actor, tournamentId: string, matchId: string, query: unknown, previewPositions?: unknown) {
  parseRefereeRequestId(matchId);
  const loaded = await data(actor, tournamentId);
  const match = publishedMatches(loaded.context).find((row) => row.fixture.id === matchId);
  if (!match) throw new AppError(404, "Trận không thuộc lịch chính thức của giải.", "REFEREE_DRAFT_MATCH_NOT_FOUND");
  const row = assignmentRow(loaded, match.fixture, match.schedule);
  if (previewPositions !== undefined) row.positions = parseRefereePositions(previewPositions);
  const status = (await getMatch(matchId)).status;
  const operationLocked = !["UNSCHEDULED", "SCHEDULED", "POSTPONED"].includes(status);
  const readOnlyReason = loaded.readOnlyReason ?? (row.isPublished ? "Phân công đã công bố; không được thay đổi trong bản nháp." : operationLocked ? "Trận đã bắt đầu điều hành; không thể thay đổi phân công." : !loaded.saved ? "Lưu cấu hình trọng tài tại tab Cấu hình trọng tài trước khi phân công." : null);
  const search = typeof query === "string" ? query.trim().slice(0, 200).toLocaleLowerCase("vi") : "";
  const candidates = loaded.team.members.filter((candidate) => !search || `${candidate.identity.fullName} ${candidate.identity.email} ${candidate.profile.organization}`.toLocaleLowerCase("vi").includes(search));
  return { ...row, readOnly: Boolean(readOnlyReason), readOnlyReason, canReplace: row.isPublished && Boolean(row.publication) && !loaded.readOnlyReason && !operationLocked,
    minimumRestMinutes: loaded.saved?.configuration.minimumRestMinutes ?? 0,
    occupancy: refereeDutyWindow(loaded.context!, match.fixture, match.schedule),
    suggestions: row.positions.map((position) => ({ position: position.code, candidates: candidates.map((candidate) => ({
      userId: candidate.userId, fullName: candidate.identity.fullName, email: candidate.identity.email, organization: candidate.profile.organization,
      ...refereeEligibility(candidate, position, eligibilityContext(loaded.context!, match.fixture, match.schedule, loaded.saved?.configuration.minimumRestMinutes ?? 0, loaded.duties)),
    })).sort((left, right) => Number(right.eligible) - Number(left.eligible) || left.totalAssignments - right.totalAssignments || (right.restMinutes ?? Number.MAX_SAFE_INTEGER) - (left.restMinutes ?? Number.MAX_SAFE_INTEGER) || left.fullName.localeCompare(right.fullName, "vi")) })) };
}

export { access as refereeAssignmentAccess, data as loadRefereeAssignmentData, publishedMatches as publishedRefereeMatches, eligibilityContext as refereeEligibilityContext };

export async function saveRefereeAssignmentDraft(actor: Actor, tournamentId: string, matchId: string, value: unknown) {
  parseRefereeRequestId(matchId);
  const input = parseRefereeDraft(value);
  const authorized = await access(actor, tournamentId);
  if (authorized.readOnlyReason) throw new AppError(409, authorized.readOnlyReason, "REFEREE_DRAFT_READ_ONLY");
  const initial = publishedMatches(authorized.context).find((row) => row.fixture.id === matchId);
  if (!initial) throw new AppError(404, "Trận không thuộc lịch chính thức của giải.", "REFEREE_DRAFT_MATCH_NOT_FOUND");
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await lockRefereeConfiguration(client, tournamentId);
    await client.query("SELECT id FROM schedules WHERE id=$1 FOR UPDATE", [initial.schedule.id]);
    const current = await access(actor, tournamentId);
    if (current.readOnlyReason) throw new AppError(409, current.readOnlyReason, "REFEREE_DRAFT_READ_ONLY");
    const match = publishedMatches(current.context).find((row) => row.fixture.id === matchId);
    if (!match || refereeScheduleSignature(match.schedule) !== input.scheduleSignature) throw new AppError(409, "Lịch trận đã thay đổi. Tải lại trước khi lưu phân công.", "REFEREE_DRAFT_SCHEDULE_CHANGED");
    const operation = await getMatch(matchId);
    if (!["UNSCHEDULED", "SCHEDULED", "POSTPONED"].includes(operation.status)) throw new AppError(409, "Trận đã bắt đầu điều hành; không được thay đổi phân công.", "REFEREE_DRAFT_MATCH_LOCKED");
    let saved = await findRefereeConfiguration(tournamentId, client);
    if (!saved || saved.revision !== input.configurationRevision) throw new AppError(409, "Cấu hình trọng tài đã thay đổi. Tải lại trước khi lưu.", "REFEREE_CONFIG_REVISION_CONFLICT");
    const draft = (await listRefereeDrafts(tournamentId, client)).find((row) => row.scheduleId === match.schedule.id);
    if ((draft?.revision ?? 0) !== input.expectedRevision) throw new AppError(409, "Phân công đã thay đổi ở phiên khác. Tải lại trước khi lưu.", "REFEREE_DRAFT_REVISION_CONFLICT");
    if (draft?.publishedAt || (await publishedRefereeCrews(tournamentId, client)).has(match.schedule.id)) throw new AppError(409, "Phân công chính thức đang được bảo vệ; không được ghi đè bằng bản nháp.", "REFEREE_DRAFT_PUBLISHED_LOCKED");
    if (input.matchPositions) {
      const existing = saved.configuration.overrides.find((row) => row.scope === "MATCH" && row.matchId === matchId);
      const configuration = { ...saved.configuration, overrides: [...saved.configuration.overrides.filter((row) => row !== existing), { id: existing?.id ?? randomUUID(), scope: "MATCH" as const, matchId, positions: input.matchPositions }] };
      saved = await saveRefereeConfiguration(tournamentId, configuration, saved.revision, actor.userId!, async () => {}, client, match.schedule.id);
    }
    const positions = effectiveRefereePositions(saved.configuration, match.fixture).positions;
    if (input.slots.some((slot) => !positions.some((position) => position.code === slot.position))) throw new AppError(400, "Vị trí phân công không thuộc cấu hình của trận.", "REFEREE_DRAFT_POSITION_INVALID");
    for (const refereeId of input.slots.map((slot) => slot.refereeId).sort()) await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [refereeId]);
    const team = await getTournamentRefereeTeam(actor, tournamentId);
    const duties = await refereeDuties(input.slots.map((slot) => slot.refereeId), client);
    const candidateContext = eligibilityContext(current.context!, match.fixture, match.schedule, saved.configuration.minimumRestMinutes ?? 0, duties);
    const conflicts: Array<{ position: string; refereeId: string; issues: RefereeEligibilityIssue[] }> = [];
    for (const slot of input.slots) {
      const candidate: RefereeAssignmentCandidate | undefined = team.members.find((member) => member.userId === slot.refereeId);
      if (!candidate) { conflicts.push({ ...slot, issues: [{ code: "NOT_IN_TEAM", message: "Trọng tài chưa thuộc đội ngũ giải." }] }); continue; }
      const result = refereeEligibility(candidate, positions.find((position) => position.code === slot.position)!, candidateContext);
      if (!result.eligible) conflicts.push({ ...slot, issues: result.issues });
    }
    if (conflicts.length) throw new AppError(409, "Không thể lưu các vị trí có trọng tài vi phạm ràng buộc.", "REFEREE_DRAFT_CONFLICT", { conflicts });
    await persistRefereeDraft(client, tournamentId, match.schedule.id, (draft?.revision ?? 0) + 1, saved.revision, positions, input.slots, candidateContext, actor.userId!);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  return getRefereeAssignmentSuggestions(actor, tournamentId, matchId, "");
}

async function persistRefereeDraft(client: PoolClient, tournamentId: string, scheduleId: string, revision: number, configurationRevision: number,
  positions: RefereePosition[], slots: RefereeDraftSlot[], occupancy: { occupiedFrom: string; occupiedTo: string; minimumRestMinutes: number }, updatedBy: string) {
  await client.query(`INSERT INTO schedule_referee_drafts(schedule_id,tournament_id,revision,configuration_revision,positions,occupied_from,occupied_to,minimum_rest_minutes,updated_by)
    VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9) ON CONFLICT(schedule_id) DO UPDATE SET revision=EXCLUDED.revision,configuration_revision=EXCLUDED.configuration_revision,
      positions=EXCLUDED.positions,occupied_from=EXCLUDED.occupied_from,occupied_to=EXCLUDED.occupied_to,minimum_rest_minutes=EXCLUDED.minimum_rest_minutes,updated_by=EXCLUDED.updated_by,updated_at=NOW()`,
    [scheduleId, tournamentId, revision, configurationRevision, JSON.stringify(positions), occupancy.occupiedFrom, occupancy.occupiedTo, occupancy.minimumRestMinutes, updatedBy]);
  await client.query("DELETE FROM schedule_referee_draft_slots WHERE schedule_id=$1", [scheduleId]);
  for (const slot of slots) await client.query("INSERT INTO schedule_referee_draft_slots(schedule_id,position,referee_id) VALUES($1,$2,$3)", [scheduleId, slot.position, slot.refereeId]);
}
