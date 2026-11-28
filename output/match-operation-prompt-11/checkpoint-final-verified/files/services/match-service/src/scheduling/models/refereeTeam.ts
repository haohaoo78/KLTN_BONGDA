export type RefereeQualificationLevel = "UNVERIFIED" | "ENTRY" | "CITY" | "NATIONAL" | "INTERNATIONAL";

export type RefereeTeamProfile = {
  organization: string;
  club: string;
  formats: Array<5 | 7 | 11>;
  level: RefereeQualificationLevel;
  experienceYears: number;
  positions: string[];
  unavailablePeriods: Array<{ id: string; startAt: string; endAt: string; reason: string }>;
  notes: string;
};

export type RefereeAccount = {
  userId: string;
  email: string;
  fullName: string;
  phone: string | null;
  accountStatus: string;
  isActive: boolean;
  emailVerified: boolean;
  roles: string[];
};

export type RefereeAccessEmail = {
  status: "PENDING" | "SENT" | "FAILED";
  lastAttemptAt: string | null;
  sentAt: string | null;
  errorCode?: string;
};

export type RefereeTeamMemberRecord = {
  id: string;
  tournamentId: string;
  userId: string;
  profile: RefereeTeamProfile;
  assignmentCount: number;
  accessEmail: RefereeAccessEmail;
  createdAt: string;
  updatedAt: string;
};

export type RefereeAccessEmailEvent = {
  id: string;
  memberId: string;
  tournamentId: string;
  userId: string;
  requestedBy: string;
  requestId: string;
  operation: "ADD" | "RESEND";
  status: "PENDING" | "SENDING" | "SENT" | "FAILED";
  eventKey: string;
};
