import { useEffect, useMemo, useState } from "react";
import {
  getMatchById,
  getManagedMatchReport,
  getManagedMatchResult,
  getMatches,
  recordMatchResult,
  reviewMatchReport,
  submitMatchReport,
  updateRefereeMatchStatus,
  type Match,
  type MatchReport,
  type MatchResult,
  type RefereeSchedule,
} from "../api/competition";

type TournamentRef = { id: string; name: string };
type Props = {
  mode: "referee" | "btc";
  schedules?: RefereeSchedule[];
  tournaments?: TournamentRef[];
  teamNames: Map<string, string>;
  onNotice: (message: string) => void;
};

type MatchWork = { match: Match; result: MatchResult | null; report: MatchReport | null; tournamentName: string };

function missing(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "status" in error && (error as { status?: number }).status === 404);
}

export function MatchOperationsPanel({ mode, schedules = [], tournaments = [], teamNames, onNotice }: Props) {
  const [items, setItems] = useState<MatchWork[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [homeScore, setHomeScore] = useState("0");
  const [awayScore, setAwayScore] = useState("0");
  const [halfHome, setHalfHome] = useState("0");
  const [halfAway, setHalfAway] = useState("0");
  const [attendance, setAttendance] = useState("");
  const [weather, setWeather] = useState("");
  const [notes, setNotes] = useState("");
  const [reviewNote, setReviewNote] = useState("");

  const selected = items.find((item) => item.match.id === selectedId) ?? null;
  const workIds = useMemo(() => mode === "referee"
    ? schedules.map((schedule) => ({ id: schedule.matchId, tournamentName: "Lịch được phân công" }))
    : tournaments.map((tournament) => ({ id: tournament.id, tournamentName: tournament.name })),
  [mode, schedules, tournaments]);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      let matchesWithTournament: Array<{ match: Match; tournamentName: string }>;
      if (mode === "referee") {
        matchesWithTournament = (await Promise.all(schedules.map(async (schedule) => {
          try { return { match: (await getMatchById(schedule.matchId)).match, tournamentName: "Lịch được phân công" }; }
          catch (err) { if (missing(err)) return null; throw err; }
        }))).filter((item): item is { match: Match; tournamentName: string } => item !== null);
      } else {
        matchesWithTournament = (await Promise.all(tournaments.map(async (tournament) => {
          const result = await getMatches(tournament.id);
          return result.items.map((match) => ({ match, tournamentName: tournament.name }));
        }))).flat();
      }
      const work = await Promise.all(matchesWithTournament.map(async ({ match, tournamentName }) => {
        const [result, report] = await Promise.all([
          getManagedMatchResult(match.id).then((value) => value.result).catch((err: unknown) => missing(err) ? null : Promise.reject(err)),
          getManagedMatchReport(match.id).then((value) => value.report).catch((err: unknown) => missing(err) ? null : Promise.reject(err)),
        ]);
        return { match, result, report, tournamentName };
      }));
      const visible = mode === "btc"
        ? work.filter((item) => item.report?.status === "PENDING")
        : work.sort((a, b) => (a.match.matchDate ?? "").localeCompare(b.match.matchDate ?? ""));
      setItems(visible);
      setSelectedId((current) => visible.some((item) => item.match.id === current) ? current : visible[0]?.match.id ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được công việc trận đấu.");
    } finally { setLoading(false); }
  }

  useEffect(() => { void refresh(); // refresh when the assigned work changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, schedules.map((item) => item.matchId).join(","), tournaments.map((item) => item.id).join(",")]);

  useEffect(() => {
    if (!selected) return;
    setHomeScore(String(selected.result?.homeScore ?? 0));
    setAwayScore(String(selected.result?.awayScore ?? 0));
    setNotes(selected.result?.notes ?? "");
    setHalfHome("0"); setHalfAway("0"); setAttendance(""); setWeather(""); setReviewNote("");
  }, [selectedId]);

  async function refereeAction(action: "confirm" | "start" | "finish") {
    if (!selected) return;
    const nextStatus = action === "confirm" ? "LINEUP_CONFIRMED" : action === "start" ? "IN_PROGRESS" : "FINISHED";
    setBusy(true); setError(null);
    try {
      await updateRefereeMatchStatus(selected.match.id, nextStatus);
      onNotice(action === "confirm" ? "Đã xác nhận sẵn sàng đội hình." : action === "start" ? "Đã bắt đầu trận đấu." : "Đã kết thúc trận đấu.");
      await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Không cập nhật được trạng thái trận."); }
    finally { setBusy(false); }
  }

  async function submitResultAndReport() {
    if (!selected) return;
    setBusy(true); setError(null);
    try {
      await recordMatchResult({ matchId: selected.match.id, homeScore: Number(homeScore), awayScore: Number(awayScore), notes: notes.trim() || undefined });
      const report = await submitMatchReport({
        matchId: selected.match.id,
        homeScoreAtHalfTime: Number(halfHome), awayScoreAtHalfTime: Number(halfAway),
        attendance: attendance ? Number(attendance) : undefined,
        weather: weather.trim() || undefined, notes: notes.trim() || undefined,
      });
      onNotice(`Đã gửi kết quả và biên bản trận đấu (${report.report.status === "PENDING" ? "chờ BTC duyệt" : "đã tiếp nhận"}).`);
      await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Không gửi được kết quả và biên bản."); }
    finally { setBusy(false); }
  }

  async function review(status: "APPROVED" | "REJECTED" | "REVISION_REQUIRED") {
    if (!selected?.report) return;
    setBusy(true); setError(null);
    try {
      await reviewMatchReport(selected.report.id, status, reviewNote.trim() || undefined);
      onNotice(status === "APPROVED" ? "Đã duyệt biên bản; kết quả được công nhận và tính vào bảng xếp hạng." : status === "REJECTED" ? "Đã từ chối biên bản." : "Đã yêu cầu trọng tài bổ sung biên bản.");
      await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Không cập nhật được biên bản."); }
    finally { setBusy(false); }
  }

  return <section className="panel data-panel match-operations-panel">
    <div className="panel-heading panel-heading-wrap"><div><span className="eyebrow">{mode === "referee" ? "KHU VỰC TRỌNG TÀI" : "KIỂM DUYỆT KẾT QUẢ"}</span><h2>{mode === "referee" ? "Tác nghiệp trận được phân công" : "Biên bản chờ duyệt"}</h2><p>{mode === "referee" ? "Cập nhật trạng thái, ghi nhận tỷ số và gửi biên bản cho BTC." : "Chỉ kết quả có biên bản được duyệt mới được công nhận trên bảng xếp hạng."}</p></div><button className="text-button" type="button" onClick={() => void refresh()}>Tải lại</button></div>
    {error ? <div className="message-banner message-error" role="alert">{error}</div> : null}
    {loading ? <p className="loading-state">Đang tải…</p> : !items.length ? <div className="empty-state"><h3>{mode === "referee" ? "Chưa có trận được phân công" : "Không có biên bản chờ duyệt"}</h3><p>{mode === "referee" ? "Các trận được phân công cho bạn sẽ xuất hiện tại đây." : "Khi trọng tài gửi biên bản, hồ sơ sẽ xuất hiện để BTC xem xét."}</p></div> : <>
      <div className="form-grid">
        <label className="field field-wide">{mode === "referee" ? "Trận đấu được phân công" : "Biên bản cần xem"}<select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{items.map(({ match, report, tournamentName }) => <option key={match.id} value={match.id}>{tournamentName} · {teamNames.get(match.homeTeamId) ?? match.homeTeamId.slice(0, 8)} – {teamNames.get(match.awayTeamId) ?? match.awayTeamId.slice(0, 8)}{report ? ` · ${new Date(report.submittedAt).toLocaleString("vi-VN")}` : ""}</option>)}</select></label>
      </div>
      {selected ? <div className="match-operation-detail">
        <p><strong>{teamNames.get(selected.match.homeTeamId) ?? "Đội nhà"} – {teamNames.get(selected.match.awayTeamId) ?? "Đội khách"}</strong> · {selected.match.round ?? "Trận đấu"} · Trạng thái: {selected.match.status}</p>
        {mode === "referee" ? <>
          <div className="button-row">
            {selected.match.status === "SCHEDULED" ? <button className="button button-secondary" type="button" disabled={busy} onClick={() => void refereeAction("confirm")}>Xác nhận đội hình</button> : null}
            {selected.match.status === "LINEUP_CONFIRMED" ? <button className="primary-button" type="button" disabled={busy} onClick={() => void refereeAction("start")}>Bắt đầu trận</button> : null}
            {selected.match.status === "IN_PROGRESS" ? <button className="button button-secondary" type="button" disabled={busy} onClick={() => void refereeAction("finish")}>Kết thúc trận</button> : null}
          </div>
          {selected.match.status === "FINISHED" && (!selected.report || selected.report.status === "REVISION_REQUIRED") ? <div className="form-grid">
            <label className="field">Tỷ số đội nhà<input type="number" min="0" max="99" value={homeScore} onChange={(event) => setHomeScore(event.target.value)} /></label>
            <label className="field">Tỷ số đội khách<input type="number" min="0" max="99" value={awayScore} onChange={(event) => setAwayScore(event.target.value)} /></label>
            <label className="field">Hiệp 1 · đội nhà<input type="number" min="0" max="99" value={halfHome} onChange={(event) => setHalfHome(event.target.value)} /></label>
            <label className="field">Hiệp 1 · đội khách<input type="number" min="0" max="99" value={halfAway} onChange={(event) => setHalfAway(event.target.value)} /></label>
            <label className="field">Khán giả<input type="number" min="0" value={attendance} onChange={(event) => setAttendance(event.target.value)} /></label>
            <label className="field">Thời tiết<input maxLength={120} value={weather} onChange={(event) => setWeather(event.target.value)} /></label>
            <label className="field field-wide">Ghi chú<textarea maxLength={2000} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
            <div className="field-wide form-actions"><button className="primary-button" type="button" disabled={busy || !Number.isInteger(Number(homeScore)) || !Number.isInteger(Number(awayScore)) || !Number.isInteger(Number(halfHome)) || !Number.isInteger(Number(halfAway))} onClick={() => void submitResultAndReport()}>{busy ? "Đang gửi…" : selected.report?.status === "REVISION_REQUIRED" ? "Gửi lại kết quả và biên bản" : "Gửi kết quả và biên bản"}</button></div>
          </div> : <p className="form-help">{selected.report?.status === "PENDING" ? "Biên bản đã gửi, đang chờ BTC duyệt." : selected.report?.status === "APPROVED" ? "Biên bản và kết quả đã được BTC duyệt." : selected.result?.status === "PENDING" ? "Đã ghi nhận kết quả chờ duyệt. Có thể gửi biên bản sau khi trận kết thúc." : "Kết thúc trận để nhập kết quả và gửi biên bản."}</p>}
        </> : selected.report ? <>
          <dl className="match-report-summary"><div><dt>Trạng thái</dt><dd>{selected.report.status}</dd></div><div><dt>Giờ gửi</dt><dd>{new Date(selected.report.submittedAt).toLocaleString("vi-VN")}</dd></div><div><dt>Tỷ số cuối</dt><dd>{selected.result ? `${selected.result.homeScore} – ${selected.result.awayScore}` : "Chưa có kết quả"}</dd></div><div><dt>Hiệp một</dt><dd>{selected.report.homeScoreAtHalfTime ?? "—"} – {selected.report.awayScoreAtHalfTime ?? "—"}</dd></div><div><dt>Khán giả / thời tiết</dt><dd>{selected.report.attendance ?? "—"} · {selected.report.weather ?? "—"}</dd></div><div><dt>Ghi chú trọng tài</dt><dd>{selected.report.notes || "Không có"}</dd></div></dl>
          <label className="field">Ghi chú xét duyệt<input maxLength={2000} value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="Bắt buộc khi từ chối hoặc yêu cầu bổ sung" /></label>
          <div className="button-row"><button className="primary-button" disabled={busy || selected.match.status !== "FINISHED" || !selected.result} type="button" onClick={() => void review("APPROVED")}>Duyệt kết quả</button><button className="button button-secondary" disabled={busy || !reviewNote.trim()} type="button" onClick={() => void review("REVISION_REQUIRED")}>Yêu cầu bổ sung</button><button className="text-button danger-text-button" disabled={busy || !reviewNote.trim()} type="button" onClick={() => void review("REJECTED")}>Từ chối</button></div>
          {selected.match.status !== "FINISHED" || !selected.result ? <p className="form-help">Chỉ duyệt được khi trận đã kết thúc và có tỷ số được trọng tài ghi nhận.</p> : null}
        </> : null}
      </div> : null}
    </>}
  </section>;
}
