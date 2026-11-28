import type {
  Match,
  MatchCreateInput,
  MatchUpdateInput,
  MatchResult,
  MatchResultCreateInput,
  MatchResultCorrectionRequest,
  Standing,
  StandingUpdateInput,
  MatchStatus,
} from "../models/match";
import { AppError } from "../lib/errors";
import { assertKickoffReached } from "./matchKickoff";
import {
  findMatchById,
  listMatches,
  createMatch,
  updateMatch,
  deleteMatch,
  findMatchResultByMatchId,
  recordMatchResultAndRecalculate,
  listStandings,
  findStanding,
  createResultCorrectionRequest as createCorrectionRequestRecord,
  findResultCorrectionRequest,
  listResultCorrectionRequests,
  reviewResultCorrectionRequest as reviewCorrectionRequestRecord,
  recordForfeitResult,
} from "../repositories/matchRepository";
import { getTournamentDisciplinePolicy } from "./tournamentDisciplinePolicy";
import { assertResultRulePolicy, getEffectiveMatchRules } from "./matchOperationRulesService";
import { validateMatchScore } from "./matchResultValidation";
import { config } from "../config";

// Workflow state transitions
const validTransitions: Record<MatchStatus, MatchStatus[]> = {
  UNSCHEDULED: ["SCHEDULED", "CANCELLED"],
  SCHEDULED: ["LINEUP_CONFIRMED", "CANCELLED", "POSTPONED"],
  LINEUP_CONFIRMED: ["IN_PROGRESS", "CANCELLED", "POSTPONED"],
  IN_PROGRESS: ["FINISHED", "CANCELLED", "POSTPONED"],
  FINISHED: ["VERIFIED", "CANCELLED"],
  VERIFIED: ["LOCKED"],
  LOCKED: [],
  CANCELLED: [],
  POSTPONED: ["SCHEDULED"],
};

export function canTransition(from: MatchStatus, to: MatchStatus): boolean {
  return validTransitions[from]?.includes(to) ?? false;
}

// Matches
export async function getMatch(id: string): Promise<Match> {
  const match = await findMatchById(id);
  if (!match) {
    throw new AppError(404, "Match not found", "MATCH_NOT_FOUND");
  }
  return match;
}

export async function getMatches(
  tournamentId: string,
  limit: number,
  offset: number,
  status?: string,
): Promise<{ items: Match[]; total: number }> {
  return listMatches(tournamentId, limit, offset, status);
}

export async function createNewMatch(input: MatchCreateInput): Promise<Match> {
  if (input.homeTeamId === input.awayTeamId) {
    throw new AppError(400, "Home and away teams must be different", "SAME_TEAMS");
  }

  if (new Date(input.matchDate) < new Date()) {
    throw new AppError(400, "Match date must be in the future", "INVALID_DATE");
  }

  return createMatch(input);
}

export async function updateMatchInfo(id: string, input: MatchUpdateInput, actorId?:string): Promise<Match> {
  const existing = await findMatchById(id);
  if (!existing) {
    throw new AppError(404, "Match not found", "MATCH_NOT_FOUND");
  }
  if(input.status==="LINEUP_CONFIRMED"||existing.status==="LINEUP_CONFIRMED"&&input.status==="SCHEDULED")throw new AppError(409,"Cần dùng quy trình kiểm tra đội hình hoặc mở lại chuẩn bị có lý do.","MATCH_LINEUPS_WORKFLOW_REQUIRED");

  if (input.status && !canTransition(existing.status, input.status)) {
    throw new AppError(400, `Cannot transition from ${existing.status} to ${input.status}`, "INVALID_STATUS_TRANSITION");
  }
  if (input.status && ["IN_PROGRESS", "FINISHED", "VERIFIED", "LOCKED"].includes(input.status)) {
    throw new AppError(409, "Trạng thái này chỉ được cập nhật qua đồng hồ trận và quy trình xác nhận kết quả.", "MATCH_CLOCK_ACTION_REQUIRED");
  }

  if (input.status && input.status !== "SCHEDULED" && (!existing.homeTeamId || !existing.awayTeamId)) {
    throw new AppError(409, "Chưa thể điều hành trận khi chưa xác định đủ hai đội", "BRACKET_TEAMS_UNRESOLVED");
  }

  if (input.status === "IN_PROGRESS") {
    assertKickoffReached(existing.matchDate);
  }

  if (existing.status === "LOCKED") {
    throw new AppError(400, "Cannot update locked match", "MATCH_LOCKED");
  }

  if (input.matchDate && new Date(input.matchDate) < new Date()) {
    throw new AppError(400, "Match date must be in the future", "INVALID_DATE");
  }

  const updated = await updateMatch(id, input,existing.status,actorId);
  if (!updated) {
    throw new AppError(404, "Match not found", "MATCH_NOT_FOUND");
  }
  return updated;
}

export async function removeMatch(id: string): Promise<void> {
  const existing = await findMatchById(id);
  if (!existing) {
    throw new AppError(404, "Match not found", "MATCH_NOT_FOUND");
  }

  const result = await findMatchResultByMatchId(id);
  if (result) {
    throw new AppError(400, "Cannot delete match with recorded result", "MATCH_HAS_RESULT");
  }

  await deleteMatch(id);
}

// Match Results
export async function getMatchResult(matchId: string): Promise<MatchResult> {
  const result = await findMatchResultByMatchId(matchId);
  if (!result) {
    throw new AppError(404, "Match result not found", "RESULT_NOT_FOUND");
  }
  return result;
}

export async function recordMatchResult(
  input: MatchResultCreateInput,
  recordedBy: string,
): Promise<MatchResult> {
  validateMatchScore(input);
  const match = await getMatch(input.matchId);
  if (!match.homeTeamId || !match.awayTeamId) {
    throw new AppError(409, "Chưa thể nhập kết quả khi chưa xác định đủ hai đội", "BRACKET_TEAMS_UNRESOLVED");
  }
  if (match.status === "UNSCHEDULED") {
    throw new AppError(409, "A match must be scheduled before recording a result", "MATCH_UNSCHEDULED");
  }
  assertResultRulePolicy(await getEffectiveMatchRules(input.matchId), input);
  return recordMatchResultAndRecalculate(input, recordedBy);
}

export async function decideMatchForfeit(
  matchId: string,
  forfeitingTeamId: string,
  reason: string,
  decidedBy: string,
): Promise<Awaited<ReturnType<typeof recordForfeitResult>> & { notificationFailures: string[] }> {
  const match = await getMatch(matchId);
  if (!["SCHEDULED", "LINEUP_CONFIRMED"].includes(match.status)) {
    throw new AppError(409, "A forfeit can only be decided before the match starts", "MATCH_NOT_FORFEITABLE");
  }
  if (![match.homeTeamId, match.awayTeamId].includes(forfeitingTeamId)) {
    throw new AppError(400, "The forfeiting team must be part of this match", "MATCH_TEAM_MISMATCH");
  }
  const normalizedReason = reason.trim();
  if (normalizedReason.length < 10 || normalizedReason.length > 2000) {
    throw new AppError(400, "Forfeit reason must contain 10–2000 characters", "FORFEIT_REASON_REQUIRED");
  }
  const policy = await getTournamentDisciplinePolicy(match.tournamentId, match.id);
  if(policy.forfeitPolicy===null||policy.forfeitWinnerScore===null||policy.forfeitLoserScore===null)throw new AppError(409,"Điều lệ chưa công bố chính sách và tỷ số xử thua; không tự áp tỷ số mặc định.","FORFEIT_POLICY_UNDEFINED");
  if (policy.forfeitPolicy === "NO_AUTOMATIC_RESULT") {
    throw new AppError(409, "Điều lệ không cho áp dụng tỷ số xử thua tự động; BTC cần xử lý theo quy trình thủ công của giải.", "FORFEIT_REQUIRES_MANUAL_DECISION");
  }
  if (policy.forfeitWinnerScore <= policy.forfeitLoserScore) {
    throw new AppError(409, "Configured forfeit score does not determine a winner", "INVALID_FORFEIT_SCORE");
  }
  const outcome = await recordForfeitResult({
    matchId,
    forfeitingTeamId,
    reason: normalizedReason,
    winnerScore: policy.forfeitWinnerScore,
    loserScore: policy.forfeitLoserScore,
    policy: policy.forfeitPolicy,
  }, decidedBy);
  if (!outcome.alreadyApplied) {
    const recipientTeams = [match.homeTeamId, match.awayTeamId].filter((teamId): teamId is string => Boolean(teamId));
    const recipients = await Promise.all(recipientTeams.map(async (teamId) => {
      try {
        const endpoint = new URL(`/internal/teams/${encodeURIComponent(teamId)}/captain-notification-recipient`, config.organizationServiceUrl);
        const response = await fetch(endpoint, {
          headers: config.internalApiKey ? { "x-gateway-internal-key": config.internalApiKey } : {},
          signal: AbortSignal.timeout(5_000),
        });
        if (!response.ok) return null;
        const body = await response.json() as { userId?: string | null };
        return body.userId ?? null;
      } catch { return null; }
    }));
    const userIds = [...new Set(recipients.filter((userId): userId is string => Boolean(userId)))];
    const notificationFailures: string[] = [];
    for (const userId of userIds) {
      try {
        const response = await fetch(new URL("/internal/notifications", config.notificationServiceUrl), {
          method: "POST",
          headers: { "content-type": "application/json", "x-internal-api-key": config.internalApiKey },
          body: JSON.stringify({
            userId,
            type: "MATCH_RESULT",
            title: "Trận đấu được xử lý theo điều lệ",
            body: `BTC đã ghi nhận quyết định xử thua trận ${match.id}. Kết quả chính thức: ${outcome.result.homeScore}–${outcome.result.awayScore}. Lý do: ${normalizedReason}`,
            data: { category: "MATCH_FORFEIT", matchId: match.id, tournamentId: match.tournamentId, decisionId: outcome.decision.id },
          }),
          signal: AbortSignal.timeout(5_000),
        });
        if (!response.ok) notificationFailures.push(userId);
      } catch { notificationFailures.push(userId); }
    }
    if (notificationFailures.length) console.error("[match-service] forfeit notification failures", notificationFailures);
    return { ...outcome, notificationFailures };
  }
  return { ...outcome, notificationFailures: [] };
}

export async function requestMatchResultCorrection(
  matchId: string,
  input: Omit<MatchResultCreateInput, "matchId">,
  reason: string,
  requestedBy: string,
): Promise<MatchResultCorrectionRequest> {
  validateMatchScore(input);
  if (reason.trim().length < 10 || reason.trim().length > 2000) {
    throw new AppError(400, "Correction reason must be between 10 and 2000 characters", "CORRECTION_REASON_REQUIRED");
  }
  assertResultRulePolicy(await getEffectiveMatchRules(matchId),input,true);
  return createCorrectionRequestRecord({ matchId, proposal: input, reason, requestedBy });
}

export async function getMatchResultCorrectionRequest(id: string): Promise<MatchResultCorrectionRequest> {
  const request = await findResultCorrectionRequest(id);
  if (!request) throw new AppError(404, "Correction request not found", "CORRECTION_REQUEST_NOT_FOUND");
  return request;
}

export async function getTournamentResultCorrectionRequests(tournamentId: string, status?: string): Promise<MatchResultCorrectionRequest[]> {
  if (status && !["PENDING", "APPROVED", "REJECTED"].includes(status)) {
    throw new AppError(400, "Invalid correction request status", "INVALID_STATUS");
  }
  return listResultCorrectionRequests(tournamentId, status);
}

export async function decideMatchResultCorrectionRequest(
  id: string,
  decision: "APPROVED" | "REJECTED",
  reviewerId: string,
  reviewReason: string,
): Promise<MatchResultCorrectionRequest> {
  return reviewCorrectionRequestRecord(id, decision, reviewerId, reviewReason);
}

// Standings
export async function getStandings(tournamentId: string): Promise<Standing[]> {
  return listStandings(tournamentId);
}

export async function getStanding(tournamentId: string, teamId: string): Promise<Standing> {
  const standing = await findStanding(tournamentId, teamId);
  if (!standing) {
    throw new AppError(404, "Standing not found", "STANDING_NOT_FOUND");
  }
  return standing;
}
