import bcrypt from "bcryptjs";
import { Pool, type PoolClient } from "pg";

type Role = "ADMIN" | "BTC" | "TEAM_CAPTAIN" | "PLAYER" | "VIEWER";
type ApplicationStatus = "APPROVED" | "PENDING" | "REJECTED";
type DemoAccount = {
  key: string;
  email: string;
  fullName: string;
  role?: Role;
  schoolCode?: string;
  requestedRole?: "TEAM_CAPTAIN" | "PLAYER";
  applicationStatus?: ApplicationStatus;
  studentId?: string;
  birthDate?: string;
  gender?: string;
  playingPosition?: string;
  dominantFoot?: string;
  heightCm?: number;
  weightKg?: number;
  reason?: string;
  commitment?: string;
  verified?: boolean;
};

const accounts: DemoAccount[] = [
  { key: "admin-hcm", email: "admin.hcm.demo@football.local", fullName: "Nguyễn Minh Quân", role: "ADMIN" },
  { key: "btc-iuh", email: "btc.iuh@football.local", fullName: "Trần Quốc Bảo", schoolCode: "SFL-HCM-IUH" },
  { key: "btc-hutech", email: "btc.hutech@football.local", fullName: "Lê Hoàng Nam", schoolCode: "SFL-HCM-HUTECH" },
  { key: "btc-uef", email: "btc.uef@football.local", fullName: "Nguyễn Thành Long", schoolCode: "SFL-HCM-UEF" },
  { key: "btc-ueh", email: "btc.ueh@football.local", fullName: "Phạm Minh Tuấn", schoolCode: "SFL-HCM-UEH" },
  { key: "captain-iuh", email: "captain.iuh@football.local", fullName: "Phạm Thành Đạt", schoolCode: "SFL-HCM-IUH", requestedRole: "TEAM_CAPTAIN", applicationStatus: "APPROVED", studentId: "DEMO-CAP-IUH-001", reason: "Đăng ký quản lý đội IUH Eagles - DEMO", commitment: "Cam kết quản lý đội theo điều lệ - DEMO" },
  { key: "captain-hutech", email: "captain.hutech@football.local", fullName: "Nguyễn Hoàng Phúc", schoolCode: "SFL-HCM-HUTECH", requestedRole: "TEAM_CAPTAIN", applicationStatus: "APPROVED", studentId: "DEMO-CAP-HUT-001", reason: "Đăng ký quản lý đội HUTECH Tigers - DEMO", commitment: "Cam kết quản lý đội theo điều lệ - DEMO" },
  { key: "captain-uef", email: "captain.uef@football.local", fullName: "Lê Quốc Huy", schoolCode: "SFL-HCM-UEF", requestedRole: "TEAM_CAPTAIN", applicationStatus: "PENDING", studentId: "DEMO-CAP-UEF-001", reason: "Đăng ký quản lý đội UEF United - DEMO", commitment: "Cam kết quản lý đội theo điều lệ - DEMO" },
  { key: "captain-ueh", email: "captain.ueh@football.local", fullName: "Trần Minh Khang", schoolCode: "SFL-HCM-UEH", requestedRole: "TEAM_CAPTAIN", applicationStatus: "PENDING", studentId: "DEMO-CAP-UEH-001", reason: "Đăng ký quản lý đội UEH FC - DEMO", commitment: "Cam kết quản lý đội theo điều lệ - DEMO" },
  { key: "captain-rejected", email: "captain.rejected@football.local", fullName: "Trần Hoàng Sơn", schoolCode: "SFL-HCM-IUH", requestedRole: "TEAM_CAPTAIN", applicationStatus: "REJECTED", studentId: "DEMO-CAP-IUH-002", reason: "Đăng ký đội thử nghiệm - DEMO", commitment: "Cam kết quản lý đội - DEMO" },
  { key: "player-iuh", email: "player.iuh@football.local", fullName: "Nguyễn Văn Minh", schoolCode: "SFL-HCM-IUH", requestedRole: "PLAYER", applicationStatus: "APPROVED", studentId: "21000001", playingPosition: "MID", dominantFoot: "RIGHT", heightCm: 172, weightKg: 66 },
  { key: "player-iuh2", email: "player.iuh2@football.local", fullName: "Võ Nhật Huy", schoolCode: "SFL-HCM-IUH", requestedRole: "PLAYER", applicationStatus: "APPROVED", studentId: "21000002", playingPosition: "DEF", dominantFoot: "RIGHT", heightCm: 175, weightKg: 70 },
  { key: "player-iuh3", email: "player.iuh3@football.local", fullName: "Lê Hoàng Phát", schoolCode: "SFL-HCM-IUH", requestedRole: "PLAYER", applicationStatus: "APPROVED", studentId: "22000003", playingPosition: "FWD", dominantFoot: "LEFT", heightCm: 169, weightKg: 63 },
  { key: "player-hutech", email: "player.hutech@football.local", fullName: "Trần Đức Anh", schoolCode: "SFL-HCM-HUTECH", requestedRole: "PLAYER", applicationStatus: "APPROVED", studentId: "22000004", playingPosition: "GK", dominantFoot: "RIGHT", heightCm: 181, weightKg: 76 },
  { key: "player-hutech2", email: "player.hutech2@football.local", fullName: "Nguyễn Gia Bảo", schoolCode: "SFL-HCM-HUTECH", requestedRole: "PLAYER", applicationStatus: "APPROVED", studentId: "22000005", playingPosition: "MID", dominantFoot: "LEFT", heightCm: 170, weightKg: 65 },
  { key: "player-hutech3", email: "player.hutech3@football.local", fullName: "Lâm Quốc Hưng", schoolCode: "SFL-HCM-HUTECH", requestedRole: "PLAYER", applicationStatus: "APPROVED", studentId: "DEMO-PLY-HUT-013", playingPosition: "DEF", dominantFoot: "RIGHT", heightCm: 176, weightKg: 69 },
  { key: "player-uef", email: "player.uef@football.local", fullName: "Phạm Nhật Nam", schoolCode: "SFL-HCM-UEF", requestedRole: "PLAYER", applicationStatus: "PENDING", studentId: "23000006", playingPosition: "DEF", dominantFoot: "RIGHT", heightCm: 174, weightKg: 68 },
  { key: "player-ueh", email: "player.ueh@football.local", fullName: "Đỗ Minh Khôi", schoolCode: "SFL-HCM-UEH", requestedRole: "PLAYER", applicationStatus: "PENDING", studentId: "23000007", playingPosition: "MID", dominantFoot: "RIGHT", heightCm: 171, weightKg: 64 },
  { key: "player-pending", email: "player.pending@football.local", fullName: "Bùi Quốc Việt", schoolCode: "SFL-HCM-IUH", requestedRole: "PLAYER", applicationStatus: "PENDING", studentId: "23000008", playingPosition: "FWD", dominantFoot: "LEFT", heightCm: 173, weightKg: 67 },
  { key: "player-join", email: "player.join@football.local", fullName: "Võ Thành Trung", schoolCode: "SFL-HCM-IUH", requestedRole: "PLAYER", applicationStatus: "APPROVED", studentId: "23000009", playingPosition: "MID", dominantFoot: "RIGHT", heightCm: 168, weightKg: 62 },
  { key: "player-free", email: "player.free@football.local", fullName: "Nguyễn Anh Khoa", schoolCode: "SFL-HCM-HUTECH", requestedRole: "PLAYER", applicationStatus: "APPROVED", studentId: "23000010", playingPosition: "DEF", dominantFoot: "RIGHT", heightCm: 177, weightKg: 71 },
  { key: "player-rejected", email: "player.rejected@football.local", fullName: "Nguyễn Quốc Thịnh", schoolCode: "SFL-HCM-IUH", requestedRole: "PLAYER", applicationStatus: "REJECTED", studentId: "DEMO-PLY-IUH-011", playingPosition: "FWD", dominantFoot: "LEFT", heightCm: 169, weightKg: 64 },
  { key: "player-new", email: "player.new@football.local", fullName: "Phạm Đức Tài", schoolCode: "SFL-HCM-HUTECH", requestedRole: "PLAYER", applicationStatus: "PENDING", studentId: "DEMO-PLY-HUT-012", playingPosition: "MID", dominantFoot: "RIGHT", heightCm: 172, weightKg: 66 },
  { key: "viewer-2", email: "viewer.demo2@football.local", fullName: "Trần Ngọc Mai" },
  { key: "viewer-3", email: "viewer.demo3@football.local", fullName: "Lê Minh Anh" },
  { key: "viewer-pending", email: "viewer.pending@football.local", fullName: "Nguyễn Thanh Bình", verified: false },
];

const targetEmails = [
  "admin.demo@football.local",
  "viewer.demo@football.local",
];
const allowedLegacyAccounts = new Set(targetEmails);
const schoolNames: Record<string, string> = {
  "SFL-HCM-IUH": "Đại học Công nghiệp Thành phố Hồ Chí Minh",
  "SFL-HCM-HUTECH": "Trường Đại học Công nghệ Thành phố Hồ Chí Minh (HUTECH)",
  "SFL-HCM-UEF": "Trường Đại học Kinh tế - Tài chính Thành phố Hồ Chí Minh (UEF)",
  "SFL-HCM-UEH": "Đại học Kinh tế Thành phố Hồ Chí Minh (UEH)",
};

function applicationData(account: DemoAccount, index: number): Record<string, unknown> {
  const schoolName = schoolNames[account.schoolCode ?? ""] ?? "Không áp dụng";
  const data: Record<string, unknown> = {
    birthDate: account.birthDate ?? `${2001 + (index % 5)}-${String((index % 12) + 1).padStart(2, "0")}-${String((index % 27) + 1).padStart(2, "0")}`,
    gender: account.gender ?? (index % 2 === 0 ? "MALE" : "FEMALE"),
    phone: `090${String(1000000 + index).slice(-7)}`,
    faculty: `Khoa Công nghệ thông tin (DEMO)`,
    major: `Ngành Quản trị thể thao (DEMO)`,
    academicYear: "2022-2026 (DEMO)",
    educationLevel: "Đại học (DEMO)",
    school: schoolName,
    studentId: account.studentId ?? `DEMO-${String(index + 1).padStart(4, "0")}`,
    address: `Địa chỉ thử nghiệm ${index + 1}, TP. Hồ Chí Minh (DEMO)`,
    avatarUrl: `https://demo.invalid/avatars/${account.key}.png`,
    evidenceUrl: `https://demo.invalid/evidence/${account.key}`,
    evidenceLabel: "MINH CHỨNG DEMO - không phải giấy tờ thật",
  };
  if (account.requestedRole === "PLAYER") {
    data.playingPosition = account.playingPosition ?? "MID";
    data.dominantFoot = account.dominantFoot ?? "RIGHT";
    data.heightCm = account.heightCm ?? 172;
    data.weightKg = account.weightKg ?? 66;
  } else if (account.requestedRole === "TEAM_CAPTAIN") {
    data.reason = account.reason;
    data.commitment = account.commitment;
  }
  return data;
}

async function transaction<T>(
  pool: Pool,
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
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

async function seedAccounts(
  pool: Pool,
  password: string,
  schoolIds: Map<string, string>,
): Promise<{ ids: Map<string, string>; created: number; skippedLegacy: string[] }> {
  const passwordHash = await bcrypt.hash(password, 10);
  return transaction(pool, async (client) => {
    if (schoolIds.size !== 4) {
      throw new Error("Run organization-migrate first; all four HCMC demo schools must exist");
    }
    const ids = new Map<string, string>();
    let created = 0;
    const skippedLegacy: string[] = [];

    for (const [index, account] of accounts.entries()) {
      const existing = await client.query<{
        id: string;
        full_name: string;
        registered_seed_key: string | null;
      }>(
        `SELECT u.id, u.full_name, r.seed_key AS registered_seed_key
         FROM users u
         LEFT JOIN demo_account_registry r ON r.user_id = u.id
         WHERE LOWER(u.email) = LOWER($1)`,
        [account.email],
      );
      let userId: string;
      if (existing.rowCount) {
        const row = existing.rows[0];
        if (row.registered_seed_key !== account.key) {
          if (!allowedLegacyAccounts.has(account.email)) {
            throw new Error(`Refusing to overwrite pre-existing account ${account.email}`);
          }
          skippedLegacy.push(account.email);
          ids.set(account.email, row.id);
          continue;
        }
        userId = row.id;
      } else {
        if (account.studentId) {
          const collision = await client.query<{ email: string }>(
            "SELECT email FROM users WHERE student_id = $1",
            [account.studentId],
          );
          if (collision.rowCount) {
            throw new Error(`Student ID ${account.studentId} is already assigned to ${collision.rows[0].email}`);
          }
        }
        const primaryRole: Role = account.role ?? (account.requestedRole && account.applicationStatus === "APPROVED"
          ? account.requestedRole
          : account.email.startsWith("btc.")
            ? "BTC"
            : "VIEWER");
        const schoolId = account.schoolCode ? schoolIds.get(account.schoolCode) : null;
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO users
             (email, password_hash, full_name, student_id, is_active, email_verified, institution_id)
           VALUES ($1, $2, $3, $4, TRUE, $5, $6)
           RETURNING id`,
          [
            account.email,
            passwordHash,
            account.fullName,
            account.studentId ?? null,
            account.verified !== false,
            account.email.startsWith("btc.") ? schoolId : null,
          ],
        );
        userId = inserted.rows[0].id;
        await client.query(
          "INSERT INTO demo_account_registry (user_id, seed_key, email) VALUES ($1, $2, $3)",
          [userId, account.key, account.email],
        );
        await client.query(
          "INSERT INTO user_roles (user_id, role) VALUES ($1, $2)",
          [userId, primaryRole],
        );
        if (primaryRole !== "VIEWER" && !account.email.startsWith("btc.")) {
          await client.query(
            "INSERT INTO user_roles (user_id, role) VALUES ($1, 'VIEWER') ON CONFLICT DO NOTHING",
            [userId],
          );
        }
        created += 1;
      }

      const profile = applicationData(account, index);
      await client.query(
        `INSERT INTO account_profiles (user_id, profile_data)
         VALUES ($1, $2::jsonb) ON CONFLICT (user_id) DO NOTHING`,
        [userId, JSON.stringify({ ...profile, demoData: true })],
      );
      ids.set(account.key, userId);

      if (account.requestedRole && account.applicationStatus) {
        const roles = await client.query(
          "SELECT 1 FROM user_roles WHERE user_id = $1 AND role = $2",
          [userId, account.requestedRole],
        );
        if (account.applicationStatus === "APPROVED" && !roles.rowCount) {
          await client.query(
            "INSERT INTO user_roles (user_id, role) VALUES ($1, $2) ON CONFLICT DO NOTHING",
            [userId, account.requestedRole],
          );
          if (account.schoolCode) {
            await client.query(
              "UPDATE users SET institution_id = $2 WHERE id = $1 AND institution_id IS NULL",
              [userId, schoolIds.get(account.schoolCode)],
            );
          }
        }
        const application = await client.query(
          "SELECT id FROM role_applications WHERE user_id = $1 AND requested_role = $2 LIMIT 1",
          [userId, account.requestedRole],
        );
        if (!application.rowCount) {
          const reviewer = account.schoolCode
            ? ids.get(`btc-${account.schoolCode.replace("SFL-HCM-", "").toLowerCase()}`)
            : undefined;
          const decisionNote = account.applicationStatus === "REJECTED"
            ? "Hồ sơ demo bị từ chối để kiểm thử trạng thái; không phản ánh quyết định thật."
            : null;
          await client.query(
            `INSERT INTO role_applications
               (user_id, requested_role, institution_id, application_data, message,
                status, decision_note, reviewed_by, reviewed_at)
             VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8,
                     CASE WHEN $6::varchar = 'PENDING' THEN NULL ELSE NOW() END)`,
            [
              userId,
              account.requestedRole,
              account.schoolCode ? schoolIds.get(account.schoolCode) : null,
              JSON.stringify(profile),
              `Hồ sơ đăng ký ${account.requestedRole} - DEMO`,
              account.applicationStatus,
              decisionNote,
              account.applicationStatus === "PENDING" ? null : reviewer ?? null,
            ],
          );
        }
      }
    }
    return { ids, created, skippedLegacy };
  });
}

async function seedOrganization(
  pool: Pool,
  accountIds: Map<string, string>,
): Promise<void> {
  await transaction(pool, async (client) => {
    const schools = await client.query<{ id: string; code: string }>(
      "SELECT id, code FROM institutions WHERE code = ANY($1::text[])",
      [["SFL-HCM-IUH", "SFL-HCM-HUTECH", "SFL-HCM-UEF", "SFL-HCM-UEH"]],
    );
    const schoolIds = new Map(schools.rows.map((school) => [school.code, school.id]));
    if (schoolIds.size !== 4) throw new Error("The school catalog is incomplete");

    const teamDefinitions = [
      { code: "SFL-HCM-IUH", name: "IUH Eagles", captainKey: "captain-iuh", reviewerKey: "btc-iuh", status: "APPROVED" },
      { code: "SFL-HCM-HUTECH", name: "HUTECH Tigers", captainKey: "captain-hutech", reviewerKey: "btc-hutech", status: "APPROVED" },
      { code: "SFL-HCM-IUH", name: "IUH Warriors", captainKey: "captain-iuh", reviewerKey: "btc-iuh", status: "PENDING" },
      { code: "SFL-HCM-HUTECH", name: "HUTECH Falcons", captainKey: "captain-hutech", reviewerKey: "btc-hutech", status: "PENDING" },
      { code: "SFL-HCM-UEF", name: "UEF United", captainKey: "captain-uef", reviewerKey: "btc-uef", status: "PENDING" },
      { code: "SFL-HCM-UEH", name: "UEH FC", captainKey: "captain-ueh", reviewerKey: "btc-ueh", status: "PENDING" },
    ] as const;
    const teamIds = new Map<string, string>();

    for (const team of teamDefinitions) {
      const applicantId = accountIds.get(team.captainKey);
      const institutionId = schoolIds.get(team.code);
      const reviewerId = accountIds.get(team.reviewerKey);
      if (!applicantId || !institutionId || !reviewerId) {
        throw new Error(`Missing seed relation for ${team.name}`);
      }
      let teamId: string | null = null;
      if (team.status === "APPROVED") {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO teams
             (name, short_name, description, institution_id, captain_id, contact_email,
              contact_phone, representative_name, unit_name, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE)
           ON CONFLICT DO NOTHING
           RETURNING id`,
          [
            team.name,
            team.name,
            `${team.name} là đội mẫu phục vụ kiểm thử SFTMS (DEMO).`,
            institutionId,
            applicantId,
            team.captainKey === "captain-iuh" ? "captain.iuh@football.local" : "captain.hutech@football.local",
            "0900000000",
            team.captainKey === "captain-iuh" ? "Phạm Thành Đạt" : "Nguyễn Hoàng Phúc",
            "CLB sinh viên (DEMO)",
          ],
        );
        const selected = inserted.rows[0]?.id
          ? inserted.rows[0]
          : (await client.query<{ id: string; captain_id: string }>(
              "SELECT id, captain_id FROM teams WHERE institution_id = $1 AND LOWER(name) = LOWER($2)",
              [institutionId, team.name],
            )).rows[0];
        if (!selected || ("captain_id" in selected && selected.captain_id !== applicantId)) {
          throw new Error(`Team name is already in use by unrelated data: ${team.name}`);
        }
        teamId = selected.id;
        teamIds.set(team.name, teamId);
      }

      const existing = await client.query<{ id: string; applicant_id: string }>(
        `SELECT id, applicant_id FROM club_requests
         WHERE institution_id = $1 AND LOWER(name) = LOWER($2)
         ORDER BY created_at LIMIT 1`,
        [institutionId, team.name],
      );
      if (existing.rowCount && existing.rows[0].applicant_id !== applicantId) {
        throw new Error(`Club request name is already in use by another applicant: ${team.name}`);
      }
      if (!existing.rowCount) {
        await client.query(
          `INSERT INTO club_requests
             (applicant_id, institution_id, name, captain_name, short_name, description,
              unit_name, contact_email, contact_phone, initial_members, status,
              decision_note, reviewed_by, reviewed_at, approved_team_id)
           VALUES ($1, $2, $3, $4, $3, $5, $6, $7, $8, $9::jsonb, $10,
                   CASE WHEN $10::varchar = 'APPROVED' THEN 'Đã duyệt yêu cầu CLB demo.' ELSE NULL END,
                   CASE WHEN $10::varchar = 'APPROVED' THEN $11::uuid ELSE NULL::uuid END,
                   CASE WHEN $10::varchar = 'APPROVED' THEN NOW() ELSE NULL END, $12)`,
          [
            applicantId,
            institutionId,
            team.name,
            team.captainKey === "captain-iuh" ? "Phạm Thành Đạt" :
              team.captainKey === "captain-hutech" ? "Nguyễn Hoàng Phúc" :
                team.captainKey === "captain-uef" ? "Lê Quốc Huy" : "Trần Minh Khang",
            `${team.name} - dữ liệu kiểm thử DEMO.`,
            "CLB sinh viên (DEMO)",
            team.captainKey === "captain-iuh" ? "captain.iuh@football.local" :
              team.captainKey === "captain-hutech" ? "captain.hutech@football.local" :
                team.captainKey === "captain-uef" ? "captain.uef@football.local" : "captain.ueh@football.local",
            "0900000000",
            JSON.stringify([{ name: "Danh sách thành viên mẫu", demo: true }]),
            team.status,
            reviewerId,
            teamId,
          ],
        );
      }
    }

    const memberships = [
      { teamName: "IUH Eagles", accountKey: "captain-iuh", jersey: 1, position: "MID", captain: true },
      { teamName: "IUH Eagles", accountKey: "player-iuh", jersey: 2, position: "MID" },
      { teamName: "IUH Eagles", accountKey: "player-iuh2", jersey: 3, position: "DEF" },
      { teamName: "IUH Eagles", accountKey: "player-iuh3", jersey: 4, position: "FWD" },
      { teamName: "HUTECH Tigers", accountKey: "captain-hutech", jersey: 1, position: "MID", captain: true },
      { teamName: "HUTECH Tigers", accountKey: "player-hutech", jersey: 2, position: "GK" },
      { teamName: "HUTECH Tigers", accountKey: "player-hutech2", jersey: 3, position: "MID" },
      { teamName: "HUTECH Tigers", accountKey: "player-hutech3", jersey: 4, position: "DEF" },
    ];
    for (const member of memberships) {
      const userId = accountIds.get(member.accountKey);
      const teamId = teamIds.get(member.teamName);
      if (!userId || !teamId) throw new Error(`Missing membership relation for ${member.accountKey}`);
      const existing = await client.query<{ team_id: string }>(
        "SELECT team_id FROM players WHERE user_id = $1 AND left_at IS NULL",
        [userId],
      );
      if (existing.rowCount && existing.rows[0].team_id !== teamId) {
        throw new Error(`Account ${member.accountKey} is already an active member of another team`);
      }
      const account = accounts.find((item) => item.key === member.accountKey);
      if (!account) throw new Error(`Unknown member ${member.accountKey}`);
      await client.query(
        `INSERT INTO players
           (team_id, user_id, full_name, birth_date, student_id, contact_email,
            evidence_url, jersey_number, position, is_captain)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (team_id, user_id) DO NOTHING`,
        [
          teamId,
          userId,
          account.fullName,
          account.birthDate ?? "2002-01-01",
          account.studentId ?? `DEMO-${member.accountKey}`,
          account.email,
          `https://demo.invalid/evidence/${member.accountKey}`,
          member.jersey,
          member.position,
          member.captain ?? false,
        ],
      );
    }

    const requests = [
      { team: "IUH Eagles", account: "player-join", status: "PENDING" },
      { team: "IUH Eagles", account: "player-iuh2", status: "APPROVED" },
      { team: "HUTECH Tigers", account: "player-free", status: "REJECTED" },
    ] as const;
    for (const request of requests) {
      const userId = accountIds.get(request.account);
      const teamId = teamIds.get(request.team);
      const applicant = accounts.find((item) => item.key === request.account);
      if (!userId || !teamId || !applicant) throw new Error("Missing player request relation");
      const existing = await client.query(
        "SELECT id FROM player_requests WHERE team_id = $1 AND user_id = $2 AND status = $3",
        [teamId, userId, request.status],
      );
      if (existing.rowCount) continue;
      await client.query(
        `INSERT INTO player_requests
           (team_id, user_id, full_name, birth_date, student_id, contact_email,
            message, status, responded_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
                 CASE WHEN $8::varchar = 'PENDING' THEN NULL ELSE NOW() END)`,
        [
          teamId,
          userId,
          applicant.fullName,
          applicant.birthDate ?? "2002-01-01",
          applicant.studentId ?? `DEMO-${request.account}`,
          applicant.email,
          `Yêu cầu gia nhập đội để kiểm thử trạng thái ${request.status} (DEMO).`,
          request.status,
        ],
      );
    }
  });
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("HCMC demo accounts can only be seeded when NODE_ENV=development");
  }
  const password = process.env.DEMO_ACCOUNT_PASSWORD;
  if (!password || password.length < 8) {
    throw new Error("Set DEMO_ACCOUNT_PASSWORD to a value of at least 8 characters");
  }
  const accountUrl = process.env.ACCOUNT_DATABASE_URL;
  const organizationUrl = process.env.ORGANIZATION_DATABASE_URL;
  if (!accountUrl || !organizationUrl) {
    throw new Error("ACCOUNT_DATABASE_URL and ORGANIZATION_DATABASE_URL are required");
  }

  const accountPool = new Pool({ connectionString: accountUrl });
  const organizationPool = new Pool({ connectionString: organizationUrl });
  try {
    const schoolResult = await organizationPool.query<{ id: string; code: string }>(
      "SELECT id, code FROM institutions WHERE code = ANY($1::text[])",
      [["SFL-HCM-IUH", "SFL-HCM-HUTECH", "SFL-HCM-UEF", "SFL-HCM-UEH"]],
    );
    const schoolIds = new Map(schoolResult.rows.map((school) => [school.code, school.id]));
    if (schoolIds.size !== 4) {
      throw new Error("Run organization-migrate first; all four HCMC demo schools must exist");
    }
    const accountResult = await seedAccounts(accountPool, password, schoolIds);
    await seedOrganization(organizationPool, accountResult.ids);
    console.log(JSON.stringify({
      message: "HCMC demo seed completed; existing users and statuses were not overwritten",
      createdAccounts: accountResult.created,
      legacyAccountsPreserved: accountResult.skippedLegacy,
      demoAccounts: accounts.length,
      unverifiedDemoAccounts: accounts.filter((account) => account.verified === false).map((account) => account.email),
      organizationFixtures: {
        approvedClubs: 2,
        pendingClubRequests: 4,
        approvedTeamMembers: 8,
        playerJoinRequests: ["PENDING", "APPROVED", "REJECTED"],
      },
    }, null, 2));
  } finally {
    await Promise.all([accountPool.end(), organizationPool.end()]);
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error("[hcm-school-demo-seed] failed", error);
    process.exitCode = 1;
  });
}
