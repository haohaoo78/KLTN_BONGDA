import { AppError } from "./errors";
import { config } from "../config";

export type TournamentSummary = {
  id: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  minPlayers: number;
  maxPlayersPerTeam: number;
  minGoalkeepers: number;
};

export async function getTournamentSummary(tournamentId: string): Promise<TournamentSummary> {
  if (!config.internalApiKey) {
    throw new AppError(503, "Tournament service authentication is not configured", "SERVICE_MISCONFIGURED");
  }
  const endpoint = new URL(`/tournaments/${encodeURIComponent(tournamentId)}`, config.tournamentServiceUrl);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      headers: { "x-gateway-internal-key": config.internalApiKey },
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new AppError(503, "Tournament service is unavailable", "UPSTREAM_UNAVAILABLE");
  }
  if (!response.ok) {
    throw new AppError(502, "Could not load tournament information", "UPSTREAM_ERROR");
  }
  const result = await response.json() as { tournament?: Partial<TournamentSummary> };
  const tournament = result.tournament;
  if (!tournament || tournament.id !== tournamentId || typeof tournament.name !== "string") {
    throw new AppError(502, "Tournament service returned invalid tournament information", "UPSTREAM_ERROR");
  }
  return {
    id: tournament.id,
    name: tournament.name,
    startDate: typeof tournament.startDate === "string" ? tournament.startDate : null,
    endDate: typeof tournament.endDate === "string" ? tournament.endDate : null,
    minPlayers: Number.isInteger(tournament.minPlayers) ? Number(tournament.minPlayers) : 0,
    maxPlayersPerTeam: Number.isInteger(tournament.maxPlayersPerTeam) ? Number(tournament.maxPlayersPerTeam) : 0,
    minGoalkeepers: Number.isInteger(tournament.minGoalkeepers) ? Number(tournament.minGoalkeepers) : 0,
  };
}
