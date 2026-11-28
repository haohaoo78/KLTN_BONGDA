const test = require("node:test");
const assert = require("node:assert/strict");
const { assertApprovalRevocationAllowed, isNonManagerAccessStatus } = require("../dist/lib/teamAuthorization");

test("hidden and missing tournaments are treated as no manager access, not upstream failure", () => {
  assert.equal(isNonManagerAccessStatus(403), true);
  assert.equal(isNonManagerAccessStatus(404), true);
  assert.equal(isNonManagerAccessStatus(401), false);
  assert.equal(isNonManagerAccessStatus(500), false);
  assert.equal(isNonManagerAccessStatus(502), false);
});

test("approval revocation is rejected after roster lock or a later tournament stage", () => {
  for (const status of ["ROSTER_LOCKED", "PREPARING", "IN_PROGRESS", "PAUSED", "COMPLETED"]) {
    assert.throws(() => assertApprovalRevocationAllowed(status), (error) => error.code === "APPROVAL_REVOCATION_AFTER_ROSTER_LOCK");
  }
  for (const status of ["OPEN_REGISTRATION", "REGISTRATION_CLOSED"]) {
    assert.doesNotThrow(() => assertApprovalRevocationAllowed(status));
  }
});
