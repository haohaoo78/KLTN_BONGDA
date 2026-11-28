const assert = require("node:assert/strict");
const test = require("node:test");
const { assertDrawStageReady } = require("../dist/services/drawStageReadiness");

test("draw preparation requires a locked roster", () => {
  assert.throws(() => assertDrawStageReady("REGISTRATION_CLOSED"), (error) =>
    error.code === "DRAW_STAGE_NOT_READY" && error.status === 409,
  );
  assert.doesNotThrow(() => assertDrawStageReady("ROSTER_LOCKED"));
});

test("draw preparation rejects unrelated or terminal tournament stages", () => {
  for (const status of ["DRAFT", "OPEN_REGISTRATION", "PREPARING", "IN_PROGRESS", "COMPLETED", "CANCELLED"]) {
    assert.throws(() => assertDrawStageReady(status), (error) => error.code === "DRAW_STAGE_NOT_READY");
  }
});
