import { useEffect, useState } from "react";
import { useDialog } from "./DialogProvider";
import { Modal } from "./Modal";
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

export function RosterLockStep({ tournament, open, onClose, teamNames, onNotice, onStatusChange, pendingWorkflowRequestCount = 0 }: { tournament: Tournament; open: boolean; onClose: () => void; teamNames: Map<string, string>; onNotice: (message: string) => void; onStatusChange: (status: string) => Promise<void>; pendingWorkflowRequestCount?: number }) {
  const { confirm } = useDialog();
  const [registrations, setRegistrations] = useState<TeamRegistration[]>([]);
  const [rosterCounts, setRosterCounts] = useState<Map<string, number>>(new Map());
  const [rosterIssues, setRosterIssues] = useState<Map<string, string[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const { registrations: all } = await getTournamentRegistrations(tournament.id);
      const approved = all.filter((registration) => registration.status === "APPROVED");
      const rosters = await Promise.all(approved.map(async (registration) => {
        const entries = (await getTournamentRosters(tournament.id, registration.teamId)).rosters;
        // Eligibility is determined by captain/player confirmation; BTC decides on the whole team application.
        const verified = entries;
        const starters = verified.filter((entry) => entry.lineupRole === "STARTER");
        const issues: string[] = [];
        if (verified.length < (tournament.minPlayers ?? 0)) issues.push(`Cần tối thiểu ${tournament.minPlayers} cầu thủ hợp lệ`);
        if (verified.length > (tournament.maxPlayersPerTeam ?? Number.MAX_SAFE_INTEGER)) issues.push(`Vượt quá ${tournament.maxPlayersPerTeam} cầu thủ`);
        if (starters.length !== (tournament.footballFormat ?? 7)) issues.push(`Cần đúng ${tournament.footballFormat ?? 7} cầu thủ đá chính`);
        if (starters.filter((entry) => entry.isGoalkeeper).length !== 1) issues.push("Đội hình đá chính phải có đúng 1 thủ môn");
        return { teamId: registration.teamId, count: verified.length, issues };
      }));
      setRegistrations(all);
      setRosterCounts(new Map(rosters.map(({ teamId, count }) => [teamId, count])));
      setRosterIssues(new Map(rosters.map(({ teamId, issues }) => [teamId, issues])));
    } catch (err) { setError(err instanceof Error ? err.message : "Không tải được đội hình đăng ký."); }
    finally { setLoading(false); }
  }
  // This modal stays mounted inside the workflow panel. Refresh its application
  // snapshot every time BTC opens it so approvals made since the previous visit
  // cannot leave an enabled stale lock button.
  useEffect(() => {
    if (open) void load();
  }, [tournament.id, open]);
  const approved = registrations.filter((item) => item.status === "APPROVED");
  const undecided = registrations.filter((item) => !["APPROVED", "REJECTED", "APPROVAL_REVOKED", "WITHDRAWN"].includes(item.status));
  const pending = registrations.filter((item) => item.status === "PENDING").length;
  const needsSupplement = registrations.filter((item) => ["NEEDS_SUPPLEMENT", "REVISION_REQUIRED"].includes(item.status)).length;
  const waitlisted = registrations.filter((item) => item.status === "WAITLIST" || Boolean(item.waitlistReason)).length;
  const waitlistNeedsSupplement = registrations.filter((item) => Boolean(item.waitlistReason) && ["NEEDS_SUPPLEMENT", "REVISION_REQUIRED"].includes(item.status)).length;
  const expiredSupplement = registrations.filter((item) =>
    (["NEEDS_SUPPLEMENT", "REVISION_REQUIRED"].includes(item.status)
      && item.supplementDeadline && new Date(item.supplementDeadline).getTime() <= Date.now())
    || (item.status === "REJECTED" && /hết hạn bổ sung hồ sơ|đóng khi hồ sơ còn thiếu/i.test(item.notes ?? ""))).length;
  const minPlayers = tournament.minPlayers ?? 0;
  const minTeams = tournament.minTeams ?? 2;
  const institutionCounts = new Map<string, number>();
  for (const registration of approved) if (registration.institutionId) institutionCounts.set(registration.institutionId, (institutionCounts.get(registration.institutionId) ?? 0) + 1);
  const institutionLimit = tournament.defaultMaxTeamsPerInstitution;
  const overInstitutionLimit = [...institutionCounts.entries()].some(([institutionId, count]) => {
    const customLimit = tournament.institutionTeamLimits?.find((limit) => limit.institutionId === institutionId)?.maxTeams;
    const limit = customLimit ?? institutionLimit;
    return limit !== null && limit !== undefined && count > limit;
  });
  const invalidTeams = approved.filter((item) => {
    const issues = rosterIssues.get(item.teamId) ?? [];
    const customLimit = tournament.institutionTeamLimits?.find((limit) => limit.institutionId === item.institutionId)?.maxTeams;
    const teamLimit = customLimit ?? institutionLimit;
    return issues.length > 0 || (teamLimit !== null && teamLimit !== undefined && (institutionCounts.get(item.institutionId ?? "") ?? 0) > teamLimit);
  });
  const mustFinishReviewQueue = approved.length < tournament.maxTeams && undecided.length > 0;
  const canLock = tournament.status === "REGISTRATION_CLOSED" && approved.length >= minTeams && approved.length <= tournament.maxTeams && pendingWorkflowRequestCount === 0 && invalidTeams.length === 0 && !overInstitutionLimit && !mustFinishReviewQueue;

  async function lockRoster() {
    const finalizationSummary = `Điều lệ: ${minTeams}–${tournament.maxTeams} đội. Chính thức: ${approved.length}. Còn ${pending} chờ duyệt, ${needsSupplement} cần bổ sung (${expiredSupplement} đã quá hạn), ${waitlisted} chờ suất (${waitlistNeedsSupplement} hồ sơ chờ suất chưa hoàn thiện). Khi xác nhận, chỉ đội đã duyệt được khóa roster; hồ sơ còn lại kết thúc xét duyệt theo tình trạng và lý do riêng, các claim của đội không được chọn được giải phóng.`;
    if (!await confirm({ title: `Chốt danh sách ${approved.length} đội?`, description: `Giải “${tournament.name}”. ${finalizationSummary}`, confirmLabel: "Chốt danh sách" })) return;
    setBusy(true); setError(null);
    try {
      await onStatusChange("ROSTER_LOCKED");
      onNotice("Đã chốt danh sách đăng ký và cầu thủ cho giải.");
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Không chốt được danh sách."); }
    finally { setBusy(false); }
  }

  return <Modal open={open} eyebrow="DANH SÁCH ĐƯỢC DUYỆT" title="Kiểm tra và chốt danh sách" description={`Đang có ${approved.length}/${tournament.maxTeams} đội được duyệt. Xem lại danh sách trước khi xác nhận chốt.`} onClose={onClose} className="tournament-roster-lock-modal">
    <div className="workflow-metrics"><article><strong>{minTeams}–{tournament.maxTeams}</strong><span>Điều lệ số đội</span></article><article><strong>{approved.length}</strong><span>Đội chính thức dự kiến</span></article><article><strong>{tournament.maxTeams - approved.length}</strong><span>Suất còn trống</span></article><article><strong>{pending}</strong><span>Chờ xét duyệt</span></article><article><strong>{needsSupplement}</strong><span>Cần bổ sung</span></article><article><strong>{waitlisted}</strong><span>Chờ suất ({waitlistNeedsSupplement} chưa hoàn thiện)</span></article><article><strong>{undecided.length}</strong><span>Chưa có quyết định cuối</span></article><article><strong>{expiredSupplement}</strong><span>Bổ sung quá hạn</span></article><article><strong>{invalidTeams.length}</strong><span>Đội chính thức chưa đạt điều lệ</span></article></div>
    <div className="roster-lock-modal-toolbar"><span>{approved.length} đội được duyệt</span><button type="button" className="text-button" onClick={() => void load()}>Tải lại danh sách</button></div>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {loading ? <p className="muted">Đang kiểm tra hồ sơ và roster…</p> : approved.length ? <div className="institution-list roster-lock-approved-list">{approved.map((registration) => {
      const customLimit = tournament.institutionTeamLimits?.find((limit) => limit.institutionId === registration.institutionId)?.maxTeams;
      const schoolLimit = customLimit ?? institutionLimit;
      const schoolExceeded = schoolLimit !== null && schoolLimit !== undefined && (institutionCounts.get(registration.institutionId ?? "") ?? 0) > schoolLimit;
      const issues = [...(rosterIssues.get(registration.teamId) ?? []), ...(schoolExceeded ? [`Trường vượt hạn mức ${schoolLimit} đội`] : []), ...(approved.length > tournament.maxTeams ? [`Giải vượt giới hạn ${tournament.maxTeams} đội`] : [])];
      return <article className="institution-row" key={registration.id}><div><strong>{teamNames.get(registration.teamId) ?? `Đội ${registration.teamId.slice(0, 8)}`}</strong><p>{registration.institutionName ?? "Chưa rõ trường"}</p>{issues.length ? <p className="form-error">{issues.join(" · ")}</p> : null}</div><span>{rosterCounts.get(registration.teamId) ?? 0} / {tournament.maxPlayersPerTeam} cầu thủ · {issues.length ? "Cần xử lý" : "Đủ điều kiện"}</span></article>;
    })}</div> : <p className="muted">Chưa có đội nào được duyệt.</p>}
    <p className="form-help">Bắt buộc: đã đóng đăng ký; số đội chính thức nằm trong khoảng {minTeams}–{tournament.maxTeams}; roster, giới hạn theo trường và cấu hình thể thức hợp lệ; không còn yêu cầu đang mở ảnh hưởng trực tiếp đến đội chính thức. Khi còn suất và vẫn còn hồ sơ chưa có quyết định cuối, BTC phải tiếp tục xử lý hàng chờ trước khi chốt. Có thể chốt dưới mức tối đa khi không còn hồ sơ nào chưa xử lý.</p>
    {mustFinishReviewQueue ? <div className="message-banner message-warning" role="status">Còn {tournament.maxTeams - approved.length} suất và {undecided.length} hồ sơ chưa có quyết định cuối. Hãy tiếp tục phê duyệt hoặc từ chối hồ sơ; chỉ chốt dưới {tournament.maxTeams} đội khi hàng chờ đã hết.</div> : null}
    {tournament.status === "ROSTER_LOCKED" || ["PREPARING", "IN_PROGRESS", "PAUSED", "COMPLETED"].includes(tournament.status) ? <div className="message-banner message-success">Danh sách đã được khóa theo trạng thái hiện tại của giải. Snapshot roster đã lưu ở backend.</div> : <div className="form-actions roster-lock-modal-actions"><button className="primary-button" type="button" disabled={busy || loading || !canLock} title={!canLock ? "Cần đóng đăng ký, đạt tối thiểu, xử lý hết hồ sơ chưa có quyết định khi còn suất, bảo đảm roster/giới hạn trường hợp lệ và giải quyết yêu cầu đang mở ảnh hưởng tới đội chính thức." : undefined} onClick={() => void lockRoster()}>{busy ? "Đang chốt…" : "Chốt danh sách"}</button>{!canLock ? <span className="form-help">Chưa thể chốt: {!approved.length || approved.length < minTeams ? `cần tối thiểu ${minTeams} đội đã duyệt; hiện có ${approved.length}.` : tournament.status !== "REGISTRATION_CLOSED" ? "đăng ký phải được đóng trước." : invalidTeams.length ? `${invalidTeams.length} đội chính thức cần sửa roster/điều lệ.` : overInstitutionLimit ? "vượt giới hạn số đội theo trường." : pendingWorkflowRequestCount ? "còn yêu cầu xử lý ảnh hưởng tới đội chính thức." : mustFinishReviewQueue ? `còn ${undecided.length} hồ sơ chưa có quyết định cuối và vẫn còn suất; tiếp tục xét duyệt/từ chối cho đến khi đủ ${tournament.maxTeams} đội hoặc hết hồ sơ.` : `số đội phải không vượt ${tournament.maxTeams}.`}</span> : null}</div>}
  </Modal>;
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
    <div className="panel-heading"><div><span className="eyebrow">BƯỚC 7 · TỔNG KẾT</span><h2>Bảng xếp hạng chính thức</h2><p>Chỉ kết quả được công nhận chính thức được tính vào bảng xếp hạng.</p></div><span className="status-pill">{tournament.status === "COMPLETED" ? "Đã kết thúc" : ready ? "Đủ điều kiện tổng kết" : "Còn trận cần xử lý"}</span></div>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {loading ? <p className="muted">Đang tổng hợp…</p> : standings.length ? <div className="match-table"><div className="table-head match-row"><span>HẠNG</span><span>ĐỘI</span><span>ĐÃ ĐẤU</span><span>HIỆU SỐ</span><span>ĐIỂM</span></div>{standings.map((standing) => <div className="match-row" key={standing.id}><strong>{standing.groupRank || "—"}</strong><strong>{standing.teamName??"Đội đang cập nhật"}</strong><span>{standing.played}</span><span>{standing.goalDifference > 0 ? "+" : ""}{standing.goalDifference}</span><strong>{standing.points}</strong></div>)}</div> : <p className="muted">Chưa có kết quả chính thức để tổng kết.</p>}
    {tournament.status !== "COMPLETED" ? <div className="form-actions"><button className="primary-button" type="button" disabled={busy || loading || !ready} onClick={() => void finishTournament()}>{busy ? "Đang cập nhật…" : "Kết thúc giải đấu"}</button>{!ready ? <span className="form-help">Cần có lịch trận và tất cả trận phải được xác nhận kết quả trước khi kết thúc.</span> : null}</div> : null}
  </section>;
}
