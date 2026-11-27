import bcrypt from "bcryptjs";
import crypto from "crypto";
import { Pool, type PoolClient } from "pg";

const tournamentId = "e5000000-0000-4000-8000-000000000001";
const schoolCodes = [
  "SFL-HCM-IUH",
  "SFL-HCM-HUTECH",
  "SFL-HCM-UEF",
  "SFL-HCM-UEH",
] as const;

const teamNames = [
  "16T IUH Eagles",
  "16T IUH Dragons",
  "16T IUH Warriors",
  "16T IUH Phoenix",
  "16T HUTECH Tigers",
  "16T HUTECH Falcons",
  "16T HUTECH Lions",
  "16T HUTECH Panthers",
  "16T UEF United",
  "16T UEF Rangers",
  "16T UEF Athletic",
  "16T UEF Stars",
  "16T UEH FC",
  "16T UEH Sharks",
  "16T UEH Hornets",
  "16T UEH Knights",
] as const;

function uuid(seed: string): string {
  const bytes = crypto.createHash("md5").update(seed).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function transaction<T>(pool: Pool, callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("Full tournament demo seeding is permitted only in development");
  }
  const password = process.env.DEMO_ACCOUNT_PASSWORD;
  if (!password || password.length < 8) {
    throw new Error("DEMO_ACCOUNT_PASSWORD must contain at least 8 characters");
  }
  const accountUrl = process.env.ACCOUNT_DATABASE_URL;
  const organizationUrl = process.env.ORGANIZATION_DATABASE_URL;
  const tournamentUrl = process.env.TOURNAMENT_DATABASE_URL;
  if (!accountUrl || !organizationUrl || !tournamentUrl) {
    throw new Error("ACCOUNT_DATABASE_URL, ORGANIZATION_DATABASE_URL and TOURNAMENT_DATABASE_URL are required");
  }

  const accountPool = new Pool({ connectionString: accountUrl });
  const organizationPool = new Pool({ connectionString: organizationUrl });
  const tournamentPool = new Pool({ connectionString: tournamentUrl });

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const accountIds = new Map<string, string>();
    let createdAccounts = 0;

    await transaction(accountPool, async (client) => {
      const schools = await organizationPool.query<{ id: string; code: string }>(
        "SELECT id, code FROM institutions WHERE code = ANY($1::text[])",
        [schoolCodes],
      );
      const schoolIds = new Map(schools.rows.map((row) => [row.code, row.id]));
      if (schoolIds.size !== 4) {
        throw new Error("The four HCMC demo schools must exist before seeding the tournament");
      }

      for (let teamIndex = 0; teamIndex < teamNames.length; teamIndex += 1) {
        const teamNumber = teamIndex + 1;
        const schoolCode = schoolCodes[Math.floor(teamIndex / 4)];
        const institutionId = schoolIds.get(schoolCode)!;
        const captainEmail = `captain16.team${String(teamNumber).padStart(2, "0")}@football.local`;
        const captainSeed = `full-tournament-team-${teamNumber}-captain`;
        const captainExisting = await client.query<{ id: string }>(
          "SELECT id FROM users WHERE LOWER(email) = LOWER($1)",
          [captainEmail],
        );
        let captainId: string;
        if (captainExisting.rows[0]) {
          captainId = captainExisting.rows[0].id;
        } else {
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO users
               (id, email, password_hash, full_name, student_id, is_active, email_verified, institution_id)
             VALUES ($1, $2, $3, $4, $5, TRUE, TRUE, $6)
             RETURNING id`,
            [
              uuid(captainSeed),
              captainEmail,
              passwordHash,
              `Đội trưởng ${teamNames[teamIndex]}`,
              `CPT-${String(teamNumber).padStart(2, "0")}`,
              institutionId,
            ],
          );
          captainId = inserted.rows[0].id;
          await client.query(
            "INSERT INTO demo_account_registry (user_id, seed_key, email) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO NOTHING",
            [captainId, captainSeed, captainEmail],
          );
          createdAccounts += 1;
        }
        await client.query(
          "INSERT INTO user_roles (user_id, role) VALUES ($1, 'TEAM_CAPTAIN'), ($1, 'VIEWER') ON CONFLICT DO NOTHING",
          [captainId],
        );
        accountIds.set(`captain-${teamNumber}`, captainId);

        for (let playerIndex = 1; playerIndex <= 10; playerIndex += 1) {
          const playerNumber = (teamIndex * 10) + playerIndex;
          const playerEmail = `team${String(teamNumber).padStart(2, "0")}.player${String(playerIndex).padStart(2, "0")}@football.local`;
          const playerSeed = `full-tournament-team-${teamNumber}-player-${playerIndex}`;
          const existing = await client.query<{ id: string }>(
            "SELECT id FROM users WHERE LOWER(email) = LOWER($1)",
            [playerEmail],
          );
          let playerId: string;
          if (existing.rows[0]) {
            playerId = existing.rows[0].id;
          } else {
            const positions = ["GK", "DEF", "DEF", "DEF", "MID", "MID", "MID", "MID", "FWD", "FWD"];
            const inserted = await client.query<{ id: string }>(
              `INSERT INTO users
                 (id, email, password_hash, full_name, student_id, is_active, email_verified, institution_id)
               VALUES ($1, $2, $3, $4, $5, TRUE, TRUE, $6)
               RETURNING id`,
              [
                uuid(playerSeed),
                playerEmail,
                passwordHash,
                `Cầu thủ ${playerNumber} - ${teamNames[teamIndex]}`,
                `PLY-${String(playerNumber).padStart(3, "0")}`,
                institutionId,
              ],
            );
            playerId = inserted.rows[0].id;
            await client.query(
              "INSERT INTO demo_account_registry (user_id, seed_key, email) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO NOTHING",
              [playerId, playerSeed, playerEmail],
            );
            await client.query(
              "INSERT INTO account_profiles (user_id, profile_data) VALUES ($1, $2::jsonb) ON CONFLICT (user_id) DO NOTHING",
              [playerId, JSON.stringify({
                demoData: true,
                playingPosition: positions[playerIndex - 1],
                dominantFoot: playerIndex % 3 === 0 ? "LEFT" : "RIGHT",
              })],
            );
            createdAccounts += 1;
          }
          await client.query(
            "INSERT INTO user_roles (user_id, role) VALUES ($1, 'PLAYER'), ($1, 'VIEWER') ON CONFLICT DO NOTHING",
            [playerId],
          );
          accountIds.set(`team-${teamNumber}-player-${playerIndex}`, playerId);
        }
      }
    });

    await transaction(organizationPool, async (client) => {
      const schools = await client.query<{ id: string; code: string }>(
        "SELECT id, code FROM institutions WHERE code = ANY($1::text[])",
        [schoolCodes],
      );
      const schoolIds = new Map(schools.rows.map((row) => [row.code, row.id]));
      const admin = await accountPool.query<{ id: string }>(
        "SELECT id FROM users WHERE email = 'admin.demo@football.local'",
      );
      const btc = await accountPool.query<{ id: string }>(
        "SELECT id FROM users WHERE email = 'btc.iuh@football.local'",
      );
      const organizerId = btc.rows[0]?.id ?? admin.rows[0]?.id;
      if (!organizerId) throw new Error("Missing organizer account btc.iuh or admin.demo");

      for (let teamIndex = 0; teamIndex < teamNames.length; teamIndex += 1) {
        const teamNumber = teamIndex + 1;
        const schoolCode = schoolCodes[Math.floor(teamIndex / 4)];
        const institutionId = schoolIds.get(schoolCode)!;
        const captainId = accountIds.get(`captain-${teamNumber}`)!;
        const teamId = uuid(`full-tournament-team-${teamNumber}`);
        await client.query(
          `INSERT INTO teams
             (id, name, short_name, description, institution_id, captain_id, contact_email,
              contact_phone, max_players, is_active, unit_name, representative_name, kit_color)
           VALUES ($1, $2, $3, $4, $5, $6, $7, '0900000000', 11, TRUE,
                   'CLB sinh viên - DEMO', $8, $9)
           ON CONFLICT (id) DO UPDATE SET
             name = EXCLUDED.name,
             institution_id = EXCLUDED.institution_id,
             captain_id = EXCLUDED.captain_id,
             max_players = EXCLUDED.max_players,
             is_active = TRUE`,
          [
            teamId,
            teamNames[teamIndex],
            teamNames[teamIndex].replace(" ", ""),
            `${teamNames[teamIndex]} - đội demo đủ 11 cầu thủ`,
            institutionId,
            captainId,
            `captain16.team${String(teamNumber).padStart(2, "0")}@football.local`,
            `Đội trưởng ${teamNames[teamIndex]}`,
            teamIndex % 3 === 0 ? "RED" : teamIndex % 3 === 1 ? "BLUE" : "GREEN",
          ],
        );

        const rosterRows = [{
          position: "MID",
          jersey: 1,
          userId: captainId,
          playerId: uuid(`full-tournament-team-${teamNumber}-member-1`),
          isCaptain: true,
        }];
        for (let playerIndex = 1; playerIndex <= 10; playerIndex += 1) {
          rosterRows.push({
            position: ["GK", "DEF", "DEF", "DEF", "MID", "MID", "MID", "MID", "FWD", "FWD"][playerIndex - 1],
            jersey: playerIndex + 1,
            userId: accountIds.get(`team-${teamNumber}-player-${playerIndex}`)!,
            playerId: uuid(`full-tournament-team-${teamNumber}-member-${playerIndex + 1}`),
            isCaptain: false,
          });
        }
        for (const member of rosterRows) {
          await client.query(
            `INSERT INTO players
               (id, team_id, user_id, full_name, student_id, jersey_number, position, is_captain)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (team_id, user_id) DO UPDATE SET
               jersey_number = EXCLUDED.jersey_number,
               position = EXCLUDED.position,
               is_captain = EXCLUDED.is_captain,
               left_at = NULL`,
            [
              member.playerId,
              teamId,
              member.userId,
              member.isCaptain
                ? `Đội trưởng ${teamNames[teamIndex]}`
                : `Cầu thủ ${((teamIndex * 10) + member.jersey - 1)} - ${teamNames[teamIndex]}`,
              member.isCaptain
                ? `CPT-${String(teamNumber).padStart(2, "0")}`
                : `PLY-${String((teamIndex * 10) + member.jersey - 1).padStart(3, "0")}`,
              member.jersey,
              member.position,
              member.isCaptain,
            ],
          );
        }

        const sequence = teamNumber;
        const registration = await client.query<{ id: string }>(
          `INSERT INTO team_registrations
             (id, team_id, tournament_id, institution_id, status, notes,
              submission_sequence, submitted_at, approved_at, approved_by)
           VALUES ($1, $2, $3, $4, 'APPROVED',
                   'Seed giải đầy đủ 16 đội - DEMO', $5, NOW(), NOW(), $6)
           ON CONFLICT (team_id, tournament_id) DO UPDATE SET
             institution_id = EXCLUDED.institution_id,
             status = 'APPROVED',
             approved_at = COALESCE(team_registrations.approved_at, NOW()),
             approved_by = EXCLUDED.approved_by,
             notes = EXCLUDED.notes
           RETURNING id`,
          [
            uuid(`full-tournament-registration-${teamNumber}`),
            teamId,
            tournamentId,
            institutionId,
            sequence,
            organizerId,
          ],
        );
        for (const member of rosterRows) {
          await client.query(
            `INSERT INTO rosters (team_id, tournament_id, player_id, is_verified, verified_at)
             VALUES ($1, $2, $3, TRUE, NOW())
             ON CONFLICT (team_id, tournament_id, player_id) DO UPDATE SET
               is_verified = TRUE,
               verified_at = COALESCE(rosters.verified_at, NOW())`,
            [teamId, tournamentId, member.playerId],
          );
        }
        void registration.rows[0];
      }
    });

    await transaction(tournamentPool, async (client) => {
      const creator = await accountPool.query<{ id: string }>(
        "SELECT id FROM users WHERE email = 'btc.iuh@football.local'",
      );
      const creatorId = creator.rows[0]?.id;
      if (!creatorId) throw new Error("Missing BTC account btc.iuh@football.local");
      const btcAccounts = await accountPool.query<{ id: string }>(
        `SELECT u.id
         FROM users u
         JOIN user_roles r ON r.user_id = u.id
         WHERE r.role = 'BTC' AND u.is_active = TRUE AND u.email_verified = TRUE`,
      );
      if (!btcAccounts.rowCount) throw new Error("No active verified BTC accounts are available");
      const registrations = await organizationPool.query<{
        registrationId: string;
        teamId: string;
        institutionId: string;
        playerIds: string[];
      }>(
        `SELECT tr.id AS "registrationId", tr.team_id AS "teamId",
                tr.institution_id AS "institutionId",
                array_agg(DISTINCT r.player_id) FILTER (WHERE r.is_verified) AS "playerIds"
         FROM team_registrations tr
         JOIN rosters r ON r.team_id = tr.team_id AND r.tournament_id = tr.tournament_id
         WHERE tr.tournament_id = $1 AND tr.status = 'APPROVED'
         GROUP BY tr.id, tr.team_id, tr.institution_id`,
        [tournamentId],
      );
      if (registrations.rowCount !== teamNames.length ||
          registrations.rows.some((registration) => registration.playerIds?.length !== 11)) {
        throw new Error("The tournament must have 16 approved teams with 11 verified roster members each");
      }

      await client.query(
        `INSERT INTO tournaments
           (id, name, description, status, location, organizer_name, organizer_contact_name,
            organizer_email, scope, football_format, competition_format, min_teams, max_teams,
            min_players, max_players_per_team, min_goalkeepers, start_date, end_date, created_by)
         VALUES ($1, 'SFL HCMC 16-Team Cup', 'Giải demo đầy đủ 16 đội, mỗi đội 11 cầu thủ',
                 'ROSTER_LOCKED', 'Khu liên hợp thể thao TP.HCM',
                 'BTC SFL TP.HCM', 'BTC IUH', 'btc.iuh@football.local',
                 'INTER_SCHOOL', 11, 'GROUP_AND_KNOCKOUT', 16, 16,
                 11, 11, 1, CURRENT_DATE + 7, CURRENT_DATE + 37, $2)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           status = EXCLUDED.status,
           min_teams = EXCLUDED.min_teams,
           max_teams = EXCLUDED.max_teams,
           min_players = EXCLUDED.min_players,
           max_players_per_team = EXCLUDED.max_players_per_team,
           start_date = EXCLUDED.start_date,
           end_date = EXCLUDED.end_date`,
        [tournamentId, creatorId],
      );
      await client.query(
        `INSERT INTO registration_periods (id, tournament_id, name, start_date, end_date)
         VALUES ($1, $2, 'Đợt đăng ký giải 16 đội', NOW() - INTERVAL '30 days', NOW() - INTERVAL '1 day')
         ON CONFLICT (id) DO UPDATE SET start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date`,
        [uuid("full-tournament-registration-period"), tournamentId],
      );
      await client.query(
        `INSERT INTO tournament_rules
           (tournament_id, eligibility_description, points_for_win, points_for_draw,
            points_for_loss, match_duration_minutes, advancing_teams_per_group,
            max_teams_per_group, competition_config, published_version, published_at)
         VALUES (
           $1, '16 đội; mỗi đội có 11 cầu thủ đăng ký chính thức.', 3, 1, 0, 90,
           2, 4,
           '{"groupCountMode":"AUTO_BY_CAPACITY","groupCount":null,"groupAllocation":"BALANCED","sameInstitutionPolicy":"REQUIRE_SEPARATE","knockoutPairing":"GROUP_RANK","fixedPairingRule":"STANDARD_CROSSOVER","knockoutLegs":1,"thirdPlaceMatch":false,"byePolicy":"AUTOMATIC","schedulingStartTime":"08:00","schedulingEndTime":"22:00"}'::jsonb,
           1, NOW())
         ON CONFLICT (tournament_id) DO UPDATE SET
           eligibility_description = EXCLUDED.eligibility_description,
           points_for_win = EXCLUDED.points_for_win,
           points_for_draw = EXCLUDED.points_for_draw,
           points_for_loss = EXCLUDED.points_for_loss,
           advancing_teams_per_group = EXCLUDED.advancing_teams_per_group,
           max_teams_per_group = EXCLUDED.max_teams_per_group,
           competition_config = EXCLUDED.competition_config,
           published_version = GREATEST(tournament_rules.published_version, EXCLUDED.published_version),
           published_at = COALESCE(tournament_rules.published_at, EXCLUDED.published_at)`,
        [tournamentId],
      );

      const schools = await organizationPool.query<{ id: string }>(
        "SELECT id FROM institutions WHERE code = ANY($1::text[])",
        [schoolCodes],
      );
      await client.query(
        "DELETE FROM tournament_allowed_institutions WHERE tournament_id = $1",
        [tournamentId],
      );
      for (const school of schools.rows) {
        await client.query(
          `INSERT INTO tournament_allowed_institutions (tournament_id, institution_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [tournamentId, school.id],
        );
      }
      for (const btcAccount of btcAccounts.rows) {
        await client.query(
          `INSERT INTO tournament_organizers (tournament_id, user_id, assigned_by)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [tournamentId, btcAccount.id, creatorId],
        );
      }
      for (const registration of registrations.rows) {
        await client.query(
          `INSERT INTO tournament_registration_reservations
             (registration_id, tournament_id, team_id, institution_id, status,
              persisted_in_organization, expires_at, roster_player_ids)
           VALUES ($1, $2, $3, $4, 'APPROVED', TRUE, 'infinity'::timestamptz, $5::uuid[])
           ON CONFLICT (registration_id) DO UPDATE SET
             status = 'APPROVED',
             persisted_in_organization = TRUE,
             expires_at = 'infinity'::timestamptz,
             roster_player_ids = EXCLUDED.roster_player_ids,
             updated_at = NOW()`,
          [
            registration.registrationId,
            tournamentId,
            registration.teamId,
            registration.institutionId,
            registration.playerIds,
          ],
        );
        await client.query(
          `INSERT INTO tournament_player_participation_reservations
             (registration_id, tournament_id, player_id)
           SELECT $1, $2, unnest($3::uuid[])
           ON CONFLICT (registration_id, player_id) DO NOTHING`,
          [registration.registrationId, tournamentId, registration.playerIds],
        );
      }

      await client.query(
        `INSERT INTO tournament_ranking_criteria (tournament_id, priority, criterion)
         VALUES
           ($1, 1, 'POINTS'),
           ($1, 2, 'GOAL_DIFFERENCE'),
           ($1, 3, 'GOALS_FOR')
         ON CONFLICT DO NOTHING`,
        [tournamentId],
      );
      await client.query(
        `INSERT INTO tournament_workflow_state (tournament_id, current_step, updated_by)
         VALUES ($1, 3, $2)
         ON CONFLICT (tournament_id) DO UPDATE SET
           current_step = 3,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()`,
        [tournamentId, creatorId],
      );
    });

    console.log(JSON.stringify({
      tournamentId,
      tournamentName: "SFL HCMC 16-Team Cup",
      teams: teamNames.length,
      playersPerTeam: 11,
      teamCaptains: 16,
      additionalPlayers: 160,
      totalAccountsCreated: createdAccounts,
    }));
  } finally {
    await Promise.all([accountPool.end(), organizationPool.end(), tournamentPool.end()]);
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error("[full-tournament-demo-seed] failed", error);
    process.exitCode = 1;
  });
}
