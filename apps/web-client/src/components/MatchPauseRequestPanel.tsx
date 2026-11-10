import { useEffect, useState } from "react";
import {
  createMatchPauseRequest,
  getMatchPauseRequests,
  getMatches,
  reviewMatchPauseRequest,
  type Match,
  type MatchPauseRequest,
} from "../api/competition";

type Props = {
  mode: "admin" | "btc";
  tournaments: Array<{ id: string; name: string }>;
  onNotice: (message: string) => void;
};

export function MatchPauseRequestPanel({ mode, tournaments, onNotice }: Props) {
  const [tournamentId, setTournamentId] = useState("");
  const [matches, setMatches] = useState<Match[]>([]);
  const [matchId, setMatchId] = useState("");
  const [requests, setRequests] = useState<MatchPauseRequest[]>([]);
  const [reason, setReason] = useState("");
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTournamentId((current) =>
      tournaments.some((tournament) => tournament.id === current)
        ? current
        : tournaments[0]?.id ?? "",
    );
  }, [tournaments]);

  useEffect(() => {
    if (!tournamentId) {
      setMatches([]);
      setMatchId("");
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    getMatches(tournamentId)
      .then(({ items }) => {
        if (!active) return;
        setMatches(items);
        setMatchId((current) => items.some((match) => match.id === current) ? current : items[0]?.id ?? "");
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Không tải được danh sách trận.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [tournamentId]);

  useEffect(() => {
    if (!matchId || mode !== "btc") {
      setRequests([]);
      return;
    }
    let active = true;
    getMatchPauseRequests(matchId)
      .then(({ requests: items }) => { if (active) setRequests(items); })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Không tải được yêu cầu tạm dừng.");
      });
    return () => { active = false; };
  }, [matchId, mode]);

  const selectedMatch = matches.find((match) => match.id === matchId);

  async function submitRequest() {
    if (!matchId || !reason.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await createMatchPauseRequest(matchId, reason.trim());
      setReason("");
      onNotice("Đã gửi yêu cầu tạm dừng trận đấu đến BTC phụ trách.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không gửi được yêu cầu tạm dừng.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReview(request: MatchPauseRequest, decision: "APPROVED" | "REJECTED") {
    const note = reviewNotes[request.id]?.trim() ?? "";
    if (decision === "REJECTED" && !note) {
      setError("Cần ghi lý do khi từ chối yêu cầu.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await reviewMatchPauseRequest(request.id, decision, note || undefined);
      setRequests((current) => current.map((item) => item.id === request.id
        ? { ...item, status: decision, reviewNote: note || null, reviewedAt: new Date().toISOString() }
        : item));
      onNotice(decision === "APPROVED"
        ? "Đã chấp thuận yêu cầu; trận đấu được chuyển sang trạng thái hoãn để BTC xử lý lịch."
        : "Đã từ chối yêu cầu tạm dừng.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không xử lý được yêu cầu.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="panel data-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{mode === "admin" ? "GIÁM SÁT BẤT THƯỜNG" : "YÊU CẦU TẠM DỪNG"}</span>
          <h2>{mode === "admin" ? "Gửi yêu cầu tạm dừng trận" : "Duyệt yêu cầu tạm dừng trận"}</h2>
        </div>
      </div>
      <div className="form-grid">
        <label className="field">Giải đấu
          <select value={tournamentId} onChange={(event) => setTournamentId(event.target.value)} required>
            <option value="">Chọn giải đấu</option>
            {tournaments.map((tournament) => <option value={tournament.id} key={tournament.id}>{tournament.name}</option>)}
          </select>
        </label>
        <label className="field">Trận đấu
          <select value={matchId} onChange={(event) => setMatchId(event.target.value)} required disabled={loading || !matches.length}>
            <option value="">Chọn trận đấu</option>
            {matches.map((match) => (
              <option value={match.id} key={match.id}>
                {match.round || "Trận"} · {match.id.slice(0, 8)} · {match.status}
              </option>
            ))}
          </select>
        </label>
        {mode === "admin" ? (
          <>
            <label className="field field-wide">Lý do / dấu hiệu bất thường
              <textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={2000} rows={3} required />
            </label>
            <p className="field-wide form-help">
              Gửi yêu cầu không tự dừng trận. BTC của giải sẽ xem xét; khi được duyệt, trận chuyển sang trạng thái hoãn để BTC cập nhật lịch.
            </p>
            <div className="field-wide form-actions">
              <button className="primary-button" type="button" disabled={submitting || !matchId || !reason.trim()} onClick={() => void submitRequest()}>
                {submitting ? "Đang gửi…" : "Gửi yêu cầu"}
              </button>
            </div>
          </>
        ) : null}
      </div>
      {error ? <div className="message-banner message-error" role="alert">{error}</div> : null}
      {mode === "btc" ? loading ? <div className="loading-state">Đang tải dữ liệu…</div> : requests.length ? (
        <div className="institution-list">
          {requests.map((request) => (
            <article className="institution-row" key={request.id}>
              <div>
                <span className="eyebrow">{request.status} · {new Date(request.createdAt).toLocaleString("vi-VN")}</span>
                <p>{request.reason}</p>
                {request.reviewNote ? <p>Lý do xử lý: {request.reviewNote}</p> : null}
              </div>
              {request.status === "PENDING" ? (
                <div className="form-grid">
                  <label className="field">Lý do nếu từ chối
                    <textarea value={reviewNotes[request.id] ?? ""} onChange={(event) => setReviewNotes((current) => ({ ...current, [request.id]: event.target.value }))} maxLength={2000} rows={2} />
                  </label>
                  <div className="button-row">
                    <button className="primary-button" type="button" disabled={submitting} onClick={() => void handleReview(request, "APPROVED")}>Chấp thuận</button>
                    <button className="text-button" type="button" disabled={submitting || !reviewNotes[request.id]?.trim()} onClick={() => void handleReview(request, "REJECTED")}>Từ chối</button>
                  </div>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : <div className="empty-state"><p>Không có yêu cầu tạm dừng cho trận đang chọn.</p></div> : null}
      {selectedMatch?.status === "POSTPONED" && mode === "btc" ? (
        <p className="form-help">Trận đang hoãn. Hãy cập nhật lịch thi đấu sau khi xử lý bất thường.</p>
      ) : null}
    </section>
  );
}
