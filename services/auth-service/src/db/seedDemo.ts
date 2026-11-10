import bcrypt from "bcryptjs";
import { Pool, type PoolClient } from "pg";

type DemoAccount = {
  key: string;
  email: string;
  fullName: string;
  role: string;
};

const accounts: DemoAccount[] = [
  { key: "admin", email: "admin.demo@football.local", fullName: "Demo Administrator", role: "ADMIN" },
  { key: "btc", email: "btc.demo@football.local", fullName: "Demo Tournament Organizer", role: "BTC" },
  { key: "captainA", email: "captain.demo@football.local", fullName: "Demo Team Captain A", role: "TEAM_CAPTAIN" },
  { key: "captainB", email: "captain2.demo@football.local", fullName: "Demo Team Captain B", role: "TEAM_CAPTAIN" },
  { key: "referee", email: "referee.demo@football.local", fullName: "Demo Referee", role: "REFEREE" },
  { key: "viewer", email: "viewer.demo@football.local", fullName: "Demo Viewer", role: "VIEWER" },
  ...Array.from({ length: 14 }, (_, index) => ({
    key: `player${index + 1}`,
    email: index === 0
      ? "player.demo@football.local"
      : `player${index + 1}.demo@football.local`,
    fullName: `Demo Player ${index + 1}`,
    role: "PLAYER",
  })),
];

const ids = {
  institutionA: "d0000000-0000-4000-8000-000000000001",
  institutionB: "d0000000-0000-4000-8000-000000000002",
  teamA: "d0000000-0000-4000-8000-000000000011",
  teamB: "d0000000-0000-4000-8000-000000000012",
  tournament: "d0000000-0000-4000-8000-000000000021",
  registrationPeriod: "d0000000-0000-4000-8000-000000000022",
  matchFinished: "d0000000-0000-4000-8000-000000000031",
  matchScheduled: "d0000000-0000-4000-8000-000000000032",
  venue: "d0000000-0000-4000-8000-000000000041",
  result: "d0000000-0000-4000-8000-000000000051",
  scheduleFinished: "d0000000-0000-4000-8000-000000000061",
  scheduleUpcoming: "d0000000-0000-4000-8000-000000000062",
};

async function inTransaction<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function seedAccounts(
  pool: Pool,
  password: string,
): Promise<Map<string, string>> {
  const passwordHash = await bcrypt.hash(password, 10);
  const userIds = new Map<string, string>();
  const insertedRoles: string[] = [];

  await inTransaction(pool, async (client) => {
    for (const account of accounts) {
      const existing = await client.query<{
        id: string;
        is_active: boolean;
        email_verified: boolean;
        roles: string[];
      }>(
        `SELECT u.id, u.is_active, u.email_verified,
                COALESCE(array_agg(ur.role) FILTER (WHERE ur.role IS NOT NULL), '{}') AS roles
         FROM users u
         LEFT JOIN user_roles ur ON ur.user_id = u.id
         WHERE LOWER(u.email) = LOWER($1)
         GROUP BY u.id`,
        [account.email],
      );

      if (existing.rows[0]) {
        const user = existing.rows[0];
        if (!user.is_active || !user.email_verified || !user.roles.includes(account.role)) {
          throw new Error(
            `Existing demo account for role ${account.role} is not active, verified, and correctly assigned. It was left unchanged.`,
          );
        }
        userIds.set(account.key, user.id);
        continue;
      }

      const created = await client.query<{ id: string }>(
        `INSERT INTO users (email, password_hash, full_name, is_active, email_verified)
         VALUES ($1, $2, $3, TRUE, TRUE)
         RETURNING id`,
        [account.email, passwordHash, account.fullName],
      );
      const userId = created.rows[0].id;
      await client.query(
        "INSERT INTO user_roles (user_id, role) VALUES ($1, $2)",
        [userId, account.role],
      );
      userIds.set(account.key, userId);
      insertedRoles.push(account.role);
    }
  });

  console.log(
    `[demo-seed] account seed complete: ${accounts.length} accounts checked, ${insertedRoles.length} created; existing accounts were not modified`,
  );
  return userIds;
}

function dateOffset(days: number): Date {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

async function seedOrganization(
  pool: Pool,
  userIds: Map<string, string>,
): Promise<void> {
  const playerUsers = Array.from({ length: 14 }, (_, index) => userIds.get(`player${index + 1}`)!);
  const captainA = userIds.get("captainA")!;
  const captainB = userIds.get("captainB")!;

  await inTransaction(pool, async (client) => {
    await client.query(
      `INSERT INTO institutions (id, name, code, institution_type, address)
       VALUES ($1, 'Demo University North', 'SFL-DEMO-NORTH', 'UNIVERSITY', 'Demo campus')
       ON CONFLICT DO NOTHING`,
      [ids.institutionA],
    );
    await client.query(
      `INSERT INTO institutions (id, name, code, institution_type, address)
       VALUES ($1, 'Demo University South', 'SFL-DEMO-SOUTH', 'UNIVERSITY', 'Demo campus')
       ON CONFLICT DO NOTHING`,
      [ids.institutionB],
    );
    await client.query(
      `INSERT INTO teams (id, name, description, institution_id, captain_id, contact_email,
                          max_players, is_active, representative_name, kit_color)
       VALUES ($1, 'SFL Demo North', 'Seeded development fixture', $2, $3,
               'captain.demo@football.local', 25, TRUE, 'Demo Team Captain A', 'Blue')
       ON CONFLICT DO NOTHING`,
      [ids.teamA, ids.institutionA, captainA],
    );
    await client.query(
      `INSERT INTO teams (id, name, description, institution_id, captain_id, contact_email,
                          max_players, is_active, representative_name, kit_color)
       VALUES ($1, 'SFL Demo South', 'Seeded development fixture', $2, $3,
               'captain2.demo@football.local', 25, TRUE, 'Demo Team Captain B', 'Red')
       ON CONFLICT DO NOTHING`,
      [ids.teamB, ids.institutionB, captainB],
    );
    const seededTeams = await client.query<{ id: string; name: string; captain_id: string }>(
      "SELECT id, name, captain_id FROM teams WHERE id = ANY($1::uuid[])",
      [[ids.teamA, ids.teamB]],
    );
    const expectedTeams = new Map([
      [ids.teamA, { name: "SFL Demo North", captainId: captainA }],
      [ids.teamB, { name: "SFL Demo South", captainId: captainB }],
    ]);
    if (
      seededTeams.rowCount !== expectedTeams.size ||
      seededTeams.rows.some((team) => {
        const expected = expectedTeams.get(team.id);
        return !expected || team.name !== expected.name || team.captain_id !== expected.captainId;
      })
    ) {
      throw new Error("A stable demo team ID is already occupied by unrelated data");
    }

    for (let index = 0; index < playerUsers.length; index += 1) {
      const isHomeTeam = index < 7;
      const playerNumber = index + 1;
      const playerId = isHomeTeam
        ? `d0000000-0000-4000-8000-${String(100 + playerNumber).padStart(12, "0")}`
        : `d0000000-0000-4000-8000-${String(200 + playerNumber - 7).padStart(12, "0")}`;
      const teamId = isHomeTeam ? ids.teamA : ids.teamB;
      await client.query(
        `INSERT INTO players (id, team_id, user_id, full_name, jersey_number, position, is_captain)
         VALUES ($1, $2, $3, $4, $5, $6, FALSE)
         ON CONFLICT DO NOTHING`,
        [playerId, teamId, playerUsers[index], `Demo Player ${index + 1}`, (index % 7) + 1,
          index % 4 === 0 ? "GK" : "MID"],
      );
    }
  });
  console.log("[demo-seed] organization fixtures are current");
}

async function seedTournament(
  pool: Pool,
  userIds: Map<string, string>,
): Promise<void> {
  await inTransaction(pool, async (client) => {
    await client.query(
      `INSERT INTO tournaments (
         id, name, description, status, location, organizer_name, organizer_contact_name,
         organizer_email, scope, football_format, competition_format, min_teams, max_teams,
         min_players, max_players_per_team, start_date, end_date, created_by
       )
       VALUES ($1, 'SFL Development Demo Cup', 'Seeded development fixture', 'IN_PROGRESS',
               'Demo campus stadium', 'SFL Demo Committee', 'Demo Organizer',
               'btc.demo@football.local', 'INTER_SCHOOL', 7, 'ROUND_ROBIN', 2, 8, 7, 25,
               $2::date, $3::date, $4)
       ON CONFLICT DO NOTHING`,
      [ids.tournament, dateOffset(-2), dateOffset(28), userIds.get("admin")],
    );
    const tournament = await client.query<{ name: string }>(
      "SELECT name FROM tournaments WHERE id = $1",
      [ids.tournament],
    );
    if (tournament.rows[0]?.name !== "SFL Development Demo Cup") {
      throw new Error("The stable demo tournament ID is already occupied by unrelated data");
    }
    await client.query(
      `INSERT INTO registration_periods (id, tournament_id, name, start_date, end_date)
       VALUES ($1, $2, 'Demo registration', $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [ids.registrationPeriod, ids.tournament, dateOffset(-20), dateOffset(-3)],
    );
    await client.query(
      `INSERT INTO tournament_rules (
         tournament_id, eligibility_description, points_for_win, points_for_draw,
         points_for_loss, match_duration_minutes
       )
       VALUES ($1, 'Development test teams with complete seven-player rosters.', 3, 1, 0, 90)
       ON CONFLICT DO NOTHING`,
      [ids.tournament],
    );
    await client.query(
      `INSERT INTO tournament_ranking_criteria (tournament_id, priority, criterion)
       VALUES ($1, 1, 'POINTS'), ($1, 2, 'GOAL_DIFFERENCE'), ($1, 3, 'GOALS_FOR')
       ON CONFLICT DO NOTHING`,
      [ids.tournament],
    );
    await client.query(
      `INSERT INTO tournament_allowed_institutions (tournament_id, institution_id)
       VALUES ($1, $2), ($1, $3)
       ON CONFLICT DO NOTHING`,
      [ids.tournament, ids.institutionA, ids.institutionB],
    );
    await client.query(
      `INSERT INTO tournament_organizers (tournament_id, user_id, assigned_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (tournament_id, user_id) DO NOTHING`,
      [ids.tournament, userIds.get("btc"), userIds.get("admin")],
    );
  });
  console.log("[demo-seed] tournament fixtures are current");
}

async function seedRegistrations(pool: Pool): Promise<void> {
  await inTransaction(pool, async (client) => {
    for (const [teamId, playerStart] of [[ids.teamA, 1], [ids.teamB, 8]]) {
      const registration = await client.query<{ id: string }>(
        `INSERT INTO team_registrations (team_id, tournament_id, status, notes)
         VALUES ($1, $2, 'APPROVED', 'Development demo fixture')
         ON CONFLICT (team_id, tournament_id) DO NOTHING
         RETURNING id`,
        [teamId, ids.tournament],
      );
      const existingRegistration = registration.rows[0]
        ? registration.rows[0]
        : (await client.query<{ id: string }>(
            "SELECT id FROM team_registrations WHERE team_id = $1 AND tournament_id = $2",
            [teamId, ids.tournament],
          )).rows[0];
      if (!existingRegistration) {
        throw new Error("Unable to resolve seeded team registration");
      }

      for (let playerOffset = 0; playerOffset < 7; playerOffset += 1) {
        const playerId = playerStart === 1
          ? `d0000000-0000-4000-8000-${String(101 + playerOffset).padStart(12, "0")}`
          : `d0000000-0000-4000-8000-${String(201 + playerOffset).padStart(12, "0")}`;
        await client.query(
          `INSERT INTO rosters (team_id, tournament_id, player_id, is_verified, verified_at)
           VALUES ($1, $2, $3, TRUE, NOW())
           ON CONFLICT (team_id, tournament_id, player_id) DO NOTHING`,
          [teamId, ids.tournament, playerId],
        );
      }
    }
  });
  console.log("[demo-seed] approved registrations and rosters are current");
}

async function seedMatches(
  matchPool: Pool,
  schedulingPool: Pool,
  userIds: Map<string, string>,
): Promise<void> {
  await inTransaction(matchPool, async (client) => {
    await client.query(
      `INSERT INTO matches (id, tournament_id, home_team_id, away_team_id, match_date,
                            venue, round, status)
       VALUES ($1, $2, $3, $4, $5, 'Demo Stadium', 'Round 1', 'FINISHED')
       ON CONFLICT DO NOTHING`,
      [ids.matchFinished, ids.tournament, ids.teamA, ids.teamB, dateOffset(-1)],
    );
    await client.query(
      `INSERT INTO matches (id, tournament_id, home_team_id, away_team_id, match_date,
                            venue, round, status)
       VALUES ($1, $2, $3, $4, $5, 'Demo Stadium', 'Round 2', 'SCHEDULED')
       ON CONFLICT DO NOTHING`,
      [ids.matchScheduled, ids.tournament, ids.teamB, ids.teamA, dateOffset(7)],
    );
    await client.query(
      `INSERT INTO match_results (id, match_id, home_score, away_score, recorded_by, notes)
       VALUES ($1, $2, 2, 1, $3, 'Development demo fixture')
       ON CONFLICT (id) DO NOTHING`,
      [ids.result, ids.matchFinished, userIds.get("referee")],
    );
    await client.query(
      `INSERT INTO standings (
         tournament_id, team_id, played, won, drawn, lost, goals_for, goals_against,
         goal_difference, points
       )
       VALUES
         ($1, $2, 1, 1, 0, 0, 2, 1, 1, 3),
         ($1, $3, 1, 0, 0, 1, 1, 2, -1, 0)
       ON CONFLICT (tournament_id, team_id) DO NOTHING`,
      [ids.tournament, ids.teamA, ids.teamB],
    );
  });

  await inTransaction(schedulingPool, async (client) => {
    await client.query(
      `INSERT INTO venues (id, name, location, capacity, surface)
       VALUES ($1, 'SFL Demo Stadium', 'Demo campus', 1000, 'Grass')
       ON CONFLICT DO NOTHING`,
      [ids.venue],
    );
    await client.query(
      `INSERT INTO schedules (
         id, tournament_id, match_id, venue_id, referee_id, scheduled_date,
         duration_minutes, status, created_by
       )
       VALUES
         ($1, $3, $4, $5, $6, $7, 90, 'PUBLISHED', $8),
         ($2, $3, $9, $5, $6, $10, 90, 'PUBLISHED', $8)
       ON CONFLICT (id) DO NOTHING`,
      [
        ids.scheduleFinished,
        ids.scheduleUpcoming,
        ids.tournament,
        ids.matchFinished,
        ids.venue,
        userIds.get("referee"),
        dateOffset(-1),
        userIds.get("btc"),
        ids.matchScheduled,
        dateOffset(7),
      ],
    );
  });
  console.log("[demo-seed] match results, standings and referee schedules are current");
}

export async function seedDemo(): Promise<void> {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("Demo seeding is permitted only when NODE_ENV=development");
  }
  const password = process.env.DEMO_ACCOUNT_PASSWORD;
  if (!password || password.length < 8) {
    throw new Error("DEMO_ACCOUNT_PASSWORD must be configured with at least 8 characters");
  }
  const databaseUrls = {
    ACCOUNT_DATABASE_URL: process.env.ACCOUNT_DATABASE_URL,
    ORGANIZATION_DATABASE_URL: process.env.ORGANIZATION_DATABASE_URL,
    TOURNAMENT_DATABASE_URL: process.env.TOURNAMENT_DATABASE_URL,
    DATABASE_URL: process.env.DATABASE_URL,
    SCHEDULING_DATABASE_URL: process.env.SCHEDULING_DATABASE_URL,
  };
  for (const [name, value] of Object.entries(databaseUrls)) {
    if (!value) throw new Error(`${name} must be configured for demo seeding`);
  }

  const accountPool = new Pool({ connectionString: databaseUrls.ACCOUNT_DATABASE_URL });
  const organizationPool = new Pool({ connectionString: databaseUrls.ORGANIZATION_DATABASE_URL });
  const tournamentPool = new Pool({ connectionString: databaseUrls.TOURNAMENT_DATABASE_URL });
  const matchPool = new Pool({ connectionString: databaseUrls.DATABASE_URL });
  const schedulingPool = new Pool({ connectionString: databaseUrls.SCHEDULING_DATABASE_URL });
  const pools = [accountPool, organizationPool, tournamentPool, matchPool, schedulingPool];

  try {
    const userIds = await seedAccounts(accountPool, password);
    await seedOrganization(organizationPool, userIds);
    await seedTournament(tournamentPool, userIds);
    await seedRegistrations(organizationPool);
    await seedMatches(matchPool, schedulingPool, userIds);
    console.log("[demo-seed] all development fixtures are current");
  } finally {
    await Promise.all(pools.map((pool) => pool.end()));
  }
}

if (require.main === module) {
  seedDemo().catch((error: unknown) => {
    console.error("[demo-seed] failed", error);
    process.exitCode = 1;
  });
}
