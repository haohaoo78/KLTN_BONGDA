export type TeamStatus = "ACTIVE" | "INACTIVE";

export interface Team {
  id: string;
  name: string;
  shortName: string | null;
  description: string | null;
  logoUrl: string | null;
  institutionId: string | null;
  institutionName?: string | null;
  unitName: string | null;
  representativeName: string | null;
  kitColor: string | null;
  captainId: string;
  isPlayer?: boolean;
  contactEmail: string | null;
  contactPhone: string | null;
  maxPlayers: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TeamCreateInput {
  name: string;
  shortName?: string;
  description?: string;
  logoUrl?: string;
  institutionId: string;
  unitName?: string;
  representativeName?: string;
  kitColor?: string;
  captainId: string;
  contactEmail?: string;
  contactPhone?: string;
  maxPlayers?: number;
}

export interface TeamUpdateInput {
  name?: string;
  shortName?: string | null;
  description?: string;
  logoUrl?: string;
  institutionId?: string;
  unitName?: string | null;
  representativeName?: string | null;
  kitColor?: string | null;
  captainId?: string;
  contactEmail?: string;
  contactPhone?: string;
  maxPlayers?: number;
  isActive?: boolean;
}

export type ClubRequestStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface ClubRequest {
  id: string;
  applicantId: string;
  institutionId: string;
  captainName: string;
  name: string;
  shortName: string | null;
  description: string | null;
  logoUrl: string | null;
  unitName: string | null;
  contactEmail: string;
  contactPhone: string;
  initialMembers: Array<Record<string, unknown>>;
  status: ClubRequestStatus;
  decisionNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  approvedTeamId: string | null;
  createdAt: string;
}

export type RegistrationStatus = "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN";

export interface TeamRegistration {
  id: string;
  teamId: string;
  tournamentId: string;
  status: RegistrationStatus;
  registeredAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
  notes: string | null;
  institutionId: string | null;
  institutionName?: string | null;
}

export interface TeamRegistrationCreateInput {
  id: string;
  teamId: string;
  tournamentId: string;
  institutionId: string;
  notes?: string;
}

export interface TeamRegistrationUpdateInput {
  status?: RegistrationStatus;
  notes?: string;
}

export interface Player {
  id: string;
  teamId: string;
  userId: string | null;
  fullName: string | null;
  birthDate: string | null;
  studentId: string | null;
  contactEmail: string | null;
  evidenceUrl: string | null;
  jerseyNumber: number | null;
  position: string | null;
  isCaptain: boolean;
  joinedAt: string;
  leftAt: string | null;
}

export interface PlayerCreateInput {
  teamId: string;
  userId?: string;
  fullName: string;
  birthDate?: string;
  studentId?: string;
  contactEmail?: string;
  evidenceUrl?: string;
  jerseyNumber?: number;
  position?: string;
  isCaptain?: boolean;
}

export interface PlayerUpdateInput {
  fullName?: string;
  birthDate?: string | null;
  studentId?: string | null;
  contactEmail?: string | null;
  evidenceUrl?: string | null;
  jerseyNumber?: number;
  position?: string;
  isCaptain?: boolean;
  leftAt?: string | null;
}

export interface Institution {
  id: string;
  name: string;
  shortName: string | null;
  code: string | null;
  admissionCode: string | null;
  institutionType: "UNIVERSITY" | "COLLEGE" | "OTHER";
  address: string | null;
  officialWebsite: string | null;
  city: string | null;
  dataSourceUrl: string | null;
  dataCollectedAt: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  status: "DRAFT" | "ACTIVE" | "SUSPENDED";
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InstitutionCreateInput {
  name: string;
  code?: string | null;
  shortName?: string;
  admissionCode?: string;
  institutionType?: "UNIVERSITY" | "COLLEGE" | "OTHER";
  address?: string;
  officialWebsite?: string;
  city?: string;
  dataSourceUrl?: string;
  dataCollectedAt?: string;
  contactEmail?: string;
  contactPhone?: string;
}

export interface InstitutionUpdateInput {
  name?: string;
  code?: string | null;
  shortName?: string | null;
  admissionCode?: string | null;
  institutionType?: "UNIVERSITY" | "COLLEGE" | "OTHER";
  address?: string | null;
  officialWebsite?: string | null;
  city?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
}

export interface Roster {
  id: string;
  teamId: string;
  tournamentId: string;
  playerId: string;
  lineupRole: "STARTER" | "SUBSTITUTE";
  isGoalkeeper: boolean;
  evidenceUrl: string | null;
  isVerified: boolean;
  verifiedAt: string | null;
  reviewStatus: "PENDING" | "APPROVED" | "REVISION_REQUIRED" | "REJECTED";
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface RosterCreateInput {
  teamId: string;
  tournamentId: string;
  playerId: string;
  lineupRole?: "STARTER" | "SUBSTITUTE";
  isGoalkeeper?: boolean;
  evidenceUrl?: string;
}

export type PlayerRequestStatus = "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN";

export interface PlayerRequest {
  id: string;
  teamId: string;
  userId: string;
  fullName: string | null;
  birthDate: string | null;
  studentId: string | null;
  contactEmail: string | null;
  profileData: Record<string, string | null>;
  message: string | null;
  status: PlayerRequestStatus;
  createdAt: string;
  respondedAt: string | null;
  reviewedBy: string | null;
  decisionReason: string | null;
}

export interface PlayerRequestCreateInput {
  teamId: string;
  userId: string;
  fullName: string;
  birthDate?: string;
  studentId?: string;
  contactEmail?: string;
  profileData?: Record<string, string | null>;
  message?: string;
}
