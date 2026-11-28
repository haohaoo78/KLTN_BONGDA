const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const test = require("node:test");

let tournamentApi;
test.before(async () => {
  const http = require("node:http");
  tournamentApi = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.method === "GET" && req.url.endsWith("/registration-review-eligibility")) {
      res.end(JSON.stringify({ eligible: true, status: "OPEN_REGISTRATION", minPlayers: 1, maxPlayersPerTeam: 30, minGoalkeepers: 0 }));
      return;
    }
    if (req.method === "PATCH" && req.url.startsWith("/internal/registration-reservations/")) {
      res.end(JSON.stringify({ conflictedRegistrations: [], waitlistedRegistrationIds: [] }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: { code: "NOT_FOUND", message: "Unexpected Tournament API call in test" } }));
  });
  await new Promise((resolve) => tournamentApi.listen(0, "127.0.0.1", resolve));
  process.env.TOURNAMENT_SERVICE_URL = `http://127.0.0.1:${tournamentApi.address().port}`;
  process.env.INTERNAL_API_KEY = "organization-integration-test-key";
});

test.after(async () => {
  if (tournamentApi?.listening) await new Promise((resolve) => tournamentApi.close(resolve));
});

test("accepts more submissions than tournament capacity and assigns unique server FIFO numbers", {
  skip: process.env.RUN_ORG_DB_INTEGRATION !== "1",
}, async () => {
  const { createTeamRegistration } = require("../dist/repositories/teamRepository");
  const { closePool, getPool } = require("../dist/lib/db");
  const pool = getPool();
  const tournamentId = randomUUID();
  const teams = Array.from({ length: 35 }, () => ({ id: randomUUID(), captainId: randomUUID() }));
  try {
    for (const team of teams) {
      await pool.query("INSERT INTO teams (id,name,captain_id) VALUES ($1,$2,$3)", [team.id, `FIFO test ${team.id}`, team.captainId]);
    }
    const registrations = await Promise.all(teams.map((team) => createTeamRegistration({
      id: randomUUID(), teamId: team.id, tournamentId, institutionId: randomUUID(),
    })));
    assert.equal(registrations.length, 35);
    assert.deepEqual(registrations.map((item) => item.submissionSequence).sort((a, b) => a - b), Array.from({ length: 35 }, (_, index) => index + 1));
    assert.ok(registrations.every((item) => Boolean(item.submittedAt)));
    await assert.rejects(
      pool.query("UPDATE team_registrations SET submission_sequence=999, submitted_at=NOW() WHERE id=$1", [registrations[0].id]),
      (error) => error.code === "23514",
    );
    const stored = await pool.query("SELECT COUNT(*)::int AS count, COUNT(DISTINCT submission_sequence)::int AS unique_count FROM team_registrations WHERE tournament_id=$1", [tournamentId]);
    assert.equal(stored.rows[0].count, 35);
    assert.equal(stored.rows[0].unique_count, 35);
  } finally {
    await pool.query("DELETE FROM team_registrations WHERE tournament_id=$1", [tournamentId]);
    await pool.query("DELETE FROM teams WHERE id=ANY($1::uuid[])", [teams.map((team) => team.id)]);
    await closePool();
  }
});

test("requires BTC to decide applications in submission order", {
  skip: process.env.RUN_ORG_DB_INTEGRATION !== "1",
}, async () => {
  const { createTeamRegistration } = require("../dist/repositories/teamRepository");
  const { updateTeamRegistrationStatus } = require("../dist/services/teamService");
  const { closePool, getPool } = require("../dist/lib/db");
  const pool = getPool();
  const tournamentId = randomUUID();
  const teams = Array.from({ length: 2 }, () => ({ id: randomUUID(), captainId: randomUUID() }));
  let registrations = [];
  try {
    for (const team of teams) {
      await pool.query("INSERT INTO teams (id,name,captain_id) VALUES ($1,$2,$3)", [team.id, `FIFO decision ${team.id}`, team.captainId]);
      registrations.push(await createTeamRegistration({ id: randomUUID(), teamId: team.id, tournamentId, institutionId: randomUUID() }));
    }
    const first = registrations.find((registration) => registration.submissionSequence === 1);
    const second = registrations.find((registration) => registration.submissionSequence === 2);
    await assert.rejects(updateTeamRegistrationStatus(second.id, {
      status: "NEEDS_SUPPLEMENT",
      notes: "Please correct the roster",
      supplementDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }, randomUUID()), (error) => error.code === "REGISTRATION_NOT_NEXT_IN_QUEUE");
    const firstDecision = await updateTeamRegistrationStatus(first.id, {
      status: "NEEDS_SUPPLEMENT",
      notes: "Please correct the roster",
      supplementDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }, randomUUID());
    assert.equal(firstDecision.status, "NEEDS_SUPPLEMENT");
    const secondDecision = await updateTeamRegistrationStatus(second.id, {
      status: "REJECTED", notes: "Application is incomplete",
    }, randomUUID());
    assert.equal(secondDecision.status, "REJECTED");
  } finally {
    await pool.query("DELETE FROM team_registrations WHERE tournament_id=$1", [tournamentId]);
    await pool.query("DELETE FROM teams WHERE id=ANY($1::uuid[])", [teams.map((team) => team.id)]);
    await closePool();
  }
});

test("serializes two reviewers on the same tournament queue", {
  skip: process.env.RUN_ORG_DB_INTEGRATION !== "1",
}, async () => {
  const { withTournamentRegistrationReviewLock } = require("../dist/repositories/teamRepository");
  const { closePool } = require("../dist/lib/db");
  const tournamentId = randomUUID();
  let activeReviewTransactions = 0;
  let maximumConcurrentReviews = 0;
  try {
    await Promise.all(Array.from({ length: 2 }, () => withTournamentRegistrationReviewLock(tournamentId, async () => {
      activeReviewTransactions += 1;
      maximumConcurrentReviews = Math.max(maximumConcurrentReviews, activeReviewTransactions);
      await new Promise((resolve) => setTimeout(resolve, 30));
      activeReviewTransactions -= 1;
    })));
    assert.equal(maximumConcurrentReviews, 1);
  } finally {
    await closePool();
  }
});
