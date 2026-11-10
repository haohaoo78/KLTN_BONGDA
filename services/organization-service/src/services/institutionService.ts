import type {
  Institution,
  InstitutionCreateInput,
  InstitutionUpdateInput,
  Roster,
  RosterCreateInput,
  PlayerRequest,
  PlayerRequestCreateInput,
} from "../models/team";
import { AppError } from "../lib/errors";
import { config } from "../config";
import {
  listInstitutions,
  findInstitutionById,
  createInstitution,
  updateInstitution as updateInstitutionRecord,
  updateInstitutionStatus as updateInstitutionStatusRecord,
  listInstitutionHistory as listInstitutionHistoryRecord,
  listRosters,
  createRoster,
  createRostersBatch as createRostersBatchRecord,
    findRosterById,
    reviewRoster as reviewRosterRecord,
    updateRosterEvidence as updateRosterEvidenceRecord,
    deleteRoster as deleteRosterRecord,
  listPlayerRequests,
  listPlayerRequestsForUser,
  createPlayerRequest,
  findPlayerRequestById,
  updatePlayerRequest,
  withdrawPlayerRequest as withdrawPlayerRequestRecord,
} from "../repositories/institutionRepository";

export async function getInstitutions(filters?: {
  isActive?: boolean;
  institutionType?: Institution["institutionType"];
  status?: Institution["status"];
  search?: string;
  city?: string;
}): Promise<Institution[]> {
  return listInstitutions(filters);
}

export async function getInstitution(id: string): Promise<Institution | null> {
  return findInstitutionById(id);
}

export async function createNewInstitution(
  input: InstitutionCreateInput,
  actorId: string,
): Promise<Institution> {
  if (!input.name.trim()) {
    throw new AppError(400, "Institution name is required", "INVALID_NAME");
  }
  if (input.code && input.code.trim().length > 50) {
    throw new AppError(400, "Institution code must be at most 50 characters", "INVALID_CODE");
  }
  if (input.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.contactEmail)) {
    throw new AppError(400, "Contact email is invalid", "INVALID_CONTACT_EMAIL");
  }
  if (input.contactPhone && !/^[+()\d\s.-]{7,30}$/.test(input.contactPhone)) {
    throw new AppError(400, "Contact phone is invalid", "INVALID_CONTACT_PHONE");
  }
  if (
    input.institutionType &&
    !["UNIVERSITY", "COLLEGE", "OTHER"].includes(input.institutionType)
  ) {
    throw new AppError(400, "Institution type is invalid", "INVALID_INSTITUTION_TYPE");
  }
  if (input.officialWebsite && !/^https?:\/\/\S+$/i.test(input.officialWebsite)) {
    throw new AppError(400, "Official website must be a valid HTTP(S) URL", "INVALID_WEBSITE");
  }
  if (input.dataSourceUrl && !/^https?:\/\/\S+$/i.test(input.dataSourceUrl)) {
    throw new AppError(400, "Data source must be a valid HTTP(S) URL", "INVALID_SOURCE_URL");
  }
  return createInstitution({
    ...input,
    name: input.name.trim(),
    code: input.code?.trim().toUpperCase() || undefined,
  }, actorId);
}

export async function updateInstitution(
  id: string,
  input: InstitutionUpdateInput,
  actorId: string,
): Promise<Institution> {
  if (input.name !== undefined && !input.name.trim()) {
    throw new AppError(400, "Institution name is required", "INVALID_NAME");
  }
  if (input.code && input.code.trim().length > 50) {
    throw new AppError(400, "Institution code must be at most 50 characters", "INVALID_CODE");
  }
  if (
    input.institutionType &&
    !["UNIVERSITY", "COLLEGE", "OTHER"].includes(input.institutionType)
  ) {
    throw new AppError(400, "Institution type is invalid", "INVALID_INSTITUTION_TYPE");
  }
  if (input.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.contactEmail)) {
    throw new AppError(400, "Contact email is invalid", "INVALID_CONTACT_EMAIL");
  }
  if (input.contactPhone && !/^[+()\d\s.-]{7,30}$/.test(input.contactPhone)) {
    throw new AppError(400, "Contact phone is invalid", "INVALID_CONTACT_PHONE");
  }
  if (input.officialWebsite && !/^https?:\/\/\S+$/i.test(input.officialWebsite)) {
    throw new AppError(400, "Official website must be a valid HTTP(S) URL", "INVALID_WEBSITE");
  }
  const updated = await updateInstitutionRecord(
    id,
    {
      ...input,
      name: input.name?.trim(),
      code: input.code === undefined ? undefined : input.code?.trim().toUpperCase() || null,
    },
    actorId,
  );
  if (!updated) {
    throw new AppError(404, "Institution not found", "INSTITUTION_NOT_FOUND");
  }
  return updated;
}

async function requestBtcAssignments(institutionIds: string[]): Promise<string[]> {
  if (institutionIds.length === 0) return [];
  if (!config.internalApiKey) {
    throw new AppError(503, "Institution assignment verification is not configured", "SERVICE_MISCONFIGURED");
  }
  let endpoint: string;
  try {
    endpoint = new URL("/internal/institutions/btc-assignments", config.authServiceUrl).toString();
  } catch {
    throw new AppError(503, "Auth service URL is invalid", "SERVICE_MISCONFIGURED");
  }
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gateway-internal-key": config.internalApiKey,
      },
      body: JSON.stringify({ institutionIds }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new AppError(503, "BTC assignments could not be verified", "UPSTREAM_UNAVAILABLE");
  }
  if (!response.ok) {
    throw new AppError(502, "BTC assignments could not be verified", "UPSTREAM_ERROR");
  }
  const body = await response.json() as { assignedInstitutionIds?: unknown };
  if (
    !Array.isArray(body.assignedInstitutionIds) ||
    body.assignedInstitutionIds.some((id) => typeof id !== "string")
  ) {
    throw new AppError(502, "Auth service returned invalid assignment data", "UPSTREAM_ERROR");
  }
  return body.assignedInstitutionIds;
}

export async function getInstitutionsWithAssignedBtc(
  institutions: Institution[],
): Promise<Institution[]> {
  const assignedIds = new Set(await requestBtcAssignments(institutions.map(({ id }) => id)));
  return institutions.filter((institution) => assignedIds.has(institution.id));
}

export async function hasAssignedBtc(institutionId: string): Promise<boolean> {
  const assignedIds = await requestBtcAssignments([institutionId]);
  return assignedIds.includes(institutionId);
}

export async function assertInstitutionAvailableForRegistration(institutionId: string): Promise<void> {
  const institution = await findInstitutionById(institutionId);
  if (!institution || institution.status !== "ACTIVE" || !institution.isActive) {
    throw new AppError(409, "The selected school is not accepting new registrations", "INSTITUTION_UNAVAILABLE");
  }
  if (!(await hasAssignedBtc(institutionId))) {
    throw new AppError(409, "The selected school has no assigned BTC account", "BTC_ASSIGNMENT_REQUIRED");
  }
}

export async function updateInstitutionStatus(
  id: string,
  status: Institution["status"],
  actorId: string,
): Promise<Institution> {
  const existing = await findInstitutionById(id);
  if (!existing) {
    throw new AppError(404, "Institution not found", "INSTITUTION_NOT_FOUND");
  }
  if (status === "ACTIVE" && !(await hasAssignedBtc(id))) {
    throw new AppError(409, "Assign at least one BTC account before activating this school", "BTC_ASSIGNMENT_REQUIRED");
  }
  const updated = await updateInstitutionStatusRecord(id, status, actorId);
  if (!updated) {
    throw new AppError(404, "Institution not found", "INSTITUTION_NOT_FOUND");
  }
  return updated;
}

export async function listInstitutionHistory(id: string) {
  const institution = await findInstitutionById(id);
  if (!institution) {
    throw new AppError(404, "Institution not found", "INSTITUTION_NOT_FOUND");
  }
  return listInstitutionHistoryRecord(id);
}

export async function getRosters(tournamentId: string, teamId?: string): Promise<Roster[]> {
  return listRosters(tournamentId, teamId);
}

export async function addRoster(input: RosterCreateInput): Promise<Roster> {
  return createRoster(input);
}

export async function addRostersBatch(inputs: RosterCreateInput[]): Promise<Roster[]> {
  return createRostersBatchRecord(inputs);
}

export async function getRoster(id: string): Promise<Roster> {
  const roster = await findRosterById(id);
  if (!roster) throw new AppError(404, "Tournament roster not found", "ROSTER_NOT_FOUND");
  return roster;
}

export async function reviewTournamentRoster(
  tournamentId: string,
  id: string,
  status: Roster["reviewStatus"],
  note: string | null,
  reviewerId: string,
): Promise<Roster> {
  const roster = await reviewRosterRecord(tournamentId, id, status, note, reviewerId);
  if (!roster) throw new AppError(404, "Tournament roster not found", "ROSTER_NOT_FOUND");
  return roster;
}

export async function updateTournamentRosterEvidence(
  tournamentId: string,
  id: string,
  evidenceUrl: string | null,
): Promise<Roster> {
  const roster = await updateRosterEvidenceRecord(tournamentId, id, evidenceUrl);
  if (!roster) throw new AppError(404, "Tournament roster not found", "ROSTER_NOT_FOUND");
  return roster;
}

export async function removeTournamentRoster(tournamentId: string, id: string): Promise<void> {
  if (!(await deleteRosterRecord(tournamentId, id))) {
    throw new AppError(404, "Tournament roster not found", "ROSTER_NOT_FOUND");
  }
}

export async function getPlayerRequests(teamId: string, status?: string): Promise<PlayerRequest[]> {
  return listPlayerRequests(teamId, status);
}

export async function getPlayerRequestsForUser(userId: string): Promise<PlayerRequest[]> {
  return listPlayerRequestsForUser(userId);
}

export async function submitPlayerRequest(input: PlayerRequestCreateInput): Promise<PlayerRequest> {
  if (!input.fullName.trim()) {
    throw new AppError(400, "Player name is required", "INVALID_PLAYER_NAME");
  }
  if (input.fullName.length > 255) {
    throw new AppError(400, "Player name must be at most 255 characters", "VALIDATION_ERROR");
  }
  if (input.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.contactEmail)) {
    throw new AppError(400, "Player contact email is invalid", "INVALID_CONTACT_EMAIL");
  }
  if (input.birthDate && Number.isNaN(Date.parse(input.birthDate))) {
    throw new AppError(400, "Player birth date is invalid", "INVALID_BIRTH_DATE");
  }
  if (input.studentId && input.studentId.length > 100) {
    throw new AppError(400, "Student ID must be at most 100 characters", "VALIDATION_ERROR");
  }
  if (input.message && input.message.length > 2000) {
    throw new AppError(400, "Message must be at most 2000 characters", "VALIDATION_ERROR");
  }
  return createPlayerRequest(input);
}

export async function getPlayerRequest(id: string): Promise<PlayerRequest> {
  const request = await findPlayerRequestById(id);
  if (!request) {
    throw new AppError(404, "Player request not found", "REQUEST_NOT_FOUND");
  }
  return request;
}

export async function respondPlayerRequest(
  id: string,
  status: "APPROVED" | "REJECTED",
  reviewerId: string,
  decisionReason: string | null,
): Promise<PlayerRequest> {
  const updated = await updatePlayerRequest(id, status, reviewerId, decisionReason);
  if (!updated) {
    throw new AppError(404, "Player request not found", "REQUEST_NOT_FOUND");
  }
  return updated;
}

export async function withdrawPlayerRequest(id: string, userId: string): Promise<PlayerRequest> {
  const request = await withdrawPlayerRequestRecord(id, userId);
  if (!request) {
    throw new AppError(409, "Only your pending request can be withdrawn", "REQUEST_NOT_WITHDRAWABLE");
  }
  return request;
}
