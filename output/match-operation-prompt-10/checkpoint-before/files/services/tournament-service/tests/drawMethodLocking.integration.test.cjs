const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const test = require("node:test");

const enabled = process.env.RUN_TOURNAMENT_DB_INTEGRATION === "1";

async function fixture(pool, actorId, prefix) {
  const tournamentId = randomUUID();
  const teamIds = Array.from({ length: 4 }, () => randomUUID());
  const candidates = teamIds.map((teamId, index) => ({
    teamId, name: `${prefix} club ${index + 1}`, shortName: `${prefix}${index + 1}`, logoUrl: null,
    institutionId: randomUUID(), institutionName: `${prefix} institution ${index + 1}`, isActive: true,
    registrationStatus: "APPROVED", verifiedRosterCount: 12, totalRosterCount: 12,
  }));
  await pool.query(
    `INSERT INTO tournaments (id,name,status,scope,football_format,competition_format,min_teams,max_teams,min_players,max_players_per_team,created_by)
     VALUES ($1,$2,'ROSTER_LOCKED','INTER_SCHOOL',7,'ROUND_ROBIN',4,8,7,18,$3)`, [tournamentId, prefix, actorId],
  );
  await pool.query(
    `INSERT INTO tournament_rules (tournament_id,published_version,published_at,published_by,competition_config)
     VALUES ($1,1,NOW(),$2,$3::jsonb)`,
    [tournamentId, actorId, JSON.stringify({ groupCountMode: "AUTO_BY_CAPACITY", groupCount: null, groupAllocation: "BALANCED", groupDrawMethod: "RANDOM", sameInstitutionPolicy: "NONE" })],
  );
  for (const candidate of candidates) await pool.query(
    `INSERT INTO tournament_registration_reservations (registration_id,tournament_id,team_id,institution_id,status,persisted_in_organization)
     VALUES ($1,$2,$3,$4,'APPROVED',TRUE)`, [randomUUID(), tournamentId, candidate.teamId, candidate.institutionId],
  );
  return { tournamentId, teamIds, candidates };
}

function plan(method, teamIds) {
  return {
    method, groupCount: 1, teamsPerGroup: [4], noSameInstitution: false,
    ...(method === "MANUAL" ? { groups: [{ name: "Bảng A", teamIds }] } : {}),
  };
}

test("independent method drafts survive switching, and publishing one archives other drafts permanently", { skip: !enabled }, async () => {
  const { getPool, closePool } = require("../dist/lib/db.js");
  const { config } = require("../dist/config.js");
  const { saveDrawWorkflowDraft, confirmDrawWorkflow, publishDrawWorkflow, getDrawManagement, getPublicDraw } = require("../dist/services/drawWorkflowService.js");
  const pool = getPool();
  const originalFetch = global.fetch;
  const originalKey = config.internalApiKey;
  config.internalApiKey = "integration-test-internal-key";
  const actorId = randomUUID();
  let tournamentId;
  try {
    const created = await fixture(pool, actorId, "Independent drafts");
    tournamentId = created.tournamentId;
    global.fetch = async () => new Response(JSON.stringify({ candidates: created.candidates }), { status: 200, headers: { "content-type": "application/json" } });

    const randomDraft = await saveDrawWorkflowDraft(tournamentId, plan("RANDOM", created.teamIds), actorId);
    const manualDraft = await saveDrawWorkflowDraft(tournamentId, plan("MANUAL", created.teamIds), actorId);
    assert.equal(randomDraft.status, "DRAFT");
    assert.equal(manualDraft.status, "DRAFT");
    const drafts = (await getDrawManagement(tournamentId)).history.filter((item) => item.status === "DRAFT");
    assert.deepEqual(new Set(drafts.map((item) => item.method)), new Set(["RANDOM", "MANUAL"]));

    await confirmDrawWorkflow(tournamentId, "MANUAL", actorId);
    const published = await publishDrawWorkflow(tournamentId, "MANUAL", actorId);
    assert.equal(published.status, "PUBLISHED");
    assert.equal((await getPublicDraw(tournamentId)).id, published.id);
    const history = (await getDrawManagement(tournamentId)).history;
    assert.equal(history.find((item) => item.id === randomDraft.id).status, "ARCHIVED");
    assert.equal(history.filter((item) => item.status === "PUBLISHED").length, 1);
    await assert.rejects(saveDrawWorkflowDraft(tournamentId, plan("RANDOM", created.teamIds), actorId), (error) => error.code === "DRAW_ALREADY_PUBLISHED");
  } finally {
    global.fetch = originalFetch;
    config.internalApiKey = originalKey;
    if (tournamentId) {
      await pool.query("DELETE FROM tournament_draw_assignments WHERE draw_version_id IN (SELECT id FROM tournament_draw_versions WHERE tournament_id=$1)", [tournamentId]);
      await pool.query("DELETE FROM tournament_draw_groups WHERE draw_version_id IN (SELECT id FROM tournament_draw_versions WHERE tournament_id=$1)", [tournamentId]);
      await pool.query("DELETE FROM tournament_draw_versions WHERE tournament_id=$1", [tournamentId]);
      await pool.query("DELETE FROM tournaments WHERE id=$1", [tournamentId]);
    }
    await closePool();
  }
});

test("concurrent publication of two methods is serialized to exactly one official draw", { skip: !enabled }, async () => {
  const { getPool, closePool } = require("../dist/lib/db.js");
  const { config } = require("../dist/config.js");
  const { saveDrawWorkflowDraft, confirmDrawWorkflow, publishDrawWorkflow, getDrawManagement } = require("../dist/services/drawWorkflowService.js");
  const pool = getPool();
  const originalFetch = global.fetch;
  const originalKey = config.internalApiKey;
  config.internalApiKey = "integration-test-internal-key";
  const actorId = randomUUID();
  let tournamentId;
  try {
    const created = await fixture(pool, actorId, "Concurrent draw publication");
    tournamentId = created.tournamentId;
    global.fetch = async () => new Response(JSON.stringify({ candidates: created.candidates }), { status: 200, headers: { "content-type": "application/json" } });
    await saveDrawWorkflowDraft(tournamentId, plan("RANDOM", created.teamIds), actorId);
    await saveDrawWorkflowDraft(tournamentId, plan("MANUAL", created.teamIds), actorId);
    await confirmDrawWorkflow(tournamentId, "RANDOM", actorId);
    await confirmDrawWorkflow(tournamentId, "MANUAL", actorId);
    const outcomes = await Promise.allSettled([
      publishDrawWorkflow(tournamentId, "RANDOM", actorId),
      publishDrawWorkflow(tournamentId, "MANUAL", actorId),
    ]);
    assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal((await getDrawManagement(tournamentId)).history.filter((version) => version.status === "PUBLISHED").length, 1);
  } finally {
    global.fetch = originalFetch;
    config.internalApiKey = originalKey;
    if (tournamentId) {
      await pool.query("DELETE FROM tournament_draw_assignments WHERE draw_version_id IN (SELECT id FROM tournament_draw_versions WHERE tournament_id=$1)", [tournamentId]);
      await pool.query("DELETE FROM tournament_draw_groups WHERE draw_version_id IN (SELECT id FROM tournament_draw_versions WHERE tournament_id=$1)", [tournamentId]);
      await pool.query("DELETE FROM tournament_draw_versions WHERE tournament_id=$1", [tournamentId]);
      await pool.query("DELETE FROM tournaments WHERE id=$1", [tournamentId]);
    }
    await closePool();
  }
});

test("a direct schedule locks draft mutations, and cancellation requires a reason then unlocks drafts", { skip: !enabled }, async () => {
  const { getPool, closePool } = require("../dist/lib/db.js");
  const { config } = require("../dist/config.js");
  const { saveDrawWorkflowDraft, confirmDrawWorkflow, startLiveDraw, startScheduledLiveDraw, advanceLiveDrawPick, rescheduleLiveDraw, getDrawManagement, getPublicDraw } = require("../dist/services/drawWorkflowService.js");
  const pool = getPool();
  const originalFetch = global.fetch;
  const originalKey = config.internalApiKey;
  config.internalApiKey = "integration-test-internal-key";
  const actorId = randomUUID();
  let tournamentId;
  try {
    const created = await fixture(pool, actorId, "Schedule locks drafts");
    tournamentId = created.tournamentId;
    global.fetch = async () => new Response(JSON.stringify({ candidates: created.candidates }), { status: 200, headers: { "content-type": "application/json" } });
    const randomDraft = await saveDrawWorkflowDraft(tournamentId, plan("RANDOM", created.teamIds), actorId);
    const scheduled = await startLiveDraw(tournamentId, plan("RANDOM", created.teamIds), actorId, {
      eventName: "Lock test", scheduledAt: new Date(Date.now() + 60_000).toISOString(), timeZone: "Asia/Ho_Chi_Minh", announcement: "", location: "Test hall",
    });
    assert.equal(scheduled.status, "SCHEDULED");
    assert.equal(scheduled.location, "Test hall");
    await assert.rejects(saveDrawWorkflowDraft(tournamentId, plan("MANUAL", created.teamIds), actorId), (error) => error.code === "DRAW_METHOD_LOCKED_BY_LIVE_SESSION");
    await assert.rejects(confirmDrawWorkflow(tournamentId, "RANDOM", actorId), (error) => error.code === "DRAW_METHOD_LOCKED_BY_LIVE_SESSION");
    await assert.rejects(rescheduleLiveDraw(tournamentId, actorId, "CANCELLED"), (error) => error.code === "LIVE_DRAW_CANCELLATION_REASON_REQUIRED");
    const cancelled = await rescheduleLiveDraw(tournamentId, actorId, "CANCELLED", undefined, "Lý do kiểm thử");
    assert.equal(cancelled.status, "CANCELLED");
    assert.equal(cancelled.history.at(-1).detail, "Lý do kiểm thử");
    const reopenedDraft = await saveDrawWorkflowDraft(tournamentId, plan("MANUAL", created.teamIds), actorId);
    assert.equal(reopenedDraft.status, "DRAFT");
    assert.equal((await getDrawManagement(tournamentId)).history.find((item) => item.id === randomDraft.id).status, "DRAFT");

    const secondSchedule = await startLiveDraw(tournamentId, plan("RANDOM", created.teamIds), actorId, {
      eventName: "Final lock test", scheduledAt: new Date(Date.now() + 100).toISOString(), timeZone: "Asia/Ho_Chi_Minh", announcement: "",
    });
    await new Promise((resolve) => setTimeout(resolve, 120));
    await startScheduledLiveDraw(tournamentId, actorId);
    let completed;
    for (let sequence = 0; sequence < created.teamIds.length; sequence += 1) {
      completed = await advanceLiveDrawPick(tournamentId, sequence, actorId, `final-lock-${sequence + 1}`);
    }
    assert.equal(completed.state.status, "FINALIZED");
    assert.equal((await getPublicDraw(tournamentId)).status, "PUBLISHED");
    const finalHistory = (await getDrawManagement(tournamentId)).history;
    assert.equal(finalHistory.filter((item) => item.status === "PUBLISHED").length, 1);
    assert.equal(finalHistory.find((item) => item.id === reopenedDraft.id).status, "ARCHIVED");
    assert.equal(finalHistory.find((item) => item.id === randomDraft.id).status, "ARCHIVED");
    assert.equal(secondSchedule.status, "SCHEDULED");
  } finally {
    global.fetch = originalFetch;
    config.internalApiKey = originalKey;
    if (tournamentId) {
      await pool.query("DELETE FROM tournament_live_draw_sessions WHERE tournament_id=$1", [tournamentId]);
      await pool.query("DELETE FROM tournament_draw_assignments WHERE draw_version_id IN (SELECT id FROM tournament_draw_versions WHERE tournament_id=$1)", [tournamentId]);
      await pool.query("DELETE FROM tournament_draw_groups WHERE draw_version_id IN (SELECT id FROM tournament_draw_versions WHERE tournament_id=$1)", [tournamentId]);
      await pool.query("DELETE FROM tournament_draw_versions WHERE tournament_id=$1", [tournamentId]);
      await pool.query("DELETE FROM tournaments WHERE id=$1", [tournamentId]);
    }
    await closePool();
  }
});
