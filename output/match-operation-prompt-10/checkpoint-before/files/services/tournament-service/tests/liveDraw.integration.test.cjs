const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const test = require("node:test");

const enabled = process.env.RUN_TOURNAMENT_DB_INTEGRATION === "1";

test("live draw schedule, concurrent/idempotent picks and final publication are persisted atomically", { skip: !enabled }, async () => {
  const { getPool, closePool } = require("../dist/lib/db.js");
  const { createLiveDrawSession, startScheduledLiveDraw, advanceLiveDraw } = require("../dist/repositories/liveDrawRepository.js");
  const pool = getPool();
  const tournamentId = randomUUID();
  const actorId = randomUUID();
  const teamIds = [randomUUID(), randomUUID()];
  let sessionId;
  try {
    await pool.query(
      `INSERT INTO tournaments (id,name,status,scope,football_format,competition_format,min_teams,max_teams,min_players,max_players_per_team,created_by)
       VALUES ($1,'Live draw integration fixture','ROSTER_LOCKED','INTER_SCHOOL',7,'ROUND_ROBIN',2,8,7,18,$2)`,
      [tournamentId, actorId],
    );
    await pool.query("INSERT INTO tournament_rules (tournament_id,published_version,published_at,published_by) VALUES ($1,1,NOW(),$2)", [tournamentId, actorId]);
    for (const teamId of teamIds) {
      await pool.query(
        `INSERT INTO tournament_registration_reservations (registration_id,tournament_id,team_id,institution_id,status,persisted_in_organization)
         VALUES ($1,$2,$3,$4,'APPROVED',TRUE)`,
        [randomUUID(), tournamentId, teamId, randomUUID()],
      );
    }
    const scheduledAt = new Date(Date.now() + 500).toISOString();
    const group = {
      name: "Bảng A", maxTeams: 2,
      assignments: teamIds.map((teamId, index) => ({ teamId, position: index + 1, seedGroup: null })),
    };
    const state = await createLiveDrawSession(tournamentId, actorId, "RANDOM", {
      groups: [group],
      drawOrder: teamIds.map((teamId, index) => ({ groupIndex: 0, groupName: "Bảng A", teamId, position: index + 1, seedGroup: null })),
    }, { eventName: "Integration ceremony", scheduledAt, timeZone: "Asia/Ho_Chi_Minh", announcement: "" });
    sessionId = state.sessionId;
    assert.equal(state.status, "SCHEDULED");
    assert.equal(state.picks.length, 0, "unrevealed plan must not be part of the public/session snapshot");

    await new Promise((resolve) => setTimeout(resolve, 600));
    const live = await startScheduledLiveDraw(tournamentId, actorId);
    assert.equal(live.status, "LIVE");

    const firstRequest = await advanceLiveDraw(tournamentId, 0, actorId, "live-draw-pick-1");
    assert.equal(firstRequest.state.revealedCount, 1);
    const replay = await advanceLiveDraw(tournamentId, 0, actorId, "live-draw-pick-1");
    assert.equal(replay.idempotentReplay, true);
    assert.equal(replay.state.picks.length, 1, "replay must not create another pick");

    const simultaneous = await Promise.allSettled([
      advanceLiveDraw(tournamentId, 1, actorId, "live-draw-pick-2a"),
      advanceLiveDraw(tournamentId, 1, actorId, "live-draw-pick-2b"),
    ]);
    assert.equal(simultaneous.filter((result) => result.status === "fulfilled").length, 1);
    const final = simultaneous.find((result) => result.status === "fulfilled").value;
    assert.equal(final.state.status, "FINALIZED");
    assert.equal(final.draw.status, "PUBLISHED");
    assert.equal(final.draw.groups.reduce((sum, item) => sum + item.assignments.length, 0), 2);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM tournament_live_draw_picks WHERE session_id=$1", [sessionId])).rows[0].count, 2);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM tournament_live_draw_events WHERE session_id=$1 AND event_type='PUBLISHED'", [sessionId])).rows[0].count, 1);
  } finally {
    if (sessionId) await pool.query("DELETE FROM tournament_draw_assignments WHERE draw_version_id IN (SELECT id FROM tournament_draw_versions WHERE tournament_id=$1)", [tournamentId]);
    if (sessionId) await pool.query("DELETE FROM tournament_draw_groups WHERE draw_version_id IN (SELECT id FROM tournament_draw_versions WHERE tournament_id=$1)", [tournamentId]);
    await pool.query("DELETE FROM tournament_draw_versions WHERE tournament_id=$1", [tournamentId]);
    await pool.query("DELETE FROM tournaments WHERE id=$1", [tournamentId]);
    await closePool();
  }
});
