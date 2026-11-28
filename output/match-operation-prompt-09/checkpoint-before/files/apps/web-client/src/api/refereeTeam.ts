import { apiFetch } from "./client";

export type RefereeTeamLevel = "UNVERIFIED" | "ENTRY" | "CITY" | "NATIONAL" | "INTERNATIONAL";
export type RefereeTeamPosition = "REFEREE" | "ASSISTANT_REFEREE_1" | "ASSISTANT_REFEREE_2" | "ASSISTANT_REFEREE_3" | "ASSISTANT_REFEREE_4" | "FOURTH_OFFICIAL" | "MATCH_SECRETARY";
export type RefereeTeamIdentity = {
  email: string;
  fullName: string;
  phone: string | null;
  accountStatus: string;
  isActive: boolean;
  emailVerified: boolean;
  roles: string[];
};
export type RefereeTeamProfile = {
  organization: string;
  club: string;
  formats: Array<5 | 7 | 11>;
  level: RefereeTeamLevel;
  experienceYears: number;
  positions: RefereeTeamPosition[];
  unavailablePeriods: Array<{ id: string; startAt: string; endAt: string; reason: string }>;
  notes: string;
};
export type RefereeTeamMember = {
  id: string;
  userId: string;
  identity: RefereeTeamIdentity;
  profile: RefereeTeamProfile;
  assignmentCount: number;
  accessEmail: { status: "PENDING" | "SENT" | "FAILED"; lastAttemptAt: string | null; sentAt: string | null; errorCode?: string };
  createdAt: string;
  updatedAt: string;
};
export type RefereeTeamResponse = {
  tournamentId: string;
  readOnly: boolean;
  readOnlyReason: string | null;
  members: RefereeTeamMember[];
  stats: { totalMembers: number; assignedMembers: number; unassignedMembers: number; totalAssignments: number };
};
export type RefereeAccountLookup = {
  found: boolean;
  account: (RefereeTeamIdentity & { userId: string }) | null;
  alreadyMember: boolean;
};
export type RefereeTeamCreateInput = {
  email: string;
  fullName?: string;
  phone?: string;
  profile: RefereeTeamProfile;
  requestId: string;
};

const teamPath = (tournamentId: string) => `/tournaments/${encodeURIComponent(tournamentId)}/referee-team`;

export function getRefereeTeam(tournamentId: string): Promise<RefereeTeamResponse> {
  return apiFetch(teamPath(tournamentId));
}

export function lookupRefereeAccount(tournamentId: string, email: string): Promise<RefereeAccountLookup> {
  return apiFetch(`${teamPath(tournamentId)}/account-lookup?email=${encodeURIComponent(email)}`);
}

export function addRefereeTeamMember(tournamentId: string, input: RefereeTeamCreateInput): Promise<{ member: RefereeTeamMember }> {
  return apiFetch(teamPath(tournamentId), { method: "POST", body: JSON.stringify(input) });
}

export function updateRefereeTeamMember(tournamentId: string, memberId: string, profile: RefereeTeamProfile): Promise<{ member: RefereeTeamMember }> {
  return apiFetch(`${teamPath(tournamentId)}/${encodeURIComponent(memberId)}`, { method: "PATCH", body: JSON.stringify({ profile }) });
}

export function resendRefereeAccessEmail(tournamentId: string, memberId: string, requestId: string): Promise<{ member: RefereeTeamMember }> {
  return apiFetch(`${teamPath(tournamentId)}/${encodeURIComponent(memberId)}/resend-access`, { method: "POST", body: JSON.stringify({ requestId }) });
}
