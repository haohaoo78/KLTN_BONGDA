import { Router, type Router as ExpressRouter } from "express";
import { schedulingController } from "../controllers/schedulingController";
import { requireGatewayUser } from "../middleware/gatewayUser";
import { requireRole } from "../middleware/requireRole";
import { schedulingEngineController } from "../controllers/schedulingEngineController";
import { resourcePresetController } from "../controllers/resourcePresetController";
import { refereeTeamController } from "../controllers/refereeTeamController";

const router: ExpressRouter = Router();

// Health check
router.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "scheduling-service" });
});

// Public routes - anyone can view venues and schedules
router.get("/venues", schedulingController.listVenues);
router.get("/venues/:id", schedulingController.getVenueById);
router.get("/venues/:venueId/availability", schedulingController.listVenueAvailability);
router.get("/tournaments/:tournamentId/schedules", schedulingController.listSchedules);
router.get("/my/schedules", requireGatewayUser, requireRole("REFEREE"), schedulingController.listMySchedules);
router.get("/schedules/referee-candidates", requireGatewayUser, requireRole("BTC"), schedulingController.listRefereeCandidates);
router.get("/schedules/test-resource-presets", requireGatewayUser, requireRole("BTC"), resourcePresetController.get);
router.get("/schedules/:id", schedulingController.getScheduleById);
router.get("/matches/:matchId/schedule", schedulingController.getScheduleByMatchId);
router.get("/schedules/test-workflow/:tournamentId/public", schedulingEngineController.publicTestState);

// Protected routes - require authentication
router.use(requireGatewayUser);

router.get("/tournaments/:tournamentId/referee-team", requireRole("BTC"), refereeTeamController.list);
router.get("/tournaments/:tournamentId/referee-team/account-lookup", requireRole("BTC"), refereeTeamController.lookup);
router.post("/tournaments/:tournamentId/referee-team", requireRole("BTC"), refereeTeamController.add);
router.patch("/tournaments/:tournamentId/referee-team/:memberId", requireRole("BTC"), refereeTeamController.patch);
router.post("/tournaments/:tournamentId/referee-team/:memberId/resend-access", requireRole("BTC"), refereeTeamController.resend);

// Development-only, non-persistent calculations for isolated browser test data.
// All calculations call the same shared scheduling engine used by the UI.
router.post("/schedules/engine/test/validate", requireRole("BTC"), schedulingEngineController.validate);
router.post("/schedules/engine/test/simulation/validate", requireRole("BTC"), schedulingEngineController.validateSimulation);
router.post("/schedules/test-workflow/:tournamentId/publish", requireRole("BTC"), schedulingEngineController.publishTestSchedule);
router.post("/schedules/test-workflow/:tournamentId/reopen", requireRole("BTC"), schedulingEngineController.reopenPublishedTestSchedule);
router.post("/schedules/engine/test/resources/preview", requireRole("BTC"), schedulingEngineController.resourceImpact);
router.post("/schedules/engine/test/setup-analysis", requireRole("BTC"), schedulingEngineController.setupAnalysis);
router.post("/schedules/engine/test/manual-candidates", requireRole("BTC"), schedulingEngineController.manualCandidates);
router.post("/schedules/engine/test/automatic-preview", requireRole("BTC"), schedulingEngineController.automaticPreview);
router.post("/schedules/engine/test/referee-preview", requireRole("BTC"), schedulingEngineController.refereePreview);
router.post("/tournaments/:tournamentId/schedules/automatic-preview", requireRole("BTC"), schedulingEngineController.officialAutomaticPreview);
router.get("/tournaments/:tournamentId/schedules/context", requireRole("BTC"), schedulingEngineController.officialContext);
router.post("/tournaments/:tournamentId/schedules/validate", requireRole("BTC"), schedulingEngineController.officialValidate);
router.post("/tournaments/:tournamentId/schedules/setup-analysis", requireRole("BTC"), schedulingEngineController.officialSetupAnalysis);
router.post("/tournaments/:tournamentId/schedules/manual-candidates", requireRole("BTC"), schedulingEngineController.officialManualCandidates);
router.post("/tournaments/:tournamentId/schedules/resources/preview", requireRole("BTC"), schedulingEngineController.officialResourceImpact);
router.put("/tournaments/:tournamentId/schedules/draft", requireRole("BTC"), schedulingEngineController.officialSaveDraft);
router.get("/schedules/test-workflow/:tournamentId", requireRole("BTC"), schedulingEngineController.testState);
router.put("/schedules/test-resource-presets", requireRole("BTC"), resourcePresetController.save);
router.put("/schedules/test-workflow/:tournamentId", requireRole("BTC"), schedulingEngineController.saveTestState);
router.delete("/schedules/test-workflow/:tournamentId", requireRole("BTC"), schedulingEngineController.resetTestState);

router.get(
  "/tournaments/:tournamentId/schedules/manage",
  requireRole("BTC"),
  schedulingController.listManagedSchedules,
);
router.get("/tournaments/:tournamentId/scheduling-resources", requireRole("BTC"), schedulingController.getTournamentScheduleResources);
router.put("/tournaments/:tournamentId/scheduling-resources", requireRole("BTC"), schedulingController.saveTournamentScheduleResources);
router.post("/tournaments/:tournamentId/schedules/publish", requireRole("BTC"), schedulingController.publishTournamentSchedules);
router.put("/schedules/:id/lock", requireRole("BTC"), schedulingController.setScheduleLock);
router.get("/schedules/:id/referees", requireRole("BTC"), schedulingController.listScheduleOfficials);
router.get("/schedules/:id/referee-history", requireRole("BTC"), schedulingController.listScheduleOfficialsHistory);
router.get("/schedules/:id/change-history", requireRole("BTC"), schedulingController.listScheduleChangesHistory);
router.put("/schedules/:id/referees", requireRole("BTC"), schedulingController.replaceScheduleOfficials);

router.post("/venues", requireRole("BTC"), schedulingController.createVenue);
router.put("/venues/:id", requireRole("BTC"), schedulingController.updateVenue);
router.delete("/venues/:id", requireRole("BTC"), schedulingController.deleteVenue);

router.post("/venue-availability", requireRole("BTC"), schedulingController.createVenueAvailability);
router.delete("/venue-availability/:id", requireRole("BTC"), schedulingController.deleteVenueAvailability);

router.post("/schedules/check-conflicts", requireRole("BTC"), schedulingController.checkScheduleConflicts);
router.post("/schedules", requireRole("BTC"), schedulingController.createSchedule);
router.put("/schedules/:id", requireRole("BTC"), schedulingController.updateSchedule);
router.delete("/schedules/:id", requireRole("BTC"), schedulingController.deleteSchedule);

export const schedulingRoutes = router;
