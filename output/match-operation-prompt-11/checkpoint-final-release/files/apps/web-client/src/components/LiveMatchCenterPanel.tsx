import { MatchSquadEditor } from "./MatchSquadEditor";
import { PublicMatchDetailView } from "./PublicMatchDetailView";
import { Modal } from "./Modal";
import { useEffect, useMemo, useRef, useState } from "react";
import {clockElapsedMilliseconds,compareMatchEventTiming,eventTimeLabel} from "../../../../packages/shared/src/matchTiming";
import { API_BASE } from "../api/client";
import {
  getLiveMatches,
  getPublicTournamentFixtures,
  getPublicTournamentSchedules,
  getPublishedTournamentTeams,
  getPublicMatchLiveState,
  getMatchResult,
  getPublicTeamDetail,
  getPublicFixtureGroupStandings,
  type LiveMatchSummary,
  type Match,
  type PublicMatchLiveState,
  type PublicMatchResult,
  type Tournament,
  type FixtureGroupStandings,
  type PublicFixtureBundle,
  type PublicTeamPlayer,
} from "../api/competition";

type StatusFilter = "ALL" | "LIVE" | "UPCOMING" | "FINISHED";

function teamName(teamId: string | null, names: Map<string, string>): string {
  if (!teamId) return "Chưa xác định";
  return names.get(teamId) ?? "Đang cập nhật thông tin đội";
}
function TeamIdentity({ id, names, logos }: { id: string | null; names: Map<string, string>; logos: Map<string, string | null> }) {
  const name = teamName(id, names);
  const logo = id ? logos.get(id) : null;
  return <span className="live-team-identity">{logo ? <img src={logo} alt="" loading="lazy" /> : null}<span>{name}</span></span>;
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
    YELLOW_CARD: "Thẻ vàng", SECOND_YELLOW_CARD:"Thẻ vàng thứ hai · truất quyền", RED_CARD: "Thẻ đỏ", SUBSTITUTION_IN: "Vào sân", SUBSTITUTION_OUT: "Thay người",REPLACEMENT_IN:"Bổ sung người sau truất quyền",INJURY:"Chấn thương",PLAYER_LEAVE:"Rời sân tạm thời",PLAYER_RETURN:"Trở lại sân",INCIDENT:"Sự cố",
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
  if (state?.result) return [state.result.homeScore+(state.result.homeExtraTimeScore??0), state.result.awayScore+(state.result.awayExtraTimeScore??0)];
  if(state?.stageScores&&(state.clock?.actualStartedAt||["IN_PROGRESS","FINISHED","VERIFIED","LOCKED"].includes(state.match.status)))return [state.stageScores.total.home,state.stageScores.total.away];
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

export function LiveMatchCenterPanel(props: { tournaments: Tournament[]; teamNames: Map<string, string>; returnPath: string; captainTeamIds?: string[]; scopeTeamIds?: string[] }) {
  const [squadTarget,setSquadTarget]=useState<{matchId:string;teamId:string}|null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [live, setLive] = useState<LiveMatchSummary[]>([]);
  const [approvedResults, setApprovedResults] = useState<Map<string, PublicMatchResult>>(new Map());
  const [pitchScores,setPitchScores]=useState<Map<string,{home:number;away:number}>>(new Map());
  const [officialTeamNames, setOfficialTeamNames] = useState<Map<string, string>>(new Map());
  const [officialTeamLogos, setOfficialTeamLogos] = useState<Map<string, string | null>>(new Map());
  const [publicPlayers, setPublicPlayers] = useState<Map<string, PublicTeamPlayer>>(new Map());
  const [selectedId, setSelectedId] = useState(() => window.location.pathname.match(/^\/matches\/([^/]+)\/?$/)?.[1] ?? "");
  const [detail, setDetail] = useState<PublicMatchLiveState | null>(null);
  const detailRef=useRef<PublicMatchLiveState|null>(null);
  useEffect(()=>{detailRef.current=detail;},[detail]);
  const [detailFixtures,setDetailFixtures]=useState<PublicFixtureBundle|null>(null);
  const [detailStandings,setDetailStandings]=useState<FixtureGroupStandings|null>(null);
  const [highlightEventId,setHighlightEventId]=useState<string|null>(null);
  const [detailRetry,setDetailRetry]=useState(0);
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
  const [groupFilter, setGroupFilter] = useState("");
  const [roundFilter, setRoundFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [clockNow, setClockNow] = useState(Date.now());
  const refreshTimer = useRef<number | null>(null);
  const feedRefreshTimer = useRef<number | null>(null);
  const detailRequest = useRef(0);

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
    const listResults = await Promise.allSettled(visibleTournaments.map(async (tournament) => {
      const [fixtures, scheduleResult, teamResult] = await Promise.all([
        getPublicTournamentFixtures(tournament.id), getPublicTournamentSchedules(tournament.id), getPublishedTournamentTeams(tournament.id),
      ]);
      const schedules = new Map(scheduleResult.schedules.filter((item) => item.status === "PUBLISHED").map((item) => [item.matchId, item]));
      const fixturesOnly = fixtures.stages.flatMap((stage) => stage.matches).filter((match) => schedules.has(match.id)
        && (props.scopeTeamIds === undefined || props.scopeTeamIds.includes(match.homeTeamId ?? "") || props.scopeTeamIds.includes(match.awayTeamId ?? "")));
      return { items: fixturesOnly.map((match) => ({ ...match, matchDate: schedules.get(match.id)!.scheduledDate, venue: match.venue || schedules.get(match.id)!.venueName || null })), teams: teamResult.teams };
    }));
    const all = listResults.flatMap((result) => result.status === "fulfilled" ? result.value.items : []);
    const teams = listResults.flatMap((result) => result.status === "fulfilled" ? result.value.teams : []);
    setOfficialTeamNames(new Map(teams.map((team) => [team.id, team.name])));
    setOfficialTeamLogos(new Map(teams.map((team) => [team.id, team.logoUrl])));
    setMatches(all.sort((a, b) => (a.matchDate ?? "9999").localeCompare(b.matchDate ?? "9999")));
    const officialResults = await Promise.all(all.filter((item) => ["FINISHED", "VERIFIED", "LOCKED"].includes(item.status)).map(async (item) => {
      const projection = await getMatchResult(item.id).catch(() => ({ result: null,pitchScore:null }));
      return {id:item.id,result:projection.result,pitchScore:projection.pitchScore??null};
    }));
    const approvedMap=new Map<string,PublicMatchResult>(),pitchMap=new Map<string,{home:number;away:number}>();
    for(const item of officialResults){if(item.result?.status==="APPROVED")approvedMap.set(item.id,item.result);else if(item.pitchScore)pitchMap.set(item.id,item.pitchScore);}
    setApprovedResults(approvedMap);setPitchScores(pitchMap);
    const liveResult = await getLiveMatches();
    const publishedMatchIds = new Set(all.map((item) => item.id));
    setLive(liveResult.items.filter((item) => publishedMatchIds.has(item.id)));
  }

  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    Promise.all([
      Promise.allSettled(props.tournaments.filter((tournament) => tournament.status !== "DRAFT").map(async (tournament) => {
        const [fixtures, scheduleResult, teamResult] = await Promise.all([
          getPublicTournamentFixtures(tournament.id), getPublicTournamentSchedules(tournament.id), getPublishedTournamentTeams(tournament.id),
        ]);
        const schedules = new Map(scheduleResult.schedules.filter((item) => item.status === "PUBLISHED").map((item) => [item.matchId, item]));
        const items = fixtures.stages.flatMap((stage) => stage.matches).filter((match) => schedules.has(match.id)
          && (props.scopeTeamIds === undefined || props.scopeTeamIds.includes(match.homeTeamId ?? "") || props.scopeTeamIds.includes(match.awayTeamId ?? "")))
          .map((match) => ({ ...match, matchDate: schedules.get(match.id)!.scheduledDate, venue: match.venue || schedules.get(match.id)!.venueName || null }));
        return { items, teams: teamResult.teams };
      })),
      getLiveMatches(),
    ]).then(([results, currentLive]) => {
      if (!active) return;
      const all = results.flatMap((result) => result.status === "fulfilled" ? result.value.items : []);
      const teams = results.flatMap((result) => result.status === "fulfilled" ? result.value.teams : []);
      setOfficialTeamNames(new Map(teams.map((team) => [team.id, team.name])));
      setOfficialTeamLogos(new Map(teams.map((team) => [team.id, team.logoUrl])));
      setMatches(all.sort((a, b) => (a.matchDate ?? "9999").localeCompare(b.matchDate ?? "9999")));
      void Promise.all(all.filter((item) => ["FINISHED", "VERIFIED", "LOCKED"].includes(item.status)).map(async (item) => {
        const projection=await getMatchResult(item.id).catch(()=>({result:null,pitchScore:null}));return{id:item.id,result:projection.result,pitchScore:projection.pitchScore??null};
      })).then((loaded) => { if (active){const approvedMap=new Map<string,PublicMatchResult>(),pitchMap=new Map<string,{home:number;away:number}>();for(const item of loaded){if(item.result?.status==="APPROVED")approvedMap.set(item.id,item.result);else if(item.pitchScore)pitchMap.set(item.id,item.pitchScore);}setApprovedResults(approvedMap);setPitchScores(pitchMap);} });
      const publishedMatchIds = new Set(all.map((item) => item.id));
      setLive(currentLive.items.filter((item) => publishedMatchIds.has(item.id)));
      if (results.length && results.every((result) => result.status === "rejected")) setError("Không tải được lịch thi đấu. Vui lòng thử tải lại.");
      else if (results.some((result) => result.status === "rejected")) setError("Một số giải chưa tải được lịch đã công bố. Các giải còn lại vẫn hiển thị theo dữ liệu máy chủ.");
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "Không tải được trận đang diễn ra.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [props.tournaments, props.scopeTeamIds]);

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
    stream.addEventListener("sync-required", scheduleRefresh);
    stream.onerror = () => setLiveFeedConnected(false);
    const poll=window.setInterval(()=>{if(stream.readyState!==EventSource.OPEN)scheduleRefresh();},30000);
    return () => { stream.close();window.clearInterval(poll); if (feedRefreshTimer.current !== null) window.clearTimeout(feedRefreshTimer.current); };
  }, [props.tournaments, props.scopeTeamIds]);

  useEffect(() => {
    if (!selectedId) { setDetail(null); setDetailError(""); setConnected(false); return; }
    let active = true,stream:EventSource|null=null,detailPoll:number|null=null;
    setDetailError("");
    const connect=(cursor:string)=>{
      stream?.close();const url=new URL(`${API_BASE}/matches/${encodeURIComponent(selectedId)}/stream`,window.location.origin);url.searchParams.set("after",cursor);
      stream=new EventSource(url.toString(),{withCredentials:true});
      const schedule=()=>{if(refreshTimer.current!==null)window.clearTimeout(refreshTimer.current);refreshTimer.current=window.setTimeout(()=>{refreshTimer.current=null;void refreshDetail(false);void reloadMatches().catch(()=>undefined);},180);};
      stream.onopen=()=>setConnected(true);stream.addEventListener("match-update",schedule);stream.addEventListener("sync-required",()=>void refreshDetail(true));
      stream.addEventListener("access-revoked",()=>{setConnected(false);setDetailError("Trận không còn được công khai.");stream?.close();});stream.onerror=()=>setConnected(false);
    };
    const refreshDetail = async (reopen:boolean) => {
      const request=++detailRequest.current;
      try {
        const state=await getPublicMatchLiveState(selectedId),tournamentId=state.match.tournamentId;
        const tournament=props.tournaments.find(t=>t.id===tournamentId);
        const [fixtures,standings]=await Promise.all([
          getPublicTournamentFixtures(tournamentId).catch(()=>null),
          tournament&&tournament.competitionFormat!=="KNOCKOUT"?getPublicFixtureGroupStandings(tournamentId).catch(()=>null):Promise.resolve(null),
        ]);
        if (active&&request===detailRequest.current) {
          const prior=detailRef.current,priorIds=new Set(prior?.events.map(e=>e.id)??[]),added=state.events.filter(e=>!priorIds.has(e.id));
          setDetail(state);setDetailFixtures(fixtures);setDetailStandings(standings);setDetailError("");
          if(added.length)setHighlightEventId(added.at(-1)!.id);
          if(reopen)connect(state.realtimeCursor);
        }
      } catch (reason) {
        if (active&&request===detailRequest.current) setDetailError(reason instanceof Error ? reason.message : "Không tải được chi tiết trận.");
      } finally { if (active) setDetailLoading(false); }
    };
    setDetailLoading(true);void refreshDetail(true);
    detailPoll=window.setInterval(()=>{if(!stream||stream.readyState!==EventSource.OPEN)void refreshDetail(true);},30000);
    return () => { active = false;stream?.close();if(detailPoll!==null)window.clearInterval(detailPoll); if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current); };
  }, [selectedId,detailRetry]);

  const tournamentById = useMemo(() => new Map(props.tournaments.map((tournament) => [tournament.id, tournament])), [props.tournaments]);
  const identityNames = useMemo(() => new Map([...props.teamNames, ...officialTeamNames]), [props.teamNames, officialTeamNames]);
  const identityLogos = officialTeamLogos;
  const liveById = useMemo(() => new Map(live.map((item) => [item.id, item])), [live]);
  const filtered = useMemo(() => matches.filter((match) => {
    const query = search.trim().toLocaleLowerCase("vi-VN");
    const tournamentName = tournamentById.get(match.tournamentId)?.name ?? "";
    const home = teamName(match.homeTeamId, identityNames);
    const away = teamName(match.awayTeamId, identityNames);
    const matchesQuery = !query || `${tournamentName} ${home} ${away} ${match.round ?? ""}`.toLocaleLowerCase("vi-VN").includes(query);
    const inStatus = statusFilter === "ALL" || statusFilter === "LIVE" && match.status === "IN_PROGRESS" || statusFilter === "UPCOMING" && ["SCHEDULED", "LINEUP_CONFIRMED"].includes(match.status) || statusFilter === "FINISHED" && ["FINISHED", "VERIFIED", "LOCKED"].includes(match.status);
    return matchesQuery && inStatus && (!tournamentFilter || match.tournamentId === tournamentFilter)
      && (!teamFilter || match.homeTeamId === teamFilter || match.awayTeamId === teamFilter)
      && (!dateFilter || Boolean(match.matchDate && new Date(match.matchDate).toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }) === dateFilter))
      && (!groupFilter || (match.round ?? "").split("·")[0].trim() === groupFilter)
      && (!roundFilter || match.round === roundFilter);
  }), [matches, search, statusFilter, tournamentFilter, teamFilter, dateFilter, groupFilter, roundFilter, tournamentById, identityNames]);

  const teamOptions = useMemo(() => [...new Set(matches.flatMap((match) => [match.homeTeamId, match.awayTeamId]).filter((id): id is string => Boolean(id)))], [matches]);
  const selectedMatch = detail?.match ?? matches.find((match) => match.id === selectedId) ?? null;
  const approvedResult = selectedId ? approvedResults.get(selectedId) : undefined;
  const score = liveScore(detail, selectedId ? liveById.get(selectedId) : undefined)
    ?? (approvedResult ? [approvedResult.homeScore + (approvedResult.homeExtraTimeScore ?? 0), approvedResult.awayScore + (approvedResult.awayExtraTimeScore ?? 0)] as [number, number] : null);

  useEffect(() => {
    if (!selectedMatch) { setPublicPlayers(new Map()); return; }
    let active = true;
    const teamIds = [...new Set([selectedMatch.homeTeamId, selectedMatch.awayTeamId].filter((id): id is string => Boolean(id)))];
    void Promise.all(teamIds.map((id) => getPublicTeamDetail(id))).then((details) => {
      if (!active) return;
      const players = details.flatMap((detail) => detail.players.map((player) => [player.id, player] as const));
      setPublicPlayers(new Map(players));
      setOfficialTeamNames((current) => new Map([...current, ...details.map((detail) => [detail.team.id, detail.team.name] as const)]));
      setOfficialTeamLogos((current) => new Map([...current, ...details.map((detail) => [detail.team.id, detail.team.logoUrl] as const)]));
    }).catch(() => { if (active) setPublicPlayers(new Map()); });
    return () => { active = false; };
  }, [selectedMatch?.id]);

  return <section className="live-match-center">
    {!selectedId ? <>
    <div className="live-center-heading"><div><span className="eyebrow">THEO DÕI MÙA GIẢI</span><h2>{props.scopeTeamIds !== undefined ? "LỊCH & KẾT QUẢ ĐỘI TÔI" : "LỊCH THI ĐẤU & KẾT QUẢ"}</h2><p>{props.scopeTeamIds !== undefined ? "Chỉ hiển thị các trận đã công bố có đội của bạn tham gia." : "Thông tin trận đấu đã công bố được đồng bộ trực tiếp từ Match Service."}</p><span className={liveFeedConnected ? "live-feed-status connected" : "live-feed-status"}>{liveFeedConnected ? "● Dữ liệu trực tiếp đang kết nối" : "○ Đang kết nối dữ liệu trực tiếp…"}</span></div><button className="button button-secondary" type="button" disabled={loading} onClick={() => { setLoading(true); void reloadMatches().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Không tải được lịch.")).finally(() => setLoading(false)); }}>Tải lại</button></div>
    <div className="live-center-tabs" role="tablist" aria-label="Lọc trạng thái trận">{([["ALL", "Tất cả"], ["LIVE", "Đang diễn ra"], ["UPCOMING", "Sắp diễn ra"], ["FINISHED", "Đã kết thúc"]] as const).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={statusFilter === value} className={statusFilter === value ? "active" : ""} onClick={() => setStatusFilter(value)}>{label}</button>)}</div>
    {live.length ? <section className="live-now-section"><div className="panel-heading"><div><span className="live-now-indicator">● LIVE NOW</span><h3>Trận đang diễn ra</h3></div><span className="status-pill">{live.length} trận</span></div><div className="live-match-grid">{live.map((match) => { const tournament = tournamentById.get(match.tournamentId); const elapsed = match.elapsedSeconds + (match.isClockRunning && match.clockStartedAt ? Math.max(0, Math.floor((clockNow - new Date(match.clockStartedAt).getTime()) / 1000)) : 0); return <button className="live-match-card" type="button" key={match.id} onClick={() => openMatch(match.id)}><div className="live-match-card-meta"><span>{tournament?.name ?? "Giải đấu"}</span><b>LIVE</b></div><span className="live-match-round">{match.round || "Trận đấu"} · {phaseText(match.clockPhase)} · {Math.floor(elapsed / 60)}′</span><div className="live-match-score"><span><TeamIdentity id={match.homeTeamId} names={identityNames} logos={identityLogos} /></span><strong>{match.homeScore} : {match.awayScore}</strong><span><TeamIdentity id={match.awayTeamId} names={identityNames} logos={identityLogos} /></span></div><small>{match.venue || "Sân chưa cập nhật"} · Theo dõi trực tiếp ↗</small></button>; })}</div></section> : <div className="live-empty-banner"><b>Hiện chưa có trận đấu đang diễn ra</b><span>Khi trọng tài bắt đầu trận, tỷ số trực tiếp sẽ xuất hiện tại đây.</span></div>}
    <div className="live-match-filters"><label className="field">Tìm giải, đội hoặc vòng<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nhập tên cần tìm" /></label><label className="field">Giải đấu<select value={tournamentFilter} onChange={(event) => setTournamentFilter(event.target.value)}><option value="">Tất cả giải công khai</option>{props.tournaments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="field">Đội bóng<select value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)}><option value="">Tất cả đội</option>{teamOptions.map((id) => <option key={id} value={id}>{teamName(id, identityNames)}</option>)}</select></label><label className="field">Ngày<input type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} /></label><label className="field">Bảng<input value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)} list="public-match-groups" placeholder="Tất cả bảng" /><datalist id="public-match-groups">{[...new Set(matches.map((match) => (match.round ?? "").split("·")[0].trim()).filter((value) => value.startsWith("Bảng")))].map((value) => <option key={value} value={value} />)}</datalist></label><label className="field">Vòng<input value={roundFilter} onChange={(event) => setRoundFilter(event.target.value)} list="public-match-rounds" placeholder="Tất cả vòng" /><datalist id="public-match-rounds">{[...new Set(matches.map((match) => match.round ?? "").filter(Boolean))].map((value) => <option key={value} value={value} />)}</datalist></label><button type="button" className="text-button" onClick={() => { setSearch(""); setTournamentFilter(""); setTeamFilter(""); setDateFilter(""); setGroupFilter(""); setRoundFilter(""); setStatusFilter("ALL"); }}>Xóa bộ lọc</button></div>
    {error ? <div className="inline-error" role="alert">{error}</div> : null}
    {loading ? <div className="live-center-loading" aria-label="Đang tải lịch">Đang tải lịch thi đấu…</div> : filtered.length ? <div className="live-fixture-list">{filtered.map((match) => { const currentLive = liveById.get(match.id); const tournament = tournamentById.get(match.tournamentId); const approved = approvedResults.get(match.id); const pitch=pitchScores.get(match.id); const currentScore = currentLive ? [currentLive.homeScore, currentLive.awayScore] as const : approved ? [approved.homeScore + (approved.homeExtraTimeScore ?? 0), approved.awayScore + (approved.awayExtraTimeScore ?? 0)] as const : pitch ? [pitch.home,pitch.away] as const : null; return <div className="squad-fixture-item" key={match.id}><button className="live-fixture-row" type="button" onClick={() => openMatch(match.id)}><time>{formatKickoff(match.matchDate)}</time><span className="live-fixture-event"><small>{tournament?.name ?? "Giải đấu"} · {match.round || "Vòng đấu"}</small><strong><TeamIdentity id={match.homeTeamId} names={identityNames} logos={identityLogos} /> <i>vs</i> <TeamIdentity id={match.awayTeamId} names={identityNames} logos={identityLogos} /></strong><small>{match.venue || "Chưa xếp sân"}</small></span><b className={currentLive ? "live-fixture-score is-live" : "live-fixture-score"}>{currentScore ? `${currentScore[0]} – ${currentScore[1]}` : match.status === "SCHEDULED" ? "VS" : statusText(match.status)}</b><span className={`status-pill status-${match.status.toLowerCase()}`}>{currentLive ? "LIVE" : statusText(match.status)}</span></button>{["SCHEDULED","LINEUP_CONFIRMED"].includes(match.status)?<div className="squad-fixture-actions">{(props.captainTeamIds??[]).filter(id=>id===match.homeTeamId||id===match.awayTeamId).map(id=><button type="button" className="button-secondary" key={id} onClick={()=>setSquadTarget({matchId:match.id,teamId:id})}>Chuẩn bị đội hình{(props.captainTeamIds?.length??0)>1?` · ${teamName(id,identityNames)}`:""}</button>)}</div>:null}</div>; })}</div> : <div className="live-empty-banner"><b>Không có trận phù hợp</b><span>Hãy đổi trạng thái, ngày hoặc bộ lọc tìm kiếm.</span></div>}
    </> : null}
    {selectedId ? (selectedMatch ? <PublicMatchDetailView key={selectedId} match={selectedMatch} tournament={tournamentById.get(selectedMatch.tournamentId)??null} state={detail} teamNames={identityNames} teamLogos={identityLogos} players={publicPlayers} fixtures={detailFixtures} standings={detailStandings} connected={connected} loading={detailLoading} error={detailError} onBack={closeMatch} onRetry={()=>setDetailRetry(value=>value+1)} highlightEventId={highlightEventId}/>:<section className="live-match-detail-page"><button className="button button-secondary" type="button" onClick={closeMatch}>← Quay lại lịch</button><p role={detailError?'alert':'status'}>{detailError||'Đang tải thông tin trận đấu…'}</p></section>) : null}
    <Modal open={squadTarget!==null} className="squad-modal" title="Chuẩn bị đội hình trận" onClose={()=>setSquadTarget(null)}>{squadTarget?<MatchSquadEditor key={squadTarget.matchId+squadTarget.teamId} {...squadTarget}/>:null}</Modal>
  </section>;
}


