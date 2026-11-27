import { Router, type Router as ExpressRouter } from "express";
import { matchController } from "../controllers/matchController";
import { lineupController } from "../controllers/lineupController";
import { requireGatewayUser } from "../middleware/gatewayUser";
import { matchSquadController } from "../controllers/matchSquadController";
import { requireRole } from "../middleware/requireRole";
import { requireTrustedService } from "../middleware/requireTrustedService";
import { refereePortalController } from "../controllers/refereePortalController";
import { matchOperationRulesController } from "../controllers/matchOperationRulesController";
import { matchOperationReadinessController } from "../controllers/matchOperationReadinessController";
import {matchShootoutController} from '../controllers/matchShootoutController';
import { matchDemoTimeController } from "../controllers/matchDemoTimeController";

const router: ExpressRouter = Router();

// Health check
router.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "match-service" });
});
router.post("/internal/tournaments/:tournamentId/roster-addition-eligibility", requireTrustedService, matchController.getRosterAdditionEligibility);
router.get("/internal/tournaments/:tournamentId/fixture-publication-readiness", requireTrustedService, matchController.getInternalFixturePublicationReadiness);
router.get("/internal/tournaments/:tournamentId/match-operation-readiness", requireTrustedService, matchOperationReadinessController.internal);

// Public routes
router.get("/tournaments/:tournamentId/matches", matchController.listMatches);
router.get("/tournaments/:tournamentId/bracket", matchController.getTournamentBracket);
router.get("/tournaments/:tournamentId/fixtures/public", matchController.getPublicTournamentFixtures);
router.get("/tournaments/:tournamentId/fixtures/group-standings/public", matchController.getPublicFixtureGroupStandings);
// Keep fixed paths before the UUID route. Otherwise "live" is parsed as a
// match ID and the PostgreSQL UUID cast fails before the live handler runs.
router.get("/matches/live", matchController.listPublicLiveMatches);
router.get("/matches/live/stream", matchController.streamPublicLiveFeed);
router.get("/matches/:id", matchController.getMatchById);
router.get("/matches/:matchId/live-state", matchController.getPublicLiveState);
router.get("/matches/:matchId/stream", matchController.streamPublicMatch);
router.get("/matches/:matchId/result", matchController.getMatchResultByMatchId);
router.get("/tournaments/:tournamentId/standings", matchController.listStandings);
router.get("/tournaments/:tournamentId/standings/:teamId", matchController.getStandingByTeam);
router.get("/matches/:matchId/lineups", lineupController.listLineups);
router.get("/matches/:matchId/events", lineupController.listMatchEvents);
router.get("/matches/:matchId/report", lineupController.getMatchReport);

// Protected routes
router.use(requireGatewayUser);

router.get("/my/schedules/workspace", requireRole("REFEREE"), refereePortalController.list);
router.get("/matches/:matchId/referee-context", requireRole("REFEREE"), refereePortalController.detail);
router.get("/matches/:matchId/operation-rules", requireRole("REFEREE", "BTC"), matchOperationRulesController.get);
router.get("/matches/:matchId/operation-readiness", requireRole("REFEREE", "BTC"), matchOperationReadinessController.match);
router.get("/tournaments/:tournamentId/fixtures/operation-readiness", requireRole("BTC"), matchOperationReadinessController.tournament);
router.get("/tournaments/:tournamentId/fixtures/operation-rules", requireRole("BTC"), matchOperationRulesController.candidates);
router.post("/tournaments/:tournamentId/fixtures/operation-rules/apply", requireRole("BTC"), matchOperationRulesController.apply);

router.get("/matches/:matchId/result/manage", requireRole("REFEREE", "BTC"), matchController.getManagedMatchResultByMatchId);
router.get("/matches/:matchId/clock", requireRole("REFEREE", "BTC"), matchController.getMatchClock);
router.get("/matches/:matchId/demo-time",requireRole("REFEREE","BTC"),matchDemoTimeController.get);
router.post("/matches/:matchId/demo-time",requireRole("REFEREE"),matchDemoTimeController.change);
router.post("/matches/:matchId/clock-actions", requireRole("REFEREE"), matchController.applyMatchClockAction);
router.get('/matches/:matchId/shootout',requireRole('REFEREE','BTC'),matchShootoutController.get);
router.post('/matches/:matchId/shootout/actions',requireRole('REFEREE'),matchShootoutController.change);
router.get("/matches/:matchId/report/manage", requireRole("REFEREE", "BTC"), lineupController.getManagedMatchReport);
router.post("/matches/:matchId/result-correction-requests", requireRole("REFEREE", "BTC"), matchController.requestResultCorrection);
router.get("/tournaments/:tournamentId/result-correction-requests", requireRole("BTC"), matchController.listResultCorrectionRequests);
router.put("/result-correction-requests/:id/review", requireRole("BTC"), matchController.reviewResultCorrectionRequest);
router.post("/matches/:matchId/forfeit", requireRole("BTC"), matchController.decideForfeit);
router.get("/tournaments/:tournamentId/forfeit-decisions", requireRole("BTC"), matchController.listForfeitDecisions);

router.post(
  "/tournaments/:tournamentId/fixtures/generate",
  requireRole("BTC"),
  matchController.generateFixtures,
);
router.get(
  "/tournaments/:tournamentId/fixtures/manage",
  requireRole("BTC"),
  matchController.getManagedTournamentFixtures,
);
router.get(
  "/tournaments/:tournamentId/fixtures/group-fair-play",
  requireRole("BTC"),
  matchController.getTournamentGroupFairPlay,
);
router.get("/tournaments/:tournamentId/fixtures/group-standings", requireRole("BTC"), matchController.getFixtureGroupStandings);
router.post("/tournaments/:tournamentId/fixtures/validate", requireRole("BTC"), matchController.validateFixtureStructure);
router.post(
  "/tournaments/:tournamentId/fixtures/publish",
  requireRole("BTC"),
  matchController.publishFixtureStage,
);
router.post(
  "/tournaments/:tournamentId/knockout-stage/generate",
  requireRole("BTC"),
  matchController.generateHybridPlayoffs,
);
router.get(
  "/tournaments/:tournamentId/knockout-stage/lot-draws",
  requireRole("BTC"),
  matchController.listHybridLotDraws,
);
router.get(
  "/matches/:matchId/pause-requests",
  requireRole("ADMIN", "BTC"),
  matchController.listPauseRequests,
);
router.post(
  "/matches/:matchId/pause-requests",
  requireRole("ADMIN"),
  matchController.createPauseRequest,
);
router.put(
  "/pause-requests/:id/review",
  requireRole("BTC"),
  matchController.reviewPauseRequest,
);

// Lineups
router.get("/matches/:matchId/squads/:teamId",requireRole("TEAM_CAPTAIN","BTC","REFEREE"),matchSquadController.workspace);
router.put("/matches/:matchId/squads/:teamId",requireRole("TEAM_CAPTAIN"),matchSquadController.save);
router.get("/matches/:matchId/preparation",requireRole("BTC","REFEREE"),matchSquadController.preparation);
router.post("/matches/:matchId/squads/:teamId/review",requireRole("REFEREE"),matchSquadController.review);
router.post("/matches/:matchId/preparation/issues",requireRole("REFEREE"),matchSquadController.reportIssue);
router.post("/matches/:matchId/preparation/organizer",requireRole("BTC"),matchSquadController.organizer);
router.post("/lineups",requireRole("TEAM_CAPTAIN"),matchSquadController.legacyAdd);
router.put("/matches/:matchId/lineups/:teamId/confirm",requireRole("TEAM_CAPTAIN"),matchSquadController.legacyConfirm);
router.delete("/matches/:matchId/lineups/:teamId",requireRole("TEAM_CAPTAIN"),matchSquadController.legacyDelete);

// Match Events
router.post("/match-events", requireRole("REFEREE"), lineupController.createMatchEvent);
router.put('/match-events/:id',requireRole('REFEREE'),lineupController.correctMatchEvent);
router.delete("/match-events/:id", requireRole("REFEREE"), lineupController.deleteMatchEvent);

// Match Reports
router.post("/match-reports", requireRole("REFEREE"), lineupController.createMatchReport);
router.put("/match-reports/:id/review", requireRole("BTC"), lineupController.reviewMatchReport);

// Matches
router.post("/matches", requireRole("BTC"), matchController.createMatch);
router.put("/matches/:id", requireRole("BTC"), matchController.updateMatch);
router.put("/matches/:id/referee-status", requireRole("REFEREE"), matchController.updateRefereeMatchStatus);
router.delete("/matches/:id", requireRole("BTC"), matchController.deleteMatch);
router.post("/match-results", requireRole("REFEREE"), matchController.recordMatchResult);

export const matchRoutes = router;
