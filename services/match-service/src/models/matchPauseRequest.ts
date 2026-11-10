export type MatchPauseRequestStatus = "PENDING" | "APPROVED" | "REJECTED";

export type MatchPauseRequest = {
  id: string;
  matchId: string;
  requestedBy: string;
  reason: string;
  status: MatchPauseRequestStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
};
