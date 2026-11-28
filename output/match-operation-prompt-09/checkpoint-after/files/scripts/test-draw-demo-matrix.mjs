import assert from "node:assert/strict";

const generatorUrl = new URL("../apps/web-client/src/utils/drawDemoFixtures.ts", import.meta.url);
const { generateDemoFixtures } = await import(generatorUrl.href);
const methods = ["DIRECT", "RANDOM", "MANUAL"];
const formats = ["ROUND_ROBIN", "KNOCKOUT", "GROUP_AND_KNOCKOUT"];
const ids = Array.from({ length: 9 }, (_, index) => `db-team-${String(index + 1).padStart(2, "0")}`);

for (const format of formats) {
  for (const method of methods) {
    const teamsPerGroup = format === "KNOCKOUT" ? [ids.length] : [5, 4];
    const slots = format === "KNOCKOUT" ? [...ids, ...Array(7).fill(null)] : [...ids];
    const state = {
      version: 1,
      tournamentId: `matrix-${format}-${method}`,
      configuration: { format, teamIds: ids, groupCount: teamsPerGroup.length, teamsPerGroup, roundRobinLegs: 2, qualifiersPerGroup: 2, extraQualificationSlots: 1, knockoutPairing: "GROUP_RANK" },
      publication: { method, format, teamIds: ids, teamsPerGroup, slots, byePositions: format === "KNOCKOUT" ? Array.from({ length: 7 }, (_, index) => ids.length + index) : [], groupCount: teamsPerGroup.length, qualifiersPerGroup: 2, extraQualificationSlots: 1, publishedAt: new Date(0).toISOString() },
      fixtures: [], fixturesPublishedAt: null, directSession: null, completedSteps: { step3: true, step4: false }, currentStep: 5, updatedAt: new Date(0).toISOString(),
    };
    const fixtures = generateDemoFixtures(state);
    const fixtureIds = new Set(fixtures.map((fixture) => fixture.id));
    assert.equal(fixtureIds.size, fixtures.length, `${format}/${method}: unique fixture IDs`);
    assert.ok(fixtures.every((fixture) => fixture.homeTeamId !== fixture.awayTeamId || fixture.homeTeamId === null), `${format}/${method}: no self-match`);

    if (format === "ROUND_ROBIN") {
      const groupMatches = fixtures.filter((fixture) => fixture.stage === "GROUP");
      assert.equal(groupMatches.length, (5 * 4 / 2 + 4 * 3 / 2) * 2, `${format}/${method}: double round-robin match count`);
      for (const round of new Set(groupMatches.map((fixture) => fixture.round))) {
        const appearing = groupMatches.filter((fixture) => fixture.round === round).flatMap((fixture) => [fixture.homeTeamId, fixture.awayTeamId]).filter(Boolean);
        assert.equal(new Set(appearing).size, appearing.length, `${format}/${method}: no team appears twice in a round`);
      }
    }
    if (format === "KNOCKOUT") {
      const knockout = fixtures.filter((fixture) => fixture.stage === "KNOCKOUT");
      assert.equal(knockout.length, ids.length - 1, `${format}/${method}: N-1 actual matches with BYE advancement`);
      assert.ok(knockout.every((fixture) => !fixture.homeSource?.includes("BYE") && !fixture.awaySource?.includes("BYE")), `${format}/${method}: BYE is not a match`);
    }
    if (format === "GROUP_AND_KNOCKOUT") {
      const groupMatches = fixtures.filter((fixture) => fixture.stage === "GROUP");
      const playoff = fixtures.filter((fixture) => fixture.stage === "KNOCKOUT");
      assert.equal(groupMatches.length, 16 * 2, `${format}/${method}: group schedule`);
      assert.equal(playoff.length, 4, `${format}/${method}: five qualifiers generate four actual matches`);
      assert.ok(playoff.every((fixture) => fixture.homeSource?.includes("bảng") || fixture.homeSource?.startsWith("Thắng") || fixture.awaySource?.includes("bảng") || fixture.awaySource?.startsWith("Thắng")), `${format}/${method}: bracket uses rank/winner sources`);
      assert.ok(playoff.every((fixture) => !fixture.homeSource?.includes("A1") && !fixture.awaySource?.includes("A1")), `${format}/${method}: bracket sources are ranks, not allocation slots`);
      assert.equal(playoff[0].homeSource, "Nhất bảng A", `${format}/${method}: first crossover home is group A winner`);
      assert.equal(playoff[0].awaySource, "Nhì bảng B", `${format}/${method}: first crossover away is group B runner-up`);
      assert.equal(playoff[1].homeSource, "Nhất bảng B", `${format}/${method}: second crossover home is group B winner`);
      assert.equal(playoff[1].awaySource, "Nhì bảng A", `${format}/${method}: second crossover away is group A runner-up`);
    }
    console.log(`PASS ${format} + ${method} (${fixtures.length} fixtures)`);
  }
}

const knockoutIds = Array.from({ length: 8 }, (_, index) => `bye-test-${index + 1}`);
const thirdPlaceState = {
  version: 1,
  tournamentId: "knockout-third-place",
  configuration: { format: "KNOCKOUT", teamIds: knockoutIds, groupCount: 1, teamsPerGroup: [8], roundRobinLegs: 1, qualifiersPerGroup: 0, extraQualificationSlots: 0, thirdPlaceMatch: true },
  publication: { method: "RANDOM", format: "KNOCKOUT", teamIds: knockoutIds, teamsPerGroup: [8], slots: knockoutIds, byePositions: [], groupCount: 1, qualifiersPerGroup: 0, extraQualificationSlots: 0, publishedAt: new Date(0).toISOString() },
  fixtures: [], fixturesPublishedAt: null, directSession: null, completedSteps: { step3: true, step4: false }, currentStep: 4, updatedAt: new Date(0).toISOString(),
};
const thirdPlaceFixtures = generateDemoFixtures(thirdPlaceState);
const thirdPlace = thirdPlaceFixtures.find((fixture) => fixture.id.includes("-THIRD-"));
assert.ok(thirdPlace, "knockout: configured third-place fixture exists");
assert.ok(thirdPlace.homeSource?.includes("-R2-"), "knockout: third-place home comes from a semifinal loser");
assert.ok(thirdPlace.awaySource?.includes("-R2-"), "knockout: third-place away comes from a semifinal loser");
assert.equal(thirdPlaceFixtures.filter((fixture) => fixture.stage === "KNOCKOUT").length, 8, "knockout: third-place match is added without replacing the final");
console.log("PASS knockout third-place fixture links to semifinal losers");

console.log("PASS all 9 Step 3 method × format combinations at the Step 4 fixture-generation boundary");
