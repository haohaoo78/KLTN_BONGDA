/** Read projections only; no additional match/assignment business states. */
export interface MatchOperationReadiness {
  matchId: string;
  tournamentId: string;
  tournamentStatus: string;
  matchStatus: string;
  assignmentStatus: "UNASSIGNED" | "PARTIAL" | "COMPLETE" | "CONFLICT" | "PUBLISHED";
  fixturePublished: boolean;
  teamsResolved: boolean;
  schedulePublished: boolean;
  crewPublished: boolean;
  publicationRevision: number | null;
  scheduledDate: string | null;
  canPrepare: boolean;
  canConfirmLineup: boolean;
  canStart: boolean;
  lineupsConfirmed: boolean;
  kickoffReached: boolean;
  issues: Array<{ code: string; message: string }>;
}
export interface TournamentOperationReadiness {
  tournamentId: string;
  tournamentStatus: string;
  matches: MatchOperationReadiness[];
  stats: { total: number; unassigned: number; draft: number; published: number; needsReview: number; ready: number; inProgress: number; finished: number };
  allAssignmentsPublished: boolean;
  canOpenOperations: boolean;
}
