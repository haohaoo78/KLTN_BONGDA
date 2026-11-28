const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const test = require("node:test");

test("hybrid draw reserves playoff Match IDs and resolves qualifiers into the same slots", {
  skip: process.env.RUN_HYBRID_PLAYOFF_DB_INTEGRATION !== "1",
}, async () => {
  const { getPool, closePool } = require("../dist/lib/db");
  const { generateHybridPlayoffSkeleton, generateKnockoutFixtures, listManagedKnockoutBracket } = require("../dist/repositories/matchRepository");
  const pool = getPool();
  const tournamentId = randomUUID();
  const drawVersionId = randomUUID();
  const generatedBy = randomUUID();
  const groups = [randomUUID(), randomUUID()];
  const teams = [randomUUID(), randomUUID()];
  try {
    const skeleton = await generateHybridPlayoffSkeleton(tournamentId, drawVersionId,
      groups.map((groupId) => ({ groupId, groupRank: 1 })), generatedBy);
    assert.equal(skeleton.length, 1);
    assert.ok(skeleton[0].id);
    assert.equal(skeleton[0].status, "UNSCHEDULED");
    assert.equal(skeleton[0].homeTeamId, null);
    assert.equal(skeleton[0].awayTeamId, null);

    const before = await listManagedKnockoutBracket(tournamentId);
    assert.equal(before.length, 1);
    assert.deepEqual(new Set([before[0].homeQualification.groupId, before[0].awayQualification.groupId]), new Set(groups));
    assert.equal(before[0].matchId, skeleton[0].id);
    assert.equal(before[0].status, "WAITING");

    const resolved = await generateKnockoutFixtures(tournamentId, drawVersionId, teams, generatedBy, true,
      teams.map((teamId, index) => ({ teamId, groupId: groups[index], groupRank: 1 })));
    assert.equal(resolved.alreadyGenerated, false);
    assert.equal(resolved.matches.length, 1);
    assert.equal(resolved.matches[0].id, skeleton[0].id);
    assert.deepEqual(new Set([resolved.matches[0].homeTeamId, resolved.matches[0].awayTeamId]), new Set(teams));
    const after = await listManagedKnockoutBracket(tournamentId);
    assert.equal(after[0].status, "READY");
    assert.equal(after[0].matchId, skeleton[0].id);
    assert.deepEqual(new Set([after[0].homeTeamId, after[0].awayTeamId]), new Set(teams));
  } finally {
    await pool.query("DELETE FROM match_bracket_slots WHERE tournament_id=$1", [tournamentId]);
    await pool.query("DELETE FROM matches WHERE tournament_id=$1", [tournamentId]);
    await pool.query("DELETE FROM match_fixture_generations WHERE tournament_id=$1", [tournamentId]);
    await closePool();
  }
});

test("hybrid playoff snapshots qualifiers and can be retried without duplicate bracket matches", {
  skip: process.env.RUN_HYBRID_PLAYOFF_DB_INTEGRATION !== "1",
}, async () => {
  const { getPool, closePool } = require("../dist/lib/db");
  const { getGroupStageFixtures, generateKnockoutFixtures } = require("../dist/repositories/matchRepository");
  const { rankHybridGroup } = require("../dist/services/hybridQualification");
  const pool = getPool();
  const tournamentId = randomUUID();
  const drawVersionId = randomUUID();
  const groups = [randomUUID(), randomUUID()];
  const teams = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const fixtures = [randomUUID(), randomUUID()];
  const actorId = randomUUID();
  try {
    await pool.query(
      `INSERT INTO match_fixture_generations (tournament_id,draw_version_id,legs,generated_by,stage)
       VALUES ($1,$2,1,$3,'GROUP')`, [tournamentId, drawVersionId, actorId],
    );
    await pool.query(
      `INSERT INTO matches (id,tournament_id,home_team_id,away_team_id,status,draw_version_id,fixture_key,group_id) VALUES
       ($1,$3,$4,$5,'VERIFIED',$7,'group-a-fixture',$8),($2,$3,$6,$9,'VERIFIED',$7,'group-b-fixture',$10)`,
      [fixtures[0], fixtures[1], tournamentId, teams[0], teams[1], teams[2], drawVersionId, groups[0], teams[3], groups[1]],
    );
    await pool.query(
      `INSERT INTO match_results (match_id,home_score,away_score,recorded_by,status) VALUES
       ($1,2,0,$3,'APPROVED'),($2,1,0,$3,'APPROVED')`, [fixtures[0], fixtures[1], actorId],
    );

    const qualifiers = [];
    for (let index = 0; index < groups.length; index += 1) {
      const stage = await getGroupStageFixtures(tournamentId, drawVersionId, groups[index]);
      const ranked = rankHybridGroup({
        groupId: groups[index], fixtures: stage.fixtures, advancingTeamsPerGroup: 1,
        rankingCriteria: ["POINTS", "GOAL_DIFFERENCE", "GOALS_FOR"],
        pointsForWin: 3, pointsForDraw: 1, pointsForLoss: 0,
      });
      qualifiers.push({ teamId: ranked[0].teamId, groupId: groups[index], groupRank: 1 });
    }
    const firstRun = await generateKnockoutFixtures(tournamentId, drawVersionId, qualifiers.map((item) => item.teamId), actorId, true, qualifiers);
    assert.equal(firstRun.alreadyGenerated, false);
    assert.equal(firstRun.matches.length, 1);
    const secondRun = await generateKnockoutFixtures(tournamentId, drawVersionId, qualifiers.map((item) => item.teamId), actorId, true, qualifiers);
    assert.equal(secondRun.alreadyGenerated, true);
    assert.equal(secondRun.matches.length, 1);
    const savedQualifications = await pool.query(
      "SELECT team_id,group_id,group_rank FROM match_knockout_qualifications WHERE tournament_id=$1 AND draw_version_id=$2 ORDER BY group_id",
      [tournamentId, drawVersionId],
    );
    assert.equal(savedQualifications.rowCount, 2);
  } finally {
    await pool.query("DELETE FROM match_bracket_slots WHERE tournament_id=$1", [tournamentId]);
    await pool.query("DELETE FROM match_knockout_qualifications WHERE tournament_id=$1", [tournamentId]);
    await pool.query("DELETE FROM matches WHERE tournament_id=$1", [tournamentId]);
    await pool.query("DELETE FROM match_fixture_generations WHERE tournament_id=$1", [tournamentId]);
    await closePool();
  }
});

for (const teamCount of [5, 6, 7, 8, 10, 12, 16]) {
  test(`hybrid PostgreSQL workflow creates a persisted playoff for ${teamCount} qualified teams`, {
    skip: process.env.RUN_HYBRID_PLAYOFF_DB_INTEGRATION !== "1",
  }, async () => {
    const { getPool, closePool } = require("../dist/lib/db");
    const { getGroupStageFixtures, generateKnockoutFixtures } = require("../dist/repositories/matchRepository");
    const { rankHybridGroup } = require("../dist/services/hybridQualification");
    const pool = getPool();
    const tournamentId = randomUUID();
    const drawVersionId = randomUUID();
    const groupId = randomUUID();
    const actorId = randomUUID();
    const teams = Array.from({ length: teamCount }, () => randomUUID());
    const fixtureIds = [];
    try {
      await pool.query(
        `INSERT INTO match_fixture_generations (tournament_id,draw_version_id,legs,generated_by,stage)
         VALUES ($1,$2,1,$3,'GROUP')`, [tournamentId, drawVersionId, actorId],
      );
      for (let home = 0; home < teamCount; home += 1) {
        for (let away = home + 1; away < teamCount; away += 1) {
          const matchId = randomUUID();
          fixtureIds.push(matchId);
          await pool.query(
            `INSERT INTO matches (id,tournament_id,home_team_id,away_team_id,status,draw_version_id,fixture_key,group_id)
             VALUES ($1,$2,$3,$4,'VERIFIED',$5,$6,$7)`,
            [matchId, tournamentId, teams[home], teams[away], drawVersionId, `round-robin:${home}:${away}`, groupId],
          );
          await pool.query(
            `INSERT INTO match_results (match_id,home_score,away_score,recorded_by,status)
             VALUES ($1,1,0,$2,'APPROVED')`, [matchId, actorId],
          );
        }
      }

      const stage = await getGroupStageFixtures(tournamentId, drawVersionId, groupId);
      assert.equal(stage.fixtures.length, teamCount * (teamCount - 1) / 2);
      const ranked = rankHybridGroup({
        groupId,
        fixtures: stage.fixtures,
        advancingTeamsPerGroup: teamCount,
        rankingCriteria: ["POINTS"],
        pointsForWin: 3,
        pointsForDraw: 1,
        pointsForLoss: 0,
      });
      const qualifications = ranked.map(({ teamId, groupRank }) => ({ teamId, groupId, groupRank }));
      assert.equal(new Set(qualifications.map(({ teamId }) => teamId)).size, teamCount);
      assert.deepEqual(qualifications.map(({ groupRank }) => groupRank), Array.from({ length: teamCount }, (_, index) => index + 1));

      const run = await generateKnockoutFixtures(
        tournamentId,
        drawVersionId,
        qualifications.map(({ teamId }) => teamId),
        actorId,
        true,
        qualifications,
      );
      const bracket = await pool.query(
        `SELECT round_number, status, winner_team_id, match_id FROM match_bracket_slots
         WHERE tournament_id=$1 AND draw_version_id=$2 ORDER BY round_number,position`,
        [tournamentId, drawVersionId],
      );
      const size = 2 ** Math.ceil(Math.log2(teamCount));
      assert.equal(bracket.rowCount, size - 1);
      assert.equal(bracket.rows.filter((slot) => slot.round_number === 1 && slot.status === "COMPLETED" && slot.match_id === null).length, size - teamCount);
      assert.equal(run.matches.length, await pool.query("SELECT id FROM matches WHERE tournament_id=$1 AND draw_version_id=$2 AND fixture_key LIKE 'knockout:%'", [tournamentId, drawVersionId]).then((result) => result.rowCount));

      const retry = await generateKnockoutFixtures(
        tournamentId,
        drawVersionId,
        qualifications.map(({ teamId }) => teamId),
        actorId,
        true,
        qualifications,
      );
      assert.equal(retry.alreadyGenerated, true);
      assert.equal(retry.matches.length, run.matches.length);
      const savedQualifications = await pool.query(
        "SELECT team_id,group_rank FROM match_knockout_qualifications WHERE tournament_id=$1 AND draw_version_id=$2",
        [tournamentId, drawVersionId],
      );
      assert.equal(savedQualifications.rowCount, teamCount);
      assert.equal(fixtureIds.length, teamCount * (teamCount - 1) / 2);
    } finally {
      await pool.query("DELETE FROM match_bracket_slots WHERE tournament_id=$1", [tournamentId]);
      await pool.query("DELETE FROM match_knockout_qualifications WHERE tournament_id=$1", [tournamentId]);
      await pool.query("DELETE FROM matches WHERE tournament_id=$1", [tournamentId]);
      await pool.query("DELETE FROM match_fixture_generations WHERE tournament_id=$1", [tournamentId]);
      await closePool();
    }
  });
}

test("multi-group hybrid playoff interleaves qualifiers and persists witnessed lot-draw minutes", {
  skip: process.env.RUN_HYBRID_PLAYOFF_DB_INTEGRATION !== "1",
}, async () => {
  const { getPool, closePool } = require("../dist/lib/db");
  const { generateKnockoutFixtures } = require("../dist/repositories/matchRepository");
  const { rankHybridGroup, selectHybridQualifiers } = require("../dist/services/hybridQualification");
  const pool = getPool();
  const tournamentId = randomUUID();
  const drawVersionId = randomUUID();
  const actorId = randomUUID();
  const groups = [randomUUID(), randomUUID()];
  const teamsByGroup = [
    [randomUUID(), randomUUID()],
    [randomUUID(), randomUUID()],
  ];
  try {
    await pool.query(
      `INSERT INTO match_fixture_generations (tournament_id,draw_version_id,legs,generated_by,stage)
       VALUES ($1,$2,1,$3,'GROUP')`, [tournamentId, drawVersionId, actorId],
    );
    for (let index = 0; index < groups.length; index += 1) {
      const matchId = randomUUID();
      await pool.query(
        `INSERT INTO matches (id,tournament_id,home_team_id,away_team_id,status,draw_version_id,fixture_key,group_id)
         VALUES ($1,$2,$3,$4,'VERIFIED',$5,$6,$7)`,
        [matchId, tournamentId, teamsByGroup[index][0], teamsByGroup[index][1], drawVersionId, `lot-tie:${index}`, groups[index]],
      );
      await pool.query(
        `INSERT INTO match_results (match_id,home_score,away_score,recorded_by,status)
         VALUES ($1,0,0,$2,'APPROVED')`, [matchId, actorId],
      );
    }

    const standings = groups.map((groupId, index) => rankHybridGroup({
      groupId,
      fixtures: [{ homeTeamId: teamsByGroup[index][0], awayTeamId: teamsByGroup[index][1], homeScore: 0, awayScore: 0, status: "VERIFIED", resultStatus: "APPROVED" }],
      advancingTeamsPerGroup: 1,
      rankingCriteria: ["POINTS", "LOT_DRAW"],
      pointsForWin: 3,
      pointsForDraw: 1,
      pointsForLoss: 0,
      lotDrawResolutions: [{
        tiedTeamIds: teamsByGroup[index],
        drawnOrder: [...teamsByGroup[index]].reverse(),
        witnessName: `Người chứng kiến ${index + 1}`,
        reason: `Biên bản bốc thăm bảng ${index + 1} sau khi hoàn thành vòng bảng.`,
      }],
    }));
    const qualifiers = selectHybridQualifiers(standings, 1);
    assert.deepEqual(qualifiers.map(({ teamId }) => teamId), [teamsByGroup[0][1], teamsByGroup[1][1]]);
    const qualificationRows = qualifiers.map(({ teamId, groupId, groupRank }) => ({ teamId, groupId, groupRank }));
    const auditRows = groups.map((groupId, index) => ({
      groupId,
      tiedTeamIds: teamsByGroup[index],
      drawnOrder: [...teamsByGroup[index]].reverse(),
      witnessName: `Người chứng kiến ${index + 1}`,
      reason: `Biên bản bốc thăm bảng ${index + 1} sau khi hoàn thành vòng bảng.`,
    }));
    const generated = await generateKnockoutFixtures(
      tournamentId, drawVersionId, qualifiers.map(({ teamId }) => teamId), actorId, true, qualificationRows, auditRows,
    );
    assert.equal(generated.matches.length, 1);

    const savedAudits = await pool.query(
      `SELECT group_id, tied_team_ids, drawn_order, witness_name, reason, drawn_by
       FROM match_group_lot_draws WHERE tournament_id=$1 AND draw_version_id=$2 ORDER BY group_id`,
      [tournamentId, drawVersionId],
    );
    assert.equal(savedAudits.rowCount, 2);
    assert.ok(savedAudits.rows.every((row) => row.witness_name.startsWith("Người chứng kiến ") && row.reason.includes("Biên bản bốc thăm") && row.drawn_by === actorId));
  } finally {
    await pool.query("DELETE FROM match_group_lot_draws WHERE tournament_id=$1", [tournamentId]);
    await pool.query("DELETE FROM match_bracket_slots WHERE tournament_id=$1", [tournamentId]);
    await pool.query("DELETE FROM match_knockout_qualifications WHERE tournament_id=$1", [tournamentId]);
    await pool.query("DELETE FROM matches WHERE tournament_id=$1", [tournamentId]);
    await pool.query("DELETE FROM match_fixture_generations WHERE tournament_id=$1", [tournamentId]);
    await closePool();
  }
});

test("multi-group playoff qualification selects one advancing team per group in seed order", {
  skip: process.env.RUN_HYBRID_PLAYOFF_DB_INTEGRATION !== "1",
}, async () => {
  const { getPool, closePool } = require("../dist/lib/db");
  const { generateKnockoutFixtures } = require("../dist/repositories/matchRepository");
  const { rankHybridGroup, selectHybridQualifiers } = require("../dist/services/hybridQualification");
  const pool = getPool();
  const tournamentId = randomUUID();
  const drawVersionId = randomUUID();
  const actorId = randomUUID();
  const groups = [randomUUID(), randomUUID()];
  const teams = [[randomUUID(), randomUUID(), randomUUID()], [randomUUID(), randomUUID(), randomUUID()]];
  try {
    await pool.query(
      `INSERT INTO match_fixture_generations (tournament_id,draw_version_id,legs,generated_by,stage)
       VALUES ($1,$2,1,$3,'GROUP')`, [tournamentId, drawVersionId, actorId],
    );
    const standings = [];
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      const fixtures = [];
      for (let home = 0; home < teams[groupIndex].length; home += 1) {
        for (let away = home + 1; away < teams[groupIndex].length; away += 1) {
          const matchId = randomUUID();
          await pool.query(
            `INSERT INTO matches (id,tournament_id,home_team_id,away_team_id,status,draw_version_id,fixture_key,group_id)
             VALUES ($1,$2,$3,$4,'VERIFIED',$5,$6,$7)`,
            [matchId, tournamentId, teams[groupIndex][home], teams[groupIndex][away], drawVersionId, `multi:${groupIndex}:${home}:${away}`, groups[groupIndex]],
          );
          await pool.query(
            `INSERT INTO match_results (match_id,home_score,away_score,recorded_by,status)
             VALUES ($1,1,0,$2,'APPROVED')`, [matchId, actorId],
          );
          fixtures.push({ homeTeamId: teams[groupIndex][home], awayTeamId: teams[groupIndex][away], homeScore: 1, awayScore: 0, status: "VERIFIED", resultStatus: "APPROVED" });
        }
      }
      standings.push(rankHybridGroup({
        groupId: groups[groupIndex], fixtures, advancingTeamsPerGroup: 2,
        rankingCriteria: ["POINTS", "GOAL_DIFFERENCE", "GOALS_FOR"],
        pointsForWin: 3, pointsForDraw: 1, pointsForLoss: 0,
      }));
    }
    const selected = selectHybridQualifiers(standings, 2);
    assert.deepEqual(selected.map(({ groupId, groupRank }) => [groupId, groupRank]), [
      [groups[0], 1], [groups[1], 1], [groups[0], 2], [groups[1], 2],
    ]);
    const qualifications = selected.map(({ teamId, groupId, groupRank }) => ({ teamId, groupId, groupRank }));
    const result = await generateKnockoutFixtures(
      tournamentId, drawVersionId, qualifications.map(({ teamId }) => teamId), actorId, true, qualifications,
    );
    assert.equal(result.matches.length, 3, "four qualified teams require three playoff matches");
    const saved = await pool.query(
      `SELECT team_id, group_id, group_rank FROM match_knockout_qualifications
       WHERE tournament_id=$1 AND draw_version_id=$2 ORDER BY group_id, group_rank`,
      [tournamentId, drawVersionId],
    );
    assert.equal(saved.rowCount, 4);
    for (const groupId of groups) {
      assert.deepEqual(saved.rows.filter((row) => row.group_id === groupId).map((row) => Number(row.group_rank)), [1, 2]);
    }
  } finally {
    await pool.query("DELETE FROM match_group_lot_draws WHERE tournament_id=$1", [tournamentId]);
    await pool.query("DELETE FROM match_bracket_slots WHERE tournament_id=$1", [tournamentId]);
    await pool.query("DELETE FROM match_knockout_qualifications WHERE tournament_id=$1", [tournamentId]);
    await pool.query("DELETE FROM matches WHERE tournament_id=$1", [tournamentId]);
    await pool.query("DELETE FROM match_fixture_generations WHERE tournament_id=$1", [tournamentId]);
    await closePool();
  }
});
