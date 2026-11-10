import { useEffect, useMemo, useState } from "react";
import {
  getTournament,
  getTournaments,
  getTournamentWorkflowState,
  updateTournamentWorkflowStep,
  getTournamentRegistrations,
  getDrawManagement,
  getMatches,
  getManagedTournamentSchedules,
  getMatchReport,
  getMatchResult,
  updateTournament,
  type Tournament,
  type TournamentCreateInput,
} from "../api/competition";
import type { Institution } from "../api/institutions";
import { TournamentCreateForm } from "./TournamentCreateForm";
import { MatchOperationsPanel } from "./MatchOperationsPanel";
import { DrawWorkflowPanel } from "./DrawWorkflowPanel";
import { ScheduleManagementPanel } from "./ScheduleManagementPanel";
import { TournamentDetailPanel } from "./TournamentDetailPanel";
import { TournamentWorkflowPanel } from "./TournamentWorkflowPanel";
import { RosterLockStep, TournamentWrapUpStep } from "./TournamentProgressSteps";

type AssignedTournament = { id: string; name: string; status: string };
type Tab = "current" | "mine";

type Props = {
  assignedTournaments: AssignedTournament[];
  institutions: Institution[];
  userInstitutionId: string | null;
  creating: boolean;
  onCreateTournament: (input: TournamentCreateInput) => Promise<void>;
  teamNames: Map<string, string>;
  onNotice: (message: string) => void;
  onOpenSection: (tournamentId: string, section: "matches" | "standings") => void;
};

const visibleStatuses = [
  "OPEN_REGISTRATION",
  "REGISTRATION_CLOSED",
  "ROSTER_LOCKED",
  "PREPARING",
  "IN_PROGRESS",
  "PAUSED",
  "COMPLETED",
  "CANCELLED",
];
const statusNames: Record<string, string> = {
  OPEN_REGISTRATION: "Mở đăng ký",
  REGISTRATION_CLOSED: "Đóng đăng ký",
  ROSTER_LOCKED: "Khóa danh sách",
  PREPARING: "Chuẩn bị",
  IN_PROGRESS: "Đang diễn ra",
  PAUSED: "Tạm dừng",
  COMPLETED: "Đã kết thúc",
  CANCELLED: "Đã hủy",
  DRAFT: "Bản nháp",
};

function tournamentDate(value: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

async function getCompletedWorkflowSteps(tournament: Tournament): Promise<{ completed: boolean[]; registrationCount: number }> {
  const registrationResult = await getTournamentRegistrations(tournament.id);
  const approved = registrationResult.registrations.filter((item) => item.status === "APPROVED").length;
  const hasPending = registrationResult.registrations.some((item) => item.status === "PENDING");
  const step1 = tournament.status !== "DRAFT";
  const step2 = !["DRAFT", "OPEN_REGISTRATION"].includes(tournament.status) && !hasPending && approved >= (tournament.minTeams ?? 2);
  const step3 = ["ROSTER_LOCKED", "PREPARING", "IN_PROGRESS", "PAUSED", "COMPLETED"].includes(tournament.status);
  const draw = await getDrawManagement(tournament.id);
  const step4 = draw.latestVersion?.status === "PUBLISHED";
  const matchResult = await getMatches(tournament.id);
  const scheduleResult = await getManagedTournamentSchedules(tournament.id);
  const publishedSchedules = scheduleResult.schedules.filter((item) => item.status === "PUBLISHED");
  const scheduledMatchIds = new Set(publishedSchedules.map((item) => item.matchId));
  const step5 = matchResult.items.length > 0 && matchResult.items.every((item) => scheduledMatchIds.has(item.id));
  const step6 = step5 && publishedSchedules.length >= matchResult.items.length && publishedSchedules.every((item) => Boolean(item.refereeId));
  const approvedReports = await Promise.all(matchResult.items.map(async (match) => {
    try {
      const [{ result }, { report }] = await Promise.all([getMatchResult(match.id), getMatchReport(match.id)]);
      return result?.status === "APPROVED" && report?.status === "APPROVED" && ["VERIFIED", "LOCKED"].includes(match.status);
    } catch { return false; }
  }));
  const step7 = matchResult.items.length > 0 && approvedReports.every(Boolean);
  const step8 = tournament.status === "COMPLETED";
  return { completed: [step1, step2, step3, step4, step5, step6, step7, step8], registrationCount: registrationResult.registrations.length };
}

export function BtcTournamentWorkspace({
  assignedTournaments,
  institutions,
  userInstitutionId,
  creating,
  onCreateTournament,
  teamNames,
  onNotice,
  onOpenSection,
}: Props) {
  const [tab, setTab] = useState<Tab>("mine");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [scope, setScope] = useState<Tournament["scope"] | "">("");
  const [status, setStatus] = useState("");
  const [sortBy, setSortBy] = useState<"CREATED_AT" | "NAME" | "START_DATE">("CREATED_AT");
  const [institutionId, setInstitutionId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(0);
  const [currentTournaments, setCurrentTournaments] = useState<Tournament[]>([]);
  const [currentTotal, setCurrentTotal] = useState(0);
  const [currentLoading, setCurrentLoading] = useState(false);
  const [currentError, setCurrentError] = useState<string | null>(null);
  const [managedTournaments, setManagedTournaments] = useState<Tournament[]>([]);
  const [managedLoading, setManagedLoading] = useState(false);
  const [managedError, setManagedError] = useState<string | null>(null);
  const [selectedCurrentId, setSelectedCurrentId] = useState("");
  const [selectedManagedId, setSelectedManagedId] = useState("");
  const [manageTournamentId, setManageTournamentId] = useState(() => new URLSearchParams(window.location.search).get("manageTournament") ?? "");
  const [managedSummaries, setManagedSummaries] = useState<Record<string, { registrationCount: number; currentStep: number }>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [workflowLoading, setWorkflowLoading] = useState(false);
  const [completedSteps, setCompletedSteps] = useState<boolean[]>(Array(8).fill(false));
  const [maxUnlockedStep, setMaxUnlockedStep] = useState(1);
  const [workflowRevision, setWorkflowRevision] = useState(0);
  const [workflowLoadedTournamentId, setWorkflowLoadedTournamentId] = useState("");
  const [registrationCount, setRegistrationCount] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setAppliedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (tab !== "current") return;
    let active = true;
    setCurrentLoading(true);
    setCurrentError(null);
    getTournaments({
      statuses: status ? [status] : visibleStatuses,
      search: appliedSearch || undefined,
      scope: scope || undefined,
      institutionId: institutionId || undefined,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
      sortBy,
      sortOrder: sortBy === "CREATED_AT" ? "DESC" : "ASC",
      limit: 20,
      offset: page * 20,
    }).then(({ items, total }) => {
      if (!active) return;
      setCurrentTournaments(items);
      setCurrentTotal(total);
      setSelectedCurrentId((current) =>
        items.some((tournament) => tournament.id === current) ? current : "",
      );
    }).catch((error: unknown) => {
      if (active) setCurrentError(error instanceof Error ? error.message : "Không tải được giải hiện hành.");
    }).finally(() => {
      if (active) setCurrentLoading(false);
    });
    return () => { active = false; };
  }, [appliedSearch, fromDate, institutionId, page, scope, sortBy, status, tab, toDate]);

  useEffect(() => {
    let active = true;
    setManagedLoading(true);
    setManagedError(null);
    Promise.all(assignedTournaments.map(async (item) =>
      (await getTournament(item.id)).tournament,
    )).then((items) => {
      if (!active) return;
      setManagedTournaments(items);
      setSelectedManagedId((current) =>
        items.some((tournament) => tournament.id === current) ? current : items[0]?.id ?? "",
      );
    }).catch((error: unknown) => {
      if (active) setManagedError(error instanceof Error ? error.message : "Không tải được giải do bạn quản lý.");
    }).finally(() => {
      if (active) setManagedLoading(false);
    });
    return () => { active = false; };
  }, [assignedTournaments]);

  useEffect(() => {
    let active = true;
    Promise.all(managedTournaments.map(async (tournament) => {
      const [registrationResult, workflowResult] = await Promise.all([
        getTournamentRegistrations(tournament.id),
        getTournamentWorkflowState(tournament.id),
      ]);
      return [tournament.id, { registrationCount: registrationResult.registrations.length, currentStep: workflowResult.workflow.currentStep }] as const;
    })).then((entries) => { if (active) setManagedSummaries(Object.fromEntries(entries)); })
      .catch(() => { if (active) setManagedSummaries({}); });
    return () => { active = false; };
  }, [managedTournaments]);

  const selectedCurrent = currentTournaments.find((item) => item.id === selectedCurrentId) ?? null;
  const filteredManaged = useMemo(() => managedTournaments.filter((tournament) => {
    const query = appliedSearch.toLocaleLowerCase("vi");
    const matchesSearch = !query ||
      tournament.name.toLocaleLowerCase("vi").includes(query) ||
      (tab === "current" && (tournament.organizerName ?? "").toLocaleLowerCase("vi").includes(query));
    const matchesScope = !scope || tournament.scope === scope;
    const matchesStatus = !status || tournament.status === status;
    const matchesInstitution = !institutionId || tournament.organizingInstitutionId === institutionId;
    const start = tournamentDate(tournament.startDate);
    const matchesFrom = !fromDate || (start > 0 && start >= Date.parse(`${fromDate}T00:00:00`));
    const matchesTo = !toDate || (start > 0 && start <= Date.parse(`${toDate}T23:59:59`));
    return matchesSearch && matchesScope && matchesStatus && matchesInstitution && matchesFrom && matchesTo;
  }).sort((a, b) => {
    if (sortBy === "NAME") return a.name.localeCompare(b.name, "vi");
    if (sortBy === "START_DATE") return tournamentDate(a.startDate) - tournamentDate(b.startDate);
    return 0;
  }), [appliedSearch, fromDate, institutionId, managedTournaments, scope, sortBy, status, toDate]);

  useEffect(() => {
    if (selectedManagedId && !filteredManaged.some((item) => item.id === selectedManagedId)) {
      setSelectedManagedId("");
    }
  }, [filteredManaged, selectedManagedId]);

  const pageCount = Math.max(1, Math.ceil(currentTotal / 20));
  const managedTournament = managedTournaments.find((item) => item.id === manageTournamentId) ?? null;

  useEffect(() => {
    if (!manageTournamentId || !managedTournament) return;
    let active = true;
    setWorkflowLoadedTournamentId("");
    setWorkflowLoading(true);
    Promise.all([getTournamentWorkflowState(manageTournamentId), getCompletedWorkflowSteps(managedTournament)])
      .then(([{ workflow }, completion]) => {
        if (!active) return;
        const firstIncomplete = completion.completed.findIndex((done) => !done);
        const maxUnlocked = firstIncomplete < 0 ? 8 : Math.min(8, firstIncomplete + 1);
        setCompletedSteps(completion.completed);
        setRegistrationCount(completion.registrationCount);
        setMaxUnlockedStep(maxUnlocked);
        setCurrentStep(Math.min(workflow.currentStep, maxUnlocked));
        setWorkflowLoadedTournamentId(manageTournamentId);
      })
      .catch((error: unknown) => { if (active) setManagedError(error instanceof Error ? error.message : "Không tải được tiến độ quy trình."); })
      .finally(() => { if (active) setWorkflowLoading(false); });
    return () => { active = false; };
  }, [manageTournamentId, managedTournament?.status, workflowRevision]);

  function noticeAndRefreshWorkflow(message: string) {
    onNotice(message);
    setWorkflowRevision((revision) => revision + 1);
  }

  async function changeTournamentStatus(status: string) {
    if (!managedTournament) return;
    const { tournament } = await updateTournament(managedTournament.id, { status });
    setManagedTournaments((items) => items.map((item) => item.id === tournament.id ? tournament : item));
  }

  async function selectWorkflowStep(step: number) {
    if (!manageTournamentId || workflowLoadedTournamentId !== manageTournamentId || step < 1 || step > maxUnlockedStep) return;
    setWorkflowLoading(true);
    setManagedError(null);
    try {
      const { workflow } = await updateTournamentWorkflowStep(manageTournamentId, step);
      setCurrentStep(workflow.currentStep);
    } catch (error) {
      setManagedError(error instanceof Error ? error.message : "Không lưu được bước đang chọn.");
    } finally { setWorkflowLoading(false); }
  }

  const workflowSteps = [
    { number: 1, icon: "✦", title: "Tạo giải và công bố" },
    { number: 2, icon: "♧", title: "Xét duyệt đội và cầu thủ" },
    { number: 3, icon: "✓", title: "Chốt danh sách" },
    { number: 4, icon: "⚄", title: "Chia bảng / bốc thăm" },
    { number: 5, icon: "◷", title: "Xếp lịch và phân công sân" },
    { number: 6, icon: "⚑", title: "Phân công trọng tài" },
    { number: 7, icon: "▣", title: "Theo dõi và duyệt biên bản" },
    { number: 8, icon: "★", title: "Tổng kết và kết thúc giải" },
  ];
  if (manageTournamentId && managedTournament) {
    const workflowReady = workflowLoadedTournamentId === manageTournamentId;
    const currentManaged = [{ id: managedTournament.id, name: managedTournament.name, status: managedTournament.status }];
    const completedThrough = completedSteps.filter(Boolean).length;
    return <div className="btc-managed-tournament">
      <div className="btc-managed-toolbar">
        <button type="button" className="text-button" onClick={() => { setManageTournamentId(""); const url = new URL(window.location.href); url.searchParams.delete("manageTournament"); window.history.replaceState({}, "", url); }}>← Quay lại Giải đấu của tôi</button>
        <span className="status-pill">{statusNames[managedTournament.status] ?? managedTournament.status}</span>
      </div>
      <section className="panel data-panel btc-managed-overview">
        <div className="panel-heading panel-heading-wrap"><div><span className="eyebrow">KHÔNG GIAN ĐIỀU HÀNH GIẢI</span><h2>{managedTournament.name}</h2><p>{managedTournament.startDate ? new Date(managedTournament.startDate).toLocaleDateString("vi-VN") : "Chưa có ngày bắt đầu"}{managedTournament.endDate ? ` — ${new Date(managedTournament.endDate).toLocaleDateString("vi-VN")}` : ""} · {registrationCount} đội đăng ký</p></div><strong>{completedThrough}/8 bước hoàn thành</strong></div>
        <div className="btc-workflow-progress" role="progressbar" aria-valuemin={0} aria-valuemax={8} aria-valuenow={completedThrough}><span style={{ width: `${completedThrough * 12.5}%` }} /></div>
        <nav className="btc-workflow-stepper" aria-label="Quy trình quản lý giải đấu">
          {workflowSteps.map((step, index) => {
            const locked = !workflowReady || step.number > maxUnlockedStep;
            const complete = completedSteps[step.number - 1] ?? false;
            const active = currentStep === step.number;
            return <button key={step.number} type="button" className={`btc-workflow-step ${active ? "active" : ""} ${complete ? "complete" : ""} ${locked ? "locked" : ""}`} disabled={locked || workflowLoading} title={locked ? `Đang khóa: hoàn tất bước ${maxUnlockedStep} trước` : step.title} aria-current={active ? "step" : undefined} onClick={() => void selectWorkflowStep(step.number)}>
              <span className="btc-workflow-step-icon">{locked ? "🔒" : complete ? "✓" : step.icon}</span><span className="btc-workflow-step-number">BƯỚC {step.number}</span><strong>{step.title}</strong><small>{locked ? "Đang khóa" : complete ? "Hoàn thành" : active ? "Đang thực hiện" : "Cần xử lý"}</small>
              {index < workflowSteps.length - 1 ? <i className="btc-workflow-connector" aria-hidden="true" /> : null}
            </button>;
          })}
        </nav>
        {workflowLoading ? <p className="muted">Đang tải hoặc lưu bước hiện tại…</p> : null}
        {managedError ? <p className="form-error" role="alert">{managedError}</p> : null}
      </section>
      <section className="btc-workflow-content" aria-live="polite">
        {!workflowReady ? <p className="loading-state">Đang xác minh quyền và tải tiến độ của giải này…</p> : null}
        {workflowReady ? <>
        {currentStep === 1 ? <><WorkflowStatusAction tournament={managedTournament} targetStatus="OPEN_REGISTRATION" label="Công bố giải và mở đăng ký" disabled={managedTournament.status !== "DRAFT"} onStatusChange={changeTournamentStatus} onNotice={noticeAndRefreshWorkflow} /><TournamentDetailPanel key={`step1-${managedTournament.id}`} tournamentId={managedTournament.id} institutions={institutions} canManage onNotice={noticeAndRefreshWorkflow} onClose={() => setManageTournamentId("")} /></> : null}
        {currentStep === 2 ? <><WorkflowStatusAction tournament={managedTournament} targetStatus="REGISTRATION_CLOSED" label="Đóng đăng ký, chuyển sang chốt hồ sơ" disabled={managedTournament.status !== "OPEN_REGISTRATION"} onStatusChange={changeTournamentStatus} onNotice={noticeAndRefreshWorkflow} /><TournamentWorkflowPanel key={`step2-${managedTournament.id}`} mode="btc" assignedTournaments={currentManaged} onNotice={noticeAndRefreshWorkflow} /></> : null}
        {currentStep === 3 ? <RosterLockStep tournament={managedTournament} onNotice={noticeAndRefreshWorkflow} onStatusChange={changeTournamentStatus} /> : null}
        {currentStep === 4 ? <><DrawWorkflowPanel key={`step4-${managedTournament.id}`} tournaments={currentManaged} onNotice={noticeAndRefreshWorkflow} />{managedTournament.status === "ROSTER_LOCKED" ? <WorkflowStatusAction tournament={managedTournament} targetStatus="PREPARING" label="Chuyển sang xếp lịch và phân công" disabled={false} onStatusChange={changeTournamentStatus} onNotice={noticeAndRefreshWorkflow} /> : null}</> : null}
        {currentStep === 5 ? <ScheduleManagementPanel key={`step5-${managedTournament.id}`} tournaments={currentManaged} onNotice={noticeAndRefreshWorkflow} mode="venues" /> : null}
        {currentStep === 6 ? <>{managedTournament.status === "PREPARING" ? <WorkflowStatusAction tournament={managedTournament} targetStatus="IN_PROGRESS" label="Bắt đầu giải đấu" disabled={false} onStatusChange={changeTournamentStatus} onNotice={noticeAndRefreshWorkflow} /> : null}<ScheduleManagementPanel key={`step6-${managedTournament.id}`} tournaments={currentManaged} onNotice={noticeAndRefreshWorkflow} mode="referees" /></> : null}
        {currentStep === 7 ? <MatchOperationsPanel key={`step7-${managedTournament.id}`} mode="btc" tournaments={currentManaged} teamNames={teamNames} onNotice={noticeAndRefreshWorkflow} /> : null}
        {currentStep === 8 ? <TournamentWrapUpStep tournament={managedTournament} onNotice={noticeAndRefreshWorkflow} onStatusChange={changeTournamentStatus} /> : null}
        </> : null}
      </section>
    </div>;
  }

  function resetFilters() {
    setSearch("");
    setAppliedSearch("");
    setScope("");
    setStatus("");
    setInstitutionId("");
    setFromDate("");
    setToDate("");
    setPage(0);
  }

  return (
    <>
      <section className="panel data-panel btc-tournament-workspace">
        <div className="panel-heading panel-heading-wrap">
          <div>
            <p className="eyebrow">KHÔNG GIAN BAN TỔ CHỨC</p>
            <h2>{tab === "current" ? "Tất cả giải đấu" : "Giải đấu của tôi"}</h2>
          </div>
          <span className="muted">{tab === "mine" ? `${managedTournaments.length} giải của bạn` : `${currentTotal} giải đã công bố`}</span>
          {tab === "mine" ? <button type="button" className="primary-button" onClick={() => setCreateOpen((open) => !open)}>＋ Tạo giải đấu</button> : null}
        </div>

        <div className="btc-tournament-tabs" role="tablist" aria-label="Danh sách giải đấu">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "current"}
            className={tab === "current" ? "selected" : ""}
            onClick={() => { setTab("current"); setPage(0); setSelectedManagedId(""); }}
          >
            Tất cả giải đấu
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "mine"}
            className={tab === "mine" ? "selected" : ""}
            onClick={() => { setTab("mine"); setSelectedCurrentId(""); }}
          >
            Giải đấu của tôi
          </button>
        </div>

        <div className="btc-tournament-filters">
          <label>
            <span>Tìm giải</span>
            <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder={tab === "mine" ? "Tìm theo tên giải" : "Tên giải hoặc ban tổ chức"} />
          </label>
          <label>
            <span>Trường tổ chức</span>
            <select value={institutionId} onChange={(event) => { setInstitutionId(event.target.value); setPage(0); }}>
              <option value="">Tất cả trường</option>
              {institutions.map((institution) => (
                <option key={institution.id} value={institution.id}>{institution.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Loại giải</span>
            <select value={scope} onChange={(event) => { setScope(event.target.value as Tournament["scope"] | ""); setPage(0); }}>
              <option value="">Tất cả</option>
              <option value="SINGLE_INSTITUTION">Cấp trường</option>
              <option value="INTER_SCHOOL">Liên trường</option>
            </select>
          </label>
          <label>
            <span>Trạng thái</span>
            <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(0); }}>
              <option value="">Tất cả trạng thái</option>
              {Object.entries(statusNames).map(([value, label]) => (
                visibleStatuses.includes(value) ? <option key={value} value={value}>{label}</option> : null
              ))}
            </select>
          </label>
          <label>
            <span>Sắp xếp</span>
            <select value={sortBy} onChange={(event) => { setSortBy(event.target.value as typeof sortBy); setPage(0); }}>
              <option value="CREATED_AT">Mới cập nhật</option>
              <option value="NAME">Tên giải A–Z</option>
              <option value="START_DATE">Ngày thi đấu gần nhất</option>
            </select>
          </label>
          <label>
            <span>Từ ngày bắt đầu</span>
            <input type="date" value={fromDate} onChange={(event) => { setFromDate(event.target.value); setPage(0); }} />
          </label>
          <label>
            <span>Đến ngày bắt đầu</span>
            <input type="date" value={toDate} onChange={(event) => { setToDate(event.target.value); setPage(0); }} />
          </label>
          <button type="button" className="button button-secondary" onClick={resetFilters}>Đặt lại bộ lọc</button>
        </div>

        {tab === "mine" && createOpen ? <TournamentCreateForm
          institutions={institutions}
          userInstitutionId={userInstitutionId}
          isAdmin={false}
          disabled={creating}
          onSubmit={async (input) => { await onCreateTournament(input); setCreateOpen(false); }}
          onClose={() => setCreateOpen(false)}
        /> : null}

        {tab === "current" ? (
          <>
            <p className="btc-tournament-hint">Khu vực tra cứu công khai của BTC. Mở chi tiết để xem điều lệ, đội tham gia, lịch, kết quả và bảng xếp hạng; các thao tác điều hành nằm trong “Giải đấu của tôi”.</p>
            {currentError ? <p className="form-error" role="alert">{currentError}</p> : null}
            {currentLoading ? <p className="muted">Đang tải danh sách giải…</p> : currentTournaments.length ? (
              <div className="btc-tournament-list">
                {currentTournaments.map((tournament) => {
                  const school = institutions.find((item) => item.id === tournament.organizingInstitutionId);
                  return (
                    <button
                      type="button"
                      key={tournament.id}
                      className={`btc-tournament-row ${selectedCurrentId === tournament.id ? "selected" : ""}`}
                      onClick={() => setSelectedCurrentId(tournament.id)}
                    >
                      <span><strong>{tournament.name}</strong><small>{school?.name ?? "Trường tổ chức chưa ghi nhận"} · {tournament.scope === "SINGLE_INSTITUTION" ? "Cấp trường" : "Liên trường"}</small></span>
                      <span className="status-pill">{statusNames[tournament.status] ?? tournament.status}</span>
                      <span>{tournament.startDate ? new Date(tournament.startDate).toLocaleDateString("vi-VN") : "Chưa có ngày"}</span>
                      <span className="btc-view-action">Xem chi tiết →</span>
                    </button>
                  );
                })}
              </div>
            ) : !currentLoading ? <p className="muted">Không tìm thấy giải hiện hành phù hợp bộ lọc.</p> : null}
            {pageCount > 1 ? (
              <div className="btc-tournament-pagination">
                <button type="button" className="button button-secondary" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>Trước</button>
                <span>Trang {page + 1}/{pageCount}</span>
                <button type="button" className="button button-secondary" disabled={page + 1 >= pageCount} onClick={() => setPage((value) => value + 1)}>Tiếp</button>
              </div>
            ) : null}
            {selectedCurrent ? (
              <TournamentDetailPanel
                key={`current-${selectedCurrent.id}`}
                tournamentId={selectedCurrent.id}
                institutions={institutions}
                onClose={() => setSelectedCurrentId("")}
              />
            ) : null}
          </>
        ) : (
          <>
            <p className="btc-tournament-hint">Danh sách các giải bạn được giao tổ chức. Chọn “Quản lý giải đấu” để mở quy trình riêng của giải đó.</p>
            {managedError ? <p className="form-error" role="alert">{managedError}</p> : null}
            {managedLoading ? <p className="muted">Đang tải các giải được phân công…</p> : filteredManaged.length ? (
              <div className="btc-tournament-list">
                  {filteredManaged.map((tournament) => {
                  const school = institutions.find((item) => item.id === tournament.organizingInstitutionId);
                  return (
                    <article key={tournament.id} className={`btc-tournament-row ${selectedManagedId === tournament.id ? "selected" : ""}`}>
                      <span><strong>{tournament.name}</strong><small>{school?.name ?? "Trường tổ chức chưa ghi nhận"} · {tournament.scope === "SINGLE_INSTITUTION" ? "Cấp trường" : "Liên trường"}</small></span>
                      <span className="status-pill">{statusNames[tournament.status] ?? tournament.status}</span>
                      <span>{tournament.startDate ? new Date(tournament.startDate).toLocaleDateString("vi-VN") : "Chưa có ngày"}</span>
                      <span className="btc-view-action">{managedSummaries[tournament.id]?.registrationCount ?? "—"} đội đăng ký · Bước {managedSummaries[tournament.id]?.currentStep ?? 1}/8</span>
                      <button type="button" className="button button-secondary" onClick={() => { setSelectedManagedId(tournament.id); setManageTournamentId(tournament.id); const url = new URL(window.location.href); url.searchParams.set("manageTournament", tournament.id); window.history.replaceState({}, "", url); }}>Quản lý giải đấu →</button>
                    </article>
                  );
                })}
              </div>
            ) : !managedLoading ? <p className="muted">{managedTournaments.length ? "Không tìm thấy giải do bạn tổ chức phù hợp bộ lọc." : "Bạn chưa được phân công quản lý giải đấu nào."}</p> : null}
          </>
        )}
      </section>
    </>
  );
}

function WorkflowStatusAction(props: {
  tournament: Tournament;
  targetStatus: string;
  label: string;
  disabled: boolean;
  onStatusChange: (status: string) => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const copy: Record<string, { step: string; title: string; description: string }> = {
    OPEN_REGISTRATION: { step: "1", title: "Sẵn sàng công bố", description: "Kiểm tra thông tin, thời gian và điều lệ trước khi mở đăng ký." },
    REGISTRATION_CLOSED: { step: "2", title: "Hoàn tất xét duyệt", description: "Đóng đăng ký để ngừng nhận hồ sơ mới và chuyển sang kiểm tra danh sách." },
    PREPARING: { step: "4", title: "Chốt phương án thi đấu", description: "Chỉ chuyển sang xếp lịch sau khi đã công bố phương án chia bảng." },
    IN_PROGRESS: { step: "6", title: "Sẵn sàng khai mạc", description: "Chỉ bắt đầu khi mọi trận đã có lịch công bố và trọng tài được phân công." },
  };
  const actionCopy = copy[props.targetStatus] ?? { step: "", title: "Cập nhật trạng thái giải", description: "" };
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setSaving(true); setError(null);
    try {
      await props.onStatusChange(props.targetStatus);
      props.onNotice(props.targetStatus === "OPEN_REGISTRATION" ? "Giải đã được công bố và mở đăng ký." : "Đã đóng đăng ký; có thể bắt đầu xét điều kiện để chốt danh sách.");
    } catch (err) { setError(err instanceof Error ? err.message : "Không cập nhật được trạng thái giải."); }
    finally { setSaving(false); }
  }
  if (props.tournament.status === "COMPLETED" || props.tournament.status === "CANCELLED") return null;
  if (props.targetStatus === "OPEN_REGISTRATION" && props.tournament.status !== "DRAFT") return null;
  if (props.targetStatus === "REGISTRATION_CLOSED" && props.tournament.status !== "OPEN_REGISTRATION") return null;
  if (props.targetStatus === "PREPARING" && props.tournament.status !== "ROSTER_LOCKED") return null;
  if (props.targetStatus === "IN_PROGRESS" && props.tournament.status !== "PREPARING") return null;
  return <section className="panel data-panel workflow-phase-panel">
    <div className="panel-heading"><div><span className="eyebrow">BƯỚC {actionCopy.step}</span><h2>{actionCopy.title}</h2><p>{actionCopy.description}</p></div></div>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <button type="button" className="primary-button" disabled={saving || props.disabled} onClick={() => void submit()}>{saving ? "Đang cập nhật…" : props.label}</button>
  </section>;
}
