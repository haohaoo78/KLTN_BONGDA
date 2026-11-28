const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

test("official referee team persists unique profiles, scoped membership, access outcomes and actual assignment counts", {
  skip: process.env.RUN_REFEREE_TEAM_DB_INTEGRATION !== "1",
}, async () => {
  const { getPool, closePool } = require("../dist/scheduling/lib/db");
  const repository = require("../dist/scheduling/repositories/refereeTeamRepository");
  const { emptyRefereeTeamProfile } = require("../dist/scheduling/services/refereeTeamValidation");
  const pool = getPool();
  const current = await pool.query("SELECT current_database() AS name");
  assert.match(current.rows[0].name, /step6.*(?:verify|qa)|(?:verify|qa).*step6/i, "Write tests require a dedicated Step 6 verification database");
  const tournamentId = randomUUID();
  const otherTournamentId = randomUUID();
  const userId = randomUUID();
  const actorId = randomUUID();
  const requestId = randomUUID();
  const venueId = randomUUID();
  const scheduleIds = [randomUUID(), randomUUID(), randomUUID()];
  const profile = { ...emptyRefereeTeamProfile(), organization: "Isolated QA school", formats: [7], level: "CITY", positions: ["REFEREE"], unavailablePeriods: [{ id: randomUUID(), startAt: "2026-12-02T08:00", endAt: "2026-12-02T10:00", reason: "QA" }] };
  try {
    assert.deepEqual(await repository.listRefereeTeamMembers(tournamentId), []);
    const first = await repository.addRefereeTeamMember(tournamentId, userId, profile, actorId, requestId);
    assert.equal(first.created, true);
    const repeat = await repository.addRefereeTeamMember(tournamentId, userId, profile, actorId, requestId);
    assert.equal(repeat.created, false);
    assert.equal(repeat.memberId, first.memberId);
    await assert.rejects(repository.addRefereeTeamMember(tournamentId, userId, profile, actorId, randomUUID()), { code: "REFEREE_ALREADY_IN_TEAM" });
    await assert.rejects(repository.addRefereeTeamMember(tournamentId, randomUUID(), profile, actorId, requestId), { code: "REFEREE_REQUEST_REUSED" });
    const second = await repository.addRefereeTeamMember(otherTournamentId, userId, emptyRefereeTeamProfile(), actorId, randomUUID());
    assert.notEqual(second.memberId, first.memberId);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM referee_profiles WHERE user_id=$1", [userId])).rows[0].count, 1, "one global profile per Auth account");
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM tournament_referee_team WHERE tournament_id=ANY($1::uuid[])", [[tournamentId, otherTournamentId]])).rows[0].count, 2);
    assert.equal(await repository.findRefereeTeamMember(otherTournamentId, first.memberId), null, "a member cannot be addressed through another tournament");
    const event = await repository.claimRefereeAccessEmailEvent(tournamentId, requestId);
    assert.ok(event);
    assert.equal(await repository.claimRefereeAccessEmailEvent(tournamentId, requestId), null, "a claimed event cannot dispatch twice");
    await repository.finishRefereeAccessEmailEvent(event.id, { status: "FAILED", errorCode: "SMTP_DELIVERY_FAILED" });
    let saved = await repository.findRefereeTeamMember(tournamentId, first.memberId);
    assert.equal(saved.accessEmail.status, "FAILED");
    assert.equal(saved.userId, userId, "SMTP failure cannot remove membership");
    assert.deepEqual(saved.profile, profile);
    assert.equal(await repository.claimRefereeAccessEmailEvent(tournamentId, requestId), null, "failed events require a new explicit resend action");
    const resendId = randomUUID();
    await repository.createRefereeAccessEmailEvent(tournamentId, first.memberId, actorId, resendId);
    await repository.createRefereeAccessEmailEvent(tournamentId, first.memberId, actorId, resendId);
    await assert.rejects(repository.createRefereeAccessEmailEvent(tournamentId, first.memberId, actorId, requestId), { code: "REFEREE_REQUEST_REUSED" });
    const resend = await repository.claimRefereeAccessEmailEvent(tournamentId, resendId);
    assert.ok(resend);
    assert.notEqual(resend.eventKey, event.eventKey);
    await repository.finishRefereeAccessEmailEvent(resend.id, { status: "SENT", sentAt: "2026-11-25T01:00:00Z" });
    assert.equal((await repository.findRefereeTeamMember(tournamentId, first.memberId)).accessEmail.status, "SENT");
    const changed = { ...profile, level: "NATIONAL", notes: "Updated tournament qualification" };
    assert.equal(await repository.updateRefereeTeamProfile(tournamentId, first.memberId, changed), true);
    assert.deepEqual((await repository.findRefereeTeamMember(tournamentId, first.memberId)).profile, changed);
    assert.equal((await repository.findRefereeTeamMember(otherTournamentId, second.memberId)).profile.level, "UNVERIFIED", "advanced edits are local to the tournament");
    await pool.query("INSERT INTO venues(id,name,location) VALUES($1,'Referee team isolated QA','Temporary isolated verification data')", [venueId]);
    for (let index = 0; index < scheduleIds.length; index++) {
      await pool.query("INSERT INTO schedules(id,tournament_id,match_id,venue_id,referee_id,scheduled_date,duration_minutes,status,created_by) VALUES($1,$2,$3,$4,$5,$6,50,$7,$8)", [scheduleIds[index], tournamentId, randomUUID(), venueId, index === 0 ? userId : null, `2026-12-0${index + 1}T08:00:00+07:00`, index === 2 ? "CANCELLED" : "PUBLISHED", actorId]);
      await pool.query("INSERT INTO schedule_referee_assignments(schedule_id,referee_id,position,is_final_authority,assigned_by) VALUES($1,$2,'REFEREE',TRUE,$3)", [scheduleIds[index], userId, actorId]);
    }
    saved = await repository.findRefereeTeamMember(tournamentId, first.memberId);
    assert.equal(saved.assignmentCount, 2, "count distinct real matches; do not double count legacy referee plus crew or cancelled schedules");
    assert.equal((await repository.findRefereeTeamMember(otherTournamentId, second.memberId)).assignmentCount, 0);
  } finally {
    await pool.query("DELETE FROM schedules WHERE id=ANY($1::uuid[])", [scheduleIds]);
    await pool.query("DELETE FROM venues WHERE id=$1", [venueId]);
    await pool.query("DELETE FROM referee_team_access_emails WHERE tournament_id=ANY($1::uuid[])", [[tournamentId, otherTournamentId]]);
    await pool.query("DELETE FROM tournament_referee_team WHERE tournament_id=ANY($1::uuid[])", [[tournamentId, otherTournamentId]]);
    await pool.query("DELETE FROM referee_profiles WHERE user_id=$1", [userId]);
    await closePool();
  }
});
