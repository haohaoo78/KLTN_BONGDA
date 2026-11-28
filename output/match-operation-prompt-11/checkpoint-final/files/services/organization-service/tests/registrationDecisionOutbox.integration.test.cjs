const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const test = require("node:test");

test("registration decision survives a failed delivery and completes on retry", {
  skip: process.env.RUN_ORG_DB_INTEGRATION !== "1",
}, async () => {
  const {
    claimRegistrationDecision,
    completeRegistrationDecision,
    enqueueRegistrationDecision,
    failRegistrationDecision,
  } = require("../dist/repositories/registrationDecisionOutboxRepository");
  const { closePool, getPool } = require("../dist/lib/db");
  const pool = getPool();
  const ids = { team: randomUUID(), captain: randomUUID(), tournament: randomUUID(), registration: randomUUID() };

  try {
    await pool.query(
      "INSERT INTO teams (id, name, captain_id) VALUES ($1, 'Registration outbox integration fixture', $2)",
      [ids.team, ids.captain],
    );
    await pool.query(
      "INSERT INTO team_registrations (id, team_id, tournament_id, status, submission_sequence, submitted_at) VALUES ($1, $2, $3, 'PENDING', 1, NOW())",
      [ids.registration, ids.team, ids.tournament],
    );

    const queued = await enqueueRegistrationDecision(
      ids.registration,
      { status: "REJECTED", notes: "integration decision" },
      randomUUID(),
    );
    await assert.rejects(
      enqueueRegistrationDecision(ids.registration, { status: "APPROVED" }, randomUUID()),
      (error) => error.code === "REGISTRATION_DECISION_SYNC_PENDING",
    );
    const firstAttempt = await claimRegistrationDecision(queued.outboxId);
    assert.ok(firstAttempt);
    await failRegistrationDecision(firstAttempt, new Error("Tournament unavailable"), true);
    const persisted = await pool.query(
      "SELECT state, attempts FROM team_registration_decision_outbox WHERE id = $1",
      [queued.outboxId],
    );
    assert.equal(persisted.rows[0].state, "PENDING");
    assert.equal(Number(persisted.rows[0].attempts), 1);
    assert.equal((await pool.query("SELECT status FROM team_registrations WHERE id = $1", [ids.registration])).rows[0].status, "PENDING");

    await pool.query("UPDATE team_registration_decision_outbox SET next_attempt_at = NOW() WHERE id = $1", [queued.outboxId]);
    const retry = await claimRegistrationDecision(queued.outboxId);
    assert.ok(retry);
    assert.equal(retry.attempts, 2);
    await completeRegistrationDecision(retry, []);

    const result = await pool.query(
      `SELECT tr.status, o.state FROM team_registrations tr
       JOIN team_registration_decision_outbox o ON o.registration_id = tr.id WHERE tr.id = $1`,
      [ids.registration],
    );
    assert.equal(result.rows[0].status, "REJECTED");
    assert.equal(result.rows[0].state, "SUCCEEDED");
  } finally {
    await pool.query("DELETE FROM team_registrations WHERE id = $1", [ids.registration]);
    await pool.query("DELETE FROM teams WHERE id = $1", [ids.team]);
    await closePool();
  }
});
