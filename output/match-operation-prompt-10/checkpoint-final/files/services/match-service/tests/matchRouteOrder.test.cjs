const test = require("node:test");
const assert = require("node:assert/strict");
process.env.DATABASE_URL ||= "postgresql://sfl:sfl_dev_password@localhost:5432/sfl_match";
process.env.SCHEDULING_DATABASE_URL ||= process.env.DATABASE_URL;
const { matchRoutes } = require("../dist/routes/matchRoutes");

test("fixed live-match route is registered before the UUID parameter route", () => {
  const getRoutes = matchRoutes.stack
    .filter((layer) => layer.route && layer.route.methods.get)
    .map((layer) => layer.route.path);
  assert.ok(getRoutes.indexOf("/matches/live") < getRoutes.indexOf("/matches/:id"));
});
