const test = require("node:test");
const assert = require("node:assert/strict");

process.env.SCHEDULING_DATABASE_URL ??= "postgresql://unit:unit@127.0.0.1:1/unit";
const { scheduleLocalDateTime, parseOfficialScheduleEntries, assertOfficialEntriesUnchanged, officialFixtureRoundLabel, projectOfficialScheduleEntry, assertOfficialScheduleCanRegenerate, assertPublishedScheduleStages, assertProtectedScheduleTimingUnchanged } = require("../dist/scheduling/services/schedulingService");
const { parseAutoScheduleConfiguration } = require("../dist/scheduling/controllers/schedulingEngineController");

test("official automatic configuration accepts the shared two-minute budget and rejects larger values", () => {
  const configuration = { scope: { phase: "ALL", groups: [], rounds: [], onlyUnscheduled: true }, objectives: ["MINIMIZE_CHANGES", "REST", "COMPLETION"], maxRuntimeMs: 120_000 };
  assert.deepEqual(parseAutoScheduleConfiguration(configuration), configuration);
  assert.throws(() => parseAutoScheduleConfiguration({ ...configuration, maxRuntimeMs: 120_001 }), { code: "INVALID_CONFIGURATION" });
  assert.throws(() => parseAutoScheduleConfiguration({ ...configuration, maxRuntimeMs: Number.NaN }), { code: "INVALID_CONFIGURATION" });
});

const fixtures = [{ id: "official-match", stage: "GROUP", round: "Vòng 1", homeTeamId: "team-a", awayTeamId: "team-b" }];
const resources = {
  groupTiming: { halfMinutes: 20, halftimeBreakMinutes: 5, extraTimeReserveMinutes: 0, penaltyReserveMinutes: 0 },
  knockoutTiming: { halfMinutes: 20, halftimeBreakMinutes: 5, extraTimeReserveMinutes: 0, penaltyReserveMinutes: 0 },
  venues: [{ id: "venue-id", code: "A", name: "Sân A" }],
};
const entry = { scheduledAt: "2026-12-10T08:00:00+07:00", durationMinutes: 45, venue: "A", refereeNames: [], notes: "BTC chốt sân", slotId: "morning", locked: true };

test("official dates use Vietnam wall clock without changing the instant", () => {
  assert.equal(scheduleLocalDateTime("2026-12-10T01:00:00.000Z"), "2026-12-10T08:00:00+07:00");
  assert.equal(scheduleLocalDateTime(entry.scheduledAt), entry.scheduledAt);
  assert.equal(scheduleLocalDateTime("2026-12-10T08:00"), entry.scheduledAt);
  assert.throws(() => scheduleLocalDateTime("not a date"), { code: "INVALID_DATE" });
});

test("official draft preserves notes, slot and independent lock in normalized entries", () => {
  const parsed = parseOfficialScheduleEntries({ "official-match": entry }, fixtures, resources);
  assert.deepEqual(parsed["official-match"], { ...entry, scheduledAt: "2026-12-10T08:00:00" });
});

test("official draft refuses fixtures outside the published diagram", () => {
  assert.throws(() => parseOfficialScheduleEntries({ fake: entry }, fixtures, resources), { code: "OFFICIAL_FIXTURE_REQUIRED" });
});

test("official duration is derived from saved timing rather than trusted from a client", () => {
  assert.throws(() => parseOfficialScheduleEntries({ "official-match": { ...entry, durationMinutes: 10 } }, fixtures, resources), { code: "SCHEDULE_DURATION_MISMATCH" });
  assert.equal(parseOfficialScheduleEntries({ "official-match": { ...entry, durationMinutes: null } }, fixtures, resources)["official-match"].durationMinutes, 45);
});

test("a historical unlocked draft duration can follow corrected official reserves on the next explicit save", () => {
  const historical = { ...entry, locked: false, officialStatus: "DRAFT", durationMinutes: 75 };
  const parsed = parseOfficialScheduleEntries({ "official-match": historical }, fixtures, resources, { "official-match": historical });
  assert.equal(parsed["official-match"].durationMinutes, 45);
  assert.equal(parsed["official-match"].scheduledAt, "2026-12-10T08:00:00");
  assert.throws(() => parseOfficialScheduleEntries({ "official-match": { ...historical, durationMinutes: 10 } }, fixtures, resources, { "official-match": historical }), { code: "SCHEDULE_DURATION_MISMATCH" });
  assert.throws(() => parseOfficialScheduleEntries({ "official-match": { ...historical, locked: true } }, fixtures, resources, { "official-match": { ...historical, locked: true } }), { code: "SCHEDULE_DURATION_MISMATCH" });
  assert.throws(() => parseOfficialScheduleEntries({ "official-match": { ...historical, officialStatus: "PUBLISHED" } }, fixtures, resources, { "official-match": { ...historical, officialStatus: "PUBLISHED" } }), { code: "SCHEDULE_DURATION_MISMATCH" });
});

test("locked or published entries cannot move, disappear, or move while being unlocked", () => {
  for (const protectedEntry of [entry, { ...entry, locked: false, officialStatus: "PUBLISHED" }]) {
    const current = { "official-match": protectedEntry };
    assert.throws(() => assertOfficialEntriesUnchanged(current, {}), { code: "SCHEDULE_LOCKED" });
    assert.throws(() => assertOfficialEntriesUnchanged(current, { "official-match": { ...entry, scheduledAt: "2026-12-10T10:00:00+07:00", locked: false } }), { code: "SCHEDULE_LOCKED" });
    assert.throws(() => assertOfficialEntriesUnchanged(current, { "official-match": { ...entry, venue: "B", locked: false } }), { code: "SCHEDULE_LOCKED" });
  }
});

test("unlocking a draft is allowed only while its schedule remains unchanged", () => {
  assert.doesNotThrow(() => assertOfficialEntriesUnchanged({ "official-match": entry }, { "official-match": { ...entry, locked: false } }));
});

test("publication and organizer lock are projected as independent states", () => {
  const schedule = { scheduledDate: "2026-12-10T01:00:00Z", durationMinutes: 45, isLocked: false, status: "PUBLISHED", notes: "", slotId: null };
  const projected = projectOfficialScheduleEntry(schedule, "A");
  assert.equal(projected.locked, false);
  assert.equal(projected.officialStatus, "PUBLISHED");
  assert.throws(() => assertOfficialEntriesUnchanged({ "official-match": projected }, {}), { code: "SCHEDULE_LOCKED" });
  assert.equal(projectOfficialScheduleEntry({ ...schedule, isLocked: true }, "A").locked, true);
});

test("official automatic preview rejects published schedules even when organizer locks are off", () => {
  assert.doesNotThrow(() => assertOfficialScheduleCanRegenerate([{ status: "DRAFT", isLocked: false }]));
  assert.doesNotThrow(() => assertOfficialScheduleCanRegenerate([{ status: "CANCELLED", isLocked: false }]));
  assert.throws(() => assertOfficialScheduleCanRegenerate([{ status: "PUBLISHED", isLocked: false }]), { code: "PUBLISHED_SCHEDULE_IMMUTABLE" });
});

test("official group rounds preserve checkpoint grouping and keep round before the second leg", () => {
  assert.equal(officialFixtureRoundLabel({ stage: "GROUP", round: "Bảng A · Lượt 1 · Vòng 2", roundNumber: 2, groupName: "Bảng A", leg: 1 }), "Bảng A · Vòng 2");
  assert.equal(officialFixtureRoundLabel({ stage: "GROUP", round: "Bảng B · Lượt 2 · Vòng 3", groupName: "B", leg: 2 }), "Bảng B · Vòng 3 · Lượt 2");
  assert.equal(officialFixtureRoundLabel({ stage: "GROUP", round: "Bảng A · Lượt 1 · Vòng 1 · Trận 2", roundNumber: 1, groupName: "A", leg: 1 }), "Bảng A · Vòng 1");
});

test("official knockout rounds follow bracket depth and keep third place separate", () => {
  const label = (roundNumber, slotType) => officialFixtureRoundLabel({ stage: "KNOCKOUT", round: `Vòng ${roundNumber} · Trận 1`, roundNumber, knockoutRoundCount: 4, slotType });
  assert.deepEqual([1, 2, 3, 4].map((roundNumber) => label(roundNumber)), ["Vòng 16 đội", "Tứ kết", "Bán kết", "Chung kết"]);
  assert.equal(label(4, "THIRD_PLACE"), "Tranh hạng ba");
});

test("official scheduling requires every mandatory published fixture stage", () => {
  assert.doesNotThrow(() => assertPublishedScheduleStages("ROUND_ROBIN", ["GROUP"]));
  assert.doesNotThrow(() => assertPublishedScheduleStages("KNOCKOUT", ["KNOCKOUT"]));
  assert.doesNotThrow(() => assertPublishedScheduleStages("GROUP_AND_KNOCKOUT", ["GROUP", "KNOCKOUT"]));
  assert.throws(() => assertPublishedScheduleStages("GROUP_AND_KNOCKOUT", ["GROUP"]), { code: "PUBLISHED_FIXTURES_REQUIRED" });
  assert.throws(() => assertPublishedScheduleStages("GROUP_AND_KNOCKOUT", ["KNOCKOUT"]), { code: "PUBLISHED_FIXTURES_REQUIRED" });
});

test("correcting a timing reserve cannot reinterpret locked or published schedule profiles", () => {
  const fixture = { ...fixtures[0], stage: "KNOCKOUT" };
  const stale = { ...resources, knockoutTiming: { ...resources.knockoutTiming, extraTimeReserveMinutes: 30 } };
  const corrected = { ...resources, knockoutTiming: { ...resources.knockoutTiming, extraTimeReserveMinutes: 0 } };
  for (const protectedEntry of [{ ...entry, locked: true }, { ...entry, locked: false, officialStatus: "PUBLISHED" }]) {
    assert.throws(() => assertProtectedScheduleTimingUnchanged([fixture], { [fixture.id]: protectedEntry }, stale, corrected), { code: "SCHEDULE_LOCKED_RESOURCE_CONFLICT" });
    assert.doesNotThrow(() => assertProtectedScheduleTimingUnchanged([fixture], { [fixture.id]: protectedEntry }, stale, stale));
  }
  assert.doesNotThrow(() => assertProtectedScheduleTimingUnchanged([fixture], { [fixture.id]: { ...entry, locked: false, officialStatus: "DRAFT" } }, stale, corrected));
});
