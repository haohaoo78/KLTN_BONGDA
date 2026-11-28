import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { Pool } from "pg";

const schools = ["SFL-HCM-IUH", "SFL-HCM-HUTECH", "SFL-HCM-UEF", "SFL-HCM-UEH", "SFL-HCM-CAOTHANG", "SFL-HCM-HITU", "SFL-HCM-TDC", "SFL-HCM-HCMCT"];
const teamCount = Number(process.env.DEMO_TEAM_COUNT ?? 30);
const playerCount = Number(process.env.DEMO_PLAYERS_PER_TEAM ?? 20);
const firstNames = ["An", "Bảo", "Châu", "Dũng", "Đạt", "Giang", "Hải", "Huy", "Khang", "Khánh", "Khoa", "Long", "Minh", "Nam", "Phát", "Phúc", "Quân", "Sơn", "Tài", "Thành", "Thịnh", "Tuấn", "Việt", "Vinh"];
const familyNames = ["Nguyễn", "Trần", "Lê", "Phạm", "Hoàng", "Phan", "Võ", "Đặng", "Bùi", "Đỗ", "Hồ", "Ngô"];

function idFor(key: string): string {
  const bytes = createHash("sha256").update(`sftms-demo-dataset-v1:${key}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function nameFor(n: number): string {
  return `${familyNames[n % familyNames.length]} ${firstNames[(n * 7 + 3) % firstNames.length]} ${firstNames[(n * 11 + 9) % firstNames.length]}`;
}

async function main(): Promise<void> {
  if (!(process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test")) throw new Error("Demo dataset seeding is restricted to development/test");
  if (!Number.isInteger(teamCount) || teamCount < 8 || teamCount > 32 || !Number.isInteger(playerCount) || playerCount !== 20) throw new Error("DEMO_TEAM_COUNT must be 8..32 and DEMO_PLAYERS_PER_TEAM must be 20");
  const databaseUrl = process.env.ACCOUNT_DATABASE_URL;
  const password = process.env.DEMO_ACCOUNT_PASSWORD;
  if (!databaseUrl || !password || password.length < 8) throw new Error("ACCOUNT_DATABASE_URL and DEMO_ACCOUNT_PASSWORD (8+ chars) are required");
  const organizationUrl = process.env.ORGANIZATION_SERVICE_URL ?? "http://organization-service:3004";
  const response = await fetch(`${organizationUrl}/internal/institution-catalog`, {
    headers: { "x-gateway-internal-key": process.env.INTERNAL_API_KEY ?? "" },
  });
  if (!response.ok) throw new Error(`Organization school catalog request failed: ${response.status}`);
  const body = await response.json() as { institutions: Array<{ id: string; code: string }> };
  const schoolIds = new Map(body.institutions.map((item) => [item.code, item.id]));
  if (schools.some((code) => !schoolIds.has(code))) throw new Error("The eight TP.HCM demo school catalog records are required");

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const drawWorkspaceDemo = process.env.DRAW_WORKSPACE_DEMO === "true";
    const client = await pool.connect();
    let created = 0;
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('sftms-demo-dataset-v1-auth')::bigint)");
      for (let captain = 1; captain <= teamCount; captain += 1) {
        const teamIndex = captain - 1;
        const schoolCode = drawWorkspaceDemo
          ? schools[teamIndex % schools.length]!
          : process.env.DEMO_INTER_SCHOOL === "true"
          ? schools[teamIndex % 4]!
          : captain <= 16 || captain === 31 ? "SFL-HCM-IUH" : schools[1 + ((teamIndex - 16) % (schools.length - 1))]!;
        const key = drawWorkspaceDemo ? `draw-demo-captain-${String(captain).padStart(2, "0")}` : `dataset-captain-${String(captain).padStart(2, "0")}`;
        const email = drawWorkspaceDemo ? `drawdemo.captain${String(captain).padStart(2, "0")}@football.local` : `dataset.captain${String(captain).padStart(2, "0")}@football.local`;
        const fullName = nameFor(700 + captain);
        const userId = idFor(key);
        await upsertUser(client, { key, email, fullName, userId, role: "TEAM_CAPTAIN", institutionId: schoolIds.get(schoolCode)!, passwordHash });
        created += 1;
      }
      for (let staff = 1; staff <= 10; staff += 1) {
        const schoolCode = schools[(staff - 1) % schools.length]!;
        const key = drawWorkspaceDemo ? `draw-demo-btc-${String(staff).padStart(2, "0")}` : `dataset-btc-${String(staff).padStart(2, "0")}`;
        const email = drawWorkspaceDemo ? `drawdemo.btc${String(staff).padStart(2, "0")}@football.local` : `dataset.btc${String(staff).padStart(2, "0")}@football.local`;
        await upsertUser(client, {
          key,
          email,
          fullName: `BTC Demo Staff ${String(staff).padStart(2, "0")}`,
          userId: idFor(key),
          role: "BTC",
          institutionId: schoolIds.get(schoolCode)!,
          passwordHash,
        });
        created += 1;
      }
      for (let player = 1; player <= teamCount * playerCount; player += 1) {
        const teamIndex = Math.floor((player - 1) / playerCount);
        const schoolCode = drawWorkspaceDemo
          ? schools[teamIndex % schools.length]!
          : process.env.DEMO_INTER_SCHOOL === "true"
          ? schools[teamIndex % 4]!
          : teamIndex < 16 || teamIndex === 30 ? "SFL-HCM-IUH" : schools[1 + ((teamIndex - 16) % (schools.length - 1))]!;
        const key = drawWorkspaceDemo ? `draw-demo-player-${String(player).padStart(4, "0")}` : `dataset-player-${String(player).padStart(4, "0")}`;
        const email = drawWorkspaceDemo ? `drawdemo.player${String(player).padStart(4, "0")}@football.local` : `dataset.player${String(player).padStart(4, "0")}@football.local`;
        const fullName = nameFor(player);
        const studentId = `${drawWorkspaceDemo ? "DRAW26" : "SFTMS26"}${String(player).padStart(6, "0")}`;
        await upsertUser(client, { key, email, fullName, userId: idFor(key), role: "PLAYER", institutionId: schoolIds.get(schoolCode)!, passwordHash, studentId });
        created += 1;
      }
      const staff = [
        { key: "dataset-admin-01", email: "dataset.admin01@football.local", role: "ADMIN" as const, name: "Quản trị viên Demo 01" },
        { key: "dataset-referee-01", email: "dataset.referee01@football.local", role: "REFEREE" as const, name: "Trọng tài Demo 01" },
        { key: "dataset-viewer-01", email: "dataset.viewer01@football.local", role: "VIEWER" as const, name: "Khán giả Demo 01" },
      ];
      for (const account of staff) {
        await upsertUser(client, { key: account.key, email: account.email, fullName: account.name, userId: idFor(account.key), role: account.role, institutionId: schoolIds.get("SFL-HCM-IUH")!, passwordHash });
        created += 1;
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
    const counts = await pool.query<{ role: string; count: string }>(
      `SELECT ur.role, COUNT(*)::text AS count FROM demo_account_registry d
       JOIN user_roles ur ON ur.user_id=d.user_id
       WHERE d.seed_key LIKE 'dataset-captain-%' OR d.seed_key LIKE 'dataset-player-%'
          OR d.seed_key LIKE 'dataset-btc-%' OR d.seed_key LIKE 'dataset-extra-player-%'
       GROUP BY ur.role ORDER BY ur.role`,
    );
    console.log(JSON.stringify({ seed: "tournament-demo-accounts", attempted: created, roleCounts: counts.rows }, null, 2));
  } finally { await pool.end(); }
}

async function upsertUser(client: import("pg").PoolClient, input: {
  key: string; email: string; fullName: string; userId: string; role: "ADMIN" | "TEAM_CAPTAIN" | "PLAYER" | "BTC" | "REFEREE" | "VIEWER";
  institutionId: string; passwordHash: string; studentId?: string;
}): Promise<void> {
  const resetPasswordEmails = new Set((process.env.DEMO_RESET_ACCOUNT_EMAILS ?? "")
    .split(",").map((email) => email.trim().toLowerCase()).filter(Boolean));
  const existing = await client.query<{ id: string; seed_key: string | null }>(
    `SELECT u.id, d.seed_key FROM users u LEFT JOIN demo_account_registry d ON d.user_id=u.id WHERE LOWER(u.email)=LOWER($1)`,
    [input.email],
  );
  if (existing.rowCount && (existing.rows[0]!.id !== input.userId || existing.rows[0]!.seed_key !== input.key)) {
    throw new Error(`Refusing to modify unrelated account ${input.email}`);
  }
  if (!existing.rowCount) {
    await client.query(
      `INSERT INTO users(id,email,password_hash,full_name,student_id,is_active,email_verified,institution_id)
       VALUES($1,$2,$3,$4,$5,TRUE,TRUE,$6)`,
      [input.userId, input.email, input.passwordHash, input.fullName, input.studentId ?? null, input.institutionId],
    );
    await client.query("INSERT INTO demo_account_registry(user_id,seed_key,email) VALUES($1,$2,$3)", [input.userId,input.key,input.email]);
  } else {
    await client.query("UPDATE users SET institution_id=COALESCE(institution_id,$2) WHERE id=$1", [input.userId,input.institutionId]);
    if (resetPasswordEmails.has(input.email.toLowerCase())) {
      await client.query("UPDATE users SET password_hash=$2 WHERE id=$1", [input.userId,input.passwordHash]);
    }
  }
  if (input.studentId) {
    const collision = await client.query("SELECT 1 FROM users WHERE student_id=$1 AND id<>$2", [input.studentId,input.userId]);
    if (collision.rowCount) throw new Error(`Student ID collision for ${input.email}`);
  }
  await client.query("INSERT INTO user_roles(user_id,role) VALUES($1,$2) ON CONFLICT DO NOTHING", [input.userId,input.role]);
  await client.query("INSERT INTO user_roles(user_id,role) VALUES($1,'VIEWER') ON CONFLICT DO NOTHING", [input.userId]);
  const index = Number(input.studentId?.replace(/^(?:SFTMS26|DRAW26)/, "") ?? 0);
  const position = ["GK", "DEF", "MID", "FWD"][index % 4];
  await client.query(
    `INSERT INTO account_profiles(user_id,profile_data) VALUES($1,$2::jsonb) ON CONFLICT(user_id) DO NOTHING`,
    [input.userId, JSON.stringify({ demoData: true, institutionId: input.institutionId, studentId: input.studentId ?? null, playingPosition: position, major: "Ngành học mẫu (DEMO)", academicYear: "2022-2026" })],
  );
}

if (require.main === module) main().catch((error: unknown) => { console.error("[tournament-demo-accounts] failed", error); process.exitCode = 1; });
