const test = require("node:test");
const assert = require("node:assert/strict");
const { canWithdrawRegistrationBeforeDraw, removeTeamFromRosterSnapshot, sameUniqueTeamSet, uniqueTeamIdsAreSubset } = require("../dist/services/rosterWithdrawal");

test("allows ordinary withdrawals before roster lock and locked roster adjustments before draw confirmation", () => {
  assert.equal(canWithdrawRegistrationBeforeDraw("OPEN_REGISTRATION", null), true);
  assert.equal(canWithdrawRegistrationBeforeDraw("REGISTRATION_CLOSED", null), true);
  assert.equal(canWithdrawRegistrationBeforeDraw("ROSTER_LOCKED", null), true);
  assert.equal(canWithdrawRegistrationBeforeDraw("ROSTER_LOCKED", "DRAFT"), true);
  assert.equal(canWithdrawRegistrationBeforeDraw("ROSTER_LOCKED", "ARCHIVED"), true);
});

test("does not allow a withdrawal to mutate a confirmed/published draw or later tournament stage", () => {
  assert.equal(canWithdrawRegistrationBeforeDraw("ROSTER_LOCKED", "CONFIRMED"), false);
  assert.equal(canWithdrawRegistrationBeforeDraw("ROSTER_LOCKED", "PUBLISHED"), false);
  assert.equal(canWithdrawRegistrationBeforeDraw("ROSTER_LOCKED", "LIVE"), false);
  assert.equal(canWithdrawRegistrationBeforeDraw("ROSTER_LOCKED", "PAUSED"), false);
  assert.equal(canWithdrawRegistrationBeforeDraw("ROSTER_LOCKED", "COMPLETED"), false);
  assert.equal(canWithdrawRegistrationBeforeDraw("PREPARING", null), false);
  assert.equal(canWithdrawRegistrationBeforeDraw("IN_PROGRESS", null), false);
});

test("removes exactly one team from an immutable snapshot copy and preserves other records", () => {
  const snapshot = [{ teamId: "a", name: "A" }, { teamId: "b", name: "B" }];
  const result = removeTeamFromRosterSnapshot(snapshot, "a");
  assert.equal(result.removed, true);
  assert.deepEqual(result.roster, [{ teamId: "b", name: "B" }]);
  assert.deepEqual(snapshot, [{ teamId: "a", name: "A" }, { teamId: "b", name: "B" }]);
});

test("rejects snapshots that do not contain the target team or are not arrays", () => {
  assert.deepEqual(removeTeamFromRosterSnapshot([{ teamId: "a" }], "missing"), {
    roster: [{ teamId: "a" }], removed: false,
  });
  assert.deepEqual(removeTeamFromRosterSnapshot(null, "a"), { roster: [], removed: false });
});

test("draw assignments must not include withdrawn teams, and confirmation requires the exact roster", () => {
  assert.equal(uniqueTeamIdsAreSubset(["a", "b"], ["a"]), true);
  assert.equal(uniqueTeamIdsAreSubset(["a", "b"], ["a", "c"]), false);
  assert.equal(uniqueTeamIdsAreSubset(["a", "b"], ["a", "a"]), false);
  assert.equal(sameUniqueTeamSet(["a", "b"], ["b", "a"]), true);
  assert.equal(sameUniqueTeamSet(["a", "b"], ["a"]), false);
});
