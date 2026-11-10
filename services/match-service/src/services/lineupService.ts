import type {
  Lineup,
  LineupCreateInput,
  MatchEvent,
  MatchEventCreateInput,
  MatchReport,
  MatchReportCreateInput,
  MatchReportUpdateInput,
} from "../models/match";
import { AppError } from "../lib/errors";
import {
  listLineups,
  createLineup,
  confirmLineup,
  deleteLineup,
  listMatchEvents,
  findMatchEventById,
  createMatchEvent,
  deleteMatchEvent,
  findMatchReportByMatchId,
  findMatchReportById,
  createMatchReport,
  resubmitMatchReport,
  updateMatchReport,
} from "../repositories/lineupRepository";
import { findMatchResultByMatchId } from "../repositories/matchRepository";

// Lineup Service
export async function getLineups(matchId: string, teamId?: string): Promise<Lineup[]> {
  return listLineups(matchId, teamId);
}

export async function addLineup(input: LineupCreateInput): Promise<Lineup> {
  if (input.jerseyNumber !== undefined && (input.jerseyNumber < 1 || input.jerseyNumber > 99)) {
    throw new AppError(400, "Jersey number must be between 1 and 99", "INVALID_JERSEY");
  }

  return createLineup(input);
}

export async function confirmTeamLineup(matchId: string, teamId: string, confirmedBy: string): Promise<void> {
  await confirmLineup(matchId, teamId, confirmedBy);
}

export async function removeLineup(matchId: string, teamId: string): Promise<void> {
  await deleteLineup(matchId, teamId);
}

// Match Event Service
export async function getMatchEvents(matchId: string, teamId?: string): Promise<MatchEvent[]> {
  return listMatchEvents(matchId, teamId);
}

export async function getMatchEventById(id: string): Promise<MatchEvent> {
  const event = await findMatchEventById(id);
  if (!event) {
    throw new AppError(404, "Match event not found", "EVENT_NOT_FOUND");
  }
  return event;
}

export async function addMatchEvent(input: MatchEventCreateInput, createdBy: string): Promise<MatchEvent> {
  if (input.minute !== undefined && (input.minute < 0 || input.minute > 120)) {
    throw new AppError(400, "Minute must be between 0 and 120", "INVALID_MINUTE");
  }

  const event = await createMatchEvent(input, createdBy);

  // If card event, could trigger discipline service integration (future)
  if (input.eventType === "YELLOW_CARD" || input.eventType === "RED_CARD") {
    // TODO: Call discipline-service to record card
  }

  return event;
}

export async function removeMatchEvent(id: string): Promise<void> {
  const deleted = await deleteMatchEvent(id);
  if (!deleted) {
    throw new AppError(404, "Match event not found", "EVENT_NOT_FOUND");
  }
}

// Match Report Service
export async function getMatchReport(matchId: string): Promise<MatchReport> {
  const report = await findMatchReportByMatchId(matchId);
  if (!report) {
    throw new AppError(404, "Match report not found", "REPORT_NOT_FOUND");
  }
  return report;
}

export async function getMatchReportById(id: string): Promise<MatchReport> {
  const report = await findMatchReportById(id);
  if (!report) {
    throw new AppError(404, "Match report not found", "REPORT_NOT_FOUND");
  }
  return report;
}

export async function submitMatchReport(input: MatchReportCreateInput, submittedBy: string): Promise<MatchReport> {
  const existing = await findMatchReportByMatchId(input.matchId);
  if (existing && existing.status !== "REVISION_REQUIRED") {
    throw new AppError(409, "A report can be resubmitted only after BTC requests revisions", "REPORT_EXISTS");
  }
  const matchResult = await findMatchResultByMatchId(input.matchId);
  if (!matchResult || matchResult.status !== "PENDING") {
    throw new AppError(409, "A pending match result is required before report submission", "MATCH_RESULT_REQUIRED");
  }
  if (existing) {
    const resubmitted = await resubmitMatchReport(input, submittedBy);
    if (!resubmitted) throw new AppError(409, "The report is no longer awaiting revisions", "REPORT_STATE_CHANGED");
    return resubmitted;
  }
  return createMatchReport(input, submittedBy);
}

export async function reviewMatchReport(id: string, input: MatchReportUpdateInput, verifiedBy: string): Promise<MatchReport> {
  const updated = await updateMatchReport(id, { ...input, verifiedBy });
  if (!updated) {
    throw new AppError(404, "Match report not found", "REPORT_NOT_FOUND");
  }
  return updated;
}
