import type { NextFunction, Response } from "express";
import { AppError } from "../lib/errors";
import type { AuthenticatedRequest } from "../middleware/gatewayUser";
import { requireUserId } from "../lib/teamAuthorization";
import { getClubRequests, reviewClubRequest, submitClubRequest } from "../services/clubRequestService";
import { sendMembershipNotification } from "../services/membershipNotificationService";

function isAdmin(req: AuthenticatedRequest): boolean {
  return req.userRoles?.includes("ADMIN") ?? false;
}

export const clubRequestController = {
  async listMine(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { requests, total } = await getClubRequests({ applicantId: requireUserId(req), limit: 100 });
      res.json({ requests, pagination: { limit: 100, offset: 0, total } });
    } catch (error) {
      next(error);
    }
  },

  async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.userInstitutionId || !req.userFullName) {
        throw new AppError(403, "An approved school assignment is required to request a club", "SCHOOL_ASSIGNMENT_REQUIRED");
      }
      const contactEmail = typeof req.body?.contactEmail === "string" ? req.body.contactEmail : req.userEmail ?? "";
      const request = await submitClubRequest({
        applicantId: requireUserId(req),
        institutionId: req.userInstitutionId,
        captainName: req.userFullName,
        name: typeof req.body?.name === "string" ? req.body.name : "",
        shortName: typeof req.body?.shortName === "string" ? req.body.shortName : undefined,
        description: typeof req.body?.description === "string" ? req.body.description : undefined,
        logoUrl: typeof req.body?.logoUrl === "string" ? req.body.logoUrl : undefined,
        unitName: typeof req.body?.unitName === "string" ? req.body.unitName : undefined,
        contactEmail,
        contactPhone: typeof req.body?.contactPhone === "string" ? req.body.contactPhone : "",
        initialMembers: req.body?.initialMembers,
      });
      res.status(201).json({ request });
    } catch (error) {
      next(error);
    }
  },

  async listForReview(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const statusRaw = typeof req.query.status === "string" ? req.query.status : "PENDING";
      if (!["ALL", "PENDING", "APPROVED", "REJECTED"].includes(statusRaw)) {
        throw new AppError(400, "Invalid club request status", "VALIDATION_ERROR");
      }
      const status = statusRaw === "ALL" ? undefined : statusRaw as "PENDING" | "APPROVED" | "REJECTED";
      const admin = isAdmin(req);
      if (!admin && !req.userInstitutionId) {
        throw new AppError(403, "BTC must have an active school assignment", "SCHOOL_ASSIGNMENT_REQUIRED");
      }
      const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
      if (search.length > 100) {
        throw new AppError(400, "Search text is too long", "VALIDATION_ERROR");
      }
      const createdFrom = typeof req.query.createdFrom === "string" ? req.query.createdFrom : undefined;
      const createdTo = typeof req.query.createdTo === "string" ? req.query.createdTo : undefined;
      const datePattern = /^\d{4}-\d{2}-\d{2}$/;
      for (const [field, value] of [["createdFrom", createdFrom], ["createdTo", createdTo]] as const) {
        if (value && (!datePattern.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)))) {
          throw new AppError(400, `${field} must be a valid YYYY-MM-DD date`, "VALIDATION_ERROR");
        }
      }
      if (createdFrom && createdTo && createdFrom > createdTo) {
        throw new AppError(400, "createdFrom must not be later than createdTo", "VALIDATION_ERROR");
      }
      const limit = Number(req.query.limit ?? 20);
      const offset = Number(req.query.offset ?? 0);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100 ||
          !Number.isInteger(offset) || offset < 0) {
        throw new AppError(400, "Invalid pagination values", "VALIDATION_ERROR");
      }
      const result = await getClubRequests({
        institutionId: admin ? undefined : req.userInstitutionId,
        status,
        search: search || undefined,
        createdFrom,
        createdTo,
        limit,
        offset,
      });
      res.json({
        requests: result.requests,
        pagination: { limit, offset, total: result.total },
      });
    } catch (error) {
      next(error);
    }
  },

  async review(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const decision = req.body?.decision;
      if (decision !== "APPROVED" && decision !== "REJECTED") {
        throw new AppError(400, "Decision must be APPROVED or REJECTED", "VALIDATION_ERROR");
      }
      const request = await reviewClubRequest({
        requestId: req.params.id,
        reviewerId: requireUserId(req),
        reviewerInstitutionId: req.userInstitutionId,
        isAdmin: false,
        decision,
        decisionNote: typeof req.body?.decisionNote === "string" ? req.body.decisionNote : undefined,
      });
      await sendMembershipNotification({
        userId: request.applicantId,
        title: decision === "APPROVED" ? "Yêu cầu thành lập CLB đã được duyệt" : "Yêu cầu thành lập CLB bị từ chối",
        body: decision === "APPROVED"
          ? `BTC đã duyệt hồ sơ ${request.name} và tạo đội bóng.`
          : `BTC đã từ chối hồ sơ ${request.name}. Lý do: ${request.decisionNote}`,
        data: {
          requestId: request.id,
          status: request.status,
          teamId: request.approvedTeamId,
        },
      });
      res.json({ request });
    } catch (error) {
      next(error);
    }
  },
};
