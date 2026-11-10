import { Router } from "express";
import { authController } from "../controllers/authController";

const router = Router();

router.post("/login", authController.login.bind(authController));
router.post("/logout", authController.logout.bind(authController));
router.get("/me", authController.getMe.bind(authController));
router.get("/session/validate", authController.validateSession.bind(authController));
router.post("/register", authController.register.bind(authController));
router.post("/resend-verification", authController.resendVerification.bind(authController));
router.post("/verify-email/:token", authController.verifyEmail.bind(authController));
router.post("/confirm-email-change/:token", authController.confirmEmailChange.bind(authController));
router.post("/forgot-password", authController.forgotPassword.bind(authController));
router.post("/reset-password", authController.resetPassword.bind(authController));
router.post("/activate-account", authController.activateStaffAccount.bind(authController));
router.post("/refresh", authController.refreshToken.bind(authController));

export const authRoutes = router;
