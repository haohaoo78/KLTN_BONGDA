import { useEffect, useMemo, useRef, useState } from "react";
import { API_BASE } from "../api/client";
import {
  getLiveMatches,
  getAllMatches,
  getPublicMatchLiveState,
  type LiveMatchSummary,
  type Match,
  type PublicMatchLiveState,
  type Tournament,
} from "../api/competition";

type StatusFilter = "ALL" | "LIVE" | "UPCOMING" | "FINISHED";

function teamName(teamId: string | null, names: Map<string, string>): string {
  if (!teamId) return "Chưa xác định";
  return names.get(teamId) ?? `Đội ${teamId.slice(0, 6).toUpperCase()}`;
}

function statusText(status: string): string {
  const labels: Record<string, string> = {
    SCHEDULED: "Sắp diễn ra", LINEUP_CONFIRMED: "Đã xác nhận đội hình",
    IN_PROGRESS: "Đang diễn ra", FINISHED: "Chờ xác nhận kết quả", VERIFIED: "Kết quả chính thức",
    LOCKED: "Đã khóa", POSTPONED: "Tạm hoãn", CANCELLED: "Đã hủy", UNSCHEDULED: "Chưa xếp lịch",
  };
  return labels[status] ?? status.replaceAll("_", " ");
}

function eventLabel(eventType: string): string {
  const labels: Record<string, string> = {
    GOAL: "Bàn thắng", PENALTY_GOAL: "Bàn thắng · phạt đền", OWN_GOAL: "Phản lưới nhà",
    YELLOW_CARD: "Thẻ vàng", RED_CARD: "Thẻ đỏ", SUBSTITUTION_IN: "Vào sân", SUBSTITUTION_OUT: "Rời sân",
  };
  return labels[eventType] ?? eventType.replaceAll("_", " ");
}

function positionLabel(position: string | null): string {
  const labels: Record<string, string> = { GK: "Thủ môn", DEF: "Hậu vệ", MID: "Tiền vệ", FWD: "Tiền đạo" };
  return position ? labels[position] ?? position : "";
}

function phaseText(phase: string | null): string {
  const labels: Record<string, string> = {
    FIRST_HALF: "Hiệp 1", HALF_TIME: "Nghỉ giữa hiệp", SECOND_HALF: "Hiệp 2",
    REGULATION_COMPLETE: "Hết giờ", EXTRA_TIME_FIRST_HALF: "Hiệp phụ 1", EXTRA_TIME_HALF_TIME: "Nghỉ hiệp phụ",
    EXTRA_TIME_SECOND_HALF: "Hiệp phụ 2", EXTRA_TIME_COMPLETE: "Hết hiệp phụ", PENALTIES: "Luân lưu", ENDED: "FT",
  };
  return phase ? labels[phase] ?? phase : "Chưa bắt đầu";
}

function formatKickoff(value: string | null): string {
  if (!value) return "Chưa xếp giờ";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Chưa xếp giờ" : date.toLocaleString("vi-VN", { dateStyle: "medium", timeStyle: "short" });
}

function liveScore(state: PublicMatchLiveState | null, summary?: LiveMatchSummary): [number, number] | null {
  if (state?.result) return [state.result.homeScore, state.result.awayScore];
  if (summary) return [summary.homeScore, summary.awayScore];
  if (!state || state.match.status !== "IN_PROGRESS") return null;
  let home = 0; let away = 0;
  for (const event of state.events) {
    if (event.eventType === "GOAL" || event.eventType === "PENALTY_GOAL") {
      if (event.teamId === state.match.homeTeamId) home++; else if (event.teamId === state.match.awayTeamId) away++;
    } else if (event.eventType === "OWN_GOAL") {
      if (event.teamId === state.match.homeTeamId) away++; else if (event.teamId === state.match.awayTeamId) home++;
    }
  }
  return [home, away];
}

export function LiveMatchCenterPanel(props: { tournaments: Tournament[]; teamNames: Map<string, string>; returnPath: string }) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [live, setLive] = useState<LiveMatchSummary[]>([]);
  const [selectedId, setSelectedId] = useState(() => window.location.pathname.match(/^\/matches\/([^/]+)\/?$/)?.[1] ?? "");
  const [detail, setDetail] = useState<PublicMatchLiveState | null>(null);
  const [detailError, setDetailError] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [liveFeedConnected, setLiveFeedConnected] = useState(false);
  const [search, setSearch] = useState("");
  const [tournamentFilter, setTournamentFilter] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [clockNow, setClockNow] = useState(Date.now());
  const refreshTimer = useRef<number | null>(null);
  const feedRefreshTimer = useRef<number | null>(null);

  function openMatch(matchId: string) {
    if (!/^\/[a-z]+\/?$/i.test(window.location.pathname) && window.location.pathname !== "/") return;
    window.history.replaceState({ ...(window.history.state ?? {}), section: "matches" }, "", window.location.href);
    window.history.pushState({ returnPath: props.returnPath }, "", `/matches/${encodeURIComponent(matchId)}`);
    setSelectedId(matchId);
  }

  function closeMatch() {
    if (window.history.state?.returnPath) window.history.back();
    else window.history.replaceState({}, "", props.returnPath);
    setSelectedId("");
  }

  useEffect(() => {
    const onPopState = () => setSelectedId(window.location.pathname.match(/^\/matches\/([^/]+)\/?$/)?.[1] ?? "");
    const tick = window.setInterval(() => setClockNow(Date.now()), 1000);
    window.addEventListener("popstate", onPopState);
    return () => { window.clearInterval(tick); window.removeEventListener("popstate", onPopState); };
  }, []);

  async function reloadMatches() {
    const visibleTournaments = props.tournaments.filter((tournament) => tournament.status !== "DRAFT");
    const listResults = await Promise.allSettled(visibleTournaments.map((tournament) => getAllMatches(tournament.id)));
    const all = listResults.flatMap((result) => result.status === "fulfilled" ? result.value.items : []);
    setMatches(all.sort((a, b) => (a.matchDate ?? "9999").localeCompare(b.matchDate ?? "9999")));
    const liveResult = await getLiveMatches();
    setLive(liveResult.items);
  }

  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    Promise.all([
      Promise.allSettled(props.tournaments.filter((tournament) => tournament.status !== "DRAFT").map((tournament) => getAllMatches(tournament.id))),
      getLiveMatches(),
    ]).then(([results, currentLive]) => {
      if (!active) return;
      const all = results.flatMap((result) => result.status === "fulfilled" ? result.value.items : []);
      setMatches(all.sort((a, b) => (a.matchDate ?? "9999").localeCompare(b.matchDate ?? "9999")));
      setLive(currentLive.items);
      if (results.length && results.every((result) => result.status === "rejected")) setError("Không tải được lịch thi đấu. Vui lòng thử tải lại.");
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "Không tải được trận đang diễn ra.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [props.tournaments]);

  useEffect(() => {
    const stream = new EventSource(`${API_BASE}/matches/live/stream`, { withCredentials: true });
    const scheduleRefresh = () => {
      if (feedRefreshTimer.current !== null) window.clearTimeout(feedRefreshTimer.current);
      feedRefreshTimer.current = window.setTimeout(() => {
        feedRefreshTimer.current = null;
        void reloadMatches().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Không đồng bộ được bảng trận đang diễn ra."));
      }, 300);
    };
    stream.onopen = () => { setLiveFeedConnected(true); scheduleRefresh(); };
    stream.addEventListener("match-update", scheduleRefresh);
    stream.onerror = () => setLiveFeedConnected(false);
    return () => { stream.close(); if (feedRefreshTimer.current !== null) window.clearTimeout(feedRefreshTimer.current); };
  }, [props.tournaments]);

  useEffect(() => {
    if (!selectedId) { setDetail(null); setDetailError(""); setConnected(false); return; }
    let active = true;
    setDetailError("");
    const refreshDetail = async () => {
      try {
        const state = await getPublicMatchLiveState(selectedId);
        if (active) { setDetail(state); setDetailError(""); }
      } catch (reason) {
        if (active) setDetailError(reason instanceof Error ? reason.message : "Không tải được chi tiết trận.");
      } finally { if (active) setDetailLoading(false); }
    };
    setDetailLoading(true); void refreshDetail();
    const stream = new EventSource(`${API_BASE}/matches/${encodeURIComponent(selectedId)}/stream`, { withCredentials: true });
    const scheduleRefresh = () => {
      void refreshDetail();
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
      refreshTimer.current = window.setTimeout(() => { refreshTimer.current = null; void reloadMatches().catch(() => undefined); }, 350);
    };
    stream.onopen = () => { setConnected(true); scheduleRefresh(); };
    stream.addEventListener("match-update", scheduleRefresh);
    stream.addEventListener("sync-required", () => { void refreshDetail(); });
    stream.onerror = () => setConnected(false);
    return () => { active = false; stream.close(); if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current); };
  }, [selectedId]);

  const tournamentById = useMemo(() => new Map(props.tournaments.map((tournament) => [tournament.id, tournament])), [props.tournaments]);
  const liveById = useMemo(() => new Map(live.map((item) => [item.id, item])), [live]);
  const filtered = useMemo(() => matches.filter((match) => {
    const query = search.trim().toLocaleLowerCase("vi-VN");
    const tournamentName = tournamentById.get(match.tournamentId)?.name ?? "";
    const home = teamName(match.homeTeamId, props.teamNames);
    const away = teamName(match.awayTeamId, props.teamNames);
    const matchesQuery = !query || `${tournamentName} ${home} ${away} ${match.round ?? ""}`.toLocaleLowerCase("vi-VN").includes(query);
    const inStatus = statusFilter === "ALL" || statusFilter === "LIVE" && match.status === "IN_PROGRESS" || statusFilter === "UPCOMING" && ["SCHEDULED", "LINEUP_CONFIRMED"].includes(match.status) || statusFilter === "FINISHED" && ["FINISHED", "VERIFIED", "LOCKED"].includes(match.status);
    return matchesQuery && inStatus && (!tournamentFilter || match.tournamentId === tournamentFilter)
      && (!teamFilter || match.homeTeamId === teamFilter || match.awayTeamId === teamFilter)
      && (!dateFilter || Boolean(match.matchDate?.startsWith(dateFilter)));
  }), [matches, search, statusFilter, tournamentFilter, teamFilter, dateFilter, tournamentById, props.teamNames]);

  const teamOptions = useMemo(() => [...new Set(matches.flatMap((match) => [match.homeTeamId, match.awayTeamId]).filter((id): id is string => Boolean(id)))], [matches]);
  const selectedMatch = detail?.match ?? matches.find((match) => match.id === selectedId) ?? null;
  const score = liveScore(detail, selectedId ? liveById.get(selectedId) : undefined);

  return <section className="live-match-center">
    <div className="live-center-heading"><div><span className="eyebrow">THEO DÕI MÙA GIẢI</span><h2>LỊCH THI ĐẤU & KẾT QUẢ</h2><p>Thông tin trận đấu công khai được đồng bộ trực tiếp từ Match Service.</p><span className={liveFeedConnected ? "live-feed-status connected" : "live-feed-status"}>{liveFeedConnected ? "● Dữ liệu trực tiếp đang kết nối" : "○ Đang kết nối dữ liệu trực tiếp…"}</span></div><button className="button button-secondary" type="button" disabled={loading} onClick={() => { setLoading(true); void reloadMatches().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Không tải được lịch.")).finally(() => setLoading(false)); }}>Tải lại</button></div>
    <div className="live-center-tabs" role="tablist" aria-label="Lọc trạng thái trận">{([["ALL", "Tất cả"], ["LIVE", "Đang diễn ra"], ["UPCOMING", "Sắp diễn ra"], ["FINISHED", "Đã kết thúc"]] as const).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={statusFilter === value} className={statusFilter === value ? "active" : ""} onClick={() => setStatusFilter(value)}>{label}</button>)}</div>
    {live.length ? <section className="live-now-section"><div className="panel-heading"><div><span className="live-now-indicator">● LIVE NOW</span><h3>Trận đang diễn ra</h3></div><span className="status-pill">{live.length} trận</span></div><div className="live-match-grid">{live.map((match) => { const tournament = tournamentById.get(match.tournamentId); const elapsed = match.elapsedSeconds + (match.isClockRunning && match.clockStartedAt ? Math.max(0, Math.floor((clockNow - new Date(match.clockStartedAt).getTime()) / 1000)) : 0); return <button className="live-match-card" type="button" key={match.id} onClick={() => openMatch(match.id)}><div className="live-match-card-meta"><span>{tournament?.name ?? "Giải đấu"}</span><b>LIVE</b></div><span className="live-match-round">{match.round || "Trận đấu"} · {phaseText(match.clockPhase)} · {Math.floor(elapsed / 60)}′</span><div className="live-match-score"><span>{teamName(match.homeTeamId, props.teamNames)}</span><strong>{match.homeScore} : {match.awayScore}</strong><span>{teamName(match.awayTeamId, props.teamNames)}</span></div><small>{match.venue || "Sân chưa cập nhật"} · Theo dõi trực tiếp ↗</small></button>; })}</div></section> : <div className="live-empty-banner"><b>Hiện chưa có trận đấu đang diễn ra</b><span>Khi trọng tài bắt đầu trận, tỷ số trực tiếp sẽ xuất hiện tại đây.</span></div>}
    <div className="live-match-filters"><label className="field">Tìm giải, đội hoặc vòng<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nhập tên cần tìm" /></label><label className="field">Giải đấu<select value={tournamentFilter} onChange={(event) => setTournamentFilter(event.target.value)}><option value="">Tất cả giải công khai</option>{props.tournaments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="field">Đội bóng<select value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)}><option value="">Tất cả đội</option>{teamOptions.map((id) => <option key={id} value={id}>{teamName(id, props.teamNames)}</option>)}</select></label><label className="field">Ngày<input type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} /></label><button type="button" className="text-button" onClick={() => { setSearch(""); setTournamentFilter(""); setTeamFilter(""); setDateFilter(""); setStatusFilter("ALL"); }}>Xóa bộ lọc</button></div>
    {error ? <div className="inline-error" role="alert">{error}</div> : null}
    {loading ? <div className="live-center-loading" aria-label="Đang tải lịch">Đang tải lịch thi đấu…</div> : filtered.length ? <div className="live-fixture-list">{filtered.map((match) => { const currentLive = liveById.get(match.id); const tournament = tournamentById.get(match.tournamentId); const currentScore = currentLive ? [currentLive.homeScore, currentLive.awayScore] as const : null; return <button className="live-fixture-row" type="button" key={match.id} onClick={() => openMatch(match.id)}><time>{formatKickoff(match.matchDate)}</time><span className="live-fixture-event"><small>{tournament?.name ?? "Giải đấu"} · {match.round || "Vòng đấu"}</small><strong>{teamName(match.homeTeamId, props.teamNames)} <i>vs</i> {teamName(match.awayTeamId, props.teamNames)}</strong><small>{match.venue || "Chưa xếp sân"}</small></span><b className={currentLive ? "live-fixture-score is-live" : "live-fixture-score"}>{currentScore ? `${currentScore[0]} – ${currentScore[1]}` : match.status === "SCHEDULED" ? "VS" : statusText(match.status)}</b><span className={`status-pill status-${match.status.toLowerCase()}`}>{currentLive ? "LIVE" : statusText(match.status)}</span></button>; })}</div> : <div className="live-empty-banner"><b>Không có trận phù hợp</b><span>Hãy đổi trạng thái, ngày hoặc bộ lọc tìm kiếm.</span></div>}
    {selectedId ? <div className="live-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeMatch(); }}><section className="live-detail-dialog" role="dialog" aria-modal="true" aria-label="Chi tiết trận đấu"><button className="live-detail-close" type="button" aria-label="Đóng chi tiết trận" onClick={closeMatch}>×</button>{detailLoading && !detail ? <div className="live-center-loading">Đang tải trận đấu…</div> : detailError && !selectedMatch ? <div className="live-detail-empty" role="alert">{detailError}<p><button className="button button-secondary" type="button" onClick={() => { setDetailLoading(true); setDetailError(""); void getPublicMatchLiveState(selectedId).then(setDetail).catch((reason: unknown) => setDetailError(reason instanceof Error ? reason.message : "Không tải được chi tiết trận.")).finally(() => setDetailLoading(false)); }}>Thử lại</button></p></div> : selectedMatch ? <>
      <header className={`live-detail-scoreboard ${selectedMatch.status === "IN_PROGRESS" ? "is-live" : ""}`}><span className="eyebrow">{tournamentById.get(selectedMatch.tournamentId)?.name ?? "Giải đấu"} · {selectedMatch.round ?? "Trận đấu"}</span><div className="live-detail-teams"><div><strong>{teamName(selectedMatch.homeTeamId, props.teamNames)}</strong></div><div className="live-detail-result">{score ? `${score[0]} – ${score[1]}` : selectedMatch.status === "SCHEDULED" || selectedMatch.status === "LINEUP_CONFIRMED" ? "VS" : selectedMatch.status === "FINISHED" ? "Chờ duyệt" : "—"}<small>{selectedMatch.status === "IN_PROGRESS" ? `${phaseText(detail?.clock?.phase ?? null)} · ${Math.floor(((detail?.clock?.elapsedSeconds ?? 0) + (detail?.clock?.isRunning && detail.clock.startedAt ? Math.max(0, (clockNow - new Date(detail.clock.startedAt).getTime()) / 1000) : 0)) / 60)}′` : statusText(selectedMatch.status)}</small></div><div><strong>{teamName(selectedMatch.awayTeamId, props.teamNames)}</strong></div></div><p>{formatKickoff(selectedMatch.matchDate)} · {selectedMatch.venue || "Chưa cập nhật sân"}</p><span className={connected ? "live-connection connected" : "live-connection"}>{connected ? "Cập nhật trực tiếp đang kết nối" : "Đang nối lại cập nhật trực tiếp…"}</span></header>
      {detail?.provisionalResult ? <p className="live-provisional-note">Tỷ số đang chờ xác nhận; chưa được tính vào bảng xếp hạng chính thức.</p> : null}
      <div className="live-detail-tabs"><section><h3>Diễn biến trận</h3>{detail?.events.length ? <><div className="live-event-stats">{([ ["⚽", "Bàn thắng", detail.events.filter((event) => ["GOAL", "PENALTY_GOAL", "OWN_GOAL"].includes(event.eventType)).length], ["🟨", "Thẻ vàng", detail.events.filter((event) => event.eventType === "YELLOW_CARD").length], ["🟥", "Thẻ đỏ", detail.events.filter((event) => event.eventType === "RED_CARD").length], ["↔", "Thay người", detail.events.filter((event) => event.eventType === "SUBSTITUTION_IN").length] ] as const).map(([icon, label, count]) => <div key={label}><span>{icon}</span><strong>{count}</strong><small>{label}</small></div>)}</div><ol className="live-timeline">{[...detail.events].sort((a, b) => (a.minute ?? 0) - (b.minute ?? 0) || a.createdAt.localeCompare(b.createdAt)).map((event) => <li key={event.id}><time>{event.minute ?? "—"}′</time><div><strong>{eventLabel(event.eventType)}</strong><span>{teamName(event.teamId, props.teamNames)}{event.playerId ? " · Cầu thủ" : ""}</span>{event.description ? <small>{event.description}</small> : null}</div></li>)}</ol></> : <p className="live-detail-empty">Chưa có diễn biến được ghi nhận.</p>}</section><section><h3>Đội hình</h3>{detail?.lineups.length ? <div className="live-lineups">{[selectedMatch.homeTeamId, selectedMatch.awayTeamId].filter((id): id is string => Boolean(id)).map((teamId) => <div key={teamId}><h4>{teamName(teamId, props.teamNames)}</h4><p>Đá chính</p><ul>{detail.lineups.filter((lineup) => lineup.teamId === teamId && lineup.isStarting).map((lineup) => <li key={lineup.id}>{lineup.jerseyNumber ? `#${lineup.jerseyNumber} · ` : ""}Cầu thủ{lineup.position ? ` · ${positionLabel(lineup.position)}` : ""}</li>)}</ul><p>Dự bị</p><ul>{detail.lineups.filter((lineup) => lineup.teamId === teamId && !lineup.isStarting).map((lineup) => <li key={lineup.id}>{lineup.jerseyNumber ? `#${lineup.jerseyNumber} · ` : ""}Cầu thủ{lineup.position ? ` · ${positionLabel(lineup.position)}` : ""}</li>)}</ul></div>)}</div> : <p className="live-detail-empty">Đội hình chưa được công bố.</p>}</section></div>
    </> : null}</section></div> : null}
  </section>;
}
