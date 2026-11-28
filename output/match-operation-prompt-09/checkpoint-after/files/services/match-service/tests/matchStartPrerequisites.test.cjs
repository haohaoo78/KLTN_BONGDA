const test = require("node:test");
const assert = require("node:assert/strict");
const { assertMatchStartPrerequisites } = require("../dist/services/matchClockWorkflow");

const valid = {
  homeTeamId: "team-home",
  awayTeamId: "team-away",
  hasPublishedSchedule: true,
  publishedOfficialCount: 2,
  finalAuthorityCount: 1,
};

test("match start requires two different, resolved teams", () => {
  assert.throws(() => assertMatchStartPrerequisites({ ...valid, awayTeamId: null }), { code: "MATCH_TEAMS_UNRESOLVED" });
  assert.throws(() => assertMatchStartPrerequisites({ ...valid, awayTeamId: valid.homeTeamId }), { code: "MATCH_TEAMS_UNRESOLVED" });
});

test("match start requires a published schedule", () => {
  assert.throws(() => assertMatchStartPrerequisites({ ...valid, hasPublishedSchedule: false }), { code: "PUBLISHED_SCHEDULE_REQUIRED" });
});

test("match start requires published officials and exactly one final authority", () => {
  assert.throws(() => assertMatchStartPrerequisites({ ...valid, publishedOfficialCount: 0, finalAuthorityCount: 0 }), { code: "PUBLISHED_REFEREE_ASSIGNMENT_REQUIRED" });
  assert.throws(() => assertMatchStartPrerequisites({ ...valid, finalAuthorityCount: 0 }), { code: "PUBLISHED_REFEREE_ASSIGNMENT_REQUIRED" });
  assert.throws(() => assertMatchStartPrerequisites({ ...valid, finalAuthorityCount: 2 }), { code: "PUBLISHED_REFEREE_ASSIGNMENT_REQUIRED" });
  assert.doesNotThrow(() => assertMatchStartPrerequisites(valid));
});
