const test = require("node:test");
const assert = require("node:assert/strict");

process.env.SCHEDULING_DATABASE_URL ??= "postgresql://unit:unit@127.0.0.1:1/unit";
const { getOfficialSchedulePublicationCoverage: coverage, assertOfficialSchedulePublicationComplete: assertComplete } = require("../dist/scheduling/services/schedulingService");

const fixtures = ["group-1", "group-2", "knockout-1"].map((id, index) => ({
  id, stage: index === 2 ? "KNOCKOUT" : "GROUP", round: `Round ${index + 1}`,
  homeTeamId: `team-${index * 2}`, awayTeamId: `team-${index * 2 + 1}`,
}));
const row = (matchId, extra = {}) => ({
  matchId, status: "DRAFT", scheduledDate: "2026-12-20T08:00:00+07:00", venueId: "venue-id", durationMinutes: 90,
  isLocked: false, refereeId: null, ...extra,
});

test("an empty official diagram cannot be declared published", () => {
  assert.equal(coverage([], []).complete, false);
  assert.throws(() => assertComplete([], []), { code: "PUBLISHED_FIXTURES_REQUIRED" });
});

test("an empty saved schedule lists every required official fixture", () => {
  assert.throws(() => assertComplete(fixtures, []), (error) => {
    assert.equal(error.code, "SCHEDULE_FIXTURES_UNSCHEDULED");
    assert.deepEqual(error.details, { fixtureIds: fixtures.map((fixture) => fixture.id), totalCount: 3, scheduledCount: 0, unscheduledCount: 3 });
    return true;
  });
});

test("partial or frontend-selected schedules cannot cover the rest of the official diagram", () => {
  for (const rows of [[row("group-1")], [row("group-1"), row("group-2")]]) {
    assert.throws(() => assertComplete(fixtures, rows), (error) => {
      assert.equal(error.code, "SCHEDULE_FIXTURES_UNSCHEDULED");
      assert.ok(error.details.fixtureIds.includes("knockout-1"));
      assert.equal(error.details.scheduledCount, rows.length);
      return true;
    });
  }
});

test("unrelated rows and equal row counts cannot stand in for missing fixtures", () => {
  const result = coverage(fixtures, [row("group-1", { status: "PUBLISHED" }), row("old-match-1", { status: "PUBLISHED" }), row("old-match-2", { status: "PUBLISHED" })]);
  assert.equal(result.complete, false);
  assert.deepEqual(result.publishedFixtureIds, ["group-1"]);
  assert.deepEqual(result.missingFixtureIds, ["group-2", "knockout-1"]);
});

test("cancelled and historical rescheduled rows do not count as saved publishable schedules", () => {
  for (const status of ["CANCELLED", "RESCHEDULED"]) {
    assert.throws(() => assertComplete(fixtures, fixtures.map((fixture, index) => row(fixture.id, index === 1 ? { status } : {}))), { code: "SCHEDULE_FIXTURES_UNSCHEDULED" });
  }
});

test("every required fixture needs a valid saved date, venue and positive duration", () => {
  for (const invalid of [{ scheduledDate: "" }, { scheduledDate: "invalid" }, { venueId: " " }, { durationMinutes: 0 }, { durationMinutes: -1 }, { durationMinutes: 1.5 }]) {
    assert.throws(() => assertComplete(fixtures, fixtures.map((fixture, index) => row(fixture.id, index === 0 ? invalid : {}))), { code: "SCHEDULE_FIXTURES_UNSCHEDULED" });
  }
});

test("duplicate active rows cannot be hidden by an entry map or inflate coverage", () => {
  const rows = [...fixtures.map((fixture) => row(fixture.id)), row("group-1", { status: "PUBLISHED" })];
  assert.deepEqual(coverage(fixtures, rows).duplicateFixtureIds, ["group-1"]);
  assert.throws(() => assertComplete(fixtures, rows), (error) => {
    assert.equal(error.code, "SCHEDULE_DUPLICATE_FIXTURES");
    assert.deepEqual(error.details.fixtureIds, ["group-1"]);
    return true;
  });
});

test("cancelled history does not make a current schedule duplicate", () => {
  const rows = [...fixtures.map((fixture) => row(fixture.id)), row("group-1", { status: "CANCELLED" })];
  assert.doesNotThrow(() => assertComplete(fixtures, rows));
});

test("structural BYEs are excluded but unresolved real knockout matches remain required", () => {
  const bye = { ...fixtures[0], id: "structural-bye", bye: true, awayTeamId: null };
  const real = { ...fixtures[2], homeTeamId: null, awayTeamId: null, homeSource: "Winner group A", awaySource: "Winner group B" };
  assert.doesNotThrow(() => assertComplete([...fixtures.slice(0, 2), real, bye], fixtures.map((fixture) => row(fixture.id))));
  assert.throws(() => assertComplete([...fixtures.slice(0, 2), real, bye], fixtures.slice(0, 2).map((fixture) => row(fixture.id))), { code: "SCHEDULE_FIXTURES_UNSCHEDULED" });
});

test("complete saved schedules may publish without organizer locks or assigned referees", () => {
  const rows = fixtures.map((fixture) => row(fixture.id));
  assert.doesNotThrow(() => assertComplete(fixtures, rows));
  assert.equal(coverage(fixtures, rows).complete, true);
  assert.deepEqual(coverage(fixtures, rows).publishedFixtureIds, []);
});

test("published coverage is exact and remains complete on repeated validation", () => {
  const rows = fixtures.map((fixture) => row(fixture.id, { status: "PUBLISHED" }));
  assert.doesNotThrow(() => assertComplete(fixtures, rows));
  assert.deepEqual(coverage(fixtures, rows).publishedFixtureIds, fixtures.map((fixture) => fixture.id));
  assert.deepEqual(coverage(fixtures, rows), coverage(fixtures, rows));
});

test("publication service rejects empty, partial and selected-stage database schedules before starting publication", async (t) => {
  const fixtureGeneration = require("../dist/services/fixtureGenerationService");
  const matches = require("../dist/repositories/matchRepository");
  const schedules = require("../dist/scheduling/repositories/schedulingRepository");
  const matchDb = require("../dist/lib/db");
  const { publishTournamentSchedules, getOfficialScheduleContext } = require("../dist/scheduling/services/schedulingService");
  const tournamentId = "official-tournament";
  const draw = { id: "official-draw", groups: [], config: { fixtureRegulationSnapshot: { competitionFormat: "GROUP_AND_KNOCKOUT", regulationVersion: 1, rules: {} } } };
  const timing = { halfMinutes: 45, halftimeBreakMinutes: 10, extraTimeReserveMinutes: 0, penaltyReserveMinutes: 0 };
  const resources = { venues: [{ id: "venue-id", code: "A" }], groupTiming: timing, knockoutTiming: timing };
  let saved = [];
  let publicationCalls = 0;
  let connectionCalls = 0;
  t.mock.method(fixtureGeneration, "getPublishedDraw", async () => draw);
  t.mock.method(matches, "listManagedTournamentFixtures", async () => ({ stages: ["GROUP", "KNOCKOUT"].map((stage) => ({
    stage, status: "PUBLISHED", drawVersionId: draw.id, publishedAt: "2026-12-01T00:00:00Z",
    matches: fixtures.filter((fixture) => fixture.stage === stage),
  })) }));
  t.mock.method(matches, "listManagedKnockoutBracket", async () => []);
  t.mock.method(schedules, "listSchedules", async () => saved);
  t.mock.method(schedules, "getTournamentScheduleResources", async () => ({ revision: 1, resources }));
  t.mock.method(schedules, "publishScheduleBatch", async () => { publicationCalls += 1; throw new Error("unexpected publication"); });
  t.mock.method(matchDb, "getPool", () => { connectionCalls += 1; throw new Error("unexpected write connection"); });
  t.mock.method(globalThis, "fetch", async () => ({ ok: true, json: async () => ({ tournament: { id: tournamentId, competitionFormat: "GROUP_AND_KNOCKOUT", footballFormat: 11 } }) }));

  for (const rows of [[], [row("group-1")], [row("group-1"), row("group-2")]]) {
    saved = rows;
    await assert.rejects(publishTournamentSchedules(tournamentId, "organizer"), (error) => {
      assert.equal(error.code, "SCHEDULE_FIXTURES_UNSCHEDULED");
      assert.equal(error.details.totalCount, 3);
      assert.equal(error.details.scheduledCount, rows.length);
      assert.ok(error.details.fixtureIds.includes("knockout-1"));
      return true;
    });
  }
  saved = [...fixtures.map((fixture) => row(fixture.id)), row("group-1")];
  await assert.rejects(publishTournamentSchedules(tournamentId, "organizer"), { code: "SCHEDULE_DUPLICATE_FIXTURES" });
  assert.equal(publicationCalls, 0);
  assert.equal(connectionCalls, 0);

  saved = [row("group-1", { status: "PUBLISHED", updatedAt: "2026-12-01T01:00:00Z" }), row("old-1", { status: "PUBLISHED", updatedAt: "2026-12-01T02:00:00Z" }), row("old-2", { status: "PUBLISHED", updatedAt: "2026-12-01T03:00:00Z" })];
  assert.equal((await getOfficialScheduleContext(tournamentId)).schedulePublishedAt, null, "equal published row counts cannot mark an incomplete official diagram as published");
  saved = fixtures.map((fixture) => row(fixture.id, { status: "PUBLISHED", updatedAt: "2026-12-01T01:00:00Z" }));
  assert.equal((await getOfficialScheduleContext(tournamentId)).schedulePublishedAt, "2026-12-01T01:00:00Z");
});
