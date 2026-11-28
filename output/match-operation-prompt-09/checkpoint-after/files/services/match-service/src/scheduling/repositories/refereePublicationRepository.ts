import type { PoolClient } from "pg";
import { getPool } from "../lib/db";
import type { RefereePosition } from "../models/refereeConfiguration";
import type { RefereeDraftSlot } from "../models/refereeAssignment";

export interface RefereePublication {
  scheduleId: string; revision: number; action: "PUBLISH" | "REPLACE"; positions: RefereePosition[]; slots: RefereeDraftSlot[];
  publishedBy: string; publishedAt: string; reason: string | null; requestId: string; requestHash: string; voidedAt: string | null; voidReason: string | null;
}
export const publicationView = (row: Record<string, any>): RefereePublication => ({ scheduleId: row.schedule_id, revision: row.revision,
  action: row.action, positions: row.positions, slots: row.slots, publishedBy: row.published_by,
  publishedAt: new Date(row.published_at).toISOString(), reason: row.reason, requestId: row.request_id, requestHash: row.request_hash, voidedAt: row.voided_at ? new Date(row.voided_at).toISOString() : null, voidReason: row.void_reason ?? null });
export async function refereePublications(tournamentId: string, client?: PoolClient) {
  const result = await (client ?? getPool()).query(`SELECT DISTINCT ON(p.schedule_id) p.* FROM schedule_referee_publications p
    JOIN schedules s ON s.id=p.schedule_id WHERE s.tournament_id=$1 AND p.voided_at IS NULL ORDER BY p.schedule_id,p.revision DESC`, [tournamentId]);
  return new Map(result.rows.map((row) => [row.schedule_id as string, publicationView(row)]));
}
export async function publishedRefereePositions(matchId: string): Promise<RefereePosition[] | null> {
  const result = await getPool().query(`SELECT p.positions FROM schedule_referee_publications p JOIN schedules s ON s.id=p.schedule_id
    WHERE s.match_id=$1 AND s.status='PUBLISHED' AND p.voided_at IS NULL ORDER BY p.revision DESC LIMIT 1`, [matchId]);
  return result.rows[0]?.positions ?? null;
}
export async function refereeDeliveryViews(tournamentId: string) {
  const result = await getPool().query(`SELECT m.id,m.schedule_id,m.publication_revision,m.referee_id,m.position,m.kind,
    m.notification_status,a.status,a.error_code,a.sent_at,a.id AS attempt_id,
    m.payload->>'fullName' AS full_name FROM referee_assignment_messages m JOIN schedules s ON s.id=m.schedule_id
    LEFT JOIN LATERAL (SELECT * FROM referee_assignment_email_attempts a WHERE a.message_id=m.id ORDER BY a.created_at DESC,a.id DESC LIMIT 1) a ON TRUE
    WHERE s.tournament_id=$1 ORDER BY m.created_at,m.id`, [tournamentId]);
  return result.rows.map((row) => ({ id: row.id as string, scheduleId: row.schedule_id as string, publicationRevision: row.publication_revision as number,
    refereeId: row.referee_id as string, position: row.position as string, kind: row.kind as "PUBLISHED" | "REPLACED_IN" | "REPLACED_OUT", fullName: row.full_name as string,
    notificationStatus: row.notification_status as "PENDING" | "SENT" | "FAILED", emailStatus: (row.status ?? "PENDING") as "PENDING" | "SENT" | "FAILED",
    errorCode: row.error_code as string | null, sentAt: row.sent_at ? new Date(row.sent_at).toISOString() : null }));
}
