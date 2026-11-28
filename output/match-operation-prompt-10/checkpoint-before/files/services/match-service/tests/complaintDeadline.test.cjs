const assert = require("node:assert/strict");
const test = require("node:test");
const { complaintDeadlineExceeded } = require("../dist/services/tournamentDisciplinePolicy");

test("complaint deadline remains open at the exact configured boundary", () => {
  const finalizedAt = "2026-11-16T10:00:00.000Z";
  const deadline = Date.parse(finalizedAt) + 24 * 60 * 60 * 1000;
  assert.equal(complaintDeadlineExceeded(finalizedAt, 24, deadline), false);
  assert.equal(complaintDeadlineExceeded(finalizedAt, 24, deadline + 1), true);
});

test("a zero-hour complaint window closes immediately after finalization", () => {
  const finalizedAt = "2026-11-16T10:00:00.000Z";
  assert.equal(complaintDeadlineExceeded(finalizedAt, 0, Date.parse(finalizedAt)), false);
  assert.equal(complaintDeadlineExceeded(finalizedAt, 0, Date.parse(finalizedAt) + 1), true);
});

test("invalid finalization timestamps and negative windows are rejected", () => {
  assert.throws(() => complaintDeadlineExceeded("invalid", 24), { code: "INVALID_COMPLAINT_DEADLINE" });
  assert.throws(() => complaintDeadlineExceeded("2026-11-16T10:00:00.000Z", -1), { code: "INVALID_COMPLAINT_DEADLINE" });
});

test("appeal deadline uses the published complaint window from the recorded decision time", () => {
  const decidedAt = "2026-11-16T10:00:00.000Z";
  const deadline = Date.parse(decidedAt) + 12 * 60 * 60 * 1000;
  assert.equal(complaintDeadlineExceeded(decidedAt, 12, deadline), false);
  assert.equal(complaintDeadlineExceeded(decidedAt, 12, deadline + 1), true);
});
