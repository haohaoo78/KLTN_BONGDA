import { Router, type Router as ExpressRouter } from "express";
import { schedulingController } from "../controllers/schedulingController";
import { requireGatewayUser } from "../middleware/gatewayUser";
import { requireRole } from "../middleware/requireRole";

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
router.get("/schedules/:id", schedulingController.getScheduleById);
router.get("/matches/:matchId/schedule", schedulingController.getScheduleByMatchId);

// Protected routes - require authentication
router.use(requireGatewayUser);

router.get(
  "/tournaments/:tournamentId/schedules/manage",
  requireRole("BTC"),
  schedulingController.listManagedSchedules,
);

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
