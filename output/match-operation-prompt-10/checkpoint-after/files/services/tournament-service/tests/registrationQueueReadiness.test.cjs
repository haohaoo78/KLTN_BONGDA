const test = require("node:test");
const assert = require("node:assert/strict");
const { assertLockedTeamCountFitsFormat, assertRegistrationQueueCanBeLocked } = require("../dist/services/registrationQueueReadiness.js");

test("blocks locking below capacity while any application remains undecided", () => {
  assert.throws(() => assertRegistrationQueueCanBeLocked({
    statuses: [...Array(4).fill("APPROVED"), "PENDING", "NEEDS_SUPPLEMENT", "WAITLIST"], minimumTeams: 4, maximumTeams: 8,
  }), { code: "REGISTRATION_QUEUE_NOT_EXHAUSTED" });
});

test("requires every undecided application to be processed before locking below the maximum", () => {
  assert.throws(() => assertRegistrationQueueCanBeLocked({
    statuses: [...Array(12).fill("APPROVED"), "PENDING", "NEEDS_SUPPLEMENT", "REVISION_REQUIRED", "CONFLICT_ADJUSTMENT_REQUIRED", "WAITLIST"],
    minimumTeams: 12,
    maximumTeams: 16,
  }), { code: "REGISTRATION_QUEUE_NOT_EXHAUSTED" });
});

test("allows locking below capacity when no undecided application remains", () => {
  assert.doesNotThrow(() => assertRegistrationQueueCanBeLocked({
    statuses: [...Array(5).fill("APPROVED"), "REJECTED", "WITHDRAWN", "APPROVAL_REVOKED"],
    minimumTeams: 4,
    maximumTeams: 8,
  }));
});

test("allows locking at maximum capacity even when other applications remain", () => {
  assert.doesNotThrow(() => assertRegistrationQueueCanBeLocked({
    statuses: [...Array(8).fill("APPROVED"), "PENDING", "WAITLIST", "NEEDS_SUPPLEMENT"],
    minimumTeams: 4,
    maximumTeams: 8,
  }));
});

test("does not lock below the regulation minimum even when no application is pending", () => {
  assert.throws(
    () => assertRegistrationQueueCanBeLocked({ statuses: [...Array(7).fill("APPROVED"), "REJECTED"], minimumTeams: 8, maximumTeams: 20 }),
    { code: "MINIMUM_TEAMS_NOT_MET" },
  );
});

test("never permits an approved count above the regulation maximum", () => {
  assert.throws(
    () => assertRegistrationQueueCanBeLocked({ statuses: [...Array(21).fill("APPROVED"), "PENDING"], minimumTeams: 8, maximumTeams: 20 }),
    { code: "MAXIMUM_TEAMS_EXCEEDED" },
  );
});

test("locks after the minimum is met and every remaining over-capacity team is explicitly rejected", () => {
  assert.doesNotThrow(() => assertRegistrationQueueCanBeLocked({
    statuses: [...Array(8).fill("APPROVED"), ...Array(12).fill("REJECTED")],
    minimumTeams: 8,
    maximumTeams: 16,
  }));
});

test("allows the approved count to lock when it can be allocated into configured hybrid groups", () => {
  assert.doesNotThrow(() => assertLockedTeamCountFitsFormat({
    format: "GROUP_AND_KNOCKOUT", approvedCount: 14, groupCapacity: 4,
    groupCountMode: "FIXED", fixedGroupCount: 4,
  }));
});

test("blocks a hybrid group setup that would leave a one-team group", () => {
  assert.throws(() => assertLockedTeamCountFitsFormat({
    format: "GROUP_AND_KNOCKOUT", approvedCount: 7, groupCapacity: 3,
    groupCountMode: "FIXED", fixedGroupCount: 4,
  }), { code: "HYBRID_GROUP_COUNT_INFEASIBLE" });
});

test("round robin and knockout formats do not require the maximum team count", () => {
  assert.doesNotThrow(() => assertLockedTeamCountFitsFormat({ format: "ROUND_ROBIN", approvedCount: 12 }));
  assert.doesNotThrow(() => assertLockedTeamCountFitsFormat({ format: "KNOCKOUT", approvedCount: 13 }));
});
