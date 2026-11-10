import type { UserProfilePublic } from "@sfl/shared";
import type { UserRecord } from "../repositories/userRepository";

export function toUserProfile(user: UserRecord): UserProfilePublic {
  return {
    userId: user.id,
    email: user.email,
    fullName: user.fullName,
    studentId: user.studentId,
    institutionId: user.institutionId,
    roles: user.roles,
    isActive: user.isActive,
    emailVerified: user.emailVerified,
    ...(user.accountStatus ? { accountStatus: user.accountStatus } : {}),
    ...(user.createdAt ? { createdAt: user.createdAt } : {}),
    ...(user.updatedAt ? { updatedAt: user.updatedAt } : {}),
    ...(user.profileData ? { profileData: user.profileData } : {}),
  };
}
