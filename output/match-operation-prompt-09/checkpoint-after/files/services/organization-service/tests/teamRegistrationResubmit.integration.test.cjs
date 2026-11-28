const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const test = require("node:test");
const { resubmitTeamRegistration } = require("../dist/repositories/teamRepository");
const { listRosters } = require("../dist/repositories/institutionRepository");
const { closePool, getPool } = require("../dist/lib/db");

test("resubmission replaces the team snapshot in one transaction without per-player BTC approval", {
  skip: process.env.RUN_ORG_DB_INTEGRATION !== "1",
}, async () => {
  const pool = getPool();
  assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name, "sfl_team");
  const teamId = randomUUID(); const captainId = randomUUID(); const playerId = randomUUID();
  const userId = randomUUID(); const tournamentId = randomUUID(); const registrationId = randomUUID();
  try {
    await pool.query("INSERT INTO teams (id,name,captain_id) VALUES ($1,'Resubmit integration team',$2)", [teamId,captainId]);
    await pool.query("INSERT INTO players (id,team_id,user_id,full_name,student_id) VALUES ($1,$2,$3,'Snapshot player','SFL-RESUBMIT-TEST')", [playerId,teamId,userId]);
    await pool.query("INSERT INTO team_registrations (id,team_id,tournament_id,status,notes,submission_sequence,submitted_at) VALUES ($1,$2,$3,'REVISION_REQUIRED','Replace invalid player',1,NOW())", [registrationId,teamId,tournamentId]);
    const original = (await pool.query("SELECT submission_sequence,submitted_at FROM team_registrations WHERE id=$1", [registrationId])).rows[0];
    const registration = await resubmitTeamRegistration(registrationId,captainId,[{
      playerId,lineupRole:"STARTER",isGoalkeeper:true,competitionRole:"PLAYING_CAPTAIN",jerseyNumber:1,position:"GK",
      playerName:"Snapshot player",studentId:"SFL-RESUBMIT-TEST",
    }]);
    assert.equal(registration.status,"PENDING");
    assert.equal(registration.submissionSequence, Number(original.submission_sequence));
    assert.equal(new Date(registration.submittedAt).toISOString(), new Date(original.submitted_at).toISOString());
    assert.ok(registration.supplementCompletedAt);
    const rows = await pool.query("SELECT version,status,submitted_roster FROM team_registrations WHERE id=$1",[registrationId]);
    assert.equal(rows.rows[0].version,2);
    assert.equal(rows.rows[0].status,"PENDING");
    const history = await pool.query("SELECT action FROM team_registration_versions WHERE registration_id=$1",[registrationId]);
    assert.deepEqual(history.rows.map((item) => item.action),["RESUBMITTED"]);
    const roster = await listRosters(tournamentId,teamId);
    assert.equal(roster.length,1);
    assert.equal(roster[0].competitionRole,"PLAYING_CAPTAIN");
    assert.equal(roster[0].isVerified,false);
    assert.equal(roster[0].reviewStatus,"PENDING");
    assert.equal(roster[0].jerseyNumberSnapshot,1);
  } finally {
    await pool.query("DELETE FROM teams WHERE id=$1",[teamId]);
    await closePool();
  }
});
