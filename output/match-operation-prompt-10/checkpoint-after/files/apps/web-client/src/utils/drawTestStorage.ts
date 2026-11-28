import type { DrawTestConfiguration } from "../api/competition";
import { ApiError } from "../api/client";
import {
  getDrawWorkflowTestState,
  getPublicDrawWorkflowTestState,
  getPublicScheduleWorkflowTestState,
  getScheduleWorkflowTestState,
  resetDrawWorkflowTestState,
  resetScheduleWorkflowTestState,
  saveDrawWorkflowTestState,
  saveScheduleWorkflowTestState,
} from "../api/testWorkflow";

export type DemoAllocationMethod = "DIRECT" | "RANDOM" | "MANUAL";
export type DemoPublishedAllocation = {
  method: DemoAllocationMethod;
  format: DrawTestConfiguration["format"];
  teamIds: string[];
  teamsPerGroup: number[];
  slots: Array<string | null>;
  byePositions?: number[];
  groupCount: number;
  qualifiersPerGroup: number;
  extraQualificationSlots: number;
  publishedAt: string;
};
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
export type DemoRefereePosition = { id: string; label: string };
export type DemoRefereeAssignment = {
  positionId: string;
  slotIndex?: number;
  refereeId?: string;
  refereeName: string;
  eligibilityConfirmed: boolean;
  availabilityConfirmed: boolean;
  locked?: boolean;
  source?: "INDIVIDUAL" | "CREW";
  crewId?: string;
  validationStatus?: "VALID" | "NEEDS_RECHECK";
  validationMessages?: string[];
};
export type DemoRefereeAvailabilityWindow = { id: string; weekday: number; start: string; end: string };
export type DemoRefereeUnavailablePeriod = { id: string; startAt: string; endAt: string; reason: string };
export type DemoRefereeResource = {
  id: string;
  source: "ACCOUNT" | "VIRTUAL";
  userId?: string;
  email?: string;
  displayName: string;
  organization?: string;
  club?: string;
  formats: Array<5 | 7 | 11>;
  level: string;
  experienceYears: number;
  positionIds: string[];
  availability: DemoRefereeAvailabilityWindow[];
  unavailablePeriods: DemoRefereeUnavailablePeriod[];
  minimumRestMinutes: number;
  maximumMatchesPerDay: number;
  participationStatus: "ACTIVE" | "INVITED" | "WITHDRAWN";
  dutyStatus: "ACTIVE" | "PAUSED" | "SUSPENDED";
  dutyStatusFrom?: string;
  dutyStatusTo?: string;
  dutyStatusReason?: string;
  notes?: string;
};
export type DemoRefereeModelPosition = {
  id: string;
  code: string;
  label: string;
  requiredCount: number;
  required: boolean;
  formats: Array<5 | 7 | 11>;
  minimumLevel: string;
  minimumExperienceYears: number;
  duties: string;
  permissions: string[];
  confirmsResult: boolean;
};
export type DemoRefereePositionModel = {
  id: string;
  name: string;
  positions: DemoRefereeModelPosition[];
  stageScopes: string[];
  isDefault: boolean;
};
export type DemoRefereeCrewTemplate = { id: string; name: string; positionIds: string[]; positionCounts?: Record<string, number>; notes: string };
export type DemoRefereeCrew = {
  id: string;
  code: string;
  name: string;
  templateId: string;
  members: Array<{ refereeId: string; positionId: string; slotIndex?: number }>;
  status: "ACTIVE" | "PAUSED" | "RETIRED";
};
export type DemoRefereeNeutralRule = {
  id: string;
  scope: "CLUB" | "SCHOOL" | "UNIT" | "OTHER";
  value: string;
  mandatory: boolean;
  note: string;
};
export type DemoRefereeMatchRequirement = {
  importance: "ORDINARY" | "QUALIFICATION" | "PLACEMENT" | "DECISIVE" | "SEMIFINAL" | "FINAL";
  minimumLevel: string;
  minimumExperienceYears: number;
  positionModelId: string;
};
export type DemoRefereeEvaluationRecord = {
  id: string;
  fixtureId: string;
  refereeId: string;
  rating: number | null;
  incident: string;
  verificationStatus: "UNVERIFIED" | "VERIFIED" | "DISMISSED";
  suspensionDecision: "NONE" | "REVIEW_REQUIRED" | "SUSPENDED" | "CLEARED";
  decidedBy?: string;
  decidedAt?: string;
};
export type DemoRefereeResourceState = {
  referees: DemoRefereeResource[];
  models: DemoRefereePositionModel[];
  crewTemplates: DemoRefereeCrewTemplate[];
  crews: DemoRefereeCrew[];
  neutralRules: DemoRefereeNeutralRule[];
  matchRequirements: Record<string, DemoRefereeMatchRequirement>;
  repeatTeamDutyLimit?: { maximum: number; mandatory: boolean };
  evaluations: DemoRefereeEvaluationRecord[];
};
export type DemoPublishedScheduleVersion = {
  version: number;
  diagramSnapshotKey: string;
  publishedAt: string;
  publishedBy: string;
  scheduleByFixture: Record<string, DemoScheduleEntry>;
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
  id: string;
  code: string;
  name: string;
  location: string;
  pitchType: 5 | 7 | 11;
  active: boolean;
  weekdays: number[];
  availableFrom: string;
  availableTo: string;
  availableSlots?: DemoVenueAvailabilityWindow[];
  turnaroundMinutes: number;
  unavailablePeriods: DemoVenueUnavailablePeriod[];
  availabilityStartDate?: string;
  availabilityEndDate?: string;
  dateOverrides?: DemoVenueDateOverride[];
  locationId?: string;
  availabilityProfileId?: string;
  availabilityConfirmed?: boolean;
  central?: boolean;
  preferredStages?: string[];
  travelZone?: string;
  homeTeamId?: string;
};
export type DemoMatchTimingProfile = {
  halfMinutes: number;
  halftimeBreakMinutes: number;
  preparationBeforeMinutes: number;
  transitionAfterMinutes: number;
  extraTimeReserveMinutes: number;
  penaltyReserveMinutes: number;
};
export type DemoScheduleResources = {
  competitionStartDate: string;
  competitionEndDate: string;
  officialCompetitionStartDate?: string;
  officialCompetitionEndDate?: string;
  allowedWeekdays: number[];
  slots: DemoScheduleSlot[];
  blockedDates: string[];
  groupTiming: DemoMatchTimingProfile;
  knockoutTiming: DemoMatchTimingProfile;
  minimumTeamRestMinutes: number;
  maximumMatchesPerTeamPerDay: number;
  travelBufferMinutes: number;
  venues: DemoScheduleVenue[];
  locations?: DemoScheduleLocation[];
  availabilityProfiles?: DemoScheduleAvailabilityProfile[];
  setupProvenance?: Record<string, ScheduleSettingProvenance>;
  setupRegulationVersion?: number | null;
  stageDateRanges?: Partial<Record<"GROUP" | "KNOCKOUT", { startDate: string; endDate: string }>>;
  defaultObjectives?: AutoScheduleObjective[];
  scheduleMode?: "CENTRALIZED" | "HOME_AWAY";
  maximumRoundsPerDay?: number;
  requireSimultaneousGroupFinalRound?: boolean;
  rotateVenues?: boolean;
  rotateTimeSlots?: boolean;
  maximumKnockoutRestDifferenceMinutes?: number;
  enforceKnockoutRestDifference?: boolean;
  centralVenuePreferredStages?: string[];
  maximumConsecutiveHomeAway?: number;
  maximumRoundsPerDayRequired?: boolean;
  sameVenueAcrossRoundRequired?: boolean;
  rotateTimeSlotsRequired?: boolean;
  maximumKnockoutRestDifferenceRequired?: boolean;
};
export type AutoScheduleObjective = "MINIMIZE_CHANGES" | "COMPLETION" | "REST" | "FAIRNESS" | "TRAVEL" | "VENUE_USE" | "BRANCH_REST" | "CENTRAL_VENUE";
export type AutoScheduleScope = {
  phase: "ALL" | "GROUP" | "KNOCKOUT";
  groups: string[];
  rounds: string[];
  onlyUnscheduled: boolean;
  legs?: number[];
  fixtureIds?: string[];
  dateRange?: { start: string; end: string };
};
export type AutoScheduleConfiguration = { scope: AutoScheduleScope; objectives: AutoScheduleObjective[]; maxRuntimeMs: number };
export type AutoScheduleMissingFixture = { fixtureId: string; reason: string };
export type AutoSchedulePreview = {
  status: "COMPLETE" | "PARTIAL" | "INFEASIBLE" | "TIMEOUT" | "NO_TARGETS";
  generatedAt: string;
  elapsedMs: number;
  exploredNodes: number;
  selectedFixtureIds: string[];
  scheduledFixtureIds: string[];
  missing: AutoScheduleMissingFixture[];
  proposedEntries: Record<string, DemoScheduleEntry>;
  baseSignature: string;
  warnings: string[];
  searchLimitReached?: boolean;
  candidateRejections?: Array<{ code: string; count: number; examples: string[] }>;
};
export type DemoStep5State = {
  diagramSnapshotKey: string;
  scheduleByFixture: Record<string, DemoScheduleEntry>;
  /** Legacy field kept only for reading older local test sessions. New publishes use schedulePublishedAt. */
  publishedAt: string | null;
  schedulePublishedAt?: string | null;
  schedulePublishedBy?: string | null;
  schedulePublishedDiagramSnapshotKey?: string | null;
  publishedScheduleByFixture?: Record<string, DemoScheduleEntry>;
  scheduleVersion?: number;
  publishedScheduleVersions?: DemoPublishedScheduleVersion[];
  refereePolicy?: { mode: "BY_PERIOD" | "WHOLE_TOURNAMENT"; publicationLeadDays: number | null };
  refereeScopeRounds?: string[];
  refereeScopeGroups?: string[];
  refereeScopeDates?: string[];
  refereePositions?: DemoRefereePosition[];
  refereeResources?: DemoRefereeResourceState;
  refereeAssignmentsByFixture?: Record<string, DemoRefereeAssignment[]>;
  refereeDraftScheduleSignature?: string | null;
  refereeDraftResourceSignature?: string | null;
  refereeLockedFixtureIds?: string[];
  lockedRefereeSlotKeysByFixture?: Record<string, string[]>;
  refereeAssignmentsPublishedAt?: string | null;
  refereeAssignmentsPublishedBy?: string | null;
  publishedRefereeAssignmentsByFixture?: Record<string, DemoRefereeAssignment[]>;
  refereePublishedFixtureIds?: string[];
  resources?: DemoScheduleResources;
  /** One-time BTC acknowledgement consumed by Match Service when a resource edit affects existing test schedules. */
  resourceChangeAcknowledgement?: { diagramVersion: string; resourceSignature: string; pitchType: 5 | 7 | 11; fixtureIds: string[] };
  autoConfiguration?: AutoScheduleConfiguration;
  autoPreview?: AutoSchedulePreview;
  simulationStatus?: "SIMULATED" | "SIMULATED_CUSTOMIZED" | "VALID" | "INVALID" | null;
  simulationValidation?: { checkedAt: string; diagramVersion: string; revision: number; validCount: number; invalidCount: number; warningCount: number; issues: Array<{ fixtureId: string; code: string; message: string; severity: "HARD" | "WARNING" }> } | null;
};
export type DrawTestState = {
  version: 1;
  tournamentId: string;
  configuration: DrawTestConfiguration | null;
  publication: DemoPublishedAllocation | null;
  fixtures: DemoFixture[];
  fixturesPublishedAt: string | null;
  directSession: Record<string, unknown> | null;
  /** Server-backed private allocation drafts; public snapshot projections omit these fields. */
  allocationDrafts?: Record<string, unknown>;
  allocationControl?: Record<string, unknown>;
  completedSteps: { step3: boolean; step4: boolean };
  step5?: DemoStep5State;
  /** Local workflow position: 4=draw, 5=fixtures, 6=scheduling, 7=referees, 8=operations. */
  currentStep: 4 | 5 | 6 | 7 | 8;
  updatedAt: string;
};

const changedEvent = "sfl:draw-test-state-changed";
const channelName = "sfl:draw-test-state";
let channel: BroadcastChannel | null = null;
const drawRevisions = new Map<string, number>();
const scheduleRevisions = new Map<string, number>();
export function getScheduleTestRevision(tournamentId: string): number | undefined { return scheduleRevisions.get(tournamentId); }
export function acknowledgeScheduleTestRevision(tournamentId: string, revision: number): void { scheduleRevisions.set(tournamentId, revision); }
export function acceptServerScheduleTestState(tournamentId: string, step5: DemoStep5State, revision: number): void {
  acknowledgeScheduleTestRevision(tournamentId, revision);
  const rootState = readDrawTestState(tournamentId);
  replaceLocalDrawTestState(tournamentId, { ...rootState, step5, updatedAt: new Date().toISOString() });
  clearPersistenceError(tournamentId, "schedule");
}
export async function ensureScheduleTestRevision(tournamentId: string): Promise<number> {
  let revision = scheduleRevisions.get(tournamentId);
  if (revision === undefined) {
    const existing = await getScheduleWorkflowTestState<DemoStep5State>(tournamentId);
    revision = existing.revision;
    scheduleRevisions.set(tournamentId, revision);
  }
  return revision;
}
const pendingDrawWrites = new Map<string, Promise<void>>();
const pendingScheduleWrites = new Map<string, Promise<void>>();
const persistenceErrorEvent = "sfl:draw-test-persistence-error";
const persistenceErrors = new Map<string, { draw?: unknown; schedule?: unknown }>();
function recordPersistenceError(tournamentId: string, scope: "draw" | "schedule", error: unknown) {
  persistenceErrors.set(tournamentId, { ...persistenceErrors.get(tournamentId), [scope]: error });
}
function clearPersistenceError(tournamentId: string, scope: "draw" | "schedule") {
  const remaining = { ...persistenceErrors.get(tournamentId) };
  delete remaining[scope];
  if (remaining.draw === undefined && remaining.schedule === undefined) persistenceErrors.delete(tournamentId);
  else persistenceErrors.set(tournamentId, remaining);
}

/** Local browser-only draw tests must never leak onto a hosted production site. */
export function isDrawTestOriginAllowed() {
  if (typeof window === "undefined") return false;
  const hostname = window.location.hostname.toLocaleLowerCase("en-US");
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname.endsWith(".test") || hostname.endsWith(".localhost");
}

function key(tournamentId: string) { return `sfl.draw.test-state.v1.${tournamentId}`; }
function emptyState(tournamentId: string): DrawTestState {
  return { version: 1, tournamentId, configuration: null, publication: null, fixtures: [], fixturesPublishedAt: null, directSession: null, completedSteps: { step3: false, step4: false }, currentStep: 4, updatedAt: new Date().toISOString() };
}

export function emptyDrawTestState(tournamentId: string): DrawTestState { return emptyState(tournamentId); }

export function readDrawTestState(tournamentId: string): DrawTestState {
  try {
    const raw = window.localStorage.getItem(key(tournamentId));
    if (!raw) return emptyState(tournamentId);
    const parsed = JSON.parse(raw) as DrawTestState;
    if (parsed.version !== 1 || parsed.tournamentId !== tournamentId) return emptyState(tournamentId);
    return { ...emptyState(tournamentId), ...parsed };
  } catch { return emptyState(tournamentId); }
}

function replaceLocalDrawTestState(tournamentId: string, state: DrawTestState): void {
  window.localStorage.setItem(key(tournamentId), JSON.stringify(state));
  window.dispatchEvent(new CustomEvent(changedEvent, { detail: { tournamentId } }));
}

function drawOnlyState(state: DrawTestState): DrawTestState {
  const { step5: _step5, ...drawState } = state;
  return drawState as DrawTestState;
}

function queueDrawPersistence(tournamentId: string, state: DrawTestState): void {
  if (!isDrawTestOriginAllowed()) return;
  const previous = pendingDrawWrites.get(tournamentId) ?? Promise.resolve();
  const next = previous.then(async () => {
    let revision = drawRevisions.get(tournamentId);
    if (revision === undefined) {
      const existing = await getDrawWorkflowTestState<DrawTestState>(tournamentId);
      revision = existing.revision;
      drawRevisions.set(tournamentId, revision);
    }
    const result = await saveDrawWorkflowTestState(tournamentId, drawOnlyState(state), revision === 0 ? null : revision);
    drawRevisions.set(tournamentId, result.revision);
    clearPersistenceError(tournamentId, "draw");
  }).catch((error: unknown) => {
    recordPersistenceError(tournamentId, "draw", error);
    window.dispatchEvent(new CustomEvent(persistenceErrorEvent, { detail: { tournamentId, error } }));
  }).finally(() => {
    if (pendingDrawWrites.get(tournamentId) === next) pendingDrawWrites.delete(tournamentId);
  });
  pendingDrawWrites.set(tournamentId, next);
  const current = state.step5;
  if (current) queueSchedulePersistence(tournamentId, state, current);
}

function queueSchedulePersistence(tournamentId: string, rootState: DrawTestState, step5: DemoStep5State): void {
  if (!isDrawTestOriginAllowed()) return;
  const previous = pendingScheduleWrites.get(tournamentId) ?? Promise.resolve();
  const next = previous.then(async () => {
    let revision = scheduleRevisions.get(tournamentId);
    if (revision === undefined) {
      const existing = await getScheduleWorkflowTestState<DemoStep5State>(tournamentId);
      revision = existing.revision;
      scheduleRevisions.set(tournamentId, revision);
    }
    const result = await saveScheduleWorkflowTestState(tournamentId, { ...rootState, step5 }, revision === 0 ? null : revision);
    scheduleRevisions.set(tournamentId, result.revision);
    clearPersistenceError(tournamentId, "schedule");
  }).catch((error: unknown) => {
    recordPersistenceError(tournamentId, "schedule", error);
    window.dispatchEvent(new CustomEvent(persistenceErrorEvent, { detail: { tournamentId, error } }));
  }).finally(() => {
    if (pendingScheduleWrites.get(tournamentId) === next) pendingScheduleWrites.delete(tournamentId);
  });
  pendingScheduleWrites.set(tournamentId, next);
}

export async function flushDrawTestPersistence(tournamentId: string): Promise<void> {
  await Promise.all([pendingDrawWrites.get(tournamentId), pendingScheduleWrites.get(tournamentId)]);
  const error = Object.values(persistenceErrors.get(tournamentId) ?? {})[0];
  if (error) throw error instanceof Error ? error : new Error("Không lưu được dữ liệu kiểm thử lên máy chủ.");
}

/** Save a draw-test transition before publishing it to the shared browser cache. */
export async function commitDrawTestState(
  tournamentId: string,
  update: Partial<Omit<DrawTestState, "version" | "tournamentId" | "updatedAt">>,
): Promise<number> {
  await flushDrawTestPersistence(tournamentId);
  let revision = drawRevisions.get(tournamentId);
  if (revision === undefined) {
    const existing = await getDrawWorkflowTestState<DrawTestState>(tournamentId);
    revision = existing.revision;
    drawRevisions.set(tournamentId, revision);
  }
  const current = readDrawTestState(tournamentId);
  const next = { ...current, ...update, updatedAt: new Date().toISOString() };
  const result = await saveDrawWorkflowTestState(tournamentId, drawOnlyState(next), revision === 0 ? null : revision);
  drawRevisions.set(tournamentId, result.revision);
  replaceLocalDrawTestState(tournamentId, next);
  clearPersistenceError(tournamentId, "draw");
  if (typeof BroadcastChannel !== "undefined") {
    channel ??= new BroadcastChannel(channelName);
    channel.postMessage({ tournamentId, updatedAt: next.updatedAt });
  }
  return result.revision;
}

/** Commit a schedule transition to Match Service before publishing it to the shared UI cache. */
export async function commitScheduleTestState(tournamentId: string, step5: DemoStep5State): Promise<number> {
  await flushDrawTestPersistence(tournamentId);
  const revision = await ensureScheduleTestRevision(tournamentId);
  const rootState = readDrawTestState(tournamentId);
  const result = await saveScheduleWorkflowTestState(tournamentId, { ...rootState, step5 }, revision === 0 ? null : revision);
  acknowledgeScheduleTestRevision(tournamentId, result.revision);
  replaceLocalDrawTestState(tournamentId, { ...rootState, step5, updatedAt: new Date().toISOString() });
  clearPersistenceError(tournamentId, "schedule");
  return result.revision;
}

export function subscribeDrawTestPersistenceErrors(listener: (tournamentId: string, error: unknown) => void): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ tournamentId?: string; error?: unknown }>).detail;
    if (detail?.tournamentId) listener(detail.tournamentId, detail.error);
  };
  window.addEventListener(persistenceErrorEvent, handler);
  return () => window.removeEventListener(persistenceErrorEvent, handler);
}

/** Fetch server authority on entry. The browser cache is used only once to import legacy test state when no server snapshot exists. */
export async function hydrateDrawTestState(tournamentId: string, audience: "MANAGER" | "PUBLIC" = "MANAGER"): Promise<DrawTestState> {
  if (audience === "PUBLIC") {
    const [draw, schedule] = await Promise.all([
      getPublicDrawWorkflowTestState<DrawTestState>(tournamentId),
      getPublicScheduleWorkflowTestState<DemoStep5State>(tournamentId).catch((error: unknown) => {
        // A 404 means the isolated test schedule is not available for this
        // tournament/environment. Do not hide network, authorization or 5xx failures.
        if (error instanceof ApiError && error.status === 404) return { state: null, revision: 0, updatedAt: null };
        throw error;
      }),
    ]);
    const safe = draw.state ?? emptyState(tournamentId);
    const merged = { ...emptyState(tournamentId), ...safe, step5: schedule.state ? { ...emptyDemoStep5State(""), ...schedule.state } : undefined } as DrawTestState;
    return merged;
  }
  const [draw, schedule] = await Promise.all([
    getDrawWorkflowTestState<DrawTestState>(tournamentId),
    getScheduleWorkflowTestState<DemoStep5State>(tournamentId),
  ]);
  drawRevisions.set(tournamentId, draw.revision);
  scheduleRevisions.set(tournamentId, schedule.revision);
  if (draw.state) {
    const hydrated = { ...emptyState(tournamentId), ...draw.state, step5: schedule.state ?? undefined } as DrawTestState;
    replaceLocalDrawTestState(tournamentId, hydrated);
    return hydrated;
  }
  const legacy = readDrawTestState(tournamentId);
  const merged = { ...legacy, step5: schedule.state ?? legacy.step5 };
  if (legacy.publication || legacy.configuration || legacy.fixtures.length || legacy.step5) {
    // One-time migration of a user's pre-existing local test state into the isolated server store.
    queueDrawPersistence(tournamentId, merged);
  }
  return merged;
}

export function writeDrawTestState(tournamentId: string, update: Partial<Omit<DrawTestState, "version" | "tournamentId" | "updatedAt">>) {
  const next = { ...readDrawTestState(tournamentId), ...update, updatedAt: new Date().toISOString() };
  window.localStorage.setItem(key(tournamentId), JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(changedEvent, { detail: { tournamentId } }));
  if (typeof BroadcastChannel !== "undefined") {
    channel ??= new BroadcastChannel(channelName);
    channel.postMessage({ tournamentId, updatedAt: next.updatedAt });
  }
  queueDrawPersistence(tournamentId, next);
  return next;
}

/** Stable identity for the published Step 4 input; Step 5 data is invalid when this changes. */
export function demoDiagramSnapshotKey(state: DrawTestState): string {
  if (!state.completedSteps.step4 || !state.fixturesPublishedAt || !state.publication) return "";
  return JSON.stringify({
    publishedAt: state.fixturesPublishedAt,
    allocation: state.publication,
    fixtures: state.fixtures.map(({ id, stage, groupName, round, leg, homeTeamId, awayTeamId, homeSource, awaySource, bye }) =>
      [id, stage, groupName, round, leg, homeTeamId, awayTeamId, homeSource, awaySource, bye]),
  });
}

export function emptyDemoStep5State(diagramSnapshotKey: string, defaults?: Partial<DemoScheduleResources>): DemoStep5State {
  const emptyTiming: DemoMatchTimingProfile = { halfMinutes: 0, halftimeBreakMinutes: 0, preparationBeforeMinutes: 0, transitionAfterMinutes: 0, extraTimeReserveMinutes: 0, penaltyReserveMinutes: 0 };
  return {
    diagramSnapshotKey,
    scheduleByFixture: {},
    publishedAt: null,
    schedulePublishedAt: null,
    schedulePublishedBy: null,
    schedulePublishedDiagramSnapshotKey: null,
    publishedScheduleByFixture: {},
    scheduleVersion: 0,
    publishedScheduleVersions: [],
    refereePolicy: { mode: "BY_PERIOD", publicationLeadDays: null },
    refereeScopeRounds: [],
    refereePositions: [],
    refereeAssignmentsByFixture: {},
    refereeDraftScheduleSignature: null,
    refereeAssignmentsPublishedAt: null,
    refereeAssignmentsPublishedBy: null,
    publishedRefereeAssignmentsByFixture: {},
    refereePublishedFixtureIds: [],
    resources: {
      competitionStartDate: defaults?.competitionStartDate ?? "",
      competitionEndDate: defaults?.competitionEndDate ?? "",
      allowedWeekdays: defaults?.allowedWeekdays ?? [],
      slots: defaults?.slots ?? [],
      blockedDates: defaults?.blockedDates ?? [],
      groupTiming: defaults?.groupTiming ?? emptyTiming,
      knockoutTiming: defaults?.knockoutTiming ?? { ...emptyTiming, halfMinutes: 40, extraTimeReserveMinutes: 20, penaltyReserveMinutes: 15 },
      minimumTeamRestMinutes: defaults?.minimumTeamRestMinutes ?? 0,
      maximumMatchesPerTeamPerDay: defaults?.maximumMatchesPerTeamPerDay ?? 0,
      travelBufferMinutes: defaults?.travelBufferMinutes ?? 0,
      venues: defaults?.venues ?? [],
      locations: defaults?.locations ?? [],
      availabilityProfiles: defaults?.availabilityProfiles ?? [],
      setupProvenance: defaults?.setupProvenance ?? {},
      setupRegulationVersion: defaults?.setupRegulationVersion ?? null,
      stageDateRanges: defaults?.stageDateRanges ?? {},
      defaultObjectives: defaults?.defaultObjectives ?? ["MINIMIZE_CHANGES", "REST", "FAIRNESS", "TRAVEL", "VENUE_USE", "COMPLETION"],
    },
  };
}

/** Reset only the backend-owned Step 5 test snapshot with optimistic concurrency, then refresh the browser cache. */
export async function resetScheduleTestStateForDevelopment(tournamentId: string, defaults?: Partial<DemoScheduleResources>): Promise<void> {
  await flushDrawTestPersistence(tournamentId);
  const revision = await ensureScheduleTestRevision(tournamentId);
  await resetScheduleWorkflowTestState(tournamentId, revision);
  scheduleRevisions.set(tournamentId, 0);
  const current = readDrawTestState(tournamentId);
  const next = { ...current, step5: emptyDemoStep5State(demoDiagramSnapshotKey(current), defaults), updatedAt: new Date().toISOString() };
  replaceLocalDrawTestState(tournamentId, next);
  clearPersistenceError(tournamentId, "schedule");
}

/** Reset only local Step 5 data while preserving the published draw/fixtures and current Step 5 page. */
export function resetDrawTestStep5(tournamentId: string, defaults?: Partial<DemoScheduleResources>) {
  const current = readDrawTestState(tournamentId);
  const next = writeDrawTestState(tournamentId, {
    step5: emptyDemoStep5State(demoDiagramSnapshotKey(current), defaults),
    currentStep: 6,
  });
  return next;
}

/** Reset only referee test data; keep the official test schedule intact. */
export function resetDrawTestStep6(tournamentId: string) {
  const current = readDrawTestState(tournamentId);
  if (!current.step5) return current;
  const scheduleState = { ...current.step5 };
  for (const field of [
    "refereePolicy", "refereeScopeRounds", "refereeScopeGroups", "refereeScopeDates", "refereePositions",
    "refereeResources", "refereeAssignmentsByFixture", "refereeDraftScheduleSignature", "refereeDraftResourceSignature",
    "refereeLockedFixtureIds", "lockedRefereeSlotKeysByFixture", "refereeAssignmentsPublishedAt",
    "refereeAssignmentsPublishedBy", "publishedRefereeAssignmentsByFixture", "refereePublishedFixtureIds",
  ] as const) delete scheduleState[field];
  return writeDrawTestState(tournamentId, {
    step5: {
      ...scheduleState,
      refereePolicy: { mode: "BY_PERIOD", publicationLeadDays: null },
      refereeScopeRounds: [], refereeScopeGroups: [], refereeScopeDates: [], refereePositions: [],
      refereeResources: { referees: [], models: [], crewTemplates: [], crews: [], neutralRules: [], matchRequirements: {}, evaluations: [] },
      refereeAssignmentsByFixture: {}, refereeDraftScheduleSignature: null, refereeDraftResourceSignature: null,
      refereeLockedFixtureIds: [], lockedRefereeSlotKeysByFixture: {}, refereeAssignmentsPublishedAt: null,
      refereeAssignmentsPublishedBy: null, publishedRefereeAssignmentsByFixture: {}, refereePublishedFixtureIds: [],
    },
    currentStep: 7,
  });
}

export function resetDrawTestRun(tournamentId: string) {
  const prefix = `sfl.draw.demo-allocation.`;
  for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
    const existingKey = window.localStorage.key(index);
    if (existingKey?.startsWith(prefix) && existingKey.includes(`.${tournamentId}`)) window.localStorage.removeItem(existingKey);
  }
  window.localStorage.removeItem(`sfl.draw.demo-allocation.v1.${tournamentId}`);
  window.localStorage.removeItem(`sfl.fixture.demo-scores.v1.${tournamentId}`);
  const current = readDrawTestState(tournamentId);
  const next = { ...emptyState(tournamentId), configuration: current.configuration };
  window.localStorage.setItem(key(tournamentId), JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(changedEvent, { detail: { tournamentId, reset: true } }));
  if (typeof BroadcastChannel !== "undefined") {
    channel ??= new BroadcastChannel(channelName);
    channel.postMessage({ tournamentId, reset: true, updatedAt: next.updatedAt });
  }
  if (isDrawTestOriginAllowed()) {
    const resetDraw = (pendingDrawWrites.get(tournamentId) ?? Promise.resolve())
      .then(() => resetDrawWorkflowTestState(tournamentId))
      .then(() => { drawRevisions.set(tournamentId, 0); clearPersistenceError(tournamentId, "draw"); })
      .catch((error: unknown) => { recordPersistenceError(tournamentId, "draw", error); window.dispatchEvent(new CustomEvent(persistenceErrorEvent, { detail: { tournamentId, error } })); });
    const resetSchedule = (pendingScheduleWrites.get(tournamentId) ?? Promise.resolve())
      .then(async () => resetScheduleWorkflowTestState(tournamentId, await ensureScheduleTestRevision(tournamentId)))
      .then(() => { scheduleRevisions.set(tournamentId, 0); clearPersistenceError(tournamentId, "schedule"); })
      .catch((error: unknown) => { recordPersistenceError(tournamentId, "schedule", error); window.dispatchEvent(new CustomEvent(persistenceErrorEvent, { detail: { tournamentId, error } })); });
    pendingDrawWrites.set(tournamentId, resetDraw);
    pendingScheduleWrites.set(tournamentId, resetSchedule);
  }
  return next;
}

export function subscribeDrawTestState(tournamentId: string, listener: (event?: { reset?: boolean }) => void) {
  const onStorage = (event: StorageEvent) => {
    if (!event.key || event.key === key(tournamentId)) {
      const state = readDrawTestState(tournamentId);
      listener({ reset: !state.publication && !state.directSession && !state.fixtures.length && !state.fixturesPublishedAt });
    }
  };
  const onCustom = (event: Event) => {
    if ((event as CustomEvent<{ tournamentId?: string; reset?: boolean }>).detail?.tournamentId === tournamentId) {
      listener({ reset: (event as CustomEvent<{ reset?: boolean }>).detail?.reset });
    }
  };
  const onChannel = (event: MessageEvent<{ tournamentId?: string; reset?: boolean }>) => {
    if (event.data?.tournamentId === tournamentId) listener({ reset: event.data.reset });
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(changedEvent, onCustom);
  if (typeof BroadcastChannel !== "undefined") {
    channel ??= new BroadcastChannel(channelName);
    channel.addEventListener("message", onChannel);
  }
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(changedEvent, onCustom);
    channel?.removeEventListener("message", onChannel);
  };
}
