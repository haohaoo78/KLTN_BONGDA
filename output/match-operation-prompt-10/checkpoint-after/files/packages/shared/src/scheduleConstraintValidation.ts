import type { DemoFixture, DemoScheduleEntry, DemoScheduleResources, DemoScheduleVenue } from "./schedulingTypes";

export type ScheduleConstraintIssue = { fixtureId: string; message: string; code: string; severity?: "HARD" | "WARNING" };
export type ManualScheduleCandidate = { date: string; venue: DemoScheduleVenue; scheduledAt: string; endAt: string; slotId: string; slotLabel: string };
export type FinalRoundClusterOption = { date: string; scheduledAt: string; slotId: string; slotLabel: string; venues: DemoScheduleVenue[] };

const MINUTE = 60_000;
function localDate(value: string) { return value.slice(0, 10); }
function minutesOfDay(value: string) { const [hour, minute] = value.split(":").map(Number); return hour * 60 + minute; }
function venueWindows(venue: DemoScheduleVenue) {
  return venue.availableSlots?.length ? venue.availableSlots : [{ id: "legacy-window", start: venue.availableFrom, end: venue.availableTo }];
}
export function venueAvailabilityWindowsForDate(venue: DemoScheduleVenue, date: string) {
  if ((venue.availabilityStartDate && date < venue.availabilityStartDate) || (venue.availabilityEndDate && date > venue.availabilityEndDate)) return [];
  const override = venue.dateOverrides?.find((item) => item.date === date);
  if (override) return override.unavailable ? [] : override.availableSlots;
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return venue.weekdays.includes(weekday) ? venueWindows(venue) : [];
}
function timestamp(value: string) { return new Date(value).getTime(); }
function overlaps(startA: number, endA: number, startB: number, endB: number) { return startA < endB && startB < endA; }
function profileFor(fixture: DemoFixture, resources: DemoScheduleResources) { return fixture.stage === "KNOCKOUT" ? resources.knockoutTiming : resources.groupTiming; }
function roundNumber(round: string) { const match = round.match(/\d+/); return match ? Number(match[0]) : Number.NaN; }
function groupRoundNumber(fixture: DemoFixture) {
  return fixture.roundNumber ?? Number(fixture.round.match(/(?:vòng|round)\s*(\d+)/i)?.[1] ?? roundNumber(fixture.round));
}

/** Last round fixtures are grouped by their published group and round; this never changes published fixtures. */
export function getFinalRoundFixturesByGroup(fixtures: DemoFixture[]) {
  const groups = new Map<string, DemoFixture[]>();
  for (const fixture of fixtures.filter((item) => item.stage === "GROUP" && !item.bye)) {
    const name = fixture.groupName ?? "Vòng tròn";
    groups.set(name, [...(groups.get(name) ?? []), fixture]);
  }
  return [...groups.entries()].map(([groupName, groupFixtures]) => {
    const finalLeg = Math.max(...groupFixtures.map((fixture) => fixture.leg ?? 1));
    const finalLegFixtures = groupFixtures.filter((fixture) => (fixture.leg ?? 1) === finalLeg);
    const rounds = finalLegFixtures.map((fixture) => roundNumber(fixture.round)).filter(Number.isFinite);
    const finalRound = rounds.length ? Math.max(...rounds) : undefined;
    const lastFixtures = finalRound === undefined
      ? finalLegFixtures.filter((fixture) => fixture.round === finalLegFixtures[finalLegFixtures.length - 1]?.round)
      : finalLegFixtures.filter((fixture) => roundNumber(fixture.round) === finalRound);
    return { groupName, fixtures: lastFixtures };
  }).filter((group) => group.fixtures.length > 0);
}

export function matchPlayMinutes(fixture: DemoFixture, resources: DemoScheduleResources) {
  const profile = profileFor(fixture, resources);
  return profile.halfMinutes * 2 + profile.halftimeBreakMinutes + profile.extraTimeReserveMinutes + profile.penaltyReserveMinutes;
}

export function venueOccupiedMinutes(fixture: DemoFixture, venue: DemoScheduleVenue, resources: DemoScheduleResources) {
  const profile = profileFor(fixture, resources);
  return profile.preparationBeforeMinutes + matchPlayMinutes(fixture, resources) + profile.transitionAfterMinutes + venue.turnaroundMinutes;
}

function sourceFixtureId(source?: string) {
  // Test fixtures use stable TEST IDs; official fixtures retain their UUIDs.
  const pattern = /(TEST-[A-Z0-9]+-R\d+(?:-L\d+)?-M\d+)/i;
  return source?.match(pattern)?.[1]
    ?? source?.match(/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/i)?.[1];
}
function groupSourceName(source?: string) { return source?.match(/(?:Nhất|Nhì|Hạng\s+\d+)\s+bảng\s+(.+)/i)?.[1]?.trim().replace(/^bảng\s+/i, ""); }
function sameGroupName(candidateName?: string, sourceName?: string) {
  return (candidateName ?? "").replace(/^bảng\s+/i, "").trim().toLocaleLowerCase() === (sourceName ?? "").replace(/^bảng\s+/i, "").trim().toLocaleLowerCase();
}
function potentialTeams(fixture: DemoFixture, fixtures: DemoFixture[], allTeamIds: string[], seen = new Set<string>()): Set<string> {
  if (seen.has(fixture.id)) return new Set(allTeamIds);
  seen.add(fixture.id);
  const possible = new Set<string>();
  if (fixture.homeTeamId) possible.add(fixture.homeTeamId);
  if (fixture.awayTeamId) possible.add(fixture.awayTeamId);
  for (const source of [fixture.homeSource, fixture.awaySource]) {
    if (!source) continue;
    const sourceId = sourceFixtureId(source);
    if (sourceId) {
      const parent = fixtures.find((candidate) => candidate.id === sourceId);
      if (parent) potentialTeams(parent, fixtures, allTeamIds, new Set(seen)).forEach((id) => possible.add(id));
      continue;
    }
    const group = groupSourceName(source);
    if (group) fixtures.filter((candidate) => candidate.stage === "GROUP" && sameGroupName(candidate.groupName, group))
      .forEach((candidate) => [candidate.homeTeamId, candidate.awayTeamId].forEach((id) => { if (id) possible.add(id); }));
  }
  return possible.size ? possible : new Set(allTeamIds);
}
function groupMatchesForQualification(fixture: DemoFixture, fixtures: DemoFixture[]) {
  const groups = [fixture.homeSource, fixture.awaySource].map(groupSourceName).filter((name): name is string => Boolean(name));
  return fixtures.filter((candidate) => candidate.stage === "GROUP" && groups.some((name) => sameGroupName(candidate.groupName, name)));
}
function dependsOnFixture(candidate: DemoFixture, sourceFixtureIdValue: string, fixtures: DemoFixture[]) {
  return [candidate.homeSource, candidate.awaySource].some((source) => sourceFixtureId(source) === sourceFixtureIdValue)
    || groupMatchesForQualification(candidate, fixtures).some((groupFixture) => groupFixture.id === sourceFixtureIdValue);
}
function scheduledEnd(fixture: DemoFixture, entry: DemoScheduleEntry, resources: DemoScheduleResources) {
  return timestamp(entry.scheduledAt) + matchPlayMinutes(fixture, resources) * MINUTE;
}
function occupancy(fixture: DemoFixture, entry: DemoScheduleEntry, venue: DemoScheduleVenue | undefined, resources: DemoScheduleResources) {
  const profile = profileFor(fixture, resources);
  const start = timestamp(entry.scheduledAt);
  const prep = profile.preparationBeforeMinutes * MINUTE;
  const end = start + (matchPlayMinutes(fixture, resources) + profile.transitionAfterMinutes + (venue?.turnaroundMinutes ?? 0)) * MINUTE;
  return { start: start - prep, end };
}

/** Structural validation shared by the test API and the management form. It intentionally permits saving an unconfirmed venue, but never treats it as usable for a match. */
export function validateScheduleResourceConfiguration(resources: DemoScheduleResources, pitchType?: 5 | 7 | 11, fixtures?: DemoFixture[]): ScheduleConstraintIssue[] {
  const issues: ScheduleConstraintIssue[] = [];
  const add = (code: string, message: string, severity: "HARD" | "WARNING" = "HARD") => issues.push({ fixtureId: "", code, message, severity });
  const stageIsUsed = (stage: "GROUP" | "KNOCKOUT") => fixtures === undefined || fixtures.some((fixture) => !fixture.bye && fixture.stage === stage);
  const settingIsUsed = (key: string) => {
    if (key.startsWith("groupTiming.") || key.startsWith("stageDateRanges.GROUP")) return stageIsUsed("GROUP");
    if (key.startsWith("knockoutTiming.") || key.startsWith("stageDateRanges.KNOCKOUT")) return stageIsUsed("KNOCKOUT");
    return true;
  };
  if (!resources.competitionStartDate || !resources.competitionEndDate) add("COMPETITION_DATES_REQUIRED", "Cần cấu hình ngày bắt đầu và kết thúc thi đấu.", "WARNING");
  else if (resources.competitionStartDate > resources.competitionEndDate) add("COMPETITION_DATES_INVALID", "Ngày kết thúc phải bằng hoặc sau ngày bắt đầu.");
  if ((resources.officialCompetitionStartDate && !/^\d{4}-\d{2}-\d{2}$/.test(resources.officialCompetitionStartDate))
    || (resources.officialCompetitionEndDate && !/^\d{4}-\d{2}-\d{2}$/.test(resources.officialCompetitionEndDate))
    || (resources.officialCompetitionStartDate && resources.officialCompetitionEndDate && resources.officialCompetitionStartDate > resources.officialCompetitionEndDate)) add("OFFICIAL_COMPETITION_DATES_INVALID", "Khoảng ngày chính thức của giải không hợp lệ.");
  if (!resources.allowedWeekdays.length) add("COMPETITION_WEEKDAYS_REQUIRED", "Chọn ít nhất một ngày được phép tổ chức trận.", "WARNING");
  if (!resources.slots.length) add("COMPETITION_SLOTS_REQUIRED", "Cần ít nhất một khung giờ tổ chức trận.", "WARNING");
  if (resources.slots.some((slot) => !slot.id.trim() || !slot.label.trim() || !/^\d{2}:\d{2}$/.test(slot.start) || !/^\d{2}:\d{2}$/.test(slot.end) || minutesOfDay(slot.start) >= minutesOfDay(slot.end))) {
    add("COMPETITION_SLOT_INVALID", "Mỗi khung giờ cần mã, tên và giờ kết thúc sau giờ bắt đầu.");
  }
  if (new Set(resources.slots.map((slot) => slot.id)).size !== resources.slots.length) add("COMPETITION_SLOT_DUPLICATE", "Mã khung giờ bị trùng.");
  for (const [key, provenance] of Object.entries(resources.setupProvenance ?? {})) {
    if (settingIsUsed(key) && (provenance.source === "SYSTEM_PROPOSED" || provenance.source === "CALCULATED") && !provenance.confirmed) add("SETUP_CONFIRMATION_REQUIRED", `Cần BTC xác nhận thông số hệ thống đề xuất: ${key}.`);
  }
  for (const [stage, range] of Object.entries(resources.stageDateRanges ?? {})) {
    if ((stage === "GROUP" || stage === "KNOCKOUT") && !stageIsUsed(stage)) continue;
    if (!range || (!range.startDate && !range.endDate)) continue;
    if ((range.startDate && !/^\d{4}-\d{2}-\d{2}$/.test(range.startDate)) || (range.endDate && !/^\d{4}-\d{2}-\d{2}$/.test(range.endDate)) || (range.startDate && range.endDate && range.startDate > range.endDate)) {
      add("STAGE_DATE_RANGE_INVALID", `Khoảng thời gian ${stage === "GROUP" ? "vòng bảng" : "knockout"} không hợp lệ.`);
    }
    if (range.startDate && resources.competitionStartDate && range.startDate < resources.competitionStartDate) add("STAGE_DATE_OUTSIDE_TOURNAMENT", `Ngày bắt đầu ${stage === "GROUP" ? "vòng bảng" : "knockout"} nằm trước thời gian giải.`);
    if (range.endDate && resources.competitionEndDate && range.endDate > resources.competitionEndDate) add("STAGE_DATE_OUTSIDE_TOURNAMENT", `Ngày kết thúc ${stage === "GROUP" ? "vòng bảng" : "knockout"} nằm sau thời gian giải.`);
  }

  const locations = resources.locations ?? [];
  const locationIds = new Set(locations.map((location) => location.id));
  if (locations.some((location) => !location.id.trim() || !location.name.trim() || !location.address.trim())) add("LOCATION_INCOMPLETE", "Mỗi địa điểm cần mã, tên và địa chỉ.");
  if (locationIds.size !== locations.length) add("LOCATION_ID_DUPLICATE", "ID địa điểm bị trùng.");
  const profiles = resources.availabilityProfiles ?? [];
  const profileIds = new Set(profiles.map((profile) => profile.id));
  if (profileIds.size !== profiles.length) add("AVAILABILITY_PROFILE_DUPLICATE", "ID hồ sơ khả dụng bị trùng.");
  if (profiles.some((profile) => !profile.id.trim() || !profile.name.trim() || profile.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
    || !/^\d{2}:\d{2}$/.test(profile.availableFrom) || !/^\d{2}:\d{2}$/.test(profile.availableTo) || minutesOfDay(profile.availableFrom) >= minutesOfDay(profile.availableTo)
    || (profile.availableSlots && (!profile.availableSlots.length || profile.availableSlots.some((window) => !window.id.trim() || !/^\d{2}:\d{2}$/.test(window.start) || !/^\d{2}:\d{2}$/.test(window.end) || minutesOfDay(window.start) >= minutesOfDay(window.end)) || new Set(profile.availableSlots.map((window) => window.id)).size !== profile.availableSlots.length)))) {
    add("AVAILABILITY_PROFILE_INVALID", "Hồ sơ khả dụng cần tên, thứ và khung giờ hợp lệ.");
  }

  const venueIds = new Set(resources.venues.map((venue) => venue.id));
  const venueCodes = resources.venues.map((venue) => venue.code.trim().toLocaleLowerCase());
  if (venueIds.size !== resources.venues.length) add("VENUE_ID_DUPLICATE", "ID sân bị trùng.");
  if (new Set(venueCodes).size !== venueCodes.length) add("VENUE_CODE_DUPLICATE", "Mã sân bị trùng.");
  for (const venue of resources.venues) {
    if (!venue.id.trim() || !venue.code.trim() || !venue.name.trim()) add("VENUE_INCOMPLETE", "Mỗi sân cần ID, mã và tên sân.");
    if (venue.locationId && !locationIds.has(venue.locationId)) add("VENUE_LOCATION_NOT_FOUND", `Sân ${venue.name || venue.code} chưa liên kết với địa điểm hợp lệ.`);
    if (!venue.locationId && locations.length) add("VENUE_LOCATION_REQUIRED", `Sân ${venue.name || venue.code} cần chọn địa điểm trực thuộc.`);
    if (venue.availabilityProfileId && profiles.length && !profileIds.has(venue.availabilityProfileId)) add("VENUE_AVAILABILITY_PROFILE_NOT_FOUND", `Sân ${venue.name || venue.code} đang trỏ tới hồ sơ khả dụng không tồn tại.`);
    if (![5, 7, 11].includes(venue.pitchType)) add("VENUE_PITCH_TYPE_INVALID", `Sân ${venue.name || venue.code} có loại sân không hợp lệ.`);
    if ((venue.availabilityStartDate && !/^\d{4}-\d{2}-\d{2}$/.test(venue.availabilityStartDate))
      || (venue.availabilityEndDate && !/^\d{4}-\d{2}-\d{2}$/.test(venue.availabilityEndDate))
      || (venue.availabilityStartDate && venue.availabilityEndDate && venue.availabilityStartDate > venue.availabilityEndDate)) add("VENUE_DATE_RANGE_INVALID", `Khoảng ngày sử dụng sân ${venue.name || venue.code} không hợp lệ.`);
    const officialStart = resources.officialCompetitionStartDate || resources.competitionStartDate;
    const officialEnd = resources.officialCompetitionEndDate || resources.competitionEndDate;
    if ((venue.availabilityStartDate && officialStart && venue.availabilityStartDate < officialStart)
      || (venue.availabilityEndDate && officialEnd && venue.availabilityEndDate > officialEnd)) add("VENUE_DATE_RANGE_OUTSIDE_TOURNAMENT", `Khoảng ngày sử dụng sân ${venue.name || venue.code} nằm ngoài thời gian tổ chức giải.`);
    const hasDateOnlyAvailability = venue.dateOverrides?.some((override) => !override.unavailable && override.availableSlots.length > 0) === true;
    if ((!venue.weekdays.length && !hasDateOnlyAvailability) || venue.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) add("VENUE_WEEKDAYS_INVALID", `Lịch của sân ${venue.name || venue.code} cần ít nhất một thứ hợp lệ hoặc một ngày khả dụng riêng.`);
    if (!/^\d{2}:\d{2}$/.test(venue.availableFrom) || !/^\d{2}:\d{2}$/.test(venue.availableTo) || minutesOfDay(venue.availableFrom) >= minutesOfDay(venue.availableTo)
      || (venue.availableSlots && (!venue.availableSlots.length || venue.availableSlots.some((window) => !window.id.trim() || !/^\d{2}:\d{2}$/.test(window.start) || !/^\d{2}:\d{2}$/.test(window.end) || minutesOfDay(window.start) >= minutesOfDay(window.end)) || new Set(venue.availableSlots.map((window) => window.id)).size !== venue.availableSlots.length))) add("VENUE_HOURS_INVALID", `Khung giờ của sân ${venue.name || venue.code} không hợp lệ.`);
    if (!Number.isFinite(venue.turnaroundMinutes) || venue.turnaroundMinutes < 0) add("VENUE_TURNAROUND_INVALID", `Thời gian chuyển tiếp của sân ${venue.name || venue.code} không hợp lệ.`);
    if (pitchType && venue.pitchType !== pitchType) add("VENUE_PITCH_TYPE_MISMATCH", `Sân ${venue.name || venue.code} không phù hợp bóng đá ${pitchType} người.`, "WARNING");
    if (venue.active && venue.pitchType === pitchType && venue.availabilityConfirmed !== true) add("VENUE_AVAILABILITY_UNCONFIRMED", `Khả dụng thực tế của sân ${venue.name || venue.code} chưa được BTC xác nhận.`, "WARNING");
    if (venue.unavailablePeriods.some((period) => !period.id.trim() || !Number.isFinite(timestamp(period.startAt)) || !Number.isFinite(timestamp(period.endAt)) || timestamp(period.startAt) >= timestamp(period.endAt))) add("VENUE_BLACKOUT_INVALID", `Khoảng bảo trì/không khả dụng của sân ${venue.name || venue.code} không hợp lệ.`);
    if (venue.dateOverrides && (new Set(venue.dateOverrides.map((override) => override.date)).size !== venue.dateOverrides.length
      || venue.dateOverrides.some((override) => !/^\d{4}-\d{2}-\d{2}$/.test(override.date)
        || (venue.availabilityStartDate && override.date < venue.availabilityStartDate) || (venue.availabilityEndDate && override.date > venue.availabilityEndDate)
        || (!override.unavailable && (!override.availableSlots.length || override.availableSlots.some((window) => !window.id.trim() || !/^\d{2}:\d{2}$/.test(window.start) || !/^\d{2}:\d{2}$/.test(window.end) || minutesOfDay(window.start) >= minutesOfDay(window.end))
          || new Set(override.availableSlots.map((window) => window.id)).size !== override.availableSlots.length))))) add("VENUE_DATE_OVERRIDE_INVALID", `Giờ sử dụng riêng theo ngày của sân ${venue.name || venue.code} không hợp lệ.`);
  }
  return issues;
}

function dateRangeForFixture(fixture: DemoFixture, resources: DemoScheduleResources) {
  const phase = resources.stageDateRanges?.[fixture.stage];
  return { start: phase?.startDate || resources.competitionStartDate, end: phase?.endDate || resources.competitionEndDate };
}

/** Validate a complete plan; focusFixtureId limits checks to a proposed edit and its direct dependants. */
export function validateSchedulePlan(
  fixtures: DemoFixture[],
  entries: Record<string, DemoScheduleEntry>,
  resources: DemoScheduleResources,
  pitchType: 5 | 7 | 11,
  focusFixtureId?: string,
): ScheduleConstraintIssue[] {
  const issues: ScheduleConstraintIssue[] = [];
  issues.push(...validateScheduleResourceConfiguration(resources, pitchType, fixtures).filter((issue) => issue.severity === "HARD"));
  const allScheduled = fixtures.filter((fixture) => !fixture.bye && entries[fixture.id]?.scheduledAt);
  const venueByName = new Map(resources.venues.flatMap((venue) => [[venue.name, venue], [venue.code, venue]]));
  const allTeamIds = [...new Set(fixtures.flatMap((fixture) => [fixture.homeTeamId, fixture.awayTeamId].filter((id): id is string => Boolean(id))))];
  const potentialCache = new Map<string, Set<string>>();
  const possibleTeams = (fixture: DemoFixture) => {
    let result = potentialCache.get(fixture.id);
    if (!result) { result = potentialTeams(fixture, fixtures, allTeamIds); potentialCache.set(fixture.id, result); }
    return result;
  };
  const add = (fixture: DemoFixture, message: string, code: string) => issues.push({ fixtureId: fixture.id, message, code });
  const isRelevant = (fixture: DemoFixture) => !focusFixtureId || fixture.id === focusFixtureId;

  for (const fixture of allScheduled.filter(isRelevant)) {
    const entry = entries[fixture.id];
    const start = timestamp(entry.scheduledAt);
    if (!Number.isFinite(start)) { add(fixture, "Ngày giờ thi đấu không hợp lệ.", "INVALID_START"); continue; }
    const startDate = localDate(entry.scheduledAt);
    const day = new Date(`${startDate}T12:00:00Z`).getUTCDay();
    const startMinute = minutesOfDay(entry.scheduledAt.slice(11, 16));
    const profile = profileFor(fixture, resources);
    const play = matchPlayMinutes(fixture, resources);
    const venue = venueByName.get(entry.venue);
    const occupiedStartMinute = startMinute - profile.preparationBeforeMinutes;
    const occupiedEndMinute = startMinute + play + profile.transitionAfterMinutes + (venue?.turnaroundMinutes ?? 0);

    const phaseDates = dateRangeForFixture(fixture, resources);
    if ((phaseDates.start && startDate < phaseDates.start) || (phaseDates.end && startDate > phaseDates.end)) add(fixture, "Lịch nằm ngoài thời gian cho phép của giai đoạn thi đấu.", "OUTSIDE_COMPETITION");
    if (!resources.allowedWeekdays.includes(day)) add(fixture, "Ngày này không nằm trong các ngày thi đấu đã cấu hình.", "WEEKDAY_NOT_ALLOWED");
    if (resources.blockedDates.includes(startDate)) add(fixture, "Ngày này đã được đánh dấu nghỉ, không tổ chức thi đấu.", "BLOCKED_DATE");
    if (!resources.slots.some((slot) => occupiedStartMinute >= minutesOfDay(slot.start) && occupiedEndMinute <= minutesOfDay(slot.end))) add(fixture, "Thời gian chiếm dụng sân (gồm chuẩn bị và chuyển tiếp) nằm ngoài các khung giờ thi đấu.", "OUTSIDE_TIME_SLOT");
    if (!venue) { add(fixture, "Sân chưa được chọn từ danh sách sân đã cấu hình.", "VENUE_NOT_CONFIGURED"); continue; }
    if (!venue.active) add(fixture, `Sân ${venue.name} đang ngừng hoạt động.`, "VENUE_INACTIVE");
    if (venue.pitchType !== pitchType) add(fixture, `Sân ${venue.name} không phù hợp loại bóng đá ${pitchType} người.`, "PITCH_TYPE_MISMATCH");
    if (venue.availabilityConfirmed !== true) add(fixture, `Khả dụng thực tế của sân ${venue.name} chưa được BTC xác nhận.`, "VENUE_AVAILABILITY_UNCONFIRMED");
    if ((venue.availabilityStartDate && startDate < venue.availabilityStartDate) || (venue.availabilityEndDate && startDate > venue.availabilityEndDate)) add(fixture, `Sân ${venue.name} không hoạt động trong ngày ${startDate} theo khoảng ngày đã khai báo.`, "VENUE_OUTSIDE_DATE_RANGE");
    if (venue.locationId && resources.locations?.length && !resources.locations.some((location) => location.id === venue.locationId)) add(fixture, `Địa điểm trực thuộc của sân ${venue.name} không còn tồn tại.`, "VENUE_LOCATION_NOT_FOUND");
    if (!venueAvailabilityWindowsForDate(venue, startDate).some((window) => occupiedStartMinute >= minutesOfDay(window.start) && occupiedEndMinute <= minutesOfDay(window.end))) add(fixture, `Sân ${venue.name} không có khung giờ khả dụng vào ${startDate} hoặc thời gian chiếm dụng nằm ngoài các khung đã khai báo.`, "VENUE_UNAVAILABLE_WINDOW");
    if (resources.scheduleMode === "HOME_AWAY" && fixture.homeTeamId && venue.homeTeamId !== fixture.homeTeamId) add(fixture, "Sân " + venue.name + " không được gắn với đội chủ nhà của trận; cấu hình sân nhà hoặc dùng sân tập trung.", "HOME_VENUE_MISMATCH");
    const span = occupancy(fixture, entry, venue, resources);
    for (const period of venue.unavailablePeriods) {
      const unavailableStart = timestamp(period.startAt); const unavailableEnd = timestamp(period.endAt);
      if (Number.isFinite(unavailableStart) && Number.isFinite(unavailableEnd) && overlaps(span.start, span.end, unavailableStart, unavailableEnd)) add(fixture, `Sân ${venue.name} không khả dụng: ${period.reason || "đã khóa thời gian này"}.`, "VENUE_BLACKOUT");
    }
  }

  if (resources.maximumRoundsPerDayRequired && resources.maximumRoundsPerDay && resources.maximumRoundsPerDay > 0) {
    const byDay = new Map<string, Set<string>>();
    for (const fixture of allScheduled) {
      const date = localDate(entries[fixture.id].scheduledAt);
      const rounds = byDay.get(date) ?? new Set<string>(); rounds.add(fixture.round); byDay.set(date, rounds);
    }
    for (const [date, rounds] of byDay) if (rounds.size > resources.maximumRoundsPerDay) {
      const fixture = allScheduled.find((item) => localDate(entries[item.id].scheduledAt) === date && isRelevant(item));
      if (fixture) add(fixture, "Ngày " + date + " vượt giới hạn " + resources.maximumRoundsPerDay + " vòng thi đấu.", "MAX_ROUNDS_PER_DAY");
    }
  }

  if (resources.requireSimultaneousGroupFinalRound) {
    for (const group of getFinalRoundFixturesByGroup(fixtures)) {
      const scheduledFinals = group.fixtures.filter((fixture) => entries[fixture.id]?.scheduledAt);
      if (scheduledFinals.length < 2) continue;
      const kickoff = entries[scheduledFinals[0].id].scheduledAt;
      const mismatch = scheduledFinals.find((fixture) => entries[fixture.id].scheduledAt !== kickoff);
      const venueIds = scheduledFinals.map((fixture) => venueByName.get(entries[fixture.id].venue)?.id).filter(Boolean);
      const duplicateVenue = venueIds.find((id, index) => venueIds.indexOf(id) !== index);
      if (mismatch && isRelevant(mismatch)) add(mismatch, "Các trận vòng cuối " + group.groupName + " phải cùng ngày và giờ bắt đầu.", "FINAL_ROUND_KICKOFF_MISMATCH");
      if (duplicateVenue) {
        const affected = scheduledFinals.find((fixture) => isRelevant(fixture) && venueByName.get(entries[fixture.id].venue)?.id === duplicateVenue);
        if (affected) add(affected, "Các trận vòng cuối " + group.groupName + " phải sử dụng sân khác nhau.", "FINAL_ROUND_DUPLICATE_VENUE");
      }
    }
  }

  const scheduledPairs: Array<[DemoFixture, DemoFixture]> = [];
  if (focusFixtureId) {
    const focused = allScheduled.find((fixture) => fixture.id === focusFixtureId);
    if (focused) for (const other of allScheduled) if (other.id !== focused.id) scheduledPairs.push([focused, other]);
  } else {
    for (let leftIndex = 0; leftIndex < allScheduled.length; leftIndex += 1)
      for (let rightIndex = leftIndex + 1; rightIndex < allScheduled.length; rightIndex += 1) scheduledPairs.push([allScheduled[leftIndex], allScheduled[rightIndex]]);
  }
  for (const [left, right] of scheduledPairs) {
      const leftEntry = entries[left.id]; const leftVenue = venueByName.get(leftEntry.venue);
      const rightEntry = entries[right.id]; const rightVenue = venueByName.get(rightEntry.venue);
      const leftSpan = occupancy(left, leftEntry, leftVenue, resources); const rightSpan = occupancy(right, rightEntry, rightVenue, resources);
      const conflictTarget = focusFixtureId ? (left.id === focusFixtureId ? right : left) : right;
      if (leftVenue && rightVenue && leftVenue.id === rightVenue.id && overlaps(leftSpan.start, leftSpan.end, rightSpan.start, rightSpan.end)) add(conflictTarget, `Sân ${leftVenue.name} bị chiếm dụng trùng với trận ${left.id === conflictTarget.id ? right.id : left.id}.`, "VENUE_OVERLAP");

      const leftStart = timestamp(leftEntry.scheduledAt); const rightStart = timestamp(rightEntry.scheduledAt);
      const leftEnd = scheduledEnd(left, leftEntry, resources); const rightEnd = scheduledEnd(right, rightEntry, resources);
      if (left.stage === "GROUP" && right.stage === "GROUP" && sameGroupName(left.groupName, right.groupName)) {
        const order = (left.leg ?? 1) - (right.leg ?? 1) || groupRoundNumber(left) - groupRoundNumber(right);
        if (Number.isFinite(order) && order !== 0) {
          const earlierRound = order < 0 ? left : right;
          const laterRound = order < 0 ? right : left;
          const earlierEnd = order < 0 ? leftEnd : rightEnd;
          const laterStart = order < 0 ? rightStart : leftStart;
          if (earlierEnd > laterStart) add(conflictTarget, `Trận ${laterRound.id} phải diễn ra sau khi các trận của lượt/vòng trước kết thúc; trận ${earlierRound.id} đang được xếp muộn hơn.`, "GROUP_ROUND_ORDER");
        }
      }
      const leftTeams = possibleTeams(left); const rightTeams = possibleTeams(right);
      const overlapTeams = [...leftTeams].filter((id) => rightTeams.has(id));
      if (!overlapTeams.length) continue;
      if (overlaps(leftStart, leftEnd, rightStart, rightEnd)) add(conflictTarget, `Có khả năng đội tham gia bị xếp hai trận trùng giờ với ${left.id === conflictTarget.id ? right.id : left.id}.`, "TEAM_OVERLAP");
      const sameDay = localDate(leftEntry.scheduledAt) === localDate(rightEntry.scheduledAt);
      if (sameDay && resources.maximumMatchesPerTeamPerDay > 0) {
        const counts = new Map<string, number>();
        for (const candidate of allScheduled.filter((item) => localDate(entries[item.id].scheduledAt) === localDate(rightEntry.scheduledAt))) possibleTeams(candidate).forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1));
        if (overlapTeams.some((id) => (counts.get(id) ?? 0) > resources.maximumMatchesPerTeamPerDay)) add(conflictTarget, `Vượt giới hạn ${resources.maximumMatchesPerTeamPerDay} trận/ngày của đội có thể tham gia.`, "TEAM_DAILY_LIMIT");
      }
      const earlier = leftStart <= rightStart ? left : right; const later = earlier === left ? right : left;
      const earlierEntry = entries[earlier.id]; const earlierStart = timestamp(earlierEntry.scheduledAt);
      const earlierEnd = earlierStart + matchPlayMinutes(earlier, resources) * MINUTE;
      const laterStart = timestamp(entries[later.id].scheduledAt);
      const earlierVenue = venueByName.get(earlierEntry.venue); const laterVenue = venueByName.get(entries[later.id].venue);
      const earlierTravelKey = earlierVenue?.travelZone || earlierVenue?.location;
      const laterTravelKey = laterVenue?.travelZone || laterVenue?.location;
      const travel = earlierVenue && laterVenue && earlierTravelKey !== laterTravelKey ? resources.travelBufferMinutes : 0;
      const requiredRest = (resources.minimumTeamRestMinutes + travel) * MINUTE;
      if (laterStart - earlierEnd < requiredRest) add(conflictTarget, `Khoảng nghỉ của đội có thể trùng chưa đủ ${resources.minimumTeamRestMinutes + travel} phút sau khi kết thúc trận ${earlier.id}.`, "TEAM_MINIMUM_REST");
  }

  const dependencyChecks = focusFixtureId
    ? allScheduled.filter((fixture) => fixture.id === focusFixtureId || dependsOnFixture(fixture, focusFixtureId, fixtures))
    : allScheduled;
  for (const fixture of dependencyChecks) {
    const childStart = timestamp(entries[fixture.id].scheduledAt);
    const parents = [fixture.homeSource, fixture.awaySource].map(sourceFixtureId).filter((id): id is string => Boolean(id));
    const qualificationMatches = groupMatchesForQualification(fixture, fixtures);
    const requiredSources = [...fixtures.filter((candidate) => parents.includes(candidate.id)), ...qualificationMatches];
    for (const source of [...new Map(requiredSources.map((item) => [item.id, item])).values()]) {
      const sourceEntry = entries[source.id];
      if (!sourceEntry?.scheduledAt) { add(fixture, `Chưa xếp lịch trận nguồn ${source.id}; cần xác định đội/vị trí trước trận này.`, "SOURCE_FIXTURE_UNSCHEDULED"); continue; }
      const earliestChild = timestamp(sourceEntry.scheduledAt) + (matchPlayMinutes(source, resources) + resources.minimumTeamRestMinutes) * MINUTE;
      if (childStart < earliestChild) add(fixture, `Trận này phải diễn ra sau trận nguồn ${source.id} và đủ thời gian nghỉ tối thiểu.`, "SOURCE_DEPENDENCY");
    }
  }
  return [...new Map(issues.map((issue) => [`${issue.fixtureId}:${issue.code}:${issue.message}`, issue])).values()];
}

/** Advisory fairness findings; these never prevent a valid manual save. */
export function getScheduleObjectiveWarnings(
  fixtures: DemoFixture[], entries: Record<string, DemoScheduleEntry>, resources: DemoScheduleResources,
): ScheduleConstraintIssue[] {
  const warnings: ScheduleConstraintIssue[] = [];
  const venueByName = new Map(resources.venues.flatMap((venue) => [[venue.name, venue], [venue.code, venue]]));
  const teamMatches = new Map<string, DemoFixture[]>();
  for (const fixture of fixtures) {
    const entry = entries[fixture.id];
    if (!entry?.scheduledAt) continue;
    const venue = venueByName.get(entry.venue);
    const slot = resources.slots.find((candidate) => candidate.id === entry.slotId);
    if (slot?.priority === "RESTRICTED") warnings.push({ fixtureId: fixture.id, code: "RESTRICTED_TIME_SLOT", severity: "WARNING", message: "Trận được xếp vào khung giờ hạn chế " + slot.label + "." });
    if (resources.centralVenuePreferredStages?.includes(fixture.round) && venue && !venue.central) warnings.push({ fixtureId: fixture.id, code: "CENTRAL_VENUE_PREFERENCE", severity: "WARNING", message: "Ưu tiên sân trung tâm cho " + fixture.round + "; trận hiện ở " + venue.name + "." });
    const stageVenue = resources.venues.find((candidate) => candidate.preferredStages?.includes(fixture.round));
    if (stageVenue && venue && stageVenue.id !== venue.id) warnings.push({ fixtureId: fixture.id, code: "VENUE_STAGE_PREFERENCE", severity: "WARNING", message: "Sân " + stageVenue.name + " được ưu tiên cho " + fixture.round + "." });
    if (resources.rotateVenues && venue && fixtures.some((other) => other.id !== fixture.id && other.groupName === fixture.groupName && entries[other.id]?.scheduledAt && venueByName.get(entries[other.id].venue)?.id === venue.id)) warnings.push({ fixtureId: fixture.id, code: "VENUE_ROTATION", severity: "WARNING", message: "Mục tiêu xoay tua sân chưa đạt hoàn toàn trong " + (fixture.groupName ?? "giải") + "." });
    if (resources.rotateTimeSlots && entry.slotId && fixtures.some((other) => other.id !== fixture.id && other.groupName === fixture.groupName && entries[other.id]?.slotId === entry.slotId)) warnings.push({ fixtureId: fixture.id, code: "SLOT_ROTATION", severity: "WARNING", message: "Mục tiêu xoay tua khung giờ chưa đạt hoàn toàn trong " + (fixture.groupName ?? "giải") + "." });
    for (const teamId of [fixture.homeTeamId, fixture.awayTeamId].filter((id): id is string => Boolean(id))) teamMatches.set(teamId, [...(teamMatches.get(teamId) ?? []), fixture]);
  }
  if (resources.scheduleMode === "HOME_AWAY" && resources.maximumConsecutiveHomeAway) {
    for (const [teamId, matches] of teamMatches) {
      const ordered = matches.sort((a, b) => timestamp(entries[a.id].scheduledAt) - timestamp(entries[b.id].scheduledAt));
      let streak = 0; let previousSide = "";
      for (const fixture of ordered) {
        const side = fixture.homeTeamId === teamId ? "HOME" : "AWAY";
        streak = side === previousSide ? streak + 1 : 1; previousSide = side;
        if (streak > resources.maximumConsecutiveHomeAway) warnings.push({ fixtureId: fixture.id, code: "HOME_AWAY_STREAK", severity: "WARNING", message: "Đội " + teamId + " vượt mục tiêu tối đa " + resources.maximumConsecutiveHomeAway + " trận sân nhà/sân khách liên tiếp; cặp đấu đã được giữ nguyên theo sơ đồ." });
      }
    }
  }
  if (resources.maximumKnockoutRestDifferenceMinutes && resources.maximumKnockoutRestDifferenceMinutes > 0) {
    for (const fixture of fixtures.filter((item) => item.stage === "KNOCKOUT" && entries[item.id]?.scheduledAt)) {
      const parents = [fixture.homeSource, fixture.awaySource].map(sourceFixtureId).filter((id): id is string => Boolean(id)).map((id) => fixtures.find((candidate) => candidate.id === id)).filter((item): item is DemoFixture => Boolean(item));
      const parentStarts = parents.map((parent) => entries[parent.id]?.scheduledAt).filter((value): value is string => Boolean(value));
      if (parentStarts.length < 2) continue;
      const childStart = timestamp(entries[fixture.id].scheduledAt);
      const rests = parents.map((parent) => childStart - (timestamp(entries[parent.id].scheduledAt) + matchPlayMinutes(parent, resources) * MINUTE));
      const spreadMinutes = (Math.max(...rests) - Math.min(...rests)) / MINUTE;
      if (spreadMinutes > resources.maximumKnockoutRestDifferenceMinutes) warnings.push({ fixtureId: fixture.id, code: "KNOCKOUT_REST_IMBALANCE", severity: resources.maximumKnockoutRestDifferenceRequired ? "HARD" : "WARNING", message: "Chênh lệch thời gian nghỉ giữa các nhánh là " + Math.round(spreadMinutes) + " phút (mục tiêu tối đa " + resources.maximumKnockoutRestDifferenceMinutes + ")." });
    }
  }
  return [...new Map(warnings.map((item) => [item.fixtureId + ":" + item.code, item])).values()];
}

/** Enumerate only valid date/venue/time choices. Times are kickoff times; prep and turnover occupy the field around them. */
export function getManualScheduleCandidates(
  fixture: DemoFixture,
  fixtures: DemoFixture[],
  entries: Record<string, DemoScheduleEntry>,
  resources: DemoScheduleResources,
  pitchType: 5 | 7 | 11,
): ManualScheduleCandidate[] {
  const phaseDates = dateRangeForFixture(fixture, resources);
  if (!phaseDates.start || !phaseDates.end || phaseDates.start > phaseDates.end || fixture.bye) return [];
  const existing = entries[fixture.id];
  const base: DemoScheduleEntry = { scheduledAt: "", durationMinutes: matchPlayMinutes(fixture, resources), venue: "", refereeNames: existing?.refereeNames ?? [], notes: existing?.notes ?? "", locked: existing?.locked };
  const others = { ...entries }; delete others[fixture.id];
  const candidates: ManualScheduleCandidate[] = [];
  const start = new Date(`${phaseDates.start}T12:00:00`);
  const end = new Date(`${phaseDates.end}T12:00:00`);
  const days = Math.min(730, Math.floor((end.getTime() - start.getTime()) / (24 * 60 * MINUTE)) + 1);
  const venues = resources.venues.filter((venue) => venue.active && venue.pitchType === pitchType && venue.availabilityConfirmed === true);
  for (let offset = 0; offset < days; offset += 1) {
    const date = new Date(start.getTime() + offset * 24 * 60 * MINUTE).toISOString().slice(0, 10);
    const day = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (!resources.allowedWeekdays.includes(day) || resources.blockedDates.includes(date)) continue;
    for (const venue of venues) {
      const dayWindows = venueAvailabilityWindowsForDate(venue, date);
      if (!dayWindows.length) continue;
      const profile = profileFor(fixture, resources);
      const prep = profile.preparationBeforeMinutes;
      const post = matchPlayMinutes(fixture, resources) + profile.transitionAfterMinutes + venue.turnaroundMinutes;
      for (const slot of resources.slots) for (const window of dayWindows) {
        const earliest = Math.max(minutesOfDay(slot.start), minutesOfDay(window.start)) + prep;
        const latest = Math.min(minutesOfDay(slot.end), minutesOfDay(window.end)) - post;
        const first = Math.ceil(earliest / 15) * 15;
        for (let kickoff = first; kickoff <= latest; kickoff += 15) {
          const hh = String(Math.floor(kickoff / 60)).padStart(2, "0"); const mm = String(kickoff % 60).padStart(2, "0");
          const scheduledAt = `${date}T${hh}:${mm}`;
          const endAtDate = new Date(timestamp(scheduledAt) + matchPlayMinutes(fixture, resources) * MINUTE);
          const endAt = `${String(endAtDate.getHours()).padStart(2, "0")}:${String(endAtDate.getMinutes()).padStart(2, "0")}`;
          const proposed = { ...base, scheduledAt, venue: venue.code, slotId: slot.id };
          const issues = validateSchedulePlan(fixtures, { ...others, [fixture.id]: proposed }, resources, pitchType, fixture.id);
          const hardFairness = getScheduleObjectiveWarnings(fixtures, { ...others, [fixture.id]: proposed }, resources).some((issue) => issue.severity === "HARD");
          if (!issues.length && !hardFairness) candidates.push({ date, venue, scheduledAt, endAt, slotId: slot.id, slotLabel: slot.label });
        }
      }
    }
  }
  // The first candidate is the deterministic earliest valid option across all
  // venues and slots (not merely the first venue encountered in input order).
  return candidates.sort((a, b) => a.date.localeCompare(b.date)
    || a.scheduledAt.localeCompare(b.scheduledAt)
    || a.venue.id.localeCompare(b.venue.id)
    || a.slotId.localeCompare(b.slotId));
}

/**
 * Bounded, date/venue-diverse candidate enumeration for the automatic planner.
 * It uses the exact same validation rules as manual editing, but samples at
 * venue-occupancy boundaries and keeps a few choices for each resource bucket.
 */
export function getAutomaticScheduleCandidates(
  fixture: DemoFixture,
  fixtures: DemoFixture[],
  entries: Record<string, DemoScheduleEntry>,
  resources: DemoScheduleResources,
  pitchType: 5 | 7 | 11,
  options: { maximumCandidates?: number; maximumPerBucket?: number; maximumProbes?: number; shouldStop?: () => boolean; onLimitReached?: () => void; onRejected?: (code: string, message: string) => void; existingEntry?: DemoScheduleEntry; dateRange?: { start: string; end: string } } = {},
): ManualScheduleCandidate[] {
  const maximumCandidates = options.maximumCandidates ?? 96;
  const maximumPerBucket = options.maximumPerBucket ?? 2;
  const fixtureDates = dateRangeForFixture(fixture, resources);
  const phaseDates = { start: options.dateRange?.start ? (options.dateRange.start > fixtureDates.start ? options.dateRange.start : fixtureDates.start) : fixtureDates.start,
    end: options.dateRange?.end ? (options.dateRange.end < fixtureDates.end ? options.dateRange.end : fixtureDates.end) : fixtureDates.end };
  if (!phaseDates.start || !phaseDates.end || phaseDates.start > phaseDates.end || fixture.bye) return [];
  const existing = entries[fixture.id] ?? options.existingEntry;
  if (existing?.locked) return [];
  // These lower bounds are already mandatory in validateSchedulePlan. Apply
  // them before minute probing so descendants do not repeatedly scan days
  // that finish before their published sources can possibly be ready.
  const parentIds = [fixture.homeSource, fixture.awaySource].map(sourceFixtureId).filter((id): id is string => Boolean(id));
  const sourceFixtures = [...new Map([...fixtures.filter((item) => parentIds.includes(item.id)), ...groupMatchesForQualification(fixture, fixtures)].map((item) => [item.id, item])).values()];
  let minimumKickoff = Number.NEGATIVE_INFINITY;
  for (const parent of sourceFixtures) {
    const entry = entries[parent.id];
    if (!entry?.scheduledAt) {
      options.onRejected?.("SOURCE_FIXTURE_UNSCHEDULED", `Chưa xếp lịch trận nguồn ${parent.id}; cần xác định đội/vị trí trước trận này.`);
      return [];
    }
    minimumKickoff = Math.max(minimumKickoff, timestamp(entry.scheduledAt) + (matchPlayMinutes(parent, resources) + resources.minimumTeamRestMinutes) * MINUTE);
  }
  if (fixture.stage === "GROUP") for (const earlier of fixtures) {
    if (earlier.stage !== "GROUP" || !sameGroupName(earlier.groupName, fixture.groupName) || !entries[earlier.id]?.scheduledAt) continue;
    const order = (earlier.leg ?? 1) - (fixture.leg ?? 1) || groupRoundNumber(earlier) - groupRoundNumber(fixture);
    if (order < 0) minimumKickoff = Math.max(minimumKickoff, timestamp(entries[earlier.id].scheduledAt) + matchPlayMinutes(earlier, resources) * MINUTE);
  }
  const base: DemoScheduleEntry = { scheduledAt: "", durationMinutes: matchPlayMinutes(fixture, resources), venue: "", refereeNames: existing?.refereeNames ?? [], notes: existing?.notes ?? "", locked: existing?.locked };
  const others = { ...entries }; delete others[fixture.id];
  const candidates: ManualScheduleCandidate[] = [];
  const seen = new Set<string>();
  let probes = 0;
  const start = new Date(`${phaseDates.start}T12:00:00`);
  const end = new Date(`${phaseDates.end}T12:00:00`);
  const days = Math.min(730, Math.floor((end.getTime() - start.getTime()) / (24 * 60 * MINUTE)) + 1);
  const venues = resources.venues.filter((venue) => venue.active && venue.pitchType === pitchType && venue.availabilityConfirmed === true);
  if (existing?.scheduledAt && existing.venue) {
    const venue = venues.find((item) => item.code === existing.venue || item.name === existing.venue);
    const date = localDate(existing.scheduledAt);
    const startMinute = minutesOfDay(existing.scheduledAt.slice(11, 16));
    const profile = profileFor(fixture, resources);
    const occupiedStart = startMinute - profile.preparationBeforeMinutes;
    const occupiedEnd = startMinute + matchPlayMinutes(fixture, resources) + profile.transitionAfterMinutes + (venue?.turnaroundMinutes ?? 0);
    const slot = resources.slots.find((item) => item.id === existing.slotId && occupiedStart >= minutesOfDay(item.start) && occupiedEnd <= minutesOfDay(item.end))
      ?? resources.slots.find((item) => occupiedStart >= minutesOfDay(item.start) && occupiedEnd <= minutesOfDay(item.end));
    const candidateDate = new Date(`${date}T12:00:00Z`);
    const day = candidateDate.getUTCDay();
    if (venue && slot && resources.allowedWeekdays.includes(day) && !resources.blockedDates.includes(date) && venueAvailabilityWindowsForDate(venue, date).length > 0) {
      const proposed = { ...base, ...existing, scheduledAt: existing.scheduledAt, venue: venue.code, slotId: slot.id };
      const issues = validateSchedulePlan(fixtures, { ...others, [fixture.id]: proposed }, resources, pitchType, fixture.id);
      const hardFairness = resources.maximumKnockoutRestDifferenceRequired && fixtures.some((item) => item.stage === "KNOCKOUT")
        && getScheduleObjectiveWarnings(fixtures, { ...others, [fixture.id]: proposed }, resources).some((issue) => issue.severity === "HARD");
      if (!issues.length && !hardFairness) {
        const endAtDate = new Date(timestamp(existing.scheduledAt) + matchPlayMinutes(fixture, resources) * MINUTE);
        candidates.push({ date, venue, scheduledAt: existing.scheduledAt, endAt: `${String(endAtDate.getHours()).padStart(2, "0")}:${String(endAtDate.getMinutes()).padStart(2, "0")}`, slotId: slot.id, slotLabel: slot.label });
        seen.add(`${existing.scheduledAt}|${venue.id}`);
      }
    }
  }
  dateLoop: for (let offset = 0; offset < days && candidates.length < maximumCandidates; offset += 1) {
    const date = new Date(start.getTime() + offset * 24 * 60 * MINUTE).toISOString().slice(0, 10);
    const day = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (!resources.allowedWeekdays.includes(day) || resources.blockedDates.includes(date)) continue;
    for (const venue of venues) {
      if (candidates.length >= maximumCandidates) break;
      const dayWindows = venueAvailabilityWindowsForDate(venue, date);
      if (!dayWindows.length) continue;
      const profile = profileFor(fixture, resources);
      const prep = profile.preparationBeforeMinutes;
      const post = matchPlayMinutes(fixture, resources) + profile.transitionAfterMinutes + venue.turnaroundMinutes;
      for (const slot of resources.slots) for (const window of dayWindows) {
        if (candidates.length >= maximumCandidates) break;
        const earliest = Math.max(Math.max(minutesOfDay(slot.start), minutesOfDay(window.start)) + prep,
          Math.ceil((minimumKickoff - timestamp(`${date}T00:00`)) / MINUTE));
        const latest = Math.min(minutesOfDay(slot.end), minutesOfDay(window.end)) - post;
        const first = Math.ceil(earliest);
        const validInBucket: ManualScheduleCandidate[] = [];
        let probeLimitReached = false;
        for (let kickoff = first; kickoff <= latest; kickoff += 1) {
          probes += 1;
          if (options.shouldStop?.()) break dateLoop;
          if (probes > (options.maximumProbes ?? 5_000)) { options.onLimitReached?.(); probeLimitReached = true; break; }
          const hh = String(Math.floor(kickoff / 60)).padStart(2, "0");
          const mm = String(kickoff % 60).padStart(2, "0");
          const scheduledAt = `${date}T${hh}:${mm}`;
          const candidateKey = `${scheduledAt}|${venue.id}`;
          if (seen.has(candidateKey)) continue;
          const endAtDate = new Date(timestamp(scheduledAt) + matchPlayMinutes(fixture, resources) * MINUTE);
          const endAt = `${String(endAtDate.getHours()).padStart(2, "0")}:${String(endAtDate.getMinutes()).padStart(2, "0")}`;
          const proposed = { ...base, scheduledAt, venue: venue.code, slotId: slot.id };
          const issues = validateSchedulePlan(fixtures, { ...others, [fixture.id]: proposed }, resources, pitchType, fixture.id);
          if (issues.length) {
            issues.forEach((issue) => options.onRejected?.(issue.code, issue.message));
            continue;
          }
          const hardFairness = resources.maximumKnockoutRestDifferenceRequired && fixtures.some((item) => item.stage === "KNOCKOUT")
            ? getScheduleObjectiveWarnings(fixtures, { ...others, [fixture.id]: proposed }, resources).filter((issue) => issue.severity === "HARD")
            : [];
          if (hardFairness.length) {
            hardFairness.forEach((issue) => options.onRejected?.(issue.code, issue.message));
            continue;
          }
          const candidate = { date, venue, scheduledAt, endAt, slotId: slot.id, slotLabel: slot.label };
          validInBucket.push(candidate);
          seen.add(candidateKey);
          // A one-representative bucket returns its first valid minute. Once
          // found, scanning later minutes cannot change that result.
          if (maximumPerBucket === 1) break;
        }
        // The scan above is minute precise so narrow, non-grid-aligned windows
        // are not silently skipped. Keep representative boundary/midpoint
        // choices from each continuous availability bucket for bounded search.
        const representativeIndexes = maximumPerBucket <= 1 ? [0]
          : maximumPerBucket === 2 ? [0, validInBucket.length - 1]
            : [0, Math.floor((validInBucket.length - 1) / 2), validInBucket.length - 1];
        const representatives = validInBucket.length <= maximumPerBucket
          ? validInBucket
          : [...new Set(representativeIndexes)].map((index) => validInBucket[index]);
        candidates.push(...representatives);
        if (probeLimitReached) break dateLoop;
        if (candidates.length >= maximumCandidates) { options.onLimitReached?.(); break dateLoop; }
      }
    }
  }
  return candidates;
}

/** Candidate plans for a required same-time final-round cluster; validates the full cluster before returning it. */
export function getFinalRoundClusterOptions(
  groupFixtures: DemoFixture[], fixtures: DemoFixture[], entries: Record<string, DemoScheduleEntry>, resources: DemoScheduleResources,
  pitchType: 5 | 7 | 11,
): FinalRoundClusterOption[] {
  if (groupFixtures.length < 2 || !resources.competitionStartDate || !resources.competitionEndDate) return [];
  const perFixture = groupFixtures.map((fixture) => getManualScheduleCandidates(fixture, fixtures, entries, resources, pitchType));
  if (perFixture.some((options) => !options.length)) return [];
  const result: FinalRoundClusterOption[] = [];
  const firstExisting = entries[groupFixtures[0].id];
  for (const first of perFixture[0]) {
    if (firstExisting?.scheduledAt && first.scheduledAt !== firstExisting.scheduledAt) continue;
    if (firstExisting?.venue && first.venue.code !== firstExisting.venue && first.venue.name !== firstExisting.venue) continue;
    const venues: DemoScheduleVenue[] = [first.venue];
    let valid = true;
    for (let index = 1; index < groupFixtures.length; index += 1) {
      const existing = entries[groupFixtures[index].id];
      const match = perFixture[index].find((candidate) => candidate.scheduledAt === first.scheduledAt && (!existing?.scheduledAt || candidate.scheduledAt === existing.scheduledAt) && (!existing?.venue || candidate.venue.code === existing.venue || candidate.venue.name === existing.venue) && candidate.venue.id !== first.venue.id && !venues.some((venue) => venue.id === candidate.venue.id));
      if (!match) { valid = false; break; }
      venues.push(match.venue);
    }
    if (!valid) continue;
    const proposed = { ...entries };
    groupFixtures.forEach((fixture, index) => {
      const candidate = perFixture[index].find((item) => item.scheduledAt === first.scheduledAt && item.venue.id === venues[index].id)!;
      const previous = entries[fixture.id];
      proposed[fixture.id] = { ...previous, scheduledAt: candidate.scheduledAt, durationMinutes: matchPlayMinutes(fixture, resources), venue: candidate.venue.code, slotId: candidate.slotId, refereeNames: previous?.refereeNames ?? [], notes: previous?.notes ?? "" };
    });
    if (validateSchedulePlan(fixtures, proposed, resources, pitchType).length) continue;
    result.push({ date: first.date, scheduledAt: first.scheduledAt, slotId: first.slotId, slotLabel: first.slotLabel, venues });
  }
  return result;
}

/** Read-only statistics for the manual scheduling dashboard. */
export function getScheduleStatistics(fixtures: DemoFixture[], entries: Record<string, DemoScheduleEntry>, resources: DemoScheduleResources) {
  const venueByName = new Map(resources.venues.flatMap((venue) => [[venue.name, venue], [venue.code, venue]]));
  const scheduled = fixtures.filter((fixture) => entries[fixture.id]?.scheduledAt);
  const countBy = (keyOf: (fixture: DemoFixture) => string) => {
    const values: Record<string, number> = {};
    for (const fixture of scheduled) { const key = keyOf(fixture); values[key] = (values[key] ?? 0) + 1; }
    return values;
  };
  const teamMatches = new Map<string, Array<{ start: number; end: number }>>();
  for (const fixture of scheduled) for (const teamId of [fixture.homeTeamId, fixture.awayTeamId].filter((id): id is string => Boolean(id))) {
    teamMatches.set(teamId, [...(teamMatches.get(teamId) ?? []), { start: timestamp(entries[fixture.id].scheduledAt), end: scheduledEnd(fixture, entries[fixture.id], resources) }]);
  }
  const restIntervals: number[] = [];
  for (const matches of teamMatches.values()) {
    matches.sort((a, b) => a.start - b.start);
    for (let index = 1; index < matches.length; index += 1) restIntervals.push((matches[index].start - matches[index - 1].end) / MINUTE);
  }
  return {
    byDate: countBy((fixture) => localDate(entries[fixture.id].scheduledAt)),
    byVenue: countBy((fixture) => venueByName.get(entries[fixture.id].venue)?.name ?? entries[fixture.id].venue),
    byGroup: countBy((fixture) => fixture.groupName ?? "Không thuộc bảng"),
    byRound: countBy((fixture) => fixture.round),
    byTeam: Object.fromEntries([...teamMatches.entries()].map(([teamId, matches]) => [teamId, matches.length])),
    shortestRestMinutes: restIntervals.length ? Math.min(...restIntervals) : null,
    longestRestMinutes: restIntervals.length ? Math.max(...restIntervals) : null,
    teamsWithSchedules: teamMatches.size,
  };
}
