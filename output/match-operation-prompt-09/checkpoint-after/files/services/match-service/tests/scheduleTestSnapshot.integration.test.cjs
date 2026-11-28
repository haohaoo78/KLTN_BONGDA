const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const test = require("node:test");

test("schedule test snapshots are scoped to the diagram version and reject stale writes", {
  skip: process.env.RUN_SCHEDULING_DB_INTEGRATION !== "1",
}, async () => {
  const { getPool, closePool } = require("../dist/scheduling/lib/db");
  const { getScheduleTestSnapshot, saveScheduleTestSnapshot, deleteScheduleTestSnapshot } = require("../dist/scheduling/repositories/testSnapshotRepository");
  const pool = getPool();
  const tournamentId = randomUUID();
  const actorId = randomUUID();
  try {
    assert.equal(await getScheduleTestSnapshot(tournamentId), null);
    const first = await saveScheduleTestSnapshot(tournamentId, "diagram-v1", {
      scheduleByFixture: { "fixture-draft": { scheduledAt: "2026-12-01T09:00:00.000Z", venue: "A", locked: false } },
      autoPreview: { status: "PARTIAL", scheduledFixtureIds: ["fixture-sim"], proposedEntries: { "fixture-sim": { scheduledAt: "2026-12-01T11:00:00.000Z", venue: "B" } }, baseSignature: "source-v1" },
      simulationStatus: "SIMULATED",
    }, actorId, null);
    assert.equal(first.revision, 1);
    assert.equal(first.state.simulationStatus, "SIMULATED");
    assert.equal(first.state.scheduleByFixture["fixture-draft"].venue, "A");
    assert.equal(first.state.autoPreview.proposedEntries["fixture-sim"].venue, "B");
    assert.equal(first.state.scheduleByFixture["fixture-sim"], undefined, "simulation is not silently copied into the draft schedule");
    const contenders = await Promise.all([
      saveScheduleTestSnapshot(tournamentId, "diagram-v1", { marker: "left" }, actorId, 1),
      saveScheduleTestSnapshot(tournamentId, "diagram-v1", { marker: "right" }, actorId, 1),
    ]);
    assert.equal(contenders.filter(Boolean).length, 1, "only one concurrent write based on revision 1 wins");
    const saved = await getScheduleTestSnapshot(tournamentId);
    assert.equal(saved.revision, 2);
    assert.equal(saved.diagramVersion, "diagram-v1");
    await deleteScheduleTestSnapshot(tournamentId);
    assert.equal(await getScheduleTestSnapshot(tournamentId), null);
  } finally {
    await pool.query("DELETE FROM match_schedule_test_snapshots WHERE tournament_id=$1", [tournamentId]);
    await closePool();
  }
});
