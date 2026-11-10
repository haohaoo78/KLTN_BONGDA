import type { UserRole } from "@sfl/shared";
import type { UserRecord, UserCreateInput, UserProfileUpdateInput, UserAdminUpdateInput, ListUsersResult } from "../models/user";
import { AppError } from "../lib/errors";
import { getPool } from "../lib/db";

export type { UserRecord };

function mapUser(row: {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  student_id: string | null;
  institution_id: string | null;
  is_active: boolean;
  email_verified: boolean;
  roles: string[] | null;
  account_status?: "ACTIVE" | "LOCKED" | "DISABLED";
  created_at?: Date | string;
  updated_at?: Date | string;
  profile_data?: { phone?: string | null; address?: string | null } | null;
}): UserRecord {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    fullName: row.full_name,
    studentId: row.student_id,
    institutionId: row.institution_id,
    isActive: row.is_active,
    emailVerified: row.email_verified,
    roles: (row.roles ?? []) as UserRole[],
    ...(row.account_status ? { accountStatus: row.account_status } : {}),
    ...(row.created_at ? { createdAt: new Date(row.created_at).toISOString() } : {}),
    ...(row.updated_at ? { updatedAt: new Date(row.updated_at).toISOString() } : {}),
    ...(row.profile_data
      ? {
          profileData: {
            ...(typeof row.profile_data.phone === "string" ? { phone: row.profile_data.phone } : {}),
            ...(typeof row.profile_data.address === "string" ? { address: row.profile_data.address } : {}),
          },
        }
      : {}),
  };
}

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  const pool = getPool();
  const result = await pool.query<{
    id: string;
    email: string;
    password_hash: string;
    full_name: string;
    student_id: string | null;
    institution_id: string | null;
    is_active: boolean;
    email_verified: boolean;
    roles: string[] | null;
    account_status: "ACTIVE" | "LOCKED" | "DISABLED";
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT u.id, u.email, u.password_hash, u.full_name, u.student_id, u.institution_id, u.is_active,
            u.account_status, u.created_at, u.updated_at,
            u.email_verified,
            COALESCE(array_agg(ur.role) FILTER (WHERE ur.role IS NOT NULL), '{}') AS roles
     FROM users u
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     WHERE LOWER(u.email) = LOWER($1)
     GROUP BY u.id`,
    [email],
  );

  if (result.rowCount === 0) return null;
  return mapUser(result.rows[0]);
}

export async function findUserById(id: string): Promise<UserRecord | null> {
  const pool = getPool();
  const result = await pool.query<{
    id: string;
    email: string;
    password_hash: string;
    full_name: string;
    student_id: string | null;
    institution_id: string | null;
    is_active: boolean;
    email_verified: boolean;
    roles: string[] | null;
    account_status: "ACTIVE" | "LOCKED" | "DISABLED";
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT u.id, u.email, u.password_hash, u.full_name, u.student_id, u.institution_id, u.is_active,
            u.account_status, u.created_at, u.updated_at,
            u.email_verified,
            COALESCE(array_agg(ur.role) FILTER (WHERE ur.role IS NOT NULL), '{}') AS roles
     FROM users u
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     WHERE u.id = $1
     GROUP BY u.id`,
    [id],
  );

  if (result.rowCount === 0) return null;
  return mapUser(result.rows[0]);
}



export async function listUsers(
  limit: number,
  offset: number,
  filters: {
    search?: string;
    role?: UserRole;
    status?: "pending" | "active" | "inactive" | "disabled";
    institutionId?: string;
    createdFrom?: string;
    createdTo?: string;
    sortBy?: "createdAt" | "fullName" | "email";
    sortDirection?: "asc" | "desc";
  } = {},
): Promise<ListUsersResult> {
  const pool = getPool();
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (filters.search) {
    values.push(`%${filters.search}%`);
    conditions.push(`(u.full_name ILIKE $${values.length} OR u.email ILIKE $${values.length}
      OR COALESCE(u.student_id, '') ILIKE $${values.length} OR u.id::text ILIKE $${values.length})`);
  }
  if (filters.role) {
    values.push(filters.role);
    conditions.push(
      `EXISTS (SELECT 1 FROM user_roles filter_role
       WHERE filter_role.user_id = u.id AND filter_role.role = $${values.length})`,
    );
  }
  if (filters.institutionId) {
    values.push(filters.institutionId);
    conditions.push(`u.institution_id = $${values.length}`);
  }
  if (filters.status === "pending") {
    conditions.push("u.email_verified = FALSE AND u.account_status = 'ACTIVE'");
  } else if (filters.status === "active") {
    conditions.push("u.email_verified = TRUE AND u.account_status = 'ACTIVE' AND u.is_active = TRUE");
  } else if (filters.status === "inactive") {
    conditions.push("u.account_status = 'LOCKED' AND u.is_active = FALSE");
  } else if (filters.status === "disabled") {
    conditions.push("u.account_status = 'DISABLED'");
  }
  if (filters.createdFrom) {
    values.push(filters.createdFrom);
    conditions.push(`u.created_at >= $${values.length}::date`);
  }
  if (filters.createdTo) {
    values.push(filters.createdTo);
    conditions.push(`u.created_at < ($${values.length}::date + INTERVAL '1 day')`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const countResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM users u ${whereClause}`,
    values,
  );
  const total = Number(countResult.rows[0]?.count ?? 0);

  const statisticsResult = await pool.query<{
    total: string;
    active: string;
    locked: string;
    pending: string;
    disabled: string;
  }>(
    `SELECT COUNT(*)::text AS total,
            COUNT(*) FILTER (
              WHERE u.is_active = TRUE AND u.email_verified = TRUE AND u.account_status = 'ACTIVE'
            )::text AS active,
            COUNT(*) FILTER (WHERE u.account_status = 'LOCKED')::text AS locked,
            COUNT(*) FILTER (WHERE u.email_verified = FALSE AND u.account_status = 'ACTIVE')::text AS pending,
            COUNT(*) FILTER (WHERE u.account_status = 'DISABLED')::text AS disabled
     FROM users u`,
  );
  const stats = statisticsResult.rows[0];

  const paginationValues = [...values, limit, offset];
  const result = await pool.query<{
    id: string;
    email: string;
    password_hash: string;
    full_name: string;
    student_id: string | null;
    institution_id: string | null;
    is_active: boolean;
    email_verified: boolean;
    roles: string[] | null;
    account_status: "ACTIVE" | "LOCKED" | "DISABLED";
    created_at: Date;
    updated_at: Date;
    profile_data: { phone?: string | null; address?: string | null } | null;
  }>(
    `SELECT u.id, u.email, u.password_hash, u.full_name, u.student_id, u.institution_id, u.is_active,
            u.email_verified, u.account_status, u.created_at, u.updated_at,
            ap.profile_data,
            COALESCE(array_agg(ur.role) FILTER (WHERE ur.role IS NOT NULL), '{}') AS roles
     FROM users u
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     LEFT JOIN account_profiles ap ON ap.user_id = u.id
     ${whereClause}
     GROUP BY u.id, ap.profile_data
     ORDER BY ${
       filters.sortBy === "fullName" ? "u.full_name" :
       filters.sortBy === "email" ? "u.email" : "u.created_at"
     } ${filters.sortDirection === "asc" ? "ASC" : "DESC"}, u.id
     LIMIT $${paginationValues.length - 1} OFFSET $${paginationValues.length}`,
    paginationValues,
  );

  return {
    items: result.rows.map(mapUser),
    total,
    statistics: {
      total: Number(stats.total),
      active: Number(stats.active),
      locked: Number(stats.locked),
      pending: Number(stats.pending),
      disabled: Number(stats.disabled),
    },
  };
}

export async function listBtcAssignedInstitutionIds(institutionIds: string[]): Promise<string[]> {
  if (institutionIds.length === 0) return [];
  const pool = getPool();
  const result = await pool.query<{ institution_id: string }>(
    `SELECT DISTINCT u.institution_id
     FROM users u
     JOIN user_roles r ON r.user_id = u.id AND r.role = 'BTC'
     WHERE u.institution_id = ANY($1::uuid[])
       AND u.is_active = TRUE AND u.email_verified = TRUE AND u.account_status = 'ACTIVE'`,
    [institutionIds],
  );
  return result.rows.map((row) => row.institution_id);
}

export async function hasOtherBtcAssignment(
  institutionId: string,
  excludingUserId: string,
): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT 1
     FROM users u
     JOIN user_roles r ON r.user_id = u.id AND r.role = 'BTC'
     WHERE u.institution_id = $1 AND u.id <> $2
       AND u.is_active = TRUE AND u.email_verified = TRUE AND u.account_status = 'ACTIVE'
     LIMIT 1`,
    [institutionId, excludingUserId],
  );
  return Boolean(result.rowCount);
}

export async function createUser(input: UserCreateInput): Promise<UserRecord> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name, student_id, institution_id, is_active, email_verified)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        input.email.toLowerCase(),
        input.passwordHash,
        input.fullName,
        input.studentId,
        input.institutionId ?? null,
        input.isActive ?? true,
        input.emailVerified ?? true,
      ],
    );
    const userId = inserted.rows[0].id;
    for (const role of input.roles) {
      await client.query(
        "INSERT INTO user_roles (user_id, role) VALUES ($1, $2)",
        [userId, role],
      );
    }
    await client.query("COMMIT");
    const user = await findUserById(userId);
    if (!user) {
      throw new Error("Failed to load created user");
    }
    return user;
  } catch (err: unknown) {
    await client.query("ROLLBACK");
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "23505"
    ) {
      throw new AppError(409, "Email already exists", "EMAIL_EXISTS");
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function markUserEmailVerified(userId: string): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query(
    `UPDATE users
     SET email_verified = TRUE, updated_at = NOW()
     WHERE id = $1 AND is_active = TRUE`,
    [userId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function updateUserProfile(
  userId: string,
  input: UserProfileUpdateInput,
): Promise<UserRecord | null> {
  const pool = getPool();
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (input.fullName !== undefined) {
    sets.push(`full_name = $${idx++}`);
    values.push(input.fullName);
  }
  if (input.studentId !== undefined) {
    sets.push(`student_id = $${idx++}`);
    values.push(input.studentId);
  }
  if (input.institutionId !== undefined) {
    sets.push(`institution_id = $${idx++}`);
    values.push(input.institutionId);
  }
  if (input.passwordHash !== undefined) {
    sets.push(`password_hash = $${idx++}`);
    values.push(input.passwordHash);
  }
  if (sets.length === 0) {
    return findUserById(userId);
  }

  sets.push("updated_at = NOW()");
  values.push(userId);

  await pool.query(
    `UPDATE users SET ${sets.join(", ")} WHERE id = $${idx}`,
    values,
  );
  return findUserById(userId);
}

export async function updateUserAdmin(
  userId: string,
  input: UserAdminUpdateInput,
): Promise<UserRecord | null> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const targetResult = await client.query<{
      emailVerified: boolean;
      isAdmin: boolean;
      institutionId: string | null;
      roles: UserRole[];
      accountStatus: "ACTIVE" | "LOCKED" | "DISABLED";
      fullName: string;
      studentId: string | null;
      statusReason: string | null;
      profileData: { phone?: string | null; address?: string | null };
    }>(
      `SELECT u.email_verified AS "emailVerified",
              u.account_status AS "accountStatus",
              u.full_name AS "fullName",
              u.student_id AS "studentId",
              u.status_reason AS "statusReason",
              COALESCE(
                (SELECT profile_data FROM account_profiles WHERE user_id = u.id),
                '{}'::jsonb
              ) AS "profileData",
              u.institution_id AS "institutionId",
              EXISTS (
                SELECT 1 FROM user_roles
                WHERE user_id = u.id AND role = 'ADMIN'
              ) AS "isAdmin",
              COALESCE(
                (SELECT array_agg(role) FROM user_roles WHERE user_id = u.id),
                '{}'
              ) AS roles
       FROM users u
       WHERE u.id = $1
       FOR UPDATE`,
      [userId],
    );
    const target = targetResult.rows[0];
    if (!target) {
      await client.query("COMMIT");
      return null;
    }
    const resultingStatus = input.accountStatus ??
      (input.isActive === undefined
        ? target.accountStatus
        : input.isActive ? "ACTIVE" : "LOCKED");
    const resultingRoles = input.roles ?? target.roles;
    const resultingInstitutionId =
      input.institutionId === undefined ? target.institutionId : input.institutionId;
    if (resultingStatus === "ACTIVE" && !target.emailVerified) {
      throw new AppError(409, "Verify the email before activating this account", "EMAIL_VERIFICATION_REQUIRED");
    }
    if (resultingRoles.includes("BTC") && !resultingInstitutionId) {
      throw new AppError(400, "BTC accounts must be assigned to a school", "INSTITUTION_REQUIRED");
    }
    if (input.roles !== undefined) {
      const addedRoles = input.roles.filter((role) => !target.roles.includes(role));
      for (const role of addedRoles) {
        if (role === "PLAYER" || role === "TEAM_CAPTAIN") {
          const approval = await client.query(
            `SELECT 1 FROM role_applications
             WHERE user_id = $1 AND requested_role = $2 AND status = 'APPROVED'
             LIMIT 1`,
            [userId, role],
          );
          if (!approval.rowCount) {
            throw new AppError(
              409,
              `${role} must be granted through an approved role application`,
              "ROLE_APPLICATION_REQUIRED",
            );
          }
        }
        if (role === "REFEREE" && !target.emailVerified) {
          throw new AppError(409, "A referee account must verify its email before receiving the role", "EMAIL_VERIFICATION_REQUIRED");
        }
      }
    }

    const removesActiveAdmin =
      target.isAdmin &&
      ((resultingStatus !== "ACTIVE") ||
        (input.roles !== undefined && !input.roles.includes("ADMIN")));
    if (removesActiveAdmin) {
      await client.query(
        `SELECT u.id
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         WHERE ur.role = 'ADMIN' AND u.is_active = TRUE AND u.email_verified = TRUE
         FOR UPDATE OF u`,
      );
      const activeAdmins = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         WHERE ur.role = 'ADMIN' AND u.is_active = TRUE AND u.email_verified = TRUE
           AND u.id <> $1`,
        [userId],
      );
      if (Number(activeAdmins.rows[0]?.count ?? 0) === 0) {
        throw new AppError(409, "At least one active verified administrator must remain", "LAST_ADMIN");
      }
    }

    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    const before: Record<string, unknown> = {
      fullName: target.fullName,
      studentId: target.studentId,
      institutionId: target.institutionId,
      roles: target.roles,
      accountStatus: target.accountStatus,
      statusReason: target.statusReason,
      profileData: target.profileData,
    };
    const after: Record<string, unknown> = { ...before };

    if (input.fullName !== undefined) {
      sets.push(`full_name = $${idx++}`);
      values.push(input.fullName);
      after.fullName = input.fullName;
    }
    if (input.studentId !== undefined) {
      sets.push(`student_id = $${idx++}`);
      values.push(input.studentId);
      after.studentId = input.studentId;
    }
    if (input.institutionId !== undefined) {
      sets.push(`institution_id = $${idx++}`);
      values.push(input.institutionId);
      after.institutionId = input.institutionId;
    }
    if (input.profileData !== undefined) {
      const mergedProfile = { ...target.profileData, ...input.profileData };
      await client.query(
        `INSERT INTO account_profiles (user_id, profile_data)
         VALUES ($1, $2::jsonb)
         ON CONFLICT (user_id) DO UPDATE
         SET profile_data = EXCLUDED.profile_data, updated_at = NOW()`,
        [userId, JSON.stringify(mergedProfile)],
      );
      after.profileData = mergedProfile;
    }
    if (input.isActive !== undefined || input.accountStatus !== undefined) {
      sets.push(`is_active = $${idx++}`);
      values.push(resultingStatus === "ACTIVE");
      sets.push(`account_status = $${idx++}`);
      values.push(resultingStatus);
      sets.push(`status_reason = $${idx++}`);
      values.push(input.statusReason ?? null);
      sets.push(`status_changed_by = $${idx++}`);
      values.push(input.actorUserId ?? null);
      sets.push("status_changed_at = NOW()");
      after.accountStatus = resultingStatus;
      after.statusReason = input.statusReason ?? null;
    }

    if (sets.length > 0) {
      sets.push("updated_at = NOW()");
      values.push(userId);
      await client.query(
        `UPDATE users SET ${sets.join(", ")} WHERE id = $${idx}`,
        values,
      );
    }

    if (input.roles !== undefined) {
      await client.query("DELETE FROM user_roles WHERE user_id = $1", [userId]);
      for (const role of input.roles) {
        await client.query(
          "INSERT INTO user_roles (user_id, role) VALUES ($1, $2)",
          [userId, role],
        );
      }
      after.roles = input.roles;
    }

    if (
      input.fullName !== undefined ||
      input.studentId !== undefined ||
      input.institutionId !== undefined ||
      input.roles !== undefined ||
      input.profileData !== undefined ||
      input.isActive !== undefined ||
      input.accountStatus !== undefined
    ) {
      await client.query(
        `INSERT INTO account_profile_history (user_id, changes)
         VALUES ($1, $2::jsonb)`,
        [userId, JSON.stringify({
          action: input.accountStatus === "DISABLED"
            ? "ACCOUNT_DISABLED"
            : input.isActive !== undefined || input.accountStatus !== undefined
              ? "ACCOUNT_STATUS_CHANGE"
              : input.roles !== undefined
                ? "ROLE_CHANGE"
                : "ADMIN_UPDATE",
          before,
          after,
          actor: input.actorEmail ?? input.actorUserId ?? "ADMIN",
          actorUserId: input.actorUserId ?? null,
          reason: input.statusReason ?? null,
        })],
      );
    }

    await client.query("COMMIT");
    return findUserById(userId);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
