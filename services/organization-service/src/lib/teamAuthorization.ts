import type { AuthenticatedRequest } from "../middleware/gatewayUser";
import { AppError } from "./errors";
import {
  getTeam,
  getTeamTournamentIds,
  isActivePlayerInTeam,
} from "../services/teamService";
import { config } from "../config";

export function isTournamentStaff(req: AuthenticatedRequest): boolean {
  return req.userRoles?.includes("BTC") ?? false;
}

export function requireUserId(req: AuthenticatedRequest): string {
  if (!req.userId) {
    throw new AppError(401, "Missing user authentication", "UNAUTHENTICATED");
  }
  return req.userId;
}

export async function assertCanManageTeam(
  req: AuthenticatedRequest,
  teamId: string,
): Promise<void> {
  const team = await getTeam(teamId);
  if (
    req.userRoles?.includes("TEAM_CAPTAIN") &&
    team.captainId === requireUserId(req)
  ) {
    return;
  }
  throw new AppError(403, "You cannot manage this team", "FORBIDDEN");
}

async function hasTournamentManagerAccess(
  req: AuthenticatedRequest,
  tournamentId: string,
): Promise<boolean> {
  const roles = req.userRoles ?? [];
  if (!roles.includes("BTC")) return false;
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
    return false;
  }
  if (!response.ok) {
    throw new AppError(502, "Tournament authorization could not be verified", "UPSTREAM_ERROR");
  }
  return true;
}

export async function assertCanManageTournament(
  req: AuthenticatedRequest,
  tournamentId: string,
): Promise<void> {
  const roles = req.userRoles ?? [];
  if (!roles.includes("BTC")) {
    throw new AppError(403, "Only tournament staff can manage registrations", "FORBIDDEN");
  }
  if (!(await hasTournamentManagerAccess(req, tournamentId))) {
    throw new AppError(403, "You are not assigned to manage this tournament", "FORBIDDEN");
  }
}

export async function assertTournamentRosterEditable(tournamentId: string): Promise<void> {
  if (!config.internalApiKey) {
    throw new AppError(503, "Tournament roster authorization is not configured", "SERVICE_MISCONFIGURED");
  }
  let endpoint: string;
  try {
    endpoint = new URL(
      `/internal/tournaments/${encodeURIComponent(tournamentId)}/roster-editability`,
      config.tournamentServiceUrl,
    ).toString();
  } catch {
    throw new AppError(503, "Tournament service URL is invalid", "SERVICE_MISCONFIGURED");
  }
  let response: Response;
  try {
    response = await fetch(endpoint, {
      headers: { "x-gateway-internal-key": config.internalApiKey },
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new AppError(503, "Tournament roster authorization service is unavailable", "UPSTREAM_UNAVAILABLE");
  }
  if (!response.ok) {
    throw new AppError(502, "Tournament roster editability could not be checked", "UPSTREAM_ERROR");
  }
  const result = await response.json() as { editable?: boolean; reason?: string };
  if (result.editable !== true) {
    throw new AppError(409, result.reason ?? "Tournament rosters are locked", "ROSTER_LOCKED");
  }
}

async function callTournamentRegistrationApi(
  path: string,
  method: "POST" | "PATCH",
  body: Record<string, unknown>,
): Promise<string[]> {
  if (!config.internalApiKey) {
    throw new AppError(503, "Tournament registration is not configured", "SERVICE_MISCONFIGURED");
  }
  let endpoint: string;
  try {
    endpoint = new URL(path, config.tournamentServiceUrl).toString();
  } catch {
    throw new AppError(503, "Tournament service URL is invalid", "SERVICE_MISCONFIGURED");
  }
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method,
      headers: {
        "content-type": "application/json",
        "x-gateway-internal-key": config.internalApiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new AppError(503, "Tournament registration service is unavailable", "UPSTREAM_UNAVAILABLE");
  }
  if (!response.ok) {
    const result = await response.json().catch(() => null) as {
      error?: { code?: string; message?: string };
    } | null;
    const status = response.status >= 400 && response.status < 500 ? response.status : 502;
    throw new AppError(
      status,
      result?.error?.message ?? "Tournament registration could not be processed",
      result?.error?.code ?? "UPSTREAM_ERROR",
    );
  }
  const result = await response.json().catch(() => null) as { withdrawnRegistrationIds?: unknown } | null;
  return Array.isArray(result?.withdrawnRegistrationIds)
    ? result.withdrawnRegistrationIds.filter((id): id is string => typeof id === "string")
    : [];
}

export async function reserveTournamentRegistration(input: {
  registrationId: string;
  teamId: string;
  tournamentId: string;
  institutionId: string;
}): Promise<void> {
  await callTournamentRegistrationApi(
    `/internal/tournaments/${encodeURIComponent(input.tournamentId)}/registration-reservations`,
    "POST",
    input,
  );
}

export async function syncTournamentRegistrationReservation(
  registrationId: string,
  status: "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN",
  persistedInOrganization: boolean,
  registration?: { tournamentId: string; teamId: string; institutionId: string | null },
): Promise<string[]> {
  return callTournamentRegistrationApi(
    `/internal/registration-reservations/${encodeURIComponent(registrationId)}`,
    "PATCH",
    {
      status,
      persistedInOrganization,
      ...(registration ? {
        tournamentId: registration.tournamentId,
        teamId: registration.teamId,
        institutionId: registration.institutionId,
      } : {}),
    },
  );
}

export async function assertCanViewTeam(
  req: AuthenticatedRequest,
  teamId: string,
): Promise<void> {
  const team = await getTeam(teamId);
  const userId = requireUserId(req);
  if (
    req.userRoles?.includes("ADMIN") ||
    (req.userRoles?.includes("TEAM_CAPTAIN") && team.captainId === userId)
  ) {
    return;
  }
  if (
    req.userRoles?.includes("PLAYER") &&
    (await isActivePlayerInTeam(teamId, userId))
  ) {
    return;
  }
  if (!req.userRoles?.includes("BTC")) {
    throw new AppError(403, "You cannot view this team", "FORBIDDEN");
  }

  const tournamentIds = await getTeamTournamentIds(teamId);
  for (const tournamentId of tournamentIds) {
    if (await hasTournamentManagerAccess(req, tournamentId)) {
      return;
    }
  }
  throw new AppError(403, "You cannot view this team", "FORBIDDEN");
}
