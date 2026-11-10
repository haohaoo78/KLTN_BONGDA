import { UserRole, type SessionData, type AuthUserPublic } from "@sfl/shared";
import type {
  LoginCredentials,
  UserVerificationResult,
  RegisterInput,
  RefreshTokenResponse,
} from "../models/auth";
import {
  createSessionId,
  deleteSession,
  getSession,
  saveSession,
  deleteUserSessions,
} from "./sessionStore";
import {
  getRegistrationStatus,
  verifyCredentials,
  verifyUserEmail,
  createUser,
  requestPasswordReset,
  confirmPasswordReset,
  getAuthProfile,
} from "./accountService";
import { AuthRepository } from "../repositories/authRepository";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { AppError } from "../lib/errors";
import { config } from "../config";
import {
  assertEmailDeliveryConfigured,
  sendStaffActivationEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendEmailChangeVerification,
} from "./verificationEmailService";
import { getPool } from "../account/lib/db";
import {
  createUser as createStaffUser,
  findUserById,
} from "../account/repositories/userRepository";
import { StaffInvitationRepository } from "../account/repositories/staffInvitationRepository";
import {
  confirmEmailChange as confirmEmailChangeRecord,
  createEmailChangeRequest,
  expireEmailChangeRequest,
} from "../account/repositories/emailChangeRepository";

type StaffRole = typeof UserRole.BTC | typeof UserRole.REFEREE;

export class AuthService {
  private readonly staffInvitationRepository: StaffInvitationRepository;

  constructor(private authRepository: AuthRepository) {
    this.staffInvitationRepository = new StaffInvitationRepository(getPool());
  }

  async loginUser(
    credentials: LoginCredentials,
  ): Promise<{ user: AuthUserPublic; sessionId: string; refreshToken: string }> {
    const user = await verifyCredentials(credentials.email, credentials.password);
    const sessionId = createSessionId();
    const session: SessionData = {
      userId: user.userId,
      email: user.email,
      roles: user.roles,
      createdAt: new Date().toISOString(),
    };

    await saveSession(sessionId, session);

    // Create refresh token
    const refreshToken = this.generateToken();
    const refreshExpiresAt = new Date(
      Date.now() + config.refreshTokenTtlSeconds * 1000,
    );
    await this.authRepository.createRefreshToken(
      user.userId,
      refreshToken,
      refreshExpiresAt,
    );

    return {
      user: {
        userId: user.userId,
        email: user.email,
        fullName: user.fullName,
        roles: user.roles,
        institutionId: user.institutionId,
      },
      sessionId,
      refreshToken,
    };
  }

  async logoutUser(sessionId: string, refreshToken?: string): Promise<void> {
    if (refreshToken) {
      await this.authRepository.revokeRefreshToken(refreshToken);
    }
    if (sessionId) {
      await deleteSession(sessionId);
    }
  }

  async getCurrentUser(
    sessionId: string,
  ): Promise<AuthUserPublic | null> {
    const session = await getSession(sessionId);
    if (!session) {
      return null;
    }

    const user = await getAuthProfile(session.userId);
    if (
      user.email !== session.email ||
      user.roles.length !== session.roles.length ||
      user.roles.some((role) => !session.roles.includes(role))
    ) {
      await saveSession(sessionId, {
        ...session,
        email: user.email,
        roles: user.roles,
      });
    }
    return user;
  }

  async validateSession(
    sessionId: string,
  ): Promise<AuthUserPublic | null> {
    return this.getCurrentUser(sessionId);
  }

  async registerUser(
    input: RegisterInput,
  ): Promise<void> {
    assertEmailDeliveryConfigured();
    const user = await createUser(
      input.email,
      input.password,
      input.name,
      input.role,
      input.studentId,
    );
    await this.issueVerificationEmail(user.userId, user.email);
  }

  async provisionStaffAccount(input: {
    email: string;
    fullName: string;
    role: StaffRole;
    institutionId: string | null;
    requestedBy: { userId: string; email: string };
  }): Promise<{ userId: string; email: string; roles: string[] }> {
    assertEmailDeliveryConfigured();
    const email = input.email.trim().toLowerCase();
    const fullName = input.fullName.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255) {
      throw new AppError(400, "A valid email address is required", "VALIDATION_ERROR");
    }
    if (!fullName || fullName.length > 255) {
      throw new AppError(400, "A valid full name is required", "VALIDATION_ERROR");
    }
    if (input.role !== UserRole.BTC && input.role !== UserRole.REFEREE) {
      throw new AppError(400, "Only BTC and REFEREE accounts can be provisioned", "INVALID_ROLE");
    }
    if (input.role === UserRole.BTC && !input.institutionId) {
      throw new AppError(400, "BTC accounts must be assigned to a school", "INSTITUTION_REQUIRED");
    }
    if (input.institutionId) {
      await this.validateAssignableInstitution(input.institutionId, input.requestedBy);
    }

    const placeholderPassword = randomBytes(48).toString("hex");
    const created = await createStaffUser({
      email,
      passwordHash: await bcrypt.hash(placeholderPassword, 10),
      fullName,
      studentId: null,
      institutionId: input.institutionId,
      roles: [input.role],
      isActive: false,
      emailVerified: false,
    });
    await this.sendStaffInvitation(created.id, created.email, input.role);
    return { userId: created.id, email: created.email, roles: created.roles };
  }

  async validateActiveInstitution(
    institutionId: string,
    actor: { userId: string; email: string },
  ): Promise<void> {
    const institution = await this.requestInstitutionVerification(
      institutionId,
      actor,
      "verify",
      true,
    );
    if (institution.isActive !== true || institution.status !== "ACTIVE") {
      throw new AppError(400, "The selected school is not active", "INVALID_INSTITUTION");
    }
  }

  async validateAssignableInstitution(
    institutionId: string,
    actor: { userId: string; email: string },
  ): Promise<void> {
    await this.requestInstitutionVerification(
      institutionId,
      actor,
      "verify-assignment",
      false,
    );
  }

  private async requestInstitutionVerification(
    institutionId: string,
    actor: { userId: string; email: string },
    operation: "verify" | "verify-assignment",
    activeRequired: boolean,
  ): Promise<{ id: string; institutionType: string; isActive?: boolean; status?: string }> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(institutionId)) {
      throw new AppError(400, "A valid school ID is required", "INVALID_INSTITUTION");
    }
    if (!config.internalApiKey) {
      throw new AppError(503, "School verification is not configured", "SERVICE_MISCONFIGURED");
    }

    let endpoint: string;
    try {
      endpoint = new URL(
        `/internal/institutions/${encodeURIComponent(institutionId)}/${operation}`,
        config.organizationServiceUrl,
      ).toString();
    } catch {
      throw new AppError(503, "Organization service URL is invalid", "SERVICE_MISCONFIGURED");
    }

    let response: Response;
    try {
      response = await fetch(endpoint, {
        headers: {
          "x-gateway-internal-key": config.internalApiKey,
          "x-user-id": actor.userId,
          "x-user-email": actor.email,
        },
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      throw new AppError(503, "School catalog is unavailable", "UPSTREAM_UNAVAILABLE");
    }
    if (response.status === 404) {
      throw new AppError(
        400,
        activeRequired ? "The selected school is not active" : "The selected school does not exist",
        "INVALID_INSTITUTION",
      );
    }
    if (!response.ok) {
      throw new AppError(502, "School selection could not be verified", "UPSTREAM_ERROR");
    }
    const body = await response.json() as {
      institution?: {
        id?: string;
        institutionType?: string;
        isActive?: boolean;
        status?: string;
      };
    };
    if (body.institution?.id !== institutionId) {
      throw new AppError(502, "School catalog returned an invalid response", "UPSTREAM_ERROR");
    }
    if (!["UNIVERSITY", "COLLEGE"].includes(body.institution.institutionType ?? "")) {
      throw new AppError(400, "Only universities and colleges can be assigned", "INVALID_INSTITUTION_TYPE");
    }
    return {
      id: body.institution.id,
      institutionType: body.institution.institutionType ?? "",
      isActive: body.institution.isActive,
      status: body.institution.status,
    };
  }

  async resendStaffInvitation(userId: string): Promise<void> {
    assertEmailDeliveryConfigured();
    const user = await findUserById(userId);
    if (!user || user.isActive || user.emailVerified) {
      throw new AppError(404, "Pending staff account not found", "NOT_FOUND");
    }
    const role = user.roles.find(
      (candidate): candidate is StaffRole =>
        candidate === UserRole.BTC || candidate === UserRole.REFEREE,
    );
    if (!role) {
      throw new AppError(404, "Pending staff account not found", "NOT_FOUND");
    }
    await this.sendStaffInvitation(user.id, user.email, role);
  }

  async activateStaffAccount(token: string, password: string): Promise<void> {
    if (!/^[a-f0-9]{64}$/i.test(token)) {
      throw new AppError(400, "Invalid or expired activation link", "INVALID_TOKEN");
    }
    if (password.length < 8) {
      throw new AppError(400, "Password must be at least 8 characters", "VALIDATION_ERROR");
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const activated = await this.staffInvitationRepository.activate(token, passwordHash);
    if (!activated) {
      throw new AppError(400, "Invalid or expired activation link", "INVALID_TOKEN");
    }
  }

  async resendVerificationEmail(email: string): Promise<void> {
    assertEmailDeliveryConfigured();
    const user = await getRegistrationStatus(email);
    if (!user || !user.isActive || user.emailVerified) return;

    const lastSentAt = await this.authRepository.getLatestEmailVerificationCreatedAt(user.email);
    if (lastSentAt && Date.now() - lastSentAt.getTime() < 60_000) {
      throw new AppError(429, "Wait a minute before requesting another verification email.", "EMAIL_RESEND_RATE_LIMITED");
    }

    await this.authRepository.expirePendingEmailVerifications(user.email);
    await this.issueVerificationEmail(user.userId, user.email);
  }

  async verifyEmail(token: string): Promise<{ success: boolean; userId?: string }> {
    const pending = await this.authRepository.findEmailVerificationByToken(token);
    if (!pending) {
      return { success: false };
    }
    await verifyUserEmail(pending.userId);
    const verification = await this.authRepository.verifyEmail(token);
    if (!verification) return { success: false };

    return {
      success: true,
      userId: verification.userId.toString(),
    };
  }

  async requestEmailChange(userId: string, email: string, currentPassword: string): Promise<void> {
    const user = await findUserById(userId);
    if (!user || !user.isActive || !user.emailVerified) {
      throw new AppError(403, "An active verified account is required", "ACCOUNT_NOT_VERIFIED");
    }
    await verifyCredentials(user.email, currentPassword);
    const normalizedEmail = email.trim().toLowerCase();
    if (normalizedEmail.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      throw new AppError(400, "A valid email address is required", "VALIDATION_ERROR");
    }
    assertEmailDeliveryConfigured();
    const token = this.generateToken();
    await createEmailChangeRequest({
      userId,
      email: normalizedEmail,
      token,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    try {
      await sendEmailChangeVerification(normalizedEmail, token);
    } catch (error) {
      await expireEmailChangeRequest(userId, token);
      throw error;
    }
  }

  async confirmEmailChange(token: string): Promise<void> {
    const userId = await confirmEmailChangeRecord(token);
    await this.authRepository.revokeAllUserRefreshTokens(userId);
    await deleteUserSessions(userId);
  }

  async requestPasswordReset(email: string): Promise<void> {
    assertEmailDeliveryConfigured();
    const token = await requestPasswordReset(email);
    if (token) await sendPasswordResetEmail(email, token);
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const userId = await confirmPasswordReset(token, newPassword);
    await this.authRepository.revokeAllUserRefreshTokens(userId);
    await deleteUserSessions(userId);
  }

  async refreshAccessToken(
    refreshToken: string,
  ): Promise<{
    user: AuthUserPublic;
    sessionId: string;
    newRefreshToken: string;
  } | null> {
    const tokenRecord = await this.authRepository.findRefreshTokenByToken(refreshToken);

    if (!tokenRecord) {
      return null;
    }

    const user = await getAuthProfile(tokenRecord.userId.toString());
    const newRefreshToken = this.generateToken();
    const newExpiresAt = new Date(
      Date.now() + config.refreshTokenTtlSeconds * 1000,
    );

    const rotated = await this.authRepository.rotateRefreshToken(
      refreshToken,
      newRefreshToken,
      newExpiresAt,
    );
    if (!rotated) return null;

    const sessionId = createSessionId();
    const session: SessionData = {
      userId: user.userId,
      email: user.email,
      roles: user.roles,
      createdAt: new Date().toISOString(),
    };

    await saveSession(sessionId, session);

    return {
      user,
      sessionId,
      newRefreshToken,
    };
  }

  private generateToken(): string {
    return randomBytes(32).toString("hex");
  }

  private async issueVerificationEmail(userId: string, email: string): Promise<void> {
    const token = this.generateToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await this.authRepository.createEmailVerification(userId, email, token, expiresAt);
    try {
      await sendVerificationEmail(email, token);
    } catch (error) {
      await this.authRepository.expirePendingEmailVerifications(email);
      throw error;
    }
  }

  private async sendStaffInvitation(
    userId: string,
    email: string,
    role: StaffRole,
  ): Promise<void> {
    const token = this.generateToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await this.staffInvitationRepository.create(userId, token, expiresAt);
    try {
      await sendStaffActivationEmail(email, token, role);
    } catch (error) {
      await this.staffInvitationRepository.expire(token);
      throw error;
    }
  }
}

// Legacy functions for backward compatibility
let authServiceInstance: AuthService | null = null;

export function setAuthService(authService: AuthService) {
  authServiceInstance = authService;
}

export async function loginUser(
  credentials: LoginCredentials,
): Promise<{ user: AuthUserPublic; sessionId: string }> {
  if (!authServiceInstance) {
    throw new Error("AuthService not initialized");
  }
  const result = await authServiceInstance.loginUser(credentials);
  return {
    user: result.user,
    sessionId: result.sessionId,
  };
}

export async function logoutUser(sessionId: string): Promise<void> {
  if (!authServiceInstance) {
    throw new Error("AuthService not initialized");
  }
  await authServiceInstance.logoutUser(sessionId);
}

export async function getCurrentUser(
  sessionId: string,
): Promise<AuthUserPublic | null> {
  if (!authServiceInstance) {
    throw new Error("AuthService not initialized");
  }
  return authServiceInstance.getCurrentUser(sessionId);
}

export async function validateSession(
  sessionId: string,
): Promise<AuthUserPublic | null> {
  if (!authServiceInstance) {
    throw new Error("AuthService not initialized");
  }
  return authServiceInstance.validateSession(sessionId);
}
