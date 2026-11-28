const assert = require("node:assert/strict");
const test = require("node:test");
const { crewHasCapability, validateCrewAssignments } = require("../dist/scheduling/crewValidation");

test("allows a one-person crew when that official has final authority", () => {
  assert.doesNotThrow(() => validateCrewAssignments([
    { refereeId: "official-1", position: "REFEREE", isFinalAuthority: true },
  ]));
});

test("allows multiple officials with exactly one final authority", () => {
  assert.doesNotThrow(() => validateCrewAssignments([
    { refereeId: "official-1", position: "REFEREE", isFinalAuthority: true },
    { refereeId: "official-2", position: "ASSISTANT_REFEREE_1", isFinalAuthority: false },
    { refereeId: "official-3", position: "FOURTH_OFFICIAL", isFinalAuthority: false },
  ]));
});

test("allows an empty crew only while no assignment is being finalized", () => {
  assert.doesNotThrow(() => validateCrewAssignments([]));
});

test("rejects crews with no or multiple final authorities", () => {
  assert.throws(() => validateCrewAssignments([
    { refereeId: "official-1", position: "REFEREE", isFinalAuthority: false },
  ]), { code: "FINAL_AUTHORITY_REQUIRED" });
  assert.throws(() => validateCrewAssignments([
    { refereeId: "official-1", position: "REFEREE", isFinalAuthority: true },
    { refereeId: "official-2", position: "ASSISTANT_REFEREE_1", isFinalAuthority: true },
  ]), { code: "FINAL_AUTHORITY_REQUIRED" });
});

test("rejects duplicate officials, duplicate positions, and unsupported position codes", () => {
  assert.throws(() => validateCrewAssignments([
    { refereeId: "same", position: "REFEREE", isFinalAuthority: true },
    { refereeId: "same", position: "ASSISTANT_REFEREE_1", isFinalAuthority: false },
  ]), { code: "DUPLICATE_CREW_ASSIGNMENT" });
  assert.throws(() => validateCrewAssignments([
    { refereeId: "official-1", position: "REFEREE", isFinalAuthority: true },
    { refereeId: "official-2", position: "REFEREE", isFinalAuthority: false },
  ]), { code: "DUPLICATE_CREW_ASSIGNMENT" });
  assert.throws(() => validateCrewAssignments([
    { refereeId: "official-1", position: "referee", isFinalAuthority: true },
  ]), { code: "INVALID_CREW_ASSIGNMENT" });
  assert.throws(() => validateCrewAssignments([
    { refereeId: "official-1", position: "VIDEO_OPERATOR", isFinalAuthority: true },
  ]), { code: "INVALID_CREW_ASSIGNMENT" });
  assert.throws(() => validateCrewAssignments([
    { refereeId: "official-1", position: "ADMIN", isFinalAuthority: true },
  ]), { code: "INVALID_CREW_ASSIGNMENT" });
});

test("requires the on-field referee to hold final result authority", () => {
  assert.throws(() => validateCrewAssignments([
    { refereeId: "official-1", position: "ASSISTANT_REFEREE_1", isFinalAuthority: true },
  ]), { code: "FINAL_AUTHORITY_MUST_BE_REFEREE" });
  assert.doesNotThrow(() => validateCrewAssignments([
    { refereeId: "official-1", position: "REFEREE", isFinalAuthority: true },
    { refereeId: "official-2", position: "ASSISTANT_REFEREE_1", isFinalAuthority: false },
  ]));
});

test("limits each match crew to twelve officials", () => {
  const assignments = Array.from({ length: 13 }, (_, index) => ({
    refereeId: `official-${index}`,
    position: `OFFICIAL_${index}`,
    isFinalAuthority: index === 0,
  }));
  assert.throws(() => validateCrewAssignments(assignments), { code: "INVALID_CREW" });
});

test("separates event entry, event correction, and final confirmation permissions", () => {
  assert.equal(crewHasCapability("REFEREE", true, "RECORD_EVENT"), true);
  assert.equal(crewHasCapability("REFEREE", true, "FINALIZE"), true);
  assert.equal(crewHasCapability("REFEREE", true, "EDIT_EVENT"), true);
  assert.equal(crewHasCapability("ASSISTANT_REFEREE_1", false, "RECORD_EVENT"), true);
  assert.equal(crewHasCapability("ASSISTANT_REFEREE_1", false, "EDIT_EVENT"), false);
  assert.equal(crewHasCapability("ASSISTANT_REFEREE_1", false, "FINALIZE"), false);
  assert.equal(crewHasCapability("MATCH_SECRETARY", false, "RECORD_EVENT"), true);
  assert.equal(crewHasCapability("MATCH_SECRETARY", false, "EDIT_EVENT"), false);
  assert.equal(crewHasCapability("VIDEO_OPERATOR", false, "RECORD_EVENT"), false);
});
