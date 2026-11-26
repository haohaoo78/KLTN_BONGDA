import type { PoolClient } from "pg";
import { getPool } from "../lib/db";
import { AppError } from "../lib/errors";
import type { RefereeAccessEmail, RefereeAccessEmailEvent, RefereeTeamMemberRecord, RefereeTeamProfile } from "../models/refereeTeam";
import { emptyRefereeTeamProfile } from "../services/refereeTeamValidation";

const iso = (value: Date | string | null) => value === null ? null : new Date(value).toISOString();
type MemberRow = {
  id: string; tournament_id: string; user_id: string; profile: RefereeTeamProfile;
  assignment_count: number | string; email_status: RefereeAccessEmail["status"] | "SENDING" | null;
  last_attempt_at: Date | string | null; sent_at: Date | string | null; error_code: string | null;
  created_at: Date | string; updated_at: Date | string;
};
const memberSelect = `SELECT member.id,member.tournament_id,profile.user_id,member.profile,member.created_at,member.updated_at,
  (SELECT COUNT(DISTINCT schedule.match_id)::int FROM schedules schedule
    WHERE schedule.tournament_id=member.tournament_id AND schedule.status<>'CANCELLED'
      AND (schedule.referee_id=profile.user_id OR EXISTS (
        SELECT 1 FROM schedule_referee_assignments assignment
        WHERE assignment.schedule_id=schedule.id AND assignment.referee_id=profile.user_id AND assignment.is_active=TRUE
      ) OR EXISTS (SELECT 1 FROM schedule_referee_draft_slots draft WHERE draft.schedule_id=schedule.id AND draft.referee_id=profile.user_id))) AS assignment_count,
  email.status AS email_status,email.last_attempt_at,email.sent_at,email.error_code
  FROM tournament_referee_team member JOIN referee_profiles profile ON profile.id=member.referee_profile_id
  LEFT JOIN LATERAL (SELECT status,last_attempt_at,sent_at,error_code FROM referee_team_access_emails
    WHERE member_id=member.id ORDER BY created_at DESC,id DESC LIMIT 1) email ON TRUE`;

function mapMember(row: MemberRow): RefereeTeamMemberRecord {
  return { id: row.id, tournamentId: row.tournament_id, userId: row.user_id,
    profile: { ...emptyRefereeTeamProfile(), ...row.profile }, assignmentCount: Number(row.assignment_count),
    accessEmail: { status: row.email_status === "SENT" || row.email_status === "FAILED" ? row.email_status : "PENDING",
      lastAttemptAt: iso(row.last_attempt_at), sentAt: iso(row.sent_at), ...(row.error_code ? { errorCode: row.error_code } : {}) },
    createdAt: iso(row.created_at)!, updatedAt: iso(row.updated_at)!,
  };
}

export async function listRefereeTeamMembers(tournamentId: string): Promise<RefereeTeamMemberRecord[]> {
  const result = await getPool().query<MemberRow>(`${memberSelect} WHERE member.tournament_id=$1 ORDER BY member.created_at,member.id`, [tournamentId]);
  return result.rows.map(mapMember);
}

export async function findRefereeTeamMember(tournamentId: string, memberId: string): Promise<RefereeTeamMemberRecord | null> {
  const result = await getPool().query<MemberRow>(`${memberSelect} WHERE member.tournament_id=$1 AND member.id=$2`, [tournamentId, memberId]);
  return result.rows[0] ? mapMember(result.rows[0]) : null;
}

type EventRow = { id: string; member_id: string; tournament_id: string; user_id: string; requested_by: string; request_id: string; operation: RefereeAccessEmailEvent["operation"]; status: RefereeAccessEmailEvent["status"]; event_key: string };
const eventSelect = `SELECT event.id,event.member_id,event.tournament_id,profile.user_id,event.requested_by,event.request_id,event.operation,event.status,event.event_key
  FROM referee_team_access_emails event JOIN tournament_referee_team member ON member.id=event.member_id
  JOIN referee_profiles profile ON profile.id=member.referee_profile_id`;
const mapEvent = (row: EventRow): RefereeAccessEmailEvent => ({ id: row.id, memberId: row.member_id, tournamentId: row.tournament_id,
  userId: row.user_id, requestedBy: row.requested_by, requestId: row.request_id, operation: row.operation, status: row.status, eventKey: row.event_key });

export async function findRefereeAccessEmailEvent(tournamentId: string, requestId: string): Promise<RefereeAccessEmailEvent | null> {
  const result = await getPool().query<EventRow>(`${eventSelect} WHERE event.tournament_id=$1 AND event.request_id=$2`, [tournamentId, requestId]);
  return result.rows[0] ? mapEvent(result.rows[0]) : null;
}

async function insertEvent(client: PoolClient, tournamentId: string, memberId: string, requestedBy: string, requestId: string, operation: RefereeAccessEmailEvent["operation"]) {
  await client.query(`INSERT INTO referee_team_access_emails(tournament_id,member_id,request_id,operation,requested_by,event_key)
    VALUES($1,$2,$3,$4,$5,$6)`, [tournamentId, memberId, requestId, operation, requestedBy, `referee-team:${tournamentId}:${requestId}`]);
}

export async function addRefereeTeamMember(tournamentId: string, userId: string, profile: RefereeTeamProfile, addedBy: string, requestId: string): Promise<{ memberId: string; created: boolean }> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('referee-team:'||$1)::bigint)", [tournamentId]);
    const prior = await client.query<EventRow>(`${eventSelect} WHERE event.tournament_id=$1 AND event.request_id=$2 FOR UPDATE OF event`, [tournamentId, requestId]);
    if (prior.rows[0]) {
      const event = prior.rows[0];
      if (event.user_id !== userId || event.requested_by !== addedBy || event.operation !== "ADD") throw new AppError(409, "Mã thao tác đã được dùng cho yêu cầu khác.", "REFEREE_REQUEST_REUSED");
      await client.query("COMMIT");
      return { memberId: event.member_id, created: false };
    }
    const referee = await client.query<{ id: string }>("INSERT INTO referee_profiles(user_id) VALUES($1) ON CONFLICT(user_id) DO UPDATE SET user_id=referee_profiles.user_id RETURNING id", [userId]);
    const member = await client.query<{ id: string }>(`INSERT INTO tournament_referee_team(tournament_id,referee_profile_id,profile,added_by)
      VALUES($1,$2,$3::jsonb,$4) ON CONFLICT(tournament_id,referee_profile_id) DO NOTHING RETURNING id`, [tournamentId, referee.rows[0].id, JSON.stringify(profile), addedBy]);
    if (!member.rows[0]) throw new AppError(409, "Trọng tài đã có trong đội ngũ của giải.", "REFEREE_ALREADY_IN_TEAM");
    await insertEvent(client, tournamentId, member.rows[0].id, addedBy, requestId, "ADD");
    await client.query("COMMIT");
    return { memberId: member.rows[0].id, created: true };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function updateRefereeTeamProfile(tournamentId: string, memberId: string, profile: RefereeTeamProfile): Promise<boolean> {
  const result = await getPool().query("UPDATE tournament_referee_team SET profile=$3::jsonb,updated_at=NOW() WHERE tournament_id=$1 AND id=$2 RETURNING id", [tournamentId, memberId, JSON.stringify(profile)]);
  return Boolean(result.rowCount);
}

export async function createRefereeAccessEmailEvent(tournamentId: string, memberId: string, requestedBy: string, requestId: string): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('referee-team:'||$1)::bigint)", [tournamentId]);
    const member = await client.query("SELECT id FROM tournament_referee_team WHERE tournament_id=$1 AND id=$2 FOR UPDATE", [tournamentId, memberId]);
    if (!member.rowCount) throw new AppError(404, "Không tìm thấy trọng tài trong giải.", "REFEREE_TEAM_MEMBER_NOT_FOUND");
    const prior = await client.query<{ member_id: string; requested_by: string; operation: string }>("SELECT member_id,requested_by,operation FROM referee_team_access_emails WHERE tournament_id=$1 AND request_id=$2", [tournamentId, requestId]);
    if (prior.rows[0]) {
      if (prior.rows[0].member_id !== memberId || prior.rows[0].requested_by !== requestedBy || prior.rows[0].operation !== "RESEND") throw new AppError(409, "Mã thao tác đã được dùng cho yêu cầu khác.", "REFEREE_REQUEST_REUSED");
    } else await insertEvent(client, tournamentId, memberId, requestedBy, requestId, "RESEND");
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function claimRefereeAccessEmailEvent(tournamentId: string, requestId: string): Promise<RefereeAccessEmailEvent | null> {
  const result = await getPool().query<{ id: string }>(`UPDATE referee_team_access_emails SET status='SENDING',attempts=attempts+1,
    last_attempt_at=NOW(),lease_until=NOW()+INTERVAL '60 seconds',updated_at=NOW()
    WHERE tournament_id=$1 AND request_id=$2 AND ((status='PENDING' AND attempts=0) OR (status='SENDING' AND lease_until<NOW())) RETURNING id`, [tournamentId, requestId]);
  return result.rowCount ? findRefereeAccessEmailEvent(tournamentId, requestId) : null;
}

export async function finishRefereeAccessEmailEvent(eventId: string, outcome: { status: RefereeAccessEmail["status"]; sentAt?: string; errorCode?: string }): Promise<void> {
  await getPool().query(`UPDATE referee_team_access_emails SET status=$2,lease_until=NULL,sent_at=$3,error_code=$4,updated_at=NOW()
    WHERE id=$1 AND status='SENDING'`, [eventId, outcome.status, outcome.status === "SENT" ? outcome.sentAt ?? new Date().toISOString() : null, outcome.errorCode ?? null]);
}

export async function markRefereeMemberNotification(memberId: string, status: "SENT" | "FAILED", errorCode: string | null): Promise<void> {
  await getPool().query("UPDATE tournament_referee_team SET notification_status=$2,notification_error_code=$3 WHERE id=$1", [memberId, status, errorCode]);
}
