import { Request, Response, NextFunction } from "express";
import { AppError } from "../lib/errors";
import type { AuthenticatedRequest } from "../middleware/gatewayUser";
import {
  assertCanManageTeam,
  assertCanManageTournament,
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
  getPlayerRequests,
  getPlayerRequestsForUser,
  submitPlayerRequest,
  editOwnPlayerRequest,
  respondPlayerRequest,
  withdrawPlayerRequest as withdrawPlayerRequestService,
  getPlayerRequest,
} from "../services/institutionService";
import {
  getTeam,
  getTeamRegistration,
} from "../services/teamService";
import { sendMembershipNotification } from "../services/membershipNotificationService";

export const institutionController = {
  async listInternalInstitutions(_req: Request, res: Response, next: NextFunction) {
    try {
      const institutions = await getInstitutions({ isActive: true, status: "ACTIVE", city: "TP. Hồ Chí Minh" });
      res.json({ institutions });
    } catch (err) { next(err); }
  },

  async listInternalInstitutionCatalog(_req: Request, res: Response, next: NextFunction) {
    try {
      const institutions = await getInstitutions({ city: "TP. Hồ Chí Minh" });
      res.json({ institutions });
    } catch (err) { next(err); }
  },

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

  async editMyPlayerRequest(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const teamId = typeof req.body.teamId === "string" ? req.body.teamId : "";
      const team = teamId ? await getTeam(teamId) : null;
      if (!team) throw new AppError(404, "Team not found", "TEAM_NOT_FOUND");
      if (!req.userInstitutionId || team.institutionId !== req.userInstitutionId) {
        throw new AppError(403, "Players can only request to join a club from their institution", "INSTITUTION_MISMATCH");
      }
      const profileFields = ["gender", "faculty", "major", "academicYear", "playingPosition", "dominantFoot", "heightCm", "weightKg", "phone"] as const;
      const submitted = req.body.profileData && typeof req.body.profileData === "object" && !Array.isArray(req.body.profileData) ? req.body.profileData as Record<string, unknown> : {};
      const profileData: Record<string, string | null> = {};
      for (const field of profileFields) {
        if (typeof submitted[field] === "string") profileData[field] = (submitted[field] as string).trim().slice(0, 200) || null;
      }
      const fullName = typeof req.body.fullName === "string" ? req.body.fullName.trim() : "";
      const request = await editOwnPlayerRequest(req.params.id, requireUserId(req), {
        teamId, fullName,
        birthDate: typeof req.body.birthDate === "string" ? req.body.birthDate : undefined,
        studentId: typeof req.body.studentId === "string" ? req.body.studentId.trim() : undefined,
        contactEmail: req.userEmail,
        profileData,
        message: typeof req.body.message === "string" ? req.body.message.trim() : undefined,
      });
      await sendMembershipNotification({
        userId: team.captainId,
        title: "Yêu cầu gia nhập đội được gửi lại",
        body: `${fullName} đã cập nhật hồ sơ và gửi lại yêu cầu gia nhập ${team.name}.`,
        data: { teamId: team.id, requestId: request.id },
      });
      res.json({ request });
    } catch (err) { next(err); }
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
