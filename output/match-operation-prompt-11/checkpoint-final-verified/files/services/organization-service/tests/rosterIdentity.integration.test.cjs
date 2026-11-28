const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const test = require("node:test");
const { createRostersBatch } = require("../dist/repositories/institutionRepository");
const { closePool, getPool } = require("../dist/lib/db");

test("từ chối một MSSV đã nằm trong hồ sơ PENDING của đội khác cùng giải", {
  skip: process.env.RUN_ORG_DB_INTEGRATION !== "1",
}, async () => {
  const pool = getPool();
  const db = await pool.query("SELECT current_database() AS name");
  assert.equal(db.rows[0].name, "sfl_team", "integration test must run only against the organization database");

  const teamIds = [randomUUID(), randomUUID()];
  const playerIds = [randomUUID(), randomUUID()];
  const tournamentId = randomUUID();
  const captainId = randomUUID();
  const studentId = `TEST-${randomUUID()}`;
  try {
    for (let index = 0; index < teamIds.length; index += 1) {
      const teamId = teamIds[index];
      await pool.query(
        "INSERT INTO teams (id, name, captain_id) VALUES ($1, 'Roster identity integration fixture', $2)",
        [teamId, captainId],
      );
      await pool.query(
        "INSERT INTO team_registrations (team_id, tournament_id, status, submission_sequence, submitted_at) VALUES ($1, $2, 'PENDING', $3, NOW())",
        [teamId, tournamentId, index + 1],
      );
    }
    for (let index = 0; index < teamIds.length; index += 1) {
      await pool.query(
        "INSERT INTO players (id, team_id, full_name, student_id) VALUES ($1, $2, $3, $4)",
        [playerIds[index], teamIds[index], `Fixture Player ${index + 1}`, studentId],
      );
    }

    await createRostersBatch([{ teamId: teamIds[0], tournamentId, playerId: playerIds[0] }]);
    await assert.rejects(
      createRostersBatch([{ teamId: teamIds[1], tournamentId, playerId: playerIds[1] }]),
      (error) => error.code === "DUPLICATE_TOURNAMENT_PLAYER",
    );
  } finally {
    await pool.query("DELETE FROM teams WHERE id = ANY($1::uuid[])", [teamIds]);
    await closePool();
  }
});
