const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const test = require("node:test");

const enabled = process.env.RUN_TOURNAMENT_DB_INTEGRATION === "1";

async function createFixture(pool, { endOffset = "1 day" } = {}) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO tournaments (id,name,status,scope,football_format,competition_format,min_teams,max_teams,min_players,max_players_per_team,start_date,end_date,created_by)
     VALUES ($1,'Registration control integration fixture','OPEN_REGISTRATION','SINGLE_INSTITUTION',7,'ROUND_ROBIN',4,8,7,18,CURRENT_DATE+30,CURRENT_DATE+32,$2)`,
    [id, randomUUID()],
  );
  await pool.query(
    "INSERT INTO registration_periods (tournament_id,name,start_date,end_date) VALUES ($1,'Integration window',NOW()-INTERVAL '1 day',NOW()+$2::interval)",
    [id, endOffset],
  );
  return id;
}

test("manual close and reopen persist status and audit rows without changing registration reservations", { skip: !enabled }, async () => {
  const { setManualRegistrationStatus } = require("../dist/repositories/tournamentRepository.js");
  const { closePool, getPool } = require("../dist/lib/db.js");
  const pool = getPool();
  const tournamentId = await createFixture(pool);
  const registrationId = randomUUID();
  const teamId = randomUUID();
  try {
    await pool.query("INSERT INTO tournament_registration_reservations(registration_id,tournament_id,team_id,institution_id,status,persisted_in_organization) VALUES($1,$2,$3,$4,'PENDING',TRUE)", [registrationId,tournamentId,teamId,randomUUID()]);
    const actorId = randomUUID();
    const closed = await setManualRegistrationStatus({ tournamentId, actorId, action: "TEST_CLOSE" });
    assert.equal(closed.status, "REGISTRATION_CLOSED");
    const reopened = await setManualRegistrationStatus({ tournamentId, actorId, action: "TEST_REOPEN" });
    assert.equal(reopened.status, "OPEN_REGISTRATION");
    const audit = await pool.query("SELECT action,previous_status,new_status FROM tournament_registration_control_audit WHERE tournament_id=$1 ORDER BY created_at", [tournamentId]);
    assert.deepEqual(audit.rows.map((row) => [row.action,row.previous_status,row.new_status]), [
      ["TEST_CLOSE","OPEN_REGISTRATION","REGISTRATION_CLOSED"],
      ["TEST_REOPEN","REGISTRATION_CLOSED","OPEN_REGISTRATION"],
    ]);
    assert.equal((await pool.query("SELECT status FROM tournament_registration_reservations WHERE registration_id=$1", [registrationId])).rows[0].status, "PENDING");
  } finally {
    await pool.query("DELETE FROM tournament_registration_control_audit WHERE tournament_id=$1", [tournamentId]);
    await pool.query("DELETE FROM tournaments WHERE id=$1", [tournamentId]);
    await closePool();
  }
});

test("test reopen cannot extend or bypass the real registration deadline", { skip: !enabled }, async () => {
  const { setManualRegistrationStatus } = require("../dist/repositories/tournamentRepository.js");
  const { closePool, getPool } = require("../dist/lib/db.js");
  const pool = getPool();
  const tournamentId = await createFixture(pool, { endOffset: "-1 minute" });
  try {
    await pool.query("UPDATE tournaments SET status='REGISTRATION_CLOSED' WHERE id=$1", [tournamentId]);
    await assert.rejects(
      setManualRegistrationStatus({ tournamentId, actorId: randomUUID(), action: "TEST_REOPEN" }),
      (error) => error.code === "REGISTRATION_PERIOD_EXPIRED",
    );
  } finally {
    await pool.query("DELETE FROM tournaments WHERE id=$1", [tournamentId]);
    await closePool();
  }
});

test("expired registration windows are automatically persisted as closed", { skip: !enabled }, async () => {
  const { closeExpiredTournamentRegistrations } = require("../dist/repositories/tournamentRepository.js");
  const { closePool, getPool } = require("../dist/lib/db.js");
  const pool = getPool();
  const tournamentId = await createFixture(pool, { endOffset: "-1 minute" });
  try {
    const changed = await closeExpiredTournamentRegistrations();
    assert.ok(changed >= 1);
    const status = await pool.query("SELECT status FROM tournaments WHERE id=$1", [tournamentId]);
    assert.equal(status.rows[0].status, "REGISTRATION_CLOSED");
  } finally {
    await pool.query("DELETE FROM tournaments WHERE id=$1", [tournamentId]);
    await closePool();
  }
});

test("locking keeps only approved reservations and releases unselected player claims", { skip: !enabled }, async () => {
  const { lockTournamentRosterSnapshot, reserveTournamentInvitationParticipation } = require("../dist/repositories/tournamentRepository.js");
  const { closePool, getPool } = require("../dist/lib/db.js");
  const pool = getPool();
  const tournamentId = await createFixture(pool);
  const approvedRegistrationId = randomUUID();
  const pendingRegistrationId = randomUUID();
  const approvedTeamId = randomUUID();
  const pendingTeamId = randomUUID();
  const institutionId = randomUUID();
  const playerId = randomUUID();
  const invitationId = randomUUID();
  try {
    await pool.query("UPDATE tournaments SET status='REGISTRATION_CLOSED' WHERE id=$1", [tournamentId]);
      await pool.query("UPDATE tournaments SET min_teams=1,max_teams=1 WHERE id=$1", [tournamentId]);
    await pool.query(
      `INSERT INTO tournament_registration_reservations(registration_id,tournament_id,team_id,institution_id,status,persisted_in_organization)
       VALUES($1,$3,$4,$5,'APPROVED',TRUE),($2,$3,$6,$5,'PENDING',TRUE)`,
      [approvedRegistrationId,pendingRegistrationId,tournamentId,approvedTeamId,institutionId,pendingTeamId],
    );
    await pool.query("INSERT INTO tournament_player_participation_reservations(registration_id,tournament_id,player_id) VALUES($1,$2,$3)", [pendingRegistrationId,tournamentId,playerId]);
    await pool.query("INSERT INTO tournament_player_participation_claims(invitation_id,tournament_id,team_id,player_id,state) VALUES($1,$2,$3,$4,'ACTIVE')", [invitationId,tournamentId,pendingTeamId,playerId]);
    await assert.rejects(lockTournamentRosterSnapshot(tournamentId, randomUUID(), []), (error) => error.code === "REGISTRATION_SET_CHANGED");
    await lockTournamentRosterSnapshot(tournamentId, randomUUID(), [{ teamId: approvedTeamId }]);
    assert.equal((await pool.query("SELECT status FROM tournament_registration_reservations WHERE registration_id=$1", [approvedRegistrationId])).rows[0].status, "APPROVED");
    assert.equal((await pool.query("SELECT status FROM tournament_registration_reservations WHERE registration_id=$1", [pendingRegistrationId])).rows[0].status, "REJECTED");
    assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM tournament_player_participation_reservations WHERE registration_id=$1", [pendingRegistrationId])).rows[0].count, 0);
    assert.equal((await pool.query("SELECT state FROM tournament_player_participation_claims WHERE invitation_id=$1", [invitationId])).rows[0].state, "RELEASED");
      // Organization periodically reconciles accepted invitations. A stale
      // accepted invitation for an unselected team must not reclaim its place.
      await reserveTournamentInvitationParticipation({ invitationId, tournamentId, teamId: pendingTeamId, playerId });
      assert.equal((await pool.query("SELECT state FROM tournament_player_participation_claims WHERE invitation_id=$1", [invitationId])).rows[0].state, "RELEASED");
  } finally {
    await pool.query("DELETE FROM tournament_roster_lock_snapshots WHERE tournament_id=$1", [tournamentId]);
    await pool.query("DELETE FROM tournaments WHERE id=$1", [tournamentId]);
    await closePool();
  }
});
