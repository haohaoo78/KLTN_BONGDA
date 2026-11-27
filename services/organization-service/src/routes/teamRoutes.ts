import { Router, type Router as ExpressRouter } from "express";
import { matchRosterController } from "../controllers/matchRosterController";
import { teamController } from "../controllers/teamController";
import { institutionController } from "../controllers/institutionController";
import { clubRequestController } from "../controllers/clubRequestController";
import { requireGatewayUser, requireTrustedGateway } from "../middleware/gatewayUser";
import { requireRole } from "../middleware/requireRole";
import { playerMembershipController } from "../controllers/playerMembershipController";
import { tournamentInvitationController } from "../controllers/tournamentInvitationController";

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
router.get("/internal/tournaments/:tournamentId/teams/:teamId/match-roster", requireTrustedGateway, matchRosterController);
router.get("/internal/institutions", requireTrustedGateway, institutionController.listInternalInstitutions);
router.get("/internal/institution-catalog", requireTrustedGateway, institutionController.listInternalInstitutionCatalog);
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
router.get(
  "/internal/tournaments/:tournamentId/registration-readiness",
  requireTrustedGateway,
  teamController.getInternalRegistrationReadiness,
);
router.post(
  "/internal/tournaments/:tournamentId/finalize-unselected-registrations",
  requireTrustedGateway,
  teamController.finalizeUnselectedRegistrations,
);
router.post(
  "/internal/tournaments/:tournamentId/finalize-unselected-registrations",
  requireTrustedGateway,
  teamController.finalizeUnselectedRegistrations,
);
router.get(
  "/internal/teams/:teamId/captain-notification-recipient",
  requireTrustedGateway,
  teamController.getCaptainNotificationRecipient,
);
router.get("/internal/players/:playerId/ownership", requireTrustedGateway, teamController.internalPlayerOwnership);
router.post(
  "/internal/teams/:teamId/players/verify-active-membership",
  requireTrustedGateway,
  teamController.verifyActiveTeamPlayers,
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
// BTC reviews the team application as a whole; player invitations are confirmed by players.
router.post("/player-requests", requireRole("PLAYER"), institutionController.createPlayerRequest);
router.patch("/player-requests/:id", requireRole("PLAYER"), institutionController.editMyPlayerRequest);
router.get("/tournament-invitations/my", requireRole("PLAYER"), tournamentInvitationController.listMine);
router.get("/tournament-invitations/withdrawal-requests/my", requireRole("PLAYER"), tournamentInvitationController.listMyPlayerWithdrawals);
router.post("/tournament-invitations/:id/respond", requireRole("PLAYER"), tournamentInvitationController.respond);
router.post("/tournament-invitations/:id/withdrawal-requests", requireRole("PLAYER"), tournamentInvitationController.requestPlayerWithdrawal);
router.get("/teams/:teamId/tournaments/:tournamentId/registration-draft", requireRole("TEAM_CAPTAIN"), tournamentInvitationController.getDraft);
router.put("/teams/:teamId/tournaments/:tournamentId/registration-draft", requireRole("TEAM_CAPTAIN"), tournamentInvitationController.saveDraft);
router.delete("/teams/:teamId/tournaments/:tournamentId/registration-draft", requireRole("TEAM_CAPTAIN"), tournamentInvitationController.deleteDraft);
router.post("/teams/:teamId/tournaments/:tournamentId/invitations", requireRole("TEAM_CAPTAIN"), tournamentInvitationController.createBatch);
router.get("/teams/:teamId/tournaments/:tournamentId/invitations", requireRole("TEAM_CAPTAIN"), tournamentInvitationController.listForTeam);
router.get("/teams/:teamId/tournaments/:tournamentId/player-withdrawal-requests", requireRole("TEAM_CAPTAIN"), tournamentInvitationController.listTeamPlayerWithdrawals);
router.post("/player-withdrawal-requests/:requestId/decision", requireRole("TEAM_CAPTAIN"), tournamentInvitationController.decidePlayerWithdrawal);
router.post("/teams/:teamId/tournaments/:tournamentId/invitations/:id/:action", requireRole("TEAM_CAPTAIN"), tournamentInvitationController.captainAction);
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
router.get("/teams/:teamId/tournaments/:tournamentId/eligible-players", requireRole("TEAM_CAPTAIN"), teamController.listTournamentEligibleTeamPlayers);
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
router.get("/tournaments/:tournamentId/registration-review-summary", requireRole("BTC"), teamController.getTournamentRegistrationReviewSummary);
router.get("/tournaments/:tournamentId/withdrawal-requests", requireRole("BTC"), teamController.listTeamWithdrawalRequests);
router.get("/teams/:teamId/tournaments/:tournamentId/registration", teamController.getTeamRegistrationById);
router.get("/teams/:teamId/registrations", requireRole("TEAM_CAPTAIN"), teamController.listTeamRegistrationsByTeam);
router.post("/registrations", requireRole("TEAM_CAPTAIN"), teamController.registerTeam);
router.put("/registrations/:id", requireRole("BTC"), teamController.updateTeamRegistration);
router.get("/registrations/:id/history", requireRole("BTC", "TEAM_CAPTAIN"), teamController.listTeamRegistrationHistory);
router.get("/registrations/:id/withdrawal-requests", requireRole("BTC", "TEAM_CAPTAIN"), teamController.listRegistrationWithdrawalRequests);
router.get("/registrations/:id/approval-reviews", requireRole("BTC", "TEAM_CAPTAIN"), teamController.listRegistrationApprovalReviews);
router.post("/registrations/:id/approval-reviews", requireRole("BTC"), teamController.openRegistrationApprovalReview);
router.post("/approval-reviews/:reviewId/response", requireRole("TEAM_CAPTAIN"), teamController.respondToRegistrationApprovalReview);
router.post("/approval-reviews/:reviewId/decision", requireRole("BTC"), teamController.decideRegistrationApprovalReview);
router.post("/registrations/:id/resubmit", requireRole("TEAM_CAPTAIN"), teamController.resubmitTeamRegistration);
router.post("/registrations/:id/withdraw", requireRole("TEAM_CAPTAIN"), teamController.withdrawTeamRegistration);
router.post("/registrations/:id/withdrawal-requests", requireRole("TEAM_CAPTAIN"), teamController.requestApprovedTeamWithdrawal);
router.post("/withdrawal-requests/:requestId/cancel", requireRole("TEAM_CAPTAIN"), teamController.cancelTeamWithdrawalRequest);
router.post("/registrations/:id/change-requests", requireRole("TEAM_CAPTAIN"), teamController.requestRegistrationChange);
router.get("/registrations/:id/change-requests", requireRole("BTC", "TEAM_CAPTAIN"), teamController.listTeamRegistrationChangeRequests);
router.get("/tournaments/:tournamentId/registration-change-requests", requireRole("BTC"), teamController.listRegistrationChangeRequests);
router.post("/registration-change-requests/:id/decision", requireRole("BTC"), teamController.decideRegistrationChangeRequest);
router.post("/withdrawal-requests/:requestId/decision", requireRole("BTC"), teamController.decideTeamWithdrawalRequest);
// Registration history is append-only. Never expose a hard-delete endpoint.

export const teamRoutes = router;
