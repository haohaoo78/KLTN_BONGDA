import { Router, type Router as ExpressRouter } from "express";
import { tournamentController } from "../controllers/tournamentController";
import { seasonController } from "../controllers/seasonController";
import { optionalGatewayUser, requireGatewayUser, requireTrustedGateway } from "../middleware/gatewayUser";
import { requireRole } from "../middleware/requireRole";
import { requireTournamentManager } from "../middleware/requireTournamentManager";
import { requireTournamentVisibility } from "../middleware/requireTournamentVisibility";
import { drawWorkflowController } from "../controllers/drawWorkflowController";
import { matchOperationRulesController } from "../controllers/matchOperationRulesController";

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
router.get("/tournaments/:tournamentId/regulation-operation-rules", optionalGatewayUser, requireTournamentVisibility, matchOperationRulesController.list);
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
  "/tournaments/:tournamentId/live-draw",
  optionalGatewayUser,
  requireTournamentVisibility,
  drawWorkflowController.publicLive,
);
router.get(
  "/tournaments/:tournamentId/live-draw/stream",
  optionalGatewayUser,
  requireTournamentVisibility,
  drawWorkflowController.liveStream,
);
router.get(
  "/tournaments/:tournamentId/draw-management/test-state/public",
  optionalGatewayUser,
  requireTournamentVisibility,
  drawWorkflowController.publicTestState,
);
router.get(
  "/internal/tournaments/:tournamentId/published-draw",
  requireTrustedGateway,
  drawWorkflowController.internalPublishedDraw,
);
router.get(
  "/internal/tournaments/:tournamentId/test-published-draw",
  requireTrustedGateway,
  drawWorkflowController.internalPublishedTestState,
);
router.post(
  "/internal/tournaments/:tournamentId/registration-reservations",
  requireTrustedGateway,
  tournamentController.reserveRegistration,
);
router.post(
  "/internal/tournaments/:tournamentId/player-availability",
  requireTrustedGateway,
  tournamentController.getPlayerAvailability,
);
router.post(
  "/internal/player-participation/invitations/reserve",
  requireTrustedGateway,
  tournamentController.reserveTournamentInvitationParticipation,
);
router.post(
  "/internal/player-participation/invitations/:invitationId/release",
  requireTrustedGateway,
  tournamentController.releaseTournamentInvitationParticipation,
);
router.post(
  "/internal/player-participation/reconcile",
  requireTrustedGateway,
  tournamentController.reconcileApprovedPlayerClaims,
);
router.patch(
  "/internal/registration-reservations/:registrationId",
  requireTrustedGateway,
  tournamentController.updateRegistrationReservation,
);
router.post(
  "/internal/registration-reservations/:registrationId/approve-withdrawal",
  requireTrustedGateway,
  tournamentController.approveRegistrationWithdrawal,
);
router.get(
  "/internal/tournaments/:tournamentId/roster-editability",
  requireTrustedGateway,
  tournamentController.getRosterEditability,
);
router.get(
  "/internal/tournaments/:tournamentId/registration-review-eligibility",
  requireTrustedGateway,
  tournamentController.getRegistrationReviewEligibility,
);
router.get(
  "/internal/tournaments/:tournamentId/discipline-policy",
  requireTrustedGateway,
  tournamentController.getInternalDisciplinePolicy,
);

// Protected routes
router.get("/internal/tournaments/:tournamentId/match-rules-source", requireTrustedGateway, matchOperationRulesController.source);
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
router.get(
  "/tournaments/:tournamentId/draw-management/test-configuration",
  drawWorkflowController.testConfiguration,
);
router.get("/tournaments/:tournamentId/draw-management/test-state", drawWorkflowController.testState);
router.put("/tournaments/:tournamentId/draw-management/test-state", drawWorkflowController.saveTestState);
router.delete("/tournaments/:tournamentId/draw-management/test-state", drawWorkflowController.resetTestState);
router.put(
  "/tournaments/:tournamentId/draw-management/test-configuration",
  drawWorkflowController.saveTestConfiguration,
);
router.delete(
  "/tournaments/:tournamentId/draw-management/test-configuration",
  drawWorkflowController.resetTestConfiguration,
);
router.get(
  "/tournaments/:tournamentId/draw-management/live-session",
  drawWorkflowController.managementLive,
);
router.post(
  "/tournaments/:tournamentId/draw-management/live-session",
  drawWorkflowController.startLive,
);
router.post(
  "/tournaments/:tournamentId/draw-management/live-session/start",
  drawWorkflowController.startScheduled,
);
router.patch(
  "/tournaments/:tournamentId/draw-management/live-session/schedule",
  drawWorkflowController.updateSchedule,
);
router.post(
  "/tournaments/:tournamentId/draw-management/live-session/next",
  drawWorkflowController.advanceLive,
);
router.patch(
  "/tournaments/:tournamentId/draw-management/live-session",
  drawWorkflowController.controlLive,
);
router.post(
  "/tournaments/:tournamentId/draw-management/live-session/finalize",
  drawWorkflowController.finalizeLive,
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
router.get("/tournaments/:id/registration-control", requireTournamentManager, tournamentController.getRegistrationControlAvailability);
router.post("/tournaments/:id/registration-control", requireTournamentManager, tournamentController.manuallyControlRegistration);
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
router.post("/tournaments/:tournamentId/regulation-operation-rules", matchOperationRulesController.create);
router.post("/tournaments/:tournamentId/regulation-operation-rules/:revision/publish", matchOperationRulesController.publish);
router.post("/tournaments/:tournamentId/regulation-versions", requireTournamentManager, seasonController.createRegulationVersion);

// Groups
router.post("/tournaments/:tournamentId/groups", requireTournamentManager, seasonController.createGroup);

// Draws
router.post("/tournaments/:tournamentId/draws", requireTournamentManager, seasonController.createDraw);
router.post("/tournaments/:tournamentId/draws/perform", requireTournamentManager, seasonController.performDraw);
router.delete("/tournaments/:tournamentId/draws", requireTournamentManager, seasonController.clearDraws);

export const tournamentRoutes = router;
