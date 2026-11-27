import type {
  Card,
  CardCreateInput,
  Suspension,
  SuspensionCreateInput,
  Complaint,
  ComplaintCreateInput,
  ComplaintUpdateInput,
  DisciplinaryDecision,
  DisciplinaryDecisionCreateInput,
  ComplaintAppeal,
  ComplaintAppealCreateInput,
  ComplaintAppealReviewInput,
} from "../models/discipline";
import { AppError } from "../lib/errors";
import {
  listCards,
  createCard,
  listSuspensions,
  findSuspensionById,
  createSuspension,
  updateSuspension,
  listComplaints,
  findComplaintById,
  createComplaint,
  updateComplaint,
  createDisciplinaryDecision,
  listDisciplinaryDecisions,
  voidCardBySourceEventId,
  createComplaintAppeal,
  findComplaintAppeal,
  findComplaintAppealByComplaintId,
  listComplaintAppeals,
  updateComplaintAppeal,
  countUnsuspendedYellowCards,
} from "../repositories/disciplineRepository";
import { getPool as getMatchPool } from "../../lib/db";
import { getTournamentDisciplinePolicy } from "../../services/tournamentDisciplinePolicy";

// Cards
export async function getCards(tournamentId: string, playerId?: string, teamId?: string): Promise<Card[]> {
  return listCards(tournamentId, playerId, teamId);
}

export async function issueCard(input: CardCreateInput, issuedBy: string): Promise<Card> {
  if (input.minute !== undefined && (input.minute < 0 || input.minute > 120)) {
    throw new AppError(400, "Invalid minute value", "INVALID_MINUTE");
  }

  const matchPool = getMatchPool();
  const matchResult = await matchPool.query<{
    tournament_id: string;
    home_team_id: string | null;
    away_team_id: string | null;
    status: string;
  }>("SELECT tournament_id, home_team_id, away_team_id, status FROM matches WHERE id = $1", [input.matchId]);
  const match = matchResult.rows[0];
  if (!match) throw new AppError(404, "Match not found", "MATCH_NOT_FOUND");
  if (match.tournament_id !== input.tournamentId) {
    throw new AppError(409, "Card tournament does not match the fixture", "MATCH_TOURNAMENT_MISMATCH");
  }
  if (![match.home_team_id, match.away_team_id].includes(input.teamId)) {
    throw new AppError(409, "Card team is not participating in this fixture", "CARD_TEAM_NOT_IN_MATCH");
  }
  if (!input.sourceEventId && match.status !== "IN_PROGRESS") {
    throw new AppError(409, "A card can only be issued during a live match", "MATCH_NOT_IN_PROGRESS");
  }
  if (input.sourceEventId) {
    const sourceEvent = await matchPool.query<{
      match_id: string;
      team_id: string;
      player_id: string | null;
      event_type: string;
      voided_at: string | null;
    }>(
      "SELECT match_id, team_id, player_id, event_type, voided_at FROM match_events WHERE id = $1",
      [input.sourceEventId],
    );
    const event = sourceEvent.rows[0];
    if (!event || event.voided_at || event.match_id !== input.matchId || event.team_id !== input.teamId
      || event.player_id !== input.playerId
      || event.event_type !== `${input.cardType}_CARD`) {
      throw new AppError(409, "Card event source does not match the recorded match event", "CARD_EVENT_SOURCE_MISMATCH");
    }
  }
  const lineupPlayer = await matchPool.query(
    "SELECT 1 FROM lineups WHERE match_id = $1 AND team_id = $2 AND player_id = $3",
    [input.matchId, input.teamId, input.playerId],
  );
  if (!lineupPlayer.rowCount) {
    throw new AppError(409, "The carded player is not in this team's match lineup", "PLAYER_NOT_IN_LINEUP");
  }

  const policy = await getTournamentDisciplinePolicy(input.tournamentId, input.matchId);
  const card = await createCard(input, issuedBy);
  const suspensionStart = new Date();
  const suspensionEnd = new Date(suspensionStart.getTime() + 365 * 24 * 60 * 60 * 1000);

  if (input.cardType === "RED") {
    const suspensionInput: SuspensionCreateInput = {
      playerId: input.playerId,
      tournamentId: input.tournamentId,
      teamId: input.teamId,
      type: "RED_CARD",
      startDate: new Date().toISOString(),
      endDate: suspensionEnd.toISOString(),
      reason: `Red card in match ${input.matchId}`,
      matchId: input.matchId,
      sourceCardId: card.id,
      matchesSuspended: policy.suspensionMatches,
    };
    await createSuspension(suspensionInput, issuedBy);
  } else if (policy.yellowCardsForSuspension > 0) {
    const yellowCardCount = await countUnsuspendedYellowCards(input.playerId, input.tournamentId);
    if (yellowCardCount >= policy.yellowCardsForSuspension) {
      await createSuspension({
        playerId: input.playerId,
        tournamentId: input.tournamentId,
        teamId: input.teamId,
        type: "YELLOW_CARDS",
        startDate: suspensionStart.toISOString(),
        endDate: suspensionEnd.toISOString(),
        reason: `Accumulated ${policy.yellowCardsForSuspension} yellow cards`,
        matchId: input.matchId,
        sourceCardId: card.id,
        matchesSuspended: policy.suspensionMatches,
      }, issuedBy);
    }
  }

  return card;
}

export async function retractEventCard(eventId: string, actorId: string, reason: string): Promise<void> {
  await voidCardBySourceEventId(eventId, actorId, reason);
}

// Suspensions
export async function getSuspensions(tournamentId: string, playerId?: string, isActive?: boolean): Promise<Suspension[]> {
  return listSuspensions(tournamentId, playerId, isActive);
}

export async function getSuspension(id: string): Promise<Suspension> {
  const suspension = await findSuspensionById(id);
  if (!suspension) {
    throw new AppError(404, "Suspension not found", "SUSPENSION_NOT_FOUND");
  }
  return suspension;
}

export async function issueSuspension(input: SuspensionCreateInput, issuedBy: string): Promise<Suspension> {
  if (new Date(input.startDate) >= new Date(input.endDate)) {
    throw new AppError(400, "Start date must be before end date", "INVALID_DATES");
  }
  if (input.matchesSuspended !== undefined && input.matchesSuspended !== null
    && (!Number.isInteger(input.matchesSuspended) || input.matchesSuspended < 1)) {
    throw new AppError(400, "matchesSuspended must be a positive integer", "INVALID_MATCH_SUSPENSION");
  }

  return createSuspension(input, issuedBy);
}

export async function liftSuspension(id: string): Promise<Suspension> {
  const suspension = await updateSuspension(id, false);
  if (!suspension) {
    throw new AppError(404, "Suspension not found", "SUSPENSION_NOT_FOUND");
  }
  return suspension;
}

export async function checkPlayerSuspension(playerId: string, tournamentId: string, matchId?: string): Promise<boolean> {
  const suspensions = await listSuspensions(tournamentId, playerId, true);
  const now = new Date();
  for (const suspension of suspensions) {
    if (suspension.matchesSuspended !== null) {
      // Without a target fixture, report any unlifted match-count ban as active.
      if (!matchId) return true;
      const matchPool = getMatchPool();
      const targetResult = await matchPool.query<{
        match_date: string | null;
        tournament_id: string;
        home_team_id: string | null;
        away_team_id: string | null;
      }>(
        `SELECT match_date, tournament_id, home_team_id, away_team_id FROM matches WHERE id = $1`,
        [matchId],
      );
      const target = targetResult.rows[0];
      if (!target) throw new AppError(404, "Match not found", "MATCH_NOT_FOUND");
      if (target.tournament_id !== tournamentId) {
        throw new AppError(409, "Match does not belong to this tournament", "MATCH_TOURNAMENT_MISMATCH");
      }
      if (![target.home_team_id, target.away_team_id].includes(suspension.teamId)) continue;
      if (!target.match_date) return true;
      if (Date.parse(target.match_date) <= Date.parse(suspension.startDate)) continue;
      const served = await matchPool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM matches played
         JOIN match_results result ON result.match_id = played.id AND result.status = 'APPROVED'
         WHERE played.tournament_id = $1
           AND (played.home_team_id = $2 OR played.away_team_id = $2)
           AND played.id <> $3
           AND played.status IN ('VERIFIED', 'LOCKED')
           AND played.match_date < $4::timestamptz
           AND played.match_date > COALESCE(
             (SELECT source.match_date FROM matches source WHERE source.id = $5),
             $6::timestamptz
           )`,
        [tournamentId, suspension.teamId, matchId, target.match_date, suspension.matchId, suspension.startDate],
      );
      if (Number(served.rows[0]?.count ?? 0) < suspension.matchesSuspended) return true;
      continue;
    }
    if (new Date(suspension.startDate) <= now && new Date(suspension.endDate) >= now) return true;
  }
  return false;
}

// Complaints
export async function getComplaints(tournamentId: string, status?: string, teamId?: string): Promise<Complaint[]> {
  return listComplaints(tournamentId, status, teamId);
}

export async function getComplaint(id: string): Promise<Complaint> {
  const complaint = await findComplaintById(id);
  if (!complaint) {
    throw new AppError(404, "Complaint not found", "COMPLAINT_NOT_FOUND");
  }
  return complaint;
}

export async function submitComplaint(input: ComplaintCreateInput): Promise<Complaint> {
  if (!input.description.trim()) {
    throw new AppError(400, "Description is required", "INVALID_DESCRIPTION");
  }

  return createComplaint(input);
}

export async function reviewComplaint(id: string, input: ComplaintUpdateInput, reviewedBy: string): Promise<Complaint> {
  if (!["UNDER_REVIEW", "APPROVED", "REJECTED", "CLOSED"].includes(input.status ?? "")) {
    throw new AppError(400, "A valid complaint decision status is required", "INVALID_COMPLAINT_STATUS");
  }
  const current = await getComplaint(id);
  if (current.status !== "PENDING" && current.status !== "UNDER_REVIEW") {
    throw new AppError(409, "This complaint has already been decided", "COMPLAINT_ALREADY_DECIDED");
  }
  if (input.status === "REJECTED" && !input.decisionReason?.trim()) {
    throw new AppError(400, "A reason is required when rejecting a complaint", "DECISION_REASON_REQUIRED");
  }
  const updated = await updateComplaint(id, input, reviewedBy);
  if (!updated) {
    throw new AppError(404, "Complaint not found", "COMPLAINT_NOT_FOUND");
  }
  return updated;
}

export async function getComplaintAppeal(id: string): Promise<ComplaintAppeal> {
  const appeal = await findComplaintAppeal(id);
  if (!appeal) throw new AppError(404, "Complaint appeal not found", "COMPLAINT_APPEAL_NOT_FOUND");
  return appeal;
}

export async function getComplaintAppealByComplaintId(complaintId: string): Promise<ComplaintAppeal | null> {
  return findComplaintAppealByComplaintId(complaintId);
}

export async function getComplaintAppeals(tournamentId: string, status?: string): Promise<ComplaintAppeal[]> {
  return listComplaintAppeals(tournamentId, status);
}

export async function submitComplaintAppeal(input: ComplaintAppealCreateInput): Promise<ComplaintAppeal> {
  const current = await getComplaint(input.complaintId);
  if (!["APPROVED", "REJECTED", "CLOSED"].includes(current.status)) {
    throw new AppError(409, "Only a decided complaint can be appealed", "COMPLAINT_NOT_APPEALABLE");
  }
  if (current.submittedBy !== input.submittedBy) {
    throw new AppError(403, "Only the original complainant may submit an appeal", "APPEAL_SUBMITTER_MISMATCH");
  }
  if (!input.description.trim()) throw new AppError(400, "Appeal grounds are required", "INVALID_APPEAL_DESCRIPTION");
  try {
    return await createComplaintAppeal(input);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      throw new AppError(409, "An appeal has already been submitted for this complaint", "APPEAL_ALREADY_SUBMITTED");
    }
    throw error;
  }
}

export async function reviewComplaintAppeal(
  id: string, input: ComplaintAppealReviewInput, reviewedBy: string,
): Promise<ComplaintAppeal> {
  if (!["APPROVED", "REJECTED"].includes(input.status)) {
    throw new AppError(400, "A valid appeal decision is required", "INVALID_APPEAL_STATUS");
  }
  if (!input.decisionReason.trim()) {
    throw new AppError(400, "A reason is required for every appeal decision", "APPEAL_DECISION_REASON_REQUIRED");
  }
  const updated = await updateComplaintAppeal(id, input, reviewedBy);
  if (!updated) throw new AppError(409, "This appeal has already been decided", "APPEAL_ALREADY_DECIDED");
  return updated;
}

// Disciplinary Decisions
export async function issueDisciplinaryDecision(input: DisciplinaryDecisionCreateInput, issuedBy: string): Promise<DisciplinaryDecision> {
  if (!input.action.trim()) {
    throw new AppError(400, "Action is required", "INVALID_ACTION");
  }
  const hasMatchBan = input.additionalMatchesSuspended !== undefined;
  const hasDateBan = input.startDate !== undefined || input.endDate !== undefined;
  if (hasMatchBan && (!Number.isInteger(input.additionalMatchesSuspended) || (input.additionalMatchesSuspended ?? 0) < 1)) {
    throw new AppError(400, "additionalMatchesSuspended must be a positive integer", "INVALID_MATCH_SUSPENSION");
  }
  if (hasDateBan && (!input.startDate || !input.endDate || Date.parse(input.startDate) >= Date.parse(input.endDate))) {
    throw new AppError(400, "A valid startDate and endDate are required for a date-based suspension", "INVALID_DATES");
  }
  if ((hasMatchBan || hasDateBan) && (!input.playerId || !input.complaintId)) {
    throw new AppError(400, "A player and complaint are required when a disciplinary decision creates a suspension", "SUSPENSION_TARGET_REQUIRED");
  }

  let suspensionInput: SuspensionCreateInput | undefined;
  if (hasMatchBan || hasDateBan) {
    const complaint = await getComplaint(input.complaintId!);
    const matchPool = getMatchPool();
    const participant = await matchPool.query<{ team_id: string }>(
      `SELECT team_id FROM lineups WHERE match_id = $1 AND player_id = $2 LIMIT 1`,
      [complaint.matchId, input.playerId],
    );
    if (!participant.rowCount) {
      throw new AppError(409, "Cầu thủ bị xử lý không có tên trong đội hình trận được khiếu nại.", "DISCIPLINE_PLAYER_NOT_IN_MATCH");
    }
    const startDate = hasMatchBan ? new Date().toISOString() : input.startDate!;
    const endDate = hasMatchBan
      ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
      : input.endDate!;
    suspensionInput = {
      playerId: input.playerId!,
      tournamentId: complaint.tournamentId,
      teamId: participant.rows[0].team_id,
      type: "DISCIPLINARY",
      startDate,
      endDate,
      reason: input.action.trim(),
      matchId: complaint.matchId,
      matchesSuspended: input.additionalMatchesSuspended ?? null,
    };
  }

  return createDisciplinaryDecision(input, issuedBy, suspensionInput);
}

export async function getDisciplinaryDecisions(tournamentId: string, playerId?: string): Promise<DisciplinaryDecision[]> {
  return listDisciplinaryDecisions(tournamentId, playerId);
}
