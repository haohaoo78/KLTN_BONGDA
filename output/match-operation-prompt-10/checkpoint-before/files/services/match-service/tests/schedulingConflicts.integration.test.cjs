const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const test = require("node:test");

const integrationEnabled = process.env.RUN_SCHEDULING_DB_INTEGRATION === "1";

test("schedule writes serialize venue bookings and enforce team rest in PostgreSQL", {
  skip: !integrationEnabled,
}, async () => {
  const { getPool: getMatchPool, closePool: closeMatchPool } = require("../dist/lib/db");
  const { getPool: getSchedulingPool, closePool: closeSchedulingPool } = require("../dist/scheduling/lib/db");
  const { createSchedule } = require("../dist/scheduling/repositories/schedulingRepository");
  const matchPool = getMatchPool();
  const schedulingPool = getSchedulingPool();
  const client = await schedulingPool.connect();
  const ids = {
    tournament: randomUUID(),
    matchA: randomUUID(),
    matchB: randomUUID(),
    matchC: randomUUID(),
    matchD: randomUUID(),
    teamA: randomUUID(),
    teamB: randomUUID(),
    teamC: randomUUID(),
    teamD: randomUUID(),
    teamE: randomUUID(),
    venueA: randomUUID(),
    venueB: randomUUID(),
    creator: randomUUID(),
  };
  const createdScheduleIds = [];
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const at = (offsetMinutes) => new Date(start.getTime() + offsetMinutes * 60_000).toISOString();

  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO venues (id, name, location) VALUES
       ($1, 'QA schedule venue A', 'Temporary integration fixture'),
       ($2, 'QA schedule venue B', 'Temporary integration fixture')`,
      [ids.venueA, ids.venueB],
    );
    await matchPool.query(
      `INSERT INTO matches (id, tournament_id, home_team_id, away_team_id, status) VALUES
       ($1, $4, $5, $6, 'SCHEDULED'),
       ($2, $4, $5, $7, 'SCHEDULED'),
       ($3, $4, $8, $9, 'SCHEDULED'),
       ($10, $4, $5, $11, 'SCHEDULED')`,
      [ids.matchA, ids.matchB, ids.matchC, ids.tournament, ids.teamA, ids.teamB, ids.teamC,
        ids.teamC, ids.teamD, ids.matchD, ids.teamE],
    );
    await client.query("COMMIT");

    const validateTeams = (input, excludeScheduleId, minimumRestMinutes) => async () => {
      const candidateStart = new Date(input.scheduledDate).getTime();
      const candidateEnd = candidateStart + (input.durationMinutes ?? 90) * 60_000;
      const schedules = await schedulingPool.query(
        "SELECT id, match_id, scheduled_date, duration_minutes, status FROM schedules WHERE tournament_id = $1",
        [ids.tournament],
      );
      for (const schedule of schedules.rows) {
        if (schedule.id === excludeScheduleId || schedule.status === "CANCELLED" || schedule.match_id === input.matchId) continue;
        const match = await matchPool.query("SELECT home_team_id, away_team_id FROM matches WHERE id = $1", [schedule.match_id]);
        if (!match.rowCount) continue;
        const other = match.rows[0];
        const sharesTeam = [other.home_team_id, other.away_team_id].some((teamId) =>
          teamId === input.teamIds[0] || teamId === input.teamIds[1]);
        if (!sharesTeam) continue;
        const otherStart = new Date(schedule.scheduled_date).getTime();
        const otherEnd = otherStart + schedule.duration_minutes * 60_000;
        const gap = candidateStart >= otherStart ? candidateStart - otherEnd : otherStart - candidateEnd;
        if (gap < minimumRestMinutes * 60_000) {
          throw Object.assign(new Error("A team needs minimum rest between matches"), { code: "TEAM_REST_CONFLICT" });
        }
      }
    };
    const sameVenueGuard = (teamIds) => ({ teamIds, refereeIds: [], minimumRestMinutes: 0 });
    const concurrent = await Promise.allSettled([
      createSchedule({ tournamentId: ids.tournament, matchId: ids.matchA, venueId: ids.venueA, scheduledDate: at(0), durationMinutes: 60 }, ids.creator, sameVenueGuard([ids.teamA, ids.teamB]), validateTeams({ matchId: ids.matchA, scheduledDate: at(0), durationMinutes: 60, teamIds: [ids.teamA, ids.teamB] }, undefined, 0)),
      createSchedule({ tournamentId: ids.tournament, matchId: ids.matchC, venueId: ids.venueA, scheduledDate: at(0), durationMinutes: 60 }, ids.creator, sameVenueGuard([ids.teamC, ids.teamD]), validateTeams({ matchId: ids.matchC, scheduledDate: at(0), durationMinutes: 60, teamIds: [ids.teamC, ids.teamD] }, undefined, 0)),
    ]);
    const successful = concurrent.filter((result) => result.status === "fulfilled");
    const rejected = concurrent.filter((result) => result.status === "rejected");
    assert.equal(successful.length, 1, "only one concurrent booking can hold a venue slot");
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].reason.code, "VENUE_CONFLICT");
    createdScheduleIds.push(successful[0].value.id);

    const baseForTeamRest = await createSchedule({
      tournamentId: ids.tournament,
      matchId: ids.matchB,
      venueId: ids.venueB,
      scheduledDate: at(240),
      durationMinutes: 60,
    }, ids.creator, { teamIds: [ids.teamA, ids.teamC], refereeIds: [], minimumRestMinutes: 60 }, validateTeams({ matchId: ids.matchB, scheduledDate: at(240), durationMinutes: 60, teamIds: [ids.teamA, ids.teamC] }, undefined, 60));
    createdScheduleIds.push(baseForTeamRest.id);

    await assert.rejects(
      createSchedule({
        tournamentId: ids.tournament,
        matchId: ids.matchD,
        venueId: ids.venueA,
        scheduledDate: at(330),
        durationMinutes: 60,
      }, ids.creator, { teamIds: [ids.teamA, ids.teamE], refereeIds: [], minimumRestMinutes: 60 }, validateTeams({ matchId: ids.matchD, scheduledDate: at(330), durationMinutes: 60, teamIds: [ids.teamA, ids.teamE] }, undefined, 60)),
      { code: "TEAM_REST_CONFLICT" },
    );
  } finally {
    const cleanup = await schedulingPool.connect();
    try {
      await cleanup.query("BEGIN");
      if (createdScheduleIds.length) {
        await cleanup.query("DELETE FROM schedules WHERE id = ANY($1::uuid[])", [createdScheduleIds]);
      }
      await cleanup.query("DELETE FROM schedules WHERE tournament_id = $1", [ids.tournament]);
      await cleanup.query("DELETE FROM venues WHERE id = ANY($1::uuid[])", [[ids.venueA, ids.venueB]]);
      await cleanup.query("COMMIT");
    } catch (cleanupError) {
      await cleanup.query("ROLLBACK");
      throw cleanupError;
    } finally {
      cleanup.release();
    }
    await matchPool.query("DELETE FROM matches WHERE tournament_id = $1", [ids.tournament]);
    client.release();
    await Promise.all([closeMatchPool(), closeSchedulingPool()]);
  }
});
