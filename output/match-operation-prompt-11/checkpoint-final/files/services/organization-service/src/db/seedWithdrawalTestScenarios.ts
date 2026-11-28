import { createHash } from "node:crypto";
import { Pool } from "pg";

const seedTournamentId = "5b3e59ec-233b-5de2-8482-079e80e8c8d4";

function uuidFor(namespace: string, value: string): string {
  const bytes = createHash("sha256").update(`${namespace}:${value}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV !== "development" && process.env.NODE_ENV !== "test") {
    throw new Error("Seed 1 withdrawal scenarios are restricted to development/test");
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const teamId = uuidFor("sftms-demo-dataset-v1", "dataset-team-02");
    const captainId = uuidFor("sftms-demo-dataset-v1", "dataset-captain-02");
    const registration = await pool.query<{ id: string; status: string; captain_id: string; team_name: string }>(
      `SELECT registration.id,registration.status,team.captain_id,team.name AS team_name
       FROM team_registrations registration JOIN teams team ON team.id=registration.team_id
       WHERE registration.team_id=$1 AND registration.tournament_id=$2`,
      [teamId, seedTournamentId],
    );
    if (!registration.rowCount || registration.rows[0]!.status !== "APPROVED" || registration.rows[0]!.captain_id !== captainId) {
      throw new Error("Seed 1 withdrawal fixture requires the existing APPROVED IUH Demo Club 02 registration; no existing data was changed");
    }

    const existingPending = await pool.query<{ id: string }>(
      `SELECT id FROM team_registration_withdrawal_requests
       WHERE registration_id=$1 AND status IN ('PENDING','PROCESSING') ORDER BY created_at DESC LIMIT 1`,
      [registration.rows[0]!.id],
    );
    let requestId = existingPending.rows[0]?.id;
    if (!requestId) {
      const previous = await pool.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM team_registration_withdrawal_requests WHERE registration_id=$1",
        [registration.rows[0]!.id],
      );
      requestId = uuidFor("sftms-seed1-withdrawal", `team02-request-${Number(previous.rows[0]!.count) + 1}`);
      await pool.query(
        `INSERT INTO team_registration_withdrawal_requests(id,registration_id,team_id,tournament_id,requested_by,reason,status)
         VALUES($1,$2,$3,$4,$5,$6,'PENDING') ON CONFLICT(id) DO NOTHING`,
        [requestId,registration.rows[0]!.id,teamId,seedTournamentId,captainId,
          "Fixture Seed 1: BTC tự quyết định chấp thuận hoặc từ chối yêu cầu rút đội IUH Demo Club 02."],
      );
    }

    const request = await pool.query<{ id: string; status: string }>(
      "SELECT id,status FROM team_registration_withdrawal_requests WHERE id=$1 AND registration_id=$2",
      [requestId, registration.rows[0]!.id],
    );
    if (!request.rowCount || request.rows[0]!.status !== "PENDING") {
      throw new Error("Could not prepare a pending team-withdrawal decision fixture");
    }

    const playerFixtures = await pool.query<{ email: string; team_name: string; registration_status: string; invitation_status: string; withdrawal_request_status: string | null; has_draft: boolean }>(
      `SELECT player.contact_email AS email,team.name AS team_name,COALESCE(registration.status,'DRAFT') AS registration_status,
         invitation.status AS invitation_status,withdrawal.status AS withdrawal_request_status,
         EXISTS(SELECT 1 FROM tournament_registration_drafts draft
           WHERE draft.team_id=invitation.team_id AND draft.tournament_id=invitation.tournament_id) AS has_draft
       FROM tournament_player_invitations invitation
       JOIN players player ON player.id=invitation.player_id
       JOIN teams team ON team.id=invitation.team_id
       LEFT JOIN team_registrations registration ON registration.team_id=invitation.team_id AND registration.tournament_id=invitation.tournament_id
       LEFT JOIN tournament_player_withdrawal_requests withdrawal ON withdrawal.invitation_id=invitation.id
       WHERE (player.contact_email='dataset.player0602@football.local' AND invitation.tournament_id='12050c82-ca1e-5174-9f23-6065cf7b58b5')
          OR (player.contact_email='dataset.player0241@football.local'
              AND invitation.tournament_id='7e9e92fb-612f-59ce-ad7d-708f5cd025b2')
          OR (player.contact_email='dataset.player0242@football.local'
              AND invitation.tournament_id='e79175f2-47ab-5957-ae91-9b2437f13be2')
          OR (player.contact_email='dataset.player0002@football.local' AND invitation.tournament_id=$1)
       ORDER BY player.contact_email`,
      [seedTournamentId],
    );
    const expectedStatuses: Record<string, string> = {
      "dataset.player0602@football.local": "DRAFT",
      "dataset.player0241@football.local": "PENDING",
      "dataset.player0242@football.local": "REVISION_REQUIRED",
      "dataset.player0002@football.local": "APPROVED",
    };
    const missing = Object.entries(expectedStatuses).filter(([email, status]) => {
      const fixture = playerFixtures.rows.find((row) => row.email === email);
      return !fixture || fixture.invitation_status !== "ACCEPTED" || fixture.registration_status !== status
        || (email === "dataset.player0602@football.local" && !fixture.has_draft);
    }).map(([email, status]) => `${email} (${status})`);
    if (missing.length) throw new Error(`Required accepted Seed 1 player fixture is missing: ${missing.join(", ")}`);

    console.log(JSON.stringify({
      seed: "Seed 1 withdrawal manual scenarios",
      existingDataPreserved: true,
      playerFixtures: playerFixtures.rows,
      teamWithdrawal: {
        tournamentId: seedTournamentId,
        team: registration.rows[0]!.team_name,
        captain: "dataset.captain02@football.local",
        registrationStatus: registration.rows[0]!.status,
        requestId,
        requestStatus: "PENDING",
        decision: "BTC must choose; seed does not decide",
      },
      existingCaptain01Withdrawal: "IUH Demo Club 01 already has its separate pending request; use one fixture for approve and the other for reject.",
      limitation: "No active match/draw withdrawal fixture is synthesized; post-draw and in-progress requests require the competition-change workflow.",
    }, null, 2));
  } finally {
    await pool.end();
  }
}

if (require.main === module) main().catch((error: unknown) => {
  console.error("[seed1-withdrawal-test-scenarios] failed", error);
  process.exitCode = 1;
});
