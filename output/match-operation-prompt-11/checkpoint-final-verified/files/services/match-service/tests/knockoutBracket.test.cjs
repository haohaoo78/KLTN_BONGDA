const assert = require("node:assert/strict");
const test = require("node:test");
const { createKnockoutBracket, createThirdPlaceBracketDefinition } = require("../dist/services/knockoutBracket");

for (const count of [5, 6, 7, 8, 10, 12, 16]) {
  test(`knockout ${count} đội tạo đúng cấu trúc nhánh và BYE`, () => {
    const teams = Array.from({ length: count }, (_, index) => ({ teamId: `team-${index + 1}`, seed: index + 1 }));
    const slots = createKnockoutBracket(teams);
    const size = 2 ** Math.ceil(Math.log2(count));
    const rounds = Math.log2(size);
    assert.equal(slots.length, size - 1);
    assert.equal(slots.filter((slot) => slot.round === 1 && slot.byeWinnerTeamId).length, size - count);
    assert.equal(slots.filter((slot) => slot.round === 1 && slot.homeTeamId && slot.awayTeamId).length, count - (size - count) - (size / 2 - (size - count)));
    assert.equal(new Set(slots.filter((slot) => slot.round === 1).flatMap((slot) => [slot.homeTeamId, slot.awayTeamId]).filter(Boolean)).size, count);
    assert.equal(Math.max(...slots.map((slot) => slot.round)), rounds);
    assert.equal(slots.filter((slot) => slot.round === rounds).length, 1);
  });
}

test("top two seeds do not meet in the opening round", () => {
  for (const count of [4, 5, 8, 16]) {
    const slots = createKnockoutBracket(Array.from({ length: count }, (_, index) => ({ teamId: `team-${index + 1}`, seed: index + 1 })));
    assert.equal(slots.filter((slot) => slot.round === 1).some((slot) =>
      [slot.homeTeamId, slot.awayTeamId].includes("team-1") && [slot.homeTeamId, slot.awayTeamId].includes("team-2")), false);
  }
});

test("rejects fewer than two teams and duplicate teams", () => {
  assert.throws(() => createKnockoutBracket([{ teamId: "a" }]), /At least two/);
  assert.throws(() => createKnockoutBracket([{ teamId: "a" }, { teamId: "a" }]), /Duplicate/);
});

test("published draw positions are preserved instead of seeded a second time", () => {
  const slots = createKnockoutBracket(Array.from({ length: 16 }, (_, index) => ({ teamId: `P${index + 1}`, position: index + 1 })));
  assert.deepEqual(slots.filter((slot) => slot.round === 1).map((slot) => [slot.homeTeamId, slot.awayTeamId]),
    Array.from({ length: 8 }, (_, index) => [`P${index * 2 + 1}`, `P${index * 2 + 2}`]));
  const byes = createKnockoutBracket([1, 3, 4, 5, 7, 8].map((position) => ({ teamId: `P${position}`, position })));
  assert.deepEqual(byes.filter((slot) => slot.byeWinnerTeamId).map((slot) => slot.byeWinnerTeamId), ["P1", "P5"]);
  assert.throws(() => createKnockoutBracket([{ teamId: "a", position: 1 }, { teamId: "b", position: 1 }]), /Invalid published/);
  assert.throws(() => createKnockoutBracket([{ teamId: "a", position: 1 }, { teamId: "b" }]), /Invalid published/);
});

test("third-place fixture links to the two semifinal losers for variable bracket sizes", () => {
  for (const count of [4, 5, 6, 7, 8, 16, 32]) {
    const definition = createThirdPlaceBracketDefinition(count);
    const slots = createKnockoutBracket(Array.from({ length: count }, (_, index) => ({ teamId: `team-${index + 1}` })));
    assert.equal(definition.round, Math.max(...slots.map((slot) => slot.round)));
    assert.equal(definition.position, 2);
    assert.deepEqual([definition.homeSourcePosition, definition.awaySourcePosition], [1, 2]);
    assert.equal(slots.some((slot) => slot.round === definition.round - 1 && slot.position === definition.homeSourcePosition), true);
    assert.equal(slots.some((slot) => slot.round === definition.round - 1 && slot.position === definition.awaySourcePosition), true);
  }
  assert.throws(() => createThirdPlaceBracketDefinition(3), /at least four/);
});
