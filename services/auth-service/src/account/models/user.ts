import type { UserRole } from "@sfl/shared";

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  fullName: string;
  studentId: string | null;
  institutionId: string | null;
  isActive: boolean;
  emailVerified: boolean;
  roles: UserRole[];
  accountStatus?: "ACTIVE" | "LOCKED" | "DISABLED";
  createdAt?: string;
  updatedAt?: string;
  profileData?: {
    phone?: string | null;
    address?: string | null;
    birthDate?: string | null;
    gender?: string | null;
    faculty?: string | null;
    major?: string | null;
    academicYear?: string | null;
    playingPosition?: string | null;
    dominantFoot?: string | null;
    heightCm?: string | null;
    weightKg?: string | null;
  };
}

export interface UserCreateInput {
  email: string;
  passwordHash: string;
  fullName: string;
  studentId: string | null;
  institutionId?: string | null;
  roles: UserRole[];
  isActive?: boolean;
  emailVerified?: boolean;
}

export interface UserProfileUpdateInput {
  fullName?: string;
  studentId?: string | null;
  institutionId?: string | null;
  passwordHash?: string;
}

export interface UserAdminUpdateInput {
  fullName?: string;
  studentId?: string | null;
  institutionId?: string | null;
  isActive?: boolean;
  accountStatus?: "ACTIVE" | "LOCKED" | "DISABLED";
  roles?: UserRole[];
  statusReason?: string | null;
  profileData?: {
    phone?: string | null;
    address?: string | null;
  };
  actorUserId?: string;
  actorEmail?: string;
}

export interface ListUsersResult {
  items: UserRecord[];
  total: number;
  statistics: {
    total: number;
    active: number;
    locked: number;
    pending: number;
    disabled: number;
  };
}

export interface PasswordResetRecord {
  id: number;
  userId: string;
  token: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PasswordResetInput {
  email: string;
}

export interface PasswordResetConfirmInput {
  token: string;
  newPassword: string;
}

export interface ChangePasswordInput {
  oldPassword: string;
  newPassword: string;
}
