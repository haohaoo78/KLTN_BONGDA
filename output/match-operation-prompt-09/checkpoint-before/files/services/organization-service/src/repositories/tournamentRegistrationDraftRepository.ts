import { getPool } from "../lib/db";
import { AppError } from "../lib/errors";

export type TournamentRegistrationDraft = {
  teamId: string;
  tournamentId: string;
  updatedBy: string;
  roster: Array<{
    playerId: string;
    competitionRole: "PLAYER" | "PLAYING_CAPTAIN" | "VICE_CAPTAIN";
    lineupRole: "STARTER" | "SUBSTITUTE";
    isGoalkeeper: boolean;
    proposedJerseyNumber: number | null;
    position: string | null;
  }>;
  notes: string;
  updatedAt: string;
  registrationId: string | null;
  baseVersion: number | null;
  editingSubmitted: boolean;
  draftState: "DRAFT" | "DRAFT_CHANGES";
};

function mapDraft(row: Record<string, unknown>): TournamentRegistrationDraft {
  return {
    teamId: String(row.team_id),
    tournamentId: String(row.tournament_id),
    updatedBy: String(row.updated_by),
    roster: row.roster as TournamentRegistrationDraft["roster"],
    notes: String(row.notes ?? ""),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
    registrationId: row.registration_id ? String(row.registration_id) : null,
    baseVersion: row.base_version === null || row.base_version === undefined ? null : Number(row.base_version),
    editingSubmitted: row.editing_submitted === true,
    draftState: row.draft_state === "DRAFT_CHANGES" || row.editing_submitted === true ? "DRAFT_CHANGES" : "DRAFT",
  };
}

export async function getTournamentRegistrationDraft(teamId: string, tournamentId: string) {
  const result = await getPool().query(
    `SELECT team_id,tournament_id,updated_by,roster,notes,updated_at,registration_id,base_version,editing_submitted,draft_state
     FROM tournament_registration_drafts WHERE team_id=$1 AND tournament_id=$2`,
    [teamId, tournamentId],
  );
  return result.rows[0] ? mapDraft(result.rows[0]) : null;
}

export async function saveTournamentRegistrationDraft(input: {
  teamId: string;
  tournamentId: string;
  updatedBy: string;
  roster: TournamentRegistrationDraft["roster"];
  notes: string;
  registrationId?: string | null;
  baseVersion?: number | null;
  editingSubmitted?: boolean;
  draftState?: "DRAFT" | "DRAFT_CHANGES";
}) {
  const client = await getPool().connect();
  try {
  await client.query("BEGIN");
  if (input.registrationId) {
    const locked = await client.query(
      `SELECT id,status,version FROM team_registrations WHERE id=$1 AND team_id=$2 AND tournament_id=$3 FOR UPDATE`,
      [input.registrationId,input.teamId,input.tournamentId],
    );
    if (!locked.rowCount || !["PENDING","NEEDS_SUPPLEMENT","REVISION_REQUIRED","CONFLICT_ADJUSTMENT_REQUIRED","REJECTED"].includes(locked.rows[0].status)
      || (input.baseVersion !== null && input.baseVersion !== undefined && Number(locked.rows[0].version) !== input.baseVersion)) {
      await client.query("ROLLBACK");
      throw new AppError(409, "Hồ sơ đã đổi trạng thái hoặc phiên bản; tải lại trước khi chỉnh sửa.", "REGISTRATION_EDIT_CONFLICT");
    }
    const decision = await client.query(
      `SELECT 1 FROM team_registration_decision_outbox WHERE registration_id=$1 AND state IN ('PENDING','PROCESSING') LIMIT 1`,
      [input.registrationId],
    );
    if (decision.rowCount) {
      await client.query("ROLLBACK");
      throw new AppError(409, "BTC đang xử lý quyết định hồ sơ; không thể bắt đầu chỉnh sửa lúc này.", "REGISTRATION_DECISION_SYNC_PENDING");
    }
  }
  const result = await client.query(
    `INSERT INTO tournament_registration_drafts (team_id,tournament_id,updated_by,roster,notes,updated_at,registration_id,base_version,editing_submitted,draft_state)
     VALUES ($1,$2,$3,$4::jsonb,$5,NOW(),$6,$7,$8,$9)
     ON CONFLICT (team_id,tournament_id) DO UPDATE SET
       updated_by=EXCLUDED.updated_by,roster=EXCLUDED.roster,notes=EXCLUDED.notes,updated_at=NOW(),
       registration_id=EXCLUDED.registration_id,base_version=EXCLUDED.base_version,editing_submitted=EXCLUDED.editing_submitted,draft_state=EXCLUDED.draft_state
     RETURNING team_id,tournament_id,updated_by,roster,notes,updated_at,registration_id,base_version,editing_submitted,draft_state`,
    [input.teamId, input.tournamentId, input.updatedBy, JSON.stringify(input.roster), input.notes,input.registrationId ?? null,input.baseVersion ?? null,input.editingSubmitted ?? false,input.draftState ?? (input.editingSubmitted ? "DRAFT_CHANGES" : "DRAFT")],
  );
  await client.query("COMMIT");
  return mapDraft(result.rows[0]);
  } catch(error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function deleteTournamentRegistrationDraft(teamId: string, tournamentId: string) {
  await getPool().query(
    "DELETE FROM tournament_registration_drafts WHERE team_id=$1 AND tournament_id=$2",
    [teamId, tournamentId],
  );
}
