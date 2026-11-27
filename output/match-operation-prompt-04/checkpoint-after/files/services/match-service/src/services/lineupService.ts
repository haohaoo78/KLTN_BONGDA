import type {
  Lineup,
  MatchEvent,
  MatchEventCreateInput,
  MatchReport,
  MatchReportCreateInput,
  MatchReportUpdateInput,
} from "../models/match";
import { AppError } from "../lib/errors";
import { assertRuleOperation, assertResultRulePolicy, getEffectiveMatchRules } from "./matchOperationRulesService";
import {
  listLineups,
  listMatchEvents,
  findMatchEventById,
  createMatchEvent,
  deleteMatchEvent,
  findMatchReportByMatchId,
  findMatchReportById,
  finalizeMatchReport,
  updateMatchReport,
} from "../repositories/lineupRepository";
import { findMatchResultByMatchId } from "../repositories/matchRepository";
import { getMatch } from "./matchService";
import { checkPlayerSuspension } from "../discipline/services/disciplineService";
import { config } from "../config";
import { getPool } from "../lib/db";

// Lineup Service
export async function getLineups(matchId: string, teamId?: string): Promise<Lineup[]> {
  const allowed=await getPool().query(`SELECT s.team_id FROM match_squads s WHERE s.match_id=$1 AND s.status='SUBMITTED'
    UNION SELECT l.team_id FROM lineups l JOIN matches m ON m.id=l.match_id
    WHERE m.id=$1 AND m.status IN ('IN_PROGRESS','FINISHED','VERIFIED','LOCKED')`,[matchId]);
  return (await listLineups(matchId,teamId)).filter(p=>allowed.rows.some(r=>r.team_id===p.teamId));
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

  const rules = await getEffectiveMatchRules(input.matchId);
  assertRuleOperation(rules, input.eventType.startsWith("SUBSTITUTION") ? "SUBSTITUTION" : "CLOCK");
  const event = await createMatchEvent(input, createdBy);

  // If card event, could trigger discipline service integration (future)
  if (input.eventType === "YELLOW_CARD" || input.eventType === "RED_CARD") {
    // TODO: Call discipline-service to record card
  }

  return event;
}

export async function removeMatchEvent(id: string, actorId: string, reason: string): Promise<void> {
  const deleted = await deleteMatchEvent(id, actorId, reason);
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
  assertRuleOperation(await getEffectiveMatchRules(input.matchId), "FINALIZE");
  const submitted = await finalizeMatchReport(input, submittedBy);
  if (input.requiresOrganizerReview) return submitted;
  // A match's appointed final-authority referee may confirm an ordinary result.
  // Reports flagged as exceptional remain pending for the assigned organizer.
  return reviewMatchReport(submitted.id, { status: "APPROVED", verifiedBy: submittedBy }, submittedBy);
}

export async function reviewMatchReport(id: string, input: MatchReportUpdateInput, verifiedBy: string): Promise<MatchReport> {
  if (input.status === "APPROVED") {
    const report = await getMatchReportById(id);
    const result = await findMatchResultByMatchId(report.matchId);
    if (result) assertResultRulePolicy(await getEffectiveMatchRules(report.matchId), result, true);
  }
  const updated = await updateMatchReport(id, { ...input, verifiedBy });
  if (!updated) {
    throw new AppError(404, "Match report not found", "REPORT_NOT_FOUND");
  }
  return updated;
}
