export type TournamentStatus =
  | "DRAFT"
  | "OPEN_REGISTRATION"
  | "REGISTRATION_CLOSED"
  | "ROSTER_LOCKED"
  | "PREPARING"
  | "IN_PROGRESS"
  | "PAUSED"
  | "COMPLETED"
  | "CANCELLED";

export type TournamentScope = "SINGLE_INSTITUTION" | "INTER_SCHOOL";
export type InstitutionLevel = "UNIVERSITY" | "COLLEGE";
export interface InstitutionTeamLimit {
  institutionId: string;
  maxTeams: number | null;
}
export type FootballFormat = 7 | 11;
export type CompetitionFormat = "ROUND_ROBIN" | "GROUP_AND_KNOCKOUT" | "KNOCKOUT";
export type RankingCriterion =
  | "POINTS"
  | "GOAL_DIFFERENCE"
  | "GOALS_FOR"
  | "HEAD_TO_HEAD"
  | "FAIR_PLAY"
  | "LOT_DRAW";
export type ForfeitPolicy = "ORGANIZER_DECISION" | "WALKOVER" | "NO_AUTOMATIC_RESULT";

export interface Tournament {
  id: string;
  name: string;
  description: string | null;
  status: TournamentStatus;
  location: string | null;
  organizerName: string | null;
  organizerContactName: string | null;
  organizerEmail: string | null;
  organizerPhone: string | null;
  scope: TournamentScope;
  footballFormat: FootballFormat;
  competitionFormat: CompetitionFormat;
  minTeams: number;
  maxTeams: number;
  minPlayers: number;
  maxPlayersPerTeam: number;
  startDate: string | null;
  endDate: string | null;
  organizingInstitutionId?: string | null;
  registrationPeriods?: RegistrationPeriod[];
  allowedInstitutionIds?: string[];
  allowedInstitutionLevels?: InstitutionLevel[];
  allInstitutionsAllowed?: boolean;
  defaultMaxTeamsPerInstitution?: number | null;
  institutionTeamLimits?: InstitutionTeamLimit[];
  rankingCriteria?: RankingCriterion[];
  rules?: TournamentRules | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface TournamentCreateInput {
  name: string;
  description?: string;
  location: string;
  organizerName: string;
  organizerContactName: string;
  organizerEmail: string;
  organizerPhone: string;
  scope: TournamentScope;
  allowedInstitutionIds: string[];
  allowedInstitutionLevels: InstitutionLevel[];
  allInstitutionsAllowed: boolean;
  defaultMaxTeamsPerInstitution: number | null;
  institutionTeamLimits: InstitutionTeamLimit[];
  organizingInstitutionId: string;
  footballFormat: FootballFormat;
  competitionFormat: CompetitionFormat;
  minTeams: number;
  maxTeams: number;
  minPlayers: number;
  maxPlayersPerTeam: number;
  startDate: string;
  endDate: string;
  registrationStart: string;
  registrationEnd: string;
  eligibilityDescription: string;
  pointsForWin: number;
  pointsForDraw: number;
  pointsForLoss: number;
  rankingCriteria: RankingCriterion[];
  advancingTeamsPerGroup: number;
  yellowCardsForSuspension: number;
  suspensionMatches: number;
  complaintWindowHours: number;
  minimumRestMinutes: number;
  matchDurationMinutes: number;
  forfeitPolicy: ForfeitPolicy;
  forfeitWinnerScore: number;
  forfeitLoserScore: number;
  createdBy: string;
}

export interface TournamentRules {
  eligibilityDescription: string;
  pointsForWin: number;
  pointsForDraw: number;
  pointsForLoss: number;
  advancingTeamsPerGroup: number;
  yellowCardsForSuspension: number;
  suspensionMatches: number;
  complaintWindowHours: number;
  minimumRestMinutes: number;
  matchDurationMinutes: number;
  forfeitPolicy: ForfeitPolicy;
  forfeitWinnerScore: number;
  forfeitLoserScore: number;
  publishedVersion: number;
  publishedAt: string | null;
}

export interface TournamentUpdateInput {
  name?: string;
  description?: string;
  status?: TournamentStatus;
  location?: string;
  maxTeams?: number;
  startDate?: string;
  endDate?: string;
}

export interface RegistrationPeriod {
  id: string;
  tournamentId: string;
  name: string;
  startDate: string;
  endDate: string;
  createdAt: string;
}

export interface RegistrationPeriodCreateInput {
  tournamentId: string;
  name: string;
  startDate: string;
  endDate: string;
}

export interface Regulation {
  id: string;
  tournamentId: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface RegulationCreateInput {
  tournamentId: string;
  title: string;
  content: string;
}

export interface RegulationUpdateInput {
  title?: string;
  content?: string;
}

export interface Season {
  id: string;
  name: string;
  year: number;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SeasonCreateInput {
  name: string;
  year: number;
  description?: string;
}

export interface RegulationVersion {
  id: string;
  tournamentId: string;
  version: number;
  title: string;
  content: string;
  effectiveDate: string;
  createdBy: string;
  createdAt: string;
}

export interface RegulationVersionCreateInput {
  tournamentId: string;
  version: number;
  title: string;
  content: string;
  effectiveDate: string;
}

export type GroupStage = "GROUP_STAGE" | "QUARTER_FINALS" | "SEMI_FINALS" | "FINAL";

export interface Group {
  id: string;
  tournamentId: string;
  name: string;
  stage: GroupStage;
  maxTeams: number;
  createdAt: string;
}

export interface GroupCreateInput {
  tournamentId: string;
  name: string;
  stage: GroupStage;
  maxTeams?: number;
}

export interface Draw {
  id: string;
  tournamentId: string;
  groupId: string | null;
  teamId: string;
  position: number;
  drawnAt: string;
  drawnBy: string;
}

export interface DrawCreateInput {
  tournamentId: string;
  groupId?: string;
  teamId: string;
  position: number;
}
