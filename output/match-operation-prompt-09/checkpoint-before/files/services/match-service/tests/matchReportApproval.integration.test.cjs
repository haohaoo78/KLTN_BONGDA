const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const test = require("node:test");

test("ordinary referee report finalizes immediately; exceptional report stays pending for BTC", {
  skip: process.env.RUN_MATCH_REPORT_DB_INTEGRATION !== "1",
}, async () => {
  const { getPool, closePool } = require("../dist/lib/db");
  const { submitMatchReport, reviewMatchReport } = require("../dist/services/lineupService");
  const pool = getPool();
  const tournamentId = randomUUID();
  const teamIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const refereeId = randomUUID();
  const btcId = randomUUID();
  const matchIds = [randomUUID(), randomUUID()];

  try {
    await pool.query(
      `INSERT INTO matches (id, tournament_id, home_team_id, away_team_id, status) VALUES
       ($1, $3, $4, $5, 'FINISHED'),
       ($2, $3, $6, $7, 'FINISHED')`,
      [matchIds[0], matchIds[1], tournamentId, teamIds[0], teamIds[1], teamIds[2], teamIds[3]],
    );
    await pool.query(
      `INSERT INTO match_results (match_id, home_score, away_score, recorded_by, status) VALUES
       ($1, 2, 0, $3, 'PENDING'),
       ($2, 1, 1, $3, 'PENDING')`,
      [matchIds[0], matchIds[1], refereeId],
    );

    const submitted = await submitMatchReport({ matchId: matchIds[0], refereeId, homeScoreAtHalfTime: 1, awayScoreAtHalfTime: 0 }, refereeId);
    assert.equal(submitted.status, "APPROVED");
    assert.equal(submitted.verifiedBy, refereeId);
    let state = await pool.query(
      `SELECT m.status AS match_status, r.status AS result_status,
              (SELECT COUNT(*) FROM standings WHERE tournament_id = $1) AS standing_count
       FROM matches m JOIN match_results r ON r.match_id = m.id WHERE m.id = $2`,
      [tournamentId, matchIds[0]],
    );
    assert.deepEqual(state.rows[0], { match_status: "VERIFIED", result_status: "APPROVED", standing_count: "2" });

    const submittedForRevision = await submitMatchReport({ matchId: matchIds[1], refereeId, requiresOrganizerReview: true }, refereeId);
    assert.equal(submittedForRevision.status, "PENDING");
    await reviewMatchReport(submittedForRevision.id, {
      status: "REVISION_REQUIRED", verifiedBy: btcId, reviewNote: "Vui lòng bổ sung biên bản.",
    });
    state = await pool.query(
      `SELECT m.status AS match_status, r.status AS result_status,
              (SELECT COUNT(*) FROM standings WHERE tournament_id = $1) AS standing_count
       FROM matches m JOIN match_results r ON r.match_id = m.id WHERE m.id = $2`,
      [tournamentId, matchIds[1]],
    );
    assert.deepEqual(state.rows[0], { match_status: "FINISHED", result_status: "PENDING", standing_count: "2" });
  } finally {
    await pool.query("DELETE FROM matches WHERE id = ANY($1::uuid[])", [matchIds]);
    await pool.query("DELETE FROM standings WHERE tournament_id = $1", [tournamentId]);
    await closePool();
  }
});

test("knockout winner advances after both final-authority referees confirm their results", {
  skip: process.env.RUN_MATCH_REPORT_DB_INTEGRATION !== "1",
}, async () => {
  const { getPool, closePool } = require("../dist/lib/db");
  const { submitMatchReport } = require("../dist/services/lineupService");
  const pool = getPool();
  const tournamentId = randomUUID();
  const drawVersionId = randomUUID();
  const teams = Array.from({ length: 4 }, () => randomUUID());
  const matches = [randomUUID(), randomUUID(), randomUUID()];
  const slots = [randomUUID(), randomUUID(), randomUUID()];
  const refereeId = randomUUID();
  try {
    await pool.query(
      `INSERT INTO match_fixture_generations (tournament_id, draw_version_id, legs, generated_by) VALUES ($1,$2,1,$3)`,
      [tournamentId, drawVersionId, refereeId],
    );
    await pool.query(
      `INSERT INTO matches (id,tournament_id,home_team_id,away_team_id,status,draw_version_id,fixture_key) VALUES
       ($1,$3,$4,$5,'FINISHED',$7,'knockout:1:1'),($2,$3,$6,$8,'FINISHED',$7,'knockout:1:2'),
       ($9,$3,NULL,NULL,'UNSCHEDULED',$7,'knockout:2:1')`,
      [matches[0], matches[1], tournamentId, teams[0], teams[1], teams[2], drawVersionId, teams[3], matches[2]],
    );
    await pool.query(
      `INSERT INTO match_results (match_id,home_score,away_score,home_penalty_score,away_penalty_score,recorded_by,status) VALUES
       ($1,2,1,NULL,NULL,$3,'PENDING'),($2,1,1,4,3,$3,'PENDING')`,
      [matches[0], matches[1], refereeId],
    );
    await pool.query(
      `INSERT INTO match_bracket_slots (id,tournament_id,draw_version_id,round_number,position,home_team_id,away_team_id,home_resolved,away_resolved,status,match_id,home_source_slot_id,away_source_slot_id) VALUES
       ($1,$4,$5,1,1,$6,$7,TRUE,TRUE,'READY',$8,NULL,NULL),
       ($2,$4,$5,1,2,$9,$10,TRUE,TRUE,'READY',$11,NULL,NULL),
       ($3,$4,$5,2,1,NULL,NULL,FALSE,FALSE,'WAITING',$12,$1,$2)`,
      [slots[0], slots[1], slots[2], tournamentId, drawVersionId, teams[0], teams[1], matches[0], teams[2], teams[3], matches[1], matches[2]],
    );
    const firstReport = await submitMatchReport({ matchId: matches[0], refereeId }, refereeId);
    assert.equal(firstReport.status, "APPROVED");
    let finalState = await pool.query("SELECT home_team_id, away_team_id, status, match_id FROM match_bracket_slots WHERE id=$1", [slots[2]]);
    assert.deepEqual(finalState.rows[0], { home_team_id: teams[0], away_team_id: null, status: "WAITING", match_id: matches[2] });

    const secondReport = await submitMatchReport({ matchId: matches[1], refereeId }, refereeId);
    assert.equal(secondReport.status, "APPROVED");
    finalState = await pool.query("SELECT home_team_id, away_team_id, status, match_id FROM match_bracket_slots WHERE id=$1", [slots[2]]);
    assert.equal(finalState.rows[0].home_team_id, teams[0]);
    assert.equal(finalState.rows[0].away_team_id, teams[2]);
    assert.equal(finalState.rows[0].status, "READY");
    assert.ok(finalState.rows[0].match_id);
    const finalMatch = await pool.query("SELECT home_team_id, away_team_id, status FROM matches WHERE id=$1", [finalState.rows[0].match_id]);
    assert.deepEqual(finalMatch.rows[0], { home_team_id: teams[0], away_team_id: teams[2], status: "UNSCHEDULED" });
  } finally {
    await pool.query("DELETE FROM match_bracket_slots WHERE tournament_id=$1 AND round_number=2", [tournamentId]);
    await pool.query("DELETE FROM match_bracket_slots WHERE tournament_id=$1", [tournamentId]);
    await pool.query("DELETE FROM matches WHERE tournament_id=$1", [tournamentId]);
    await pool.query("DELETE FROM match_fixture_generations WHERE tournament_id=$1", [tournamentId]);
    await closePool();
  }
});
