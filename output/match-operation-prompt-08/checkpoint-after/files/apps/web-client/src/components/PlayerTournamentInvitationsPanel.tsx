import { useCallback, useEffect, useState } from "react";
import { NOTIFICATION_REALTIME_EVENT } from "../api/client";
import { getMyTournamentInvitations, getMyPlayerTournamentWithdrawals, requestPlayerTournamentWithdrawal, respondToTournamentInvitation, type PlayerTournamentWithdrawalRequest, type TournamentPlayerInvitation } from "../api/competition";

export function PlayerTournamentInvitationsPanel({ onNotice, focusInvitationId = "" }: { onNotice: (message: string) => void; focusInvitationId?: string }) {
  const [items, setItems] = useState<TournamentPlayerInvitation[]>([]);
  const [withdrawals, setWithdrawals] = useState<PlayerTournamentWithdrawalRequest[]>([]);
  const [withdrawalReasons, setWithdrawalReasons] = useState<Record<string, string>>({});
  const [requestingId, setRequestingId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [invitations, requests] = await Promise.all([getMyTournamentInvitations(), getMyPlayerTournamentWithdrawals()]);
      setItems(invitations.invitations); setWithdrawals(requests.withdrawalRequests);
    }
    catch (err) { setError(err instanceof Error ? err.message : "Không tải được lời mời tham gia giải."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const refresh = () => void load();
    window.addEventListener(NOTIFICATION_REALTIME_EVENT, refresh);
    return () => window.removeEventListener(NOTIFICATION_REALTIME_EVENT, refresh);
  }, [load]);
  useEffect(() => {
    if (!focusInvitationId || loading) return;
    const row = document.querySelector<HTMLElement>(`[data-invitation-id="${CSS.escape(focusInvitationId)}"]`);
    row?.scrollIntoView({ behavior: "smooth", block: "center" });
    row?.focus({ preventScroll: true });
  }, [focusInvitationId, items, loading]);
  async function respond(item: TournamentPlayerInvitation, status: "ACCEPTED" | "DECLINED") {
    setBusyId(item.id); setError("");
    try {
      const { invitation, invalidatedInvitations = [] } = await respondToTournamentInvitation(item.id, status);
      const updates = new Map([invitation, ...invalidatedInvitations].map((row) => [row.id, row]));
      setItems((current) => current.map((row) => updates.get(row.id) ?? row));
      onNotice(status === "ACCEPTED" ? "Đã xác nhận tham gia giải." : "Đã từ chối lời mời tham gia giải.");
    } catch (err) { setError(err instanceof Error ? err.message : "Không cập nhật được phản hồi."); await load(); }
    finally { setBusyId(""); }
  }
  async function requestWithdrawal(item: TournamentPlayerInvitation) {
    const reason = withdrawalReasons[item.id]?.trim() ?? "";
    if (reason.length < 5) { setError("Nhập lý do rút xác nhận (ít nhất 5 ký tự)."); return; }
    setRequestingId(item.id); setError("");
    try {
      const result = await requestPlayerTournamentWithdrawal(item.id, reason);
      setWithdrawals((current) => [result.withdrawalRequest, ...current.filter((request) => request.id !== result.withdrawalRequest.id)]);
      setWithdrawalReasons((current) => ({ ...current, [item.id]: "" }));
      onNotice("Đã gửi yêu cầu rút xác nhận cho đội trưởng. Suất tham gia vẫn được giữ đến khi có quyết định.");
    } catch (err) { setError(err instanceof Error ? err.message : "Không gửi được yêu cầu rút."); await load(); }
    finally { setRequestingId(""); }
  }
  return <section className="panel data-panel">
    <div className="panel-heading"><div><span className="eyebrow">XÁC NHẬN THAM GIA</span><h2>Lời mời dự giải</h2></div><button className="text-button" type="button" onClick={() => void load()}>Tải lại</button></div>
    {error ? <div className="message-banner message-error" role="alert">{error}</div> : null}
    {loading ? <p className="loading-state">Đang tải lời mời…</p> : items.length ? <div className="institution-list">{items.map((item) => <article className={`institution-row ${focusInvitationId === item.id ? "invitation-focused" : ""}`} key={item.id} data-invitation-id={item.id} tabIndex={-1}>
      <div><span className="eyebrow">{item.status === "PENDING" ? "Chờ bạn phản hồi" : item.status === "ACCEPTED" ? "Đã đồng ý" : item.status === "DECLINED" ? "Đã từ chối" : item.status === "EXPIRED" ? "Hết hạn" : item.status === "INVALIDATED" ? "Đã vô hiệu hóa · Trùng thời gian giải" : item.status === "WITHDRAWN" ? "Đã rút xác nhận" : "Đã hủy"}</span>
        <h3>{item.tournament_name ?? "Lời mời tham gia giải"}</h3><p>Đội mời: {item.team_name ?? "Đội bóng"}{item.tournament_start_date ? ` · ${new Date(item.tournament_start_date).toLocaleDateString("vi-VN")}${item.tournament_end_date ? ` – ${new Date(item.tournament_end_date).toLocaleDateString("vi-VN")}` : ""}` : ""}</p><p>{item.full_name ?? "Cầu thủ"} · MSSV {item.student_id ?? "—"}</p>
        <p>{item.competition_role === "PLAYING_CAPTAIN" ? "Đội trưởng thi đấu" : item.competition_role === "VICE_CAPTAIN" ? "Đội phó" : "Cầu thủ"} · {item.position_snapshot ?? "Chưa chọn vị trí"} · Số áo dự kiến {item.proposed_jersey_number ?? "—"} · {item.lineup_role === "STARTER" ? "Đá chính" : "Dự bị"}{item.is_goalkeeper ? " · Thủ môn" : ""}</p>
        {item.message ? <p>{item.message}</p> : null}{item.status === "INVALIDATED" ? <p className="message-banner message-error">{item.status_reason ?? `Lời mời không còn hiệu lực vì bạn đã xác nhận tham gia ${item.conflict_tournament_name ?? "một giải có thời gian trùng"}.`}</p> : null}{item.status === "PENDING" ? <p>Phản hồi trước {new Date(item.expires_at).toLocaleString("vi-VN")}</p> : null}
      </div>
      {item.status === "PENDING" ? <div className="button-row"><button className="primary-button" type="button" disabled={busyId === item.id} onClick={() => void respond(item, "ACCEPTED")}>{busyId === item.id ? "Đang lưu…" : "Đồng ý"}</button><button className="text-button" type="button" disabled={busyId === item.id} onClick={() => void respond(item, "DECLINED")}>Từ chối</button></div> : null}
      {item.status === "ACCEPTED" ? (() => {
        const request = withdrawals.find((entry) => entry.invitationId === item.id && ["PENDING", "PROCESSING"].includes(entry.status));
        return request ? <p className="message-banner message-warning">Yêu cầu rút đang {request.status === "PENDING" ? "chờ đội trưởng xử lý" : "được xử lý"}. Bạn vẫn thuộc roster và vẫn giữ quyền tham gia các giải trùng lịch.</p> : item.can_request_withdrawal ? <div className="field"><label htmlFor={`withdrawal-reason-${item.id}`}>Yêu cầu rút khỏi roster giải này</label><textarea id={`withdrawal-reason-${item.id}`} value={withdrawalReasons[item.id] ?? ""} maxLength={2000} onChange={(event) => setWithdrawalReasons((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="Nêu lý do để đội trưởng xem xét" /><button className="text-button" type="button" disabled={requestingId === item.id} onClick={() => void requestWithdrawal(item)}>{requestingId === item.id ? "Đang gửi…" : "Gửi yêu cầu rút khỏi giải"}</button></div> : <p className="message-banner message-info">Không thể gửi yêu cầu rút tự nguyện: hồ sơ đã được BTC duyệt hoặc roster/giải đã khóa. Việc rút CLB hay rút đội khỏi giải là quy trình khác.</p>;
      })() : null}
      {withdrawals.filter((request) => request.invitationId === item.id && !["PENDING", "PROCESSING"].includes(request.status)).map((request) => <p key={request.id} className={`message-banner ${request.status === "APPROVED" ? "message-success" : "message-warning"}`}>{request.status === "APPROVED" ? "Yêu cầu rút đã được chấp nhận" : "Yêu cầu rút đã bị từ chối"}{request.decisionNote ? ` · ${request.decisionNote}` : ""}</p>)}
    </article>)}</div> : <div className="empty-state"><h3>Chưa có lời mời</h3><p>Lời mời từ đội trưởng sẽ hiển thị tại đây.</p></div>}
  </section>;
}
