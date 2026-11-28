import type { AutoScheduleConfiguration, DemoFixture, DemoScheduleEntry, DemoScheduleResources, DemoScheduleVenue } from "./schedulingTypes";
import { buildAutomaticSchedulePlan } from "./automaticSchedulePlanner";
import { getFinalRoundFixturesByGroup, matchPlayMinutes, validateSchedulePlan, validateScheduleResourceConfiguration, venueAvailabilityWindowsForDate } from "./scheduleConstraintValidation";

export type ScheduleSetupTournamentContext = {
  tournamentId: string;
  name: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  location: string | null;
  footballFormat: 5 | 7 | 11;
  competitionFormat: "ROUND_ROBIN" | "GROUP_AND_KNOCKOUT" | "KNOCKOUT";
  teamCount: number;
  regulationVersion: number | null;
  rules?: {
    matchDurationMinutes?: number;
    minimumRestMinutes?: number;
    extraTimeMinutes?: number;
    knockoutDecisionMethod?: "EXTRA_TIME_THEN_PENALTIES" | "PENALTIES_ONLY";
    plannedPitchCount?: number;
    playableHoursPerDay?: number;
    competitionConfig?: { schedulingStartTime?: string; schedulingEndTime?: string };
  } | null;
};

export type ScheduleSetupAnalysis = {
  tournament: ScheduleSetupTournamentContext;
  suggestedResources: DemoScheduleResources;
  counts: { teams: number; fixtures: number; groupFixtures: number; knockoutFixtures: number; byes: number; scheduled: number; unscheduled: number };
  requirement: { estimatedOccupiedMinutes: number; estimatedOccupiedHours: number; requiredSimultaneousVenues: number };
  capacity: { confirmedMatchingVenues: number; locations: number; theoreticalAvailableMinutes: number; theoreticalAvailableHours: number; theoreticalFixtureCapacity: number | null; daysWithCapacity: number; averageCapacityMinutesPerDay: number; additionalVenuesTheoretical: number | null };
  search: { status: "NOT_RUN" | "COMPLETE" | "PARTIAL" | "INFEASIBLE" | "TIMEOUT" | "NO_TARGETS"; elapsedMs: number | null; scheduled: number; missing: Array<{ fixtureId: string; reason: string }>; limitReached: boolean | null; startDate: string | null; endDate: string | null };
  blockingReasons: string[];
  recommendations: string[];
  resourceIssues: ReturnType<typeof validateScheduleResourceConfiguration>;
  scheduleIssues: ReturnType<typeof validateSchedulePlan>;
};

function dayNumber(date: string): number { return new Date(`${date}T12:00:00Z`).getUTCDay(); }
function minutes(value: string): number { const [hour, minute] = value.split(":").map(Number); return hour * 60 + minute; }
function overlaps(startA: number, endA: number, startB: number, endB: number): boolean { return startA < endB && startB < endA; }
function daySpan(start: number, end: number, from: number, to: number): number { return Math.max(0, Math.min(end, to) - Math.max(start, from)); }

function meta(source: "REGULATION" | "CALCULATED" | "SYSTEM_PROPOSED", sourceLabel: string, explanation: string, confirmed: boolean, adjustable: boolean) {
  return { source, sourceLabel, explanation, confirmed, adjustable } as const;
}

/** Derive only decision-method reserves; protected historical profiles remain unchanged. */
export function normalizeScheduleDecisionTiming(
  tournament: ScheduleSetupTournamentContext,
  resources: DemoScheduleResources,
  protectedStages: ReadonlySet<DemoFixture["stage"]> = new Set(),
): DemoScheduleResources {
  const next: DemoScheduleResources = {
    ...resources,
    groupTiming: { ...resources.groupTiming },
    knockoutTiming: { ...resources.knockoutTiming },
    setupProvenance: { ...resources.setupProvenance },
  };
  const force = (stage: DemoFixture["stage"], key: "extraTimeReserveMinutes" | "penaltyReserveMinutes", value: number, explanation: string, confirmed = true) => {
    if (protectedStages.has(stage)) return;
    const section = stage === "GROUP" ? "groupTiming" : "knockoutTiming";
    next[section][key] = value;
    next.setupProvenance![`${section}.${key}`] = meta("REGULATION", "Điều lệ hiện hành", explanation, confirmed, false);
  };
  force("GROUP", "extraTimeReserveMinutes", 0, "Vòng bảng không áp dụng hiệp phụ khi lập lịch.");
  force("GROUP", "penaltyReserveMinutes", 0, "Vòng bảng không áp dụng luân lưu khi lập lịch.");
  const decision = tournament.competitionFormat === "ROUND_ROBIN" ? undefined : tournament.rules?.knockoutDecisionMethod;
  if (!decision) {
    force("KNOCKOUT", "extraTimeReserveMinutes", 0, "Thể thức hoặc điều lệ không áp dụng hiệp phụ.");
    force("KNOCKOUT", "penaltyReserveMinutes", 0, "Thể thức hoặc điều lệ chưa áp dụng luân lưu.");
  } else if (decision === "PENALTIES_ONLY") {
    force("KNOCKOUT", "extraTimeReserveMinutes", 0, "Điều lệ quy định penalty trực tiếp; không cộng thời gian hiệp phụ.");
  } else {
    const minutes = tournament.rules?.extraTimeMinutes;
    const valid = typeof minutes === "number" && Number.isInteger(minutes) && minutes > 0;
    force("KNOCKOUT", "extraTimeReserveMinutes", valid ? minutes : 0, valid ? "Thời lượng hiệp phụ được kế thừa từ điều lệ đã công bố." : "Điều lệ yêu cầu hiệp phụ nhưng chưa có thời lượng hợp lệ.", valid);
  }
  return next;
}

export function buildScheduleSetupSuggestions(tournament: ScheduleSetupTournamentContext, current: DemoScheduleResources): DemoScheduleResources {
  current = normalizeScheduleDecisionTiming(tournament, current);
  const rules = tournament.rules;
  const existingMeta = current.setupProvenance ?? {};
  const proposed = { ...current };
  const provenance = { ...existingMeta };
  const btcHasChanged = (key: string) => existingMeta[key]?.source === "ORGANIZER_CONFIRMED" || existingMeta[key]?.sourceLabel?.startsWith("BTC đang điều chỉnh") === true;
  const refreshableSuggestion = (key: string) => {
    const item = existingMeta[key];
    return Boolean(item && !item.confirmed && (item.source === "SYSTEM_PROPOSED" || item.source === "CALCULATED") && !item.sourceLabel?.startsWith("BTC đang điều chỉnh"));
  };
  const shouldFill = (key: string, empty: boolean) => (empty || refreshableSuggestion(key)) && !btcHasChanged(key);
  const confirmOrFlagRegulation = (key: string, matches: boolean, explanation: string) => {
    if (btcHasChanged(key)) return;
    provenance[key] = meta("REGULATION", matches ? "Điều lệ hiện hành" : "Điều lệ · snapshot đang lệch", explanation, matches, true);
  };

  if (tournament.startDate) {
    if (shouldFill("competitionStartDate", !current.competitionStartDate)) proposed.competitionStartDate = tournament.startDate.slice(0, 10);
    confirmOrFlagRegulation("competitionStartDate", !current.competitionStartDate || current.competitionStartDate >= tournament.startDate.slice(0, 10), "Ngày xếp trận phải nằm trong khoảng ngày chính thức của giải.");
  }
  if (tournament.endDate) {
    if (shouldFill("competitionEndDate", !current.competitionEndDate)) proposed.competitionEndDate = tournament.endDate.slice(0, 10);
    confirmOrFlagRegulation("competitionEndDate", !current.competitionEndDate || current.competitionEndDate <= tournament.endDate.slice(0, 10), "Ngày xếp trận phải nằm trong khoảng ngày chính thức của giải.");
  }

  const formatHalfSuggestion: Record<5 | 7 | 11, number> = { 5: 20, 7: 25, 11: 45 };
  const durationHalf = rules?.matchDurationMinutes ? Math.max(1, Math.round(rules.matchDurationMinutes / 2)) : undefined;
  const halfMinutes = durationHalf ?? formatHalfSuggestion[tournament.footballFormat];
  const formatTiming = (stage: "GROUP" | "KNOCKOUT") => {
    const section = stage === "GROUP" ? "groupTiming" : "knockoutTiming";
    const currentTiming = current[section];
    const proposedTiming = { ...currentTiming };
    const field = (key: keyof typeof currentTiming, value: number, source: "REGULATION" | "SYSTEM_PROPOSED", label: string, explanation: string, adjustable: boolean) => {
      const path = `${section}.${key}`;
      const existing = existingMeta[path];
      const fill = shouldFill(path, !currentTiming[key] || currentTiming[key] === 0);
      if (fill) proposedTiming[key] = value;
      const finalValue = fill ? value : currentTiming[key];
      const confirmed = source === "REGULATION" && finalValue === value;
      provenance[path] = btcHasChanged(path) ? existing! : meta(source, label, explanation, confirmed, adjustable);
    };
    if (rules?.matchDurationMinutes) field("halfMinutes", durationHalf!, "REGULATION", "Điều lệ hiện hành", `Kế thừa tổng thời lượng ${rules.matchDurationMinutes} phút và chia đều hai hiệp.`, false);
    else field("halfMinutes", halfMinutes, "SYSTEM_PROPOSED", `Đề xuất theo bóng đá ${tournament.footballFormat} người`, "Suy ra theo loại bóng đá vì điều lệ chưa có thời lượng trận; BTC phải xác nhận.", true);
    field("halftimeBreakMinutes", Math.max(5, Math.round(halfMinutes / 4)), "SYSTEM_PROPOSED", "Tính từ thời lượng hiệp", "Ước lượng khoảng một phần tư hiệp; không thay thế điều lệ.", true);
    field("preparationBeforeMinutes", Math.max(5, Math.round(halfMinutes / 3)), "SYSTEM_PROPOSED", "Tính từ thời lượng hiệp", "Ước lượng thời gian chuẩn bị sân; BTC xác nhận theo nguồn lực thực tế.", true);
    field("transitionAfterMinutes", Math.max(5, Math.round(halfMinutes / 3)), "SYSTEM_PROPOSED", "Tính từ thời lượng hiệp", "Ước lượng thời gian chuyển tiếp; sân có thể có thời gian riêng.", true);
    if (stage === "KNOCKOUT" && (rules?.knockoutDecisionMethod === "PENALTIES_ONLY" || rules?.knockoutDecisionMethod === "EXTRA_TIME_THEN_PENALTIES")) {
      field("penaltyReserveMinutes", Math.max(5, Math.round(halfMinutes / 3)), "SYSTEM_PROPOSED", "Tính từ thời lượng hiệp", "Ước lượng dự phòng luân lưu; BTC xác nhận theo quy trình giải.", true);
    }
    proposed[section] = proposedTiming;
  };
  const hasGroup = tournament.competitionFormat !== "KNOCKOUT";
  const hasKnockout = tournament.competitionFormat !== "ROUND_ROBIN";
  if (hasGroup) formatTiming("GROUP");
  if (hasKnockout) formatTiming("KNOCKOUT");

  const confirmedVenues = current.venues.filter((venue) => venue.active && venue.pitchType === tournament.footballFormat && venue.availabilityConfirmed === true);
  if (!proposed.allowedWeekdays.length && confirmedVenues.length && !btcHasChanged("allowedWeekdays")) proposed.allowedWeekdays = [...new Set(confirmedVenues.flatMap((venue) => venue.weekdays))].sort((a, b) => a - b);
  if (proposed.allowedWeekdays.length) provenance.allowedWeekdays = btcHasChanged("allowedWeekdays")
    ? existingMeta.allowedWeekdays!
    : meta("CALCULATED", "Suy ra từ sân đã xác nhận · cần BTC duyệt", "Hợp các thứ khả dụng của sân phù hợp; BTC xác nhận ngày tổ chức chung.", false, true);
  else provenance.allowedWeekdays ??= meta("SYSTEM_PROPOSED", "Chưa xác định", "Cần BTC chọn ngày được phép tổ chức.", false, true);

  const ruleConfig = rules?.competitionConfig;
  const ruleStart = ruleConfig?.schedulingStartTime ?? "";
  const ruleEnd = ruleConfig?.schedulingEndTime ?? "";
  const validRuleWindow = /^\d{2}:\d{2}$/.test(ruleStart) && /^\d{2}:\d{2}$/.test(ruleEnd) && ruleStart < ruleEnd;
  if ((!proposed.slots.length || refreshableSuggestion("slots")) && !btcHasChanged("slots")) {
    if (validRuleWindow) proposed.slots = [{ id: "regulation-window", label: "Khung giờ theo điều lệ", start: ruleStart, end: ruleEnd }];
    else {
      const windows = new Map<string, { id: string; label: string; start: string; end: string }>();
      for (const venue of confirmedVenues) for (const window of venue.availableSlots?.length ? venue.availableSlots : [{ start: venue.availableFrom, end: venue.availableTo }]) {
        windows.set(`${window.start}-${window.end}`, { id: `derived-${window.start}-${window.end}`, label: `Khả dụng ${window.start}–${window.end}`, start: window.start, end: window.end });
      }
      proposed.slots = [...windows.values()];
    }
  }
  if (proposed.slots.length) {
    const matchesRule = validRuleWindow && proposed.slots.every((slot) => slot.start >= ruleStart && slot.end <= ruleEnd);
    provenance.slots = btcHasChanged("slots") ? existingMeta.slots!
      : validRuleWindow ? meta("REGULATION", "Điều lệ hiện hành", "Khung giờ được giới hạn bởi khoảng tổ chức đã công bố.", matchesRule, true)
        : meta("CALCULATED", "Tổng hợp từ sân xác nhận · cần BTC duyệt", "Mỗi sân vẫn giữ cửa sổ riêng và được kiểm tra riêng.", false, true);
  } else provenance.slots ??= meta("SYSTEM_PROPOSED", "Chưa xác định", "Cần cấu hình khung giờ chung hoặc khai báo sân có khả dụng thực tế.", false, true);

  if (typeof rules?.minimumRestMinutes === "number") {
    if (shouldFill("minimumTeamRestMinutes", current.minimumTeamRestMinutes <= 0)) proposed.minimumTeamRestMinutes = rules.minimumRestMinutes;
    const matches = proposed.minimumTeamRestMinutes === rules.minimumRestMinutes;
    provenance.minimumTeamRestMinutes = existingMeta.minimumTeamRestMinutes?.source === "ORGANIZER_CONFIRMED" ? existingMeta.minimumTeamRestMinutes
      : meta("REGULATION", "Điều lệ hiện hành", "Thời gian nghỉ tối thiểu là ràng buộc bắt buộc.", matches, false);
  } else provenance.minimumTeamRestMinutes ??= meta("SYSTEM_PROPOSED", "Cần BTC xác nhận", "Điều lệ chưa khai báo thời gian nghỉ tối thiểu.", false, true);
  if (current.maximumMatchesPerTeamPerDay <= 0 && !btcHasChanged("maximumMatchesPerTeamPerDay")) proposed.maximumMatchesPerTeamPerDay = 1;
  provenance.maximumMatchesPerTeamPerDay ??= meta("SYSTEM_PROPOSED", "Đề xuất an toàn", "Một trận/đội/ngày là giá trị khởi điểm, cần BTC xác nhận theo điều lệ và thời lượng giải.", false, true);
  provenance.travelBufferMinutes ??= meta("SYSTEM_PROPOSED", "Cần dữ liệu địa điểm", "Không có thông tin tuyến đường; khai báo thời gian di chuyển nếu giải dùng nhiều địa điểm.", false, true);
  if (!proposed.scheduleMode && !btcHasChanged("scheduleMode")) proposed.scheduleMode = "CENTRALIZED";
  provenance.scheduleMode ??= meta("SYSTEM_PROPOSED", "Đề xuất tổ chức tập trung", "Chỉ đổi sang sân nhà–sân khách khi nguồn lực và điều lệ xác định được sân chủ nhà.", false, true);
  proposed.defaultObjectives ??= ["MINIMIZE_CHANGES", "REST", "FAIRNESS", "TRAVEL", "VENUE_USE", "COMPLETION"];
  proposed.setupProvenance = provenance;
  proposed.setupRegulationVersion ??= tournament.regulationVersion;
  return proposed;
}

export function validateScheduleSetupAgainstTournament(tournament: ScheduleSetupTournamentContext, resources: DemoScheduleResources, fixtures: DemoFixture[] = []): string[] {
  const issues: string[] = [];
  if (tournament.regulationVersion !== null && resources.setupRegulationVersion !== tournament.regulationVersion) issues.push("Thiết lập chưa được xác minh theo phiên bản điều lệ hiện hành.");
  if (!tournament.startDate || !tournament.endDate) issues.push("Điều lệ chưa xác định ngày bắt đầu và kết thúc giải.");
  const officialStartDate = tournament.startDate?.slice(0, 10);
  const officialEndDate = tournament.endDate?.slice(0, 10);
  if (officialStartDate && resources.competitionStartDate && resources.competitionStartDate < officialStartDate) issues.push("Ngày xếp trận bắt đầu trước thời gian chính thức của giải.");
  if (officialEndDate && resources.competitionEndDate && resources.competitionEndDate > officialEndDate) issues.push("Ngày xếp trận kết thúc sau thời gian chính thức của giải.");
  const officialStart = tournament.rules?.competitionConfig?.schedulingStartTime;
  const officialEnd = tournament.rules?.competitionConfig?.schedulingEndTime;
  const validOfficialWindow = Boolean(officialStart && officialEnd && /^\d{2}:\d{2}$/.test(officialStart) && /^\d{2}:\d{2}$/.test(officialEnd) && officialStart < officialEnd);
  if (validOfficialWindow && resources.slots.some((slot) => slot.start < officialStart! || slot.end > officialEnd!)) issues.push(`Khung giờ lập lịch vượt khung điều lệ ${officialStart}–${officialEnd}.`);
  const hasGroup = fixtures.some((fixture) => fixture.stage === "GROUP") || tournament.competitionFormat !== "KNOCKOUT";
  const hasKnockout = fixtures.some((fixture) => fixture.stage === "KNOCKOUT") || tournament.competitionFormat !== "ROUND_ROBIN";
  const duration = tournament.rules?.matchDurationMinutes;
  if (duration && hasGroup && resources.groupTiming.halfMinutes * 2 !== duration) issues.push(`Thời lượng vòng bảng phải giữ ${duration} phút theo điều lệ.`);
  if (duration && hasKnockout && resources.knockoutTiming.halfMinutes * 2 !== duration) issues.push(`Thời lượng knockout phải giữ ${duration} phút theo điều lệ.`);
  const rest = tournament.rules?.minimumRestMinutes;
  if (typeof rest === "number" && resources.minimumTeamRestMinutes !== rest) issues.push(`Thời gian nghỉ tối thiểu phải giữ ${rest} phút theo điều lệ.`);
  if (hasGroup && (resources.groupTiming.extraTimeReserveMinutes !== 0 || resources.groupTiming.penaltyReserveMinutes !== 0)) issues.push("Vòng bảng không áp dụng dự phòng hiệp phụ hoặc luân lưu.");
  const decision = hasKnockout ? tournament.rules?.knockoutDecisionMethod : undefined;
  if (!decision && (resources.knockoutTiming.extraTimeReserveMinutes !== 0 || resources.knockoutTiming.penaltyReserveMinutes !== 0)) issues.push("Thể thức hoặc điều lệ không áp dụng dự phòng hiệp phụ và luân lưu.");
  if (hasKnockout && tournament.rules?.knockoutDecisionMethod === "EXTRA_TIME_THEN_PENALTIES") {
    if (!Number.isInteger(tournament.rules.extraTimeMinutes) || (tournament.rules.extraTimeMinutes ?? 0) <= 0) issues.push("Điều lệ yêu cầu hiệp phụ nhưng chưa có thời lượng hợp lệ.");
    else if (resources.knockoutTiming.extraTimeReserveMinutes !== tournament.rules.extraTimeMinutes) issues.push(`Dự phòng hiệp phụ phải giữ ${tournament.rules.extraTimeMinutes} phút theo điều lệ.`);
  }
  if (hasKnockout && tournament.rules?.knockoutDecisionMethod === "PENALTIES_ONLY" && resources.knockoutTiming.extraTimeReserveMinutes !== 0) {
    issues.push("Điều lệ quy định đá penalty trực tiếp; không được cộng dự phòng hiệp phụ.");
  }
  return [...new Set(issues)];
}

function venueDayCapacityMinutes(date: string, venue: DemoScheduleVenue, resources: DemoScheduleResources): number {
  const weekday = dayNumber(date);
  const dayWindows = venueAvailabilityWindowsForDate(venue, date);
  if (!venue.active || !venue.availabilityConfirmed || !dayWindows.length
    || (resources.allowedWeekdays.length > 0 && !resources.allowedWeekdays.includes(weekday))
    || resources.blockedDates.includes(date)) return 0;
  const occupied = dayWindows.flatMap((window) => resources.slots.map((slot) => ({ start: Math.max(minutes(window.start), minutes(slot.start)), end: Math.min(minutes(window.end), minutes(slot.end)) })))
    .filter((interval) => interval.end > interval.start)
    .sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const interval of occupied) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else merged.push({ ...interval });
  }
  const dateStart = new Date(`${date}T00:00:00`).getTime();
  const dateEnd = dateStart + 24 * 60 * 60 * 1000;
  const blackouts = venue.unavailablePeriods.map((period) => ({ start: new Date(period.startAt).getTime(), end: new Date(period.endAt).getTime() }))
    .filter((period) => Number.isFinite(period.start) && Number.isFinite(period.end) && overlaps(period.start, period.end, dateStart, dateEnd))
    .map((period) => ({ start: Math.max(0, Math.floor((period.start - dateStart) / 60_000)), end: Math.min(1440, Math.ceil((period.end - dateStart) / 60_000)) }))
    .sort((a, b) => a.start - b.start);
  return merged.reduce((sum, interval) => {
    const blockedMinutes = blackouts.reduce((blocked, blackout) => blocked + daySpan(interval.start, interval.end, blackout.start, blackout.end), 0);
    return sum + Math.max(0, interval.end - interval.start - blockedMinutes);
  }, 0);
}

export async function analyzeScheduleSetup(input: {
  tournament: ScheduleSetupTournamentContext;
  fixtures: DemoFixture[];
  entries: Record<string, DemoScheduleEntry>;
  resources: DemoScheduleResources;
  maxRuntimeMs?: number;
}): Promise<ScheduleSetupAnalysis> {
  const { tournament, fixtures, entries, resources } = input;
  const suggestedResources = buildScheduleSetupSuggestions(tournament, resources);
  // Report capacity and blockers for the candidate settings shown in the editor.
  // The previous persisted values are only the starting point for suggestions.
  const analysisResources = suggestedResources;
  const playable = fixtures.filter((fixture) => !fixture.bye);
  const hasGroupStage = playable.some((fixture) => fixture.stage === "GROUP") || tournament.competitionFormat !== "KNOCKOUT";
  const hasKnockoutStage = playable.some((fixture) => fixture.stage === "KNOCKOUT") || tournament.competitionFormat !== "ROUND_ROBIN";
  const byes = fixtures.filter((fixture) => fixture.bye).length;
  const activeMatching = analysisResources.venues.filter((venue) => venue.active && venue.pitchType === tournament.footballFormat);
  const confirmedMatching = activeMatching.filter((venue) => venue.availabilityConfirmed === true);
  const scheduled = playable.filter((fixture) => Boolean(entries[fixture.id]?.scheduledAt && entries[fixture.id]?.venue)).length;
  const finalRoundRequirement = analysisResources.requireSimultaneousGroupFinalRound
    ? Math.max(0, ...getFinalRoundFixturesByGroup(playable).map((group) => group.fixtures.length))
    : 0;
  const relevantVenues = confirmedMatching.length ? confirmedMatching : [undefined];
  const estimatedOccupiedMinutes = playable.reduce((sum, fixture) => {
    const venueTurnaround = Math.max(0, ...relevantVenues.map((venue) => venue?.turnaroundMinutes ?? 0));
    const timing = fixture.stage === "KNOCKOUT" ? analysisResources.knockoutTiming : analysisResources.groupTiming;
    return sum + timing.preparationBeforeMinutes + matchPlayMinutes(fixture, analysisResources) + timing.transitionAfterMinutes + venueTurnaround;
  }, 0);
  const startDate = analysisResources.competitionStartDate;
  const endDate = analysisResources.competitionEndDate;
  let theoreticalAvailableMinutes = 0;
  let daysWithCapacity = 0;
  if (startDate && endDate && startDate <= endDate && analysisResources.slots.length) {
    const start = new Date(`${startDate}T12:00:00Z`);
    const end = new Date(`${endDate}T12:00:00Z`);
    const days = Math.min(730, Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1);
    for (let offset = 0; offset < days; offset += 1) {
      const date = new Date(start.getTime() + offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const dateInStageWindow = new Set(playable.map((fixture) => fixture.stage)).size === 0 || playable.some((fixture) => {
        const phase = analysisResources.stageDateRanges?.[fixture.stage];
        return date >= (phase?.startDate || startDate) && date <= (phase?.endDate || endDate);
      });
      if (!dateInStageWindow) continue;
      const dayCapacity = confirmedMatching.reduce((sum, venue) => sum + venueDayCapacityMinutes(date, venue, analysisResources), 0);
      theoreticalAvailableMinutes += dayCapacity;
      if (dayCapacity > 0) daysWithCapacity += 1;
    }
  }
  const applicableResourceIssues = validateScheduleResourceConfiguration(analysisResources, tournament.footballFormat, playable)
    .filter((issue) => {
      if (issue.code === "SETUP_CONFIRMATION_REQUIRED") {
        const key = issue.message.split(": ").at(-1) ?? "";
        if (key.startsWith("groupTiming.") && !hasGroupStage) return false;
        if (key.startsWith("knockoutTiming.") && !hasKnockoutStage) return false;
        if (key.startsWith("stageDateRanges.GROUP") && !hasGroupStage) return false;
        if (key.startsWith("stageDateRanges.KNOCKOUT") && !hasKnockoutStage) return false;
      }
      if (issue.code.startsWith("STAGE_DATE") && issue.message.includes("vòng bảng") && !hasGroupStage) return false;
      if (issue.code.startsWith("STAGE_DATE") && issue.message.includes("knockout") && !hasKnockoutStage) return false;
      return issue.severity === "HARD" || issue.code.endsWith("_REQUIRED");
    });
  const blockingReasons = [
    ...validateScheduleSetupAgainstTournament(tournament, analysisResources, fixtures),
    ...applicableResourceIssues.map((issue) => issue.message),
  ];
  if (!tournament.startDate || !tournament.endDate) blockingReasons.push("Giải chưa có thời gian thi đấu chính thức trong điều lệ.");
  if (!confirmedMatching.length) blockingReasons.push(`Chưa có sân ${tournament.footballFormat} người xác nhận khả dụng thực tế.`);
  if (finalRoundRequirement > confirmedMatching.length) blockingReasons.push(`Vòng cuối đồng giờ cần ${finalRoundRequirement} sân riêng biệt; hiện có ${confirmedMatching.length} sân đã xác nhận.`);
  const scheduleIssues = validateSchedulePlan(playable, entries, analysisResources, tournament.footballFormat);
  const averageCapacityMinutesPerDay = daysWithCapacity ? Math.round(theoreticalAvailableMinutes / daysWithCapacity) : 0;
  const additionalVenuesTheoretical = theoreticalAvailableMinutes < estimatedOccupiedMinutes && averageCapacityMinutesPerDay > 0
    ? Math.ceil((estimatedOccupiedMinutes - theoreticalAvailableMinutes) / averageCapacityMinutesPerDay)
    : null;
  const recommendations = [...new Set([
    ...blockingReasons.map((reason) => reason.includes("sân") ? "Bổ sung sân phù hợp và xác nhận ngày/giờ sử dụng thực tế." : "Mở nhóm Thiết lập liên quan và xác nhận thông số còn thiếu."),
    ...(finalRoundRequirement > confirmedMatching.length ? [`Cần bổ sung ${finalRoundRequirement - confirmedMatching.length} sân phù hợp để đáp ứng cụm vòng cuối đồng giờ; chỉ được bố trí lệch giờ nếu điều lệ cho phép.`] : []),
    ...(theoreticalAvailableMinutes < estimatedOccupiedMinutes ? [
      `Thiếu khoảng ${Math.ceil((estimatedOccupiedMinutes - theoreticalAvailableMinutes) / 60)} giờ sân theo ước tính lý thuyết.`,
      additionalVenuesTheoretical ? `Tương đương khoảng ${additionalVenuesTheoretical} sân bổ sung cho cùng số ngày/khung giờ; đây là ước lượng công suất, chưa phải lịch hợp lệ.` : "Chưa có cửa sổ sân khả dụng để quy đổi thiếu hụt thành số sân; khai báo/ xác nhận thêm sân hoặc thời gian khả dụng.",
      "Có thể phân tích thêm ngày/khung giờ nằm trong điều lệ; không kéo dài giải vượt thời hạn chính thức.",
    ] : []),
  ])];
  let search: ScheduleSetupAnalysis["search"] = { status: "NOT_RUN", elapsedMs: null, scheduled: 0, missing: [], limitReached: null, startDate: null, endDate: null };
  if (blockingReasons.length === 0) {
    const maxRuntimeMs = Math.max(100, Math.min(5_000, input.maxRuntimeMs ?? 1_500));
    const plan = await buildAutomaticSchedulePlan({
      fixtures: playable,
      currentEntries: entries,
      resources: analysisResources,
      pitchType: tournament.footballFormat,
      configuration: { scope: { phase: "ALL", groups: [], rounds: [], onlyUnscheduled: true }, objectives: analysisResources.defaultObjectives?.length ? analysisResources.defaultObjectives : ["MINIMIZE_CHANGES", "REST", "FAIRNESS", "TRAVEL", "VENUE_USE", "COMPLETION"], maxRuntimeMs } as AutoScheduleConfiguration,
    });
    const dates = Object.values(plan.proposedEntries).filter((entry) => entry?.scheduledAt).map((entry) => entry.scheduledAt.slice(0, 10)).sort();
    search = {
      status: plan.status,
      elapsedMs: plan.elapsedMs,
      scheduled: plan.scheduledFixtureIds.length,
      missing: plan.missing,
      limitReached: plan.searchLimitReached ?? false,
      startDate: dates[0] ?? null,
      endDate: dates[dates.length - 1] ?? null,
    };
    if (plan.status === "TIMEOUT") recommendations.push("Chưa thể kết luận lịch không khả thi: thuật toán hết giới hạn tìm kiếm. Có thể chạy lập lịch tự động với giới hạn lớn hơn.");
    if (plan.status === "INFEASIBLE") recommendations.push("Bộ tìm kiếm đã xét các phương án khả dụng trong phạm vi hiện tại và không tìm được lịch đầy đủ; xem các trận thiếu để biết nguồn lực cần bổ sung.");
  }
  return {
    tournament,
    suggestedResources,
    counts: {
      teams: tournament.teamCount,
      fixtures: playable.length,
      groupFixtures: playable.filter((fixture) => fixture.stage === "GROUP").length,
      knockoutFixtures: playable.filter((fixture) => fixture.stage === "KNOCKOUT").length,
      byes,
      scheduled,
      unscheduled: playable.length - scheduled,
    },
    requirement: { estimatedOccupiedMinutes, estimatedOccupiedHours: Math.round(estimatedOccupiedMinutes / 60 * 10) / 10, requiredSimultaneousVenues: finalRoundRequirement },
    capacity: {
      confirmedMatchingVenues: confirmedMatching.length,
      locations: new Set(confirmedMatching.map((venue) => venue.locationId ?? venue.location).filter(Boolean)).size,
      theoreticalAvailableMinutes,
      theoreticalAvailableHours: Math.round(theoreticalAvailableMinutes / 60 * 10) / 10,
      theoreticalFixtureCapacity: estimatedOccupiedMinutes > 0 ? Math.floor(theoreticalAvailableMinutes / (estimatedOccupiedMinutes / Math.max(1, playable.length))) : null,
      daysWithCapacity,
      averageCapacityMinutesPerDay,
      additionalVenuesTheoretical,
    },
    search,
    blockingReasons: [...new Set(blockingReasons)],
    recommendations: [...new Set(recommendations)],
    resourceIssues: validateScheduleResourceConfiguration(resources, tournament.footballFormat, playable),
    scheduleIssues,
  };
}
