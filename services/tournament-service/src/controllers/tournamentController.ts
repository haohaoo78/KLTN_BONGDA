import { Request, Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../middleware/gatewayUser";
import { AppError } from "../lib/errors";
import {
  getTournament,
  assertRegistrationOpen,
  assertWorkflowStepAvailable,
  getTournaments,
  createNewTournament,
  updateTournamentInfo,
  removeTournament,
  getRegistrationPeriods,
  createNewRegistrationPeriod,
  removeRegistrationPeriod,
  getRegulations,
  createNewRegulation,
  updateRegulationInfo,
  removeRegulation,
} from "../services/tournamentService";
import {
  assignTournamentOrganizer,
  hasTournamentAssignment,
  listAssignedTournaments,
  listTournamentOrganizers,
  removeTournamentOrganizer,
} from "../repositories/organizerRepository";
import { config } from "../config";
import { getWorkflowState, saveWorkflowStep } from "../repositories/workflowStateRepository";
import {
  reserveTournamentRegistration,
  updateTournamentRegistrationReservation,
  listUnpersistedRegistrationCounts,
  backfillOrganizerInstitutionForCreator,
  type ExistingRegistrationCounts,
} from "../repositories/tournamentRepository";
import type { InstitutionLevel } from "../models/tournament";

type OrganizationalUser = {
  userId: string;
  roles: string[];
  institutionId: string | null;
  isActive: boolean;
  emailVerified: boolean;
};

type OrganizerCandidate = {
  userId: string;
  email: string;
  fullName: string;
  institutionId: string;
};

async function assertManagerForWorkflow(req: AuthenticatedRequest, tournamentId: string): Promise<void> {
  if (!(req.userRoles ?? []).includes("BTC")) {
    throw new AppError(403, "Only BTC may access tournament workflow state", "FORBIDDEN");
  }
  if (!req.userId || !(await hasTournamentAssignment(tournamentId, req.userId))) {
    throw new AppError(403, "You are not assigned to manage this tournament", "FORBIDDEN");
  }
}

async function getOrganizationalUser(userId: string): Promise<OrganizationalUser> {
  if (!config.internalApiKey) {
    throw new AppError(503, "Auth service authentication is not configured", "SERVICE_MISCONFIGURED");
  }
  let endpoint: string;
  try {
    endpoint = new URL(
      `/internal/users/${encodeURIComponent(userId)}/organizational-access`,
      config.authServiceUrl,
    ).toString();
  } catch {
    throw new AppError(503, "Auth service URL is invalid", "SERVICE_MISCONFIGURED");
  }
  let response: globalThis.Response;
  try {
    response = await fetch(endpoint, {
      headers: { "x-gateway-internal-key": config.internalApiKey },
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new AppError(503, "Auth service is unavailable", "UPSTREAM_UNAVAILABLE");
  }
  if (response.status === 404) {
    throw new AppError(404, "Account not found", "USER_NOT_FOUND");
  }
  if (!response.ok) {
    throw new AppError(502, "Account scope could not be verified", "UPSTREAM_ERROR");
  }
  return await response.json() as OrganizationalUser;
}

async function getBtcOrganizerCandidates(
  institutionId: string,
  search: string,
): Promise<OrganizerCandidate[]> {
  if (!config.internalApiKey) {
    throw new AppError(503, "Auth service authentication is not configured", "SERVICE_MISCONFIGURED");
  }
  const query = new URLSearchParams();
  if (search) query.set("search", search);
  let endpoint: string;
  try {
    endpoint = new URL(
      `/internal/institutions/${encodeURIComponent(institutionId)}/btc-accounts?${query.toString()}`,
      config.authServiceUrl,
    ).toString();
  } catch {
    throw new AppError(503, "Auth service URL is invalid", "SERVICE_MISCONFIGURED");
  }
  let response: globalThis.Response;
  try {
    response = await fetch(endpoint, {
      headers: { "x-gateway-internal-key": config.internalApiKey },
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new AppError(503, "Auth service is unavailable", "UPSTREAM_UNAVAILABLE");
  }
  if (!response.ok) {
    throw new AppError(502, "BTC accounts could not be loaded", "UPSTREAM_ERROR");
  }
  const body = await response.json() as { users: OrganizerCandidate[] };
  return body.users;
}

async function getOrganizationJson<T>(path: string): Promise<T> {
  if (!config.internalApiKey) {
    throw new AppError(503, "Internal service authentication is not configured", "SERVICE_MISCONFIGURED");
  }
  let endpoint: string;
  try {
    endpoint = new URL(path, config.organizationServiceUrl).toString();
  } catch {
    throw new AppError(503, "Organization service URL is invalid", "SERVICE_MISCONFIGURED");
  }
  let response: globalThis.Response;
  try {
    response = await fetch(endpoint, {
      headers: { "x-gateway-internal-key": config.internalApiKey },
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new AppError(503, "Organization service is unavailable", "UPSTREAM_UNAVAILABLE");
  }
  if (!response.ok) {
    throw new AppError(502, "Organization data could not be verified", "UPSTREAM_ERROR");
  }
  return await response.json() as T;
}

async function getInstitutionLevel(institutionId: string): Promise<InstitutionLevel> {
  const result = await getOrganizationJson<{
    institution: { id: string; institutionType: InstitutionLevel };
  }>(`/internal/institutions/${encodeURIComponent(institutionId)}/participation`);
  if (!["UNIVERSITY", "COLLEGE"].includes(result.institution.institutionType)) {
    throw new AppError(409, "Only universities and colleges may register", "INSTITUTION_LEVEL_NOT_ELIGIBLE");
  }
  return result.institution.institutionType;
}

async function backfillOwnTournamentSchools(req: AuthenticatedRequest): Promise<void> {
  if (
    req.userId && req.userInstitutionId &&
    (req.userRoles ?? []).includes("BTC")
  ) {
    await backfillOrganizerInstitutionForCreator(req.userId, req.userInstitutionId);
  }
}

async function getOrganizationCounts(
  tournamentId?: string,
  institutionId?: string,
): Promise<Array<{ tournamentId: string; institutionId: string; pending: number; approved: number }>> {
  const query = new URLSearchParams();
  if (tournamentId) query.set("tournamentId", tournamentId);
  if (institutionId) query.set("institutionId", institutionId);
  const result = await getOrganizationJson<{
    counts: Array<{ tournamentId: string; institutionId: string; pending: number; approved: number }>;
  }>(`/internal/registration-counts?${query.toString()}`);
  return result.counts;
}

export const tournamentController = {
  async getRosterEditability(req: Request, res: Response, next: NextFunction) {
    try {
      const tournament = await getTournament(req.params.tournamentId);
      const editable = ["OPEN_REGISTRATION", "REGISTRATION_CLOSED"].includes(tournament.status);
      res.json({
        editable,
        status: tournament.status,
        reason: editable ? null : "Đội hình giải đã khóa hoặc giải chưa mở giai đoạn gửi roster.",
      });
    } catch (err) { next(err); }
  },
  async getWorkflowState(req: Request, res: Response, next: NextFunction) {
    try {
      const authenticatedReq = req as AuthenticatedRequest;
      if (!authenticatedReq.userId) throw new AppError(401, "Missing user authentication", "UNAUTHENTICATED");
      const tournamentId = req.params.id;
      const tournament = await getTournament(tournamentId);
      await assertManagerForWorkflow(authenticatedReq, tournament.id);
      res.json({ workflow: await getWorkflowState(tournamentId, authenticatedReq.userId) });
    } catch (err) { next(err); }
  },

  async updateWorkflowStep(req: Request, res: Response, next: NextFunction) {
    try {
      const authenticatedReq = req as AuthenticatedRequest;
      if (!authenticatedReq.userId) throw new AppError(401, "Missing user authentication", "UNAUTHENTICATED");
      const currentStep = req.body?.currentStep;
      if (!Number.isInteger(currentStep) || currentStep < 1 || currentStep > 8) {
        throw new AppError(400, "currentStep must be an integer from 1 to 8", "VALIDATION_ERROR");
      }
      const tournament = await getTournament(req.params.id);
      await assertManagerForWorkflow(authenticatedReq, tournament.id);
      await assertWorkflowStepAvailable(tournament.id, currentStep);
      res.json({ workflow: await saveWorkflowStep(tournament.id, authenticatedReq.userId, currentStep) });
    } catch (err) { next(err); }
  },
  async reserveRegistration(req: Request, res: Response, next: NextFunction) {
    try {
      const { tournamentId } = req.params;
      const { registrationId, teamId, institutionId } = req.body ?? {};
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (![registrationId, teamId, institutionId].every(
        (value) => typeof value === "string" && uuidPattern.test(value),
      )) {
        throw new AppError(400, "registrationId, teamId and institutionId must be UUIDs", "VALIDATION_ERROR");
      }
      const institutionType = await getInstitutionLevel(institutionId as string);
      const tournament = await assertRegistrationOpen(tournamentId, institutionId as string, institutionType);
      await reserveTournamentRegistration({
        registrationId: registrationId as string,
        tournamentId,
        teamId: teamId as string,
        institutionId: institutionId as string,
        maxTeams: tournament.maxTeams,
        defaultMaxTeamsPerInstitution: tournament.defaultMaxTeamsPerInstitution ?? null,
        institutionTeamLimits: tournament.institutionTeamLimits ?? [],
        loadExistingCounts: async () => {
          const counts = await getOrganizationCounts(tournamentId);
          return counts.reduce<ExistingRegistrationCounts>(
            (total, row) => ({
              total: total.total + row.pending + row.approved,
              institution: total.institution + (
                row.institutionId === institutionId ? row.pending + row.approved : 0
              ),
            }),
            { total: 0, institution: 0 },
          );
        },
      });
      res.status(201).json({ registrationId });
    } catch (err) {
      next(err);
    }
  },

  async updateRegistrationReservation(req: Request, res: Response, next: NextFunction) {
    try {
      const status = req.body?.status;
      const persistedInOrganization = req.body?.persistedInOrganization;
      const registration = req.body?.tournamentId && req.body?.teamId && req.body?.institutionId
        ? {
          tournamentId: String(req.body.tournamentId),
          teamId: String(req.body.teamId),
          institutionId: String(req.body.institutionId),
        }
        : undefined;
      if (
        !["PENDING", "APPROVED", "REJECTED", "WITHDRAWN"].includes(status) ||
        typeof persistedInOrganization !== "boolean" ||
        (registration && ![registration.tournamentId, registration.teamId, registration.institutionId].every(
          (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
        ))
      ) {
        throw new AppError(400, "A valid registration status and persistence flag are required", "VALIDATION_ERROR");
      }
      const withdrawnRegistrationIds = await updateTournamentRegistrationReservation(
        req.params.registrationId,
        status as "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN",
        persistedInOrganization,
        registration,
      );
      res.json({ withdrawnRegistrationIds });
    } catch (err) {
      next(err);
    }
  },

  async listRegistrationOptions(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!(req.userRoles ?? []).includes("TEAM_CAPTAIN")) {
        throw new AppError(403, "Only team representatives can view registration options", "FORBIDDEN");
      }
      const institutionId = typeof req.query.institutionId === "string" ? req.query.institutionId : "";
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidPattern.test(institutionId)) {
        throw new AppError(400, "A valid institutionId is required", "VALIDATION_ERROR");
      }
      const institutionType = await getInstitutionLevel(institutionId);
      // Return every published tournament so captains can see why it is unavailable;
      // only options that pass the checks below can actually be registered.
      const { items } = await getTournaments(1000, 0);
      const [registrationCounts, institutionCounts, pendingReservations, totalReservations] = await Promise.all([
        getOrganizationCounts(),
        getOrganizationCounts(undefined, institutionId),
        listUnpersistedRegistrationCounts(institutionId),
        listUnpersistedRegistrationCounts(),
      ]);
      const details = await Promise.all(items.map((item) => getTournament(item.id)));
      const options = details.map((tournament) => {
        const now = Date.now();
        const hasOpenPeriod = tournament.registrationPeriods?.some((period) => {
          const start = new Date(period.startDate).getTime();
          const end = new Date(period.endDate).getTime();
          return Number.isFinite(start) && Number.isFinite(end) && start <= now && now <= end;
        }) ?? false;
        const levels = tournament.allowedInstitutionLevels ?? ["UNIVERSITY", "COLLEGE"];
        const allSchools = tournament.allInstitutionsAllowed ?? !(tournament.allowedInstitutionIds?.length);
        const institutionAllowed =
          tournament.scope === "SINGLE_INSTITUTION"
            ? tournament.allowedInstitutionIds?.includes(institutionId) === true
            : levels.includes(institutionType) &&
              (allSchools || tournament.allowedInstitutionIds?.includes(institutionId) === true);
        const registeredForInstitution = institutionCounts
          .filter((row) => row.tournamentId === tournament.id)
          .reduce((sum, row) => sum + row.pending + row.approved, 0);
        const reservedForInstitution = pendingReservations
          .find((row) => row.tournamentId === tournament.id)?.count ?? 0;
        const schoolOverride = tournament.institutionTeamLimits?.find(
          (limit) => limit.institutionId === institutionId,
        );
        const schoolLimit = schoolOverride
          ? schoolOverride.maxTeams
          : tournament.defaultMaxTeamsPerInstitution ?? null;
        const schoolCount = registeredForInstitution + reservedForInstitution;
        const totalCount = totalReservations.find((row) => row.tournamentId === tournament.id)?.count ?? 0;
        const orgTotal = registrationCounts
          .filter((row) => row.tournamentId === tournament.id)
          .reduce((sum, row) => sum + row.pending + row.approved, 0);
        const reason = tournament.status !== "OPEN_REGISTRATION"
          ? "Giải chưa mở đăng ký hoặc đã đóng đăng ký."
          : !hasOpenPeriod
            ? "Giải chưa đến hoặc đã hết thời gian nhận đăng ký."
          : !institutionAllowed
            ? "Trường hoặc bậc đào tạo của đội không thuộc phạm vi giải."
            : schoolLimit !== null && schoolCount >= schoolLimit
              ? "Trường đã đạt giới hạn số đội được đăng ký."
              : orgTotal + totalCount >= tournament.maxTeams
                ? "Giải đã đạt tổng số đội tối đa."
                : null;
        return {
          tournament,
          eligible: reason === null,
          ineligibilityReason: reason,
          registeredTeamsForInstitution: schoolCount,
          maxTeamsPerInstitution: schoolLimit,
        };
      });
      res.json({ options });
    } catch (err) {
      next(err);
    }
  },

  async checkManagerAccess(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { tournamentId } = req.params;
      const roles = req.userRoles ?? [];
      if (roles.includes("ADMIN")) {
        const tournament = await getTournament(tournamentId);
        if (tournament.status === "DRAFT") {
          throw new AppError(404, "Tournament not found", "TOURNAMENT_NOT_FOUND");
        }
        res.status(204).send();
        return;
      }
      if (
        !roles.includes("BTC") ||
        !req.userId ||
        !(await hasTournamentAssignment(tournamentId, req.userId))
      ) {
        throw new AppError(403, "You are not assigned to manage this tournament", "FORBIDDEN");
      }
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },

  async listMyTournaments(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.userId) {
        throw new AppError(401, "Missing user authentication", "UNAUTHENTICATED");
      }
      await backfillOwnTournamentSchools(req);
      const includeOwnDrafts = !(req.userRoles ?? []).includes("ADMIN");
      res.json(await listAssignedTournaments(req.userId, includeOwnDrafts));
    } catch (err) {
      next(err);
    }
  },

  async listTournamentOrganizers(req: Request, res: Response, next: NextFunction) {
    try {
      res.json({
        userIds: await listTournamentOrganizers(req.params.tournamentId),
      });
    } catch (err) {
      next(err);
    }
  },

  async listOrganizerCandidates(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const tournament = await getTournament(req.params.tournamentId);
      const creator = await getOrganizationalUser(tournament.createdBy);
      const roles = req.userRoles ?? [];
      if (!roles.includes("ADMIN") && req.userInstitutionId !== creator.institutionId) {
        throw new AppError(403, "You cannot manage organizers outside your school scope", "FORBIDDEN");
      }
      const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
      if (search.length > 100) {
        throw new AppError(400, "Search text is too long", "VALIDATION_ERROR");
      }
      if (!creator.institutionId) {
        res.json({ candidates: [] });
        return;
      }
      res.json({
        candidates: await getBtcOrganizerCandidates(creator.institutionId, search),
      });
    } catch (error) {
      next(error);
    }
  },

  async assignOrganizer(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.userId) {
        throw new AppError(401, "Missing user authentication", "UNAUTHENTICATED");
      }
      const { tournamentId, userId } = req.params;
      const tournament = await getTournament(tournamentId);
      const [creator, candidate] = await Promise.all([
        getOrganizationalUser(tournament.createdBy),
        getOrganizationalUser(userId),
      ]);
      if (
        !candidate.isActive ||
        !candidate.emailVerified ||
        !candidate.roles.includes("BTC") ||
        !candidate.institutionId ||
        candidate.institutionId !== creator.institutionId
      ) {
        throw new AppError(
          409,
          "Only an active BTC from the tournament creator's school can be added as a co-organizer",
          "BTC_SCOPE_MISMATCH",
        );
      }
      const actorRoles = req.userRoles ?? [];
      if (
        !actorRoles.includes("ADMIN") &&
        req.userInstitutionId !== creator.institutionId
      ) {
        throw new AppError(403, "You cannot assign organizers outside your school scope", "FORBIDDEN");
      }
      await assignTournamentOrganizer(tournamentId, userId, req.userId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },

  async removeOrganizer(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.userId) {
        throw new AppError(401, "Missing user authentication", "UNAUTHENTICATED");
      }
      const removed = await removeTournamentOrganizer(
        req.params.tournamentId,
        req.params.userId,
        req.userId,
      );
      if (!removed) {
        throw new AppError(404, "Organizer assignment not found", "NOT_FOUND");
      }
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },

  // Tournaments
  async getTournamentById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const tournament = await getTournament(id);
      const authenticatedReq = req as AuthenticatedRequest;
      if (
        tournament.status === "DRAFT" &&
        ((authenticatedReq.userRoles ?? []).includes("ADMIN") ||
          !(authenticatedReq.userRoles ?? []).includes("BTC") ||
          authenticatedReq.userId !== tournament.createdBy)
      ) {
        throw new AppError(404, "Tournament not found", "TOURNAMENT_NOT_FOUND");
      }
      res.json({ tournament });
    } catch (err) {
      next(err);
    }
  },

  async listPublishedTournamentTeams(req: Request, res: Response, next: NextFunction) {
    try {
      const tournament = await getTournament(req.params.id);
      if (tournament.status === "DRAFT") {
        throw new AppError(404, "Tournament not found", "TOURNAMENT_NOT_FOUND");
      }
      const { teams } = await getOrganizationJson<{
        teams: Array<{ id: string; name: string; shortName: string | null; logoUrl: string | null; institutionId: string | null; institutionName: string | null; unitName: string | null }>;
      }>(`/internal/tournaments/${encodeURIComponent(tournament.id)}/approved-teams`);
      res.json({ teams });
    } catch (err) { next(err); }
  },

  async listTournaments(req: Request, res: Response, next: NextFunction) {
    try {
      const limit = req.query.limit === undefined ? 20 : Number(req.query.limit);
      const offset = req.query.offset === undefined ? 0 : Number(req.query.offset);
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const statuses = typeof req.query.statuses === "string"
        ? req.query.statuses.split(",").filter(Boolean)
        : undefined;
      const search = typeof req.query.search === "string" ? req.query.search.trim() : undefined;
      const scope = typeof req.query.scope === "string" ? req.query.scope : undefined;
      const institutionId = typeof req.query.institutionId === "string" ? req.query.institutionId : undefined;
      const fromDate = typeof req.query.fromDate === "string" ? req.query.fromDate : undefined;
      const toDate = typeof req.query.toDate === "string" ? req.query.toDate : undefined;
      const sortBy = typeof req.query.sortBy === "string" ? req.query.sortBy : "CREATED_AT";
      const sortOrder = typeof req.query.sortOrder === "string" ? req.query.sortOrder : "DESC";
      const validStatuses = [
        "DRAFT", "OPEN_REGISTRATION", "REGISTRATION_CLOSED", "ROSTER_LOCKED",
        "PREPARING", "IN_PROGRESS", "PAUSED", "COMPLETED", "CANCELLED",
      ];
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      const isIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        Number.isFinite(Date.parse(`${value}T00:00:00.000Z`));
      if (
        !Number.isInteger(limit) || limit < 1 || limit > 100 ||
        !Number.isInteger(offset) || offset < 0 ||
        (status !== undefined && !validStatuses.includes(status)) ||
        statuses?.some((value) => !validStatuses.includes(value)) ||
        (statuses && statuses.length > 9) ||
        (search !== undefined && search.length > 100) ||
        (scope !== undefined && !["SINGLE_INSTITUTION", "INTER_SCHOOL"].includes(scope)) ||
        (institutionId !== undefined && !uuidPattern.test(institutionId)) ||
        (fromDate !== undefined && !isIsoDate(fromDate)) ||
        (toDate !== undefined && !isIsoDate(toDate)) ||
        !["CREATED_AT", "NAME", "START_DATE"].includes(sortBy) ||
        !["ASC", "DESC"].includes(sortOrder) ||
        (fromDate && toDate && fromDate > toDate)
      ) {
        throw new AppError(400, "Invalid tournament list filters", "VALIDATION_ERROR");
      }

      const authenticatedReq = req as AuthenticatedRequest;
      await backfillOwnTournamentSchools(authenticatedReq);
      const draftCreatorId = authenticatedReq.userId &&
        !(authenticatedReq.userRoles ?? []).includes("ADMIN") &&
        (authenticatedReq.userRoles ?? []).includes("BTC")
        ? authenticatedReq.userId
        : undefined;
      const result = await getTournaments(limit, offset, status, {
        statuses,
        search,
        scope: scope as "SINGLE_INSTITUTION" | "INTER_SCHOOL" | undefined,
        institutionId,
        fromDate,
        toDate,
        sortBy: sortBy as "CREATED_AT" | "NAME" | "START_DATE",
        sortOrder: sortOrder as "ASC" | "DESC",
        draftCreatorId,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async createTournament(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.userId) {
        throw new AppError(401, "Missing user authentication", "UNAUTHENTICATED");
      }
      const isBtc = (req.userRoles ?? []).includes("BTC");
      if (!isBtc) {
        throw new AppError(403, "Only BTC may create a tournament", "FORBIDDEN");
      }
      const institutionId = req.userInstitutionId;
      if (!institutionId) {
        throw new AppError(403, "BTC must have an active school assignment to create a tournament", "SCHOOL_ASSIGNMENT_REQUIRED");
      }
      const allowedInstitutionIds = Array.isArray(req.body?.allowedInstitutionIds)
        ? req.body.allowedInstitutionIds as string[]
        : [];
      const allowedInstitutionLevels = Array.isArray(req.body?.allowedInstitutionLevels)
        ? req.body.allowedInstitutionLevels as InstitutionLevel[]
        : ["UNIVERSITY", "COLLEGE"] as InstitutionLevel[];
      const allInstitutionsAllowed = typeof req.body?.allInstitutionsAllowed === "boolean"
        ? req.body.allInstitutionsAllowed
        : req.body?.scope === "INTER_SCHOOL" && allowedInstitutionIds.length === 0;
      const institutionTeamLimits = Array.isArray(req.body?.institutionTeamLimits)
        ? req.body.institutionTeamLimits
        : [];
      const defaultMaxTeamsPerInstitution = req.body?.defaultMaxTeamsPerInstitution === null ||
        req.body?.defaultMaxTeamsPerInstitution === undefined
        ? null
        : Number(req.body.defaultMaxTeamsPerInstitution);
      const creatorInstitutionType = await getInstitutionLevel(institutionId);
      if (
        req.body?.scope === "SINGLE_INSTITUTION" &&
        (allowedInstitutionIds.length !== 1 ||
          allowedInstitutionIds[0] !== institutionId)
      ) {
        throw new AppError(403, "A BTC may create a single-school tournament only for its assigned school", "TOURNAMENT_SCOPE_MISMATCH");
      }
      if (
        !allInstitutionsAllowed &&
        !allowedInstitutionIds.includes(institutionId)
      ) {
        throw new AppError(403, "The BTC's school must be included in the tournament participation scope", "TOURNAMENT_SCOPE_MISMATCH");
      }
      if (!allowedInstitutionLevels.includes(creatorInstitutionType)) {
        throw new AppError(403, "The organizer's education level must be included in the tournament scope", "TOURNAMENT_SCOPE_MISMATCH");
      }
      const scopedInstitutionIds = [...new Set([
        ...allowedInstitutionIds,
        ...institutionTeamLimits.map((limit: { institutionId?: unknown }) => limit.institutionId),
      ])];
      for (const scopedId of scopedInstitutionIds) {
        if (typeof scopedId !== "string") {
          throw new AppError(400, "Institution limits must refer to valid school IDs", "INVALID_INSTITUTION_LIMIT");
        }
        const level = await getInstitutionLevel(scopedId);
        if (!allowedInstitutionLevels.includes(level)) {
          throw new AppError(400, "A selected school does not match the selected education levels", "INSTITUTION_LEVEL_MISMATCH");
        }
      }
      const input = {
        name: req.body.name,
        description: req.body.description,
        location: req.body.location,
        organizerName: req.body.organizerName,
        organizerContactName: req.body.organizerContactName,
        organizerEmail: req.body.organizerEmail,
        organizerPhone: req.body.organizerPhone,
        scope: req.body.scope,
        allowedInstitutionIds,
        allowedInstitutionLevels,
        allInstitutionsAllowed,
        defaultMaxTeamsPerInstitution,
        institutionTeamLimits,
        organizingInstitutionId: institutionId,
        footballFormat: req.body.footballFormat,
        competitionFormat: req.body.competitionFormat,
        minTeams: req.body.minTeams,
        maxTeams: req.body.maxTeams,
        minPlayers: req.body.minPlayers,
        maxPlayersPerTeam: req.body.maxPlayersPerTeam,
        startDate: req.body.startDate,
        endDate: req.body.endDate,
        registrationStart: req.body.registrationStart,
        registrationEnd: req.body.registrationEnd,
        eligibilityDescription: req.body.eligibilityDescription,
        pointsForWin: req.body.pointsForWin,
        pointsForDraw: req.body.pointsForDraw,
        pointsForLoss: req.body.pointsForLoss,
        rankingCriteria: req.body.rankingCriteria,
        advancingTeamsPerGroup: req.body.advancingTeamsPerGroup,
        yellowCardsForSuspension: req.body.yellowCardsForSuspension,
        suspensionMatches: req.body.suspensionMatches,
        complaintWindowHours: req.body.complaintWindowHours,
        minimumRestMinutes: req.body.minimumRestMinutes,
        matchDurationMinutes: req.body.matchDurationMinutes,
        forfeitPolicy: req.body.forfeitPolicy,
        forfeitWinnerScore: req.body.forfeitWinnerScore,
        forfeitLoserScore: req.body.forfeitLoserScore,
        createdBy: req.userId,
      };

      const tournament = await createNewTournament(input);
      res.status(201).json({ tournament });
    } catch (err) {
      next(err);
    }
  },

  async updateTournament(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const input = {
        name: req.body.name,
        description: req.body.description,
        status: req.body.status,
        location: req.body.location,
        maxTeams: req.body.maxTeams,
        startDate: req.body.startDate,
        endDate: req.body.endDate,
      };

      const tournament = await updateTournamentInfo(id, input);
      res.json({ tournament });
    } catch (err) {
      next(err);
    }
  },

  async deleteTournament(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      await removeTournament(id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },

  // Registration Periods
  async listRegistrationPeriods(req: Request, res: Response, next: NextFunction) {
    try {
      const { tournamentId } = req.params;
      const periods = await getRegistrationPeriods(tournamentId);
      res.json({ periods });
    } catch (err) {
      next(err);
    }
  },

  async createRegistrationPeriod(req: Request, res: Response, next: NextFunction) {
    try {
      const { tournamentId } = req.params;
      const input = {
        tournamentId,
        name: req.body.name,
        startDate: req.body.startDate,
        endDate: req.body.endDate,
      };

      const period = await createNewRegistrationPeriod(input);
      res.status(201).json({ period });
    } catch (err) {
      next(err);
    }
  },

  async deleteRegistrationPeriod(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      await removeRegistrationPeriod(id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },

  // Regulations
  async listRegulations(req: Request, res: Response, next: NextFunction) {
    try {
      const { tournamentId } = req.params;
      const regulations = await getRegulations(tournamentId);
      res.json({ regulations });
    } catch (err) {
      next(err);
    }
  },

  async createRegulation(req: Request, res: Response, next: NextFunction) {
    try {
      const { tournamentId } = req.params;
      const input = {
        tournamentId,
        title: req.body.title,
        content: req.body.content,
      };

      const regulation = await createNewRegulation(input);
      res.status(201).json({ regulation });
    } catch (err) {
      next(err);
    }
  },

  async updateRegulation(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const input = {
        title: req.body.title,
        content: req.body.content,
      };

      const regulation = await updateRegulationInfo(id, input);
      res.json({ regulation });
    } catch (err) {
      next(err);
    }
  },

  async deleteRegulation(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      await removeRegulation(id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
};
