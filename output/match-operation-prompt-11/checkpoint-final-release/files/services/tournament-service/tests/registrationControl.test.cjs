const assert = require("node:assert/strict");
const test = require("node:test");
const { isManualRegistrationControlEnabled } = require("../dist/services/tournamentService.js");

test("manual registration control requires the feature flag in development and test", () => {
  assert.equal(isManualRegistrationControlEnabled("development", true), true);
  assert.equal(isManualRegistrationControlEnabled("test", true), true);
  assert.equal(isManualRegistrationControlEnabled("development", false), false);
  assert.equal(isManualRegistrationControlEnabled("test", false), false);
});

test("production always disables manual registration control even when misconfigured", () => {
  assert.equal(isManualRegistrationControlEnabled("production", true), false);
});
