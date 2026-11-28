import type { DemoFixture, DrawTestState } from "./drawTestStorage";

type Entrant = { teamId?: string; source?: string };
function knockoutRoundName(round: number, totalRounds: number, prefix = "") {
  const remaining = totalRounds - round;
  const name = remaining === 0 ? "Chung kết" : remaining === 1 ? "Bán kết" : remaining === 2 ? "Tứ kết" : `Vòng 1/${2 ** (remaining + 1)}`;
  return prefix ? `${prefix} · ${name}` : name;
}

/** Builds browser-only Step 4 fixtures from the immutable Step 3 test publication. */
export function generateDemoFixtures(state: DrawTestState): DemoFixture[] {
  const allocation = state.publication;
  if (!allocation) return [];
  const groups: string[][] = allocation.teamsPerGroup.map((capacity, groupIndex) => {
    const start = allocation.teamsPerGroup.slice(0, groupIndex).reduce((sum, value) => sum + value, 0);
    return allocation.slots.slice(start, start + capacity).filter((id): id is string => Boolean(id));
  });
  const fixtures: DemoFixture[] = [];
  if (allocation.format !== "KNOCKOUT") {
    groups.forEach((ids, groupIndex) => {
      const group = `Bảng ${String.fromCharCode(65 + groupIndex)}`;
      const field: Array<string | null> = [...ids];
      if (field.length % 2) field.push(null);
      const initialLength = field.length;
      const firstLeg: DemoFixture[] = [];
      for (let round = 0; round < initialLength - 1; round += 1) {
        for (let pair = 0; pair < initialLength / 2; pair += 1) {
          const home = field[pair]; const away = field[initialLength - 1 - pair];
          if (home && away) {
            const fixture = { id: `TEST-${groupIndex + 1}-R${round + 1}-L1-M${pair + 1}`, stage: "GROUP" as const, groupName: group, round: `${group} · Vòng ${round + 1}`, leg: 1, homeTeamId: home, awayTeamId: away };
            fixtures.push(fixture);
            firstLeg.push(fixture);
          }
        }
        const last = field.pop();
        if (last !== undefined) field.splice(1, 0, last);
      }
      if (state.configuration?.roundRobinLegs === 2) {
        firstLeg.forEach((match) => fixtures.push({ ...match, id: match.id.replace("L1", "L2"), round: `${group} · Vòng ${match.round.split("Vòng ")[1]} · Lượt 2`, leg: 2, homeTeamId: match.awayTeamId, awayTeamId: match.homeTeamId }));
      }
    });
  }
  if (allocation.format === "KNOCKOUT") {
    const byes = new Set(allocation.byePositions ?? []);
    let entrants: Entrant[] = allocation.slots.map((teamId, index) => byes.has(index) ? {} : { ...(teamId ? { teamId } : { source: `Vị trí P${index + 1}` }) });
    const totalRounds = Math.ceil(Math.log2(Math.max(2, entrants.length)));
    let round = 1;
    while (entrants.length > 1) {
      const winners: Entrant[] = [];
      for (let index = 0; index < entrants.length; index += 2) {
        const home = entrants[index] ?? {}; const away = entrants[index + 1] ?? {};
        if (home.teamId && !away.teamId && !away.source) { winners.push(home); continue; }
        if (away.teamId && !home.teamId && !home.source) { winners.push(away); continue; }
        if (!home.teamId && !home.source && !away.teamId && !away.source) { winners.push({}); continue; }
        const number = Math.floor(index / 2) + 1;
        const id = `TEST-KO-R${round}-M${number}`;
        fixtures.push({ id, stage: "KNOCKOUT", round: knockoutRoundName(round, totalRounds), homeTeamId: home.teamId ?? null, awayTeamId: away.teamId ?? null, homeSource: home.source, awaySource: away.source });
        winners.push({ source: `Thắng ${id}` });
      }
      entrants = winners; round += 1;
    }
    if (state.configuration?.thirdPlaceMatch) {
      const finalRound = Math.max(0, round - 1);
      const semiRound = finalRound - 1;
      const semifinals = fixtures.filter((fixture) => fixture.stage === "KNOCKOUT" && fixture.id.includes(`-R${semiRound}-`));
      if (semifinals.length === 2) fixtures.push({ id: `TEST-KO-THIRD-R${finalRound}-M1`, stage: "KNOCKOUT", round: "Tranh hạng ba", homeTeamId: null, awayTeamId: null, homeSource: `Thua ${semifinals[0].id}`, awaySource: `Thua ${semifinals[1].id}` });
    }
  }
  if (allocation.format === "GROUP_AND_KNOCKOUT") {
    const ranksForGroup = (groupIndex: number) => Array.from({ length: allocation.qualifiersPerGroup }, (_, index) => {
      const rank = index + 1;
      return { source: `${rank === 1 ? "Nhất" : rank === 2 ? "Nhì" : `Hạng ${rank}`} bảng ${String.fromCharCode(65 + groupIndex)}` };
    });
    let qualifierSources: Entrant[] = [];
    if ((state.configuration?.knockoutPairing === "GROUP_RANK" || state.configuration?.knockoutPairing === "FIXED_CROSSOVER") && allocation.qualifiersPerGroup === 2 && groups.length > 1 && groups.length % 2 === 0) {
      for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 2) {
        const first = ranksForGroup(groupIndex);
        const second = ranksForGroup(groupIndex + 1);
        qualifierSources.push(first[0], second[1], second[0], first[1]);
      }
    } else {
      groups.forEach((_, groupIndex) => qualifierSources.push(...ranksForGroup(groupIndex)));
    }
    for (let extra = 1; extra <= allocation.extraQualificationSlots; extra += 1) qualifierSources.push({ source: `Suất bổ sung ${extra} · chờ điều lệ xác định` });
    const bracketSize = qualifierSources.length > 1 ? 2 ** Math.ceil(Math.log2(qualifierSources.length)) : qualifierSources.length;
    let entrants = Array.from({ length: bracketSize }, (_, index) => qualifierSources[index] ?? {});
    const totalRounds = Math.ceil(Math.log2(Math.max(2, bracketSize)));
    let round = 1;
    while (entrants.length > 1) {
      const next: Entrant[] = [];
      for (let index = 0; index < entrants.length; index += 2) {
        const home = entrants[index] ?? {}; const away = entrants[index + 1] ?? {};
        if ((home.source || home.teamId) && !(away.source || away.teamId)) { next.push(home); continue; }
        if ((away.source || away.teamId) && !(home.source || home.teamId)) { next.push(away); continue; }
        if (!(home.source || home.teamId) && !(away.source || away.teamId)) { next.push({}); continue; }
        const number = Math.floor(index / 2) + 1;
        const id = `TEST-PO-R${round}-M${number}`;
        fixtures.push({ id, stage: "KNOCKOUT", round: knockoutRoundName(round, totalRounds, "Playoff"), homeTeamId: null, awayTeamId: null, homeSource: home.source ?? "Chờ xác định", awaySource: away.source ?? "Chờ xác định" });
        next.push({ source: `Thắng ${id}` });
      }
      entrants = next; round += 1;
    }
    if (state.configuration?.thirdPlaceMatch) {
      const finalRound = Math.max(0, round - 1);
      const semiRound = finalRound - 1;
      const semifinals = fixtures.filter((fixture) => fixture.stage === "KNOCKOUT" && fixture.id.includes(`-PO-R${semiRound}-`));
      if (semifinals.length === 2) fixtures.push({ id: `TEST-PO-THIRD-R${finalRound}-M1`, stage: "KNOCKOUT", round: "Tranh hạng ba", homeTeamId: null, awayTeamId: null, homeSource: `Thua ${semifinals[0].id}`, awaySource: `Thua ${semifinals[1].id}` });
    }
  }
  return fixtures;
}
