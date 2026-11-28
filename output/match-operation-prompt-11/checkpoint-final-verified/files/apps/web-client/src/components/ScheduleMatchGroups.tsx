import type { ReactNode } from "react";
import type { DemoFixture } from "@sfl/shared";

/** Shared presentational groups; scheduling and referee selection own their actions/data. */
export function ScheduleMatchGroups({ groups, columns, renderRow, empty = "Không có trận phù hợp bộ lọc." }: {
  groups: Array<{ key: string; title: string; fixtures: DemoFixture[] }>;
  columns: ReactNode; renderRow: (fixture: DemoFixture) => ReactNode; empty?: string;
}) {
  return <div className="step5-ws-match-groups">{groups.map((group) => <details className="step5-ws-match-group" key={group.key} open><summary><strong>{group.title}</strong><span>{group.fixtures.length} trận</span></summary><div className="step5-ws-table-wrap"><table><thead><tr>{columns}</tr></thead><tbody>{group.fixtures.map(renderRow)}</tbody></table></div></details>)}{!groups.length ? <div className="step5-empty-view">{empty}</div> : null}</div>;
}
