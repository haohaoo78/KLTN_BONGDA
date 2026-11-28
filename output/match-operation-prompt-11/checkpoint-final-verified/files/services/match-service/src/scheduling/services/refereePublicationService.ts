import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { AppError } from "../../lib/errors";
import { getMatch } from "../../services/matchService";
import { publishCommittedMatchUpdate } from "../../realtime/matchRealtime";
import { getPool } from "../lib/db";
import type { AuthenticatedRequest } from "../middleware/gatewayUser";
import type { RefereeDraftSlot } from "../models/refereeAssignment";
import type { RefereePosition } from "../models/refereeConfiguration";
import { lockRefereeConfiguration } from "../repositories/refereeConfigurationRepository";
import { listRefereeDrafts, publishedRefereeCrews, refereeDuties } from "../repositories/refereeAssignmentRepository";
import { refereePublications, publicationView } from "../repositories/refereePublicationRepository";
import { refereeEligibility } from "./refereeAssignmentValidation";
import { loadRefereeAssignmentData, publishedRefereeMatches, refereeAssignmentAccess, refereeEligibilityContext, refereeScheduleSignature } from "./refereeAssignmentService";
import { enqueueRefereeMessage, type AssignmentMessagePayload } from "./refereePublicationDelivery";
import { parseRefereePublication, parseRefereeReplacement, validateOfficialRefereeCrew } from "./refereePublicationValidation";
import { parseRefereeRequestId } from "./refereeTeamValidation";
import { config } from "../../config";

type Actor = AuthenticatedRequest;
type Loaded = Awaited<ReturnType<typeof loadRefereeAssignmentData>>;
type Match = ReturnType<typeof publishedRefereeMatches>[number];
async function officialTeamNames(tournamentId: string): Promise<Map<string, string>> {
  let response: Response;
  try { response = await fetch(new URL(`/internal/tournaments/${encodeURIComponent(tournamentId)}/approved-teams`, config.organizationServiceUrl), { headers: { "x-gateway-internal-key": config.internalApiKey }, signal: AbortSignal.timeout(8000) }); }
  catch { throw new AppError(503, "Không lấy được tên đội chính thức để công bố phân công.", "REFEREE_PUBLICATION_TEAMS_UNAVAILABLE"); }
  if (!response.ok) throw new AppError(502, "Không lấy được tên đội chính thức.", "REFEREE_PUBLICATION_TEAMS_UNAVAILABLE");
  const body = await response.json() as { teams?: Array<{ id: string; name: string }> } | Array<{ id: string; name: string }>;
  const teams = Array.isArray(body) ? body : body.teams;
  if (!Array.isArray(teams) || teams.some((team) => typeof team.id !== "string" || typeof team.name !== "string")) throw new AppError(502, "Dữ liệu tên đội không hợp lệ.", "REFEREE_PUBLICATION_TEAMS_UNAVAILABLE");
  return new Map(teams.map((team) => [team.id, team.name]));
}

function assertMutable(loaded: { readOnlyReason: string | null }) {
  if (loaded.readOnlyReason) throw new AppError(409, loaded.readOnlyReason, "REFEREE_PUBLICATION_READ_ONLY");
}
async function assertNotStarted(matchId: string) {
  if (!["UNSCHEDULED", "SCHEDULED", "POSTPONED"].includes((await getMatch(matchId)).status)) throw new AppError(409, "Trận đã bắt đầu điều hành; không được công bố hoặc thay thế tổ trọng tài.", "REFEREE_PUBLICATION_MATCH_LOCKED");
}
async function lockRequest(client: PoolClient, actor: Actor, tournamentId: string, requestId: string, hash: string) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [`referee-publication-request:${requestId}`]);
  const rows = await client.query(`SELECT p.*,s.tournament_id,s.match_id FROM schedule_referee_publications p JOIN schedules s ON s.id=p.schedule_id WHERE p.request_id=$1`, [requestId]);
  if (rows.rows.some((row) => row.voided_at)) throw new AppError(409, "This publication was voided; reload the current draft.", "REFEREE_PUBLICATION_VOIDED");
  if (rows.rows.some((row) => row.request_hash !== hash || row.published_by !== actor.userId || row.tournament_id !== tournamentId)) throw new AppError(409, "Mã thao tác đã được sử dụng cho dữ liệu khác.", "REFEREE_PUBLICATION_REQUEST_REUSED");
  return rows.rows.map((row) => row.match_id as string);
}
async function validatePeople(loaded: Loaded, match: Match, positions: RefereePosition[], slots: RefereeDraftSlot[], client: PoolClient) {
  validateOfficialRefereeCrew(positions, slots);
  const context = refereeEligibilityContext(loaded.context!, match.fixture, match.schedule, loaded.saved?.configuration.minimumRestMinutes ?? 0, await refereeDuties(slots.map((slot) => slot.refereeId), client));
  const conflicts = slots.flatMap((slot) => {
    const candidate = loaded.team.members.find((member) => member.userId === slot.refereeId), position = positions.find((p) => p.code === slot.position)!;
    const issues = candidate ? refereeEligibility(candidate, position, context).issues : [{ code: "NOT_IN_TEAM", message: "Trọng tài không thuộc đội ngũ giải." }];
    return issues.length ? [{ matchId: match.fixture.id, position: position.label, refereeId: slot.refereeId, issues }] : [];
  });
  if (conflicts.length) throw new AppError(409, "Phân công vi phạm ràng buộc; chưa công bố/thay thế trận nào.", "REFEREE_PUBLICATION_CONFLICT", { conflicts });
  return context;
}
function messagePayload(loaded: Loaded, match: Match, names: Map<string, string>, position: RefereePosition, userId: string, kind: AssignmentMessagePayload["kind"], reason?: string): AssignmentMessagePayload {
  const member = loaded.team.members.find((person) => person.userId === userId);
  if (!member) throw new AppError(409, "Không xác định được người nhận thông báo.", "REFEREE_PUBLICATION_RECIPIENT_MISSING");
  const venue = loaded.context!.resources?.venues.find((row) => row.id === match.schedule.venueId);
  return { email: member.identity.email, fullName: member.identity.fullName, tournamentId: loaded.context!.tournamentId,
    tournamentName: loaded.context!.tournamentContext.name, matchId: match.fixture.id,
    matchLabel: `${names.get(match.fixture.homeTeamId ?? "") ?? match.fixture.homeSource ?? match.fixture.homeTeamId ?? "Chờ xác định"} — ${names.get(match.fixture.awayTeamId ?? "") ?? match.fixture.awaySource ?? match.fixture.awayTeamId ?? "Chờ xác định"}`.slice(0, 1000),
    position: position.label, scheduledAt: match.schedule.scheduledDate, venueName: venue?.name ?? match.schedule.venueId, location: venue?.location ?? "", kind, ...(reason ? { reason } : {}) };
}
async function persist(client: PoolClient, loaded: Loaded, match: Match, names: Map<string, string>, positions: RefereePosition[], slots: RefereeDraftSlot[], actor: Actor,
  input: { action: "PUBLISH" | "REPLACE"; requestId: string; hash: string; sourceRevision: number; reason?: string; changedPosition?: string; oldRefereeId?: string }) {
  const revision = Number((await client.query("SELECT COALESCE(MAX(revision),0)+1 AS revision FROM schedule_referee_publications WHERE schedule_id=$1", [match.schedule.id])).rows[0].revision);
  const before = (await client.query(`SELECT referee_id AS "refereeId",position,is_final_authority AS "isFinalAuthority" FROM schedule_referee_assignments WHERE schedule_id=$1 AND is_active=TRUE ORDER BY position`, [match.schedule.id])).rows;
  const assignments = slots.map((slot) => ({ ...slot, isFinalAuthority: positions.find((p) => p.code === slot.position)!.capabilities.includes("FINALIZE") }));
  await client.query(`INSERT INTO schedule_referee_publications(schedule_id,revision,action,positions,slots,published_by,reason,request_id,request_hash,schedule_signature,source_draft_revision)
    VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9,$10,$11)`, [match.schedule.id, revision, input.action, JSON.stringify(positions), JSON.stringify(slots), actor.userId, input.reason ?? null, input.requestId, input.hash, refereeScheduleSignature(match.schedule), input.sourceRevision]);
  await client.query("INSERT INTO schedule_referee_assignment_history(schedule_id,before_assignments,after_assignments,changed_by,reason) VALUES($1,$2::jsonb,$3::jsonb,$4,$5)", [match.schedule.id, JSON.stringify(before), JSON.stringify(assignments), actor.userId, input.reason ?? "Công bố phân công chính thức"]);
  await client.query("UPDATE schedule_referee_assignments SET is_active=FALSE,updated_at=NOW() WHERE schedule_id=$1 AND is_active=TRUE", [match.schedule.id]);
  for (const slot of assignments) await client.query("INSERT INTO schedule_referee_assignments(schedule_id,referee_id,position,is_final_authority,assigned_by) VALUES($1,$2,$3,$4,$5)", [match.schedule.id, slot.refereeId, slot.position, slot.isFinalAuthority, actor.userId]);
  // Keep schedule rows, including date/time/venue/lock/referee_id, byte-for-byte unchanged.
  await client.query("UPDATE schedule_referee_drafts SET published_at=COALESCE(published_at,NOW()),revision=revision+1,positions=$2::jsonb,updated_by=$3,updated_at=NOW() WHERE schedule_id=$1", [match.schedule.id, JSON.stringify(positions), actor.userId]);
  await client.query("DELETE FROM schedule_referee_draft_slots WHERE schedule_id=$1", [match.schedule.id]);
  for (const slot of slots) await client.query("INSERT INTO schedule_referee_draft_slots(schedule_id,position,referee_id) VALUES($1,$2,$3)", [match.schedule.id, slot.position, slot.refereeId]);
  for (const slot of slots.filter((slot) => input.action === "PUBLISH" || slot.position === input.changedPosition)) {
    const position = positions.find((p) => p.code === slot.position)!;
    await enqueueRefereeMessage(client, match.schedule.id, revision, slot.refereeId, slot.position, messagePayload(loaded, match, names, position, slot.refereeId, input.action === "PUBLISH" ? "PUBLISHED" : "REPLACED_IN", input.reason), actor.userId!);
  }
  if (input.oldRefereeId && input.changedPosition) await enqueueRefereeMessage(client, match.schedule.id, revision, input.oldRefereeId, input.changedPosition, messagePayload(loaded, match, names, positions.find((p) => p.code === input.changedPosition)!, input.oldRefereeId, "REPLACED_OUT", input.reason), actor.userId!);
  return revision;
}

export async function publishRefereeAssignments(actor: Actor, tournamentId: string, value: unknown) {
  const input = parseRefereePublication(value), hash = createHash("sha256").update(JSON.stringify([tournamentId, "PUBLISH", input.matches])).digest("hex");
  assertMutable(await refereeAssignmentAccess(actor, tournamentId));
  const client = await getPool().connect(); let replayed = false;
  try {
    await client.query("BEGIN");
    const previous = await lockRequest(client, actor, tournamentId, input.requestId, hash);
    replayed = previous.length > 0;
    if (!replayed) {
      const names = await officialTeamNames(tournamentId);
      await lockRefereeConfiguration(client, tournamentId);
      await client.query("SELECT id FROM schedules WHERE tournament_id=$1 AND match_id=ANY($2::uuid[]) ORDER BY id FOR UPDATE", [tournamentId, input.matches.map((row) => row.matchId)]);
      let loaded = await loadRefereeAssignmentData(actor, tournamentId); assertMutable(loaded);
      const all = publishedRefereeMatches(loaded.context), drafts = await listRefereeDrafts(tournamentId, client), publications = await refereePublications(tournamentId, client), active = await publishedRefereeCrews(tournamentId, client);
      const selected = input.matches.map((requested) => {
        const match = all.find((row) => row.fixture.id === requested.matchId), draft = drafts.find((row) => row.scheduleId === match?.schedule.id);
        if (!match) throw new AppError(404, "Trận không thuộc lịch công bố của giải.", "REFEREE_DRAFT_MATCH_NOT_FOUND");
        if (publications.has(match.schedule.id) || active.has(match.schedule.id) || draft?.publishedAt) throw new AppError(409, `Trận ${requested.matchId} đã công bố phân công.`, "REFEREE_PUBLICATION_ALREADY_PUBLISHED");
        if (!draft || draft.revision !== requested.expectedRevision || loaded.saved?.revision !== requested.configurationRevision) throw new AppError(409, `Bản nháp/cấu hình trận ${requested.matchId} đã thay đổi. Tải lại trước khi công bố.`, "REFEREE_PUBLICATION_REVISION_CONFLICT");
        if (refereeScheduleSignature(match.schedule) !== requested.scheduleSignature) throw new AppError(409, `Lịch trận ${requested.matchId} đã thay đổi.`, "REFEREE_DRAFT_SCHEDULE_CHANGED");
        return { match, draft };
      });
      const people = [...new Set(selected.flatMap(({ draft }) => draft.slots.map((slot) => slot.refereeId)))].sort();
      for (const person of people) await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [person]);
      loaded = await loadRefereeAssignmentData(actor, tournamentId); assertMutable(loaded);
      const { effectiveRefereePositions } = await import("./refereeConfigurationValidation");
      for (const { match, draft } of selected) {
        await assertNotStarted(match.fixture.id);
        const positions = effectiveRefereePositions(loaded.saved!.configuration, match.fixture).positions;
        try { await validatePeople(loaded, match, positions, draft.slots, client); }
        catch (error) { if (error instanceof AppError) throw new AppError(error.status, `Trận ${match.fixture.id}: ${error.message}`, error.code, error.details); throw error; }
        await persist(client, loaded, match, names, positions, draft.slots, actor, { action: "PUBLISH", requestId: input.requestId, hash, sourceRevision: draft.revision });
      }
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  if (!replayed) for (const row of input.matches) await publishCommittedMatchUpdate(row.matchId, "referees.published");
  return { publishedMatchIds: input.matches.map((row) => row.matchId), replayed };
}

export async function replacePublishedReferee(actor: Actor, tournamentId: string, matchId: string, value: unknown) {
  parseRefereeRequestId(matchId);
  const input = parseRefereeReplacement(value), hash = createHash("sha256").update(JSON.stringify([tournamentId, matchId, "REPLACE", input])).digest("hex");
  assertMutable(await refereeAssignmentAccess(actor, tournamentId));
  const client = await getPool().connect(); let replayed = false;
  try {
    await client.query("BEGIN"); replayed = (await lockRequest(client, actor, tournamentId, input.requestId, hash)).length > 0;
    if (!replayed) {
      const names = await officialTeamNames(tournamentId);
      await lockRefereeConfiguration(client, tournamentId);
      const schedule = (await client.query("SELECT id FROM schedules WHERE tournament_id=$1 AND match_id=$2 AND status='PUBLISHED' FOR UPDATE", [tournamentId, matchId])).rows[0];
      if (!schedule) throw new AppError(404, "Không tìm thấy lịch công bố của trận.", "REFEREE_DRAFT_MATCH_NOT_FOUND");
      const publication = (await refereePublications(tournamentId, client)).get(schedule.id);
      if (!publication || publication.revision !== input.expectedPublicationRevision) throw new AppError(409, "Phiên bản công bố đã thay đổi. Tải lại trước khi thay thế.", "REFEREE_PUBLICATION_REVISION_CONFLICT");
      if (!publication.slots.some((slot) => slot.position === input.position && slot.refereeId === input.oldRefereeId)) throw new AppError(409, "Trọng tài/vị trí hiện tại đã thay đổi.", "REFEREE_REPLACEMENT_STALE");
      const slots = publication.slots.map((slot) => slot.position === input.position ? { ...slot, refereeId: input.newRefereeId } : slot);
      for (const person of [...new Set([...slots.map((slot) => slot.refereeId), input.oldRefereeId])].sort()) await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [person]);
      const loaded = await loadRefereeAssignmentData(actor, tournamentId); assertMutable(loaded);
      const match = publishedRefereeMatches(loaded.context).find((row) => row.fixture.id === matchId)!;
      if (!match || refereeScheduleSignature(match.schedule) !== input.scheduleSignature) throw new AppError(409, "Lịch trận đã thay đổi. Tải lại trước khi thay thế.", "REFEREE_DRAFT_SCHEDULE_CHANGED");
      await assertNotStarted(matchId); await validatePeople(loaded, match, publication.positions, slots, client);
      const draft = (await listRefereeDrafts(tournamentId, client)).find((row) => row.scheduleId === schedule.id);
      if (!draft) throw new AppError(409, "Thiếu bản ghi nguồn của phân công chính thức.", "REFEREE_PUBLICATION_SOURCE_MISSING");
      await persist(client, loaded, match, names, publication.positions, slots, actor, { action: "REPLACE", requestId: input.requestId, hash, sourceRevision: draft.revision, reason: input.reason, oldRefereeId: input.oldRefereeId, changedPosition: input.position });
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  if (!replayed) await publishCommittedMatchUpdate(matchId, "referees.replaced");
  return { matchId, replayed };
}

export async function getRefereePublicationHistory(actor: Actor, tournamentId: string, matchId: string) {
  parseRefereeRequestId(matchId); await refereeAssignmentAccess(actor, tournamentId);
  const result = await getPool().query(`SELECT p.* FROM schedule_referee_publications p JOIN schedules s ON s.id=p.schedule_id WHERE s.tournament_id=$1 AND s.match_id=$2 ORDER BY p.revision DESC`, [tournamentId, matchId]);
  return { versions: result.rows.map(publicationView) };
}
