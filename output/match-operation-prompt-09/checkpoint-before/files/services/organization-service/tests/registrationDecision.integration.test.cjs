const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const test = require("node:test");

test("concurrent conflicting decisions leave one durable event and block the second", {
  skip: process.env.RUN_ORG_DB_INTEGRATION !== "1",
}, async () => {
  const { enqueueRegistrationDecision } = require("../dist/repositories/registrationDecisionOutboxRepository");
  const { closePool, getPool } = require("../dist/lib/db");
  const pool = getPool();
  const ids = { team: randomUUID(), captain: randomUUID(), tournament: randomUUID(), registration: randomUUID() };
  try {
    await pool.query(
      "INSERT INTO teams (id, name, captain_id) VALUES ($1, 'Registration decision integration fixture', $2)",
      [ids.team, ids.captain],
    );
    await pool.query(
      "INSERT INTO team_registrations (id, team_id, tournament_id, status, submission_sequence, submitted_at) VALUES ($1, $2, $3, 'PENDING', 1, NOW())",
      [ids.registration, ids.team, ids.tournament],
    );

    const decisions = await Promise.allSettled([
      enqueueRegistrationDecision(ids.registration, { status: "APPROVED" }, randomUUID()),
      enqueueRegistrationDecision(ids.registration, { status: "REJECTED", notes: "fixture rejection" }),
    ]);

    assert.equal(
      decisions.filter((result) => result.status === "fulfilled").length,
      1,
      JSON.stringify(decisions.map((result) => result.status === "rejected"
        ? { status: result.status, code: result.reason.code, message: result.reason.message }
        : { status: result.status, value: result.value })),
    );
    const rejected = decisions.find((result) => result.status === "rejected");
    assert.equal(rejected.reason.code, "REGISTRATION_DECISION_SYNC_PENDING");
    const stored = await pool.query(
      `SELECT tr.status, COUNT(o.id)::INTEGER AS event_count
       FROM team_registrations tr LEFT JOIN team_registration_decision_outbox o ON o.registration_id = tr.id
       WHERE tr.id = $1 GROUP BY tr.status`,
      [ids.registration],
    );
    assert.equal(stored.rows[0].status, "PENDING");
    assert.equal(stored.rows[0].event_count, 1);
  } finally {
    await pool.query("DELETE FROM team_registrations WHERE id = $1", [ids.registration]);
    await pool.query("DELETE FROM teams WHERE id = $1", [ids.team]);
    await closePool();
  }
});
