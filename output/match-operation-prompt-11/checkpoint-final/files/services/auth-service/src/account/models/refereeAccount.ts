import type { UserRole } from "@sfl/shared";

export type RefereeAccountSummary = {
  userId: string;
  email: string;
  fullName: string;
  phone: string | null;
  accountStatus: "ACTIVE" | "LOCKED" | "DISABLED";
  isActive: boolean;
  emailVerified: boolean;
  roles: UserRole[];
};

export type RefereeAccountScope = { actorUserId: string; tournamentId: string };
export type RefereeAccountEnsureInput = RefereeAccountScope & {
  email: string; fullName?: string; phone?: string | null; idempotencyKey: string;
};
export type RefereeAccountEnsureResult = { account: RefereeAccountSummary; created: boolean; roleAdded: boolean };
export type RefereeAccessDelivery = { status: "PENDING" | "SENT" | "FAILED"; errorCode?: string; sentAt?: string };
export type RefereeAccessEmailInput = RefereeAccountScope & { userId: string; tournamentName: string; eventKey: string };
