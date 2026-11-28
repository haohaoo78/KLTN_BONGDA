const assert = require("node:assert/strict");
const test = require("node:test");
const { createRoundRobinFixtures } = require("../dist/services/fixtureGenerationService");

const testedTeamCounts = [5, 6, 7, 8, 10, 12, 16];

function makeDraw(teamCount) {
  return {
    id: "draw-test",
    tournamentId: "tournament-test",
    status: "PUBLISHED",
    groups: [{
      id: "group-test",
      name: "Bảng A",
      assignments: Array.from({ length: teamCount }, (_, index) => ({ teamId: `team-${index + 1}` })),
    }],
  };
}

for (const teamCount of testedTeamCounts) {
  test(`vòng tròn ${teamCount} đội tạo đúng số trận một lượt và hai lượt`, () => {
    const draw = makeDraw(teamCount);
    const oneLeg = createRoundRobinFixtures(draw, 1);
    const twoLegs = createRoundRobinFixtures(draw, 2);
    const expectedOneLeg = (teamCount * (teamCount - 1)) / 2;

    assert.equal(oneLeg.length, expectedOneLeg);
    assert.equal(twoLegs.length, expectedOneLeg * 2);
    assert.equal(new Set(oneLeg.map((fixture) => [fixture.homeTeamId, fixture.awayTeamId].sort().join("/"))).size, expectedOneLeg);
    assert.equal(new Set(twoLegs.map((fixture) => `${fixture.leg}:${[fixture.homeTeamId, fixture.awayTeamId].sort().join("/")}`)).size, expectedOneLeg * 2);
  });

  test(`vòng tròn ${teamCount} đội không xếp một đội hai lần trong cùng vòng`, () => {
    const fixtures = createRoundRobinFixtures(makeDraw(teamCount), 1);
    const rounds = new Map();
    for (const fixture of fixtures) {
      const teams = rounds.get(fixture.roundNumber) ?? new Set();
      assert.equal(teams.has(fixture.homeTeamId), false);
      assert.equal(teams.has(fixture.awayTeamId), false);
      teams.add(fixture.homeTeamId);
      teams.add(fixture.awayTeamId);
      rounds.set(fixture.roundNumber, teams);
    }
    assert.equal(rounds.size, teamCount % 2 === 0 ? teamCount - 1 : teamCount);
    if (teamCount % 2 === 1) {
      for (let teamIndex = 1; teamIndex <= teamCount; teamIndex += 1) {
        const teamId = `team-${teamIndex}`;
        const playedRounds = [...rounds.values()].filter((teams) => teams.has(teamId)).length;
        assert.equal(playedRounds, teamCount - 1, `${teamId} must receive exactly one bye`);
      }
    }
  });

  test(`vòng tròn ${teamCount} đội lượt về đảo sân của từng cặp`, () => {
    const fixtures = createRoundRobinFixtures(makeDraw(teamCount), 2);
    const byPair = new Map();
    for (const fixture of fixtures) {
      const key = [fixture.homeTeamId, fixture.awayTeamId].sort().join("/");
      const legs = byPair.get(key) ?? [];
      legs.push(fixture);
      byPair.set(key, legs);
    }
    assert.equal(byPair.size, teamCount * (teamCount - 1) / 2);
    for (const [pair, legs] of byPair) {
      assert.equal(legs.length, 2, pair);
      assert.deepEqual(new Set(legs.map((fixture) => fixture.leg)), new Set([1, 2]));
      assert.equal(legs[0].homeTeamId, legs[1].awayTeamId, `${pair} home/away reversed`);
      assert.equal(legs[0].awayTeamId, legs[1].homeTeamId, `${pair} away/home reversed`);
    }
  });
}

test("vòng tròn nhiều bảng sinh số trận và số vòng độc lập theo từng cỡ bảng", () => {
  const draw = makeDraw(4);
  draw.groups.push({
    id: "group-b",
    name: "Bảng B",
    assignments: Array.from({ length: 5 }, (_, index) => ({ teamId: `b-${index + 1}` })),
  });
  const oneLeg = createRoundRobinFixtures(draw, 1);
  assert.equal(oneLeg.filter((fixture) => fixture.groupId === "group-test").length, 6);
  assert.equal(oneLeg.filter((fixture) => fixture.groupId === "group-b").length, 10);
  assert.equal(new Set(oneLeg.filter((fixture) => fixture.groupId === "group-test").map((fixture) => fixture.roundNumber)).size, 3);
  assert.equal(new Set(oneLeg.filter((fixture) => fixture.groupId === "group-b").map((fixture) => fixture.roundNumber)).size, 5);
  for (let roundNumber = 1; roundNumber <= 5; roundNumber += 1) {
    const played = new Set(oneLeg.filter((fixture) => fixture.groupId === "group-b" && fixture.roundNumber === roundNumber)
      .flatMap((fixture) => [fixture.homeTeamId, fixture.awayTeamId]));
    assert.equal(5 - played.size, 1, `Bảng B round ${roundNumber} has one resting team`);
  }
});
