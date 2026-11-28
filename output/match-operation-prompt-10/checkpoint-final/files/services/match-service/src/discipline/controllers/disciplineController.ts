import {addMatchEvent} from '../../services/lineupService';
import { Request, Response, NextFunction } from "express";
import { withRefereeOperation } from "../../services/matchOperationReadinessService";
import { AppError } from "../../lib/errors";
import type { AuthenticatedRequest } from "../../middleware/gatewayUser";
import {
  assertCanManageMatch,
  assertCanManageTournament,
  assertCanSubmitComplaintForTeam,
} from "../../scheduling/authorization";
import { getMatch } from "../../services/matchService";
import { getMatchReport } from "../../services/lineupService";
import { config as matchConfig } from "../../config";
import {
  getCards,
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
  getComplaintAppeal,
  getComplaintAppealByComplaintId,
  getComplaintAppeals,
  submitComplaintAppeal,
  reviewComplaintAppeal,
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
      await assertCanManageMatch(authenticatedReq, req.body.matchId, "RECORD_EVENT");
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
      if(!['YELLOW','RED'].includes(input.cardType))throw new AppError(400,'Loại thẻ không hợp lệ.','VALIDATION_ERROR');
      const card = await withRefereeOperation(authenticatedReq, input.matchId, "RECORD_EVENT", () => addMatchEvent({matchId:input.matchId,teamId:input.teamId,playerId:input.playerId,eventType:input.cardType==='RED'?'RED_CARD':req.body.secondYellow===true?'SECOND_YELLOW_CARD':'YELLOW_CARD',minute:input.minute,description:input.reason,operationId:req.body.operationId,phase:req.body.phase,periodElapsedSeconds:req.body.periodElapsedSeconds,expectedClockVersion:req.body.expectedClockVersion},issuedBy));
      res.status(201).json({ event:card,disciplineSync:"PENDING" });
    } catch (err) {
      next(err);
    }
  },

  // Suspensions
  async listSuspensions(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { tournamentId } = req.params;
      await assertCanManageTournament(req, tournamentId);
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
        matchesSuspended: req.body.matchesSuspended,
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
      const actor = req as AuthenticatedRequest;
      if (!actor.userId || !actor.userRoles?.includes("PLAYER")) throw new AppError(403, "Thông tin treo giò chỉ dành cho chính tài khoản cầu thủ.", "PLAYER_SUSPENSION_FORBIDDEN");
      let ownerResponse: globalThis.Response;
      try {
        ownerResponse = await fetch(new URL(`/internal/players/${encodeURIComponent(playerId)}/ownership`, matchConfig.organizationServiceUrl), {
          headers: { "x-gateway-internal-key": matchConfig.internalApiKey }, signal: AbortSignal.timeout(5000),
        });
      } catch { throw new AppError(503, "Không xác minh được hồ sơ cầu thủ.", "PLAYER_IDENTITY_UNAVAILABLE"); }
      if (!ownerResponse.ok) throw new AppError(503, "Không xác minh được hồ sơ cầu thủ.", "PLAYER_IDENTITY_UNAVAILABLE");
      const owner = await ownerResponse.json() as { playerId?: string; userId?: string | null };
      if (owner.playerId !== playerId || owner.userId !== actor.userId) throw new AppError(403, "Bạn chỉ xem được tư cách thi đấu của chính mình.", "PLAYER_SUSPENSION_FORBIDDEN");
      const matchId = typeof req.query.matchId === "string" ? req.query.matchId : undefined;
      try {
        const isSuspended = await checkPlayerSuspension(playerId, tournamentId, matchId);
        res.json({ isSuspended, status: isSuspended ? 'SUSPENDED' : 'ELIGIBLE' });
      } catch(error) {
        if(error instanceof Error && 'code' in error && String(error.code).startsWith('DISCIPLINE_')) res.json({isSuspended:null,status:'UNDETERMINED',reason:error.message});
        else throw error;
      }
    } catch (err) {
      next(err);
    }
  },

  // Complaints
  async listComplaints(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { tournamentId } = req.params;
      const status = req.query.status as string | undefined;
      const teamId = req.query.teamId as string | undefined;
      if ((req.userRoles ?? []).includes("BTC")) {
        await assertCanManageTournament(req, tournamentId);
      } else if ((req.userRoles ?? []).includes("TEAM_CAPTAIN") && teamId) {
        await assertCanSubmitComplaintForTeam(req, teamId);
      } else {
        throw new AppError(403, "Only the tournament organizer or the team's captain may view complaints", "FORBIDDEN");
      }
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
      const roles = authenticatedReq.userRoles ?? [];
      if (roles.includes("BTC")) {
        await assertCanManageTournament(authenticatedReq, req.body.tournamentId);
      } else if (roles.includes("TEAM_CAPTAIN")) {
        if (typeof req.body.teamId !== "string") {
          throw new AppError(400, "teamId is required", "VALIDATION_ERROR");
        }
        await assertCanSubmitComplaintForTeam(authenticatedReq, req.body.teamId);
      } else {
        throw new AppError(403, "Only the team's captain or assigned organizer may submit a complaint", "FORBIDDEN");
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

  async listComplaintAppeals(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { tournamentId } = req.params;
      await assertCanManageTournament(req, tournamentId);
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const appeals = await getComplaintAppeals(tournamentId, status);
      res.json({ appeals });
    } catch (err) { next(err); }
  },

  async createComplaintAppeal(req: Request, res: Response, next: NextFunction) {
    try {
      const authenticatedReq = req as AuthenticatedRequest;
      const complaint = await getComplaint(req.params.id);
      if (authenticatedReq.userRoles?.includes("BTC")) {
        await assertCanManageTournament(authenticatedReq, complaint.tournamentId);
      } else if (authenticatedReq.userRoles?.includes("TEAM_CAPTAIN")) {
        await assertCanSubmitComplaintForTeam(authenticatedReq, complaint.teamId);
      } else {
        throw new AppError(403, "Only the original team's captain may appeal this complaint", "FORBIDDEN");
      }
      if (!authenticatedReq.userId) throw new AppError(401, "Missing user authentication", "UNAUTHENTICATED");
      if (!complaint.reviewedAt) throw new AppError(409, "The complaint decision has no review timestamp", "COMPLAINT_REVIEW_TIME_MISSING");
      const appeal = await submitComplaintAppeal({
        complaintId: complaint.id,
        submittedBy: authenticatedReq.userId,
        description: typeof req.body.description === "string" ? req.body.description : "",
        evidence: typeof req.body.evidence === "string" ? req.body.evidence : undefined,
      });
      res.status(201).json({ appeal });
    } catch (err) { next(err); }
  },

  async getComplaintAppealStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const authenticatedReq = req as AuthenticatedRequest;
      const complaint = await getComplaint(req.params.id);
      if (authenticatedReq.userRoles?.includes("BTC")) {
        await assertCanManageTournament(authenticatedReq, complaint.tournamentId);
      } else if (authenticatedReq.userRoles?.includes("TEAM_CAPTAIN")) {
        await assertCanSubmitComplaintForTeam(authenticatedReq, complaint.teamId);
      } else {
        throw new AppError(403, "Only the team's captain or assigned organizer may view the appeal", "FORBIDDEN");
      }
      const appeal = await getComplaintAppealByComplaintId(complaint.id);
      res.json({ appeal });
    } catch (err) { next(err); }
  },

  async decideComplaintAppeal(req: Request, res: Response, next: NextFunction) {
    try {
      const authenticatedReq = req as AuthenticatedRequest;
      const appeal = await getComplaintAppeal(req.params.id);
      const complaint = await getComplaint(appeal.complaintId);
      await assertCanManageTournament(authenticatedReq, complaint.tournamentId);
      if (!authenticatedReq.userId) throw new AppError(401, "Missing user authentication", "UNAUTHENTICATED");
      if (!['APPROVED', 'REJECTED'].includes(req.body.status)) {
        throw new AppError(400, "status must be APPROVED or REJECTED", "INVALID_APPEAL_STATUS");
      }
      const decided = await reviewComplaintAppeal(appeal.id, {
        status: req.body.status,
        decisionReason: typeof req.body.decisionReason === "string" ? req.body.decisionReason : "",
      }, authenticatedReq.userId);
      res.json({ appeal: decided, followUpRequired: decided.status === "APPROVED" });
    } catch (err) { next(err); }
  },

  // Disciplinary Decisions
  async listDisciplinaryDecisions(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const tournamentId = typeof req.query.tournamentId === "string" ? req.query.tournamentId : "";
      if (!tournamentId) throw new AppError(400, "tournamentId is required", "VALIDATION_ERROR");
      await assertCanManageTournament(req, tournamentId);
      const playerId = req.query.playerId as string | undefined;
      const decisions = await getDisciplinaryDecisions(tournamentId, playerId);
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
