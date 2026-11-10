import type {
  Season,
  SeasonCreateInput,
  RegulationVersion,
  RegulationVersionCreateInput,
  Group,
  GroupCreateInput,
  Draw,
  DrawCreateInput,
} from "../models/tournament";
import { AppError } from "../lib/errors";
import {
  listSeasons,
  createSeason,
  updateSeason,
  listRegulationVersions,
  createRegulationVersion,
  listGroups,
  createGroup,
  listDraws,
  createDraw,
  deleteDraws,
} from "../repositories/seasonRepository";

export async function getSeasons(isActive?: boolean): Promise<Season[]> {
  return listSeasons(isActive);
}

export async function createNewSeason(input: SeasonCreateInput): Promise<Season> {
  if (input.year < 2000 || input.year > 2100) {
    throw new AppError(400, "Year must be between 2000 and 2100", "INVALID_YEAR");
  }
  return createSeason(input);
}

export async function toggleSeason(id: string, isActive: boolean): Promise<Season> {
  const updated = await updateSeason(id, isActive);
  if (!updated) {
    throw new AppError(404, "Season not found", "SEASON_NOT_FOUND");
  }
  return updated;
}

export async function getRegulationVersions(tournamentId: string): Promise<RegulationVersion[]> {
  return listRegulationVersions(tournamentId);
}

export async function createNewRegulationVersion(input: RegulationVersionCreateInput, createdBy: string): Promise<RegulationVersion> {
  if (input.version < 1) {
    throw new AppError(400, "Version must be at least 1", "INVALID_VERSION");
  }
  return createRegulationVersion(input, createdBy);
}

export async function getGroups(tournamentId: string): Promise<Group[]> {
  return listGroups(tournamentId);
}

export async function createNewGroup(input: GroupCreateInput): Promise<Group> {
  if (input.maxTeams !== undefined && input.maxTeams < 2) {
    throw new AppError(400, "Max teams must be at least 2", "INVALID_MAX_TEAMS");
  }
  return createGroup(input);
}

export async function getDraws(tournamentId: string, groupId?: string): Promise<Draw[]> {
  return listDraws(tournamentId, groupId);
}

export async function createNewDraw(input: DrawCreateInput, drawnBy: string): Promise<Draw> {
  if (input.position < 1) {
    throw new AppError(400, "Position must be at least 1", "INVALID_POSITION");
  }
  return createDraw(input, drawnBy);
}

export async function performDraw(tournamentId: string, teamIds: string[], drawnBy: string): Promise<Draw[]> {
  const draws: Draw[] = [];
  for (let i = 0; i < teamIds.length; i++) {
    const draw = await createDraw(
      { tournamentId, teamId: teamIds[i], position: i + 1 },
      drawnBy,
    );
    draws.push(draw);
  }
  return draws;
}

export async function clearDraws(tournamentId: string): Promise<void> {
  await deleteDraws(tournamentId);
}
