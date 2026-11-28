const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const test = require("node:test");

test("hybrid Step 4 stores official version metadata and publishes all stages atomically", {
  skip: process.env.RUN_FIXTURE_STRUCTURE_DB_INTEGRATION !== "1",
}, async () => {
  const { getPool, closePool } = require("../dist/lib/db");
  const {
    generateGroupFixtures,
    generateHybridPlayoffSkeleton,
    listManagedTournamentFixtures,
    publishTournamentFixtureStructure,
  } = require("../dist/repositories/matchRepository");
  const pool = getPool();
  const tournamentId = randomUUID();
  const drawVersionId = randomUUID();
  const actorId = randomUUID();
  const groups = [randomUUID(), randomUUID()];
  const teams = Array.from({ length: 4 }, () => randomUUID());
  const fixtures = groups.map((groupId, index) => ({
    tournamentId,
    drawVersionId,
    groupId,
    groupName: `Bảng ${index ? "B" : "A"}`,
    round: `Bảng ${index ? "B" : "A"} · Lượt 1 · Vòng 1`,
    roundNumber: 1,
    leg: 1,
    homeTeamId: teams[index * 2],
    awayTeamId: teams[index * 2 + 1],
  }));
  try {
    const groupRun = await generateGroupFixtures(tournamentId, drawVersionId, 1, fixtures, actorId, 7);
    assert.equal(groupRun.matches.length, 2);
    assert.ok(groupRun.matches.every((match) => match.stage === "GROUP" && match.roundNumber === 1 && match.leg === 1));
    assert.ok(groupRun.matches.every((match) => match.drawVersionId === drawVersionId && match.fixtureKey));

    const knockoutRun = await generateHybridPlayoffSkeleton(tournamentId, drawVersionId, [
      { groupId: groups[0], groupRank: 1 },
      { groupId: groups[1], groupRank: 1 },
      { groupId: groups[0], groupRank: 2 },
      { groupId: groups[1], groupRank: 2 },
    ], actorId, false, 7);
    assert.equal(knockoutRun.length, 3);
    assert.ok(knockoutRun.every((match) => match.stage === "KNOCKOUT" && match.drawVersionId === drawVersionId));

    const before = await listManagedTournamentFixtures(tournamentId);
    assert.deepEqual(new Set(before.stages.map((stage) => stage.stage)), new Set(["GROUP", "KNOCKOUT"]));
    assert.ok(before.stages.every((stage) => stage.regulationVersion === 7 && stage.status === "DRAFT"));

    await assert.rejects(
      publishTournamentFixtureStructure(tournamentId, ["GROUP", "KNOCKOUT"], drawVersionId,
        { GROUP: 2, KNOCKOUT: 4 }, 7, actorId),
      (error) => error.code === "FIXTURE_STRUCTURE_INCOMPLETE",
    );
    const afterRejectedPublish = await listManagedTournamentFixtures(tournamentId);
    assert.ok(afterRejectedPublish.stages.every((stage) => stage.status === "DRAFT"), "failed publish rolls back both phases");

    const published = await publishTournamentFixtureStructure(tournamentId, ["GROUP", "KNOCKOUT"], drawVersionId,
      { GROUP: 2, KNOCKOUT: 3 }, 7, actorId);
    assert.equal(published.length, 2);
    assert.ok(published.every((stage) => stage.status === "PUBLISHED"));
    assert.deepEqual(new Set(published.map((stage) => stage.matchCount)), new Set([2, 3]));
    const retry = await publishTournamentFixtureStructure(tournamentId, ["GROUP", "KNOCKOUT"], drawVersionId,
      { GROUP: 2, KNOCKOUT: 3 }, 7, actorId);
    assert.ok(retry.every((stage) => stage.status === "PUBLISHED"));
    assert.deepEqual(retry.map((stage) => stage.publishedAt), published.map((stage) => stage.publishedAt));
  } finally {
    for (;;) {
      const latestRound = await pool.query("SELECT MAX(round_number) AS round_number FROM match_bracket_slots WHERE tournament_id=$1", [tournamentId]);
      const round = latestRound.rows[0]?.round_number;
      if (round === null || round === undefined) break;
      await pool.query("DELETE FROM match_bracket_slots WHERE tournament_id=$1 AND round_number=$2", [tournamentId, round]);
    }
    await pool.query("DELETE FROM matches WHERE tournament_id=$1", [tournamentId]);
    await pool.query("DELETE FROM match_fixture_generations WHERE tournament_id=$1", [tournamentId]);
    await closePool();
  }
});
