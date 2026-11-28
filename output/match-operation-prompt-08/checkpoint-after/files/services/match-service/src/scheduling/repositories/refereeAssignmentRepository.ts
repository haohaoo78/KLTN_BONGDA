import type { PoolClient } from "pg";
import { getPool } from "../lib/db";
import { getPool as matchPool } from "../../lib/db";
import { AppError } from "../../lib/errors";
import type { RefereeAssignmentDraft, RefereeDuty } from "../models/refereeAssignment";

const iso = (value: string | Date) => new Date(value).toISOString();
export async function publishedRefereeCrews(tournamentId: string, client?: PoolClient): Promise<Map<string, import("../models/scheduling").ScheduleRefereeAssignmentInput[]>> {
  const result = await (client ?? getPool()).query(`SELECT s.id,s.referee_id,a.position,a.referee_id AS assigned_referee_id,a.is_final_authority
    FROM schedules s LEFT JOIN schedule_referee_assignments a ON a.schedule_id=s.id AND a.is_active=TRUE
    WHERE s.tournament_id=$1 AND s.status<>'CANCELLED' AND (a.id IS NOT NULL OR s.referee_id IS NOT NULL)`, [tournamentId]);
  const crews = new Map<string, import("../models/scheduling").ScheduleRefereeAssignmentInput[]>();
  for (const row of result.rows) {
    const crew = crews.get(row.id) ?? [];
    crew.push({ refereeId: row.assigned_referee_id ?? row.referee_id, position: row.position ?? "REFEREE", isFinalAuthority: row.assigned_referee_id ? row.is_final_authority : true });
    crews.set(row.id, crew);
  }
  return crews;
}
export async function listRefereeDrafts(tournamentId: string, client?: PoolClient): Promise<RefereeAssignmentDraft[]> {
  const result = await (client ?? getPool()).query(`SELECT d.*,COALESCE(jsonb_agg(jsonb_build_object('position',s.position,'refereeId',s.referee_id) ORDER BY s.position) FILTER(WHERE s.position IS NOT NULL),'[]'::jsonb) AS slots
    FROM schedule_referee_drafts d LEFT JOIN schedule_referee_draft_slots s ON s.schedule_id=d.schedule_id
    WHERE d.tournament_id=$1 GROUP BY d.schedule_id ORDER BY d.schedule_id`, [tournamentId]);
  return result.rows.map((row) => ({ scheduleId: row.schedule_id, tournamentId: row.tournament_id, revision: row.revision,
    configurationRevision: row.configuration_revision, positions: row.positions, slots: row.slots, occupiedFrom: iso(row.occupied_from),
    occupiedTo: iso(row.occupied_to), minimumRestMinutes: row.minimum_rest_minutes, publishedAt: row.published_at ? iso(row.published_at) : null, updatedAt: iso(row.updated_at) }));
}

/** Include unannounced drafts and legacy/published crews across every tournament. */
export async function refereeDuties(refereeIds?: string[], client?: PoolClient): Promise<RefereeDuty[]> {
  if (refereeIds && !refereeIds.length) return [];
  const rows = await (client ?? getPool()).query(`WITH people AS (
      SELECT schedule_id,referee_id FROM schedule_referee_assignments WHERE is_active=TRUE
      UNION SELECT id,referee_id FROM schedules WHERE referee_id IS NOT NULL
      UNION SELECT schedule_id,referee_id FROM schedule_referee_draft_slots
    ) SELECT p.referee_id,s.id,s.match_id,s.tournament_id,s.venue_id,s.scheduled_date,s.duration_minutes,r.resources,
      COALESCE((rfc.configuration->>'minimumRestMinutes')::int,0) AS minimum_rest_minutes
      FROM people p JOIN schedules s ON s.id=p.schedule_id
      LEFT JOIN tournament_schedule_resources r ON r.tournament_id=s.tournament_id
      LEFT JOIN tournament_referee_configurations rfc ON rfc.tournament_id=s.tournament_id
      WHERE s.status<>'CANCELLED' AND ($1::uuid[] IS NULL OR p.referee_id=ANY($1::uuid[]))`, [refereeIds ?? null]);
  const ids = [...new Set(rows.rows.map((row) => row.match_id as string))];
  const stages = ids.length ? await matchPool().query("SELECT id,stage FROM matches WHERE id=ANY($1::uuid[])", [ids]) : { rows: [] };
  const stageById = new Map(stages.rows.map((row) => [row.id, row.stage]));
  return rows.rows.map((row) => {
    const resources = row.resources;
    const stage = stageById.get(row.match_id);
    const timing = stage === "GROUP" ? resources?.groupTiming : stage === "KNOCKOUT" ? resources?.knockoutTiming : null;
    const prep = timing?.preparationBeforeMinutes ?? Math.max(resources?.groupTiming?.preparationBeforeMinutes ?? 0, resources?.knockoutTiming?.preparationBeforeMinutes ?? 0);
    const transition = timing?.transitionAfterMinutes ?? Math.max(resources?.groupTiming?.transitionAfterMinutes ?? 0, resources?.knockoutTiming?.transitionAfterMinutes ?? 0);
    const start = new Date(row.scheduled_date).getTime();
    return { scheduleId: row.id, matchId: row.match_id, tournamentId: row.tournament_id, refereeId: row.referee_id, venueId: row.venue_id,
      startsAt: new Date(start - prep * 60000).toISOString(), endsAt: new Date(start + (row.duration_minutes + transition) * 60000).toISOString(), minimumRestMinutes: Number(row.minimum_rest_minutes) };
  });
}

export async function assertNoRefereeDraftOverlap(client: PoolClient, scheduleId: string | null, refereeIds: string[], startsAt: string, endsAt: string): Promise<void> {
  if (!refereeIds.length) return;
  const duties = await refereeDuties(refereeIds, client);
  const conflict = duties.find((duty) => duty.scheduleId !== scheduleId && Date.parse(duty.startsAt) < Date.parse(endsAt) && Date.parse(duty.endsAt) > Date.parse(startsAt));
  if (conflict) throw new AppError(409, "Trọng tài đã có phân công hoặc bản nháp trùng thời gian ở trận khác.", "REFEREE_DRAFT_CONFLICT", { matchId: conflict.matchId, refereeId: conflict.refereeId });
}

export async function assertDraftReservationsForSchedule(client: PoolClient, scheduleId: string | null, refereeIds: string[], input?: { tournamentId: string; matchId: string; scheduledDate: string; durationMinutes: number }): Promise<void> {
  if (!refereeIds.length) return;
  const current = input ?? (await client.query(`SELECT tournament_id AS "tournamentId",match_id AS "matchId",scheduled_date AS "scheduledDate",duration_minutes AS "durationMinutes" FROM schedules WHERE id=$1`, [scheduleId])).rows[0];
  if (!current) return;
  const resources = (await client.query("SELECT resources FROM tournament_schedule_resources WHERE tournament_id=$1", [current.tournamentId])).rows[0]?.resources;
  const stage = (await matchPool().query("SELECT stage FROM matches WHERE id=$1", [current.matchId])).rows[0]?.stage;
  const timing = stage === "GROUP" ? resources?.groupTiming : resources?.knockoutTiming;
  const start = new Date(current.scheduledDate).getTime();
  await assertNoRefereeDraftOverlap(client, scheduleId, refereeIds, new Date(start - (timing?.preparationBeforeMinutes ?? 0) * 60000).toISOString(), new Date(start + (current.durationMinutes + (timing?.transitionAfterMinutes ?? 0)) * 60000).toISOString());
}
