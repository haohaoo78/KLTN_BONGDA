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
  goalsAgainst?: number;
  won?: number;
  drawn?: number;
  lost?: number;
  rankingIssue?: string | null;
  tiedTeamIds?: string[];
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
  /** An explicit declaration is required; HEAD_TO_HEAD alone does not define a mini-table. */
  headToHeadPolicy?: string | null;
  teamIds?: string[];
}): QualifiedGroupTeam[] {
  const teamIds = input.teamIds ?? [...new Set(input.fixtures.flatMap((fixture) => [fixture.homeTeamId, fixture.awayTeamId]))];
  if (new Set(teamIds).size !== teamIds.length || teamIds.length < 2 || (input.fixtures.length !== teamIds.length * (teamIds.length - 1) / 2 && input.fixtures.length !== teamIds.length * (teamIds.length - 1) && !(input.preview && input.fixtures.length === 0))) {
    throw new AppError(409, "Lịch vòng bảng chưa đủ trận theo thể thức đã tạo", "GROUP_FIXTURES_INCOMPLETE");
  }
  if(input.fixtures.length){
    const legs=input.fixtures.length/(teamIds.length*(teamIds.length-1)/2),pairs=new Map<string,number>();
    for(const f of input.fixtures){if(f.homeTeamId===f.awayTeamId||!teamIds.includes(f.homeTeamId)||!teamIds.includes(f.awayTeamId))throw new AppError(409,'Trận không khớp thành phần bảng.','GROUP_FIXTURES_INCOMPLETE');const key=[f.homeTeamId,f.awayTeamId].sort().join(':');pairs.set(key,(pairs.get(key)??0)+1);}
    if(pairs.size!==teamIds.length*(teamIds.length-1)/2||[...pairs.values()].some(count=>count!==legs))throw new AppError(409,'Thiếu cặp đấu hoặc sai số lượt trong bảng.','GROUP_FIXTURES_INCOMPLETE');
  }
  if (!input.preview && input.fixtures.some((fixture) => !["VERIFIED", "LOCKED"].includes(fixture.status) || fixture.resultStatus !== "APPROVED")) {
    throw new AppError(409, "Chỉ chốt đội đi tiếp sau khi tất cả trận vòng bảng có kết quả chính thức", "GROUP_RESULTS_NOT_FINAL");
  }
  if (!Number.isInteger(input.advancingTeamsPerGroup) || input.advancingTeamsPerGroup < 1 || input.advancingTeamsPerGroup > teamIds.length) {
    throw new AppError(409, "Số đội đi tiếp mỗi bảng không hợp lệ với thành phần bảng", "INVALID_ADVANCING_TEAMS");
  }
  const table = new Map<string, TeamTable>(teamIds.map((teamId) => [teamId, {
    teamId, groupId: input.groupId, groupRank: 0, played: 0, points: 0, goalDifference: 0, goalsFor: 0,
    goalsAgainst: 0, won: 0, drawn: 0, lost: 0, rankingIssue: null,
    fairPlayPoints: input.fairPlayPoints?.[teamId] ?? 0,
  }]));
  const points = { win: input.pointsForWin, draw: input.pointsForDraw, loss: input.pointsForLoss };
  if (Object.values(points).some(value => !Number.isInteger(value) || value < 0) || !input.rankingCriteria.length || new Set(input.rankingCriteria).size !== input.rankingCriteria.length || input.rankingCriteria.some(value=>!['POINTS','GOAL_DIFFERENCE','GOALS_FOR','HEAD_TO_HEAD','FAIR_PLAY','LOT_DRAW'].includes(value))) throw new AppError(409, "Điều lệ chưa xác định cách tính điểm và thứ tự xếp hạng hợp lệ.", "STANDINGS_RULES_UNDEFINED");
  const finalFixtures = input.fixtures.filter((fixture) => ["VERIFIED", "LOCKED"].includes(fixture.status) && fixture.resultStatus === "APPROVED");
  for (const fixture of finalFixtures) {
    const home = table.get(fixture.homeTeamId)!;
    const away = table.get(fixture.awayTeamId)!;
    home.played += 1; away.played += 1;
    home.goalsFor += fixture.homeScore; away.goalsFor += fixture.awayScore;
    home.goalsAgainst! += fixture.awayScore; away.goalsAgainst! += fixture.homeScore;
    if (fixture.homeScore > fixture.awayScore) { home.won!++; away.lost!++; }
    else if (fixture.homeScore < fixture.awayScore) { away.won!++; home.lost!++; }
    else { home.drawn!++; away.drawn!++; }
    home.goalDifference += fixture.homeScore - fixture.awayScore;
    away.goalDifference += fixture.awayScore - fixture.homeScore;
    home.points += fixture.homeScore > fixture.awayScore ? points.win : fixture.homeScore === fixture.awayScore ? points.draw : points.loss;
    away.points += fixture.awayScore > fixture.homeScore ? points.win : fixture.homeScore === fixture.awayScore ? points.draw : points.loss;
  }
  let tiedGroups: TeamTable[][] = [[...table.values()]];
  const appliedLotDraws = new Set<string>();
  const unresolved = (group: TeamTable[], code: string, message: string) => {
    if (!input.preview) throw new AppError(409, message, code, { groupId: input.groupId, tiedTeamIds: group.map(t=>t.teamId) });
    group.forEach(team=>team.rankingIssue=message);
    return [group];
  };
  for (const criterion of input.rankingCriteria) {
    const blocked = tiedGroups.filter(group=>group.some(t=>t.rankingIssue));
    const active = tiedGroups.filter(group=>!group.some(t=>t.rankingIssue));
    const positions = [...tiedGroups];
    if (criterion === "POINTS") tiedGroups = splitByMetric(active, (team) => team.points);
    else if (criterion === "GOAL_DIFFERENCE") tiedGroups = splitByMetric(active, (team) => team.goalDifference);
    else if (criterion === "GOALS_FOR") tiedGroups = splitByMetric(active, (team) => team.goalsFor);
    else if (criterion === "HEAD_TO_HEAD") {
      tiedGroups = active.flatMap(group=>{
        if(group.length===1)return [group];
        const policies:Record<string,Array<"points"|"goalDifference"|"goalsFor">>={POINTS:["points"],GOAL_DIFFERENCE:["goalDifference"],GOALS_FOR:["goalsFor"],POINTS_GOAL_DIFFERENCE_GOALS_FOR:["points","goalDifference","goalsFor"]};
        const keys=policies[input.headToHeadPolicy??""];
        if(!keys)return unresolved(group,"HEAD_TO_HEAD_POLICY_REQUIRED","Điều lệ chưa xác định nội dung tiêu chí đối đầu.");
        const ids=new Set(group.map(t=>t.teamId)),meetings=input.fixtures.filter(f=>ids.has(f.homeTeamId)&&ids.has(f.awayTeamId));
        if(meetings.some(f=>!["VERIFIED","LOCKED"].includes(f.status)||f.resultStatus!=="APPROVED"))return unresolved(group,"HEAD_TO_HEAD_INCOMPLETE","Chưa đủ kết quả đối đầu chính thức; chưa áp dụng tiêu chí sau đối đầu.");
        let mini=[group];for(const key of keys)mini=splitByMetric(mini,t=>headToHeadMetric(t,group,finalFixtures,points,key));return mini;
      });
    } else if (criterion === "FAIR_PLAY") tiedGroups = active.flatMap(group=>group.length<2?[group]:group.some(t=>input.fairPlayPoints?.[t.teamId]==null)?unresolved(group,"FAIR_PLAY_POLICY_REQUIRED","Chưa đủ trọng số hoặc dữ liệu fair-play theo điều lệ."):splitByMetric([group],team=>team.fairPlayPoints,false));
    else if (criterion === "LOT_DRAW" && active.some((group) => group.length > 1)) {
      const tieKey = (teamIds: string[]) => [...teamIds].sort().join(":");
      tiedGroups = active.flatMap((group) => {
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
    } else tiedGroups=active;
    // Keep each prior equivalence class in place, including a class blocked by missing rules.
    const outputs=tiedGroups;
    tiedGroups=positions.flatMap(group=>blocked.includes(group)?[group]:outputs.filter(candidate=>candidate.some(team=>group.includes(team))));
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
    return group.map((team) => ({ ...team, groupRank: rank, ...(group.length>1?{tiedTeamIds:group.map(t=>t.teamId)}:{}) }));
  });
}
