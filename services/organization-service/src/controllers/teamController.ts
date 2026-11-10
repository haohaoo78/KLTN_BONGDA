import { Request, Response, NextFunction } from "express";
import { AppError } from "../lib/errors";
import type { AuthenticatedRequest } from "../middleware/gatewayUser";
import {
  assertCanManageTeam,
  assertCanManageTournament,
  assertCanViewTeam,
  isTournamentStaff,
  requireUserId,
} from "../lib/teamAuthorization";
import {
  getTeam,
  getPublicTeamDetail,
  getTeamsForUser,
  getTeamsManagedByUser,
  getTeams,
  createNewTeam,
  linkTeamToVerifiedInstitution,
  updateTeamInfo,
  removeTeam,
  getTeamRegistration,
  getTeamRegistrationByRegistrationId,
  getTeamRegistrations,
  getTeamRegistrationsByTeam,
  registerTeamForTournament,
  updateTeamRegistrationStatus,
  removeTeamRegistration,
  getPlayers,
  listTournamentDrawCandidates,
  addPlayerToTeam,
  updatePlayerInfo,
  removePlayerFromTeam,
  getPlayer,
  listTournamentRegistrationCounts as getTournamentRegistrationCounts,
} from "../services/teamService";

export const teamController = {
  async listPublishedTournamentTeams(req: Request, res: Response, next: NextFunction) {
    try {
      const { tournamentId } = req.params;
      const registrations = await getTeamRegistrations(tournamentId, { status: "APPROVED" });
      const teams = await Promise.all(registrations.map(async (registration) => {
        const team = await getTeam(registration.teamId);
        return {
          id: team.id,
          name: team.name,
          shortName: team.shortName,
          logoUrl: team.logoUrl,
          institutionId: team.institutionId,
          institutionName: registration.institutionName ?? null,
          unitName: team.unitName,
        };
      }));
      res.json({ teams });
    } catch (err) { next(err); }
  },

  async listInternalRegistrationCounts(req: Request, res: Response, next: NextFunction) {
    try {
      const tournamentId = typeof req.query.tournamentId === "string" ? req.query.tournamentId : undefined;
      const institutionId = typeof req.query.institutionId === "string" ? req.query.institutionId : undefined;
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (
        (tournamentId && !uuidPattern.test(tournamentId)) ||
        (institutionId && !uuidPattern.test(institutionId))
      ) {
        throw new AppError(400, "Registration count filters must be UUIDs", "VALIDATION_ERROR");
      }
      res.json({
        counts: await getTournamentRegistrationCounts(tournamentId, institutionId),
      });
    } catch (err) {
      next(err);
    }
  },

  async listPublicTeams(req: Request, res: Response, next: NextFunction) {
    try {
      const requestedLimit = Number(req.query.limit) || 100;
      const limit = Math.min(Math.max(requestedLimit, 1), 100);
      const offset = Math.max(Number(req.query.offset) || 0, 0);
      const institutionId = typeof req.query.institutionId === "string" ? req.query.institutionId : undefined;
      const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 120) : undefined;
      const sortBy = typeof req.query.sortBy === "string" ? req.query.sortBy : "CREATED_AT";
      const isActive = typeof req.query.isActive === "string"
        ? req.query.isActive === "true" ? true : req.query.isActive === "false" ? false : null
        : undefined;
      if (institutionId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(institutionId)) {
        throw new AppError(400, "institutionId must be a UUID", "VALIDATION_ERROR");
      }
      if (isActive === null || !["NAME", "CREATED_AT"].includes(sortBy)) {
        throw new AppError(400, "Invalid public team filters", "VALIDATION_ERROR");
      }
      const { items, total } = await getTeams(limit, offset, isActive, institutionId, search, sortBy as "NAME" | "CREATED_AT");
      res.json({
        items: items.map((team) => ({
          id: team.id,
          name: team.name,
          shortName: team.shortName,
          description: team.description,
          logoUrl: team.logoUrl,
          institutionId: team.institutionId,
          unitName: team.unitName,
          kitColor: team.kitColor,
          isActive: team.isActive,
        })),
        total,
      });
    } catch (err) {
      next(err);
    }
  },

  async listTournamentDrawCandidates(req: Request, res: Response, next: NextFunction) {
    try {
      const { tournamentId } = req.params;
      const candidates = await listTournamentDrawCandidates(tournamentId);
      res.json({ candidates });
    } catch (err) {
      next(err);
    }
  },

  async getPublicTeamById(req: Request, res: Response, next: NextFunction) {
    try {
      const { team, players } = await getPublicTeamDetail(req.params.id);
      res.json({ team, players });
    } catch (err) {
      next(err);
    }
  },

  // Teams
  async checkCaptainAccess(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { teamId } = req.params;
      const team = await getTeam(teamId);
      res.json({ allowed: team.captainId === requireUserId(req) });
    } catch (err) {
      next(err);
    }
  },

  async getTeamById(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      await assertCanViewTeam(req, id);
      const team = await getTeam(id);
      res.json({ team });
    } catch (err) {
      next(err);
    }
  },

  async listTeams(req: Request, res: Response, next: NextFunction) {
    try {
      const authenticated = req as AuthenticatedRequest;
      const limit = Number(req.query.limit) || 20;
      const offset = Number(req.query.offset) || 0;
      const isActive = req.query.isActive === "true" ? true : req.query.isActive === "false" ? false : undefined;
      const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 120) : undefined;
      const institutionId =
        authenticated.userRoles?.includes("BTC") &&
        !authenticated.userRoles.includes("ADMIN")
          ? authenticated.userInstitutionId
          : undefined;
      if (
        authenticated.userRoles?.includes("BTC") &&
        !authenticated.userRoles.includes("ADMIN") &&
        !institutionId
      ) {
        throw new AppError(403, "BTC must have an active school assignment", "SCHOOL_ASSIGNMENT_REQUIRED");
      }

      const result = await getTeams(limit, offset, isActive, institutionId, search);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async listMyTeams(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userId = requireUserId(req);
      const teams = await getTeamsForUser(userId);
      res.json({ teams });
    } catch (err) {
      next(err);
    }
  },

  async listMyManagedTeams(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.userRoles?.includes("TEAM_CAPTAIN")) {
        throw new AppError(403, "Only team captains can manage team requests", "FORBIDDEN");
      }
      const teams = await getTeamsManagedByUser(requireUserId(req));
      res.json({ teams });
    } catch (err) { next(err); }
  },

  async listMyTeamRegistrations(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const teams = await getTeamsForUser(requireUserId(req));
      const registrations = (await Promise.all(teams.map((team) => getTeamRegistrationsByTeam(team.id)))).flat();
      res.json({ registrations });
    } catch (err) { next(err); }
  },

  async createTeam(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.userRoles?.includes("TEAM_CAPTAIN")) {
        throw new AppError(403, "Only a team representative can create a team", "FORBIDDEN");
      }
      if (!req.userInstitutionId || req.body.institutionId !== req.userInstitutionId) {
        throw new AppError(403, "A captain can create teams only for their verified school", "SCHOOL_SCOPE_VIOLATION");
      }
      const input = {
        name: req.body.name,
        shortName: req.body.shortName,
        description: req.body.description,
        logoUrl: req.body.logoUrl,
        institutionId: req.body.institutionId,
        unitName: req.body.unitName,
        representativeName: req.body.representativeName,
        kitColor: req.body.kitColor,
        captainId: requireUserId(req),
        contactEmail: req.body.contactEmail,
        contactPhone: req.body.contactPhone,
        maxPlayers: req.body.maxPlayers,
      };

      const team = await createNewTeam(input);
      res.status(201).json({ team });
    } catch (err) {
      next(err);
    }
  },

  async linkTeamToVerifiedSchool(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      await assertCanManageTeam(req, id);
      if (!req.userInstitutionId) {
        throw new AppError(409, "Hồ sơ tài khoản đội trưởng chưa được liên kết với trường. Vui lòng nhờ Admin xác minh trường trước.", "INSTITUTION_REQUIRED");
      }
      const team = await linkTeamToVerifiedInstitution(id, req.userInstitutionId);
      res.json({ team });
    } catch (err) {
      next(err);
    }
  },

  async updateTeam(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      await assertCanManageTeam(req, id);
      if (
        req.body.institutionId !== undefined ||
        req.body.captainId !== undefined ||
        req.body.isActive !== undefined
      ) {
        throw new AppError(403, "Team representatives cannot change school, ownership or system status", "FORBIDDEN");
      }
      const input = {
        name: req.body.name,
        shortName: req.body.shortName,
        description: req.body.description,
        logoUrl: req.body.logoUrl,
        unitName: req.body.unitName,
        representativeName: req.body.representativeName,
        kitColor: req.body.kitColor,
        contactEmail: req.body.contactEmail,
        contactPhone: req.body.contactPhone,
        maxPlayers: req.body.maxPlayers,
      };

      const team = await updateTeamInfo(id, input);
      res.json({ team });
    } catch (err) {
      next(err);
    }
  },

  async deleteTeam(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      await assertCanManageTeam(req, id);
      await removeTeam(id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },

  // Team Registrations
  async getTeamRegistrationById(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { teamId, tournamentId } = req.params;
      await assertCanViewTeam(req, teamId);
      if (req.userRoles?.includes("BTC")) {
        await assertCanManageTournament(req, tournamentId);
      }
      const registration = await getTeamRegistration(teamId, tournamentId);
      res.json({ registration });
    } catch (err) {
      next(err);
    }
  },

  async listTeamRegistrationsByTeam(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { teamId } = req.params;
      await assertCanManageTeam(req, teamId);
      const registrations = await getTeamRegistrationsByTeam(teamId);
      res.json({ registrations });
    } catch (err) { next(err); }
  },

  async listTeamRegistrations(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!isTournamentStaff(req)) {
        throw new AppError(403, "Only tournament staff can list all registrations", "FORBIDDEN");
      }
      const { tournamentId } = req.params;
      await assertCanManageTournament(req, tournamentId);
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const institutionId = typeof req.query.institutionId === "string" ? req.query.institutionId : undefined;
      const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 120) : undefined;
      if (status && !["PENDING", "APPROVED", "REJECTED", "WITHDRAWN"].includes(status)) {
        throw new AppError(400, "Invalid registration status filter", "VALIDATION_ERROR");
      }
      if (institutionId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(institutionId)) {
        throw new AppError(400, "institutionId must be a UUID", "VALIDATION_ERROR");
      }
      const [registrations, allRegistrations] = await Promise.all([
        getTeamRegistrations(tournamentId, { status, institutionId, search }),
        getTeamRegistrations(tournamentId),
      ]);
      const summary = new Map<string, {
        institutionId: string;
        institutionName: string;
        pending: number;
        approved: number;
        total: number;
      }>();
      for (const registration of allRegistrations) {
        const key = registration.institutionId ?? "unknown";
        const row = summary.get(key) ?? {
          institutionId: registration.institutionId ?? "",
          institutionName: registration.institutionName ?? "Chưa xác định trường",
          pending: 0,
          approved: 0,
          total: 0,
        };
        if (registration.status === "PENDING" || registration.status === "APPROVED") {
          row.total += 1;
          if (registration.status === "PENDING") row.pending += 1;
          if (registration.status === "APPROVED") row.approved += 1;
        }
        summary.set(key, row);
      }
      res.json({ registrations, schoolCounts: [...summary.values()] });
    } catch (err) {
      next(err);
    }
  },

  async registerTeam(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.userRoles?.includes("TEAM_CAPTAIN")) {
        throw new AppError(403, "Only a team representative can register a team", "FORBIDDEN");
      }
      if (typeof req.body.teamId !== "string") {
        throw new AppError(400, "teamId is required", "VALIDATION_ERROR");
      }
      if (typeof req.body.tournamentId !== "string") {
        throw new AppError(400, "tournamentId is required", "VALIDATION_ERROR");
      }
      if (!Array.isArray(req.body.roster)) {
        throw new AppError(400, "roster is required with the tournament application", "ROSTER_REQUIRED");
      }
      if (req.body.roster.some((entry: unknown) => !entry || typeof entry !== "object" || typeof (entry as Record<string, unknown>).playerId !== "string")) {
        throw new AppError(400, "Every roster entry must include a playerId", "INVALID_ROSTER");
      }
      if (req.body.roster.some((entry: Record<string, unknown>) => typeof entry.evidenceUrl === "string" && entry.evidenceUrl.trim() && (entry.evidenceUrl.trim().length > 500 || !/^https?:\/\//i.test(entry.evidenceUrl.trim())))) {
        throw new AppError(400, "Player evidence must be an HTTP or HTTPS link up to 500 characters", "INVALID_EVIDENCE_URL");
      }
      await assertCanManageTeam(req, req.body.teamId);
      const input = {
        teamId: req.body.teamId,
        tournamentId: req.body.tournamentId,
        notes: typeof req.body.notes === "string" ? req.body.notes.trim().slice(0, 2000) : undefined,
        roster: Array.isArray(req.body.roster) ? req.body.roster.map((entry: Record<string, unknown>) => ({
          playerId: entry.playerId,
          lineupRole: entry.lineupRole,
          isGoalkeeper: entry.isGoalkeeper === true,
          evidenceUrl: typeof entry.evidenceUrl === "string" ? entry.evidenceUrl.trim().slice(0, 500) : undefined,
        })) : undefined,
      };

      const registration = await registerTeamForTournament(input);
      res.status(201).json({ registration });
    } catch (err) {
      next(err);
    }
  },

  async updateTeamRegistration(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const current = await getTeamRegistrationByRegistrationId(id);
      await assertCanManageTournament(req, current.tournamentId);
      const input = {
        status: req.body.status,
        notes: req.body.notes,
      };
      const approvedBy = req.userId;

      const registration = await updateTeamRegistrationStatus(id, input, approvedBy);
      res.json({ registration });
    } catch (err) {
      next(err);
    }
  },

  async deleteTeamRegistration(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const current = await getTeamRegistrationByRegistrationId(id);
      await assertCanManageTournament(req, current.tournamentId);
      await removeTeamRegistration(id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },

  // Players
  async listPlayers(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { teamId } = req.params;
      await assertCanViewTeam(req, teamId);
      const includeLeft = req.query.includeLeft === "true";
      const players = await getPlayers(teamId, includeLeft);
      res.json({ players });
    } catch (err) {
      next(err);
    }
  },

  async addPlayer(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (typeof req.body.teamId !== "string") {
        throw new AppError(400, "teamId is required", "VALIDATION_ERROR");
      }
      await assertCanManageTeam(req, req.body.teamId);
      const input = {
        teamId: req.body.teamId,
        userId: req.body.userId,
        fullName: req.body.fullName,
        birthDate: req.body.birthDate,
        studentId: req.body.studentId,
        contactEmail: req.body.contactEmail,
        evidenceUrl: req.body.evidenceUrl,
        jerseyNumber: req.body.jerseyNumber,
        position: req.body.position,
        isCaptain: req.body.isCaptain,
      };

      const player = await addPlayerToTeam(input);
      res.status(201).json({ player });
    } catch (err) {
      next(err);
    }
  },

  async updatePlayer(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const currentPlayer = await getPlayer(id);
      await assertCanManageTeam(req, currentPlayer.teamId);
      if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "leftAt")) {
        throw new AppError(409, "Active membership must be ended through an approved leave request", "LEAVE_REQUEST_REQUIRED");
      }
      const input = {
        fullName: req.body.fullName,
        birthDate: req.body.birthDate,
        studentId: req.body.studentId,
        contactEmail: req.body.contactEmail,
        evidenceUrl: req.body.evidenceUrl,
        jerseyNumber: req.body.jerseyNumber,
        position: req.body.position,
        isCaptain: req.body.isCaptain,
        leftAt: req.body.leftAt,
      };

      const player = await updatePlayerInfo(id, input);
      res.json({ player });
    } catch (err) {
      next(err);
    }
  },

  async deletePlayer(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const player = await getPlayer(id);
      await assertCanManageTeam(req, player.teamId);
      if (player.userId && !player.leftAt) {
        throw new AppError(409, "Active account membership must be ended through an approved leave request", "LEAVE_REQUEST_REQUIRED");
      }
      await removePlayerFromTeam(id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
};
