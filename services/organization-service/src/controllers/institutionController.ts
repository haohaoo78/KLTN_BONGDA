import { Request, Response, NextFunction } from "express";
import { AppError } from "../lib/errors";
import type { AuthenticatedRequest } from "../middleware/gatewayUser";
import {
  assertCanManageTeam,
  assertCanManageTournament,
  assertTournamentRosterEditable,
  requireUserId,
} from "../lib/teamAuthorization";
import {
  getInstitutions,
  getInstitutionsWithAssignedBtc,
  getInstitution,
  createNewInstitution,
  updateInstitution,
  updateInstitutionStatus,
  listInstitutionHistory,
  hasAssignedBtc,
  getRosters,
  addRoster,
  getRoster,
  reviewTournamentRoster,
  updateTournamentRosterEvidence,
  removeTournamentRoster,
  getPlayerRequests,
  getPlayerRequestsForUser,
  submitPlayerRequest,
  respondPlayerRequest,
  withdrawPlayerRequest as withdrawPlayerRequestService,
  getPlayerRequest,
} from "../services/institutionService";
import {
  getPlayer,
  getTeam,
  getTeamRegistration,
} from "../services/teamService";
import { sendMembershipNotification } from "../services/membershipNotificationService";

export const institutionController = {
  async listInstitutions(req: Request, res: Response, next: NextFunction) {
    try {
      const institutionType = typeof req.query.institutionType === "string" ? req.query.institutionType : undefined;
      if (institutionType && !["UNIVERSITY", "COLLEGE", "OTHER"].includes(institutionType)) {
        throw new AppError(400, "Invalid institution type", "VALIDATION_ERROR");
      }
      const search = typeof req.query.search === "string" ? req.query.search.trim() : undefined;
      if (search && search.length > 100) {
        throw new AppError(400, "Search text is too long", "VALIDATION_ERROR");
      }
      const institutions = await getInstitutions({
        isActive: true,
        institutionType: institutionType as "UNIVERSITY" | "COLLEGE" | "OTHER" | undefined,
        status: "ACTIVE",
        search: search || undefined,
        city: "TP. Hồ Chí Minh",
      });
      res.json({ institutions: await getInstitutionsWithAssignedBtc(institutions) });
    } catch (err) {
      next(err);
    }
  },

  async listManagedInstitutions(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      if (status && !["DRAFT", "ACTIVE", "SUSPENDED"].includes(status)) {
        throw new AppError(400, "Invalid institution status", "VALIDATION_ERROR");
      }
      const institutionType = typeof req.query.institutionType === "string" ? req.query.institutionType : undefined;
      if (institutionType && !["UNIVERSITY", "COLLEGE", "OTHER"].includes(institutionType)) {
        throw new AppError(400, "Invalid institution type", "VALIDATION_ERROR");
      }
      const search = typeof req.query.search === "string" ? req.query.search.trim() : undefined;
      if (search && search.length > 100) {
        throw new AppError(400, "Search text is too long", "VALIDATION_ERROR");
      }
      const institutions = await getInstitutions({
        status: status as "DRAFT" | "ACTIVE" | "SUSPENDED" | undefined,
        institutionType: institutionType as "UNIVERSITY" | "COLLEGE" | "OTHER" | undefined,
        search: search || undefined,
        city: "TP. Hồ Chí Minh",
      });
      res.json({ institutions });
    } catch (err) {
      next(err);
    }
  },

  async createInstitution(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const input = {
        name: req.body.name,
        code: req.body.code,
        shortName: req.body.shortName,
        admissionCode: req.body.admissionCode,
        institutionType: req.body.institutionType,
        address: req.body.address,
        officialWebsite: req.body.officialWebsite,
        city: req.body.city,
        dataSourceUrl: req.body.dataSourceUrl,
        dataCollectedAt: req.body.dataCollectedAt,
        contactEmail: req.body.contactEmail,
        contactPhone: req.body.contactPhone,
      };
      const institution = await createNewInstitution(input, requireUserId(req));
      res.status(201).json({ institution });
    } catch (err) {
      next(err);
    }
  },

  async editInstitution(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const institution = await updateInstitution(req.params.id, {
        name: req.body?.name,
        code: req.body?.code,
        shortName: req.body?.shortName,
        admissionCode: req.body?.admissionCode,
        institutionType: req.body?.institutionType,
        address: req.body?.address,
        officialWebsite: req.body?.officialWebsite,
        city: req.body?.city,
        contactEmail: req.body?.contactEmail,
        contactPhone: req.body?.contactPhone,
      }, requireUserId(req));
      res.json({ institution });
    } catch (err) {
      next(err);
    }
  },

  async setInstitutionStatus(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const status = req.body?.status;
      if (!["DRAFT", "ACTIVE", "SUSPENDED"].includes(status)) {
        throw new AppError(400, "Invalid institution status", "VALIDATION_ERROR");
      }
      const institution = await updateInstitutionStatus(
        req.params.id,
        status,
        requireUserId(req),
      );
      res.json({ institution });
    } catch (err) {
      next(err);
    }
  },

  async listInstitutionHistory(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      res.json({ history: await listInstitutionHistory(req.params.id) });
    } catch (err) {
      next(err);
    }
  },

  async verifyInstitution(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const institution = await getInstitution(req.params.id);
      if (
        !institution ||
        institution.status !== "ACTIVE" ||
        !institution.isActive ||
        !(await hasAssignedBtc(institution.id))
      ) {
        throw new AppError(404, "Active institution not found", "INSTITUTION_NOT_FOUND");
      }
      res.json({
        institution: {
          id: institution.id,
          institutionType: institution.institutionType,
          status: institution.status,
          isActive: institution.isActive,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  async verifyInstitutionAssignment(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const institution = await getInstitution(req.params.id);
      if (!institution || !["UNIVERSITY", "COLLEGE"].includes(institution.institutionType)) {
        throw new AppError(404, "Institution not found", "INSTITUTION_NOT_FOUND");
      }
      res.json({ institution: { id: institution.id, institutionType: institution.institutionType } });
    } catch (err) {
      next(err);
    }
  },

  async getParticipationInstitution(req: Request, res: Response, next: NextFunction) {
    try {
      const institution = await getInstitution(req.params.id);
      if (
        !institution ||
        institution.status !== "ACTIVE" ||
        !institution.isActive ||
        !["UNIVERSITY", "COLLEGE"].includes(institution.institutionType)
      ) {
        throw new AppError(404, "Active university or college not found", "INSTITUTION_NOT_FOUND");
      }
      res.json({
        institution: {
          id: institution.id,
          institutionType: institution.institutionType,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  async listRosters(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { tournamentId } = req.params;
      const teamId = req.query.teamId as string | undefined;
      if (req.userRoles?.includes("BTC")) {
        await assertCanManageTournament(req, tournamentId);
      } else if (req.userRoles?.includes("TEAM_CAPTAIN") && teamId) {
        await assertCanManageTeam(req, teamId);
        await getTeamRegistration(teamId, tournamentId);
      } else {
        throw new AppError(403, "Only the assigned team captain or tournament BTC can view this roster", "FORBIDDEN");
      }
      const rosters = await getRosters(tournamentId, teamId);
      res.json({ rosters });
    } catch (err) {
      next(err);
    }
  },

  async createRoster(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (
        typeof req.body.teamId !== "string" ||
        typeof req.body.playerId !== "string" ||
        typeof req.body.tournamentId !== "string"
      ) {
        throw new AppError(400, "teamId, playerId and tournamentId are required", "VALIDATION_ERROR");
      }
      if (!req.userRoles?.includes("TEAM_CAPTAIN")) {
        throw new AppError(403, "Only a team representative can manage its tournament roster", "FORBIDDEN");
      }
      await assertCanManageTeam(req, req.body.teamId);
      await assertTournamentRosterEditable(req.body.tournamentId);
      const registration = await getTeamRegistration(req.body.teamId, req.body.tournamentId);
      if (!["PENDING", "APPROVED"].includes(registration.status)) {
        throw new AppError(409, "Only a current tournament registration can submit a roster", "REGISTRATION_NOT_ACTIVE");
      }
      const player = await getPlayer(req.body.playerId);
      if (player.teamId !== req.body.teamId) {
        throw new AppError(400, "Player does not belong to this team", "INVALID_PLAYER_TEAM");
      }
      const input = {
        teamId: req.body.teamId,
        tournamentId: req.body.tournamentId,
        playerId: req.body.playerId,
        evidenceUrl: req.body.evidenceUrl,
      };
      const roster = await addRoster(input);
      res.status(201).json({ roster });
    } catch (err) {
      next(err);
    }
  },

  async reviewRoster(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.userRoles?.includes("BTC")) {
        throw new AppError(403, "Only tournament BTC can review a roster", "FORBIDDEN");
      }
      const { tournamentId, rosterId } = req.params;
      await assertCanManageTournament(req, tournamentId);
      await assertTournamentRosterEditable(tournamentId);
      const status = req.body?.status;
      const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 2000) : "";
      if (!["APPROVED", "REVISION_REQUIRED", "REJECTED"].includes(status)) {
        throw new AppError(400, "A valid roster review decision is required", "VALIDATION_ERROR");
      }
      if (status !== "APPROVED" && !note) {
        throw new AppError(400, "Explain why the roster needs correction or is rejected", "REVIEW_NOTE_REQUIRED");
      }
      const roster = await reviewTournamentRoster(
        tournamentId,
        rosterId,
        status as "APPROVED" | "REVISION_REQUIRED" | "REJECTED",
        note || null,
        requireUserId(req),
      );
      res.json({ roster });
    } catch (err) { next(err); }
  },

  async updateRosterEvidence(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { tournamentId, rosterId } = req.params;
      const roster = await getRoster(rosterId);
      await assertCanManageTeam(req, roster.teamId);
      await assertTournamentRosterEditable(tournamentId);
      if (roster.tournamentId !== tournamentId) {
        throw new AppError(404, "Tournament roster not found", "ROSTER_NOT_FOUND");
      }
      const rawEvidenceUrl = req.body?.evidenceUrl;
      const evidenceUrl = typeof rawEvidenceUrl === "string" && rawEvidenceUrl.trim()
        ? rawEvidenceUrl.trim()
        : null;
      if (evidenceUrl && (evidenceUrl.length > 500 || !/^https?:\/\//i.test(evidenceUrl))) {
        throw new AppError(400, "Evidence must be an HTTP or HTTPS link up to 500 characters", "INVALID_EVIDENCE_URL");
      }
      const updated = await updateTournamentRosterEvidence(tournamentId, rosterId, evidenceUrl);
      res.json({ roster: updated });
    } catch (err) { next(err); }
  },

  async deleteRoster(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { tournamentId, rosterId } = req.params;
      const roster = await getRoster(rosterId);
      await assertCanManageTeam(req, roster.teamId);
      await assertTournamentRosterEditable(tournamentId);
      if (roster.tournamentId !== tournamentId) {
        throw new AppError(404, "Tournament roster not found", "ROSTER_NOT_FOUND");
      }
      await removeTournamentRoster(tournamentId, rosterId);
      res.status(204).send();
    } catch (err) { next(err); }
  },

  async listPlayerRequests(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { teamId } = req.params;
      await assertCanManageTeam(req, teamId);
      const status = req.query.status as string | undefined;
      const requests = await getPlayerRequests(teamId, status);
      res.json({ requests });
    } catch (err) {
      next(err);
    }
  },

  async listMyPlayerRequests(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const requests = await getPlayerRequestsForUser(requireUserId(req));
      res.json({ requests });
    } catch (err) {
      next(err);
    }
  },

  async createPlayerRequest(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (typeof req.body.teamId !== "string") {
        throw new AppError(400, "teamId is required", "VALIDATION_ERROR");
      }
      const targetTeam = await getTeam(req.body.teamId);
      if (!targetTeam) throw new AppError(404, "Team not found", "TEAM_NOT_FOUND");
      if (!req.userInstitutionId || targetTeam.institutionId !== req.userInstitutionId) {
        throw new AppError(403, "Players can only request to join a club from their institution", "INSTITUTION_MISMATCH");
      }
      const fullName = typeof req.body.fullName === "string" ? req.body.fullName.trim() : "";
      if (!fullName) {
        throw new AppError(400, "fullName is required", "VALIDATION_ERROR");
      }
      const profileFields = [
        "gender", "faculty", "major", "academicYear", "playingPosition",
        "dominantFoot", "heightCm", "weightKg", "phone",
      ] as const;
      const submittedProfile = req.body.profileData && typeof req.body.profileData === "object" && !Array.isArray(req.body.profileData)
        ? req.body.profileData as Record<string, unknown>
        : {};
      const profileData: Record<string, string | null> = {};
      for (const field of profileFields) {
        const value = submittedProfile[field];
        if (typeof value === "string") profileData[field] = value.trim().slice(0, 200) || null;
      }
      const input = {
        teamId: req.body.teamId,
        userId: requireUserId(req),
        fullName,
        birthDate: typeof req.body.birthDate === "string" ? req.body.birthDate : undefined,
        studentId: typeof req.body.studentId === "string" ? req.body.studentId.trim() : undefined,
        contactEmail: req.userEmail,
        profileData,
        message: typeof req.body.message === "string" ? req.body.message.trim() : undefined,
      };
      const request = await submitPlayerRequest(input);
      const team = await getTeam(input.teamId);
      await sendMembershipNotification({
        userId: team.captainId,
        title: "Yêu cầu gia nhập đội mới",
        body: `${fullName} đã gửi yêu cầu gia nhập ${team.name}.`,
        data: { teamId: team.id, requestId: request.id },
      });
      res.status(201).json({ request });
    } catch (err) {
      next(err);
    }
  },

  async respondPlayerRequest(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { status } = req.body;
      const playerRequest = await getPlayerRequest(id);
      await assertCanManageTeam(req, playerRequest.teamId);
      if (status !== "APPROVED" && status !== "REJECTED") {
        throw new AppError(400, "Invalid player request status", "INVALID_STATUS");
      }
      const decisionReason =
        typeof req.body?.decisionReason === "string" ? req.body.decisionReason.trim() : "";
      if (status === "REJECTED" && !decisionReason) {
        throw new AppError(400, "A reason is required when rejecting a request", "VALIDATION_ERROR");
      }
      if (decisionReason.length > 2000) {
        throw new AppError(400, "Decision reason must be at most 2000 characters", "VALIDATION_ERROR");
      }
      const request = await respondPlayerRequest(
        id,
        status,
        requireUserId(req),
        decisionReason || null,
      );
      await sendMembershipNotification({
        userId: request.userId,
        title: status === "APPROVED" ? "Yêu cầu gia nhập đội đã được duyệt" : "Yêu cầu gia nhập đội bị từ chối",
        body: status === "APPROVED"
          ? "Đội trưởng đã duyệt yêu cầu gia nhập đội của bạn."
          : `Yêu cầu gia nhập đội bị từ chối: ${request.decisionReason ?? "Không có lý do."}`,
        data: { teamId: request.teamId, requestId: request.id, status },
      });
      res.json({ request });
    } catch (err) {
      next(err);
    }
  },

  async withdrawPlayerRequest(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const request = await withdrawPlayerRequestService(req.params.id, requireUserId(req));
      res.json({ request });
    } catch (error) {
      next(error);
    }
  },
};
