import type {
  Match,
  MatchCreateInput,
  MatchUpdateInput,
  MatchResult,
  MatchResultCreateInput,
  Standing,
  StandingUpdateInput,
  MatchStatus,
} from "../models/match";
import { AppError } from "../lib/errors";
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
} from "../repositories/matchRepository";

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

export async function updateMatchInfo(id: string, input: MatchUpdateInput): Promise<Match> {
  const existing = await findMatchById(id);
  if (!existing) {
    throw new AppError(404, "Match not found", "MATCH_NOT_FOUND");
  }

  if (input.status && !canTransition(existing.status, input.status)) {
    throw new AppError(400, `Cannot transition from ${existing.status} to ${input.status}`, "INVALID_STATUS_TRANSITION");
  }

  if (existing.status === "LOCKED") {
    throw new AppError(400, "Cannot update locked match", "MATCH_LOCKED");
  }

  if (input.matchDate && new Date(input.matchDate) < new Date()) {
    throw new AppError(400, "Match date must be in the future", "INVALID_DATE");
  }

  const updated = await updateMatch(id, input);
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
  if (input.homeScore < 0 || input.awayScore < 0) {
    throw new AppError(400, "Scores must be non-negative", "INVALID_SCORES");
  }
  const match = await getMatch(input.matchId);
  if (match.status === "UNSCHEDULED") {
    throw new AppError(409, "A match must be scheduled before recording a result", "MATCH_UNSCHEDULED");
  }
  return recordMatchResultAndRecalculate(input, recordedBy);
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
