import { Request, Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../middleware/gatewayUser";
import { AppError } from "../lib/errors";
import { assertCanManageLineup, assertCanManageMatch } from "../scheduling/authorization";
import {
  getLineups,
  addLineup,
  confirmTeamLineup,
  removeLineup,
  getMatchEvents,
  getMatchEventById,
  addMatchEvent,
  removeMatchEvent,
  getMatchReport,
  getMatchReportById,
  submitMatchReport,
  reviewMatchReport,
} from "../services/lineupService";

export const lineupController = {
  // Lineups
  async listLineups(req: Request, res: Response, next: NextFunction) {
    try {
      const { matchId } = req.params;
      const teamId = req.query.teamId as string | undefined;
      const lineups = await getLineups(matchId, teamId);
      res.json({ lineups });
    } catch (err) {
      next(err);
    }
  },

  async createLineup(req: Request, res: Response, next: NextFunction) {
    try {
      if (typeof req.body.matchId !== "string" || typeof req.body.teamId !== "string") {
        throw new AppError(400, "matchId and teamId are required", "VALIDATION_ERROR");
      }
      await assertCanManageLineup(
        req as AuthenticatedRequest,
        req.body.matchId,
        req.body.teamId,
      );
      const input = {
        matchId: req.body.matchId,
        teamId: req.body.teamId,
        playerId: req.body.playerId,
        position: req.body.position,
        jerseyNumber: req.body.jerseyNumber,
        isStarting: req.body.isStarting,
      };
      const lineup = await addLineup(input);
      res.status(201).json({ lineup });
    } catch (err) {
      next(err);
    }
  },

  async confirmLineup(req: Request, res: Response, next: NextFunction) {
    try {
      const { matchId, teamId } = req.params;
      await assertCanManageLineup(req as AuthenticatedRequest, matchId, teamId);
      const confirmedBy = (req as any).userId;
      await confirmTeamLineup(matchId, teamId, confirmedBy);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },

  async deleteLineup(req: Request, res: Response, next: NextFunction) {
    try {
      const { matchId, teamId } = req.params;
      await assertCanManageLineup(req as AuthenticatedRequest, matchId, teamId);
      await removeLineup(matchId, teamId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },

  // Match Events
  async listMatchEvents(req: Request, res: Response, next: NextFunction) {
    try {
      const { matchId } = req.params;
      const teamId = req.query.teamId as string | undefined;
      const events = await getMatchEvents(matchId, teamId);
      res.json({ events });
    } catch (err) {
      next(err);
    }
  },

  async createMatchEvent(req: Request, res: Response, next: NextFunction) {
    try {
      await assertCanManageMatch(req as AuthenticatedRequest, req.body.matchId);
      const input = {
        matchId: req.body.matchId,
        teamId: req.body.teamId,
        playerId: req.body.playerId,
        eventType: req.body.eventType,
        minute: req.body.minute,
        description: req.body.description,
      };
      const createdBy = (req as any).userId;
      const event = await addMatchEvent(input, createdBy);
      res.status(201).json({ event });
    } catch (err) {
      next(err);
    }
  },

  async deleteMatchEvent(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const event = await getMatchEventById(id);
      await assertCanManageMatch(req as AuthenticatedRequest, event.matchId);
      await removeMatchEvent(id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },

  // Match Reports
  async getMatchReport(req: Request, res: Response, next: NextFunction) {
    try {
      const { matchId } = req.params;
      let report = null;
      try { report = await getMatchReport(matchId); }
      catch (err) {
        if (!(err instanceof AppError) || err.code !== "REPORT_NOT_FOUND") throw err;
      }
      if (report?.status !== "APPROVED") report = null;
      res.json({ report });
    } catch (err) {
      next(err);
    }
  },

  async getManagedMatchReport(req: Request, res: Response, next: NextFunction) {
    try {
      const { matchId } = req.params;
      await assertCanManageMatch(req as AuthenticatedRequest, matchId);
      let report = null;
      try { report = await getMatchReport(matchId); }
      catch (err) {
        if (!(err instanceof AppError) || err.code !== "REPORT_NOT_FOUND") throw err;
      }
      res.json({ report });
    } catch (err) {
      next(err);
    }
  },

  async createMatchReport(req: Request, res: Response, next: NextFunction) {
    try {
      const authenticatedReq = req as AuthenticatedRequest;
      const refereeId = typeof req.body.refereeId === "string"
        ? req.body.refereeId
        : authenticatedReq.userId;
      await assertCanManageMatch(authenticatedReq, req.body.matchId);
      if (
        authenticatedReq.userRoles?.includes("REFEREE") &&
        refereeId !== authenticatedReq.userId
      ) {
        throw new AppError(403, "A referee can submit reports only as themselves", "FORBIDDEN");
      }
      const input = {
        matchId: req.body.matchId,
        refereeId,
        homeCaptainId: req.body.homeCaptainId,
        awayCaptainId: req.body.awayCaptainId,
        homeScoreAtHalfTime: req.body.homeScoreAtHalfTime,
        awayScoreAtHalfTime: req.body.awayScoreAtHalfTime,
        attendance: req.body.attendance,
        weather: req.body.weather,
        notes: req.body.notes,
      };
      const submittedBy = (req as any).userId;
      const report = await submitMatchReport(input, submittedBy);
      res.status(201).json({ report });
    } catch (err) {
      next(err);
    }
  },

  async reviewMatchReport(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const status = req.body.status;
      if (!["APPROVED", "REJECTED", "REVISION_REQUIRED"].includes(status)) {
        throw new AppError(400, "status must be APPROVED, REJECTED, or REVISION_REQUIRED", "VALIDATION_ERROR");
      }
      const reviewNote = typeof req.body.reviewNote === "string" ? req.body.reviewNote.trim() : "";
      if ((status === "REJECTED" || status === "REVISION_REQUIRED") && !reviewNote) {
        throw new AppError(400, "A reason is required when rejecting or requesting revisions", "VALIDATION_ERROR");
      }
      if (reviewNote.length > 2000) {
        throw new AppError(400, "reviewNote must be at most 2000 characters", "VALIDATION_ERROR");
      }
      const existingReport = await getMatchReportById(id);
      await assertCanManageMatch(
        req as AuthenticatedRequest,
        existingReport.matchId,
      );
      const input = {
        status: status as "APPROVED" | "REJECTED" | "REVISION_REQUIRED",
        reviewNote: reviewNote || null,
        verifiedBy: (req as any).userId,
      };
      const report = await reviewMatchReport(id, input, input.verifiedBy);
      res.json({ report });
    } catch (err) {
      next(err);
    }
  },
};
