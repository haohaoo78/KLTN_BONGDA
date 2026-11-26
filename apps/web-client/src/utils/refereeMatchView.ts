import type { DemoFixture } from "@sfl/shared";

export function refereeFixtureCaption(fixture: DemoFixture): string {
  const round = fixture.round || `Vòng ${fixture.roundNumber ?? 1}`;
  const group = fixture.groupName && !round.toLocaleLowerCase("vi").includes(fixture.groupName.toLocaleLowerCase("vi")) ? `${fixture.groupName} · ` : "";
  return `${group}${round}${fixture.leg && !/lượt/i.test(round) ? ` · Lượt ${fixture.leg}` : ""}`;
}

export function groupRefereeMatches(fixtures: DemoFixture[], format: string) {
  const groups = new Map<string, { key: string; title: string; fixtures: DemoFixture[]; phase: number; round: number; leg: number; group: string }>();
  for (const fixture of fixtures) {
    const phase = fixture.stage === "GROUP" ? 0 : 1, group = fixture.groupName ?? "", leg = fixture.leg ?? 1;
    const round = fixture.roundNumber ?? 1;
    const rawRound = fixture.round || `Vòng ${round}`;
    const roundLabel = group && rawRound.toLocaleLowerCase("vi").startsWith(group.toLocaleLowerCase("vi")) ? rawRound.slice(group.length).replace(/^[\s·—-]+/, "") : rawRound;
    const title = fixture.stage === "KNOCKOUT" ? `Loại trực tiếp · ${roundLabel}`
      : `${format === "GROUP_AND_KNOCKOUT" ? "Vòng bảng · " : ""}${group ? `${group} · ` : ""}${roundLabel}${fixture.leg && !/lượt/i.test(roundLabel) ? ` · Lượt ${leg}` : ""}`;
    const key = `${phase}:${group}:${leg}:${round}`;
    const entry = groups.get(key) ?? { key, title, fixtures: [], phase, round, leg, group };
    entry.fixtures.push(fixture); groups.set(key, entry);
  }
  return [...groups.values()].sort((left, right) => left.phase - right.phase || left.group.localeCompare(right.group, "vi", { numeric: true }) || left.leg - right.leg || left.round - right.round);
}

export const refereeMatchDate = (value: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(value));
export const refereeMatchTime = (value: string) => new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
