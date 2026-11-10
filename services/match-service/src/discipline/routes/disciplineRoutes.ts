import { Router, type Router as ExpressRouter } from "express";
import { disciplineController } from "../controllers/disciplineController";
import { requireGatewayUser } from "../middleware/gatewayUser";
import { requireRole } from "../middleware/requireRole";

const router: ExpressRouter = Router();

// Health check
router.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "discipline-service" });
});

// Public routes - anyone can view cards and suspensions
router.get("/tournaments/:tournamentId/cards", disciplineController.listCards);
router.get("/tournaments/:tournamentId/suspensions", disciplineController.listSuspensions);
router.get("/players/:playerId/tournaments/:tournamentId/suspension", disciplineController.checkSuspension);
router.get("/tournaments/:tournamentId/complaints", disciplineController.listComplaints);
router.get("/disciplinary-decisions", disciplineController.listDisciplinaryDecisions);

// Protected routes - require authentication
router.use(requireGatewayUser);

// Referee can issue cards
router.post("/cards", requireRole("BTC", "REFEREE"), disciplineController.createCard);

router.post("/suspensions", requireRole("BTC"), disciplineController.createSuspension);
router.put("/suspensions/:id/lift", requireRole("BTC"), disciplineController.liftSuspension);

// Team captains can submit complaints
router.post("/complaints", requireRole("BTC", "TEAM_CAPTAIN"), disciplineController.createComplaint);

router.put("/complaints/:id/review", requireRole("BTC"), disciplineController.reviewComplaint);

router.post("/disciplinary-decisions", requireRole("BTC"), disciplineController.createDisciplinaryDecision);

export const disciplineRoutes = router;
