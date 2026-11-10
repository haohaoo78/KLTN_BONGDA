/** Mã dịch vụ dùng cho log, trace, health check */
export const ServiceName = {
  AUTH: "auth-service",
  TOURNAMENT: "tournament-service",
  ORGANIZATION: "organization-service",
  MATCH: "match-service",
  NOTIFICATION: "notification-service",
  GATEWAY: "api-gateway",
} as const;

export type HealthResponse = {
  status: "ok";
  service: string;
  timestamp: string;
};

/** Vai trò MVP — khớp phân quyền SRS */
export const UserRole = {
  ADMIN: "ADMIN",
  BTC: "BTC",
  TEAM_CAPTAIN: "TEAM_CAPTAIN",
  PLAYER: "PLAYER",
  REFEREE: "REFEREE",
  VIEWER: "VIEWER",
} as const;

export type UserRole = (typeof UserRole)[keyof typeof UserRole];

/** Payload session lưu Redis (auth-service) */
export type SessionData = {
  userId: string;
  email: string;
  roles: UserRole[];
  createdAt: string;
};

export type AuthUserPublic = {
  userId: string;
  email: string;
  fullName?: string;
  roles: UserRole[];
  institutionId?: string | null;
};

/** Hồ sơ công khai — không trả password */
export type UserProfilePublic = {
  userId: string;
  email: string;
  fullName: string;
  studentId: string | null;
  institutionId: string | null;
  roles: UserRole[];
  isActive: boolean;
  emailVerified: boolean;
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
};
