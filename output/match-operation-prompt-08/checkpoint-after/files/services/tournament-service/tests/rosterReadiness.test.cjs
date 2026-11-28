const assert = require("node:assert/strict");
const test = require("node:test");
const { isTeamRosterReady } = require("../dist/services/rosterReadiness");

test("a player-confirmed team roster can be locked without per-player BTC review state", () => {
  assert.equal(isTeamRosterReady({ rosterCount: 15, listedCount: 15, minimumPlayers: 10, maximumPlayers: 20, goalkeepers: 2, minimumGoalkeepers: 1, starters: 7, requiredStarters: 7, startingGoalkeepers: 1 }), true);
});

test("roster lock rejects team-wide count or lineup violations", () => {
  assert.equal(isTeamRosterReady({ rosterCount: 9, listedCount: 9, minimumPlayers: 10, maximumPlayers: 20, goalkeepers: 1, minimumGoalkeepers: 1, starters: 7, requiredStarters: 7, startingGoalkeepers: 1 }), false);
  assert.equal(isTeamRosterReady({ rosterCount: 12, listedCount: 11, minimumPlayers: 10, maximumPlayers: 20, goalkeepers: 1, minimumGoalkeepers: 1, starters: 7, requiredStarters: 7, startingGoalkeepers: 1 }), false);
  assert.equal(isTeamRosterReady({ rosterCount: 12, listedCount: 12, minimumPlayers: 10, maximumPlayers: 20, goalkeepers: 1, minimumGoalkeepers: 2, starters: 7, requiredStarters: 7, startingGoalkeepers: 1 }), false);
  assert.equal(isTeamRosterReady({ rosterCount: 12, listedCount: 12, minimumPlayers: 10, maximumPlayers: 20, goalkeepers: 1, minimumGoalkeepers: 1, starters: 7, requiredStarters: 7, startingGoalkeepers: 2 }), false);
});
