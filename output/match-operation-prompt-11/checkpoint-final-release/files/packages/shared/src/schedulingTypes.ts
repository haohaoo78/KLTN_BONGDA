/** Scheduling domain contracts shared by the web client and Match Service.
 * Persistence mode may differ, but validation and planning use these exact shapes.
 */
export type DemoFixture = {
  id: string;
  stage: "GROUP" | "KNOCKOUT";
  groupName?: string;
  round: string;
  roundNumber?: number;
  leg?: number;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeSource?: string;
  awaySource?: string;
  bye?: boolean;
};

export type DemoScheduleEntry = {
  scheduledAt: string;
  durationMinutes: number | null;
  venue: string;
  slotId?: string;
  refereeNames: string[];
  notes: string;
  locked?: boolean;
  officialStatus?: "DRAFT" | "PUBLISHED" | "CANCELLED" | "RESCHEDULED";
};

export type DemoScheduleSlot = { id: string; label: string; start: string; end: string; priority?: "PREFERRED" | "NORMAL" | "RESTRICTED" };
export type DemoVenueUnavailablePeriod = { id: string; startAt: string; endAt: string; reason: string };
export type DemoVenueAvailabilityWindow = { id: string; start: string; end: string };
export type DemoVenueDateOverride = { date: string; unavailable: boolean; availableSlots: DemoVenueAvailabilityWindow[] };
export type DemoScheduleLocation = { id: string; name: string; address: string; contactName?: string; contactPhone?: string; notes?: string };
export type DemoScheduleAvailabilityProfile = { id: string; name: string; weekdays: number[]; availableFrom: string; availableTo: string; availableSlots?: DemoVenueAvailabilityWindow[]; unavailablePeriods: DemoVenueUnavailablePeriod[]; availabilityConfirmed: boolean };
export type ScheduleSettingSource = "REGULATION" | "CALCULATED" | "SYSTEM_PROPOSED" | "ORGANIZER_CONFIRMED";
export type ScheduleSettingProvenance = { source: ScheduleSettingSource; sourceLabel: string; explanation: string; confirmed: boolean; adjustable: boolean };
export type DemoScheduleVenue = {
  id: string; code: string; name: string; location: string; pitchType: 5 | 7 | 11; active: boolean;
  weekdays: number[]; availableFrom: string; availableTo: string; availableSlots?: DemoVenueAvailabilityWindow[]; turnaroundMinutes: number;
  unavailablePeriods: DemoVenueUnavailablePeriod[]; central?: boolean; preferredStages?: string[];
  travelZone?: string; homeTeamId?: string; locationId?: string; availabilityProfileId?: string; availabilityConfirmed?: boolean;
  availabilityStartDate?: string; availabilityEndDate?: string; dateOverrides?: DemoVenueDateOverride[];
};
export type DemoMatchTimingProfile = {
  halfMinutes: number; halftimeBreakMinutes: number; preparationBeforeMinutes: number;
  transitionAfterMinutes: number; extraTimeReserveMinutes: number; penaltyReserveMinutes: number;
};
export type DemoScheduleResources = {
  competitionStartDate: string; competitionEndDate: string; allowedWeekdays: number[]; slots: DemoScheduleSlot[];
  officialCompetitionStartDate?: string; officialCompetitionEndDate?: string;
  blockedDates: string[]; groupTiming: DemoMatchTimingProfile; knockoutTiming: DemoMatchTimingProfile;
  minimumTeamRestMinutes: number; maximumMatchesPerTeamPerDay: number; travelBufferMinutes: number;
  venues: DemoScheduleVenue[]; locations?: DemoScheduleLocation[]; availabilityProfiles?: DemoScheduleAvailabilityProfile[];
  setupProvenance?: Record<string, ScheduleSettingProvenance>;
  setupRegulationVersion?: number | null;
  stageDateRanges?: Partial<Record<"GROUP" | "KNOCKOUT", { startDate: string; endDate: string }>>;
  defaultObjectives?: AutoScheduleObjective[];
  scheduleMode?: "CENTRALIZED" | "HOME_AWAY"; maximumRoundsPerDay?: number;
  requireSimultaneousGroupFinalRound?: boolean; rotateVenues?: boolean; rotateTimeSlots?: boolean;
  maximumKnockoutRestDifferenceMinutes?: number; enforceKnockoutRestDifference?: boolean;
  centralVenuePreferredStages?: string[]; maximumConsecutiveHomeAway?: number;
  maximumRoundsPerDayRequired?: boolean; sameVenueAcrossRoundRequired?: boolean;
  rotateTimeSlotsRequired?: boolean; maximumKnockoutRestDifferenceRequired?: boolean;
};
export type AutoScheduleObjective = "MINIMIZE_CHANGES" | "COMPLETION" | "REST" | "FAIRNESS" | "TRAVEL" | "VENUE_USE" | "BRANCH_REST" | "CENTRAL_VENUE";
export type AutoScheduleScope = { phase: "ALL" | "GROUP" | "KNOCKOUT"; groups: string[]; rounds: string[]; onlyUnscheduled: boolean; legs?: number[]; fixtureIds?: string[]; dateRange?: { start: string; end: string } };
export type AutoScheduleConfiguration = { scope: AutoScheduleScope; objectives: AutoScheduleObjective[]; maxRuntimeMs: number };
export type AutoScheduleMissingFixture = { fixtureId: string; reason: string };
export type AutoSchedulePreview = {
  status: "COMPLETE" | "PARTIAL" | "INFEASIBLE" | "TIMEOUT" | "NO_TARGETS";
  generatedAt: string; elapsedMs: number; exploredNodes: number; selectedFixtureIds: string[];
  scheduledFixtureIds: string[]; missing: AutoScheduleMissingFixture[];
  proposedEntries: Record<string, DemoScheduleEntry>; baseSignature: string; warnings: string[];
  searchLimitReached?: boolean;
  candidateRejections?: Array<{ code: string; count: number; examples: string[] }>;
};

export type DemoRefereePosition = { id: string; label: string };
export type DemoRefereeAssignment = {
  positionId: string; slotIndex?: number; refereeId?: string; refereeName: string;
  eligibilityConfirmed: boolean; availabilityConfirmed: boolean; locked?: boolean;
  source?: "INDIVIDUAL" | "CREW"; crewId?: string;
  validationStatus?: "VALID" | "NEEDS_RECHECK"; validationMessages?: string[];
};
export type DemoRefereeAvailabilityWindow = { id: string; weekday: number; start: string; end: string };
export type DemoRefereeUnavailablePeriod = { id: string; startAt: string; endAt: string; reason: string };
export type DemoRefereeResource = {
  id: string; source: "ACCOUNT" | "VIRTUAL"; userId?: string; email?: string; displayName: string;
  organization?: string; club?: string; formats: Array<5 | 7 | 11>; level: string; experienceYears: number;
  positionIds: string[]; availability: DemoRefereeAvailabilityWindow[]; unavailablePeriods: DemoRefereeUnavailablePeriod[];
  minimumRestMinutes: number; maximumMatchesPerDay: number;
  participationStatus: "ACTIVE" | "INVITED" | "WITHDRAWN"; dutyStatus: "ACTIVE" | "PAUSED" | "SUSPENDED";
  dutyStatusFrom?: string; dutyStatusTo?: string; dutyStatusReason?: string; notes?: string;
};
export type DemoRefereeModelPosition = {
  id: string; code: string; label: string; requiredCount: number; required: boolean; formats: Array<5 | 7 | 11>;
  minimumLevel: string; minimumExperienceYears: number; duties: string; permissions: string[]; confirmsResult: boolean;
};
export type DemoRefereePositionModel = { id: string; name: string; positions: DemoRefereeModelPosition[]; stageScopes: string[]; isDefault: boolean };
export type DemoRefereeCrewTemplate = { id: string; name: string; positionIds: string[]; positionCounts?: Record<string, number>; notes: string };
export type DemoRefereeCrew = {
  id: string; code: string; name: string; templateId: string;
  members: Array<{ refereeId: string; positionId: string; slotIndex?: number }>;
  status: "ACTIVE" | "PAUSED" | "RETIRED";
};
export type DemoRefereeNeutralRule = { id: string; scope: "CLUB" | "SCHOOL" | "UNIT" | "OTHER"; value: string; mandatory: boolean; note: string };
export type DemoRefereeMatchRequirement = {
  importance: "ORDINARY" | "QUALIFICATION" | "PLACEMENT" | "DECISIVE" | "SEMIFINAL" | "FINAL";
  minimumLevel: string; minimumExperienceYears: number; positionModelId: string;
};
export type DemoRefereeEvaluationRecord = {
  id: string; fixtureId: string; refereeId: string; rating: number | null; incident: string;
  verificationStatus: "UNVERIFIED" | "VERIFIED" | "DISMISSED";
  suspensionDecision: "NONE" | "REVIEW_REQUIRED" | "SUSPENDED" | "CLEARED"; decidedBy?: string; decidedAt?: string;
};
export type DemoRefereeResourceState = {
  referees: DemoRefereeResource[]; models: DemoRefereePositionModel[]; crewTemplates: DemoRefereeCrewTemplate[];
  crews: DemoRefereeCrew[]; neutralRules: DemoRefereeNeutralRule[];
  matchRequirements: Record<string, DemoRefereeMatchRequirement>;
  repeatTeamDutyLimit?: { maximum: number; mandatory: boolean }; evaluations: DemoRefereeEvaluationRecord[];
};
