import type { SessionData, AuthUserPublic, UserRole } from "@sfl/shared";

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface UserVerificationResult {
  userId: string;
  email: string;
  roles: string[];
}

export interface RegisterInput {
  email: string;
  password: string;
  name: string;
  role?: UserRole;
  studentId?: string;
}

export interface EmailVerificationRecord {
  id: number;
  userId: string;
  email: string;
  token: string;
  expiresAt: Date;
  verifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RefreshTokenRecord {
  id: number;
  userId: string;
  token: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedByToken: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RefreshTokenResponse {
  refreshToken: string;
  expiresAt: Date;
}
