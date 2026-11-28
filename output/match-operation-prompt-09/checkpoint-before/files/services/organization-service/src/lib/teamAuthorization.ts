import type { AuthenticatedRequest } from "../middleware/gatewayUser";
import { AppError } from "./errors";
import {
  getTeam,
  getTeamTournamentIds,
  isActivePlayerInTeam,
} from "../services/teamService";
import { config } from "../config";

export function isTournamentStaff(req: AuthenticatedRequest): boolean {
  const roles = req.userRoles ?? [];
  return roles.includes("BTC") && !roles.includes("ADMIN");
}

export function requireUserId(req: AuthenticatedRequest): string {
  if (!req.userId) {
    throw new AppError(401, "Missing user authentication", "UNAUTHENTICATED");
  }
  return req.userId;
}

// Tournament Service intentionally returns 404 when a tournament is missing
// or the caller is not its manager. Both cases mean that this BTC has no
// visibility through this tournament link; they are not an upstream failure.
export function isNonManagerAccessStatus(status: number): boolean {
  return status === 403 || status === 404;
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
  if (!roles.includes("BTC") || roles.includes("ADMIN")) return false;
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

  if (isNonManagerAccessStatus(response.status)) {
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
  if (!roles.includes("BTC") || roles.includes("ADMIN")) {
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

export async function getTournamentRegistrationReviewState(tournamentId: string): Promise<{ eligible: boolean; status: string; minPlayers?: number; maxPlayersPerTeam?: number; minGoalkeepers?: number }> {
  if (!config.internalApiKey) throw new AppError(503, "Tournament registration review is not configured", "SERVICE_MISCONFIGURED");
  let endpoint: string;
  try {
    endpoint = new URL(`/internal/tournaments/${encodeURIComponent(tournamentId)}/registration-review-eligibility`, config.tournamentServiceUrl).toString();
  } catch {
    throw new AppError(503, "Tournament service URL is invalid", "SERVICE_MISCONFIGURED");
  }
  let response: Response;
  try {
    response = await fetch(endpoint, { headers: { "x-gateway-internal-key": config.internalApiKey }, signal: AbortSignal.timeout(5_000) });
  } catch {
    throw new AppError(503, "Tournament registration review service is unavailable", "UPSTREAM_UNAVAILABLE");
  }
  if (!response.ok) throw new AppError(502, "Tournament review eligibility could not be checked", "UPSTREAM_ERROR");
  const result = await response.json() as { eligible?: boolean; status?: string; minPlayers?: number; maxPlayersPerTeam?: number; minGoalkeepers?: number };
  if (typeof result.eligible !== "boolean" || typeof result.status !== "string") throw new AppError(502, "Tournament service returned invalid review eligibility", "UPSTREAM_ERROR");
  return { eligible: result.eligible, status: result.status, minPlayers: result.minPlayers, maxPlayersPerTeam: result.maxPlayersPerTeam, minGoalkeepers: result.minGoalkeepers };
}

export async function isTournamentRegistrationReviewOpen(tournamentId: string): Promise<boolean> {
  return (await getTournamentRegistrationReviewState(tournamentId)).eligible;
}

export async function getLockedRosterAdditionEligibility(tournamentId: string, playerIds: string[]) {
  if (!config.internalApiKey) throw new AppError(503, "Match eligibility service is not configured", "SERVICE_MISCONFIGURED");
  let endpoint: string;
  try { endpoint = new URL(`/internal/tournaments/${encodeURIComponent(tournamentId)}/roster-addition-eligibility`, config.matchServiceUrl).toString(); }
  catch { throw new AppError(503, "Match service URL is invalid", "SERVICE_MISCONFIGURED"); }
  let response: Response;
  try {
    response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", "x-gateway-internal-key": config.internalApiKey }, body: JSON.stringify({ playerIds }), signal: AbortSignal.timeout(5_000) });
  } catch { throw new AppError(503, "Match eligibility service is unavailable", "UPSTREAM_UNAVAILABLE"); }
  if (!response.ok) throw new AppError(502, "Match service could not verify roster-addition eligibility", "UPSTREAM_ERROR");
  const result = await response.json() as { eligible?: boolean; reason?: string | null; finalGroupRound?: number | null; finalGroupRoundStartsAt?: string | null; alreadyAppearedPlayerIds?: string[] };
  if (typeof result.eligible !== "boolean") throw new AppError(502, "Match service returned invalid roster-addition eligibility", "UPSTREAM_ERROR");
  return result;
}

export function assertApprovalRevocationAllowed(tournamentStatus: string): void {
  if (["ROSTER_LOCKED", "PREPARING", "IN_PROGRESS", "PAUSED", "COMPLETED"].includes(tournamentStatus)) {
    throw new AppError(409, "Không thể thu hồi phê duyệt sau khi danh sách đã chốt", "APPROVAL_REVOCATION_AFTER_ROSTER_LOCK");
  }
}

async function callTournamentRegistrationApi(
  path: string,
  method: "POST" | "PATCH",
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
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
      error?: { code?: string; message?: string; details?: Record<string, unknown> };
    } | null;
    const status = response.status >= 400 && response.status < 500 ? response.status : 502;
    throw new AppError(
      status,
      result?.error?.message ?? "Tournament registration could not be processed",
      result?.error?.code ?? "UPSTREAM_ERROR",
      result?.error?.details,
    );
  }
  return await response.json().catch(() => ({})) as Record<string, unknown>;
}

export async function reserveTournamentRegistration(input: {
  registrationId: string;
  teamId: string;
  tournamentId: string;
  institutionId: string;
  isResubmission?: boolean;
  roster: Array<{ playerId: string; lineupRole: "STARTER" | "SUBSTITUTE"; isGoalkeeper: boolean }>;
}): Promise<"PENDING" | "WAITLIST"> {
  const response = await callTournamentRegistrationApi(
    `/internal/tournaments/${encodeURIComponent(input.tournamentId)}/registration-reservations`,
    "POST",
    input,
  );
  if (response.reservationStatus !== "PENDING" && response.reservationStatus !== "WAITLIST") {
    throw new AppError(502, "Tournament service returned an invalid reservation status", "UPSTREAM_ERROR");
  }
  return response.reservationStatus;
}

export async function syncTournamentRegistrationReservation(
  registrationId: string,
  status: "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN" | "WAITLIST" | "CONFLICT_ADJUSTMENT_REQUIRED",
  persistedInOrganization: boolean,
  registration?: { tournamentId: string; teamId: string; institutionId: string | null },
  playerIds?: string[],
): Promise<{ conflictedRegistrations: Array<{ registrationId: string; conflicts: Array<{ playerId: string; conflictingTournamentId: string; conflictingTournamentName: string }> ; adjustmentDeadline: string | null }>; waitlistedRegistrationIds: string[] }> {
  const result = await callTournamentRegistrationApi(
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
      ...(playerIds ? { playerIds } : {}),
    },
  );
  return {
    conflictedRegistrations: Array.isArray(result.conflictedRegistrations) ? result.conflictedRegistrations as Array<{ registrationId: string; conflicts: Array<{ playerId: string; conflictingTournamentId: string; conflictingTournamentName: string }>; adjustmentDeadline: string | null }> : [],
    waitlistedRegistrationIds: Array.isArray(result.waitlistedRegistrationIds) ? result.waitlistedRegistrationIds.filter((id): id is string => typeof id === "string") : [],
  };
}

export async function getUnavailableTournamentPlayerIds(tournamentId: string, teamId: string, playerIds: string[]): Promise<string[]> {
  const result = await callTournamentRegistrationApi(
    `/internal/tournaments/${encodeURIComponent(tournamentId)}/player-availability`, "POST", { teamId, playerIds },
  );
  return Array.isArray(result.unavailablePlayerIds) ? result.unavailablePlayerIds.filter((id): id is string => typeof id === "string") : [];
}

export async function reserveTournamentInvitationParticipation(input: { invitationId: string; tournamentId: string; teamId: string; playerId: string }): Promise<void> {
  await callTournamentRegistrationApi("/internal/player-participation/invitations/reserve", "POST", input);
}

export async function releaseTournamentInvitationParticipation(invitationId: string): Promise<void> {
  await callTournamentRegistrationApi(`/internal/player-participation/invitations/${encodeURIComponent(invitationId)}/release`, "POST", {});
}

export async function syncApprovedRegistrationPlayerClaims(claims: Array<{
  registrationId: string; tournamentId: string; teamId: string; institutionId: string; playerIds: string[];
  status: "PENDING" | "APPROVED" | "WAITLIST" | "CONFLICT_ADJUSTMENT_REQUIRED";
}>): Promise<void> {
  for (let offset = 0; offset < claims.length; offset += 250) {
    await callTournamentRegistrationApi("/internal/player-participation/reconcile", "POST", {
      claims: claims.slice(offset, offset + 250),
    });
  }
}

export async function approveTournamentTeamWithdrawal(input: {
  registrationId: string;
  tournamentId: string;
  actorId: string;
  reason: string;
}): Promise<void> {
  await callTournamentRegistrationApi(
    `/internal/registration-reservations/${encodeURIComponent(input.registrationId)}/approve-withdrawal`,
    "POST",
    { tournamentId: input.tournamentId, actorId: input.actorId, reason: input.reason },
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
