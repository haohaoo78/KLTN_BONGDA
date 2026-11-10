import { Router } from "express";
import { InternalEmailController } from "../controllers/internalEmailController";
import { requireInternalAuth } from "../middleware/internalAuth";
import { InternalNotificationController } from "../controllers/internalNotificationController";

export function createInternalRoutes(
  controller: InternalEmailController,
  notificationController: InternalNotificationController,
) {
  const router = Router();
  router.use(requireInternalAuth);
  router.post("/email/send", controller.sendAccountEmail.bind(controller));
  router.post("/notifications", notificationController.create.bind(notificationController));
  return router;
}
