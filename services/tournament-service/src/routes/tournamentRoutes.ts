import { Router, type Router as ExpressRouter } from "express";
import { tournamentController } from "../controllers/tournamentController";
import { seasonController } from "../controllers/seasonController";
import { optionalGatewayUser, requireGatewayUser, requireTrustedGateway } from "../middleware/gatewayUser";
import { requireRole } from "../middleware/requireRole";
import { requireTournamentManager } from "../middleware/requireTournamentManager";
import { requireTournamentVisibility } from "../middleware/requireTournamentVisibility";
import { drawWorkflowController } from "../controllers/drawWorkflowController";

const router: ExpressRouter = Router();

// Public routes
router.get("/tournaments", optionalGatewayUser, tournamentController.listTournaments);
router.get(
  "/tournaments/registration-options",
  requireGatewayUser,
  requireRole("TEAM_CAPTAIN"),
  tournamentController.listRegistrationOptions,
);
router.get("/tournaments/:id", optionalGatewayUser, tournamentController.getTournamentById);
router.get("/tournaments/:id/approved-teams", optionalGatewayUser, tournamentController.listPublishedTournamentTeams);
router.get("/seasons", seasonController.listSeasons);
router.get(
  "/tournaments/:tournamentId/regulation-versions",
  optionalGatewayUser,
  requireTournamentVisibility,
  seasonController.listRegulationVersions,
);
router.get(
  "/tournaments/:tournamentId/registration-periods",
  requireTrustedGateway,
  optionalGatewayUser,
  requireTournamentVisibility,
  tournamentController.listRegistrationPeriods,
);
router.get(
  "/tournaments/:tournamentId/regulations",
  requireTrustedGateway,
  optionalGatewayUser,
  requireTournamentVisibility,
  tournamentController.listRegulations,
);
router.get(
  "/tournaments/:tournamentId/groups",
  optionalGatewayUser,
  requireTournamentVisibility,
  seasonController.listGroups,
);
router.get(
  "/tournaments/:tournamentId/draws",
  optionalGatewayUser,
  requireTournamentVisibility,
  seasonController.listDraws,
);
router.get(
  "/tournaments/:tournamentId/draw-public",
  optionalGatewayUser,
  requireTournamentVisibility,
  drawWorkflowController.publicDraw,
);
router.get(
  "/internal/tournaments/:tournamentId/published-draw",
  requireTrustedGateway,
  drawWorkflowController.internalPublishedDraw,
);
router.post(
  "/internal/tournaments/:tournamentId/registration-reservations",
  requireTrustedGateway,
  tournamentController.reserveRegistration,
);
router.patch(
  "/internal/registration-reservations/:registrationId",
  requireTrustedGateway,
  tournamentController.updateRegistrationReservation,
);
router.get(
  "/internal/tournaments/:tournamentId/roster-editability",
  requireTrustedGateway,
  tournamentController.getRosterEditability,
);

// Protected routes
router.use(requireGatewayUser);
router.get(
  "/internal/tournaments/:tournamentId/manager-access",
  tournamentController.checkManagerAccess,
);

router.get("/my/tournaments", requireRole("BTC"), tournamentController.listMyTournaments);
router.post("/seasons", requireRole("BTC"), seasonController.createSeason);
router.put("/seasons/:id", requireRole("BTC"), seasonController.updateSeason);
router.post(
  "/tournaments",
  requireRole("BTC"),
  tournamentController.createTournament,
);

router.use("/tournaments/:tournamentId", requireTournamentManager);
router.use("/registration-periods/:id", requireTournamentManager);
router.use("/regulations/:id", requireTournamentManager);
router.use("/regulation-versions/:id", requireTournamentManager);
router.use("/groups/:id", requireTournamentManager);
router.use("/draws/:id", requireTournamentManager);

router.get(
  "/tournaments/:tournamentId/organizer-candidates",
  tournamentController.listOrganizerCandidates,
);
router.get(
  "/tournaments/:tournamentId/organizers",
  tournamentController.listTournamentOrganizers,
);
router.put(
  "/tournaments/:tournamentId/organizers/:userId",
  tournamentController.assignOrganizer,
);
router.delete(
  "/tournaments/:tournamentId/organizers/:userId",
  tournamentController.removeOrganizer,
);

router.get(
  "/tournaments/:tournamentId/draw-management",
  drawWorkflowController.management,
);
router.post(
  "/tournaments/:tournamentId/draw-management/preview",
  drawWorkflowController.preview,
);
router.post(
  "/tournaments/:tournamentId/draw-management/drafts",
  drawWorkflowController.saveDraft,
);
router.post(
  "/tournaments/:tournamentId/draw-management/confirm",
  drawWorkflowController.confirm,
);
router.post(
  "/tournaments/:tournamentId/draw-management/publish",
  drawWorkflowController.publish,
);

// Tournaments
router.put("/tournaments/:id", requireTournamentManager, tournamentController.updateTournament);
router.get("/tournaments/:id/workflow-state", requireTournamentManager, tournamentController.getWorkflowState);
router.put("/tournaments/:id/workflow-state", requireTournamentManager, tournamentController.updateWorkflowStep);
router.delete("/tournaments/:id", requireTournamentManager, tournamentController.deleteTournament);

// Registration periods
router.post(
  "/tournaments/:tournamentId/registration-periods",
  tournamentController.createRegistrationPeriod,
);
router.delete(
  "/registration-periods/:id",
  tournamentController.deleteRegistrationPeriod,
);

// Regulations
router.post(
  "/tournaments/:tournamentId/regulations",
  tournamentController.createRegulation,
);
router.put("/regulations/:id", tournamentController.updateRegulation);
router.delete("/regulations/:id", tournamentController.deleteRegulation);

// Seasons
// Regulation versions
router.post("/tournaments/:tournamentId/regulation-versions", requireTournamentManager, seasonController.createRegulationVersion);

// Groups
router.post("/tournaments/:tournamentId/groups", requireTournamentManager, seasonController.createGroup);

// Draws
router.post("/tournaments/:tournamentId/draws", requireTournamentManager, seasonController.createDraw);
router.post("/tournaments/:tournamentId/draws/perform", requireTournamentManager, seasonController.performDraw);
router.delete("/tournaments/:tournamentId/draws", requireTournamentManager, seasonController.clearDraws);

export const tournamentRoutes = router;
