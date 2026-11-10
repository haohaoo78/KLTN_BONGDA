import { Request, Response, NextFunction } from "express";
import { UserRole } from "@sfl/shared";
import { AppError } from "../lib/errors";
import { parseRoles } from "../lib/roles";
import { toUserProfile } from "../lib/userMapper";
import type { RequestWithUser } from "../middleware/gatewayUser";
import {
  findUserById,
  hasOtherBtcAssignment,
  listUsers,
  updateUserAdmin,
} from "../repositories/userRepository";
import {
  type EditableAccountProfile,
  getAccountProfileData,
  listAccountProfileHistory,
  updateAccountProfile,
} from "../repositories/accountProfileRepository";
import { PasswordResetService } from "../services/passwordResetService";
import type { AuthService } from "../../services/authService";
import {
  sendAdminAccountChangeNotification,
  sendRoleApplicationNotification,
} from "../../services/verificationEmailService";
import {
  createRoleApplication,
  findMyRoleApplicationById,
  findRoleApplicationById,
  listRoleApplications,
  reviewRoleApplication,
  updateMyRoleApplication,
  withdrawMyRoleApplication,
} from "../repositories/roleApplicationRepository";

type RequestedRole = "TEAM_CAPTAIN" | "PLAYER";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validateRoleApplicationInput(input: {
  requestedRole: unknown;
  institutionId: unknown;
  applicationData: unknown;
  message: unknown;
}): {
  requestedRole: RequestedRole;
  institutionId: string;
  applicationData: Record<string, unknown>;
  message: string;
} {
  const { requestedRole } = input;
  const institutionId = typeof input.institutionId === "string" ? input.institutionId : "";
  const message = typeof input.message === "string" ? input.message.trim() : "";
  const applicationData =
    input.applicationData && typeof input.applicationData === "object" &&
    !Array.isArray(input.applicationData)
      ? input.applicationData as Record<string, unknown>
      : null;
  if (requestedRole !== UserRole.TEAM_CAPTAIN && requestedRole !== UserRole.PLAYER) {
    throw new AppError(400, "Only TEAM_CAPTAIN and PLAYER roles can be requested", "VALIDATION_ERROR");
  }
  if (!message || message.length > 2000) {
    throw new AppError(400, "A message of 1–2000 characters is required", "VALIDATION_ERROR");
  }
  if (!institutionId || !applicationData) {
    throw new AppError(400, "A school and applicant profile are required", "VALIDATION_ERROR");
  }
  const requiredFields = ["birthDate", "gender", "phone", "faculty", "evidenceUrl"];
  if (requestedRole === "PLAYER") {
    requiredFields.push("major", "studentId", "academicYear", "playingPosition", "dominantFoot");
  } else {
    requiredFields.push("representativeType", "teamPosition", "reason", "commitment");
  }
  for (const field of requiredFields) {
    const value = applicationData[field];
    if (typeof value !== "string" || !value.trim()) {
      throw new AppError(400, `${field} is required`, "VALIDATION_ERROR");
    }
  }
  if (!/^https?:\/\/\S+$/i.test(applicationData.evidenceUrl as string)) {
    throw new AppError(400, "Evidence must be supplied as an HTTP(S) URL", "VALIDATION_ERROR");
  }
  if (!["MALE", "FEMALE", "OTHER"].includes(applicationData.gender as string)) {
    throw new AppError(400, "A valid gender is required", "VALIDATION_ERROR");
  }
  if (requestedRole === "TEAM_CAPTAIN") {
    if (!["STUDENT", "LECTURER", "STAFF", "OTHER"].includes(applicationData.representativeType as string)) {
      throw new AppError(400, "A valid representative type is required", "VALIDATION_ERROR");
    }
    if (applicationData.commitment !== "true") {
      throw new AppError(400, "The representative responsibility commitment is required", "VALIDATION_ERROR");
    }
    if (applicationData.representativeType === "OTHER" &&
      (typeof applicationData.representativeOther !== "string" || !applicationData.representativeOther.trim())) {
      throw new AppError(400, "Describe the representative type", "VALIDATION_ERROR");
    }
  } else if (!["GK", "DEF", "MID", "FWD"].includes(applicationData.playingPosition as string)) {
    throw new AppError(400, "A valid playing position is required", "VALIDATION_ERROR");
  } else if (!["RIGHT", "LEFT", "BOTH"].includes(applicationData.dominantFoot as string)) {
    throw new AppError(400, "A valid dominant foot is required", "VALIDATION_ERROR");
  }
  return { requestedRole, institutionId, applicationData, message };
}

function dateFilter(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  ) {
    throw new AppError(400, `${field} must be a valid YYYY-MM-DD date`, "VALIDATION_ERROR");
  }
  return value;
}

export const userController = {
  passwordResetService: null as PasswordResetService | null,
  authService: null as Pick<
    AuthService,
    | "provisionStaffAccount"
    | "resendStaffInvitation"
    | "validateActiveInstitution"
    | "validateAssignableInstitution"
    | "requestEmailChange"
  > | null,

  setPasswordResetService(service: PasswordResetService) {
    this.passwordResetService = service;
  },
  setAuthService(service: AuthService) {
    this.authService = service;
  },
  async getMe(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId } = (req as RequestWithUser).userContext;
      const user = await findUserById(userId);
      if (!user || !user.isActive) {
        throw new AppError(404, "User not found", "NOT_FOUND");
      }
      const profileData = await getAccountProfileData(userId);
      res.json({ user: { ...toUserProfile(user), profileData } });
    } catch (err) {
      next(err);
    }
  },

  async listMyProfileHistory(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId } = (req as RequestWithUser).userContext;
      res.json({ history: await listAccountProfileHistory(userId) });
    } catch (error) {
      next(error);
    }
  },

  async listUserProfileHistory(req: Request, res: Response, next: NextFunction) {
    try {
      const targetUserId = req.params.id;
      const user = await findUserById(targetUserId);
      if (!user) {
        throw new AppError(404, "User not found", "NOT_FOUND");
      }
      res.json({ history: await listAccountProfileHistory(targetUserId) });
    } catch (error) {
      next(error);
    }
  },

  async listMyRoleApplications(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId } = (req as RequestWithUser).userContext;
      const { applications } = await listRoleApplications({ userId, limit: 100, offset: 0 });
      res.json({ applications });
    } catch (err) {
      next(err);
    }
  },

  async submitRoleApplication(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId } = (req as RequestWithUser).userContext;
      const applicationInput = validateRoleApplicationInput({
        requestedRole: req.body?.requestedRole,
        institutionId: req.body?.institutionId,
        applicationData: req.body?.applicationData,
        message: req.body?.message,
      });
      if (!this.authService) {
        throw new AppError(500, "Auth service not initialized", "SERVICE_ERROR");
      }
      const account = await findUserById(userId);
      if (!account) {
        throw new AppError(404, "User not found", "NOT_FOUND");
      }
      await this.authService.validateActiveInstitution(applicationInput.institutionId, {
        userId,
        email: account.email,
      });
      const application = await createRoleApplication({
        userId,
        ...applicationInput,
      });
      res.status(201).json({ application });
    } catch (err) {
      next(err);
    }
  },

  async updateMyRoleApplication(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId, email } = (req as RequestWithUser).userContext;
      const applicationId = req.params.id;
      if (!isUuid(applicationId)) {
        throw new AppError(404, "Role application not found", "NOT_FOUND");
      }
      const existing = await findMyRoleApplicationById(applicationId, userId);
      if (!existing) {
        throw new AppError(404, "Role application not found", "NOT_FOUND");
      }
      if (existing.status !== "PENDING") {
        throw new AppError(409, "Only pending applications can be edited", "APPLICATION_NOT_EDITABLE");
      }
      const applicationInput = validateRoleApplicationInput({
        requestedRole: existing.requestedRole,
        institutionId: req.body?.institutionId,
        applicationData: req.body?.applicationData,
        message: req.body?.message,
      });
      if (!this.authService) {
        throw new AppError(500, "Auth service not initialized", "SERVICE_ERROR");
      }
      await this.authService.validateActiveInstitution(applicationInput.institutionId, { userId, email });
      const application = await updateMyRoleApplication({
        applicationId,
        userId,
        institutionId: applicationInput.institutionId,
        applicationData: applicationInput.applicationData,
        message: applicationInput.message,
      });
      res.json({ application });
    } catch (err) {
      next(err);
    }
  },

  async withdrawMyRoleApplication(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId } = (req as RequestWithUser).userContext;
      if (!isUuid(req.params.id)) {
        throw new AppError(404, "Role application not found", "NOT_FOUND");
      }
      const application = await withdrawMyRoleApplication(req.params.id, userId);
      res.json({ application });
    } catch (err) {
      next(err);
    }
  },

  async listRoleApplications(req: Request, res: Response, next: NextFunction) {
    try {
      const statusRaw = typeof req.query.status === "string" ? req.query.status : undefined;
      if (statusRaw && !["PENDING", "APPROVED", "REJECTED", "WITHDRAWN"].includes(statusRaw)) {
        throw new AppError(400, "Invalid application status", "VALIDATION_ERROR");
      }
      const requestedRole = typeof req.query.requestedRole === "string" ? req.query.requestedRole : undefined;
      if (requestedRole && !["PLAYER", "TEAM_CAPTAIN"].includes(requestedRole)) {
        throw new AppError(400, "Invalid requested role", "VALIDATION_ERROR");
      }
      const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
      if (search.length > 100) {
        throw new AppError(400, "Search text is too long", "VALIDATION_ERROR");
      }
      const createdFrom = dateFilter(req.query.createdFrom, "createdFrom");
      const createdTo = dateFilter(req.query.createdTo, "createdTo");
      const institutionId = typeof req.query.institutionId === "string"
        ? req.query.institutionId : undefined;
      if (institutionId && !isUuid(institutionId)) {
        throw new AppError(400, "Invalid institution filter", "VALIDATION_ERROR");
      }
      if (createdFrom && createdTo && createdFrom > createdTo) {
        throw new AppError(400, "createdFrom must not be later than createdTo", "VALIDATION_ERROR");
      }
      const limitRaw = Number(req.query.limit ?? 20);
      const offsetRaw = Number(req.query.offset ?? 0);
      if (!Number.isInteger(limitRaw) || limitRaw < 1 || limitRaw > 100 ||
          !Number.isInteger(offsetRaw) || offsetRaw < 0) {
        throw new AppError(400, "Invalid pagination values", "VALIDATION_ERROR");
      }
      const result = await listRoleApplications({
        status: statusRaw as "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN" | undefined,
        requestedRole: requestedRole as "PLAYER" | "TEAM_CAPTAIN" | undefined,
        search: search || undefined,
        institutionId,
        createdFrom,
        createdTo,
        limit: limitRaw,
        offset: offsetRaw,
        reviewerId: (req as RequestWithUser).userContext.userId,
        isAdmin: (req as RequestWithUser).userContext.roles.includes(UserRole.ADMIN),
      });
      res.json({
        applications: result.applications,
        pagination: { limit: limitRaw, offset: offsetRaw, total: result.total },
      });
    } catch (err) {
      next(err);
    }
  },

  async reviewRoleApplication(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId } = (req as RequestWithUser).userContext;
      const decision = req.body?.decision;
      const decisionNote =
        typeof req.body?.decisionNote === "string" ? req.body.decisionNote.trim() : "";
      if (decision !== "APPROVED" && decision !== "REJECTED") {
        throw new AppError(400, "Decision must be APPROVED or REJECTED", "VALIDATION_ERROR");
      }
      if (decision === "REJECTED" && !decisionNote) {
        throw new AppError(400, "A reason is required when rejecting an application", "VALIDATION_ERROR");
      }
      if (decisionNote.length > 2000) {
        throw new AppError(400, "Decision note must be at most 2000 characters", "VALIDATION_ERROR");
      }
      if (decision === "APPROVED") {
        const pendingApplication = await findRoleApplicationById(req.params.id);
        if (!pendingApplication) {
          throw new AppError(404, "Role application not found", "NOT_FOUND");
        }
        const reviewer = (req as RequestWithUser).userContext;
        if (!this.authService) {
          throw new AppError(500, "Auth service not initialized", "SERVICE_ERROR");
        }
        await this.authService.validateActiveInstitution(pendingApplication.institutionId, {
          userId: reviewer.userId,
          email: reviewer.email,
        });
      }
      const application = await reviewRoleApplication({
        applicationId: req.params.id,
        reviewerId: userId,
        isAdmin: (req as RequestWithUser).userContext.roles.includes(UserRole.ADMIN),
        decision,
        decisionNote: decisionNote || null,
      });
      let notificationWarning: string | undefined;
      try {
        await sendRoleApplicationNotification({
          userId: application.userId,
          role: application.requestedRole,
          status: decision,
          decisionNote: application.decisionNote,
        });
      } catch (notificationError) {
        notificationWarning = "Quyết định đã được lưu nhưng không gửi được thông báo trong ứng dụng.";
        console.error("[auth-service] role application notification failed", {
          applicationId: application.id,
          code: notificationError instanceof AppError ? notificationError.code : "NOTIFICATION_FAILED",
        });
      }
      res.json({ application, ...(notificationWarning ? { notificationWarning } : {}) });
    } catch (err) {
      next(err);
    }
  },

  async updateMe(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId, roles } = (req as RequestWithUser).userContext;
      const isPlayer = roles.includes(UserRole.PLAYER);
      const fullName =
        typeof req.body?.fullName === "string" ? req.body.fullName.trim() : undefined;
      const body = req.body ?? {};
      if (["institutionId", "roles"].some((key) => Object.prototype.hasOwnProperty.call(body, key)) ||
          (Object.prototype.hasOwnProperty.call(body, "studentId") && !isPlayer)) {
        throw new AppError(403, "Verified identity, school, and role cannot be changed here", "VERIFIED_FIELD_IMMUTABLE");
      }

      let studentId: string | null | undefined;
      if (Object.prototype.hasOwnProperty.call(body, "studentId")) {
        if (body.studentId !== null && (typeof body.studentId !== "string" || body.studentId.trim().length < 1 || body.studentId.trim().length > 100)) {
          throw new AppError(400, "Student ID must be between 1 and 100 characters", "VALIDATION_ERROR");
        }
        studentId = typeof body.studentId === "string" ? body.studentId.trim() : null;
      }

      if (fullName !== undefined && !fullName) {
        throw new AppError(400, "fullName cannot be empty", "VALIDATION_ERROR");
      }
      let profileData: EditableAccountProfile | undefined;
      if (body.profileData !== undefined) {
        const playerProfileKeys = ["birthDate", "gender", "faculty", "major", "academicYear", "playingPosition", "dominantFoot", "heightCm", "weightKg"];
        const allowedProfileKeys = isPlayer ? ["phone", "address", ...playerProfileKeys] : ["phone", "address"];
        if (
          typeof body.profileData !== "object" ||
          body.profileData === null ||
          Array.isArray(body.profileData) ||
          Object.keys(body.profileData).some((key) => !allowedProfileKeys.includes(key))
        ) {
          throw new AppError(400, "Some profile fields are not editable for this account", "VALIDATION_ERROR");
        }
        profileData = {};
        for (const [key, rawValue] of Object.entries(body.profileData)) {
          if (rawValue !== null && typeof rawValue !== "string") {
            throw new AppError(400, `${key} must be text`, "VALIDATION_ERROR");
          }
          const maxLength = key === "phone" ? 50 : key === "address" ? 255 : 200;
          if (typeof rawValue === "string" && rawValue.trim().length > maxLength) {
            throw new AppError(400, `${key} is too long`, "VALIDATION_ERROR");
          }
          if (key === "phone" && typeof rawValue === "string" && rawValue.trim() && !/^[+0-9()\-\s]{6,50}$/.test(rawValue.trim())) {
            throw new AppError(400, "Phone number is invalid", "VALIDATION_ERROR");
          }
          (profileData as Record<string, string | null>)[key] = typeof rawValue === "string" ? rawValue.trim() || null : null;
        }
      }

      if (fullName === undefined && studentId === undefined && profileData === undefined) {
        throw new AppError(400, "No fields to update", "VALIDATION_ERROR");
      }

      const updated = await updateAccountProfile({ userId, fullName, studentId, profileData });
      res.json({
        user: { ...toUserProfile(updated.user), profileData: updated.profileData },
      });
    } catch (err) {
      next(err);
    }
  },

  async requestEmailChange(req: Request, res: Response, next: NextFunction) {
    try {
      const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
      if (!email || email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new AppError(400, "A valid email address is required", "VALIDATION_ERROR");
      }
      const currentPassword =
        typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";
      if (!currentPassword) {
        throw new AppError(400, "Current password is required", "VALIDATION_ERROR");
      }
      if (!this.authService) {
        throw new AppError(500, "Auth service not initialized", "SERVICE_ERROR");
      }
      const { userId } = (req as RequestWithUser).userContext;
      await this.authService.requestEmailChange(userId, email, currentPassword);
      res.json({
        message: "Email xác nhận đã được gửi đến địa chỉ mới. Email hiện tại vẫn được dùng cho đến khi xác nhận.",
      });
    } catch (error) {
      next(error);
    }
  },

  async listUsers(req: Request, res: Response, next: NextFunction) {
    try {
      const limitRaw = Number(req.query.limit ?? 20);
      const offsetRaw = Number(req.query.offset ?? 0);
      const limit = Number.isFinite(limitRaw)
        ? Math.min(Math.max(1, limitRaw), 100)
        : 20;
      const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0;
      const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
      const roleRaw = typeof req.query.role === "string" ? req.query.role : undefined;
      const statusRaw = typeof req.query.status === "string" ? req.query.status : undefined;
      const institutionId = typeof req.query.institutionId === "string" ? req.query.institutionId : undefined;
      const createdFrom = dateFilter(req.query.createdFrom, "createdFrom");
      const createdTo = dateFilter(req.query.createdTo, "createdTo");
      const sortByRaw = typeof req.query.sortBy === "string" ? req.query.sortBy : "createdAt";
      const sortDirectionRaw = typeof req.query.sortDirection === "string" ? req.query.sortDirection : "desc";
      const roles = Object.values(UserRole) as string[];
      if (roleRaw && !roles.includes(roleRaw)) {
        throw new AppError(400, "Invalid role filter", "VALIDATION_ERROR");
      }
      if (statusRaw && !["pending", "active", "inactive", "disabled"].includes(statusRaw)) {
        throw new AppError(400, "Invalid status filter", "VALIDATION_ERROR");
      }
      if (createdFrom && createdTo && createdFrom > createdTo) {
        throw new AppError(400, "createdFrom must not be later than createdTo", "VALIDATION_ERROR");
      }
      if (!["createdAt", "fullName", "email"].includes(sortByRaw) ||
          !["asc", "desc"].includes(sortDirectionRaw)) {
        throw new AppError(400, "Invalid account sort", "VALIDATION_ERROR");
      }
      if (institutionId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(institutionId)) {
        throw new AppError(400, "Invalid institution filter", "VALIDATION_ERROR");
      }

      const { items, total, statistics } = await listUsers(limit, offset, {
        search: search || undefined,
        role: roleRaw as UserRole | undefined,
        status: statusRaw as "pending" | "active" | "inactive" | "disabled" | undefined,
        institutionId,
        createdFrom,
        createdTo,
        sortBy: sortByRaw as "createdAt" | "fullName" | "email",
        sortDirection: sortDirectionRaw as "asc" | "desc",
      });
      res.json({
        users: items.map(toUserProfile),
        pagination: { limit, offset, total },
        statistics,
      });
    } catch (err) {
      next(err);
    }
  },

  async createUser(req: Request, res: Response, next: NextFunction) {
    try {
      const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
      const fullName =
        typeof req.body?.fullName === "string" ? req.body.fullName.trim() : "";
      const requestedRole = req.body?.role;
      const roles = req.body?.roles;
      const role =
        requestedRole ??
        (Array.isArray(roles) && roles.length === 1 ? roles[0] : undefined);
      if (!email || !fullName || !role) {
        throw new AppError(400, "email, fullName and role are required", "VALIDATION_ERROR");
      }
      if (role !== UserRole.BTC && role !== UserRole.REFEREE) {
        throw new AppError(400, "Only BTC and REFEREE accounts can be created here", "INVALID_ROLE");
      }
      const institutionId =
        typeof req.body?.institutionId === "string" ? req.body.institutionId : null;
      if (role === UserRole.BTC && !institutionId) {
        throw new AppError(400, "BTC accounts must be assigned to a school", "INSTITUTION_REQUIRED");
      }
      if (!this.authService) {
        throw new AppError(500, "Auth service not initialized", "SERVICE_ERROR");
      }
      const context = (req as RequestWithUser).userContext;
      if (institutionId) {
        await this.authService.validateAssignableInstitution(institutionId, {
          userId: context.userId,
          email: context.email,
        });
      }
      const created = await this.authService.provisionStaffAccount({
        email,
        fullName,
        role,
        institutionId,
        requestedBy: { userId: context.userId, email: context.email },
      });
      res.status(201).json({ user: created, message: "Activation email sent." });
    } catch (err) {
      next(err);
    }
  },

  async resendStaffActivation(req: Request, res: Response, next: NextFunction) {
    try {
      if (!this.authService) {
        throw new AppError(500, "Auth service not initialized", "SERVICE_ERROR");
      }
      await this.authService.resendStaffInvitation(req.params.id);
      res.json({ message: "Email kích hoạt đã được gửi lại." });
    } catch (error) {
      next(error);
    }
  },

  async getUserById(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await findUserById(req.params.id);
      if (!user) {
        throw new AppError(404, "User not found", "NOT_FOUND");
      }
      res.json({
        user: { ...toUserProfile(user), profileData: await getAccountProfileData(user.id) },
      });
    } catch (err) {
      next(err);
    }
  },

  async updateUserById(req: Request, res: Response, next: NextFunction) {
    try {
      const fullName =
        typeof req.body?.fullName === "string" ? req.body.fullName.trim() : undefined;
      const studentIdRaw = req.body?.studentId;
      const isActive =
        typeof req.body?.isActive === "boolean" ? req.body.isActive : undefined;
      const accountStatusRaw = req.body?.accountStatus;
      const accountStatus =
        typeof accountStatusRaw === "string" ? accountStatusRaw : undefined;
      const statusReasonRaw = req.body?.statusReason;
      const statusReason = typeof statusReasonRaw === "string"
        ? statusReasonRaw.trim() || null
        : statusReasonRaw === null
          ? null
          : undefined;
      const hasInstitutionId = Object.prototype.hasOwnProperty.call(req.body ?? {}, "institutionId");
      const institutionId = hasInstitutionId
        ? typeof req.body.institutionId === "string" ? req.body.institutionId : null
        : undefined;

      if (fullName !== undefined && !fullName) {
        throw new AppError(400, "fullName cannot be empty", "VALIDATION_ERROR");
      }
      if (accountStatus && !["ACTIVE", "LOCKED", "DISABLED"].includes(accountStatus)) {
        throw new AppError(400, "Invalid account status", "VALIDATION_ERROR");
      }
      if (accountStatus !== undefined && isActive !== undefined &&
          (accountStatus === "ACTIVE") !== isActive) {
        throw new AppError(400, "accountStatus and isActive conflict", "VALIDATION_ERROR");
      }

      let studentId: string | null | undefined;
      if (studentIdRaw === null) {
        studentId = null;
      } else if (typeof studentIdRaw === "string") {
        studentId = studentIdRaw.trim() || null;
      }

      let roles;
      if (req.body?.roles !== undefined) {
        roles = parseRoles(req.body.roles);
        if (roles.length === 0) {
          throw new AppError(400, "An account must retain at least one role", "VALIDATION_ERROR");
        }
      }
      let profileData: { phone?: string | null; address?: string | null } | undefined;
      if (req.body?.profileData !== undefined) {
        const raw = req.body.profileData;
        if (
          typeof raw !== "object" || raw === null || Array.isArray(raw) ||
          Object.keys(raw).some((key) => !["phone", "address"].includes(key))
        ) {
          throw new AppError(400, "Only phone and address may be edited in profileData", "VALIDATION_ERROR");
        }
        profileData = {};
        if (Object.prototype.hasOwnProperty.call(raw, "phone")) {
          const value = raw.phone;
          if (value !== null && (typeof value !== "string" || value.trim().length > 50 ||
            (value.trim() && !/^[+0-9()\-\s]{6,50}$/.test(value.trim())))) {
            throw new AppError(400, "Phone number is invalid", "VALIDATION_ERROR");
          }
          profileData.phone = typeof value === "string" ? value.trim() || null : null;
        }
        if (Object.prototype.hasOwnProperty.call(raw, "address")) {
          const value = raw.address;
          if (value !== null && (typeof value !== "string" || value.trim().length > 255)) {
            throw new AppError(400, "Address must be at most 255 characters", "VALIDATION_ERROR");
          }
          profileData.address = typeof value === "string" ? value.trim() || null : null;
        }
      }
      if (institutionId && !this.authService) {
        throw new AppError(500, "Auth service not initialized", "SERVICE_ERROR");
      }
      if (institutionId && this.authService) {
        const actor = (req as RequestWithUser).userContext;
        await this.authService.validateAssignableInstitution(institutionId, {
          userId: actor.userId,
          email: actor.email,
        });
      }
      const actorId = (req as RequestWithUser).userContext.userId;
      const changesStatus = accountStatus !== undefined || isActive !== undefined;
      const resultingStatus = accountStatus ??
        (isActive === undefined ? undefined : isActive ? "ACTIVE" : "LOCKED");
      if (statusReason !== undefined && !changesStatus) {
        throw new AppError(400, "statusReason may only be changed with account status", "VALIDATION_ERROR");
      }
      const currentUser = await findUserById(req.params.id);
      if (!currentUser) {
        throw new AppError(404, "User not found", "NOT_FOUND");
      }
      const currentInstitutionId = currentUser.institutionId;
      const targetInstitutionId = institutionId === undefined ? currentInstitutionId : institutionId;
      if (roles?.includes(UserRole.BTC) && !targetInstitutionId) {
        throw new AppError(400, "BTC accounts must be assigned to a school", "INSTITUTION_REQUIRED");
      }
      const removesBtcAssignment = currentUser.roles.includes(UserRole.BTC) &&
        currentInstitutionId !== null &&
        ((institutionId !== undefined && institutionId !== currentInstitutionId) ||
          (roles !== undefined && !roles.includes(UserRole.BTC)));
      if (removesBtcAssignment && currentInstitutionId &&
          !(await hasOtherBtcAssignment(currentInstitutionId, currentUser.id))) {
        throw new AppError(
          409,
          "Assign another BTC to this school before removing its last BTC assignment",
          "LAST_BTC_ASSIGNMENT",
        );
      }
      if (
        actorId === req.params.id &&
        (resultingStatus === "LOCKED" || resultingStatus === "DISABLED" ||
          (roles !== undefined && !roles.includes(UserRole.ADMIN)))
      ) {
        throw new AppError(409, "Administrators cannot disable or demote their own account", "SELF_ADMIN_CHANGE");
      }

      if (
        (resultingStatus === "LOCKED" || resultingStatus === "DISABLED") &&
        !statusReason
      ) {
        throw new AppError(400, "A reason is required when locking or disabling an account", "VALIDATION_ERROR");
      }
      if (statusReason !== undefined && statusReason !== null && statusReason.length > 500) {
        throw new AppError(400, "statusReason must be at most 500 characters", "VALIDATION_ERROR");
      }

      if (
        fullName === undefined &&
        studentId === undefined &&
        !changesStatus &&
        roles === undefined &&
        institutionId === undefined &&
        statusReason === undefined &&
        profileData === undefined
      ) {
        throw new AppError(400, "No fields to update", "VALIDATION_ERROR");
      }

      const actor = (req as RequestWithUser).userContext;
      const updated = await updateUserAdmin(req.params.id, {
        fullName,
        studentId,
        isActive,
        roles,
        institutionId,
        accountStatus: accountStatus as "ACTIVE" | "LOCKED" | "DISABLED" | undefined,
        statusReason,
        profileData,
        actorUserId: actor.userId,
        actorEmail: actor.email,
      });
      if (!updated) {
        throw new AppError(404, "User not found", "NOT_FOUND");
      }
      let notificationWarning: string | undefined;
      const rolesChanged = roles !== undefined &&
        JSON.stringify([...currentUser.roles].sort()) !== JSON.stringify([...roles].sort());
      if (changesStatus || rolesChanged) {
        try {
          await sendAdminAccountChangeNotification({
            userId: req.params.id,
            title: changesStatus
              ? resultingStatus === "DISABLED"
                ? "Tài khoản đã được vô hiệu hóa"
                : resultingStatus === "ACTIVE"
                  ? "Tài khoản đã được mở khóa"
                  : "Tài khoản đã bị khóa"
              : "Vai trò tài khoản đã thay đổi",
            body: [
              changesStatus
                ? `Trạng thái tài khoản: ${resultingStatus === "ACTIVE" ? "Đang hoạt động" : resultingStatus === "DISABLED" ? "Đã vô hiệu hóa" : "Bị khóa"}.`
                : "",
              rolesChanged ? `Vai trò mới: ${(roles ?? []).join(", ")}.` : "",
              statusReason ? `Lý do: ${statusReason}` : "",
              "Nếu bạn cho rằng thay đổi này chưa chính xác, vui lòng liên hệ quản trị viên hệ thống.",
            ].filter(Boolean).join(" "),
            data: {
              action: changesStatus ? "ACCOUNT_STATUS_CHANGE" : "ROLE_CHANGE",
              accountStatus: resultingStatus ?? currentUser.accountStatus ?? (currentUser.isActive ? "ACTIVE" : "LOCKED"),
              previousRoles: currentUser.roles,
              roles: updated.roles,
              reason: statusReason ?? null,
              changedBy: actor.userId,
            },
          });
        } catch (notificationError) {
          notificationWarning = "Tài khoản đã cập nhật nhưng không gửi được thông báo trong ứng dụng.";
          console.error("[auth-service] account status notification failed", {
            userId: req.params.id,
            code: notificationError instanceof AppError ? notificationError.code : "NOTIFICATION_FAILED",
          });
        }
      }
      res.json({
        user: { ...toUserProfile(updated), profileData: await getAccountProfileData(updated.id) },
        ...(notificationWarning ? { notificationWarning } : {}),
      });
    } catch (err) {
      next(err);
    }
  },

  async changePassword(req: Request, res: Response, next: NextFunction) {
    try {
      if (!this.passwordResetService) {
        throw new AppError(500, "Password reset service not initialized", "SERVICE_ERROR");
      }

      const { userId } = (req as RequestWithUser).userContext;
      const oldPassword =
        typeof req.body?.oldPassword === "string" ? req.body.oldPassword : "";
      const newPassword =
        typeof req.body?.newPassword === "string" ? req.body.newPassword : "";

      if (!oldPassword || !newPassword) {
        throw new AppError(400, "Old and new password are required", "VALIDATION_ERROR");
      }

      if (newPassword.length < 8) {
        throw new AppError(400, "Password must be at least 8 characters", "VALIDATION_ERROR");
      }

      await this.passwordResetService.changePassword(userId, {
        oldPassword,
        newPassword,
      });

      res.json({ message: "Password has been changed successfully" });
    } catch (err) {
      next(err);
    }
  },
};
