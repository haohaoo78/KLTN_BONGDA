const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const test = require("node:test");

test("draw test snapshots are isolated, revision-checked and resettable", {
  skip: process.env.RUN_TOURNAMENT_DB_INTEGRATION !== "1",
}, async () => {
  const { getPool, closePool } = require("../dist/lib/db");
  const { getDrawTestSnapshot, saveDrawTestSnapshot, deleteDrawTestSnapshot } = require("../dist/repositories/drawTestSnapshotRepository");
  const pool = getPool();
  const tournamentId = randomUUID();
  const actorId = randomUUID();
  try {
    await pool.query(
      `INSERT INTO tournaments
         (id,name,status,scope,football_format,competition_format,min_teams,max_teams,min_players,max_players_per_team,created_by)
       VALUES ($1,'Snapshot integration fixture','ROSTER_LOCKED','INTER_SCHOOL',7,'ROUND_ROBIN',2,8,7,18,$2)`,
      [tournamentId, actorId],
    );
    assert.equal(await getDrawTestSnapshot(tournamentId), null);
    const first = await saveDrawTestSnapshot(tournamentId, { tournamentId, version: 1, marker: "first" }, actorId, null);
    assert.equal(first.revision, 1);
    const contenders = await Promise.all([
      saveDrawTestSnapshot(tournamentId, { tournamentId, version: 1, marker: "left" }, actorId, 1),
      saveDrawTestSnapshot(tournamentId, { tournamentId, version: 1, marker: "right" }, actorId, 1),
    ]);
    assert.equal(contenders.filter(Boolean).length, 1, "only one concurrent write based on revision 1 wins");
    const saved = await getDrawTestSnapshot(tournamentId);
    assert.equal(saved.revision, 2);
    await deleteDrawTestSnapshot(tournamentId);
    assert.equal(await getDrawTestSnapshot(tournamentId), null);
  } finally {
    await pool.query("DELETE FROM tournaments WHERE id=$1", [tournamentId]);
    await closePool();
  }
});
