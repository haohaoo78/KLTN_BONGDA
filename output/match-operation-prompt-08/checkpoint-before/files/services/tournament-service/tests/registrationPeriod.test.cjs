const assert = require("node:assert/strict");
const test = require("node:test");
const { isWithinAnyRegistrationPeriod, isRegistrationReviewEligible, toRegistrationTimestamp } = require("../dist/services/registrationPeriod");

const period = (startDate, endDate) => [{ startDate, endDate }];

test("date-only registration period includes the full final day", () => {
  const endOfDay = Date.parse("2026-11-30T16:59:59.999Z");
  assert.equal(isWithinAnyRegistrationPeriod(period("2026-11-01", "2026-11-30"), endOfDay), true);
});

test("date-only registration period closes at the next day in Vietnam time", () => {
  const nextDay = Date.parse("2026-11-30T17:00:00.000Z");
  assert.equal(isWithinAnyRegistrationPeriod(period("2026-11-01", "2026-11-30"), nextDay), false);
});

test("registration period includes its start instant and excludes instants before it", () => {
  const start = Date.parse("2026-10-31T17:00:00.000Z");
  assert.equal(isWithinAnyRegistrationPeriod(period("2026-11-01", "2026-11-30"), start), true);
  assert.equal(isWithinAnyRegistrationPeriod(period("2026-11-01", "2026-11-30"), start - 1), false);
});

test("timestamp-based period endpoints retain their exact instant semantics", () => {
  const end = Date.parse("2026-11-30T16:30:00.000Z");
  const timestampPeriod = period("2026-11-01T08:00:00.000Z", "2026-11-30T16:30:00.000Z");
  assert.equal(isWithinAnyRegistrationPeriod(timestampPeriod, end), true);
  assert.equal(isWithinAnyRegistrationPeriod(timestampPeriod, end + 1), false);
});

test("date-only form boundaries are stored at Vietnam local midnight and end of day", () => {
  assert.equal(toRegistrationTimestamp("2026-11-16", "start"), "2026-11-16T00:00:00.000+07:00");
  assert.equal(toRegistrationTimestamp("2026-11-16", "end"), "2026-11-16T23:59:59.999+07:00");
  assert.equal(toRegistrationTimestamp("2026-11-16T09:30:00.000Z", "start"), "2026-11-16T09:30:00.000Z");
});

test("invalid periods do not open registration", () => {
  assert.equal(isWithinAnyRegistrationPeriod(period("not-a-date", "2026-11-30"), Date.now()), false);
  assert.equal(isWithinAnyRegistrationPeriod(undefined, Date.now()), false);
});

test("new approval reviews require an open status and an active registration period", () => {
  const periods = period("2026-11-01", "2026-11-30");
  const active = Date.parse("2026-11-15T12:00:00.000Z");
  const afterDeadline = Date.parse("2026-12-01T00:00:00.000Z");
  assert.equal(isRegistrationReviewEligible("OPEN_REGISTRATION", periods, active), true);
  assert.equal(isRegistrationReviewEligible("REGISTRATION_CLOSED", periods, active), false);
  assert.equal(isRegistrationReviewEligible("OPEN_REGISTRATION", periods, afterDeadline), false);
});
