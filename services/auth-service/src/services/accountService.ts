import bcrypt from "bcryptjs";
import { UserRole, type AuthUserPublic } from "@sfl/shared";
import { AppError } from "../lib/errors";
import { PasswordResetRepository } from "../account/repositories/passwordResetRepository";
import {
  createUser as insertUser,
  findUserByEmail,
  findUserById,
  markUserEmailVerified,
} from "../account/repositories/userRepository";
import { getPool } from "../account/lib/db";
import { PasswordResetService } from "../account/services/passwordResetService";

type RegistrationStatusResponse = {
  userId: string;
  email: string;
  emailVerified: boolean;
  isActive: boolean;
};

let passwordResetService: PasswordResetService | null = null;

function getPasswordResetService(): PasswordResetService {
  passwordResetService ??= new PasswordResetService(
    new PasswordResetRepository(getPool()),
  );
  return passwordResetService;
}

export async function verifyCredentials(
  email: string,
  password: string,
): Promise<AuthUserPublic> {
  const user = await findUserByEmail(email);
  if (!user || !user.isActive || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new AppError(401, "Invalid email or password", "INVALID_CREDENTIALS");
  }
  if (!user.emailVerified) {
    throw new AppError(403, "Verify your email before signing in", "EMAIL_NOT_VERIFIED");
  }
  return {
    userId: user.id,
    email: user.email,
    fullName: user.fullName,
    roles: user.roles,
    institutionId: user.institutionId,
  };
}

export async function createUser(
  email: string,
  password: string,
  name: string,
  role: UserRole = UserRole.VIEWER,
  studentId?: string,
): Promise<AuthUserPublic> {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AppError(400, "A valid email is required", "VALIDATION_ERROR");
  }
  if (password.length < 8) {
    throw new AppError(400, "Password must be at least 8 characters", "VALIDATION_ERROR");
  }
  const allowedPublicRoles = [UserRole.VIEWER, UserRole.TEAM_CAPTAIN, UserRole.PLAYER] as const;
  if (!allowedPublicRoles.includes(role as (typeof allowedPublicRoles)[number])) {
    throw new AppError(400, "This account role cannot be selected during public registration", "INVALID_REGISTRATION_ROLE");
  }
  const user = await insertUser({
    email: email.toLowerCase(),
    passwordHash: await bcrypt.hash(password, 10),
    fullName: name.trim(),
    studentId: studentId?.trim() || null,
    roles: [role],
    isActive: true,
    emailVerified: false,
  });
  return {
    userId: user.id,
    email: user.email,
    fullName: user.fullName,
    roles: user.roles,
    institutionId: user.institutionId,
  };
}

export async function getRegistrationStatus(
  email: string,
): Promise<RegistrationStatusResponse | null> {
  const user = await findUserByEmail(email);
  if (!user) return null;
  return {
    userId: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
    isActive: user.isActive,
  };
}

export async function verifyUserEmail(userId: string): Promise<void> {
  if (!(await markUserEmailVerified(userId))) {
    throw new AppError(404, "User not found or inactive", "ACCOUNT_UNAVAILABLE");
  }
}

export async function requestPasswordReset(email: string): Promise<string | null> {
  const { token } = await getPasswordResetService().requestPasswordReset({ email });
  return token || null;
}

export async function confirmPasswordReset(
  token: string,
  newPassword: string,
): Promise<string> {
  if (newPassword.length < 8) {
    throw new AppError(400, "Password must be at least 8 characters", "VALIDATION_ERROR");
  }
  return getPasswordResetService().confirmPasswordReset({ token, newPassword });
}

export async function getAuthProfile(userId: string): Promise<AuthUserPublic> {
  const user = await findUserById(userId);
  if (!user || !user.isActive || !user.emailVerified) {
    throw new AppError(401, "Account is inactive or not verified", "ACCOUNT_UNAVAILABLE");
  }
  return {
    userId: user.id,
    email: user.email,
    fullName: user.fullName,
    roles: user.roles,
    institutionId: user.institutionId,
  };
}
