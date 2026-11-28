import type { ScheduleRefereeAssignmentInput } from "./models/scheduling";
import { AppError } from "../lib/errors";
import type { RefereePosition } from "./models/refereeConfiguration";
import { crewConfigurationIssues } from "./services/refereeConfigurationValidation";

export type CrewCapability = "READ" | "RECORD_EVENT" | "EDIT_EVENT" | "MANAGE_REPORT" | "FINALIZE";
export const REFEREE_CREW_POSITIONS = new Set([
  "REFEREE",
  "ASSISTANT_REFEREE_1",
  "ASSISTANT_REFEREE_2",
  "ASSISTANT_REFEREE_3",
  "ASSISTANT_REFEREE_4",
  "FOURTH_OFFICIAL",
  "MATCH_SECRETARY",
]);

export function crewHasCapability(position: string, isFinalAuthority: boolean, capability: CrewCapability): boolean {
  if (capability === "READ") return true;
  // Editing/voiding an official event can affect the score and discipline record,
  // so keep it with the appointed final authority. Assistants may submit events.
  if (capability === "FINALIZE" || capability === "EDIT_EVENT" || capability === "MANAGE_REPORT") return isFinalAuthority;
  return isFinalAuthority || [
    "REFEREE",
    "ASSISTANT_REFEREE_1",
    "ASSISTANT_REFEREE_2",
    "ASSISTANT_REFEREE_3",
    "ASSISTANT_REFEREE_4",
    "FOURTH_OFFICIAL",
    "MATCH_SECRETARY",
  ].includes(position);
}

export function configuredCrewHasCapability(position: string, isFinalAuthority: boolean, capability: CrewCapability, positions: RefereePosition[] | null): boolean {
  if (!positions) return crewHasCapability(position, isFinalAuthority, capability);
  const configured = positions.find((item) => item.code === position);
  if (!configured) return false;
  if (capability === "READ") return true;
  return configured.capabilities.includes(capability) && (capability !== "FINALIZE" || isFinalAuthority);
}

export function validateCrewAssignments(assignments: ScheduleRefereeAssignmentInput[], configuration?: RefereePosition[] | null): void {
  if (!Array.isArray(assignments) || assignments.length > (configuration ? 64 : 12)) {
    throw new AppError(400, "A match can have up to 12 assigned officials", "INVALID_CREW");
  }
  const ids = assignments.map((item) => item.refereeId);
  const positions = assignments.map((item) => item.position);
  if (new Set(ids).size !== ids.length || new Set(positions).size !== positions.length) {
    throw new AppError(400, "Each official and position must be unique within the crew", "DUPLICATE_CREW_ASSIGNMENT");
  }
  if (assignments.some((item) => !item.refereeId || !(configuration ? configuration.some((p) => p.code === item.position) : REFEREE_CREW_POSITIONS.has(item.position)))) {
    throw new AppError(400, "Each assignment needs a referee and a supported match-official position", "INVALID_CREW_ASSIGNMENT");
  }
  if (assignments.length && assignments.filter((item) => item.isFinalAuthority === true).length !== 1) {
    throw new AppError(400, "Exactly one assigned official must have final result authority", "FINAL_AUTHORITY_REQUIRED");
  }
  if (!configuration && assignments.some((item) => item.isFinalAuthority === true && item.position !== "REFEREE")) {
    throw new AppError(400, "Final result authority must be assigned to the match referee", "FINAL_AUTHORITY_MUST_BE_REFEREE");
  }
  if (configuration) {
    const issues = crewConfigurationIssues(configuration, assignments);
    if (issues.length) throw new AppError(409, "Phân công chưa đáp ứng cấu hình trọng tài.", "REFEREE_CONFIG_ASSIGNMENT_CONFLICT", { issues });
  }
}
