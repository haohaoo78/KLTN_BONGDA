const assert = require("node:assert/strict");
const test = require("node:test");
const { assertBracketMatchSchedulable } = require("../dist/scheduling/bracketReadiness");

test("regular fixtures without bracket slots remain schedulable", () => {
  assert.doesNotThrow(() => assertBracketMatchSchedulable(null));
});

test("resolved bracket matches are schedulable", () => {
  assert.doesNotThrow(() => assertBracketMatchSchedulable({
    status: "READY", homeTeamId: "team-a", awayTeamId: "team-b", homeResolved: true, awayResolved: true,
  }));
});

test("future bracket matches can be scheduled while entrants are unresolved", () => {
  assert.doesNotThrow(() => assertBracketMatchSchedulable({
    status: "WAITING", homeTeamId: null, awayTeamId: null, homeResolved: false, awayResolved: false,
  }));
});

test("invalid bracket states cannot be scheduled", () => {
  for (const slot of [
    { status: "READY", homeTeamId: "team-a", awayTeamId: null, homeResolved: true, awayResolved: true },
    { status: "READY", homeTeamId: "team-a", awayTeamId: "team-a", homeResolved: true, awayResolved: true },
  ]) {
    assert.throws(() => assertBracketMatchSchedulable(slot), { code: slot.homeTeamId === slot.awayTeamId ? "INVALID_BRACKET_MATCH" : "BRACKET_SLOT_NOT_SCHEDULABLE" });
  }
});
