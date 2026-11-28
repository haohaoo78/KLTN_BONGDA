import { createHash } from "node:crypto";
import { Pool } from "pg";

const tournaments = {
  A: { id: "12050c82-ca1e-5174-9f23-6065cf7b58b5", key: "A" },
  B: { id: "3b78de98-ed74-5980-83d9-6fee8237ed1c", key: "B" },
  C: { id: "ffa6a2b7-cda0-5b48-ae72-4d67cb36a273", key: "C" },
} as const;

type Fixture = {
  key: string;
  tournamentKey: keyof typeof tournaments;
  teamNumber: 14 | 15 | 16;
  withdrawJersey?: number;
  invalidAfterWithdrawal?: boolean;
  draftOnly?: boolean;
};

const fixtures: Fixture[] = [
  { key: "PENDING-clean-team14-A", tournamentKey: "A", teamNumber: 14 },
  { key: "PENDING-DRAFT_CHANGES-valid-team15-C", tournamentKey: "C", teamNumber: 15, withdrawJersey: 8 },
  { key: "PENDING-DRAFT_CHANGES-missing-GK-team16-B", tournamentKey: "B", teamNumber: 16, withdrawJersey: 1, invalidAfterWithdrawal: true },
  { key: "DRAFT-team14-C", tournamentKey: "C", teamNumber: 14, draftOnly: true },
];

function idFor(key: string): string {
  const bytes = createHash("sha256").update(`sftms-demo-dataset-v1:${key}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function api(url: URL, method: "GET" | "POST" | "PATCH", key: string, body?: Record<string, unknown>) {
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json", "x-gateway-internal-key": key },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(8_000),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, any>;
  if (!response.ok) throw new Error(`Fixture API ${method} ${url.pathname} failed: HTTP ${response.status} ${payload.error?.code ?? ""} ${payload.error?.message ?? ""}`);
  return payload;
}

async function main(): Promise<void> {
  if (!(["development", "test"].includes(process.env.NODE_ENV ?? ""))) throw new Error("Seed 1 withdrawal-stage fixtures are restricted to development/test");
  const databaseUrl = process.env.DATABASE_URL;
  const tournamentServiceUrl = process.env.TOURNAMENT_SERVICE_URL;
  const internalApiKey = process.env.INTERNAL_API_KEY;
  if (!databaseUrl || !tournamentServiceUrl || !internalApiKey) throw new Error("DATABASE_URL, TOURNAMENT_SERVICE_URL and INTERNAL_API_KEY are required");

  const tournamentInfo = new Map<string, { id: string; name: string; startDate: string; endDate: string; minPlayers: number; maxPlayers: number; minGoalkeepers: number; footballFormat: number }>();
  for (const [key, source] of Object.entries(tournaments)) {
    const payload = await api(new URL(`/tournaments/${source.id}`, tournamentServiceUrl), "GET", internalApiKey);
    const tournament = payload.tournament;
    if (!tournament?.id || !tournament.startDate || !tournament.endDate || !tournament.minPlayers || !tournament.maxPlayersPerTeam || !tournament.footballFormat) {
      throw new Error(`Tournament ${key} is missing dates or roster rules`);
    }
    tournamentInfo.set(key, {
      id: tournament.id,
      name: tournament.name,
      startDate: String(tournament.startDate).slice(0, 10),
      endDate: String(tournament.endDate).slice(0, 10),
      minPlayers: Number(tournament.minPlayers),
      maxPlayers: Number(tournament.maxPlayersPerTeam),
      minGoalkeepers: Number(tournament.minGoalkeepers ?? 0),
      footballFormat: Number(tournament.footballFormat),
    });
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const report: Array<Record<string, unknown>> = [];
  try {
    for (const fixture of fixtures) {
      const tournament = tournamentInfo.get(fixture.tournamentKey)!;
      const teamId = idFor(`dataset-team-${String(fixture.teamNumber).padStart(2, "0")}`);
      const captainId = idFor(`dataset-captain-${String(fixture.teamNumber).padStart(2, "0")}`);
      const registrationId = fixture.draftOnly ? null : idFor(fixture.key);
      const teamResult = await pool.query<{ id: string; captain_id: string; institution_id: string | null; name: string }>(
        "SELECT id,captain_id,institution_id,name FROM teams WHERE id=$1", [teamId],
      );
      if (!teamResult.rowCount || teamResult.rows[0]!.captain_id !== captainId || !teamResult.rows[0]!.institution_id) {
        throw new Error(`Expected seeded Club ${fixture.teamNumber} with its deterministic captain and institution`);
      }
      const institutionId = teamResult.rows[0]!.institution_id!;
      const playersResult = await pool.query<{
        id: string; user_id: string; full_name: string; student_id: string; jersey_number: number; position: string;
      }>(
        `SELECT id,user_id,full_name,student_id,jersey_number,position FROM players
         WHERE team_id=$1 AND left_at IS NULL AND user_id IS NOT NULL AND jersey_number BETWEEN 1 AND 8 ORDER BY jersey_number`, [teamId],
      );
      if (playersResult.rowCount !== 8 || playersResult.rows[0]!.position !== "GK") throw new Error(`Club ${fixture.teamNumber} requires eight active linked players, including a goalkeeper`);
      const players = playersResult.rows;
      const roster = players.map((player) => ({
        playerId: player.id,
        playerName: player.full_name,
        studentId: player.student_id,
        birthDate: null,
        competitionRole: "PLAYER",
        lineupRole: player.jersey_number <= tournament.footballFormat ? "STARTER" : "SUBSTITUTE",
        isGoalkeeper: player.jersey_number === 1,
        jerseyNumber: player.jersey_number,
        position: player.position,
      }));
      if (roster.filter((entry) => entry.lineupRole === "STARTER").length !== tournament.footballFormat) {
        throw new Error(`Fixture ${fixture.key} needs a ${tournament.footballFormat}-player starting lineup`);
      }
      const fixtureRegistration = await pool.query<{ id: string; status: string; version: number }>(
        "SELECT id,status,version FROM team_registrations WHERE team_id=$1 AND tournament_id=$2", [teamId,tournament.id],
      );
      if (fixtureRegistration.rowCount && fixtureRegistration.rows[0]!.id !== registrationId) {
        throw new Error(`Fixture ${fixture.key} conflicts with an existing registration; refusing to overwrite`);
      }
      const invitationIds = new Map<string, string>();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const player of players) {
          const invitationId = idFor(`${fixture.key}:invitation:${player.jersey_number}`);
          invitationIds.set(player.id, invitationId);
          await client.query(
            `INSERT INTO tournament_player_invitations(
              id,tournament_id,team_id,player_id,player_user_id,invited_by,competition_role,lineup_role,is_goalkeeper,
              proposed_jersey_number,position_snapshot,message,status,expires_at,responded_at,
              tournament_start_date,tournament_end_date,tournament_name
            ) VALUES($1,$2,$3,$4,$5,$6,'PLAYER',$7,$8,$9,$10,$11,'ACCEPTED',NOW()+INTERVAL '30 days',NOW(),$12::date,$13::date,$14)
            ON CONFLICT(id) DO NOTHING`,
            [invitationId,tournament.id,teamId,player.id,player.user_id,captainId,
              player.jersey_number <= tournament.footballFormat ? "STARTER" : "SUBSTITUTE",player.jersey_number === 1,
              player.jersey_number,player.position,`Seed 1 fixture ${fixture.key}`,tournament.startDate,tournament.endDate,tournament.name],
          );
        }
        const initialRegistration = await client.query<{ id: string; status: string; version: number }>(
          "SELECT id,status,version FROM team_registrations WHERE team_id=$1 AND tournament_id=$2 FOR UPDATE", [teamId,tournament.id],
        );
        if (!fixture.draftOnly && !initialRegistration.rowCount) {
          await client.query(
            `INSERT INTO team_registrations(id,team_id,tournament_id,institution_id,status,submitted_roster,version,submitted_at,submission_sequence,notes)
             VALUES($1,$2,$3,$4,'PENDING',$5::jsonb,1,NOW(),
               COALESCE((SELECT MAX(submission_sequence)+1 FROM team_registrations WHERE tournament_id=$3),1),$6)`,
            [registrationId,teamId,tournament.id,institutionId,JSON.stringify(roster),`Seed 1 fixture ${fixture.key}`],
          );
          await client.query(
            `INSERT INTO team_registration_versions(registration_id,version,action,roster_snapshot,note,actor_id)
             VALUES($1,1,'SUBMITTED',$2::jsonb,$3,$4)`,
            [registrationId,JSON.stringify(roster),`Fixture ${fixture.key}: initial PENDING submission`,captainId],
          );
          for (const player of players) {
            const entry = roster.find((item) => item.playerId === player.id)!;
            await client.query(
              `INSERT INTO rosters(team_id,tournament_id,player_id,lineup_role,is_goalkeeper,competition_role,
                jersey_number_snapshot,position_snapshot,player_name_snapshot,student_id_snapshot,is_verified,review_status)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,FALSE,'PENDING') ON CONFLICT DO NOTHING`,
              [teamId,tournament.id,player.id,entry.lineupRole,entry.isGoalkeeper,entry.competitionRole,entry.jerseyNumber,
                entry.position,player.full_name,player.student_id],
            );
          }
        }
        if (fixture.draftOnly) {
          await client.query(
            `INSERT INTO tournament_registration_drafts(team_id,tournament_id,updated_by,roster,notes,registration_id,base_version,editing_submitted,draft_state)
             VALUES($1,$2,$3,$4::jsonb,$5,NULL,NULL,FALSE,'DRAFT') ON CONFLICT(team_id,tournament_id) DO NOTHING`,
            [teamId,tournament.id,captainId,JSON.stringify(roster.map((entry) => ({
              playerId:entry.playerId,competitionRole:entry.competitionRole,lineupRole:entry.lineupRole,
              isGoalkeeper:entry.isGoalkeeper,proposedJerseyNumber:entry.jerseyNumber,position:entry.position,
            }))),`Seed 1 fixture DRAFT; editable roster before submission`],
          );
        } else if (fixture.withdrawJersey && !initialRegistration.rowCount) {
          const player = players.find((entry) => entry.jersey_number === fixture.withdrawJersey)!;
          const invitationId = invitationIds.get(player.id)!;
          const remaining = roster.filter((entry) => entry.playerId !== player.id);
          const draftRoster = remaining.map((entry) => ({
            playerId:entry.playerId,competitionRole:entry.competitionRole,lineupRole:entry.lineupRole,
            isGoalkeeper:entry.isGoalkeeper,proposedJerseyNumber:entry.jerseyNumber,position:entry.position,
          }));
          const requestId = idFor(`${fixture.key}:approved-withdrawal`);
          await client.query(
            `UPDATE tournament_player_invitations SET status='WITHDRAWN',status_reason=$2,responded_at=NOW(),updated_at=NOW() WHERE id=$1`,
            [invitationId,`Seed 1 fixture: withdrawal already approved; ${fixture.invalidAfterWithdrawal ? "minimum goalkeeper rule is unmet" : "roster remains valid"}`],
          );
          await client.query(
            `INSERT INTO tournament_player_withdrawal_requests(id,invitation_id,player_user_id,reason,status,decision_note,decided_by,decided_at)
             VALUES($1,$2,$3,$4,'APPROVED',$5,$6,NOW()) ON CONFLICT(id) DO NOTHING`,
            [requestId,invitationId,player.user_id,`Seed 1 fixture: ${player.full_name} yêu cầu rút khỏi roster`,
              "Fixture trạng thái ban đầu, không phải quyết định do BTC thực hiện.",captainId],
          );
          await client.query(
            `INSERT INTO team_registration_versions(registration_id,version,action,roster_snapshot,note,actor_id)
             VALUES($1,1,'PLAYER_WITHDRAWAL_ACCEPTED',$2::jsonb,$3,$4)`,
            [registrationId,JSON.stringify(remaining),`DRAFT_CHANGES: fixture captain approved withdrawal for ${player.full_name}; submitted PENDING snapshot is retained`,captainId],
          );
          await client.query(
            `INSERT INTO tournament_registration_drafts(team_id,tournament_id,updated_by,roster,notes,registration_id,base_version,editing_submitted,draft_state)
             VALUES($1,$2,$3,$4::jsonb,$5,$6,1,TRUE,'DRAFT_CHANGES') ON CONFLICT(team_id,tournament_id) DO NOTHING`,
            [teamId,tournament.id,captainId,JSON.stringify(draftRoster),`Fixture ${fixture.key}; submitted snapshot remains unchanged`,registrationId],
          );
        }
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }

      for (const player of players) {
        await api(new URL("/internal/player-participation/invitations/reserve", tournamentServiceUrl), "POST", internalApiKey, {
          invitationId: invitationIds.get(player.id), tournamentId:tournament.id, teamId, playerId:player.id,
        });
      }
      if (!fixture.draftOnly) {
        // Keep the submitted PENDING version reserved until the captain resubmits; the withdrawal is only in DRAFT_CHANGES.
        const reservationRoster = roster;
        const currentRegistration = await pool.query<{ status: string }>(
          "SELECT status FROM team_registrations WHERE id=$1", [registrationId],
        );
        if (currentRegistration.rows[0]?.status === "PENDING") {
          await api(new URL(`/internal/tournaments/${tournament.id}/registration-reservations`, tournamentServiceUrl), "POST", internalApiKey, {
            registrationId,teamId,institutionId,
            isResubmission: Boolean(fixture.withdrawJersey),
            requireConfirmedRoster:true,
            roster:reservationRoster.map((entry) => ({ playerId:entry.playerId,lineupRole:entry.lineupRole,isGoalkeeper:entry.isGoalkeeper })),
          });
          await api(new URL(`/internal/registration-reservations/${registrationId}`, tournamentServiceUrl), "PATCH", internalApiKey, {
            status:"PENDING",persistedInOrganization:true,tournamentId:tournament.id,teamId,institutionId,
            playerIds:reservationRoster.map((entry) => entry.playerId),
          });
        }
      }
      if (fixture.withdrawJersey) {
        await api(new URL(`/internal/player-participation/invitations/${invitationIds.get(players.find((player) => player.jersey_number === fixture.withdrawJersey)!.id)}/release`, tournamentServiceUrl), "POST", internalApiKey, {});
      }
      report.push({ fixture:fixture.key,team:teamResult.rows[0]!.name,tournament:tournament.name,registrationId,status:fixture.draftOnly?"DRAFT":"PENDING",draftState:fixture.draftOnly?"DRAFT":fixture.withdrawJersey?"DRAFT_CHANGES":null,withdrawnJersey:fixture.withdrawJersey ?? null,rosterAfterWithdrawal:fixture.withdrawJersey?7:8,rosterValidAfterWithdrawal:fixture.withdrawJersey ? !fixture.invalidAfterWithdrawal : true });
    }
    console.log(JSON.stringify({ seed:"Seed 1 player withdrawal stage fixtures",existingRegistrationsPreserved:true,fixtures:report,password:"Demo@123456 (new captain/player accounts 14–16 only)" },null,2));
  } finally { await pool.end(); }
}

if (require.main === module) main().catch((error: unknown) => { console.error("[seed1-player-withdrawal-stage-fixtures] failed",error); process.exitCode=1; });
