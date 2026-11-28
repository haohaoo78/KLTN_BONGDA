const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const test = require("node:test");

const enabled = process.env.RUN_TOURNAMENT_DB_INTEGRATION === "1";

test("server draw validation covers random, manual and seeded allocations in all three competition formats", { skip: !enabled }, async () => {
  const { getPool, closePool } = require("../dist/lib/db.js");
  const { config } = require("../dist/config.js");
  const { previewDraw } = require("../dist/services/drawWorkflowService.js");
  const pool = getPool();
  const originalInternalApiKey = config.internalApiKey;
  config.internalApiKey = "integration-test-internal-key";
  const actorId = randomUUID();
  const tournamentIds = [];
  const originalFetch = global.fetch;
  const teamIds = Array.from({ length: 4 }, () => randomUUID());
  const candidates = teamIds.map((teamId, index) => ({
    teamId, name: `Integration club ${index + 1}`, shortName: `IC${index + 1}`, logoUrl: null,
    institutionId: randomUUID(), institutionName: `Institution ${index + 1}`, isActive: true,
    registrationStatus: "APPROVED", verifiedRosterCount: 12, totalRosterCount: 12,
  }));
  global.fetch = async () => new Response(JSON.stringify({ candidates }), { status: 200, headers: { "content-type": "application/json" } });

  try {
    const formats = ["ROUND_ROBIN", "KNOCKOUT", "GROUP_AND_KNOCKOUT"];
    for (const format of formats) {
      const tournamentId = randomUUID();
      tournamentIds.push(tournamentId);
      const groupCount = format === "GROUP_AND_KNOCKOUT" ? 2 : 1;
      const config = {
        groupCountMode: format === "GROUP_AND_KNOCKOUT" ? "FIXED" : "AUTO_BY_CAPACITY",
        groupCount: format === "GROUP_AND_KNOCKOUT" ? 2 : null,
        groupAllocation: "BALANCED", groupDrawMethod: "RANDOM", sameInstitutionPolicy: "NONE",
        knockoutPairing: "FIXED_CROSSOVER", byePolicy: "AUTOMATIC", knockoutLegs: 1,
        thirdPlaceMatch: false, schedulingStartTime: "08:00", schedulingEndTime: "22:00",
      };
      await pool.query(
        `INSERT INTO tournaments (id,name,status,scope,football_format,competition_format,min_teams,max_teams,min_players,max_players_per_team,created_by)
         VALUES ($1,$2,'ROSTER_LOCKED','INTER_SCHOOL',7,$3,4,8,7,18,$4)`,
        [tournamentId, `Draw combinations ${format}`, format, actorId],
      );
      await pool.query(
        `INSERT INTO tournament_rules (tournament_id,published_version,published_at,published_by,max_teams_per_group,competition_config)
         VALUES ($1,1,NOW(),$2,$3,$4::jsonb)`,
        [tournamentId, actorId, format === "GROUP_AND_KNOCKOUT" ? 4 : null, JSON.stringify(config)],
      );
      for (const teamId of teamIds) {
        await pool.query(
          `INSERT INTO tournament_registration_reservations (registration_id,tournament_id,team_id,institution_id,status,persisted_in_organization)
           VALUES ($1,$2,$3,$4,'APPROVED',TRUE)`,
          [randomUUID(), tournamentId, teamId, randomUUID()],
        );
      }

      for (const method of ["RANDOM", "MANUAL", "SEEDED"]) {
        const teamsPerGroup = format === "GROUP_AND_KNOCKOUT" ? [2, 2] : [4];
        const groups = method === "MANUAL"
          ? Array.from({ length: groupCount }, (_, groupIndex) => ({ name: format === "KNOCKOUT" ? "Nhánh loại trực tiếp" : `Bảng ${String.fromCharCode(65 + groupIndex)}`, teamIds: teamIds.slice(groupIndex * 2, groupIndex * 2 + (format === "GROUP_AND_KNOCKOUT" ? 2 : 4)) }))
          : undefined;
        const seedings = method === "SEEDED"
          ? teamIds.map((teamId, index) => ({ teamId, seedGroup: format === "GROUP_AND_KNOCKOUT" ? Math.floor(index / 2) + 1 : index + 1 }))
          : undefined;
        const result = await previewDraw(tournamentId, {
          method, groupCount, teamsPerGroup,
          ...(format === "GROUP_AND_KNOCKOUT" ? { maxTeamsPerGroup: 4 } : {}),
          noSameInstitution: false, ...(groups ? { groups } : {}), ...(seedings ? { seedings } : {}),
        });
        assert.equal(result.unassignedTeamIds.length, 0, `${format}/${method} leaves no teams unassigned`);
        assert.equal(result.groups.reduce((sum, group) => sum + group.assignments.length, 0), 4, `${format}/${method} assigns the exact approved roster`);
        assert.equal(new Set(result.groups.flatMap((group) => group.assignments.map((assignment) => assignment.teamId)).values()).size, 4, `${format}/${method} does not duplicate teams`);
        if (format === "KNOCKOUT") assert.equal(result.groups[0].name, "Nhánh loại trực tiếp");
      }
    }
  } finally {
    global.fetch = originalFetch;
    config.internalApiKey = originalInternalApiKey;
    for (const tournamentId of tournamentIds) await pool.query("DELETE FROM tournaments WHERE id=$1", [tournamentId]);
    await closePool();
  }
});
