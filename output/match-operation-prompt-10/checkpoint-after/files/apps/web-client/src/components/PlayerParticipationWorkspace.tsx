import { useEffect, useMemo, useState } from "react";
import { API_BASE } from "../api/client";
import {
  getMyTournamentInvitations,
  getMyTournamentSuspension,
  getPublicMatchLiveState,
  getPublicTournamentFixtures,
  getPublicTournamentSchedules,
  getPublishedTournamentTeams,
  getPublishedTournamentDraw,
  getPublicFixtureGroupStandings,
  getOfficialTournamentStatistics,
  type OfficialTournamentStatistics,
  type PublicMatchLiveState,
  type Tournament,
  type TournamentPlayerInvitation,
} from "../api/competition";

type PlayerFixture = {
  match: PublicMatchLiveState["match"];
  state: PublicMatchLiveState | null;
  scheduledDate: string;
  venueName: string;
  opponentName: string;
  score: string;
  suspension: boolean | null;
  suspensionReason?: string;
};
type Participation = { invitation: TournamentPlayerInvitation; fixtures: PlayerFixture[]; groupLabel?: string; statistics?:OfficialTournamentStatistics; error: string };

function invitationStatus(item: TournamentPlayerInvitation): string {
  if (item.status !== "ACCEPTED") return item.status === "PENDING" ? "Chờ xác nhận tham gia" : item.status === "DECLINED" ? "Đã từ chối" : item.status === "WITHDRAWN" ? "Đã rút xác nhận" : "Không còn hiệu lực";
  if (item.registration_status === "APPROVED") return "Đủ điều kiện theo roster đã duyệt";
  if (item.registration_status === "PENDING" || item.registration_status === "WAITLIST") return "Đã đồng ý · chờ BTC duyệt đội";
  return "Đã đồng ý · đang chờ xác nhận tư cách từ BTC";
}

function competitionFormatLabel(value: Tournament["competitionFormat"]): string {
  if (value === "ROUND_ROBIN") return "Vòng tròn";
  if (value === "KNOCKOUT") return "Loại trực tiếp";
  if (value === "GROUP_AND_KNOCKOUT") return "Vòng bảng và loại trực tiếp";
  return "Thể thức đang cập nhật";
}

function matchSquadStatus(item: PlayerFixture, playerId: string): string {
  const selected = item.state?.lineups.find((lineup) => lineup.playerId === playerId);
  if (!selected) return "Chưa có tên trong đội hình trận";
  return selected.isStarting ? "Đá chính" : "Dự bị";
}

function matchResult(item: PlayerFixture, teamId: string): string {
  const result = item.state?.result;
  if (!result) return item.match.status === "IN_PROGRESS" ? "Đang thi đấu" : "Chưa có kết quả chính thức";
  const own = item.match.homeTeamId === teamId ? result.homeScore + (result.homeExtraTimeScore ?? 0) : result.awayScore + (result.awayExtraTimeScore ?? 0);
  const opponent = item.match.homeTeamId === teamId ? result.awayScore + (result.awayExtraTimeScore ?? 0) : result.homeScore + (result.homeExtraTimeScore ?? 0);
  return own > opponent ? "Thắng" : own < opponent ? "Thua" : "Hòa";
}

export function PlayerParticipationWorkspace({ tournaments }: { tournaments: Tournament[] }) {
  const [items, setItems] = useState<Participation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const tournamentById = useMemo(() => new Map(tournaments.map((item) => [item.id, item])), [tournaments]);

  useEffect(() => {
    const stream = new EventSource(`${API_BASE.replace(/\/$/, "")}/matches/live/stream`, { withCredentials: true });
    let timer = 0;
    const refresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setRevision((value) => value + 1), 400);
    };
    stream.addEventListener("match-update", refresh);
    stream.addEventListener("sync-required", refresh);
    return () => { window.clearTimeout(timer); stream.close(); };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    void getMyTournamentInvitations().then(async ({ invitations }) => {
      const rows = await Promise.all(invitations.map(async (invitation) => {
        if (invitation.status !== "ACCEPTED" || invitation.registration_status !== "APPROVED") {
          return { invitation, fixtures: [], error: "" } satisfies Participation;
        }
        try {
          const [fixtureBundle, scheduleResult, teamResult, publishedDraw, ranking, suspension] = await Promise.all([
            getPublicTournamentFixtures(invitation.tournament_id),
            getPublicTournamentSchedules(invitation.tournament_id),
            getPublishedTournamentTeams(invitation.tournament_id),
            getPublishedTournamentDraw(invitation.tournament_id).catch(() => null),
            getPublicFixtureGroupStandings(invitation.tournament_id).catch(() => null),
            getMyTournamentSuspension(invitation.player_id, invitation.tournament_id),
          ]);
          const teamNames = new Map(teamResult.teams.map((team) => [team.id, team.name]));
          const group = publishedDraw?.draw?.groups.find((item) => item.assignments.some((assignment) => assignment.teamId === invitation.team_id));
          const groupRank = group ? ranking?.groups.find((item) => item.groupId === group.id)?.standings.find((row) => row.teamId === invitation.team_id)?.groupRank ?? 0 : 0;
          const groupLabel = group ? `${group.name} · ${groupRank > 0 ? `Hạng ${groupRank}` : "Chưa xếp hạng"}` : "Đang chờ xác định bảng/nhánh";
          const scheduleByMatch = new Map(scheduleResult.schedules.filter((item) => item.status === "PUBLISHED").map((item) => [item.matchId, item]));
          const ownFixtures = fixtureBundle.stages.flatMap((stage) => stage.matches)
            .filter((match) => (match.homeTeamId === invitation.team_id || match.awayTeamId === invitation.team_id) && scheduleByMatch.has(match.id));
          const fixtures = await Promise.all(ownFixtures.map(async (match) => {
            const schedule = scheduleByMatch.get(match.id)!;
            const state = await getPublicMatchLiveState(match.id).catch(() => null);
            const matchSuspension = await getMyTournamentSuspension(invitation.player_id, invitation.tournament_id, match.id).catch(() => ({ isSuspended: null, reason:'Chưa xác minh được kỷ luật của trận; hãy tải lại.' }));
            const opponentId = match.homeTeamId === invitation.team_id ? match.awayTeamId : match.homeTeamId;
            const result = state?.result;
            const score = result
              ? `${result.homeScore + (result.homeExtraTimeScore ?? 0)} – ${result.awayScore + (result.awayExtraTimeScore ?? 0)}`
              : state?.match.status === "IN_PROGRESS" ? "Đang thi đấu" : "Chưa có kết quả";
            return { match, state, scheduledDate: schedule.scheduledDate, venueName: match.venue || schedule.venueName || "Chưa cập nhật sân", opponentName: opponentId ? teamNames.get(opponentId) ?? "Đối thủ đang cập nhật" : "Chưa xác định đối thủ", score, suspension: matchSuspension.isSuspended, suspensionReason:matchSuspension.reason } satisfies PlayerFixture;
          }));
          const statisticsResult=await getOfficialTournamentStatistics(invitation.tournament_id).catch(()=>null);
          return { invitation, fixtures, groupLabel, statistics:statisticsResult?.statistics, error: "" } satisfies Participation;
        } catch (reason) {
          return { invitation, fixtures: [], error: reason instanceof Error ? reason.message : "Không tải được dữ liệu thi đấu của cầu thủ." } satisfies Participation;
        }
      }));
      if (active) setItems(rows);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "Không tải được dữ liệu tham gia giải.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision]);

  const approvedParticipations = items.filter((item) => item.invitation.status === "ACCEPTED" && item.invitation.registration_status === "APPROVED");
  const uniqueParticipations=[...new Map(approvedParticipations.map(item=>[`${item.invitation.tournament_id}:${item.invitation.team_id}:${item.invitation.player_id}`,item])).values()];
  const statisticsComplete=uniqueParticipations.every(item=>item.statistics);
  const goalsComplete=statisticsComplete&&uniqueParticipations.every(item=>!item.statistics?.goalReconciliationMatchIds.length);
  const official=uniqueParticipations.flatMap(item=>item.statistics?.players.filter(p=>p.playerId===item.invitation.player_id&&p.teamId===item.invitation.team_id)??[]);
  const goals=official.reduce((sum,p)=>sum+p.goals,0),yellowCards=official.reduce((sum,p)=>sum+p.yellowCards,0);

  return <section className="panel data-panel player-participation-workspace">
    <div className="panel-heading"><div><span className="eyebrow">KHÔNG GIAN CẦU THỦ</span><h2>Giải đấu và lịch thi đấu của tôi</h2><p>Theo dõi tư cách thi đấu, đội hình từng trận, kết quả và thành tích từ dữ liệu đã công bố.</p></div><button className="button button-secondary" type="button" disabled={loading} onClick={() => setRevision((value) => value + 1)}>Tải lại</button></div>
    {error ? <div className="message-banner message-error" role="alert">{error}</div> : null}
    <div className="competition-stat-grid"><article><span>Giải đã xác nhận</span><strong>{approvedParticipations.length}</strong></article><article><span>Bàn thắng</span><strong>{goalsComplete?goals:"—"}</strong></article><article><span>Thẻ vàng</span><strong>{statisticsComplete?yellowCards:"—"}</strong></article></div>
    {loading ? <div className="loading-state">Đang tải giải và lịch cá nhân…</div> : items.length ? <div className="player-competition-list">{items.map(({ invitation, fixtures, groupLabel, error: fixtureError }) => {
      const tournament = tournamentById.get(invitation.tournament_id);
      const next = fixtures.filter((fixture) => ["SCHEDULED", "LINEUP_CONFIRMED"].includes(fixture.match.status)).sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate))[0];
      return <article className="player-competition-card" key={invitation.id}>
        <header><div><span className={`status-pill ${invitation.status === "ACCEPTED" && invitation.registration_status === "APPROVED" ? "status-success" : "status-warning"}`}>{invitationStatus(invitation)}</span><h3>{invitation.tournament_name ?? tournament?.name ?? "Giải đấu"}</h3><p>{invitation.team_name ?? "Đội bóng"} · {competitionFormatLabel(tournament?.competitionFormat)} · {tournament?.competitionFormat === "KNOCKOUT" ? "Nhánh loại trực tiếp" : groupLabel ?? "Đang chờ xác định bảng/nhánh"}</p></div></header>
        {fixtureError ? <p className="message-banner message-error" role="alert">{fixtureError}</p> : null}
        {invitation.status === "ACCEPTED" && invitation.registration_status === "APPROVED" ? <>
          <p>{next ? <>Trận tiếp theo: <strong>{next.match.round ?? "Trận đấu"}</strong> · {new Date(next.scheduledDate).toLocaleString("vi-VN")} · {next.venueName}</> : "Chưa có trận đã công bố lịch cho đội."}</p>
          {fixtures.length ? <div className="player-fixture-list">{fixtures.map((fixture) => <article key={fixture.match.id}><div><strong>{fixture.match.round ?? "Trận đấu"}</strong><span>{new Date(fixture.scheduledDate).toLocaleString("vi-VN")} · {fixture.venueName}</span><small>{invitation.team_name} vs {fixture.opponentName}</small></div><div><strong>{fixture.score}</strong><span className="status-pill">{matchSquadStatus(fixture, invitation.player_id)}</span><span>{matchResult(fixture, invitation.team_id)}</span><span className={fixture.suspension === true ? "form-error" : "muted"}>{fixture.suspension === true ? "Đang bị treo giò trong trận" : fixture.suspension === false ? "Không có án treo giò hiệu lực" : fixture.suspensionReason??"Chưa kiểm tra án treo giò"}</span></div></article>)}</div> : <div className="empty-state"><p>Chưa có lịch thi đấu được công bố.</p></div>}
          <p className="muted">Việc chọn đá chính/dự bị do đội trưởng gửi trong danh sách thi đấu. Mục này chỉ đọc dữ liệu của cầu thủ.</p>
        </> : <p>Lời mời và phản hồi của bạn nằm trong mục <strong>Thông báo</strong>. Lịch và tư cách thi đấu chỉ xuất hiện sau khi hồ sơ đội được BTC duyệt.</p>}
      </article>;
    })}</div> : <div className="empty-state"><h3>Chưa có giải đấu đã mời</h3><p>Khi đội trưởng mời bạn tham gia giải, xác nhận trong mục Thông báo để theo dõi quá trình thi đấu tại đây.</p></div>}
  </section>;
}
