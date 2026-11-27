export type SquadEntry = { playerId: string; jerseyNumber: number | null; position: string | null; isStarting: boolean };
export type SquadIssue = { code: string; message: string; playerId?: string; field?: string };
export type SquadPlayer = { id: string; fullName: string; avatarUrl: string | null; position: string | null; jerseyNumber: number | null; eligible: boolean; reasons: string[] };
export type MatchSquad = { matchId: string; teamId: string; revision: number; status: "DRAFT" | "SUBMITTED" | "CHANGES_REQUESTED"; submittedAt: string | null; reviewedAt: string | null; note: string | null; rosterRevision: string | null; entries: SquadEntry[]; issues: SquadIssue[]; valid: boolean };
export type PreparationIssue = { id: string; matchId: string; teamId: string | null; kind: string; description: string; resolvedAt: string | null; resolution: string | null; createdAt: string };
export type MatchPreparation = { squads: MatchSquad[]; issues: PreparationIssue[]; ready: boolean; inconsistent: boolean };
export type SquadRoster = { teamId: string; tournamentId: string; teamName: string; logoUrl: string | null; captainId: string | null; registrationStatus: string | null; revision: string; players: SquadPlayer[] };
