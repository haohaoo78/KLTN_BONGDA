import { useEffect, useState } from "react";
import {
  getMyTeams,
  getMyManagedTeams,
  getMyTeamTournamentRegistrations,
  getPlayers,
  getTournament,
  getTournamentRosters,
  withdrawTeamRegistration,
  requestTeamRegistrationWithdrawal,
  getRegistrationWithdrawalRequests,
  type Player,
  type RosterEntry,
  type Team,
  type TeamRegistration,
  type TeamWithdrawalRequest,
  type Tournament,
} from "../api/competition";
import { Modal } from "./Modal";
import { NOTIFICATION_REALTIME_EVENT } from "../api/client";

type Entry = { team: Team; registration: TeamRegistration; tournament: Tournament | null };
type Props = { canManage: boolean; onManage: (teamId: string, tournamentId: string) => void; onViewTournament: (tournamentId: string) => void };

const statusLabels: Record<TeamRegistration["status"], string> = {
  PENDING: "Chờ BTC duyệt", APPROVED: "Đã duyệt", REJECTED: "Bị từ chối", APPROVAL_REVOKED: "Đã thu hồi phê duyệt", REVISION_REQUIRED: "Cần bổ sung", NEEDS_SUPPLEMENT: "Cần bổ sung", WITHDRAWN: "Đã rút", WAITLIST: "Chờ suất", CONFLICT_ADJUSTMENT_REQUIRED: "Cần điều chỉnh – Trùng cầu thủ",
};

export function MyTeamTournamentsPanel({ canManage, onManage, onViewTournament }: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [managedTeamIds, setManagedTeamIds] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Entry | null>(null);
  const [rosters, setRosters] = useState<RosterEntry[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [withdrawReason, setWithdrawReason] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawalRequestSent, setWithdrawalRequestSent] = useState(false);
  const [withdrawalRequests, setWithdrawalRequests] = useState<TeamWithdrawalRequest[]>([]);
  const [realtimeRevision, setRealtimeRevision] = useState(0);

  useEffect(() => {
    const refresh = () => setRealtimeRevision((revision) => revision + 1);
    window.addEventListener(NOTIFICATION_REALTIME_EVENT, refresh);
    return () => window.removeEventListener(NOTIFICATION_REALTIME_EVENT, refresh);
  }, []);

  async function handleWithdraw(entry: Entry) {
    if (withdrawReason.trim().length < 10) { setError("Nhập lý do rút hồ sơ (ít nhất 10 ký tự)."); return; }
    setWithdrawing(true); setError(null);
    try {
      const result = await withdrawTeamRegistration(entry.registration.id, withdrawReason);
      setEntries((current) => current.map((item) => item.registration.id === result.registration.id ? { ...item, registration: result.registration } : item));
      setSelected((current) => current?.registration.id === result.registration.id ? { ...current, registration: result.registration } : current);
      setWithdrawReason("");
    } catch (withdrawError) {
      setError(withdrawError instanceof Error ? withdrawError.message : "Không thể rút hồ sơ lúc này.");
    } finally { setWithdrawing(false); }
  }

  async function handleApprovedWithdrawalRequest(entry: Entry) {
    if (withdrawReason.trim().length < 10) { setError("Nhập lý do xin rút đội (ít nhất 10 ký tự)."); return; }
    setWithdrawing(true); setError(null);
    try {
      const { withdrawalRequest } = await requestTeamRegistrationWithdrawal(entry.registration.id, withdrawReason);
      setWithdrawalRequests((current) => [withdrawalRequest, ...current]);
      setWithdrawalRequestSent(true);
      setWithdrawReason("");
    } catch (withdrawError) {
      setError(withdrawError instanceof Error ? withdrawError.message : "Không thể gửi yêu cầu rút đội.");
    } finally { setWithdrawing(false); }
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([getMyTeams(), getMyTeamTournamentRegistrations(), canManage ? getMyManagedTeams() : Promise.resolve({ teams: [] as Team[] })])
      .then(async ([membership, teamRegistrationResult, management]) => {
        const teamsById = new Map(membership.teams.map((team) => [team.id, team]));
        const allRegistrations = teamRegistrationResult.registrations.flatMap((registration) => {
          const team = teamsById.get(registration.teamId);
          return team ? [{ team, registration }] : [];
        });
        const result = await Promise.all(allRegistrations.map(async (item) => {
          try { return { ...item, tournament: (await getTournament(item.registration.tournamentId)).tournament }; }
          catch { return { ...item, tournament: null }; }
        }));
        if (!active) return;
        setEntries(result.sort((a, b) => b.registration.registeredAt.localeCompare(a.registration.registeredAt)));
        setManagedTeamIds(new Set(management.teams.map((team) => team.id)));
      })
      .catch((loadError: unknown) => { if (active) setError(loadError instanceof Error ? loadError.message : "Không tải được giải đội bạn tham gia."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [canManage, realtimeRevision]);

  useEffect(() => {
    if (!selected) { setRosters([]); setPlayers([]); return; }
    let active = true;
    setDetailLoading(true);
    const withdrawalRequestQuery = canManage && managedTeamIds.has(selected.team.id)
      ? getRegistrationWithdrawalRequests(selected.registration.id)
      : Promise.resolve({ withdrawalRequests: [] as TeamWithdrawalRequest[] });
    Promise.all([getTournamentRosters(selected.registration.tournamentId, selected.team.id), getPlayers(selected.team.id), withdrawalRequestQuery])
      .then(([rosterResult, playerResult, withdrawalResult]) => {
        if (!active) return;
        setRosters(rosterResult.rosters);
        setPlayers(playerResult.players);
        setWithdrawalRequests(withdrawalResult.withdrawalRequests);
        setWithdrawalRequestSent(withdrawalResult.withdrawalRequests.some((request) => request.status === "PENDING" || request.status === "PROCESSING"));
      })
      .catch((detailError: unknown) => { if (active) setError(detailError instanceof Error ? detailError.message : "Không tải được danh sách cầu thủ giải."); })
      .finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [selected, canManage, managedTeamIds, realtimeRevision]);

  return (
    <>
      <section className="panel data-panel my-team-tournaments">
        <div className="panel-heading"><div><span className="eyebrow">THEO DÕI ĐỘI BÓNG</span><h2>Giải đấu đội tôi tham gia</h2><p>Xem trạng thái hồ sơ, danh sách cầu thủ dự giải và lịch sử tham gia của các đội bạn.</p></div></div>
        {error ? <div className="message-banner message-error" role="alert">{error}</div> : null}
        {loading ? <div className="loading-state">Đang tải hồ sơ tham gia giải…</div> : entries.length ? (
          <div className="my-tournament-list">
            {entries.map((entry) => (
              <article className="my-tournament-row" key={entry.registration.id}>
                <div className="my-tournament-icon">🏆</div>
                <div className="my-tournament-copy"><span className={`status-pill status-${entry.registration.status.toLowerCase()}`}>{statusLabels[entry.registration.status]}</span><h3>{entry.tournament?.name ?? "Giải đấu"}</h3><p>{entry.team.name} · Gửi lúc {new Date(entry.registration.registeredAt).toLocaleString("vi-VN")}</p></div>
                <div className="button-row">
                  <button className="text-button" type="button" onClick={() => setSelected(entry)}>Hồ sơ & lịch sử</button>
                  {entry.tournament ? <button className="text-button" type="button" onClick={() => onViewTournament(entry.tournament!.id)}>Lịch & kết quả</button> : null}
          {canManage && managedTeamIds.has(entry.team.id) && ["PENDING", "APPROVED", "REVISION_REQUIRED", "NEEDS_SUPPLEMENT", "CONFLICT_ADJUSTMENT_REQUIRED"].includes(entry.registration.status) ? <button className="primary-button" type="button" onClick={() => onManage(entry.team.id, entry.registration.tournamentId)}>{entry.registration.status === "CONFLICT_ADJUSTMENT_REQUIRED" ? "Điều chỉnh roster" : "Quản lý roster"}</button> : null}
                </div>
              </article>
            ))}
          </div>
        ) : <div className="empty-state"><h3>Chưa có đội nào đăng ký giải</h3><p>Khi đội do bạn tham gia gửi hồ sơ dự giải, lịch sử và roster sẽ hiện tại đây.</p></div>}
      </section>
      <Modal open={Boolean(selected)} title={selected?.tournament?.name ?? "Hồ sơ tham gia giải"} description={selected ? `${selected.team.name} · ${statusLabels[selected.registration.status]}` : undefined} onClose={() => { setSelected(null); setWithdrawalRequestSent(false); }} className="modal-wide">
        {selected ? <div className="my-tournament-detail">
          <div className="my-tournament-facts"><div><span>ĐỘI BÓNG</span><strong>{selected.team.name}</strong></div><div><span>TRẠNG THÁI</span><strong>{statusLabels[selected.registration.status]}</strong></div><div><span>SỐ THỨ TỰ FIFO</span><strong>#{selected.registration.submissionSequence}</strong></div><div><span>THỜI GIAN GỬI</span><strong>{new Date(selected.registration.submittedAt).toLocaleString("vi-VN")}</strong></div><div><span>PHẢN HỒI / GHI CHÚ</span><strong>{selected.registration.notes || "Chưa có ghi chú từ BTC"}</strong></div>{selected.registration.status === "CONFLICT_ADJUSTMENT_REQUIRED" ? <div><span>CẦU THỦ CẦN THAY</span><strong>{(selected.registration.registrationConflicts ?? []).map((conflict) => `${players.find((player) => player.id === conflict.playerId)?.fullName ?? conflict.playerName ?? "Cầu thủ"} · ${conflict.conflictingTournamentName}`).join("; ") || "Xem roster bên dưới"}</strong></div> : null}{selected.registration.status === "CONFLICT_ADJUSTMENT_REQUIRED" && selected.registration.adjustmentDeadline ? <div><span>HẠN ĐIỀU CHỈNH</span><strong>{new Date(selected.registration.adjustmentDeadline).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</strong></div> : null}{selected.registration.supplementDeadline ? <div><span>HẠN BỔ SUNG</span><strong>{new Date(selected.registration.supplementDeadline).toLocaleString("vi-VN")}{selected.registration.supplementCompletedAt ? ` · Đã gửi bổ sung ${new Date(selected.registration.supplementCompletedAt).toLocaleString("vi-VN")}` : ""}</strong></div> : null}</div>
          <section><div className="panel-heading"><div><span className="eyebrow">DANH SÁCH CẦU THỦ DỰ GIẢ</span><h3>Roster giải đấu</h3></div><span className="status-pill">{rosters.length} cầu thủ</span></div>
            {detailLoading ? <div className="loading-state">Đang tải roster…</div> : rosters.length ? <div className="my-tournament-roster">{rosters.map((roster) => { const player = players.find((item) => item.id === roster.playerId); return <article className="institution-row" key={roster.id}><div><strong>{roster.playerNameSnapshot ?? player?.fullName ?? "Cầu thủ"}</strong><p>MSSV: {roster.studentIdSnapshot ?? player?.studentId ?? "—"} · Số áo {roster.jerseyNumberSnapshot ?? "—"} · {roster.positionSnapshot ?? player?.position ?? "Chưa rõ vị trí"} · {roster.lineupRole === "STARTER" ? "Đá chính" : "Dự bị"}{roster.isGoalkeeper ? " · Thủ môn" : ""} · {roster.competitionRole === "PLAYING_CAPTAIN" ? "Đội trưởng thi đấu" : roster.competitionRole === "VICE_CAPTAIN" ? "Đội phó" : "Cầu thủ"}</p></div></article>; })}</div> : <div className="empty-state"><p>Đội chưa gửi danh sách cầu thủ cho giải này.</p></div>}
          </section>
          {canManage && managedTeamIds.has(selected.team.id) && ["PENDING", "REVISION_REQUIRED", "NEEDS_SUPPLEMENT"].includes(selected.registration.status) ? <section className="withdraw-registration-box"><label>Lý do rút hồ sơ<textarea value={withdrawReason} onChange={(event) => setWithdrawReason(event.target.value)} rows={3} minLength={10} maxLength={1000} placeholder="Cho BTC biết vì sao đội xin rút hồ sơ" /></label><button className="button-secondary" type="button" disabled={withdrawing || withdrawReason.trim().length < 10} onClick={() => void handleWithdraw(selected)}>{withdrawing ? "Đang gửi yêu cầu…" : "Rút hồ sơ đang chờ duyệt"}</button><p>Đội đã được duyệt cần gửi yêu cầu rút đội để BTC xử lý theo điều lệ.</p></section> : null}
          {canManage && managedTeamIds.has(selected.team.id) && selected.registration.status === "APPROVED" ? <section className="withdraw-registration-box"><h3>Xin rút đội đã được duyệt</h3>{withdrawalRequestSent ? <p className="message-banner message-info">Đã gửi yêu cầu rút đội. Đội vẫn được xem là đã đăng ký cho tới khi BTC quyết định và đồng bộ xong.</p> : <><label>Lý do gửi BTC<textarea value={withdrawReason} onChange={(event) => setWithdrawReason(event.target.value)} rows={3} minLength={10} maxLength={2000} placeholder="Nêu lý do và các ảnh hưởng đã biết đến giải" /></label><button className="button-secondary" type="button" disabled={withdrawing || withdrawReason.trim().length < 10} onClick={() => void handleApprovedWithdrawalRequest(selected)}>{withdrawing ? "Đang gửi…" : "Gửi yêu cầu rút đội cho BTC"}</button><p>Yêu cầu cần BTC quyết định; hệ thống không tự xóa kết quả hoặc lịch đã công bố.</p></>}{withdrawalRequests.map((request) => <article className="institution-row" key={request.id}><div><strong>{request.status === "PENDING" ? "Đang chờ BTC" : request.status === "PROCESSING" ? "BTC đang đồng bộ quyết định" : request.status === "APPROVED" ? "BTC đã chấp thuận" : "BTC đã từ chối"}</strong><p>{new Date(request.createdAt).toLocaleString("vi-VN")} · {request.reason}</p>{request.decisionNote ? <p>Phản hồi BTC: {request.decisionNote}</p> : null}</div></article>)}</section> : null}
          <div className="form-actions"><button className="text-button" type="button" onClick={() => setSelected(null)}>Đóng</button>{canManage && managedTeamIds.has(selected.team.id) && ["PENDING", "APPROVED", "REVISION_REQUIRED", "NEEDS_SUPPLEMENT", "CONFLICT_ADJUSTMENT_REQUIRED"].includes(selected.registration.status) ? <button className="primary-button" type="button" onClick={() => { const { team, registration } = selected; setSelected(null); onManage(team.id, registration.tournamentId); }}>{selected.registration.status === "CONFLICT_ADJUSTMENT_REQUIRED" ? "Điều chỉnh roster" : "Cập nhật roster"}</button> : null}</div>
        </div> : null}
      </Modal>
    </>
  );
}
