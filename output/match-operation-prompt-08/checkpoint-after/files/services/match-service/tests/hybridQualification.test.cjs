const assert = require("node:assert/strict");
const test = require("node:test");
const { rankHybridGroup, selectHybridQualifiers } = require("../dist/services/hybridQualification");

test("read-only standings ignore unapproved scores and do not invent ranks for unresolved ties", () => {
  const input = { groupId: "group-a", fixtures: [{ homeTeamId: "A", awayTeamId: "B", homeScore: 9, awayScore: 0, status: "COMPLETED", resultStatus: "SUBMITTED" }],
    advancingTeamsPerGroup: 1, rankingCriteria: ["POINTS", "GOAL_DIFFERENCE", "LOT_DRAW"], pointsForWin: 3, pointsForDraw: 1, pointsForLoss: 0 };
  const rows = rankHybridGroup({ ...input, preview: true });
  assert.deepEqual(rows.map(({ played, points, groupRank }) => [played, points, groupRank]), [[0, 0, 0], [0, 0, 0]]);
  assert.throws(() => rankHybridGroup(input), (error) => error.code === "GROUP_RESULTS_NOT_FINAL");
  const final = rankHybridGroup({ ...input, preview: true, fixtures: [{ ...input.fixtures[0], status: "VERIFIED", resultStatus: "APPROVED" }] });
  assert.deepEqual(final.map(({ teamId, points, groupRank }) => [teamId, points, groupRank]), [["A", 3, 1], ["B", 0, 2]]);
});

function fixture(homeTeamId, awayTeamId, homeScore, awayScore, status = "VERIFIED", resultStatus = "APPROVED") {
  return { homeTeamId, awayTeamId, homeScore, awayScore, status, resultStatus };
}

test("hybrid group ranking applies configured points and goal difference before qualification", () => {
  const ranked = rankHybridGroup({
    groupId: "group-a",
    fixtures: [fixture("A", "B", 2, 0), fixture("A", "C", 1, 0), fixture("B", "C", 1, 0)],
    advancingTeamsPerGroup: 2,
    rankingCriteria: ["POINTS", "GOAL_DIFFERENCE", "GOALS_FOR"],
    pointsForWin: 3, pointsForDraw: 1, pointsForLoss: 0,
  });
  assert.deepEqual(ranked.map(({ teamId, groupRank }) => [teamId, groupRank]), [["A", 1], ["B", 2], ["C", 3]]);
});

test("hybrid group ranking rejects unapproved results and unresolved tie-breaks", () => {
  assert.throws(() => rankHybridGroup({
    groupId: "group-a", fixtures: [fixture("A", "B", 1, 0, "FINISHED", "PENDING")],
    advancingTeamsPerGroup: 1, rankingCriteria: ["POINTS"], pointsForWin: 3, pointsForDraw: 1, pointsForLoss: 0,
  }), (error) => error.code === "GROUP_RESULTS_NOT_FINAL");
  assert.throws(() => rankHybridGroup({
    groupId: "group-a", fixtures: [fixture("A", "B", 0, 0)],
    advancingTeamsPerGroup: 1, rankingCriteria: ["POINTS", "LOT_DRAW"], pointsForWin: 3, pointsForDraw: 1, pointsForLoss: 0,
  }), (error) => error.code === "GROUP_LOT_DRAW_REQUIRED");
});

test("head-to-head and fair-play criteria resolve ties in the configured order", () => {
  const headToHead = rankHybridGroup({
    groupId: "group-a",
    fixtures: [
      fixture("A", "B", 1, 0), fixture("A", "C", 1, 0), fixture("A", "D", 0, 1),
      fixture("B", "C", 1, 0), fixture("B", "D", 1, 0), fixture("C", "D", 1, 0),
    ],
    advancingTeamsPerGroup: 1,
    rankingCriteria: ["POINTS", "GOAL_DIFFERENCE", "HEAD_TO_HEAD"],
    pointsForWin: 3, pointsForDraw: 1, pointsForLoss: 0,
  });
  assert.equal(headToHead[0].teamId, "A");

  const fairPlay = rankHybridGroup({
    groupId: "group-b", fixtures: [fixture("A", "B", 0, 0)], advancingTeamsPerGroup: 1,
    rankingCriteria: ["POINTS", "GOAL_DIFFERENCE", "GOALS_FOR", "FAIR_PLAY"],
    pointsForWin: 3, pointsForDraw: 1, pointsForLoss: 0, fairPlayPoints: { A: 1, B: 0 },
  });
  assert.equal(fairPlay[0].teamId, "B");
});

test("hybrid qualifiers interleave ranks across groups and reject incomplete or duplicate standings", () => {
  const groupA = [
    { teamId: "A1", groupId: "A", groupRank: 1 },
    { teamId: "A2", groupId: "A", groupRank: 2 },
    { teamId: "A3", groupId: "A", groupRank: 3 },
  ];
  const groupB = [
    { teamId: "B1", groupId: "B", groupRank: 1 },
    { teamId: "B2", groupId: "B", groupRank: 2 },
    { teamId: "B3", groupId: "B", groupRank: 3 },
  ];
  const qualifiers = selectHybridQualifiers([groupA, groupB], 2);
  assert.deepEqual(qualifiers.map(({ teamId, groupRank }) => [teamId, groupRank]), [
    ["A1", 1], ["B1", 1], ["A2", 2], ["B2", 2],
  ]);
  assert.throws(() => selectHybridQualifiers([groupA, groupB], 4), (error) => error.code === "INVALID_ADVANCING_TEAMS");
  assert.throws(() => selectHybridQualifiers([groupA, [{ ...groupB[0], teamId: "A1" }]], 1), (error) => error.code === "DUPLICATE_QUALIFIED_TEAM");
});

test("a witnessed lot draw resolves only the exact tied teams and emits actionable details when missing", () => {
  const input = {
    groupId: "group-a",
    fixtures: [fixture("A", "B", 0, 0)],
    advancingTeamsPerGroup: 2,
    rankingCriteria: ["POINTS", "LOT_DRAW"],
    pointsForWin: 3,
    pointsForDraw: 1,
    pointsForLoss: 0,
  };
  assert.throws(() => rankHybridGroup(input), (error) => {
    assert.equal(error.code, "GROUP_LOT_DRAW_REQUIRED");
    assert.deepEqual(error.details, { groupId: "group-a", tiedTeamIds: ["A", "B"] });
    return true;
  });

  const ranked = rankHybridGroup({
    ...input,
    lotDrawResolutions: [{
      tiedTeamIds: ["A", "B"],
      drawnOrder: ["B", "A"],
      witnessName: "Nguyễn Văn B",
      reason: "Biên bản số 04, bốc thăm công khai sau trận cuối bảng A.",
    }],
  });
  assert.deepEqual(ranked.map(({ teamId, groupRank }) => [teamId, groupRank]), [["B", 1], ["A", 2]]);
  assert.throws(() => rankHybridGroup({
    ...input,
    lotDrawResolutions: [{
      tiedTeamIds: ["A", "B"], drawnOrder: ["A", "A"], witnessName: "Nguyễn Văn B", reason: "Biên bản bốc thăm số 04.",
    }],
  }), (error) => error.code === "INVALID_GROUP_LOT_DRAW");
});
