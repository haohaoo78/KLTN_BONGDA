import { getPool } from "../lib/db";
import { findUserById, type UserRecord } from "./userRepository";
import { AppError } from "../../lib/errors";

export type EditableAccountProfile = {
  phone?: string | null;
  address?: string | null;
  birthDate?: string | null;
  gender?: string | null;
  faculty?: string | null;
  major?: string | null;
  academicYear?: string | null;
  playingPosition?: string | null;
  dominantFoot?: string | null;
  heightCm?: string | null;
  weightKg?: string | null;
};

const editableProfileFields = [
  "phone", "address", "birthDate", "gender", "faculty", "major",
  "academicYear", "playingPosition", "dominantFoot", "heightCm", "weightKg",
] as const;

export type AccountProfileHistoryRecord = {
  id: number;
  changes: Record<string, unknown>;
  changedAt: string;
};

export async function getAccountProfileData(
  userId: string,
): Promise<EditableAccountProfile> {
  const result = await getPool().query<{ profile_data: EditableAccountProfile }>(
    `SELECT profile_data FROM account_profiles WHERE user_id = $1`,
    [userId],
  );
  const data = result.rows[0]?.profile_data ?? {};
  return Object.fromEntries(editableProfileFields
    .filter((key) => typeof data[key] === "string")
    .map((key) => [key, data[key]])) as EditableAccountProfile;
}

export async function updateAccountProfile(input: {
  userId: string;
  fullName?: string;
  studentId?: string | null;
  profileData?: EditableAccountProfile;
}): Promise<{ user: UserRecord; profileData: EditableAccountProfile }> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const account = await client.query<{ id: string }>(
      "SELECT id FROM users WHERE id = $1 AND is_active = TRUE FOR UPDATE",
      [input.userId],
    );
    if (!account.rowCount) {
      throw new AppError(404, "User not found", "NOT_FOUND");
    }

    const changes: Record<string, unknown> = {};
    if (input.fullName !== undefined) {
      await client.query(
        "UPDATE users SET full_name = $1, updated_at = NOW() WHERE id = $2",
        [input.fullName, input.userId],
      );
      changes.fullName = input.fullName;
    }
    if (input.studentId !== undefined) {
      await client.query(
        "UPDATE users SET student_id = $1, updated_at = NOW() WHERE id = $2",
        [input.studentId, input.userId],
      );
      changes.studentId = input.studentId;
    }
    let profileData: EditableAccountProfile = {};
    if (input.profileData) {
      const current = await client.query<{ profile_data: Record<string, unknown> }>(
        "SELECT profile_data FROM account_profiles WHERE user_id = $1 FOR UPDATE",
        [input.userId],
      );
      const merged = { ...(current.rows[0]?.profile_data ?? {}), ...input.profileData };
      await client.query(
        `INSERT INTO account_profiles (user_id, profile_data)
         VALUES ($1, $2::jsonb)
         ON CONFLICT (user_id) DO UPDATE
         SET profile_data = EXCLUDED.profile_data, updated_at = NOW()`,
        [input.userId, JSON.stringify(merged)],
      );
      profileData = Object.fromEntries(editableProfileFields
        .filter((key) => typeof merged[key] === "string")
        .map((key) => [key, merged[key]])) as EditableAccountProfile;
      changes.profileData = input.profileData;
    }
    if (Object.keys(changes).length) {
      await client.query(
        `INSERT INTO account_profile_history (user_id, changes)
         VALUES ($1, $2::jsonb)`,
        [input.userId, JSON.stringify(changes)],
      );
    }
    await client.query("COMMIT");
    const user = await findUserById(input.userId);
    if (!user) {
      throw new AppError(404, "User not found", "NOT_FOUND");
    }
    if (!input.profileData) {
      profileData = await getAccountProfileData(input.userId);
    }
    return { user, profileData };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listAccountProfileHistory(
  userId: string,
): Promise<AccountProfileHistoryRecord[]> {
  const result = await getPool().query<{
    id: number;
    changes: Record<string, unknown>;
    changed_at: Date;
  }>(
    `SELECT id, changes, changed_at FROM account_profile_history
     WHERE user_id = $1 ORDER BY changed_at DESC LIMIT 50`,
    [userId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    changes: row.changes,
    changedAt: row.changed_at.toISOString(),
  }));
}
