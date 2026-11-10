import { Router } from "express";
import { UserRole } from "@sfl/shared";
import { userController } from "../controllers/userController";
import {
  requireGatewayUser,
  requireRoles,
  requireSelfOrAdmin,
} from "../middleware/gatewayUser";

const router = Router();

// Protected routes
router.use(requireGatewayUser);

router.get("/me", userController.getMe);
router.get("/me/profile-history", userController.listMyProfileHistory);
router.get("/:id/profile-history", requireRoles(UserRole.ADMIN), userController.listUserProfileHistory);
router.patch("/me", userController.updateMe);
router.post("/me/email-change", userController.requestEmailChange.bind(userController));
router.patch("/me/change-password", userController.changePassword.bind(userController));
router.get("/me/role-applications", userController.listMyRoleApplications);
router.post(
  "/me/role-applications",
  userController.submitRoleApplication.bind(userController),
);
router.patch(
  "/me/role-applications/:id",
  userController.updateMyRoleApplication.bind(userController),
);
router.post(
  "/me/role-applications/:id/withdraw",
  userController.withdrawMyRoleApplication.bind(userController),
);
router.get(
  "/role-applications",
  requireRoles(UserRole.ADMIN, UserRole.BTC),
  userController.listRoleApplications,
);
router.patch(
  "/role-applications/:id",
  requireRoles(UserRole.ADMIN, UserRole.BTC),
  userController.reviewRoleApplication.bind(userController),
);

router.get("/", requireRoles(UserRole.ADMIN), userController.listUsers);
router.post(
  "/",
  requireRoles(UserRole.ADMIN),
  userController.createUser.bind(userController),
);
router.post(
  "/:id/resend-activation",
  requireRoles(UserRole.ADMIN),
  userController.resendStaffActivation.bind(userController),
);
router.get("/:id", requireSelfOrAdmin("id"), userController.getUserById);
router.patch("/:id", requireRoles(UserRole.ADMIN), userController.updateUserById);

export const userRoutes = router;
