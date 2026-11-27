import {getMatchShootout} from '../repositories/matchShootoutRepository';
import {stageOutcome} from '../repositories/matchOutcomeRepository';
import { Request, Response, NextFunction } from "express";
import { AppError } from "../lib/errors";
import { confirmPreparedMatch } from "../services/matchSquadService";
import type { AuthenticatedRequest } from "../middleware/gatewayUser";
import { config } from "../config";
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
  requestMatchResultCorrection,
  getMatchResultCorrectionRequest,
  getTournamentResultCorrectionRequests,
  decideMatchResultCorrectionRequest,
  decideMatchForfeit,
} from "../services/matchService";
import { findMatchResultByMatchId, getGroupStageFixtures, getRosterAdditionEligibility, isFixtureMatchPublic, listKnockoutBracket, listManagedKnockoutBracket, listManagedTournamentFixtures, listTournamentForfeitDecisions } from "../repositories/matchRepository";
import { listLiveMatchSummaries } from "../repositories/matchRepository";
import { applyMatchClockAction, getMatchClock } from "../repositories/matchClockRepository";
import { getMatchOperationReadiness, withRefereeOperation } from "../services/matchOperationReadinessService";
import { getLineups, getMatchEvents } from "../services/lineupService";
import { subscribeToMatch } from "../realtime/matchRealtime";
import type { MatchClockAction } from "../models/match";
import { getFixtureGroupStandings, generateHybridKnockoutStage, generateTournamentFixtures, getHybridLotDrawHistory, getPublishedDraw, publishGeneratedFixtureStructure } from "../services/fixtureGenerationService";
import {
  createMatchPauseRequest,
  findMatchPauseRequest,
  listMatchPauseRequests,
  reviewMatchPauseRequest,
} from "../repositories/matchPauseRequestRepository";

export const matchController = {
  async getRosterAdditionEligibility(req: Request, res: Response, next: NextFunction) {
    try {
      const playerIds = req.body?.playerIds;
      if (!Array.isArray(playerIds) || playerIds.length > 30 || playerIds.some((id: unknown) => typeof id !== "string")) {
        throw new AppError(400, "playerIds must be an array of at most 30 IDs", "VALIDATION_ERROR");
      }
      res.json(await getRosterAdditionEligibility(req.params.tournamentId, playerIds));
    } catch (err) { next(err); }
  },
  async listPublicLiveMatches(_req: Request, res: Response, next: NextFunction) {
    try {
      const items = await listLiveMatchSummaries();
      const visibility = await Promise.all([...new Set(items.map((item) => item.tournamentId))].map(async (tournamentId) => [tournamentId, await isPublicTournament(tournamentId)] as const));
      const publicTournaments = new Set(visibility.filter(([, visible]) => visible).map(([id]) => id));
      res.json({ items: items.filter((item) => publicTournaments.has(item.tournamentId)) });
    } catch (err) { next(err); }
  },
  async getPublicLiveState(req: Request, res: Response, next: NextFunction) {
    try {
      const match = await getMatch(req.params.matchId);
      if (!await isPublicTournament(match.tournamentId) || !await isFixtureMatchPublic(match.id)) throw new AppError(404, "Match not found", "MATCH_NOT_FOUND");
      const [events, lineups, result, clock] = await Promise.all([
        getMatchEvents(match.id), getLineups(match.id), findMatchResultByMatchId(match.id),
        match.status === "IN_PROGRESS" ? getMatchClock(match.id) : Promise.resolve(null),
      ]);
      res.json({
        match,
        events,
        lineups,
        result: result?.status === "APPROVED" ? result : null,
        provisionalResult: result && result.status !== "APPROVED" ? { status: result.status } : null,
          stageScores:await stageOutcome(match.id),shootout:await getMatchShootout(match.id),
        clock,
      });
    } catch (err) { next(err); }
  },
  async streamPublicMatch(req: Request, res: Response, next: NextFunction) {
    try {
      const match = await getMatch(req.params.matchId);
      if (!await isPublicTournament(match.tournamentId) || !await isFixtureMatchPublic(match.id)) throw new AppError(404, "Match not found", "MATCH_NOT_FOUND");
      await subscribeToMatch(match.id, res, req.get("Last-Event-ID"));
    } catch (err) { next(err); }
  },
  async streamPublicLiveFeed(req: Request, res: Response, next: NextFunction) {
    try { await subscribeToMatch("*", res, req.get("Last-Event-ID")); }
    catch (err) { next(err); }
  },
  async getMatchClock(req: Request, res: Response, next: NextFunction) {
    try {
      const authenticatedReq = req as AuthenticatedRequest;
      await assertCanManageMatch(authenticatedReq, req.params.matchId, "READ");
      res.json({ clock: await getMatchClock(req.params.matchId) });
    } catch (err) { next(err); }
  },
  async applyMatchClockAction(req: Request, res: Response, next: NextFunction) {
    try {
      const authenticatedReq = req as AuthenticatedRequest;
      await assertCanManageMatch(authenticatedReq, req.params.matchId, "FINALIZE");
      if (!authenticatedReq.userId) throw new AppError(401, "Missing user authentication", "UNAUTHENTICATED");
        const actions: MatchClockAction[] = ["START_MATCH", "PAUSE", "SUSPEND_PLAY", "RESUME", "DECLARE_ADDED_TIME", "END_PERIOD", "START_NEXT_PERIOD", "START_EXTRA_TIME", "START_PENALTIES", "END_MATCH"];
      if (!actions.includes(req.body?.action) || !Number.isInteger(req.body?.expectedVersion) || req.body.expectedVersion < 0) {
        throw new AppError(400, "action and a non-negative expectedVersion are required", "VALIDATION_ERROR");
      }
        if(req.body.reason!=null&&(typeof req.body.reason!=="string"||req.body.reason.length>2000))throw new AppError(400,"Lý do không hợp lệ.","CLOCK_REASON_REQUIRED");
        const clock = await applyMatchClockAction(req.params.matchId, req.body.action, req.body.expectedVersion, authenticatedReq.userId,{reason:req.body.reason,addedTimeSeconds:req.body.addedTimeSeconds});
      res.json({ clock });
    } catch (err) { next(err); }
  },
  async getTournamentBracket(req: Request, res: Response, next: NextFunction) {
    try {
      if (!await isPublicTournament(req.params.tournamentId)) throw new AppError(404, "Tournament not found", "TOURNAMENT_NOT_FOUND");
      res.json({ slots: await listKnockoutBracket(req.params.tournamentId) });
    } catch (err) { next(err); }
  },
  async getPublicTournamentFixtures(req: Request, res: Response, next: NextFunction) {
    try {
      const tournamentId = req.params.tournamentId;
      if (!await isPublicTournament(tournamentId)) throw new AppError(404, "Tournament not found", "TOURNAMENT_NOT_FOUND");
      let draw: Awaited<ReturnType<typeof getPublishedDraw>> | null = null;
      try { draw = await getPublishedDraw(tournamentId); }
      catch (error) {
        if (error instanceof AppError && error.code === "PUBLISHED_DRAW_REQUIRED") {
          res.json({ stages: [], bracket: [] });
          return;
        }
        throw error;
      }
      const { stages } = await listManagedTournamentFixtures(tournamentId);
      const publishedStages = stages
        .filter((stage) => stage.drawVersionId === draw.id && stage.status === "PUBLISHED")
        .map(({ drawVersionId, stage, legs, regulationVersion, status, createdAt, publishedAt, matches }) => ({
          drawVersionId, stage, legs, regulationVersion, status, createdAt, publishedAt, matches,
        }));
      const bracket = publishedStages.some((stage) => stage.stage === "KNOCKOUT")
        ? await listKnockoutBracket(tournamentId, draw.id)
        : [];
      res.json({ stages: publishedStages, bracket });
    } catch (err) { next(err); }
  },
  async getManagedTournamentFixtures(req: Request, res: Response, next: NextFunction) {
    try {
      const authenticatedReq = req as AuthenticatedRequest;
      await assertCanManageTournament(authenticatedReq, req.params.tournamentId);
      const [fixtures, bracket] = await Promise.all([
        listManagedTournamentFixtures(req.params.tournamentId),
        listManagedKnockoutBracket(req.params.tournamentId),
      ]);
      res.json({ ...fixtures, bracket });
    } catch (err) { next(err); }
  },
  async getTournamentGroupFairPlay(req: Request, res: Response, next: NextFunction) {
    try {
      const authenticatedReq = req as AuthenticatedRequest;
      await assertCanManageTournament(authenticatedReq, req.params.tournamentId);
      const draw = await getPublishedDraw(req.params.tournamentId);
      const fairPlayPoints: Record<string, number> = {};
      for (const group of draw.groups) {
        try {
          const stage = await getGroupStageFixtures(req.params.tournamentId, draw.id, group.id);
          Object.assign(fairPlayPoints, stage.fairPlayPoints);
        } catch (error) {
          if (!(error instanceof AppError) || error.code !== "GROUP_FIXTURES_REQUIRED") throw error;
        }
      }
      res.json({ drawVersionId: draw.id, fairPlayPoints });
    } catch (err) { next(err); }
  },
  async getInternalFixturePublicationReadiness(req: Request, res: Response, next: NextFunction) {
    try {
      const { stages } = await listManagedTournamentFixtures(req.params.tournamentId);
      res.json({ stages: stages.map(({ drawVersionId, stage, regulationVersion, status, matches }) => ({
        drawVersionId,
        stage,
        regulationVersion,
        status,
        matchCount: matches.length,
      })) });
    } catch (err) { next(err); }
  },
  async getFixtureGroupStandings(req: Request, res: Response, next: NextFunction) {
    try {
      await assertCanManageTournament(req as AuthenticatedRequest, req.params.tournamentId);
      res.json(await getFixtureGroupStandings(req.params.tournamentId));
    } catch (err) { next(err); }
  },
  async getPublicFixtureGroupStandings(req: Request, res: Response, next: NextFunction) {
    try {
      if (!await isPublicTournament(req.params.tournamentId)) throw new AppError(404, "Tournament not found", "TOURNAMENT_NOT_FOUND");
      res.json(await getFixtureGroupStandings(req.params.tournamentId));
    } catch (err) { next(err); }
  },
  async validateFixtureStructure(req: Request, res: Response, next: NextFunction) {
    try {
      const authenticatedReq = req as AuthenticatedRequest;
      await assertCanManageTournament(authenticatedReq, req.params.tournamentId);
      if (!authenticatedReq.userId) throw new AppError(401, "Missing user authentication", "UNAUTHENTICATED");
      await publishGeneratedFixtureStructure(req.params.tournamentId, authenticatedReq.userId, true);
      res.json({ valid: true, message: "Cấu trúc sơ đồ và các liên kết trận nguồn hợp lệ." });
    } catch (err) { next(err); }
  },
  async publishFixtureStage(req: Request, res: Response, next: NextFunction) {
    try {
      const authenticatedReq = req as AuthenticatedRequest;
      await assertCanManageTournament(authenticatedReq, req.params.tournamentId);
      if (!authenticatedReq.userId) throw new AppError(401, "Missing user authentication", "UNAUTHENTICATED");
      const publications = await publishGeneratedFixtureStructure(req.params.tournamentId, authenticatedReq.userId);
      res.json({ publications });
    } catch (err) { next(err); }
  },
  async listHybridLotDraws(req: Request, res: Response, next: NextFunction) {
    try {
      const authenticatedReq = req as AuthenticatedRequest;
      await assertCanManageTournament(authenticatedReq, req.params.tournamentId);
      res.json({ lotDraws: await getHybridLotDrawHistory(req.params.tournamentId) });
    } catch (err) { next(err); }
  },
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

  async generateHybridPlayoffs(req: Request, res: Response, next: NextFunction) {
    try {
      const tournamentId = req.params.tournamentId;
      const authenticatedReq = req as AuthenticatedRequest;
      await assertCanManageTournament(authenticatedReq, tournamentId);
      if (!authenticatedReq.userId) {
        throw new AppError(401, "Missing user authentication", "UNAUTHENTICATED");
      }
        const rawResolutions = req.body?.lotDrawResolutions;
        if (rawResolutions !== undefined && (!Array.isArray(rawResolutions) || rawResolutions.length > 32)) {
          throw new AppError(400, "lotDrawResolutions must be an array of at most 32 witnessed draws", "VALIDATION_ERROR");
        }
        const lotDrawResolutions = (rawResolutions ?? []).map((value: unknown) => {
          if (!value || typeof value !== "object") throw new AppError(400, "Invalid lot draw record", "VALIDATION_ERROR");
          const entry = value as Record<string, unknown>;
          if (typeof entry.groupId !== "string"
            || !Array.isArray(entry.tiedTeamIds) || entry.tiedTeamIds.length < 2
            || !entry.tiedTeamIds.every((id) => typeof id === "string")
            || !Array.isArray(entry.drawnOrder) || !entry.drawnOrder.every((id) => typeof id === "string")
            || typeof entry.witnessName !== "string"
            || typeof entry.reason !== "string") {
            throw new AppError(400, "Each lot draw record needs a group, tied teams, drawn order, witness and minutes/reason", "VALIDATION_ERROR");
          }
          return {
            groupId: entry.groupId,
            tiedTeamIds: entry.tiedTeamIds as string[],
            drawnOrder: entry.drawnOrder as string[],
            witnessName: entry.witnessName,
            reason: entry.reason,
          };
        });
        const result = await generateHybridKnockoutStage(tournamentId, authenticatedReq.userId, lotDrawResolutions);
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
      if (!await isPublicTournament(match.tournamentId) || !await isFixtureMatchPublic(match.id)) {
        throw new AppError(404, "Match not found", "MATCH_NOT_FOUND");
      }
      res.json({ match });
    } catch (err) {
      next(err);
    }
  },

  async decideForfeit(req: Request, res: Response, next: NextFunction) {
    try {
      const authenticatedReq = req as AuthenticatedRequest;
      const match = await getMatch(req.params.matchId);
      await assertCanManageTournament(authenticatedReq, match.tournamentId);
      if (!authenticatedReq.userId) throw new AppError(401, "Missing user authentication", "UNAUTHENTICATED");
      if (typeof req.body?.forfeitingTeamId !== "string" || typeof req.body?.reason !== "string") {
        throw new AppError(400, "forfeitingTeamId and reason are required", "VALIDATION_ERROR");
      }
      const outcome = await decideMatchForfeit(
        match.id,
        req.body.forfeitingTeamId,
        req.body.reason,
        authenticatedReq.userId,
      );
      res.status(200).json(outcome);
    } catch (err) {
      next(err);
    }
  },

  async listForfeitDecisions(req: Request, res: Response, next: NextFunction) {
    try {
      const authenticatedReq = req as AuthenticatedRequest;
      const { tournamentId } = req.params;
      await assertCanManageTournament(authenticatedReq, tournamentId);
      const decisions = await listTournamentForfeitDecisions(tournamentId);
      res.json({ decisions });
    } catch (err) { next(err); }
  },

  async listMatches(req: Request, res: Response, next: NextFunction) {
    try {
      const { tournamentId } = req.params;
      if (!await isPublicTournament(tournamentId)) throw new AppError(404, "Tournament not found", "TOURNAMENT_NOT_FOUND");
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

        const match = await updateMatchInfo(id, input,(req as AuthenticatedRequest).userId);
      res.json({ match });
    } catch (err) {
      next(err);
    }
  },

  async updateRefereeMatchStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const authenticatedReq = req as AuthenticatedRequest;
      await assertCanManageMatch(authenticatedReq, id, "FINALIZE");
      const status = req.body?.status;
      if (status !== "LINEUP_CONFIRMED") {
        throw new AppError(409, "Bắt đầu/kết thúc trận phải dùng API đồng hồ để lưu trạng thái thời gian.", "MATCH_CLOCK_ACTION_REQUIRED");
      }
      const match = await withRefereeOperation(authenticatedReq, id, "FINALIZE", async context => {
        const readiness = await getMatchOperationReadiness(id, context);
        if (!readiness.canConfirmLineup) throw new AppError(409, "Hai đội phải có đội hình hợp lệ đã xác nhận và phân công chính thức còn hiệu lực.", "MATCH_LINEUPS_NOT_READY", { issues: readiness.issues });
        await confirmPreparedMatch(id,authenticatedReq.userId!);
        return getMatch(id);
      });
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
      const match = await getMatch(matchId);
      if (!await isPublicTournament(match.tournamentId) || !await isFixtureMatchPublic(matchId)) throw new AppError(404, "Match not found", "MATCH_NOT_FOUND");
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
      await assertCanManageMatch(authenticatedReq, req.body.matchId, "FINALIZE");
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

      const result = await withRefereeOperation(authenticatedReq, input.matchId, "FINALIZE", () => recordMatchResult(input, recordedBy));
      res.status(201).json({ result });
    } catch (err) {
      next(err);
    }
  },

  async requestResultCorrection(req: Request, res: Response, next: NextFunction) {
    try {
      const authenticatedReq = req as AuthenticatedRequest;
      const matchId = req.params.matchId;
      const requestedBy = authenticatedReq.userId;
      if (!requestedBy) throw new AppError(401, "Missing user authentication", "UNAUTHENTICATED");
      await assertCanManageMatch(authenticatedReq, matchId, "FINALIZE");
      const request = await requestMatchResultCorrection(matchId, {
        homeScore: req.body.homeScore,
        awayScore: req.body.awayScore,
        homeExtraTimeScore: req.body.homeExtraTimeScore,
        awayExtraTimeScore: req.body.awayExtraTimeScore,
        homePenaltyScore: req.body.homePenaltyScore,
        awayPenaltyScore: req.body.awayPenaltyScore,
        notes: typeof req.body.notes === "string" ? req.body.notes.trim() : undefined,
      }, typeof req.body.reason === "string" ? req.body.reason : "", requestedBy);
      res.status(201).json({ request });
    } catch (err) { next(err); }
  },

  async listResultCorrectionRequests(req: Request, res: Response, next: NextFunction) {
    try {
      const authenticatedReq = req as AuthenticatedRequest;
      await assertCanManageTournament(authenticatedReq, req.params.tournamentId);
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      res.json({ requests: await getTournamentResultCorrectionRequests(req.params.tournamentId, status) });
    } catch (err) { next(err); }
  },

  async reviewResultCorrectionRequest(req: Request, res: Response, next: NextFunction) {
    try {
      const authenticatedReq = req as AuthenticatedRequest;
      const reviewerId = authenticatedReq.userId;
      if (!reviewerId) throw new AppError(401, "Missing user authentication", "UNAUTHENTICATED");
      const existing = await getMatchResultCorrectionRequest(req.params.id);
      await assertCanManageTournament(authenticatedReq, existing.tournamentId);
      const decision = req.body.decision;
      if (decision !== "APPROVED" && decision !== "REJECTED") throw new AppError(400, "Decision must be APPROVED or REJECTED", "VALIDATION_ERROR");
      const reviewReason = typeof req.body.reviewReason === "string" ? req.body.reviewReason.trim() : "";
      if (decision === "REJECTED" && reviewReason.length < 5) throw new AppError(400, "A rejection reason is required", "DECISION_REASON_REQUIRED");
      const request = await decideMatchResultCorrectionRequest(req.params.id, decision, reviewerId, reviewReason);
      res.json({ request });
    } catch (err) { next(err); }
  },

  // Standings
  async listStandings(req: Request, res: Response, next: NextFunction) {
    try {
      const { tournamentId } = req.params;
      if (!await isPublicTournament(tournamentId)) throw new AppError(404, "Tournament not found", "TOURNAMENT_NOT_FOUND");
      const standings = await getStandings(tournamentId);
      res.json({ standings });
    } catch (err) {
      next(err);
    }
  },

  async getStandingByTeam(req: Request, res: Response, next: NextFunction) {
    try {
      const { tournamentId, teamId } = req.params;
      if (!await isPublicTournament(tournamentId)) throw new AppError(404, "Tournament not found", "TOURNAMENT_NOT_FOUND");
      const standing = await getStanding(tournamentId, teamId);
      res.json({ standing });
    } catch (err) {
      next(err);
    }
  },
};

async function isPublicTournament(tournamentId: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
      const response = await fetch(`${config.tournamentServiceUrl}/tournaments/${encodeURIComponent(tournamentId)}`, {
        headers: config.internalApiKey ? { "x-gateway-internal-key": config.internalApiKey } : {},
        signal: controller.signal,
      });
    if (response.status === 404) return false;
    if (!response.ok) throw new AppError(503, "Không xác minh được trạng thái công khai của giải đấu.", "TOURNAMENT_VISIBILITY_UNAVAILABLE");
    const body = await response.json() as { tournament?: { status?: string } };
    return Boolean(body.tournament && body.tournament.status !== "DRAFT");
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(503, "Không xác minh được trạng thái công khai của giải đấu.", "TOURNAMENT_VISIBILITY_UNAVAILABLE");
  } finally { clearTimeout(timeout); }
}
