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
  finalizeMatchReport,
  updateMatchReport,
} from "../repositories/lineupRepository";
import { findMatchResultByMatchId } from "../repositories/matchRepository";
import { getMatch } from "./matchService";
import { checkPlayerSuspension } from "../discipline/services/disciplineService";
import { config } from "../config";

async function assertPlayersBelongToTeam(teamId: string, playerIds: string[]): Promise<void> {
  const uniqueIds = [...new Set(playerIds)];
  if (!uniqueIds.length) return;
  let response: Response;
  try {
    response = await fetch(
      new URL(`/internal/teams/${encodeURIComponent(teamId)}/players/verify-active-membership`, config.organizationServiceUrl),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-gateway-internal-key": config.internalApiKey,
        },
        body: JSON.stringify({ playerIds: uniqueIds }),
        signal: AbortSignal.timeout(5_000),
      },
    );
  } catch {
    throw new AppError(503, "Không thể xác minh thành viên đội với Organization Service. Vui lòng thử lại.", "ROSTER_VERIFICATION_UNAVAILABLE");
  }
  if (!response.ok) {
    throw new AppError(503, "Organization Service không thể xác minh danh sách cầu thủ.", "ROSTER_VERIFICATION_UNAVAILABLE");
  }
  let body: { validPlayerIds?: unknown };
  try {
    body = await response.json() as { validPlayerIds?: unknown };
  } catch {
    throw new AppError(502, "Organization Service trả về kết quả xác minh không hợp lệ.", "ROSTER_VERIFICATION_FAILED");
  }
  const validIds = new Set(Array.isArray(body.validPlayerIds) ? body.validPlayerIds.filter((id): id is string => typeof id === "string") : []);
  const invalidCount = uniqueIds.filter((id) => !validIds.has(id)).length;
  if (invalidCount) {
    throw new AppError(409, `${invalidCount} cầu thủ không còn là thành viên đang hoạt động của đội này.`, "PLAYER_NOT_IN_TEAM");
  }
}

async function assertPlayersEligibleForLineup(matchId: string, teamId: string, playerIds: string[]): Promise<void> {
  if (!playerIds.length) return;
  const match = await getMatch(matchId);
  if (![match.homeTeamId, match.awayTeamId].includes(teamId)) {
    throw new AppError(409, "Đội không tham gia trận đấu này.", "TEAM_NOT_IN_MATCH");
  }
  await assertPlayersBelongToTeam(teamId, playerIds);
  const suspendedPlayers = await Promise.all(playerIds.map(async (playerId) =>
    (await checkPlayerSuspension(playerId, match.tournamentId, matchId)) ? playerId : null,
  ));
  const blocked = suspendedPlayers.filter((playerId): playerId is string => playerId !== null);
  if (blocked.length) {
    throw new AppError(
      409,
      `Không thể đưa ${blocked.length} cầu thủ đang bị treo giò vào đội hình trận này.`,
      "PLAYER_SUSPENDED",
    );
  }
}

// Lineup Service
export async function getLineups(matchId: string, teamId?: string): Promise<Lineup[]> {
  return listLineups(matchId, teamId);
}

export async function addLineup(input: LineupCreateInput): Promise<Lineup> {
  if (input.jerseyNumber !== undefined && (input.jerseyNumber < 1 || input.jerseyNumber > 99)) {
    throw new AppError(400, "Jersey number must be between 1 and 99", "INVALID_JERSEY");
  }

  await assertPlayersEligibleForLineup(input.matchId, input.teamId, [input.playerId]);

  return createLineup(input);
}

export async function confirmTeamLineup(matchId: string, teamId: string, confirmedBy: string): Promise<void> {
  const lineups = await listLineups(matchId, teamId);
  if (!lineups.length) {
    throw new AppError(409, "Đội hình chưa có cầu thủ để xác nhận.", "LINEUP_EMPTY");
  }
  await assertPlayersEligibleForLineup(matchId, teamId, lineups.map((lineup) => lineup.playerId));
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
  const submitted = await finalizeMatchReport(input, submittedBy);
  if (input.requiresOrganizerReview) return submitted;
  // A match's appointed final-authority referee may confirm an ordinary result.
  // Reports flagged as exceptional remain pending for the assigned organizer.
  return reviewMatchReport(submitted.id, { status: "APPROVED", verifiedBy: submittedBy }, submittedBy);
}

export async function reviewMatchReport(id: string, input: MatchReportUpdateInput, verifiedBy: string): Promise<MatchReport> {
  const updated = await updateMatchReport(id, { ...input, verifiedBy });
  if (!updated) {
    throw new AppError(404, "Match report not found", "REPORT_NOT_FOUND");
  }
  return updated;
}
