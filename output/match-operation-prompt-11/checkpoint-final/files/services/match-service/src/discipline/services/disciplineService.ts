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

// Cards
export async function getCards(tournamentId: string, playerId?: string, teamId?: string): Promise<Card[]> {
  return listCards(tournamentId, playerId, teamId);
}

export async function issueCard(input:CardCreateInput,issuedBy:string):Promise<Card>{
  if(!input.sourceEventId)throw new AppError(409,'Thẻ phải được ghi qua sự kiện trận đấu chính thức.','CARD_EVENT_SOURCE_REQUIRED');
  const source=(await getMatchPool().query('SELECT e.*,m.tournament_id FROM match_events e JOIN matches m ON m.id=e.match_id WHERE e.id=$1',[input.sourceEventId])).rows[0];
  if(!source||source.match_id!==input.matchId||source.tournament_id!==input.tournamentId||source.team_id!==input.teamId||source.player_id!==input.playerId)throw new AppError(409,'Nguồn thẻ không khớp sự kiện trận.','CARD_EVENT_SOURCE_MISMATCH');
  const {reconcilePlayerDiscipline}=await import('./disciplineProjection');await reconcilePlayerDiscipline(input.tournamentId,input.playerId);
  const saved=(await listCards(input.tournamentId,input.playerId,input.teamId)).find(card=>card.matchId===input.matchId);
  if(!saved)throw new AppError(409,'Thẻ đã hủy hoặc chưa đồng bộ.','CARD_EVENT_SOURCE_MISMATCH');return saved;
}

export async function retractEventCard(eventId:string,actorId:string,reason:string):Promise<void>{
 const source=(await getMatchPool().query('SELECT e.player_id,m.tournament_id FROM match_events e JOIN matches m ON m.id=e.match_id WHERE e.id=$1',[eventId])).rows[0];
 if(source?.player_id){const {reconcilePlayerDiscipline}=await import('./disciplineProjection');await reconcilePlayerDiscipline(source.tournament_id,source.player_id);}
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
  if (!Number.isFinite(Date.parse(input.startDate)) || input.matchesSuspended==null && (!input.endDate || !Number.isFinite(Date.parse(input.endDate)) || new Date(input.startDate) >= new Date(input.endDate))) {
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

export async function checkPlayerSuspension(playerId: string, tournamentId: string, matchId?: string, matchQuery?: Pick<import("pg").PoolClient,"query">): Promise<boolean> {
  if(matchId){const target=(await (matchQuery??getMatchPool()).query('SELECT tournament_id FROM matches WHERE id=$1',[matchId])).rows[0];if(!target)throw new AppError(404,'Không tìm thấy trận.','MATCH_NOT_FOUND');if(target.tournament_id!==tournamentId)throw new AppError(409,'Trận không thuộc giải cần kiểm tra.','MATCH_TOURNAMENT_MISMATCH');}
  const {assertDisciplineSynchronized}=await import('./disciplineProjection');
  await assertDisciplineSynchronized(tournamentId,playerId,matchQuery??getMatchPool());
  const suspensions = await listSuspensions(tournamentId, playerId);
  const targetDate=matchId?(await (matchQuery??getMatchPool()).query("SELECT match_date FROM matches WHERE id=$1",[matchId])).rows[0]?.match_date:null;
  const now = targetDate?new Date(targetDate):new Date();
  for (const suspension of suspensions) {
    if (!suspension.isActive && suspension.statusReason !== "COMPLETED") continue;
    if (suspension.matchesSuspended !== null) {
      // Without a target fixture, report any unlifted match-count ban as active.
      if (!matchId) { if(suspension.isActive)return true; continue; }
      const matchPool = matchQuery??getMatchPool();
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
      if (suspension.scopeStage) {
        const scope=(await (matchQuery??getMatchPool()).query('SELECT stage FROM matches WHERE id=$1',[matchId])).rows[0]?.stage;
        if(scope!==suspension.scopeStage)continue;
      }
      if (!target.match_date) throw new AppError(409,'Trận chưa có thời điểm để xác định phạm vi thi hành án.','DISCIPLINE_TARGET_TIME_UNDEFINED');
      const source=suspension.matchId?(await matchPool.query('SELECT COALESCE(c.actual_started_at,m.match_date) AS date FROM matches m LEFT JOIN match_clock_states c ON c.match_id=m.id WHERE m.id=$1',[suspension.matchId])).rows[0]?.date:null;
      if (Date.parse(target.match_date) <= Date.parse(source??suspension.startDate)) continue;
      if(suspension.projectionKey){
        const completed=await matchPool.query('SELECT COUNT(*)::int AS count FROM matches m LEFT JOIN match_clock_states c ON c.match_id=m.id WHERE m.id=ANY($1::uuid[]) AND m.id<>$2 AND COALESCE(c.actual_started_at,m.match_date)<$3',[suspension.servedMatchIds??[],matchId,target.match_date]);
        if(completed.rows[0].count<suspension.matchesSuspended)return true;
        continue;
      }
      const served = await matchPool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM matches played
         JOIN match_results result ON result.match_id = played.id AND result.status = 'APPROVED'
         WHERE played.tournament_id = $1
           AND (played.home_team_id = $2 OR played.away_team_id = $2)
           AND played.id <> $3
           AND played.status IN ('VERIFIED', 'LOCKED')
           AND result.result_origin IN ('FIELD','CORRECTION')
           AND NOT EXISTS(SELECT 1 FROM match_forfeit_decisions f WHERE f.match_id=played.id)
           AND EXISTS(SELECT 1 FROM match_clock_states clock WHERE clock.match_id=played.id AND clock.actual_started_at IS NOT NULL AND clock.actual_ended_at IS NOT NULL)
           AND NOT EXISTS(SELECT 1 FROM lineups l WHERE l.match_id=played.id AND l.player_id=$7)
           AND ($8::text IS NULL OR played.stage=$8)
           AND played.match_date < $4::timestamptz
           AND played.match_date > COALESCE(
             (SELECT source.match_date FROM matches source WHERE source.id = $5),
             $6::timestamptz
           )`,
        [tournamentId, suspension.teamId, matchId, target.match_date, suspension.matchId, suspension.startDate, playerId, suspension.scopeStage??null],
      );
      if (Number(served.rows[0]?.count ?? 0) < suspension.matchesSuspended) return true;
      continue;
    }
    if (suspension.isActive && suspension.endDate && new Date(suspension.startDate) <= now && new Date(suspension.endDate) >= now) return true;
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
  const { complaintDeadline } = await import('../../services/complaintDeadlineService');
  const deadline = await complaintDeadline(input.matchId);
  if (deadline.expired) throw new AppError(409,'Đã hết thời hạn khiếu nại theo điều lệ áp dụng.','COMPLAINT_WINDOW_CLOSED');
  input.deadlineSnapshot = deadline;
  if (!input.description.trim()) {
    throw new AppError(400, "Description is required", "INVALID_DESCRIPTION");
  }

  return createComplaint(input);
}

export async function reviewComplaint(id: string, input: ComplaintUpdateInput, reviewedBy: string): Promise<Complaint> {
  if (!input.decisionReason?.trim() || input.decisionReason.length > 4000) throw new AppError(400,'Mỗi quyết định phải có lý do và căn cứ.','DECISION_REASON_REQUIRED');
  if (input.status === 'APPROVED' && !input.decision?.trim()) throw new AppError(400,'Cần kết luận giải quyết khiếu nại.','DECISION_REQUIRED');
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
  const { complaintDeadline } = await import('../../services/complaintDeadlineService');
  const deadline = await complaintDeadline(current.matchId,current.reviewedAt??undefined);
  if (!current.reviewedAt || deadline.expired) throw new AppError(409,'Đã hết thời hạn kháng nghị hoặc chưa có quyết định được công bố.','APPEAL_WINDOW_CLOSED');
  input.deadlineSnapshot = deadline;
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
    const endDate = hasMatchBan ? undefined : input.endDate!;
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
