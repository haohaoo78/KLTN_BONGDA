const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildAutomaticSchedulePlan,
  buildAutomaticRefereePlan,
  getManualScheduleCandidates,
  getAutomaticScheduleCandidates,
  matchPlayMinutes,
  validateSchedulePlan,
  validateScheduleResourceConfiguration,
  analyzeScheduleResourceChange,
  analyzeScheduleSetup,
  validateScheduleSetupAgainstTournament,
  buildScheduleSetupSuggestions,
  getFinalRoundFixturesByGroup,
  normalizeScheduleDecisionTiming,
  automaticScheduleBaseSignature,
  MAX_AUTOMATIC_SCHEDULE_RUNTIME_MS,
} = require("@sfl/shared");

const fixtures = [
  { id: "fixture-1", stage: "GROUP", groupName: "A", round: "Vòng 1", homeTeamId: "team-a", awayTeamId: "team-b" },
  { id: "fixture-2", stage: "GROUP", groupName: "A", round: "Vòng 1", homeTeamId: "team-c", awayTeamId: "team-d" },
];
const resources = {
  setupRegulationVersion: 3,
  competitionStartDate: "2026-12-01", competitionEndDate: "2026-12-02", allowedWeekdays: [2, 3],
  slots: [{ id: "morning", label: "Buổi sáng", start: "08:00", end: "12:00" }], blockedDates: [],
  groupTiming: { halfMinutes: 20, halftimeBreakMinutes: 10, preparationBeforeMinutes: 10, transitionAfterMinutes: 10, extraTimeReserveMinutes: 0, penaltyReserveMinutes: 0 },
  knockoutTiming: { halfMinutes: 20, halftimeBreakMinutes: 10, preparationBeforeMinutes: 10, transitionAfterMinutes: 10, extraTimeReserveMinutes: 0, penaltyReserveMinutes: 0 },
  minimumTeamRestMinutes: 120, maximumMatchesPerTeamPerDay: 1, travelBufferMinutes: 0,
    venues: [{ id: "venue-1", code: "V1", name: "Sân 1", location: "Cơ sở A", pitchType: 7, active: true, weekdays: [2, 3], availableFrom: "07:00", availableTo: "18:00", turnaroundMinutes: 5, unavailablePeriods: [], availabilityConfirmed: true }],
};

const decisionTournament = (competitionFormat, knockoutDecisionMethod, extraTimeMinutes) => ({
  tournamentId: "official-decision", name: "Decision timing QA", status: "ROSTER_LOCKED", startDate: "2026-12-01", endDate: "2026-12-02", location: null,
  footballFormat: 7, competitionFormat, teamCount: 4, regulationVersion: 3,
  rules: { matchDurationMinutes: 40, minimumRestMinutes: 120, knockoutDecisionMethod, extraTimeMinutes },
});

test("direct penalties force extra-time reserve zero and preserve an applicable penalty reserve of zero", () => {
  const stale = { ...resources, groupTiming: { ...resources.groupTiming, extraTimeReserveMinutes: 20, penaltyReserveMinutes: 10 }, knockoutTiming: { ...resources.knockoutTiming, extraTimeReserveMinutes: 30, penaltyReserveMinutes: 0 } };
  const normalized = normalizeScheduleDecisionTiming(decisionTournament("KNOCKOUT", "PENALTIES_ONLY", 30), stale);
  assert.equal(normalized.groupTiming.extraTimeReserveMinutes, 0);
  assert.equal(normalized.groupTiming.penaltyReserveMinutes, 0);
  assert.equal(normalized.knockoutTiming.extraTimeReserveMinutes, 0);
  assert.equal(normalized.knockoutTiming.penaltyReserveMinutes, 0);
  assert.equal(normalized.setupProvenance["knockoutTiming.extraTimeReserveMinutes"].confirmed, true);
  assert.equal(normalized.setupProvenance["knockoutTiming.extraTimeReserveMinutes"].adjustable, false);
  assert.equal(stale.knockoutTiming.extraTimeReserveMinutes, 30, "normalizing a proposal must not mutate the saved object");
  assert.equal(normalized.minimumTeamRestMinutes, stale.minimumTeamRestMinutes);
  assert.equal(normalized.slots, stale.slots);
});

test("extra-time reserve comes from official extraTimeMinutes even after an old organizer override", () => {
  const stale = { ...resources, knockoutTiming: { ...resources.knockoutTiming, extraTimeReserveMinutes: 99, penaltyReserveMinutes: 12 }, setupProvenance: { "knockoutTiming.extraTimeReserveMinutes": { source: "ORGANIZER_CONFIRMED", sourceLabel: "BTC", explanation: "Old override", confirmed: true, adjustable: true } } };
  const tournament = decisionTournament("GROUP_AND_KNOCKOUT", "EXTRA_TIME_THEN_PENALTIES", 30);
  const suggested = buildScheduleSetupSuggestions(tournament, stale);
  assert.equal(suggested.knockoutTiming.extraTimeReserveMinutes, 30);
  assert.equal(suggested.knockoutTiming.penaltyReserveMinutes, 12);
  assert.equal(suggested.setupProvenance["knockoutTiming.extraTimeReserveMinutes"].source, "REGULATION");
  assert.equal(suggested.setupProvenance["knockoutTiming.extraTimeReserveMinutes"].confirmed, true);
});

test("a round-robin format or absent knockout decision has no extra-time or penalty reserves", () => {
  const stale = { ...resources, knockoutTiming: { ...resources.knockoutTiming, extraTimeReserveMinutes: 30, penaltyReserveMinutes: 10 } };
  for (const tournament of [decisionTournament("ROUND_ROBIN", "EXTRA_TIME_THEN_PENALTIES", 30), decisionTournament("KNOCKOUT", undefined, 30)]) {
    const suggested = buildScheduleSetupSuggestions(tournament, stale);
    assert.equal(suggested.knockoutTiming.extraTimeReserveMinutes, 0);
    assert.equal(suggested.knockoutTiming.penaltyReserveMinutes, 0);
    assert.equal(suggested.setupProvenance["knockoutTiming.penaltyReserveMinutes"].confirmed, true);
  }
});

test("protected schedule profiles remain byte-for-byte unchanged in read projection", () => {
  const stale = { ...resources, knockoutTiming: { ...resources.knockoutTiming, extraTimeReserveMinutes: 30, penaltyReserveMinutes: 10 }, setupProvenance: { "knockoutTiming.extraTimeReserveMinutes": { source: "ORGANIZER_CONFIRMED", sourceLabel: "BTC", explanation: "Historical allocation", confirmed: true, adjustable: true } } };
  const projected = normalizeScheduleDecisionTiming(decisionTournament("KNOCKOUT", "PENALTIES_ONLY", 30), stale, new Set(["KNOCKOUT"]));
  assert.deepEqual(projected.knockoutTiming, stale.knockoutTiming);
  assert.deepEqual(projected.setupProvenance["knockoutTiming.extraTimeReserveMinutes"], stale.setupProvenance["knockoutTiming.extraTimeReserveMinutes"]);
});

test("decision timing normalization is stable across context/save round trips and validates real rule contradictions", () => {
  const tournament = decisionTournament("KNOCKOUT", "PENALTIES_ONLY", 30);
  const stale = { ...resources, knockoutTiming: { ...resources.knockoutTiming, extraTimeReserveMinutes: 30 } };
  assert.ok(validateScheduleSetupAgainstTournament(tournament, stale, [{ ...fixtures[0], stage: "KNOCKOUT" }]).some((message) => /không được cộng/.test(message)));
  const normalized = normalizeScheduleDecisionTiming(tournament, stale);
  assert.deepEqual(validateScheduleSetupAgainstTournament(tournament, normalized, [{ ...fixtures[0], stage: "KNOCKOUT" }]), []);
  assert.equal(automaticScheduleBaseSignature(fixtures, {}, normalized), automaticScheduleBaseSignature(fixtures, {}, normalizeScheduleDecisionTiming(tournament, normalized)));
  const missingExtra = decisionTournament("KNOCKOUT", "EXTRA_TIME_THEN_PENALTIES", undefined);
  assert.ok(validateScheduleSetupAgainstTournament(missingExtra, normalizeScheduleDecisionTiming(missingExtra, stale), [{ ...fixtures[0], stage: "KNOCKOUT" }]).some((message) => /chưa có thời lượng hợp lệ/.test(message)));
});

test("simultaneous group finals include only the final round of the last leg", () => {
  const twoLegFixtures = [1, 2].flatMap((leg) => [1, 2, 3].flatMap((round) => [1, 2].map((match) => ({
    id: `A-L${leg}-R${round}-M${match}`, stage: "GROUP", groupName: "A", leg,
    round: `Bảng A · Vòng ${round}${leg === 2 ? " · Lượt 2" : ""}`,
    homeTeamId: `team-${match * 2 - 1}`, awayTeamId: `team-${match * 2}`,
  }))));
  const finalGroup = getFinalRoundFixturesByGroup(twoLegFixtures);
  assert.equal(finalGroup.length, 1);
  assert.deepEqual(finalGroup[0].fixtures.map((fixture) => fixture.id), ["A-L2-R3-M1", "A-L2-R3-M2"]);
  const oneLegFixtures = twoLegFixtures.filter((fixture) => fixture.leg === 1);
  assert.deepEqual(getFinalRoundFixturesByGroup(oneLegFixtures)[0].fixtures.map((fixture) => fixture.id), ["A-L1-R3-M1", "A-L1-R3-M2"]);
  const absentLeg = oneLegFixtures.map(({ leg, ...fixture }) => fixture);
  assert.deepEqual(getFinalRoundFixturesByGroup(absentLeg)[0].fixtures.map((fixture) => fixture.id), ["A-L1-R3-M1", "A-L1-R3-M2"]);
  const twoLegResources = {
    ...resources, competitionEndDate: "2026-12-06", allowedWeekdays: [0, 1, 2, 3, 4, 5, 6], requireSimultaneousGroupFinalRound: true,
    venues: [resources.venues[0], { ...resources.venues[0], id: "venue-2", code: "V2", name: "Sân 2" }].map((venue) => ({ ...venue, weekdays: [0, 1, 2, 3, 4, 5, 6] })),
  };
  const entries = Object.fromEntries(twoLegFixtures.map((fixture) => {
    const round = Number(fixture.round.match(/Vòng (\d+)/)[1]);
    const date = String((fixture.leg - 1) * 3 + round).padStart(2, "0");
    return [fixture.id, { scheduledAt: `2026-12-${date}T09:00:00`, durationMinutes: 50, venue: fixture.id.endsWith("M1") ? "V1" : "V2", refereeNames: [], notes: "" }];
  }));
  assert.deepEqual(validateSchedulePlan(twoLegFixtures, entries, twoLegResources, 7).filter((issue) => issue.code.startsWith("FINAL_ROUND_")), [], "the first-leg final may occur on a different date from the last-leg final");
  const invalidFinal = { ...entries, "A-L2-R3-M2": { ...entries["A-L2-R3-M2"], scheduledAt: "2026-12-06T10:00:00" } };
  assert.ok(validateSchedulePlan(twoLegFixtures, invalidFinal, twoLegResources, 7).some((issue) => issue.code === "FINAL_ROUND_KICKOFF_MISMATCH"));
});

test("shared engine returns valid manual candidates and rejects overlapping pitch occupancy", () => {
  const candidates = getManualScheduleCandidates(fixtures[0], fixtures, {}, resources, 7);
  assert.ok(candidates.length > 0);
  const scheduled = {
    "fixture-1": { scheduledAt: "2026-12-01T08:00:00", durationMinutes: 50, venue: "V1", refereeNames: [], notes: "" },
    "fixture-2": { scheduledAt: "2026-12-01T08:00:00", durationMinutes: 50, venue: "V1", refereeNames: [], notes: "" },
  };
  assert.ok(validateSchedulePlan(fixtures, scheduled, resources, 7).some((issue) => issue.code === "VENUE_OVERLAP"));
});

test("unconfirmed pitches can be saved as resources but are excluded from scheduling", () => {
  const unconfirmed = { ...resources, venues: resources.venues.map((venue) => ({ ...venue, availabilityConfirmed: false })) };
  assert.ok(validateScheduleResourceConfiguration(unconfirmed, 7).some((issue) => issue.code === "VENUE_AVAILABILITY_UNCONFIRMED" && issue.severity === "WARNING"));
  assert.deepEqual(getManualScheduleCandidates(fixtures[0], fixtures, {}, unconfirmed, 7), []);
  const scheduled = { "fixture-1": { scheduledAt: "2026-12-01T08:00:00", durationMinutes: 50, venue: "V1", refereeNames: [], notes: "" } };
  assert.ok(validateSchedulePlan(fixtures, scheduled, unconfirmed, 7).some((issue) => issue.code === "VENUE_AVAILABILITY_UNCONFIRMED"));
});

test("setup confirmation only blocks a stage present in the published fixtures", () => {
  const proposal = (explanation) => ({
    source: "SYSTEM_PROPOSED", sourceLabel: "System proposal", explanation, confirmed: false, adjustable: true,
  });
  const withProposals = {
    ...resources,
    setupProvenance: {
      "groupTiming.halftimeBreakMinutes": proposal("Group timing applies."),
      "knockoutTiming.halftimeBreakMinutes": proposal("Knockout timing applies only to knockout fixtures."),
    },
  };
  const groupIssues = validateSchedulePlan(fixtures, {}, withProposals, 7)
    .filter((issue) => issue.code === "SETUP_CONFIRMATION_REQUIRED");
  assert.deepEqual(groupIssues.map((issue) => issue.message).sort(), [
    "Cần BTC xác nhận thông số hệ thống đề xuất: groupTiming.halftimeBreakMinutes.",
  ]);

  const mixedFixtures = [...fixtures, {
    id: "fixture-knockout", stage: "KNOCKOUT", round: "Bán kết", homeTeamId: null, awayTeamId: null,
  }];
  const mixedIssues = validateSchedulePlan(mixedFixtures, {}, withProposals, 7)
    .filter((issue) => issue.code === "SETUP_CONFIRMATION_REQUIRED");
  assert.deepEqual(mixedIssues.map((issue) => issue.message).sort(), [
    "Cần BTC xác nhận thông số hệ thống đề xuất: groupTiming.halftimeBreakMinutes.",
    "Cần BTC xác nhận thông số hệ thống đề xuất: knockoutTiming.halftimeBreakMinutes.",
  ]);
});

test("manual candidate generation respects separate availability windows for a pitch", () => {
  const splitWindows = { ...resources, venues: resources.venues.map((venue) => ({
    ...venue,
    availableSlots: [{ id: "morning-window", start: "08:00", end: "10:00" }, { id: "late-window", start: "11:00", end: "14:00" }],
  })) };
  const candidates = getManualScheduleCandidates(fixtures[0], fixtures, {}, splitWindows, 7);
  assert.ok(candidates.length > 0);
  for (const candidate of candidates) {
    const kickoff = new Date(candidate.scheduledAt);
    const occupiedStart = kickoff.getHours() * 60 + kickoff.getMinutes() - splitWindows.groupTiming.preparationBeforeMinutes;
    const occupiedEnd = kickoff.getHours() * 60 + kickoff.getMinutes() + 50 + splitWindows.groupTiming.transitionAfterMinutes + candidate.venue.turnaroundMinutes;
    assert.ok(splitWindows.venues[0].availableSlots.some((window) => occupiedStart >= Number(window.start.slice(0, 2)) * 60 + Number(window.start.slice(3))
      && occupiedEnd <= Number(window.end.slice(0, 2)) * 60 + Number(window.end.slice(3))));
  }
});

test("venue date overrides affect only the selected day and retain the weekly schedule on other days", () => {
  const dateSpecific = {
    ...resources,
    venues: resources.venues.map((venue) => ({
      ...venue,
      availabilityStartDate: "2026-12-01",
      availabilityEndDate: "2026-12-02",
      dateOverrides: [{ date: "2026-12-01", unavailable: false, availableSlots: [{ id: "only-tuesday", start: "08:00", end: "10:00" }] }],
    })),
  };
  const candidates = getManualScheduleCandidates(fixtures[0], fixtures, {}, dateSpecific, 7);
  const tuesday = candidates.filter((candidate) => candidate.date === "2026-12-01");
  const wednesday = candidates.filter((candidate) => candidate.date === "2026-12-02");
  assert.ok(tuesday.length > 0);
  assert.ok(wednesday.length > 0);
  for (const candidate of tuesday) {
    const start = new Date(candidate.scheduledAt).getHours() * 60 + new Date(candidate.scheduledAt).getMinutes();
    const occupiedStart = start - dateSpecific.groupTiming.preparationBeforeMinutes;
    const occupiedEnd = start + matchPlayMinutes(fixtures[0], dateSpecific) + dateSpecific.groupTiming.transitionAfterMinutes + candidate.venue.turnaroundMinutes;
    assert.ok(occupiedStart >= 8 * 60 && occupiedEnd <= 10 * 60);
  }
  assert.ok(wednesday.some((candidate) => new Date(candidate.scheduledAt).getHours() < 10), "the unaffected Wednesday still uses its weekly availability");
});

test("venue date range and day-off overrides are enforced when validating schedules", () => {
  const restricted = {
    ...resources,
    venues: resources.venues.map((venue) => ({
      ...venue,
      availabilityStartDate: "2026-12-02",
      availabilityEndDate: "2026-12-02",
      dateOverrides: [{ date: "2026-12-02", unavailable: true, availableSlots: [] }],
    })),
  };
  const beforeRange = { "fixture-1": { scheduledAt: "2026-12-01T08:00:00", durationMinutes: 50, venue: "V1", refereeNames: [], notes: "" } };
  const dayOff = { "fixture-1": { scheduledAt: "2026-12-02T08:00:00", durationMinutes: 50, venue: "V1", refereeNames: [], notes: "" } };
  assert.ok(validateSchedulePlan(fixtures, beforeRange, restricted, 7).some((issue) => issue.code === "VENUE_OUTSIDE_DATE_RANGE"));
  assert.ok(validateSchedulePlan(fixtures, dayOff, restricted, 7).some((issue) => issue.code === "VENUE_UNAVAILABLE_WINDOW"));
  const invalidRange = { ...resources, venues: resources.venues.map((venue) => ({ ...venue, availabilityStartDate: "2026-11-30" })) };
  assert.ok(validateScheduleResourceConfiguration(invalidRange, 7).some((issue) => issue.code === "VENUE_DATE_RANGE_OUTSIDE_TOURNAMENT"));
  assert.deepEqual(getManualScheduleCandidates(fixtures[0], fixtures, {}, restricted, 7), []);
});

test("automatic candidate scan finds a feasible kickoff that is not on a coarse half-hour grid", () => {
  const narrowWindow = {
    ...resources,
    slots: [{ id: "narrow", label: "Khung sớm", start: "07:57", end: "09:12" }],
    venues: resources.venues.map((venue) => ({ ...venue, availableSlots: [{ id: "narrow", start: "07:57", end: "09:12" }] })),
  };
  const candidates = getAutomaticScheduleCandidates(fixtures[0], fixtures, {}, narrowWindow, 7, { maximumCandidates: 20, maximumPerBucket: 3, maximumProbes: 10_000 });
  assert.ok(candidates.some((candidate) => candidate.scheduledAt === "2026-12-01T08:07"), "minute-precise scan must keep the only earliest valid kickoff");
});

test("manual options are ranked by earliest valid kickoff across venues", () => {
  const multiVenue = { ...resources, venues: [
    { ...resources.venues[0], id: "venue-late", code: "LATE", name: "Sân muộn", availableFrom: "10:00" },
    { ...resources.venues[0], id: "venue-early", code: "EARLY", name: "Sân sớm", availableFrom: "07:00" },
  ] };
  const candidates = getManualScheduleCandidates(fixtures[0], fixtures, {}, multiVenue, 7);
  assert.ok(candidates.length > 0);
  assert.equal(candidates[0].scheduledAt, "2026-12-01T08:15");
  assert.deepEqual(candidates, [...candidates].sort((a, b) => a.date.localeCompare(b.date)
    || a.scheduledAt.localeCompare(b.scheduledAt)
    || a.venue.id.localeCompare(b.venue.id)
    || a.slotId.localeCompare(b.slotId)));
});

test("unconfirmed system setup values block scheduling until BTC confirms them", () => {
  const proposed = {
    ...resources,
    setupProvenance: {
      travelBufferMinutes: { source: "SYSTEM_PROPOSED", sourceLabel: "Đề xuất", explanation: "Chưa xác nhận", confirmed: false, adjustable: true },
    },
  };
  assert.ok(validateScheduleResourceConfiguration(proposed, 7).some((issue) => issue.code === "SETUP_CONFIRMATION_REQUIRED"));
  assert.deepEqual(getManualScheduleCandidates(fixtures[0], fixtures, {}, proposed, 7), []);
  const confirmed = { ...proposed, setupProvenance: { travelBufferMinutes: { ...proposed.setupProvenance.travelBufferMinutes, source: "ORGANIZER_CONFIRMED", confirmed: true } } };
  assert.ok(getManualScheduleCandidates(fixtures[0], fixtures, {}, confirmed, 7).length > 0);
});

test("manual candidates respect date windows configured for each phase", () => {
  const phaseWindow = { ...resources, stageDateRanges: { GROUP: { startDate: "2026-12-02", endDate: "2026-12-02" } } };
  const candidates = getManualScheduleCandidates(fixtures[0], fixtures, {}, phaseWindow, 7);
  assert.ok(candidates.length > 0);
  assert.ok(candidates.every((candidate) => candidate.date === "2026-12-02"));
});

test("resource edit analysis identifies exactly the scheduled match invalidated by a changed window", () => {
  const entries = {
    "fixture-1": { scheduledAt: "2026-12-01T09:00:00", durationMinutes: 50, venue: "V1", refereeNames: [], notes: "" },
    "fixture-2": { scheduledAt: "2026-12-02T08:30:00", durationMinutes: 50, venue: "V1", refereeNames: [], notes: "", locked: true },
  };
  const candidate = { ...resources, venues: resources.venues.map((venue) => ({
    ...venue,
    availableSlots: [{ id: "morning-only", start: "07:00", end: "08:30" }],
  })) };
  const impact = analyzeScheduleResourceChange(fixtures, entries, resources, candidate, 7);
  assert.equal(impact.requiresConfirmation, true);
  assert.deepEqual(impact.affectedFixtureIds, ["fixture-1", "fixture-2"]);
  assert.deepEqual(impact.affectedLockedFixtureIds, ["fixture-2"]);
  assert.ok(impact.newlyInvalidIssues.some((issue) => issue.fixtureId === "fixture-1" && issue.code === "VENUE_UNAVAILABLE_WINDOW"));
});

test("setup analysis uses regulation values, fixture sources and bounded real planner search", async () => {
  const tournament = {
    tournamentId: "test-tournament",
    name: "Setup analysis test",
    status: "ROSTER_LOCKED",
    startDate: "2026-12-01",
    endDate: "2026-12-02",
    location: "Sân A",
    footballFormat: 7,
    competitionFormat: "ROUND_ROBIN",
    teamCount: 4,
    regulationVersion: 3,
    rules: {
      matchDurationMinutes: 40,
      minimumRestMinutes: 120,
      extraTimeMinutes: 0,
      knockoutDecisionMethod: "PENALTIES_ONLY",
      plannedPitchCount: 1,
      playableHoursPerDay: 4,
      competitionConfig: { schedulingStartTime: "08:00", schedulingEndTime: "12:00" },
    },
  };
  const confirmedResources = {
    ...resources,
    scheduleMode: "CENTRALIZED",
    setupProvenance: Object.fromEntries([
      "allowedWeekdays", "slots", "minimumTeamRestMinutes", "maximumMatchesPerTeamPerDay", "travelBufferMinutes", "scheduleMode",
      "groupTiming.halftimeBreakMinutes", "groupTiming.preparationBeforeMinutes", "groupTiming.transitionAfterMinutes",
    ].map((key) => [key, { source: "ORGANIZER_CONFIRMED", sourceLabel: "BTC đã xác nhận", explanation: "Thông số đã được xác nhận cho kịch bản test.", confirmed: true, adjustable: true }])),
  };
  assert.deepEqual(validateScheduleSetupAgainstTournament(tournament, confirmedResources, fixtures), []);
  const result = await analyzeScheduleSetup({ tournament, fixtures, entries: {}, resources: confirmedResources, maxRuntimeMs: 1_000 });
  assert.equal(result.counts.teams, 4);
  assert.equal(result.counts.fixtures, 2);
  assert.equal(result.capacity.confirmedMatchingVenues, 1);
  assert.equal(result.capacity.theoreticalAvailableHours, 8);
  assert.equal(result.search.status, "COMPLETE");
  assert.equal(result.search.scheduled, 2);
});

test("regulation-bound date, duration and time-window conflicts are not treated as editable suggestions", () => {
  const tournament = {
    tournamentId: "test-tournament",
    name: "Regulation bounds test",
    status: "ROSTER_LOCKED",
    startDate: "2026-12-01",
    endDate: "2026-12-02",
    location: "Sân A",
    footballFormat: 7,
    competitionFormat: "ROUND_ROBIN",
    teamCount: 4,
    regulationVersion: 3,
    rules: { matchDurationMinutes: 40, minimumRestMinutes: 120, extraTimeMinutes: 0, knockoutDecisionMethod: "PENALTIES_ONLY", playableHoursPerDay: 3, competitionConfig: { schedulingStartTime: "08:00", schedulingEndTime: "12:00" } },
  };
  const invalid = {
    ...resources,
    competitionStartDate: "2026-11-30",
    groupTiming: { ...resources.groupTiming, halfMinutes: 21 },
    slots: [{ id: "outside-window", label: "Khung ngoài điều lệ", start: "07:00", end: "12:00" }],
  };
  const issues = validateScheduleSetupAgainstTournament(tournament, invalid, fixtures);
  assert.ok(issues.some((message) => message.includes("trước thời gian chính thức")));
  assert.ok(issues.some((message) => message.includes("40 phút")));
  assert.ok(issues.some((message) => message.includes("vượt khung điều lệ")));
});

test("backend derives setup suggestions from official rules and existing confirmed availability", () => {
  const tournament = {
    tournamentId: "test-tournament", name: "Rule sourced setup", status: "ROSTER_LOCKED",
    startDate: "2026-12-01", endDate: "2026-12-02", location: "Sân A", footballFormat: 7,
    competitionFormat: "ROUND_ROBIN", teamCount: 4, regulationVersion: 4,
    rules: { matchDurationMinutes: 40, minimumRestMinutes: 120, extraTimeMinutes: 0, knockoutDecisionMethod: "PENALTIES_ONLY", plannedPitchCount: 1, playableHoursPerDay: 4, competitionConfig: { schedulingStartTime: "08:00", schedulingEndTime: "12:00" } },
  };
  const blank = {
    ...resources,
    competitionStartDate: "", competitionEndDate: "", allowedWeekdays: [], slots: [],
    minimumTeamRestMinutes: 0, maximumMatchesPerTeamPerDay: 0,
    groupTiming: { ...resources.groupTiming, halfMinutes: 0, halftimeBreakMinutes: 0, preparationBeforeMinutes: 0, transitionAfterMinutes: 0 },
    setupProvenance: {}, setupRegulationVersion: null,
  };
  const suggested = buildScheduleSetupSuggestions(tournament, blank);
  assert.equal(suggested.competitionStartDate, tournament.startDate);
  assert.equal(suggested.competitionEndDate, tournament.endDate);
  assert.equal(suggested.groupTiming.halfMinutes, 20);
  assert.equal(suggested.minimumTeamRestMinutes, 120);
  assert.equal(suggested.slots[0].start, "08:00");
  assert.equal(suggested.setupProvenance["groupTiming.halftimeBreakMinutes"].confirmed, false);
  assert.equal(suggested.setupProvenance["groupTiming.halfMinutes"].source, "REGULATION");
  assert.equal(suggested.groupTiming.halfMinutes, 20);
  assert.equal(suggested.setupRegulationVersion, 4);
});

test("shared referee planner handles an empty valid scope without inventing work", () => {
  const plan = buildAutomaticRefereePlan({
    fixtures: [], schedules: {}, resources, roster: { referees: [], models: [], crewTemplates: [], crews: [], neutralRules: [], matchRequirements: {}, evaluations: [] },
    currentAssignments: {}, publishedAssignments: {}, publishedFixtureIds: [], lockedFixtureIds: [], lockedSlotKeysByFixture: {}, teamAffiliations: {}, format: 7,
    configuration: { rounds: [], groups: [], dates: [], onlyUnassignedFixtures: true, onlyMissingSlots: true, method: "MIXED", objectives: ["FEWEST_CANDIDATES"], maxRuntimeMs: 1_000 },
  });
  assert.equal(plan.status, "NO_TARGETS");
  assert.deepEqual(plan.changedFixtureIds, []);
});

test("shared automatic planner proposes a complete non-conflicting plan", async () => {
  const plan = await buildAutomaticSchedulePlan({
    fixtures,
    currentEntries: {},
    resources,
    pitchType: 7,
    configuration: { scope: { phase: "ALL", groups: [], rounds: [], onlyUnscheduled: true }, objectives: ["COMPLETION", "FAIRNESS"], maxRuntimeMs: 1_000 },
  });
  assert.equal(plan.status, "COMPLETE");
  assert.equal(plan.scheduledFixtureIds.length, 2);
  assert.deepEqual(validateSchedulePlan(fixtures, plan.proposedEntries, resources, 7), []);
});

test("official UUID knockout sources are respected by automatic plans and validation", async () => {
  const semifinalId = "11111111-1111-4111-8111-111111111111";
  const finalId = "22222222-2222-4222-8222-222222222222";
  const officialFixtures = [
    { id: semifinalId, stage: "KNOCKOUT", round: "Bán kết", homeTeamId: "team-a", awayTeamId: "team-b" },
    { id: finalId, stage: "KNOCKOUT", round: "Chung kết", homeTeamId: null, awayTeamId: null, homeSource: `Thắng trận ${semifinalId}` },
  ];
  const invalidOrder = {
    [semifinalId]: { scheduledAt: "2026-12-01T10:00:00", durationMinutes: 50, venue: "V1", refereeNames: [], notes: "" },
    [finalId]: { scheduledAt: "2026-12-01T08:00:00", durationMinutes: 50, venue: "V1", refereeNames: [], notes: "" },
  };
  assert.ok(validateSchedulePlan(officialFixtures, invalidOrder, resources, 7).some((issue) => issue.code === "SOURCE_DEPENDENCY"));

  const plan = await buildAutomaticSchedulePlan({
    fixtures: officialFixtures,
    currentEntries: {},
    resources,
    pitchType: 7,
    configuration: { scope: { phase: "ALL", groups: [], rounds: [], onlyUnscheduled: true }, objectives: ["COMPLETION"], maxRuntimeMs: 1_000 },
  });
  assert.ok(plan.proposedEntries[finalId].scheduledAt > plan.proposedEntries[semifinalId].scheduledAt);
});

test("automatic planner supports a prioritized objective to preserve a valid existing schedule", async () => {
  const currentEntries = {
    "fixture-1": { scheduledAt: "2026-12-01T08:10:00", durationMinutes: 50, venue: "V1", slotId: "morning", refereeNames: [], notes: "Giữ lịch đã chốt nội bộ" },
  };
  const plan = await buildAutomaticSchedulePlan({
    fixtures,
    currentEntries,
    resources,
    pitchType: 7,
    configuration: { scope: { phase: "ALL", groups: [], rounds: [], onlyUnscheduled: false }, objectives: ["MINIMIZE_CHANGES", "COMPLETION"], maxRuntimeMs: 1_000 },
  });
  assert.equal(plan.status, "COMPLETE");
  assert.equal(plan.proposedEntries["fixture-1"].scheduledAt, currentEntries["fixture-1"].scheduledAt);
  assert.equal(plan.proposedEntries["fixture-1"].venue, currentEntries["fixture-1"].venue);
});

test("automatic planner filters by round, leg, exact fixture and requested date range", async () => {
  const twoLegFixtures = [
    { ...fixtures[0], id: "leg-1", round: "Vòng 1", leg: 1 },
    { ...fixtures[1], id: "leg-2", round: "Vòng 1", leg: 2 },
  ];
  const plan = await buildAutomaticSchedulePlan({
    fixtures: twoLegFixtures,
    currentEntries: {},
    resources,
    pitchType: 7,
    configuration: {
      scope: { phase: "GROUP", groups: ["A"], rounds: ["Vòng 1"], onlyUnscheduled: true, legs: [2], fixtureIds: ["leg-2"], dateRange: { start: "2026-12-02", end: "2026-12-02" } },
      objectives: ["FAIRNESS", "REST"], maxRuntimeMs: 1_000,
    },
  });
  assert.deepEqual(plan.selectedFixtureIds, ["leg-2"]);
  assert.ok(Object.keys(plan.proposedEntries).includes("leg-2"));
});

test("group chronology rejects interleaved legs and a later round before an earlier round finishes", () => {
  const chronological = [
    { ...fixtures[0], id: "L1R1", leg: 1, roundNumber: 1, round: "Bảng A · Lượt 1 · Vòng 1" },
    { ...fixtures[1], id: "L1R2", leg: 1, roundNumber: 2, round: "Bảng A · Lượt 1 · Vòng 2" },
    { ...fixtures[0], id: "L2R1", leg: 2, roundNumber: 1, round: "Bảng A · Lượt 2 · Vòng 1" },
  ];
  const entryAt = (date, time = "09:00") => ({ scheduledAt: `2026-12-${date}T${time}:00`, durationMinutes: 50, venue: "V1", refereeNames: [], notes: "" });
  const clockResources = { ...resources, competitionEndDate: "2026-12-07", allowedWeekdays: [0, 1, 2, 3, 4, 5, 6], venues: resources.venues.map((venue) => ({ ...venue, weekdays: [0, 1, 2, 3, 4, 5, 6] })) };
  const interleaved = { L1R1: entryAt("01"), L1R2: entryAt("03"), L2R1: entryAt("02") };
  assert.ok(validateSchedulePlan(chronological, interleaved, clockResources, 7).some((issue) => issue.code === "GROUP_ROUND_ORDER"));
  const tooEarly = { L1R1: entryAt("01", "10:00"), L1R2: entryAt("01", "09:00") };
  assert.ok(validateSchedulePlan(chronological, tooEarly, clockResources, 7).some((issue) => issue.code === "GROUP_ROUND_ORDER"));
  assert.ok(validateSchedulePlan(chronological, tooEarly, clockResources, 7, "L1R2").some((issue) => issue.code === "GROUP_ROUND_ORDER"));
  const partial = { L2R1: entryAt("03") };
  assert.ok(!validateSchedulePlan(chronological, partial, clockResources, 7).some((issue) => issue.code === "GROUP_ROUND_ORDER"), "unscheduled earlier rounds are permitted in a partial draft");
  const valid = { L1R1: entryAt("01"), L1R2: entryAt("02"), L2R1: entryAt("03") };
  assert.ok(!validateSchedulePlan(chronological, valid, clockResources, 7).some((issue) => issue.code === "GROUP_ROUND_ORDER"));
});

test("automatic round-robin scheduling completes first-leg rounds before second-leg rounds", async () => {
  const pairings = [[["a", "d"], ["b", "c"]], [["a", "c"], ["d", "b"]], [["a", "b"], ["c", "d"]]];
  const twoLegFixtures = [2, 1].flatMap((leg) => [3, 2, 1].flatMap((round) => pairings[round - 1].map(([home, away], index) => ({
    id: `${leg === 2 ? "a" : "z"}-${round}-${index}`, stage: "GROUP", groupName: "A", leg, roundNumber: round,
    round: `Bảng A · Lượt ${leg} · Vòng ${round}`,
    homeTeamId: leg === 1 ? home : away, awayTeamId: leg === 1 ? away : home,
  }))));
  const weekResources = {
    ...resources, competitionEndDate: "2026-12-07", allowedWeekdays: [0, 1, 2, 3, 4, 5, 6], minimumTeamRestMinutes: 1440,
    slots: [{ id: "day", label: "Cả ngày", start: "08:00", end: "22:00" }],
    venues: [resources.venues[0], { ...resources.venues[0], id: "venue-2", code: "V2", name: "Sân 2" }].map((venue) => ({
      ...venue, weekdays: [0, 1, 2, 3, 4, 5, 6], availableFrom: "08:00", availableTo: "22:00",
      dateOverrides: Array.from({ length: 7 }, (_, day) => ({ date: `2026-12-${String(day + 1).padStart(2, "0")}`, unavailable: false, availableSlots: [{ id: `day-${day + 1}`, start: `${String(8 + day).padStart(2, "0")}:00`, end: `${String(9 + day).padStart(2, "0")}:15` }] })),
    })),
  };
  const plan = await buildAutomaticSchedulePlan({ fixtures: twoLegFixtures, currentEntries: {}, resources: weekResources, pitchType: 7, configuration: { scope: { phase: "ALL", groups: [], rounds: [], onlyUnscheduled: true }, objectives: ["COMPLETION"], maxRuntimeMs: 3_000 } });
  assert.equal(plan.status, "COMPLETE");
  assert.equal(plan.scheduledFixtureIds.length, 12);
  assert.deepEqual(validateSchedulePlan(twoLegFixtures, plan.proposedEntries, weekResources, 7), []);
  const orders = [1, 2].flatMap((leg) => [1, 2, 3].map((roundNumber) => twoLegFixtures.filter((fixture) => fixture.leg === leg && fixture.roundNumber === roundNumber)));
  for (let index = 1; index < orders.length; index += 1) {
    const previousEnd = Math.max(...orders[index - 1].map((fixture) => new Date(plan.proposedEntries[fixture.id].scheduledAt).getTime() + 50 * 60_000));
    const nextStart = Math.min(...orders[index].map((fixture) => new Date(plan.proposedEntries[fixture.id].scheduledAt).getTime()));
    assert.ok(previousEnd <= nextStart, `round ${index} finishes before round ${index + 1}`);
  }
});

test("a candidate-search cutoff is reported as inconclusive, not proven infeasible", async () => {
  const crowded = { ...resources, competitionStartDate: "2026-12-01", competitionEndDate: "2027-12-01", slots: [{ id: "long", label: "Khung dài", start: "00:00", end: "23:59" }] };
  let clock = 0;
  const plan = await buildAutomaticSchedulePlan({
    fixtures: [fixtures[0]], currentEntries: {}, resources: crowded, pitchType: 7,
    configuration: { scope: { phase: "ALL", groups: [], rounds: [], onlyUnscheduled: true }, objectives: ["FAIRNESS"], maxRuntimeMs: 500 },
    now: () => (clock += 20),
  });
  assert.equal(plan.status, "TIMEOUT");
  assert.match(plan.warnings.join(" "), /chưa chứng minh|giới hạn|phương án một phần/i);
});

test("the automatic runtime budget can exceed the old fifteen-second clamp", async () => {
  assert.equal(MAX_AUTOMATIC_SCHEDULE_RUNTIME_MS, 120_000);
  const year = { ...resources, competitionEndDate: "2027-12-01", slots: [{ id: "long", label: "All day", start: "00:00", end: "23:59" }] };
  let clock = 0;
  const plan = await buildAutomaticSchedulePlan({ fixtures: [fixtures[0]], currentEntries: {}, resources: year, pitchType: 7,
    configuration: { scope: { phase: "ALL", groups: [], rounds: [], onlyUnscheduled: true }, objectives: ["REST", "COMPLETION"], maxRuntimeMs: 30_000 }, now: () => (clock += 100) });
  assert.ok(plan.elapsedMs >= 20_000, "a caller's accepted budget is not silently reduced to 15 seconds");
  assert.ok(plan.elapsedMs < 31_000, "the configured deadline remains bounded");
});

test("first-only candidate enumeration keeps exact earliest representatives without scanning later valid minutes", () => {
  const candidateResources = { ...resources, slots: [{ id: "morning", label: "Morning", start: "08:00", end: "12:00" }, { id: "afternoon", label: "Afternoon", start: "13:00", end: "17:00" }] };
  const options = { maximumCandidates: 20, maximumProbes: 20_000 };
  const first = getAutomaticScheduleCandidates(fixtures[0], fixtures, {}, candidateResources, 7, { ...options, maximumPerBucket: 1 });
  const three = getAutomaticScheduleCandidates(fixtures[0], fixtures, {}, candidateResources, 7, { ...options, maximumPerBucket: 3 });
  assert.equal(first.length, 4);
  for (const candidate of first) assert.deepEqual(candidate, three.find(item => item.date === candidate.date && item.venue.id === candidate.venue.id && item.slotId === candidate.slotId));
  let probes = 0;
  const repeated = getAutomaticScheduleCandidates(fixtures[0], fixtures, {}, candidateResources, 7, { ...options, maximumPerBucket: 1, shouldStop: () => { probes++; return false; } });
  assert.deepEqual(repeated, first);
  assert.equal(probes, 4, "one valid probe per date/venue/window bucket is sufficient");
  const two = getAutomaticScheduleCandidates(fixtures[0], fixtures, {}, candidateResources, 7, { ...options, maximumPerBucket: 2 });
  assert.equal(two.length, 8);
  assert.equal(three.length, 12);
  for (const candidate of first) {
    const matching = three.filter(item => item.date === candidate.date && item.venue.id === candidate.venue.id && item.slotId === candidate.slotId);
    const endpoints = two.filter(item => item.date === candidate.date && item.venue.id === candidate.venue.id && item.slotId === candidate.slotId);
    assert.deepEqual(endpoints, [matching[0], matching[matching.length - 1]], "two/three representative policies remain unchanged");
  }
});

test("first-only candidates retain date scopes, source dependencies, overrides, existing entries and cancellation", () => {
  const parent = { ...fixtures[0], id: "TEST-KO-R1-M1", stage: "KNOCKOUT", groupName: undefined };
  const child = { ...fixtures[1], id: "TEST-KO-R2-M1", stage: "KNOCKOUT", groupName: undefined, homeTeamId: null, awayTeamId: null, homeSource: "Thắng trận TEST-KO-R1-M1", awaySource: "Thua trận TEST-KO-R1-M1" };
  const parentEntry = { scheduledAt: "2026-12-01T08:10", durationMinutes: 50, venue: "V1", slotId: "morning", refereeNames: [], notes: "parent" };
  const scoped = { ...resources, venues: resources.venues.map(v => ({ ...v, dateOverrides: [{ date: "2026-12-02", unavailable: false, availableSlots: [{ id: "override", start: "10:00", end: "12:00" }] }] })) };
  const options = { maximumPerBucket: 1, dateRange: { start: "2026-12-02", end: "2026-12-02" } };
  assert.deepEqual(getAutomaticScheduleCandidates(child, [parent, child], {}, scoped, 7, options), []);
  const valid = getAutomaticScheduleCandidates(child, [parent, child], { [parent.id]: parentEntry }, scoped, 7, options);
  assert.equal(valid.length, 1);
  assert.equal(valid[0].scheduledAt, "2026-12-02T10:10");
  const existing = { ...parentEntry, scheduledAt: valid[0].scheduledAt, notes: "existing" };
  const retained = getAutomaticScheduleCandidates(child, [parent, child], { [parent.id]: parentEntry }, scoped, 7, { ...options, existingEntry: existing });
  assert.equal(retained[0].scheduledAt, existing.scheduledAt);
  assert.deepEqual(getAutomaticScheduleCandidates(child, [parent, child], { [parent.id]: parentEntry }, scoped, 7, { ...options, shouldStop: () => true }), []);
});

test("feasibility precedes optional rest optimization and keeps a complete valid incumbent", async () => {
  const rounds = [1, 2, 3].map(roundNumber => ({ ...fixtures[0], id: "round-" + roundNumber, round: "Vòng " + roundNumber, roundNumber, leg: 1 }));
  const oneDay = { ...resources, competitionEndDate: resources.competitionStartDate, maximumMatchesPerTeamPerDay: 3,
    slots: [{ id: "day", label: "Day", start: "08:00", end: "15:00" }], venues: resources.venues.map(v => ({ ...v, availableFrom: "08:00", availableTo: "15:00" })) };
  const input = JSON.stringify(oneDay);
  const plan = await buildAutomaticSchedulePlan({ fixtures: rounds, currentEntries: {}, resources: oneDay, pitchType: 7,
    configuration: { scope: { phase: "ALL", groups: [], rounds: [], onlyUnscheduled: true }, objectives: ["MINIMIZE_CHANGES", "REST", "FAIRNESS", "TRAVEL", "VENUE_USE", "COMPLETION"], maxRuntimeMs: 1_000 } });
  assert.equal(plan.status, "COMPLETE");
  assert.equal(plan.scheduledFixtureIds.length, 3);
  assert.deepEqual(validateSchedulePlan(rounds, plan.proposedEntries, oneDay, 7), []);
  assert.equal(JSON.stringify(oneDay), input);
});

test("long automatic searches yield to cancellation and keep unlocked publication independent", async () => {
  const published = { scheduledAt: "2026-12-01T08:10", durationMinutes: 50, venue: "V1", slotId: "morning", refereeNames: [], notes: "published", locked: false, officialStatus: "PUBLISHED" };
  const frozen = await buildAutomaticSchedulePlan({ fixtures: [fixtures[0]], currentEntries: { [fixtures[0].id]: published }, resources, pitchType: 7,
    configuration: { scope: { phase: "ALL", groups: [], rounds: [], onlyUnscheduled: false }, objectives: ["COMPLETION"], maxRuntimeMs: MAX_AUTOMATIC_SCHEDULE_RUNTIME_MS } });
  assert.deepEqual(frozen.proposedEntries[fixtures[0].id], published);
  assert.equal(frozen.exploredNodes, 0);
  let cancelled = false;
  const timer = setTimeout(() => { cancelled = true; }, 0);
  const plan = await buildAutomaticSchedulePlan({ fixtures, currentEntries: {}, resources, pitchType: 7,
    configuration: { scope: { phase: "ALL", groups: [], rounds: [], onlyUnscheduled: true }, objectives: ["REST"], maxRuntimeMs: MAX_AUTOMATIC_SCHEDULE_RUNTIME_MS }, shouldCancel: () => cancelled });
  clearTimeout(timer);
  assert.equal(cancelled, true);
  assert.equal(plan.status, "TIMEOUT");
  assert.deepEqual(plan.proposedEntries, {});
  assert.ok(plan.elapsedMs < 1_000, "cancellation is observed before a long search blocks the event loop");
});

test("optimization cannot replace a validated complete incumbent with an invalid simultaneous-final cluster", async () => {
  const finalC = { id: "z-final", stage: "GROUP", groupName: "A", round: "Vòng 2", roundNumber: 2, leg: 1, homeTeamId: "c", awayTeamId: "d" };
  const finalA = { ...finalC, id: "a-final", homeTeamId: "a", awayTeamId: "b" };
  const prior = { ...finalC, id: "prior", round: "Vòng 1", roundNumber: 1 };
  const cluster = [finalC, finalA, prior];
  const timing = { ...resources.groupTiming, preparationBeforeMinutes: 0, transitionAfterMinutes: 0 };
  const clusterResources = { ...resources, groupTiming: timing, knockoutTiming: timing, minimumTeamRestMinutes: 1440, requireSimultaneousGroupFinalRound: true,
    slots: [{ id: "early", label: "Early", start: "08:00", end: "09:00" }, { id: "late", label: "Late", start: "12:00", end: "13:00" }],
    venues: [resources.venues[0], { ...resources.venues[0], id: "venue-2", code: "V2", name: "Sân 2" }].map(v => ({ ...v, availableFrom: "08:00", availableTo: "13:00", turnaroundMinutes: 0 })) };
  const saved = { prior: { scheduledAt: "2026-12-01T08:00", durationMinutes: 50, venue: "V1", slotId: "early", refereeNames: [], notes: "prior" },
    "a-final": { scheduledAt: "2026-12-02T08:00", durationMinutes: 50, venue: "V1", slotId: "early", refereeNames: [], notes: "keep if possible" } };
  const plan = await buildAutomaticSchedulePlan({ fixtures: cluster, currentEntries: saved, resources: clusterResources, pitchType: 7,
    configuration: { scope: { phase: "GROUP", groups: ["A"], rounds: ["Vòng 2"], onlyUnscheduled: false, dateRange: { start: "2026-12-02", end: "2026-12-02" } }, objectives: ["MINIMIZE_CHANGES", "COMPLETION"], maxRuntimeMs: 1_000 } });
  assert.equal(plan.status, "COMPLETE");
  assert.deepEqual(validateSchedulePlan(cluster, plan.proposedEntries, clusterResources, 7), []);
  assert.equal(plan.proposedEntries[finalA.id].scheduledAt, "2026-12-02T12:00");
  assert.equal(plan.proposedEntries[finalC.id].scheduledAt, "2026-12-02T12:00");
});

test("all-locked scope still checks mandatory knockout rest balance before returning complete", async () => {
  const parents = fixtures.map((f, index) => ({ ...f, id: `TEST-KO-R1-M${index + 1}`, stage: "KNOCKOUT", groupName: undefined }));
  const child = { id: "TEST-KO-R2-M1", stage: "KNOCKOUT", round: "Chung kết", homeTeamId: null, awayTeamId: null, homeSource: "Thắng trận TEST-KO-R1-M1", awaySource: "Thắng trận TEST-KO-R1-M2" };
  const all = [...parents, child];
  const wide = { ...resources, maximumKnockoutRestDifferenceMinutes: 30, maximumKnockoutRestDifferenceRequired: true,
    slots: [{ id: "day", label: "Day", start: "07:00", end: "18:00" }] };
  const saved = Object.fromEntries(all.map((f, index) => [f.id, { scheduledAt: index === 2 ? "2026-12-02T12:10" : index ? "2026-12-01T10:10" : "2026-12-01T08:10", durationMinutes: 50, venue: "V1", slotId: "day", refereeNames: [], notes: "", locked: true }]));
  assert.deepEqual(validateSchedulePlan(all, saved, wide, 7), []);
  const plan = await buildAutomaticSchedulePlan({ fixtures: all, currentEntries: saved, resources: wide, pitchType: 7,
    configuration: { scope: { phase: "ALL", groups: [], rounds: [], onlyUnscheduled: false }, objectives: ["COMPLETION"], maxRuntimeMs: MAX_AUTOMATIC_SCHEDULE_RUNTIME_MS } });
  assert.equal(plan.status, "INFEASIBLE");
  assert.deepEqual(plan.proposedEntries, saved);
  assert.match(plan.warnings.join(" "), /Chênh lệch thời gian nghỉ/);
});
