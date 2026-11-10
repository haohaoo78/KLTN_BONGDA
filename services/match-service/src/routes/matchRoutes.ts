import { Router, type Router as ExpressRouter } from "express";
import { matchController } from "../controllers/matchController";
import { lineupController } from "../controllers/lineupController";
import { requireGatewayUser } from "../middleware/gatewayUser";
import { requireRole } from "../middleware/requireRole";

const router: ExpressRouter = Router();

// Health check
router.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "match-service" });
});

// Public routes
router.get("/tournaments/:tournamentId/matches", matchController.listMatches);
router.get("/matches/:id", matchController.getMatchById);
router.get("/matches/:matchId/result", matchController.getMatchResultByMatchId);
router.get("/tournaments/:tournamentId/standings", matchController.listStandings);
router.get("/tournaments/:tournamentId/standings/:teamId", matchController.getStandingByTeam);
router.get("/matches/:matchId/lineups", lineupController.listLineups);
router.get("/matches/:matchId/events", lineupController.listMatchEvents);
router.get("/matches/:matchId/report", lineupController.getMatchReport);

// Protected routes
router.use(requireGatewayUser);

router.get("/matches/:matchId/result/manage", requireRole("REFEREE", "BTC"), matchController.getManagedMatchResultByMatchId);
router.get("/matches/:matchId/report/manage", requireRole("REFEREE", "BTC"), lineupController.getManagedMatchReport);

router.post(
  "/tournaments/:tournamentId/fixtures/generate",
  requireRole("BTC"),
  matchController.generateFixtures,
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
router.post("/lineups", requireRole("BTC", "TEAM_CAPTAIN"), lineupController.createLineup);
router.put("/matches/:matchId/lineups/:teamId/confirm", requireRole("BTC", "TEAM_CAPTAIN"), lineupController.confirmLineup);
router.delete("/matches/:matchId/lineups/:teamId", requireRole("BTC", "TEAM_CAPTAIN"), lineupController.deleteLineup);

// Match Events
router.post("/match-events", requireRole("REFEREE"), lineupController.createMatchEvent);
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
