import { Request, Response, NextFunction } from "express";
import { AppError } from "../../lib/errors";
import type { AuthenticatedRequest } from "../../middleware/gatewayUser";
import {
  assertCanManageMatch,
  assertCanManageTournament,
  assertCanSubmitComplaintForTeam,
} from "../../scheduling/authorization";
import { getMatch } from "../../services/matchService";
import {
  getCards,
  issueCard,
  getSuspensions,
  getSuspension,
  issueSuspension,
  liftSuspension,
  checkPlayerSuspension,
  getComplaints,
  getComplaint,
  submitComplaint,
  reviewComplaint,
  issueDisciplinaryDecision,
  getDisciplinaryDecisions,
} from "../services/disciplineService";

export const disciplineController = {
  // Cards
  async listCards(req: Request, res: Response, next: NextFunction) {
    try {
      const { tournamentId } = req.params;
      const playerId = req.query.playerId as string | undefined;
      const teamId = req.query.teamId as string | undefined;
      const cards = await getCards(tournamentId, playerId, teamId);
      res.json({ cards });
    } catch (err) {
      next(err);
    }
  },

  async createCard(req: Request, res: Response, next: NextFunction) {
    try {
      if (typeof req.body.matchId !== "string") {
        throw new AppError(400, "matchId is required", "VALIDATION_ERROR");
      }
      const authenticatedReq = req as AuthenticatedRequest;
      if (typeof req.body.tournamentId !== "string") {
        throw new AppError(400, "tournamentId is required", "VALIDATION_ERROR");
      }
      const match = await getMatch(req.body.matchId);
      if (match.tournamentId !== req.body.tournamentId) {
        throw new AppError(400, "tournamentId does not match the selected match", "MATCH_TOURNAMENT_MISMATCH");
      }
      await assertCanManageMatch(authenticatedReq, req.body.matchId);
      if (!authenticatedReq.userId) {
        throw new AppError(401, "Missing user authentication", "UNAUTHENTICATED");
      }
      const input = {
        playerId: req.body.playerId,
        matchId: req.body.matchId,
        tournamentId: req.body.tournamentId,
        teamId: req.body.teamId,
        cardType: req.body.cardType,
        minute: req.body.minute,
        reason: req.body.reason,
      };
      const issuedBy = authenticatedReq.userId;
      const card = await issueCard(input, issuedBy);
      res.status(201).json({ card });
    } catch (err) {
      next(err);
    }
  },

  // Suspensions
  async listSuspensions(req: Request, res: Response, next: NextFunction) {
    try {
      const { tournamentId } = req.params;
      const playerId = req.query.playerId as string | undefined;
      const isActive = req.query.isActive === "true" ? true : req.query.isActive === "false" ? false : undefined;
      const suspensions = await getSuspensions(tournamentId, playerId, isActive);
      res.json({ suspensions });
    } catch (err) {
      next(err);
    }
  },

  async createSuspension(req: Request, res: Response, next: NextFunction) {
    try {
      const authenticatedReq = req as AuthenticatedRequest;
      if (typeof req.body.tournamentId !== "string") {
        throw new AppError(400, "tournamentId is required", "VALIDATION_ERROR");
      }
      await assertCanManageTournament(authenticatedReq, req.body.tournamentId);
      if (typeof req.body.matchId === "string") {
        const match = await getMatch(req.body.matchId);
        if (match.tournamentId !== req.body.tournamentId) {
          throw new AppError(400, "tournamentId does not match the selected match", "MATCH_TOURNAMENT_MISMATCH");
        }
        await assertCanManageMatch(authenticatedReq, req.body.matchId);
      }
      if (!authenticatedReq.userId) {
        throw new AppError(401, "Missing user authentication", "UNAUTHENTICATED");
      }
      const input = {
        playerId: req.body.playerId,
        tournamentId: req.body.tournamentId,
        teamId: req.body.teamId,
        type: req.body.type,
        startDate: req.body.startDate,
        endDate: req.body.endDate,
        reason: req.body.reason,
        matchId: req.body.matchId,
      };
      const suspension = await issueSuspension(input, authenticatedReq.userId);
      res.status(201).json({ suspension });
    } catch (err) {
      next(err);
    }
  },

  async liftSuspension(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const authenticatedReq = req as AuthenticatedRequest;
      const existing = await getSuspension(id);
      await assertCanManageTournament(authenticatedReq, existing.tournamentId);
      const suspension = await liftSuspension(id);
      res.json({ suspension });
    } catch (err) {
      next(err);
    }
  },

  async checkSuspension(req: Request, res: Response, next: NextFunction) {
    try {
      const { playerId, tournamentId } = req.params;
      const isSuspended = await checkPlayerSuspension(playerId, tournamentId);
      res.json({ isSuspended });
    } catch (err) {
      next(err);
    }
  },

  // Complaints
  async listComplaints(req: Request, res: Response, next: NextFunction) {
    try {
      const { tournamentId } = req.params;
      const status = req.query.status as string | undefined;
      const teamId = req.query.teamId as string | undefined;
      const complaints = await getComplaints(tournamentId, status, teamId);
      res.json({ complaints });
    } catch (err) {
      next(err);
    }
  },

  async createComplaint(req: Request, res: Response, next: NextFunction) {
    try {
      const authenticatedReq = req as AuthenticatedRequest;
      if (typeof req.body.matchId !== "string" || typeof req.body.tournamentId !== "string") {
        throw new AppError(400, "matchId and tournamentId are required", "VALIDATION_ERROR");
      }
      const match = await getMatch(req.body.matchId);
      if (
        match.tournamentId !== req.body.tournamentId ||
        ![match.homeTeamId, match.awayTeamId].includes(req.body.teamId)
      ) {
        throw new AppError(400, "Complaint team and tournament must belong to the selected match", "MATCH_SCOPE_MISMATCH");
      }
      if ((authenticatedReq.userRoles ?? []).includes("BTC")) {
        await assertCanManageTournament(authenticatedReq, req.body.tournamentId);
      } else if ((authenticatedReq.userRoles ?? []).includes("TEAM_CAPTAIN")) {
        if (typeof req.body.teamId !== "string") {
          throw new AppError(400, "teamId is required", "VALIDATION_ERROR");
        }
        await assertCanSubmitComplaintForTeam(authenticatedReq, req.body.teamId);
      }
      if (!authenticatedReq.userId) {
        throw new AppError(401, "Missing user authentication", "UNAUTHENTICATED");
      }
      const input = {
        matchId: req.body.matchId,
        tournamentId: req.body.tournamentId,
        teamId: req.body.teamId,
        submittedBy: authenticatedReq.userId,
        complaintType: req.body.complaintType,
        description: req.body.description,
        evidence: req.body.evidence,
      };
      const complaint = await submitComplaint(input);
      res.status(201).json({ complaint });
    } catch (err) {
      next(err);
    }
  },

  async reviewComplaint(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const authenticatedReq = req as AuthenticatedRequest;
      const existing = await getComplaint(id);
      await assertCanManageTournament(authenticatedReq, existing.tournamentId);
      if (!authenticatedReq.userId) {
        throw new AppError(401, "Missing user authentication", "UNAUTHENTICATED");
      }
      const input = {
        status: req.body.status,
        decision: req.body.decision,
        decisionReason: req.body.decisionReason,
      };
      const complaint = await reviewComplaint(id, input, authenticatedReq.userId);
      res.json({ complaint });
    } catch (err) {
      next(err);
    }
  },

  // Disciplinary Decisions
  async listDisciplinaryDecisions(req: Request, res: Response, next: NextFunction) {
    try {
      const playerId = req.query.playerId as string | undefined;
      const decisions = await getDisciplinaryDecisions(playerId);
      res.json({ decisions });
    } catch (err) {
      next(err);
    }
  },

  async createDisciplinaryDecision(req: Request, res: Response, next: NextFunction) {
    try {
      const authenticatedReq = req as AuthenticatedRequest;
      const isBtc = (authenticatedReq.userRoles ?? []).includes("BTC");
      if (isBtc && typeof req.body.complaintId !== "string") {
        throw new AppError(400, "BTC decisions must reference a complaint in an assigned tournament", "COMPLAINT_REQUIRED");
      }
      if (typeof req.body.complaintId === "string") {
        const complaint = await getComplaint(req.body.complaintId);
        await assertCanManageTournament(authenticatedReq, complaint.tournamentId);
      }
      if (!authenticatedReq.userId) {
        throw new AppError(401, "Missing user authentication", "UNAUTHENTICATED");
      }
      const input = {
        complaintId: req.body.complaintId,
        playerId: req.body.playerId,
        action: req.body.action,
        additionalMatchesSuspended: req.body.additionalMatchesSuspended,
        startDate: req.body.startDate,
        endDate: req.body.endDate,
        notes: req.body.notes,
      };
      const decision = await issueDisciplinaryDecision(input, authenticatedReq.userId);
      res.status(201).json({ decision });
    } catch (err) {
      next(err);
    }
  },
};
