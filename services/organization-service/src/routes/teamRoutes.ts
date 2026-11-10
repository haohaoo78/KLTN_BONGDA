import { Router, type Router as ExpressRouter } from "express";
import { teamController } from "../controllers/teamController";
import { institutionController } from "../controllers/institutionController";
import { clubRequestController } from "../controllers/clubRequestController";
import { requireGatewayUser, requireTrustedGateway } from "../middleware/gatewayUser";
import { requireRole } from "../middleware/requireRole";
import { playerMembershipController } from "../controllers/playerMembershipController";

const router: ExpressRouter = Router();

router.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "organization-service" });
});

router.get("/institutions", institutionController.listInstitutions);
router.get("/public/teams", requireTrustedGateway, teamController.listPublicTeams);
router.get("/public/teams/:id", requireTrustedGateway, teamController.getPublicTeamById);
router.get(
  "/internal/registration-counts",
  requireTrustedGateway,
  teamController.listInternalRegistrationCounts,
);
router.get(
  "/internal/tournaments/:tournamentId/approved-teams",
  requireTrustedGateway,
  teamController.listPublishedTournamentTeams,
);
router.get(
  "/internal/institutions/:id/participation",
  requireTrustedGateway,
  institutionController.getParticipationInstitution,
);
router.get(
  "/internal/tournaments/:tournamentId/draw-candidates",
  requireTrustedGateway,
  teamController.listTournamentDrawCandidates,
);
router.use(requireGatewayUser);

router.get("/institutions/manage", requireRole("ADMIN"), institutionController.listManagedInstitutions);
router.get("/institutions/:id/history", requireRole("ADMIN"), institutionController.listInstitutionHistory);
router.patch("/institutions/:id/status", requireRole("ADMIN"), institutionController.setInstitutionStatus);
router.patch("/institutions/:id", requireRole("ADMIN"), institutionController.editInstitution);
router.get("/internal/institutions/:id/verify", institutionController.verifyInstitution);
router.get("/internal/institutions/:id/verify-assignment", institutionController.verifyInstitutionAssignment);
router.get("/internal/teams/:teamId/captain-access", teamController.checkCaptainAccess);
router.get("/club-requests/my", requireRole("TEAM_CAPTAIN"), clubRequestController.listMine);
router.post("/club-requests", requireRole("TEAM_CAPTAIN"), clubRequestController.create);
router.get(
  "/club-requests",
  requireRole("ADMIN", "BTC"),
  clubRequestController.listForReview,
);
router.patch(
  "/club-requests/:id",
  requireRole("BTC"),
  clubRequestController.review,
);
router.get(
  "/teams/:teamId/player-requests",
  requireRole("TEAM_CAPTAIN"),
  institutionController.listPlayerRequests,
);
router.get("/player-requests/my", requireRole("PLAYER"), institutionController.listMyPlayerRequests);
router.post("/institutions", requireRole("ADMIN"), institutionController.createInstitution);
router.get("/tournaments/:tournamentId/rosters", requireRole("BTC", "TEAM_CAPTAIN"), institutionController.listRosters);
router.post("/rosters", requireRole("TEAM_CAPTAIN"), institutionController.createRoster);
router.patch("/tournaments/:tournamentId/rosters/:rosterId/review", requireRole("BTC"), institutionController.reviewRoster);
router.put("/tournaments/:tournamentId/rosters/:rosterId", requireRole("TEAM_CAPTAIN"), institutionController.updateRosterEvidence);
router.delete("/tournaments/:tournamentId/rosters/:rosterId", requireRole("TEAM_CAPTAIN"), institutionController.deleteRoster);
router.post("/player-requests", requireRole("PLAYER"), institutionController.createPlayerRequest);
router.put("/player-requests/:id", requireRole("TEAM_CAPTAIN"), institutionController.respondPlayerRequest);
router.post("/player-requests/:id/withdraw", requireRole("PLAYER"), institutionController.withdrawPlayerRequest);
router.get("/player-leave-requests/my", requireRole("PLAYER"), playerMembershipController.listMine);
router.post("/player-leave-requests", requireRole("PLAYER"), playerMembershipController.createLeaveRequest);
router.post("/player-leave-requests/:id/withdraw", requireRole("PLAYER"), playerMembershipController.withdrawLeaveRequest);
router.get(
  "/teams/:teamId/player-leave-requests",
  requireRole("TEAM_CAPTAIN"),
  playerMembershipController.listTeamLeaveRequests,
);
router.patch(
  "/player-leave-requests/:id",
  requireRole("TEAM_CAPTAIN"),
  playerMembershipController.reviewLeaveRequest,
);

router.get("/teams", teamController.listTeams);
router.get("/teams/my/managed", requireRole("TEAM_CAPTAIN"), teamController.listMyManagedTeams);
router.get("/teams/my/registrations", teamController.listMyTeamRegistrations);
router.get("/teams/my", teamController.listMyTeams);
router.get("/teams/:teamId/players", teamController.listPlayers);
router.get("/teams/:id", teamController.getTeamById);

router.post("/teams", requireRole("TEAM_CAPTAIN"), teamController.createTeam);
router.post("/teams/:id/link-verified-school", requireRole("TEAM_CAPTAIN"), teamController.linkTeamToVerifiedSchool);
router.put("/teams/:id", requireRole("TEAM_CAPTAIN"), teamController.updateTeam);
router.delete("/teams/:id", requireRole("TEAM_CAPTAIN"), teamController.deleteTeam);

router.post("/players", requireRole("TEAM_CAPTAIN"), teamController.addPlayer);
router.put("/players/:id", requireRole("TEAM_CAPTAIN"), teamController.updatePlayer);
router.delete("/players/:id", requireRole("TEAM_CAPTAIN"), teamController.deletePlayer);

router.get("/tournaments/:tournamentId/registrations", requireRole("BTC"), teamController.listTeamRegistrations);
router.get("/teams/:teamId/tournaments/:tournamentId/registration", teamController.getTeamRegistrationById);
router.get("/teams/:teamId/registrations", requireRole("TEAM_CAPTAIN"), teamController.listTeamRegistrationsByTeam);
router.post("/registrations", requireRole("TEAM_CAPTAIN"), teamController.registerTeam);
router.put("/registrations/:id", requireRole("BTC"), teamController.updateTeamRegistration);
router.delete("/registrations/:id", requireRole("BTC"), teamController.deleteTeamRegistration);

export const teamRoutes = router;
