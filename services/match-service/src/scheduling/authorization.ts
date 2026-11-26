import { AppError } from "./lib/errors";
import type { AuthenticatedRequest } from "./middleware/gatewayUser";
import { config } from "../config";
import { getRefereeAssignmentForMatch, refereeIsAssignedToMatch } from "./services/schedulingService";
import { getMatch } from "../services/matchService";
import { configuredCrewHasCapability, type CrewCapability } from "./crewValidation";
import { configuredPositionsForMatch } from "./repositories/refereeConfigurationRepository";
import { publishedRefereePositions } from "./repositories/refereePublicationRepository";

export async function assertCanManageTournament(
  req: AuthenticatedRequest,
  tournamentId: string,
): Promise<void> {
  const roles = req.userRoles ?? [];
  if (!roles.includes("BTC")) {
    throw new AppError(403, "Insufficient permissions", "FORBIDDEN");
  }
  if (!req.userId) {
    throw new AppError(401, "Missing user authentication", "UNAUTHENTICATED");
  }
  if (!config.internalApiKey) {
    throw new AppError(503, "Tournament authorization is not configured", "SERVICE_MISCONFIGURED");
  }

  let endpoint: string;
  try {
    endpoint = new URL(
      `/internal/tournaments/${encodeURIComponent(tournamentId)}/manager-access`,
      config.tournamentServiceUrl,
    ).toString();
  } catch {
    throw new AppError(503, "Tournament service URL is invalid", "SERVICE_MISCONFIGURED");
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      headers: {
        "x-gateway-internal-key": config.internalApiKey,
        "x-user-id": req.userId,
        "x-user-roles": roles.join(","),
      },
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new AppError(503, "Tournament authorization service is unavailable", "UPSTREAM_UNAVAILABLE");
  }

  if (response.status === 403) {
    throw new AppError(403, "You are not assigned to manage this tournament", "FORBIDDEN");
  }
  if (!response.ok) {
    throw new AppError(502, "Tournament authorization could not be verified", "UPSTREAM_ERROR");
  }
}

export async function assertCanSubmitComplaintForTeam(
  req: AuthenticatedRequest,
  teamId: string,
): Promise<void> {
  await assertTeamCaptainAccess(req, teamId);
}

async function assertTeamCaptainAccess(
  req: AuthenticatedRequest,
  teamId: string,
): Promise<void> {
  if (!(req.userRoles ?? []).includes("TEAM_CAPTAIN")) {
    throw new AppError(403, "Only a team representative can manage this team", "FORBIDDEN");
  }
  if (!req.userId) {
    throw new AppError(401, "Missing user authentication", "UNAUTHENTICATED");
  }
  if (!config.internalApiKey) {
    throw new AppError(503, "Organization authorization is not configured", "SERVICE_MISCONFIGURED");
  }

  let endpoint: string;
  try {
    endpoint = new URL(
      `/internal/teams/${encodeURIComponent(teamId)}/captain-access`,
      config.organizationServiceUrl,
    ).toString();
  } catch {
    throw new AppError(503, "Organization service URL is invalid", "SERVICE_MISCONFIGURED");
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      headers: {
        "x-gateway-internal-key": config.internalApiKey,
        "x-user-id": req.userId,
        "x-user-roles": (req.userRoles ?? []).join(","),
      },
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new AppError(503, "Organization authorization service is unavailable", "UPSTREAM_UNAVAILABLE");
  }

  if (!response.ok) {
    throw new AppError(502, "Team ownership could not be verified", "UPSTREAM_ERROR");
  }
  const body = (await response.json()) as { allowed?: boolean };
  if (body.allowed !== true) {
    throw new AppError(403, "You do not represent this team", "FORBIDDEN");
  }
}

export async function assertCanManageLineup(
  req: AuthenticatedRequest,
  matchId: string,
  teamId: string,
): Promise<void> {
  if ((req.userRoles ?? []).includes("BTC")) {
    const match = await getMatch(matchId);
    if (![match.homeTeamId, match.awayTeamId].includes(teamId)) {
      throw new AppError(403, "The team is not part of this match", "MATCH_TEAM_MISMATCH");
    }
    await assertCanManageTournament(req, match.tournamentId);
    return;
  }
  const match = await getMatch(matchId);
  if (![match.homeTeamId, match.awayTeamId].includes(teamId)) {
    throw new AppError(403, "The team is not part of this match", "MATCH_TEAM_MISMATCH");
  }
  await assertTeamCaptainAccess(req, teamId);
}

export async function assertCanManageMatch(
  req: AuthenticatedRequest,
  matchId: string,
  capability: CrewCapability = "READ",
): Promise<void> {
  const roles = req.userRoles ?? [];
  if (roles.includes("BTC")) {
    const match = await getMatch(matchId);
    await assertCanManageTournament(req, match.tournamentId);
    return;
  }
  if (!roles.includes("REFEREE")) {
    throw new AppError(403, "Insufficient permissions", "FORBIDDEN");
  }
  if (!req.userId) {
    throw new AppError(401, "Missing user authentication", "UNAUTHENTICATED");
  }
  const assignment = await getRefereeAssignmentForMatch(matchId, req.userId);
  if (!assignment && !(await refereeIsAssignedToMatch(matchId, req.userId))) {
    throw new AppError(403, "You are not assigned to this match", "FORBIDDEN");
  }
  const positions = assignment ? await publishedRefereePositions(matchId) ?? await configuredPositionsForMatch((await getMatch(matchId)).tournamentId, matchId) : null;
  if (assignment && !configuredCrewHasCapability(assignment.position, assignment.isFinalAuthority, capability, positions)) {
    throw new AppError(403,
      capability === "FINALIZE"
        ? "Only the appointed final authority may control the match and confirm its result"
        : capability === "EDIT_EVENT"
          ? "Only the appointed final authority may correct or void an official match event"
          : capability === "MANAGE_REPORT" ? "Your assigned match position cannot manage the match report"
            : "Your assigned match position cannot record match events",
      capability === "FINALIZE" ? "FINAL_AUTHORITY_REQUIRED" : capability === "EDIT_EVENT" ? "EVENT_EDIT_PERMISSION_REQUIRED" : "EVENT_PERMISSION_REQUIRED");
  }
  if (!assignment && (capability === "FINALIZE" || capability === "EDIT_EVENT" || capability === "MANAGE_REPORT")) {
    throw new AppError(403,
      capability === "FINALIZE"
        ? "Only the appointed final authority may control the match and confirm its result"
        : "Only the appointed final authority may correct or void an official match event",
      capability === "FINALIZE" ? "FINAL_AUTHORITY_REQUIRED" : "EVENT_EDIT_PERMISSION_REQUIRED");
  }
}
