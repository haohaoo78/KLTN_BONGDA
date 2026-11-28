const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const test = require("node:test");

test("card events create discipline records and event correction retracts linked red-card suspension", {
  skip: process.env.RUN_MATCH_EVENT_DISCIPLINE_DB_INTEGRATION !== "1",
}, async () => {
  const { getPool: getMatchPool, closePool: closeMatchPool } = require("../dist/lib/db");
  const { getPool: getDisciplinePool, closePool: closeDisciplinePool } = require("../dist/discipline/lib/db");
  const { createMatchEvent, deleteMatchEvent } = require("../dist/repositories/lineupRepository");
  const { processMatchEventDisciplineOutbox } = require("../dist/discipline/services/matchEventDisciplineOutbox");
  const matchPool = getMatchPool();
  const disciplinePool = getDisciplinePool();
  const ids = {
    match: randomUUID(), tournament: randomUUID(), home: randomUUID(), away: randomUUID(),
    player: randomUUID(), referee: randomUUID(),
  };
  let eventId;
  let cardId;

  try {
    await matchPool.query(
      `INSERT INTO matches (id, tournament_id, home_team_id, away_team_id, status)
       VALUES ($1, $2, $3, $4, 'IN_PROGRESS')`,
      [ids.match, ids.tournament, ids.home, ids.away],
    );
    await matchPool.query(
      `INSERT INTO match_clock_states (match_id, phase, elapsed_seconds, total_elapsed_seconds, is_running, started_at)
       VALUES ($1, 'FIRST_HALF', 0, 0, TRUE, NOW())`,
      [ids.match],
    );
    await matchPool.query(
      `INSERT INTO lineups (match_id, team_id, player_id) VALUES ($1, $2, $3)`,
      [ids.match, ids.home, ids.player],
    );
    const event = await createMatchEvent({
      matchId: ids.match, teamId: ids.home, playerId: ids.player,
      eventType: "RED_CARD", minute: 70, description: "Hành vi bạo lực",
    }, ids.referee);
    eventId = event.id;
    await processMatchEventDisciplineOutbox();

    let card = await disciplinePool.query(
      `SELECT id, card_type, voided_at FROM cards WHERE source_event_id = $1`, [eventId],
    );
    assert.equal(card.rowCount, 1);
    assert.equal(card.rows[0].card_type, "RED");
    assert.equal(card.rows[0].voided_at, null);
    cardId = card.rows[0].id;
    let suspension = await disciplinePool.query(
      `SELECT is_active FROM suspensions WHERE source_card_id = $1`, [cardId],
    );
    assert.equal(suspension.rowCount, 1);
    assert.equal(suspension.rows[0].is_active, true);

    await matchPool.query(
      `UPDATE match_event_discipline_outbox SET processed_at = NULL, available_at = NOW() WHERE event_id = $1 AND action = 'ISSUE_CARD'`,
      [eventId],
    );
    await processMatchEventDisciplineOutbox();
    card = await disciplinePool.query(`SELECT COUNT(*)::integer AS count FROM cards WHERE source_event_id = $1`, [eventId]);
    suspension = await disciplinePool.query(`SELECT COUNT(*)::integer AS count FROM suspensions WHERE source_card_id = $1`, [cardId]);
    assert.equal(card.rows[0].count, 1, "outbox redelivery must not duplicate the card");
    assert.equal(suspension.rows[0].count, 1, "outbox redelivery must not duplicate its suspension");

    await deleteMatchEvent(eventId, ids.referee, "Đính chính thẻ sau khi kiểm tra video");
    await processMatchEventDisciplineOutbox();
    card = await disciplinePool.query(`SELECT voided_at FROM cards WHERE id = $1`, [cardId]);
    assert.ok(card.rows[0].voided_at);
    suspension = await disciplinePool.query(`SELECT is_active FROM suspensions WHERE source_card_id = $1`, [cardId]);
    assert.equal(suspension.rows[0].is_active, false);
  } finally {
    if (eventId) await matchPool.query("DELETE FROM match_event_discipline_outbox WHERE event_id = $1", [eventId]);
    await matchPool.query("DELETE FROM matches WHERE id = $1", [ids.match]);
    if (cardId) {
      await disciplinePool.query("DELETE FROM suspensions WHERE source_card_id = $1", [cardId]);
      await disciplinePool.query("DELETE FROM cards WHERE id = $1", [cardId]);
    } else if (eventId) {
      await disciplinePool.query("DELETE FROM suspensions WHERE source_card_id IN (SELECT id FROM cards WHERE source_event_id = $1)", [eventId]);
      await disciplinePool.query("DELETE FROM cards WHERE source_event_id = $1", [eventId]);
    }
    await Promise.all([closeMatchPool(), closeDisciplinePool()]);
  }
});
