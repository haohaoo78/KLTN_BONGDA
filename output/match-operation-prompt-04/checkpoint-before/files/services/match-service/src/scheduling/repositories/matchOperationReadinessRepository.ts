import type { PoolClient } from "pg";
import { getPool } from "../lib/db";
import { AppError } from "../../lib/errors";
import { mapSchedule } from "./schedulingRepository";
import type { Schedule, ScheduleRefereeAssignmentInput } from "../models/scheduling";
import type { RefereePosition } from "../models/refereeConfiguration";

export interface OperationScheduleContext {
  schedule: Schedule;
  crew: ScheduleRefereeAssignmentInput[];
  publication: { revision: number; positions: RefereePosition[]; slots: Array<{ position: string; refereeId: string }>; scheduleSignature: string; voided: boolean } | null;
  hasDraft: boolean;
  draftSlotCount: number;
  draftPositions: RefereePosition[];
  draftSlots: Array<{ position: string; refereeId: string }>;
}

const projection = `SELECT to_jsonb(s) AS schedule,
  p.revision,p.positions,p.slots,p.schedule_signature,p.voided_at,
  COALESCE(a.crew,'[]'::jsonb) AS crew,d.schedule_id AS draft_id,COALESCE(d.slot_count,0)::int AS draft_slot_count,d.positions AS draft_positions,d.slots AS draft_slots
  FROM schedules s
  LEFT JOIN LATERAL (SELECT * FROM schedule_referee_publications WHERE schedule_id=s.id ORDER BY revision DESC LIMIT 1) p ON TRUE
  LEFT JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('refereeId',referee_id,'position',position,'isFinalAuthority',is_final_authority) ORDER BY position) AS crew
    FROM schedule_referee_assignments WHERE schedule_id=s.id AND is_active=TRUE) a ON TRUE
  LEFT JOIN LATERAL (SELECT draft.schedule_id,draft.positions,COUNT(slot.position) AS slot_count,
    COALESCE(jsonb_agg(jsonb_build_object('position',slot.position,'refereeId',slot.referee_id)) FILTER(WHERE slot.position IS NOT NULL),'[]'::jsonb) AS slots FROM schedule_referee_drafts draft
    LEFT JOIN schedule_referee_draft_slots slot ON slot.schedule_id=draft.schedule_id WHERE draft.schedule_id=s.id GROUP BY draft.schedule_id) d ON TRUE`;

function view(row: Record<string, any>): OperationScheduleContext {
  return { schedule: mapSchedule(row.schedule), crew: row.crew,
    publication: row.revision == null ? null : { revision: row.revision, positions: row.positions, slots: row.slots, scheduleSignature: row.schedule_signature, voided: row.voided_at != null },
    hasDraft: row.draft_id != null, draftSlotCount: row.draft_slot_count, draftPositions: row.draft_positions ?? [], draftSlots: row.draft_slots ?? [] };
}

export async function listOperationSchedules(tournamentId: string): Promise<Map<string, OperationScheduleContext>> {
  const result = await getPool().query(`${projection} WHERE s.tournament_id=$1 AND s.status<>'CANCELLED' ORDER BY s.updated_at`, [tournamentId]);
  return new Map(result.rows.map(row => { const item = view(row); return [item.schedule.matchId, item]; }));
}

export async function readOperationSchedule(matchId: string, client?: PoolClient): Promise<OperationScheduleContext | null> {
  const result = await (client ?? getPool()).query(`${projection} WHERE s.match_id=$1 AND s.status<>'CANCELLED' ORDER BY s.updated_at DESC LIMIT 1`, [matchId]);
  return result.rows[0] ? view(result.rows[0]) : null;
}

/** Scheduling owns this read transaction. Match owns its own write transaction.
 * Every schedule/crew publication writer locks this parent schedule FOR UPDATE.
 * Hold FOR SHARE until the Match callback commits; always take Scheduling first.
 * No data is written here and this is not a distributed PostgreSQL transaction.
 */
export async function withOperationScheduleLock<T>(matchId: string, task: (context: OperationScheduleContext) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    const locked = await client.query("SELECT id FROM schedules WHERE match_id=$1 AND status='PUBLISHED' ORDER BY updated_at DESC LIMIT 1 FOR SHARE", [matchId]);
    if (!locked.rowCount) throw new AppError(409, "Trận chưa có lịch thi đấu đã công bố.", "PUBLISHED_SCHEDULE_REQUIRED");
    const context = await readOperationSchedule(matchId, client);
    if (!context || context.schedule.id !== locked.rows[0].id || context.schedule.status !== "PUBLISHED") throw new AppError(409, "Lịch trận vừa thay đổi. Hãy tải lại.", "MATCH_OPERATION_SCHEDULE_CHANGED");
    const result = await task(context);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "55P03") throw new AppError(409, "Lịch hoặc tổ trọng tài đang được cập nhật. Hãy tải lại rồi thử lại.", "MATCH_OPERATION_BUSY");
    throw error;
  } finally { client.release(); }
}
