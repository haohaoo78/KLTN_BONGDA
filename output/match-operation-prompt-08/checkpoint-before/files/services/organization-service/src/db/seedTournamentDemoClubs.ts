import { createHash } from "node:crypto";
import { Pool, type PoolClient } from "pg";

const schoolCodes = ["SFL-HCM-IUH", "SFL-HCM-HUTECH", "SFL-HCM-UEF", "SFL-HCM-UEH", "SFL-HCM-CAOTHANG", "SFL-HCM-HITU", "SFL-HCM-TDC", "SFL-HCM-HCMCT"];
const teamCount = Number(process.env.DEMO_TEAM_COUNT ?? 30);
const playersPerTeam = Number(process.env.DEMO_PLAYERS_PER_TEAM ?? 20);
const firstNames = ["An", "Bảo", "Châu", "Dũng", "Đạt", "Giang", "Hải", "Huy", "Khang", "Khánh", "Khoa", "Long", "Minh", "Nam", "Phát", "Phúc", "Quân", "Sơn", "Tài", "Thành", "Thịnh", "Tuấn", "Việt", "Vinh"];
const familyNames = ["Nguyễn", "Trần", "Lê", "Phạm", "Hoàng", "Phan", "Võ", "Đặng", "Bùi", "Đỗ", "Hồ", "Ngô"];

function idFor(key: string): string {
  const bytes = createHash("sha256").update(`sftms-demo-dataset-v1:${key}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function nameFor(n: number): string {
  return `${familyNames[n % familyNames.length]} ${firstNames[(n * 7 + 3) % firstNames.length]} ${firstNames[(n * 11 + 9) % firstNames.length]}`;
}

async function main(): Promise<void> {
  if (!(process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test")) throw new Error("Demo dataset seeding is restricted to development/test");
  if (!Number.isInteger(teamCount) || teamCount < 8 || teamCount > 32 || playersPerTeam !== 20) throw new Error("DEMO_TEAM_COUNT must be 8..32 and DEMO_PLAYERS_PER_TEAM must be 20");
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const drawWorkspaceDemo = process.env.DRAW_WORKSPACE_DEMO === "true";
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('sftms-demo-dataset-v1-organization')::bigint)");
      const requiredSchoolCodes = process.env.DEMO_TEAM_COUNT && Number(process.env.DEMO_TEAM_COUNT) > 16
        ? schoolCodes
        : process.env.DEMO_INTER_SCHOOL === "true" ? schoolCodes.slice(0, 4) : [schoolCodes[0]!];
      const schoolRows = await client.query<{ id: string; code: string; short_name: string | null }>(
        `SELECT id,code,short_name FROM institutions WHERE code=ANY($1::text[])
         AND ($2::boolean OR (is_active=TRUE AND status='ACTIVE'))`,
        [requiredSchoolCodes, Number(process.env.DEMO_TEAM_COUNT ?? 30) > 16],
      );
      const schoolByCode = new Map(schoolRows.rows.map((item) => [item.code, item]));
      if (requiredSchoolCodes.some((code) => !schoolByCode.has(code))) throw new Error(`Required active test schools are missing: ${requiredSchoolCodes.filter((code) => !schoolByCode.has(code)).join(", ")}`);
      let insertedTeams = 0;
      let insertedPlayers = 0;
      const teamNumbers = teamCount === 31 ? [31] : Array.from({ length: teamCount }, (_, index) => index + 1);
      for (const teamNumber of teamNumbers) {
        const index = teamNumber - 1;
        const code = drawWorkspaceDemo
          ? schoolCodes[index % schoolCodes.length]!
          : process.env.DEMO_INTER_SCHOOL === "true"
          ? schoolCodes[index % 4]!
          : teamNumber <= 16 || teamNumber === 31 ? "SFL-HCM-IUH" : schoolCodes[1 + ((teamNumber - 17) % (schoolCodes.length - 1))]!;
        const school = schoolByCode.get(code)!;
        const captainNumber = teamNumber;
        const accountKey = drawWorkspaceDemo ? `draw-demo-captain-${String(captainNumber).padStart(2, "0")}` : `dataset-captain-${String(captainNumber).padStart(2, "0")}`;
        const captainEmail = drawWorkspaceDemo ? `drawdemo.captain${String(captainNumber).padStart(2, "0")}@football.local` : `dataset.captain${String(captainNumber).padStart(2, "0")}@football.local`;
        const captainId = idFor(accountKey);
        const teamId = idFor(drawWorkspaceDemo ? `draw-demo-team-${String(teamNumber).padStart(2, "0")}` : `dataset-team-${String(teamNumber).padStart(2, "0")}`);
        const prefix = school.short_name ?? code.replace("SFL-HCM-", "");
        const logo = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='32' fill='%232b6742'/%3E%3Ctext x='50%25' y='56%25' text-anchor='middle' font-family='Arial' font-size='22' font-weight='700' fill='white'%3E${String(teamNumber).padStart(2, "0")}%3C/text%3E%3C/svg%3E`;
        const teamName = drawWorkspaceDemo
          ? `${prefix} Draw Demo Club ${String(teamNumber).padStart(2, "0")}`
          : teamNumber <= 16 || teamNumber === 31
          ? `IUH Demo Club ${String(teamNumber).padStart(2, "0")}`
          : `${prefix} Demo Club ${String(teamNumber).padStart(2, "0")}`;
        const teamCheck = await client.query<{ id: string; captain_id: string; institution_id: string; name: string }>(
          `SELECT id,captain_id,institution_id,name FROM teams WHERE id=$1`, [teamId],
        );
        if (teamCheck.rowCount) {
          const row = teamCheck.rows[0]!;
          if (row.captain_id !== captainId || row.institution_id !== school.id || row.name !== teamName) {
            throw new Error(`Stable demo team ID collision at ${teamName}`);
          }
        } else {
          const sameName = await client.query("SELECT 1 FROM teams WHERE institution_id=$1 AND LOWER(name)=LOWER($2)", [school.id, teamName]);
          if (sameName.rowCount) throw new Error(`Demo team name already belongs to unrelated data: ${teamName}`);
          await client.query(
            `INSERT INTO teams(id,name,short_name,description,logo_url,institution_id,captain_id,contact_email,contact_phone,
              max_players,is_active,unit_name,representative_name,kit_color)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,25,TRUE,$10,$11,$12)`,
            [teamId, teamName, `${prefix}-${String(teamNumber).padStart(2, "0")}`, `${teamName} là câu lạc bộ dữ liệu kiểm thử.`, logo,
              school.id, captainId, captainEmail, "0900000000",
              "CLB sinh viên (DEMO)", nameFor(700 + captainNumber), ["Xanh đậm", "Đỏ", "Trắng", "Xanh lá"][teamNumber % 4]],
          );
          insertedTeams += 1;
        }
        await client.query("UPDATE teams SET logo_url=COALESCE(logo_url,$2) WHERE id=$1", [teamId, logo]);

        for (let member = 1; member <= playersPerTeam; member += 1) {
          const playerNumber = index * playersPerTeam + member;
          const key = drawWorkspaceDemo ? `draw-demo-player-${String(playerNumber).padStart(4, "0")}` : `dataset-player-${String(playerNumber).padStart(4, "0")}`;
          const playerId = idFor(key);
          const userId = idFor(key);
          const email = drawWorkspaceDemo ? `drawdemo.player${String(playerNumber).padStart(4, "0")}@football.local` : `dataset.player${String(playerNumber).padStart(4, "0")}@football.local`;
          const playerName = nameFor(playerNumber);
          const jersey = member;
          const position = member === 1 ? "GK" : member <= 6 ? "DEF" : member <= 14 ? "MID" : "FWD";
          const existing = await client.query<{ team_id: string; user_id: string | null }>(
            `SELECT team_id,user_id FROM players WHERE id=$1`, [playerId],
          );
          if (existing.rowCount) {
            const row = existing.rows[0]!;
            if (row.team_id !== teamId || row.user_id !== userId) throw new Error(`Stable player ID collision for ${email}`);
            continue;
          }
          const activeMembership = await client.query("SELECT 1 FROM players WHERE user_id=$1 AND left_at IS NULL", [userId]);
          if (activeMembership.rowCount) throw new Error(`Player account is already linked to another active club: ${email}`);
          const studentId = `${drawWorkspaceDemo ? "DRAW26" : "SFTMS26"}${String(playerNumber).padStart(6, "0")}`;
          await client.query(
            `INSERT INTO players(id,team_id,user_id,full_name,birth_date,student_id,contact_email,evidence_url,jersey_number,position,is_captain)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,FALSE)`,
            [playerId, teamId, userId, playerName, `200${1 + (playerNumber % 6)}-${String((playerNumber % 12) + 1).padStart(2, "0")}-${String((playerNumber % 27) + 1).padStart(2, "0")}`,
              studentId, email, `https://demo.invalid/evidence/${key}`, jersey, position],
          );
          insertedPlayers += 1;
        }
      }
      await client.query("COMMIT");
      const counts = await client.query(
        `SELECT COUNT(DISTINCT t.id)::int AS teams, COUNT(p.id)::int AS players,
          COUNT(DISTINCT t.id) FILTER (WHERE i.code='SFL-HCM-IUH')::int AS iuh_teams
         FROM teams t JOIN institutions i ON i.id=t.institution_id
         LEFT JOIN players p ON p.team_id=t.id AND p.user_id IS NOT NULL AND p.left_at IS NULL
         WHERE t.id IN (SELECT id FROM teams WHERE name LIKE '%Demo Club %')`,
      );
      console.log(JSON.stringify({ seed: "tournament-demo-clubs", teamsRequested: teamCount, playersPerTeam, insertedTeams, insertedPlayers, totalSeeded: counts.rows[0] }, null, 2));
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  } finally { await pool.end(); }
}

if (require.main === module) main().catch((error: unknown) => { console.error("[tournament-demo-clubs] failed", error); process.exitCode = 1; });
