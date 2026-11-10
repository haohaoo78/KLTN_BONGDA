import { Router } from "express";
import { notificationController } from "../controllers/notificationController";
import { requireGatewayUser } from "../middleware/gatewayUser";
import { requireRole } from "../middleware/requireRole";

const router = Router();

router.use(requireGatewayUser);
router.get("/", notificationController.listNotifications.bind(notificationController));
router.get("/unread-count", notificationController.getUnreadCount.bind(notificationController));
router.post(
  "/send",
  requireRole("ADMIN", "BTC"),
  notificationController.sendNotification.bind(notificationController),
);
router.get("/:id", notificationController.getNotification.bind(notificationController));
router.post("/:id/read", notificationController.markAsRead.bind(notificationController));
router.post("/mark-all-read", notificationController.markAllAsRead.bind(notificationController));
router.delete("/:id", notificationController.deleteNotification.bind(notificationController));

export const notificationRoutes = router;
