import { Request, Response, NextFunction } from "express";
import { AuthService } from "../services/authService";
import { AppError } from "../lib/errors";
import {
  readSessionIdFromCookie,
  readRefreshTokenFromCookie,
  setSessionCookie,
  setRefreshCookie,
  clearSessionCookie,
  clearRefreshCookie,
} from "../lib/cookies";
import type { RegisterInput } from "../models/auth";
import { UserRole } from "@sfl/shared";

export const authController = {
  authService: null as AuthService | null,

  setAuthService(authService: AuthService) {
    this.authService = authService;
  },

  async login(req: Request, res: Response, next: NextFunction) {
    try {
      const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
      const password = typeof req.body?.password === "string" ? req.body.password : "";

      if (!email || !password) {
        throw new AppError(400, "Email and password are required", "VALIDATION_ERROR");
      }

      if (!this.authService) {
        throw new AppError(500, "Auth service not initialized", "SERVICE_ERROR");
      }

      const { user, sessionId, refreshToken } = await this.authService.loginUser({ email, password });
      setSessionCookie(res, sessionId);
      setRefreshCookie(res, refreshToken);

      res.json({ user });
    } catch (err) {
      next(err);
    }
  },

  async logout(req: Request, res: Response, next: NextFunction) {
    try {
      if (!this.authService) {
        throw new AppError(500, "Auth service not initialized", "SERVICE_ERROR");
      }
      const sessionId = readSessionIdFromCookie(req.headers.cookie);
      const refreshToken = readRefreshTokenFromCookie(req.headers.cookie);
      await this.authService.logoutUser(sessionId || "", refreshToken);
      clearSessionCookie(res);
      clearRefreshCookie(res);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },

  async getMe(req: Request, res: Response, next: NextFunction) {
    try {
      if (!this.authService) {
        throw new AppError(500, "Auth service not initialized", "SERVICE_ERROR");
      }
      const sessionId = readSessionIdFromCookie(req.headers.cookie);
      if (!sessionId) {
        throw new AppError(401, "Not authenticated", "UNAUTHENTICATED");
      }

      const user = await this.authService.getCurrentUser(sessionId);
      if (!user) {
        throw new AppError(401, "Session expired or invalid", "SESSION_INVALID");
      }

      res.json({ user });
    } catch (err) {
      next(err);
    }
  },

  async validateSession(req: Request, res: Response, next: NextFunction) {
    try {
      if (!this.authService) {
        throw new AppError(500, "Auth service not initialized", "SERVICE_ERROR");
      }
      const sessionId = readSessionIdFromCookie(req.headers.cookie);
      if (!sessionId) {
        throw new AppError(401, "Not authenticated", "UNAUTHENTICATED");
      }

      const user = await this.authService.validateSession(sessionId);
      if (!user) {
        throw new AppError(401, "Session expired or invalid", "SESSION_INVALID");
      }

      res.json({ user });
    } catch (err) {
      next(err);
    }
  },

  async register(req: Request, res: Response, next: NextFunction) {
    try {
      if (!this.authService) {
        throw new AppError(500, "Auth service not initialized", "SERVICE_ERROR");
      }

      const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
      const password = typeof req.body?.password === "string" ? req.body.password : "";
      const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
      const studentId =
        typeof req.body?.studentId === "string" ? req.body.studentId.trim() : undefined;

      if (!email || !password || !name) {
        throw new AppError(400, "Email, password, and name are required", "VALIDATION_ERROR");
      }
      if (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new AppError(400, "A valid email address is required", "VALIDATION_ERROR");
      }
      if (name.length > 255) {
        throw new AppError(400, "Name must be at most 255 characters", "VALIDATION_ERROR");
      }

      if (password.length < 8) {
        throw new AppError(400, "Password must be at least 8 characters", "VALIDATION_ERROR");
      }
      if (req.body?.role !== undefined && req.body.role !== UserRole.VIEWER) {
        throw new AppError(
          400,
          "Public registration creates VIEWER accounts; request other roles after verification",
          "INVALID_REGISTRATION_ROLE",
        );
      }
      if (studentId && studentId.length > 100) {
        throw new AppError(400, "Student ID must be at most 100 characters", "VALIDATION_ERROR");
      }

      await this.authService.registerUser({
        email,
        password,
        name,
        role: UserRole.VIEWER,
        studentId,
      });

      res.status(201).json({
        message: "Email xác minh đã được gửi. Hãy mở email để hoàn tất đăng ký.",
      });
    } catch (err) {
      next(err);
    }
  },

  async resendVerification(req: Request, res: Response, next: NextFunction) {
    try {
      if (!this.authService) {
        throw new AppError(500, "Auth service not initialized", "SERVICE_ERROR");
      }
      const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
      if (!email) {
        throw new AppError(400, "Email is required", "VALIDATION_ERROR");
      }
      if (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new AppError(400, "A valid email address is required", "VALIDATION_ERROR");
      }
      await this.authService.resendVerificationEmail(email);
      res.json({
        message: "Nếu tài khoản cần xác minh, email hướng dẫn sẽ được gửi đến hộp thư đã đăng ký.",
      });
    } catch (err) {
      next(err);
    }
  },

  async verifyEmail(req: Request, res: Response, next: NextFunction) {
    try {
      if (!this.authService) {
        throw new AppError(500, "Auth service not initialized", "SERVICE_ERROR");
      }

      const token = typeof req.params?.token === "string" ? req.params.token : "";

      if (!token) {
        throw new AppError(400, "Verification token is required", "VALIDATION_ERROR");
      }

      const result = await this.authService.verifyEmail(token);

      if (!result.success) {
        throw new AppError(400, "Invalid or expired verification token", "INVALID_TOKEN");
      }

      res.json({
        message: "Email verified successfully",
        userId: result.userId,
      });
    } catch (err) {
      next(err);
    }
  },

  async confirmEmailChange(req: Request, res: Response, next: NextFunction) {
    try {
      if (!this.authService) {
        throw new AppError(500, "Auth service not initialized", "SERVICE_ERROR");
      }
      const token = typeof req.params?.token === "string" ? req.params.token : "";
      if (!/^[a-f0-9]{64}$/i.test(token)) {
        throw new AppError(400, "A valid email-change token is required", "VALIDATION_ERROR");
      }
      await this.authService.confirmEmailChange(token);
      res.json({ message: "Email address updated and verified. Please sign in again." });
    } catch (error) {
      next(error);
    }
  },

  async forgotPassword(req: Request, res: Response, next: NextFunction) {
    try {
      if (!this.authService) {
        throw new AppError(500, "Auth service not initialized", "SERVICE_ERROR");
      }
      const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
      if (!email) {
        throw new AppError(400, "Email is required", "VALIDATION_ERROR");
      }
      if (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new AppError(400, "A valid email address is required", "VALIDATION_ERROR");
      }
      await this.authService.requestPasswordReset(email);
      res.json({
        message: "Nếu email đã đăng ký, hướng dẫn đặt lại mật khẩu sẽ được gửi đến hộp thư.",
      });
    } catch (err) {
      next(err);
    }
  },

  async resetPassword(req: Request, res: Response, next: NextFunction) {
    try {
      if (!this.authService) {
        throw new AppError(500, "Auth service not initialized", "SERVICE_ERROR");
      }
      const token = typeof req.body?.token === "string" ? req.body.token : "";
      const newPassword =
        typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
      if (!token || !newPassword) {
        throw new AppError(400, "Token and new password are required", "VALIDATION_ERROR");
      }
      if (newPassword.length < 8) {
        throw new AppError(400, "Password must be at least 8 characters", "VALIDATION_ERROR");
      }
      await this.authService.resetPassword(token, newPassword);
      res.json({ message: "Mật khẩu đã được đặt lại thành công." });
    } catch (err) {
      next(err);
    }
  },

  async activateStaffAccount(req: Request, res: Response, next: NextFunction) {
    try {
      if (!this.authService) {
        throw new AppError(500, "Auth service not initialized", "SERVICE_ERROR");
      }
      const token = typeof req.body?.token === "string" ? req.body.token : "";
      const password = typeof req.body?.password === "string" ? req.body.password : "";
      if (!token || !password) {
        throw new AppError(400, "Activation token and password are required", "VALIDATION_ERROR");
      }
      await this.authService.activateStaffAccount(token, password);
      res.json({ message: "Tài khoản đã được kích hoạt. Bạn có thể đăng nhập." });
    } catch (error) {
      next(error);
    }
  },

  async refreshToken(req: Request, res: Response, next: NextFunction) {
    try {
      if (!this.authService) {
        throw new AppError(500, "Auth service not initialized", "SERVICE_ERROR");
      }

      const refreshToken = readRefreshTokenFromCookie(req.headers.cookie);

      if (!refreshToken) {
        throw new AppError(401, "Refresh token is required", "INVALID_TOKEN");
      }

      const result = await this.authService.refreshAccessToken(refreshToken);

      if (!result) {
        throw new AppError(401, "Invalid or expired refresh token", "INVALID_TOKEN");
      }

      setSessionCookie(res, result.sessionId);
      setRefreshCookie(res, result.newRefreshToken);

      res.json({ user: result.user });
    } catch (err) {
      next(err);
    }
  },
};
