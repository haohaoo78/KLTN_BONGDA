import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const transpile = (source, fileName) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName,
}).outputText;
const sharedRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../packages/shared/src");
const moduleCache = new Map();
function loadSharedModule(filePath) {
  const absolutePath = path.resolve(filePath);
  if (moduleCache.has(absolutePath)) return moduleCache.get(absolutePath).exports;
  const module = { exports: {} };
  moduleCache.set(absolutePath, module);
  const source = readFileSync(absolutePath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: absolutePath,
  }).outputText;
  const localRequire = (specifier) => {
    if (!specifier.startsWith(".")) return require(specifier);
    const resolved = path.resolve(path.dirname(absolutePath), `${specifier}.ts`);
    return loadSharedModule(resolved);
  };
  new Function("require", "module", "exports", compiled)(localRequire, module, module.exports);
  return module.exports;
}
const { buildAutomaticRefereePlan } = loadSharedModule(path.join(sharedRoot, "automaticRefereePlanner.ts"));

const start = "2026-11-22T08:00:00+07:00";
const weekday = new Date(start).getDay();
const referee = (id, extra = {}) => ({
  id, source: "VIRTUAL", displayName: `Ref ${id}`, formats: [7], level: "CITY", experienceYears: 5,
  positionIds: ["main", "assistant"], availability: [{ id: `${id}-availability`, weekday, start: "00:00", end: "23:59" }],
  unavailablePeriods: [], minimumRestMinutes: 0, maximumMatchesPerDay: 5,
  participationStatus: "ACTIVE", dutyStatus: "ACTIVE", ...extra,
});
const positions = ["main", "assistant"].map((id) => ({
  id, code: id, label: id, requiredCount: 1, required: true, formats: [7], minimumLevel: "ENTRY",
  minimumExperienceYears: 0, duties: "", permissions: [], confirmsResult: false,
}));
const fixtures = [
  { id: "M1", stage: "GROUP", groupName: "A", round: "R1", homeTeamId: "T1", awayTeamId: "T2" },
  { id: "M2", stage: "GROUP", groupName: "A", round: "R2", homeTeamId: "T3", awayTeamId: "T4" },
];
const schedules = { M1: { scheduledAt: start, venue: "V1" }, M2: { scheduledAt: "2026-11-22T13:00:00+07:00", venue: "V2" } };
const timing = { halfMinutes: 30, halftimeBreakMinutes: 5, preparationBeforeMinutes: 5, transitionAfterMinutes: 5, extraTimeReserveMinutes: 0, penaltyReserveMinutes: 0 };
const resources = { groupTiming: timing, knockoutTiming: timing, travelBufferMinutes: 0, venues: [] };
const crewTemplate = { id: "pair", name: "Tổ 2 người", positionIds: ["main", "assistant"], positionCounts: { main: 1, assistant: 1 }, notes: "" };
const crew = (id, first, second) => ({
  id, code: id, name: id, templateId: crewTemplate.id, status: "ACTIVE",
  members: [{ refereeId: first, positionId: "main" }, { refereeId: second, positionId: "assistant" }],
});
const configuration = (method = "INDIVIDUAL", overrides = {}) => ({
  rounds: [], groups: [], dates: [], onlyUnassignedFixtures: false, onlyMissingSlots: true, method,
  objectives: ["FEWEST_CANDIDATES", "UPCOMING", "EXPERIENCE", "BALANCE", "REST", "TEAM_REPEAT", "CREW_CONTINUITY"],
  maxRuntimeMs: 500, ...overrides,
});
const input = (referees, overrides = {}) => ({
  fixtures: overrides.fixtures ?? fixtures,
  schedules: overrides.schedules ?? schedules,
  resources,
  roster: {
    referees, models: [{ id: "pair", name: "2 vị trí", positions, stageScopes: ["GROUP"], isDefault: true }],
    crewTemplates: [crewTemplate], crews: overrides.crews ?? [], neutralRules: overrides.neutralRules ?? [],
    matchRequirements: {}, evaluations: [],
  },
  currentAssignments: overrides.currentAssignments ?? {}, publishedAssignments: {}, publishedFixtureIds: [],
  lockedFixtureIds: [], lockedSlotKeysByFixture: overrides.lockedSlots ?? {}, teamAffiliations: {}, format: 7,
  configuration: configuration(overrides.method, overrides.config),
});

test("individual method fills required positions without assigning one person twice in a match", () => {
  const result = buildAutomaticRefereePlan(input([referee("R1"), referee("R2"), referee("R3")]));
  assert.equal(result.status, "COMPLETE");
  for (const fixture of fixtures) assert.equal(new Set(result.proposedAssignmentsByFixture[fixture.id].map((row) => row.refereeId)).size, 2);
});

test("crew method assigns a complete matching crew", () => {
  const result = buildAutomaticRefereePlan(input([referee("R1"), referee("R2")], {
    method: "CREW", fixtures: [fixtures[0]], schedules: { M1: schedules.M1 }, crews: [crew("C1", "R1", "R2")],
  }));
  assert.equal(result.status, "COMPLETE");
  assert.ok(result.proposedAssignmentsByFixture.M1.every((row) => row.crewId === "C1"));
});

test("mixed method falls back to individual assignment when there is no usable crew", () => {
  const result = buildAutomaticRefereePlan(input([referee("R1"), referee("R2")], {
    method: "MIXED", fixtures: [fixtures[0]], schedules: { M1: schedules.M1 },
  }));
  assert.equal(result.status, "COMPLETE");
  assert.ok(result.proposedAssignmentsByFixture.M1.every((row) => row.source === "INDIVIDUAL"));
});

test("shared crew members are not assigned to concurrent matches twice", () => {
  const sameTime = { M1: schedules.M1, M2: { ...schedules.M2, scheduledAt: start } };
  const result = buildAutomaticRefereePlan(input(["R1", "R2", "R3", "R4"].map((id) => referee(id)), {
    method: "CREW", schedules: sameTime,
    crews: [crew("C1", "R1", "R2"), crew("C2", "R1", "R3"), crew("C3", "R3", "R4")],
  }));
  assert.equal(result.status, "COMPLETE");
  const assignments = Object.values(result.proposedAssignmentsByFixture).flat();
  assert.equal(assignments.length, 4);
  for (const id of ["R1", "R2", "R3", "R4"]) assert.ok(assignments.filter((row) => row.refereeId === id).length <= 1);
});

test("locked position remains unchanged while missing position is filled", () => {
  const held = { positionId: "main", slotIndex: 0, refereeId: "R1", refereeName: "Ref R1", eligibilityConfirmed: true, availabilityConfirmed: true, locked: true };
  const result = buildAutomaticRefereePlan(input([referee("R1"), referee("R2")], {
    fixtures: [fixtures[0]], schedules: { M1: schedules.M1 }, currentAssignments: { M1: [held] }, lockedSlots: { M1: ["main:0"] },
  }));
  const rows = result.proposedAssignmentsByFixture.M1;
  assert.equal(rows.find((row) => row.positionId === "main").refereeId, "R1");
  assert.equal(rows.find((row) => row.positionId === "assistant").refereeId, "R2");
});

test("suspended referee is rejected and partial result explains missing positions", () => {
  const result = buildAutomaticRefereePlan(input([referee("R1", { dutyStatus: "SUSPENDED" })]));
  assert.equal(result.status, "PARTIAL");
  assert.ok(result.missing.length > 0);
  assert.ok(Object.values(result.proposedAssignmentsByFixture).flat().every((row) => row.refereeId !== "R1"));
});

test("unknown opponent with mandatory neutrality is flagged for recheck", () => {
  const fixture = { id: "K1", stage: "KNOCKOUT", round: "SF", homeTeamId: null, awayTeamId: "T2", homeSource: "Winner M1" };
  const result = buildAutomaticRefereePlan(input([referee("R1"), referee("R2")], {
    fixtures: [fixture], schedules: { K1: schedules.M1 },
    neutralRules: [{ id: "N1", scope: "SCHOOL", value: "IUH", mandatory: true, note: "" }],
  }));
  assert.equal(result.status, "COMPLETE");
  assert.ok(result.proposedAssignmentsByFixture.K1.every((row) => row.validationStatus === "NEEDS_RECHECK"));
});

test("round, group and day filters constrain target fixtures", () => {
  const result = buildAutomaticRefereePlan(input([referee("R1"), referee("R2")], {
    config: { rounds: ["R2"], groups: ["A"], dates: ["2026-11-22"] },
  }));
  assert.deepEqual(result.targetFixtureIds, ["M2"]);
});

test("format qualification is respected for 5, 7 and 11 player models", () => {
  for (const format of [5, 7, 11]) {
    const qualified = input([referee(`R${format}`, { formats: [format] }), referee(`A${format}`, { formats: [format] })], {
      fixtures: [fixtures[0]], schedules: { M1: schedules.M1 },
    });
    qualified.format = format;
    qualified.roster.models[0].positions = positions.map((position) => ({ ...position, formats: [format] }));
    const result = buildAutomaticRefereePlan(qualified);
    assert.equal(result.status, "COMPLETE", `${format}-player format should be schedulable`);
    const unqualified = { ...qualified, roster: { ...qualified.roster, referees: qualified.roster.referees.map((item) => ({ ...item, formats: [format === 5 ? 7 : 5] })) } };
    assert.equal(buildAutomaticRefereePlan(unqualified).status, "PARTIAL", `${format}-player incompatible officials must be rejected`);
  }
});
