import type {
  Team,
  TeamCreateInput,
  TeamUpdateInput,
  TeamRegistration,
  TeamRegistrationCreateInput,
  TeamRegistrationUpdateInput,
  Player,
  PlayerCreateInput,
  PlayerUpdateInput,
  RosterCreateInput,
} from "../models/team";
import { AppError } from "../lib/errors";
import {
  findTeamById,
  findPublicTeamDetail,
  findTeamsForUser,
  findTeamsManagedByUser,
  listTeams,
  createTeam,
  linkTeamToInstitutionIfUnlinked,
  updateTeam,
  deleteTeam,
  findTeamRegistration,
  findTeamRegistrationById,
  listTournamentIdsByTeam,
  listTeamRegistrations,
  listTeamRegistrationsByTeam as findTeamRegistrationsByTeam,
  listTournamentDrawCandidates as findTournamentDrawCandidates,
  createTeamRegistration,
  updateTeamRegistration,
  deleteTeamRegistration,
  listPlayers,
  findPlayerByTeamAndUser,
  findPlayerById,
  createPlayer,
  updatePlayer,
  deletePlayer,
  listTournamentRegistrationCounts as findTournamentRegistrationCounts,
} from "../repositories/teamRepository";
import { assertInstitutionAvailableForRegistration } from "./institutionService";
import { addRostersBatch, getInstitution } from "./institutionService";
import { randomUUID } from "node:crypto";
import {
  reserveTournamentRegistration,
  syncTournamentRegistrationReservation,
} from "../lib/teamAuthorization";

// Teams
export async function getTeam(id: string): Promise<Team> {
  const team = await findTeamById(id);
  if (!team) {
    throw new AppError(404, "Team not found", "TEAM_NOT_FOUND");
  }
  return team;
}

export async function getPublicTeamDetail(id: string) {
  const detail = await findPublicTeamDetail(id);
  if (!detail) {
    throw new AppError(404, "Public team not found", "TEAM_NOT_FOUND");
  }
  return detail;
}

export async function getTeamsForUser(userId: string): Promise<Team[]> {
  return findTeamsForUser(userId);
}

export async function getTeamsManagedByUser(userId: string): Promise<Team[]> {
  return findTeamsManagedByUser(userId);
}

export async function isActivePlayerInTeam(teamId: string, userId: string): Promise<boolean> {
  return (await findPlayerByTeamAndUser(teamId, userId)) !== null;
}

export async function getTeamTournamentIds(teamId: string): Promise<string[]> {
  return listTournamentIdsByTeam(teamId);
}

export async function getTeams(
  limit: number,
  offset: number,
  isActive?: boolean,
  institutionId?: string,
  search?: string,
  sortBy: "NAME" | "CREATED_AT" = "CREATED_AT",
): Promise<{ items: Team[]; total: number }> {
  return listTeams(limit, offset, isActive, institutionId, search, sortBy);
}

export async function listTournamentDrawCandidates(tournamentId: string) {
  return findTournamentDrawCandidates(tournamentId);
}

export async function createNewTeam(input: TeamCreateInput): Promise<Team> {
  // Validation: maxPlayers must be positive
  if (input.maxPlayers !== undefined && input.maxPlayers <= 0) {
    throw new AppError(400, "maxPlayers must be greater than 0", "INVALID_MAX_PLAYERS");
  }

  // Validation: name cannot be empty
  if (!input.name.trim()) {
    throw new AppError(400, "Team name is required", "INVALID_NAME");
  }

  if (!input.institutionId) {
    throw new AppError(400, "A representative institution is required", "INSTITUTION_REQUIRED");
  }
  await assertInstitutionAvailableForRegistration(input.institutionId);
  if (input.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.contactEmail)) {
    throw new AppError(400, "Contact email is invalid", "INVALID_CONTACT_EMAIL");
  }

  return createTeam(input);
}

export async function linkTeamToVerifiedInstitution(teamId: string, institutionId: string): Promise<Team> {
  const existing = await findTeamById(teamId);
  if (!existing) throw new AppError(404, "Team not found", "TEAM_NOT_FOUND");
  if (existing.institutionId) {
    if (existing.institutionId === institutionId) return existing;
    throw new AppError(409, "This team is already linked to another school", "TEAM_ALREADY_LINKED");
  }
  await assertInstitutionAvailableForRegistration(institutionId);
  const linked = await linkTeamToInstitutionIfUnlinked(teamId, institutionId);
  if (linked) return linked;
  const current = await findTeamById(teamId);
  if (current?.institutionId === institutionId) return current;
  throw new AppError(409, "The team could not be linked because its school changed", "TEAM_LINK_CONFLICT");
}

export async function updateTeamInfo(id: string, input: TeamUpdateInput): Promise<Team> {
  const existing = await findTeamById(id);
  if (!existing) {
    throw new AppError(404, "Team not found", "TEAM_NOT_FOUND");
  }

  // Validation: maxPlayers must be positive
  if (input.maxPlayers !== undefined && input.maxPlayers <= 0) {
    throw new AppError(400, "maxPlayers must be greater than 0", "INVALID_MAX_PLAYERS");
  }

  // Validation: name cannot be empty
  if (input.name !== undefined && !input.name.trim()) {
    throw new AppError(400, "Team name is required", "INVALID_NAME");
  }

  // Business rule: captain must be in the team (future: check with player repository)
  // For MVP, allow any user as captain

  const updated = await updateTeam(id, input);
  if (!updated) {
    throw new AppError(404, "Team not found", "TEAM_NOT_FOUND");
  }
  return updated;
}

export async function removeTeam(id: string): Promise<void> {
  const existing = await findTeamById(id);
  if (!existing) {
    throw new AppError(404, "Team not found", "TEAM_NOT_FOUND");
  }

  // Business rule: cannot delete team with active registrations
  // For MVP, allow deletion (will cascade via FK)

  await deleteTeam(id);
}

// Team Registrations
export async function getTeamRegistration(
  teamId: string,
  tournamentId: string,
): Promise<TeamRegistration> {
  const registration = await findTeamRegistration(teamId, tournamentId);
  if (!registration) {
    throw new AppError(404, "Team registration not found", "REGISTRATION_NOT_FOUND");
  }
  return registration;
}

export async function getTeamRegistrationByRegistrationId(id: string): Promise<TeamRegistration> {
  const registration = await findTeamRegistrationById(id);
  if (!registration) {
    throw new AppError(404, "Team registration not found", "REGISTRATION_NOT_FOUND");
  }
  return registration;
}

export async function getTeamRegistrations(
  tournamentId: string,
  filters: { status?: string; institutionId?: string; search?: string } = {},
): Promise<TeamRegistration[]> {
  return listTeamRegistrations(tournamentId, filters);
}

export async function getTeamRegistrationsByTeam(teamId: string): Promise<TeamRegistration[]> {
  return findTeamRegistrationsByTeam(teamId);
}

export async function listTournamentRegistrationCounts(
  tournamentId?: string,
  institutionId?: string,
) {
  return findTournamentRegistrationCounts(tournamentId, institutionId);
}

export async function registerTeamForTournament(
  input: Pick<TeamRegistrationCreateInput, "teamId" | "tournamentId"> & { notes?: string; roster?: Array<Pick<RosterCreateInput, "playerId" | "lineupRole" | "isGoalkeeper" | "evidenceUrl">> },
): Promise<TeamRegistration> {
  // Check if team exists
  const team = await findTeamById(input.teamId);
  if (!team) {
    throw new AppError(404, "Team not found", "TEAM_NOT_FOUND");
  }
  if (!team.institutionId) {
    throw new AppError(409, "The team must be linked to an active school before registration", "INSTITUTION_REQUIRED");
  }
  const institution = await getInstitution(team.institutionId);
  if (!institution || institution.status !== "ACTIVE" || !institution.isActive) {
    throw new AppError(409, "The team's school is not accepting registrations", "INSTITUTION_UNAVAILABLE");
  }

  // Check if already registered
  const existing = await findTeamRegistration(input.teamId, input.tournamentId);
  if (existing) {
    throw new AppError(409, "Team already registered for this tournament", "ALREADY_REGISTERED");
  }

  const submittedRoster = input.roster ?? [];
  if (!submittedRoster.length) {
    throw new AppError(400, "A team roster is required with the tournament application", "ROSTER_REQUIRED");
  }
  const activePlayers = await listPlayers(input.teamId);
  const activePlayerIds = new Set(activePlayers.map((player) => player.id));
  const uniquePlayerIds = new Set(submittedRoster.map((entry) => entry.playerId));
  if (submittedRoster.length > Math.min(team.maxPlayers, 30)) {
    throw new AppError(400, "Roster exceeds the team's registered player limit", "ROSTER_TOO_LARGE");
  }
  if (uniquePlayerIds.size !== submittedRoster.length || submittedRoster.some((entry) => !activePlayerIds.has(entry.playerId))) {
    throw new AppError(400, "Roster must contain unique active players from this team", "INVALID_ROSTER");
  }
  if (activePlayers.some((player) => uniquePlayerIds.has(player.id) && (!player.fullName?.trim() || !player.studentId?.trim()))) {
    throw new AppError(400, "Every registered player needs a full name and student ID", "PLAYER_PROFILE_INCOMPLETE");
  }
  if (submittedRoster.some((entry) => !["STARTER", "SUBSTITUTE"].includes(entry.lineupRole ?? "SUBSTITUTE"))) {
    throw new AppError(400, "Each roster player must be assigned as starter or substitute", "INVALID_ROSTER_ROLE");
  }
  const starters = submittedRoster.filter((entry) => entry.lineupRole === "STARTER");
  const startingKeepers = starters.filter((entry) => entry.isGoalkeeper === true);
  if (![7, 11].includes(starters.length) || startingKeepers.length !== 1 || submittedRoster.some((entry) => entry.isGoalkeeper && entry.lineupRole !== "STARTER")) {
    throw new AppError(400, "Starting lineup must contain 7 or 11 players and exactly one starting goalkeeper", "INVALID_STARTING_LINEUP");
  }

  const registrationId = randomUUID();
  await reserveTournamentRegistration({
    registrationId,
    teamId: input.teamId,
    tournamentId: input.tournamentId,
    institutionId: team.institutionId,
  });
  let registration: TeamRegistration;
  try {
    registration = await createTeamRegistration({
      ...input,
      id: registrationId,
      institutionId: team.institutionId,
    });
  } catch (error) {
    await syncTournamentRegistrationReservation(registrationId, "WITHDRAWN", false);
    throw error;
  }
  try {
    if (submittedRoster.length) {
      await addRostersBatch(submittedRoster.map((entry) => ({
        teamId: input.teamId,
        tournamentId: input.tournamentId,
        playerId: entry.playerId,
        lineupRole: entry.lineupRole ?? "SUBSTITUTE",
        isGoalkeeper: entry.isGoalkeeper ?? false,
        evidenceUrl: entry.evidenceUrl,
      })));
    }
  } catch (error) {
    await deleteTeamRegistration(registrationId);
    await syncTournamentRegistrationReservation(registrationId, "WITHDRAWN", false);
    throw error;
  }
  await syncTournamentRegistrationReservation(registrationId, "PENDING", true);
  return registration;
}

export async function updateTeamRegistrationStatus(
  id: string,
  input: TeamRegistrationUpdateInput,
  approvedBy?: string,
): Promise<TeamRegistration> {
  // Validation: status must be valid
  const validStatuses = ["PENDING", "APPROVED", "REJECTED", "WITHDRAWN"];
  if (input.status && !validStatuses.includes(input.status)) {
    throw new AppError(400, "Invalid status", "INVALID_STATUS");
  }

  // Business rule: only approve if status is APPROVED
  if (input.status === "APPROVED" && !approvedBy) {
    throw new AppError(400, "approvedBy is required when approving", "MISSING_APPROVER");
  }

  const current = await findTeamRegistrationById(id);
  if (!current) {
    throw new AppError(404, "Team registration not found", "REGISTRATION_NOT_FOUND");
  }
  if (input.status) {
    const withdrawnIds = await syncTournamentRegistrationReservation(id, input.status, true, {
      tournamentId: current.tournamentId,
      teamId: current.teamId,
      institutionId: current.institutionId,
    });
    if (input.status === "APPROVED" && withdrawnIds.length) {
      const teamRegistrations = await findTeamRegistrationsByTeam(current.teamId);
      for (const pending of teamRegistrations) {
        if (withdrawnIds.includes(pending.id) && pending.status === "PENDING") {
          const reason = "Tự động rút hồ sơ vì đội đã được duyệt vào một giải có thời gian tổ chức trùng lặp.";
          await updateTeamRegistration(pending.id, {
            status: "WITHDRAWN",
            notes: [pending.notes?.trim(), reason].filter(Boolean).join("\n\n"),
          });
        }
      }
    }
  }
  const updated = await updateTeamRegistration(id, input, approvedBy);
  if (!updated) {
    throw new AppError(404, "Team registration not found", "REGISTRATION_NOT_FOUND");
  }

  return updated;
}

export async function removeTeamRegistration(id: string): Promise<void> {
  const current = await findTeamRegistrationById(id);
  if (!current) {
    throw new AppError(404, "Team registration not found", "REGISTRATION_NOT_FOUND");
  }
  await syncTournamentRegistrationReservation(id, "WITHDRAWN", true, {
    tournamentId: current.tournamentId,
    teamId: current.teamId,
    institutionId: current.institutionId,
  });
  const deleted = await deleteTeamRegistration(id);
  if (!deleted) {
    throw new AppError(404, "Team registration not found", "REGISTRATION_NOT_FOUND");
  }
}

// Players
export async function getPlayers(teamId: string, includeLeft: boolean = false): Promise<Player[]> {
  const team = await findTeamById(teamId);
  if (!team) {
    throw new AppError(404, "Team not found", "TEAM_NOT_FOUND");
  }

  return listPlayers(teamId, includeLeft);
}

export async function getPlayer(id: string): Promise<Player> {
  const player = await findPlayerById(id);
  if (!player) {
    throw new AppError(404, "Player not found", "PLAYER_NOT_FOUND");
  }
  return player;
}

export async function addPlayerToTeam(input: PlayerCreateInput): Promise<Player> {
  // Check if team exists
  const team = await findTeamById(input.teamId);
  if (!team) {
    throw new AppError(404, "Team not found", "TEAM_NOT_FOUND");
  }

  // Check if player already in team
  if (!input.fullName.trim()) {
    throw new AppError(400, "Player name is required", "INVALID_PLAYER_NAME");
  }
  const existing = input.userId
    ? await findPlayerByTeamAndUser(input.teamId, input.userId)
    : null;
  if (existing) {
    throw new AppError(409, "User already in this team", "ALREADY_IN_TEAM");
  }
  if (
    input.birthDate &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(input.birthDate) ||
      Number.isNaN(Date.parse(`${input.birthDate}T00:00:00Z`)) ||
      new Date(`${input.birthDate}T00:00:00Z`) > new Date())
  ) {
    throw new AppError(400, "Birth date is invalid", "INVALID_BIRTH_DATE");
  }
  if (input.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.contactEmail)) {
    throw new AppError(400, "Contact email is invalid", "INVALID_CONTACT_EMAIL");
  }

  // Validation: position must be valid
  const validPositions = ["GK", "DEF", "MID", "FWD"];
  if (input.position && !validPositions.includes(input.position)) {
    throw new AppError(400, "Invalid position", "INVALID_POSITION");
  }

  // Validation: jersey number must be positive
  if (input.jerseyNumber !== undefined && input.jerseyNumber <= 0) {
    throw new AppError(400, "Jersey number must be greater than 0", "INVALID_JERSEY_NUMBER");
  }

  // Business rule: check team max players
  const currentPlayers = await listPlayers(input.teamId, false);
  if (currentPlayers.length >= team.maxPlayers) {
    throw new AppError(400, "Team has reached maximum players", "MAX_PLAYERS_REACHED");
  }
  if (
    input.jerseyNumber !== undefined &&
    currentPlayers.some((player) => player.jerseyNumber === input.jerseyNumber)
  ) {
    throw new AppError(409, "Jersey number is already in use by this team", "DUPLICATE_JERSEY_NUMBER");
  }
  if (
    input.studentId &&
    currentPlayers.some((player) => player.studentId?.toLowerCase() === input.studentId?.toLowerCase())
  ) {
    throw new AppError(409, "Student ID is already registered for this team", "DUPLICATE_STUDENT_ID");
  }

  return createPlayer(input);
}

export async function updatePlayerInfo(id: string, input: PlayerUpdateInput): Promise<Player> {
  // Validation: position must be valid
  const validPositions = ["GK", "DEF", "MID", "FWD"];
  if (input.position && !validPositions.includes(input.position)) {
    throw new AppError(400, "Invalid position", "INVALID_POSITION");
  }

  // Validation: jersey number must be positive
  if (input.jerseyNumber !== undefined && input.jerseyNumber <= 0) {
    throw new AppError(400, "Jersey number must be greater than 0", "INVALID_JERSEY_NUMBER");
  }

  const updated = await updatePlayer(id, input);
  if (!updated) {
    throw new AppError(404, "Player not found", "PLAYER_NOT_FOUND");
  }

  return updated;
}

export async function removePlayerFromTeam(id: string): Promise<void> {
  const deleted = await deletePlayer(id);
  if (!deleted) {
    throw new AppError(404, "Player not found", "PLAYER_NOT_FOUND");
  }
}
