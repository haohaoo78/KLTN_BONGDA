const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const test = require("node:test");

test("serializes overlapping invitation confirmations and releases claims", { skip: process.env.RUN_TOURNAMENT_DB_INTEGRATION !== "1" }, async () => {
  const { reserveTournamentInvitationParticipation, releaseTournamentInvitationParticipation, listUnavailableTournamentPlayerIds } = require("../dist/repositories/tournamentRepository");
  const { closePool, getPool } = require("../dist/lib/db");
  const pool = getPool();
  const db = await pool.query("SELECT current_database() AS name");
  assert.equal(db.rows[0].name, "sfl_tournament", "integration test must run only against tournament DB");
  const playerId = randomUUID();
  const teamA = randomUUID();
  const teamB = randomUUID();
  const tournamentA = randomUUID();
  const tournamentB = randomUUID();
  const tournamentC = randomUUID();
  const invitationA = randomUUID();
  const invitationB = randomUUID();
  const invitationC = randomUUID();
  try {
    for (const [id, name, start, end] of [
      [tournamentA, "Overlap A", "2040-06-01", "2040-06-10"],
      [tournamentB, "Overlap B", "2040-06-10", "2040-06-15"],
      [tournamentC, "Separate C", "2040-06-16", "2040-06-20"],
    ]) {
      await pool.query("INSERT INTO tournaments (id,name,status,max_teams,min_teams,start_date,end_date,created_by) VALUES ($1,$2,'OPEN_REGISTRATION',8,2,$3,$4,$5)", [id,name,start,end,randomUUID()]);
    }
    const outcomes = await Promise.allSettled([
      reserveTournamentInvitationParticipation({ invitationId: invitationA, tournamentId: tournamentA, teamId: teamA, playerId }),
      reserveTournamentInvitationParticipation({ invitationId: invitationB, tournamentId: tournamentB, teamId: teamB, playerId }),
    ]);
    assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal(outcomes.filter((item) => item.status === "rejected" && item.reason.code === "PLAYER_TOURNAMENT_DATE_CONFLICT").length, 1);
    const winner = outcomes[0].status === "fulfilled" ? { invitationId: invitationA, teamId: teamA, tournamentId: tournamentA } : { invitationId: invitationB, teamId: teamB, tournamentId: tournamentB };
    const overlappingTournament = winner.tournamentId === tournamentA ? tournamentB : tournamentA;
    assert.deepEqual(await listUnavailableTournamentPlayerIds(overlappingTournament, randomUUID(), [playerId]), [playerId], "a confirmed invitation claim blocks selection in an overlapping tournament before BTC approval");
    assert.deepEqual(await listUnavailableTournamentPlayerIds(tournamentC, randomUUID(), [playerId]), []);
    await reserveTournamentInvitationParticipation({ invitationId: invitationC, tournamentId: tournamentC, teamId: teamB, playerId });
    assert.deepEqual(await listUnavailableTournamentPlayerIds(winner.tournamentId, randomUUID(), [playerId]), [playerId]);
    await releaseTournamentInvitationParticipation(winner.invitationId);
    await releaseTournamentInvitationParticipation(invitationC);
    assert.deepEqual(await listUnavailableTournamentPlayerIds(winner.tournamentId, randomUUID(), [playerId]), []);
  } finally {
    await pool.query("DELETE FROM tournaments WHERE id=ANY($1::uuid[])", [[tournamentA,tournamentB,tournamentC]]);
    await closePool();
  }
});
