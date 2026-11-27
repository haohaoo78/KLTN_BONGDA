import { useEffect, useMemo, useState } from "react";
import { getPublicTeamDetail, type DrawVersion, type FixtureGroupStandings, type LiveDrawSession, type Match, type MatchResult, type PublicFixtureBundle, type PublicTeamDetail, type PublicTournamentTeam, type Tournament } from "../api/competition";
import { Modal } from "./Modal";
import { demoDiagramSnapshotKey, type DemoScheduleEntry, type DrawTestState } from "../utils/drawTestStorage";
import { DrawDemoFixtureWorkspace } from "./DrawDemoFixtureWorkspace";

type Props = {
  tournament: Tournament;
  draw: DrawVersion | null;
  drawLoading: boolean;
  drawError: string | null;
  liveDraw: LiveDrawSession | null;
  liveConnection: "connected" | "reconnecting";
  fixtures: PublicFixtureBundle | null;
  fixturesLoading: boolean;
  fixturesError: string | null;
  teams: PublicTournamentTeam[];
  results: Map<string, MatchResult>;
  fixtureStandings?: FixtureGroupStandings | null;
  fixtureStandingsLoading?: boolean;
  fixtureStandingsError?: string;
  drawTestState?: DrawTestState | null;
};

const formatLabel: Record<string, string> = {
  ROUND_ROBIN: "Vòng tròn",
  GROUP_AND_KNOCKOUT: "Vòng bảng & loại trực tiếp",
  KNOCKOUT: "Loại trực tiếp",
};

const methodLabel: Record<string, string> = { RANDOM: "Bốc thăm ngẫu nhiên", SEEDED: "Bốc thăm trực tiếp", MANUAL: "Sắp xếp thủ công" };
const liveStatusLabel: Record<LiveDrawSession["status"], string> = {
  SCHEDULED: "Sắp diễn ra", POSTPONED: "Đã hoãn", LIVE: "LIVE · Đang bốc thăm", PAUSED: "Tạm dừng bốc thăm",
  COMPLETED: "Đã hoàn thành", CANCELLED: "Đã hủy", FINALIZED: "Đã công bố kết quả",
};
const publicMatchStatusLabels: Record<string, string> = {
  UNSCHEDULED: "Chưa xếp lịch", SCHEDULED: "Sắp diễn ra", LINEUP_CONFIRMED: "Đã xác nhận đội hình",
  IN_PROGRESS: "Đang thi đấu", FINISHED: "Chờ BTC công nhận", VERIFIED: "Kết quả chính thức",
  LOCKED: "Đã khóa kết quả", POSTPONED: "Tạm hoãn", CANCELLED: "Đã hủy",
};

function publicMatchStatusLabel(status: string): string {
  return publicMatchStatusLabels[status] ?? "Đang cập nhật trạng thái";
}

function formatDate(value: string, timeZone?: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Chưa cập nhật" : new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "full", timeStyle: "short", ...(timeZone ? { timeZone } : {}),
  }).format(date);
}

export function PublicTournamentCompetitionPanel({ tournament, draw, drawLoading, drawError, liveDraw, liveConnection, fixtures, fixturesLoading, fixturesError, teams, results, fixtureStandings, fixtureStandingsLoading = false, fixtureStandingsError = "", drawTestState }: Props) {
  const [viewerOpen, setViewerOpen] = useState(false);
  const [groupFilter, setGroupFilter] = useState("all");
  const [roundFilter, setRoundFilter] = useState("all");
  const [teamDetail, setTeamDetail] = useState<PublicTeamDetail | null>(null);
  const [teamDetailLoading, setTeamDetailLoading] = useState(false);
  const [teamDetailError, setTeamDetailError] = useState<string | null>(null);
  const [testViewerOpen, setTestViewerOpen] = useState(false);
  const [testClock, setTestClock] = useState(Date.now());
  const teamById = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);
  const publishedRegulation = draw?.config.fixtureRegulationSnapshot as { competitionFormat?: Tournament["competitionFormat"]; rules?: { advancingTeamsPerGroup?: number } } | undefined;
  const format = publishedRegulation?.competitionFormat ?? draw?.config.competitionFormat as Tournament["competitionFormat"] | undefined ?? tournament.competitionFormat ?? "ROUND_ROBIN";
  const qualifiersPerGroup = publishedRegulation?.rules?.advancingTeamsPerGroup ?? tournament.rules?.advancingTeamsPerGroup ?? 0;
  const publishedGroups = draw?.groups ?? [];
  const publishedAssignments = publishedGroups.flatMap((group) => group.assignments);
  const liveVisible = Boolean(liveDraw && ["SCHEDULED", "POSTPONED", "LIVE", "PAUSED", "COMPLETED", "CANCELLED", "FINALIZED"].includes(liveDraw.status));
  const publishedAt = draw?.publishedAt;
  const activeLive = Boolean(liveDraw && ["LIVE", "PAUSED"].includes(liveDraw.status));
  const methodText = draw ? methodLabel[draw.method] ?? draw.method : "";
  const publishedStages = fixtures?.stages ?? [];
  const groupStages = publishedStages.filter((stage) => stage.stage === "GROUP");
  const knockoutStages = publishedStages.filter((stage) => stage.stage === "KNOCKOUT");
  const groupMatches = groupStages.flatMap((stage) => stage.matches);
  const rounds = [...new Set(groupMatches.map((match) => match.round ?? "Vòng đấu"))];
  const visibleGroupMatches = groupMatches.filter((match) => {
    const groupName = publishedGroups.find((group) => group.assignments.some((assignment) => assignment.teamId === match.homeTeamId || assignment.teamId === match.awayTeamId))?.name;
    return (groupFilter === "all" || groupFilter === groupName) && (roundFilter === "all" || roundFilter === match.round);
  });
  const visibleRounds = [...new Set(visibleGroupMatches.map((match) => match.round ?? "Vòng đấu"))];
  // Public snapshots intentionally omit manager-only configuration and drafts.
  // A published allocation or ceremony is sufficient to render the public test
  // view; requiring configuration here made published Step 3/4 results appear
  // as if they were still waiting for BTC.
  const testMode = false;
  const testPublication = drawTestState?.publication ?? null;
  const testLive = drawTestState?.directSession;
  const directFormat = typeof testLive?.format === "string" ? testLive.format as Tournament["competitionFormat"] : undefined;
  const testFormat = testPublication?.format ?? directFormat ?? drawTestState?.configuration?.format ?? tournament.competitionFormat ?? "ROUND_ROBIN";
  const testTeamSlots = testPublication?.slots ?? (Array.isArray(testLive?.slots) ? testLive.slots.filter((id): id is string | null => id === null || typeof id === "string") : []);
  const directGroupSizes = Array.isArray(testLive?.teamsPerGroup) ? testLive.teamsPerGroup.filter((size): size is number => typeof size === "number") : [];
  const testGroupSizes = testPublication?.teamsPerGroup ?? (directGroupSizes.length ? directGroupSizes : drawTestState?.configuration?.teamsPerGroup ?? []);
  const testTeams = useMemo(() => teams.map((team) => ({
    teamId: team.id,
    name: team.name,
    shortName: team.shortName,
    logoUrl: team.logoUrl,
    institutionId: team.institutionId,
    institutionName: team.institutionName,
    isActive: true,
    registrationStatus: "APPROVED",
    verifiedRosterCount: 0,
    totalRosterCount: 0,
    eligible: true,
    ineligibilityReason: null,
  })), [teams]);
  const testGroups = testGroupSizes.map((capacity, groupIndex) => {
    const start = testGroupSizes.slice(0, groupIndex).reduce((sum, size) => sum + size, 0);
    return { name: testFormat === "KNOCKOUT" ? "Nhánh loại trực tiếp" : `Bảng ${String.fromCharCode(65 + groupIndex)}`, assignments: testTeamSlots.slice(start, start + capacity).map((teamId, index) => ({ teamId, position: index + 1 })) };
  });
  const testStep5 = drawTestState?.step5;
  const currentTestDiagramKey = drawTestState ? demoDiagramSnapshotKey(drawTestState) : "";
  const testScheduleIsPublished = Boolean(testMode && testStep5 && testStep5.diagramSnapshotKey === currentTestDiagramKey
    && (testStep5.schedulePublishedAt || testStep5.publishedAt)
    && (testStep5.schedulePublishedDiagramSnapshotKey === currentTestDiagramKey || (!testStep5.schedulePublishedDiagramSnapshotKey && testStep5.publishedAt)));
  const publicTestSchedule: Record<string, DemoScheduleEntry> | undefined = testScheduleIsPublished && testStep5
    ? Object.fromEntries(Object.entries(testStep5.publishedScheduleByFixture ?? testStep5.scheduleByFixture).map(([fixtureId, entry]) => {
      const publicAssignments = (testStep5.publishedRefereeAssignmentsByFixture?.[fixtureId] ?? []).map((item) => item.refereeName.trim()).filter(Boolean);
      return [fixtureId, { ...entry, refereeNames: testStep5.refereePublishedFixtureIds?.includes(fixtureId) ? publicAssignments : [] }];
    }))
    : undefined;
  const publicTestScheduleDisplay = publicTestSchedule && testStep5 ? Object.fromEntries(Object.entries(publicTestSchedule).map(([fixtureId, entry]) => {
    const venue = testStep5.resources?.venues.find((item) => item.code === entry.venue || item.name === entry.venue);
    const fixture = drawTestState?.fixtures.find((item) => item.id === fixtureId);
    const duration = fixture ? (fixture.stage === "GROUP" ? testStep5.resources?.groupTiming : testStep5.resources?.knockoutTiming) : null;
    const minutes = duration ? duration.halfMinutes * 2 + duration.halftimeBreakMinutes + duration.extraTimeReserveMinutes + duration.penaltyReserveMinutes : entry.durationMinutes ?? 0;
    const end = entry.scheduledAt ? new Date(new Date(entry.scheduledAt).getTime() + minutes * 60_000) : null;
    return [fixtureId, { endLabel: end ? end.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) : "", venueName: venue?.name ?? entry.venue, status: entry.locked ? "LOCKED" as const : "SCHEDULED" as const }];
  })) : undefined;

  useEffect(() => {
    if (!testLive || !["SCHEDULED", "POSTPONED", "LIVE", "PAUSED"].includes(String(testLive.status))) return;
    const timer = window.setInterval(() => setTestClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [testLive?.status, testLive?.scheduledAt]);

  function standingsFor(groupId: string) {
    return fixtureStandings?.groups.find((group) => group.groupId === groupId)?.standings ?? [];
  }

  function teamIdentity(teamId: string | null, source?: { groupId: string; groupRank: number } | null) {
    if (!teamId) {
      const sourceGroup = source ? publishedGroups.find((group) => group.id === source.groupId)?.name : null;
      return <span className="public-draw-team-source">{source ? `${source.groupRank === 1 ? "Nhất" : source.groupRank === 2 ? "Nhì" : `Hạng ${source.groupRank}`} ${sourceGroup ?? "bảng"}` : "Chờ đội được xác định"}</span>;
    }
    const team = teamById.get(teamId);
    return <button type="button" className="public-team-link" onClick={() => {
      setTeamDetail(null); setTeamDetailError(null); setTeamDetailLoading(true);
      void getPublicTeamDetail(teamId).then(setTeamDetail).catch((cause: unknown) => setTeamDetailError(cause instanceof Error ? cause.message : "Không tải được hồ sơ đội.")).finally(() => setTeamDetailLoading(false));
    }} aria-label={`Xem hồ sơ công khai ${team?.name ?? "đội bóng"}`}>
      <span className="public-draw-team-identity">{team?.logoUrl ? <img src={team.logoUrl} alt="" loading="lazy" /> : <i>{(team?.shortName ?? team?.name ?? "Đội").slice(0, 2).toLocaleUpperCase("vi")}</i>}<span><strong>{team?.name ?? "Đội bóng"}</strong><small>{team?.institutionName ?? ""}</small></span></span>
    </button>;
  }

  function matchCard(match: Match) {
    const result = results.get(match.id);
    return <article className="public-fixture-match" key={match.id}>
      <header><strong>{match.round ?? "Trận đấu"}</strong><em>{publicMatchStatusLabel(match.status)}</em></header>
      <div className="public-fixture-sides">{teamIdentity(match.homeTeamId)}<b>VS</b>{teamIdentity(match.awayTeamId)}</div>
      <strong className="public-fixture-score">{result ? `${result.homeScore} – ${result.awayScore} · Đã công nhận` : match.status === "FINISHED" ? "Chờ BTC công nhận kết quả" : "Chưa thi đấu"}</strong>
      <small>{match.matchDate ? formatDate(match.matchDate) : "Chưa xếp lịch"}{match.venue ? ` · ${match.venue}` : ""}</small>
    </article>;
  }

  function allocationDiagram() {
    if (!draw) return null;
    if (format === "KNOCKOUT") {
      const positions = publishedGroups.flatMap((group) => group.assignments.map((assignment) => ({ group, assignment })));
      return <div className="public-branch-grid">{positions.map(({ group, assignment }, index) => <article className="public-branch-position" key={`${group.id}-${assignment.position}`}>
        <span>P{assignment.position}</span>{teamIdentity(assignment.teamId)}{assignment.seedGroup ? <small>Hạt giống {assignment.seedGroup}</small> : null}
        {index % 2 === 0 && index + 1 < positions.length ? <i aria-hidden="true" /> : null}
      </article>)}</div>;
    }
    return <>
      <div className="public-draw-flow"><strong>{publishedAssignments.length} ĐỘI ĐÃ PHÂN BỔ</strong><span aria-hidden="true">↓</span><div className="public-draw-groups">
        {publishedGroups.map((group) => <article className="public-draw-group" key={group.id}>
          <header><div><strong>{group.name}</strong><small>{group.assignments.length} đội</small></div><span>{format === "GROUP_AND_KNOCKOUT" ? `${group.assignments.length} vị trí` : "Vòng tròn"}</span></header>
          {[...group.assignments].sort((a, b) => a.position - b.position).map((assignment) => <div className="public-draw-assignment" key={assignment.teamId}>
      <b>{group.name}{assignment.position}</b>{teamIdentity(assignment.teamId)}{assignment.seedGroup ? <small>Hạt giống {assignment.seedGroup}</small> : null}
          </div>)}
          {format === "GROUP_AND_KNOCKOUT" ? <footer>{qualifiersPerGroup} suất đi tiếp</footer> : null}
        </article>)}
      </div></div>
      {format === "GROUP_AND_KNOCKOUT" ? <div className="public-qualification-summary"><span>{publishedGroups.length} bảng</span><b>→</b><strong>{publishedGroups.length * qualifiersPerGroup} suất loại trực tiếp</strong><small>Đội đi tiếp được xác định sau khi có kết quả vòng bảng chính thức.</small></div> : null}
    </>;
  }

  function liveViewer() {
    if (!liveDraw) return null;
    const latestPick = liveDraw.picks.at(-1);
    return <div className="public-live-viewer">
      <div className="public-live-viewer-head"><div><span className="eyebrow">{tournament.name}</span><h3>{liveDraw.eventName}</h3></div><span className={`status-pill ${activeLive ? "status-warning" : "status-success"}`}>{liveStatusLabel[liveDraw.status]}</span></div>
      {liveConnection === "reconnecting" ? <p className="public-live-connection" role="status">Đang kết nối lại · trạng thái sẽ tự đồng bộ.</p> : null}
      <div className="public-live-progress"><span>{liveDraw.revealedCount}/{liveDraw.totalPicks} đội đã được bốc</span><progress max={Math.max(1, liveDraw.totalPicks)} value={liveDraw.revealedCount} /></div>
      {latestPick ? <article className="public-live-last-pick"><span>LÁ THĂM VỪA MỞ · LƯỢT {latestPick.sequence}</span>{teamIdentity(latestPick.teamId)}<strong>{latestPick.groupName} · vị trí {latestPick.position}{latestPick.seedGroup ? ` · Hạt giống ${latestPick.seedGroup}` : ""}</strong></article> : <article className="public-live-last-pick is-empty"><span>BUỔI LỄ BỐC THĂM</span><strong>Chưa mở lá thăm</strong><small>Kết quả xuất hiện sau khi BTC ghi nhận lượt bốc đầu tiên.</small></article>}
      <div className="public-draw-groups">{liveDraw.groups.map((group, groupIndex) => <article className="public-draw-group" key={`${liveDraw.sessionId}-${group.name}`}><header><strong>{group.name}</strong><span>{liveDraw.picks.filter((pick) => pick.groupIndex === groupIndex).length}/{group.maxTeams}</span></header>{liveDraw.picks.filter((pick) => pick.groupIndex === groupIndex).map((pick) => <div className="public-draw-assignment" key={pick.sequence}><b>{group.name}{pick.position}</b>{teamIdentity(pick.teamId)}{pick.seedGroup ? <small>Hạt giống {pick.seedGroup}</small> : null}</div>)}{liveDraw.picks.every((pick) => pick.groupIndex !== groupIndex) ? <p className="muted">Chưa phân bổ đội</p> : null}</article>)}</div>
      <details className="draw-live-history"><summary>Lịch sử bốc thăm ({liveDraw.history.length})</summary>{liveDraw.history.map((item, index) => <p key={`${item.at}-${index}`}><time>{formatDate(item.at)}</time> · {item.detail}</p>)}</details>
    </div>;
  }

  function testDrawSection() {
    const direct = testLive;
    const directStatus = typeof direct?.status === "string" ? direct.status : "";
    const directStatusLabel: Record<string, string> = { SCHEDULED: "Sắp diễn ra", POSTPONED: "Đã hoãn", LIVE: "LIVE · Đang bốc thăm", PAUSED: "Tạm dừng bốc thăm", COMPLETED: "Hoàn thành", CANCELLED: "Đã hủy", WAITING: "Chưa công bố lịch" };
    const directSlots = Array.isArray(direct?.slots) ? direct.slots : [];
    const revealed = typeof direct?.revealedCount === "number" ? direct.revealedCount : 0;
    const time = typeof direct?.scheduledAt === "string" ? new Date(direct.scheduledAt) : null;
    const total = typeof direct?.totalPicks === "number" ? direct.totalPicks : testPublication?.teamIds.length ?? teams.length;
    const statusStyle = ["LIVE", "PAUSED"].includes(directStatus) ? "status-warning" : directStatus === "CANCELLED" ? "status-danger" : "status-success";
    return <>
      <section className="tournament-detail-section public-competition-section public-test-competition">
        <div className="panel-heading panel-heading-wrap"><div><span className="eyebrow">KẾT QUẢ KIỂM THỬ · ĐỒNG BỘ TỪ KHO TEST</span><h3>{testFormat === "KNOCKOUT" ? "Kết quả phân nhánh" : testFormat === "GROUP_AND_KNOCKOUT" ? "Kết quả chia bảng & suất đi tiếp" : "Kết quả chia bảng"}</h3></div><span className="status-pill">DEV · Không phải kết quả chính thức</span></div>
        {direct && directStatus && directStatus !== "WAITING" ? <article className="public-ceremony-card"><div><span className="eyebrow">{["LIVE", "PAUSED"].includes(directStatus) ? "BUỔI LỄ BỐC THĂM" : "LỊCH BỐC THĂM"}</span><h4>{String(direct.eventName ?? "Lễ bốc thăm")}</h4></div><span className={`status-pill ${statusStyle}`}>{directStatusLabel[directStatus] ?? directStatus}</span><p>{time && !Number.isNaN(time.getTime()) ? formatDate(time.toISOString(), String(direct.timeZone ?? "Asia/Ho_Chi_Minh")) : "Chưa công bố thời gian"}{direct.location ? ` · ${String(direct.location)}` : ""}</p>{direct.announcement ? <p>{String(direct.announcement)}</p> : null}<div className="public-live-progress"><span>{revealed}/{total} đội đã được bốc</span><progress max={Math.max(1, total)} value={revealed} /></div>{directStatus === "SCHEDULED" && time ? <p>{time.getTime() > testClock ? `Còn ${Math.max(0, Math.ceil((time.getTime() - testClock) / 60000))} phút · Sắp diễn ra` : "Đã đến giờ · Đang chờ Ban tổ chức bắt đầu."}</p> : null}{["SCHEDULED", "POSTPONED", "LIVE", "PAUSED", "COMPLETED"].includes(directStatus) ? <button type="button" className="button button-primary" onClick={() => setTestViewerOpen(true)}>{["LIVE", "PAUSED"].includes(directStatus) ? "Theo dõi bốc thăm trực tiếp" : "Xem buổi bốc thăm"}</button> : null}</article> : null}
        {!testPublication ? <div className="public-draw-empty"><span>🎟️</span><strong>{directStatus === "LIVE" || directStatus === "PAUSED" ? "Đang diễn ra buổi bốc thăm thử nghiệm" : "Đang chờ Ban tổ chức công bố kết quả"}</strong><p>{formatLabel[testFormat] ?? "Thể thức đang cập nhật"} · Kết quả thử nghiệm chỉ xuất hiện sau khi BTC công bố.</p></div> : <>
          <div className="public-draw-summary"><span>{methodLabel[testPublication.method] ?? testPublication.method}</span><span>{testPublication.teamIds.length} đội</span><span>{formatLabel[testPublication.format]}</span><span>Công bố thử nghiệm {formatDate(testPublication.publishedAt)}</span></div>
          {testPublication.format === "KNOCKOUT" ? <div className="public-branch-grid">{testPublication.slots.map((teamId, index) => <article className={`public-branch-position ${testPublication.byePositions?.includes(index) ? "is-bye" : ""}`} key={`test-position-${index}`}><span>P{index + 1}</span>{teamId ? teamIdentity(teamId) : <span>{testPublication.byePositions?.includes(index) ? "BYE · miễn vòng" : "Vị trí trống"}</span>}</article>)}</div> : <div className="public-draw-groups">{testGroups.map((group) => <article className="public-draw-group" key={group.name}><header><strong>{group.name}</strong><span>{group.assignments.filter((item) => item.teamId).length} đội</span></header>{group.assignments.map((assignment) => <div className="public-draw-assignment" key={`${group.name}-${assignment.position}`}><b>{group.name.replace("Bảng ", "")}{assignment.position}</b>{assignment.teamId ? teamIdentity(assignment.teamId) : <span>Vị trí chưa phân bổ</span>}</div>)}{testPublication.format === "GROUP_AND_KNOCKOUT" ? <footer>{testPublication.qualifiersPerGroup} suất đi tiếp · chờ kết quả vòng bảng</footer> : null}</article>)}</div>}
          {testPublication.format === "GROUP_AND_KNOCKOUT" ? <div className="public-qualification-summary"><span>{testPublication.groupCount} bảng</span><b>→</b><strong>{testPublication.qualifiersPerGroup * testPublication.groupCount + testPublication.extraQualificationSlots} suất playoff</strong><small>Suất đi tiếp lấy từ thứ hạng bảng sau khi có kết quả chính thức.</small></div> : null}
        </>}
        {!testPublication && direct && ["SCHEDULED", "POSTPONED", "LIVE", "PAUSED"].includes(directStatus) ? <div className="public-draw-groups">{testGroups.map((group) => <article className="public-draw-group" key={group.name}><header><strong>{group.name}</strong><span>{group.assignments.filter((item) => item.teamId).length} vị trí đã mở</span></header>{group.assignments.map((assignment) => <div className="public-draw-assignment" key={`${group.name}-${assignment.position}`}><b>{testFormat === "KNOCKOUT" ? `P${assignment.position}` : `${group.name.replace("Bảng ", "")}${assignment.position}`}</b>{assignment.teamId ? teamIdentity(assignment.teamId) : <span className="public-draw-team-source">{directStatus === "SCHEDULED" || directStatus === "POSTPONED" ? "Chưa mở lá thăm" : "Chờ lượt bốc"}</span>}</div>)}</article>)}</div> : null}
        {direct && Array.isArray(direct.history) && direct.history.length ? <details className="draw-live-history"><summary>Lịch sử bốc thăm thử nghiệm ({direct.history.length})</summary>{direct.history.map((event, index) => { const item = event as { at?: string; detail?: string; type?: string }; return <p key={`${item.at ?? index}-${index}`}>{item.at ? formatDate(item.at) : ""} · {item.detail ?? item.type ?? "Thao tác"}</p>; })}</details> : null}
      </section>
      {drawTestState?.fixturesPublishedAt
        ? <DrawDemoFixtureWorkspace tournamentId={tournament.id} tournamentName={tournament.name} readOnly publishedState={drawTestState} teams={testTeams} scheduleByFixture={publicTestSchedule} scheduleDisplayByFixture={publicTestScheduleDisplay} />
        : <section className="tournament-detail-section public-fixtures-section public-test-fixtures"><div className="panel-heading panel-heading-wrap"><div><span className="eyebrow">SƠ ĐỒ THI ĐẤU KIỂM THỬ</span><h3>Sơ đồ thi đấu</h3></div></div><p className="public-draw-empty-text">Sơ đồ thử nghiệm sẽ hiển thị sau khi BTC công bố tại Bước 4. Bản nháp không hiển thị cho người xem.</p></section>}
      <Modal open={testViewerOpen} onClose={() => setTestViewerOpen(false)} eyebrow="THEO DÕI CÔNG KHAI · DEV" title={String(direct?.eventName ?? "Bốc thăm trực tiếp")} description="Chỉ hiển thị lịch đã công bố và các lượt bốc đã được ghi nhận; bản nháp phân bổ vẫn được giữ riêng."><div className="public-live-viewer"><div className="public-live-viewer-head"><span className={`status-pill ${statusStyle}`}>{directStatusLabel[directStatus] ?? directStatus}</span><span>{time && !Number.isNaN(time.getTime()) ? formatDate(time.toISOString(), String(direct?.timeZone ?? "Asia/Ho_Chi_Minh")) : "Chưa công bố thời gian"}{direct?.location ? ` · ${String(direct.location)}` : ""}</span></div>{direct?.announcement ? <p>{String(direct.announcement)}</p> : null}<progress max={Math.max(1, total)} value={revealed} /><p>{revealed}/{total} đội đã được bốc</p><div className="public-draw-groups">{testGroups.map((group, groupIndex) => { const groupStart = testGroupSizes.slice(0, groupIndex).reduce((sum, size) => sum + size, 0); return <article className="public-draw-group" key={group.name}><header><strong>{group.name}</strong></header>{group.assignments.map((assignment) => { const slotIndex = groupStart + assignment.position - 1; const id = typeof directSlots[slotIndex] === "string" ? directSlots[slotIndex] as string : null; return <div className="public-draw-assignment" key={`${group.name}-${assignment.position}`}><b>{testFormat === "KNOCKOUT" ? `P${assignment.position}` : `${group.name.replace("Bảng ", "")}${assignment.position}`}</b>{id ? teamIdentity(id) : <span className="public-draw-team-source">{["SCHEDULED", "POSTPONED"].includes(directStatus) ? "Chưa mở lá thăm" : "Chờ lượt bốc"}</span>}</div>; })}</article>; })}</div>{Array.isArray(direct?.history) && direct.history.length ? <details className="draw-live-history"><summary>Lịch sử buổi lễ ({direct.history.length})</summary>{direct.history.map((event, index) => { const item = event as { at?: string; detail?: string; type?: string }; return <p key={`${item.at ?? index}-${index}`}>{item.at ? formatDate(item.at) : ""} · {item.detail ?? item.type ?? "Thao tác"}</p>; })}</details> : null}</div></Modal>
    </>;
  }

  return <>
    {testMode ? testDrawSection() : <>
    <section className="tournament-detail-section public-competition-section">
      <div className="panel-heading panel-heading-wrap"><div><span className="eyebrow">KẾT QUẢ CHÍNH THỨC</span><h3>{format === "KNOCKOUT" ? "Kết quả phân nhánh" : format === "GROUP_AND_KNOCKOUT" ? "Kết quả chia bảng & suất đi tiếp" : "Kết quả chia bảng"}</h3></div>{draw ? <span className="status-pill status-success">Đã công bố</span> : null}</div>
      {drawLoading ? <p className="muted" role="status">Đang tải kết quả công bố…</p> : drawError ? <div className="public-data-error" role="alert"><strong>Không thể tải kết quả bốc thăm</strong><p>{drawError}</p></div> : null}
      {!drawLoading && !drawError && !draw && liveVisible && liveDraw ? <>
        <article className="public-ceremony-card"><div><span className="eyebrow">{liveDraw.status === "LIVE" || liveDraw.status === "PAUSED" ? "BUỔI LỄ BỐC THĂM" : "LỊCH BỐC THĂM"}</span><h4>{liveDraw.eventName}</h4></div><span className={`status-pill ${activeLive ? "status-warning" : liveDraw.status === "CANCELLED" ? "status-danger" : ""}`}>{liveStatusLabel[liveDraw.status]}</span><p>{formatDate(liveDraw.scheduledAt, liveDraw.timeZone)} · {liveDraw.timeZone}{liveDraw.location ? ` · ${liveDraw.location}` : ""}</p>{liveDraw.announcement ? <p>{liveDraw.announcement}</p> : null}<div className="public-ceremony-facts"><span>{liveDraw.totalPicks} đội</span><span>{formatLabel[format] ?? "Thể thức giải"}</span><span>{methodLabel[liveDraw.method] ?? "Bốc thăm trực tiếp"}</span></div>{liveDraw.status === "CANCELLED" ? <p className="public-cancellation-note">Buổi lễ đã bị hủy. {liveDraw.history.filter((event) => event.type.includes("cancel")).at(-1)?.detail ?? ""}</p> : null}{liveDraw.status !== "CANCELLED" ? <p>{liveDraw.status === "SCHEDULED" ? (Date.now() >= new Date(liveDraw.scheduledAt).getTime() ? "Đã đến giờ · Đang chờ ban tổ chức bắt đầu." : `Còn ${Math.max(0, Math.ceil((new Date(liveDraw.scheduledAt).getTime() - Date.now()) / 60000))} phút · Sắp diễn ra.`) : liveDraw.status === "POSTPONED" ? "Lịch bốc thăm đang được hoãn." : "Theo dõi tiến độ và các lượt đã ghi nhận."}</p> : null}{liveDraw.status !== "CANCELLED" ? <button className="button button-primary" type="button" onClick={() => setViewerOpen(true)}>{activeLive ? "Theo dõi bốc thăm trực tiếp" : "Xem thông tin buổi lễ"}</button> : null}</article>
      </> : null}
      {!drawLoading && !drawError && !draw && !liveVisible ? <div className="public-draw-empty"><span aria-hidden="true">🎟️</span><strong>Đang chờ Ban tổ chức công bố kết quả</strong><p>{formatLabel[format] ?? "Thể thức đang cập nhật"}{teams.length ? ` · ${teams.length} đội đã chốt` : ""}. Kết quả phân bổ sẽ xuất hiện tại đây sau khi được xác lập chính thức.</p></div> : null}
      {draw ? <>
        <div className="public-draw-summary"><span>{methodText}</span><span>{publishedAssignments.length} đội</span><span>{formatLabel[format] ?? "Thể thức giải"}</span>{publishedAt ? <span>Công bố {formatDate(publishedAt)}</span> : null}</div>
        {liveDraw?.status === "FINALIZED" && liveDraw.history.length ? <details className="draw-live-history"><summary>Xem lịch sử các lượt bốc ({liveDraw.history.length})</summary>{liveDraw.history.map((item, index) => <p key={`${item.at}-${index}`}><time>{formatDate(item.at)}</time> · {item.detail}</p>)}</details> : null}
        {allocationDiagram()}
      </> : null}
      {activeLive && liveDraw ? <article className="public-live-callout"><span className="status-pill status-warning">{liveStatusLabel[liveDraw.status]}</span><strong>Buổi lễ đang diễn ra</strong><button type="button" className="button button-primary" onClick={() => setViewerOpen(true)}>Theo dõi bốc thăm trực tiếp</button></article> : null}
    </section>

    <section className="tournament-detail-section public-fixtures-section">
      <div className="panel-heading panel-heading-wrap"><div><span className="eyebrow">LỊCH THI ĐẤU CÔNG KHAI</span><h3>Sơ đồ thi đấu</h3></div>{fixtures?.stages.length ? <span className="status-pill status-success">Đã công bố</span> : null}</div>
      {fixturesLoading ? <p className="muted" role="status">Đang tải sơ đồ thi đấu…</p> : fixturesError ? <div className="public-data-error" role="alert"><strong>Không thể tải sơ đồ thi đấu</strong><p>{fixturesError}</p></div> : null}
      {!fixturesLoading && !fixturesError && !draw ? <p className="public-draw-empty-text">Sơ đồ thi đấu sẽ được công bố sau khi hoàn thành bốc thăm và phân bổ đội.</p> : null}
      {!fixturesLoading && !fixturesError && draw && !publishedStages.length ? <p className="public-draw-empty-text">Ban tổ chức đang chuẩn bị sơ đồ và các vòng đấu dựa trên kết quả phân bổ chính thức.</p> : null}
      {!fixturesLoading && !fixturesError && publishedStages.length ? <>
        {groupStages.length ? <>
          <div className="public-fixture-toolbar"><label><span>Bảng</span><select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}><option value="all">Tất cả bảng</option>{publishedGroups.map((group) => <option key={group.id} value={group.name}>{group.name}</option>)}</select></label><label><span>Vòng đấu</span><select value={roundFilter} onChange={(event) => setRoundFilter(event.target.value)}><option value="all">Tất cả vòng</option>{rounds.map((round) => <option key={round} value={round}>{round}</option>)}</select></label></div>
          {visibleGroupMatches.length ? <div className="public-fixture-rounds">{visibleRounds.map((round) => {
            const roundMatches = visibleGroupMatches.filter((match) => (match.round ?? "Vòng đấu") === round);
            const group = publishedGroups.find((item) => round.startsWith(item.name))
              ?? publishedGroups.find((item) => item.assignments.some((assignment) => roundMatches.some((match) => assignment.teamId === match.homeTeamId || assignment.teamId === match.awayTeamId)));
            const playing = new Set(roundMatches.flatMap((match) => [match.homeTeamId, match.awayTeamId]).filter((id): id is string => Boolean(id)));
            const resting = group?.assignments.filter((assignment) => !playing.has(assignment.teamId)) ?? [];
            return <section key={round}><header><strong>{round}</strong><span>{roundMatches.length} trận</span></header><div className="public-fixture-grid">{roundMatches.map(matchCard)}</div>{resting.length ? <div className="public-resting-teams"><strong>Nghỉ vòng này</strong>{resting.map((assignment) => <span key={assignment.teamId}>{teamIdentity(assignment.teamId)}</span>)}</div> : null}</section>;
          })}</div> : <p className="muted">Chưa có trận vòng bảng khớp bộ lọc.</p>}
          {format === "GROUP_AND_KNOCKOUT" ? <>
            <section className="public-group-standings"><header><div><span className="eyebrow">BẢNG XẾP HẠNG</span><h4>Kết quả vòng bảng</h4></div><span className="status-pill">Chỉ đọc</span></header>{fixtureStandingsError ? <p className="public-data-error" role="alert">{fixtureStandingsError}</p> : fixtureStandingsLoading ? <p className="muted" role="status">Đang tải bảng xếp hạng chính thức…</p> : null}<div className="public-group-standings-grid">{publishedGroups.map((group) => <article key={group.id}><h5>{group.name}</h5><div className="public-standing-wrap"><table><thead><tr><th>Hạng</th><th>Đội</th><th>Tr</th><th>T</th><th>H</th><th>B</th><th>BT</th><th>BB</th><th>HS</th><th>Điểm</th></tr></thead><tbody>{standingsFor(group.id).map((row) => <tr key={row.teamId}><td>{row.groupRank > 0 ? row.groupRank : "—"}</td><td>{teamIdentity(row.teamId)}</td><td>{row.played}</td><td>{row.won}</td><td>{row.drawn}</td><td>{row.lost}</td><td>{row.goalsFor}</td><td>{row.goalsAgainst}</td><td>{row.goalDifference}</td><td><strong>{row.points}</strong></td></tr>)}</tbody></table>{!fixtureStandingsLoading && !fixtureStandingsError && standingsFor(group.id).length === 0 ? <p className="muted">Chưa có bảng xếp hạng được trả về từ dữ liệu chính thức.</p> : null}</div></article>)}</div><small>Kết quả chỉ tính từ tỷ số đã được BTC công nhận.</small></section>
            {fixtures?.bracket.length ? <section className="public-qualification-list"><span className="eyebrow">CÁC SUẤT VÀO VÒNG LOẠI TRỰC TIẾP</span><div>{[...new Map(fixtures.bracket.flatMap((slot) => [slot.homeQualification, slot.awayQualification]).filter((item): item is { groupId: string; groupRank: number } => item !== null).map((source) => [`${source.groupId}:${source.groupRank}`, source])).values()].map((source) => { const sourceGroupMatches = groupMatches.filter((match) => publishedGroups.find((group) => group.id === source.groupId)?.assignments.some((assignment) => assignment.teamId === match.homeTeamId || assignment.teamId === match.awayTeamId)); const determined = sourceGroupMatches.length > 0 && sourceGroupMatches.every((match) => results.has(match.id)); const teamId = standingsFor(source.groupId)[source.groupRank - 1]?.teamId; return <span key={`${source.groupId}:${source.groupRank}`}>{source.groupRank === 1 ? "Nhất" : source.groupRank === 2 ? "Nhì" : `Hạng ${source.groupRank}`} {publishedGroups.find((group) => group.id === source.groupId)?.name ?? "bảng"} · {determined && teamId ? teamById.get(teamId)?.name ?? "Đang xác định" : "Chờ xác định"}</span>; })}</div><small>Suất được xác định theo thứ hạng chính thức, không theo mã vị trí phân bổ.</small></section> : null}
          </> : null}
        </> : null}
        {knockoutStages.length && fixtures && fixtures.bracket.length ? <div className="public-knockout-bracket"><header><span className="eyebrow">CÂY THI ĐẤU</span><strong>{fixtures.bracket.filter((slot) => slot.status === "BYE").length} suất BYE</strong></header><div className="public-knockout-rounds">{[...new Set(fixtures.bracket.map((slot) => slot.roundNumber))].sort((a, b) => a - b).map((round) => <section key={round}><h4>{round === Math.max(...fixtures.bracket.map((slot) => slot.roundNumber)) ? "Chung kết" : `Vòng ${round}`}</h4>{fixtures.bracket.filter((slot) => slot.roundNumber === round).map((slot) => <article className={`public-knockout-card ${slot.status === "BYE" ? "is-bye" : ""}`} key={slot.id}><header><strong>{slot.slotType === "THIRD_PLACE" ? "Tranh hạng ba" : slot.status === "BYE" ? "Suất BYE" : `Trận ${slot.position}`}</strong></header>{slot.status === "BYE" ? <>{teamIdentity(slot.homeTeamId ?? slot.awayTeamId)}<small>Được miễn thi đấu vòng này</small></> : <><div>{teamIdentity(slot.homeTeamId, slot.homeQualification)}</div><b>VS</b><div>{teamIdentity(slot.awayTeamId, slot.awayQualification)}</div>{slot.matchId ? <small>{publicMatchStatusLabel(fixtures.stages.flatMap((stage) => stage.matches).find((match) => match.id === slot.matchId)?.status ?? "SCHEDULED")}</small> : null}</>}</article>)}</section>)}</div></div> : null}
      </> : null}
      {format === "ROUND_ROBIN" && groupStages.length ? <section className="public-group-standings"><header><div><span className="eyebrow">BẢNG XẾP HẠNG</span><h4>Kết quả vòng tròn</h4></div><span className="status-pill">Chỉ đọc</span></header>{fixtureStandingsError ? <p className="public-data-error" role="alert">{fixtureStandingsError}</p> : fixtureStandingsLoading ? <p className="muted" role="status">Đang tải bảng xếp hạng chính thức…</p> : null}<div className="public-group-standings-grid">{publishedGroups.map((group) => <article key={group.id}><h5>{group.name}</h5><div className="public-standing-wrap"><table><thead><tr><th>Hạng</th><th>Đội</th><th>Tr</th><th>T</th><th>H</th><th>B</th><th>BT</th><th>BB</th><th>HS</th><th>Điểm</th></tr></thead><tbody>{standingsFor(group.id).map((row) => <tr key={row.teamId}><td>{row.groupRank > 0 ? row.groupRank : "—"}</td><td>{teamIdentity(row.teamId)}</td><td>{row.played}</td><td>{row.won}</td><td>{row.drawn}</td><td>{row.lost}</td><td>{row.goalsFor}</td><td>{row.goalsAgainst}</td><td>{row.goalDifference}</td><td><strong>{row.points}</strong></td></tr>)}</tbody></table>{!fixtureStandingsLoading && !fixtureStandingsError && standingsFor(group.id).length === 0 ? <p className="muted">Chưa có bảng xếp hạng được trả về từ dữ liệu chính thức.</p> : null}</div></article>)}</div><small>Kết quả chỉ tính từ tỷ số đã được BTC công nhận.</small></section> : null}
    </section>

    <Modal open={viewerOpen} onClose={() => setViewerOpen(false)} eyebrow="THEO DÕI CÔNG KHAI" title={liveDraw?.eventName ?? "Bốc thăm trực tiếp"} description="Bản xem chỉ đọc. Trạng thái và các lượt đã ghi nhận được đồng bộ từ máy chủ." className="public-live-draw-modal">
      {liveViewer()}
    </Modal>
    </>}
    <Modal open={teamDetailLoading || Boolean(teamDetailError) || Boolean(teamDetail)} onClose={() => { setTeamDetail(null); setTeamDetailError(null); }} eyebrow="HỒ SƠ ĐỘI BÓNG" title={teamDetail?.team.name ?? "Thông tin đội"} description="Thông tin công khai của đội đã được công bố trong giải." className="public-team-draw-modal">
      {teamDetailLoading ? <p role="status">Đang tải hồ sơ đội…</p> : teamDetailError ? <p className="form-error" role="alert">{teamDetailError}</p> : teamDetail ? <div className="public-team-draw-detail"><div className="public-team-draw-heading">{teamDetail.team.logoUrl ? <img src={teamDetail.team.logoUrl} alt="" /> : <span>{teamDetail.team.name.slice(0, 2).toLocaleUpperCase("vi")}</span>}<div><strong>{teamDetail.team.name}</strong><small>{teamDetail.team.institutionName ?? "Chưa liên kết trường"}{teamDetail.team.unitName ? ` · ${teamDetail.team.unitName}` : ""}</small></div></div><div className="public-team-draw-facts"><span>Đại diện CLB <strong>{teamDetail.team.representativeName ?? "Chưa công khai"}</strong></span><span>Quân số công khai <strong>{teamDetail.players.length} cầu thủ</strong></span></div>{teamDetail.players.length ? <ul>{teamDetail.players.map((player) => <li key={player.id}><span>{player.fullName ?? "Cầu thủ"}</span><small>{player.teamRole === "CAPTAIN" ? "Đội trưởng" : "Thành viên"} · {player.jerseyNumber ? `#${player.jerseyNumber}` : "Chưa có số áo"} · {player.position ?? "Chưa cập nhật vị trí"}</small></li>)}</ul> : <p>Danh sách cầu thủ chưa được công khai.</p>}</div> : null}
    </Modal>
  </>;
}
