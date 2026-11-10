import { useEffect, useState } from "react";
import {
  getMatches,
  getStandings,
  getTournament,
  getTournamentRegistrations,
  getTournamentRosters,
  type Standing,
  type TeamRegistration,
  type Tournament,
} from "../api/competition";

export function RosterLockStep({ tournament, onNotice, onStatusChange }: { tournament: Tournament; onNotice: (message: string) => void; onStatusChange: (status: string) => Promise<void> }) {
  const [registrations, setRegistrations] = useState<TeamRegistration[]>([]);
  const [rosterCounts, setRosterCounts] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const { registrations: all } = await getTournamentRegistrations(tournament.id);
      const approved = all.filter((registration) => registration.status === "APPROVED");
      const rosters = await Promise.all(approved.map(async (registration) => ({
        teamId: registration.teamId,
        entries: (await getTournamentRosters(tournament.id, registration.teamId)).rosters,
      })));
      setRegistrations(all);
      setRosterCounts(new Map(rosters.map(({ teamId, entries }) => [teamId, entries.filter((entry) => entry.isVerified).length])));
    } catch (err) { setError(err instanceof Error ? err.message : "Không tải được đội hình đăng ký."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [tournament.id]);
  const approved = registrations.filter((item) => item.status === "APPROVED");
  const pending = registrations.filter((item) => item.status === "PENDING").length;
  const minPlayers = tournament.minPlayers ?? 0;
  const minTeams = tournament.minTeams ?? 2;
  const invalidTeams = approved.filter((item) => (rosterCounts.get(item.teamId) ?? 0) < minPlayers);
  const canLock = tournament.status === "REGISTRATION_CLOSED" && approved.length >= minTeams && pending === 0 && invalidTeams.length === 0;

  async function lockRoster() {
    setBusy(true); setError(null);
    try {
      await onStatusChange("ROSTER_LOCKED");
      onNotice("Đã chốt danh sách đăng ký và cầu thủ cho giải.");
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Không chốt được danh sách."); }
    finally { setBusy(false); }
  }

  return <section className="panel data-panel workflow-phase-panel">
    <div className="panel-heading"><div><span className="eyebrow">BƯỚC 3 · CHỐT DANH SÁCH</span><h2>Kiểm tra điều kiện roster</h2></div><button type="button" className="text-button" onClick={() => void load()}>Tải lại</button></div>
    <div className="workflow-metrics"><article><strong>{approved.length}/{minTeams}</strong><span>Đội đã duyệt / tối thiểu</span></article><article><strong>{pending}</strong><span>Hồ sơ còn chờ duyệt</span></article><article><strong>{invalidTeams.length}</strong><span>Roster thiếu cầu thủ hợp lệ</span></article></div>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {loading ? <p className="muted">Đang kiểm tra hồ sơ và roster…</p> : <div className="institution-list">{approved.map((registration) => <article className="institution-row" key={registration.id}><div><strong>Đội {registration.teamId.slice(0, 8)}</strong><p>{registration.institutionName ?? "Chưa rõ trường"}</p></div><span>{rosterCounts.get(registration.teamId) ?? 0} / {minPlayers} cầu thủ hợp lệ</span></article>)}</div>}
    <p className="form-help">Chỉ chốt khi đã đóng đăng ký, đủ số đội tối thiểu, không còn hồ sơ chờ duyệt và mọi đội đạt số cầu thủ tối thiểu theo roster đã xác minh.</p>
    {tournament.status === "ROSTER_LOCKED" || ["PREPARING", "IN_PROGRESS", "PAUSED", "COMPLETED"].includes(tournament.status) ? <div className="message-banner message-success">Danh sách đã được khóa theo trạng thái hiện tại của giải.</div> : <div className="form-actions"><button className="primary-button" type="button" disabled={busy || loading || !canLock} onClick={() => void lockRoster()}>{busy ? "Đang chốt…" : "Chốt danh sách"}</button>{!canLock ? <span className="form-help">Điều kiện chưa đạt hoặc giải chưa ở trạng thái Đã đóng đăng ký.</span> : null}</div>}
  </section>;
}

export function TournamentWrapUpStep({ tournament, onNotice, onStatusChange }: { tournament: Tournament; onNotice: (message: string) => void; onStatusChange: (status: string) => Promise<void> }) {
  const [standings, setStandings] = useState<Standing[]>([]);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([getStandings(tournament.id), getMatches(tournament.id)])
      .then(([standingResult, matchResult]) => {
        if (!active) return;
        setStandings(standingResult.standings);
        setReady(matchResult.items.length > 0 && matchResult.items.every((match) => ["VERIFIED", "LOCKED"].includes(match.status)));
      }).catch((err: unknown) => { if (active) setError(err instanceof Error ? err.message : "Không tải được tổng kết."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [tournament.id]);

  async function finishTournament() {
    setBusy(true); setError(null);
    try {
      await onStatusChange("COMPLETED");
      onNotice("Đã chuyển giải sang trạng thái kết thúc.");
      await getTournament(tournament.id);
    } catch (err) { setError(err instanceof Error ? err.message : "Không thể kết thúc giải."); }
    finally { setBusy(false); }
  }

  return <section className="panel data-panel workflow-phase-panel">
    <div className="panel-heading"><div><span className="eyebrow">BƯỚC 8 · TỔNG KẾT</span><h2>Bảng xếp hạng chính thức</h2><p>Chỉ kết quả đã được BTC xác nhận được tính vào bảng xếp hạng.</p></div><span className="status-pill">{tournament.status === "COMPLETED" ? "Đã kết thúc" : ready ? "Đủ điều kiện tổng kết" : "Còn trận cần xử lý"}</span></div>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {loading ? <p className="muted">Đang tổng hợp…</p> : standings.length ? <div className="match-table"><div className="table-head match-row"><span>HẠNG</span><span>ĐỘI</span><span>ĐÃ ĐẤU</span><span>HIỆU SỐ</span><span>ĐIỂM</span></div>{[...standings].sort((a, b) => b.points - a.points || b.goalDifference - a.goalDifference).map((standing, index) => <div className="match-row" key={standing.id}><strong>{index + 1}</strong><strong>{standing.teamId}</strong><span>{standing.played}</span><span>{standing.goalDifference > 0 ? "+" : ""}{standing.goalDifference}</span><strong>{standing.points}</strong></div>)}</div> : <p className="muted">Chưa có kết quả chính thức để tổng kết.</p>}
    {tournament.status !== "COMPLETED" ? <div className="form-actions"><button className="primary-button" type="button" disabled={busy || loading || !ready} onClick={() => void finishTournament()}>{busy ? "Đang cập nhật…" : "Kết thúc giải đấu"}</button>{!ready ? <span className="form-help">Cần có lịch trận và tất cả trận phải được xác nhận kết quả trước khi kết thúc.</span> : null}</div> : null}
  </section>;
}
