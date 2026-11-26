import { useEffect, useMemo, useState } from "react";
import {
  getTournament,
  getTournaments,
  getTournamentWorkflowState,
  updateTournamentWorkflowStep,
  getTournamentRegistrations,
  getTournamentWithdrawalRequests,
  getTournamentRegistrationReviewSummary,
  getRegistrationControlAvailability,
  controlRegistrationForTest,
  getDrawManagement,
  getManagedTournamentFixtures,
  getAllMatches,
  getManagedTournamentSchedules,
  getMatchReport,
  getMatchResult,
  updateTournament,
  type Tournament,
  type TournamentCreateInput,
} from "../api/competition";
import type { Institution } from "../api/institutions";
import { NOTIFICATION_REALTIME_EVENT } from "../api/client";
import { TournamentCreateForm } from "./TournamentCreateForm";
import { MatchOperationsPanel } from "./MatchOperationsPanel";
import { DrawWorkflowPanel } from "./DrawWorkflowPanel";
import { FixtureDiagramPanel } from "./FixtureDiagramPanel";
import { Step6RefereeWorkspace } from "./Step6RefereeWorkspace";
import { TournamentDetailPanel } from "./TournamentDetailPanel";
import { TournamentWorkflowPanel } from "./TournamentWorkflowPanel";
import { RosterLockStep, TournamentWrapUpStep } from "./TournamentProgressSteps";
import { useDialog } from "./DialogProvider";
import { OfficialScheduleWorkspace } from "./OfficialScheduleWorkspace";

type AssignedTournament = { id: string; name: string; status: string; competitionFormat?: Tournament["competitionFormat"] };
type Tab = "current" | "mine";

type Props = {
  assignedTournaments: AssignedTournament[];
  institutions: Institution[];
  userInstitutionId: string | null;
  creating: boolean;
  onCreateTournament: (input: TournamentCreateInput) => Promise<void>;
  teamNames: Map<string, string>;
  onNotice: (message: string) => void;
  operatorName?: string;
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

function maximumStepForStatus(status: string): number {
  if (status === "DRAFT") return 1;
  if (status === "OPEN_REGISTRATION") return 2;
  if (status === "REGISTRATION_CLOSED") return 2;
  if (status === "ROSTER_LOCKED") return 5;
  if (status === "PREPARING") return 7;
  if (["IN_PROGRESS", "PAUSED", "COMPLETED"].includes(status)) return 8;
  return 1;
}

function visibleWorkflowStep(step: number): number {
  if (step <= 1) return 1;
  if (step <= 3) return 2; // Legacy workflow position 3 is intentionally hidden.
  if (step === 4) return 3;
  if (step === 5) return 4;
  if (step === 6) return 5;
  if (step === 7) return 7;
  return 8;
}

function visibleDrawTestStep(step: number): number {
  return step >= 4 ? step - 1 : step;
}

function apiWorkflowStepForVisibleStep(step: number): number {
  if (step <= 2) return step;
  if (step === 3) return 4;
  if (step === 4) return 5;
  if (step === 5 || step === 6) return 6;
  return step;
}

async function getCompletedWorkflowSteps(tournament: Tournament): Promise<{
  completed: boolean[];
  registrationCount: number;
  pendingApplicationCount: number;
  pendingWithdrawalCount: number;
  pendingApprovalReviewCount: number;
}> {
  const [registrationResult, withdrawalResult, reviewSummary] = await Promise.all([
    getTournamentRegistrations(tournament.id),
    getTournamentWithdrawalRequests(tournament.id),
    getTournamentRegistrationReviewSummary(tournament.id),
  ]);
  const pendingApplicationCount = registrationResult.registrations.filter((item) => ["PENDING", "NEEDS_SUPPLEMENT", "REVISION_REQUIRED", "WAITLIST", "CONFLICT_ADJUSTMENT_REQUIRED"].includes(item.status)).length;
  const step1 = tournament.status !== "DRAFT";
  const step2 = ["ROSTER_LOCKED", "PREPARING", "IN_PROGRESS", "PAUSED", "COMPLETED"].includes(tournament.status);
  const draw = await getDrawManagement(tournament.id);
  const step3 = draw.latestVersion?.status === "PUBLISHED";
  const fixtureResult = await getManagedTournamentFixtures(tournament.id);
  const latestDrawStages = fixtureResult.stages.filter((stage) => stage.drawVersionId === draw.latestVersion?.id);
  const step4 = latestDrawStages.length > 0 && latestDrawStages.every((stage) => stage.status === "PUBLISHED" && stage.matches.length > 0);
  const matchResult = await getAllMatches(tournament.id);
  const scheduleResult = await getManagedTournamentSchedules(tournament.id);
  const publishedSchedules = scheduleResult.schedules.filter((item) => item.status === "PUBLISHED");
  const scheduledMatchIds = new Set(publishedSchedules.map((item) => item.matchId));
  const step5 = matchResult.items.length > 0 && latestDrawStages.length > 0 && latestDrawStages.every((stage) => stage.status === "PUBLISHED")
    && matchResult.items.every((item) => scheduledMatchIds.has(item.id))
    && publishedSchedules.length >= matchResult.items.length;
  const step6 = matchResult.items.length > 0 && matchResult.items.every((match) => {
    const schedule = publishedSchedules.find((item) => item.matchId === match.id);
    return Boolean(schedule?.refereeId);
  });
  const approvedReports = await Promise.all(matchResult.items.map(async (match) => {
    try {
      const [{ result }, { report }] = await Promise.all([getMatchResult(match.id), getMatchReport(match.id)]);
      return result?.status === "APPROVED" && report?.status === "APPROVED" && ["VERIFIED", "LOCKED"].includes(match.status);
    } catch { return false; }
  }));
  const step7 = matchResult.items.length > 0 && approvedReports.every(Boolean);
  const step8 = tournament.status === "COMPLETED";
  return {
    completed: [step1, step2, step3, step4, step5, step6, step7, step8],
    registrationCount: registrationResult.registrations.length,
    pendingApplicationCount,
    pendingWithdrawalCount: withdrawalResult.withdrawalRequests.filter((item) => item.status === "PENDING" || item.status === "PROCESSING").length,
    pendingApprovalReviewCount: reviewSummary.pendingApprovalReviewCount,
  };
}

export function BtcTournamentWorkspace({
  assignedTournaments,
  institutions,
  userInstitutionId,
  creating,
  onCreateTournament,
  teamNames,
  onNotice,
  operatorName,
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
  const [approvedRosterOpen, setApprovedRosterOpen] = useState(false);
  const [workflowBlockers, setWorkflowBlockers] = useState({ pendingApplications: 0, pendingWithdrawals: 0, pendingApprovalReviews: 0 });

  const managedTournament = managedTournaments.find((item) => item.id === manageTournamentId) ?? null;

  useEffect(() => {
    const refresh = () => setWorkflowRevision((revision) => revision + 1);
    window.addEventListener(NOTIFICATION_REALTIME_EVENT, refresh);
    return () => window.removeEventListener(NOTIFICATION_REALTIME_EVENT, refresh);
  }, []);

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
  }, [appliedSearch, fromDate, institutionId, page, scope, sortBy, status, tab, toDate, workflowRevision]);

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
  }, [assignedTournaments, workflowRevision]);

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
  }, [managedTournaments, workflowRevision]);

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

  useEffect(() => {
    if (!manageTournamentId || managedTournament?.status !== "OPEN_REGISTRATION") return;
    let active = true;
    const refreshRegistrationState = async () => {
      try {
        const { tournament } = await getTournament(manageTournamentId);
        if (active && tournament.status !== "OPEN_REGISTRATION") {
          setManagedTournaments((items) => items.map((item) => item.id === tournament.id ? tournament : item));
        }
      } catch { /* A transient refresh failure must not interrupt ongoing review work. */ }
    };
    const timer = window.setInterval(() => void refreshRegistrationState(), 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [manageTournamentId, managedTournament?.status]);

  const pageCount = Math.max(1, Math.ceil(currentTotal / 20));
  useEffect(() => {
    if (!manageTournamentId || !managedTournament) return;
    let active = true;
    setWorkflowLoadedTournamentId("");
    setWorkflowLoading(true);
    setManagedError(null);
    Promise.all([getTournamentWorkflowState(manageTournamentId), getCompletedWorkflowSteps(managedTournament)])
      .then(async ([{ workflow }, completion]) => {
        if (!active) return;
        const workflowCompletion = [...completion.completed];
        const prerequisiteMaximum = !workflowCompletion[2] ? 3 : !workflowCompletion[3] ? 4 : !workflowCompletion[4] ? 5 : managedTournament.status === "COMPLETED" && workflowCompletion[6] ? 8 : 7;
        const maxUnlocked = Math.min(maximumStepForStatus(managedTournament.status), prerequisiteMaximum);
        setCompletedSteps(workflowCompletion);
        setRegistrationCount(completion.registrationCount);
        setWorkflowBlockers({
          pendingApplications: completion.pendingApplicationCount,
          pendingWithdrawals: completion.pendingWithdrawalCount,
          pendingApprovalReviews: completion.pendingApprovalReviewCount,
        });
        setMaxUnlockedStep(maxUnlocked);
        let nextStep = visibleWorkflowStep(workflow.currentStep);
        // Step 3 used to be a standalone roster-lock screen. Roster lock now
        // lives inside registration review (step 2), so normalize saved state.
        if (managedTournament.status === "REGISTRATION_CLOSED" && nextStep >= 3) nextStep = 2;
        if (workflow.currentStep === 3) nextStep = managedTournament.status === "ROSTER_LOCKED" ? 3 : 2;
        if (workflow.currentStep === 6 && workflowCompletion[4]) nextStep = 6;
        const selectedStep = Math.min(nextStep, maxUnlocked);
        const selectedApiStep = apiWorkflowStepForVisibleStep(selectedStep);
        if (selectedApiStep > workflow.currentStep) await updateTournamentWorkflowStep(manageTournamentId, selectedApiStep);
        setCurrentStep(selectedStep);
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
    if (!manageTournamentId || workflowLoadedTournamentId !== manageTournamentId || step < 1) return;
    if (step > maxUnlockedStep) return;
    if (step === 6) { setCurrentStep(6); return; }
    setWorkflowLoading(true);
    setManagedError(null);
    try {
      const { workflow } = await updateTournamentWorkflowStep(manageTournamentId, apiWorkflowStepForVisibleStep(step));
      setCurrentStep(step === 5 ? 5 : visibleWorkflowStep(workflow.currentStep));
    } catch (error) {
      setManagedError(error instanceof Error ? error.message : "Không lưu được bước đang chọn.");
    } finally { setWorkflowLoading(false); }
  }

  async function openFixturesAfterLiveDraw() {
    if (!manageTournamentId) return;
    setWorkflowLoading(true);
    setManagedError(null);
    try {
      // Persist the destination before reload so the refreshed workspace reads
      // Step 4 back and revalidates the published draw through the backend.
      await updateTournamentWorkflowStep(manageTournamentId, apiWorkflowStepForVisibleStep(4));
      window.location.reload();
    } catch (error) {
      setManagedError(error instanceof Error
        ? `Kết quả đã công bố, nhưng chưa chuyển được sang Sơ đồ thi đấu: ${error.message}`
        : "Kết quả đã công bố, nhưng chưa chuyển được sang Sơ đồ thi đấu. Hãy thử nút chuyển bước.");
      setWorkflowLoading(false);
    }
  }

  async function advanceToSchedulingStep() {
    if (!manageTournamentId) return;
    setWorkflowLoading(true);
    setManagedError(null);
    try {
      if (managedTournament?.status === "ROSTER_LOCKED") {
        const { tournament } = await updateTournament(manageTournamentId, { status: "PREPARING" });
        setManagedTournaments((items) => items.map((item) => item.id === tournament.id ? tournament : item));
      }
      const { workflow } = await updateTournamentWorkflowStep(manageTournamentId, 6);
      setCurrentStep(5);
      setMaxUnlockedStep((current) => Math.max(current, 6));
      setCompletedSteps((current) => {
        const next = [...current];
        next[3] = true;
        return next;
      });
      setWorkflowRevision((revision) => revision + 1);
    } catch (error) {
      setCurrentStep(5);
      setMaxUnlockedStep((current) => Math.max(current, 5));
      setManagedError(error instanceof Error ? `Sơ đồ đã công bố, nhưng chưa hoàn tất chuyển sang Lập lịch: ${error.message}` : "Sơ đồ đã công bố, nhưng chưa hoàn tất chuyển sang Lập lịch.");
    } finally {
      setWorkflowLoading(false);
    }
  }

  function markSchedulePublished() {
    if (!manageTournamentId) return;
    setCompletedSteps((values) => values.map((value, index) => index === 4 ? true : value));
    setMaxUnlockedStep((value) => Math.max(value, 6));
  }

  const workflowSteps = [
    { number: 1, workflowStep: 1, completionIndex: 0, icon: "✦", title: "Thông tin & điều lệ" },
    { number: 2, workflowStep: 2, completionIndex: 1, icon: "♧", title: "Xét duyệt & chốt danh sách" },
    { number: 3, workflowStep: 3, completionIndex: 2, icon: "⚄", title: "Bốc thăm & chia bảng" },
    { number: 4, workflowStep: 4, completionIndex: 3, icon: "⌗", title: "Sơ đồ thi đấu" },
    { number: 5, workflowStep: 5, completionIndex: 4, icon: "◷", title: "Lập lịch thi đấu" },
    { number: 6, workflowStep: 6, completionIndex: 5, icon: "⚑", title: "Phân công trọng tài" },
    { number: 7, workflowStep: 7, completionIndex: 6, icon: "▣", title: "Điều hành giải đấu" },
    { number: 8, workflowStep: 8, completionIndex: 7, icon: "★", title: "Tổng kết giải đấu" },
  ];
  if (manageTournamentId && managedTournament) {
    const workflowReady = workflowLoadedTournamentId === manageTournamentId;
    const currentManaged = [{ id: managedTournament.id, name: managedTournament.name, status: managedTournament.status, competitionFormat: managedTournament.competitionFormat, rules: managedTournament.rules }];
    const completedThrough = workflowSteps.filter((step) => completedSteps[step.completionIndex] ?? false).length;
    const registrationPeriod = (managedTournament.registrationPeriods ?? []).slice().sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
    const registrationStart = registrationPeriod?.startDate;
    const registrationEnd = registrationPeriod?.endDate;
    const competitionFormatName = managedTournament.competitionFormat === "ROUND_ROBIN" ? "Vòng tròn"
      : managedTournament.competitionFormat === "KNOCKOUT" ? "Loại trực tiếp"
        : managedTournament.competitionFormat === "GROUP_AND_KNOCKOUT" ? "Vòng bảng · loại trực tiếp" : "Chưa thiết lập thể thức";
    return <div className="btc-managed-tournament">
      <div className="btc-managed-toolbar">
        <button type="button" className="text-button" onClick={() => { setManageTournamentId(""); const url = new URL(window.location.href); url.searchParams.delete("manageTournament"); window.history.replaceState({}, "", url); }}>← Quay lại Giải đấu của tôi</button>
        <span className="status-pill">{statusNames[managedTournament.status] ?? managedTournament.status}</span>
      </div>
      <section className="panel data-panel btc-managed-overview">
        <header className="btc-overview-header">
          <div className="btc-overview-title"><span className="eyebrow">KHÔNG GIAN ĐIỀU HÀNH GIẢI</span><h1>{managedTournament.name}</h1><p>{managedTournament.location ?? "Địa điểm chưa cập nhật"} <span aria-hidden="true">·</span> {managedTournament.startDate ? new Date(managedTournament.startDate).toLocaleDateString("vi-VN") : "Chưa có ngày bắt đầu"}{managedTournament.endDate ? ` — ${new Date(managedTournament.endDate).toLocaleDateString("vi-VN")}` : ""}</p></div>
          <div className="btc-overview-completion"><strong>{completedThrough}<span> / 8</span></strong><span>giai đoạn hoàn thành</span><div className="btc-workflow-progress" role="progressbar" aria-label="Tiến độ quy trình" aria-valuemin={0} aria-valuemax={8} aria-valuenow={completedThrough}><span style={{ width: `${completedThrough * (100 / 8)}%` }} /></div><small>{Math.round(completedThrough * (100 / 8))}% hoàn tất</small></div>
        </header>
        <div className="btc-overview-facts" aria-label="Thông tin giải đấu">
          <div><span aria-hidden="true">♧</span><strong>{registrationCount}</strong><small>Đội đăng ký</small></div>
          <div><span aria-hidden="true">↗</span><strong>{managedTournament.maxTeams}</strong><small>Tối đa đội</small></div>
          <div><span aria-hidden="true">⌖</span><strong>{managedTournament.minTeams ?? 2}</strong><small>Tối thiểu đội</small></div>
          <div><span aria-hidden="true">⚽</span><strong>{competitionFormatName}</strong><small>Thể thức thi đấu</small></div>
          {registrationStart || registrationEnd ? <div><span aria-hidden="true">◷</span><strong>{registrationStart ? new Date(registrationStart).toLocaleDateString("vi-VN") : "—"} – {registrationEnd ? new Date(registrationEnd).toLocaleDateString("vi-VN") : "—"}</strong><small>Thời gian đăng ký</small></div> : null}
        </div>
        <nav className="btc-workflow-stepper" aria-label="Quy trình quản lý giải đấu">
          {workflowSteps.map((step, index) => {
            const locked = !workflowReady || step.workflowStep > maxUnlockedStep;
            const complete = completedSteps[step.completionIndex] ?? false;
            const active = currentStep === step.workflowStep;
            const lastUnlockedNumber = workflowSteps.filter((item) => item.workflowStep <= maxUnlockedStep).at(-1)?.number ?? 1;
            const destinationStep = step.workflowStep;
            return <button key={step.workflowStep} type="button" className={`btc-workflow-step ${active ? "active" : ""} ${complete ? "complete" : ""} ${locked ? "locked" : ""}`} disabled={locked || workflowLoading} title={locked ? `Đang khóa: hoàn tất bước ${lastUnlockedNumber} trước` : step.title} aria-current={active ? "step" : undefined} onClick={() => void selectWorkflowStep(destinationStep)}>
              <span className="btc-workflow-step-icon">{locked ? "🔒" : complete ? "✓" : step.number}</span><strong>{step.title}</strong><small>{locked ? "Đang khóa" : complete ? "Hoàn thành" : active ? "Đang thực hiện" : "Chưa hoàn thành"}</small>
              {index < workflowSteps.length - 1 ? <i className="btc-workflow-connector" aria-hidden="true" /> : null}
            </button>;
          })}
        </nav>
        {workflowLoading ? <p className="muted">Đang tải hoặc lưu bước hiện tại…</p> : null}
        {managedError ? <p className="form-error" role="alert">{managedError}</p> : null}
        {workflowReady && ["OPEN_REGISTRATION", "REGISTRATION_CLOSED"].includes(managedTournament.status) && !completedSteps[1] ? <p className="message-banner message-info" role="status">
          Bước <strong>Duyệt đội</strong> chưa sẵn sàng chốt danh sách:
          {managedTournament.status === "OPEN_REGISTRATION" ? " đăng ký vẫn đang mở; hãy đóng đăng ký trước." : ""}
          {workflowBlockers.pendingApplications > 0 ? ` Còn ${workflowBlockers.pendingApplications} hồ sơ chưa có quyết định cuối.` : ""}
          {workflowBlockers.pendingWithdrawals ? ` Còn ${workflowBlockers.pendingWithdrawals} yêu cầu rút đội.` : ""}
          {workflowBlockers.pendingApprovalReviews ? ` Còn ${workflowBlockers.pendingApprovalReviews} yêu cầu xem xét lại.` : ""}
          {" "}Vào mục <strong>Duyệt đội</strong> để xử lý hồ sơ. Khi còn suất, cần hoàn tất xét duyệt hàng chờ trước khi chốt; chỉ chốt dưới mức tối đa khi không còn hồ sơ chưa xử lý.
        </p> : null}
      </section>
      <section className="btc-workflow-content" aria-live="polite">
        {!workflowReady ? <p className={managedError ? "form-error" : "loading-state"} role={managedError ? "alert" : "status"}>{managedError ? `Không tải được dữ liệu quy trình: ${managedError}` : "Đang xác minh quyền và tải tiến độ của giải này…"}</p> : null}
        {workflowReady ? <>
        {currentStep === 1 ? <><WorkflowStatusAction tournament={managedTournament} targetStatus="OPEN_REGISTRATION" label="Công bố giải và mở đăng ký" disabled={managedTournament.status !== "DRAFT"} onStatusChange={changeTournamentStatus} onNotice={noticeAndRefreshWorkflow} /><TournamentDetailPanel key={`step1-${managedTournament.id}`} tournamentId={managedTournament.id} institutions={institutions} canManage onNotice={noticeAndRefreshWorkflow} onClose={() => setManageTournamentId("")} /></> : null}
        {currentStep === 2 ? <><RegistrationControlTest tournament={managedTournament} onTournamentChange={(tournament) => setManagedTournaments((items) => items.map((item) => item.id === tournament.id ? tournament : item))} onNotice={noticeAndRefreshWorkflow} /><TournamentWorkflowPanel key={`step2-${managedTournament.id}`} mode="btc" assignedTournaments={currentManaged} onNotice={noticeAndRefreshWorkflow} onViewApprovedRoster={() => setApprovedRosterOpen(true)} /><RosterLockStep tournament={managedTournament} open={approvedRosterOpen} onClose={() => setApprovedRosterOpen(false)} teamNames={teamNames} pendingWorkflowRequestCount={workflowBlockers.pendingWithdrawals + workflowBlockers.pendingApprovalReviews} onNotice={noticeAndRefreshWorkflow} onStatusChange={changeTournamentStatus} /></> : null}
          {currentStep === 3 ? <DrawWorkflowPanel key={`step3-${managedTournament.id}`} tournaments={[managedTournament]} onNotice={noticeAndRefreshWorkflow} onContinue={() => void selectWorkflowStep(4)} onLivePublished={openFixturesAfterLiveDraw} /> : null}
          {currentStep === 4 ? <FixtureDiagramPanel key={`step4-${managedTournament.id}`} tournaments={currentManaged} teamNames={teamNames} onNotice={noticeAndRefreshWorkflow} onContinue={advanceToSchedulingStep} onOpenPublicView={() => onOpenSection(managedTournament.id, "matches")} /> : null}
          {currentStep === 5 ? <OfficialScheduleWorkspace key={`step5-official-${managedTournament.id}`} tournamentId={managedTournament.id} tournamentName={managedTournament.name} competitionFormat={managedTournament.competitionFormat ?? "ROUND_ROBIN"} footballFormat={managedTournament.footballFormat ?? 7} startDate={managedTournament.startDate} endDate={managedTournament.endDate} regulation={managedTournament.rules ?? null} teamNames={teamNames} onNotice={onNotice} onPublished={markSchedulePublished} /> : null}
          {currentStep === 6 ? <Step6RefereeWorkspace key={`step6-referees-${managedTournament.id}`} tournamentId={managedTournament.id} tournamentName={managedTournament.name} onNotice={onNotice} onGoToSchedule={() => setCurrentStep(5)} /> : null}
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
              <span className="btc-view-action">{managedSummaries[tournament.id]?.registrationCount ?? "—"} đội đăng ký · Bước {visibleWorkflowStep(managedSummaries[tournament.id]?.currentStep ?? 1)}/8</span>
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

function RegistrationControlTest(props: {
  tournament: Tournament;
  onTournamentChange: (tournament: Tournament) => void;
  onNotice: (message: string) => void;
}) {
  const { confirm } = useDialog();
  const [availability, setAvailability] = useState<{ enabled: boolean; canClose: boolean; canReopen: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setAvailability(null);
    void getRegistrationControlAvailability(props.tournament.id)
      .then((result) => { if (active) setAvailability(result); })
      .catch(() => { if (active) setAvailability({ enabled: false, canClose: false, canReopen: false }); });
    return () => { active = false; };
  }, [props.tournament.id, props.tournament.status]);
  if (!availability?.enabled) return null;
  const action = availability.canClose ? "TEST_CLOSE" : availability.canReopen ? "TEST_REOPEN" : null;
  if (!action) return null;
  async function submit() {
    const isClosing = action === "TEST_CLOSE";
    const confirmed = await confirm({
      title: isClosing ? "Đóng nhận đăng ký để kiểm thử?" : "Mở lại nhận đăng ký để kiểm thử?",
      description: isClosing
        ? "Việc đóng đăng ký sẽ ngừng tiếp nhận hồ sơ mới và khóa chức năng bổ sung hồ sơ. Các hồ sơ chưa hoàn thành bổ sung sẽ tự động bị từ chối. BTC vẫn có thể tiếp tục phê duyệt hoặc từ chối những hồ sơ đã hoàn thiện. Thời hạn gốc không thay đổi."
        : "Chỉ mở lại trong thời hạn đăng ký thật và trước khi chốt danh sách. Các quyết định đã ghi nhận không bị thay đổi.",
      confirmLabel: isClosing ? "Đóng đăng ký (Test)" : "Mở lại đăng ký (Test)",
      danger: isClosing,
    });
    if (!confirmed) return;
    setSaving(true); setError(null);
    try {
      const { tournament } = await controlRegistrationForTest(props.tournament.id, action!);
      props.onTournamentChange(tournament);
      props.onNotice(action === "TEST_CLOSE" ? "Đã đóng nhận đăng ký sớm để kiểm thử." : "Đã mở lại nhận đăng ký để kiểm thử.");
    } catch (err) { setError(err instanceof Error ? err.message : "Không cập nhật được trạng thái nhận đăng ký."); }
    finally { setSaving(false); }
  }
  return <section className="panel data-panel workflow-phase-panel">
    <div className="panel-heading"><div><span className="eyebrow">CÔNG CỤ KIỂM THỬ</span><h2>Điều khiển thời hạn đăng ký</h2><p>Chỉ khả dụng ở DEV/TEST. Hồ sơ và lịch sử xét duyệt được giữ nguyên.</p></div></div>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <button type="button" className="secondary-button" disabled={saving} onClick={() => void submit()}>
      {saving ? "Đang cập nhật…" : action === "TEST_CLOSE" ? "Đóng đăng ký (Test)" : "Mở lại đăng ký (Test)"}
    </button>
  </section>;
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
      props.onNotice(props.targetStatus === "OPEN_REGISTRATION" ? "Giải đã được công bố và mở đăng ký." : "Trạng thái giải đã được cập nhật.");
    } catch (err) { setError(err instanceof Error ? err.message : "Không cập nhật được trạng thái giải."); }
    finally { setSaving(false); }
  }
  if (props.tournament.status === "COMPLETED" || props.tournament.status === "CANCELLED") return null;
  if (props.targetStatus === "OPEN_REGISTRATION" && props.tournament.status !== "DRAFT") return null;
  if (props.targetStatus === "PREPARING" && props.tournament.status !== "ROSTER_LOCKED") return null;
  if (props.targetStatus === "IN_PROGRESS" && props.tournament.status !== "PREPARING") return null;
  const actionDisabled = props.disabled || saving;
  return <section className="panel data-panel workflow-phase-panel">
    <div className="panel-heading"><div><span className="eyebrow">BƯỚC {actionCopy.step}</span><h2>{actionCopy.title}</h2><p>{actionCopy.description}</p></div></div>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <button type="button" className="primary-button" disabled={actionDisabled} onClick={() => void submit()}>{saving ? "Đang cập nhật…" : props.label}</button>
  </section>;
}
