const assert = require("node:assert/strict");
const test = require("node:test");
const { assertKickoffReached } = require("../dist/services/matchKickoff");

test("a referee may start the match at or after its published kickoff", () => {
  const now = Date.parse("2026-11-16T12:00:00.000Z");
  assert.doesNotThrow(() => assertKickoffReached("2026-11-16T11:59:00.000Z", now));
  assert.doesNotThrow(() => assertKickoffReached("2026-11-16T12:00:00.000Z", now));
});

test("a referee cannot start before kickoff or without a published kickoff", () => {
  const now = Date.parse("2026-11-16T12:00:00.000Z");
  assert.throws(
    () => assertKickoffReached("2026-11-16T12:01:00.000Z", now),
    { code: "MATCH_KICKOFF_NOT_REACHED", status: 409 },
  );
  assert.throws(
    () => assertKickoffReached(null, now),
    { code: "MATCH_SCHEDULE_REQUIRED", status: 409 },
  );
});
