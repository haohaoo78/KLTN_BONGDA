import { getPool } from "../lib/db";
import { AppError } from "../lib/errors";
import type { PoolClient } from "pg";

export type TournamentInvitationStatus = "PENDING" | "ACCEPTED" | "DECLINED" | "EXPIRED" | "CANCELLED" | "INVALIDATED" | "WITHDRAWN";
export type TournamentInvitationInput = {
  teamId: string; tournamentId: string; playerId: string; invitedBy: string;
  competitionRole: "PLAYER" | "PLAYING_CAPTAIN" | "VICE_CAPTAIN";
  lineupRole: "STARTER" | "SUBSTITUTE"; isGoalkeeper: boolean;
  proposedJerseyNumber: number | null; positionSnapshot: string | null;
  message: string | null; expiresAt: string; tournamentStartDate: string; tournamentEndDate: string; tournamentName: string;
};

export async function createTournamentInvitations(input: TournamentInvitationInput[]) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = [];
    for (const invitation of input) {
      const player = await client.query(
        `SELECT user_id FROM players WHERE id=$1 AND team_id=$2 AND left_at IS NULL FOR SHARE`,
        [invitation.playerId, invitation.teamId],
      );
      const userId = player.rows[0]?.user_id as string | null | undefined;
      if (!userId) throw Object.assign(new Error("Every invited player must have a linked account"), { code: "PLAYER_ACCOUNT_REQUIRED" });
      const row = await client.query(
        `INSERT INTO tournament_player_invitations
          (tournament_id,team_id,player_id,player_user_id,invited_by,competition_role,lineup_role,is_goalkeeper,
           proposed_jersey_number,position_snapshot,message,expires_at,tournament_start_date,tournament_end_date,tournament_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::date,$14::date,$15)
         RETURNING *`,
        [invitation.tournamentId, invitation.teamId, invitation.playerId, userId, invitation.invitedBy,
          invitation.competitionRole, invitation.lineupRole, invitation.isGoalkeeper,
          invitation.proposedJerseyNumber, invitation.positionSnapshot, invitation.message, invitation.expiresAt,
          invitation.tournamentStartDate, invitation.tournamentEndDate, invitation.tournamentName],
      );
      result.push(row.rows[0]);
    }
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505") {
      throw new AppError(409, "Cầu thủ đã có lời mời đang hiệu lực cho giải này", "ACTIVE_INVITATION_EXISTS");
    }
    throw error;
  } finally { client.release(); }
}

export async function listTournamentInvitationsForPlayer(userId: string) {
  await getPool().query(`UPDATE tournament_player_invitations SET status='EXPIRED',updated_at=NOW() WHERE player_user_id=$1 AND status='PENDING' AND expires_at<=NOW()`, [userId]);
  const result = await getPool().query(
    `SELECT i.*, t.name AS team_name, p.full_name, p.student_id, registration.status AS registration_status
     FROM tournament_player_invitations i
     JOIN teams t ON t.id=i.team_id JOIN players p ON p.id=i.player_id
     LEFT JOIN team_registrations registration ON registration.team_id=i.team_id AND registration.tournament_id=i.tournament_id
     WHERE i.player_user_id=$1 ORDER BY i.created_at DESC`, [userId],
  );
  return result.rows;
}

export async function listTournamentInvitationsForTeam(teamId: string, tournamentId: string) {
  await getPool().query(`UPDATE tournament_player_invitations SET status='EXPIRED',updated_at=NOW() WHERE team_id=$1 AND tournament_id=$2 AND status='PENDING' AND expires_at<=NOW()`, [teamId,tournamentId]);
  const result = await getPool().query(
    `SELECT i.*, p.full_name, p.student_id FROM tournament_player_invitations i
     JOIN players p ON p.id=i.player_id WHERE i.team_id=$1 AND i.tournament_id=$2 ORDER BY i.created_at DESC`,
    [teamId, tournamentId],
  );
  return result.rows;
}

export async function respondToTournamentInvitation(id: string, userId: string, status: "ACCEPTED" | "DECLINED" | "WITHDRAWN") {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE tournament_player_invitations SET status=$3, responded_at=NOW(), updated_at=NOW()
       WHERE id=$1 AND player_user_id=$2 AND status=CASE WHEN $3='WITHDRAWN' THEN 'ACCEPTED' ELSE 'PENDING' END
         AND ($3='WITHDRAWN' OR expires_at>NOW()) RETURNING *`,
      [id, userId, status],
    );
    const invitation = result.rows[0];
    if (!invitation) { await client.query("ROLLBACK"); return null; }
    let invalidatedInvitations: Record<string, unknown>[] = [];
    if (status === "ACCEPTED") {
      const player = await client.query<{ full_name: string }>("SELECT full_name FROM players WHERE id=$1", [invitation.player_id]);
      const conflicts = await client.query(
        `WITH candidates AS (
           SELECT other.id, team.captain_id, team.name AS team_name, player.full_name
           FROM tournament_player_invitations other
           JOIN teams team ON team.id=other.team_id
           JOIN players player ON player.id=other.player_id
           WHERE other.player_id=$1 AND other.player_user_id=$7 AND other.id<>$4 AND other.status='PENDING'
             AND other.tournament_start_date IS NOT NULL AND other.tournament_end_date IS NOT NULL
             AND $5::date <= other.tournament_end_date AND $6::date >= other.tournament_start_date
           FOR UPDATE OF other
         )
         UPDATE tournament_player_invitations other
         SET status='INVALIDATED', conflict_tournament_id=$2, conflict_tournament_name=$3,
             status_reason='Cầu thủ đã xác nhận tham gia một giải có thời gian tổ chức trùng nhau', updated_at=NOW()
         FROM candidates
         WHERE other.id=candidates.id
         RETURNING other.*, candidates.captain_id, candidates.team_name, candidates.full_name`,
        [invitation.player_id, invitation.tournament_id, invitation.tournament_name ?? null, invitation.id,
          invitation.tournament_start_date, invitation.tournament_end_date, userId],
      );
      invalidatedInvitations = conflicts.rows;
      const acceptedTournamentName = invitation.tournament_name ?? "giải khác";
      const playerName = player.rows[0]?.full_name ?? "Cầu thủ";
      for (const affected of invalidatedInvitations) {
        const invalidatedTournamentName = String(affected.tournament_name ?? "giải của bạn");
        const notificationData = {
          invitationId: affected.id,
          status: "INVALIDATED",
          acceptedTournamentId: invitation.tournament_id,
          acceptedTournamentName,
          invalidatedTournamentId: affected.tournament_id,
        };
        await enqueueInvalidationNotification(client, {
          userId: String(affected.captain_id),
          idempotencyKey: `invitation-invalidated:${affected.id}:captain`,
          title: "Lời mời cầu thủ đã bị vô hiệu hóa",
          body: `Cầu thủ ${playerName} đã xác nhận tham gia giải ${acceptedTournamentName}. Lời mời tham gia giải ${invalidatedTournamentName} đã bị vô hiệu hóa. Vui lòng chọn cầu thủ thay thế.`,
          data: notificationData,
        });
        await enqueueInvalidationNotification(client, {
          userId,
          idempotencyKey: `invitation-invalidated:${affected.id}:player`,
          title: "Lời mời tham gia giải không còn hiệu lực",
          body: `Lời mời tham gia giải ${invalidatedTournamentName} đã bị vô hiệu hóa vì bạn đã xác nhận tham gia giải ${acceptedTournamentName}.`,
          data: notificationData,
        });
      }
    }
    await client.query("COMMIT");
    return { ...invitation, invalidatedInvitations };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function markTournamentInvitationInvalidated(
  id: string, userId: string, reason: string, conflictTournamentId?: string, conflictTournamentName?: string,
) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE tournament_player_invitations SET status='INVALIDATED', status_reason=$3,
         conflict_tournament_id=$4, conflict_tournament_name=$5, updated_at=NOW()
       WHERE id=$1 AND player_user_id=$2 AND status='PENDING' RETURNING *`,
      [id, userId, reason, conflictTournamentId ?? null, conflictTournamentName ?? null],
    );
    const invitation = result.rows[0];
    if (!invitation) { await client.query("COMMIT"); return null; }
    const recipients = await client.query<{ captain_id: string; team_name: string; full_name: string }>(
      `SELECT team.captain_id, team.name AS team_name, player.full_name
       FROM tournament_player_invitations invitation
       JOIN teams team ON team.id=invitation.team_id
       JOIN players player ON player.id=invitation.player_id WHERE invitation.id=$1`,
      [id],
    );
    const recipient = recipients.rows[0];
    if (recipient) {
      const acceptedTournamentName = conflictTournamentName ?? "giải khác";
      const notificationData = {
        invitationId: id, status: "INVALIDATED",
        acceptedTournamentId: conflictTournamentId ?? null,
        acceptedTournamentName,
        invalidatedTournamentId: invitation.tournament_id,
      };
      await enqueueInvalidationNotification(client, {
        userId: recipient.captain_id, idempotencyKey: `invitation-invalidated:${id}:captain`,
        title: "Lời mời cầu thủ đã bị vô hiệu hóa",
        body: `Cầu thủ ${recipient.full_name} đã xác nhận tham gia giải ${acceptedTournamentName}. Lời mời tham gia giải ${invitation.tournament_name ?? "của bạn"} đã bị vô hiệu hóa. Vui lòng chọn cầu thủ thay thế.`,
        data: notificationData,
      });
      await enqueueInvalidationNotification(client, {
        userId, idempotencyKey: `invitation-invalidated:${id}:player`,
        title: "Lời mời tham gia giải không còn hiệu lực",
        body: `Lời mời tham gia giải ${invitation.tournament_name ?? "khác"} đã bị vô hiệu hóa vì bạn đã xác nhận tham gia giải ${acceptedTournamentName}.`,
        data: notificationData,
      });
    }
    await client.query("COMMIT");
    return invitation;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

async function enqueueInvalidationNotification(client: PoolClient, input: {
  userId: string; idempotencyKey: string; title: string; body: string; data: Record<string, unknown>;
}): Promise<void> {
  await client.query(
    `INSERT INTO organization_notification_outbox(user_id,type,title,body,data,idempotency_key)
     VALUES($1,'TOURNAMENT_INVITATION',$2,$3,$4::jsonb,$5)
     ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
    [input.userId,input.title,input.body,JSON.stringify(input.data),input.idempotencyKey],
  );
}

export async function getAcceptedTournamentInvitations(teamId: string, tournamentId: string, playerIds: string[]) {
  const result = await getPool().query(
    `SELECT i.*, p.full_name, p.student_id, p.birth_date FROM tournament_player_invitations i
     JOIN players p ON p.id=i.player_id
     WHERE i.team_id=$1 AND i.tournament_id=$2 AND i.player_id=ANY($3::uuid[]) AND i.status='ACCEPTED'`,
    [teamId, tournamentId, playerIds],
  );
  return result.rows;
}

export async function listAcceptedTournamentInvitations(teamId: string, tournamentId: string) {
  const result = await getPool().query(
    `SELECT i.*, p.full_name, p.student_id, p.birth_date FROM tournament_player_invitations i
     JOIN players p ON p.id=i.player_id
     WHERE i.team_id=$1 AND i.tournament_id=$2 AND i.status='ACCEPTED'
       AND p.left_at IS NULL AND p.user_id IS NOT NULL ORDER BY p.full_name`, [teamId, tournamentId],
  );
  return result.rows;
}

export async function getInvitationWithCaptain(id: string) {
  const result = await getPool().query(
    `SELECT i.*, t.captain_id, p.full_name AS player_name FROM tournament_player_invitations i
     JOIN teams t ON t.id=i.team_id JOIN players p ON p.id=i.player_id WHERE i.id=$1`, [id],
  );
  return result.rows[0] ?? null;
}

export async function listAcceptedTournamentInvitationClaims() {
  const result = await getPool().query(
    `SELECT invitation.id,invitation.team_id,invitation.tournament_id,invitation.player_id,invitation.status,
            invitation.responded_at,invitation.created_at
     FROM tournament_player_invitations invitation
     LEFT JOIN team_registrations registration
       ON registration.team_id=invitation.team_id AND registration.tournament_id=invitation.tournament_id
     WHERE invitation.status='ACCEPTED'
       AND (registration.id IS NULL OR registration.status IN ('DRAFT','PENDING','APPROVED','WAITLIST','NEEDS_SUPPLEMENT','REVISION_REQUIRED','CONFLICT_ADJUSTMENT_REQUIRED'))
     ORDER BY invitation.responded_at NULLS LAST, invitation.created_at, invitation.id`,
  );
  return result.rows as Array<{ id: string; team_id: string; tournament_id: string; player_id: string; status: string; responded_at: string | null }>;
}

export async function updateInvitationForCaptain(id: string, teamId: string, action: "CANCELLED" | "REMIND") {
  const sql = action === "CANCELLED"
    ? `UPDATE tournament_player_invitations SET status='CANCELLED',updated_at=NOW() WHERE id=$1 AND team_id=$2 AND status='PENDING' AND expires_at>NOW() RETURNING *`
    : `UPDATE tournament_player_invitations SET last_reminded_at=NOW(),updated_at=NOW() WHERE id=$1 AND team_id=$2 AND status='PENDING' AND expires_at>NOW() RETURNING *`;
  const result = await getPool().query(sql, [id, teamId]);
  return result.rows[0] ?? null;
}

export async function markTournamentInvitationsWithdrawn(invitationIds: string[]): Promise<void> {
  if (!invitationIds.length) return;
  await getPool().query(
    `UPDATE tournament_player_invitations SET status='WITHDRAWN',responded_at=COALESCE(responded_at,NOW()),updated_at=NOW()
     WHERE id=ANY($1::uuid[]) AND status='ACCEPTED'`, [invitationIds],
  );
}
