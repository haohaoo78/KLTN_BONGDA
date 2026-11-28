const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const test = require("node:test");

test("approved result correction is rejected without changing official score or standings", {
  skip: process.env.RUN_HYBRID_PLAYOFF_DB_INTEGRATION !== "1",
}, async () => {
  const { getPool, closePool } = require("../dist/lib/db");
  const { recordMatchResultAndRecalculate } = require("../dist/repositories/matchRepository");
  const pool = getPool();
  const tournamentId = randomUUID();
  const matchId = randomUUID();
  const actorId = randomUUID();
  try {
    await pool.query(
      `INSERT INTO matches (id,tournament_id,home_team_id,away_team_id,status)
       VALUES ($1,$2,$3,$4,'VERIFIED')`,
      [matchId, tournamentId, randomUUID(), randomUUID()],
    );
    await pool.query(
      `INSERT INTO match_results (match_id,home_score,away_score,recorded_by,status)
       VALUES ($1,2,1,$2,'APPROVED')`,
      [matchId, actorId],
    );

    await assert.rejects(
      recordMatchResultAndRecalculate({ matchId, homeScore: 0, awayScore: 5 }, actorId),
      (error) => error.code === "RESULT_CORRECTION_REQUEST_REQUIRED",
    );
    const result = await pool.query("SELECT home_score,away_score,status FROM match_results WHERE match_id=$1", [matchId]);
    const match = await pool.query("SELECT status FROM matches WHERE id=$1", [matchId]);
    assert.deepEqual(result.rows[0], { home_score: 2, away_score: 1, status: "APPROVED" });
    assert.equal(match.rows[0].status, "VERIFIED");
  } finally {
    await pool.query("DELETE FROM standings WHERE tournament_id=$1", [tournamentId]);
    await pool.query("DELETE FROM match_results WHERE match_id=$1", [matchId]);
    await pool.query("DELETE FROM matches WHERE tournament_id=$1", [tournamentId]);
    await closePool();
  }
});

test("BTC approval applies an audited result correction atomically", {
  skip: process.env.RUN_HYBRID_PLAYOFF_DB_INTEGRATION !== "1",
}, async () => {
  const { getPool, closePool } = require("../dist/lib/db");
  const { createResultCorrectionRequest, reviewResultCorrectionRequest } = require("../dist/repositories/matchRepository");
  const pool = getPool();
  const tournamentId = randomUUID();
  const matchId = randomUUID();
  const homeTeamId = randomUUID();
  const awayTeamId = randomUUID();
  const refereeId = randomUUID();
  const btcId = randomUUID();
  try {
    await pool.query(
      `INSERT INTO matches (id,tournament_id,home_team_id,away_team_id,status)
       VALUES ($1,$2,$3,$4,'VERIFIED')`,
      [matchId, tournamentId, homeTeamId, awayTeamId],
    );
    await pool.query(
      `INSERT INTO match_results (match_id,home_score,away_score,recorded_by,status)
       VALUES ($1,2,1,$2,'APPROVED')`, [matchId, refereeId],
    );
    const correction = await createResultCorrectionRequest({
      matchId, requestedBy: refereeId, reason: "Sửa tỷ số theo biên bản ký xác nhận.",
      proposal: { homeScore: 3, awayScore: 1, notes: "Đính chính theo biên bản gốc." },
    });
    const decided = await reviewResultCorrectionRequest(correction.id, "APPROVED", btcId, "Đã đối chiếu biên bản giấy.");
    assert.equal(decided.status, "APPROVED");
    const result = await pool.query("SELECT home_score,away_score,status FROM match_results WHERE match_id=$1", [matchId]);
    assert.deepEqual(result.rows[0], { home_score: 3, away_score: 1, status: "APPROVED" });
    const audit = await pool.query("SELECT original_result,proposed_result,reviewed_by FROM match_result_correction_requests WHERE id=$1", [correction.id]);
    assert.equal(audit.rows[0].original_result.homeScore, 2);
    assert.equal(audit.rows[0].proposed_result.homeScore, 3);
    assert.equal(audit.rows[0].reviewed_by, btcId);
  } finally {
    await pool.query("DELETE FROM standings WHERE tournament_id=$1", [tournamentId]);
    await pool.query("DELETE FROM match_result_correction_requests WHERE match_id=$1", [matchId]);
    await pool.query("DELETE FROM match_results WHERE match_id=$1", [matchId]);
    await pool.query("DELETE FROM matches WHERE tournament_id=$1", [tournamentId]);
    await closePool();
  }
});

test("approved knockout correction preserves fixture IDs and audits the rewritten next-round participant", {
  skip: process.env.RUN_HYBRID_PLAYOFF_DB_INTEGRATION !== "1",
}, async () => {
  const { getPool, closePool } = require("../dist/lib/db");
  const { createResultCorrectionRequest, reviewResultCorrectionRequest } = require("../dist/repositories/matchRepository");
  const pool = getPool();
  const tournamentId = randomUUID();
  const drawVersionId = randomUUID();
  const sourceMatchId = randomUUID();
  const nextMatchId = randomUUID();
  const sourceSlotId = randomUUID();
  const otherSourceSlotId = randomUUID();
  const nextSlotId = randomUUID();
  const originalWinnerId = randomUUID();
  const proposedWinnerId = randomUUID();
  const opponentId = randomUUID();
  const refereeId = randomUUID();
  const btcId = randomUUID();
  try {
    await pool.query(
      `INSERT INTO match_fixture_generations (tournament_id,draw_version_id,legs,generated_by,stage)
       VALUES ($1,$2,1,$3,'KNOCKOUT')`, [tournamentId, drawVersionId, btcId],
    );
    await pool.query(
      `INSERT INTO matches (id,tournament_id,home_team_id,away_team_id,status,draw_version_id,fixture_key)
       VALUES ($1,$2,$3,$4,'VERIFIED',$5,'knockout:1:1'),
              ($6,$2,$3,$7,'UNSCHEDULED',$5,'knockout:2:1')`,
      [sourceMatchId, tournamentId, originalWinnerId, proposedWinnerId, drawVersionId, nextMatchId, opponentId],
    );
    await pool.query(
      `INSERT INTO match_bracket_slots
        (id,tournament_id,draw_version_id,round_number,position,home_team_id,away_team_id,winner_team_id,match_id,status,home_resolved,away_resolved)
       VALUES ($1,$2,$3,1,1,$4,$5,$4,$6,'COMPLETED',TRUE,TRUE),
              ($7,$2,$3,1,2,$8,$9,$8,NULL,'COMPLETED',TRUE,TRUE),
              ($10,$2,$3,2,1,$4,$11,NULL,$12,'READY',TRUE,TRUE)`,
      [sourceSlotId, tournamentId, drawVersionId, originalWinnerId, proposedWinnerId, sourceMatchId,
        otherSourceSlotId, opponentId, randomUUID(), nextSlotId, opponentId, nextMatchId],
    );
    await pool.query(
      `UPDATE match_bracket_slots SET home_source_slot_id=$2, away_source_slot_id=$3 WHERE id=$1`,
      [nextSlotId, sourceSlotId, otherSourceSlotId],
    );
    await pool.query(
      `INSERT INTO match_results (match_id,home_score,away_score,recorded_by,status)
       VALUES ($1,2,1,$2,'APPROVED')`, [sourceMatchId, refereeId],
    );
    const correction = await createResultCorrectionRequest({
      matchId: sourceMatchId, requestedBy: refereeId, reason: "Biên bản gốc xác nhận đội khách thắng trận.",
      proposal: { homeScore: 1, awayScore: 3, notes: "Đối chiếu biên bản trọng tài đã ký." },
    });
    const decided = await reviewResultCorrectionRequest(correction.id, "APPROVED", btcId, "Đã kiểm tra hồ sơ gốc.");
    assert.equal(decided.status, "APPROVED");
    assert.deepEqual(decided.cascadeSnapshot, [{
      matchId: nextMatchId, previousHomeTeamId: originalWinnerId, previousAwayTeamId: opponentId,
      nextHomeTeamId: proposedWinnerId, nextAwayTeamId: opponentId,
    }]);
    const [source, next, slot] = await Promise.all([
      pool.query("SELECT home_score,away_score FROM match_results WHERE match_id=$1", [sourceMatchId]),
      pool.query("SELECT id,home_team_id,away_team_id,status FROM matches WHERE id=$1", [nextMatchId]),
      pool.query("SELECT match_id,home_team_id,away_team_id,winner_team_id,status FROM match_bracket_slots WHERE id=$1", [nextSlotId]),
    ]);
    assert.deepEqual(source.rows[0], { home_score: 1, away_score: 3 });
    assert.equal(next.rows[0].id, nextMatchId);
    assert.equal(next.rows[0].home_team_id, proposedWinnerId);
    assert.equal(next.rows[0].away_team_id, opponentId);
    assert.equal(next.rows[0].status, "UNSCHEDULED");
    assert.equal(slot.rows[0].match_id, nextMatchId);
    assert.equal(slot.rows[0].home_team_id, proposedWinnerId);
    assert.equal(slot.rows[0].winner_team_id, null);
  } finally {
    await pool.query("DELETE FROM match_realtime_events WHERE match_id IN ($1,$2)", [sourceMatchId, nextMatchId]);
    await pool.query("DELETE FROM match_result_correction_requests WHERE match_id=$1", [sourceMatchId]);
    await pool.query("DELETE FROM match_results WHERE match_id=$1", [sourceMatchId]);
    await pool.query("DELETE FROM match_bracket_slots WHERE draw_version_id=$1 AND round_number > 1", [drawVersionId]);
    await pool.query("DELETE FROM match_bracket_slots WHERE draw_version_id=$1", [drawVersionId]);
    await pool.query("DELETE FROM matches WHERE tournament_id=$1", [tournamentId]);
    await pool.query("DELETE FROM match_fixture_generations WHERE tournament_id=$1", [tournamentId]);
    await closePool();
  }
});

test("knockout correction refuses to rewrite a dependent fixture that already has a schedule", {
  skip: process.env.RUN_HYBRID_PLAYOFF_DB_INTEGRATION !== "1",
}, async () => {
  const { getPool, closePool } = require("../dist/lib/db");
  const { createResultCorrectionRequest, reviewResultCorrectionRequest } = require("../dist/repositories/matchRepository");
  const pool = getPool();
  const tournamentId = randomUUID();
  const drawVersionId = randomUUID();
  const sourceMatchId = randomUUID();
  const nextMatchId = randomUUID();
  const sourceSlotId = randomUUID();
  const otherSourceSlotId = randomUUID();
  const nextSlotId = randomUUID();
  const homeTeamId = randomUUID();
  const awayTeamId = randomUUID();
  const opponentId = randomUUID();
  const refereeId = randomUUID();
  const btcId = randomUUID();
  try {
    await pool.query(
      `INSERT INTO match_fixture_generations (tournament_id,draw_version_id,legs,generated_by,stage)
       VALUES ($1,$2,1,$3,'KNOCKOUT')`, [tournamentId, drawVersionId, btcId],
    );
    await pool.query(
      `INSERT INTO matches (id,tournament_id,home_team_id,away_team_id,status,draw_version_id,fixture_key,match_date)
       VALUES ($1,$2,$3,$4,'VERIFIED',$5,'knockout:1:1',NULL),
              ($6,$2,$3,$7,'SCHEDULED',$5,'knockout:2:1',NOW()+INTERVAL '1 day')`,
      [sourceMatchId, tournamentId, homeTeamId, awayTeamId, drawVersionId, nextMatchId, opponentId],
    );
    await pool.query(
      `INSERT INTO match_bracket_slots
        (id,tournament_id,draw_version_id,round_number,position,home_team_id,away_team_id,winner_team_id,match_id,status,home_resolved,away_resolved)
       VALUES ($1,$2,$3,1,1,$4,$5,$4,$6,'COMPLETED',TRUE,TRUE),
              ($7,$2,$3,1,2,$8,$9,$8,NULL,'COMPLETED',TRUE,TRUE),
              ($10,$2,$3,2,1,$4,$11,NULL,$12,'READY',TRUE,TRUE)`,
      [sourceSlotId, tournamentId, drawVersionId, homeTeamId, awayTeamId, sourceMatchId,
        otherSourceSlotId, opponentId, randomUUID(), nextSlotId, opponentId, nextMatchId],
    );
    await pool.query("UPDATE match_bracket_slots SET home_source_slot_id=$2,away_source_slot_id=$3 WHERE id=$1", [nextSlotId, sourceSlotId, otherSourceSlotId]);
    await pool.query(`INSERT INTO match_results (match_id,home_score,away_score,recorded_by,status) VALUES ($1,2,1,$2,'APPROVED')`, [sourceMatchId, refereeId]);
    const correction = await createResultCorrectionRequest({
      matchId: sourceMatchId, requestedBy: refereeId, reason: "Sai sót biên bản cần thay đổi đội thắng.",
      proposal: { homeScore: 0, awayScore: 1 },
    });
    await assert.rejects(
      reviewResultCorrectionRequest(correction.id, "APPROVED", btcId, "Xác nhận sau khi kiểm tra."),
      (error) => error.code === "CORRECTION_CASCADE_REQUIRES_RESCHEDULE",
    );
    const result = await pool.query("SELECT home_score,away_score FROM match_results WHERE match_id=$1", [sourceMatchId]);
    const request = await pool.query("SELECT status FROM match_result_correction_requests WHERE id=$1", [correction.id]);
    assert.deepEqual(result.rows[0], { home_score: 2, away_score: 1 });
    assert.equal(request.rows[0].status, "PENDING");
  } finally {
    await pool.query("DELETE FROM match_result_correction_requests WHERE match_id=$1", [sourceMatchId]);
    await pool.query("DELETE FROM match_results WHERE match_id=$1", [sourceMatchId]);
    await pool.query("DELETE FROM match_bracket_slots WHERE draw_version_id=$1 AND round_number > 1", [drawVersionId]);
    await pool.query("DELETE FROM match_bracket_slots WHERE draw_version_id=$1", [drawVersionId]);
    await pool.query("DELETE FROM matches WHERE tournament_id=$1", [tournamentId]);
    await pool.query("DELETE FROM match_fixture_generations WHERE tournament_id=$1", [tournamentId]);
    await closePool();
  }
});
