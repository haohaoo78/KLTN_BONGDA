const assert = require("node:assert/strict");
const test = require("node:test");
const { AppError } = require("../dist/lib/errors");

const integration = process.env.RUN_TOURNAMENT_DB_INTEGRATION === "1";

test("status compare-and-set rejects an update based on stale or missing state", { skip: !integration }, async () => {
  const { updateTournament } = require("../dist/repositories/tournamentRepository");
  const id = "00000000-0000-4000-8000-000000000001";
  await assert.rejects(
    updateTournament(id, { description: "must not persist" }, "ROSTER_LOCKED"),
    (error) => error instanceof AppError && error.code === "TOURNAMENT_STATE_CHANGED" && error.status === 409,
  );
});
