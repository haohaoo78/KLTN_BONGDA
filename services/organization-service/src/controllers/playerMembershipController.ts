import type { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "../middleware/gatewayUser";
import { AppError } from "../lib/errors";
import {
  assertCanManageTeam,
  requireUserId,
} from "../lib/teamAuthorization";
import {
  getMyPlayerLeaveRequests,
  getTeamPlayerLeaveRequests,
  reviewPlayerLeaveRequest,
  requestPlayerLeave,
  withdrawMyPlayerLeaveRequest,
} from "../services/playerMembershipService";
import { findPlayerLeaveRequest } from "../repositories/membershipRequestRepository";

export const playerMembershipController = {
  async listMine(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      res.json({ requests: await getMyPlayerLeaveRequests(requireUserId(req)) });
    } catch (error) {
      next(error);
    }
  },

  async createLeaveRequest(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
      if (!reason || reason.length > 2000) {
        throw new AppError(400, "A reason of 1–2000 characters is required", "VALIDATION_ERROR");
      }
      const request = await requestPlayerLeave(requireUserId(req), reason);
      res.status(201).json({ request });
    } catch (error) {
      next(error);
    }
  },

  async withdrawLeaveRequest(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const request = await withdrawMyPlayerLeaveRequest(req.params.id, requireUserId(req));
      res.json({ request });
    } catch (error) {
      next(error);
    }
  },

  async listTeamLeaveRequests(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const overdueOnly = req.query.overdue === "true";
      await assertCanManageTeam(req, req.params.teamId);
      const requests = await getTeamPlayerLeaveRequests(req.params.teamId, overdueOnly);
      res.json({ requests });
    } catch (error) {
      next(error);
    }
  },

  async reviewLeaveRequest(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const existing = await findPlayerLeaveRequest(req.params.id);
      if (!existing) {
        throw new AppError(404, "Leave request not found", "REQUEST_NOT_FOUND");
      }
      await assertCanManageTeam(req, existing.teamId);
      if (!(req.userRoles ?? []).includes("TEAM_CAPTAIN")) {
        throw new AppError(403, "You cannot review this request", "FORBIDDEN");
      }
      const decision = req.body?.decision;
      const decisionReason =
        typeof req.body?.decisionReason === "string" ? req.body.decisionReason.trim() : "";
      if (decision !== "APPROVED" && decision !== "REJECTED") {
        throw new AppError(400, "Decision must be APPROVED or REJECTED", "VALIDATION_ERROR");
      }
      if (decision === "REJECTED" && !decisionReason) {
        throw new AppError(400, "A reason is required when rejecting a request", "VALIDATION_ERROR");
      }
      if (decisionReason.length > 2000) {
        throw new AppError(400, "Decision reason must be at most 2000 characters", "VALIDATION_ERROR");
      }
      const request = await reviewPlayerLeaveRequest({
        requestId: req.params.id,
        reviewerId: requireUserId(req),
        decision,
        decisionReason: decisionReason || null,
      });
      res.json({ request });
    } catch (error) {
      next(error);
    }
  },
};
