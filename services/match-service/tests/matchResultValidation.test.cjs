const assert = require("node:assert/strict");
const test = require("node:test");
const { validateMatchScore } = require("../dist/services/matchResultValidation");

test("accepts a regular-time result and a decisive penalty shootout after a tie", () => {
  assert.doesNotThrow(() => validateMatchScore({ homeScore: 1, awayScore: 0 }));
  assert.doesNotThrow(() => validateMatchScore({ homeScore: 1, awayScore: 1, homePenaltyScore: 5, awayPenaltyScore: 4 }));
  assert.doesNotThrow(() => validateMatchScore({ homeScore: 2, awayScore: 2, homeExtraTimeScore: 1, awayExtraTimeScore: 1, homePenaltyScore: 6, awayPenaltyScore: 5 }));
});

test("rejects missing, fractional, negative, and out-of-range scores", () => {
  for (const score of [undefined, -1, 1.5, 2147483648]) {
    assert.throws(() => validateMatchScore({ homeScore: score, awayScore: 0 }), { code: "INVALID_SCORES" });
  }
  assert.throws(() => validateMatchScore({ homeScore: 0, awayScore: 0, homePenaltyScore: 4 }), { code: "INVALID_PENALTY_SCORES" });
  assert.throws(() => validateMatchScore({ homeScore: 0, awayScore: 0, homeExtraTimeScore: 2 }), { code: "INVALID_EXTRA_TIME_SCORES" });
});

test("requires extra time to follow a regular-time tie and penalties to follow a tie", () => {
  assert.throws(() => validateMatchScore({ homeScore: 2, awayScore: 1, homeExtraTimeScore: 1, awayExtraTimeScore: 0 }), { code: "EXTRA_TIME_REQUIRES_TIE" });
  assert.throws(() => validateMatchScore({ homeScore: 2, awayScore: 1, homePenaltyScore: 5, awayPenaltyScore: 4 }), { code: "PENALTIES_REQUIRE_TIE" });
  assert.throws(() => validateMatchScore({ homeScore: 1, awayScore: 1, homePenaltyScore: 4, awayPenaltyScore: 4 }), { code: "PENALTIES_MUST_DECIDE_WINNER" });
});
