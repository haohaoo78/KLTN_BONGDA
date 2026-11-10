import { AppError } from "../lib/errors";
import { config } from "../config";
import { getTournament } from "./tournamentService";
import {
  changeDrawVersionStatus,
  getLatestDrawVersion,
  getPublishedDrawVersion,
  listDrawVersions,
  saveDrawDraft,
} from "../repositories/drawWorkflowRepository";
import type {
  DrawCandidate,
  DrawGroup,
  DrawPlanInput,
  DrawVersion,
} from "../models/drawWorkflow";

type UpstreamCandidate = Omit<DrawCandidate, "eligible" | "ineligibilityReason">;

function assertPreparationStage(status: string): void {
  if (!["REGISTRATION_CLOSED", "ROSTER_LOCKED", "PREPARING"].includes(status)) {
    throw new AppError(
      409,
      "Chốt đăng ký và chuyển giải sang giai đoạn chuẩn bị trước khi chia bảng",
      "DRAW_STAGE_NOT_READY",
    );
  }
}

async function getDrawCandidates(tournamentId: string): Promise<DrawCandidate[]> {
  if (!config.internalApiKey) {
    throw new AppError(503, "Organization integration is not configured", "SERVICE_MISCONFIGURED");
  }
  let endpoint: string;
  try {
    endpoint = new URL(
      `/internal/tournaments/${encodeURIComponent(tournamentId)}/draw-candidates`,
      config.organizationServiceUrl,
    ).toString();
  } catch {
    throw new AppError(503, "Organization service URL is invalid", "SERVICE_MISCONFIGURED");
  }
  let response: Response;
  try {
    response = await fetch(endpoint, {
      headers: { "x-gateway-internal-key": config.internalApiKey },
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new AppError(503, "Organization service is unavailable", "UPSTREAM_UNAVAILABLE");
  }
  if (!response.ok) {
    throw new AppError(502, "Could not verify approved tournament teams", "UPSTREAM_ERROR");
  }
  const body = await response.json() as { candidates?: UpstreamCandidate[] };
  if (!Array.isArray(body.candidates)) {
    throw new AppError(502, "Organization returned an invalid draw candidate list", "UPSTREAM_ERROR");
  }
  const tournament = await getTournament(tournamentId);
  return body.candidates.map((candidate) => {
    let ineligibilityReason: string | null = null;
    if (!candidate.isActive) {
      ineligibilityReason = "Đội bóng đang bị khóa";
    } else if (candidate.registrationStatus !== "APPROVED") {
      ineligibilityReason = "Đăng ký đội chưa được BTC duyệt";
    } else if (candidate.verifiedRosterCount < tournament.minPlayers) {
      ineligibilityReason = `Roster đã xác minh chưa đủ ${tournament.minPlayers} cầu thủ`;
    } else if (candidate.verifiedRosterCount > tournament.maxPlayersPerTeam) {
      ineligibilityReason = `Roster vượt quá ${tournament.maxPlayersPerTeam} cầu thủ`;
    } else if (!candidate.institutionId) {
      ineligibilityReason = "Đội chưa liên kết trường";
    }
    return {
      ...candidate,
      eligible: ineligibilityReason === null,
      ineligibilityReason,
    };
  });
}

function groupLabel(index: number): string {
  let value = index + 1;
  let label = "";
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + value % 26) + label;
    value = Math.floor(value / 26);
  }
  return `Bảng ${label}`;
}

function shuffle<T>(values: T[]): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

function validateInput(input: DrawPlanInput, candidates: DrawCandidate[]): {
  eligible: DrawCandidate[];
  groupSize: number;
  targetSizes: number[];
} {
  if (!["RANDOM", "SEEDED", "MANUAL"].includes(input.method)) {
    throw new AppError(400, "Phương thức chia bảng không hợp lệ", "INVALID_DRAW_METHOD");
  }
  const eligible = candidates.filter((candidate) => candidate.eligible);
  if (eligible.length < 2) {
    throw new AppError(409, "Cần ít nhất hai đội đã được duyệt và đủ điều kiện", "NOT_ENOUGH_ELIGIBLE_TEAMS");
  }
  if (eligible.length > 32) {
    throw new AppError(409, "Số đội đủ điều kiện vượt quá giới hạn giải hiện tại", "TOO_MANY_ELIGIBLE_TEAMS");
  }
  if (!Number.isInteger(input.groupCount) || input.groupCount < 1 || input.groupCount > eligible.length) {
    throw new AppError(400, "Số bảng phải từ 1 đến số đội đủ điều kiện", "INVALID_GROUP_COUNT");
  }
  const groupSize = input.maxTeamsPerGroup ?? Math.ceil(eligible.length / input.groupCount);
  if (!Number.isInteger(groupSize) || groupSize < 2) {
    throw new AppError(400, "Sức chứa mỗi bảng phải tối thiểu hai đội", "INVALID_GROUP_CAPACITY");
  }
  if (eligible.length > input.groupCount * groupSize) {
    throw new AppError(409, "Tổng sức chứa các bảng nhỏ hơn số đội đủ điều kiện", "GROUP_CAPACITY_EXCEEDED");
  }
  const quotient = Math.floor(eligible.length / input.groupCount);
  const remainder = eligible.length % input.groupCount;
  const targetSizes = Array.from({ length: input.groupCount }, (_, index) =>
    quotient + (index < remainder ? 1 : 0),
  );
  if (Math.max(...targetSizes) - Math.min(...targetSizes) > 1 || Math.max(...targetSizes) > groupSize) {
    throw new AppError(409, "Không thể phân bổ cân bằng theo sức chứa đã chọn", "INVALID_GROUP_BALANCE");
  }
  return { eligible, groupSize, targetSizes };
}

function ensureNoSameInstitution(groups: DrawGroup[], candidatesById: Map<string, DrawCandidate>): void {
  for (const group of groups) {
    const institutions = new Set<string>();
    for (const assignment of group.assignments) {
      const institutionId = candidatesById.get(assignment.teamId)?.institutionId;
      if (institutionId && institutions.has(institutionId)) {
        throw new AppError(
          409,
          `${group.name} có nhiều đội cùng trường; hãy điều chỉnh điều kiện hoặc phương án chia`,
          "DRAW_CONSTRAINT_UNSATISFIED",
        );
      }
      if (institutionId) institutions.add(institutionId);
    }
  }
}

export async function previewDraw(tournamentId: string, input: DrawPlanInput): Promise<{
  eligibleTeams: DrawCandidate[];
  ineligibleTeams: DrawCandidate[];
  groups: DrawGroup[];
  unassignedTeamIds: string[];
}> {
  const tournament = await getTournament(tournamentId);
  assertPreparationStage(tournament.status);
  if (!tournament.rules || tournament.rules.publishedVersion < 1 || !tournament.rules.publishedAt) {
    throw new AppError(409, "Công bố điều lệ trước khi chia bảng", "RULES_NOT_PUBLISHED");
  }
  const candidates = await getDrawCandidates(tournamentId);
  const eligibleCount = candidates.filter((candidate) => candidate.eligible).length;
  if (eligibleCount < tournament.minTeams || eligibleCount > tournament.maxTeams) {
    throw new AppError(
      409,
      `Số đội đủ điều kiện (${eligibleCount}) phải nằm trong giới hạn ${tournament.minTeams}–${tournament.maxTeams}`,
      "ELIGIBLE_TEAM_COUNT_OUT_OF_RANGE",
    );
  }
  const { eligible, groupSize, targetSizes } = validateInput(input, candidates);
  const groups: DrawGroup[] = targetSizes.map((targetSize, index) => ({
    id: `preview-${index + 1}`,
    name: typeof input.groups?.[index]?.name === "string" && input.groups[index].name.trim()
      ? input.groups[index].name.trim()
      : groupLabel(index),
    maxTeams: groupSize,
    assignments: [],
  }));
  const byId = new Map(eligible.map((candidate) => [candidate.teamId, candidate]));

  if (input.method === "MANUAL") {
    if (!Array.isArray(input.groups) || input.groups.length !== input.groupCount) {
      throw new AppError(400, "Cần cấu hình từng bảng cho phương thức thủ công", "INVALID_MANUAL_GROUPS");
    }
    const allTeamIds: string[] = [];
    for (const [groupIndex, requestedGroup] of input.groups.entries()) {
      if (
        !requestedGroup ||
        typeof requestedGroup.name !== "string" ||
        !requestedGroup.name.trim() ||
        requestedGroup.name.length > 100
      ) {
        throw new AppError(400, "Tên bảng bắt buộc và tối đa 100 ký tự", "INVALID_GROUP_NAME");
      }
      if (
        !Array.isArray(requestedGroup.teamIds) ||
        requestedGroup.teamIds.some((teamId) => typeof teamId !== "string")
      ) {
        throw new AppError(400, "Danh sách đội trong bảng không hợp lệ", "INVALID_GROUP_TEAMS");
      }
      allTeamIds.push(...requestedGroup.teamIds);
      groups[groupIndex].name = requestedGroup.name.trim();
      groups[groupIndex].assignments = requestedGroup.teamIds.map((teamId, index) => ({
        teamId,
        groupId: groups[groupIndex].id,
        groupName: groups[groupIndex].name,
        position: index + 1,
        seedGroup: null,
      }));
    }
    if (new Set(allTeamIds).size !== allTeamIds.length) {
      throw new AppError(409, "Một đội không được phân vào nhiều bảng", "DUPLICATE_DRAW_TEAM");
    }
    if (allTeamIds.some((teamId) => !byId.has(teamId))) {
      throw new AppError(409, "Chỉ đội đã duyệt và đủ điều kiện mới được phân bảng", "INELIGIBLE_DRAW_TEAM");
    }
    const missing = eligible.filter((team) => !allTeamIds.includes(team.teamId));
    if (missing.length) {
      throw new AppError(409, "Còn đội đủ điều kiện chưa được phân bảng", "UNASSIGNED_DRAW_TEAMS");
    }
    if (groups.some((group, index) => group.assignments.length !== targetSizes[index])) {
      throw new AppError(409, "Số đội mỗi bảng phải cân bằng; chênh lệch tối đa một đội", "INVALID_GROUP_BALANCE");
    }
  } else if (input.method === "SEEDED") {
    if (!Array.isArray(input.seedings) || input.seedings.length !== eligible.length) {
      throw new AppError(400, "Cần gán nhóm hạt giống cho từng đội đủ điều kiện", "INVALID_SEEDINGS");
    }
    const seedMap = new Map<string, number>();
    for (const seeding of input.seedings) {
      if (!byId.has(seeding.teamId) || !Number.isInteger(seeding.seedGroup) || seeding.seedGroup < 1) {
        throw new AppError(400, "Nhóm hạt giống hoặc đội không hợp lệ", "INVALID_SEED_GROUP");
      }
      if (seedMap.has(seeding.teamId)) {
        throw new AppError(409, "Một đội chỉ được gán vào một nhóm hạt giống", "DUPLICATE_SEED_TEAM");
      }
      seedMap.set(seeding.teamId, seeding.seedGroup);
    }
    if (seedMap.size !== eligible.length) {
      throw new AppError(409, "Mỗi đội đủ điều kiện phải được gán nhóm hạt giống", "INCOMPLETE_SEEDINGS");
    }
    const seedGroups = [...new Set(seedMap.values())].sort((a, b) => a - b);
    for (const seedGroup of seedGroups) {
      const pot = shuffle(eligible.filter((team) => seedMap.get(team.teamId) === seedGroup));
      for (const team of pot) {
        const available = groups
          .map((group, index) => ({ group, index }))
          .filter(({ group, index }) => group.assignments.length < targetSizes[index])
          .filter(({ group }) => !input.noSameInstitution || !team.institutionId ||
            group.assignments.every((assignment) => byId.get(assignment.teamId)?.institutionId !== team.institutionId));
        if (!available.length) {
          throw new AppError(
            409,
            `Không thể phân nhóm hạt giống ${seedGroup} mà vẫn đáp ứng ràng buộc; hãy điều chỉnh hạt giống hoặc điều kiện`,
            "DRAW_CONSTRAINT_UNSATISFIED",
          );
        }
        const selected = available[Math.floor(Math.random() * available.length)];
        selected.group.assignments.push({
          teamId: team.teamId,
          groupId: selected.group.id,
          groupName: selected.group.name,
          position: selected.group.assignments.length + 1,
          seedGroup,
        });
      }
    }
  } else {
    const randomized = shuffle(eligible);
    for (const team of randomized) {
      const available = groups
        .map((group, index) => ({ group, index }))
        .filter(({ group, index }) => group.assignments.length < targetSizes[index])
        .filter(({ group }) => !input.noSameInstitution || !team.institutionId ||
          group.assignments.every((assignment) => byId.get(assignment.teamId)?.institutionId !== team.institutionId));
      if (!available.length) {
        throw new AppError(
          409,
          "Không tìm được cách chia đáp ứng điều kiện trường; hãy tắt điều kiện hoặc dùng chia thủ công",
          "DRAW_CONSTRAINT_UNSATISFIED",
        );
      }
      const selected = available[Math.floor(Math.random() * available.length)];
      selected.group.assignments.push({
        teamId: team.teamId,
        groupId: selected.group.id,
        groupName: selected.group.name,
        position: selected.group.assignments.length + 1,
        seedGroup: null,
      });
    }
  }

  if (input.noSameInstitution) {
    ensureNoSameInstitution(groups, byId);
  }
  for (const group of groups) {
    if (group.assignments.length > group.maxTeams) {
      throw new AppError(409, `${group.name} vượt sức chứa`, "GROUP_CAPACITY_EXCEEDED");
    }
    group.assignments.forEach((assignment, index) => {
      assignment.position = index + 1;
    });
  }
  return {
    eligibleTeams: eligible,
    ineligibleTeams: candidates.filter((candidate) => !candidate.eligible),
    groups,
    unassignedTeamIds: [],
  };
}

export async function getDrawManagement(tournamentId: string): Promise<{
  eligibleTeams: DrawCandidate[];
  ineligibleTeams: DrawCandidate[];
  latestVersion: DrawVersion | null;
  history: DrawVersion[];
}> {
  const candidates = await getDrawCandidates(tournamentId);
  const history = await listDrawVersions(tournamentId);
  return {
    eligibleTeams: candidates.filter((candidate) => candidate.eligible),
    ineligibleTeams: candidates.filter((candidate) => !candidate.eligible),
    latestVersion: history[0] ?? null,
    history,
  };
}

export async function getPublicDraw(tournamentId: string): Promise<DrawVersion | null> {
  return getPublishedDrawVersion(tournamentId);
}

export async function saveDrawWorkflowDraft(
  tournamentId: string,
  input: DrawPlanInput,
  userId: string,
): Promise<DrawVersion> {
  const preview = await previewDraw(tournamentId, input);
  const groups = preview.groups.map((group) => ({
    name: group.name,
    maxTeams: group.maxTeams,
    assignments: group.assignments.map((assignment) => ({
      teamId: assignment.teamId,
      seedGroup: assignment.seedGroup,
    })),
  }));
  try {
    return await saveDrawDraft(tournamentId, input, groups, userId);
  } catch (error) {
    if (error instanceof Error && error.message === "DRAW_CHANGE_REASON_REQUIRED") {
      throw new AppError(400, "Nhập lý do khi tạo phiên bản chia bảng thay đổi", "DRAW_CHANGE_REASON_REQUIRED");
    }
    throw error;
  }
}

export async function confirmDrawWorkflow(tournamentId: string, userId: string): Promise<DrawVersion> {
  const tournament = await getTournament(tournamentId);
  assertPreparationStage(tournament.status);
  const latest = await getLatestDrawVersion(tournamentId);
  if (!latest || latest.groups.reduce((count, group) => count + group.assignments.length, 0) === 0) {
    throw new AppError(409, "Chưa có bản nháp chia bảng để xác nhận", "DRAW_DRAFT_REQUIRED");
  }
  await previewDraw(tournamentId, {
    method: "MANUAL",
    groupCount: latest.groups.length,
    maxTeamsPerGroup: latest.groups[0]?.maxTeams,
    noSameInstitution: latest.config.noSameInstitution === true,
    groups: latest.groups.map((group) => ({
      name: group.name,
      teamIds: group.assignments.map((assignment) => assignment.teamId),
    })),
  });
  const confirmed = await changeDrawVersionStatus(tournamentId, "CONFIRMED", userId);
  if (!confirmed) {
    throw new AppError(409, "Bản nháp đã thay đổi; tải lại trước khi xác nhận", "DRAW_VERSION_CONFLICT");
  }
  return confirmed;
}

export async function publishDrawWorkflow(tournamentId: string, userId: string): Promise<DrawVersion> {
  const published = await changeDrawVersionStatus(tournamentId, "PUBLISHED", userId);
  if (!published) {
    throw new AppError(409, "Chỉ được công bố bản chia bảng đã xác nhận", "DRAW_CONFIRMATION_REQUIRED");
  }
  return published;
}
