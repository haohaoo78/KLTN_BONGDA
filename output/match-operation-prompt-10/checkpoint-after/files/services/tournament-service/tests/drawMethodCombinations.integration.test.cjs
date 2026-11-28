const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const test = require("node:test");

const enabled = process.env.RUN_TOURNAMENT_DB_INTEGRATION === "1";

test("Step 3 direct, random and manual workflows cover all nine format/method combinations", { skip: !enabled }, async () => {
  const { getPool, closePool } = require("../dist/lib/db.js");
  const { config } = require("../dist/config.js");
  const {
    confirmDrawWorkflow,
    getDrawManagement,
    getPublicDraw,
    previewDraw,
    publishDrawWorkflow,
    saveDrawWorkflowDraft,
    startLiveDraw,
    startScheduledLiveDraw,
    advanceLiveDrawPick,
  } = require("../dist/services/drawWorkflowService.js");
  const pool = getPool();
  const originalFetch = global.fetch;
  const originalKey = config.internalApiKey;
  config.internalApiKey = "integration-test-internal-key";

  const actorId = randomUUID();
  const teamIds = Array.from({ length: 4 }, () => randomUUID());
  const candidates = teamIds.map((teamId, index) => ({
    teamId,
    name: `Combination club ${index + 1}`,
    shortName: `CC${index + 1}`,
    logoUrl: null,
    institutionId: randomUUID(),
    institutionName: `Combination institution ${index + 1}`,
    isActive: true,
    registrationStatus: "APPROVED",
    verifiedRosterCount: 12,
    totalRosterCount: 12,
  }));
  global.fetch = async () => new Response(JSON.stringify({ candidates }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

  const tournamentIds = [];
  const sessionTournamentIds = [];
  async function createFixture(format) {
    const tournamentId = randomUUID();
    tournamentIds.push(tournamentId);
    const hybrid = format === "GROUP_AND_KNOCKOUT";
    const groupCount = hybrid ? 2 : 1;
    const config = {
      groupCountMode: hybrid ? "FIXED" : "AUTO_BY_CAPACITY",
      groupCount: hybrid ? 2 : null,
      groupAllocation: "BALANCED",
      groupDrawMethod: "RANDOM",
      sameInstitutionPolicy: "NONE",
      knockoutPairing: "FIXED_CROSSOVER",
      byePolicy: "AUTOMATIC",
      knockoutLegs: 1,
      thirdPlaceMatch: false,
      schedulingStartTime: "08:00",
      schedulingEndTime: "22:00",
    };
    await pool.query(
      `INSERT INTO tournaments (id,name,status,scope,football_format,competition_format,min_teams,max_teams,min_players,max_players_per_team,created_by)
       VALUES ($1,$2,'ROSTER_LOCKED','INTER_SCHOOL',7,$3,4,8,7,18,$4)`,
      [tournamentId, `Step 3 matrix ${format}`, format, actorId],
    );
    await pool.query(
      `INSERT INTO tournament_rules (tournament_id,published_version,published_at,published_by,max_teams_per_group,competition_config,advancing_teams_per_group)
       VALUES ($1,7,NOW(),$2,$3,$4::jsonb,$5)`,
      [tournamentId, actorId, hybrid ? 2 : null, JSON.stringify(config), 1],
    );
    for (let index = 0; index < teamIds.length; index += 1) {
      await pool.query(
        `INSERT INTO tournament_registration_reservations (registration_id,tournament_id,team_id,institution_id,status,persisted_in_organization)
         VALUES ($1,$2,$3,$4,'APPROVED',TRUE)`,
        [randomUUID(), tournamentId, teamIds[index], candidates[index].institutionId],
      );
    }
    return { tournamentId, groupCount, hybrid };
  }

  try {
    for (const format of ["ROUND_ROBIN", "KNOCKOUT", "GROUP_AND_KNOCKOUT"]) {
      for (const method of ["DIRECT", "RANDOM", "MANUAL"]) {
        const fixture = await createFixture(format);
        const { tournamentId, groupCount, hybrid } = fixture;
        const teamsPerGroup = hybrid ? [2, 2] : [4];
        const groups = Array.from({ length: groupCount }, (_, index) => ({
          name: format === "KNOCKOUT" ? "Nhánh loại trực tiếp" : `Bảng ${String.fromCharCode(65 + index)}`,
          teamIds: hybrid ? teamIds.slice(index * 2, index * 2 + 2) : teamIds,
        }));
        const input = {
          method: method === "MANUAL" ? "MANUAL" : "RANDOM",
          groupCount,
          teamsPerGroup,
          ...(hybrid ? { maxTeamsPerGroup: 2 } : {}),
          noSameInstitution: false,
          ...(method === "MANUAL" ? { groups } : {}),
        };

        if (method === "DIRECT") {
          sessionTournamentIds.push(tournamentId);
          const scheduledAt = new Date(Date.now() + 1200).toISOString();
          const scheduled = await startLiveDraw(tournamentId, input, actorId, {
            eventName: `Integration live draw ${format}`,
            scheduledAt,
            timeZone: "Asia/Ho_Chi_Minh",
            announcement: "Isolated integration fixture",
          });
          assert.equal(scheduled.status, "SCHEDULED", `${format}/DIRECT schedule`);
          assert.equal(scheduled.picks.length, 0, `${format}/DIRECT hides unrevealed picks`);
          await assert.rejects(startScheduledLiveDraw(tournamentId, actorId), (error) => error.code === "LIVE_DRAW_NOT_DUE");
          await new Promise((resolve) => setTimeout(resolve, 1250));
          const live = await startScheduledLiveDraw(tournamentId, actorId);
          assert.equal(live.status, "LIVE", `${format}/DIRECT starts only after server time`);
          let completed;
          for (let sequence = 0; sequence < teamIds.length; sequence += 1) {
            completed = await advanceLiveDrawPick(tournamentId, sequence, actorId, `${format}-pick-${sequence + 1}`);
          }
          assert.equal(completed.state.status, "FINALIZED", `${format}/DIRECT finalizes after last pick`);
          assert.equal(completed.draw.status, "PUBLISHED", `${format}/DIRECT publishes the official draw`);
          assert.equal(completed.draw.groups.reduce((sum, group) => sum + group.assignments.length, 0), teamIds.length);
          assert.equal((await getPublicDraw(tournamentId)).status, "PUBLISHED");
        } else {
          const preview = await previewDraw(tournamentId, input);
          assert.equal(preview.unassignedTeamIds.length, 0, `${format}/${method} leaves no teams unassigned`);
          assert.equal(preview.groups.reduce((sum, group) => sum + group.assignments.length, 0), teamIds.length);
          assert.equal(new Set(preview.groups.flatMap((group) => group.assignments.map((assignment) => assignment.teamId))).size, teamIds.length);

          const draft = await saveDrawWorkflowDraft(tournamentId, input, actorId);
          assert.equal(draft.status, "DRAFT", `${format}/${method} saves a persisted draft`);
          const reopened = (await getDrawManagement(tournamentId)).latestVersion;
          assert.equal(reopened.id, draft.id, `${format}/${method} reopens the same draft`);
          assert.equal(reopened.groups.reduce((sum, group) => sum + group.assignments.length, 0), teamIds.length);
          const confirmed = await confirmDrawWorkflow(tournamentId, method, actorId);
          assert.equal(confirmed.status, "CONFIRMED", `${format}/${method} confirms the draft`);
          const published = await publishDrawWorkflow(tournamentId, method, actorId);
          assert.equal(published.status, "PUBLISHED", `${format}/${method} publishes the draw`);
          assert.equal(published.config.fixtureRegulationSnapshot.regulationVersion, 7);
          assert.equal((await getPublicDraw(tournamentId)).id, published.id);
        }
      }
    }
  } finally {
    global.fetch = originalFetch;
    config.internalApiKey = originalKey;
    for (const tournamentId of sessionTournamentIds) {
      await pool.query("DELETE FROM tournament_live_draw_sessions WHERE tournament_id=$1", [tournamentId]);
    }
    for (const tournamentId of tournamentIds) {
      await pool.query("DELETE FROM tournament_draw_assignments WHERE draw_version_id IN (SELECT id FROM tournament_draw_versions WHERE tournament_id=$1)", [tournamentId]);
      await pool.query("DELETE FROM tournament_draw_groups WHERE draw_version_id IN (SELECT id FROM tournament_draw_versions WHERE tournament_id=$1)", [tournamentId]);
      await pool.query("DELETE FROM tournament_draw_versions WHERE tournament_id=$1", [tournamentId]);
      await pool.query("DELETE FROM tournaments WHERE id=$1", [tournamentId]);
    }
    await closePool();
  }
});
