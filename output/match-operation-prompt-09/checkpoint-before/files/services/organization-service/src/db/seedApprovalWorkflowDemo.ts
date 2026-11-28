import { createHash } from "node:crypto";
import { Pool } from "pg";

const schoolCodes = ["SFL-HCM-IUH", "SFL-HCM-HUTECH", "SFL-HCM-UEF", "SFL-HCM-UEH", "SFL-HCM-CAOTHANG", "SFL-HCM-HITU", "SFL-HCM-TDC", "SFL-HCM-HCMCT"];
const variant = process.env.TEST_SEED_VARIANT;
const tournamentSpecs = [
  { key: "approval-draw-iuh-2026", teams: Array.from({ length: 8 }, (_, index) => index + 1) },
  { key: "approval-draw-inter-2026", teams: [9, ...Array.from({ length: 15 }, (_, index) => index + 11)] },
];
if (variant === "draw-demo" || variant === "draw-demo-reset") {
  tournamentSpecs.splice(0, tournamentSpecs.length, {
    key: "draw-workspace-demo-2026",
    teams: Array.from({ length: 32 }, (_, index) => index + 1),
  });
} else if (variant === "expanded-1") {
  tournamentSpecs.splice(0, tournamentSpecs.length, {
    key: "sftms-test-seed-1-expanded-2026",
    teams: Array.from({ length: 12 }, (_, index) => index + 1),
  }, {
    key: "sftms-test-seed-1-overlap-2026",
    teams: [1],
  });
} else if (variant === "review-1") {
  tournamentSpecs.splice(0, tournamentSpecs.length, {
    key: "sftms-test-seed-1-review-2026",
    teams: Array.from({ length: 12 }, (_, index) => index + 1),
  });
} else if (variant === "overlap-1") {
  tournamentSpecs.splice(0, tournamentSpecs.length, {
    key: "sftms-test-seed-1-overlap-a-2026",
    teams: [13],
  }, {
    key: "sftms-test-seed-1-overlap-2026",
    teams: [13],
  });
} else if (variant) {
  const n = Number(variant);
  if (!Number.isInteger(n) || n < 1 || n > 4) throw new Error("TEST_SEED_VARIANT must be 1, 2, 3 or 4");
  tournamentSpecs.splice(0, tournamentSpecs.length, {
    key: `sftms-test-seed-${n}-2026`,
    teams: Array.from({ length: n <= 2 ? 8 : 16 }, (_, index) => index + 1),
  });
}

function idFor(key: string): string {
  const bytes = createHash("sha256").update(`sftms-demo-dataset-v1:${key}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function main(): Promise<void> {
  if (!(process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test")) throw new Error("Approval workflow demo seeding is restricted to development/test");
  const databaseUrl = process.env.DATABASE_URL;
  const tournamentUrl = process.env.TOURNAMENT_SERVICE_URL;
  const internalApiKey = process.env.INTERNAL_API_KEY;
  if (!databaseUrl || !tournamentUrl || !internalApiKey) throw new Error("DATABASE_URL, TOURNAMENT_SERVICE_URL and INTERNAL_API_KEY are required");
  const pool = new Pool({ connectionString: databaseUrl });
  let overlapTeamNumber: number | null = null;
  const registrationRows: Array<{ registrationId: string; teamId: string; tournamentId: string; institutionId: string; status: "PENDING" | "APPROVED" | "WITHDRAWN"; playerIds: string[]; invitations: Array<{ invitationId: string; playerId: string }> }> = [];
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('sftms-demo-approval-workflow-organization-v1')::bigint)");
      if (variant === "review-1") {
        // This opt-in reset is scoped to the dedicated Seed 1 review fixture.
        // It never touches any other tournament or shared team/player account.
        const reviewTournamentId = idFor("sftms-test-seed-1-review-2026");
        await client.query("DELETE FROM team_registration_decision_outbox WHERE tournament_id=$1", [reviewTournamentId]);
        await client.query("DELETE FROM tournament_player_invitations WHERE tournament_id=$1", [reviewTournamentId]);
        await client.query("DELETE FROM rosters WHERE tournament_id=$1", [reviewTournamentId]);
        await client.query("DELETE FROM team_registrations WHERE tournament_id=$1", [reviewTournamentId]);
      }
      if (variant === "draw-demo-reset") {
        // Explicit, isolated reset for only the deterministic Draw workspace fixture.
        const drawDemoTournamentId = idFor("draw-workspace-demo-2026");
        await client.query("DELETE FROM team_registration_decision_outbox WHERE tournament_id=$1", [drawDemoTournamentId]);
        await client.query("DELETE FROM tournament_player_invitations WHERE tournament_id=$1", [drawDemoTournamentId]);
        await client.query("DELETE FROM rosters WHERE tournament_id=$1", [drawDemoTournamentId]);
        await client.query("DELETE FROM team_registrations WHERE tournament_id=$1", [drawDemoTournamentId]);
      }
      const requiredSchoolCodes = variant === "draw-demo" || variant === "draw-demo-reset"
        ? schoolCodes
        : variant === "expanded-1" || variant === "review-1" || variant === "overlap-1" || (variant && Number(variant) <= 2)
        ? [schoolCodes[0]!]
        : schoolCodes.slice(0, 4);
      const schoolRows = await client.query<{ id: string; code: string }>(
        "SELECT id,code FROM institutions WHERE code=ANY($1::text[]) AND ($2::boolean OR (is_active=TRUE AND status='ACTIVE'))", [requiredSchoolCodes, variant === "draw-demo" || variant === "draw-demo-reset"],
      );
      const schools = new Map(schoolRows.rows.map((row) => [row.code,row.id]));
      if (requiredSchoolCodes.some((code) => !schools.has(code))) throw new Error(`Required active test schools are missing: ${requiredSchoolCodes.filter((code) => !schools.has(code)).join(", ")}`);

      if (variant === "overlap-1") {
        overlapTeamNumber = 13;
        const teamId = idFor("dataset-team-13");
        const team = await client.query("SELECT id FROM teams WHERE id=$1 AND is_active=TRUE", [teamId]);
        if (!team.rowCount) throw new Error("Seed 1 overlap fixture requires demo team 13; run the additive account and club seed first");
      }

      for (const tournament of tournamentSpecs) {
        const tournamentId = idFor(tournament.key);
        for (const teamNumber of tournament.teams) {
          const isDrawDemo = tournament.key === "draw-workspace-demo-2026";
          const teamId = idFor(isDrawDemo ? `draw-demo-team-${String(teamNumber).padStart(2,"0")}` : `dataset-team-${String(teamNumber).padStart(2,"0")}`);
          const captainId = idFor(isDrawDemo ? `draw-demo-captain-${String(teamNumber).padStart(2,"0")}` : `dataset-captain-${String(teamNumber).padStart(2,"0")}`);
          const registrationId = idFor(`${tournament.key}-registration-${String(teamNumber).padStart(2,"0")}`);
          const team = await client.query<{ institution_id: string; captain_id: string; is_active: boolean }>("SELECT institution_id,captain_id,is_active FROM teams WHERE id=$1", [teamId]);
          if (!team.rowCount || team.rows[0]!.captain_id !== captainId || !team.rows[0]!.is_active) throw new Error(`Demo Club ${teamNumber} is missing, inactive or has a different captain; run the account/club seed first`);
          const institutionId = team.rows[0]!.institution_id;
          if ((tournament.key === "approval-draw-iuh-2026" || variant === "1" || variant === "2" || variant === "review-1") && institutionId !== schools.get("SFL-HCM-IUH")) throw new Error(`Internal tournament received a non-IUH club: ${teamId}`);

          const selected = await client.query<{ id: string; user_id: string; full_name: string; student_id: string; jersey_number: number | null; position: string | null }>(
            `SELECT id,user_id,full_name,student_id,jersey_number,position FROM players
             WHERE team_id=$1 AND left_at IS NULL AND user_id IS NOT NULL AND NULLIF(BTRIM(full_name),'') IS NOT NULL
               AND NULLIF(BTRIM(student_id),'') IS NOT NULL ORDER BY jersey_number,id LIMIT 14`, [teamId],
          );
          if (selected.rowCount !== 14) throw new Error(`Team ${teamId} needs at least 14 linked, complete active players`);
          const jerseys = selected.rows.map((player) => player.jersey_number).filter((value): value is number => Number.isInteger(value));
          if (new Set(jerseys).size !== jerseys.length) throw new Error(`Duplicate jersey number in team ${teamId}`);

            const roster = selected.rows.map((player, index) => ({
            playerId: player.id, userId: player.user_id, playerName: player.full_name!, studentId: player.student_id!,
            competitionRole: "PLAYER", lineupRole: (index < 7 ? "STARTER" : "SUBSTITUTE") as "STARTER" | "SUBSTITUTE",
            isGoalkeeper: index === 0, jerseyNumber: player.jersey_number ?? index + 1,
            position: player.position ?? (index === 0 ? "GK" : "MID"),
          }));
          const nextSubmission = await client.query<{ next_sequence: string }>(
            "SELECT COALESCE(MAX(submission_sequence),0)::bigint + 1 AS next_sequence FROM team_registrations WHERE tournament_id=$1",
            [tournamentId],
          );
          const targetStatus = tournament.key === "draw-workspace-demo-2026" ? "APPROVED" : "PENDING";
          const inserted = await client.query(
            `INSERT INTO team_registrations(id,team_id,tournament_id,institution_id,status,registered_at,notes,version,submitted_at,submission_sequence,submitted_roster)
             VALUES($1,$2,$3,$4,$7,NOW()-INTERVAL '2 hours',NULL,1,NOW()-INTERVAL '2 hours',$5,$6::jsonb)
             ON CONFLICT(team_id,tournament_id) DO NOTHING RETURNING id`,
            [registrationId,teamId,tournamentId,institutionId,nextSubmission.rows[0]!.next_sequence,JSON.stringify(roster.map(({ userId: _userId, ...entry }) => entry)),targetStatus],
          );
          const existing = inserted.rowCount ? { id: registrationId, status: targetStatus } : (await client.query<{ id: string; status: string }>("SELECT id,status FROM team_registrations WHERE team_id=$1 AND tournament_id=$2", [teamId,tournamentId])).rows[0];
          if (!existing) throw new Error(`Could not resolve registration for team ${teamNumber}`);
          if (existing.id !== registrationId) throw new Error(`An unrelated registration already exists for demo team ${teamNumber} and new tournament`);
          if (existing.status === "PENDING" || (tournament.key === "draw-workspace-demo-2026" && existing.status === "APPROVED")) {
            const invitations: Array<{ invitationId: string; playerId: string }> = [];
            for (let index = 0; index < roster.length; index += 1) {
              const player = roster[index]!;
              const invitationId = idFor(`${tournament.key}-invitation-${String(teamNumber).padStart(2,"0")}-${String(index + 1).padStart(2,"0")}`);
              invitations.push({ invitationId, playerId: player.playerId });
              await client.query(
                `INSERT INTO tournament_player_invitations(id,tournament_id,team_id,player_id,player_user_id,invited_by,
                  competition_role,lineup_role,is_goalkeeper,proposed_jersey_number,position_snapshot,message,status,expires_at,responded_at)
                 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'Đồng ý trước trong bộ dữ liệu kiểm thử nội bộ. Không gửi email.',
                  'ACCEPTED',NOW()+INTERVAL '90 days',NOW()-INTERVAL '1 hour')
                 ON CONFLICT(id) DO NOTHING`,
                [invitationId,tournamentId,teamId,player.playerId,player.userId,captainId,player.competitionRole,player.lineupRole,player.isGoalkeeper,player.jerseyNumber,player.position],
              );
              await client.query(
                `INSERT INTO rosters(team_id,tournament_id,player_id,lineup_role,is_goalkeeper,competition_role,
                  jersey_number_snapshot,position_snapshot,player_name_snapshot,student_id_snapshot,is_verified,review_status)
                 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,FALSE,'PENDING') ON CONFLICT(team_id,tournament_id,player_id) DO NOTHING`,
                [teamId,tournamentId,player.playerId,player.lineupRole,player.isGoalkeeper,player.competitionRole,player.jerseyNumber,player.position,player.playerName,player.studentId],
              );
            }
            await client.query(
              `INSERT INTO team_registration_versions(registration_id,version,action,roster_snapshot,note,actor_id)
               VALUES($1,1,'SUBMITTED',$2::jsonb,'Hồ sơ demo đã nộp; lời mời cầu thủ được xác nhận trong seed, không phát email.',$3)
               ON CONFLICT DO NOTHING`,
              [registrationId,JSON.stringify(roster.map(({ userId: _userId, ...entry }) => entry)),captainId],
            );
            registrationRows.push({ registrationId,teamId,tournamentId,institutionId,status:targetStatus as "PENDING" | "APPROVED", playerIds:roster.map((player) => player.playerId), invitations });
          }
        }
      }
      // Retire the extra pending record from the first pre-release draft of this new fixture.
      const previousInterTournamentId = idFor("approval-draw-inter-2026");
      const previousExtraTeamId = idFor("dataset-team-26");
      const previousExtraRegistrationId = idFor("approval-draw-inter-2026-registration-26");
      const corrected = await client.query<{ status: string; institution_id: string | null }>(
        `UPDATE team_registrations SET status='WITHDRAWN',notes='Bản ghi ngoài danh sách 16 đội được giữ lại; rút khỏi fixture trước khi bắt đầu kiểm thử.'
         WHERE id=$1 AND team_id=$2 AND tournament_id=$3 AND status='PENDING'
         RETURNING status,institution_id`, [previousExtraRegistrationId,previousExtraTeamId,previousInterTournamentId],
      );
      const previousExtra = corrected.rows[0] ?? (await client.query<{ status: string; institution_id: string | null }>(
        `SELECT status,institution_id FROM team_registrations WHERE id=$1 AND team_id=$2 AND tournament_id=$3
         AND status='WITHDRAWN' AND notes LIKE 'Bản ghi ngoài danh sách 16 đội được giữ lại%'`,
        [previousExtraRegistrationId,previousExtraTeamId,previousInterTournamentId],
      )).rows[0];
      if (previousExtra?.status === "WITHDRAWN" && previousExtra.institution_id) {
        await client.query(
          `DELETE FROM tournament_player_invitations WHERE team_id=$1 AND tournament_id=$2
           AND EXISTS(SELECT 1 FROM team_registrations WHERE id=$3 AND status='WITHDRAWN'
             AND notes LIKE 'Bản ghi ngoài danh sách 16 đội được giữ lại%')`, [previousExtraTeamId,previousInterTournamentId,previousExtraRegistrationId],
        );
        await client.query(
          `DELETE FROM rosters WHERE team_id=$1 AND tournament_id=$2
           AND EXISTS(SELECT 1 FROM team_registrations WHERE id=$3 AND status='WITHDRAWN'
             AND notes LIKE 'Bản ghi ngoài danh sách 16 đội được giữ lại%')`, [previousExtraTeamId,previousInterTournamentId,previousExtraRegistrationId],
        );
        await client.query(
          `DELETE FROM team_registrations WHERE id=$1 AND team_id=$2 AND tournament_id=$3 AND status='WITHDRAWN'
           AND notes LIKE 'Bản ghi ngoài danh sách 16 đội được giữ lại%'`, [previousExtraRegistrationId,previousExtraTeamId,previousInterTournamentId],
        );
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }

    // Reconcile reservation and accepted-player claims through Tournament's API;
    // Organization never writes into another service's database.
    const reconcileResponse = await fetch(new URL("/internal/player-participation/reconcile", tournamentUrl), {
      method: "POST", headers: { "content-type": "application/json", "x-gateway-internal-key": internalApiKey },
      body: JSON.stringify({ claims: registrationRows.map((row) => ({ ...row, status: row.status, playerIds: row.playerIds })) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!reconcileResponse.ok) throw new Error(`Could not synchronize tournament reservations: HTTP ${reconcileResponse.status} ${await reconcileResponse.text()}`);
    for (const row of registrationRows) {
      for (const invitation of row.invitations) {
        const response = await fetch(new URL("/internal/player-participation/invitations/reserve", tournamentUrl), {
          method: "POST", headers: { "content-type": "application/json", "x-gateway-internal-key": internalApiKey },
          body: JSON.stringify({ invitationId: invitation.invitationId, tournamentId: row.tournamentId, teamId: row.teamId, playerId: invitation.playerId }),
          signal: AbortSignal.timeout(8_000),
        });
        if (!response.ok) throw new Error(`Could not synchronize accepted player ${invitation.playerId}: HTTP ${response.status} ${await response.text()}`);
      }
    }
    const tournamentIds = tournamentSpecs.map((item) => idFor(item.key));
    const expectedTeamsByTournament = new Map(tournamentSpecs.map((item) => [idFor(item.key), item.teams.length]));
    const summary = await pool.query(
      `SELECT tr.tournament_id,
          COUNT(DISTINCT tr.id) FILTER(WHERE tr.status='PENDING')::int AS pending,
          COUNT(DISTINCT tr.id) FILTER(WHERE tr.status IN ('APPROVED','REJECTED'))::int AS decided,
          COUNT(DISTINCT tr.team_id)::int AS teams,
          COUNT(DISTINCT r.id)::int AS roster_rows,
          COUNT(DISTINCT i.id) FILTER(WHERE i.status='ACCEPTED')::int AS accepted_invitations,
          COUNT(DISTINCT i.id) FILTER(WHERE i.status='PENDING')::int AS pending_invitations,
          COUNT(DISTINCT p.id) FILTER(WHERE p.left_at IS NULL AND p.user_id IS NOT NULL)::int AS active_linked_players
       FROM team_registrations tr
       LEFT JOIN rosters r ON r.team_id=tr.team_id AND r.tournament_id=tr.tournament_id
       LEFT JOIN tournament_player_invitations i ON i.team_id=tr.team_id AND i.tournament_id=tr.tournament_id
       LEFT JOIN teams t ON t.id=tr.team_id
       LEFT JOIN players p ON p.team_id=t.id AND p.left_at IS NULL AND p.user_id IS NOT NULL
       WHERE tr.tournament_id=ANY($1::uuid[]) GROUP BY tr.tournament_id ORDER BY tr.tournament_id`, [tournamentIds],
    );
    for (const item of summary.rows) {
      const expectedTeams = expectedTeamsByTournament.get(item.tournament_id);
      if (expectedTeams === undefined) throw new Error(`Unexpected seeded tournament in summary: ${item.tournament_id}`);
      const expectedRoster = expectedTeams * 14;
      const isDrawDemo = variant === "draw-demo";
      if ((isDrawDemo ? item.pending !== 0 || item.decided !== expectedTeams : item.pending !== expectedTeams || item.decided !== 0) || item.teams !== expectedTeams ||
          item.roster_rows !== expectedRoster || item.accepted_invitations !== expectedRoster ||
          item.pending_invitations !== 0 || item.active_linked_players !== expectedTeams * 20) {
        throw new Error(`Seed integrity check failed for tournament ${item.tournament_id}: ${JSON.stringify(item)}`);
      }
    }
    if (summary.rowCount !== tournamentIds.length) throw new Error(`Expected ${tournamentIds.length} tournament summary rows, found ${summary.rowCount}`);
    console.log(JSON.stringify({ seed: "approval-workflow-demo-registrations", variant: variant ?? null, emailSent: false,
      overlapTeamNumber, expectedTeamsPerTournament: Object.fromEntries(expectedTeamsByTournament), playersPerTeam: 20, rosterPerTeam: 14, tournaments: summary.rows }, null, 2));
  } finally { await pool.end(); }
}

if (require.main === module) main().catch((error: unknown) => { console.error("[approval-workflow-demo-registrations] failed", error); process.exitCode = 1; });
