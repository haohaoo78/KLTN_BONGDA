import { Request, Response, NextFunction } from "express";
import { AppError } from "../lib/errors";
import type { AuthenticatedRequest } from "../middleware/gatewayUser";
import {
  assertCanManageMatch,
  assertCanManageTournament,
} from "../scheduling/authorization";
import {
  getMatch,
  getMatches,
  createNewMatch,
  updateMatchInfo,
  removeMatch,
  getMatchResult,
  recordMatchResult,
  getStandings,
  getStanding,
} from "../services/matchService";
import { findMatchResultByMatchId } from "../repositories/matchRepository";
import { generateTournamentFixtures } from "../services/fixtureGenerationService";
import {
  createMatchPauseRequest,
  findMatchPauseRequest,
  listMatchPauseRequests,
  reviewMatchPauseRequest,
} from "../repositories/matchPauseRequestRepository";

export const matchController = {
  async listPauseRequests(req: Request, res: Response, next: NextFunction) {
    try {
      const authenticatedReq = req as AuthenticatedRequest;
      const match = await getMatch(req.params.matchId);
      if ((authenticatedReq.userRoles ?? []).includes("BTC")) {
        await assertCanManageTournament(authenticatedReq, match.tournamentId);
      }
      res.json({ requests: await listMatchPauseRequests(match.id) });
    } catch (err) {
      next(err);
    }
  },

  async createPauseRequest(req: Request, res: Response, next: NextFunction) {
    try {
      const authenticatedReq = req as AuthenticatedRequest;
      const requestedBy = authenticatedReq.userId;
      if (!requestedBy) {
        throw new AppError(401, "Missing user authentication", "UNAUTHENTICATED");
      }
      const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
      if (!reason || reason.length > 2000) {
        throw new AppError(400, "A reason of 1–2000 characters is required", "VALIDATION_ERROR");
      }
      const match = await getMatch(req.params.matchId);
      if (!["SCHEDULED", "LINEUP_CONFIRMED", "IN_PROGRESS"].includes(match.status)) {
        throw new AppError(409, "This match cannot accept a pause request in its current state", "MATCH_NOT_PAUSABLE");
      }
      const request = await createMatchPauseRequest(match.id, requestedBy, reason);
      res.status(201).json({ request });
    } catch (err) {
      next(err);
    }
  },

  async reviewPauseRequest(req: Request, res: Response, next: NextFunction) {
    try {
      const authenticatedReq = req as AuthenticatedRequest;
      const reviewerId = authenticatedReq.userId;
      if (!reviewerId) {
        throw new AppError(401, "Missing user authentication", "UNAUTHENTICATED");
      }
      const decision = req.body?.decision;
      if (decision !== "APPROVED" && decision !== "REJECTED") {
        throw new AppError(400, "Decision must be APPROVED or REJECTED", "VALIDATION_ERROR");
      }
      const reviewNote = typeof req.body?.reviewNote === "string" ? req.body.reviewNote.trim() : "";
      if (decision === "REJECTED" && !reviewNote) {
        throw new AppError(400, "A reason is required when rejecting a pause request", "VALIDATION_ERROR");
      }
      if (reviewNote.length > 2000) {
        throw new AppError(400, "Review note must be at most 2000 characters", "VALIDATION_ERROR");
      }
      const existing = await findMatchPauseRequest(req.params.id);
      if (!existing) {
        throw new AppError(404, "Pause request not found", "PAUSE_REQUEST_NOT_FOUND");
      }
      await assertCanManageMatch(authenticatedReq, existing.matchId);
      const request = await reviewMatchPauseRequest(
        existing.id,
        decision,
        reviewerId,
        reviewNote || null,
      );
      res.json({ request });
    } catch (err) {
      next(err);
    }
  },

  async generateFixtures(req: Request, res: Response, next: NextFunction) {
    try {
      const tournamentId = req.params.tournamentId;
      const authenticatedReq = req as AuthenticatedRequest;
      await assertCanManageTournament(authenticatedReq, tournamentId);
      if (!authenticatedReq.userId) {
        throw new AppError(401, "Missing user authentication", "UNAUTHENTICATED");
      }
      const legs = req.body.legs === 2 ? 2 : req.body.legs === undefined || req.body.legs === 1 ? 1 : null;
      if (legs === null) {
        throw new AppError(400, "legs must be 1 or 2", "VALIDATION_ERROR");
      }
      const result = await generateTournamentFixtures(tournamentId, legs, authenticatedReq.userId);
      res.status(result.alreadyGenerated ? 200 : 201).json(result);
    } catch (err) {
      next(err);
    }
  },

  // Matches
  async getMatchById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const match = await getMatch(id);
      res.json({ match });
    } catch (err) {
      next(err);
    }
  },

  async listMatches(req: Request, res: Response, next: NextFunction) {
    try {
      const { tournamentId } = req.params;
      const limit = Number(req.query.limit) || 20;
      const offset = Number(req.query.offset) || 0;
      const status = req.query.status as string | undefined;

      const result = await getMatches(tournamentId, limit, offset, status);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async createMatch(req: Request, res: Response, next: NextFunction) {
    try {
      await assertCanManageTournament(
        req as AuthenticatedRequest,
        req.body.tournamentId,
      );
      const input = {
        tournamentId: req.body.tournamentId,
        homeTeamId: req.body.homeTeamId,
        awayTeamId: req.body.awayTeamId,
        matchDate: req.body.matchDate,
        venue: req.body.venue,
        round: req.body.round,
      };

      const match = await createNewMatch(input);
      res.status(201).json({ match });
    } catch (err) {
      next(err);
    }
  },

  async updateMatch(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      await assertCanManageMatch(req as AuthenticatedRequest, id);
      const input = {
        matchDate: req.body.matchDate,
        venue: req.body.venue,
        round: req.body.round,
        status: req.body.status,
      };

      const match = await updateMatchInfo(id, input);
      res.json({ match });
    } catch (err) {
      next(err);
    }
  },

  async updateRefereeMatchStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const authenticatedReq = req as AuthenticatedRequest;
      await assertCanManageMatch(authenticatedReq, id);
      const status = req.body?.status;
      if (status !== "LINEUP_CONFIRMED" && status !== "IN_PROGRESS" && status !== "FINISHED") {
        throw new AppError(400, "Referees may set LINEUP_CONFIRMED, IN_PROGRESS, or FINISHED", "VALIDATION_ERROR");
      }
      const match = await updateMatchInfo(id, { status });
      res.json({ match });
    } catch (err) {
      next(err);
    }
  },

  async deleteMatch(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      await assertCanManageMatch(req as AuthenticatedRequest, id);
      await removeMatch(id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },

  // Match Results
  async getMatchResultByMatchId(req: Request, res: Response, next: NextFunction) {
    try {
      const { matchId } = req.params;
      const result = await findMatchResultByMatchId(matchId);
      if (result?.status !== "APPROVED") {
        res.json({ result: null });
        return;
      }
      res.json({ result });
    } catch (err) {
      next(err);
    }
  },

  async getManagedMatchResultByMatchId(req: Request, res: Response, next: NextFunction) {
    try {
      const { matchId } = req.params;
      await assertCanManageMatch(req as AuthenticatedRequest, matchId);
      const result = await findMatchResultByMatchId(matchId);
      res.json({ result });
    } catch (err) {
      next(err);
    }
  },

  async recordMatchResult(req: Request, res: Response, next: NextFunction) {
    try {
      if (typeof req.body.matchId !== "string") {
        throw new AppError(400, "matchId is required", "VALIDATION_ERROR");
      }
      const authenticatedReq = req as AuthenticatedRequest;
      await assertCanManageMatch(authenticatedReq, req.body.matchId);
      if (!authenticatedReq.userId) {
        throw new AppError(401, "Missing user authentication", "UNAUTHENTICATED");
      }
      const input = {
        matchId: req.body.matchId,
        homeScore: req.body.homeScore,
        awayScore: req.body.awayScore,
        homeExtraTimeScore: req.body.homeExtraTimeScore,
        awayExtraTimeScore: req.body.awayExtraTimeScore,
        homePenaltyScore: req.body.homePenaltyScore,
        awayPenaltyScore: req.body.awayPenaltyScore,
        notes: req.body.notes,
      };
      const recordedBy = authenticatedReq.userId;

      const result = await recordMatchResult(input, recordedBy);
      res.status(201).json({ result });
    } catch (err) {
      next(err);
    }
  },

  // Standings
  async listStandings(req: Request, res: Response, next: NextFunction) {
    try {
      const { tournamentId } = req.params;
      const standings = await getStandings(tournamentId);
      res.json({ standings });
    } catch (err) {
      next(err);
    }
  },

  async getStandingByTeam(req: Request, res: Response, next: NextFunction) {
    try {
      const { tournamentId, teamId } = req.params;
      const standing = await getStanding(tournamentId, teamId);
      res.json({ standing });
    } catch (err) {
      next(err);
    }
  },
};
