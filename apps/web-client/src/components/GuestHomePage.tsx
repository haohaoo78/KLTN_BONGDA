import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError } from "../api/client";
import { getPublicFixtureGroupStandings, getPublicTeams, getPublishedTournamentTeams, type FixtureGroupStandings, type Match, type PublicTeam, type PublicTournamentTeam, type Tournament } from "../api/competition";
import type { Institution } from "../api/institutions";
import { LiveMatchCenterPanel, type PublicMatchCenterPreview } from "./LiveMatchCenterPanel";
import { GuestArrow, GuestBall, GuestDataMessage, GuestSkeleton, type GuestSection } from "./GuestPublicLayout";

type Props = {
  tournaments: Tournament[];
  loading: boolean;
  error: string | null;
  institutions: Institution[];
  teamNames: Map<string, string>;
  onRetry: () => void;
  onNavigate: (section: GuestSection) => void;
  onOpenTournament: (id: string) => void;
  onOpenTeam: (id: string) => void;
  onOpenMatch: (id: string) => void;
};

const tournamentStatuses: Record<string, string> = {
  OPEN_REGISTRATION: "Đang nhận đăng ký", REGISTRATION_CLOSED: "Đã đóng đăng ký", ROSTER_LOCKED: "Đã chốt đội",
  PREPARING: "Sắp khởi tranh", IN_PROGRESS: "Đang diễn ra", PAUSED: "Tạm dừng", COMPLETED: "Đã kết thúc", CANCELLED: "Đã hủy",
};
const formatLabels: Record<string, string> = { ROUND_ROBIN: "Vòng tròn", GROUP_AND_KNOCKOUT: "Vòng bảng · loại trực tiếp", KNOCKOUT: "Loại trực tiếp" };
const phaseLabels: Record<string, string> = {
  NOT_STARTED: "Chưa bắt đầu", FIRST_HALF: "Hiệp 1", HALF_TIME: "Nghỉ giữa hiệp", SECOND_HALF: "Hiệp 2", REGULATION_COMPLETE: "Hết giờ chính thức",
  EXTRA_TIME_FIRST_HALF: "Hiệp phụ 1", EXTRA_TIME_HALF_TIME: "Nghỉ hiệp phụ", EXTRA_TIME_SECOND_HALF: "Hiệp phụ 2", EXTRA_TIME_COMPLETE: "Hết hiệp phụ", PENALTIES: "Luân lưu", ENDED: "Đã kết thúc",
};

function shortDate(value: string | null) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return "Chưa công bố";
  return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(value));
}
function matchDay(value: string | null) {
  return value ? new Date(value).toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }) : "";
}
function matchTime(value: string | null) {
  return value ? new Date(value).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" }) : "Chưa xếp giờ";
}
function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toLocaleUpperCase("vi-VN");
}
function SectionHeading({ kicker, title, action, onAction }: { kicker?: string; title: string; action?: string; onAction?: () => void }) {
  return <div className="guest-section-heading"><div>{kicker ? <span className="guest-kicker">{kicker}</span> : null}<h2>{title}</h2></div>{action && onAction ? <button className="guest-text-link" type="button" onClick={onAction}>{action} <GuestArrow /></button> : null}</div>;
}
function TeamIdentity({ id, view }: { id: string | null; view: PublicMatchCenterPreview }) {
  const name = id ? view.teamNames.get(id) ?? "Đang cập nhật tên đội" : "Chưa xác định";
  const logo = id ? view.teamLogos.get(id) : null;
  return <span className="guest-match-team">{logo ? <img src={logo} alt="" loading="lazy" /> : <span className="guest-match-crest" aria-hidden="true">{id && view.teamNames.has(id) ? initials(name) : <GuestBall size={20} />}</span>}<span>{name}</span></span>;
}
function hasStatus(match: Match, status: string) {
  return status === "ALL" || status === "LIVE" && match.status === "IN_PROGRESS" || status === "UPCOMING" && ["SCHEDULED", "LINEUP_CONFIRMED"].includes(match.status) || status === "FINISHED" && ["FINISHED", "VERIFIED", "LOCKED"].includes(match.status);
}
function MatchScore({ match, view }: { match: Match; view: PublicMatchCenterPreview }) {
  const live = match.status === "IN_PROGRESS" ? view.live.get(match.id) : undefined;
  const official = view.results.get(match.id);
  const pitch = view.pitchScores.get(match.id);
  const score = live ? [live.homeScore, live.awayScore] : official ? [official.homeScore + (official.homeExtraTimeScore ?? 0), official.awayScore + (official.awayExtraTimeScore ?? 0)] : pitch ? [pitch.home, pitch.away] : null;
  return <span className="guest-match-score"><strong>{score ? `${score[0]} – ${score[1]}` : ["SCHEDULED", "LINEUP_CONFIRMED"].includes(match.status) ? matchTime(match.matchDate) : "—"}</strong>{official?.homePenaltyScore != null && official.awayPenaltyScore != null ? <small>Luân lưu {official.homePenaltyScore}–{official.awayPenaltyScore}</small> : null}</span>;
}
function MatchStatus({ match, view }: { match: Match; view: PublicMatchCenterPreview }) {
  const live = match.status === "IN_PROGRESS" ? view.live.get(match.id) : undefined;
  if (live) {
    const elapsed = live.elapsedSeconds + (live.isClockRunning && live.clockStartedAt ? Math.max(0, Math.floor((view.clockNow - new Date(live.clockStartedAt).getTime()) / 1000)) : 0);
    const phase = live.clockPhase ? phaseLabels[live.clockPhase] ?? "Đang cập nhật hiệp" : "Đang thi đấu";
    return <span className="guest-match-status is-live"><i aria-hidden="true" />LIVE · {phase}{live.isClockRunning ? ` · ${Math.floor(elapsed / 60)}′` : ""}</span>;
  }
  const labels: Record<string, string> = { SCHEDULED: "Sắp diễn ra", LINEUP_CONFIRMED: "Đã xác nhận đội hình", IN_PROGRESS: "Đang thi đấu", FINISHED: "Kết thúc · chờ công nhận", VERIFIED: "Kết quả chính thức", LOCKED: "Kết quả chính thức", POSTPONED: "Tạm hoãn", CANCELLED: "Đã hủy" };
  return <span className="guest-match-status">{labels[match.status] ?? "Đang cập nhật"}</span>;
}

function StandingsPreview({ tournaments, loading, error: tournamentError, onRetry, onOpenTournament, onNavigate }: Pick<Props, "tournaments" | "loading" | "error" | "onRetry" | "onOpenTournament" | "onNavigate">) {
  const [selected, setSelected] = useState("");
  const [groupId, setGroupId] = useState("");
  const [ranking, setRanking] = useState<FixtureGroupStandings | null>(null);
  const [teams, setTeams] = useState<PublicTournamentTeam[]>([]);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState("");
  const [unpublished, setUnpublished] = useState(false);
  const [retry, setRetry] = useState(0);
  const current = tournaments.find(tournament => tournament.id === selected) ?? tournaments[0];
  useEffect(() => {
    let active = true;
    setRanking(null); setTeams([]); setError(""); setUnpublished(false);
    if (loading) { setPending(true); return () => { active = false; }; }
    if (!current || current.competitionFormat === "KNOCKOUT" || tournamentError) { setPending(false); return () => { active = false; }; }
    setPending(true);
    void getPublicFixtureGroupStandings(current.id).then(async result => {
      const identities = await getPublishedTournamentTeams(current.id);
      if (active) { setRanking(result); setTeams(identities.teams); }
    }).catch(cause => {
      if (!active) return;
      if (cause instanceof ApiError && cause.code === "PUBLISHED_DRAW_REQUIRED") setUnpublished(true);
      else setError("Không tải được bảng xếp hạng chính thức. Vui lòng thử lại.");
    }).finally(() => { if (active) setPending(false); });
    return () => { active = false; };
  }, [current?.id, current?.competitionFormat, loading, tournamentError, retry]);
  const group = ranking?.groups.find(row => row.groupId === groupId) ?? ranking?.groups[0];
  const identities = new Map(teams.map(team => [team.id, team]));
  return <section className="guest-standings" aria-label="Bảng xếp hạng rút gọn">
    <SectionHeading title="Bảng xếp hạng" />
    {!loading && tournaments.length ? <div className="guest-ranking-toolbar"><label>Giải đấu<select value={current?.id ?? ""} onChange={event => { setSelected(event.target.value); setGroupId(""); }}>{tournaments.map(tournament => <option key={tournament.id} value={tournament.id}>{tournament.name}</option>)}</select></label>{ranking && ranking.groups.length > 1 ? <label>Bảng đấu<select value={group?.groupId ?? ""} onChange={event => setGroupId(event.target.value)}>{ranking.groups.map(row => <option key={row.groupId} value={row.groupId}>{row.name}</option>)}</select></label> : null}</div> : null}
    {loading || pending ? <GuestSkeleton rows={4} label="Đang tải bảng xếp hạng chính thức" /> : tournamentError || error ? <GuestDataMessage title="Chưa tải được bảng xếp hạng" error onRetry={tournamentError ? onRetry : () => setRetry(value => value + 1)}>{tournamentError ?? error}</GuestDataMessage> : current?.competitionFormat === "KNOCKOUT" ? <div className="guest-knockout-preview"><GuestBall size={32} /><h3>Giải loại trực tiếp</h3><p>Theo dõi nhánh đấu và kết quả từng vòng của {current.name}.</p><button className="guest-text-link" type="button" onClick={() => onOpenTournament(current.id)}>Xem sơ đồ thi đấu <GuestArrow /></button></div> : group?.standings.length ? <>
      <div className="guest-table-wrap"><table className="guest-ranking-table"><thead><tr><th scope="col">Hạng</th><th scope="col">Đội bóng</th><th scope="col">Trận</th><th scope="col">HS</th><th scope="col">Điểm</th></tr></thead><tbody>{group.standings.slice(0, 5).map(row => { const team = identities.get(row.teamId); return <tr key={row.teamId}><td>{row.groupRank > 0 ? row.groupRank : "—"}</td><td><span className="guest-ranking-team">{team?.logoUrl ? <img src={team.logoUrl} alt="" loading="lazy" /> : <GuestBall size={20} />}<strong>{team?.name ?? "Đang cập nhật tên đội"}</strong></span></td><td>{row.played}</td><td>{row.gd > 0 ? "+" : ""}{row.gd}</td><td><strong>{row.points}</strong></td></tr>; })}</tbody></table></div><p className="guest-data-note">{group.name} · Chỉ tính kết quả đã được công nhận chính thức.</p>
    </> : <GuestDataMessage title={unpublished ? "Chưa công bố chia bảng" : "Chưa có dữ liệu xếp hạng"}>{unpublished ? "Thành phần bảng và BXH sẽ xuất hiện sau khi công bố kết quả chia bảng." : "Bảng xếp hạng chính thức sẽ hiển thị khi dữ liệu của giải được công bố."}</GuestDataMessage>}
    <button className="guest-section-bottom-link guest-text-link" type="button" onClick={() => onNavigate("standings")}>Xem bảng xếp hạng đầy đủ <GuestArrow /></button>
  </section>;
}

function TeamsPreview({ institutions, onNavigate, onOpenTeam }: Pick<Props, "institutions" | "onNavigate" | "onOpenTeam">) {
  const [teams, setTeams] = useState<PublicTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(""); setTeams([]);
    void getPublicTeams({ limit: 4, offset: 0, isActive: true, sortBy: "NAME" }).then(result => { if (active) setTeams(result.items); }).catch(() => { if (active) setError("Không tải được danh bạ đội bóng. Vui lòng thử lại."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [retry]);
  return <section className="guest-section guest-teams" aria-label="Đội bóng công khai">
    <SectionHeading kicker="Cộng đồng sân cỏ" title="Đội bóng" action="Xem tất cả đội bóng" onAction={() => onNavigate("teams")} />
    {loading ? <GuestSkeleton rows={2} label="Đang tải đội bóng công khai" /> : error ? <GuestDataMessage title="Chưa tải được đội bóng" error onRetry={() => setRetry(value => value + 1)}>{error}</GuestDataMessage> : teams.length ? <div className="guest-team-grid">{teams.map(team => <button className="guest-team-preview" key={team.id} type="button" onClick={() => onOpenTeam(team.id)}>{team.logoUrl ? <img src={team.logoUrl} alt="" loading="lazy" /> : <span className="guest-team-crest" aria-hidden="true">{initials(team.shortName ?? team.name)}</span>}<span><strong>{team.name}</strong><small>{institutions.find(institution => institution.id === team.institutionId)?.name ?? "Chưa cập nhật trường"}</small></span><GuestArrow /></button>)}</div> : <GuestDataMessage title="Chưa có đội bóng công khai">Đội bóng sẽ xuất hiện khi hồ sơ được công khai trong danh bạ.</GuestDataMessage>}
  </section>;
}

function HomeMatchSections({ view, props, featured, standings }: { view: PublicMatchCenterPreview; props: Props; featured: ReactNode; standings: ReactNode }) {
  const [stripStatus, setStripStatus] = useState("LIVE");
  const [tournamentFilter, setTournamentFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const loading = props.loading || view.loading;
  const error = props.error ?? view.error;
  const retry = props.error ? props.onRetry : view.retry;
  const tournamentNames = new Map(props.tournaments.map(tournament => [tournament.id, tournament.name]));
  const stripMatches = view.matches.filter(match => hasStatus(match, stripStatus)).sort((a, b) => stripStatus === "FINISHED" ? (b.matchDate ?? "").localeCompare(a.matchDate ?? "") : (a.matchDate ?? "").localeCompare(b.matchDate ?? "")).slice(0, 6);
  const filtered = view.matches.filter(match => (!tournamentFilter || match.tournamentId === tournamentFilter) && (!dateFilter || matchDay(match.matchDate) === dateFilter) && hasStatus(match, statusFilter));
  const groups = new Map<string, Match[]>();
  for (const match of filtered.slice(0, 8)) { const key = `${matchDay(match.matchDate)}|${match.tournamentId}`; groups.set(key, [...(groups.get(key) ?? []), match]); }
  const tabs = [["LIVE", "Đang diễn ra"], ["UPCOMING", "Sắp diễn ra"], ["FINISHED", "Đã kết thúc"]] as const;
  return <>
    <section className="guest-section guest-match-section" aria-label="Trung tâm trận đấu">
      <SectionHeading kicker="Nhịp đập sân cỏ" title="Trung tâm trận đấu" action="Tất cả lịch & kết quả" onAction={() => props.onNavigate("matches")} />
      <div className="guest-match-bar"><div className="guest-match-tabs" role="tablist" aria-label="Trạng thái trận đấu">{tabs.map(([value, label]) => <button id={`guest-match-tab-${value}`} key={value} type="button" role="tab" aria-selected={stripStatus === value} aria-controls="guest-match-tab-content" onClick={() => setStripStatus(value)}>{label}</button>)}</div><span className={`guest-feed-status${view.feedConnected ? " is-connected" : ""}`}>{view.feedConnected ? <i aria-hidden="true" /> : null}{view.feedConnected ? "Đã kết nối dữ liệu trực tiếp" : "Chưa kết nối dữ liệu trực tiếp"}</span></div>
      <div id="guest-match-tab-content" role="tabpanel" aria-labelledby={`guest-match-tab-${stripStatus}`}>
        {loading ? <GuestSkeleton rows={1} label="Đang tải trung tâm trận đấu" /> : error ? <GuestDataMessage title="Chưa tải đầy đủ dữ liệu trận đấu" error onRetry={retry}>{error}</GuestDataMessage> : stripMatches.length ? <div className="guest-match-strip">{stripMatches.map(match => <button className="guest-strip-match" key={match.id} type="button" onClick={() => props.onOpenMatch(match.id)}><span className="guest-strip-meta">{tournamentNames.get(match.tournamentId) ?? "Giải đấu"}<small>{match.round || "Vòng đấu chưa công bố"}</small></span><span className="guest-strip-teams"><TeamIdentity id={match.homeTeamId} view={view} /><MatchScore match={match} view={view} /><TeamIdentity id={match.awayTeamId} view={view} /></span><span className="guest-strip-bottom"><MatchStatus match={match} view={view} /><small>{stripStatus === "UPCOMING" ? `${shortDate(match.matchDate)} · ` : ""}{match.venue || "Sân chưa công bố"}</small></span></button>)}</div> : <GuestDataMessage title={stripStatus === "LIVE" ? "Hiện chưa có trận đang diễn ra" : stripStatus === "UPCOMING" ? "Chưa có trận sắp diễn ra được công bố" : "Chưa có trận đã kết thúc"}>Theo dõi các trận đấu tại đây khi có dữ liệu công khai.</GuestDataMessage>}
      </div>
    </section>
    {featured}
    <div className="guest-section guest-data-grid">
      <section className="guest-schedule" aria-label="Lịch và kết quả rút gọn">
        <SectionHeading title="Lịch & kết quả" action="Xem tất cả" onAction={() => props.onNavigate("matches")} />
        <div className="guest-schedule-filters"><label>Giải đấu<select value={tournamentFilter} onChange={event => setTournamentFilter(event.target.value)}><option value="">Tất cả giải đấu</option>{props.tournaments.map(tournament => <option key={tournament.id} value={tournament.id}>{tournament.name}</option>)}</select></label><label>Ngày thi đấu<input type="date" value={dateFilter} onChange={event => setDateFilter(event.target.value)} /></label><label>Trạng thái<select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="ALL">Tất cả</option>{tabs.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
        {loading ? <GuestSkeleton rows={3} label="Đang tải lịch thi đấu đã công bố" /> : error ? <GuestDataMessage title="Chưa tải được lịch thi đấu" error onRetry={retry}>{error}</GuestDataMessage> : groups.size ? <div className="guest-schedule-groups">{[...groups].map(([key, matches]) => <section className="guest-schedule-group" key={key}><h3><span>{tournamentNames.get(matches[0].tournamentId) ?? "Giải đấu"}</span><time>{shortDate(matches[0].matchDate)}</time></h3>{matches.map(match => <button className="guest-schedule-row" key={match.id} type="button" onClick={() => props.onOpenMatch(match.id)}><span className="guest-schedule-time"><time>{matchTime(match.matchDate)}</time><small>{match.round || "Chưa công bố vòng"}</small></span><span className="guest-schedule-teams"><TeamIdentity id={match.homeTeamId} view={view} /><TeamIdentity id={match.awayTeamId} view={view} /></span><span className="guest-schedule-result"><MatchScore match={match} view={view} /><MatchStatus match={match} view={view} /><small>{match.venue || "Sân chưa công bố"}</small></span></button>)}</section>)}</div> : <GuestDataMessage title={view.matches.length ? "Không có trận phù hợp" : "Chưa có lịch thi đấu công khai"}>{view.matches.length ? "Thử chọn giải đấu, ngày hoặc trạng thái khác." : "Lịch và kết quả sẽ hiển thị sau khi Ban tổ chức công bố lịch thi đấu."}</GuestDataMessage>}
        {tournamentFilter || dateFilter || statusFilter !== "ALL" ? <button className="guest-text-link guest-filter-reset" type="button" onClick={() => { setTournamentFilter(""); setDateFilter(""); setStatusFilter("ALL"); }}>Xóa bộ lọc</button> : null}
      </section>
      {standings}
    </div>
  </>;
}

export function GuestHomePage(props: Props) {
  const tournaments = useMemo(() => props.tournaments.filter(tournament => tournament.status !== "DRAFT"), [props.tournaments]);
  const featured = useMemo(() => {
    const priority: Record<string, number> = { IN_PROGRESS: 0, OPEN_REGISTRATION: 1, PREPARING: 2, ROSTER_LOCKED: 3, REGISTRATION_CLOSED: 4, PAUSED: 5, COMPLETED: 6, CANCELLED: 7 };
    return [...tournaments].sort((a, b) => (priority[a.status] ?? 8) - (priority[b.status] ?? 8) || (a.startDate ?? "9999").localeCompare(b.startDate ?? "9999")).slice(0, 3);
  }, [tournaments]);
  const featuredSection = <section className="guest-section guest-featured" aria-label="Giải đấu nổi bật">
    <SectionHeading kicker="Theo dõi mùa giải" title="Giải đấu nổi bật" action="Xem tất cả giải đấu" onAction={() => props.onNavigate("tournaments")} />
    {props.loading ? <GuestSkeleton rows={3} label="Đang tải giải đấu công khai" /> : props.error ? <GuestDataMessage title="Chưa tải được giải đấu" error onRetry={props.onRetry}>{props.error}</GuestDataMessage> : featured.length ? <div className="guest-tournament-grid">{featured.map(tournament => <article className="guest-tournament-card" key={tournament.id}>
      <div className="guest-tournament-identity"><GuestBall size={40} /><div><span>BÓNG ĐÁ SINH VIÊN</span><strong>{tournament.footballFormat ? `${tournament.footballFormat} người` : "Giải đấu"}</strong></div><span className={`guest-tournament-status${tournament.status === "IN_PROGRESS" ? " is-live" : ""}`}>{tournamentStatuses[tournament.status] ?? "Đang cập nhật"}</span></div>
      <div className="guest-tournament-content"><p className="guest-tournament-school">{props.institutions.find(institution => institution.id === tournament.organizingInstitutionId)?.name ?? tournament.organizerName ?? "Ban tổ chức chưa cập nhật"}</p><h3><button type="button" onClick={() => props.onOpenTournament(tournament.id)}>{tournament.name}</button></h3><p className="guest-tournament-scope">{tournament.scope === "INTER_SCHOOL" ? "Liên trường" : tournament.scope === "SINGLE_INSTITUTION" ? "Nội bộ trường" : "Bóng đá sinh viên"}{tournament.competitionFormat ? ` · ${formatLabels[tournament.competitionFormat] ?? ""}` : ""}</p><div className="guest-tournament-facts"><time>{shortDate(tournament.startDate)}{tournament.endDate ? ` — ${shortDate(tournament.endDate)}` : ""}</time>{tournament.maxTeams > 0 ? <span>Tối đa {tournament.maxTeams} đội</span> : null}</div><button className="guest-text-link" type="button" onClick={() => props.onOpenTournament(tournament.id)}>Xem chi tiết <GuestArrow /></button></div>
    </article>)}</div> : <GuestDataMessage title="Chưa có giải đấu được công bố">Giải đấu công khai sẽ xuất hiện khi Ban tổ chức công bố.</GuestDataMessage>}
  </section>;
  return <div className="guest-home">
    <section className="guest-hero" aria-labelledby="guest-home-title">
      <div className="guest-hero-copy"><span className="guest-kicker">Bóng đá sinh viên · TP. Hồ Chí Minh</span><h1 id="guest-home-title">ĐAM MÊ TRÊN<br /><em>SÂN CỎ.</em></h1><p>Nền tảng quản lý và theo dõi bóng đá sinh viên TP.HCM. Kết nối giải đấu, đội bóng và những khoảnh khắc trên sân.</p><div className="guest-hero-actions"><button className="guest-button guest-button-primary" type="button" onClick={() => props.onNavigate("tournaments")}>Khám phá giải đấu <GuestArrow /></button><button className="guest-button guest-button-on-dark" type="button" onClick={() => props.onNavigate("matches")}>Lịch thi đấu</button></div></div>
      <figure className="guest-hero-image"><img src="/images/student-football-hero.jpg" alt="Ảnh minh họa sinh viên chơi bóng đá trên sân cỏ với trang phục cam và trắng" width="1536" height="1024" fetchPriority="high" /><figcaption>Cùng đam mê. Chung sân cỏ.</figcaption></figure>
    </section>
    <LiveMatchCenterPanel tournaments={tournaments} teamNames={props.teamNames} returnPath="/" renderPreview={view => <HomeMatchSections view={view} props={{ ...props, tournaments }} featured={featuredSection} standings={<StandingsPreview {...props} tournaments={tournaments} />} />} />
    <TeamsPreview institutions={props.institutions} onNavigate={props.onNavigate} onOpenTeam={props.onOpenTeam} />
  </div>;
}
