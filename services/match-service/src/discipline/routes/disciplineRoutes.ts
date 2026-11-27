import { Router, type Router as ExpressRouter } from "express";
import { disciplineController } from "../controllers/disciplineController";
import { requireGatewayUser } from "../middleware/gatewayUser";
import { requireRole } from "../middleware/requireRole";

const router: ExpressRouter = Router();

// Health check
router.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "discipline-service" });
});

// Public scorecard data only. Personal suspensions, complaints and decisions
// contain sensitive player/team information and require scoped authorization.
router.get("/tournaments/:tournamentId/cards", disciplineController.listCards);
router.get("/tournaments/:tournamentId/suspensions", requireGatewayUser, requireRole("BTC"), disciplineController.listSuspensions);
router.get("/players/:playerId/tournaments/:tournamentId/suspension", requireGatewayUser, requireRole("PLAYER"), disciplineController.checkSuspension);
router.get("/tournaments/:tournamentId/complaints", requireGatewayUser, disciplineController.listComplaints);
router.get("/tournaments/:tournamentId/complaint-appeals", requireGatewayUser, requireRole("BTC"), disciplineController.listComplaintAppeals);
router.get("/disciplinary-decisions", requireGatewayUser, requireRole("BTC"), disciplineController.listDisciplinaryDecisions);

// Protected routes - require authentication
router.use(requireGatewayUser);

// Referee can issue cards
router.post("/cards", requireRole("BTC", "REFEREE"), disciplineController.createCard);

router.post("/suspensions", requireRole("BTC"), disciplineController.createSuspension);
router.put("/suspensions/:id/lift", requireRole("BTC"), disciplineController.liftSuspension);

// Team captains can submit complaints
router.post("/complaints", requireRole("BTC", "TEAM_CAPTAIN"), disciplineController.createComplaint);
router.get("/complaints/:id/appeals", requireRole("BTC", "TEAM_CAPTAIN"), disciplineController.getComplaintAppealStatus);
router.post("/complaints/:id/appeals", requireRole("BTC", "TEAM_CAPTAIN"), disciplineController.createComplaintAppeal);
router.put("/complaint-appeals/:id/review", requireRole("BTC"), disciplineController.decideComplaintAppeal);

router.put("/complaints/:id/review", requireRole("BTC"), disciplineController.reviewComplaint);

router.post("/disciplinary-decisions", requireRole("BTC"), disciplineController.createDisciplinaryDecision);

export const disciplineRoutes = router;
