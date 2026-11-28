import { AppError } from "../lib/errors";
import {
  createClubRequest as insertClubRequest,
  listClubRequests as selectClubRequests,
  reviewClubRequest as decideClubRequest,
} from "../repositories/clubRequestRepository";
import type { ClubRequest, ClubRequestStatus } from "../models/team";

type ClubRequestInput = {
  applicantId: string;
  institutionId: string;
  captainName: string;
  name: string;
  shortName?: string;
  description?: string;
  logoUrl?: string;
  unitName?: string;
  contactEmail: string;
  contactPhone: string;
  initialMembers?: unknown;
};

export async function submitClubRequest(input: ClubRequestInput): Promise<ClubRequest> {
  const name = input.name.trim();
  const captainName = input.captainName.trim();
  const contactEmail = input.contactEmail.trim().toLowerCase();
  const contactPhone = input.contactPhone.trim();
  if (!name || name.length > 255) {
    throw new AppError(400, "Club name must be between 1 and 255 characters", "VALIDATION_ERROR");
  }
  if (!captainName || captainName.length > 255) {
    throw new AppError(400, "Captain name is required", "VALIDATION_ERROR");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    throw new AppError(400, "A valid contact email is required", "VALIDATION_ERROR");
  }
  if (!/^[+()\d\s.-]{7,30}$/.test(contactPhone)) {
    throw new AppError(400, "A valid contact phone is required", "VALIDATION_ERROR");
  }
  if (input.shortName && input.shortName.trim().length > 100) {
    throw new AppError(400, "Club short name must be at most 100 characters", "VALIDATION_ERROR");
  }
  if (input.unitName && input.unitName.trim().length > 255) {
    throw new AppError(400, "Faculty or unit must be at most 255 characters", "VALIDATION_ERROR");
  }
  if (input.description && input.description.length > 5000) {
    throw new AppError(400, "Description must be at most 5000 characters", "VALIDATION_ERROR");
  }
  if (input.logoUrl && !/^https?:\/\/\S+$/i.test(input.logoUrl)) {
    throw new AppError(400, "Logo must be an HTTP(S) URL", "INVALID_LOGO_URL");
  }

  const rawMembers = input.initialMembers ?? [];
  if (!Array.isArray(rawMembers) || rawMembers.length > 25) {
    throw new AppError(400, "Initial member list must contain at most 25 entries", "VALIDATION_ERROR");
  }
  const initialMembers = rawMembers.map((member, index) => {
    if (!member || typeof member !== "object" || Array.isArray(member)) {
      throw new AppError(400, `Initial member ${index + 1} is invalid`, "VALIDATION_ERROR");
    }
    const record = member as Record<string, unknown>;
    const fullName = typeof record.fullName === "string" ? record.fullName.trim() : "";
    if (!fullName || fullName.length > 255) {
      throw new AppError(400, `Initial member ${index + 1} needs a valid full name`, "VALIDATION_ERROR");
    }
    return {
      fullName,
      studentId: typeof record.studentId === "string" ? record.studentId.trim().slice(0, 100) : "",
      position: typeof record.position === "string" ? record.position.trim().slice(0, 50) : "",
    };
  });

  return insertClubRequest({
    applicantId: input.applicantId,
    institutionId: input.institutionId,
    captainName,
    name,
    shortName: input.shortName?.trim() || undefined,
    description: input.description?.trim() || undefined,
    logoUrl: input.logoUrl?.trim() || undefined,
    unitName: input.unitName?.trim() || undefined,
    contactEmail,
    contactPhone,
    initialMembers,
  });
}

export async function getClubRequests(input: {
  applicantId?: string;
  institutionId?: string;
  status?: ClubRequestStatus;
  search?: string;
  createdFrom?: string;
  createdTo?: string;
  limit?: number;
  offset?: number;
}): Promise<{ requests: ClubRequest[]; total: number }> {
  return selectClubRequests(input);
}

export async function reviewClubRequest(input: {
  requestId: string;
  reviewerId: string;
  reviewerInstitutionId?: string;
  isAdmin: boolean;
  decision: "APPROVED" | "REJECTED";
  decisionNote?: string;
}): Promise<ClubRequest> {
  const decisionNote = input.decisionNote?.trim() || null;
  if (input.decision === "REJECTED" && !decisionNote) {
    throw new AppError(400, "A reason is required when rejecting a club request", "VALIDATION_ERROR");
  }
  if (decisionNote && decisionNote.length > 2000) {
    throw new AppError(400, "Decision note must be at most 2000 characters", "VALIDATION_ERROR");
  }
  return decideClubRequest({ ...input, decisionNote });
}
