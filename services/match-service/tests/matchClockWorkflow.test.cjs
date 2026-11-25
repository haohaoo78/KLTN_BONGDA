const assert = require("node:assert/strict");
const test = require("node:test");
const { accrueClock, transitionMatchClock } = require("../dist/services/matchClockWorkflow");

test("clock starts, pauses, resumes, and advances periods without auto-ending", () => {
  assert.deepEqual(transitionMatchClock("NOT_STARTED", false, "START_MATCH"), { phase: "FIRST_HALF", isRunning: true, matchStatus: "IN_PROGRESS" });
  assert.deepEqual(transitionMatchClock("FIRST_HALF", true, "PAUSE"), { phase: "FIRST_HALF", isRunning: false });
  assert.deepEqual(transitionMatchClock("HALF_TIME", false, "START_NEXT_PERIOD"), { phase: "SECOND_HALF", isRunning: true });
  assert.deepEqual(transitionMatchClock("SECOND_HALF", true, "END_PERIOD"), { phase: "REGULATION_COMPLETE", isRunning: false });
  assert.throws(() => transitionMatchClock("REGULATION_COMPLETE", false, "RESUME"), { code: "INVALID_CLOCK_TRANSITION" });
});

test("clock supports optional extra time and penalties and ends only on an explicit action", () => {
  assert.deepEqual(transitionMatchClock("REGULATION_COMPLETE", false, "START_EXTRA_TIME"), { phase: "EXTRA_TIME_FIRST_HALF", isRunning: true });
  assert.deepEqual(transitionMatchClock("EXTRA_TIME_HALF_TIME", false, "START_NEXT_PERIOD"), { phase: "EXTRA_TIME_SECOND_HALF", isRunning: true });
  assert.deepEqual(transitionMatchClock("EXTRA_TIME_COMPLETE", false, "START_PENALTIES"), { phase: "PENALTIES", isRunning: true });
  assert.deepEqual(transitionMatchClock("REGULATION_COMPLETE", false, "END_MATCH"), { phase: "ENDED", isRunning: false, matchStatus: "FINISHED" });
  assert.deepEqual(transitionMatchClock("PENALTIES", true, "END_PERIOD"), { phase: "ENDED", isRunning: false, matchStatus: "FINISHED" });
});

test("server timestamps accrue elapsed time and clamp negative clock drift", () => {
  assert.deepEqual(accrueClock(30, 130, new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:05.900Z")), { elapsedSeconds: 35, totalElapsedSeconds: 135 });
  assert.deepEqual(accrueClock(30, 130, new Date("2026-01-01T00:00:05Z"), new Date("2026-01-01T00:00:00Z")), { elapsedSeconds: 30, totalElapsedSeconds: 130 });
});
