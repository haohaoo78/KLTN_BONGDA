const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const test = require("node:test");

const enabled = process.env.RUN_TOURNAMENT_DB_INTEGRATION === "1";

async function createFixture(pool, { maxTeams, schoolCap = null } = {}) {
  const id = randomUUID();
  const createdBy = randomUUID();
  await pool.query(
    `INSERT INTO tournaments (id,name,status,max_teams,min_teams,min_players,max_players_per_team,start_date,end_date,created_by,default_max_teams_per_institution)
     VALUES ($1,'FIFO quota integration fixture','OPEN_REGISTRATION',$2,1,7,25,CURRENT_DATE+30,CURRENT_DATE+32,$3,$4)`,
    [id, maxTeams, createdBy, schoolCap],
  );
  await pool.query(
    "INSERT INTO registration_periods (tournament_id,name,start_date,end_date) VALUES ($1,'FIFO test window',NOW()-INTERVAL '1 minute',NOW()+INTERVAL '1 day')",
    [id],
  );
  return id;
}

function eligibleRoster() {
  return Array.from({ length: 7 }, (_, index) => ({
    playerId: randomUUID(), lineupRole: "STARTER", isGoalkeeper: index === 0,
  }));
}

test("accepts 35 on-time reservations for a tournament capped at 20 teams", { skip: !enabled }, async () => {
  const { reserveTournamentRegistration } = require("../dist/repositories/tournamentRepository");
  const { closePool, getPool } = require("../dist/lib/db");
  const pool = getPool();
  const tournamentId = await createFixture(pool, { maxTeams: 20 });
  const registrations = Array.from({ length: 35 }, () => ({ registrationId: randomUUID(), teamId: randomUUID(), institutionId: randomUUID() }));
  try {
    await Promise.all(registrations.map((item) => reserveTournamentRegistration({ ...item, tournamentId, roster: eligibleRoster() })));
    const count = await pool.query("SELECT COUNT(*)::int AS count FROM tournament_registration_reservations WHERE tournament_id=$1", [tournamentId]);
    assert.equal(count.rows[0].count, 35);
    await pool.query("UPDATE tournament_registration_reservations SET persisted_in_organization=TRUE WHERE registration_id=$1", [registrations[0].registrationId]);
    await pool.query(
      "UPDATE registration_periods SET end_date=(SELECT created_at FROM tournament_registration_reservations WHERE registration_id=$2) WHERE tournament_id=$1",
      [tournamentId, registrations[0].registrationId],
    );
    await assert.rejects(
      reserveTournamentRegistration({ registrationId: randomUUID(), teamId: randomUUID(), institutionId: randomUUID(), tournamentId, roster: eligibleRoster() }),
      (error) => error.code === "REGISTRATION_CLOSED",
    );
    await assert.rejects(
      reserveTournamentRegistration({ ...registrations[0], tournamentId, isResubmission: true, roster: eligibleRoster() }),
      (error) => error.code === "REGISTRATION_CLOSED",
    );
  } finally {
    await pool.query("DELETE FROM tournament_registration_reservations WHERE tournament_id=$1", [tournamentId]);
    await pool.query("DELETE FROM tournaments WHERE id=$1", [tournamentId]);
    await closePool();
  }
});

test("keeps valid new applications on the waitlist when the tournament cap is already full", { skip: !enabled }, async () => {
  const { reserveTournamentRegistration } = require("../dist/repositories/tournamentRepository");
  const { closePool, getPool } = require("../dist/lib/db");
  const pool = getPool();
  const tournamentId = await createFixture(pool, { maxTeams: 1 });
  const institutionId = randomUUID();
  try {
    await pool.query(
      "INSERT INTO tournament_registration_reservations (registration_id,tournament_id,team_id,institution_id,status,persisted_in_organization) VALUES ($1,$2,$3,$4,'APPROVED',TRUE)",
      [randomUUID(), tournamentId, randomUUID(), institutionId],
    );
    const registrationId = randomUUID();
    const status = await reserveTournamentRegistration({
      registrationId, tournamentId, teamId: randomUUID(), institutionId,
      roster: eligibleRoster(),
    });
    assert.equal(status, "WAITLIST");
    const saved = await pool.query("SELECT status FROM tournament_registration_reservations WHERE registration_id=$1", [registrationId]);
    assert.equal(saved.rows[0].status, "WAITLIST");
  } finally {
    await pool.query("DELETE FROM tournament_registration_reservations WHERE tournament_id=$1", [tournamentId]);
    await pool.query("DELETE FROM tournaments WHERE id=$1", [tournamentId]);
    await closePool();
  }
});

test("serializes concurrent approvals and never exceeds the total team cap", { skip: !enabled }, async () => {
  const { updateTournamentRegistrationReservation } = require("../dist/repositories/tournamentRepository");
  const { closePool, getPool } = require("../dist/lib/db");
  const pool = getPool();
  const tournamentId = await createFixture(pool, { maxTeams: 1 });
  const candidates = Array.from({ length: 2 }, () => ({ registrationId: randomUUID(), teamId: randomUUID(), institutionId: randomUUID() }));
  try {
    for (const candidate of candidates) {
      await pool.query(
        "INSERT INTO tournament_registration_reservations (registration_id,tournament_id,team_id,institution_id,status,persisted_in_organization) VALUES ($1,$2,$3,$4,'PENDING',TRUE)",
        [candidate.registrationId, tournamentId, candidate.teamId, candidate.institutionId],
      );
    }
    const outcomes = await Promise.allSettled(candidates.map((candidate) => updateTournamentRegistrationReservation(
      candidate.registrationId,
      "APPROVED",
      true,
      { tournamentId, teamId: candidate.teamId, institutionId: candidate.institutionId },
      [randomUUID()],
    )));
    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    assert.equal(rejected.reason.code, "TOURNAMENT_TEAM_LIMIT_REACHED");
    const winner = candidates[outcomes.findIndex((outcome) => outcome.status === "fulfilled")];
    const waitlisted = candidates[outcomes.findIndex((outcome) => outcome.status === "rejected")];
    await updateTournamentRegistrationReservation(winner.registrationId, "WITHDRAWN", true);
    await updateTournamentRegistrationReservation(waitlisted.registrationId, "APPROVED", true, {
      tournamentId, teamId: waitlisted.teamId, institutionId: waitlisted.institutionId,
    }, [randomUUID()]);
    const count = await pool.query("SELECT COUNT(*)::int AS count FROM tournament_registration_reservations WHERE tournament_id=$1 AND status='APPROVED' AND persisted_in_organization=TRUE", [tournamentId]);
    assert.equal(count.rows[0].count, 1);
  } finally {
    await pool.query("DELETE FROM tournament_registration_reservations WHERE tournament_id=$1", [tournamentId]);
    await pool.query("DELETE FROM tournaments WHERE id=$1", [tournamentId]);
    await closePool();
  }
});

test("serializes concurrent approvals against the per-institution cap", { skip: !enabled }, async () => {
  const { updateTournamentRegistrationReservation } = require("../dist/repositories/tournamentRepository");
  const { closePool, getPool } = require("../dist/lib/db");
  const pool = getPool();
  const tournamentId = await createFixture(pool, { maxTeams: 8, schoolCap: 1 });
  const institutionId = randomUUID();
  const candidates = Array.from({ length: 2 }, () => ({ registrationId: randomUUID(), teamId: randomUUID() }));
  try {
    for (const candidate of candidates) {
      await pool.query(
        "INSERT INTO tournament_registration_reservations (registration_id,tournament_id,team_id,institution_id,status,persisted_in_organization) VALUES ($1,$2,$3,$4,'PENDING',TRUE)",
        [candidate.registrationId, tournamentId, candidate.teamId, institutionId],
      );
    }
    const outcomes = await Promise.allSettled(candidates.map((candidate) => updateTournamentRegistrationReservation(
      candidate.registrationId,
      "APPROVED",
      true,
      { tournamentId, teamId: candidate.teamId, institutionId },
      [randomUUID()],
    )));
    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    assert.equal(rejected.reason.code, "INSTITUTION_TEAM_LIMIT_REACHED");
    const count = await pool.query("SELECT COUNT(*)::int AS count FROM tournament_registration_reservations WHERE tournament_id=$1 AND institution_id=$2 AND status='APPROVED' AND persisted_in_organization=TRUE", [tournamentId, institutionId]);
    assert.equal(count.rows[0].count, 1);
  } finally {
    await pool.query("DELETE FROM tournament_registration_reservations WHERE tournament_id=$1", [tournamentId]);
    await pool.query("DELETE FROM tournaments WHERE id=$1", [tournamentId]);
    await closePool();
  }
});

test("approval claims player date rights and returns overlapping pending rosters for adjustment", { skip: !enabled }, async () => {
  const { updateTournamentRegistrationReservation } = require("../dist/repositories/tournamentRepository");
  const { closePool, getPool } = require("../dist/lib/db");
  const pool = getPool();
  const firstTournament = await createFixture(pool, { maxTeams: 8 });
  const secondTournament = await createFixture(pool, { maxTeams: 8 });
  const playerId = randomUUID();
  const first = { registrationId: randomUUID(), teamId: randomUUID(), institutionId: randomUUID() };
  const second = { registrationId: randomUUID(), teamId: randomUUID(), institutionId: randomUUID() };
  try {
    await pool.query(
      "INSERT INTO tournament_registration_reservations (registration_id,tournament_id,team_id,institution_id,status,persisted_in_organization,roster_player_ids) VALUES ($1,$2,$3,$4,'PENDING',TRUE,$5::uuid[])",
      [first.registrationId, firstTournament, first.teamId, first.institutionId, [playerId]],
    );
    await pool.query(
      "INSERT INTO tournament_registration_reservations (registration_id,tournament_id,team_id,institution_id,status,persisted_in_organization,roster_player_ids) VALUES ($1,$2,$3,$4,'PENDING',TRUE,$5::uuid[])",
      [second.registrationId, secondTournament, second.teamId, second.institutionId, [playerId]],
    );
    const decision = await updateTournamentRegistrationReservation(first.registrationId, "APPROVED", true,
      { tournamentId: firstTournament, teamId: first.teamId, institutionId: first.institutionId }, [playerId]);
    assert.deepEqual(decision.conflictedRegistrations.map((item) => item.registrationId), [second.registrationId]);
    const state = await pool.query("SELECT status FROM tournament_registration_reservations WHERE registration_id=$1", [second.registrationId]);
    assert.equal(state.rows[0].status, "CONFLICT_ADJUSTMENT_REQUIRED");

    await assert.rejects(
      updateTournamentRegistrationReservation(second.registrationId, "APPROVED", true,
        { tournamentId: secondTournament, teamId: second.teamId, institutionId: second.institutionId }, [playerId]),
      (error) => error.code === "TOURNAMENT_PLAYER_DATE_CONFLICT",
    );
  } finally {
    await pool.query("DELETE FROM tournament_registration_reservations WHERE registration_id = ANY($1::uuid[])", [[first.registrationId, second.registrationId]]);
    await pool.query("DELETE FROM tournaments WHERE id = ANY($1::uuid[])", [[firstTournament, secondTournament]]);
    await closePool();
  }
});

test("two overlapping tournament approvals for the same player serialize with one winner", { skip: !enabled }, async () => {
  const { updateTournamentRegistrationReservation } = require("../dist/repositories/tournamentRepository");
  const { closePool, getPool } = require("../dist/lib/db");
  const pool = getPool();
  const tournamentIds = [await createFixture(pool, { maxTeams: 8 }), await createFixture(pool, { maxTeams: 8 })];
  const playerId = randomUUID();
  const registrations = tournamentIds.map(() => ({ registrationId: randomUUID(), teamId: randomUUID(), institutionId: randomUUID() }));
  try {
    for (let index = 0; index < registrations.length; index += 1) {
      const item = registrations[index];
      await pool.query(
        "INSERT INTO tournament_registration_reservations (registration_id,tournament_id,team_id,institution_id,status,persisted_in_organization,roster_player_ids) VALUES ($1,$2,$3,$4,'PENDING',TRUE,$5::uuid[])",
        [item.registrationId, tournamentIds[index], item.teamId, item.institutionId, [playerId]],
      );
    }
    const outcomes = await Promise.allSettled(registrations.map((item, index) => updateTournamentRegistrationReservation(
      item.registrationId, "APPROVED", true,
      { tournamentId: tournamentIds[index], teamId: item.teamId, institutionId: item.institutionId }, [playerId],
    )));
    assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 1);
    const rejected = outcomes.find((item) => item.status === "rejected");
    assert.equal(rejected.reason.code, "TOURNAMENT_PLAYER_DATE_CONFLICT");
    const claims = await pool.query("SELECT COUNT(*)::int AS count FROM tournament_player_participation_reservations WHERE player_id=$1", [playerId]);
    assert.equal(claims.rows[0].count, 1);
  } finally {
    await pool.query("DELETE FROM tournament_registration_reservations WHERE registration_id=ANY($1::uuid[])", [registrations.map((item) => item.registrationId)]);
    await pool.query("DELETE FROM tournaments WHERE id=ANY($1::uuid[])", [tournamentIds]);
    await closePool();
  }
});

test("reconciliation backfills legacy approved rosters idempotently without duplicating player claims", { skip: !enabled }, async () => {
  const { reconcileApprovedPlayerParticipationClaims } = require("../dist/repositories/tournamentRepository");
  const { closePool, getPool } = require("../dist/lib/db");
  const pool = getPool();
  const tournamentId = await createFixture(pool, { maxTeams: 8 });
  const claim = { registrationId: randomUUID(), tournamentId, teamId: randomUUID(), institutionId: randomUUID(), playerIds: [randomUUID(), randomUUID()], status: "APPROVED" };
  try {
    await pool.query(
      "INSERT INTO tournament_registration_reservations (registration_id,tournament_id,team_id,institution_id,status,persisted_in_organization) VALUES ($1,$2,$3,$4,'APPROVED',TRUE)",
      [claim.registrationId, tournamentId, claim.teamId, claim.institutionId],
    );
    await reconcileApprovedPlayerParticipationClaims([claim]);
    await reconcileApprovedPlayerParticipationClaims([claim]);
    const saved = await pool.query("SELECT roster_player_ids FROM tournament_registration_reservations WHERE registration_id=$1", [claim.registrationId]);
    const counted = await pool.query("SELECT COUNT(*)::int AS count FROM tournament_player_participation_reservations WHERE registration_id=$1", [claim.registrationId]);
    assert.equal(saved.rows[0].roster_player_ids.length, 2);
    assert.equal(counted.rows[0].count, 2);
  } finally {
    await pool.query("DELETE FROM tournament_registration_reservations WHERE registration_id=$1", [claim.registrationId]);
    await pool.query("DELETE FROM tournaments WHERE id=$1", [tournamentId]);
    await closePool();
  }
});
