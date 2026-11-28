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
  getTeamRegistrationHistory,
  getTeamRegistrations,
  getTeamRegistrationsByTeam,
  registerTeamForTournament,
  updateTeamRegistrationStatus,
  resubmitTeamRegistrationForCaptain,
  withdrawPendingTeamRegistrationForCaptain,
  requestApprovedTeamWithdrawal,
  cancelApprovedTeamWithdrawalRequest,
  getTournamentWithdrawalRequests,
  getRegistrationWithdrawalRequests,
  decideApprovedTeamWithdrawal,
  openApprovedRegistrationReview,
  getApprovedRegistrationReviews,
  getApprovedRegistrationReviewContext,
  respondToApprovedRegistrationReview,
  decideApprovedRegistrationReview,
  getPendingApprovalReviewCount,
  getPlayers,
  getActiveTeamPlayerIds,
  listTournamentDrawCandidates,
  addPlayerToTeam,
  updatePlayerInfo,
  removePlayerFromTeam,
  getPlayer,
  listTournamentRegistrationCounts as getTournamentRegistrationCounts,
  reconcileExistingApprovedPlayerClaims,
  finalizeUnselectedWaitlistRegistrations,
} from "../services/teamService";
import { getUnavailableTournamentPlayerIds, getTournamentRegistrationReviewState } from "../lib/teamAuthorization";
import { requestRegistrationChange, getTournamentRegistrationChangeRequests, decideRegistrationChange } from "../services/registrationChangeRequestService";
import { getChangeRequestRegistration, listRegistrationChangeRequestsForRegistration } from "../repositories/teamRegistrationChangeRequestRepository";

export const teamController = {
  async internalPlayerOwnership(req: Request, res: Response, next: NextFunction) {
    try {
      const player = await getPlayer(req.params.playerId);
      res.json({ playerId: player.id, userId: player.userId ?? null });
    } catch (err) { next(err); }
  },
  async finalizeUnselectedRegistrations(req: Request, res: Response, next: NextFunction) {
    try {
      const tournamentId = req.params.tournamentId;
      const state = await getTournamentRegistrationReviewState(tournamentId);
      if (!["ROSTER_LOCKED", "PREPARING", "IN_PROGRESS", "PAUSED", "COMPLETED"].includes(state.status)) {
        throw new AppError(409, "Chỉ được kết thúc hồ sơ chưa chọn sau khi danh sách giải đã chốt", "ROSTER_NOT_LOCKED");
      }
      const finalized = await finalizeUnselectedWaitlistRegistrations(500, tournamentId);
      res.json({ finalized });
    } catch (err) { next(err); }
  },
  async listTeamRegistrationChangeRequests(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const registration = await getTeamRegistrationByRegistrationId(req.params.id);
      if (req.userRoles?.includes("TEAM_CAPTAIN")) await assertCanManageTeam(req,registration.teamId);
      else if (isTournamentStaff(req)) await assertCanManageTournament(req,registration.tournamentId);
      else throw new AppError(403,"Only the captain or assigned BTC can view roster change history","FORBIDDEN");
      res.json({changeRequests:await listRegistrationChangeRequestsForRegistration(registration.id)});
    } catch(err) { next(err); }
  },
  async requestRegistrationChange(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.userRoles?.includes("TEAM_CAPTAIN")) throw new AppError(403,"Only team captains can request roster changes","FORBIDDEN");
      const registration = await getTeamRegistrationByRegistrationId(req.params.id);
      await assertCanManageTeam(req, registration.teamId);
      const kind = req.body?.requestKind;
      if (kind !== "APPROVED_AMENDMENT" && kind !== "LOCKED_PLAYER_ADDITION") throw new AppError(400,"Invalid requestKind","VALIDATION_ERROR");
      if (!Array.isArray(req.body?.playerIds) || req.body.playerIds.some((id: unknown) => typeof id !== "string")) throw new AppError(400,"playerIds must be an array","VALIDATION_ERROR");
      const changeRequest = await requestRegistrationChange({ registrationId:registration.id, requestedBy:requireUserId(req), kind, reason:typeof req.body?.reason === "string" ? req.body.reason : "", playerIds:req.body.playerIds });
      res.status(201).json({ changeRequest });
    } catch (err) { next(err); }
  },
  async listRegistrationChangeRequests(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!isTournamentStaff(req)) throw new AppError(403,"Only tournament staff can view roster change requests","FORBIDDEN");
      await assertCanManageTournament(req,req.params.tournamentId);
      res.json({ changeRequests: await getTournamentRegistrationChangeRequests(req.params.tournamentId) });
    } catch (err) { next(err); }
  },
  async decideRegistrationChangeRequest(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!isTournamentStaff(req)) throw new AppError(403,"Only tournament staff can decide roster change requests","FORBIDDEN");
      const request = await getChangeRequestRegistration(req.params.id);
      if (!request) throw new AppError(404,"Roster change request not found","CHANGE_REQUEST_NOT_FOUND");
      await assertCanManageTournament(req,String(request.tournament_id));
      const decision=req.body?.decision;
      if (decision !== "APPROVED" && decision !== "REJECTED") throw new AppError(400,"decision must be APPROVED or REJECTED","VALIDATION_ERROR");
      const note=typeof req.body?.note === "string" ? req.body.note.trim() : "";
      if (!note) throw new AppError(400,"BTC must include a decision note","DECISION_NOTE_REQUIRED");
      res.json({ changeRequest: await decideRegistrationChange({id:req.params.id,actorId:requireUserId(req),decision,note}) });
    } catch (err) { next(err); }
  },
  async verifyActiveTeamPlayers(req: Request, res: Response, next: NextFunction) {
    try {
      const playerIds = req.body?.playerIds;
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!Array.isArray(playerIds) || playerIds.length > 40 || playerIds.some((id: unknown) => typeof id !== "string" || !uuidPattern.test(id))) {
        throw new AppError(400, "playerIds must be an array of at most 40 player IDs", "VALIDATION_ERROR");
      }
      const validPlayerIds = await getActiveTeamPlayerIds(req.params.teamId, [...new Set(playerIds as string[])]);
      res.json({ validPlayerIds });
    } catch (err) { next(err); }
  },

  async listTournamentEligibleTeamPlayers(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      await assertCanManageTeam(req, req.params.teamId);
      await reconcileExistingApprovedPlayerClaims();
      const playerIds = (await getPlayers(req.params.teamId))
        .filter((player) => player.userId && player.fullName?.trim() && player.studentId?.trim())
        .map((player) => player.id);
      const unavailablePlayerIds = await getUnavailableTournamentPlayerIds(req.params.tournamentId, req.params.teamId, playerIds);
      res.json({ eligiblePlayerIds: playerIds.filter((id) => !unavailablePlayerIds.includes(id)), unavailablePlayerIds });
    } catch (err) { next(err); }
  },

  async getCaptainNotificationRecipient(req: Request, res: Response, next: NextFunction) {
    try {
      const team = await getTeam(req.params.teamId);
      res.json({ userId: team.captainId ?? null });
    } catch (err) { next(err); }
  },

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

  async getInternalRegistrationReadiness(req: Request, res: Response, next: NextFunction) {
    try {
      const candidates = await listTournamentDrawCandidates(req.params.tournamentId);
      const approvedRegistrationIds = new Set(candidates.filter((item) => item.registrationStatus === "APPROVED").map((item) => item.registrationId));
      const withdrawalRequests = await getTournamentWithdrawalRequests(req.params.tournamentId);
      res.json({
        candidates,
        pendingWithdrawalCount: withdrawalRequests.filter((item) => approvedRegistrationIds.has(item.registrationId) && (item.status === "PENDING" || item.status === "PROCESSING")).length,
        pendingApprovalReviewCount: await getPendingApprovalReviewCount(req.params.tournamentId),
      });
    } catch (err) { next(err); }
  },

  async getTournamentRegistrationReviewSummary(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!isTournamentStaff(req)) throw new AppError(403, "Only assigned BTC can view this review summary", "FORBIDDEN");
      await assertCanManageTournament(req, req.params.tournamentId);
      res.json({ pendingApprovalReviewCount: await getPendingApprovalReviewCount(req.params.tournamentId) });
    } catch (err) { next(err); }
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

  async listTeamRegistrationHistory(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const registration = await getTeamRegistrationByRegistrationId(req.params.id);
      if (req.userRoles?.includes("BTC")) await assertCanManageTournament(req, registration.tournamentId);
      else if (req.userRoles?.includes("TEAM_CAPTAIN")) await assertCanManageTeam(req, registration.teamId);
      else throw new AppError(403, "Only the team captain or assigned BTC can view this application history", "FORBIDDEN");
      res.json({ versions: await getTeamRegistrationHistory(req.params.id) });
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
      if (status && !["PENDING", "APPROVED", "REJECTED", "APPROVAL_REVOKED", "REVISION_REQUIRED", "NEEDS_SUPPLEMENT", "WITHDRAWN", "WAITLIST", "CONFLICT_ADJUSTMENT_REQUIRED"].includes(status)) {
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
        if (["PENDING", "NEEDS_SUPPLEMENT", "REVISION_REQUIRED", "APPROVED"].includes(registration.status)) {
          row.total += 1;
          if (["PENDING", "NEEDS_SUPPLEMENT", "REVISION_REQUIRED"].includes(registration.status)) row.pending += 1;
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
        actorId: requireUserId(req),
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
        supplementDeadline: typeof req.body.supplementDeadline === "string" ? req.body.supplementDeadline : undefined,
        resubmissionAllowed: req.body.status === "REJECTED" ? req.body.resubmissionAllowed === true : undefined,
      };
      if (["REJECTED", "REVISION_REQUIRED", "NEEDS_SUPPLEMENT"].includes(input.status) && (typeof input.notes !== "string" || !input.notes.trim())) {
        throw new AppError(400, "Cần nhập lý do từ chối hoặc nội dung yêu cầu bổ sung", "DECISION_NOTE_REQUIRED");
      }
      if (["REVISION_REQUIRED", "NEEDS_SUPPLEMENT"].includes(input.status) && !input.supplementDeadline) {
        throw new AppError(400, "Cần nhập thời hạn bổ sung hồ sơ", "SUPPLEMENT_DEADLINE_REQUIRED");
      }
      const approvedBy = req.userId;

      const registration = await updateTeamRegistrationStatus(id, input, approvedBy);
      res.json({ registration });
    } catch (err) {
      next(err);
    }
  },

  async resubmitTeamRegistration(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.userRoles?.includes("TEAM_CAPTAIN")) throw new AppError(403, "Only a team captain can resubmit a team application", "FORBIDDEN");
      const registration = await resubmitTeamRegistrationForCaptain(req.params.id, requireUserId(req));
      res.json({ registration });
    } catch (err) { next(err); }
  },

  async withdrawTeamRegistration(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.userRoles?.includes("TEAM_CAPTAIN")) throw new AppError(403, "Only a team captain can withdraw a team application", "FORBIDDEN");
      const reason = typeof req.body?.reason === "string" ? req.body.reason : "";
      const registration = await withdrawPendingTeamRegistrationForCaptain(req.params.id, requireUserId(req), reason);
      res.json({ registration });
    } catch (err) { next(err); }
  },

  async requestApprovedTeamWithdrawal(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.userRoles?.includes("TEAM_CAPTAIN")) throw new AppError(403, "Only a team captain can request a team withdrawal", "FORBIDDEN");
      const reason = typeof req.body?.reason === "string" ? req.body.reason : "";
      const withdrawalRequest = await requestApprovedTeamWithdrawal(req.params.id, requireUserId(req), reason);
      res.status(201).json({ withdrawalRequest });
    } catch (err) { next(err); }
  },

  async cancelTeamWithdrawalRequest(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.userRoles?.includes("TEAM_CAPTAIN")) throw new AppError(403, "Only a team captain can cancel a withdrawal request", "FORBIDDEN");
      const withdrawalRequest = await cancelApprovedTeamWithdrawalRequest(req.params.requestId, requireUserId(req));
      res.json({ withdrawalRequest });
    } catch (err) { next(err); }
  },

  async listTeamWithdrawalRequests(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!isTournamentStaff(req)) throw new AppError(403, "Only assigned tournament staff can list withdrawal requests", "FORBIDDEN");
      await assertCanManageTournament(req, req.params.tournamentId);
      res.json({ withdrawalRequests: await getTournamentWithdrawalRequests(req.params.tournamentId) });
    } catch (err) { next(err); }
  },

  async listRegistrationWithdrawalRequests(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const registration = await getTeamRegistrationByRegistrationId(req.params.id);
      if (req.userRoles?.includes("TEAM_CAPTAIN")) await assertCanManageTeam(req, registration.teamId);
      else if (isTournamentStaff(req)) await assertCanManageTournament(req, registration.tournamentId);
      else throw new AppError(403, "Only the team captain or assigned BTC can view withdrawal requests", "FORBIDDEN");
      res.json({ withdrawalRequests: await getRegistrationWithdrawalRequests(req.params.id) });
    } catch (err) { next(err); }
  },

  async listRegistrationApprovalReviews(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const registration = await getTeamRegistrationByRegistrationId(req.params.id);
      if (req.userRoles?.includes("TEAM_CAPTAIN")) await assertCanManageTeam(req, registration.teamId);
      else if (isTournamentStaff(req)) await assertCanManageTournament(req, registration.tournamentId);
      else throw new AppError(403, "Only the team captain or assigned BTC can view approval reviews", "FORBIDDEN");
      res.json({ reviews: await getApprovedRegistrationReviews(req.params.id) });
    } catch (err) { next(err); }
  },

  async openRegistrationApprovalReview(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!isTournamentStaff(req)) throw new AppError(403, "Only assigned BTC can review an approved registration", "FORBIDDEN");
      const registration = await getTeamRegistrationByRegistrationId(req.params.id);
      await assertCanManageTournament(req, registration.tournamentId);
      const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
      const responseDeadline = typeof req.body?.responseDeadline === "string" ? req.body.responseDeadline : "";
      const review = await openApprovedRegistrationReview({ registrationId: registration.id, requestedBy: requireUserId(req), reason, responseDeadline });
      res.status(201).json({ review });
    } catch (err) { next(err); }
  },

  async respondToRegistrationApprovalReview(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.userRoles?.includes("TEAM_CAPTAIN")) throw new AppError(403, "Only the team captain can respond to an approval review", "FORBIDDEN");
      const response = typeof req.body?.response === "string" ? req.body.response : "";
      const review = await respondToApprovedRegistrationReview({ reviewId: req.params.reviewId, captainId: requireUserId(req), response });
      res.json({ review });
    } catch (err) { next(err); }
  },

  async decideRegistrationApprovalReview(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!isTournamentStaff(req)) throw new AppError(403, "Only assigned BTC can decide an approval review", "FORBIDDEN");
      const context = await getApprovedRegistrationReviewContext(req.params.reviewId);
      if (!context) throw new AppError(404, "Approval review not found", "APPROVAL_REVIEW_NOT_FOUND");
      await assertCanManageTournament(req, context.tournamentId);
      const decision = req.body?.decision;
      if (decision !== "RETAIN_APPROVAL" && decision !== "REVOKE_APPROVAL" && decision !== "REQUEST_SUPPLEMENT") throw new AppError(400, "decision must be RETAIN_APPROVAL, REVOKE_APPROVAL, or REQUEST_SUPPLEMENT", "VALIDATION_ERROR");
      const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
      const supplementDeadline = typeof req.body?.supplementDeadline === "string" ? req.body.supplementDeadline : undefined;
      const result = await decideApprovedRegistrationReview({ reviewId: context.id, decision, decidedBy: requireUserId(req), note, supplementDeadline });
      res.json(result);
    } catch (err) { next(err); }
  },

  async decideTeamWithdrawalRequest(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!isTournamentStaff(req)) throw new AppError(403, "Only assigned tournament staff can decide withdrawal requests", "FORBIDDEN");
      const { getWithdrawalRequestById } = await import("../repositories/teamWithdrawalRepository");
      const request = await getWithdrawalRequestById(req.params.requestId);
      if (!request) throw new AppError(404, "Withdrawal request not found", "WITHDRAWAL_REQUEST_NOT_FOUND");
      await assertCanManageTournament(req, request.tournamentId);
      const decision = req.body?.decision;
      if (decision !== "APPROVED" && decision !== "REJECTED") throw new AppError(400, "decision must be APPROVED or REJECTED", "VALIDATION_ERROR");
      const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 2000) : "";
      const withdrawalRequest = await decideApprovedTeamWithdrawal(request.id, decision, requireUserId(req), note);
      res.json({ withdrawalRequest });
    } catch (err) { next(err); }
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
