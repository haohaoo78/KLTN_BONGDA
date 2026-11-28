import { AppError } from "../lib/errors";

export type HybridRankingCriterion = "POINTS" | "GOAL_DIFFERENCE" | "GOALS_FOR" | "HEAD_TO_HEAD" | "FAIR_PLAY" | "LOT_DRAW";
export type GroupFixture = {
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
  status: string;
  resultStatus: string;
};
export type GroupLotDrawResolution = {
  tiedTeamIds: string[];
  drawnOrder: string[];
  witnessName: string;
  reason: string;
};
export type QualifiedGroupTeam = {
  teamId: string;
  groupId: string;
  groupRank: number;
  played: number;
  points: number;
  goalDifference: number;
  goalsFor: number;
};

/** Interleave qualifiers by group rank so the same-rank teams receive adjacent playoff seeds. */
export function selectHybridQualifiers(
  rankedByGroup: QualifiedGroupTeam[][],
  advancingTeamsPerGroup: number,
): QualifiedGroupTeam[] {
  if (!rankedByGroup.length || !Number.isInteger(advancingTeamsPerGroup) || advancingTeamsPerGroup < 1) {
    throw new AppError(409, "Cấu hình số đội đi tiếp mỗi bảng không hợp lệ", "INVALID_ADVANCING_TEAMS");
  }
  const selected: QualifiedGroupTeam[] = [];
  for (let rank = 1; rank <= advancingTeamsPerGroup; rank += 1) {
    for (const group of rankedByGroup) {
      const team = group.find((candidate) => candidate.groupRank === rank);
      if (!team) {
        throw new AppError(409, "Không đủ đội trong một hoặc nhiều bảng theo cấu hình đi tiếp", "INVALID_ADVANCING_TEAMS");
      }
      selected.push(team);
    }
  }
  if (new Set(selected.map((team) => team.teamId)).size !== selected.length) {
    throw new AppError(409, "Một đội xuất hiện ở nhiều bảng; không thể tạo nhánh playoff", "DUPLICATE_QUALIFIED_TEAM");
  }
  return selected;
}

type TeamTable = QualifiedGroupTeam & { fairPlayPoints: number };

function splitByMetric(
  groups: TeamTable[][],
  metric: (team: TeamTable, tiedTeams: TeamTable[]) => number,
  higherIsBetter = true,
): TeamTable[][] {
  return groups.flatMap((group) => {
    const byValue = new Map<number, TeamTable[]>();
    for (const team of group) {
      const value = metric(team, group);
      const entries = byValue.get(value) ?? [];
      entries.push(team);
      byValue.set(value, entries);
    }
    return [...byValue.entries()]
      .sort(([left], [right]) => higherIsBetter ? right - left : left - right)
      .map(([, entries]) => entries);
  });
}

function headToHeadMetric(team: TeamTable, tied: TeamTable[], fixtures: GroupFixture[], points: { win: number; draw: number; loss: number }, key: "points" | "goalDifference" | "goalsFor"): number {
  const teamIds = new Set(tied.map((item) => item.teamId));
  let value = 0;
  for (const fixture of fixtures) {
    if (!teamIds.has(fixture.homeTeamId) || !teamIds.has(fixture.awayTeamId)) continue;
    if (fixture.homeTeamId !== team.teamId && fixture.awayTeamId !== team.teamId) continue;
    const homeIsTeam = fixture.homeTeamId === team.teamId;
    const own = homeIsTeam ? fixture.homeScore : fixture.awayScore;
    const opponent = homeIsTeam ? fixture.awayScore : fixture.homeScore;
    if (key === "goalsFor") value += own;
    else if (key === "goalDifference") value += own - opponent;
    else value += own > opponent ? points.win : own === opponent ? points.draw : points.loss;
  }
  return value;
}

export function rankHybridGroup(input: {
  groupId: string;
  fixtures: GroupFixture[];
  advancingTeamsPerGroup: number;
  rankingCriteria: HybridRankingCriterion[];
  pointsForWin: number;
  pointsForDraw: number;
  pointsForLoss: number;
  fairPlayPoints?: Record<string, number>;
  lotDrawResolutions?: GroupLotDrawResolution[];
  /** Read-only standings may include unfinished matches; qualification remains strict. */
  preview?: boolean;
}): QualifiedGroupTeam[] {
  const teamIds = [...new Set(input.fixtures.flatMap((fixture) => [fixture.homeTeamId, fixture.awayTeamId]))];
  if (teamIds.length < 2 || input.fixtures.length !== teamIds.length * (teamIds.length - 1) / 2 && input.fixtures.length !== teamIds.length * (teamIds.length - 1)) {
    throw new AppError(409, "Lịch vòng bảng chưa đủ trận theo thể thức đã tạo", "GROUP_FIXTURES_INCOMPLETE");
  }
  if (!input.preview && input.fixtures.some((fixture) => !["VERIFIED", "LOCKED"].includes(fixture.status) || fixture.resultStatus !== "APPROVED")) {
    throw new AppError(409, "Chỉ chốt đội đi tiếp sau khi tất cả trận vòng bảng có kết quả được BTC duyệt", "GROUP_RESULTS_NOT_FINAL");
  }
  if (!Number.isInteger(input.advancingTeamsPerGroup) || input.advancingTeamsPerGroup < 1 || input.advancingTeamsPerGroup > teamIds.length) {
    throw new AppError(409, "Số đội đi tiếp mỗi bảng không hợp lệ với thành phần bảng", "INVALID_ADVANCING_TEAMS");
  }
  const table = new Map<string, TeamTable>(teamIds.map((teamId) => [teamId, {
    teamId, groupId: input.groupId, groupRank: 0, played: 0, points: 0, goalDifference: 0, goalsFor: 0,
    fairPlayPoints: input.fairPlayPoints?.[teamId] ?? 0,
  }]));
  const points = { win: input.pointsForWin, draw: input.pointsForDraw, loss: input.pointsForLoss };
  const finalFixtures = input.fixtures.filter((fixture) => ["VERIFIED", "LOCKED"].includes(fixture.status) && fixture.resultStatus === "APPROVED");
  for (const fixture of finalFixtures) {
    const home = table.get(fixture.homeTeamId)!;
    const away = table.get(fixture.awayTeamId)!;
    home.played += 1; away.played += 1;
    home.goalsFor += fixture.homeScore; away.goalsFor += fixture.awayScore;
    home.goalDifference += fixture.homeScore - fixture.awayScore;
    away.goalDifference += fixture.awayScore - fixture.homeScore;
    home.points += fixture.homeScore > fixture.awayScore ? points.win : fixture.homeScore === fixture.awayScore ? points.draw : points.loss;
    away.points += fixture.awayScore > fixture.homeScore ? points.win : fixture.homeScore === fixture.awayScore ? points.draw : points.loss;
  }
  let tiedGroups: TeamTable[][] = [[...table.values()]];
  const appliedLotDraws = new Set<string>();
  for (const criterion of input.rankingCriteria) {
    if (criterion === "POINTS") tiedGroups = splitByMetric(tiedGroups, (team) => team.points);
    else if (criterion === "GOAL_DIFFERENCE") tiedGroups = splitByMetric(tiedGroups, (team) => team.goalDifference);
    else if (criterion === "GOALS_FOR") tiedGroups = splitByMetric(tiedGroups, (team) => team.goalsFor);
    else if (criterion === "HEAD_TO_HEAD") {
      tiedGroups = splitByMetric(tiedGroups, (team, tied) => headToHeadMetric(team, tied, finalFixtures, points, "points"));
      tiedGroups = splitByMetric(tiedGroups, (team, tied) => headToHeadMetric(team, tied, finalFixtures, points, "goalDifference"));
      tiedGroups = splitByMetric(tiedGroups, (team, tied) => headToHeadMetric(team, tied, finalFixtures, points, "goalsFor"));
    } else if (criterion === "FAIR_PLAY") tiedGroups = splitByMetric(tiedGroups, (team) => team.fairPlayPoints, false);
    else if (criterion === "LOT_DRAW" && tiedGroups.some((group) => group.length > 1)) {
      const tieKey = (teamIds: string[]) => [...teamIds].sort().join(":");
      tiedGroups = tiedGroups.flatMap((group) => {
        if (group.length < 2) return [group];
        const tiedTeamIds = group.map((team) => team.teamId);
        const key = tieKey(tiedTeamIds);
        const resolution = input.lotDrawResolutions?.find((candidate) => tieKey(candidate.tiedTeamIds) === key);
        if (!resolution) {
          if (input.preview) return [group];
          throw new AppError(
            409,
            "Thứ hạng còn hòa; cần lập biên bản bốc thăm có người chứng kiến trước khi tạo nhánh",
            "GROUP_LOT_DRAW_REQUIRED",
            { groupId: input.groupId, tiedTeamIds },
          );
        }
        const drawnOrder = resolution.drawnOrder;
        const validOrder = drawnOrder.length === tiedTeamIds.length
          && new Set(drawnOrder).size === tiedTeamIds.length
          && tiedTeamIds.every((teamId) => drawnOrder.includes(teamId));
        const reason = resolution.reason.trim();
        const witnessName = resolution.witnessName.trim();
        if (!validOrder || reason.length < 10 || reason.length > 1000 || witnessName.length < 2 || witnessName.length > 120) {
          throw new AppError(400, "Thứ tự bốc thăm phải đúng các đội hòa; cần họ tên người chứng kiến và biên bản từ 10 đến 1000 ký tự", "INVALID_GROUP_LOT_DRAW");
        }
        appliedLotDraws.add(key);
        const orderIndex = new Map(drawnOrder.map((teamId, index) => [teamId, index]));
        return group.sort((left, right) => orderIndex.get(left.teamId)! - orderIndex.get(right.teamId)!).map((team) => [team]);
      });
    }
  }
  if (!input.preview && (input.lotDrawResolutions?.length ?? 0) !== appliedLotDraws.size) {
    throw new AppError(409, "Có biên bản bốc thăm không khớp với nhóm đội đang hòa theo bảng xếp hạng", "UNMATCHED_GROUP_LOT_DRAW");
  }
  if (!input.preview && tiedGroups.some((group) => group.length > 1)) {
    throw new AppError(409, "Thứ hạng bảng vẫn hòa theo điều lệ; chưa thể xác định đội đi tiếp", "GROUP_STANDINGS_TIE");
  }
  let position = 1;
  return tiedGroups.flatMap((group) => {
    const rank = group.length === 1 ? position : 0;
    position += group.length;
    return group.map((team) => ({ ...team, groupRank: rank }));
  });
}
