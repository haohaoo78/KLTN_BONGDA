import type { Response, NextFunction } from "express";
import {
  buildAutomaticRefereePlan,
  buildAutomaticSchedulePlan,
  getScheduleObjectiveWarnings,
  validateSchedulePlan,
  type AutoScheduleConfiguration,
  type DemoFixture,
  type DemoScheduleEntry,
  type DemoScheduleResources,
  analyzeScheduleResourceChange,
  analyzeScheduleSetup,
  validateScheduleSetupAgainstTournament,
  validateScheduleResourceConfiguration,
  type ScheduleSetupTournamentContext,
  automaticScheduleBaseSignature,
  matchPlayMinutes,
  venueOccupiedMinutes,
  MAX_AUTOMATIC_SCHEDULE_RUNTIME_MS,
} from "@sfl/shared";
import type { AuthenticatedRequest } from "../middleware/gatewayUser";
import { config } from "../../config";
import { AppError } from "../../lib/errors";
import { assertCanManageTournament } from "../authorization";
import type { AutoRefereePlannerInput } from "@sfl/shared";
import { deleteScheduleTestSnapshot, getScheduleTestSnapshot, saveScheduleTestSnapshot } from "../repositories/testSnapshotRepository";
import { assertOfficialEntriesUnchanged, assertOfficialScheduleCanRegenerate, getOfficialScheduleContext, parseOfficialScheduleEntries, saveOfficialScheduleDraft } from "../services/schedulingService";

type EngineSnapshot = {
  tournamentId: string;
  diagramVersion: string;
  fixtures: DemoFixture[];
  entries: Record<string, DemoScheduleEntry>;
  resources: DemoScheduleResources;
  pitchType: 5 | 7 | 11;
};

function assertSandboxEnabled(): void {
  if (config.nodeEnv === "production" || !config.schedulingTestApiEnabled) {
    // Keep the development-only capability undiscoverable in production.
    throw new AppError(404, "Not found", "NOT_FOUND");
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseAutoScheduleConfiguration(value: unknown): AutoScheduleConfiguration {
  const allowedObjectives = ["MINIMIZE_CHANGES", "COMPLETION", "REST", "FAIRNESS", "TRAVEL", "VENUE_USE", "BRANCH_REST", "CENTRAL_VENUE"];
  if (!object(value) || !Number.isFinite(value.maxRuntimeMs) || Number(value.maxRuntimeMs) < 100 || Number(value.maxRuntimeMs) > MAX_AUTOMATIC_SCHEDULE_RUNTIME_MS
    || !object(value.scope) || !["ALL", "GROUP", "KNOCKOUT"].includes(String(value.scope.phase))
    || !Array.isArray(value.scope.groups) || value.scope.groups.some((item) => typeof item !== "string")
    || !Array.isArray(value.scope.rounds) || value.scope.rounds.some((item) => typeof item !== "string")
    || typeof value.scope.onlyUnscheduled !== "boolean"
    || (value.scope.legs !== undefined && (!Array.isArray(value.scope.legs) || value.scope.legs.some((item) => !Number.isInteger(item) || Number(item) < 1 || Number(item) > 2)))
    || (value.scope.fixtureIds !== undefined && (!Array.isArray(value.scope.fixtureIds) || value.scope.fixtureIds.length > 512 || value.scope.fixtureIds.some((item) => typeof item !== "string")))
    || (value.scope.dateRange !== undefined && (!object(value.scope.dateRange)
      || (value.scope.dateRange.start !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(String(value.scope.dateRange.start)))
      || (value.scope.dateRange.end !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(String(value.scope.dateRange.end)))
      || (value.scope.dateRange.start && value.scope.dateRange.end && String(value.scope.dateRange.start) > String(value.scope.dateRange.end))))
    || !Array.isArray(value.objectives) || !value.objectives.length || value.objectives.length > allowedObjectives.length
    || value.objectives.some((item) => !allowedObjectives.includes(String(item))) || new Set(value.objectives).size !== value.objectives.length) {
    throw new AppError(400, "Phạm vi hoặc thứ tự mục tiêu lập lịch không hợp lệ", "INVALID_CONFIGURATION");
  }
  return value as unknown as AutoScheduleConfiguration;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (object(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}

function parseScheduleResources(value: unknown): DemoScheduleResources {
  if (!object(value) || !Array.isArray(value.venues) || !Array.isArray(value.slots)
    || !Array.isArray(value.allowedWeekdays) || !Array.isArray(value.blockedDates)
    || !object(value.groupTiming) || !object(value.knockoutTiming)
    || (value.locations !== undefined && !Array.isArray(value.locations))
    || (value.availabilityProfiles !== undefined && !Array.isArray(value.availabilityProfiles))
    || (value.officialCompetitionStartDate !== undefined && typeof value.officialCompetitionStartDate !== "string")
    || (value.officialCompetitionEndDate !== undefined && typeof value.officialCompetitionEndDate !== "string")
    || (value.setupProvenance !== undefined && !object(value.setupProvenance))
    || (value.stageDateRanges !== undefined && !object(value.stageDateRanges))
    || (value.defaultObjectives !== undefined && (!Array.isArray(value.defaultObjectives) || value.defaultObjectives.some((item) => !["MINIMIZE_CHANGES", "COMPLETION", "REST", "FAIRNESS", "TRAVEL", "VENUE_USE", "BRANCH_REST", "CENTRAL_VENUE"].includes(String(item)))))
    || (value.setupRegulationVersion !== undefined && value.setupRegulationVersion !== null && !Number.isInteger(value.setupRegulationVersion))) {
    throw new AppError(400, "Cấu hình nguồn lực thiếu địa điểm, sân, lịch khả dụng hoặc thời lượng trận.", "INVALID_SCHEDULE_RESOURCES");
  }
  if (value.venues.length > 128 || value.slots.length > 96 || (value.locations?.length ?? 0) > 128 || (value.availabilityProfiles?.length ?? 0) > 128) {
    throw new AppError(413, "Danh mục địa điểm hoặc sân vượt giới hạn API kiểm thử.", "SCHEDULE_RESOURCES_TOO_LARGE");
  }
  if (value.slots.some((slot) => !object(slot) || typeof slot.id !== "string" || typeof slot.label !== "string" || typeof slot.start !== "string" || typeof slot.end !== "string")) {
    throw new AppError(400, "Khung giờ giải không hợp lệ.", "INVALID_SCHEDULE_SLOT");
  }
  if (value.venues.some((venue) => !object(venue) || typeof venue.id !== "string" || typeof venue.code !== "string" || typeof venue.name !== "string"
    || typeof venue.location !== "string" || ![5, 7, 11].includes(Number(venue.pitchType)) || typeof venue.active !== "boolean"
    || !Array.isArray(venue.weekdays) || !Array.isArray(venue.unavailablePeriods)
    || (venue.availabilityStartDate !== undefined && typeof venue.availabilityStartDate !== "string")
    || (venue.availabilityEndDate !== undefined && typeof venue.availabilityEndDate !== "string")
    || (venue.dateOverrides !== undefined && (!Array.isArray(venue.dateOverrides) || venue.dateOverrides.some((override) => !object(override)
      || typeof override.date !== "string" || typeof override.unavailable !== "boolean" || !Array.isArray(override.availableSlots)
      || override.availableSlots.some((window) => !object(window) || typeof window.id !== "string" || typeof window.start !== "string" || typeof window.end !== "string"))))
    || (venue.availableSlots !== undefined && (!Array.isArray(venue.availableSlots) || venue.availableSlots.some((window) => !object(window) || typeof window.id !== "string" || typeof window.start !== "string" || typeof window.end !== "string")))
    || venue.unavailablePeriods.some((period) => !object(period) || typeof period.id !== "string" || typeof period.startAt !== "string" || typeof period.endAt !== "string" || typeof period.reason !== "string"))) {
    throw new AppError(400, "Thông tin một hoặc nhiều sân không hợp lệ.", "INVALID_SCHEDULE_VENUE");
  }
  if ((value.locations ?? []).some((location) => !object(location) || typeof location.id !== "string" || typeof location.name !== "string" || typeof location.address !== "string")) {
    throw new AppError(400, "Thông tin địa điểm không hợp lệ.", "INVALID_SCHEDULE_LOCATION");
  }
  if ((value.availabilityProfiles ?? []).some((profile) => !object(profile) || typeof profile.id !== "string" || typeof profile.name !== "string"
    || !Array.isArray(profile.weekdays) || typeof profile.availableFrom !== "string" || typeof profile.availableTo !== "string"
    || typeof profile.availabilityConfirmed !== "boolean" || !Array.isArray(profile.unavailablePeriods)
    || (profile.availableSlots !== undefined && (!Array.isArray(profile.availableSlots) || profile.availableSlots.some((window) => !object(window) || typeof window.id !== "string" || typeof window.start !== "string" || typeof window.end !== "string"))))) {
    throw new AppError(400, "Hồ sơ khả dụng không hợp lệ.", "INVALID_SCHEDULE_AVAILABILITY_PROFILE");
  }
  if (Object.values(value.setupProvenance ?? {}).some((item) => !object(item)
    || !["REGULATION", "CALCULATED", "SYSTEM_PROPOSED", "ORGANIZER_CONFIRMED"].includes(String(item.source))
    || typeof item.sourceLabel !== "string" || typeof item.explanation !== "string"
    || typeof item.confirmed !== "boolean" || typeof item.adjustable !== "boolean")) {
    throw new AppError(400, "Nguồn và trạng thái xác nhận thiết lập không hợp lệ.", "INVALID_SCHEDULE_SETUP_PROVENANCE");
  }
  if (Object.entries(value.stageDateRanges ?? {}).some(([stage, range]) => !["GROUP", "KNOCKOUT"].includes(stage) || !object(range)
    || typeof range.startDate !== "string" || typeof range.endDate !== "string")) {
    throw new AppError(400, "Khoảng ngày theo giai đoạn không hợp lệ.", "INVALID_SCHEDULE_STAGE_DATE_RANGE");
  }
  return value as unknown as DemoScheduleResources;
}

function parseSnapshot(body: unknown): EngineSnapshot {
  if (!object(body) || typeof body.tournamentId !== "string" || !body.tournamentId.trim()
    || typeof body.diagramVersion !== "string" || !body.diagramVersion.trim()
    || !Array.isArray(body.fixtures) || !object(body.entries) || !object(body.resources)
    || ![5, 7, 11].includes(Number(body.pitchType))) {
    throw new AppError(400, "Scheduling snapshot is incomplete", "INVALID_SCHEDULING_SNAPSHOT");
  }
  if (body.tournamentId.length > 128 || body.diagramVersion.length > 16_000) {
    throw new AppError(400, "Scheduling snapshot identifier is too large", "INVALID_SCHEDULING_SNAPSHOT");
  }
  if (body.fixtures.length > 512 || Object.keys(body.entries).length > 512) {
    throw new AppError(413, "Scheduling snapshot exceeds the development API limits", "SCHEDULING_SNAPSHOT_TOO_LARGE");
  }
  if (body.fixtures.some((fixture) => !object(fixture) || typeof fixture.id !== "string" || typeof fixture.round !== "string")) {
    throw new AppError(400, "Every fixture needs an id and round", "INVALID_SCHEDULING_SNAPSHOT");
  }
  return { tournamentId: body.tournamentId, diagramVersion: body.diagramVersion, fixtures: body.fixtures as DemoFixture[], entries: body.entries as Record<string, DemoScheduleEntry>, resources: parseScheduleResources(body.resources), pitchType: Number(body.pitchType) as 5 | 7 | 11 };
}

function assertTestStateEnabled(): void {
  assertSandboxEnabled();
}

function parseWorkflowState(tournamentId: string, body: unknown): { state: Record<string, unknown>; diagramVersion: string; expectedRevision: number | null; fixtures: DemoFixture[] } {
  if (!object(body) || !object(body.state) || body.state.tournamentId !== tournamentId || body.state.version !== 1
    || !object(body.state.step5) || !Array.isArray(body.state.fixtures)) {
    throw new AppError(400, "A versioned Step 5 test state scoped to this tournament is required", "INVALID_TEST_WORKFLOW_STATE");
  }
  const step5 = body.state.step5;
  const diagramVersion = typeof step5.diagramSnapshotKey === "string" ? step5.diagramSnapshotKey : "";
  if (!diagramVersion || diagramVersion.length > 16_000 || !object(step5.scheduleByFixture)) {
    throw new AppError(400, "Published Step 4 diagram version and schedule snapshot are required", "INVALID_TEST_WORKFLOW_STATE");
  }
  if (Buffer.byteLength(JSON.stringify(step5), "utf8") > 2_000_000 || Object.keys(step5.scheduleByFixture).length > 512) {
    throw new AppError(413, "Step 5 test state exceeds the allowed limit", "TEST_WORKFLOW_STATE_TOO_LARGE");
  }
  const expectedRevision = body.expectedRevision === null || body.expectedRevision === undefined ? null : Number(body.expectedRevision);
  if (expectedRevision !== null && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)) {
    throw new AppError(400, "Expected revision is invalid", "INVALID_TEST_WORKFLOW_REVISION");
  }
  return { state: { ...step5 }, diagramVersion, expectedRevision, fixtures: body.state.fixtures as unknown as DemoFixture[] };
}

async function validateAndConsumeResourceAcknowledgement(tournamentId: string, diagramVersion: string, fixtures: DemoFixture[], state: Record<string, unknown>): Promise<Record<string, unknown>> {
  const candidateResources = parseScheduleResources(state.resources);
  const malformedResources = validateScheduleResourceConfiguration(candidateResources, undefined, fixtures).filter((issue) => issue.severity === "HARD" && issue.code !== "SETUP_CONFIRMATION_REQUIRED");
  if (malformedResources.length) throw new AppError(400, "Nguồn lực có trường bắt buộc không hợp lệ.", "INVALID_SCHEDULE_RESOURCES", { issues: malformedResources });
  const acknowledgement = object(state.resourceChangeAcknowledgement) ? state.resourceChangeAcknowledgement : undefined;
  const existing = await getScheduleTestSnapshot(tournamentId);
  const priorState = existing?.state;
  const previousResources = priorState && object(priorState.resources) ? parseScheduleResources(priorState.resources) : undefined;
  if (!previousResources || JSON.stringify(previousResources) === JSON.stringify(candidateResources)) {
    const sanitized = { ...state };
    delete sanitized.resourceChangeAcknowledgement;
    return sanitized;
  }
  if (priorState?.schedulePublishedAt || priorState?.publishedAt) {
    throw new AppError(409, "Lịch đã công bố; thay đổi nguồn lực cần đi qua nghiệp vụ điều chỉnh lịch riêng.", "PUBLISHED_SCHEDULE_RESOURCES_LOCKED");
  }
  const previousEntries = {
    ...(object(priorState?.scheduleByFixture) ? priorState.scheduleByFixture as Record<string, DemoScheduleEntry> : {}),
    ...(object(priorState?.autoPreview) && object(priorState.autoPreview.proposedEntries) ? priorState.autoPreview.proposedEntries as Record<string, DemoScheduleEntry> : {}),
  };
  const candidateEntries = {
    ...(object(state.scheduleByFixture) ? state.scheduleByFixture as Record<string, DemoScheduleEntry> : {}),
    ...(object(state.autoPreview) && object(state.autoPreview.proposedEntries) ? state.autoPreview.proposedEntries as Record<string, DemoScheduleEntry> : {}),
  };
  const pitchType = acknowledgement && [5, 7, 11].includes(Number(acknowledgement.pitchType)) ? Number(acknowledgement.pitchType) as 5 | 7 | 11 : undefined;
  const signature = JSON.stringify(candidateResources);
  const previousScheduled = Object.values(previousEntries).filter((entry) => entry?.scheduledAt && entry.venue);
  if (!previousScheduled.length) {
    const sanitized = { ...state };
    delete sanitized.resourceChangeAcknowledgement;
    return sanitized;
  }
  const referencedVenue = previousScheduled.map((entry) => candidateResources.venues.find((venue) => venue.code === entry.venue || venue.name === entry.venue)
    ?? previousResources.venues.find((venue) => venue.code === entry.venue || venue.name === entry.venue)).find(Boolean);
  const effectivePitchType = pitchType ?? referencedVenue?.pitchType;
  if (!effectivePitchType) throw new AppError(400, "Cần xác định loại sân của lịch trước khi xác minh thay đổi nguồn lực.", "SCHEDULE_RESOURCE_PITCH_TYPE_REQUIRED");
  const impact = analyzeScheduleResourceChange(fixtures, previousEntries, previousResources, candidateResources, effectivePitchType);
  if (impact.affectedFixtureIds.length) {
    const validAcknowledgement = acknowledgement
      && acknowledgement.diagramVersion === diagramVersion
      && acknowledgement.resourceSignature === signature
      && Array.isArray(acknowledgement.fixtureIds)
      && JSON.stringify([...acknowledgement.fixtureIds].sort()) === JSON.stringify(impact.affectedFixtureIds);
    if (!validAcknowledgement) {
      throw new AppError(409, "Thay đổi nguồn lực ảnh hưởng lịch đã có. Hãy xem danh sách trận bị ảnh hưởng và xác nhận trước khi lưu.", "SCHEDULE_RESOURCE_CHANGE_ACK_REQUIRED", {
        affectedFixtureIds: impact.affectedFixtureIds,
        lockedFixtureIds: impact.affectedLockedFixtureIds,
        newlyInvalidIssues: impact.newlyInvalidIssues,
        recommendations: impact.recommendations,
      });
    }
  }
  const sanitized = { ...state };
  delete sanitized.resourceChangeAcknowledgement;
  return sanitized;
}

async function getPublishedTestDraw(tournamentId: string): Promise<{ diagramVersion: string; fixtures: DemoFixture[]; tournamentContext: ScheduleSetupTournamentContext }> {
  if (!config.internalApiKey) throw new AppError(503, "Internal service authentication is not configured", "SERVICE_MISCONFIGURED");
  let endpoint: string;
  try { endpoint = new URL(`/internal/tournaments/${encodeURIComponent(tournamentId)}/test-published-draw`, config.tournamentServiceUrl).toString(); }
  catch { throw new AppError(503, "Tournament Service URL is invalid", "SERVICE_MISCONFIGURED"); }
  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    response = await fetch(endpoint, {
      headers: { "x-gateway-internal-key": config.internalApiKey },
      signal: AbortSignal.timeout(5_000),
    });
  } catch { throw new AppError(503, "Could not verify the published Step 4 test diagram", "UPSTREAM_UNAVAILABLE"); }
  if (response.status === 404 || response.status === 409) throw new AppError(409, "A published Step 4 test diagram is required before this operation", "TEST_DRAW_NOT_PUBLISHED");
  if (!response.ok) throw new AppError(502, "Tournament Service could not verify the test diagram", "UPSTREAM_ERROR");
  const authority = await response.json() as { diagramVersion?: unknown; fixtures?: unknown; tournamentContext?: unknown };
  if (typeof authority.diagramVersion !== "string" || !Array.isArray(authority.fixtures) || !object(authority.tournamentContext)
    || authority.tournamentContext.tournamentId !== tournamentId || ![5, 7, 11].includes(Number(authority.tournamentContext.footballFormat))) {
    throw new AppError(502, "Tournament Service returned an invalid test diagram", "INVALID_UPSTREAM_RESPONSE");
  }
  return { diagramVersion: authority.diagramVersion, fixtures: authority.fixtures as DemoFixture[], tournamentContext: authority.tournamentContext as unknown as ScheduleSetupTournamentContext };
}

function isTestDrawNotPublished(error: unknown): boolean {
  return error instanceof AppError && error.code === "TEST_DRAW_NOT_PUBLISHED";
}

async function assertDiagramAuthority(tournamentId: string, diagramVersion: string, fixtures: DemoFixture[]): Promise<void> {
  const authority = await getPublishedTestDraw(tournamentId);
  if (authority.diagramVersion !== diagramVersion) {
    throw new AppError(409, "The Step 4 diagram version changed. Reload the current test snapshot.", "STALE_TEST_DIAGRAM");
  }
  const official = authority.fixtures.filter((fixture) => !fixture.bye);
  const submitted = fixtures.filter((item) => !item.bye);
  const canonical = (fixture: DemoFixture) => [fixture.id, fixture.stage, fixture.groupName ?? null, fixture.round, fixture.leg ?? null, fixture.homeTeamId ?? null, fixture.awayTeamId ?? null, fixture.homeSource ?? null, fixture.awaySource ?? null];
  const officialById = new Map(official.map((fixture) => [fixture.id, JSON.stringify(canonical(fixture))]));
  if (submitted.length !== official.length || new Set(submitted.map((fixture) => fixture.id)).size !== official.length
    || submitted.some((fixture) => officialById.get(fixture.id) !== JSON.stringify(canonical(fixture)))) {
    throw new AppError(409, "Scheduling input does not match the published Step 4 fixtures", "TEST_FIXTURES_MISMATCH");
  }
}

function assertWithinTournamentSetup(context: ScheduleSetupTournamentContext, resources: DemoScheduleResources, fixtures: DemoFixture[]): void {
  const issues = validateScheduleSetupAgainstTournament(context, resources, fixtures);
  if (issues.length) throw new AppError(409, "Thiết lập lịch không tuân thủ điều lệ hiện hành.", "SCHEDULE_SETUP_REGULATION_CONFLICT", { issues });
}

async function authorize(req: AuthenticatedRequest, snapshot: EngineSnapshot): Promise<void> {
  assertSandboxEnabled();
  await assertCanManageTournament(req, snapshot.tournamentId);
}

async function officialCandidateContext(req: AuthenticatedRequest, allowUnsavedResources = false) {
  await assertCanManageTournament(req, req.params.tournamentId);
  const context = await getOfficialScheduleContext(req.params.tournamentId);
  if (!context.fixtures.length) throw new AppError(409, "Cần sơ đồ Bước 4 đã công bố", "PUBLISHED_FIXTURES_REQUIRED");
  if (req.body?.diagramVersion && req.body.diagramVersion !== context.diagramVersion) throw new AppError(409, "Sơ đồ Bước 4 đã đổi. Tải lại trước khi tiếp tục.", "STALE_OFFICIAL_DIAGRAM");
  const resources = allowUnsavedResources && req.body?.resources ? parseScheduleResources(req.body.resources) : context.resources;
  if (!resources) throw new AppError(409, "Lưu cấu hình sân và thời gian trước khi lập lịch", "SCHEDULE_RESOURCES_REQUIRED");
  const entries = req.body?.entries === undefined ? context.entries : parseOfficialScheduleEntries(req.body.entries, context.fixtures, resources, context.entries);
  assertOfficialEntriesUnchanged(context.entries, entries);
  return { ...context, entries, resources };
}

export const schedulingEngineController = {
  async officialContext(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      await assertCanManageTournament(req, req.params.tournamentId);
      res.json(await getOfficialScheduleContext(req.params.tournamentId));
    } catch (error) { next(error); }
  },

  async officialSaveDraft(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      await assertCanManageTournament(req, req.params.tournamentId);
      if (!req.userId) throw new AppError(401, "Missing user authentication", "UNAUTHENTICATED");
      res.json(await saveOfficialScheduleDraft(req.params.tournamentId, req.body?.entries, req.body?.baseSignature, req.userId));
    } catch (error) { next(error); }
  },

  async officialValidate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const context = await officialCandidateContext(req);
      const issues = validateSchedulePlan(context.fixtures, context.entries, context.resources, context.pitchType, typeof req.body?.focusFixtureId === "string" ? req.body.focusFixtureId : undefined);
      issues.push(...validateScheduleSetupAgainstTournament(context.tournamentContext, context.resources, context.fixtures).map((message) => ({ fixtureId: "", code: "REGULATION_SETUP", message, severity: "HARD" as const })));
      res.json({ tournamentId: context.tournamentId, diagramVersion: context.diagramVersion, issues, warnings: getScheduleObjectiveWarnings(context.fixtures, context.entries, context.resources) });
    } catch (error) { next(error); }
  },

  async officialSetupAnalysis(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const context = await officialCandidateContext(req, true);
      const runtime = req.body?.maxRuntimeMs === undefined ? 1_500 : Number(req.body.maxRuntimeMs);
      if (!Number.isFinite(runtime) || runtime < 100 || runtime > 30_000) throw new AppError(400, "maxRuntimeMs phải từ 100 đến 30000", "INVALID_CONFIGURATION");
      const analysis = await analyzeScheduleSetup({ tournament: context.tournamentContext, fixtures: context.fixtures, entries: context.entries, resources: context.resources, maxRuntimeMs: runtime });
      res.json({ tournamentId: context.tournamentId, diagramVersion: context.diagramVersion, analysis });
    } catch (error) { next(error); }
  },

  async officialManualCandidates(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const context = await officialCandidateContext(req);
      const fixture = context.fixtures.find((item) => item.id === req.body?.fixtureId);
      if (!fixture) throw new AppError(404, "Trận không thuộc sơ đồ chính thức đã công bố", "FIXTURE_NOT_FOUND");
      const { getManualScheduleCandidates } = await import("@sfl/shared");
      const candidates = getManualScheduleCandidates(fixture, context.fixtures, context.entries, context.resources, context.pitchType);
      res.json({ tournamentId: context.tournamentId, diagramVersion: context.diagramVersion, candidates });
    } catch (error) { next(error); }
  },

  async officialResourceImpact(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const context = await officialCandidateContext(req, true);
      if (context.schedules.some((schedule) => schedule.status === "PUBLISHED")) throw new AppError(409, "Lịch đã công bố; không được thay thế cấu hình nguồn lực", "PUBLISHED_SCHEDULE_RESOURCES_LOCKED");
      const candidateResources = parseScheduleResources(req.body?.candidateResources);
      const analysis = analyzeScheduleResourceChange(context.fixtures, context.entries, context.resources, candidateResources, context.pitchType);
      res.json({ tournamentId: context.tournamentId, diagramVersion: context.diagramVersion, resources: candidateResources,
        resourceIssues: validateScheduleResourceConfiguration(candidateResources, context.pitchType, context.fixtures),
        regulationIssues: validateScheduleSetupAgainstTournament(context.tournamentContext, candidateResources, context.fixtures), ...analysis });
    } catch (error) { next(error); }
  },

  async officialAutomaticPreview(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { tournamentId } = req.params;
      await assertCanManageTournament(req, tournamentId);
      const configuration = parseAutoScheduleConfiguration(req.body?.configuration);
      const context = await getOfficialScheduleContext(tournamentId);
      assertOfficialScheduleCanRegenerate(context.schedules);
      if (!context.resources) throw new AppError(409, "Lưu cấu hình sân và thời gian chính thức trước khi tạo lịch tự động", "SCHEDULE_RESOURCES_REQUIRED");
      if (!context.fixtures.length) throw new AppError(409, "Chưa có fixture Bước 4 đã công bố để lập lịch", "PUBLISHED_FIXTURES_REQUIRED");
      const setupIssues = validateScheduleSetupAgainstTournament(context.tournamentContext, context.resources, context.fixtures);
      if (setupIssues.length) throw new AppError(409, setupIssues[0], "SCHEDULE_SETUP_REGULATION_CONFLICT", { issues: setupIssues });
      let clientDisconnected = false;
      res.on("close", () => { if (!res.writableEnded) clientDisconnected = true; });
      const plan = await buildAutomaticSchedulePlan({
        fixtures: context.fixtures,
        currentEntries: context.entries,
        resources: context.resources,
        configuration,
        pitchType: context.pitchType,
        shouldCancel: () => clientDisconnected || req.aborted,
      });
      if (clientDisconnected || res.destroyed) return;
      res.json({
        tournamentId,
        drawVersionId: context.drawVersionId,
        diagramVersion: context.diagramVersion,
        resourceRevision: context.resourceRevision,
        baseSignature: automaticScheduleBaseSignature(context.fixtures, context.entries, context.resources),
        plan,
      });
    } catch (error) { next(error); }
  },

  async testState(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      assertTestStateEnabled();
      await assertCanManageTournament(req, req.params.tournamentId);
      const saved = await getScheduleTestSnapshot(req.params.tournamentId);
      // Step 5 has no authoritative input until Step 4 publishes its fixture
      // diagram. Opening the workflow earlier is valid and must not turn this
      // expected state into a 409 that prevents Step 3 from loading.
      if (!saved) {
        res.json({ state: null, revision: 0, updatedAt: null, diagramVersion: null });
        return;
      }
      let authority: Awaited<ReturnType<typeof getPublishedTestDraw>>;
      try {
        authority = await getPublishedTestDraw(req.params.tournamentId);
      } catch (error) {
        if (!isTestDrawNotPublished(error)) throw error;
        // Preserve the old revision for optimistic concurrency, but do not
        // expose or restore a schedule tied to a missing/withdrawn diagram.
        res.json({ state: null, revision: saved.revision, updatedAt: saved.updatedAt, diagramVersion: null, stale: true });
        return;
      }
      if (saved && saved.diagramVersion !== authority.diagramVersion) {
        res.json({ state: null, revision: saved.revision, updatedAt: saved.updatedAt, diagramVersion: authority.diagramVersion, stale: true });
        return;
      }
      res.json({ ...saved, diagramVersion: authority.diagramVersion });
    } catch (error) { next(error); }
  },

  async saveTestState(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      assertTestStateEnabled();
      await assertCanManageTournament(req, req.params.tournamentId);
      if (!req.userId) throw new AppError(401, "Missing user authentication", "UNAUTHENTICATED");
      const parsed = parseWorkflowState(req.params.tournamentId, req.body);
      await assertDiagramAuthority(req.params.tournamentId, parsed.diagramVersion, parsed.fixtures);
      const authority = await getPublishedTestDraw(req.params.tournamentId);
      const candidateResources = parseScheduleResources(parsed.state.resources);
      const existing = await getScheduleTestSnapshot(req.params.tournamentId);
      const previousState = existing?.state;
      const previousEntries = previousState && object(previousState.scheduleByFixture) ? previousState.scheduleByFixture as Record<string, DemoScheduleEntry> : {};
      const candidateEntries = object(parsed.state.scheduleByFixture) ? parsed.state.scheduleByFixture as Record<string, DemoScheduleEntry> : {};
      const previousSimulation = object(previousState?.autoPreview) ? previousState.autoPreview : null;
      const candidateSimulation = object(parsed.state.autoPreview) ? parsed.state.autoPreview : null;
      if (parsed.state.simulationValidation && stableStringify(parsed.state.simulationValidation) !== stableStringify(previousState?.simulationValidation ?? null)) {
        throw new AppError(409, "Simulation validation results can only be written by Match Service", "SIMULATION_VALIDATION_SERVER_ONLY");
      }
      const previousPublishedEntries = previousState && object(previousState.publishedScheduleByFixture) ? previousState.publishedScheduleByFixture : {};
      const nextPublishedEntries = object(parsed.state.publishedScheduleByFixture) ? parsed.state.publishedScheduleByFixture : {};
      const candidatePublishedAt = typeof parsed.state.schedulePublishedAt === "string" ? parsed.state.schedulePublishedAt : typeof parsed.state.publishedAt === "string" ? parsed.state.publishedAt : null;
      if (candidatePublishedAt && !previousState?.schedulePublishedAt && !previousState?.publishedAt) {
        throw new AppError(409, "Lịch chỉ có thể được công bố qua thao tác công bố phía Match Service.", "SERVER_PUBLICATION_REQUIRED");
      }
      const hasScheduledEntries = Object.values(candidateEntries).some((entry) => Boolean(entry?.scheduledAt && entry?.venue));
      // Incomplete setup is a valid draft while BTC is still configuring
      // dates, durations and resources. Enforce regulation compatibility as
      // soon as a draft contains a scheduled match, and always before publish.
      if (hasScheduledEntries || candidatePublishedAt) {
        assertWithinTournamentSetup(authority.tournamentContext, candidateResources, parsed.fixtures);
      }
      const publishedScheduleLocked = Boolean(previousState?.schedulePublishedAt || previousState?.publishedAt);
      if (publishedScheduleLocked && (JSON.stringify(previousEntries) !== JSON.stringify(candidateEntries)
        || JSON.stringify(previousPublishedEntries) !== JSON.stringify(nextPublishedEntries)
        || previousState?.schedulePublishedAt !== parsed.state.schedulePublishedAt
        || previousState?.schedulePublishedBy !== parsed.state.schedulePublishedBy
        || previousState?.scheduleVersion !== parsed.state.scheduleVersion
        || previousState?.schedulePublishedDiagramSnapshotKey !== parsed.state.schedulePublishedDiagramSnapshotKey
        || stableStringify(previousState?.publishedScheduleVersions ?? null) !== stableStringify(parsed.state.publishedScheduleVersions ?? null))) {
        throw new AppError(409, "Lịch đã công bố và bị khóa; không thể chỉnh sửa lịch chính thức qua snapshot kiểm thử.", "PUBLISHED_SCHEDULE_IMMUTABLE");
      }
      const wasPublished = Boolean(previousState?.schedulePublishedAt || previousState?.publishedAt);
      if (candidatePublishedAt && !wasPublished) {
        const requiredFixtures = parsed.fixtures.filter((fixture) => !fixture.bye);
        if (parsed.state.schedulePublishedDiagramSnapshotKey !== parsed.diagramVersion || typeof parsed.state.schedulePublishedBy !== "string" || !parsed.state.schedulePublishedBy.trim()
          || Number(parsed.state.scheduleVersion) !== Number(previousState?.scheduleVersion ?? 0) + 1) {
          throw new AppError(409, "Phiên bản hoặc người công bố lịch không hợp lệ.", "INVALID_SCHEDULE_PUBLICATION");
        }
        if (requiredFixtures.some((fixture) => !candidateEntries[fixture.id]?.scheduledAt || !candidateEntries[fixture.id]?.venue)) {
          throw new AppError(409, "Không thể công bố lịch khi còn trận chưa được bố trí.", "SCHEDULE_PUBLICATION_INCOMPLETE");
        }
        const issues = validateSchedulePlan(requiredFixtures, candidateEntries, candidateResources, authority.tournamentContext.footballFormat);
        if (issues.length) throw new AppError(409, "Lịch không vượt qua kiểm tra trước công bố.", "SCHEDULE_PUBLICATION_CONSTRAINT_VIOLATION", { issues });
        if (Object.keys(nextPublishedEntries).length !== requiredFixtures.length || requiredFixtures.some((fixture) => {
          const draft = candidateEntries[fixture.id];
          const official = nextPublishedEntries[fixture.id] as Record<string, unknown> | undefined;
          return !official || official.scheduledAt !== draft.scheduledAt || official.venue !== draft.venue || official.slotId !== draft.slotId;
        })) throw new AppError(409, "Lịch chính thức phải phản chiếu đầy đủ bản nháp đã kiểm tra.", "SCHEDULE_PUBLICATION_SNAPSHOT_MISMATCH");
      }
      if (!previousSimulation && candidateSimulation) {
        throw new AppError(409, "Simulation plans can only be created by the Match Service planner", "SIMULATION_PLAN_NOT_SERVER_GENERATED");
      }
      if (previousSimulation && candidateSimulation && stableStringify(previousSimulation) !== stableStringify(candidateSimulation)) {
        const priorIds = Array.isArray(previousSimulation.scheduledFixtureIds) ? previousSimulation.scheduledFixtureIds : [];
        const nextIds = Array.isArray(candidateSimulation.scheduledFixtureIds) ? candidateSimulation.scheduledFixtureIds : [];
        const promotedFixtureIds = [...new Set([...Object.keys(previousEntries), ...Object.keys(candidateEntries)])]
          .filter((fixtureId) => stableStringify(previousEntries[fixtureId] ?? null) !== stableStringify(candidateEntries[fixtureId] ?? null));
        const validLockedPromotions = promotedFixtureIds.length > 0 && promotedFixtureIds.every((fixtureId) => {
          const next = candidateEntries[fixtureId];
          const proposal = object(previousSimulation.proposedEntries) ? previousSimulation.proposedEntries[fixtureId] : undefined;
          return priorIds.includes(fixtureId) && Boolean(next?.locked && next.scheduledAt && next.venue && object(proposal)
            && next.scheduledAt === proposal.scheduledAt && next.venue === proposal.venue);
        });
        if ((candidateSimulation.baseSignature !== previousSimulation.baseSignature && !validLockedPromotions)
          || nextIds.some((id) => !priorIds.includes(id))
          || nextIds.length > priorIds.length
          || !object(candidateSimulation.proposedEntries)) {
          throw new AppError(409, "A simulation edit must preserve its source version and can only remove or customize proposed fixtures", "INVALID_SIMULATION_PLAN_UPDATE");
        }
        const combined = { ...candidateEntries, ...(candidateSimulation.proposedEntries as Record<string, DemoScheduleEntry>) };
        const issues = validateSchedulePlan(parsed.fixtures, combined, candidateResources, authority.tournamentContext.footballFormat);
        if (issues.length) throw new AppError(409, "The customized simulation violates schedule constraints", "SIMULATION_CONSTRAINT_VIOLATION", { issues });
      }
      const changedFixtures = new Set([...Object.keys(previousEntries), ...Object.keys(candidateEntries)]
        .filter((fixtureId) => JSON.stringify(previousEntries[fixtureId] ?? null) !== JSON.stringify(candidateEntries[fixtureId] ?? null)));
      for (const fixtureId of changedFixtures) {
        const previous = previousEntries[fixtureId];
        const next = candidateEntries[fixtureId];
        if (previous?.locked) {
          const previousWithoutLock = { ...previous, locked: false };
          const nextWithoutLock = next ? { ...next, locked: false } : null;
          if (!next || JSON.stringify(previousWithoutLock) !== JSON.stringify(nextWithoutLock)) {
            throw new AppError(409, `Lịch ${fixtureId} đã khóa. Chỉ được mở khóa tường minh trước khi thay đổi hoặc xóa.`, "LOCKED_SCHEDULE_ENTRY_IMMUTABLE", { fixtureId });
          }
        }
        if (!next?.scheduledAt || !next.venue) continue;
        const issues = validateSchedulePlan(parsed.fixtures, candidateEntries, candidateResources, authority.tournamentContext.footballFormat, fixtureId);
        if (issues.length) throw new AppError(409, `Không thể lưu lịch ${fixtureId} vì có ràng buộc chưa đạt.`, "SCHEDULE_ENTRY_CONSTRAINT_VIOLATION", { fixtureId, issues });
      }
      const state = await validateAndConsumeResourceAcknowledgement(req.params.tournamentId, parsed.diagramVersion, parsed.fixtures, parsed.state);
      const scheduleOrResourceChanged = stableStringify(previousEntries) !== stableStringify(candidateEntries)
        || stableStringify(previousState?.resources ?? null) !== stableStringify(candidateResources);
      if (scheduleOrResourceChanged && state.autoPreview) {
        state.simulationValidation = null;
        if (state.simulationStatus === "VALID" || state.simulationStatus === "INVALID") state.simulationStatus = "SIMULATED";
      }
      const saved = await saveScheduleTestSnapshot(req.params.tournamentId, parsed.diagramVersion, state, req.userId, parsed.expectedRevision);
      if (!saved) throw new AppError(409, "Step 5 test data changed in another tab. Reload before saving.", "TEST_WORKFLOW_REVISION_CONFLICT");
      res.json(saved);
    } catch (error) { next(error); }
  },

  async resetTestState(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      assertTestStateEnabled();
      await assertCanManageTournament(req, req.params.tournamentId);
      const expectedRevision = Number(req.body?.expectedRevision);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new AppError(400, "Expected revision is required", "INVALID_TEST_WORKFLOW_REVISION");
      const reset = await deleteScheduleTestSnapshot(req.params.tournamentId, expectedRevision);
      if (!reset) throw new AppError(409, "Step 5 changed in another tab. Reload before resetting.", "TEST_WORKFLOW_REVISION_CONFLICT");
      res.json({ reset: true });
    } catch (error) { next(error); }
  },

  async reopenPublishedTestSchedule(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      assertSandboxEnabled();
      const tournamentId = req.params.tournamentId;
      await assertCanManageTournament(req, tournamentId);
      if (!req.userId) throw new AppError(401, "Missing user authentication", "UNAUTHENTICATED");
      const expectedRevision = Number(req.body?.expectedRevision);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new AppError(400, "Expected revision is required", "INVALID_TEST_WORKFLOW_REVISION");
      const current = await getScheduleTestSnapshot(tournamentId);
      if (!current || current.revision !== expectedRevision) throw new AppError(409, "Schedule snapshot changed. Reload before reopening.", "TEST_WORKFLOW_REVISION_CONFLICT");
      if (current.state.schedulePublishedAt !== undefined && current.state.schedulePublishedAt === null) throw new AppError(409, "There is no published test schedule to reopen.", "TEST_SCHEDULE_NOT_PUBLISHED");
      if (typeof current.state.schedulePublishedAt !== "string" && typeof current.state.publishedAt !== "string") throw new AppError(409, "There is no published test schedule to reopen.", "TEST_SCHEDULE_NOT_PUBLISHED");
      const authority = await getPublishedTestDraw(tournamentId);
      if (authority.diagramVersion !== current.diagramVersion) throw new AppError(409, "The published Step 4 diagram has changed. The old schedule cannot be reopened.", "TEST_WORKFLOW_DIAGRAM_STALE");
      const officialEntries = object(current.state.publishedScheduleByFixture) ? current.state.publishedScheduleByFixture : {};
      const draftEntries = object(current.state.scheduleByFixture) ? current.state.scheduleByFixture : {};
      const assignments = object(current.state.refereeAssignmentsByFixture) ? current.state.refereeAssignmentsByFixture : {};
      const publishedAssignments = object(current.state.publishedRefereeAssignmentsByFixture) ? current.state.publishedRefereeAssignmentsByFixture : {};
      const dependentAssignmentCount = Object.keys(assignments).length + Object.keys(publishedAssignments).length;
      const reopenedEntries = Object.fromEntries(Object.entries({ ...officialEntries, ...draftEntries }).map(([fixtureId, entry]) => [
        fixtureId, object(entry) ? { ...entry, locked: false } : entry,
      ]));
      const reopenRecord = { at: new Date().toISOString(), by: req.userId, fromScheduleVersion: Number(current.state.scheduleVersion ?? 0), clearedRefereeAssignmentCount: dependentAssignmentCount };
      const nextState: Record<string, unknown> = {
        ...current.state,
        scheduleByFixture: reopenedEntries,
        publishedScheduleByFixture: {},
        schedulePublishedAt: null,
        schedulePublishedBy: null,
        schedulePublishedDiagramSnapshotKey: null,
        publishedAt: null,
        autoPreview: null,
        simulationValidation: null,
        simulationStatus: null,
        refereeAssignmentsByFixture: {},
        publishedRefereeAssignmentsByFixture: {},
        refereePublishedFixtureIds: [],
        refereeAssignmentsPublishedAt: null,
        refereeAssignmentsPublishedBy: null,
        refereeDraftScheduleSignature: null,
        scheduleTestReopenHistory: [...(Array.isArray(current.state.scheduleTestReopenHistory) ? current.state.scheduleTestReopenHistory : []), reopenRecord],
      };
      const saved = await saveScheduleTestSnapshot(tournamentId, current.diagramVersion, nextState, req.userId, expectedRevision);
      if (!saved) throw new AppError(409, "Schedule snapshot changed while reopening.", "TEST_WORKFLOW_REVISION_CONFLICT");
      res.json({ tournamentId, revision: saved.revision, state: saved.state, clearedRefereeAssignmentCount: dependentAssignmentCount, preservedFixtureCount: authority.fixtures.filter((fixture) => !fixture.bye).length });
    } catch (error) { next(error); }
  },

  async publicTestState(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      assertTestStateEnabled();
      const saved = await getScheduleTestSnapshot(req.params.tournamentId);
      if (!saved) {
        res.json({ revision: 0, diagramVersion: null, state: null });
        return;
      }
      let authority: Awaited<ReturnType<typeof getPublishedTestDraw>>;
      try {
        authority = await getPublishedTestDraw(req.params.tournamentId);
      } catch (error) {
        if (!isTestDrawNotPublished(error)) throw error;
        res.json({ revision: saved.revision, diagramVersion: null, state: null });
        return;
      }
      const state = saved?.state;
      const published = state && saved?.diagramVersion === authority.diagramVersion && typeof state.schedulePublishedAt === "string";
      const publicEntries = object(state?.publishedScheduleByFixture) ? Object.fromEntries(Object.entries(state.publishedScheduleByFixture).flatMap(([fixtureId, value]) => {
        if (!object(value) || typeof value.scheduledAt !== "string" || typeof value.venue !== "string") return [];
        return [[fixtureId, { scheduledAt: value.scheduledAt, venue: value.venue, durationMinutes: typeof value.durationMinutes === "number" ? value.durationMinutes : null, refereeNames: [] }]];
      })) : {};
      res.json({
        revision: saved?.revision ?? 0,
        diagramVersion: saved?.diagramVersion ?? null,
        state: published ? {
          diagramSnapshotKey: state.diagramSnapshotKey,
          schedulePublishedAt: state.schedulePublishedAt,
          schedulePublishedBy: state.schedulePublishedBy,
          schedulePublishedDiagramSnapshotKey: state.schedulePublishedDiagramSnapshotKey,
          publishedScheduleByFixture: publicEntries,
          scheduleVersion: state.scheduleVersion ?? 0,
        } : null,
      });
    } catch (error) { next(error); }
  },

  async publishTestSchedule(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      assertTestStateEnabled();
      if (!object(req.body) || typeof req.body.diagramVersion !== "string" || !Array.isArray(req.body.fixtures)
        || !Number.isSafeInteger(Number(req.body.expectedRevision)) || typeof req.body.acceptWarnings !== "boolean") {
        throw new AppError(400, "Cần phiên bản sơ đồ, danh sách fixture, revision và lựa chọn xác nhận cảnh báo.", "INVALID_SCHEDULE_PUBLICATION_REQUEST");
      }
      const tournamentId = req.params.tournamentId;
      await assertCanManageTournament(req, tournamentId);
      if (!req.userId) throw new AppError(401, "Missing user authentication", "UNAUTHENTICATED");
      const diagramVersion = req.body.diagramVersion;
      const expectedRevision = Number(req.body.expectedRevision);
      const fixtures = req.body.fixtures as DemoFixture[];
      await assertDiagramAuthority(tournamentId, diagramVersion, fixtures);
      const current = await getScheduleTestSnapshot(tournamentId);
      if (!current || current.diagramVersion !== diagramVersion) {
        throw new AppError(409, "Lịch hoặc sơ đồ đã đổi. Tải lại và kiểm tra phiên bản mới nhất trước khi công bố.", "TEST_WORKFLOW_REVISION_CONFLICT");
      }
      if (current.state.schedulePublishedAt || current.state.publishedAt) {
        res.json({ tournamentId, revision: current.revision, idempotent: true, state: current.state });
        return;
      }
      if (current.revision !== expectedRevision) {
        throw new AppError(409, "Lịch hoặc sơ đồ đã đổi. Tải lại và kiểm tra phiên bản mới nhất trước khi công bố.", "TEST_WORKFLOW_REVISION_CONFLICT");
      }
      const resources = parseScheduleResources(current.state.resources);
      const entries = object(current.state.scheduleByFixture) ? current.state.scheduleByFixture as Record<string, DemoScheduleEntry> : {};
      if (object(current.state.autoPreview) && Array.isArray((current.state.autoPreview as Record<string, unknown>).scheduledFixtureIds)
        && ((current.state.autoPreview as Record<string, unknown>).scheduledFixtureIds as unknown[]).length) {
        throw new AppError(409, "Còn phương án giả lập chưa xác nhận. Hãy khóa hoặc hủy phương án trước khi công bố.", "SIMULATION_PLAN_PENDING");
      }
      const requiredFixtures = fixtures.filter((fixture) => !fixture.bye);
      const missing = requiredFixtures.filter((fixture) => !entries[fixture.id]?.scheduledAt || !entries[fixture.id]?.venue).map((fixture) => fixture.id);
      if (missing.length) throw new AppError(409, `Còn ${missing.length} trận chưa có lịch lưu.`, "SCHEDULE_PUBLICATION_INCOMPLETE", { missingFixtureIds: missing });
      const authority = await getPublishedTestDraw(tournamentId);
      assertWithinTournamentSetup(authority.tournamentContext, resources, requiredFixtures);
      const issues = validateSchedulePlan(requiredFixtures, entries, resources, authority.tournamentContext.footballFormat);
      issues.push(...validateScheduleSetupAgainstTournament(authority.tournamentContext, resources, requiredFixtures).map((message) => ({ fixtureId: "", code: "REGULATION_SETUP", message, severity: "HARD" as const })));
      if (issues.length) throw new AppError(409, "Lịch còn lỗi bắt buộc; không thể công bố.", "SCHEDULE_PUBLICATION_CONSTRAINT_VIOLATION", { issues });
      const warnings = getScheduleObjectiveWarnings(requiredFixtures, entries, resources).filter((issue) => issue.severity !== "HARD");
      if (warnings.length && !req.body.acceptWarnings) throw new AppError(409, "Cần BTC xác nhận các cảnh báo trước khi công bố.", "SCHEDULE_PUBLICATION_WARNINGS_REQUIRE_ACK", { warnings });
      const publishedAt = new Date().toISOString();
      const publishedBy = typeof req.body.operatorName === "string" && req.body.operatorName.trim() ? req.body.operatorName.trim() : req.userId;
      const publishedScheduleByFixture = Object.fromEntries(requiredFixtures.map((fixture) => [fixture.id, { ...entries[fixture.id], refereeNames: [] }]));
      const version = Number(current.state.scheduleVersion ?? 0) + 1;
      const versionRecord = { version, diagramSnapshotKey: diagramVersion, publishedAt, publishedBy, scheduleByFixture: publishedScheduleByFixture };
      const handoffFixtures = requiredFixtures.map((fixture) => {
        const entry = publishedScheduleByFixture[fixture.id]!;
        const venue = resources.venues.find((item) => item.code === entry.venue || item.name === entry.venue);
        if (!venue) throw new AppError(409, `Sân của trận ${fixture.id} không còn trong nguồn lực hiện hành.`, "SCHEDULE_PUBLICATION_VENUE_STALE", { fixtureId: fixture.id });
        const profile = fixture.stage === "GROUP" ? resources.groupTiming : resources.knockoutTiming;
        const durationMinutes = matchPlayMinutes(fixture, resources);
        const occupiedFrom = new Date(new Date(entry.scheduledAt).getTime() - profile.preparationBeforeMinutes * 60_000).toISOString();
        const occupiedUntil = new Date(new Date(entry.scheduledAt).getTime() + venueOccupiedMinutes(fixture, venue, resources) * 60_000).toISOString();
        return { fixtureId: fixture.id, stage: fixture.stage, group: fixture.groupName ?? null, round: fixture.round, leg: fixture.leg ?? null, homeTeamId: fixture.homeTeamId ?? null, awayTeamId: fixture.awayTeamId ?? null, homeSource: fixture.homeSource ?? null, awaySource: fixture.awaySource ?? null, scheduledAt: entry.scheduledAt, durationMinutes, venue: entry.venue, location: venue.location, occupiedFrom, occupiedUntil };
      });
      const state = {
        ...current.state,
        publishedAt: null,
        schedulePublishedAt: publishedAt,
        schedulePublishedBy: publishedBy,
        schedulePublishedDiagramSnapshotKey: diagramVersion,
        scheduleVersion: version,
        publishedScheduleByFixture,
        publishedScheduleVersions: [...(Array.isArray(current.state.publishedScheduleVersions) ? current.state.publishedScheduleVersions : []), versionRecord],
        currentStep: 6,
      };
      const saved = await saveScheduleTestSnapshot(tournamentId, diagramVersion, state, req.userId, expectedRevision);
      if (!saved) throw new AppError(409, "Lịch được cập nhật trong lúc công bố; không tạo bản công bố cũ.", "TEST_WORKFLOW_REVISION_CONFLICT");
      res.json({ tournamentId, revision: saved.revision, idempotent: false, state: saved.state, handoff: { scheduleVersion: version, fixtures: handoffFixtures } });
    } catch (error) { next(error); }
  },

  async validate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const snapshot = parseSnapshot(req.body);
      await authorize(req, snapshot);
      await assertDiagramAuthority(snapshot.tournamentId, snapshot.diagramVersion, snapshot.fixtures);
      const authority = await getPublishedTestDraw(snapshot.tournamentId);
      const issues = validateSchedulePlan(
        snapshot.fixtures,
        snapshot.entries,
        snapshot.resources,
        snapshot.pitchType,
        typeof req.body.focusFixtureId === "string" ? req.body.focusFixtureId : undefined,
      );
      issues.push(...validateScheduleSetupAgainstTournament(authority.tournamentContext, snapshot.resources, snapshot.fixtures).map((message) => ({ fixtureId: "", code: "REGULATION_SETUP", message, severity: "HARD" as const })));
      const warnings = getScheduleObjectiveWarnings(snapshot.fixtures, snapshot.entries, snapshot.resources);
      res.json({ tournamentId: snapshot.tournamentId, diagramVersion: snapshot.diagramVersion, issues, warnings });
    } catch (error) { next(error); }
  },

  async validateSimulation(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!object(req.body) || typeof req.body.tournamentId !== "string" || typeof req.body.diagramVersion !== "string"
        || !Array.isArray(req.body.fixtures) || !Number.isSafeInteger(Number(req.body.expectedRevision))) {
        throw new AppError(400, "Simulation validation requires its tournament, diagram, fixtures and revision", "INVALID_SIMULATION_VALIDATION_REQUEST");
      }
      const tournamentId = req.body.tournamentId;
      const diagramVersion = req.body.diagramVersion;
      assertSandboxEnabled();
      await assertCanManageTournament(req, tournamentId);
      if (!req.userId) throw new AppError(401, "Missing user authentication", "UNAUTHENTICATED");
      await assertDiagramAuthority(tournamentId, diagramVersion, req.body.fixtures as DemoFixture[]);
      const current = await getScheduleTestSnapshot(tournamentId);
      const expectedRevision = Number(req.body.expectedRevision);
      if (!current || current.revision !== expectedRevision || current.diagramVersion !== diagramVersion || !object(current.state.autoPreview)) {
        throw new AppError(409, "Simulation plan or snapshot version changed. Reload before checking it again.", "TEST_WORKFLOW_REVISION_CONFLICT");
      }
      const authority = await getPublishedTestDraw(tournamentId);
      const fixtures = req.body.fixtures as DemoFixture[];
      const resources = parseScheduleResources(current.state.resources);
      const draftEntries = object(current.state.scheduleByFixture) ? current.state.scheduleByFixture as Record<string, DemoScheduleEntry> : {};
      const plan = current.state.autoPreview;
      const proposedEntries = object(plan.proposedEntries) ? plan.proposedEntries as Record<string, DemoScheduleEntry> : {};
      const entries = { ...draftEntries, ...proposedEntries };
      const issues = validateSchedulePlan(fixtures, entries, resources, authority.tournamentContext.footballFormat);
      issues.push(...validateScheduleSetupAgainstTournament(authority.tournamentContext, resources, fixtures)
        .map((message) => ({ fixtureId: "", code: "REGULATION_SETUP", message, severity: "HARD" as const })));
      const warnings = getScheduleObjectiveWarnings(fixtures, entries, resources);
      const allIssues = [...issues, ...warnings];
      const hardIssues = allIssues.filter((issue) => issue.severity === "HARD");
      const simulatedIds = Array.isArray(plan.scheduledFixtureIds) ? plan.scheduledFixtureIds as string[] : [];
      const invalidFixtureIds = new Set(hardIssues.map((issue) => issue.fixtureId).filter(Boolean));
      const invalidCount = hardIssues.some((issue) => !issue.fixtureId) ? simulatedIds.length : invalidFixtureIds.size;
      const validCount = Math.max(0, simulatedIds.length - invalidCount);
      const validation = {
        checkedAt: new Date().toISOString(),
        diagramVersion,
        revision: current.revision + 1,
        validCount,
        invalidCount,
        warningCount: warnings.filter((issue) => issue.severity !== "HARD").length,
        issues: allIssues.map((issue) => ({ ...issue, severity: issue.severity ?? "WARNING" })),
      };
      const saved = await saveScheduleTestSnapshot(tournamentId, diagramVersion, {
        ...current.state,
        simulationStatus: hardIssues.length ? "INVALID" : "VALID",
        simulationValidation: validation,
      }, req.userId, expectedRevision);
      if (!saved) throw new AppError(409, "Another tab updated the simulation while it was being checked", "TEST_WORKFLOW_REVISION_CONFLICT");
      res.json({ tournamentId, diagramVersion, revision: saved.revision, validation });
    } catch (error) { next(error); }
  },

  async resourceImpact(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const snapshot = parseSnapshot(req.body);
      await authorize(req, snapshot);
      await assertDiagramAuthority(snapshot.tournamentId, snapshot.diagramVersion, snapshot.fixtures);
      const existing = await getScheduleTestSnapshot(snapshot.tournamentId);
      if (existing?.diagramVersion === snapshot.diagramVersion && (existing.state.schedulePublishedAt || existing.state.publishedAt)) {
        throw new AppError(409, "Lịch đã được công bố; thay đổi nguồn lực phải qua nghiệp vụ điều chỉnh riêng.", "PUBLISHED_SCHEDULE_RESOURCES_LOCKED");
      }
      const candidateResources = parseScheduleResources(req.body.candidateResources);
      assertWithinTournamentSetup((await getPublishedTestDraw(snapshot.tournamentId)).tournamentContext, candidateResources, snapshot.fixtures);
      const analysis = analyzeScheduleResourceChange(snapshot.fixtures, snapshot.entries, snapshot.resources, candidateResources, snapshot.pitchType);
      const resourceIssues = validateScheduleResourceConfiguration(candidateResources, snapshot.pitchType, snapshot.fixtures);
      const regulationIssues = validateScheduleSetupAgainstTournament((await getPublishedTestDraw(snapshot.tournamentId)).tournamentContext, candidateResources, snapshot.fixtures);
      res.json({
        tournamentId: snapshot.tournamentId,
        diagramVersion: snapshot.diagramVersion,
        resources: candidateResources,
        resourceIssues,
        regulationIssues,
        ...analysis,
      });
    } catch (error) { next(error); }
  },

  async setupAnalysis(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const snapshot = parseSnapshot(req.body);
      await authorize(req, snapshot);
      const authority = await getPublishedTestDraw(snapshot.tournamentId);
      if (authority.diagramVersion !== snapshot.diagramVersion) throw new AppError(409, "Phiên bản sơ đồ Bước 4 đã đổi. Hãy tải lại dữ liệu trước khi phân tích.", "STALE_TEST_DIAGRAM");
      await assertDiagramAuthority(snapshot.tournamentId, snapshot.diagramVersion, snapshot.fixtures);
      const analysis = await analyzeScheduleSetup({
        tournament: authority.tournamentContext,
        fixtures: authority.fixtures,
        entries: snapshot.entries,
        resources: snapshot.resources,
        maxRuntimeMs: Number(req.body.maxRuntimeMs) || 1_500,
      });
      res.json({ tournamentId: snapshot.tournamentId, diagramVersion: snapshot.diagramVersion, analysis });
    } catch (error) { next(error); }
  },

  async manualCandidates(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const snapshot = parseSnapshot(req.body);
      await authorize(req, snapshot);
      const authority = await getPublishedTestDraw(snapshot.tournamentId);
      if (authority.diagramVersion !== snapshot.diagramVersion) throw new AppError(409, "The Step 4 diagram version changed. Reload the current test snapshot.", "STALE_TEST_DIAGRAM");
      await assertDiagramAuthority(snapshot.tournamentId, snapshot.diagramVersion, snapshot.fixtures);
      assertWithinTournamentSetup(authority.tournamentContext, snapshot.resources, snapshot.fixtures);
      const fixtureId = typeof req.body.fixtureId === "string" ? req.body.fixtureId : "";
      const fixture = snapshot.fixtures.find((item) => item.id === fixtureId);
      if (!fixture) throw new AppError(404, "Fixture is not part of this scheduling snapshot", "FIXTURE_NOT_FOUND");
      const { getManualScheduleCandidates } = await import("@sfl/shared");
      const candidates = getManualScheduleCandidates(
        fixture, snapshot.fixtures, snapshot.entries, snapshot.resources, snapshot.pitchType,
      );
      res.json({ tournamentId: snapshot.tournamentId, diagramVersion: snapshot.diagramVersion, candidates });
    } catch (error) { next(error); }
  },

  async automaticPreview(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const snapshot = parseSnapshot(req.body);
      await authorize(req, snapshot);
      const authority = await getPublishedTestDraw(snapshot.tournamentId);
      if (authority.diagramVersion !== snapshot.diagramVersion) throw new AppError(409, "The Step 4 diagram version changed. Reload the current test snapshot.", "STALE_TEST_DIAGRAM");
      await assertDiagramAuthority(snapshot.tournamentId, snapshot.diagramVersion, snapshot.fixtures);
      assertWithinTournamentSetup(authority.tournamentContext, snapshot.resources, snapshot.fixtures);
      if (!object(req.body.configuration)) throw new AppError(400, "Automatic schedule configuration is required", "INVALID_CONFIGURATION");
      const configuration = req.body.configuration as unknown as AutoScheduleConfiguration;
      if (!Number.isFinite(configuration.maxRuntimeMs) || configuration.maxRuntimeMs < 100 || configuration.maxRuntimeMs > 30_000) {
        throw new AppError(400, "maxRuntimeMs must be between 100 and 30000", "INVALID_CONFIGURATION");
      }
      const allowedObjectives = ["MINIMIZE_CHANGES", "COMPLETION", "REST", "FAIRNESS", "TRAVEL", "VENUE_USE", "BRANCH_REST", "CENTRAL_VENUE"];
      if (!object(configuration.scope) || !["ALL", "GROUP", "KNOCKOUT"].includes(String(configuration.scope.phase))
        || !Array.isArray(configuration.scope.groups) || !Array.isArray(configuration.scope.rounds) || typeof configuration.scope.onlyUnscheduled !== "boolean"
        || configuration.scope.groups.some((item) => typeof item !== "string") || configuration.scope.rounds.some((item) => typeof item !== "string")
        || (configuration.scope.legs !== undefined && (!Array.isArray(configuration.scope.legs) || configuration.scope.legs.some((item) => !Number.isInteger(item) || item < 1 || item > 2)))
        || (configuration.scope.fixtureIds !== undefined && (!Array.isArray(configuration.scope.fixtureIds) || configuration.scope.fixtureIds.length > 512 || configuration.scope.fixtureIds.some((item) => typeof item !== "string")))
        || (configuration.scope.dateRange !== undefined && (!object(configuration.scope.dateRange)
          || (configuration.scope.dateRange.start !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(String(configuration.scope.dateRange.start)))
          || (configuration.scope.dateRange.end !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(String(configuration.scope.dateRange.end)))
          || (configuration.scope.dateRange.start && configuration.scope.dateRange.end && configuration.scope.dateRange.start > configuration.scope.dateRange.end)))
        || !Array.isArray(configuration.objectives) || !configuration.objectives.length || configuration.objectives.length > allowedObjectives.length
        || configuration.objectives.some((item) => !allowedObjectives.includes(String(item))) || new Set(configuration.objectives).size !== configuration.objectives.length) {
        throw new AppError(400, "Phạm vi hoặc thứ tự mục tiêu lập lịch không hợp lệ.", "INVALID_CONFIGURATION");
      }
      let clientDisconnected = false;
      res.on("close", () => { if (!res.writableEnded) clientDisconnected = true; });
      const plan = await buildAutomaticSchedulePlan({
        fixtures: snapshot.fixtures.filter((fixture) => !fixture.bye),
        currentEntries: snapshot.entries,
        resources: snapshot.resources,
        configuration,
        pitchType: snapshot.pitchType,
        shouldCancel: () => clientDisconnected || req.aborted,
      });
      if (clientDisconnected || res.destroyed) return;
      // Persist the simulation as its own server-managed state. It remains
      // separate from scheduleByFixture (the editable draft) until BTC locks it.
      if (!req.userId) throw new AppError(401, "Missing user authentication", "UNAUTHENTICATED");
      const expectedRevision = Number(req.body.expectedRevision);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
        throw new AppError(400, "A current test workflow revision is required", "INVALID_TEST_WORKFLOW_REVISION");
      }
      const current = await getScheduleTestSnapshot(snapshot.tournamentId);
      if (!current || current.revision !== expectedRevision || current.diagramVersion !== snapshot.diagramVersion) {
        throw new AppError(409, "Scheduling data changed while the planner was running. Reload before retrying.", "TEST_WORKFLOW_REVISION_CONFLICT");
      }
      if (current.state.schedulePublishedAt || current.state.publishedAt) {
        throw new AppError(409, "The official schedule is immutable", "PUBLISHED_SCHEDULE_IMMUTABLE");
      }
      if (current.state.autoPreview && req.body.replaceExistingSimulation !== true) {
        throw new AppError(409, "An active simulation already exists. Confirm its replacement before rerunning.", "SIMULATION_REPLACEMENT_CONFIRMATION_REQUIRED");
      }
      if (stableStringify(current.state.scheduleByFixture ?? {}) !== stableStringify(snapshot.entries)) {
        throw new AppError(409, "Draft schedules changed while the planner was running", "STALE_SCHEDULE_PLAN");
      }
      const saved = await saveScheduleTestSnapshot(snapshot.tournamentId, snapshot.diagramVersion, {
        ...current.state,
        autoPreview: plan,
        autoConfiguration: configuration,
        simulationStatus: "SIMULATED",
        simulationCreatedAt: new Date().toISOString(),
        simulationValidation: null,
      }, req.userId, expectedRevision);
      if (!saved) throw new AppError(409, "Another tab updated the schedule plan", "TEST_WORKFLOW_REVISION_CONFLICT");
      res.json({ tournamentId: snapshot.tournamentId, diagramVersion: snapshot.diagramVersion, plan, revision: saved.revision });
    } catch (error) { next(error); }
  },

  async refereePreview(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!object(req.body) || typeof req.body.tournamentId !== "string" || typeof req.body.diagramVersion !== "string" || !object(req.body.input)) {
        throw new AppError(400, "Referee scheduling snapshot is incomplete", "INVALID_REFEREE_SNAPSHOT");
      }
      if (req.body.tournamentId.length > 128 || req.body.diagramVersion.length > 16_000) {
        throw new AppError(400, "Referee scheduling snapshot identifier is too large", "INVALID_REFEREE_SNAPSHOT");
      }
      assertSandboxEnabled();
      await assertCanManageTournament(req, req.body.tournamentId);
      const input = req.body.input as unknown as AutoRefereePlannerInput;
      if (!Array.isArray(input.fixtures) || input.fixtures.length > 512 || !object(input.roster)
        || !Array.isArray(input.roster.referees) || !Array.isArray(input.roster.models)
        || !Array.isArray(input.roster.crews) || input.roster.referees.length > 512 || input.roster.models.length > 64
        || input.roster.crews.length > 128 || !object(input.configuration)
        || !Number.isFinite(input.configuration.maxRuntimeMs)
        || input.configuration.maxRuntimeMs < 100 || input.configuration.maxRuntimeMs > 30_000) {
        throw new AppError(400, "Referee scheduling snapshot exceeds the allowed limits", "INVALID_REFEREE_SNAPSHOT");
      }
      await assertDiagramAuthority(req.body.tournamentId, req.body.diagramVersion, input.fixtures);
      const plan = buildAutomaticRefereePlan(input);
      res.json({ tournamentId: req.body.tournamentId, diagramVersion: req.body.diagramVersion, plan });
    } catch (error) { next(error); }
  },
};
