import { AppError } from "../lib/errors";
import { randomInt } from "node:crypto";
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
  LiveDrawState,
  DrawPlanInput,
  DrawVersion,
} from "../models/drawWorkflow";
import { assertDrawStageReady } from "./drawStageReadiness";
import {
  advanceLiveDraw,
  createLiveDrawSession,
  getLatestLiveDrawState,
  getLiveDrawStateForManager,
  setLiveDrawStatus,
  finalizeLiveDraw,
  startScheduledLiveDraw as startScheduledLiveDrawInRepository,
  updateLiveDrawSchedule as updateLiveDrawScheduleInRepository,
  type LiveDrawScheduleInput,
} from "../repositories/liveDrawRepository";

type UpstreamCandidate = Omit<DrawCandidate, "eligible" | "ineligibilityReason">;

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
    const swap = randomInt(index + 1);
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

function seededShuffle<T>(values: T[], seedText: string): T[] {
  const result = [...values];
  let seed = 2166136261;
  for (const character of seedText) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619) >>> 0;
  for (let index = result.length - 1; index > 0; index -= 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const target = seed % (index + 1);
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function knockoutSeedPositions(seedCount: number, bracketSize: number): number[] {
  if (seedCount < 1) return [];
  let order = [1, 2];
  while (order.length < bracketSize) {
    const nextSize = order.length * 2;
    order = order.flatMap((seed) => [seed, nextSize + 1 - seed]);
  }
  return Array.from({ length: seedCount }, (_, index) => order.indexOf(index + 1));
}

export async function getPublicLiveDraw(tournamentId: string) {
  return getLatestLiveDrawState(tournamentId);
}

export async function getManagerLiveDraw(tournamentId: string) {
  const { state, plan } = await getLiveDrawStateForManager(tournamentId);
  return state && plan ? { ...state, seededTeamIds: plan.seededTeamIds ?? [] } : state;
}

async function attachManagerSeedIds(state: LiveDrawState): Promise<LiveDrawState> {
  const { plan } = await getLiveDrawStateForManager(state.tournamentId);
  return { ...state, seededTeamIds: plan?.seededTeamIds ?? [] };
}

export async function startLiveDraw(tournamentId: string, input: DrawPlanInput, userId: string, schedule: LiveDrawScheduleInput) {
  if (input.method === "MANUAL") {
    throw new AppError(400, "Bốc thăm trực tiếp chỉ áp dụng cho phương thức ngẫu nhiên", "LIVE_DRAW_METHOD_NOT_SUPPORTED");
  }
  const preview = await previewDraw(tournamentId, input);
  const groups = preview.groups.map((group) => ({
    name: group.name,
    maxTeams: group.maxTeams,
    assignments: group.assignments.map(({ teamId, position, seedGroup }) => ({ teamId, position, seedGroup })),
  }));
  const seededTeamIds = new Set(input.seededTeamIds ?? []);
  const drawOrder = shuffle(groups.flatMap((group, groupIndex) => group.assignments
    .filter((assignment) => !seededTeamIds.has(assignment.teamId))
    .map((assignment) => ({ groupIndex, groupName: group.name, ...assignment }))));
  const session = await createLiveDrawSession(tournamentId, userId, input.method, {
    groups,
    drawOrder,
    seededTeamIds: [...seededTeamIds],
    noSameInstitution: input.noSameInstitution === true,
    maxTeamsPerGroup: input.maxTeamsPerGroup,
    changeReason: input.changeReason?.trim() || undefined,
  }, schedule);
  return attachManagerSeedIds(session);
}

export async function startScheduledLiveDraw(tournamentId: string, userId: string) {
  return attachManagerSeedIds(await startScheduledLiveDrawInRepository(tournamentId, userId));
}

export async function rescheduleLiveDraw(tournamentId: string, userId: string, status: "SCHEDULED" | "POSTPONED" | "CANCELLED", schedule?: LiveDrawScheduleInput, cancellationReason?: string) {
  return attachManagerSeedIds(await updateLiveDrawScheduleInRepository(tournamentId, userId, status, schedule, cancellationReason));
}

export async function advanceLiveDrawPick(tournamentId: string, expectedSequence: number, userId: string, requestKey: string) {
  const result = await advanceLiveDraw(tournamentId, expectedSequence, userId, requestKey);
  return { ...result, state: await attachManagerSeedIds(result.state) };
}

export async function controlLiveDraw(tournamentId: string, userId: string, status: "PAUSED" | "LIVE" | "CANCELLED") {
  return attachManagerSeedIds(await setLiveDrawStatus(tournamentId, userId, status));
}

export async function finalizeLiveDrawDraft(tournamentId: string, userId: string) {
  const { state, plan } = await getLiveDrawStateForManager(tournamentId);
  if (!state || !plan) throw new AppError(404, "Không tìm thấy phiên bốc thăm", "LIVE_DRAW_NOT_FOUND");
  if (state.status !== "FINALIZED") throw new AppError(409, "Phiên bốc thăm chỉ hoàn tất sau khi lượt cuối được công bố tự động", "LIVE_DRAW_NOT_COMPLETED");
  const draw = await getLatestDrawVersion(tournamentId);
  if (!draw || draw.status !== "PUBLISHED") throw new AppError(409, "Phiên hoàn tất nhưng chưa có kết quả công bố; cần BTC xử lý sự cố", "LIVE_DRAW_PUBLICATION_INCOMPLETE");
  return { state: await finalizeLiveDraw(tournamentId, state.sessionId), draw };
}

function validateInput(input: DrawPlanInput, candidates: DrawCandidate[]): {
  eligible: DrawCandidate[];
  groupSize: number;
  targetSizes: number[];
} {
  if (!["RANDOM", "MANUAL"].includes(input.method)) {
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
  if (Math.max(...targetSizes) > groupSize || Math.min(...targetSizes) < 2) {
    throw new AppError(409, "Không thể phân bổ số đội theo sức chứa đã chọn", "INVALID_GROUP_BALANCE");
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

function allocateTeams(
  teams: DrawCandidate[], groups: DrawGroup[], targetSizes: number[], byId: Map<string, DrawCandidate>,
  noSameInstitution: boolean,
): void {
  const frequencies = new Map<string, number>();
  for (const team of teams) if (team.institutionId) frequencies.set(team.institutionId, (frequencies.get(team.institutionId) ?? 0) + 1);
  const ordered = shuffle(teams).sort((a, b) => (frequencies.get(b.institutionId ?? "") ?? 0) - (frequencies.get(a.institutionId ?? "") ?? 0));
  let explored = 0;
  const canPlace = (team: DrawCandidate, index: number) => {
    const group = groups[index];
    if (group.assignments.length >= targetSizes[index]) return false;
    return !noSameInstitution || !team.institutionId || group.assignments.every((assignment) => byId.get(assignment.teamId)?.institutionId !== team.institutionId);
  };
  const assign = (teamIndex: number): boolean => {
    if (teamIndex === ordered.length) return true;
    if (explored++ >= 100000) return false;
    const team = ordered[teamIndex];
    const options = shuffle(groups.map((_, index) => index).filter((index) => canPlace(team, index)))
      .sort((a, b) => groups[a].assignments.length - groups[b].assignments.length);
    for (const index of options) {
      const group = groups[index];
      group.assignments.push({ teamId: team.teamId, groupId: group.id, groupName: group.name, position: group.assignments.length + 1, seedGroup: null });
      if (assign(teamIndex + 1)) return true;
      group.assignments.pop();
    }
    return false;
  };
  if (!assign(0)) throw new AppError(409,
    noSameInstitution ? "Không thể đáp ứng ràng buộc tách trường với số bảng hiện tại. Tăng số bảng hoặc điều chỉnh điều kiện." : "Không thể phân bổ đội theo cấu hình bảng đã chọn.",
    "DRAW_CONSTRAINT_UNSATISFIED");
}

export async function previewDraw(tournamentId: string, input: DrawPlanInput): Promise<{
  eligibleTeams: DrawCandidate[];
  ineligibleTeams: DrawCandidate[];
  groups: DrawGroup[];
  unassignedTeamIds: string[];
}> {
  const tournament = await getTournament(tournamentId);
  assertDrawStageReady(tournament.status);
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
  const isHybridFormat = tournament.competitionFormat === "GROUP_AND_KNOCKOUT";
  const isKnockout = tournament.competitionFormat === "KNOCKOUT";
  if (isHybridFormat) {
    const configuredCapacity = tournament.rules.maxTeamsPerGroup;
    if (!configuredCapacity) {
      throw new AppError(409, "Giải kết hợp chưa có số đội tối đa mỗi bảng trong điều lệ", "HYBRID_GROUP_CAPACITY_NOT_CONFIGURED");
    }
    if (input.maxTeamsPerGroup !== undefined && input.maxTeamsPerGroup !== configuredCapacity) {
      throw new AppError(409, "Sức chứa bảng phải theo điều lệ đã công bố", "GROUP_CAPACITY_RULE_MISMATCH");
    }
    const config = tournament.rules.competitionConfig;
    const expectedCount = config?.groupCountMode === "FIXED" ? config.groupCount : Math.ceil(eligibleCount / configuredCapacity);
    if (!expectedCount || expectedCount < 1 || eligibleCount > expectedCount * configuredCapacity || eligibleCount < expectedCount * 2) {
      throw new AppError(409, `Số đội hiện tại không thể phân vào ${expectedCount ?? "số"} bảng với sức chứa ${configuredCapacity}`, "HYBRID_GROUP_COUNT_INFEASIBLE");
    }
    if (input.groupCount !== expectedCount) throw new AppError(409, `Số bảng được khóa theo điều lệ: ${expectedCount}`, "HYBRID_GROUP_COUNT_MISMATCH");
    input = { ...input, maxTeamsPerGroup: configuredCapacity };
  } else if (tournament.competitionFormat === "ROUND_ROBIN" && input.groupCount !== 1) {
    throw new AppError(409, "Giải vòng tròn chỉ có một bảng duy nhất theo điều lệ", "ROUND_ROBIN_SINGLE_GROUP_REQUIRED");
  } else if (isKnockout) {
    if (input.groupCount !== 1) throw new AppError(409, "Loại trực tiếp chỉ có một nhánh", "KNOCKOUT_SINGLE_BRACKET_REQUIRED");
    const bracketCapacity = 2 ** Math.ceil(Math.log2(Math.max(2, eligibleCount)));
    if (input.maxTeamsPerGroup !== undefined && input.maxTeamsPerGroup !== bracketCapacity) {
      throw new AppError(409, `Sức chứa nhánh loại trực tiếp phải là ${bracketCapacity}`, "KNOCKOUT_BRACKET_CAPACITY_MISMATCH");
    }
    input = { ...input, maxTeamsPerGroup: bracketCapacity, noSameInstitution: false };
  }
  const policy = tournament.rules.competitionConfig?.sameInstitutionPolicy ?? "NONE";
  // Group separation is not applicable to a single knockout bracket. In particular,
  // historical regulation configs must not re-enable it after bracket normalization.
  const requireSeparateInstitutions = !isKnockout && policy === "REQUIRE_SEPARATE";
  const preferSeparateInstitutions = !isKnockout && policy === "PREFER_SEPARATE" && input.method !== "MANUAL" && !Array.isArray(input.groups);
  input = { ...input, noSameInstitution: requireSeparateInstitutions || preferSeparateInstitutions };
  const { eligible, groupSize, targetSizes: balancedSizes } = validateInput(input, candidates);
  const targetSizes = isHybridFormat && tournament.rules.competitionConfig?.groupAllocation === "TOP_UP_FIRST"
    ? Array.from({ length: input.groupCount }, (_, index) => Math.min(groupSize, eligible.length - index * groupSize))
    : balancedSizes;
  if (targetSizes.some((size) => size < 2)) {
    throw new AppError(409, "Mỗi bảng cần ít nhất hai đội; điều chỉnh số bảng hoặc số đội tối đa mỗi bảng", "INVALID_GROUP_SIZE");
  }
  if (isKnockout && (input.groupCount !== 1 || input.noSameInstitution)) {
    throw new AppError(400, "Loại trực tiếp dùng một nhánh duy nhất; không áp dụng tùy chọn chia nhiều bảng hoặc tách trường", "INVALID_KNOCKOUT_DRAW_CONFIG");
  }
  const groups: DrawGroup[] = targetSizes.map((targetSize, index) => ({
    id: `preview-${index + 1}`,
    name: typeof input.groups?.[index]?.name === "string" && input.groups[index].name.trim()
      ? input.groups[index].name.trim()
      : groupLabel(index),
    maxTeams: groupSize,
    assignments: [],
  }));
  if (isKnockout) {
    groups[0].name = "Nhánh loại trực tiếp";
    groups[0].maxTeams = groupSize;
  }
  const seededTeamIds = input.seededTeamIds ?? [];
  if (!Array.isArray(seededTeamIds) || seededTeamIds.some((teamId) => typeof teamId !== "string") || new Set(seededTeamIds).size !== seededTeamIds.length) {
    throw new AppError(400, "Danh sách đội hạt giống không hợp lệ", "INVALID_SEEDED_TEAMS");
  }
  if (seededTeamIds.some((teamId) => !eligible.some((team) => team.teamId === teamId))) {
    throw new AppError(400, "Chỉ đội đủ điều kiện mới được chọn làm hạt giống", "INELIGIBLE_SEEDED_TEAM");
  }
  if (seededTeamIds.length && tournament.competitionFormat === "ROUND_ROBIN") {
    throw new AppError(400, "Giải vòng tròn không sử dụng đội hạt giống", "ROUND_ROBIN_SEEDING_NOT_SUPPORTED");
  }
  if (seededTeamIds.length && isHybridFormat && seededTeamIds.length !== input.groupCount) {
    throw new AppError(400, `Giải kết hợp cần chọn đúng ${input.groupCount} đội hạt giống, mỗi bảng một đội`, "INVALID_HYBRID_SEED_COUNT");
  }
  if (seededTeamIds.length >= eligible.length) {
    throw new AppError(400, "Cần để lại ít nhất một đội chưa xếp để phương thức bốc thăm hoặc điều chỉnh tiếp tục hoạt động", "TOO_MANY_SEEDED_TEAMS");
  }

  const byeCount = isKnockout ? Math.max(0, groupSize - eligible.length) : 0;
  const byePolicy = tournament.rules.competitionConfig?.byePolicy ?? "AUTOMATIC";
  const seededBracketSlots = isKnockout ? knockoutSeedPositions(seededTeamIds.length, groupSize) : [];
  const seededBracketSlotSet = new Set(seededBracketSlots);
  let knockoutByeIndexes = new Set<number>();
  if (isKnockout && byeCount > 0) {
    const allIndexes = Array.from({ length: groupSize }, (_, index) => index);
    const unseededIndexes = allIndexes.filter((index) => !seededBracketSlotSet.has(index));
    if (byePolicy === "SEEDED_FIRST" && seededBracketSlots.length) {
      const pairedByeSlots = seededBracketSlots
        .map((index) => index % 2 === 0 ? index + 1 : index - 1)
        .filter((index) => unseededIndexes.includes(index));
      const remaining = unseededIndexes.filter((index) => !pairedByeSlots.includes(index));
      knockoutByeIndexes = new Set([...pairedByeSlots, ...remaining].slice(0, byeCount));
    } else if (byePolicy === "SEEDED_FIRST") {
      knockoutByeIndexes = new Set(allIndexes.slice(0, byeCount));
    } else {
      knockoutByeIndexes = new Set(seededShuffle(unseededIndexes, `${tournamentId}:${eligible.map((team) => team.teamId).sort().join(":")}`).slice(0, byeCount));
    }
  }
  const validKnockoutPositions = isKnockout
    ? Array.from({ length: groupSize }, (_, index) => index + 1).filter((position) => !knockoutByeIndexes.has(position - 1))
    : [];
  const byId = new Map(eligible.map((candidate) => [candidate.teamId, candidate]));
  const seededGroupPositions = new Map(seededTeamIds.map((teamId, index) => [teamId, { groupIndex: index, position: 1 }]));
  const seededKnockoutPositions = new Map(seededTeamIds.map((teamId, index) => [teamId, { groupIndex: 0, position: seededBracketSlots[index] + 1 }]));

  if (input.method === "MANUAL" || Array.isArray(input.groups)) {
    if (!Array.isArray(input.groups) || input.groups.length !== input.groupCount) {
      throw new AppError(400, "Cần cấu hình đủ các bảng cho phương án đã chỉnh sửa", "INVALID_MANUAL_GROUPS");
    }
    const allTeamIds: string[] = [];
    for (const [groupIndex, requestedGroup] of input.groups.entries()) {
      if (!requestedGroup || typeof requestedGroup.name !== "string" || !requestedGroup.name.trim() || requestedGroup.name.length > 100) {
        throw new AppError(400, "Tên bảng bắt buộc và tối đa 100 ký tự", "INVALID_GROUP_NAME");
      }
      if (!Array.isArray(requestedGroup.teamIds) || requestedGroup.teamIds.some((teamId) => typeof teamId !== "string")) {
        throw new AppError(400, "Danh sách đội trong bảng không hợp lệ", "INVALID_GROUP_TEAMS");
      }
      allTeamIds.push(...requestedGroup.teamIds);
      groups[groupIndex].name = requestedGroup.name.trim();
      if (requestedGroup.positions !== undefined && (!Array.isArray(requestedGroup.positions) || requestedGroup.positions.length !== requestedGroup.teamIds.length)) {
        throw new AppError(400, `${groups[groupIndex].name}: danh sách vị trí không khớp số đội`, "INVALID_DRAW_POSITIONS");
      }
      const requestedPositions = requestedGroup.positions ?? requestedGroup.teamIds.map((_, index) => index + 1);
      if (requestedPositions.some((position) => !Number.isInteger(position) || position < 1 || position > groups[groupIndex].maxTeams) || new Set(requestedPositions).size !== requestedPositions.length) {
        throw new AppError(400, `${groups[groupIndex].name}: vị trí không hợp lệ hoặc bị trùng`, "INVALID_DRAW_POSITIONS");
      }
      if (isKnockout && requestedPositions.some((position) => knockoutByeIndexes.has(position - 1))) {
        throw new AppError(409, "Vị trí đã dành cho BYE không thể xếp đội", "KNOCKOUT_BYE_POSITION_ASSIGNED");
      }
      if (!isKnockout && requestedPositions.some((position, index) => position !== index + 1)) {
        throw new AppError(400, "Vị trí trong bảng phải liên tục theo thứ tự", "INVALID_DRAW_POSITIONS");
      }
      groups[groupIndex].assignments = requestedGroup.teamIds.map((teamId, index) => ({
        teamId,
        groupId: groups[groupIndex].id,
        groupName: groups[groupIndex].name,
        position: requestedPositions[index],
        seedGroup: null,
      }));
    }
    if (new Set(allTeamIds).size !== allTeamIds.length) throw new AppError(409, "Một đội không được phân vào nhiều bảng", "DUPLICATE_DRAW_TEAM");
    if (allTeamIds.some((teamId) => !byId.has(teamId))) throw new AppError(409, "Chỉ đội đã duyệt và đủ điều kiện mới được phân bảng", "INELIGIBLE_DRAW_TEAM");
    const missing = eligible.filter((team) => !allTeamIds.includes(team.teamId));
    if (missing.length) throw new AppError(409, "Còn đội đủ điều kiện chưa được phân bảng", "UNASSIGNED_DRAW_TEAMS");
    if (groups.some((group, index) => group.assignments.length !== targetSizes[index])) throw new AppError(409, "Số đội mỗi bảng không khớp quy tắc phân bổ đã cấu hình", "INVALID_GROUP_BALANCE");
    if (isKnockout && (new Set(groups[0].assignments.map((assignment) => assignment.position)).size !== eligible.length || validKnockoutPositions.some((position) => !groups[0].assignments.some((assignment) => assignment.position === position)))) {
      throw new AppError(409, "Nhánh loại trực tiếp phải xếp đủ đội vào các vị trí không dành cho BYE", "INVALID_KNOCKOUT_POSITIONS");
    }
    const expectedSeedPositions = isKnockout ? seededKnockoutPositions : seededGroupPositions;
    for (const [teamId, expected] of expectedSeedPositions) {
      const actualGroup = groups.findIndex((group) => group.assignments.some((assignment) => assignment.teamId === teamId));
      const actual = actualGroup < 0 ? undefined : groups[actualGroup].assignments.find((assignment) => assignment.teamId === teamId);
      if (!actual || actualGroup !== expected.groupIndex || actual.position !== expected.position) {
        throw new AppError(409, "Vị trí của đội hạt giống đã thay đổi; hãy giữ nguyên các suất hạt giống rồi phân bổ đội còn lại", "SEEDED_POSITION_CHANGED");
      }
    }
    if (input.noSameInstitution && !isKnockout) ensureNoSameInstitution(groups, byId);
  } else if (isKnockout) {
    const seededPositions = new Set(seededBracketSlots);
    const assignments = seededTeamIds.map((teamId, index) => ({
      teamId, groupId: groups[0].id, groupName: groups[0].name,
      position: seededBracketSlots[index] + 1, seedGroup: null,
    }));
    const remainingPositions = validKnockoutPositions.filter((position) => !seededPositions.has(position - 1));
    const remainingTeams = shuffle(eligible.filter((team) => !seededTeamIds.includes(team.teamId)));
    if (remainingPositions.length !== remainingTeams.length) throw new AppError(409, "Không thể khớp số vị trí cây đấu với số đội đủ điều kiện", "INVALID_KNOCKOUT_POSITIONS");
    assignments.push(...remainingTeams.map((team, index) => ({
      teamId: team.teamId, groupId: groups[0].id, groupName: groups[0].name,
      position: remainingPositions[index], seedGroup: null,
    })));
    groups[0].assignments = assignments.sort((left, right) => left.position - right.position);
  } else {
    const seededSet = new Set(seededTeamIds);
    for (const [teamId, target] of seededGroupPositions) {
      const group = groups[target.groupIndex];
      group.assignments.push({ teamId, groupId: group.id, groupName: group.name, position: target.position, seedGroup: null });
    }
    const remainingTeams = eligible.filter((team) => !seededSet.has(team.teamId));
    try {
      allocateTeams(remainingTeams, groups, targetSizes, byId, Boolean(input.noSameInstitution));
    } catch (error) {
      if (!preferSeparateInstitutions) throw error;
      groups.forEach((group) => { group.assignments = group.assignments.filter((assignment) => seededSet.has(assignment.teamId)); });
      allocateTeams(remainingTeams, groups, targetSizes, byId, false);
    }
    if (!seededTeamIds.length) {
      for (const group of groups) group.assignments = shuffle(group.assignments);
    } else {
      for (const group of groups) group.assignments.sort((left, right) => left.position - right.position);
    }
  }

  if (requireSeparateInstitutions && !isKnockout) {
    ensureNoSameInstitution(groups, byId);
  }
  for (const group of groups) {
    if (group.assignments.length > group.maxTeams) {
      throw new AppError(409, `${group.name} vượt sức chứa`, "GROUP_CAPACITY_EXCEEDED");
    }
    if (!isKnockout && !Array.isArray(input.groups) && seededTeamIds.length === 0) {
      group.assignments.forEach((assignment, index) => {
        assignment.position = index + 1;
      });
    }
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
      position: assignment.position,
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

export async function confirmDrawWorkflow(tournamentId: string, method: DrawVersion["method"], userId: string): Promise<DrawVersion> {
  const tournament = await getTournament(tournamentId);
  assertDrawStageReady(tournament.status);
  const latest = (await listDrawVersions(tournamentId)).find((version) => version.method === method && version.status === "DRAFT") ?? null;
  if (!latest || latest.groups.reduce((count, group) => count + group.assignments.length, 0) === 0) {
    throw new AppError(409, "Chưa có bản nháp chia bảng để xác nhận", "DRAW_DRAFT_REQUIRED");
  }
  await previewDraw(tournamentId, {
    method: latest.method === "MANUAL" ? "MANUAL" : "RANDOM",
    groupCount: latest.groups.length,
    maxTeamsPerGroup: latest.groups[0]?.maxTeams,
    noSameInstitution: latest.config.noSameInstitution === true,
    groups: latest.groups.map((group) => ({
      name: group.name,
      teamIds: group.assignments.map((assignment) => assignment.teamId),
      positions: group.assignments.map((assignment) => assignment.position),
    })),
    seededTeamIds: Array.isArray(latest.config.seededTeamIds) ? latest.config.seededTeamIds as string[] : undefined,
  });
  const confirmed = await changeDrawVersionStatus(tournamentId, method, "CONFIRMED", userId);
  if (!confirmed) {
    throw new AppError(409, "Bản nháp đã thay đổi; tải lại trước khi xác nhận", "DRAW_VERSION_CONFLICT");
  }
  return confirmed;
}

export async function publishDrawWorkflow(tournamentId: string, method: DrawVersion["method"], userId: string): Promise<DrawVersion> {
  const tournament = await getTournament(tournamentId);
  assertDrawStageReady(tournament.status);
  const latest = (await listDrawVersions(tournamentId)).find((version) => version.method === method && version.status === "CONFIRMED") ?? null;
  if (!latest || latest.status !== "CONFIRMED") {
    throw new AppError(409, "Chỉ được công bố bản chia bảng đã xác nhận", "DRAW_CONFIRMATION_REQUIRED");
  }
  await previewDraw(tournamentId, {
    method: latest.method === "MANUAL" ? "MANUAL" : "RANDOM",
    groupCount: latest.groups.length,
    maxTeamsPerGroup: latest.groups[0]?.maxTeams,
    noSameInstitution: latest.config.noSameInstitution === true,
    groups: latest.groups.map((group) => ({
      name: group.name,
      teamIds: group.assignments.map((assignment) => assignment.teamId),
      positions: group.assignments.map((assignment) => assignment.position),
    })),
    seededTeamIds: Array.isArray(latest.config.seededTeamIds) ? latest.config.seededTeamIds as string[] : undefined,
  });
  const published = await changeDrawVersionStatus(tournamentId, method, "PUBLISHED", userId, {
    regulationVersion: tournament.rules?.publishedVersion ?? null,
    competitionFormat: tournament.competitionFormat,
    rankingCriteria: tournament.rankingCriteria ?? [],
    rules: tournament.rules,
  });
  if (!published) {
    throw new AppError(409, "Chỉ được công bố bản chia bảng đã xác nhận", "DRAW_CONFIRMATION_REQUIRED");
  }
  return published;
}
