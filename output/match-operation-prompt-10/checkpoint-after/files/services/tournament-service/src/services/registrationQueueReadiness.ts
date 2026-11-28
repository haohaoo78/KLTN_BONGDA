import { AppError } from "../lib/errors";

/**
 * When approved teams are below capacity, BTC must resolve all applications
 * before locking so available places are not silently discarded. At capacity,
 * unresolved applications do not prevent locking the approved roster.
 */
export function assertRegistrationQueueCanBeLocked(input: {
  statuses: string[];
  minimumTeams: number;
  maximumTeams: number;
}): void {
  const approvedCount = input.statuses.filter((status) => status === "APPROVED").length;
  if (approvedCount < input.minimumTeams) {
    throw new AppError(409, `At least ${input.minimumTeams} approved teams are required before locking the roster`, "MINIMUM_TEAMS_NOT_MET");
  }
  if (approvedCount > input.maximumTeams) {
    throw new AppError(409, `The approved team count exceeds this tournament's limit of ${input.maximumTeams}`, "MAXIMUM_TEAMS_EXCEEDED");
  }

  // When places are still available, BTC must finish reviewing every submitted
  // application before locking below capacity. This prevents leaving an eligible
  // queue untouched while declaring the roster final. A below-capacity lock is
  // allowed only when no application remains undecided.
  const terminalStatuses = new Set(["APPROVED", "REJECTED", "APPROVAL_REVOKED", "WITHDRAWN"]);
  const undecidedCount = input.statuses.filter((status) => !terminalStatuses.has(status)).length;
  if (approvedCount < input.maximumTeams && undecidedCount > 0) {
    throw new AppError(
      409,
      `Còn ${undecidedCount} hồ sơ chưa có quyết định cuối cùng. Khi vẫn còn suất, BTC cần tiếp tục xét duyệt hoặc từ chối các hồ sơ này; chỉ có thể chốt dưới mức tối đa khi không còn hồ sơ chưa xử lý.`,
      "REGISTRATION_QUEUE_NOT_EXHAUSTED",
    );
  }
}

export function assertLockedTeamCountFitsFormat(input: {
  format: "ROUND_ROBIN" | "KNOCKOUT" | "GROUP_AND_KNOCKOUT";
  approvedCount: number;
  groupCapacity?: number | null;
  groupCountMode?: "AUTO_BY_CAPACITY" | "FIXED";
  fixedGroupCount?: number | null;
}): void {
  if (input.format !== "GROUP_AND_KNOCKOUT") return;
  const groups = input.groupCountMode === "FIXED"
    ? input.fixedGroupCount ?? null
    : input.groupCapacity ? Math.ceil(input.approvedCount / input.groupCapacity) : null;
  if (!input.groupCapacity || !groups || groups < 1 || input.approvedCount > groups * input.groupCapacity || input.approvedCount < groups * 2) {
    throw new AppError(409, `Có ${input.approvedCount} đội chính thức nhưng cấu hình vòng bảng không khả thi; kiểm tra số bảng và sức chứa theo điều lệ.`, "HYBRID_GROUP_COUNT_INFEASIBLE");
  }
}
