import type { PoolClient } from "pg";
import { AppError } from "../lib/errors";
import { getPool } from "../lib/db";

export type RoleApplication = {
  id: string;
  userId: string;
  email: string;
  fullName: string;
  requestedRole: "TEAM_CAPTAIN" | "PLAYER";
  institutionId: string;
  applicationData: Record<string, unknown>;
  message: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN";
  decisionNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  withdrawnAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type ApplicationRow = {
  id: string;
  user_id: string;
  email: string;
  full_name: string;
  requested_role: RoleApplication["requestedRole"];
  institution_id: string;
  application_data: Record<string, unknown>;
  message: string;
  status: RoleApplication["status"];
  decision_note: string | null;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  withdrawn_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

function mapApplication(row: ApplicationRow): RoleApplication {
  return {
    id: row.id,
    userId: row.user_id,
    email: row.email,
    fullName: row.full_name,
    requestedRole: row.requested_role,
    institutionId: row.institution_id,
    applicationData: row.application_data,
    message: row.message,
    status: row.status,
    decisionNote: row.decision_note,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at?.toISOString() ?? null,
    withdrawnAt: row.withdrawn_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

const applicationSelect = `
  SELECT a.id, a.user_id, u.email, u.full_name, a.requested_role,
         a.institution_id, a.application_data, a.message, a.status,
         a.decision_note, a.reviewed_by, a.reviewed_at, a.withdrawn_at,
         a.created_at, a.updated_at
  FROM role_applications a
  JOIN users u ON u.id = a.user_id
`;

async function getReviewerInstitution(
  client: PoolClient,
  reviewerId: string,
): Promise<string> {
  const result = await client.query<{ institution_id: string | null }>(
    `SELECT u.institution_id
     FROM users u
     JOIN user_roles r ON r.user_id = u.id AND r.role = 'BTC'
     WHERE u.id = $1 AND u.is_active = TRUE AND u.email_verified = TRUE
     FOR UPDATE OF u`,
    [reviewerId],
  );
  const institutionId = result.rows[0]?.institution_id;
  if (!institutionId) {
    throw new AppError(403, "BTC must have an active school assignment", "SCHOOL_ASSIGNMENT_REQUIRED");
  }
  return institutionId;
}

export async function createRoleApplication(input: {
  userId: string;
  requestedRole: RoleApplication["requestedRole"];
  institutionId: string;
  applicationData: Record<string, unknown>;
  message: string;
}): Promise<RoleApplication> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const account = await client.query<{
      is_active: boolean;
      email_verified: boolean;
      institution_id: string | null;
    }>(
      "SELECT is_active, email_verified, institution_id FROM users WHERE id = $1 FOR UPDATE",
      [input.userId],
    );
    if (!account.rowCount || !account.rows[0].is_active || !account.rows[0].email_verified) {
      throw new AppError(403, "An active, verified account is required", "ACCOUNT_NOT_VERIFIED");
    }
    if (account.rows[0].institution_id && account.rows[0].institution_id !== input.institutionId) {
      throw new AppError(409, "Your verified school cannot be changed through a role request", "SCHOOL_ALREADY_VERIFIED");
    }

    const existingRole = await client.query(
      "SELECT 1 FROM user_roles WHERE user_id = $1 AND role = $2",
      [input.userId, input.requestedRole],
    );
    if (existingRole.rowCount) {
      throw new AppError(409, "You already have this role", "ROLE_ALREADY_GRANTED");
    }

    const pending = await client.query(
      `SELECT 1 FROM role_applications
       WHERE user_id = $1 AND requested_role = $2 AND status = 'PENDING'`,
      [input.userId, input.requestedRole],
    );
    if (pending.rowCount) {
      throw new AppError(409, "A pending application for this role already exists", "APPLICATION_PENDING");
    }

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO role_applications
         (user_id, requested_role, institution_id, application_data, message)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       RETURNING id`,
      [
        input.userId,
        input.requestedRole,
        input.institutionId,
        JSON.stringify(input.applicationData),
        input.message,
      ],
    );
    const created = await client.query<ApplicationRow>(
      `${applicationSelect} WHERE a.id = $1`,
      [inserted.rows[0].id],
    );
    await client.query("COMMIT");
    return mapApplication(created.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function findRoleApplicationById(id: string): Promise<RoleApplication | null> {
  const pool = getPool();
  const result = await pool.query<ApplicationRow>(
    `${applicationSelect} WHERE a.id = $1`,
    [id],
  );
  return result.rowCount ? mapApplication(result.rows[0]) : null;
}

export async function findMyRoleApplicationById(
  id: string,
  userId: string,
): Promise<RoleApplication | null> {
  const pool = getPool();
  const result = await pool.query<ApplicationRow>(
    `${applicationSelect} WHERE a.id = $1 AND a.user_id = $2`,
    [id, userId],
  );
  return result.rowCount ? mapApplication(result.rows[0]) : null;
}

export async function updateMyRoleApplication(input: {
  applicationId: string;
  userId: string;
  institutionId: string;
  applicationData: Record<string, unknown>;
  message: string;
}): Promise<RoleApplication> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query<{ status: RoleApplication["status"] }>(
      `SELECT status FROM role_applications
       WHERE id = $1 AND user_id = $2
       FOR UPDATE`,
      [input.applicationId, input.userId],
    );
    if (!found.rowCount) {
      throw new AppError(404, "Role application not found", "NOT_FOUND");
    }
    if (found.rows[0].status !== "PENDING") {
      throw new AppError(409, "Only pending applications can be edited", "APPLICATION_NOT_EDITABLE");
    }
    const account = await client.query<{
      is_active: boolean;
      email_verified: boolean;
      institution_id: string | null;
    }>(
      `SELECT is_active, email_verified, institution_id
       FROM users WHERE id = $1 FOR UPDATE`,
      [input.userId],
    );
    if (!account.rowCount || !account.rows[0].is_active || !account.rows[0].email_verified) {
      throw new AppError(403, "An active, verified account is required", "ACCOUNT_NOT_VERIFIED");
    }
    if (account.rows[0].institution_id &&
        account.rows[0].institution_id !== input.institutionId) {
      throw new AppError(409, "Your verified school cannot be changed through a role request", "SCHOOL_ALREADY_VERIFIED");
    }
    await client.query(
      `UPDATE role_applications
       SET institution_id = $3, application_data = $4::jsonb, message = $5
       WHERE id = $1 AND user_id = $2`,
      [
        input.applicationId,
        input.userId,
        input.institutionId,
        JSON.stringify(input.applicationData),
        input.message,
      ],
    );
    const updated = await client.query<ApplicationRow>(
      `${applicationSelect} WHERE a.id = $1 AND a.user_id = $2`,
      [input.applicationId, input.userId],
    );
    await client.query("COMMIT");
    return mapApplication(updated.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function withdrawMyRoleApplication(
  applicationId: string,
  userId: string,
): Promise<RoleApplication> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query<{ status: RoleApplication["status"] }>(
      `SELECT status FROM role_applications
       WHERE id = $1 AND user_id = $2
       FOR UPDATE`,
      [applicationId, userId],
    );
    if (!found.rowCount) {
      throw new AppError(404, "Role application not found", "NOT_FOUND");
    }
    if (found.rows[0].status !== "PENDING") {
      throw new AppError(409, "Only pending applications can be withdrawn", "APPLICATION_NOT_WITHDRAWABLE");
    }
    await client.query(
      `UPDATE role_applications
       SET status = 'WITHDRAWN', withdrawn_at = NOW()
       WHERE id = $1 AND user_id = $2`,
      [applicationId, userId],
    );
    const withdrawn = await client.query<ApplicationRow>(
      `${applicationSelect} WHERE a.id = $1 AND a.user_id = $2`,
      [applicationId, userId],
    );
    await client.query("COMMIT");
    return mapApplication(withdrawn.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listRoleApplications(input: {
  userId?: string;
  status?: RoleApplication["status"];
  requestedRole?: RoleApplication["requestedRole"];
  search?: string;
  institutionId?: string;
  createdFrom?: string;
  createdTo?: string;
  limit?: number;
  offset?: number;
  reviewerId?: string;
  isAdmin?: boolean;
}): Promise<{ applications: RoleApplication[]; total: number }> {
  const pool = getPool();
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (input.userId) {
    values.push(input.userId);
    conditions.push(`a.user_id = $${values.length}`);
  }
  if (input.status) {
    values.push(input.status);
    conditions.push(`a.status = $${values.length}`);
  }
  if (input.requestedRole) {
    values.push(input.requestedRole);
    conditions.push(`a.requested_role = $${values.length}`);
  }
  if (input.search) {
    values.push(`%${input.search}%`);
    conditions.push(`(u.full_name ILIKE $${values.length} OR u.email ILIKE $${values.length})`);
  }
  if (input.institutionId) {
    values.push(input.institutionId);
    conditions.push(`a.institution_id = $${values.length}`);
  }
  if (input.createdFrom) {
    values.push(input.createdFrom);
    conditions.push(`a.created_at >= $${values.length}::date`);
  }
  if (input.createdTo) {
    values.push(input.createdTo);
    conditions.push(`a.created_at < ($${values.length}::date + INTERVAL '1 day')`);
  }
  if (input.reviewerId && !input.isAdmin) {
    const client = await pool.connect();
    try {
      const institutionId = await getReviewerInstitution(client, input.reviewerId);
      values.push(institutionId);
      conditions.push(`a.institution_id = $${values.length}`);
    } finally {
      client.release();
    }
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const count = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM role_applications a JOIN users u ON u.id = a.user_id ${where}`,
    values,
  );
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const offset = Math.max(input.offset ?? 0, 0);
  const pageValues = [...values, limit, offset];
  const result = await pool.query<ApplicationRow>(
    `${applicationSelect} ${where}
     ORDER BY a.created_at DESC
     LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}`,
    pageValues,
  );
  return {
    applications: result.rows.map(mapApplication),
    total: Number(count.rows[0]?.count ?? 0),
  };
}

export async function reviewRoleApplication(input: {
  applicationId: string;
  reviewerId: string;
  isAdmin: boolean;
  decision: "APPROVED" | "REJECTED";
  decisionNote: string | null;
}): Promise<RoleApplication> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const reviewerInstitutionId = input.isAdmin
      ? null
      : await getReviewerInstitution(client, input.reviewerId);
    const found = await client.query<ApplicationRow>(
      `${applicationSelect}
       WHERE a.id = $1
       FOR UPDATE OF a`,
      [input.applicationId],
    );
    if (!found.rowCount) {
      throw new AppError(404, "Role application not found", "NOT_FOUND");
    }
    const application = found.rows[0];
    if (reviewerInstitutionId && application.institution_id !== reviewerInstitutionId) {
      throw new AppError(403, "You cannot review an application from another school", "FORBIDDEN");
    }
    if (application.status !== "PENDING") {
      throw new AppError(409, "This application has already been reviewed", "APPLICATION_ALREADY_REVIEWED");
    }

    const applicant = await client.query<{
      is_active: boolean;
      email_verified: boolean;
      institution_id: string | null;
    }>(
      "SELECT is_active, email_verified, institution_id FROM users WHERE id = $1 FOR UPDATE",
      [application.user_id],
    );
    const user = applicant.rows[0];
    if (input.decision === "APPROVED") {
      if (!user?.is_active || !user.email_verified) {
        throw new AppError(409, "Applicant must have an active, verified account", "ACCOUNT_NOT_VERIFIED");
      }
      if (user.institution_id && user.institution_id !== application.institution_id) {
        throw new AppError(409, "Applicant is already verified for another school", "SCHOOL_ALREADY_VERIFIED");
      }
      const currentRoles = await client.query<{ role: string }>(
        "SELECT role FROM user_roles WHERE user_id = $1 ORDER BY role",
        [application.user_id],
      );
      const previousRoles = currentRoles.rows.map((row) => row.role);
      await client.query(
        `INSERT INTO user_roles (user_id, role) VALUES ($1, $2)
         ON CONFLICT (user_id, role) DO NOTHING`,
        [application.user_id, application.requested_role],
      );
      const applicationStudentId = typeof application.application_data.studentId === "string"
        ? application.application_data.studentId.trim() || null
        : null;
      if (application.requested_role === "PLAYER") {
        await client.query(
          `UPDATE users SET institution_id = $2,
             student_id = COALESCE($3, student_id), updated_at = NOW()
           WHERE id = $1`,
          [application.user_id, application.institution_id, applicationStudentId],
        );
        const playerProfileKeys = ["birthDate", "gender", "faculty", "major", "academicYear", "playingPosition", "dominantFoot", "heightCm", "weightKg"];
        const playerProfile = Object.fromEntries(playerProfileKeys
          .filter((key) => typeof application.application_data[key] === "string" && (application.application_data[key] as string).trim())
          .map((key) => [key, (application.application_data[key] as string).trim()]));
        if (Object.keys(playerProfile).length) {
          await client.query(
            `INSERT INTO account_profiles (user_id, profile_data)
             VALUES ($1, $2::jsonb)
             ON CONFLICT (user_id) DO UPDATE
             SET profile_data = account_profiles.profile_data || EXCLUDED.profile_data,
                 updated_at = NOW()`,
            [application.user_id, JSON.stringify(playerProfile)],
          );
        }
      } else {
        await client.query(
          `UPDATE users SET institution_id = $2, updated_at = NOW()
           WHERE id = $1`,
          [application.user_id, application.institution_id],
        );
      }
      await client.query(
        `INSERT INTO account_profile_history (user_id, changes)
         VALUES ($1, $2::jsonb)`,
        [
          application.user_id,
          JSON.stringify({
            action: "ROLE_APPLICATION_APPROVED",
            before: {
              roles: previousRoles,
              institutionId: user.institution_id,
            },
            after: {
              roles: [...new Set([...previousRoles, application.requested_role])].sort(),
              institutionId: application.institution_id,
            },
            actorUserId: input.reviewerId,
            reason: input.decisionNote,
            roleApplicationId: input.applicationId,
          }),
        ],
      );
    }

    await client.query(
      `UPDATE role_applications
       SET status = $2, decision_note = $3, reviewed_by = $4, reviewed_at = NOW()
       WHERE id = $1`,
      [
        input.applicationId,
        input.decision,
        input.decisionNote,
        input.reviewerId,
      ],
    );
    const finalRow = await client.query<ApplicationRow>(
      `${applicationSelect} WHERE a.id = $1`,
      [input.applicationId],
    );
    await client.query("COMMIT");
    return mapApplication(finalRow.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
