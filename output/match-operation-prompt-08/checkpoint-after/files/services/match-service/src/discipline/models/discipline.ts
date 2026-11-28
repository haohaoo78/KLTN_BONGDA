export type CardType = "YELLOW" | "RED";

export interface Card {
  id: string;
  playerId: string;
  matchId: string;
  tournamentId: string;
  teamId: string;
  cardType: CardType;
  minute: number | null;
  reason: string | null;
  issuedBy: string;
  issuedAt: string;
}

export interface CardCreateInput {
  playerId: string;
  matchId: string;
  tournamentId: string;
  teamId: string;
  cardType: CardType;
  minute?: number;
  reason?: string;
  sourceEventId?: string;
}

export type SuspensionType = "YELLOW_CARDS" | "RED_CARD" | "DISCIPLINARY";

export interface Suspension {
  id: string;
  playerId: string;
  tournamentId: string;
  teamId: string;
  type: SuspensionType;
  startDate: string;
  endDate: string;
  reason: string | null;
  matchId: string | null;
  issuedBy: string;
  issuedAt: string;
  isActive: boolean;
  matchesSuspended: number | null;
}

export interface SuspensionCreateInput {
  playerId: string;
  tournamentId: string;
  teamId: string;
  type: SuspensionType;
  startDate: string;
  endDate: string;
  reason?: string;
  matchId?: string;
  sourceCardId?: string;
  matchesSuspended?: number | null;
}

export type ComplaintStatus = "PENDING" | "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "CLOSED";

export interface Complaint {
  id: string;
  matchId: string;
  tournamentId: string;
  teamId: string;
  submittedBy: string;
  complaintType: string;
  description: string;
  evidence: string | null;
  status: ComplaintStatus;
  submittedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  decision: string | null;
  decisionReason: string | null;
}

export interface ComplaintCreateInput {
  matchId: string;
  tournamentId: string;
  teamId: string;
  submittedBy: string;
  complaintType: string;
  description: string;
  evidence?: string;
}

export interface ComplaintUpdateInput {
  status?: ComplaintStatus;
  decision?: string;
  decisionReason?: string;
}

export type ComplaintAppealStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface ComplaintAppeal {
  id: string;
  complaintId: string;
  submittedBy: string;
  description: string;
  evidence: string | null;
  status: ComplaintAppealStatus;
  submittedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  decisionReason: string | null;
  originalDecision: {
    status: ComplaintStatus;
    reviewedBy: string | null;
    reviewedAt: string | null;
    decision: string | null;
    decisionReason: string | null;
  } | null;
}

export interface ComplaintAppealCreateInput {
  complaintId: string;
  submittedBy: string;
  description: string;
  evidence?: string;
}

export interface ComplaintAppealReviewInput {
  status: Exclude<ComplaintAppealStatus, "PENDING">;
  decisionReason: string;
}

export interface DisciplinaryDecision {
  id: string;
  complaintId: string | null;
  playerId: string | null;
  action: string;
  additionalMatchesSuspended: number | null;
  startDate: string | null;
  endDate: string | null;
  issuedBy: string;
  issuedAt: string;
  notes: string | null;
  suspensionId: string | null;
}

export interface DisciplinaryDecisionCreateInput {
  complaintId?: string;
  playerId?: string;
  action: string;
  additionalMatchesSuspended?: number;
  startDate?: string;
  endDate?: string;
  notes?: string;
}
