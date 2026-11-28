import { AppError } from "../lib/errors";
import { config } from "../config";
import { generateGroupFixtures, generateHybridPlayoffSkeleton, generateKnockoutFixtures, getGroupStageFixtures, listGroupLotDrawAudits, listManagedTournamentFixtures, listManagedKnockoutBracket, publishTournamentFixtureStructure, type FixtureStage } from "../repositories/matchRepository";
import type { AuditableGroupLotDraw, GroupLotDrawAudit } from "../repositories/matchRepository";
import type { FixtureGenerationResult, GeneratedFixtureInput } from "../models/match";
import { rankHybridGroup, selectHybridQualifiers } from "./hybridQualification";

type PublishedDraw = {
  id: string;
  tournamentId: string;
  status: string;
  config?: {
    fixtureRegulationSnapshot?: {
      regulationVersion: number | null;
      competitionFormat: TournamentDetails["competitionFormat"];
      rankingCriteria?: TournamentDetails["rankingCriteria"];
      rules?: TournamentDetails["rules"];
    };
  };
  groups: Array<{
    id: string;
    name: string;
    assignments: Array<{ teamId: string; position: number }>;
  }>;
};

function publishedRules(tournament: TournamentDetails, draw: PublishedDraw) {
  const snapshot = draw.config?.fixtureRegulationSnapshot;
  return {
    competitionFormat: snapshot?.competitionFormat ?? tournament.competitionFormat,
    rankingCriteria: snapshot?.rankingCriteria ?? tournament.rankingCriteria,
    rules: snapshot?.rules ?? tournament.rules,
    regulationVersion: snapshot ? snapshot.regulationVersion : null,
  };
}

type TournamentDetails = {
  id: string;
  status: string;
  competitionFormat: "ROUND_ROBIN" | "GROUP_AND_KNOCKOUT" | "KNOCKOUT";
  rankingCriteria?: Array<"POINTS" | "GOAL_DIFFERENCE" | "GOALS_FOR" | "HEAD_TO_HEAD" | "FAIR_PLAY" | "LOT_DRAW">;
  rules?: {
    advancingTeamsPerGroup: number;
    roundRobinLegs?: 1 | 2;
    maxTeamsPerGroup?: number | null;
    pointsForWin: number;
    pointsForDraw: number;
    pointsForLoss: number;
    competitionConfig?: { thirdPlaceMatch?: boolean; knockoutPairing?: "GROUP_RANK" | "REDRAW" | "FIXED_CROSSOVER" };
    publishedVersion?: number;
  } | null;
};

export async function getPublishedDraw(tournamentId: string): Promise<PublishedDraw> {
  if (!config.internalApiKey) {
    throw new AppError(503, "Tournament integration is not configured", "SERVICE_MISCONFIGURED");
  }
  const endpoint = new URL(
    `/internal/tournaments/${encodeURIComponent(tournamentId)}/published-draw`,
    config.tournamentServiceUrl,
  ).toString();
  let response: Response;
  try {
    response = await fetch(endpoint, {
      headers: { "x-gateway-internal-key": config.internalApiKey },
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new AppError(503, "Tournament service is unavailable", "UPSTREAM_UNAVAILABLE");
  }
  if (response.status === 404) {
    throw new AppError(409, "Chỉ có thể tạo lịch từ phương án chia bảng đã công bố", "PUBLISHED_DRAW_REQUIRED");
  }
  if (!response.ok) {
    throw new AppError(502, "Could not load the published draw", "UPSTREAM_ERROR");
  }
  const body = await response.json() as { draw?: PublishedDraw };
  if (!body.draw || body.draw.tournamentId !== tournamentId || body.draw.status !== "PUBLISHED") {
    throw new AppError(502, "Tournament service returned an invalid published draw", "UPSTREAM_ERROR");
  }
  return body.draw;
}

async function getTournamentDetails(tournamentId: string): Promise<TournamentDetails> {
  const endpoint = new URL(
    `/tournaments/${encodeURIComponent(tournamentId)}`,
    config.tournamentServiceUrl,
  ).toString();
  let response: Response;
  try {
    response = await fetch(endpoint, {
      headers: config.internalApiKey
        ? { "x-gateway-internal-key": config.internalApiKey }
        : {},
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new AppError(503, "Tournament service is unavailable", "UPSTREAM_UNAVAILABLE");
  }
  if (!response.ok) {
    throw new AppError(502, "Could not load tournament configuration", "UPSTREAM_ERROR");
  }
  const body = await response.json() as { tournament?: TournamentDetails };
  if (!body.tournament || body.tournament.id !== tournamentId) {
    throw new AppError(502, "Tournament service returned invalid configuration", "UPSTREAM_ERROR");
  }
  return body.tournament;
}

export async function generateHybridKnockoutStage(
  tournamentId: string,
  generatedBy: string,
  lotDrawResolutions: AuditableGroupLotDraw[] = [],
): Promise<FixtureGenerationResult & { qualifications: Array<{ teamId: string; groupId: string; groupRank: number }> }> {
  const tournament = await getTournamentDetails(tournamentId);
  const draw = await getPublishedDraw(tournamentId);
  const regulation = publishedRules(tournament, draw);
  if (regulation.competitionFormat !== "GROUP_AND_KNOCKOUT") {
    throw new AppError(409, "Chức năng này chỉ áp dụng cho giải vòng bảng kết hợp loại trực tiếp", "HYBRID_FORMAT_REQUIRED");
  }
  if (!["PREPARING", "IN_PROGRESS", "PAUSED"].includes(tournament.status)) {
    throw new AppError(409, "Giải phải bắt đầu giai đoạn thi đấu vòng bảng trước khi tạo nhánh playoff", "FIXTURE_STAGE_NOT_READY");
  }
  if (!draw.groups.length || draw.groups.some((group) => group.assignments.length < 2)) {
    throw new AppError(409, "Bản chia vòng bảng chưa hợp lệ", "INVALID_GROUP_DRAW");
  }
  const rules = regulation.rules;
  if (!rules) throw new AppError(409, "Điều lệ chưa cấu hình số đội đi tiếp và cách tính điểm", "HYBRID_RULES_REQUIRED");
    const {computeCompetitionStandings,recordRankingLot}=await import('../repositories/competitionProjectionRepository');
    if(lotDrawResolutions.length){
      const before=await computeCompetitionStandings(tournamentId);
      for(const lot of lotDrawResolutions){
        const group=before.groups.find(group=>group.groupId===lot.groupId);
        if(!group)throw new AppError(409,'Biên bản không thuộc bảng của giải.','UNMATCHED_GROUP_LOT_DRAW');
        await recordRankingLot(tournamentId,generatedBy,{...lot,resultSignature:lot.resultSignature??group.resultSignature});
      }
    }
    const table=await computeCompetitionStandings(tournamentId);
  if(table.knockoutPairing==='REDRAW')throw new AppError(409,'Điều lệ yêu cầu bốc thăm lại; chưa có kết quả bốc thăm vòng loại trực tiếp chính thức.','HYBRID_REDRAW_REQUIRED');
  if(table.groups.some(group=>!group.complete))throw new AppError(409,'Vòng bảng còn trận chưa có kết quả chính thức.','GROUP_RESULTS_NOT_FINAL');
  const unresolved=table.groups.find(group=>group.standings.some(team=>team.groupRank===0));
  if(unresolved)throw new AppError(409,unresolved.rankingIssues.join('; '),regulation.rankingCriteria?.includes('LOT_DRAW')?'GROUP_LOT_DRAW_REQUIRED':'GROUP_STANDINGS_TIE',{groupId:unresolved.groupId,tiedTeamIds:unresolved.standings.filter(team=>!team.groupRank).map(team=>team.teamId)});
  if(lotDrawResolutions.some(lot=>!table.groups.some(group=>group.groupId===lot.groupId)))throw new AppError(409,'Biên bản không thuộc bảng của giải.','UNMATCHED_GROUP_LOT_DRAW');
  const qualifications=selectHybridQualifiers(table.groups.map(group=>group.standings),rules.advancingTeamsPerGroup).map(({teamId,groupId,groupRank})=>({teamId,groupId,groupRank}));
  if (qualifications.length < 2 || qualifications.length > 32) {
    throw new AppError(409, "Tổng số đội đi tiếp phải từ 2 đến 32", "INVALID_PLAYOFF_FIELD_SIZE");
  }
  const teamIds = qualifications.map((qualification) => qualification.teamId);
  const thirdPlaceMatch = Boolean(rules.competitionConfig?.thirdPlaceMatch);
  if (thirdPlaceMatch && teamIds.length < 4) {
    throw new AppError(409, "Trận tranh hạng ba cần tối thiểu bốn đội đi tiếp", "THIRD_PLACE_REQUIRES_FOUR_TEAMS");
  }
    const result = await generateKnockoutFixtures(tournamentId, draw.id, teamIds, generatedBy, true, qualifications, [], thirdPlaceMatch, regulation.regulationVersion);
  return { ...result, qualifications };
}

export async function getHybridLotDrawHistory(tournamentId: string): Promise<GroupLotDrawAudit[]> {
  try {
    const draw = await getPublishedDraw(tournamentId);
    return listGroupLotDrawAudits(tournamentId, draw.id);
  } catch (error) {
    if (error instanceof AppError && error.code === "PUBLISHED_DRAW_REQUIRED") return [];
    throw error;
  }
}

/** Official, read-only table calculated from approved results using the qualification rules. */
export async function getFixtureGroupStandings(tournamentId: string) {
  const {computeCompetitionStandings}=await import('../repositories/competitionProjectionRepository');
  return computeCompetitionStandings(tournamentId);
}

export function createRoundRobinFixtures(
  draw: PublishedDraw,
  legs: 1 | 2,
): GeneratedFixtureInput[] {
  const fixtures: GeneratedFixtureInput[] = [];
  for (const group of draw.groups) {
    const teamIds = group.assignments.map((assignment) => assignment.teamId);
    if (teamIds.length < 2) {
      throw new AppError(409, `${group.name} phải có ít nhất hai đội`, "INVALID_DRAW_GROUP");
    }
    const rotation: Array<string | null> = [...teamIds];
    if (rotation.length % 2 !== 0) rotation.push(null);
    const singleLegRoundCount = rotation.length - 1;
    const gamesPerRound = rotation.length / 2;
    let current = rotation;

    for (let leg = 1; leg <= legs; leg += 1) {
      for (let roundIndex = 0; roundIndex < singleLegRoundCount; roundIndex += 1) {
        for (let pairIndex = 0; pairIndex < gamesPerRound; pairIndex += 1) {
          const first = current[pairIndex];
          const second = current[current.length - 1 - pairIndex];
          if (!first || !second) continue;
          const homeTeamId = (roundIndex + leg) % 2 === 0 ? first : second;
          const awayTeamId = homeTeamId === first ? second : first;
          fixtures.push({
            tournamentId: draw.tournamentId,
            drawVersionId: draw.id,
            groupId: group.id,
            groupName: group.name,
            roundNumber: roundIndex + 1,
            leg,
            round: `${group.name} · Lượt ${leg} · Vòng ${roundIndex + 1}`,
            homeTeamId,
            awayTeamId,
          });
        }
        const fixed = current[0];
        const rotating = current.slice(1);
        rotating.unshift(rotating.pop() ?? null);
        current = [fixed, ...rotating];
      }
      current = rotation;
    }
  }
  return fixtures;
}

export async function generateTournamentFixtures(
  tournamentId: string,
  requestedLegs: 1 | 2,
  generatedBy: string,
): Promise<FixtureGenerationResult & { knockoutStagePending: boolean }> {
  const tournament = await getTournamentDetails(tournamentId);
  const draw = await getPublishedDraw(tournamentId);
  const regulation = publishedRules(tournament, draw);
  const legs = regulation.competitionFormat === "KNOCKOUT"
    ? requestedLegs
    : regulation.rules?.roundRobinLegs ?? requestedLegs;
  if (regulation.competitionFormat !== "KNOCKOUT" && requestedLegs !== legs) {
    throw new AppError(409, `Số lượt thi đấu phải theo điều lệ đã công bố (${legs} lượt)`, "ROUND_ROBIN_LEGS_RULE_MISMATCH");
  }
  if (!["ROSTER_LOCKED", "PREPARING"].includes(tournament.status)) {
    throw new AppError(409, "Chỉ sinh sơ đồ sau khi chốt đội và công bố Bước 3", "FIXTURE_STAGE_NOT_READY");
  }
  const allTeamIds = draw.groups.flatMap((group) => group.assignments.map((assignment) => assignment.teamId));
  if (!draw.groups.length || allTeamIds.length < 2) {
    throw new AppError(409, "Kết quả Bước 3 chưa có đủ đội hoặc bảng để sinh sơ đồ", "INVALID_PUBLISHED_DRAW");
  }
  if (new Set(allTeamIds).size !== allTeamIds.length) {
    throw new AppError(409, "Một đội xuất hiện ở nhiều bảng trong bản chia đã công bố", "INVALID_PUBLISHED_DRAW");
  }
  if (regulation.competitionFormat === "KNOCKOUT") {
    if (legs !== 1) throw new AppError(400, "Thể thức loại trực tiếp chỉ hỗ trợ một lượt", "INVALID_KNOCKOUT_LEGS");
    if (draw.groups.length !== 1 || draw.groups[0].assignments.length < 2) {
      throw new AppError(409, "Bản nhánh loại trực tiếp phải có một danh sách tối thiểu hai đội", "INVALID_KNOCKOUT_DRAW");
    }
    const thirdPlaceMatch = Boolean(regulation.rules?.competitionConfig?.thirdPlaceMatch);
    if (thirdPlaceMatch && allTeamIds.length < 4) {
      throw new AppError(409, "Trận tranh hạng ba cần tối thiểu bốn đội", "THIRD_PLACE_REQUIRES_FOUR_TEAMS");
    }
    const assignments = [...draw.groups[0].assignments].sort((a, b) => a.position - b.position);
    const result = await generateKnockoutFixtures(tournamentId, draw.id, assignments.map((item) => item.teamId), generatedBy, false, [], [], thirdPlaceMatch, regulation.regulationVersion, assignments);
    return { ...result, knockoutStagePending: false };
  }
  const fixtures = createRoundRobinFixtures(draw, legs);
  if (fixtures.length > 992) {
    throw new AppError(409, "Số trận vượt giới hạn tạo lịch tự động", "TOO_MANY_FIXTURES");
  }
  let playoffSources: Array<{ groupId: string; groupRank: number }> = [];
  if (regulation.competitionFormat === "GROUP_AND_KNOCKOUT") {
    const advancingTeamsPerGroup = regulation.rules?.advancingTeamsPerGroup;
    if (!Number.isInteger(advancingTeamsPerGroup) || !advancingTeamsPerGroup || advancingTeamsPerGroup < 1) {
      throw new AppError(409, "Điều lệ chưa cấu hình số đội đi tiếp mỗi bảng", "HYBRID_RULES_REQUIRED");
    }
    if (draw.groups.some((group) => group.assignments.length < advancingTeamsPerGroup)) {
      throw new AppError(409, "Có bảng không đủ số đội theo cấu hình đi tiếp", "INVALID_ADVANCING_TEAMS");
    }
    const groups = [...draw.groups].sort((left, right) => left.name.localeCompare(right.name, "vi"));
    if (groups.length * advancingTeamsPerGroup > 32) {
      throw new AppError(409, "Tổng số đội playoff vượt giới hạn 32", "INVALID_PLAYOFF_FIELD_SIZE");
    }
    if (advancingTeamsPerGroup === 2 && groups.length > 1 && groups.length % 2 === 0
        && regulation.rules?.competitionConfig?.knockoutPairing !== "REDRAW") {
      for (let index = 0; index < groups.length; index += 2) {
        playoffSources.push({ groupId: groups[index].id, groupRank: 1 }, { groupId: groups[index + 1].id, groupRank: 2 },
          { groupId: groups[index + 1].id, groupRank: 1 }, { groupId: groups[index].id, groupRank: 2 });
      }
    } else {
      playoffSources = groups.flatMap((group) => Array.from({ length: advancingTeamsPerGroup }, (_, index) => ({ groupId: group.id, groupRank: index + 1 })));
    }
  }
  const result = await generateGroupFixtures(
    tournamentId,
    draw.id,
    legs,
    fixtures,
    generatedBy,
    regulation.regulationVersion,
  );
  if (playoffSources.length) {
    const thirdPlaceMatch = Boolean(regulation.rules?.competitionConfig?.thirdPlaceMatch);
    if (thirdPlaceMatch && playoffSources.length < 4) {
      throw new AppError(409, "Trận tranh hạng ba cần tối thiểu bốn đội đi tiếp", "THIRD_PLACE_REQUIRES_FOUR_TEAMS");
    }
    await generateHybridPlayoffSkeleton(tournamentId, draw.id, playoffSources, generatedBy, thirdPlaceMatch, regulation.regulationVersion);
  }
  return {
    ...result,
    knockoutStagePending: regulation.competitionFormat === "GROUP_AND_KNOCKOUT",
  };
}

export async function publishGeneratedFixtureStructure(tournamentId: string, userId: string, validateOnly = false) {
  const [tournament, draw] = await Promise.all([getTournamentDetails(tournamentId), getPublishedDraw(tournamentId)]);
  if (!["ROSTER_LOCKED", "PREPARING"].includes(tournament.status)) {
    throw new AppError(409, "Chỉ kiểm tra/công bố sơ đồ sau khi chốt đội và công bố Bước 3", "FIXTURE_STAGE_NOT_READY");
  }
  const regulation = publishedRules(tournament, draw);
  const rules = regulation.rules;
  if (!rules) throw new AppError(409, "Không tìm thấy phiên bản điều lệ đã công bố", "PUBLISHED_REGULATION_REQUIRED");
  if (regulation.competitionFormat !== tournament.competitionFormat) {
    throw new AppError(409, "Thể thức giải đã thay đổi sau khi công bố Bước 3", "FIXTURE_REGULATION_VERSION_MISMATCH");
  }
  const groupCounts = draw.groups.map((group) => group.assignments.length);
  if (new Set(draw.groups.flatMap((group) => group.assignments.map((assignment) => assignment.teamId))).size
      !== groupCounts.reduce((sum, count) => sum + count, 0)) {
    throw new AppError(409, "Một đội bị phân bổ nhiều lần trong kết quả Bước 3", "INVALID_PUBLISHED_DRAW");
  }
  const counts: Partial<Record<FixtureStage, number>> = {};
  const stages: FixtureStage[] = [];
  const persisted = await listManagedTournamentFixtures(tournamentId);
  const currentMatches = persisted.stages.filter((stage) => stage.drawVersionId === draw.id).flatMap((stage) => stage.matches);
  for (const match of currentMatches.filter((match) => match.stage === "GROUP")) {
    const group = draw.groups.find((candidate) => candidate.id === match.groupId);
    if (!group || !group.assignments.some((item) => item.teamId === match.homeTeamId)
        || !group.assignments.some((item) => item.teamId === match.awayTeamId)
        || !match.leg || match.leg > (rules.roundRobinLegs ?? 1) || !match.roundNumber || match.roundNumber < 1) {
      throw new AppError(409, `Trận ${match.id} không khớp đội, bảng hoặc lượt của kết quả Bước 3`, "FIXTURE_DRAW_MISMATCH");
    }
  }
  if (regulation.competitionFormat === "KNOCKOUT") {
    const bracket = await listManagedKnockoutBracket(tournamentId);
    const assignments = new Map(draw.groups.flatMap((group) => group.assignments.map((item) => [item.position, item.teamId] as const)));
    for (const slot of bracket.filter((slot) => slot.roundNumber === 1)) {
      if (slot.homeTeamId !== (assignments.get(slot.position * 2 - 1) ?? null)
          || slot.awayTeamId !== (assignments.get(slot.position * 2) ?? null)) {
        throw new AppError(409, `Nhánh ${slot.position} không giữ đúng vị trí bốc thăm đã công bố`, "FIXTURE_DRAW_MISMATCH");
      }
    }
  }
  if (regulation.competitionFormat !== "KNOCKOUT") {
    if (groupCounts.some((count) => count < 2)) throw new AppError(409, "Mỗi bảng phải có tối thiểu hai đội", "INVALID_PUBLISHED_DRAW");
    const legs = rules.roundRobinLegs ?? 1;
    counts.GROUP = groupCounts.reduce((sum, count) => sum + (count * (count - 1) / 2) * legs, 0);
    stages.push("GROUP");
  }
  if (regulation.competitionFormat !== "ROUND_ROBIN") {
    const playoffTeams = regulation.competitionFormat === "KNOCKOUT"
      ? groupCounts.reduce((sum, count) => sum + count, 0)
      : groupCounts.length * rules.advancingTeamsPerGroup;
    if (!Number.isInteger(playoffTeams) || playoffTeams < 2 || playoffTeams > 32) {
      throw new AppError(409, "Số vị trí loại trực tiếp theo điều lệ phải từ 2 đến 32", "INVALID_PLAYOFF_FIELD_SIZE");
    }
    if (regulation.competitionFormat === "GROUP_AND_KNOCKOUT"
        && groupCounts.some((count) => count < rules.advancingTeamsPerGroup)) {
      throw new AppError(409, "Có bảng không đủ số đội theo số suất đi tiếp", "INVALID_ADVANCING_TEAMS");
    }
    const thirdPlace = Boolean(rules.competitionConfig?.thirdPlaceMatch);
    if (thirdPlace && playoffTeams < 4) throw new AppError(409, "Trận tranh hạng ba cần tối thiểu bốn đội", "THIRD_PLACE_REQUIRES_FOUR_TEAMS");
    counts.KNOCKOUT = playoffTeams - 1 + (thirdPlace ? 1 : 0);
    stages.push("KNOCKOUT");
  }
  return publishTournamentFixtureStructure(
    tournamentId,
    stages,
    draw.id,
    counts,
    regulation.regulationVersion,
    userId,
    validateOnly,
  );
}
