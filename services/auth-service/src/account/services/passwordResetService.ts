import bcrypt from "bcryptjs";
import { PasswordResetRepository } from "../repositories/passwordResetRepository";
import { findUserByEmail, findUserById, updateUserProfile } from "../repositories/userRepository";
import { AppError } from "../lib/errors";
import { randomBytes } from "crypto";
import type {
  PasswordResetInput,
  PasswordResetConfirmInput,
  ChangePasswordInput,
} from "../models/user";

export class PasswordResetService {
  constructor(private passwordResetRepository: PasswordResetRepository) {}

  async requestPasswordReset(input: PasswordResetInput): Promise<{ token: string }> {
    const user = await findUserByEmail(input.email);

    if (!user) {
      // Don't reveal if email exists for security
      return { token: "" };
    }

    if (!user.isActive) {
      return { token: "" };
    }

    // Generate reset token
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 1 * 60 * 60 * 1000); // 1 hour

    // Revoke any existing unused tokens
    await this.passwordResetRepository.revokeAllUserPasswordResets(user.id);

    // Create new password reset
    await this.passwordResetRepository.createPasswordReset(
      user.id,
      token,
      expiresAt,
    );

    return { token };
  }

  async confirmPasswordReset(input: PasswordResetConfirmInput): Promise<string> {
    const passwordHash = await bcrypt.hash(input.newPassword, 10);
    const userId = await this.passwordResetRepository.resetPassword(input.token, passwordHash);
    if (!userId) {
      throw new AppError(400, "Invalid or expired reset token", "INVALID_TOKEN");
    }
    return userId;
  }

  async changePassword(
    userId: string,
    input: ChangePasswordInput,
  ): Promise<void> {
    const user = await findUserById(userId);

    if (!user) {
      throw new AppError(404, "User not found", "NOT_FOUND");
    }

    if (!user.isActive) {
      throw new AppError(403, "Account is inactive", "ACCOUNT_INACTIVE");
    }

    // Verify old password
    const isOldPasswordValid = await bcrypt.compare(input.oldPassword, user.passwordHash);
    if (!isOldPasswordValid) {
      throw new AppError(401, "Invalid old password", "INVALID_PASSWORD");
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(input.newPassword, 10);

    // Update user password
    await updateUserProfile(userId, {
      passwordHash,
    });
  }
}
