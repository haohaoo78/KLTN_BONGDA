const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const test = require("node:test");

for (const count of [3, 5, 6, 7, 9, 10, 12]) {
  test(`published positions and hybrid ${count} entrants skip empty branches without fake matches`, {
    skip: process.env.RUN_PRECREATED_BRACKET_DB_INTEGRATION !== "1",
  }, async () => {
    const { getPool, closePool } = require("../dist/lib/db");
    const { generateKnockoutFixtures, generateHybridPlayoffSkeleton, listManagedKnockoutBracket, publishTournamentFixtureStructure } = require("../dist/repositories/matchRepository");
    const pool = getPool();
    const actor = randomUUID();
    const tournamentIds = [];
    try {
      for (const hybrid of [false, true]) {
        const tournamentId = randomUUID(), drawId = randomUUID();
        tournamentIds.push(tournamentId);
        const teams = Array.from({ length: count }, () => randomUUID());
        const qualifications = teams.map((teamId) => ({ teamId, groupId: randomUUID(), groupRank: 1 }));
        const result = hybrid
          ? await generateHybridPlayoffSkeleton(tournamentId, drawId, qualifications, actor, false, 7)
          : (await generateKnockoutFixtures(tournamentId, drawId, teams, actor, false, [], [], false, 7,
            teams.map((teamId, index) => ({ teamId, position: index + 1 })))).matches;
        assert.equal(result.length, count - 1);
        const ids = result.map((match) => match.id).sort();
        const repeated = hybrid
          ? await generateHybridPlayoffSkeleton(tournamentId, drawId, qualifications, actor, false, 7)
          : (await generateKnockoutFixtures(tournamentId, drawId, teams, actor, false, [], [], false, 7,
            teams.map((teamId, index) => ({ teamId, position: index + 1 })))).matches;
        assert.deepEqual(repeated.map((match) => match.id).sort(), ids);
        const publications = await publishTournamentFixtureStructure(tournamentId, ["KNOCKOUT"], drawId, { KNOCKOUT: count - 1 }, 7, actor);
        assert.equal(publications[0].matchCount, count - 1);
        if (hybrid) {
          const resolved = await generateKnockoutFixtures(tournamentId, drawId, teams, actor, true, qualifications, [], false, 7);
          assert.deepEqual(resolved.matches.map((match) => match.id).sort(), ids);
          assert.ok(resolved.matches.every((match) => match.status === "UNSCHEDULED"));
        }
        const bracket = await listManagedKnockoutBracket(tournamentId);
        for (const slot of bracket.filter((slot) => slot.matchId && slot.roundNumber === 1)) assert.ok(slot.homeTeamId && slot.awayTeamId);
        assert.ok(bracket.filter((slot) => slot.matchId).every((slot) => slot.winnerTeamId === null));
      }
    } finally {
      for (const tournamentId of tournamentIds) {
        const rounds = await pool.query("SELECT DISTINCT round_number FROM match_bracket_slots WHERE tournament_id=$1 ORDER BY round_number DESC", [tournamentId]);
        for (const { round_number } of rounds.rows) await pool.query("DELETE FROM match_bracket_slots WHERE tournament_id=$1 AND round_number=$2", [tournamentId, round_number]);
        await pool.query("DELETE FROM matches WHERE tournament_id=$1", [tournamentId]);
        await pool.query("DELETE FROM match_fixture_generations WHERE tournament_id=$1", [tournamentId]);
      }
      await closePool();
    }
  });
}

test("knockout generation persists schedulable future rounds without fake team IDs", {
  skip: process.env.RUN_PRECREATED_BRACKET_DB_INTEGRATION !== "1",
}, async () => {
  const { getPool, closePool } = require("../dist/lib/db");
  const { generateKnockoutFixtures, listManagedKnockoutBracket, getKnockoutMatchPossibleEntrants } = require("../dist/repositories/matchRepository");
  const pool = getPool();
  const tournamentId = randomUUID();
  const drawVersionId = randomUUID();
  const actorId = randomUUID();
  const teamIds = Array.from({ length: 5 }, () => randomUUID());
  try {
    const generated = await generateKnockoutFixtures(tournamentId, drawVersionId, teamIds, actorId);
    assert.equal(generated.matches.length, teamIds.length - 1);
    assert.ok(generated.matches.some((match) => match.homeTeamId === null || match.awayTeamId === null));

    const bracket = await listManagedKnockoutBracket(tournamentId);
    assert.equal(bracket.length, 7);
    const scheduledFutureMatches = bracket.filter((slot) => slot.roundNumber > 1 && slot.matchId);
    assert.equal(scheduledFutureMatches.length, 3);
    assert.ok(scheduledFutureMatches.some((slot) => slot.status === "WAITING" && !slot.homeTeamId && !slot.awayTeamId));

    const final = scheduledFutureMatches.find((slot) => slot.roundNumber === 3);
    assert.ok(final?.matchId);
    const possibleTeams = await getKnockoutMatchPossibleEntrants(final.matchId);
    assert.deepEqual(new Set(possibleTeams), new Set(teamIds));
  } finally {
    const rounds = await pool.query("SELECT DISTINCT round_number FROM match_bracket_slots WHERE tournament_id=$1 ORDER BY round_number DESC", [tournamentId]);
    for (const { round_number: round } of rounds.rows) {
      await pool.query("DELETE FROM match_bracket_slots WHERE tournament_id=$1 AND round_number=$2", [tournamentId, round]);
    }
    await pool.query("DELETE FROM matches WHERE tournament_id=$1", [tournamentId]);
    await pool.query("DELETE FROM match_fixture_generations WHERE tournament_id=$1", [tournamentId]);
    await closePool();
  }
});
