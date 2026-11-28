const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

test("official draft batches preserve locks, metadata and history and publish atomically", {
  skip: process.env.RUN_SCHEDULING_DB_INTEGRATION !== "1",
}, async () => {
  const { getPool, closePool } = require("../dist/scheduling/lib/db");
  const { getPool: getMatchPool, closePool: closeMatchPool } = require("../dist/lib/db");
  const { saveScheduleDraftBatch, publishScheduleBatch, listSchedules, getTournamentScheduleResources, saveTournamentScheduleResources } = require("../dist/scheduling/repositories/schedulingRepository");
  const { assertOfficialSchedulePublicationComplete } = require("../dist/scheduling/services/schedulingService");
  const pool = getPool();
  const matchPool = getMatchPool();
  const databases = await Promise.all([pool.query("SELECT current_database() AS name"), matchPool.query("SELECT current_database() AS name")]);
  assert.ok(databases.every((database) => /step5.*(?:verify|qa)|(?:verify|qa).*step5/i.test(database.rows[0].name)), "This write test requires isolated Step 5 verification databases");
  const tournament = randomUUID();
  const creator = randomUUID();
  const venue = randomUUID();
  const otherTournament = randomUUID();
  const matchIds = [randomUUID(), randomUUID(), randomUUID()];
  const requiredFixtures = matchIds.map((id) => ({ id, stage: "GROUP", round: "Round 1", homeTeamId: null, awayTeamId: null }));
  const assertSavedCoverage = (fixtures) => async () => assertOfficialSchedulePublicationComplete(fixtures, await listSchedules(tournament));
  const at = (hour) => `2026-12-15T${String(hour).padStart(2, "0")}:00:00+07:00`;
  const input = (index, hour, locked = false) => ({ tournamentId: tournament, matchId: matchIds[index], venueId: venue, scheduledDate: at(hour), durationMinutes: 50, notes: `Ghi chú ${index}`, slotId: "morning", locked });
  const initial = [input(0, 8, true), input(1, 10)];
  try {
    assert.equal(await getTournamentScheduleResources(tournament), null);
    assert.equal(await saveTournamentScheduleResources(tournament, { venues: [] }, creator, 0), null, "an absent row requires the null creation token, not context revision zero");
    const firstResources = await saveTournamentScheduleResources(tournament, { venues: [] }, creator, null);
    assert.equal(firstResources.revision, 1);
    assert.equal(await saveTournamentScheduleResources(tournament, { venues: ["stale creation"] }, creator, null), null, "a stale creation request cannot replace existing resources");
    const nextResources = await saveTournamentScheduleResources(tournament, { venues: [], note: "revision two" }, creator, firstResources.revision);
    assert.equal(nextResources.revision, 2);
    assert.equal((await getTournamentScheduleResources(tournament)).resources.note, "revision two");
    await pool.query("INSERT INTO venues(id,name,location) VALUES($1,'Step 5 isolated QA','Temporary verification data')", [venue]);
    for (const id of matchIds) await matchPool.query("INSERT INTO matches(id,tournament_id,status) VALUES($1,$2,'UNSCHEDULED')", [id, tournament]);
    await assert.rejects(publishScheduleBatch(tournament, matchIds, creator, [], assertSavedCoverage(requiredFixtures)), (error) => {
      assert.equal(error.code, "SCHEDULE_FIXTURES_UNSCHEDULED");
      assert.deepEqual(error.details.fixtureIds, matchIds);
      return true;
    });
    await saveScheduleDraftBatch(tournament, initial, creator, [], async () => {});
    let saved = await listSchedules(tournament);
    assert.equal(saved.length, 2);
    await assert.rejects(publishScheduleBatch(tournament, matchIds, creator, [], assertSavedCoverage(requiredFixtures)), (error) => {
      assert.equal(error.code, "SCHEDULE_FIXTURES_UNSCHEDULED");
      assert.deepEqual(error.details.fixtureIds, [matchIds[2]]);
      return true;
    });
    assert.equal((await listSchedules(tournament)).filter((row) => row.status === "PUBLISHED").length, 0, "a partial saved draft must never partially publish");
    const locked = saved.find((row) => row.matchId === matchIds[0]);
    assert.equal(locked.isLocked, true);
    assert.equal(locked.notes, "Ghi chú 0");
    assert.equal(locked.slotId, "morning");
    const originalIds = saved.map((row) => row.id).sort();
    await assert.rejects(saveScheduleDraftBatch(tournament, [{ ...initial[0], scheduledDate: at(12), locked: false }, initial[1]], creator, [], async () => {}), { code: "SCHEDULE_LOCKED" });
    saved = await listSchedules(tournament);
    assert.equal(saved.find((row) => row.id === locked.id).scheduledDate, new Date(at(8)).toISOString());
    assert.equal(saved.find((row) => row.id === locked.id).isLocked, true);
    const unlocked = [{ ...initial[0], locked: false }, initial[1]];
    await saveScheduleDraftBatch(tournament, unlocked, creator, [], async () => {});
    assert.equal((await listSchedules(tournament)).find((row) => row.id === locked.id).isLocked, false);
    await assert.rejects(saveScheduleDraftBatch(tournament, [input(0, 12), initial[1]], creator, [], async () => { throw Object.assign(new Error("stale revision"), { code: "SCHEDULE_REVISION_CONFLICT" }); }), { code: "SCHEDULE_REVISION_CONFLICT" });
    assert.equal((await listSchedules(tournament)).find((row) => row.id === locked.id).scheduledDate, new Date(at(8)).toISOString());
    const unchangedIds = (await listSchedules(tournament)).map((row) => row.id).sort();
    assert.deepEqual(unchangedIds, originalIds);
    await saveScheduleDraftBatch(tournament, [unlocked[0]], creator, [], async () => {});
    saved = await listSchedules(tournament);
    assert.equal(saved.length, 2, "removing a draft cancels its row instead of deleting history");
    assert.equal(saved.find((row) => row.matchId === matchIds[1]).status, "CANCELLED");
    await saveScheduleDraftBatch(tournament, unlocked, creator, [], async () => {});
    await assert.rejects(publishScheduleBatch(tournament, matchIds.slice(0, 2), creator, [], async () => { throw new Error("validation failed"); }), /validation failed/);
    assert.equal((await listSchedules(tournament)).filter((row) => row.status === "PUBLISHED").length, 0, "failed validation must not partially publish");
    const duplicateScheduleId = randomUUID();
    await pool.query("INSERT INTO schedules(id,tournament_id,match_id,venue_id,scheduled_date,duration_minutes,created_by) VALUES($1,$2,$3,$4,$5,50,$6)", [duplicateScheduleId, tournament, matchIds[0], venue, at(16), creator]);
    await assert.rejects(publishScheduleBatch(tournament, matchIds.slice(0, 2), creator, [], assertSavedCoverage(requiredFixtures.slice(0, 2))), { code: "SCHEDULE_DUPLICATE_FIXTURES" });
    await pool.query("DELETE FROM schedules WHERE id=$1", [duplicateScheduleId]);
    assert.equal(await publishScheduleBatch(tournament, matchIds.slice(0, 2), creator, [], assertSavedCoverage(requiredFixtures.slice(0, 2))), 2, "complete unlocked schedules do not require referees or organizer locks to publish");
    assert.equal(await publishScheduleBatch(tournament, matchIds.slice(0, 2), creator, [], assertSavedCoverage(requiredFixtures.slice(0, 2))), 0, "publication is idempotent");
    await assert.rejects(saveScheduleDraftBatch(tournament, [input(0, 12), initial[1]], creator, [], async () => {}), { code: "SCHEDULE_LOCKED" });
    const history = await pool.query("SELECT count(*)::int AS count FROM schedule_change_history WHERE schedule_id IN (SELECT id FROM schedules WHERE tournament_id=$1)", [tournament]);
    assert.ok(history.rows[0].count >= 4);
    await pool.query("INSERT INTO schedules(tournament_id,match_id,venue_id,scheduled_date,duration_minutes,created_by) VALUES($1,$2,$3,$4,50,$5)", [otherTournament, matchIds[2], venue, at(14), creator]);
    await assert.rejects(saveScheduleDraftBatch(tournament, [...unlocked, input(2, 14)], creator, [], async () => {}), { code: "VENUE_CONFLICT" });
  } finally {
    await pool.query("DELETE FROM tournament_schedule_resources WHERE tournament_id=$1", [tournament]);
    await pool.query("DELETE FROM schedules WHERE tournament_id=ANY($1::uuid[])", [[tournament, otherTournament]]);
    await pool.query("DELETE FROM venues WHERE id=$1", [venue]);
    await matchPool.query("DELETE FROM match_realtime_events WHERE match_id=ANY($1::uuid[])", [matchIds]);
    await matchPool.query("DELETE FROM matches WHERE id=ANY($1::uuid[])", [matchIds]);
    await Promise.all([closePool(), closeMatchPool()]);
  }
});
