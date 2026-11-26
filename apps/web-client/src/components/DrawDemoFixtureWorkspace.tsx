import { useEffect, useMemo, useRef, useState } from "react";
import { getDrawManagement, type DrawCandidate, type FixtureStanding } from "../api/competition";
import { useDialog } from "./DialogProvider";
import { Modal } from "./Modal";
import { commitDrawTestState, emptyDrawTestState, readDrawTestState, resetDrawTestRun, subscribeDrawTestState, writeDrawTestState, type DemoFixture, type DemoScheduleEntry, type DrawTestState } from "../utils/drawTestStorage";
import { generateDemoFixtures } from "../utils/drawDemoFixtures";

export type OfficialFixtureData = {
  busy: boolean; error: string | null; check: { valid: boolean; messages: string[] } | null;
  legs: 1 | 2; matchCount: number; canGenerate: boolean; canQualify: boolean; championTeamId?: string;
  details: Record<string, { position?: number; homeSourceId?: string; awaySourceId?: string; status?: string; result?: { homeScore: number; awayScore: number } }>;
  standings: Record<string, FixtureStanding[]>; qualifiers: Record<string, Record<number, string>>;
  onGenerate: () => Promise<void>; onCheck: () => Promise<boolean>; onPublish: () => Promise<void>; onRefresh: () => Promise<void>;
  onContinue?: () => void | Promise<void>; onQualify: () => Promise<void>;
};
type Props = { tournamentId: string; tournamentName: string; onReset?: () => void; onNotice?: (message: string) => void; onFixtureSelect?: (fixture: DemoFixture) => void; closeGroupOnFixtureSelect?: boolean; selectedFixtureId?: string; editingFixtureId?: string; schedulePublished?: boolean; fixtureFilter?: (fixture: DemoFixture) => boolean; diagramOnly?: boolean; scheduleByFixture?: Record<string, DemoScheduleEntry>; scheduleDisplayByFixture?: Record<string, { endLabel: string; venueName: string; status: "LOCKED" | "SCHEDULED" | "PROPOSED" | "UNSCHEDULED" }>; scheduleIssuesByFixture?: Record<string, string[]>; refereeDisplayByFixture?: Record<string, { status: string; assigned: number; required: number; published: boolean; tone?: "unassigned" | "partial" | "complete" | "conflict" | "published"; importance?: string }>; readOnly?: boolean; officialMode?: boolean; publishedState?: DrawTestState; teams?: DrawCandidate[]; officialData?: OfficialFixtureData };
type StageFilter = "ALL" | "GROUP" | "KNOCKOUT";
const roundNumber = (fixture: DemoFixture) => fixture.roundNumber ?? Number(fixture.id.match(/-R(\d+)-/)?.[1] ?? fixture.round.match(/Vòng (\d+)/)?.[1] ?? 1);
const groupLetter = (name?: string) => name?.replace("Bảng ", "") ?? "";

export function DrawDemoFixtureWorkspace({ tournamentId, tournamentName, onReset, onNotice, onFixtureSelect, closeGroupOnFixtureSelect = false, selectedFixtureId, editingFixtureId, schedulePublished = false, fixtureFilter, diagramOnly = false, scheduleByFixture, scheduleDisplayByFixture, scheduleIssuesByFixture, refereeDisplayByFixture, readOnly = false, officialMode = false, publishedState, teams: suppliedTeams, officialData }: Props) {
  const { confirm } = useDialog();
  const [state, setState] = useState(() => readOnly ? publishedState ?? emptyDrawTestState(tournamentId) : readDrawTestState(tournamentId));
  const [teams, setTeams] = useState<DrawCandidate[]>(suppliedTeams ?? []);
  const [teamsError, setTeamsError] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<StageFilter>("ALL");
  const [groupFilter, setGroupFilter] = useState("ALL");
  const [roundFilter, setRoundFilter] = useState("ALL");
  const [legFilter, setLegFilter] = useState<"ALL" | "1" | "2">("ALL");
  const [scheduleDateFilter, setScheduleDateFilter] = useState("ALL");
  const [scheduleVenueFilter, setScheduleVenueFilter] = useState("ALL");
  const [scheduleStatusFilter, setScheduleStatusFilter] = useState("ALL");
  const [refereeStatusFilter, setRefereeStatusFilter] = useState("ALL");
  const [selectedGroup, setSelectedGroup] = useState("");
  const [selectedRound, setSelectedRound] = useState(1);
  const [viewMode, setViewMode] = useState<"PAIRINGS" | "ALL_ROUNDS">("PAIRINGS");
  const [selectedFixture, setSelectedFixture] = useState<DemoFixture | null>(null);
  const [groupTab, setGroupTab] = useState<"TEAMS" | "ROUNDS" | "STANDINGS" | "QUALIFIERS">("TEAMS");
  const [groupDetailOpen, setGroupDetailOpen] = useState(false);
  const [zoom, setZoom] = useState(100);
  const diagramRef = useRef<HTMLDivElement>(null);
  const [fullScreen, setFullScreen] = useState(false);

  useEffect(() => {
    if (readOnly) {
      setState(publishedState ?? emptyDrawTestState(tournamentId));
      return;
    }
    return subscribeDrawTestState(tournamentId, () => setState(readDrawTestState(tournamentId)));
  }, [publishedState, readOnly, tournamentId]);
  useEffect(() => {
    if (suppliedTeams) { setTeams(suppliedTeams); setTeamsError(""); return; }
    let active = true;
    setTeamsError("");
    void getDrawManagement(tournamentId).then((result) => { if (active) setTeams(result.eligibleTeams); }).catch((error: unknown) => {
      if (!active) return;
      setTeams([]);
      setTeamsError(error instanceof Error ? error.message : "Không tải được danh sách đội từ Tournament Service.");
    });
    return () => { active = false; };
  }, [suppliedTeams, tournamentId]);
  useEffect(() => {
    if (readOnly || !state.publication) return;
    const fixtures = generateDemoFixtures(state);
    if (JSON.stringify(fixtures) !== JSON.stringify(state.fixtures)) writeDrawTestState(tournamentId, { fixtures });
  }, [readOnly, state.publication, state.configuration, state.fixtures, tournamentId]);
  useEffect(() => {
    const listener = () => setFullScreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", listener);
    return () => document.removeEventListener("fullscreenchange", listener);
  }, []);

  const teamById = useMemo(() => new Map(teams.map((team) => [team.teamId, team])), [teams]);
  if (!state.publication) return <section className="panel workflow-phase-panel"><h2>Bước 4 · Sơ đồ thi đấu</h2>{teamsError ? <p className="form-error" role="alert">Không tải được dữ liệu đội: {teamsError}</p> : <p>{officialMode ? "Chưa có sơ đồ trận đã công bố từ Bước 3." : "Chưa có kết quả Bước 3 được công bố trong kịch bản thử nghiệm này."}</p>}</section>;
  const allocation = state.publication;
  const groups = allocation.teamsPerGroup.map((capacity, groupIndex) => {
    const start = allocation.teamsPerGroup.slice(0, groupIndex).reduce((sum, value) => sum + value, 0);
    return { name: `Bảng ${String.fromCharCode(65 + groupIndex)}`, ids: allocation.slots.slice(start, start + capacity).filter((id): id is string => Boolean(id)) };
  });
  const groupFixtures = state.fixtures.filter((item) => item.stage === "GROUP");
  const groupRounds = (name: string) => [...new Set(groupFixtures.filter((item) => item.groupName === name).map((item) => roundNumber(item)))].sort((a, b) => a - b);
  const filteredFixtures = state.fixtures.filter((item) => {
    const names = [teamById.get(item.homeTeamId ?? "")?.name, teamById.get(item.awayTeamId ?? "")?.name, item.id, item.homeSource, item.awaySource].join(" ").toLocaleLowerCase("vi");
    const matchesGroup = groupFilter === "ALL" || item.stage === "KNOCKOUT" || item.groupName === groupFilter;
    const entry = scheduleByFixture?.[item.id];
    const display = scheduleDisplayByFixture?.[item.id];
    const matchesDate = scheduleDateFilter === "ALL" || entry?.scheduledAt.slice(0, 10) === scheduleDateFilter;
    const matchesVenue = scheduleVenueFilter === "ALL" || display?.venueName === scheduleVenueFilter;
    const status = display?.status ?? (entry?.scheduledAt && entry.venue ? "SCHEDULED" : "UNSCHEDULED");
    const matchesScheduleStatus = scheduleStatusFilter === "ALL" || scheduleStatusFilter.startsWith("REF_") || status === scheduleStatusFilter;
    const refereeStatus = refereeDisplayByFixture?.[item.id];
    const matchesRefereeStatus = !refereeDisplayByFixture || refereeStatusFilter === "ALL" || (refereeStatusFilter === "UNASSIGNED" ? refereeStatus?.status === "Chưa phân công" : refereeStatusFilter === "DRAFT_PARTIAL" ? refereeStatus?.status === "Phân công nháp chưa đầy đủ" : refereeStatusFilter === "DRAFT_COMPLETE" ? refereeStatus?.status === "Phân công nháp đầy đủ" : refereeStatusFilter === "PUBLISHED" ? Boolean(refereeStatus?.published) : refereeStatus?.status === "Cần xác minh lại");
    return (!fixtureFilter || fixtureFilter(item)) && (!query || names.includes(query.toLocaleLowerCase("vi"))) && (stageFilter === "ALL" || item.stage === stageFilter) && matchesGroup && (roundFilter === "ALL" || roundNumber(item) === Number(roundFilter)) && (legFilter === "ALL" || String(item.leg ?? 1) === legFilter) && matchesDate && matchesVenue && matchesScheduleStatus && matchesRefereeStatus;
  });
  const visibleGroupFixtures = filteredFixtures.filter((item) => item.stage === "GROUP");
  const knockoutFixtures = filteredFixtures.filter((item) => item.stage === "KNOCKOUT");
  const visibleGroups = groups.filter((group) => groupFilter === "ALL" || group.name === groupFilter)
    .filter((group) => !query || visibleGroupFixtures.some((fixture) => fixture.groupName === group.name));
    const selectedGroupName = groupFilter !== "ALL"
      ? groupFilter
      : query && !visibleGroupFixtures.some((fixture) => fixture.groupName === selectedGroup)
        ? visibleGroups[0]?.name ?? selectedGroup ?? groups[0]?.name ?? ""
        : selectedGroup || groups[0]?.name || "";
    const selectedGroupData = groups.find((group) => group.name === selectedGroupName);
    const selectedGroupRoundNumbers = groupRounds(selectedGroupName);
    const selectedGroupLegs = [...new Set(groupFixtures.filter((item) => item.groupName === selectedGroupName).map((item) => item.leg ?? 1))].sort();
  const roundOptions = [...new Set(state.fixtures.map(roundNumber))].sort((a, b) => a - b);
  const scheduleDates = [...new Set(Object.values(scheduleByFixture ?? {}).filter((entry) => entry.scheduledAt).map((entry) => entry.scheduledAt.slice(0, 10)))].sort();
  const scheduleVenues = [...new Set(Object.values(scheduleDisplayByFixture ?? {}).filter((item) => item.status !== "UNSCHEDULED").map((item) => item.venueName))].sort();
  const fixtureCountByGroup = (groupName: string) => groupFixtures.filter((item) => item.groupName === groupName).length;
  const activeRound = roundFilter === "ALL" ? selectedRound : Number(roundFilter);
  const roundFixtures = visibleGroupFixtures.filter((item) => item.groupName === selectedGroupName && roundNumber(item) === activeRound && (legFilter === "ALL" || String(item.leg ?? 1) === legFilter));
  const idleTeam = selectedGroupData?.ids.find((id) => !groupFixtures.some((item) => item.groupName === selectedGroupName && roundNumber(item) === activeRound && (legFilter === "ALL" || String(item.leg ?? 1) === legFilter) && (item.homeTeamId === id || item.awayTeamId === id)));
  const groupAllRoundColumns = [...new Set(visibleGroupFixtures.filter((item) => item.groupName === selectedGroupName).map(roundNumber))].sort((a, b) => a - b).map((round) => ({ round, fixtures: visibleGroupFixtures.filter((item) => item.groupName === selectedGroupName && roundNumber(item) === round && (legFilter === "ALL" || String(item.leg ?? 1) === legFilter)) }));
  const format = allocation.format === "ROUND_ROBIN" ? "Vòng tròn" : allocation.format === "KNOCKOUT" ? "Loại trực tiếp" : "Kết hợp · vòng bảng + loại trực tiếp";
  const maximumRounds = Math.max(0, ...state.fixtures.map(roundNumber));
  const byes = Math.max(0, (allocation.slots.length || allocation.teamIds.length) - allocation.teamIds.length);

  async function publishFixtures() {
    if (state.fixturesPublishedAt || !state.fixtures.length) return;
    if (!await confirm({ title: "Công bố sơ đồ thi đấu thử nghiệm?", description: "Sơ đồ thử nghiệm được lưu trong kho kiểm thử phía máy chủ, tách khỏi dữ liệu giải chính thức; người xem chỉ nhận phần đã công bố.", confirmLabel: "Công bố sơ đồ" })) return;
    setBusy(true);
    const latest = readDrawTestState(tournamentId);
    try {
      await commitDrawTestState(tournamentId, {
        fixtures: generateDemoFixtures(latest),
        fixturesPublishedAt: new Date().toISOString(),
        completedSteps: { ...latest.completedSteps, step3: true, step4: true },
        currentStep: 6,
      });
      onNotice?.("Đã lưu sơ đồ thử nghiệm trên máy chủ; giao diện xem giải sẽ tải đúng phần đã công bố.");
    } catch (error) {
      onNotice?.(error instanceof Error ? `Không thể công bố do chưa lưu được snapshot máy chủ: ${error.message}` : "Không thể công bố sơ đồ vì chưa đồng bộ được snapshot máy chủ.");
    } finally { setBusy(false); }
  }
  async function reset() {
    if (!await confirm({ title: "Reset dữ liệu kiểm thử?", description: "Xóa snapshot kiểm thử riêng từ Bước 3 trở đi trên máy chủ, giữ cấu hình giải và đội đã chốt; không thay đổi các bảng nghiệp vụ chính thức.", confirmLabel: "Reset dữ liệu kiểm thử", danger: true })) return;
    resetDrawTestRun(tournamentId); onNotice?.("Đã xóa dữ liệu thử nghiệm và quay lại Bước 3."); onReset?.();
  }
  const teamCard = (teamId: string | null, source?: string, compact = false) => {
    const found = teamId ? teamById.get(teamId) : undefined;
    if (!found) return <div className={`draw-viz-team draw-viz-source${compact ? " is-compact" : ""}`}><span className="draw-viz-team-mark">↗</span><span><strong>{source ?? "Chờ xác định"}</strong><small>Nguồn đội · chưa thi đấu</small></span></div>;
    return <div className={`draw-viz-team${compact ? " is-compact" : ""}`}><span className="draw-viz-logo">{found.logoUrl ? <img src={found.logoUrl} alt="" /> : found.name.slice(0, 1)}</span><span><strong title={found.name}>{found.name}</strong><small title={found.institutionName ?? ""}>{found.institutionName ?? ""}</small></span></div>;
  };
  const matchCard = (fixture: DemoFixture, compact = false) => {
    const schedule = scheduleByFixture?.[fixture.id];
    const isScheduled = Boolean(schedule?.scheduledAt && schedule.venue.trim());
    const status = scheduleDisplayByFixture?.[fixture.id]?.status ?? (isScheduled ? "SCHEDULED" : "UNSCHEDULED");
    const scheduleIssues = scheduleIssuesByFixture?.[fixture.id] ?? [];
    const endLabel = scheduleDisplayByFixture?.[fixture.id]?.endLabel;
    const venueName = scheduleDisplayByFixture?.[fixture.id]?.venueName ?? schedule?.venue;
    const isEditing = editingFixtureId === fixture.id;
    const result = officialData?.details[fixture.id]?.result;
    const matchStatus = officialData?.details[fixture.id]?.status;
    const statusLabel = !scheduleByFixture ? fixture.bye ? "↗ BYE · không phải trận thi đấu" : result ? "✓ Kết quả chính thức" : matchStatus === "IN_PROGRESS" ? "⚽ Đang thi đấu" : matchStatus === "COMPLETED" ? "Chờ duyệt kết quả" : matchStatus === "CANCELLED" ? "Đã hủy" : "◷ Chưa thi đấu" : isEditing ? "🟠 Đang điều chỉnh · chưa lưu" : status === "LOCKED" ? schedulePublished ? "📣 Đã công bố · 🔒 Đã khóa" : "🔒 Đã khóa" : isScheduled ? schedulePublished ? "📣 Đã công bố · chưa khóa" : "Đã xếp · chưa khóa" : status === "PROPOSED" ? "🟠 Phương án · chưa lưu" : "🔴 Chưa xếp lịch";
    const dateLabel = isScheduled ? ` · ${new Date(schedule!.scheduledAt).toLocaleDateString("vi-VN")} · ${new Date(schedule!.scheduledAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}${endLabel ? `–${endLabel}` : ""}` : "";
    return <button key={fixture.id} type="button" style={officialMode ? { display: "block" } : undefined} className={`draw-viz-match${compact ? " is-compact" : ""}${isScheduled ? " is-scheduled" : ""}${status === "LOCKED" ? " is-schedule-locked" : ""}${status === "PROPOSED" ? " is-auto-proposed" : ""}${!isScheduled && scheduleByFixture ? " is-unscheduled" : ""}${isEditing ? " is-editing-fixture" : ""}${schedulePublished ? " is-published-fixture" : ""}${scheduleIssues.length ? " has-schedule-error" : ""}${selectedFixtureId === fixture.id ? " is-selected-fixture" : ""}`} onClick={() => { if (onFixtureSelect) { onFixtureSelect(fixture); if (closeGroupOnFixtureSelect) setGroupDetailOpen(false); } else setSelectedFixture(fixture); }} aria-label={`Chi tiết trận ${fixture.id}${statusLabel ? ` · ${statusLabel}` : ""}${scheduleIssues.length ? ` · ${scheduleIssues.length} vấn đề lịch` : ""}`}>
    <span className="draw-viz-match-meta"><b title={fixture.id}>{officialMode ? fixture.id.slice(0, 8).toUpperCase() : fixture.id}</b><small>{fixture.round}{fixture.leg ? ` · Lượt ${fixture.leg}` : ""}</small></span>
    {scheduleIssues.length ? <span className="draw-viz-schedule-error" title={scheduleIssues.join(" · ")}><b aria-hidden="true">!</b><span>{scheduleIssues.length} vấn đề lịch</span></span> : null}
    <span className="draw-viz-match-teams">{teamCard(fixture.homeTeamId, fixture.homeSource, true)}<em>VS</em>{teamCard(fixture.awayTeamId, fixture.awaySource, true)}</span>
    <span className="draw-viz-match-status"><span>{statusLabel}{dateLabel}</span><span>{scheduleByFixture ? isScheduled ? venueName : "Chưa chọn sân" : result ? `${result.homeScore} : ${result.awayScore}` : "— : —"}</span>{refereeDisplayByFixture?.[fixture.id] ? <span className={`draw-viz-referee-status${refereeDisplayByFixture[fixture.id].tone ? ` is-${refereeDisplayByFixture[fixture.id].tone}` : ""}${refereeDisplayByFixture[fixture.id].published ? " is-published" : refereeDisplayByFixture[fixture.id].status === "Cần xác minh lại" ? " needs-check" : ""}`}>{refereeDisplayByFixture[fixture.id].assigned}/{refereeDisplayByFixture[fixture.id].required} vị trí · {refereeDisplayByFixture[fixture.id].status}{refereeDisplayByFixture[fixture.id].importance ? ` · ${refereeDisplayByFixture[fixture.id].importance}` : ""}</span> : null}</span>
  </button>;
  };
  const knockoutRounds = [...new Set(knockoutFixtures.map(roundNumber))].sort((a, b) => a - b);
  const knockoutRoundLabel = (round: number) => {
    const games = (officialData ? state.fixtures.filter((item) => item.stage === "KNOCKOUT") : knockoutFixtures).filter((item) => roundNumber(item) === round);
    if (games.some((game) => game.round.includes("Chung kết"))) return "Chung kết";
    if (games.some((game) => game.round.includes("Bán kết"))) return "Bán kết";
    if (games.some((game) => game.round.includes("Tứ kết"))) return "Tứ kết";
    const teamCount = Math.max(2, games.length * 2);
    return `Vòng ${teamCount}`;
  };
  const winnerSources = (fixture: DemoFixture) => officialData ? [officialData.details[fixture.id]?.homeSourceId, officialData.details[fixture.id]?.awaySourceId].filter(Boolean) as string[] : [fixture.homeSource, fixture.awaySource].filter(Boolean) as string[];
  const treeStep = 180;
  const treeCardHeight = 146;
  const treeColumnWidth = 322;
  const treeColumnGap = 42;
  const treeHeight = Math.max(treeCardHeight, ((officialData ? state.fixtures.filter((item) => item.stage === "KNOCKOUT") : knockoutFixtures).filter((item) => roundNumber(item) === 1).length - 1) * treeStep + treeCardHeight);
  const sourceFixtureId = (source?: string) => source?.match(/(TEST-(?:KO|PO)-R\d+-M\d+|[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})/i)?.[1];
  const fixtureCenter = (fixture: DemoFixture) => {
    const roundIndex = Math.max(0, roundNumber(fixture) - 1);
    const index = (officialData?.details[fixture.id]?.position ?? 0) > 0 ? officialData!.details[fixture.id].position! - 1 : knockoutFixtures.filter((item) => roundNumber(item) === roundNumber(fixture)).findIndex((item) => item.id === fixture.id);
    return ((2 ** roundIndex) * index + ((2 ** roundIndex) - 1) / 2) * treeStep + treeCardHeight / 2;
  };
  const treeEdges = knockoutFixtures.flatMap((target) => [target.homeSource, target.awaySource].flatMap((source, side) => {
    const explicitId = side === 0 ? officialData?.details[target.id]?.homeSourceId : officialData?.details[target.id]?.awaySourceId;
    const parent = knockoutFixtures.find((fixture) => fixture.id === (explicitId ?? sourceFixtureId(source)));
    if (!parent) return [];
    const startX = (roundNumber(parent) - 1) * (treeColumnWidth + treeColumnGap) + treeColumnWidth - 16;
    const endX = (roundNumber(target) - 1) * (treeColumnWidth + treeColumnGap) + 2;
    const middleX = (startX + endX) / 2;
    return [{ key: `${parent.id}-${target.id}`, d: `M ${startX} ${fixtureCenter(parent)} H ${middleX} V ${fixtureCenter(target)} H ${endX}` }];
  }));
  const treeWidth = Math.max(treeColumnWidth, knockoutRounds.length * (treeColumnWidth + treeColumnGap) + 230);

  const knockoutTreeContent = <div className="draw-viz-knockout" style={{ "--round-count": Math.max(1, knockoutRounds.length), "--tree-width": `${treeWidth}px`, "--tree-height": `${treeHeight}px` } as React.CSSProperties}>
    {knockoutRounds.map((round) => {
      const roundGames = knockoutFixtures.filter((item) => roundNumber(item) === round);
      return <section className="draw-viz-ko-column" key={round}><h4>{knockoutRoundLabel(round)}<small>{roundGames.length} trận</small></h4><div className="draw-viz-ko-games">{roundGames.map((fixture, index) => { const top = fixtureCenter(fixture) - treeCardHeight / 2; return <div className="draw-viz-ko-game" key={fixture.id} style={{ top: `${top}px` }}>{matchCard(fixture, true)}</div>; })}</div></section>;
    })}
    {knockoutRounds.length > 0 ? <section className="draw-viz-champion"><div className="draw-viz-trophy">🏆</div><strong>Nhà vô địch</strong><span>{officialData?.championTeamId ? teamById.get(officialData.championTeamId)?.name : "Chờ kết quả chính thức"}</span></section> : null}
    <svg className="draw-viz-connectors" aria-hidden="true" width={treeWidth} height={treeHeight} viewBox={`0 0 ${treeWidth} ${treeHeight}`}>{treeEdges.map((edge) => <path key={edge.key} d={edge.d} />)}</svg>
  </div>;
  const knockoutTree = <div className="draw-viz-scroll">{knockoutTreeContent}</div>;

  const tools = <div className="draw-viz-toolbar">
    <label className="draw-viz-search"><span>⌕</span><input value={query} onChange={(event) => { const value = event.target.value; setQuery(value); if (value.trim() && allocation.format !== "KNOCKOUT") setGroupTab("ROUNDS"); }} placeholder="Tìm tên đội hoặc mã trận" aria-label="Tìm tên đội hoặc mã trận" /></label>
    <select value={stageFilter} onChange={(event) => setStageFilter(event.target.value as StageFilter)} aria-label="Lọc giai đoạn"><option value="ALL">Tất cả giai đoạn</option><option value="GROUP">Vòng bảng</option><option value="KNOCKOUT">Loại trực tiếp</option></select>
    <select value={groupFilter} onChange={(event) => { setGroupFilter(event.target.value); if (event.target.value !== "ALL") setGroupTab("ROUNDS"); }} aria-label="Lọc bảng"><option value="ALL">Tất cả bảng</option>{groups.map((group) => <option key={group.name}>{group.name}</option>)}</select>
    <select value={roundFilter} onChange={(event) => { setRoundFilter(event.target.value); if (event.target.value !== "ALL" && allocation.format !== "KNOCKOUT") setGroupTab("ROUNDS"); }} aria-label="Lọc vòng"><option value="ALL">Tất cả vòng</option>{roundOptions.map((round) => <option key={round} value={round}>Vòng {round}</option>)}</select>
    {scheduleByFixture !== undefined ? <>
      <select value={scheduleDateFilter} onChange={(event) => setScheduleDateFilter(event.target.value)} aria-label="Lọc ngày thi đấu"><option value="ALL">Mọi ngày</option>{scheduleDates.map((date) => <option key={date} value={date}>{new Date(`${date}T12:00:00`).toLocaleDateString("vi-VN")}</option>)}</select>
      <select value={scheduleVenueFilter} onChange={(event) => setScheduleVenueFilter(event.target.value)} aria-label="Lọc sân"><option value="ALL">Mọi sân</option>{scheduleVenues.map((venue) => <option key={venue} value={venue}>{venue}</option>)}</select>
      <select value={scheduleStatusFilter.startsWith("REF_") ? "ALL" : scheduleStatusFilter} onChange={(event) => setScheduleStatusFilter(event.target.value)} aria-label="Lọc trạng thái lịch"><option value="ALL">Mọi trạng thái lịch</option><option value="UNSCHEDULED">Chưa lập lịch</option><option value="PROPOSED">Đề xuất chưa áp dụng</option><option value="SCHEDULED">Đã lập lịch</option><option value="LOCKED">Đã khóa lịch</option></select>
      {refereeDisplayByFixture ? <select value={refereeStatusFilter} onChange={(event) => setRefereeStatusFilter(event.target.value)} aria-label="Lọc trạng thái phân công"><option value="ALL">Mọi trạng thái trọng tài</option><option value="UNASSIGNED">Chưa phân công</option><option value="DRAFT_PARTIAL">Nháp chưa đầy đủ</option><option value="DRAFT_COMPLETE">Nháp đầy đủ</option><option value="RECHECK">Cần xác minh lại</option><option value="PUBLISHED">Đã công bố</option></select> : null}
    </> : null}
    <div className="draw-viz-zoom"><button type="button" aria-label="Thu nhỏ sơ đồ" onClick={() => setZoom((value) => Math.max(65, value - 10))}>−</button><span>{zoom}%</span><button type="button" aria-label="Phóng to sơ đồ" onClick={() => setZoom((value) => Math.min(140, value + 10))}>＋</button><button type="button" onClick={() => setZoom(100)}>Mặc định</button><button type="button" onClick={() => void (fullScreen ? document.exitFullscreen?.() : diagramRef.current?.requestFullscreen?.())}>{fullScreen ? "Thoát toàn màn hình" : "Toàn màn hình"}</button></div>
  </div>;

  return <section className={`draw-demo-fixture-workspace draw-fixture-visual-workspace${diagramOnly ? " step5-diagram-only" : ""}`} ref={allocation.format === "ROUND_ROBIN" ? diagramRef : undefined} aria-label={officialMode ? "Sơ đồ thi đấu chính thức" : "Sơ đồ thi đấu thử nghiệm"}>
    {!diagramOnly ? <header className="draw-demo-fixture-head"><div><span className="draw-dev-badge">{officialMode ? state.fixturesPublishedAt ? "SƠ ĐỒ ĐÃ CÔNG BỐ · CHỈ ĐỌC" : "BƯỚC 4 · BẢN NHÁP CHÍNH THỨC" : readOnly ? "SƠ ĐỒ ĐÃ CÔNG BỐ · CHỈ ĐỌC" : "BƯỚC 4 · TEST RIÊNG · LƯU SNAPSHOT MÁY CHỦ"}</span><h2>Sơ đồ thi đấu</h2><p>{tournamentName} · {format} · {allocation.teamIds.length} đội · Bước 3 đã công bố {new Date(allocation.publishedAt).toLocaleString("vi-VN")}</p></div>{officialData ? <button className="button button-secondary" type="button" disabled={officialData.busy} onClick={() => void officialData.onRefresh()}>Tải lại dữ liệu</button> : !readOnly ? <button className="button button-secondary" type="button" onClick={() => void reset()}>Reset dữ liệu kiểm thử</button> : null}</header> : null}
    {teamsError ? <p className="form-error" role="alert">Không tải được dữ liệu đội: {teamsError}</p> : null}
    {!diagramOnly ? <div className="draw-demo-fixture-summary"><article><strong>{allocation.teamIds.length}</strong><span>Tổng số đội</span></article>{groups.length ? <article><strong>{groups.length}</strong><span>Bảng đấu</span></article> : null}<article><strong>{maximumRounds}</strong><span>Vòng đấu tối đa</span></article><article><strong>{officialData?.matchCount ?? state.fixtures.length}</strong><span>Tổng số trận / nguồn trận</span></article>{allocation.format !== "KNOCKOUT" ? <article><strong>{allocation.format === "ROUND_ROBIN" ? allocation.teamsPerGroup.some((count) => count % 2) ? "1 / bảng" : "0" : allocation.qualifiersPerGroup * groups.length + allocation.extraQualificationSlots}</strong><span>{allocation.format === "ROUND_ROBIN" ? "BYE mỗi vòng" : "Suất đi tiếp"}</span></article> : <article><strong>{byes}</strong><span>Suất BYE</span></article>}<article><strong>{allocation.format === "KNOCKOUT" ? "1" : allocation.format === "ROUND_ROBIN" ? (officialData?.legs ?? state.configuration?.roundRobinLegs ?? 1) : (officialData?.legs ?? state.configuration?.roundRobinLegs ?? 1)}</strong><span>Lượt đấu</span></article></div> : null}
    {officialData?.error ? <p className="form-error" role="alert">{officialData.error}</p> : null}
    {officialData?.check ? <div className={`fixture-check-result ${officialData.check.valid ? "is-valid" : "is-invalid"}`} role="status"><strong>{officialData.check.valid ? "Cấu trúc hợp lệ" : "Cần kiểm tra cấu trúc"}</strong>{officialData.check.messages.map((message) => <span key={message}>{message}</span>)}</div> : null}
    {tools}
    <div className="draw-viz-legend"><span><i className="draw-viz-legend-team" />Đội đã phân bổ</span><span><i className="draw-viz-legend-source" />Nguồn đội chưa xác định</span><span><i className="draw-viz-legend-line" />Quan hệ trận đấu</span><span><i className="draw-viz-legend-wait" />Chưa thi đấu</span></div>

    {allocation.format === "KNOCKOUT" && stageFilter !== "GROUP" ? <section className="draw-viz-section"><div className="draw-viz-section-title"><div><h3>Cây thi đấu loại trực tiếp</h3><p>Nhánh được sắp từ vòng đầu đến chung kết; nguồn thắng nối theo mã trận.</p></div></div><div className="draw-viz-canvas" ref={diagramRef} style={{ "--diagram-zoom": zoom / 100 } as React.CSSProperties}>{knockoutTree}</div>{!knockoutFixtures.length ? <p className="draw-viz-empty">Không có trận khớp bộ lọc.</p> : null}</section> : null}

    {allocation.format !== "KNOCKOUT" && stageFilter !== "KNOCKOUT" ? <section className="draw-viz-section"><div className="draw-viz-section-title"><div><h3>{allocation.format === "ROUND_ROBIN" ? "Sơ đồ bảng đấu" : "Sơ đồ vòng bảng & suất đi tiếp"}</h3><p>Từ {allocation.teamIds.length} đội chính thức đến các bảng; vị trí không đại diện cho thứ hạng.</p></div></div>
      <div className="draw-viz-scroll"><div className="draw-viz-group-flow">
        <div className="draw-viz-team-origin"><strong>{allocation.teamIds.length}</strong><span>Đội chính thức</span></div>
        <div className="draw-viz-groups-grid">
          {visibleGroups.map((group) => {
            const card = <button className={`draw-viz-group-card${selectedGroupName === group.name ? " is-selected" : ""}`} key={group.name} onClick={() => { setSelectedGroup(group.name); setSelectedRound(1); setGroupTab("TEAMS"); }} type="button"><header><strong>{group.name}</strong><span>{group.ids.length} đội</span></header><div className="draw-viz-group-team-list">{group.ids.map((id, index) => <div key={id}><b>{groupLetter(group.name)}{index + 1}</b>{teamCard(id, undefined, true)}</div>)}</div><footer>{groupRounds(group.name).length} vòng · {fixtureCountByGroup(group.name)} trận{allocation.format === "GROUP_AND_KNOCKOUT" ? ` · ${allocation.qualifiersPerGroup} suất đi tiếp` : ""}</footer></button>;
            const detailsButton = <button type="button" className="button button-secondary draw-viz-group-details-button" onClick={() => { setSelectedGroup(group.name); setSelectedRound(1); setGroupTab("TEAMS"); setGroupDetailOpen(true); }}>Xem chi tiết</button>;
            if (allocation.format !== "GROUP_AND_KNOCKOUT") return <div className="draw-viz-group-card-wrap" key={group.name}>{card}{detailsButton}</div>;

            const sourceGroupName = group.name.replace(/^Bảng\s*/, "bảng ");
            return <div className="draw-viz-group-pathway" key={group.name}>
              <div className="draw-viz-group-card-wrap">{card}{detailsButton}</div>
              <div className="draw-viz-group-qualifiers" aria-label={`Suất đi tiếp ${group.name}`} style={{ "--qualifier-count": Math.max(1, allocation.qualifiersPerGroup) } as React.CSSProperties}>
                {Array.from({ length: allocation.qualifiersPerGroup }, (_, rankIndex) => {
                  const rank = rankIndex + 1;
                  const label = `${rank === 1 ? "Nhất" : rank === 2 ? "Nhì" : `Hạng ${rank}`} ${sourceGroupName}`;
                  return <article className="draw-viz-group-qualifier" key={label}><span>{rank}</span><strong>{label}</strong><small>{officialData?.qualifiers[group.name]?.[rank] ? teamById.get(officialData.qualifiers[group.name][rank])?.name : "Chờ kết quả vòng bảng"}</small></article>;
                })}
              </div>
            </div>;
          })}
          {!visibleGroups.length ? <p className="draw-viz-empty">Không có bảng phù hợp bộ lọc hiện tại.</p> : null}
        </div>
        {allocation.format === "GROUP_AND_KNOCKOUT" && allocation.extraQualificationSlots > 0 ? <section className="draw-viz-extra-qualifiers"><h4>Suất đi tiếp bổ sung theo điều lệ</h4><div>{Array.from({ length: allocation.extraQualificationSlots }, (_, index) => <article key={index}><strong>Suất bổ sung {index + 1}</strong><small>Chờ điều lệ xác định</small></article>)}</div></section> : null}
      </div></div>
    </section> : null}

    {allocation.format !== "KNOCKOUT" && selectedGroupData && stageFilter !== "KNOCKOUT" ? <Modal open={groupDetailOpen} title={`${selectedGroupName} · Chi tiết`} description={`${selectedGroupData.ids.length} đội · ${fixtureCountByGroup(selectedGroupName)} trận`} eyebrow="CHI TIẾT BẢNG ĐẤU" className="draw-viz-group-detail-modal" onClose={() => setGroupDetailOpen(false)}><section className="draw-viz-section draw-viz-group-detail"><div className="draw-viz-section-title"><div><h3>{selectedGroupName} · Chi tiết</h3><p>{selectedGroupData.ids.length} đội · {fixtureCountByGroup(selectedGroupName)} trận được sinh từ vị trí phân bổ</p></div><div className="draw-viz-detail-tabs" role="tablist" aria-label="Chi tiết bảng">{([["TEAMS", "Đội bóng"], ["ROUNDS", "Vòng đấu"], ["STANDINGS", "BXH"], ["QUALIFIERS", "Đi tiếp"]] as const).map(([key, label]) => <button type="button" role="tab" aria-selected={groupTab === key} className={groupTab === key ? "is-active" : ""} key={key} onClick={() => setGroupTab(key)}>{label}</button>)}</div></div>
    {groupTab === "TEAMS" ? <div className="draw-viz-roster-grid">{selectedGroupData.ids.map((id, index) => <article key={id}><b>{groupLetter(selectedGroupName)}{index + 1}</b>{teamCard(id)}</article>)}</div> : null}
    {groupTab === "ROUNDS" ? <>
      <div className="draw-viz-round-controls"><button type="button" disabled={selectedGroupRoundNumbers.indexOf(selectedRound) <= 0} onClick={() => setSelectedRound((round) => selectedGroupRoundNumbers[Math.max(0, selectedGroupRoundNumbers.indexOf(round) - 1)] ?? 1)}>← Vòng trước</button><div className="draw-viz-round-track" aria-label="Hành trình vòng đấu">{selectedGroupRoundNumbers.map((round, index) => <span key={round}><button type="button" className={selectedRound === round ? "is-active" : ""} onClick={() => setSelectedRound(round)}>Vòng {round}<small>{groupFixtures.filter((item) => item.groupName === selectedGroupName && roundNumber(item) === round).length} trận</small></button>{index < selectedGroupRoundNumbers.length - 1 ? <i>→</i> : null}</span>)}</div><button type="button" disabled={selectedGroupRoundNumbers.indexOf(selectedRound) >= selectedGroupRoundNumbers.length - 1} onClick={() => setSelectedRound((round) => selectedGroupRoundNumbers[Math.min(selectedGroupRoundNumbers.length - 1, selectedGroupRoundNumbers.indexOf(round) + 1)] ?? round)}>Vòng tiếp →</button></div>
      {selectedGroupLegs.length > 1 ? <div className="draw-viz-leg-toggle"><span>Lượt đấu</span>{selectedGroupLegs.map((leg) => <button type="button" className={legFilter === String(leg) ? "is-active" : ""} key={leg} onClick={() => setLegFilter(String(leg) as "1" | "2")}>Lượt {leg}</button>)}<button type="button" className={legFilter === "ALL" ? "is-active" : ""} onClick={() => setLegFilter("ALL")}>Cả hai lượt</button></div> : null}
      <div className="draw-viz-mode-toggle"><button type="button" className={viewMode === "PAIRINGS" ? "is-active" : ""} onClick={() => setViewMode("PAIRINGS")}>Sơ đồ ghép cặp</button><button type="button" className={viewMode === "ALL_ROUNDS" ? "is-active" : ""} onClick={() => setViewMode("ALL_ROUNDS")}>Toàn bộ vòng đấu</button></div>
      {viewMode === "PAIRINGS" ? <div className="draw-viz-pairing-list">{roundFixtures.map((fixture) => <div className="draw-viz-pairing-row" key={fixture.id}>{teamCard(fixture.homeTeamId, fixture.homeSource)}<span className="draw-viz-match-connector" aria-hidden="true" /><div className="draw-viz-pairing-match">{matchCard(fixture)}</div><span className="draw-viz-match-connector" aria-hidden="true" />{teamCard(fixture.awayTeamId, fixture.awaySource)}</div>)}{idleTeam ? <div className="draw-viz-idle">⏸ Nghỉ vòng này: {teamCard(idleTeam)}</div> : null}{!roundFixtures.length ? <p className="draw-viz-empty">Không có cặp đấu khớp bộ lọc.</p> : null}</div> : <div className="draw-viz-scroll"><div className="draw-viz-round-columns">{groupAllRoundColumns.map(({ round, fixtures }) => <section className={activeRound === round ? "is-selected" : ""} key={round}><button type="button" onClick={() => { setSelectedRound(round); setViewMode("PAIRINGS"); }}>Vòng {round}<small>{fixtures.length} trận</small></button>{fixtures.map((fixture) => matchCard(fixture, true))}</section>)}</div></div>}
    </> : null}
    {groupTab === "STANDINGS" ? <div className="draw-viz-standings"><p>BXH sẽ được cập nhật khi có kết quả chính thức ở bước điều hành.</p><div className="draw-viz-standings-scroll"><table><thead><tr><th>Hạng</th><th>Đội</th><th>Tr</th><th>Th</th><th>H</th><th>B</th><th>BT</th><th>BB</th><th>HS</th><th>Đ</th></tr></thead><tbody>{officialData ? (officialData.standings[selectedGroupName] ?? []).map((row) => <tr key={row.teamId}><td>{row.groupRank || "—"}</td><td>{teamCard(row.teamId, undefined, true)}</td><td>{row.played}</td><td>{row.won}</td><td>{row.drawn}</td><td>{row.lost}</td><td>{row.goalsFor}</td><td>{row.goalsAgainst}</td><td>{row.goalDifference}</td><td>{row.points}</td></tr>) : selectedGroupData.ids.map((id, index) => <tr key={id}><td>—</td><td>{teamCard(id, undefined, true)}</td><td>0</td><td>0</td><td>0</td><td>0</td><td>0</td><td>0</td><td>0</td><td>0</td></tr>)}</tbody></table></div></div> : null}
    {groupTab === "QUALIFIERS" ? <div className="draw-viz-qualifier-detail">{allocation.format === "GROUP_AND_KNOCKOUT" ? Array.from({ length: allocation.qualifiersPerGroup }, (_, index) => <article key={index}><strong>{index + 1 === 1 ? "Nhất" : index + 1 === 2 ? "Nhì" : `Hạng ${index + 1}`} {selectedGroupName}</strong><span>{officialData?.qualifiers[selectedGroupName]?.[index + 1] ? teamById.get(officialData.qualifiers[selectedGroupName][index + 1])?.name : "Chờ kết quả chính thức · chưa xác định đội"}</span></article>) : <p>Thể thức vòng tròn không có suất loại trực tiếp.</p>}</div> : null}
    </section></Modal> : null}

    {allocation.format === "GROUP_AND_KNOCKOUT" && stageFilter !== "GROUP" && knockoutFixtures.length ? <section className="draw-viz-section"><div className="draw-viz-section-title"><div><h3>Nhánh loại trực tiếp</h3><p>Nguồn lấy theo thứ hạng vòng bảng, không theo mã vị trí A1/A2.</p></div></div><div className="draw-viz-canvas" ref={diagramRef} style={{ "--diagram-zoom": zoom / 100 } as React.CSSProperties}>{knockoutTree}</div></section> : null}
    {allocation.format === "GROUP_AND_KNOCKOUT" && stageFilter !== "GROUP" && !knockoutFixtures.length ? <p className="draw-viz-empty">Không có trận loại trực tiếp khớp bộ lọc.</p> : null}

    {selectedFixture && !onFixtureSelect ? <div className="draw-viz-modal-backdrop" style={officialMode ? { zIndex: 1600 } : undefined} role="presentation" onClick={() => setSelectedFixture(null)}><section className="draw-viz-match-detail" role="dialog" aria-modal="true" aria-labelledby="draw-viz-detail-title" onClick={(event) => event.stopPropagation()}><button type="button" className="draw-viz-modal-close" aria-label="Đóng chi tiết" onClick={() => setSelectedFixture(null)}>×</button><span className="draw-dev-badge">CHI TIẾT TRẬN · CHẾ ĐỘ CHỈ ĐỌC</span><h3 id="draw-viz-detail-title">{selectedFixture.id}</h3><p>{selectedFixture.groupName ? `${selectedFixture.groupName} · ` : ""}{selectedFixture.round}{selectedFixture.leg ? ` · Lượt ${selectedFixture.leg}` : ""}</p><div className="draw-viz-detail-contestants">{teamCard(selectedFixture.homeTeamId, selectedFixture.homeSource)}<strong>VS</strong>{teamCard(selectedFixture.awayTeamId, selectedFixture.awaySource)}</div><div className="draw-viz-next-source"><b>Trạng thái:</b> {selectedFixture.bye ? "BYE · không phải trận thi đấu" : officialData?.details[selectedFixture.id]?.result ? `Kết quả chính thức · ${officialData.details[selectedFixture.id].result!.homeScore} : ${officialData.details[selectedFixture.id].result!.awayScore}` : "Chưa có kết quả chính thức"}</div><div className="draw-viz-next-source"><b>Trận tiếp theo:</b> {state.fixtures.find((item) => item.id !== selectedFixture.id && winnerSources(item).some((source) => source.includes(selectedFixture.id)))?.id ?? "Không có trận kế tiếp xác định"}</div></section></div> : null}

    {!diagramOnly && officialData ? <div className="draw-demo-fixture-publish">
      <span className={state.fixturesPublishedAt ? "status-pill status-success" : "status-pill status-warning"} role="status">{state.fixturesPublishedAt ? "Đã công bố · " + new Date(state.fixturesPublishedAt).toLocaleString("vi-VN") : officialData.busy && !state.fixtures.length ? "Đang chuẩn bị sơ đồ…" : state.fixtures.length ? "Bản nháp đã lưu tại Match Service" : "Chưa có sơ đồ trận"}</span>
      <p>{state.fixturesPublishedAt ? "Sơ đồ và mã trận đã công bố được giữ nguyên. Bước 5 nhận danh sách trận chính thức này." : "Sơ đồ được tự động chuẩn bị và lưu từ kết quả Bước 3. Xác nhận để kiểm tra và công bố sơ đồ, giữ nguyên kết quả bốc thăm."}</p>
      <div className="button-row">
        {!state.fixturesPublishedAt ? <button type="button" className="button button-primary" disabled={officialData.busy || !state.fixtures.length} onClick={() => void officialData.onPublish()}>Xác nhận & công bố sơ đồ thi đấu</button> : officialData.onContinue ? <button type="button" className="button button-primary" disabled={officialData.busy} onClick={() => void officialData.onContinue?.()}>Tiếp tục đến Lập lịch thi đấu</button> : null}
        {officialData.canQualify ? <button type="button" className="button button-secondary" disabled={officialData.busy} onClick={() => void officialData.onQualify()}>Xác định đội đi tiếp</button> : null}
      </div>
    </div> : !diagramOnly ? !readOnly ? <div className="draw-demo-fixture-publish"><span className={state.fixturesPublishedAt ? "status-pill status-success" : "status-pill status-warning"}>{state.fixturesPublishedAt ? `Đã công bố thử nghiệm · ${new Date(state.fixturesPublishedAt).toLocaleString("vi-VN")}` : "Bản xem trước thử nghiệm"}</span>{state.fixturesPublishedAt ? <p>Sơ đồ đã khóa cho kịch bản này và đồng bộ sang các tab xem giải.</p> : <><p>Sơ đồ kiểm thử chỉ lưu cục bộ trên trình duyệt; không ghi fixtures vào match-service hoặc database.</p><button className="button button-primary" type="button" disabled={busy} onClick={() => void publishFixtures()}>{busy ? "Đang công bố…" : "Xác nhận & công bố sơ đồ thử nghiệm"}</button></>}</div> : <p className="draw-demo-fixture-publish"><span className="status-pill status-success">Đã công bố thử nghiệm · {state.fixturesPublishedAt ? new Date(state.fixturesPublishedAt).toLocaleString("vi-VN") : ""}</span></p> : null}
  </section>;
}
