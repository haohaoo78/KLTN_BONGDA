import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getDrawManagement, type DrawCandidate } from "../api/competition";
import { useDialog } from "./DialogProvider";
import { DrawDemoFixtureWorkspace } from "./DrawDemoFixtureWorkspace";
import {
  demoDiagramSnapshotKey as legacyDiagramSnapshotKey, emptyDemoStep5State, flushDrawTestPersistence, commitScheduleTestState as legacyCommitScheduleState, acceptServerScheduleTestState, readDrawTestState as legacyReadDrawState, resetScheduleTestStateForDevelopment, resetDrawTestStep6, subscribeDrawTestState, writeDrawTestState as legacyWriteDrawState,
  ensureScheduleTestRevision, acknowledgeScheduleTestRevision,
  type DemoFixture, type DemoScheduleEntry, type DemoScheduleResources, type DemoStep5State,
  type ScheduleSettingProvenance,
  type DemoRefereeAssignment, type DemoRefereeResourceState, type DrawTestState,
} from "../utils/drawTestStorage";
import { getFinalRoundClusterOptions, getFinalRoundFixturesByGroup, getScheduleObjectiveWarnings, getScheduleStatistics, matchPlayMinutes, validateSchedulePlan, venueOccupiedMinutes, type ManualScheduleCandidate, type ScheduleConstraintIssue } from "../utils/scheduleConstraintValidation";
import { DrawDemoScheduleSettingsPanel } from "./DrawDemoScheduleSettingsPanel";
import { DrawDemoAutomaticSchedulePanel, defaultAutoScheduleConfiguration } from "./DrawDemoAutomaticSchedulePanel";
import { MAX_AUTOMATIC_SCHEDULE_RUNTIME_MS, automaticScheduleBaseSignature, type AutomaticSchedulePlan } from "../utils/automaticSchedulePlanner";
import { apiFetch, ApiError } from "../api/client";
import { DrawDemoRefereeResourcesPanel } from "./DrawDemoRefereeResourcesPanel";
import { DrawDemoManualRefereeAssignmentPanel } from "./DrawDemoManualRefereeAssignmentPanel";
import { DrawDemoAutomaticRefereeAssignmentPanel } from "./DrawDemoAutomaticRefereeAssignmentPanel";
import { Modal } from "./Modal";
import { Step5WorkspaceShell, type Step5Stage } from "./Step5WorkspaceShell";
import { Step5SchedulePrintPreview } from "./Step5SchedulePrintPreview";
import { getScheduleWorkflowTestState, previewScheduleResourceImpact } from "../api/testWorkflow";
import { analyzeScheduleSetup } from "../api/testWorkflow";
import type { TournamentRules } from "../api/competition";
import { normalizeScheduleDecisionTiming } from "../../../../packages/shared/src/scheduleSetupAnalysis";
import { validateRefereeAssignment, type RefereeDuty, type RefereeTeamAffiliation } from "../utils/refereeResourceValidation";
import type { AutoScheduleConfiguration, AutoScheduleObjective } from "../utils/drawTestStorage";
import { automaticRefereeBaseSignature, runAutoRefereePlanner, type AutoRefereeConfiguration, type AutoRefereePreview } from "../utils/automaticRefereePlanner";
import type { AutoRefereePlannerInput } from "../utils/automaticRefereePlanner";

export type OfficialSchedulingBridge = {
  state: DrawTestState;
  diagramVersion: string;
  commit: (step5: DemoStep5State) => Promise<DrawTestState>;
  request: <T>(action: string, input: Record<string, unknown>, signal?: AbortSignal) => Promise<T>;
  publish: () => Promise<DrawTestState>;
};
type Props = { mode: "schedule" | "referees"; tournamentId: string; tournamentName: string; operatorName?: string; onNotice?: (message: string) => void; onGoToTournamentInfo?: () => void; startDate?: string | null; endDate?: string | null; footballFormat?: 5 | 7 | 11; competitionFormat?: "ROUND_ROBIN" | "GROUP_AND_KNOCKOUT" | "KNOCKOUT"; regulation?: TournamentRules | null; official?: OfficialSchedulingBridge };
type Tab = "schedule" | "referees" | "review";
type Method = "MANUAL" | "AUTO";
type ScheduleView = "DIAGRAM" | "CALENDAR" | "LIST";
const tabLabels: Record<Tab, string> = { schedule: "Lập lịch thi đấu", referees: "Phân công trọng tài", review: "Kiểm tra và công bố" };
const emptyEntry = (): DemoScheduleEntry => ({ scheduledAt: "", durationMinutes: 90, venue: "", refereeNames: [], notes: "" });
const timeLabel = (value: string) => new Date(value).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
const settingSource = (source: ScheduleSettingProvenance["source"], sourceLabel: string, explanation: string, confirmed: boolean, adjustable: boolean): ScheduleSettingProvenance => ({ source, sourceLabel, explanation, confirmed, adjustable });
function settingValueAt(resources: DemoScheduleResources, key: string): unknown {
  return key.split(".").reduce<unknown>((value, part) => value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined, resources);
}

function setSettingValue(resources: DemoScheduleResources, key: string, value: unknown): DemoScheduleResources {
  const [head, ...tail] = key.split(".");
  if (!head) return resources;
  if (!tail.length) return { ...resources, [head]: value } as DemoScheduleResources;
  const current = (resources as unknown as Record<string, unknown>)[head];
  return { ...resources, [head]: { ...(current && typeof current === "object" ? current as Record<string, unknown> : {}), [tail[0]]: value } } as DemoScheduleResources;
}

function upgradeSetupProvenance(resources: DemoScheduleResources, defaults: Partial<DemoScheduleResources>): DemoScheduleResources {
  const baseProvenance = resources.setupProvenance ?? {};
  const inferred: Record<string, ScheduleSettingProvenance> = { ...(defaults.setupProvenance ?? {}) };
  let upgraded = resources;
  for (const [key, proposal] of Object.entries(inferred)) {
    let savedValue = settingValueAt(upgraded, key);
    const defaultValue = settingValueAt(defaults as DemoScheduleResources, key);
    const zeroSettingIsValid = key === "travelBufferMinutes" || key.endsWith(".extraTimeReserveMinutes") || key.endsWith(".penaltyReserveMinutes");
    const isBlank = savedValue === undefined || savedValue === null || savedValue === 0 && !zeroSettingIsValid || savedValue === "" || (Array.isArray(savedValue) && savedValue.length === 0);
    const hasUsefulDefault = defaultValue !== undefined && defaultValue !== null && !(Array.isArray(defaultValue) && !defaultValue.length) && defaultValue !== 0 && defaultValue !== "";
    const existing = baseProvenance[key];
    const refreshableSuggestion = Boolean(existing && !existing.confirmed
      && (existing.source === "SYSTEM_PROPOSED" || existing.source === "CALCULATED")
      && !existing.sourceLabel.includes("BTC đang điều chỉnh"));
    if ((isBlank || refreshableSuggestion) && hasUsefulDefault && !(existing?.source === "REGULATION" && !existing.adjustable)) {
      upgraded = setSettingValue(upgraded, key, defaultValue);
      savedValue = defaultValue;
      inferred[key] = existing?.source === "ORGANIZER_CONFIRMED"
        ? settingSource("SYSTEM_PROPOSED", "Đề xuất hệ thống · cần BTC xác nhận", "Snapshot cũ đánh dấu đã xác nhận nhưng chưa có giá trị lưu; hãy xem lại đề xuất trước khi lập lịch.", false, true)
        : refreshableSuggestion ? proposal : existing ?? proposal;
      continue;
    }
    if (existing) { inferred[key] = existing; continue; }
    if (savedValue === undefined || JSON.stringify(savedValue) === JSON.stringify(defaultValue)) continue;
    if (proposal.source === "REGULATION" && !proposal.adjustable) {
      inferred[key] = { ...proposal, sourceLabel: "Điều lệ · snapshot cũ đang lệch", explanation: "Giá trị snapshot khác điều lệ đang áp dụng. Không thể sửa đè tại Bước 5; tải phiên bản điều lệ hiện hành rồi đánh giá lại.", confirmed: false };
      continue;
    }
    inferred[key] = settingSource("SYSTEM_PROPOSED", "Thiết lập cũ · cần BTC xác nhận", "Snapshot cũ không lưu nguồn hoặc trạng thái xác nhận của trường này; kiểm tra lại trước khi lập lịch.", false, true);
  }
  return {
    ...upgraded,
    setupProvenance: inferred,
    setupRegulationVersion: resources.setupRegulationVersion ?? defaults.setupRegulationVersion ?? null,
    officialCompetitionStartDate: resources.officialCompetitionStartDate ?? defaults.officialCompetitionStartDate ?? "",
    officialCompetitionEndDate: resources.officialCompetitionEndDate ?? defaults.officialCompetitionEndDate ?? "",
    defaultObjectives: resources.defaultObjectives ?? defaults.defaultObjectives,
    stageDateRanges: resources.stageDateRanges ?? defaults.stageDateRanges,
  };
}

export function DrawDemoScheduleWorkspace({ mode, tournamentId, tournamentName, operatorName, onNotice, onGoToTournamentInfo, startDate, endDate, footballFormat = 7, competitionFormat = "ROUND_ROBIN", regulation, official }: Props) {
  const { confirm } = useDialog();
  const [state, setState] = useState(() => official?.state ?? legacyReadDrawState(tournamentId));
  const stateRef = useRef(state);
  stateRef.current = state;
  function readDrawTestState(id: string) { return official ? stateRef.current : legacyReadDrawState(id); }
  function demoDiagramSnapshotKey(value: DrawTestState) { return official?.diagramVersion ?? legacyDiagramSnapshotKey(value); }
  function updateOfficialState(next: DrawTestState) { stateRef.current = next; setState(next); }
  function writeDrawTestState(id: string, patch: Partial<DrawTestState>) {
    if (!official) return legacyWriteDrawState(id, patch);
    const next = { ...stateRef.current, ...patch };
    updateOfficialState(next);
    return next;
  }
  async function commitScheduleTestState(id: string, next: DemoStep5State) {
    if (!official) return legacyCommitScheduleState(id, next);
    const saved = await official.commit(next);
    updateOfficialState(saved);
    return saved;
  }
  function requestEngine<T>(action: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    if (official) return official.request<T>(action, input, signal);
    return apiFetch<T>(`/schedules/engine/test/${action}`, { method: "POST", body: JSON.stringify(input), signal });
  }
  const analyzeOfficialSetup = useCallback(async (candidateResources: DemoScheduleResources) => {
    if (!official) throw new Error("Chưa kết nối dữ liệu lập lịch chính thức.");
    return (await official.request<Awaited<ReturnType<typeof analyzeScheduleSetup>>>("setup-analysis", { resources: candidateResources, entries: stateRef.current.step5?.scheduleByFixture ?? {} })).analysis;
  }, [official?.request]);
  const [teams, setTeams] = useState<DrawCandidate[]>([]);
  const [teamsLoadError, setTeamsLoadError] = useState("");
  const [tab, setTab] = useState<Tab>(mode === "schedule" ? "schedule" : "referees");
  const [activeStage, setActiveStage] = useState<Step5Stage>(1);
  const [method, setMethod] = useState<Method>("MANUAL");
  const [scheduleView, setScheduleView] = useState<ScheduleView>("LIST");
  const [viewQuery, setViewQuery] = useState("");
  const [viewStage, setViewStage] = useState("ALL");
  const [viewGroup, setViewGroup] = useState("ALL");
  const [viewRound, setViewRound] = useState("ALL");
  const [viewDateFrom, setViewDateFrom] = useState("");
  const [viewDateTo, setViewDateTo] = useState("");
  const [viewVenue, setViewVenue] = useState("ALL");
  const [viewStatus, setViewStatus] = useState("ALL");
  const [selectedFixture, setSelectedFixture] = useState<DemoFixture | null>(null);
  const [customDatePage, setCustomDatePage] = useState(0);
  const [serverCandidates, setServerCandidates] = useState<ManualScheduleCandidate[]>([]);
  const [candidateLoadError, setCandidateLoadError] = useState("");
  const [serverValidation, setServerValidation] = useState<{ signature: string; loading: boolean; error: string; issues: ScheduleConstraintIssue[]; warnings: ScheduleConstraintIssue[] }>({ signature: "", loading: false, error: "", issues: [], warnings: [] });
  const [settingsSection, setSettingsSection] = useState<"overview" | "time" | "duration" | "conditions" | "format" | "objectives" | "capacity" | "venues" | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ date: "", venue: "", scheduledAt: "", notes: "" });
  const [saveError, setSaveError] = useState("");
  const [clusterGroup, setClusterGroup] = useState("");
  const [clusterChoiceKey, setClusterChoiceKey] = useState("");
  const [showStats, setShowStats] = useState(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const autoRequestController = useRef<AbortController | null>(null);
  const [autoConfiguration, setAutoConfiguration] = useState<AutoScheduleConfiguration>(() => defaultAutoScheduleConfiguration());
  const [autoPanelOpen, setAutoPanelOpen] = useState(false);
  const [selectedFixtureIds, setSelectedFixtureIds] = useState<string[]>([]);
  const [calendarMode, setCalendarMode] = useState<"DAY" | "WEEK">("DAY");
  const [calendarAnchorDate, setCalendarAnchorDate] = useState("");
  const [refereeResourcesOpen, setRefereeResourcesOpen] = useState(false);
  const [refereeAssignmentMethod, setRefereeAssignmentMethod] = useState<"MANUAL" | "AUTO">("MANUAL");
  const [autoRefereeRunning, setAutoRefereeRunning] = useState(false);
  const [autoRefereeError, setAutoRefereeError] = useState("");
  const [resettingSchedule, setResettingSchedule] = useState(false);

  useEffect(() => {
    if (official) { updateOfficialState(official.state); return; }
    return subscribeDrawTestState(tournamentId, () => setState(legacyReadDrawState(tournamentId)));
  }, [tournamentId, official?.state]);
  useEffect(() => { if (settingsSection) setActiveStage(settingsSection === "venues" ? 1 : 2); }, [settingsSection]);
  useEffect(() => {
    let active = true;
    setTeamsLoadError("");
    void getDrawManagement(tournamentId).then((result) => { if (active) setTeams(result.eligibleTeams); }).catch((error: unknown) => {
      if (!active) return;
      setTeams([]);
      setTeamsLoadError(error instanceof Error ? error.message : "Không tải được danh sách đội từ Tournament Service.");
    });
    return () => { active = false; };
  }, [tournamentId]);
  const snapshotKey = demoDiagramSnapshotKey(state);
  const validStep4 = Boolean(snapshotKey && state.fixturesPublishedAt && state.completedSteps.step4);
  const storedStep5 = state.step5;
  const fixtures = useMemo(() => validStep4 ? state.fixtures.filter((fixture) => !fixture.bye) : [], [validStep4, state.fixtures]);
  const scheduleFormatLabel = competitionFormat === "ROUND_ROBIN" ? "Vòng tròn" : competitionFormat === "KNOCKOUT" ? "Loại trực tiếp" : "Kết hợp";
  const hasGroupStageFixture = fixtures.some((fixture) => fixture.stage === "GROUP");
  const hasKnockoutStageFixture = fixtures.some((fixture) => fixture.stage === "KNOCKOUT");
  const isRelevantSetupKey = (key: string) => {
    if (key === "groupTiming.extraTimeReserveMinutes" || key === "groupTiming.penaltyReserveMinutes") return false;
    if (key === "knockoutTiming.extraTimeReserveMinutes") return hasKnockoutStageFixture && regulation?.knockoutDecisionMethod === "EXTRA_TIME_THEN_PENALTIES";
    if (key === "knockoutTiming.penaltyReserveMinutes") return hasKnockoutStageFixture && (regulation?.knockoutDecisionMethod === "PENALTIES_ONLY" || regulation?.knockoutDecisionMethod === "EXTRA_TIME_THEN_PENALTIES");
    return key.startsWith("groupTiming.") ? hasGroupStageFixture : key.startsWith("knockoutTiming.") ? hasKnockoutStageFixture : true;
  };
  const diagramFormatLabel = hasGroupStageFixture && hasKnockoutStageFixture ? "Kết hợp" : hasKnockoutStageFixture ? "Loại trực tiếp" : "Vòng tròn";
  const formatMatchesDiagram = competitionFormat === "ROUND_ROBIN" ? !hasKnockoutStageFixture
    : competitionFormat === "KNOCKOUT" ? hasKnockoutStageFixture && !hasGroupStageFixture
      : hasGroupStageFixture && hasKnockoutStageFixture;
  const formatMismatchText = `Thông tin giải ghi ${scheduleFormatLabel}, nhưng sơ đồ Bước 4 là ${diagramFormatLabel}. Bước 5 không tự sửa thể thức đã chốt; cần đồng bộ thông tin nguồn trước khi lập lịch.`;
  const staleStep5Snapshot = Boolean(validStep4 && storedStep5?.diagramSnapshotKey && storedStep5.diagramSnapshotKey !== snapshotKey);
  const defaults = useMemo(() => {
    const emptyTiming = { halfMinutes: 0, halftimeBreakMinutes: 0, preparationBeforeMinutes: 0, transitionAfterMinutes: 0, extraTimeReserveMinutes: 0, penaltyReserveMinutes: 0 };
    const matchMinutes = regulation?.matchDurationMinutes ?? 90;
    const halfMinutes = Math.max(1, Math.floor(matchMinutes / 2));
    const startTime = regulation?.competitionConfig?.schedulingStartTime || "08:00";
    const endTime = regulation?.competitionConfig?.schedulingEndTime || "22:00";
    const suggested = (label: string, explanation: string): ScheduleSettingProvenance => settingSource("SYSTEM_PROPOSED", label, explanation, false, true);
    const regulationTiming = regulation?.matchDurationMinutes !== undefined
      ? settingSource("REGULATION", "Điều lệ hiện hành", `Tổng thời gian ${matchMinutes} phút, chia đều cho hai hiệp. Nghỉ giữa hiệp và các khoảng dự phòng được tính riêng.`, true, false)
      : suggested("Đề xuất hệ thống · cần xác nhận", `Ước tính ${matchMinutes} phút cho toàn trận, chia đều cho hai hiệp.`);
    const usesExtraTime = competitionFormat !== "ROUND_ROBIN" && regulation?.knockoutDecisionMethod === "EXTRA_TIME_THEN_PENALTIES";
    const usesPenalties = competitionFormat !== "ROUND_ROBIN" && (usesExtraTime || regulation?.knockoutDecisionMethod === "PENALTIES_ONLY");
    const regulationExtraTime = usesExtraTime
      ? settingSource("REGULATION", "Điều lệ hiện hành", "Dự phòng hiệp phụ theo điều lệ đã công bố.", true, false)
      : settingSource("REGULATION", "Điều lệ hiện hành", "Phương thức phân định không áp dụng hiệp phụ; dự phòng hiệp phụ bằng 0.", true, false);
    const minimumRest = Math.max(30, regulation?.minimumRestMinutes ?? 30);
    const timing = { halfMinutes, halftimeBreakMinutes: 10, preparationBeforeMinutes: 15, transitionAfterMinutes: 15, extraTimeReserveMinutes: 0, penaltyReserveMinutes: 0 };
    const startSlot = startTime < endTime ? [{ id: "system-proposed-daytime", label: "Khung đề xuất", start: startTime, end: endTime }] : [];
    const officialSlots = Boolean(regulation?.competitionConfig?.schedulingStartTime && regulation.competitionConfig.schedulingEndTime);
    return {
      competitionStartDate: startDate?.slice(0, 10) ?? "", competitionEndDate: endDate?.slice(0, 10) ?? "",
      officialCompetitionStartDate: startDate?.slice(0, 10) ?? "", officialCompetitionEndDate: endDate?.slice(0, 10) ?? "",
      allowedWeekdays: [0, 1, 2, 3, 4, 5, 6], slots: startSlot, minimumTeamRestMinutes: minimumRest,
      maximumMatchesPerTeamPerDay: 1, travelBufferMinutes: 30,
      groupTiming: { ...timing },
      knockoutTiming: { ...timing, extraTimeReserveMinutes: usesExtraTime ? regulation?.extraTimeMinutes ?? 0 : 0, penaltyReserveMinutes: usesPenalties ? 15 : 0 },
      venues: [], locations: [], availabilityProfiles: [],
      setupProvenance: {
        competitionStartDate: settingSource("CALCULATED", "Thời gian giải", "Kế thừa từ ngày bắt đầu đã cấu hình cho giải.", true, false),
        competitionEndDate: settingSource("CALCULATED", "Thời gian giải", "Kế thừa từ ngày kết thúc đã cấu hình cho giải.", true, false),
        allowedWeekdays: suggested("Đề xuất hệ thống · cần xác nhận", "Tạm mở mọi ngày trong tuần; loại trừ ngày sân không hoạt động khi cấu hình sân."),
        slots: officialSlots
          ? settingSource("REGULATION", "Điều lệ hiện hành", `Khung giờ ${startTime}–${endTime} lấy từ điều lệ đã công bố.`, true, false)
          : suggested("Đề xuất hệ thống · cần xác nhận", "Nếu điều lệ chưa quy định, hệ thống đề xuất khung giờ 08:00–22:00."),
        minimumTeamRestMinutes: regulation?.minimumRestMinutes ? settingSource("REGULATION", "Điều lệ", "Giá trị được lấy từ điều lệ hiện hành.", true, false) : suggested("Đề xuất hệ thống · cần xác nhận", "Khuyến nghị tối thiểu 30 phút; điều lệ hiện hành chưa quy định thời gian nghỉ cụ thể."),
        maximumMatchesPerTeamPerDay: suggested("Đề xuất hệ thống · cần xác nhận", "Giới hạn mặc định một trận mỗi đội mỗi ngày."),
        travelBufferMinutes: suggested("Đề xuất hệ thống · cần xác nhận", "Dự phòng 30 phút khi đổi địa điểm; BTC cần xác nhận theo khoảng cách thực tế."),
        "groupTiming.halfMinutes": regulationTiming,
        "groupTiming.halftimeBreakMinutes": suggested("Đề xuất hệ thống · cần xác nhận", "Dự phòng 10 phút giữa hai hiệp."),
        "groupTiming.preparationBeforeMinutes": suggested("Đề xuất hệ thống · cần xác nhận", "Dự phòng 15 phút chuẩn bị sân."),
        "groupTiming.transitionAfterMinutes": suggested("Đề xuất hệ thống · cần xác nhận", "Dự phòng 15 phút chuyển tiếp sau trận."),
        "knockoutTiming.halfMinutes": regulationTiming,
        "knockoutTiming.halftimeBreakMinutes": suggested("Đề xuất hệ thống · cần xác nhận", "Dự phòng 10 phút giữa hai hiệp."),
        "knockoutTiming.preparationBeforeMinutes": suggested("Đề xuất hệ thống · cần xác nhận", "Dự phòng 15 phút chuẩn bị sân."),
        "knockoutTiming.transitionAfterMinutes": suggested("Đề xuất hệ thống · cần xác nhận", "Dự phòng 15 phút chuyển tiếp sau trận."),
        "knockoutTiming.extraTimeReserveMinutes": regulationExtraTime,
        "knockoutTiming.penaltyReserveMinutes": usesPenalties ? suggested("Đề xuất hệ thống · cần xác nhận", "Dự phòng loạt luân lưu khi phương thức phân định yêu cầu.") : settingSource("REGULATION", "Điều lệ hiện hành", "Phương thức phân định không áp dụng penalty; dự phòng penalty bằng 0.", true, false),
      },
      setupRegulationVersion: regulation?.publishedVersion ?? null,
      defaultObjectives: ["MINIMIZE_CHANGES", "REST", "FAIRNESS", "TRAVEL", "VENUE_USE", "COMPLETION"] as AutoScheduleObjective[],
    };
  }, [competitionFormat, endDate, regulation, startDate]);
  const blankStep5 = useMemo(() => emptyDemoStep5State(snapshotKey, defaults), [snapshotKey, defaults]);
  const step5 = validStep4 ? storedStep5 ?? blankStep5 : blankStep5;
  const rawResources = storedStep5?.resources ?? blankStep5.resources!;
  const resources = useMemo(() => {
    const upgraded = upgradeSetupProvenance(rawResources, defaults);
    if (!official || mode !== "schedule") return upgraded;
    const protectedStages = new Set(fixtures.filter((fixture) => {
      const entry = step5.scheduleByFixture[fixture.id];
      return Boolean(step5.schedulePublishedAt || step5.publishedAt || entry?.locked || entry?.officialStatus === "PUBLISHED");
    }).map((fixture) => fixture.stage));
    const protectedResources = { ...upgraded };
    if (protectedStages.has("GROUP")) protectedResources.groupTiming = rawResources.groupTiming;
    if (protectedStages.has("KNOCKOUT")) protectedResources.knockoutTiming = rawResources.knockoutTiming;
    return normalizeScheduleDecisionTiming({
      tournamentId, name: tournamentName, status: "PREPARING", startDate: startDate ?? null, endDate: endDate ?? null,
      location: null, footballFormat, competitionFormat,
      teamCount: new Set(fixtures.flatMap((fixture) => [fixture.homeTeamId, fixture.awayTeamId]).filter((id): id is string => Boolean(id))).size,
      regulationVersion: regulation?.publishedVersion ?? null, rules: regulation ?? null,
    }, protectedResources, protectedStages);
  }, [rawResources, defaults, Boolean(official), mode, fixtures, step5.scheduleByFixture, step5.schedulePublishedAt, step5.publishedAt, tournamentId, tournamentName, startDate, endDate, footballFormat, competitionFormat, regulation]);
  const autoPreview = step5.autoPreview ?? null;
  const isSchedulePublished = Boolean(step5.schedulePublishedAt || step5.publishedAt);
  useEffect(() => {
    if (mode === "schedule" && isSchedulePublished) setActiveStage(4);
  }, [isSchedulePublished, mode]);
  const officialSchedule = step5.publishedScheduleByFixture ?? step5.scheduleByFixture;
  const visibleEntries = tab === "schedule" && isSchedulePublished
    ? officialSchedule
    : tab === "schedule" && activeStage === 3 && autoPreview
      ? autoPreview.proposedEntries
      : step5.scheduleByFixture;
  const setupScheduleEntries = useMemo(() => ({ ...step5.scheduleByFixture, ...(step5.autoPreview?.proposedEntries ?? {}) }), [step5.autoPreview, step5.scheduleByFixture]);
  const simulatedFixtureIds = autoPreview?.scheduledFixtureIds.filter((id) => {
    const draftEntry = step5.scheduleByFixture[id];
    const proposedEntry = autoPreview.proposedEntries[id];
    return Boolean(proposedEntry?.scheduledAt && proposedEntry.venue && (!draftEntry?.scheduledAt || draftEntry.scheduledAt !== proposedEntry.scheduledAt || draftEntry.venue !== proposedEntry.venue));
  }) ?? [];
  const autoPreviewStale = Boolean(autoPreview && automaticScheduleBaseSignature(state.fixtures, step5.scheduleByFixture, step5.resources ?? resources) !== autoPreview.baseSignature);
  const missingRequiredScheduleFixtures = fixtures.filter((fixture) => !step5.scheduleByFixture[fixture.id]?.scheduledAt || !step5.scheduleByFixture[fixture.id]?.venue.trim());
  const scheduledCount = fixtures.length - missingRequiredScheduleFixtures.length;
  const refereePositions = step5.refereePositions ?? [];
  const refereeResources = step5.refereeResources ?? { referees: [], models: [], crewTemplates: [], crews: [], neutralRules: [], matchRequirements: {}, evaluations: [] };
  const refereeAssignments = step5.refereeAssignmentsByFixture ?? {};
  const refereePublishedIds = new Set(step5.refereePublishedFixtureIds ?? []);
  const publishedRefereeAssignments = step5.publishedRefereeAssignmentsByFixture ?? {};
  const currentEntry = selectedFixture ? (tab === "referees" && isSchedulePublished ? officialSchedule[selectedFixture.id] : visibleEntries[selectedFixture.id]) ?? emptyEntry() : null;
  const selectedDraftIsDirty = Boolean(selectedFixture && currentEntry && editing && !currentEntry.locked && (
    draft.date !== (currentEntry.scheduledAt?.slice(0, 10) ?? "")
    || draft.scheduledAt !== (currentEntry.scheduledAt ?? "")
    || draft.venue !== (currentEntry.venue ?? "")
    || draft.notes !== (currentEntry.notes ?? "")
  ));
  const isPublished = isSchedulePublished;
  const validationSignature = JSON.stringify({ fixtures, entries: step5.scheduleByFixture, resources, footballFormat, snapshotKey });
  const validationCurrent = serverValidation.signature === validationSignature && !serverValidation.loading && !serverValidation.error;
  const constraintIssues = validationCurrent ? serverValidation.issues : [];
  const objectiveWarnings = validationCurrent ? serverValidation.warnings : [];
  const hardObjectiveIssues = objectiveWarnings.filter((issue) => issue.severity === "HARD");
  const scheduleStats = getScheduleStatistics(fixtures, step5.scheduleByFixture, resources);
  const activeVenues = resources.venues.filter((venue) => venue.active && venue.pitchType === footballFormat);
  const usedVenueCount = new Set(fixtures.map((fixture) => {
    const entry = step5.scheduleByFixture[fixture.id];
    if (!entry?.scheduledAt || !entry.venue) return "";
    return resources.venues.find((venue) => venue.code === entry.venue || venue.name === entry.venue)?.id ?? entry.venue;
  }).filter(Boolean)).size;
  const usableVenues = activeVenues.filter((venue) => venue.availabilityConfirmed === true
    && venue.weekdays.some((day) => resources.allowedWeekdays.includes(day))
    && venue.availableFrom < venue.availableTo
    && resources.slots.some((slot) => (venue.availableSlots?.length ? venue.availableSlots : [{ start: venue.availableFrom, end: venue.availableTo }])
      .some((window) => slot.start < window.end && slot.end > window.start)));
  const lockedScheduleCount = fixtures.filter((fixture) => Boolean(step5.scheduleByFixture[fixture.id]?.scheduledAt && step5.scheduleByFixture[fixture.id]?.locked)).length;
  const unconfirmedSetupCount = Object.entries(resources.setupProvenance ?? {}).filter(([key, setting]) => isRelevantSetupKey(key) && (setting.source === "SYSTEM_PROPOSED" || setting.source === "CALCULATED") && !setting.confirmed).length;
  const staleRegulationSetup = typeof regulation?.publishedVersion === "number" && resources.setupRegulationVersion !== regulation.publishedVersion;
  const configurationIssues = [
    staleStep5Snapshot ? "Bản nháp đang gắn với phiên bản sơ đồ Bước 4 khác. Dữ liệu cũ được giữ nguyên và chỉ đọc." : null,
    !resources.competitionStartDate || !resources.competitionEndDate ? "Cần cấu hình ngày bắt đầu và kết thúc thi đấu." : null,
    resources.competitionStartDate && resources.competitionEndDate && resources.competitionStartDate > resources.competitionEndDate ? "Khoảng ngày thi đấu không hợp lệ." : null,
    startDate && resources.competitionStartDate && resources.competitionStartDate < startDate.slice(0, 10) ? `Ngày bắt đầu lập lịch sớm hơn ngày giải (${startDate.slice(0, 10)}).` : null,
    endDate && resources.competitionEndDate && resources.competitionEndDate > endDate.slice(0, 10) ? `Ngày kết thúc lập lịch muộn hơn ngày giải (${endDate.slice(0, 10)}).` : null,
    !resources.allowedWeekdays.length ? "Chưa chọn ngày thi đấu trong tuần." : null,
    !resources.slots.length ? "Chưa cấu hình khung giờ thi đấu." : null,
    hasGroupStageFixture && resources.groupTiming.halfMinutes < 1 ? "Cần xác nhận thời lượng hiệp vòng bảng/vòng tròn." : null,
    hasKnockoutStageFixture && resources.knockoutTiming.halfMinutes < 1 ? "Cần xác nhận thời lượng hiệp loại trực tiếp." : null,
    hasGroupStageFixture && regulation?.matchDurationMinutes && resources.groupTiming.halfMinutes * 2 !== regulation.matchDurationMinutes ? `Điều lệ quy định ${regulation.matchDurationMinutes} phút vòng bảng; mỗi hiệp phải là ${Math.floor(regulation.matchDurationMinutes / 2)} phút.` : null,
    hasKnockoutStageFixture && regulation?.matchDurationMinutes && resources.knockoutTiming.halfMinutes * 2 !== regulation.matchDurationMinutes ? `Điều lệ quy định ${regulation.matchDurationMinutes} phút loại trực tiếp; mỗi hiệp phải là ${Math.floor(regulation.matchDurationMinutes / 2)} phút.` : null,
    hasKnockoutStageFixture && regulation?.knockoutDecisionMethod === "EXTRA_TIME_THEN_PENALTIES" && resources.knockoutTiming.extraTimeReserveMinutes !== regulation.extraTimeMinutes ? `Điều lệ yêu cầu dự phòng hiệp phụ ${regulation.extraTimeMinutes} phút.` : null,
    unconfirmedSetupCount ? `${unconfirmedSetupCount} thông số đề xuất chưa được BTC xác nhận.` : null,
    staleRegulationSetup ? "Thiết lập đang gắn với phiên bản điều lệ cũ; cần tải và xác minh lại trước khi lập lịch." : null,
    !usableVenues.length ? `Chưa có sân ${footballFormat} người hoạt động với khung giờ giao thời gian giải.` : null,
  ].filter((message): message is string => Boolean(message));
  const allValidationIssues = [...configurationIssues.map((message) => ({ fixtureId: "", message, code: "CONFIGURATION" })), ...constraintIssues, ...hardObjectiveIssues];
  const groupedReviewIssues = [...allValidationIssues, ...objectiveWarnings.filter((issue) => issue.severity !== "HARD")].reduce<Record<string, ScheduleConstraintIssue[]>>((groups, issue) => {
    const key = issue.code || "OTHER";
    (groups[key] ??= []).push(issue);
    return groups;
  }, {});
  const scheduleIssuesByFixture = Object.fromEntries(fixtures.map((fixture) => [fixture.id, [...allValidationIssues.filter((issue) => issue.fixtureId === fixture.id).map((issue) => issue.message), ...(step5.simulationValidation?.issues.filter((issue) => issue.fixtureId === fixture.id && issue.severity === "HARD").map((issue) => issue.message) ?? [])]]).filter(([, messages]) => (messages as string[]).length > 0));
  const hasPendingSimulation = Boolean(autoPreview?.scheduledFixtureIds.length);
  const scheduleReady = !staleStep5Snapshot && validationCurrent && fixtures.length > 0 && missingRequiredScheduleFixtures.length === 0 && !selectedDraftIsDirty && !autoRunning && !hasPendingSimulation && !configurationIssues.length && !constraintIssues.length && !hardObjectiveIssues.length;
  const publicationBlocker = missingRequiredScheduleFixtures.length
    ? `Chưa thể công bố: còn ${missingRequiredScheduleFixtures.length}/${fixtures.length} trận chưa có đủ ngày, giờ và sân đã lưu.`
    : selectedDraftIsDirty ? "Lưu hoặc hủy điều chỉnh đang nhập trước khi công bố."
      : hasPendingSimulation ? "Lưu hoặc hủy phương án tự động trước khi công bố."
        : autoRunning ? "Chờ tạo lịch hoàn tất trước khi công bố." : "";
  const assignedCount = fixtures.filter((fixture) => refereePublishedIds.has(fixture.id)).length;
  const refereeDraftAssignedCount = fixtures.filter((fixture) => (refereeAssignments[fixture.id] ?? []).some((item) => item.refereeName.trim())).length;
  const rounds = [...new Set(fixtures.map((fixture) => fixture.round))].sort((a, b) => a.localeCompare(b, "vi", { numeric: true }));
  const refereeScopeRounds = step5.refereeScopeRounds ?? [];
  const refereeScopeGroups = step5.refereeScopeGroups ?? [];
  const refereeScopeDates = step5.refereeScopeDates ?? [];
  const refereeTargetFixtures = step5.refereePolicy?.mode === "WHOLE_TOURNAMENT"
    ? fixtures
    : fixtures.filter((fixture) => refereeScopeRounds.includes(fixture.round)
      && (!refereeScopeGroups.length || refereeScopeGroups.includes(fixture.groupName ?? "Knockout"))
      && (!refereeScopeDates.length || refereeScopeDates.includes((step5.scheduleByFixture[fixture.id]?.scheduledAt ?? "").slice(0, 10))));
  const refereeSchedule = isSchedulePublished ? officialSchedule : step5.scheduleByFixture;
  const refereeTargetWithSchedule = refereeTargetFixtures.filter((fixture) => Boolean(refereeSchedule[fixture.id]?.scheduledAt && refereeSchedule[fixture.id]?.venue));
  const refereeScheduleSignature = (entries: Record<string, DemoScheduleEntry>) => JSON.stringify(fixtures.map((fixture) => [fixture.id, entries[fixture.id]?.scheduledAt ?? "", entries[fixture.id]?.venue ?? ""]));
  const makeAutoRefereeInput = (source: ReturnType<typeof readDrawTestState>, configuration: AutoRefereeConfiguration) => {
    const current = source.step5;
    const currentResources = current?.resources ?? resources;
    const currentRoster = current?.refereeResources ?? refereeResources;
    const official = Boolean(current?.schedulePublishedAt || current?.publishedAt);
    return {
      fixtures: source.fixtures.filter((fixture) => !fixture.bye),
      schedules: official ? current?.publishedScheduleByFixture ?? current?.scheduleByFixture ?? {} : current?.scheduleByFixture ?? {},
      resources: currentResources,
      roster: currentRoster,
      currentAssignments: current?.refereeAssignmentsByFixture ?? {},
      publishedAssignments: current?.publishedRefereeAssignmentsByFixture ?? {},
      publishedFixtureIds: current?.refereePublishedFixtureIds ?? [],
      lockedFixtureIds: current?.refereeLockedFixtureIds ?? [],
      lockedSlotKeysByFixture: current?.lockedRefereeSlotKeysByFixture ?? {},
      teamAffiliations: Object.fromEntries(teams.map((team) => [team.teamId, { club: team.name, school: team.institutionName ?? undefined, unit: team.institutionName ?? undefined }] as const)),
      format: footballFormat,
      configuration,
    };
  };
  const hasRefereeConflict = (fixtureId: string, assignment: DemoRefereeAssignment) => {
    const name = assignment.refereeName.trim().toLocaleLowerCase("vi");
    if (!name && !assignment.refereeId) return false;
    const current = refereeSchedule[fixtureId];
    const currentFixture = fixtures.find((fixture) => fixture.id === fixtureId);
    if (!current?.scheduledAt || !currentFixture) return false;
    const currentEnd = new Date(current.scheduledAt).getTime() + (matchPlayMinutes(currentFixture, resources) + resources.groupTiming.transitionAfterMinutes) * 60_000;
    return fixtures.some((other) => {
      if (other.id === fixtureId) return false;
      const otherEntry = refereeSchedule[other.id];
      if (!otherEntry?.scheduledAt) return false;
      const published = refereePublishedIds.has(other.id) ? publishedRefereeAssignments[other.id] ?? [] : [];
      const draft = refereeAssignments[other.id] ?? [];
      const sameOfficial = [...published, ...draft].some((item) => assignment.refereeId ? item.refereeId === assignment.refereeId : item.refereeName.trim().toLocaleLowerCase("vi") === name);
      if (!sameOfficial) return false;
      const start = new Date(otherEntry.scheduledAt).getTime();
      const end = start + (matchPlayMinutes(other, resources) + resources.groupTiming.transitionAfterMinutes) * 60_000;
      return new Date(current.scheduledAt).getTime() < end && start < currentEnd;
    });
  };
  const getModelPositions = (fixture: DemoFixture) => {
    const stageLabel = fixture.stage === "GROUP" ? "Vòng bảng" : "Knockout";
    const requirement = refereeResources.matchRequirements[fixture.id]
      ?? refereeResources.matchRequirements[fixture.groupName ? `${stageLabel} · ${fixture.groupName}` : ""]
      ?? refereeResources.matchRequirements[stageLabel]
      ?? refereeResources.matchRequirements[fixture.stage];
    return refereeResources.models.find((item) => item.id === requirement?.positionModelId)?.positions
      ?? refereeResources.models.find((item) => item.isDefault)?.positions
      ?? refereePositions.map((position) => ({ ...position, requiredCount: 1, required: true, formats: [footballFormat] as Array<5 | 7 | 11>, minimumLevel: "ENTRY", minimumExperienceYears: 0, duties: "", permissions: [], confirmsResult: false, code: position.id }));
  };
  const refereePositionReady = (fixtureId: string) => {
    const fixture = fixtures.find((item) => item.id === fixtureId);
    if (!fixture) return false;
    if (refereeResources.neutralRules.some((rule) => rule.mandatory) && ((!fixture.homeTeamId && Boolean(fixture.homeSource)) || (!fixture.awayTeamId && Boolean(fixture.awaySource)))) return false;
    const positions = getModelPositions(fixture);
    const rows = refereePublishedIds.has(fixtureId) ? publishedRefereeAssignments[fixtureId] ?? [] : refereeAssignments[fixtureId] ?? [];
    return positions.filter((position) => position.required).every((position) => Array.from({ length: position.requiredCount }, (_, slotIndex) => rows.find((item) => item.positionId === position.id && (item.slotIndex ?? 0) === slotIndex)).every((assignment) => Boolean(assignment?.refereeId && refereeResources.referees.some((referee) => referee.id === assignment.refereeId) && assignment.refereeName.trim() && assignment.eligibilityConfirmed && assignment.availabilityConfirmed && assignment.validationStatus !== "NEEDS_RECHECK" && !hasRefereeConflict(fixtureId, assignment))));
  };
  const refereeDraftResourceSignature = JSON.stringify(refereeResources);
  const refereeDraftSignatureStale = Boolean((step5.refereeDraftScheduleSignature && step5.refereeDraftScheduleSignature !== refereeScheduleSignature(step5.scheduleByFixture)) || (step5.refereeDraftResourceSignature && step5.refereeDraftResourceSignature !== refereeDraftResourceSignature));
  const refereeStatus = (fixtureId: string) => {
    if (refereePublishedIds.has(fixtureId)) return "Đã công bố";
    if (refereeDraftSignatureStale) return "Cần xác minh lại";
    const fixture = fixtures.find((item) => item.id === fixtureId);
    const assignments = refereeAssignments[fixtureId] ?? [];
    if (!assignments.some((item) => item.refereeName.trim() || item.refereeId)) return "Chưa phân công";
    if (assignments.some((item) => item.validationStatus === "NEEDS_RECHECK") || (fixture && refereeResources.neutralRules.some((rule) => rule.mandatory) && ((!fixture.homeTeamId && Boolean(fixture.homeSource)) || (!fixture.awayTeamId && Boolean(fixture.awaySource))))) return "Cần xác minh lại";
    return refereePositionReady(fixtureId) ? "Phân công nháp đầy đủ" : "Phân công nháp chưa đầy đủ";
  };
  const refereeReady = refereeTargetWithSchedule.length > 0 && refereeTargetWithSchedule.length === refereeTargetFixtures.length
    && refereeTargetFixtures.every((fixture) => getModelPositions(fixture).some((position) => position.required && position.requiredCount > 0))
    && refereeTargetFixtures.every((fixture) => refereePositionReady(fixture.id)) && !refereeDraftSignatureStale;
  const matchPlayDuration = (fixture: DemoFixture) => matchPlayMinutes(fixture, resources);
  const occupiedDuration = (fixture: DemoFixture, venueName: string) => venueOccupiedMinutes(fixture, resources.venues.find((venue) => venue.name === venueName || venue.code === venueName) ?? { turnaroundMinutes: 0 } as DemoScheduleResources["venues"][number], resources);

  useEffect(() => {
    if (!validStep4 || storedStep5) return;
    writeDrawTestState(tournamentId, { step5: emptyDemoStep5State(snapshotKey, defaults) });
    setSelectedFixture(null);
  }, [defaults, snapshotKey, storedStep5, tournamentId, validStep4]);
  useEffect(() => { setTab(mode === "schedule" ? "schedule" : "referees"); setSelectedFixture(null); }, [mode, tournamentId]);

  useEffect(() => {
    if (!selectedFixture) { setEditing(false); setDraft({ date: "", venue: "", scheduledAt: "", notes: "" }); return; }
    const entry = visibleEntries[selectedFixture.id] ?? step5.scheduleByFixture[selectedFixture.id];
    setDraft({ date: entry?.scheduledAt.slice(0, 10) ?? "", venue: entry?.venue ?? "", scheduledAt: entry?.scheduledAt ?? "", notes: entry?.notes ?? "" });
    setEditing(!staleStep5Snapshot && (mode === "schedule" && activeStage === 3 ? !entry?.locked : !(mode === "schedule" && activeStage === 4) && (!entry?.scheduledAt || !entry.venue)));
    setSaveError("");
  // The form is intentionally initialized when a different fixture is selected, not on every storage update.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStage, mode, selectedFixture?.id]);

  useEffect(() => {
    if (!selectedFixture || tab !== "schedule" || method !== "MANUAL" || (mode === "schedule" && activeStage === 4)) {
      setServerCandidates((current) => current.length ? [] : current);
      setCandidateLoadError((current) => current ? "" : current);
      return;
    }
    let active = true;
    setServerCandidates([]); setCandidateLoadError("");
    const candidateEntries = step5.autoPreview
      ? { ...step5.scheduleByFixture, ...step5.autoPreview.proposedEntries }
      : visibleEntries;
    requestEngine<{ tournamentId: string; diagramVersion: string; candidates: ManualScheduleCandidate[] }>("manual-candidates", { tournamentId, diagramVersion: snapshotKey, fixtureId: selectedFixture.id, fixtures, entries: candidateEntries, resources, pitchType: footballFormat }).then((response) => { if (response.tournamentId !== tournamentId || response.diagramVersion !== snapshotKey) throw new Error("Kết quả chọn giờ thuộc phiên bản sơ đồ khác."); if (active) setServerCandidates(response.candidates); })
      .catch((error: unknown) => { if (active) setCandidateLoadError(error instanceof Error ? error.message : "Không thể tính lựa chọn lịch trên Match Service."); });
    return () => { active = false; };
  }, [activeStage, mode, selectedFixture?.id, tab, method, tournamentId, snapshotKey, fixtures, visibleEntries, step5.autoPreview, step5.scheduleByFixture, resources, footballFormat]);
  const candidates = serverCandidates;
  const dateOptions = [...new Set(candidates.map((candidate) => candidate.date))];
  const venueOptions = [...new Map(candidates.filter((candidate) => candidate.date === draft.date).map((candidate) => [candidate.venue.id, candidate.venue])).values()];
  const timeOptions = candidates.filter((candidate) => candidate.date === draft.date && candidate.venue.id === venueOptions.find((venue) => venue.code === draft.venue || venue.name === draft.venue)?.id);
  const selectedChoice = timeOptions.find((candidate) => candidate.scheduledAt === draft.scheduledAt);
  const finalRoundGroups = useMemo(() => getFinalRoundFixturesByGroup(fixtures), [fixtures]);
  const selectedFinalGroup = finalRoundGroups.find((group) => group.groupName === clusterGroup);
  const finalRoundOptions = useMemo(() => selectedFinalGroup
    ? getFinalRoundClusterOptions(selectedFinalGroup.fixtures, fixtures, step5.scheduleByFixture, resources, footballFormat)
    : [], [selectedFinalGroup, fixtures, step5.scheduleByFixture, resources, footballFormat]);
  const selectedClusterOption = finalRoundOptions.find((option) => option.scheduledAt + "|" + option.slotId === clusterChoiceKey);
  const scheduleDisplayByFixture: Record<string, { endLabel: string; venueName: string; status: "LOCKED" | "SCHEDULED" | "PROPOSED" | "UNSCHEDULED" }> = Object.fromEntries(Object.entries(visibleEntries).map(([fixtureId, entry]) => {
    const fixture = fixtures.find((item) => item.id === fixtureId);
    const venue = resources.venues.find((item) => item.code === entry.venue || item.name === entry.venue);
    const duration = fixture ? matchPlayMinutes(fixture, resources) : entry.durationMinutes ?? 0;
    const end = entry.scheduledAt ? new Date(new Date(entry.scheduledAt).getTime() + duration * 60_000) : null;
    const isVisibleProposal = mode === "schedule" && activeStage === 3 && simulatedFixtureIds.includes(fixtureId);
    const status: "LOCKED" | "SCHEDULED" | "PROPOSED" | "UNSCHEDULED" = entry.locked ? "LOCKED" : entry.scheduledAt && entry.venue ? (isVisibleProposal ? "PROPOSED" : "SCHEDULED") : "UNSCHEDULED";
    return [fixtureId, { endLabel: end ? timeLabel(end.toISOString()) : "", venueName: venue?.name ?? entry.venue, status }];
  }));
  const refereeScheduleDates = [...new Set(Object.values(refereeSchedule).filter((entry) => entry.scheduledAt).map((entry) => entry.scheduledAt.slice(0, 10)))].sort();
  const refereeDisplayByFixture = Object.fromEntries(fixtures.map((fixture) => {
    const positions = getModelPositions(fixture);
    const required = positions.filter((position) => position.required).reduce((sum, position) => sum + position.requiredCount, 0);
    const rows = refereePublishedIds.has(fixture.id) ? publishedRefereeAssignments[fixture.id] ?? [] : refereeAssignments[fixture.id] ?? [];
    const assigned = rows.filter((row) => row.refereeId || row.refereeName.trim()).length;
    const requirement = refereeResources.matchRequirements[fixture.id] ?? refereeResources.matchRequirements[fixture.groupName ? `${fixture.stage === "GROUP" ? "Vòng bảng" : "Knockout"} · ${fixture.groupName}` : ""];
    return [fixture.id, { status: refereeStatus(fixture.id), assigned, required, published: refereePublishedIds.has(fixture.id), importance: requirement?.importance }];
  }));
  const refereeDiagramSchedule = tab === "referees" && isSchedulePublished ? officialSchedule : visibleEntries;

  async function validateOnMatchService(fixturesToCheck: DemoFixture[], entriesToCheck: Record<string, DemoScheduleEntry>, resourcesToCheck: DemoScheduleResources, focusFixtureId?: string) {
    const response = await requestEngine<{ tournamentId: string; diagramVersion: string; issues: ScheduleConstraintIssue[]; warnings: ScheduleConstraintIssue[] }>("validate", { tournamentId, diagramVersion: snapshotKey, fixtures: fixturesToCheck, entries: entriesToCheck, resources: resourcesToCheck, pitchType: footballFormat, focusFixtureId });
    if (response.tournamentId !== tournamentId || response.diagramVersion !== snapshotKey) throw new Error("Match Service trả về kết quả cho phiên bản giải khác.");
    return response;
  }

  useEffect(() => {
    if (!validStep4 || !snapshotKey) return;
    let active = true;
    setServerValidation((current) => ({ ...current, signature: validationSignature, loading: true, error: "" }));
    void validateOnMatchService(fixtures, step5.scheduleByFixture, resources)
      .then((result) => { if (active) setServerValidation({ signature: validationSignature, loading: false, error: "", issues: result.issues, warnings: result.warnings }); })
      .catch((error: unknown) => { if (active) setServerValidation({ signature: validationSignature, loading: false, error: error instanceof Error ? error.message : "Match Service không kiểm tra được lịch.", issues: [], warnings: [] }); });
    return () => { active = false; };
  }, [validStep4, snapshotKey, validationSignature]);

  function selectFixture(fixture: DemoFixture) {
    setSelectedFixture(fixture);
    const existing = visibleEntries[fixture.id] ?? step5.scheduleByFixture[fixture.id];
    if (mode === "schedule" && activeStage === 3 && !isPublished) {
      setMethod("MANUAL");
      setEditing(!staleStep5Snapshot && !existing?.locked);
    }
  }

  useEffect(() => {
    if (step5.autoConfiguration) {
      // Runtime is an application limit, not a hidden organizer preference.
      // Older saved previews must not retain the previous 15-second limit.
      const savedConfiguration = { ...step5.autoConfiguration, maxRuntimeMs: MAX_AUTOMATIC_SCHEDULE_RUNTIME_MS };
      setAutoConfiguration(savedConfiguration.scope.dateRange ? savedConfiguration : {
        ...savedConfiguration,
        scope: { ...savedConfiguration.scope, dateRange: { start: resources.competitionStartDate, end: resources.competitionEndDate } },
      });
    }
    else {
      const configuration = defaultAutoScheduleConfiguration(resources.competitionStartDate, resources.competitionEndDate);
      setAutoConfiguration({ ...configuration, objectives: resources.defaultObjectives?.length ? resources.defaultObjectives : configuration.objectives });
    }
  }, [tournamentId, step5.diagramSnapshotKey, step5.autoConfiguration, resources.competitionStartDate, resources.competitionEndDate, resources.defaultObjectives]);

  function changeAutoConfiguration(next: AutoScheduleConfiguration) {
    setAutoConfiguration(next);
    const latest = readDrawTestState(tournamentId);
    const latestStep5 = latest.step5?.diagramSnapshotKey === snapshotKey ? latest.step5 : step5;
    writeDrawTestState(tournamentId, { step5: { ...latestStep5, autoConfiguration: next, simulationValidation: latestStep5.autoPreview ? null : latestStep5.simulationValidation } });
  }

  async function runAutomaticSchedule() {
    if (isPublished || autoRunning || !formatMatchesDiagram || staleStep5Snapshot) return;
    if (autoPreview && !await confirm({
      title: "Thay thế phương án lập lịch hiện tại?",
      description: `${simulatedFixtureIds.length} thay đổi trong phương án hiện tại sẽ được thay bằng kết quả mới. Lịch nháp, lịch đã khóa và lịch chính thức được giữ nguyên.`,
      confirmLabel: "Chạy lại và thay thế",
    })) return;
    setAutoRunning(true);
    const controller = new AbortController();
    autoRequestController.current = controller;
    setSelectedFixture(null);
    setSaveError("");
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    try {
      const latest = readDrawTestState(tournamentId);
      const latestStep5 = latest.step5;
      if (demoDiagramSnapshotKey(latest) !== snapshotKey || latestStep5?.diagramSnapshotKey !== snapshotKey || latestStep5.schedulePublishedAt || latestStep5.publishedAt) {
        setSaveError("Sơ đồ hoặc bản lịch đã thay đổi ở tab khác; tải lại trước khi chạy tự động.");
        return;
      }
      const current = latestStep5.scheduleByFixture;
      if (official) {
        const response = await official.request<{ tournamentId: string; diagramVersion: string; plan: AutomaticSchedulePlan }>("automatic-preview", { configuration: autoConfiguration }, controller.signal);
        if (response.tournamentId !== tournamentId || response.diagramVersion !== snapshotKey) throw new Error("Sơ đồ đã thay đổi. Tải lại trước khi tạo lịch.");
        const newest = readDrawTestState(tournamentId);
        if (!newest.step5 || automaticScheduleBaseSignature(newest.fixtures, newest.step5.scheduleByFixture, newest.step5.resources ?? resources) !== response.plan.baseSignature) throw new Error("Lịch hoặc nguồn lực đã thay đổi. Đề xuất không được áp dụng.");
        writeDrawTestState(tournamentId, { step5: { ...newest.step5, autoConfiguration, autoPreview: response.plan, simulationStatus: "SIMULATED", simulationValidation: null } });
        setAutoPanelOpen(false); setScheduleView("LIST");
        onNotice?.(response.plan.scheduledFixtureIds.length ? `Đã đề xuất ${response.plan.scheduledFixtureIds.length}/${response.plan.selectedFixtureIds.length} trận; chưa lưu nháp hoặc khóa.` : "Chưa xếp được trận nào. Xem nguyên nhân trong kết quả lập lịch.");
        return;
      }
      await flushDrawTestPersistence(tournamentId);
      const serverSnapshot = await getScheduleWorkflowTestState<DemoStep5State>(tournamentId);
      const serverStep5 = serverSnapshot.state;
      if (!serverStep5 || serverSnapshot.revision < 1 || serverSnapshot.diagramVersion !== snapshotKey || serverStep5.diagramSnapshotKey !== snapshotKey) {
        setSaveError("Snapshot lịch trên Match Service không khớp sơ đồ Bước 4 hiện tại. Tải lại trạng thái rồi thử lại.");
        return;
      }
      const serverDraft = serverStep5.scheduleByFixture ?? {};
      const localResources = latestStep5.resources ?? resources;
      if (serverStep5.schedulePublishedAt || serverStep5.publishedAt
        || JSON.stringify(serverDraft) !== JSON.stringify(current)
        || JSON.stringify(serverStep5.resources ?? null) !== JSON.stringify(latestStep5.resources ?? null)
        || JSON.stringify(serverStep5.autoPreview ?? null) !== JSON.stringify(latestStep5.autoPreview ?? null)
        || JSON.stringify(serverStep5.autoConfiguration ?? null) !== JSON.stringify(latestStep5.autoConfiguration ?? null)) {
        setSaveError("Lịch, nguồn lực hoặc phương án đã đổi trên máy chủ ở phiên khác. Không ghi đè; tải lại trạng thái rồi thử lại.");
        return;
      }
      const expectedRevision = serverSnapshot.revision;
      acknowledgeScheduleTestRevision(tournamentId, expectedRevision);
      if (expectedRevision < 1) throw new Error("Chưa lưu được thiết lập lịch lên Match Service. Kiểm tra dữ liệu sơ đồ và thử lại.");
      const engineResponse = await apiFetch<{ tournamentId: string; diagramVersion: string; plan: AutomaticSchedulePlan; revision: number }>("/schedules/engine/test/automatic-preview", {
        method: "POST",
        body: JSON.stringify({
          tournamentId,
          diagramVersion: snapshotKey,
          fixtures: latest.fixtures.filter((fixture) => !fixture.bye),
          entries: current,
          resources: serverStep5.resources ?? localResources,
          configuration: autoConfiguration,
          pitchType: footballFormat,
          expectedRevision,
          replaceExistingSimulation: Boolean(serverStep5.autoPreview),
        }),
        signal: controller.signal,
      });
      if (engineResponse.tournamentId !== tournamentId || engineResponse.diagramVersion !== snapshotKey) throw new Error("Phản hồi lập lịch thuộc phiên bản giải khác; hãy thử lại.");
      const plan = engineResponse.plan;
      const newest = readDrawTestState(tournamentId);
      if (!newest.step5 || newest.step5.schedulePublishedAt || newest.step5.publishedAt || automaticScheduleBaseSignature(newest.fixtures, newest.step5.scheduleByFixture, newest.step5.resources ?? resources) !== plan.baseSignature) {
        onNotice?.("Lịch hoặc nguồn lực vừa thay đổi khi thuật toán đang chạy. Đề xuất bị hủy để tránh áp dụng dữ liệu cũ.");
        return;
      }
      acknowledgeScheduleTestRevision(tournamentId, engineResponse.revision);
      acceptServerScheduleTestState(tournamentId, { ...newest.step5, autoConfiguration, autoPreview: plan, simulationStatus: "SIMULATED", simulationValidation: null }, engineResponse.revision);
      setAutoPanelOpen(false);
      setScheduleView("LIST");
      onNotice?.(plan.status === "COMPLETE" ? `Đã đề xuất ${plan.scheduledFixtureIds.length} trận; chưa lưu nháp hoặc khóa.` : `Đã đề xuất lịch cho ${plan.scheduledFixtureIds.length}/${plan.selectedFixtureIds.length} trận; các trận còn thiếu vẫn chưa được xếp.`);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        const message = error instanceof ApiError && error.code === "TEST_WORKFLOW_REVISION_CONFLICT"
          ? "Bản lịch đã thay đổi trong khi thuật toán chạy. Không có lịch nào bị ghi đè; tải lại trạng thái rồi chạy lại."
          : error instanceof Error ? error.message : "Không thể tạo đề xuất lịch tự động.";
        setSaveError(message);
      }
    } finally {
      if (autoRequestController.current === controller) autoRequestController.current = null;
      setAutoRunning(false);
    }
  }

  async function cancelAutomaticPreview() {
    if (autoRequestController.current) {
      autoRequestController.current.abort();
      autoRequestController.current = null;
      setAutoRunning(false);
      onNotice?.("Đã yêu cầu Match Service dừng tìm kiếm. Lịch nháp chưa thay đổi.");
      return;
    }
    const latest = readDrawTestState(tournamentId);
    if (!latest.step5 || latest.step5.diagramSnapshotKey !== snapshotKey) return;
    try { await commitScheduleTestState(tournamentId, { ...latest.step5, autoPreview: undefined, simulationStatus: null, simulationValidation: null }); }
    catch (error) { setSaveError(error instanceof Error ? error.message : "Không thể hủy phương án trên Match Service."); return; }
    onNotice?.("Đã hủy đề xuất; bản lịch nháp hiện tại chưa thay đổi.");
  }

  async function withLocalScheduleLock<T>(work: () => Promise<T>): Promise<T> {
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    if (locks) return locks.request(`sfl-step5-schedule:${tournamentId}`, work);
    return work();
  }

  async function saveManualEntry(lockAfterSave = false) {
    if (!selectedFixture || !selectedChoice || isPublished || staleStep5Snapshot) return;
    if (!formatMatchesDiagram) { setSaveError(formatMismatchText); return; }
    setSaveError("");
    await withLocalScheduleLock(async () => {
      const latest = readDrawTestState(tournamentId);
      const latestKey = demoDiagramSnapshotKey(latest);
      const latestStep5 = latest.step5;
      if (latestKey !== snapshotKey || latestStep5?.diagramSnapshotKey !== snapshotKey) { setSaveError("Sơ đồ hoặc bản nháp đã thay đổi ở tab khác. Hãy tải lại lựa chọn trước khi lưu."); return; }
       if (latestStep5.schedulePublishedAt || latestStep5.publishedAt) { setSaveError("Lịch đã được công bố ở tab khác và hiện chỉ đọc."); return; }
      const latestFixture = latest.fixtures.find((fixture) => fixture.id === selectedFixture.id);
      if (!latestFixture) { setSaveError("Trận không còn thuộc phiên bản sơ đồ hiện tại."); return; }
       const currentPreview = latestStep5.autoPreview;
       const editingSimulation = Boolean(currentPreview?.scheduledFixtureIds.includes(selectedFixture.id)
         && currentPreview.proposedEntries[selectedFixture.id]?.scheduledAt);
       if (lockAfterSave && editingSimulation) { setSaveError("Lịch giả lập cần được kiểm tra và khóa riêng; không chuyển trực tiếp thành lịch nháp."); return; }
       const candidateEntries = editingSimulation && currentPreview
         ? { ...latestStep5.scheduleByFixture, ...currentPreview.proposedEntries }
         : latestStep5.scheduleByFixture;
      const serverChoices = await requestEngine<{ tournamentId: string; diagramVersion: string; candidates: ManualScheduleCandidate[] }>("manual-candidates", { tournamentId, diagramVersion: snapshotKey, fixtureId: latestFixture.id, fixtures: latest.fixtures.filter((fixture) => !fixture.bye), entries: candidateEntries, resources: latestStep5.resources ?? resources, pitchType: footballFormat });
      if (serverChoices.tournamentId !== tournamentId || serverChoices.diagramVersion !== snapshotKey) { setSaveError("Lựa chọn trả về không thuộc phiên bản sơ đồ hiện tại."); return; }
      const freshChoices = serverChoices.candidates;
      const freshChoice = freshChoices.find((candidate) => candidate.scheduledAt === draft.scheduledAt && candidate.venue.code === draft.venue);
      if (!freshChoice) { setSaveError("Lựa chọn vừa không còn khả dụng do lịch hoặc cấu hình thay đổi ở tab khác. Chọn ngày, sân và giờ mới."); return; }
      const previous = latestStep5.scheduleByFixture[selectedFixture.id] ?? emptyEntry();
      const nextEntry: DemoScheduleEntry = { ...previous, scheduledAt: freshChoice.scheduledAt, durationMinutes: matchPlayMinutes(latestFixture, latestStep5.resources ?? resources), venue: freshChoice.venue.code, slotId: freshChoice.slotId, notes: draft.notes, locked: lockAfterSave ? true : previous.locked };
      const nextEntries = { ...latestStep5.scheduleByFixture, [selectedFixture.id]: nextEntry };
      const validationEntries = editingSimulation && currentPreview
        ? { ...latestStep5.scheduleByFixture, ...currentPreview.proposedEntries, [selectedFixture.id]: nextEntry }
        : nextEntries;
      let issues: ScheduleConstraintIssue[];
      try { issues = (await validateOnMatchService(latest.fixtures.filter((fixture) => !fixture.bye), validationEntries, latestStep5.resources ?? resources)).issues; }
      catch (error) { setSaveError(error instanceof Error ? error.message : "Match Service không kiểm tra được lịch."); return; }
      if (issues.length) { setSaveError(issues.map((issue) => issue.message).join(" ")); return; }
      if (editingSimulation && currentPreview) {
        try {
          await commitScheduleTestState(tournamentId, { ...latestStep5,
            autoPreview: { ...currentPreview, proposedEntries: { ...currentPreview.proposedEntries, [selectedFixture.id]: nextEntry } },
            simulationStatus: "SIMULATED_CUSTOMIZED", simulationValidation: null,
          });
        } catch (error) { setSaveError(error instanceof Error ? error.message : "Không thể lưu điều chỉnh phương án lên Match Service."); return; }
      } else {
        try { await commitScheduleTestState(tournamentId, { ...latestStep5, scheduleByFixture: nextEntries }); }
        catch (error) { setSaveError(error instanceof Error ? error.message : "Không thể lưu lịch lên Match Service."); return; }
      }
      setEditing(false);
      onNotice?.(editingSimulation ? `Đã điều chỉnh lịch giả lập ${selectedFixture.id}; đề xuất vẫn được đánh dấu để BTC rà soát.` : lockAfterSave ? `Đã lưu và khóa lịch ${selectedFixture.id} sau khi Match Service xác minh.` : `Đã lưu lịch ${selectedFixture.id} vào bản nháp; sơ đồ đã cập nhật.`);
    }).catch((error: unknown) => { setSaveError(error instanceof Error ? error.message : "Không thể lưu lịch trên Match Service."); });
  }

  async function saveFinalRoundCluster() {
    if (!selectedFinalGroup || !selectedClusterOption || isPublished) return;
    if (!formatMatchesDiagram) { setSaveError(formatMismatchText); return; }
    await withLocalScheduleLock(async () => {
      const latest = readDrawTestState(tournamentId);
      const latestStep5 = latest.step5;
      if (demoDiagramSnapshotKey(latest) !== snapshotKey || latestStep5?.diagramSnapshotKey !== snapshotKey || latestStep5.schedulePublishedAt || latestStep5.publishedAt) {
        onNotice?.("Sơ đồ hoặc bản lịch đã đổi ở tab khác. Tải lại rồi chọn lại cụm vòng cuối.");
        return;
      }
      if (selectedFinalGroup.fixtures.some((fixture) => latestStep5.scheduleByFixture[fixture.id]?.locked)) {
        onNotice?.("Cụm này có lịch đã khóa. Mở khóa các trận trước khi lập lịch đồng giờ.");
        return;
      }
      const latestGroup = getFinalRoundFixturesByGroup(latest.fixtures.filter((fixture) => !fixture.bye)).find((group) => group.groupName === clusterGroup);
      if (!latestGroup) return;
      const latestOptions = getFinalRoundClusterOptions(latestGroup.fixtures, latest.fixtures.filter((fixture) => !fixture.bye), latestStep5.scheduleByFixture, latestStep5.resources ?? resources, footballFormat);
      const fresh = latestOptions.find((option) => option.scheduledAt + "|" + option.slotId === clusterChoiceKey);
      if (!fresh || fresh.venues.length !== latestGroup.fixtures.length) {
        onNotice?.("Không còn đủ sân hoặc khung giờ hợp lệ cho toàn cụm. Cần " + latestGroup.fixtures.length + " sân khác nhau; hãy kiểm tra ngày, sân khả dụng và ràng buộc.");
        return;
      }
      const nextEntries = { ...latestStep5.scheduleByFixture };
      const serverCandidateSets = await Promise.all(latestGroup.fixtures.map(async (fixture) => {
        const response = await requestEngine<{ tournamentId: string; diagramVersion: string; candidates: ManualScheduleCandidate[] }>("manual-candidates", { tournamentId, diagramVersion: snapshotKey, fixtureId: fixture.id, fixtures: latest.fixtures.filter((item) => !item.bye), entries: latestStep5.scheduleByFixture, resources: latestStep5.resources ?? resources, pitchType: footballFormat });
        if (response.tournamentId !== tournamentId || response.diagramVersion !== snapshotKey) throw new Error("Kết quả chọn giờ thuộc phiên bản sơ đồ khác.");
        return [fixture.id, response.candidates] as const;
      }));
      const candidatesByFixture = new Map(serverCandidateSets);
      latestGroup.fixtures.forEach((fixture, index) => {
        const venue = fresh.venues[index];
        const choice = (candidatesByFixture.get(fixture.id) ?? [])
          .find((candidate) => candidate.scheduledAt === fresh.scheduledAt && candidate.venue.id === venue.id);
        if (!choice) return;
        const previous = nextEntries[fixture.id];
        nextEntries[fixture.id] = { ...previous, scheduledAt: choice.scheduledAt, durationMinutes: matchPlayMinutes(fixture, latestStep5.resources ?? resources), venue: choice.venue.code, slotId: choice.slotId, refereeNames: previous?.refereeNames ?? [], notes: previous?.notes ?? "" };
      });
      const issues = validateSchedulePlan(latest.fixtures.filter((fixture) => !fixture.bye), nextEntries, latestStep5.resources ?? resources, footballFormat);
      if (issues.length) { onNotice?.("Không thể lưu cụm vòng cuối: " + issues[0].message); return; }
      await commitScheduleTestState(tournamentId, { ...latestStep5, scheduleByFixture: nextEntries });
      setClusterChoiceKey("");
      onNotice?.("Đã xếp đồng giờ " + latestGroup.groupName + " cho " + latestGroup.fixtures.length + " trận bằng " + fresh.venues.length + " sân khác nhau.");
    });
  }

  async function deleteSchedule() {
    if (!selectedFixture || isPublished) return;
    const isSimulation = simulatedFixtureIds.includes(selectedFixture.id);
    if (isSimulation) {
      const preview = step5.autoPreview;
      if (!preview) return;
      if (!await confirm({ title: `Bỏ lịch giả lập ${selectedFixture.id}?`, description: "Chỉ bỏ giờ và sân đang đề xuất cho trận này. Fixture và cặp đấu vẫn được giữ nguyên.", confirmLabel: "Bỏ lịch giả lập", danger: true })) return;
      const latest = readDrawTestState(tournamentId);
      const current = latest.step5?.autoPreview;
      if (!latest.step5 || latest.step5.diagramSnapshotKey !== snapshotKey || !current || current.baseSignature !== preview.baseSignature) {
        setSaveError("Đề xuất đã thay đổi ở tab khác. Hãy tải lại trước khi chỉnh."); return;
      }
      const scheduledFixtureIds = current.scheduledFixtureIds.filter((id) => id !== selectedFixture.id);
      const nextPreview = scheduledFixtureIds.length ? { ...current, scheduledFixtureIds, proposedEntries: { ...current.proposedEntries, [selectedFixture.id]: emptyEntry() } } : undefined;
      try { await commitScheduleTestState(tournamentId, { ...latest.step5, autoPreview: nextPreview, simulationStatus: nextPreview ? "SIMULATED" : null, simulationValidation: null }); }
      catch (error) { setSaveError(error instanceof Error ? error.message : "Không thể xóa lịch giả lập trên Match Service."); return; }
      setSelectedFixture(null);
      onNotice?.(`Đã bỏ lịch giả lập ${selectedFixture.id}; fixture vẫn còn trên sơ đồ.`);
      return;
    }
    const existing = step5.scheduleByFixture[selectedFixture.id];
    if (!existing?.scheduledAt) return;
    if (existing.locked) { onNotice?.("Hãy mở khóa lịch trước khi xóa."); return; }
    if (!await confirm({ title: `Xóa lịch ${selectedFixture.id}?`, description: "Trận sẽ trở về trạng thái chưa lập lịch. Cặp đấu và cấu trúc sơ đồ được giữ nguyên.", confirmLabel: "Xóa lịch", danger: true })) return;
    const latest = readDrawTestState(tournamentId); const latestStep5 = latest.step5;
    if (!latestStep5 || latestStep5.diagramSnapshotKey !== snapshotKey || latestStep5.schedulePublishedAt || latestStep5.publishedAt) return;
    const entries = { ...latestStep5.scheduleByFixture }; delete entries[selectedFixture.id];
    try { await commitScheduleTestState(tournamentId, { ...latestStep5, scheduleByFixture: entries }); }
    catch (error) { setSaveError(error instanceof Error ? error.message : "Không thể xóa lịch."); return; }
    setEditing(true); setDraft({ date: "", venue: "", scheduledAt: "", notes: "" });
    onNotice?.("Đã xóa giờ và sân của trận khỏi bản nháp.");
  }

  async function toggleLock() {
    if (!selectedFixture || !currentEntry?.scheduledAt || isPublished || staleStep5Snapshot) return;
    await withLocalScheduleLock(async () => {
      const latest = readDrawTestState(tournamentId); const latestStep5 = latest.step5;
      if (!latestStep5 || latestStep5.diagramSnapshotKey !== snapshotKey || latestStep5.schedulePublishedAt || latestStep5.publishedAt) return;
      const previous = latestStep5.scheduleByFixture[selectedFixture.id];
      const isSimulation = Boolean(latestStep5.autoPreview?.scheduledFixtureIds.includes(selectedFixture.id)
        && latestStep5.autoPreview.proposedEntries[selectedFixture.id]?.scheduledAt);
      const source = isSimulation ? latestStep5.autoPreview!.proposedEntries[selectedFixture.id] : previous;
      if (!source) return;
      const next = { ...source, locked: !source.locked };
      const entries = isSimulation
        ? { ...latestStep5.scheduleByFixture, ...latestStep5.autoPreview!.proposedEntries, [selectedFixture.id]: next }
        : { ...latestStep5.scheduleByFixture, [selectedFixture.id]: next };
      if (next.locked) {
        try {
          const serverCheck = await validateOnMatchService(latest.fixtures.filter((fixture) => !fixture.bye), entries, latestStep5.resources ?? resources, selectedFixture.id);
          const blocking = serverCheck.issues[0] ?? serverCheck.warnings.find((issue) => issue.severity === "HARD");
          if (blocking) { onNotice?.(`Không thể khóa lịch chưa hợp lệ: ${blocking.message}`); return; }
        } catch (error) { onNotice?.(error instanceof Error ? `Không thể xác minh lịch với Match Service: ${error.message}` : "Không thể xác minh lịch với Match Service."); return; }
      }
      if (isSimulation) {
        const remaining = latestStep5.autoPreview!.scheduledFixtureIds.filter((id) => id !== selectedFixture.id);
        const nextDraftEntries = { ...latestStep5.scheduleByFixture, [selectedFixture.id]: next };
        const nextPreview = remaining.length ? { ...latestStep5.autoPreview!, scheduledFixtureIds: remaining,
          proposedEntries: { ...latestStep5.autoPreview!.proposedEntries, [selectedFixture.id]: next },
          baseSignature: automaticScheduleBaseSignature(latest.fixtures, nextDraftEntries, latestStep5.resources ?? resources),
        } : undefined;
        try { await commitScheduleTestState(tournamentId, {
          ...latestStep5,
          scheduleByFixture: nextDraftEntries,
          autoPreview: nextPreview,
          simulationStatus: remaining.length ? "SIMULATED" : null, simulationValidation: null,
        }); } catch (error) { setSaveError(error instanceof Error ? error.message : "Không thể khóa lịch giả lập trên Match Service."); return; }
        setEditing(false);
        onNotice?.("Đã kiểm tra và khóa lịch này. Dấu lịch giả lập được gỡ; lịch chuyển vào bản nháp chung.");
      } else {
        try { await commitScheduleTestState(tournamentId, { ...latestStep5, scheduleByFixture: { ...latestStep5.scheduleByFixture, [selectedFixture.id]: next } }); }
        catch (error) { setSaveError(error instanceof Error ? error.message : "Không thể lưu trạng thái khóa lên Match Service."); return; }
        onNotice?.(previous?.locked ? "Đã mở khóa lịch trận để chỉnh sửa." : "Đã kiểm tra và khóa lịch trận; thời gian này được giữ nguyên.");
      }
    });
  }

  function toggleFixtureSelection(fixtureId: string) {
    setSelectedFixtureIds((selected) => selected.includes(fixtureId) ? selected.filter((id) => id !== fixtureId) : [...selected, fixtureId]);
  }

  async function validateSimulationPlan() {
    const latest = readDrawTestState(tournamentId);
    const current = latest.step5;
    if (!current?.autoPreview || current.diagramSnapshotKey !== snapshotKey || isPublished) return;
    try {
      if (official) {
        const entries = { ...current.scheduleByFixture, ...current.autoPreview.proposedEntries };
        const result = await validateOnMatchService(latest.fixtures, entries, current.resources ?? resources);
        const invalidIds = new Set(result.issues.map((issue) => issue.fixtureId).filter(Boolean));
        const validation: NonNullable<DemoStep5State["simulationValidation"]> = { checkedAt: new Date().toISOString(), diagramVersion: snapshotKey, revision: 0, validCount: current.autoPreview.scheduledFixtureIds.filter((id) => !invalidIds.has(id)).length, invalidCount: result.issues.length, warningCount: result.warnings.length, issues: [...result.issues, ...result.warnings].map((issue) => ({ ...issue, severity: issue.severity ?? "WARNING" })) };
        writeDrawTestState(tournamentId, { step5: { ...current, simulationStatus: validation.invalidCount ? "INVALID" : "VALID", simulationValidation: validation } });
        onNotice?.(`Đã kiểm tra phương án: ${validation.validCount} lịch hợp lệ, ${validation.invalidCount} lỗi, ${validation.warningCount} cảnh báo.`);
        return;
      }
      const revision = await ensureScheduleTestRevision(tournamentId);
      const result = await apiFetch<{ tournamentId: string; diagramVersion: string; revision: number; validation: NonNullable<DemoStep5State["simulationValidation"]> }>("/schedules/engine/test/simulation/validate", {
        method: "POST",
        body: JSON.stringify({ tournamentId, diagramVersion: snapshotKey, fixtures: latest.fixtures.filter((fixture) => !fixture.bye), expectedRevision: revision }),
      });
      if (result.tournamentId !== tournamentId || result.diagramVersion !== snapshotKey) throw new Error("Kết quả kiểm tra thuộc phiên bản sơ đồ khác.");
      acceptServerScheduleTestState(tournamentId, { ...current, simulationStatus: result.validation.invalidCount ? "INVALID" : "VALID", simulationValidation: result.validation }, result.revision);
      onNotice?.(`Match Service kiểm tra phương án: ${result.validation.validCount} lịch hợp lệ, ${result.validation.invalidCount} lỗi, ${result.validation.warningCount} cảnh báo.`);
    } catch (error) { onNotice?.(error instanceof Error ? `Không thể lưu kết quả kiểm tra: ${error.message}` : "Không thể kiểm tra phương án."); }
  }

  async function lockSelectedSchedules(fixtureIds = selectedFixtureIds) {
    if (!fixtureIds.length || isPublished || staleStep5Snapshot) return;
    const latest = readDrawTestState(tournamentId);
    const current = latest.step5;
    if (!current || current.diagramSnapshotKey !== snapshotKey || current.schedulePublishedAt || current.publishedAt) return;
    const entries = { ...current.scheduleByFixture };
    const preview = current.autoPreview;
    const remainingProposals = new Set(preview?.scheduledFixtureIds ?? []);
    for (const id of fixtureIds) {
      const proposed = preview?.proposedEntries[id];
      const existing = proposed?.scheduledAt && proposed.venue ? proposed : entries[id];
      if (!existing?.scheduledAt || !existing.venue) continue;
      entries[id] = { ...existing, locked: true };
      remainingProposals.delete(id);
    }
    try {
      const result = await validateOnMatchService(latest.fixtures.filter((fixture) => !fixture.bye), entries, current.resources ?? resources);
      const blocking = result.issues[0] ?? result.warnings.find((issue) => issue.severity === "HARD");
      if (blocking) { onNotice?.(`Không thể khóa lịch đã chọn: ${blocking.message}`); return; }
    } catch (error) { onNotice?.(error instanceof Error ? `Không thể kiểm tra lịch: ${error.message}` : "Không thể kiểm tra lịch."); return; }
    const nextPreview = preview && remainingProposals.size
      ? { ...preview, scheduledFixtureIds: [...remainingProposals], baseSignature: automaticScheduleBaseSignature(latest.fixtures, entries, current.resources ?? resources) }
      : undefined;
    try {
      await commitScheduleTestState(tournamentId, { ...current, scheduleByFixture: entries, autoPreview: nextPreview,
        simulationStatus: nextPreview ? "SIMULATED" : null, simulationValidation: null });
    } catch (error) { onNotice?.(error instanceof Error ? `Không thể khóa lịch trên Match Service: ${error.message}` : "Không thể khóa lịch."); return; }
    setSelectedFixtureIds([]);
    onNotice?.("Đã kiểm tra và khóa các lịch hợp lệ đã chọn.");
  }

  async function unlockSelectedSchedules() {
    if (!selectedFixtureIds.length || isPublished || staleStep5Snapshot) return;
    const latest = readDrawTestState(tournamentId);
    const current = latest.step5;
    if (!current || current.diagramSnapshotKey !== snapshotKey || current.schedulePublishedAt || current.publishedAt) return;
    const entries = { ...current.scheduleByFixture };
    for (const id of selectedFixtureIds) if (entries[id]?.locked) entries[id] = { ...entries[id], locked: false };
    try { await commitScheduleTestState(tournamentId, { ...current, scheduleByFixture: entries }); }
    catch (error) { onNotice?.(error instanceof Error ? `Không thể mở khóa lịch trên Match Service: ${error.message}` : "Không thể mở khóa lịch trên Match Service."); return; }
    setSelectedFixtureIds([]);
    onNotice?.("Đã mở khóa các lịch đã chọn để có thể chỉnh sửa.");
  }

  async function removeSelectedSchedules() {
    if (!selectedFixtureIds.length || isPublished || staleStep5Snapshot) return;
    if (!await confirm({ title: "Xóa lịch đã chọn?", description: "Chỉ xóa giờ và sân khỏi lịch nháp hoặc phương án giả lập. Fixture, mã trận, cặp đấu và sơ đồ vẫn được giữ nguyên. Lịch đang khóa cần được mở khóa trước.", confirmLabel: "Xóa lịch", danger: true })) return;
    const latest = readDrawTestState(tournamentId);
    const current = latest.step5;
    if (!current || current.diagramSnapshotKey !== snapshotKey || current.schedulePublishedAt || current.publishedAt) return;
    const entries = { ...current.scheduleByFixture };
    let preview = current.autoPreview;
    const remaining = new Set(preview?.scheduledFixtureIds ?? []);
    const proposedEntries = { ...(preview?.proposedEntries ?? {}) };
    for (const id of selectedFixtureIds) {
      if (entries[id]?.locked) continue;
      delete entries[id];
      if (preview?.scheduledFixtureIds.includes(id)) {
        remaining.delete(id);
        proposedEntries[id] = emptyEntry();
      }
    }
    if (preview) preview = remaining.size ? { ...preview, scheduledFixtureIds: [...remaining], proposedEntries } : undefined;
    try { await commitScheduleTestState(tournamentId, { ...current, scheduleByFixture: entries, autoPreview: preview }); }
    catch (error) { setSaveError(error instanceof Error ? error.message : "Không thể xóa lịch đã chọn."); return; }
    setSelectedFixtureIds([]);
    onNotice?.("Đã xóa lịch khỏi các trận đã chọn; cấu trúc sơ đồ không thay đổi.");
  }

  async function saveResources(nextResources: DemoScheduleResources) {
    if (isSchedulePublished) { onNotice?.("Lịch đã công bố và khóa. Cấu hình nguồn lực không thể thay đổi trực tiếp."); return false; }
    if (staleStep5Snapshot) { onNotice?.("Sơ đồ Bước 4 đã đổi phiên bản. Snapshot lịch cũ được giữ nguyên; không thể ghi đè bằng thiết lập của sơ đồ mới."); return false; }
    const latest = readDrawTestState(tournamentId);
    const latestStep5 = latest.step5?.diagramSnapshotKey === snapshotKey ? latest.step5 : emptyDemoStep5State(snapshotKey, defaults);
    const entries = { ...latestStep5.scheduleByFixture, ...(latestStep5.autoPreview?.proposedEntries ?? {}) };
    const hasScheduledEntries = Object.values(entries).some((entry) => Boolean(entry?.scheduledAt && entry.venue));
    const impactInput = {
      tournamentId,
      diagramVersion: snapshotKey,
      fixtures: latest.fixtures.filter((fixture) => !fixture.bye),
      entries,
      resources: latestStep5.resources ?? resources,
      candidateResources: nextResources,
      pitchType: footballFormat,
    };
    const response = hasScheduledEntries ? await (official ? official.request<Awaited<ReturnType<typeof previewScheduleResourceImpact>>>("resources/preview", impactInput) : previewScheduleResourceImpact(impactInput)) : null;
    if (response && (response.tournamentId !== tournamentId || response.diagramVersion !== snapshotKey)) throw new Error("Phân tích nguồn lực trả về sai phiên bản sơ đồ.");
    if (response) {
      const hardCatalogIssues = response.resourceIssues.filter((issue) => issue.severity === "HARD" && issue.code !== "SETUP_CONFIRMATION_REQUIRED");
      if (hardCatalogIssues.length) throw new Error(hardCatalogIssues.map((issue) => issue.message).join(" "));
      if (response.regulationIssues.length) throw new Error(response.regulationIssues.join(" "));
    }
    let acknowledgement: DemoStep5State["resourceChangeAcknowledgement"];
    if (response?.requiresConfirmation) {
      const issueText = response.newlyInvalidIssues.slice(0, 8).map((issue) => `${issue.fixtureId}: ${issue.message}`).join("\n");
      const lockedText = response.affectedLockedFixtureIds.length ? `\n\nCác lịch đang khóa có liên quan: ${response.affectedLockedFixtureIds.join(", ")}. Hệ thống không tự mở khóa hoặc di chuyển chúng.` : "";
      const recommendationText = response.recommendations.length ? `\n\nHướng xử lý: ${response.recommendations.slice(0, 5).join("; ")}` : "";
      const accepted = await confirm({
        title: `Thay đổi ảnh hưởng ${response.affectedFixtureIds.length} trận`,
        description: `${response.affectedFixtureIds.join(", ")}${issueText ? `\n\n${issueText}` : ""}${lockedText}${recommendationText}\n\nMọi lịch được giữ nguyên. Tiếp tục sẽ lưu cấu hình mới và đánh dấu những lịch không còn hợp lệ để BTC xử lý.`,
        confirmLabel: "Lưu và giữ nguyên lịch",
        danger: response.newlyInvalidIssues.length > 0,
      });
      if (!accepted) return false;
      acknowledgement = { diagramVersion: snapshotKey, resourceSignature: JSON.stringify(nextResources), pitchType: footballFormat, fixtureIds: response.affectedFixtureIds };
    }

    const updatedStep5 = { ...latestStep5, resources: nextResources, resourceChangeAcknowledgement: acknowledgement };
    await commitScheduleTestState(tournamentId, updatedStep5);
    if (acknowledgement && !official) {
      const { resourceChangeAcknowledgement: _consumed, ...cleanStep5 } = updatedStep5;
      await commitScheduleTestState(tournamentId, cleanStep5);
    }
    onNotice?.(official ? "Đã lưu sân, thời gian khả dụng và điều kiện lập lịch vào database." : response?.affectedFixtureIds.length
      ? `Đã lưu snapshot nguồn lực. ${response.affectedFixtureIds.length} lịch bị ảnh hưởng được giữ nguyên để BTC xem lại.`
      : hasScheduledEntries
        ? "Đã kiểm tra và lưu snapshot địa điểm, sân, khả dụng cùng các ràng buộc."
        : "Đã lưu snapshot địa điểm, sân, khả dụng và thiết lập vào Match Service. Sẽ kiểm tra ảnh hưởng trước khi lập lịch.");
    return true;
  }

  async function resetStep5() {
    if (official || !import.meta.env.DEV || resettingSchedule) return;
    if (!await confirm({ title: "Reset dữ liệu kiểm thử Bước 5?", description: "Backend sẽ xóa snapshot lịch của riêng giải này, gồm lịch nháp, phương án, trạng thái khóa/công bố và phân công trọng tài phụ thuộc trong môi trường development. Danh sách đội và sơ đồ Bước 4 được giữ nguyên.", confirmLabel: "Reset snapshot Bước 5", danger: true })) return;
    setResettingSchedule(true); setSaveError("");
    try {
      await resetScheduleTestStateForDevelopment(tournamentId, defaults);
      setState(readDrawTestState(tournamentId)); setSelectedFixture(null); setSelectedFixtureIds([]); setAutoPanelOpen(false);
      onNotice?.("Đã reset snapshot Bước 5 trên Match Service. Danh sách đội và sơ đồ Bước 4 vẫn được giữ nguyên.");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Không thể reset Bước 5; dữ liệu trên máy chủ chưa thay đổi.");
    } finally { setResettingSchedule(false); }
  }

  async function resetStep6() {
    if (!await confirm({ title: "Reset dữ liệu kiểm thử Bước 6?", description: "Xóa nguồn lực, mô hình, tổ, phân công nháp/đã công bố và trạng thái trọng tài thử nghiệm. Lịch thi đấu chính thức của Bước 5 và sơ đồ Bước 4 được giữ nguyên; không thay đổi database.", confirmLabel: "Reset Bước 6", danger: true })) return;
    resetDrawTestStep6(tournamentId); setSelectedFixture(null); onNotice?.("Đã reset riêng dữ liệu kiểm thử trọng tài Bước 6; lịch Bước 5 vẫn được giữ nguyên.");
  }

  async function publishSchedule() {
    if (!scheduleReady || isPublished) return;
    const latest = readDrawTestState(tournamentId);
    const latestStep5 = latest.step5;
    if (demoDiagramSnapshotKey(latest) !== snapshotKey || !latestStep5 || latestStep5.diagramSnapshotKey !== snapshotKey || latestStep5.schedulePublishedAt || latestStep5.publishedAt) {
      onNotice?.("Không thể công bố: sơ đồ hoặc lịch đã thay đổi ở tab khác. Hãy tải lại và kiểm tra lại."); return;
    }
    const latestFixtures = latest.fixtures.filter((fixture) => !fixture.bye);
    const latestMissing = latestFixtures.filter((fixture) => !latestStep5.scheduleByFixture[fixture.id]?.scheduledAt || !latestStep5.scheduleByFixture[fixture.id]?.venue.trim());
    if (!latestFixtures.length || latestMissing.length) {
      onNotice?.(`Chưa thể công bố: còn ${latestMissing.length}/${latestFixtures.length} trận chưa có đủ ngày, giờ và sân đã lưu.`);
      return;
    }
    let validation: ScheduleConstraintIssue[];
    let warnings: ScheduleConstraintIssue[];
    try {
      const serverCheck = await validateOnMatchService(latestFixtures, latestStep5.scheduleByFixture, latestStep5.resources ?? resources);
      validation = serverCheck.issues; warnings = serverCheck.warnings;
    } catch (error) { onNotice?.(error instanceof Error ? error.message : "Match Service không kiểm tra được lịch trước công bố."); return; }
    const hard = warnings.filter((item) => item.severity === "HARD");
    if (latestFixtures.some((fixture) => !latestStep5.scheduleByFixture[fixture.id]?.scheduledAt || !latestStep5.scheduleByFixture[fixture.id]?.venue) || validation.length || hard.length) {
      onNotice?.("Lịch chưa đủ điều kiện công bố: " + (validation[0]?.message ?? hard[0]?.message ?? "còn trận chưa xếp lịch.")); return;
    }
    const advisory = warnings.filter((item) => item.severity !== "HARD");
    try {
      if (official) {
        updateOfficialState(await official.publish());
        setTab("schedule"); setSelectedFixture(null); setActiveStage(4);
        onNotice?.(`Đã công bố chính thức ${latestFixtures.length} trận. Bước 6 đã được mở.`);
        return;
      }
      const expectedRevision = await ensureScheduleTestRevision(tournamentId);
      const result = await apiFetch<{ revision: number; idempotent: boolean; state: DemoStep5State; handoff: { scheduleVersion: number; fixtures: Array<{ fixtureId: string }> } }>(`/schedules/test-workflow/${encodeURIComponent(tournamentId)}/publish`, {
        method: "POST",
        body: JSON.stringify({ diagramVersion: snapshotKey, fixtures: latestFixtures, expectedRevision, acceptWarnings: true, operatorName: operatorName?.trim() || "BTC" }),
      });
      acceptServerScheduleTestState(tournamentId, result.state, result.revision);
      setTab("schedule"); setSelectedFixture(null); setActiveStage(4);
      onNotice?.(`Match Service đã công bố ${result.handoff.fixtures.length} trận trong snapshot thử nghiệm v${result.handoff.scheduleVersion}; bảng lịch chính thức không thay đổi.${advisory.length ? ` Ghi nhận ${advisory.length} lưu ý chất lượng.` : ""}`);
    } catch (error) {
      onNotice?.(error instanceof Error ? `Không công bố được lịch: ${error.message}` : "Không công bố được lịch. Bản nháp được giữ nguyên.");
    }
  }

  function saveRefereeFixtureAssignments(fixtureId: string, rows: DemoRefereeAssignment[], baseSignature: string): string | false {
    const latest = readDrawTestState(tournamentId); const current = latest.step5;
    const fixture = fixtures.find((item) => item.id === fixtureId);
    if (!current || !fixture || current.diagramSnapshotKey !== snapshotKey || current.refereePublishedFixtureIds?.includes(fixtureId) || current.refereeLockedFixtureIds?.includes(fixtureId)) return false;
    if (JSON.stringify(current.refereeAssignmentsByFixture?.[fixtureId] ?? []) !== baseSignature) { onNotice?.("Phân công vừa được cập nhật ở tab khác. Hãy tải lại trận trước khi ghi đè bản mới hơn."); return false; }
    const currentResources = current.refereeResources ?? refereeResources;
    const currentScheduleResources = current.resources ?? resources;
    const scheduleEntries = isSchedulePublished ? current.publishedScheduleByFixture ?? current.scheduleByFixture : current.scheduleByFixture;
    const schedule = scheduleEntries[fixtureId];
    if (!schedule?.scheduledAt || !schedule.venue) { onNotice?.("Chưa thể lưu: trận chưa có ngày, giờ và sân."); return false; }
    const stageLabel = fixture.stage === "GROUP" ? "Vòng bảng" : "Knockout";
    const requirement = currentResources.matchRequirements[fixture.id] ?? currentResources.matchRequirements[fixture.groupName ? `${stageLabel} · ${fixture.groupName}` : ""] ?? currentResources.matchRequirements[stageLabel] ?? currentResources.matchRequirements[fixture.stage];
    const modelPositions = currentResources.models.find((item) => item.id === requirement?.positionModelId)?.positions ?? currentResources.models.find((item) => item.isDefault)?.positions ?? [];
    const profiles = new Map(currentResources.referees.map((referee) => [referee.id, referee]));
    const currentAssignments = current.refereeAssignmentsByFixture ?? {};
    const assignedIds = rows.map((row) => row.refereeId).filter((id): id is string => Boolean(id));
    if (new Set(assignedIds).size !== assignedIds.length) { onNotice?.("Một trọng tài không thể giữ nhiều vị trí trong cùng trận."); return false; }
    const lockedSlots = new Set(current.lockedRefereeSlotKeysByFixture?.[fixtureId] ?? []);
    for (const row of rows) {
      const key = `${row.positionId}:${row.slotIndex ?? 0}`;
      const previous = (currentAssignments[fixtureId] ?? []).find((item) => item.positionId === row.positionId && (item.slotIndex ?? 0) === (row.slotIndex ?? 0));
      if (lockedSlots.has(key) && previous?.refereeId !== row.refereeId) { onNotice?.("Có vị trí đã khóa; hãy mở khóa trước khi thay đổi."); return false; }
      if (!row.refereeId) {
        if (row.refereeName.trim()) { onNotice?.("Hãy chọn trọng tài từ hồ sơ nguồn lực để hệ thống kiểm tra chuyên môn và khả dụng."); return false; }
        continue;
      }
      const referee = profiles.get(row.refereeId);
      const position = modelPositions.find((item) => item.id === row.positionId);
      if (!referee || !position) { onNotice?.("Hồ sơ trọng tài hoặc mô hình vị trí đã thay đổi. Hãy tải lại nguồn lực."); return false; }
      const affiliationsByTeamId: Record<string, RefereeTeamAffiliation> = Object.fromEntries([fixture.homeTeamId, fixture.awayTeamId].filter((id): id is string => Boolean(id)).map((id) => {
        const team = teams.find((item) => item.teamId === id);
        return [id, { club: team?.name, school: team?.institutionName ?? undefined, unit: team?.institutionName ?? undefined }];
      }));
      const existingDuties: RefereeDuty[] = fixtures.flatMap((other) => {
        if (other.id === fixtureId) return [];
        const otherSchedule = scheduleEntries[other.id];
        if (!otherSchedule?.scheduledAt) return [];
        const assignedRows = current.refereePublishedFixtureIds?.includes(other.id) ? current.publishedRefereeAssignmentsByFixture?.[other.id] ?? [] : currentAssignments[other.id] ?? [];
        if (!assignedRows.some((item) => item.refereeId === referee.id || (!item.refereeId && item.refereeName.trim().toLocaleLowerCase("vi") === referee.displayName.trim().toLocaleLowerCase("vi")))) return [];
        const timing = other.stage === "GROUP" ? currentScheduleResources.groupTiming : currentScheduleResources.knockoutTiming;
        const start = new Date(otherSchedule.scheduledAt).getTime() - timing.preparationBeforeMinutes * 60_000;
        const end = new Date(otherSchedule.scheduledAt).getTime() + (timing.halfMinutes * 2 + timing.halftimeBreakMinutes + timing.extraTimeReserveMinutes + timing.penaltyReserveMinutes + timing.transitionAfterMinutes) * 60_000;
        const venue = currentScheduleResources.venues.find((item) => item.code === otherSchedule.venue || item.name === otherSchedule.venue);
        return [{ fixtureId: other.id, refereeId: referee.id, startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString(), location: venue?.travelZone ?? venue?.location ?? otherSchedule.venue, teamIds: [other.homeTeamId, other.awayTeamId].filter((id): id is string => Boolean(id)) }];
      });
      const validation = validateRefereeAssignment({ referee, position, fixture, schedule, resources: currentScheduleResources, roster: currentResources, format: footballFormat, affiliationsByTeamId, existingDuties });
      const blocking = validation.filter((issue) => issue.severity === "BLOCK");
      if (blocking.length) { onNotice?.(`Không lưu được ${referee.displayName}: ${blocking[0].message}`); return false; }
      const unknownOpponentNeedsCheck = currentResources.neutralRules.some((rule) => rule.mandatory) && ((!fixture.homeTeamId && Boolean(fixture.homeSource)) || (!fixture.awayTeamId && Boolean(fixture.awaySource)));
      row.validationStatus = unknownOpponentNeedsCheck ? "NEEDS_RECHECK" : "VALID";
      row.validationMessages = unknownOpponentNeedsCheck ? ["Nguồn đội chưa xác định; cần kiểm tra trung lập khi có đội thực tế."] : validation.filter((issue) => issue.severity === "WARNING").map((issue) => issue.message);
      row.eligibilityConfirmed = true;
      row.availabilityConfirmed = true;
    }
    const nextAssignments = { ...currentAssignments, [fixtureId]: rows.map((row) => ({ ...row })) };
    const persistedRows = rows.map((row) => ({ ...row }));
    nextAssignments[fixtureId] = persistedRows;
    writeDrawTestState(tournamentId, { step5: { ...current, refereeAssignmentsByFixture: nextAssignments, refereeDraftScheduleSignature: refereeScheduleSignature(current.scheduleByFixture), refereeDraftResourceSignature: JSON.stringify(currentResources) } });
    onNotice?.("Đã lưu phân công trọng tài nháp trên trình duyệt; các vị trí còn thiếu chưa được công bố.");
    return JSON.stringify(persistedRows);
  }

  async function deleteRefereeFixtureDraft(fixtureId: string, baseSignature: string): Promise<boolean> {
    const current = readDrawTestState(tournamentId).step5;
    if (!current || current.refereePublishedFixtureIds?.includes(fixtureId) || current.refereeLockedFixtureIds?.includes(fixtureId)) return false;
    const rows = current.refereeAssignmentsByFixture?.[fixtureId] ?? [];
    if (JSON.stringify(rows) !== baseSignature) { onNotice?.("Phân công vừa được cập nhật ở tab khác. Không xóa bản mới hơn; hãy tải lại trận."); return false; }
    if (rows.some((row) => row.locked) || (current.lockedRefereeSlotKeysByFixture?.[fixtureId]?.length ?? 0)) { onNotice?.("Mở khóa các vị trí trước khi xóa bản nháp."); return false; }
    if (!rows.length || !await confirm({ title: "Xóa phân công nháp?", description: `Xóa các vị trí trọng tài nháp của trận ${fixtureId}. Lịch thi đấu và phân công đã công bố không thay đổi.`, confirmLabel: "Xóa bản nháp", danger: true })) return false;
    const next = { ...(current.refereeAssignmentsByFixture ?? {}) }; delete next[fixtureId];
    writeDrawTestState(tournamentId, { step5: { ...current, refereeAssignmentsByFixture: next } });
    onNotice?.("Đã xóa phân công nháp của trận.");
    return true;
  }

  function toggleRefereeSlotLock(fixtureId: string, key: string) {
    const current = readDrawTestState(tournamentId).step5;
    if (!current || current.refereePublishedFixtureIds?.includes(fixtureId) || current.refereeLockedFixtureIds?.includes(fixtureId)) return;
    const all = { ...(current.lockedRefereeSlotKeysByFixture ?? {}) };
    const keys = all[fixtureId] ?? [];
    all[fixtureId] = keys.includes(key) ? keys.filter((item) => item !== key) : [...keys, key];
    writeDrawTestState(tournamentId, { step5: { ...current, lockedRefereeSlotKeysByFixture: all } });
  }

  function toggleRefereeMatchLock(fixtureId: string) {
    const current = readDrawTestState(tournamentId).step5;
    if (!current || current.refereePublishedFixtureIds?.includes(fixtureId)) return;
    const ids = new Set(current.refereeLockedFixtureIds ?? []);
    if (ids.has(fixtureId)) ids.delete(fixtureId); else ids.add(fixtureId);
    writeDrawTestState(tournamentId, { step5: { ...current, refereeLockedFixtureIds: [...ids] } });
  }

  function saveRefereeResources(nextResources: DemoRefereeResourceState) {
    const latest = readDrawTestState(tournamentId); const current = latest.step5;
    if (!current || current.diagramSnapshotKey !== snapshotKey) return;
    const defaultModel = nextResources.models.find((model) => model.isDefault);
    const mappedPositions = defaultModel?.positions.map((position) => ({ id: position.id, label: position.label }));
    writeDrawTestState(tournamentId, { step5: {
      ...current,
      refereeResources: nextResources,
      ...(mappedPositions?.length ? { refereePositions: mappedPositions } : {}),
    } });
  }

  function toggleRefereeRound(round: string) {
    const latest = readDrawTestState(tournamentId); const current = latest.step5;
    if (!current || current.diagramSnapshotKey !== snapshotKey) return;
    const selected = current.refereeScopeRounds ?? [];
    const next = selected.includes(round) ? selected.filter((item) => item !== round) : [...selected, round];
    writeDrawTestState(tournamentId, { step5: { ...current, refereeScopeRounds: next } });
  }

  function effectiveAutoRefereeConfiguration(configuration: AutoRefereeConfiguration): AutoRefereeConfiguration {
    if (step5.refereePolicy?.mode === "WHOLE_TOURNAMENT") return configuration;
    const intersect = (selected: string[], allowed: string[]) => {
      const withinPolicy = selected.length ? selected.filter((item) => allowed.includes(item)) : allowed;
      return withinPolicy;
    };
    return {
      ...configuration,
      rounds: intersect(configuration.rounds, refereeScopeRounds),
      groups: refereeScopeGroups.length ? intersect(configuration.groups, refereeScopeGroups) : configuration.groups,
      dates: refereeScopeDates.length ? intersect(configuration.dates, refereeScopeDates) : configuration.dates,
    };
  }

  async function runAutomaticRefereeAssignment(configuration: AutoRefereeConfiguration): Promise<AutoRefereePreview | null> {
    if (autoRefereeRunning) return null;
    if (step5.refereePolicy?.mode !== "WHOLE_TOURNAMENT" && !isSchedulePublished) {
      setAutoRefereeError("Chính sách theo vòng/đợt chỉ cho phân công sau khi lịch thi đấu được công bố.");
      return null;
    }
    const effectiveConfiguration = effectiveAutoRefereeConfiguration(configuration);
    if (step5.refereePolicy?.mode !== "WHOLE_TOURNAMENT" && !effectiveConfiguration.rounds.length) {
      setAutoRefereeError("Chọn ít nhất một vòng trong phạm vi chính sách phân công hiện tại.");
      return null;
    }
    setAutoRefereeError("");
    setAutoRefereeRunning(true);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    try {
      const latest = readDrawTestState(tournamentId);
      if (demoDiagramSnapshotKey(latest) !== snapshotKey || latest.step5?.diagramSnapshotKey !== snapshotKey) {
        setAutoRefereeError("Phiên bản sơ đồ đã thay đổi. Tải lại Bước 5 trước khi tạo đề xuất.");
        return null;
      }
      const input = makeAutoRefereeInput(latest, effectiveConfiguration);
      const response = await apiFetch<{ tournamentId: string; diagramVersion: string; plan: AutoRefereePreview }>("/schedules/engine/test/referee-preview", {
        method: "POST",
        body: JSON.stringify({ tournamentId, diagramVersion: snapshotKey, input }),
      });
      if (response.tournamentId !== tournamentId || response.diagramVersion !== snapshotKey) throw new Error("Phản hồi phân công thuộc phiên bản sơ đồ khác.");
      const result = response.plan;
      const newest = readDrawTestState(tournamentId);
      const newestInput = makeAutoRefereeInput(newest, effectiveConfiguration);
      if (automaticRefereeBaseSignature(newestInput) !== result.baseSignature) {
        setAutoRefereeError("Lịch, nguồn lực hoặc phân công vừa đổi trong lúc tính. Đề xuất cũ đã bị hủy.");
        return null;
      }
      if (result.status === "NO_TARGETS") setAutoRefereeError(result.warnings[0] ?? "Không tìm thấy trận phù hợp.");
      onNotice?.(result.status === "COMPLETE" ? `Đã tìm được phương án cho ${result.changedFixtureIds.length} trận trong ${result.elapsedMs} ms; chưa áp dụng hoặc công bố.` : `Đã tạo đề xuất một phần cho ${result.changedFixtureIds.length} trận, còn thiếu ${result.missing.length} vị trí.`);
      return result;
    } catch (error) {
      setAutoRefereeError(error instanceof Error ? error.message : "Không thể tạo đề xuất phân công trọng tài.");
      return null;
    } finally {
      setAutoRefereeRunning(false);
    }
  }

  async function applyAutomaticRefereeAssignment(preview: AutoRefereePreview, configuration: AutoRefereeConfiguration): Promise<boolean> {
    const effectiveConfiguration = effectiveAutoRefereeConfiguration(configuration);
    return withLocalScheduleLock(async () => {
      const latest = readDrawTestState(tournamentId);
      const current = latest.step5;
      if (!current || demoDiagramSnapshotKey(latest) !== snapshotKey || current.diagramSnapshotKey !== snapshotKey) return false;
      const latestInput = makeAutoRefereeInput(latest, effectiveConfiguration);
      if (automaticRefereeBaseSignature(latestInput) !== preview.baseSignature) {
        onNotice?.("Lịch, nguồn lực hoặc bản phân công đã đổi. Hãy chạy lại trước khi áp dụng.");
        return false;
      }
      const freshPlan = await runAutoRefereePlanner(latestInput);
      const finalState = readDrawTestState(tournamentId);
      const finalStep5 = finalState.step5;
      if (!finalStep5 || demoDiagramSnapshotKey(finalState) !== snapshotKey || finalStep5.diagramSnapshotKey !== snapshotKey
        || automaticRefereeBaseSignature(makeAutoRefereeInput(finalState, effectiveConfiguration)) !== preview.baseSignature
        || freshPlan.baseSignature !== preview.baseSignature) {
        onNotice?.("Dữ liệu vừa thay đổi trong lúc xác minh đề xuất. Không có phân công nào được áp dụng.");
        return false;
      }
      const currentMap = finalStep5.refereeAssignmentsByFixture ?? {};
      const nextMap = { ...currentMap };
      for (const fixtureId of freshPlan.changedFixtureIds) {
        if (finalStep5.refereePublishedFixtureIds?.includes(fixtureId) || finalStep5.refereeLockedFixtureIds?.includes(fixtureId)) continue;
        const previous = currentMap[fixtureId] ?? [];
        const lockedSlots = new Set(finalStep5.lockedRefereeSlotKeysByFixture?.[fixtureId] ?? []);
        const proposed = freshPlan.proposedAssignmentsByFixture[fixtureId] ?? [];
        const preserved = previous.filter((row) => row.locked || lockedSlots.has(`${row.positionId}:${row.slotIndex ?? 0}`));
        const replacement = proposed.filter((row) => !lockedSlots.has(`${row.positionId}:${row.slotIndex ?? 0}`) && !row.locked);
        const combined = [...preserved, ...replacement];
        if (new Set(combined.map((row) => row.refereeId).filter(Boolean)).size !== combined.filter((row) => row.refereeId).length) {
          onNotice?.(`${fixtureId}: đề xuất có trọng tài trùng nhiều vị trí; không áp dụng.`);
          return false;
        }
        nextMap[fixtureId] = combined;
      }
      writeDrawTestState(tournamentId, { step5: {
        ...finalStep5,
        refereeAssignmentsByFixture: nextMap,
        refereeDraftScheduleSignature: refereeScheduleSignature(finalStep5.scheduleByFixture),
        refereeDraftResourceSignature: JSON.stringify(finalStep5.refereeResources ?? refereeResources),
      } });
      onNotice?.(`Đã áp dụng đề xuất cho ${freshPlan.changedFixtureIds.length} trận vào bản phân công nháp trên trình duyệt. Chưa công bố.`);
      return true;
    });
  }

  async function publishReferees() {
    if (!isSchedulePublished || !refereeReady) return;
    const latest = readDrawTestState(tournamentId); const current = latest.step5;
    if (!current || current.diagramSnapshotKey !== snapshotKey || !(current.schedulePublishedAt || current.publishedAt)) { onNotice?.("Trước hết cần công bố lịch thi đấu chính thức."); return; }
    const targetIds = refereeTargetFixtures.map((fixture) => fixture.id).filter((fixtureId) => !refereePublishedIds.has(fixtureId));
    if (!targetIds.length) { onNotice?.("Phạm vi này đã được công bố đầy đủ."); return; }
    if (current.refereeDraftScheduleSignature && current.refereeDraftScheduleSignature !== refereeScheduleSignature(current.scheduleByFixture)) { onNotice?.("Lịch đã thay đổi sau khi lập phân công. Hãy xác minh lại trước khi công bố."); return; }
    if (!await confirm({ title: "Công bố phân công trọng tài?", description: `Công bố ${targetIds.length} trận theo chính sách ${current.refereePolicy?.mode === "WHOLE_TOURNAMENT" ? "toàn giải" : "theo vòng/đợt"}. Chỉ các vị trí bắt buộc đã xác minh mới được công bố.`, confirmLabel: "Công bố phân công" })) return;
    const newest = readDrawTestState(tournamentId); const newestStep5 = newest.step5;
    if (demoDiagramSnapshotKey(newest) !== snapshotKey || !newestStep5 || newestStep5.diagramSnapshotKey !== snapshotKey || newestStep5.refereeDraftScheduleSignature !== current.refereeDraftScheduleSignature || newestStep5.refereeDraftResourceSignature !== current.refereeDraftResourceSignature || JSON.stringify(newestStep5.refereeResources ?? {}) !== JSON.stringify(current.refereeResources ?? {}) || targetIds.some((fixtureId) => JSON.stringify(newestStep5.refereeAssignmentsByFixture?.[fixtureId] ?? []) !== JSON.stringify(current.refereeAssignmentsByFixture?.[fixtureId] ?? [])) || targetIds.some((fixtureId) => newestStep5.refereePublishedFixtureIds?.includes(fixtureId))) { onNotice?.("Dữ liệu lịch, nguồn lực hoặc phân công vừa đổi ở tab khác. Hãy kiểm tra lại trước khi công bố."); return; }
    const at = new Date().toISOString();
    const publishedMap = { ...(newestStep5.publishedRefereeAssignmentsByFixture ?? {}) };
    for (const fixtureId of targetIds) publishedMap[fixtureId] = (newestStep5.refereeAssignmentsByFixture?.[fixtureId] ?? []).map((row) => ({ ...row }));
    const publishedIds = [...new Set([...(newestStep5.refereePublishedFixtureIds ?? []), ...targetIds])];
    writeDrawTestState(tournamentId, { step5: { ...newestStep5, publishedRefereeAssignmentsByFixture: publishedMap, refereePublishedFixtureIds: publishedIds, refereeAssignmentsPublishedAt: at, refereeAssignmentsPublishedBy: operatorName?.trim() || "BTC · chế độ kiểm thử" } });
    onNotice?.(`Đã công bố phân công trọng tài cho ${targetIds.length} trận. Lịch thi đấu chính thức không thay đổi.`);
  }

  function verifyRefereeDraft() {
    const latest = readDrawTestState(tournamentId); const current = latest.step5;
    if (!current || current.diagramSnapshotKey !== snapshotKey) return;
    const roster = current.refereeResources ?? refereeResources;
    const currentResources = current.resources ?? resources;
    const entries = current.schedulePublishedAt ? current.publishedScheduleByFixture ?? current.scheduleByFixture : current.scheduleByFixture;
    const assignmentMap = { ...(current.refereeAssignmentsByFixture ?? {}) };
    for (const fixture of refereeTargetFixtures) {
      const schedule = entries[fixture.id];
      if (!schedule?.scheduledAt || !schedule.venue) continue;
      const stageLabel = fixture.stage === "GROUP" ? "Vòng bảng" : "Knockout";
      const requirement = roster.matchRequirements[fixture.id] ?? roster.matchRequirements[fixture.groupName ? `${stageLabel} · ${fixture.groupName}` : ""] ?? roster.matchRequirements[stageLabel] ?? roster.matchRequirements[fixture.stage];
      const positions = roster.models.find((item) => item.id === requirement?.positionModelId)?.positions ?? roster.models.find((item) => item.isDefault)?.positions ?? [];
      const rows = [...(assignmentMap[fixture.id] ?? [])];
      for (const row of rows) {
        if (!row.refereeId) { if (row.refereeName.trim()) { onNotice?.(`${fixture.id}: chọn lại trọng tài từ hồ sơ nguồn lực để xác minh.`); return; } continue; }
        const referee = roster.referees.find((item) => item.id === row.refereeId);
        const position = positions.find((item) => item.id === row.positionId);
        if (!referee || !position) { onNotice?.(`${fixture.id}: hồ sơ trọng tài hoặc mô hình vị trí không còn hợp lệ.`); return; }
        const affiliationsByTeamId: Record<string, RefereeTeamAffiliation> = Object.fromEntries([fixture.homeTeamId, fixture.awayTeamId].filter((id): id is string => Boolean(id)).map((id) => { const team = teams.find((item) => item.teamId === id); return [id, { club: team?.name, school: team?.institutionName ?? undefined, unit: team?.institutionName ?? undefined }]; }));
        const existingDuties: RefereeDuty[] = fixtures.flatMap((other) => {
          if (other.id === fixture.id) return [];
          const otherSchedule = entries[other.id]; if (!otherSchedule?.scheduledAt) return [];
          const otherRows = current.refereePublishedFixtureIds?.includes(other.id) ? current.publishedRefereeAssignmentsByFixture?.[other.id] ?? [] : assignmentMap[other.id] ?? [];
          if (!otherRows.some((item) => item.refereeId === referee.id)) return [];
          const timing = other.stage === "GROUP" ? currentResources.groupTiming : currentResources.knockoutTiming;
          const start = new Date(otherSchedule.scheduledAt).getTime() - timing.preparationBeforeMinutes * 60_000;
          const end = new Date(otherSchedule.scheduledAt).getTime() + (timing.halfMinutes * 2 + timing.halftimeBreakMinutes + timing.extraTimeReserveMinutes + timing.penaltyReserveMinutes + timing.transitionAfterMinutes) * 60_000;
          const venue = currentResources.venues.find((item) => item.code === otherSchedule.venue || item.name === otherSchedule.venue);
          return [{ fixtureId: other.id, refereeId: referee.id, startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString(), location: venue?.travelZone ?? venue?.location ?? otherSchedule.venue, teamIds: [other.homeTeamId, other.awayTeamId].filter((id): id is string => Boolean(id)) }];
        });
        const issues = validateRefereeAssignment({ referee, position, fixture, schedule, resources: currentResources, roster, format: footballFormat, affiliationsByTeamId, existingDuties });
        const blocking = issues.find((issue) => issue.severity === "BLOCK");
        if (blocking) { onNotice?.(`${fixture.id} · ${referee.displayName}: ${blocking.message}`); return; }
        const unresolvedNeutrality = roster.neutralRules.some((rule) => rule.mandatory) && ((!fixture.homeTeamId && Boolean(fixture.homeSource)) || (!fixture.awayTeamId && Boolean(fixture.awaySource)));
        row.validationStatus = unresolvedNeutrality ? "NEEDS_RECHECK" : "VALID";
        row.validationMessages = unresolvedNeutrality ? ["Nguồn đội chưa xác định; cần kiểm tra trung lập khi có đội thực tế."] : issues.filter((issue) => issue.severity === "WARNING").map((issue) => issue.message);
        row.eligibilityConfirmed = true; row.availabilityConfirmed = true;
      }
      assignmentMap[fixture.id] = rows;
    }
    writeDrawTestState(tournamentId, { step5: { ...current, refereeAssignmentsByFixture: assignmentMap, refereeDraftScheduleSignature: refereeScheduleSignature(current.scheduleByFixture), refereeDraftResourceSignature: JSON.stringify(roster) } });
    onNotice?.("Đã chạy lại bộ kiểm tra theo lịch, nguồn lực, khung giờ và trung lập. Trận còn nguồn đội chưa xác định vẫn cần xác minh trước khi công bố.");
  }
  const selectedTitle = useMemo(() => {
    if (!selectedFixture) return "Chọn một trận trên sơ đồ";
    const round = selectedFixture.groupName && selectedFixture.round.toLocaleLowerCase("vi").startsWith(selectedFixture.groupName.toLocaleLowerCase("vi"))
      ? selectedFixture.round.slice(selectedFixture.groupName.length).replace(/^[\s·—-]+/, "")
      : selectedFixture.round;
    return `${selectedFixture.id}${selectedFixture.groupName ? ` · ${selectedFixture.groupName}` : ""} · ${round}${selectedFixture.leg ? ` · Lượt ${selectedFixture.leg}` : ""}`;
  }, [selectedFixture]);
  const selectedVenue = activeVenues.find((venue) => venue.code === currentEntry?.venue || venue.name === currentEntry?.venue);
  const teamNames = new Map(teams.map((team) => [team.teamId, team.name]));
  const scheduleViewFixtures = fixtures.filter((fixture) => {
    const entry = visibleEntries[fixture.id] ?? step5.scheduleByFixture[fixture.id] ?? emptyEntry();
    const entryDate = entry.scheduledAt?.slice(0, 10) ?? "";
    const display = scheduleDisplayByFixture[fixture.id];
    const group = fixture.groupName ?? "Knockout";
    const searchText = [fixture.id, fixture.round, fixture.groupName, fixture.homeSource, fixture.awaySource,
      teamNames.get(fixture.homeTeamId ?? ""), teamNames.get(fixture.awayTeamId ?? ""), entry.venue].join(" ").toLocaleLowerCase("vi");
    const status = display?.status ?? (entry.locked ? "LOCKED" : entry.scheduledAt && entry.venue ? "SCHEDULED" : "UNSCHEDULED");
    return (!viewQuery.trim() || searchText.includes(viewQuery.trim().toLocaleLowerCase("vi")))
      && (viewStage === "ALL" || fixture.stage === viewStage)
      && (viewGroup === "ALL" || group === viewGroup)
      && (viewRound === "ALL" || fixture.round === viewRound)
      && (!viewDateFrom || (entryDate && entryDate >= viewDateFrom))
      && (!viewDateTo || (entryDate && entryDate <= viewDateTo))
      && (viewVenue === "ALL" || display?.venueName === viewVenue)
      && (viewStatus === "ALL" || status === viewStatus);
  });
  const scheduleViewFixtureIdSet = new Set(scheduleViewFixtures.map((fixture) => fixture.id));
  const scheduleGroups = [...new Set(fixtures.map((fixture) => fixture.groupName ?? "Knockout"))].sort();
  const scheduleRounds = [...new Set(fixtures.map((fixture) => fixture.round))].sort((a, b) => a.localeCompare(b, "vi", { numeric: true }));
  const scheduleVenues = [...new Set(activeVenues.map((venue) => venue.name))].sort();
  const activeFilterCount = [viewStage !== "ALL", viewGroup !== "ALL", viewRound !== "ALL", Boolean(viewDateFrom), Boolean(viewDateTo), viewVenue !== "ALL", viewStatus !== "ALL"].filter(Boolean).length;
  const calendarEntries = scheduleViewFixtures.filter((fixture) => Boolean((visibleEntries[fixture.id] ?? step5.scheduleByFixture[fixture.id])?.scheduledAt));
  const calendarDays = [...new Set(calendarEntries.map((fixture) => (visibleEntries[fixture.id] ?? step5.scheduleByFixture[fixture.id]).scheduledAt.slice(0, 10)))].sort();
  const calendarVenues = [...new Set(calendarEntries.map((fixture) => scheduleDisplayByFixture[fixture.id]?.venueName ?? (visibleEntries[fixture.id] ?? step5.scheduleByFixture[fixture.id]).venue))].sort();
  const calendarBaseDate = calendarAnchorDate || calendarDays[0] || resources.competitionStartDate || new Date().toLocaleDateString("sv-SE");
  const calendarWeek = (() => {
    const base = new Date(`${calendarBaseDate}T12:00:00`);
    const mondayOffset = (base.getDay() + 6) % 7;
    base.setDate(base.getDate() - mondayOffset);
    return Array.from({ length: 7 }, (_, index) => {
      const day = new Date(base);
      day.setDate(base.getDate() + index);
      return day.toLocaleDateString("sv-SE");
    });
  })();
  const calendarRenderDays = calendarMode === "DAY" ? [calendarBaseDate] : calendarWeek;
  const venuesByLocation = [...new Set(activeVenues.map((venue) => venue.location.trim() || "Địa điểm chưa khai báo"))]
    .sort((a, b) => a.localeCompare(b, "vi"))
    .map((location) => ({ location, venues: activeVenues.filter((venue) => (venue.location.trim() || "Địa điểm chưa khai báo") === location) }));
  const occupiedTimelinePosition = (fixture: DemoFixture) => {
    const entry = visibleEntries[fixture.id] ?? step5.scheduleByFixture[fixture.id];
    const venue = resources.venues.find((item) => item.name === entry?.venue || item.code === entry?.venue);
    const occupied = venueOccupiedMinutes(fixture, venue ?? { turnaroundMinutes: 0 } as DemoScheduleResources["venues"][number], resources);
    const start = entry?.scheduledAt ? new Date(entry.scheduledAt) : null;
    const startMinutes = start ? start.getHours() * 60 + start.getMinutes() : 0;
    const profile = fixture.stage === "GROUP" ? resources.groupTiming : resources.knockoutTiming;
    const occupiedStart = startMinutes - profile.preparationBeforeMinutes;
    const transition = profile.transitionAfterMinutes + (venue?.turnaroundMinutes ?? 0);
    const timelineMinutes = 16 * 60;
    return {
      occupied,
      left: Math.max(0, Math.min(100, ((occupiedStart - 6 * 60) / timelineMinutes) * 100)),
      width: Math.max(1.5, Math.min(100, (occupied / timelineMinutes) * 100)),
      preparationWidth: Math.max(0, (profile.preparationBeforeMinutes / timelineMinutes) * 100),
      playWidth: Math.max(0, (matchPlayDuration(fixture) / timelineMinutes) * 100),
      transitionWidth: Math.max(0, (transition / timelineMinutes) * 100),
    };
  };
  const visibleTabs: Tab[] = mode === "schedule" ? ["schedule", "review"] : ["referees"];

  function renderStep5Workspace() {
    const selectedVisibleCount = scheduleViewFixtures.filter((fixture) => selectedFixtureIds.includes(fixture.id)).length;
    const allVisibleSelected = scheduleViewFixtures.length > 0 && selectedVisibleCount === scheduleViewFixtures.length;
    const autoScheduleBlocker = staleStep5Snapshot ? "Sơ đồ Bước 4 đã đổi phiên bản. Snapshot lịch cũ được giữ nguyên; hãy khôi phục đúng sơ đồ trước khi chỉnh hoặc chạy thuật toán."
      : !formatMatchesDiagram ? formatMismatchText
      : !usableVenues.length ? `Chưa có sân ${footballFormat} người xác nhận khả dụng trong ngày và khung giờ của giải.`
        : configurationIssues.length ? `Trước tiên, xử lý: ${configurationIssues[0]}` : "";
    const resetFilters = () => { setViewQuery(""); setViewStage("ALL"); setViewGroup("ALL"); setViewRound("ALL"); setViewDateFrom(""); setViewDateTo(""); setViewVenue("ALL"); setViewStatus("ALL"); };
    const roundTitle = (round: string) => {
      const normalized = round.trim().toLocaleLowerCase("vi");
      if (/\b(r32|vòng 32|round of 32)\b/.test(normalized)) return "R32";
      if (/\b(r16|vòng 16|round of 16)\b/.test(normalized)) return "R16";
      if (/\b(quarter.?final|tứ kết)\b/.test(normalized)) return "Tứ kết";
      if (/\b(semi.?final|bán kết)\b/.test(normalized)) return "Bán kết";
      if (/\b(final|chung kết)\b/.test(normalized)) return "Chung kết";
      return round;
    };
    const scheduleViewGroups = (() => {
      const groups = new Map<string, { title: string; fixtures: DemoFixture[]; phaseOrder: number }>();
      for (const fixture of scheduleViewFixtures) {
        const rawRound = roundTitle(fixture.round);
        const round = fixture.stage === "GROUP" && /^\d+$/.test(rawRound.trim()) ? `Vòng ${rawRound}` : rawRound;
        const groupName = fixture.groupName?.trim();
        const groupLabel = groupName ? (/^bảng\s/i.test(groupName) ? groupName : `Bảng ${groupName}`) : "Không chia bảng";
        const roundPart = groupName && round.toLocaleLowerCase("vi").startsWith(groupName.toLocaleLowerCase("vi")) ? round.slice(groupName.length).replace(/^[\s·—-]+/, "") : round;
        const phaseOrder = fixture.stage === "GROUP" ? 0 : 1;
        const title = competitionFormat === "ROUND_ROBIN"
          ? (groupName ? `${groupLabel} · ${roundPart}` : round)
          : fixture.stage === "GROUP" ? `Vòng bảng · ${groupLabel} · ${roundPart}` : `Knockout · ${round}`;
        const key = `${phaseOrder}|${title}`;
        const group = groups.get(key) ?? { title, fixtures: [], phaseOrder };
        group.fixtures.push(fixture);
        groups.set(key, group);
      }
      return [...groups.entries()].sort(([leftKey, left], [rightKey, right]) => left.phaseOrder - right.phaseOrder || leftKey.localeCompare(rightKey, "vi", { numeric: true })).map(([key, group]) => ({ key, ...group }));
    })();
    const renderFixtureRow = (fixture: DemoFixture) => {
      const entry = visibleEntries[fixture.id] ?? step5.scheduleByFixture[fixture.id] ?? emptyEntry();
      const status = entryStatus(fixture);
      const issueCount = scheduleIssuesByFixture[fixture.id]?.length ?? 0;
      const isEditingSelection = selectedDraftIsDirty && selectedFixture?.id === fixture.id;
      const normalizedRound = roundTitle(fixture.round);
      const displayRound = fixture.groupName && normalizedRound.toLocaleLowerCase("vi").startsWith(fixture.groupName.toLocaleLowerCase("vi")) ? normalizedRound.slice(fixture.groupName.length).replace(/^[\s·—-]+/, "") : normalizedRound;
      return <tr key={fixture.id} className={`${simulatedFixtureIds.includes(fixture.id) ? "is-simulated" : ""}${issueCount ? " has-schedule-error" : ""}${selectedFixture?.id === fixture.id ? " is-selected" : ""}${isEditingSelection ? " is-editing" : ""}`}>
        <td><input type="checkbox" disabled={mode === "schedule" && activeStage === 4} checked={selectedFixtureIds.includes(fixture.id)} aria-label={`Chọn ${fixture.id}`} onChange={() => toggleFixtureSelection(fixture.id)} /></td>
        <td><button className="step5-list-match-link" type="button" onClick={() => selectFixture(fixture)}>{issueCount ? <span className="step5-ws-error-icon" aria-label={`${issueCount} vấn đề lịch`}>!</span> : null}{fixture.id}</button></td>
        <td>{teamNames.get(fixture.homeTeamId ?? "") ?? fixture.homeSource ?? "Chờ xác định"}<b> vs </b>{teamNames.get(fixture.awayTeamId ?? "") ?? fixture.awaySource ?? "Chờ xác định"}</td>
        <td>{phaseLabel(fixture)}{fixture.groupName ? ` · ${fixture.groupName}` : ""}<small>{displayRound}{fixture.leg ? ` · Lượt ${fixture.leg}` : ""}</small></td>
        <td>{entry.scheduledAt ? new Date(entry.scheduledAt).toLocaleDateString("vi-VN") : "—"}</td>
        <td>{entry.scheduledAt ? `${timeLabel(entry.scheduledAt)}–${timeLabel(new Date(new Date(entry.scheduledAt).getTime() + matchPlayDuration(fixture) * 60000).toISOString())}` : "—"}</td>
        <td>{entry.venue ? venueName(fixture.id, entry) : "—"}</td>
        <td><span className={`step5-ws-status ${isEditingSelection ? "is-editing" : status === "LOCKED" ? "is-locked" : status === "PROPOSED" ? "is-proposed" : status === "SCHEDULED" ? "is-scheduled" : "is-missing"}`}>{isEditingSelection ? "🟠 Đang điều chỉnh · chưa lưu" : statusText(status)}</span>{issueCount ? <small className="step5-ws-error-label">⚠ {issueCount} vấn đề</small> : null}</td>
        <td>{mode === "schedule" && activeStage === 4 ? <button type="button" className="text-button" onClick={() => selectFixture(fixture)}>Xem chi tiết</button> : <button type="button" className="text-button" onClick={() => selectFixture(fixture)}>Chọn trận</button>}</td>
      </tr>;
    };
    const chooseIssue = (fixtureId: string) => {
      if (fixtureId) {
        const found = fixtures.find((fixture) => fixture.id === fixtureId);
        if (found) { setActiveStage(mode === "schedule" ? 3 : 4); setScheduleView("LIST"); setViewStatus("ALL"); setMethod("MANUAL"); selectFixture(found); }
      } else setSettingsSection("conditions");
    };
    const phaseLabel = (fixture: DemoFixture) => fixture.stage === "GROUP" ? "Vòng bảng" : "Loại trực tiếp";
    const entryStatus = (fixture: DemoFixture) => scheduleDisplayByFixture[fixture.id]?.status ?? (visibleEntries[fixture.id]?.locked ? "LOCKED" : visibleEntries[fixture.id]?.scheduledAt && visibleEntries[fixture.id]?.venue ? (mode === "schedule" && activeStage === 3 && simulatedFixtureIds.includes(fixture.id) ? "PROPOSED" : "SCHEDULED") : "UNSCHEDULED");
    const statusText = (status: string) => status === "LOCKED" ? isPublished ? "📣 Đã công bố · 🔒 Đã khóa" : "🔒 Đã khóa" : status === "SCHEDULED" ? isPublished ? "📣 Đã công bố · chưa khóa" : "Đã xếp · chưa khóa" : status === "PROPOSED" ? "🟠 Phương án · chưa lưu" : "🔴 Chưa xếp lịch";
    const venueName = (fixtureId: string, entry: DemoScheduleEntry) => scheduleDisplayByFixture[fixtureId]?.venueName ?? resources.venues.find((venue) => venue.code === entry.venue || venue.name === entry.venue)?.name ?? entry.venue;
    const closeFixtureDrawer = () => setSelectedFixture(null);
    const recommendedCandidate = candidates[0] ?? null;
    const alternativeCandidates = candidates.filter((candidate, index) => index > 0 && (candidate.date !== recommendedCandidate?.date || candidate.venue.id !== recommendedCandidate?.venue.id || candidate.slotId !== recommendedCandidate?.slotId))
      .filter((candidate, index, all) => all.findIndex((item) => item.date === candidate.date && item.venue.id === candidate.venue.id && item.slotId === candidate.slotId && item.scheduledAt === candidate.scheduledAt) === index)
      .slice(0, 6);
    const occupancyParts = (fixture: DemoFixture, venueCode: string) => {
      const profile = fixture.stage === "GROUP" ? resources.groupTiming : resources.knockoutTiming;
      const prep = profile.preparationBeforeMinutes;
      const play = matchPlayDuration(fixture);
      const transition = profile.transitionAfterMinutes + (resources.venues.find((venue) => venue.code === venueCode || venue.name === venueCode)?.turnaroundMinutes ?? 0);
      const total = Math.max(1, prep + play + transition);
      return { prep, play, transition, total, prepPercent: prep / total * 100, playPercent: play / total * 100, transitionPercent: transition / total * 100 };
    };
    const customDatePageSize = 14;
    const customDates = dateOptions.slice(customDatePage * customDatePageSize, (customDatePage + 1) * customDatePageSize);
    const fixtureRelations = selectedFixture ? (() => {
      const sources = [selectedFixture.homeSource, selectedFixture.awaySource].filter((source): source is string => Boolean(source));
      const upstream = fixtures.filter((fixture) => sources.some((source) => source.includes(fixture.id)));
      const downstream = fixtures.filter((fixture) => fixture.id !== selectedFixture.id && [fixture.homeSource, fixture.awaySource].some((source) => Boolean(source?.includes(selectedFixture.id))));
      return { sources, upstream, downstream };
    })() : null;
    const calendarAvailability = (venue: DemoScheduleResources["venues"][number], date: string) => {
      const dateValue = new Date(`${date}T12:00:00`);
      const day = dateValue.getDay();
      const unavailableDay = !resources.allowedWeekdays.includes(day) || !venue.weekdays.includes(day) || resources.blockedDates.includes(date) || !venue.active;
      const from = new Date(`${date}T00:00:00`).getTime();
      const to = from + 24 * 60 * 60 * 1000;
      const periods = venue.unavailablePeriods.filter((period) => new Date(period.startAt).getTime() < to && new Date(period.endAt).getTime() > from);
      return { unavailableDay, periods };
    };
    const blockedPosition = (period: DemoScheduleResources["venues"][number]["unavailablePeriods"][number], date: string) => {
      const dayStart = new Date(`${date}T06:00:00`).getTime();
      const dayEnd = dayStart + 16 * 60 * 60 * 1000;
      const start = Math.max(dayStart, new Date(period.startAt).getTime());
      const end = Math.min(dayEnd, new Date(period.endAt).getTime());
      return { left: Math.max(0, (start - dayStart) / (dayEnd - dayStart) * 100), width: Math.max(0, (end - start) / (dayEnd - dayStart) * 100) };
    };
    const setCalendarDate = (value: string) => setCalendarAnchorDate(value);
    const renderAutomaticFixtureDrawer = () => {
      if (!selectedFixture || !currentEntry) return null;
      if (mode === "schedule" && activeStage === 4) return <div className="step5-ws-schedule-summary"><span className={`step5-ws-status ${currentEntry.scheduledAt && currentEntry.venue ? "is-scheduled" : "is-missing"}`}>{currentEntry.scheduledAt && currentEntry.venue ? "Lịch đã lưu" : "Chưa có lịch đã lưu"}</span>{currentEntry.scheduledAt && currentEntry.venue ? <><strong>{new Date(currentEntry.scheduledAt).toLocaleDateString("vi-VN")} · {timeLabel(currentEntry.scheduledAt)}</strong><span>{venueName(selectedFixture.id, currentEntry)}</span><small>{matchPlayDuration(selectedFixture)} phút thi đấu · {occupiedDuration(selectedFixture, currentEntry.venue)} phút sân chiếm dụng.</small></> : <p>Trận chưa có lịch đã lưu. Quay lại Công đoạn 3 để điều chỉnh.</p>}<small>Đang ở chế độ rà soát. Chỉnh sửa thực hiện tại Công đoạn 3.</small></div>;
      const proposed = simulatedFixtureIds.includes(selectedFixture.id);
      return <div className="step5-ws-proposal-detail">
        <span className={`step5-ws-status ${proposed ? "is-proposed" : "is-scheduled"}`}>{proposed ? "Đang giả lập · chưa áp dụng" : currentEntry.locked ? "Đã khóa" : currentEntry.scheduledAt ? "Đã lưu trong bản nháp" : "Chưa có phương án"}</span>
        {currentEntry.scheduledAt && currentEntry.venue ? <><strong>{new Date(currentEntry.scheduledAt).toLocaleDateString("vi-VN")} · {timeLabel(currentEntry.scheduledAt)}</strong><span>{venueName(selectedFixture.id, currentEntry)}</span><small>{matchPlayDuration(selectedFixture)} phút thi đấu · {occupiedDuration(selectedFixture, currentEntry.venue)} phút sân chiếm dụng.</small></> : <p>Trận này chưa có phương án. Mở lập lịch tự động để tính lại hoặc chuyển sang thủ công.</p>}
        {proposed ? <div className="step5-ws-drawer-actions"><button type="button" className="button button-secondary" onClick={() => { setMethod("MANUAL"); setDraft({ date: currentEntry.scheduledAt.slice(0, 10), venue: currentEntry.venue, scheduledAt: currentEntry.scheduledAt, notes: currentEntry.notes }); setEditing(true); }}>Điều chỉnh thủ công</button><button type="button" className="button button-primary" disabled={autoPreviewStale || isPublished || staleStep5Snapshot} onClick={() => void toggleLock()}>Kiểm tra & khóa lịch này</button><button type="button" className="button button-danger" onClick={() => void deleteSchedule()}>Bỏ lịch giả lập</button></div> : null}
      </div>;
    };
    const renderManualFixtureDrawer = () => {
      if (!selectedFixture || !currentEntry) return null;
      if (mode === "schedule" && activeStage === 4) return <div className="step5-ws-schedule-summary">
        <span className={`step5-ws-status ${currentEntry.scheduledAt && currentEntry.venue ? "is-scheduled" : "is-missing"}`}>{currentEntry.scheduledAt && currentEntry.venue ? "Lịch đã lưu" : "Chưa có lịch đã lưu"}</span>
        {currentEntry.scheduledAt && currentEntry.venue ? <><strong>{new Date(currentEntry.scheduledAt).toLocaleDateString("vi-VN")}</strong><span>{timeLabel(currentEntry.scheduledAt)}–{timeLabel(new Date(new Date(currentEntry.scheduledAt).getTime() + matchPlayDuration(selectedFixture) * 60000).toISOString())}</span><span>{venueName(selectedFixture.id, currentEntry)}</span><small>{matchPlayDuration(selectedFixture)} phút thi đấu · {occupiedDuration(selectedFixture, currentEntry.venue)} phút sân bị chiếm dụng</small></> : <p>Trận chưa có lịch đã lưu. Quay lại Công đoạn 3 để điều chỉnh.</p>}
        <small>Đang ở chế độ rà soát. Chỉnh sửa thực hiện tại Công đoạn 3.</small>
      </div>;
      if (currentEntry.scheduledAt && currentEntry.venue && !editing) return <div className="step5-ws-schedule-summary">
        <span className={`step5-ws-status ${currentEntry.locked ? "is-locked" : "is-scheduled"}`}>{currentEntry.locked ? "Đã khóa lịch" : "Lịch trong bản nháp"}</span>
        <strong>{new Date(currentEntry.scheduledAt).toLocaleDateString("vi-VN")}</strong>
        <span>{timeLabel(currentEntry.scheduledAt)}–{timeLabel(new Date(new Date(currentEntry.scheduledAt).getTime() + matchPlayDuration(selectedFixture) * 60000).toISOString())}</span>
        <span>{selectedVenue?.name ?? currentEntry.venue} · {selectedVenue?.location ?? ""}</span>
        <small>{matchPlayDuration(selectedFixture)} phút thi đấu · {occupiedDuration(selectedFixture, currentEntry.venue)} phút sân bị chiếm dụng</small>
        {currentEntry.notes ? <small>Ghi chú: {currentEntry.notes}</small> : null}
        <div className="step5-ws-drawer-actions"><button type="button" className="button button-secondary" disabled={currentEntry.locked || isPublished || staleStep5Snapshot} onClick={() => { setDraft({ date: currentEntry.scheduledAt.slice(0, 10), venue: currentEntry.venue, scheduledAt: currentEntry.scheduledAt, notes: currentEntry.notes }); setEditing(true); }}>Chỉnh sửa</button><button type="button" className="button button-secondary" disabled={isPublished || staleStep5Snapshot} onClick={() => void toggleLock()}>{currentEntry.locked ? "Mở khóa" : "Khóa lịch"}</button><button type="button" className="button button-danger" disabled={currentEntry.locked || isPublished || staleStep5Snapshot} onClick={() => void deleteSchedule()}>Xóa lịch</button></div>
      </div>;
      return <div className="step5-ws-schedule-edit-form">
        <div className="step5-duration-breakdown"><strong>Thời lượng dự kiến</strong><span>{matchPlayDuration(selectedFixture)} phút thi đấu · {occupiedDuration(selectedFixture, draft.venue || currentEntry.venue)} phút chiếm dụng</span></div>
        {recommendedCandidate ? (() => { const parts = occupancyParts(selectedFixture, recommendedCandidate.venue.code); return <section className="step5-ws-recommendation" aria-label="Phương án hệ thống đề xuất"><div><span className="step5-ws-status is-recommended">Phương án ưu tiên · hợp lệ</span><strong>{new Date(`${recommendedCandidate.date}T12:00:00`).toLocaleDateString("vi-VN", { weekday: "long", day: "2-digit", month: "long" })} · {timeLabel(recommendedCandidate.scheduledAt)}–{recommendedCandidate.endAt}</strong><span>{recommendedCandidate.venue.name} · {recommendedCandidate.venue.location}</span><small>Match Service kiểm tra khả dụng sân, thời lượng chiếm dụng, xung đột đội, nghỉ tối thiểu và quan hệ phụ thuộc. Đây là giờ bắt đầu hợp lệ sớm nhất trong tập ứng viên hiện tại.</small></div><div className="step5-ws-occupancy-timeline" aria-label={`Chuẩn bị ${parts.prep} phút, thi đấu và dự phòng ${parts.play} phút, chuyển tiếp ${parts.transition} phút`}><i className="is-prep" style={{ width: `${parts.prepPercent}%` }}/><i className="is-play" style={{ width: `${parts.playPercent}%` }}/><i className="is-transition" style={{ width: `${parts.transitionPercent}%` }}/></div><small>Chuẩn bị {parts.prep} phút · thi đấu & dự phòng {parts.play} phút · chuyển tiếp {parts.transition} phút · tổng chiếm sân {parts.total} phút</small><button type="button" className="button button-secondary" disabled={isPublished || staleStep5Snapshot || currentEntry.locked} onClick={() => setDraft({ ...draft, date: recommendedCandidate.date, venue: recommendedCandidate.venue.code, scheduledAt: recommendedCandidate.scheduledAt })}>Chọn phương án ưu tiên</button></section>; })() : null}
        <details className="step5-ws-custom-time"><summary>Chọn thời gian khác{draft.date && draft.venue && draft.scheduledAt ? " · có thể tùy chỉnh" : ""}</summary>
          <div className="step5-ws-custom-section"><div className="step5-ws-custom-heading"><b>1 · Chọn ngày còn khả dụng</b><span>{dateOptions.length} ngày có phương án</span></div><div className="step5-ws-date-grid">{customDates.map((date) => <button type="button" key={date} disabled={isPublished || staleStep5Snapshot || currentEntry.locked} className={draft.date === date ? "is-selected" : ""} onClick={() => { setDraft({ ...draft, date, venue: "", scheduledAt: "" }); setCustomDatePage(0); }}><small>{new Date(`${date}T12:00:00`).toLocaleDateString("vi-VN", { weekday: "short" })}</small><b>{new Date(`${date}T12:00:00`).getDate()}</b><small>{new Date(`${date}T12:00:00`).toLocaleDateString("vi-VN", { month: "short" })}</small></button>)}</div>{dateOptions.length > customDatePageSize ? <div className="step5-ws-date-pager"><button type="button" disabled={!customDatePage} onClick={() => setCustomDatePage((page) => Math.max(0, page - 1))}>Ngày trước</button><span>{customDatePage + 1}/{Math.ceil(dateOptions.length / customDatePageSize)}</span><button type="button" disabled={(customDatePage + 1) * customDatePageSize >= dateOptions.length} onClick={() => setCustomDatePage((page) => page + 1)}>Ngày sau</button></div> : null}</div>
          <div className="step5-ws-custom-section"><div className="step5-ws-custom-heading"><b>2 · Chọn sân theo địa điểm</b><span>{venueOptions.length} sân hợp lệ</span></div><div className="step5-ws-venue-options">{venueOptions.map((venue) => <button type="button" key={venue.id} disabled={isPublished || staleStep5Snapshot || currentEntry.locked} className={draft.venue === venue.code || draft.venue === venue.name ? "is-selected" : ""} onClick={() => setDraft({ ...draft, venue: venue.code, scheduledAt: "" })}><b>{venue.name}</b><small>{venue.location}</small></button>)}{draft.date && !venueOptions.length ? <p className="form-help">Không có sân phù hợp vào ngày này. Chọn ngày khác hoặc kiểm tra lịch khả dụng của sân.</p> : null}</div></div>
          <div className="step5-ws-custom-section"><div className="step5-ws-custom-heading"><b>3 · Chọn giờ bắt đầu</b><span>{timeOptions.length} khung giờ hợp lệ</span></div><div className="step5-ws-time-options">{timeOptions.map((candidate) => <button type="button" key={`${candidate.slotId}-${candidate.scheduledAt}`} disabled={isPublished || staleStep5Snapshot || currentEntry.locked} className={draft.scheduledAt === candidate.scheduledAt ? "is-selected" : ""} onClick={() => setDraft({ ...draft, scheduledAt: candidate.scheduledAt })}><b>{timeLabel(candidate.scheduledAt)}</b><small>kết thúc {candidate.endAt}</small></button>)}{draft.date && draft.venue && !timeOptions.length ? <p className="form-help">Không còn giờ hợp lệ tại sân này theo các ràng buộc hiện tại.</p> : null}</div></div>
          {alternativeCandidates.length ? <div className="step5-ws-alternatives"><b>Phương án hợp lệ khác</b>{alternativeCandidates.map((candidate) => <button type="button" key={`${candidate.date}|${candidate.venue.id}|${candidate.scheduledAt}`} disabled={isPublished || staleStep5Snapshot || currentEntry.locked} onClick={() => setDraft({ ...draft, date: candidate.date, venue: candidate.venue.code, scheduledAt: candidate.scheduledAt })}>{new Date(`${candidate.date}T12:00:00`).toLocaleDateString("vi-VN", { day: "2-digit", month: "short" })} · {timeLabel(candidate.scheduledAt)} · {candidate.venue.name}</button>)}</div> : null}
        </details>
        {selectedChoice ? <div className="step5-estimated-end"><span>Phương án đang chọn · giờ kết thúc dự kiến</span><strong>{selectedChoice.endAt}</strong><small>{selectedChoice.venue.name} · {selectedChoice.venue.location} · chiếm sân {occupiedDuration(selectedFixture, selectedChoice.venue.code)} phút</small></div> : null}
        <div className="step5-ws-duration-explainer">Thời gian chuẩn bị được tính trước giờ khai cuộc; thời gian thi đấu, dự phòng và chuyển tiếp được tính vào tổng chiếm sân.</div>
        <label>Ghi chú<textarea rows={2} value={draft.notes} disabled={isPublished || staleStep5Snapshot || currentEntry.locked} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
        {candidateLoadError ? <p className="form-error" role="alert">{candidateLoadError}</p> : null}{saveError ? <p className="form-error" role="alert">{saveError}</p> : null}
        {!dateOptions.length ? <p className="step5-ws-no-candidate">{candidateLoadError ? `Không thể lấy phương án từ Match Service: ${candidateLoadError}` : !resources.competitionStartDate || !resources.competitionEndDate ? "Chưa có khoảng ngày thi đấu để tìm phương án." : !usableVenues.length ? `Chưa có sân ${footballFormat} người đã xác nhận khả dụng trong thời gian giải.` : "Match Service chưa tìm thấy tổ hợp hợp lệ cho trận này trong cấu hình hiện tại. Hãy kiểm tra ngày thi đấu, khung giờ sân, thời gian nghỉ, cụm đồng giờ và các trận phụ thuộc."}</p> : null}
        <div className="step5-ws-drawer-actions"><button type="button" className="button button-primary" disabled={!selectedChoice || isPublished || staleStep5Snapshot || currentEntry.locked} onClick={() => void saveManualEntry()}>{mode === "schedule" && activeStage === 3 ? "Lưu điều chỉnh" : "Lưu lịch nháp"}</button>{!(mode === "schedule" && activeStage === 3) && !currentEntry.scheduledAt && !step5.autoPreview?.scheduledFixtureIds.includes(selectedFixture.id) ? <button type="button" className="button button-secondary" disabled={!selectedChoice || isPublished || staleStep5Snapshot || currentEntry.locked} onClick={() => void saveManualEntry(true)}>Lưu & khóa lịch</button> : null}{!(mode === "schedule" && activeStage === 3) && currentEntry.scheduledAt && !currentEntry.locked ? <button type="button" className="button button-secondary" onClick={() => setEditing(false)}>Hủy chỉnh sửa</button> : null}</div>
      </div>;
    };

    const renderSelectedFixtureContent = () => selectedFixture && currentEntry ? <div className="step5-ws-fixture-form">
      <div className="step5-fixture-contestants"><b>{teamNames.get(selectedFixture.homeTeamId ?? "") ?? selectedFixture.homeSource ?? "Chờ xác định"}</b><span>VS</span><b>{teamNames.get(selectedFixture.awayTeamId ?? "") ?? selectedFixture.awaySource ?? "Chờ xác định"}</b></div>
      <div className="step5-detail-tags"><span>{phaseLabel(selectedFixture)}</span>{selectedFixture.groupName ? <span>{selectedFixture.groupName}</span> : null}<span>{selectedFixture.round}{selectedFixture.leg ? ` · Lượt ${selectedFixture.leg}` : ""}</span></div>
      <section className="step5-ws-fixture-context"><div><span>Mã trận</span><b>{selectedFixture.id}</b></div><div><span>Trạng thái lịch</span><b>{selectedDraftIsDirty ? "🟠 Đang điều chỉnh · chưa lưu" : statusText(entryStatus(selectedFixture))}</b></div>{currentEntry.scheduledAt && currentEntry.venue ? <div><span>Lịch hiện tại</span><b>{new Date(currentEntry.scheduledAt).toLocaleDateString("vi-VN")} · {timeLabel(currentEntry.scheduledAt)} · {venueName(selectedFixture.id, currentEntry)}</b></div> : null}
        {fixtureRelations?.sources.length ? <div><span>Nguồn đội từ Bước 4</span><b>{fixtureRelations.sources.join(" · ")}</b>{fixtureRelations.upstream.length ? <small>Trận nguồn: {fixtureRelations.upstream.map((fixture) => fixture.id).join(", ")}</small> : null}</div> : null}
        {fixtureRelations?.downstream.length ? <div><span>Trận phụ thuộc</span><b>{fixtureRelations.downstream.map((fixture) => fixture.id).join(", ")}</b></div> : null}
        {!fixtureRelations?.sources.length && !fixtureRelations?.downstream.length ? <small>Cặp đấu và nguồn đội được giữ nguyên từ sơ đồ Bước 4; không thể chỉnh sửa tại Bước 5.</small> : null}</section>
      {method === "AUTO" ? renderAutomaticFixtureDrawer() : renderManualFixtureDrawer()}
      {constraintIssues.filter((issue) => issue.fixtureId === selectedFixture.id).map((issue, index) => <p className="form-error" role="alert" key={`${issue.code}-${index}`}>{issue.message}</p>)}
    </div> : null;

    const settingsWorkspace = <DrawDemoScheduleSettingsPanel officialMode={Boolean(official)} onAnalyzeSetup={official ? analyzeOfficialSetup : undefined} section={activeStage === 1 ? "venues" : activeStage === 2 ? settingsSection ?? "overview" : null} resources={resources} pitchType={footballFormat} competitionFormat={competitionFormat} regulation={regulation ?? null} startDate={startDate} endDate={endDate} tournamentId={tournamentId} tournamentName={tournamentName} diagramVersion={snapshotKey} formatMismatchText={!formatMatchesDiagram ? formatMismatchText : undefined} fixtures={fixtures} scheduleByFixture={setupScheduleEntries} readOnly={isSchedulePublished || staleStep5Snapshot} embedded={activeStage === 1 || activeStage === 2} onClose={() => setSettingsSection(null)} onGoToVenues={() => { setActiveStage(1); setSettingsSection(null); }} onGoToTournamentInfo={onGoToTournamentInfo} onContinue={() => { setSettingsSection(null); setActiveStage(activeStage === 1 ? 2 : 3); }} onApply={saveResources} />;
    const stageStates: Record<Step5Stage, "complete" | "current" | "attention" | "upcoming"> = {
      1: usableVenues.length ? "complete" : activeStage === 1 ? "current" : "attention",
      2: configurationIssues.length || !formatMatchesDiagram ? activeStage === 2 ? "current" : "attention" : "complete",
      3: scheduleReady ? "complete" : activeStage === 3 ? "current" : scheduledCount || hasPendingSimulation ? "attention" : "upcoming",
      4: isSchedulePublished ? "complete" : !scheduleReady ? "attention" : activeStage === 4 ? "current" : "upcoming",
      5: isSchedulePublished ? "complete" : activeStage === 5 ? "current" : "upcoming",
    };
    const showStageControls = mode === "schedule" ? activeStage === 3 && !isPublished : activeStage > 2;
    const hasScheduleForReview = mode === "schedule" && activeStage === 4
      ? scheduledCount > 0
      : mode === "schedule" && activeStage === 3
        ? fixtures.length > 0
        : scheduledCount + simulatedFixtureIds.length > 0;
    const summaryIssues = [...new Map(allValidationIssues.map((issue) => [`${issue.fixtureId}|${issue.code}`, issue])).values()];

    return <Step5WorkspaceShell
      heading={<header className="step5-ws-heading"><div><span className="eyebrow">BƯỚC 5 · LẬP LỊCH THI ĐẤU</span><h2>Lập lịch thi đấu</h2><p>{tournamentName} · {scheduleFormatLabel} · bóng đá {footballFormat} người · {fixtures.length} trận · {resources.competitionStartDate || "Chưa có ngày bắt đầu"} – {resources.competitionEndDate || "Chưa có ngày kết thúc"}</p>{teamsLoadError ? <small className="form-error" role="alert">Không tải được dữ liệu đội từ Tournament Service: {teamsLoadError}</small> : null}{mode === "schedule" && !official ? <small className="step5-ws-test-data-note">Bản thử nghiệm development · lưu vào snapshot riêng, không ghi vào bảng lịch thi đấu chính thức.</small> : null}</div>{isSchedulePublished ? <span className="status-pill status-success">{official ? "Đã công bố" : "Đã công bố (sandbox)"} · v{step5.scheduleVersion ?? 1}</span> : null}</header>}
      activeStage={activeStage} stageCount={mode === "schedule" ? 4 : 5} stageStates={stageStates} showStageControls={showStageControls} canContinue={scheduleReady && !isPublished} continueLabel={mode === "schedule" ? "Tiếp tục →" : "Lưu và tiếp tục →"} onSelectStage={(stage) => { if (mode === "schedule" && stage > 4) return; setActiveStage(stage); setSettingsSection(null); }}
      preparation={settingsWorkspace}
      guidance={null}
      actions={null}
      creation={<>
        {!formatMatchesDiagram ? <p className="step5-ws-format-warning" role="alert">{formatMismatchText}</p> : null}
        {staleStep5Snapshot ? <p className="step5-ws-format-warning" role="alert">Snapshot lịch cũ được giữ nguyên; không thể lưu, khóa, mở khóa hoặc tạo lịch cho đến khi dùng đúng phiên bản sơ đồ Bước 4.</p> : null}
        <DrawDemoAutomaticSchedulePanel configuration={autoConfiguration} preview={autoPreview} fixtures={fixtures} teams={teams} currentEntries={step5.scheduleByFixture} resources={resources} pitchType={footballFormat} running={autoRunning} disabled={isPublished || staleStep5Snapshot} runDisabled={Boolean(autoScheduleBlocker) || selectedDraftIsDirty} runDisabledReason={selectedDraftIsDirty ? "Lưu hoặc hủy chỉnh sửa trận đang chọn trước khi tạo lịch tự động." : autoScheduleBlocker} error={saveError} onChange={changeAutoConfiguration} onRun={() => { setMethod("AUTO"); setAutoPanelOpen(false); setSelectedFixture(null); void runAutomaticSchedule(); }} onCancel={() => void cancelAutomaticPreview()} />
      </>}
      viewToolbar={hasScheduleForReview ? <div className="step5-ws-view-toolbar"><div className="step5-ws-view-tabs" role="tablist" aria-label="Chế độ xem lịch">{([ ["LIST", "Danh sách trận"], ["CALENDAR", "Lịch theo ngày/sân"], ["DIAGRAM", "Sơ đồ thi đấu"] ] as const).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={scheduleView === value} className={scheduleView === value ? "is-active" : ""} onClick={() => setScheduleView(value)}>{label}</button>)}</div>
        <div className="step5-ws-view-tools"><label className="step5-ws-search"><span aria-hidden="true">⌕</span><input value={viewQuery} onChange={(event) => setViewQuery(event.target.value)} placeholder="Tìm đội hoặc mã trận" aria-label="Tìm đội hoặc mã trận" /></label>
          <details className="step5-ws-filter-popover"><summary><span aria-hidden="true">☷</span> Bộ lọc{activeFilterCount ? <b>{activeFilterCount}</b> : null}</summary><div className="step5-ws-filter-panel"><div className="step5-ws-filter-heading"><strong>Lọc lịch thi đấu</strong><button type="button" className="text-button" onClick={resetFilters}>Xóa lọc</button></div><label>Giai đoạn<select value={viewStage} onChange={(event) => setViewStage(event.target.value)}><option value="ALL">Tất cả giai đoạn</option><option value="GROUP">Vòng bảng</option><option value="KNOCKOUT">Loại trực tiếp</option></select></label><label>Bảng<select value={viewGroup} onChange={(event) => setViewGroup(event.target.value)}><option value="ALL">Tất cả bảng</option>{scheduleGroups.map((group) => <option key={group}>{group}</option>)}</select></label><label>Vòng<select value={viewRound} onChange={(event) => setViewRound(event.target.value)}><option value="ALL">Tất cả vòng</option>{scheduleRounds.map((round) => <option key={round}>{round}</option>)}</select></label><label>Từ ngày<input type="date" value={viewDateFrom} onChange={(event) => setViewDateFrom(event.target.value)} /></label><label>Đến ngày<input type="date" min={viewDateFrom || undefined} value={viewDateTo} onChange={(event) => setViewDateTo(event.target.value)} /></label><label>Sân<select value={viewVenue} onChange={(event) => setViewVenue(event.target.value)}><option value="ALL">Mọi sân</option>{scheduleVenues.map((venue) => <option key={venue}>{venue}</option>)}</select></label><label>Trạng thái lịch<select value={viewStatus} onChange={(event) => setViewStatus(event.target.value)}><option value="ALL">Mọi trạng thái</option><option value="UNSCHEDULED">Còn thiếu</option><option value="SCHEDULED">Đã lập lịch</option><option value="LOCKED">Đã khóa</option><option value="PROPOSED">Đang giả lập</option></select></label><small>Đang hiển thị {scheduleViewFixtures.length}/{fixtures.length} trận.</small></div></details>
        </div>
      </div> : <section className="step5-stage4-empty"><span className="eyebrow">CHƯA CÓ LỊCH ĐÃ LƯU</span><h3>Chưa có trận nào được lưu vào lịch nháp</h3><p>Tạo và lưu lịch ở Công đoạn 3. Sơ đồ Bước 4 vẫn được giữ nguyên để tham khảo.</p><button type="button" className="button button-secondary" onClick={() => setActiveStage(3)}>Quay lại điều chỉnh</button></section>}
      simulatedPlan={hasPendingSimulation ? <section className={`step5-ws-simulated-plan ${autoPreviewStale ? "is-stale" : ""}`}><span className="step5-ws-spark" aria-hidden="true">✦</span><div><strong>{simulatedFixtureIds.length} thay đổi trong phương án tự động · {Math.max(0, fixtures.length - scheduledCount - simulatedFixtureIds.length)} trận chưa xếp</strong><p>{autoPreviewStale ? "Nguồn lực hoặc lịch đã thay đổi. Tạo lại phương án trước khi dùng." : simulatedFixtureIds.length ? "Phương án chưa nằm trong bản nháp. Kiểm tra rồi chọn trận để điều chỉnh hoặc lưu." : "Phương án không còn thay đổi so với lịch nháp; hủy phương án trước khi tiếp tục."}</p></div><button className="button button-secondary" type="button" onClick={() => void validateSimulationPlan()}>Kiểm tra xung đột</button><button className="button button-primary" type="button" disabled={autoPreviewStale || !simulatedFixtureIds.length} onClick={() => void lockSelectedSchedules(simulatedFixtureIds)}>Lưu và khóa lịch hợp lệ</button></section> : null}
      workspace={hasScheduleForReview ? <>
        {candidateLoadError && selectedFixture && method === "MANUAL" ? <p className="form-error" role="alert">Không thể tải lựa chọn từ Match Service: {candidateLoadError}</p> : null}
          {(!(mode === "schedule" && activeStage === 4)) && method === "MANUAL" && resources.requireSimultaneousGroupFinalRound && finalRoundGroups.some((group) => group.fixtures.length > 1) ? <details className="step5-ws-cluster"><summary>Vòng cuối cần đồng giờ · xếp cụm trận</summary><div><label>Bảng<select value={clusterGroup} onChange={(event) => { setClusterGroup(event.target.value); setClusterChoiceKey(""); }}><option value="">Chọn bảng</option>{finalRoundGroups.filter((group) => group.fixtures.length > 1).map((group) => <option key={group.groupName} value={group.groupName}>{group.groupName} · {group.fixtures.length} sân</option>)}</select></label><label>Ngày, giờ chung<select disabled={!clusterGroup} value={clusterChoiceKey} onChange={(event) => setClusterChoiceKey(event.target.value)}><option value="">Chọn giờ hợp lệ</option>{finalRoundOptions.map((option) => <option key={option.scheduledAt + "|" + option.slotId} value={option.scheduledAt + "|" + option.slotId}>{new Date(option.scheduledAt).toLocaleString("vi-VN")} · {option.slotLabel}</option>)}</select></label><button className="button button-primary" type="button" disabled={!selectedClusterOption || isPublished} onClick={() => void saveFinalRoundCluster()}>Lưu cụm trận</button>{clusterGroup && !finalRoundOptions.length ? <p className="form-error">Không đủ sân khả dụng cho toàn cụm {selectedFinalGroup?.fixtures.length ?? 0} trận. Hiện có {usableVenues.length} sân có khung giờ phù hợp.</p> : null}</div></details> : null}
        {scheduleView === "DIAGRAM" ? <div className="step5-ws-diagram"><DrawDemoFixtureWorkspace officialMode={Boolean(official)} tournamentId={tournamentId} tournamentName={tournamentName} readOnly publishedState={state} teams={teams} diagramOnly fixtureFilter={(fixture) => scheduleViewFixtureIdSet.has(fixture.id)} scheduleByFixture={visibleEntries} scheduleDisplayByFixture={scheduleDisplayByFixture} scheduleIssuesByFixture={scheduleIssuesByFixture} selectedFixtureId={selectedFixture?.id} editingFixtureId={selectedDraftIsDirty ? selectedFixture?.id : undefined} schedulePublished={isPublished} onFixtureSelect={selectFixture} /></div> : null}
        {scheduleView === "CALENDAR" ? <div className="step5-ws-calendar"><header className="step5-ws-calendar-heading"><div><span className="eyebrow">LỊCH TRỰC QUAN</span><h3>{calendarMode === "DAY" ? "Theo ngày" : "Theo tuần"}</h3><p>Trục 06:00–22:00 · event thể hiện cả chuẩn bị, thi đấu và chuyển tiếp.</p></div><div className="step5-ws-calendar-controls"><div role="group" aria-label="Phạm vi lịch"><button type="button" className={calendarMode === "DAY" ? "is-active" : ""} onClick={() => setCalendarMode("DAY")}>Ngày</button><button type="button" className={calendarMode === "WEEK" ? "is-active" : ""} onClick={() => setCalendarMode("WEEK")}>Tuần</button></div><label><span className="visually-hidden">Ngày xem</span><input type="date" min={resources.competitionStartDate || undefined} max={resources.competitionEndDate || undefined} value={calendarBaseDate} onChange={(event) => setCalendarDate(event.target.value)} /></label></div></header>
          <div className="step5-ws-calendar-legend"><span><i className="is-prep"/> Chuẩn bị</span><span><i className="is-play"/> Thi đấu & dự phòng</span><span><i className="is-transition"/> Chuyển tiếp sân</span><span><i className="is-unavailable"/> Không khả dụng</span></div>
          {!venuesByLocation.length ? <div className="step5-empty-view"><strong>Chưa có sân phù hợp</strong><span>Quản lý sân để khai báo địa điểm và khung giờ.</span><button className="button button-secondary" type="button" disabled={isPublished} onClick={() => setSettingsSection("venues")}>Quản lý sân</button></div> : calendarRenderDays.map((date) => <section className="step5-ws-calendar-day" key={date}><h4>{new Date(`${date}T12:00:00`).toLocaleDateString("vi-VN", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}</h4>{venuesByLocation.map(({ location, venues }) => <section className="step5-ws-location" key={`${date}-${location}`}><h5>{location}</h5>{venues.map((venue) => { const availability = calendarAvailability(venue, date); const items = calendarEntries.filter((fixture) => { const entry = visibleEntries[fixture.id] ?? step5.scheduleByFixture[fixture.id]; const matched = resources.venues.find((item) => item.code === entry?.venue || item.name === entry?.venue); return entry?.scheduledAt?.slice(0, 10) === date && matched?.id === venue.id; }); return <div className="step5-ws-lane" key={`${date}-${venue.id}`}><strong>{venue.name}<small>{venue.pitchType} người</small></strong><div className={`step5-ws-lane-track ${availability.unavailableDay ? "is-day-unavailable" : ""}`}><div className="step5-ws-time-axis"><span>06:00</span><span>10:00</span><span>14:00</span><span>18:00</span><span>22:00</span></div>{availability.periods.map((period) => { const pos = blockedPosition(period, date); return pos.width > 0 ? <span key={period.id} className="step5-ws-blackout" style={{ left: `${pos.left}%`, width: `${pos.width}%` }} title={period.reason} /> : null; })}{availability.unavailableDay ? <span className="step5-ws-unavailable-label">Sân không khả dụng trong ngày</span> : null}{items.map((fixture) => { const entry = visibleEntries[fixture.id] ?? step5.scheduleByFixture[fixture.id]; const position = occupiedTimelinePosition(fixture); const start = new Date(entry.scheduledAt); const profile = fixture.stage === "GROUP" ? resources.groupTiming : resources.knockoutTiming; const occupancyStart = new Date(start.getTime() - profile.preparationBeforeMinutes * 60000); return <button key={fixture.id} type="button" className={`step5-ws-event ${selectedFixture?.id === fixture.id ? "is-selected" : ""} ${selectedDraftIsDirty && selectedFixture?.id === fixture.id ? "is-editing" : ""} ${simulatedFixtureIds.includes(fixture.id) ? "is-simulated" : ""} ${entry.locked ? "is-locked" : ""} ${scheduleIssuesByFixture[fixture.id]?.length ? "has-schedule-error" : ""}`} style={{ left: `${position.left}%`, width: `${position.width}%` }} onClick={() => selectFixture(fixture)} title={`${fixture.id} · ${occupancyStart.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}–${new Date(occupancyStart.getTime() + position.occupied * 60000).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })} · ${position.occupied} phút chiếm sân`}><span className="step5-ws-event-segments"><i className="is-prep" style={{ width: `${position.width ? position.preparationWidth / position.width * 100 : 0}%` }} /><i className="is-play" style={{ width: `${position.width ? position.playWidth / position.width * 100 : 0}%` }} /><i className="is-transition" style={{ width: `${position.width ? position.transitionWidth / position.width * 100 : 0}%` }} /></span><b>{scheduleIssuesByFixture[fixture.id]?.length ? "⚠ " : ""}{fixture.id}</b><span>{timeLabel(entry.scheduledAt)} · {venueName(fixture.id, entry)}</span><small>{selectedDraftIsDirty && selectedFixture?.id === fixture.id ? "🟠 Đang điều chỉnh · chưa lưu" : statusText(entryStatus(fixture))}</small></button>; })}</div></div>; })}</section>)}</section>)}
          {calendarEntries.length === 0 ? <div className="step5-empty-view"><strong>Chưa có lịch trong khoảng xem</strong><span>Các trận chưa được xếp vẫn nằm trên sơ đồ và trong danh sách.</span></div> : null}
        </div> : null}
        {scheduleView === "LIST" ? <div className="step5-ws-list"><header><div><span className="eyebrow">DANH SÁCH TRẬN</span><h3>{scheduleViewFixtures.length} trận phù hợp</h3></div><label className="step5-ws-select-all"><input type="checkbox" disabled={mode === "schedule" && activeStage === 4} checked={allVisibleSelected} aria-label="Chọn tất cả trận đang hiển thị" onChange={() => setSelectedFixtureIds(allVisibleSelected ? selectedFixtureIds.filter((id) => !scheduleViewFixtureIdSet.has(id)) : [...new Set([...selectedFixtureIds, ...scheduleViewFixtures.map((fixture) => fixture.id)])])} /> Chọn tất cả</label></header>
          {selectedFixtureIds.length && !(mode === "schedule" && activeStage === 4) ? <div className="step5-ws-bulk-toolbar"><strong>{selectedFixtureIds.length} trận được chọn</strong><button type="button" className="button button-secondary" disabled={isPublished || staleStep5Snapshot} onClick={() => void lockSelectedSchedules()}>Khóa lịch hợp lệ</button><button type="button" className="button button-secondary" disabled={isPublished || staleStep5Snapshot || !selectedFixtureIds.some((id) => step5.scheduleByFixture[id]?.locked)} onClick={() => void unlockSelectedSchedules()}>Mở khóa</button><button type="button" className="button button-danger" disabled={isPublished || staleStep5Snapshot} onClick={() => void removeSelectedSchedules()}>Xóa lịch đã chọn</button><button type="button" className="text-button" onClick={() => setSelectedFixtureIds([])}>Bỏ chọn</button></div> : null}
          <div className="step5-ws-match-groups">{scheduleViewGroups.map((group) => <details className="step5-ws-match-group" key={group.key} open><summary><strong>{group.title}</strong><span>{group.fixtures.length} trận</span></summary><div className="step5-ws-table-wrap"><table><thead><tr><th></th><th>Mã trận</th><th>Đội / nguồn đội</th><th>Giai đoạn · vòng</th><th>Ngày</th><th>Giờ</th><th>Sân</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>{group.fixtures.map(renderFixtureRow)}</tbody></table></div></details>)}{!scheduleViewFixtures.length ? <div className="step5-empty-view">Không có trận phù hợp bộ lọc.</div> : null}</div>
        </div> : null}
      </> : null}
      printPreview={hasScheduleForReview ? <Step5SchedulePrintPreview tournamentName={tournamentName} fixtures={scheduleViewFixtures} entries={visibleEntries} teamNames={teamNames} venueName={venueName} durationMinutes={(fixture) => matchPlayDuration(fixture)} simulatedFixtureIds={new Set(mode === "schedule" && activeStage === 3 ? simulatedFixtureIds : [])} compact={mode === "schedule" && activeStage === 4} /> : null}
      review={mode === "schedule" ? <section className="step5-ws-review-panel" aria-label="Kết quả kiểm tra toàn bộ lịch">
        <header><div><span className="eyebrow">KIỂM TRA & CÔNG BỐ</span><h3>{isSchedulePublished ? "Lịch đã công bố" : "Kiểm tra toàn bộ lịch"}</h3><p>{validationCurrent ? "Match Service đã kiểm tra lại lịch đã lưu." : serverValidation.error ? "Chưa thể xác nhận tính hợp lệ của lịch." : "Đang kiểm tra lịch với Match Service…"}</p></div><span className={`status-pill ${isSchedulePublished ? "status-success" : scheduleReady ? "status-success" : "status-warning"}`}>{isSchedulePublished ? `Đã công bố · v${step5.scheduleVersion ?? 1}` : scheduleReady ? "Hợp lệ" : "Cần xử lý"}</span></header>
        <div className="step5-ws-completion-stats"><article><span>Tổng số trận</span><b>{fixtures.length}</b></article><article><span>Đã xếp</span><b>{scheduledCount}</b></article><article><span>Chưa xếp</span><b>{Math.max(0, fixtures.length - scheduledCount)}</b></article><article><span>Đã khóa</span><b>{lockedScheduleCount}</b></article><article><span>Sân đang sử dụng</span><b>{usedVenueCount}</b></article><article><span>Trạng thái kiểm tra</span><b>{validationCurrent ? scheduleReady ? "Hợp lệ" : "Có lỗi" : "Chưa xác nhận"}</b></article></div>
        {serverValidation.error ? <p className="form-error" role="alert">{serverValidation.error}</p> : null}
        {!isSchedulePublished && fixtures.length - scheduledCount > 0 ? <p className="step5-ws-completion-issue">Còn {fixtures.length - scheduledCount} trận chưa được lập lịch.</p> : null}
        {!isSchedulePublished && summaryIssues.length ? <div className="step5-ws-completion-issue"><strong>{summaryIssues.length} vấn đề cần xử lý</strong>{summaryIssues.slice(0, 5).map((issue, index) => <p key={`${issue.fixtureId}-${issue.code}-${index}`}>{issue.fixtureId ? `${issue.fixtureId}: ` : ""}{issue.message}</p>)}{summaryIssues.length > 5 ? <small>Còn {summaryIssues.length - 5} vấn đề. Quay lại Công đoạn 3 để điều chỉnh.</small> : null}</div> : null}
        {!isSchedulePublished && hasPendingSimulation ? <p className="step5-ws-completion-issue">Còn {autoPreview?.scheduledFixtureIds.length ?? 0} trận trong phương án tự động chưa được lưu vào lịch nháp.</p> : null}
        {!isSchedulePublished && !summaryIssues.length && objectiveWarnings.filter((issue) => issue.severity !== "HARD").length ? <div className="step5-ws-completion-ok"><strong>Lưu ý</strong>{objectiveWarnings.filter((issue) => issue.severity !== "HARD").slice(0, 3).map((issue, index) => <p key={`${issue.fixtureId}-${issue.code}-${index}`}>{issue.fixtureId ? `${issue.fixtureId}: ` : ""}{issue.message}</p>)}</div> : null}
        {isSchedulePublished && step5.schedulePublishedAt ? <p className="step5-ws-completion-ok">{official ? "Đã công bố chính thức lúc " : "Đã công bố trong snapshot thử nghiệm lúc "}{new Date(step5.schedulePublishedAt).toLocaleString("vi-VN")}.{official ? " Bước 6 tiếp nhận lịch chính thức này." : " Bảng lịch thi đấu chính thức không thay đổi."}</p> : null}
      </section> : null}
      completion={mode === "schedule" ? <section className="step5-ws-publish-footer" aria-label="Thao tác công bố lịch"><p>{isSchedulePublished ? "Đã công bố. Lịch không thể công bố trùng." : publicationBlocker || "Match Service sẽ kiểm tra lại toàn bộ ràng buộc trước khi ghi trạng thái công bố."}</p><div className="step5-ws-completion-actions"><button type="button" className="button button-secondary" onClick={() => { setActiveStage(3); setScheduleView("LIST"); }}>Quay lại điều chỉnh</button><button className="button button-primary" type="button" disabled={!scheduleReady || isPublished || !validationCurrent} onClick={() => void publishSchedule()}>{isPublished ? "Đã công bố" : "Công bố lịch"}</button></div></section> : <section className="step5-ws-completion" aria-label="Tổng kết lịch thi đấu">
        <header><div><span className="eyebrow">HOÀN TẤT & CÔNG BỐ</span><h3>{isSchedulePublished ? "Lịch thi đấu đã công bố" : "Tổng kết lịch thi đấu"}</h3><p>{validationCurrent ? "Match Service đã kiểm tra toàn bộ lịch đã lưu." : serverValidation.error ? "Chưa kiểm tra được lịch." : "Đang kiểm tra lịch với Match Service…"}</p></div><span className={`status-pill ${isSchedulePublished ? "status-success" : scheduleReady ? "status-success" : "status-warning"}`}>{isSchedulePublished ? `Đã công bố · v${step5.scheduleVersion ?? 1}` : scheduleReady ? "Hợp lệ" : "Cần xử lý"}</span></header>
        <div className="step5-ws-completion-stats"><article><span>Tổng số trận</span><b>{fixtures.length}</b></article><article><span>Đã xếp</span><b>{scheduledCount}</b></article><article><span>Chưa xếp</span><b>{Math.max(0, fixtures.length - scheduledCount)}</b></article></div>{serverValidation.error ? <p className="form-error" role="alert">{serverValidation.error}</p> : null}{!isSchedulePublished && summaryIssues.map((issue, index) => <p className="step5-ws-completion-issue" key={`${issue.fixtureId}-${issue.code}-${index}`}>{issue.fixtureId ? `${issue.fixtureId}: ` : ""}{issue.message}</p>)}
        <div className="step5-ws-completion-actions">{!isSchedulePublished && fixtures.length - scheduledCount > 0 ? <button type="button" className="button button-secondary" onClick={() => setActiveStage(3)}>Quay lại công đoạn 3</button> : null}<button className="button button-primary" type="button" disabled={!scheduleReady || isPublished || !validationCurrent} onClick={() => void publishSchedule()}>{isPublished ? "Lịch thi đấu đã công bố" : "Công bố lịch thi đấu"}</button></div>
      </section>}
      overlays={<>
        <Modal open={Boolean(selectedFixture)} title={selectedTitle} description="Mã trận, đội, bảng và quan hệ phụ thuộc được kế thừa từ sơ đồ Bước 4." eyebrow={mode === "schedule" && activeStage === 3 ? "ĐIỀU CHỈNH TRẬN ĐẤU" : method === "AUTO" ? "PHƯƠNG ÁN LỊCH" : "CHI TIẾT TRẬN ĐẤU"} className="step5-ws-fixture-drawer" onClose={closeFixtureDrawer}>
          {renderSelectedFixtureContent()}
          {mode === "schedule" && activeStage === 3 ? <div className="step5-ws-adjustment-actions"><button className="button button-secondary" type="button" onClick={closeFixtureDrawer}>Hủy thay đổi</button></div> : null}
        </Modal>
      </>}
    />;
  }

  if (!validStep4) return <section className="panel workflow-phase-panel"><span className="eyebrow">BƯỚC {mode === "schedule" ? 5 : 6} · CHẾ ĐỘ KIỂM THỬ</span><h2>{mode === "schedule" ? "Lập lịch thi đấu" : "Phân công trọng tài"}</h2><p>Bước này chỉ mở sau khi sơ đồ thi đấu thử nghiệm tại Bước 4 được công bố hợp lệ.</p></section>;

  if (String(mode) === "schedule") return renderStep5Workspace();

  return <section className="step5-demo-workspace" aria-label={`Bước ${mode === "schedule" ? 5 : 6} ${mode === "schedule" ? "lập lịch thi đấu" : "phân công trọng tài"}`}>
    <header className="step5-demo-header">
      <div>
        <span className="draw-dev-badge">BƯỚC {mode === "schedule" ? 5 : 6} · DỮ LIỆU CỤC BỘ TRÊN TRÌNH DUYỆT</span>
        <h2>{mode === "schedule" ? "Lập lịch thi đấu" : "Phân công trọng tài"}</h2>
        <p>{tournamentName} · đầu vào lấy nguyên từ sơ đồ Bước 4 đã công bố ({fixtures.length} trận; không sinh lại cặp đấu)</p>
        {mode === "schedule" ? <div className="step5-resource-actions">
          <button className="button button-secondary" type="button" disabled={isPublished || staleStep5Snapshot} onClick={() => setSettingsSection("overview")}>Thiết lập</button>
          <button className="button button-secondary" type="button" disabled={isPublished || staleStep5Snapshot} onClick={() => setSettingsSection("venues")}>Quản lý sân <span>{resources.venues.length}</span></button>
          <button className="button button-secondary" type="button" disabled={isPublished || staleStep5Snapshot} onClick={() => setSettingsSection("format")}>Ràng buộc thể thức</button>
        </div> : null}
      </div>
      <button className="button button-secondary" type="button" onClick={() => { if (mode === "schedule") void resetStep5(); else void resetStep6(); }}>Reset dữ liệu test Bước {mode === "schedule" ? 5 : 6}</button>
    </header>
    <div className="step5-demo-stats" aria-label={`Tiến độ Bước ${mode === "schedule" ? 5 : 6}`}><article><strong>{fixtures.length}</strong><span>Tổng số trận</span></article>{mode === "schedule" ? <><article><strong>{scheduledCount}</strong><span>Đã lập lịch</span></article><article><strong>{fixtures.length - scheduledCount}</strong><span>Chưa lập lịch</span></article><article><strong>{fixtures.length ? Math.round((scheduledCount / fixtures.length) * 100) : 0}%</strong><span>Tiến độ lịch</span></article></> : <><article><strong>{assignedCount}</strong><span>Trận có trọng tài đã công bố</span></article><article><strong>{fixtures.length - assignedCount}</strong><span>Chưa công bố phân công</span></article><article><strong>{refereeDraftAssignedCount}</strong><span>Có phân công nháp</span></article></>}</div>
    {mode === "schedule" ? <div className="step5-demo-progress" role="progressbar" aria-label="Tiến độ lập lịch thi đấu" aria-valuemin={0} aria-valuemax={100} aria-valuenow={fixtures.length ? Math.round((scheduledCount / fixtures.length) * 100) : 0}><span style={{ width: `${fixtures.length ? (scheduledCount / fixtures.length) * 100 : 0}%` }} /></div> : null}
    <nav className="step5-demo-tabs" role="tablist" aria-label={mode === "schedule" ? "Lập lịch và công bố" : "Phân công trọng tài"}>{visibleTabs.map((item) => <button key={item} type="button" role="tab" aria-selected={tab === item} className={tab === item ? "is-active" : ""} onClick={() => { setTab(item); setSelectedFixture(null); }}>{tabLabels[item]}</button>)}</nav>
    <p className="step5-demo-mode-note">Dữ liệu nghiệp vụ kiểm thử được lưu trong snapshot riêng trên Match Service, cô lập theo giải và phiên bản sơ đồ; localStorage chỉ là cache trình duyệt. Không ghi lịch test vào dữ liệu lịch chính thức. {resources.competitionStartDate && resources.competitionEndDate ? `Thời gian giải: ${new Date(`${resources.competitionStartDate}T12:00:00`).toLocaleDateString("vi-VN")} – ${new Date(`${resources.competitionEndDate}T12:00:00`).toLocaleDateString("vi-VN")}.` : "Chưa có khoảng ngày mặc định từ giải; hãy cấu hình thời gian."}</p>
    {tab === "referees" ? <div className="step5-referee-resource-launch"><div><span className="eyebrow">DANH SÁCH VÀ CẤU HÌNH NGUỒN LỰC</span><strong>{refereeResources.referees.length} hồ sơ · {refereeResources.models.length} mô hình · {refereeResources.crews.length} tổ</strong><p>Quản lý nhân sự, vị trí, tổ và khả dụng trong cửa sổ riêng. Chưa gán nguồn lực vào trận tại đây.</p></div><button className="button button-secondary" type="button" onClick={() => setRefereeResourcesOpen(true)}>Nguồn lực trọng tài</button></div> : null}
    {tab === "referees" ? <>
      <div className="step5-method-picker" role="group" aria-label="Phương thức phân công"><button type="button" className={refereeAssignmentMethod === "MANUAL" ? "is-active" : ""} onClick={() => { setRefereeAssignmentMethod("MANUAL"); setSelectedFixture(null); }}>Phân công thủ công<span>Chọn trận và bố trí trọng tài trên sơ đồ</span></button><button type="button" className={refereeAssignmentMethod === "AUTO" ? "is-active" : ""} onClick={() => { setRefereeAssignmentMethod("AUTO"); setSelectedFixture(null); setAutoRefereeError(""); }}>Phân công tự động<span>Tạo đề xuất có giới hạn thời gian; BTC xem lại trước khi áp dụng</span></button></div>
      <section className="step5-referee-policy">
        <div className="panel-heading panel-heading-wrap"><div><span className="eyebrow">CHÍNH SÁCH PHÂN CÔNG</span><h3>Phạm vi và trạng thái phân công</h3></div><span className={`status-pill ${isSchedulePublished ? "status-success" : "status-warning"}`}>{isSchedulePublished ? `Lịch thi đấu đã công bố v${step5.scheduleVersion ?? 1}` : "Lịch thi đấu chưa công bố"}</span></div>
        <p>Lịch là dữ liệu chỉ đọc. Các vòng chưa đến được giữ ngoài phạm vi khi áp dụng theo đợt; không coi chúng là lỗi thiếu phân công.</p>
        <label>Chính sách<select disabled={Boolean(refereePublishedIds.size)} value={step5.refereePolicy?.mode ?? "BY_PERIOD"} onChange={(event) => { const current = readDrawTestState(tournamentId); if (current.step5) writeDrawTestState(tournamentId, { step5: { ...current.step5, refereePolicy: { ...(current.step5.refereePolicy ?? { publicationLeadDays: null }), mode: event.target.value as "BY_PERIOD" | "WHOLE_TOURNAMENT" } } }); }}><option value="BY_PERIOD">Theo vòng / bảng / ngày / đợt</option><option value="WHOLE_TOURNAMENT">Toàn bộ giải</option></select></label>
        <label>Thời điểm chuẩn bị trước trận (ngày)<input disabled={Boolean(refereePublishedIds.size)} type="number" min={0} max={30} value={step5.refereePolicy?.publicationLeadDays ?? ""} placeholder="BTC tự cấu hình" onChange={(event) => { const raw = event.target.value; const days = raw === "" ? null : Math.max(0, Math.min(30, Number(raw))); const current = readDrawTestState(tournamentId); if (current.step5) writeDrawTestState(tournamentId, { step5: { ...current.step5, refereePolicy: { ...(current.step5.refereePolicy ?? { mode: "BY_PERIOD" }), publicationLeadDays: days } } }); }} /><small>Thời hạn là thông tin tham khảo, không khóa các vòng tương lai.</small></label>
        {step5.refereePolicy?.mode !== "WHOLE_TOURNAMENT" ? <fieldset><legend>Vòng / đợt cần phân công</legend><div className="step5-referee-rounds">{rounds.map((round) => <label key={round}><input type="checkbox" checked={refereeScopeRounds.includes(round)} onChange={() => toggleRefereeRound(round)} />{round}</label>)}</div><div className="step5-referee-rounds">{[...new Set(fixtures.map((fixture) => fixture.groupName ?? "Knockout"))].map((group) => <label key={group}><input type="checkbox" checked={refereeScopeGroups.includes(group)} onChange={() => { const current = readDrawTestState(tournamentId); if (current.step5) { const selected = current.step5.refereeScopeGroups ?? []; writeDrawTestState(tournamentId, { step5: { ...current.step5, refereeScopeGroups: selected.includes(group) ? selected.filter((item) => item !== group) : [...selected, group] } }); } }} />{group}</label>)}</div>{refereeScheduleDates.map((date) => <label className="step5-inline-check" key={date}><input type="checkbox" checked={refereeScopeDates.includes(date)} onChange={() => { const current = readDrawTestState(tournamentId); if (current.step5) { const selected = current.step5.refereeScopeDates ?? []; writeDrawTestState(tournamentId, { step5: { ...current.step5, refereeScopeDates: selected.includes(date) ? selected.filter((item) => item !== date) : [...selected, date] } }); } }} />{new Date(`${date}T12:00:00`).toLocaleDateString("vi-VN")}</label>)}{!refereeScopeRounds.length ? <small>Chọn ít nhất một vòng. Chỉ các trận thuộc phạm vi được yêu cầu xét công bố.</small> : null}</fieldset> : null}
        <div className="step5-referee-publish-row"><span>{refereeTargetWithSchedule.length}/{refereeTargetFixtures.length} trận trong phạm vi đã có lịch · {refereeTargetFixtures.filter((fixture) => refereePositionReady(fixture.id)).length}/{refereeTargetFixtures.length} đủ vị trí bắt buộc</span><button className="button button-primary" type="button" disabled={!isSchedulePublished || !refereeReady || refereeTargetFixtures.every((fixture) => refereePublishedIds.has(fixture.id))} onClick={() => void publishReferees()}>Công bố phân công trọng tài</button></div>
        {!isSchedulePublished ? <small>Bản nháp có thể được chuẩn bị theo chính sách toàn giải; chỉ công bố sau khi lịch chính thức có hiệu lực.</small> : null}
      </section>
      {refereeDraftSignatureStale ? <div className="form-error"><p>Lịch hoặc nguồn lực đã thay đổi sau khi lưu phân công. Hãy xác minh lại trước khi công bố.</p><button className="button button-secondary" type="button" onClick={verifyRefereeDraft}>Xác minh lại theo lịch và nguồn lực</button></div> : null}
      {refereeAssignmentMethod === "AUTO" ? <DrawDemoAutomaticRefereeAssignmentPanel
        fixtures={fixtures}
        schedules={refereeSchedule}
        assignments={refereeAssignments}
        publishedFixtureIds={[...refereePublishedIds]}
        policyMode={step5.refereePolicy?.mode ?? "BY_PERIOD"}
        policyRounds={refereeScopeRounds}
        policyGroups={refereeScopeGroups}
        policyDates={refereeScopeDates}
        running={autoRefereeRunning}
        error={autoRefereeError}
        onRun={runAutomaticRefereeAssignment}
        onApply={applyAutomaticRefereeAssignment}
        onCancel={() => setAutoRefereeError("")}
      /> : null}
    </> : null}
    {tab === "schedule" ? <div className="step5-method-picker" role="group" aria-label="Phương thức lập lịch"><button type="button" className={method === "MANUAL" ? "is-active" : ""} onClick={() => { setMethod("MANUAL"); setSelectedFixture(null); }}>Lập lịch thủ công<span>Chọn ngày, sân và khung giờ trên sơ đồ</span></button><button type="button" className={method === "AUTO" ? "is-active" : ""} disabled={isPublished} onClick={() => { setMethod("AUTO"); setSelectedFixture(null); }}>Lập lịch tự động<span>Tạo đề xuất có kiểm tra ràng buộc; BTC duyệt áp dụng vào bản nháp</span></button></div> : null}
    {tab === "schedule" && method === "AUTO" ? <DrawDemoAutomaticSchedulePanel configuration={autoConfiguration} preview={autoPreview} fixtures={fixtures} teams={teams} currentEntries={visibleEntries} resources={resources} pitchType={footballFormat} running={autoRunning} disabled={isPublished} error={saveError} onChange={changeAutoConfiguration} onRun={() => void runAutomaticSchedule()} onCancel={cancelAutomaticPreview} /> : null}
    {tab === "schedule" && method === "MANUAL" && resources.requireSimultaneousGroupFinalRound && finalRoundGroups.some((group) => group.fixtures.length > 1) ? <section className="step5-final-round-cluster"><div><span className="eyebrow">LỊCH CỤM VÒNG CUỐI</span><h3>Xếp các trận cùng giờ</h3><p>Các trận của bảng được lưu nguyên tử, cùng ngày/giờ bắt đầu và dùng sân khác nhau.</p></div><label>Bảng<select value={clusterGroup} onChange={(event) => { setClusterGroup(event.target.value); setClusterChoiceKey(""); }}><option value="">Chọn bảng vòng cuối</option>{finalRoundGroups.filter((group) => group.fixtures.length > 1).map((group) => <option key={group.groupName} value={group.groupName}>{group.groupName} · cần {group.fixtures.length} sân</option>)}</select></label><label>Ngày và giờ chung<select disabled={!clusterGroup} value={clusterChoiceKey} onChange={(event) => setClusterChoiceKey(event.target.value)}><option value="">Chọn phương án khả dụng</option>{finalRoundOptions.map((option) => <option key={option.scheduledAt + "|" + option.slotId} value={option.scheduledAt + "|" + option.slotId}>{new Date(option.scheduledAt).toLocaleString("vi-VN")} · {option.slotLabel} · {option.venues.length} sân</option>)}</select></label><button className="button button-primary" type="button" disabled={!selectedClusterOption || isPublished} onClick={() => void saveFinalRoundCluster()}>Lưu lịch cụm</button>{clusterGroup && !finalRoundOptions.length ? <p className="form-error">Không đủ nguồn lực cho toàn cụm {selectedFinalGroup?.fixtures.length ?? 0} trận: cần số sân riêng biệt tương ứng, cùng giờ khả dụng và không xung đột với lịch hiện có. Hiện có {activeVenues.length} sân phù hợp loại {footballFormat} người.</p> : null}</section> : null}
    <details className="step5-schedule-statistics"><summary onClick={(event) => { event.preventDefault(); setShowStats((current) => !current); }}>{showStats ? "Ẩn thống kê chi tiết" : "Thống kê theo ngày, sân, bảng và đội"}</summary>{showStats ? <div className="step5-schedule-statistics-grid"><section><h3>Theo ngày</h3>{Object.entries(scheduleStats.byDate).map(([key, count]) => <p key={key}>{new Date(key + "T12:00:00").toLocaleDateString("vi-VN")}: <b>{count}</b> trận</p>)}</section><section><h3>Theo sân</h3>{Object.entries(scheduleStats.byVenue).map(([key, count]) => <p key={key}>{key}: <b>{count}</b> trận</p>)}</section><section><h3>Theo bảng / vòng</h3>{Object.entries(scheduleStats.byGroup).map(([key, count]) => <p key={key}>{key}: <b>{count}</b> trận</p>)}{Object.entries(scheduleStats.byRound).map(([key, count]) => <p key={key}>{key}: <b>{count}</b> trận</p>)}</section><section><h3>Nghỉ và công bằng</h3><p>{scheduleStats.teamsWithSchedules} đội có lịch đã xác định</p><p>Nghỉ ngắn nhất: {scheduleStats.shortestRestMinutes === null ? "Chưa đủ dữ liệu" : Math.round(scheduleStats.shortestRestMinutes) + " phút"}</p><p>Nghỉ dài nhất: {scheduleStats.longestRestMinutes === null ? "Chưa đủ dữ liệu" : Math.round(scheduleStats.longestRestMinutes) + " phút"}</p>{objectiveWarnings.filter((issue) => issue.severity !== "HARD").slice(0, 8).map((issue, index) => <p className="schedule-objective-warning" key={issue.fixtureId + issue.code + index}>{issue.message}</p>)}</section></div> : null}</details>
    <details className="step5-schedule-statistics"><summary>Số trận đã lập theo từng đội</summary><div className="step5-schedule-statistics-grid"><section>{Object.entries(scheduleStats.byTeam).map(([teamId, count]) => <p key={teamId}>{teamNames.get(teamId) ?? teamId}: <b>{count}</b> trận</p>)}{!Object.keys(scheduleStats.byTeam).length ? <p>Chưa có trận nào được lập lịch.</p> : null}</section></div></details>
    <div className="step5-demo-body">
      <div className="step5-demo-diagram"><DrawDemoFixtureWorkspace tournamentId={tournamentId} tournamentName={tournamentName} readOnly publishedState={state} teams={teams} diagramOnly scheduleByFixture={tab === "referees" ? refereeDiagramSchedule : visibleEntries} scheduleDisplayByFixture={scheduleDisplayByFixture} refereeDisplayByFixture={tab === "referees" ? refereeDisplayByFixture : undefined} onFixtureSelect={selectFixture} /></div>
      <aside className="step5-demo-detail" aria-live="polite"><span className="eyebrow">{tab === "schedule" ? method === "AUTO" ? "LẬP LỊCH TỰ ĐỘNG · XEM ĐỀ XUẤT" : "LẬP LỊCH THỦ CÔNG" : tab === "referees" ? "PHÂN CÔNG TRỌNG TÀI" : "KIỂM TRA TRẬN ĐẤU"}</span><h3>{selectedTitle}</h3>
        {!selectedFixture || !currentEntry ? <p>{tab === "schedule" ? "Chọn một trận trên sơ đồ để xem lịch hoặc lập lịch thủ công." : "Chọn một trận trên sơ đồ để nhập hoặc xem thông tin của tab hiện tại."}</p> : <>
          <div className="step5-fixture-contestants"><b>{teamNames.get(selectedFixture.homeTeamId ?? "") ?? selectedFixture.homeSource ?? "Chờ xác định"}</b><span>VS</span><b>{teamNames.get(selectedFixture.awayTeamId ?? "") ?? selectedFixture.awaySource ?? "Chờ xác định"}</b></div>
            {tab === "schedule" && method === "AUTO" ? <div className="step5-auto-fixture-preview">{autoPreview?.scheduledFixtureIds.includes(selectedFixture.id) ? <><span className="status-pill status-warning">Lịch giả lập · Chưa xác nhận</span><strong>{new Date(currentEntry.scheduledAt).toLocaleDateString("vi-VN")} · {timeLabel(currentEntry.scheduledAt)}</strong><span>{resources.venues.find((venue) => venue.code === currentEntry.venue || venue.name === currentEntry.venue)?.name ?? currentEntry.venue}</span><small>Phương án đang hiển thị trên sơ đồ và được lưu riêng trên Match Service; lịch nháp chưa thay đổi.</small></> : currentEntry.scheduledAt && currentEntry.venue ? <><span className="status-pill status-success">Lịch nháp được giữ nguyên</span><strong>{new Date(currentEntry.scheduledAt).toLocaleDateString("vi-VN")} · {timeLabel(currentEntry.scheduledAt)}</strong><span>{resources.venues.find((venue) => venue.code === currentEntry.venue || venue.name === currentEntry.venue)?.name ?? currentEntry.venue}</span></> : <p>Trận này chưa có lịch trong phương án hiện tại. Xem lý do các trận còn thiếu trong phần kết quả.</p>}</div> : tab === "schedule" ? <>
            {!editing && currentEntry.scheduledAt && currentEntry.venue ? <>
              <div className="step5-schedule-summary"><span className={`step5-schedule-state ${currentEntry.locked ? "is-locked" : "is-scheduled"}`}>{currentEntry.locked ? "Đã khóa lịch" : "Đã lập lịch"}</span><strong>{new Date(currentEntry.scheduledAt).toLocaleDateString("vi-VN")}</strong><span>{timeLabel(currentEntry.scheduledAt)}–{timeLabel(new Date(new Date(currentEntry.scheduledAt).getTime() + matchPlayDuration(selectedFixture) * 60_000).toISOString())}</span><span>{selectedVenue?.name ?? currentEntry.venue} · {selectedVenue?.location ?? ""}</span></div>
              <p className="form-help">{matchPlayDuration(selectedFixture)} phút thi đấu · {occupiedDuration(selectedFixture, currentEntry.venue)} phút sân bị chiếm dụng (chuẩn bị, trận, chuyển tiếp và thu hồi sân).</p>
              {currentEntry.notes ? <p><b>Ghi chú:</b> {currentEntry.notes}</p> : null}
              {!isPublished ? <div className="step5-schedule-actions"><button className="button button-secondary" type="button" disabled={currentEntry.locked} onClick={() => { setDraft({ date: currentEntry.scheduledAt.slice(0, 10), venue: currentEntry.venue, scheduledAt: currentEntry.scheduledAt, notes: currentEntry.notes }); setEditing(true); }}>Chỉnh sửa lịch</button><button className="button button-secondary" type="button" onClick={() => void toggleLock()}>{currentEntry.locked ? "Mở khóa lịch" : "Khóa lịch"}</button><button className="button button-danger" type="button" disabled={currentEntry.locked} onClick={() => void deleteSchedule()}>Xóa lịch</button></div> : null}
            </> : <>
              {currentEntry.locked ? <p className="form-help">Lịch đang khóa. Mở khóa trước khi chỉnh sửa.</p> : null}
              <div className="step5-duration-breakdown"><strong>Thời lượng dự kiến</strong><span>{matchPlayDuration(selectedFixture)} phút thi đấu · {occupiedDuration(selectedFixture, draft.venue || currentEntry.venue)} phút sân chiếm dụng</span><small>Thời điểm đã chọn là giờ bắt đầu trận. Thời gian chuẩn bị được tính trước giờ bắt đầu; chuyển tiếp và thu hồi sân được tính sau trận.</small></div>
              <label>1 · Chọn ngày thi đấu<select disabled={isPublished || staleStep5Snapshot || currentEntry.locked} value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value, venue: "", scheduledAt: "" })}><option value="">Chọn ngày còn phương án hợp lệ</option>{dateOptions.map((date) => <option key={date} value={date}>{new Date(`${date}T12:00:00`).toLocaleDateString("vi-VN", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" })}</option>)}</select></label>
              <label>2 · Chọn sân khả dụng<select disabled={!draft.date || isPublished || currentEntry.locked} value={draft.venue} onChange={(event) => setDraft({ ...draft, venue: event.target.value, scheduledAt: "" })}><option value="">Chọn sân {footballFormat} người</option>{venueOptions.map((venue) => <option key={venue.id} value={venue.code}>{venue.name} · {venue.location}</option>)}</select></label>
              <label>3 · Chọn khung giờ khả dụng<select disabled={!draft.date || !draft.venue || isPublished || currentEntry.locked} value={draft.scheduledAt} onChange={(event) => setDraft({ ...draft, scheduledAt: event.target.value })}><option value="">Chọn giờ bắt đầu</option>{timeOptions.map((candidate) => <option key={`${candidate.slotId}-${candidate.scheduledAt}`} value={candidate.scheduledAt}>{candidate.slotLabel} · {timeLabel(candidate.scheduledAt)}–{candidate.endAt}</option>)}</select></label>
              {selectedChoice ? <div className="step5-estimated-end"><span>Giờ kết thúc dự kiến</span><strong>{selectedChoice.endAt}</strong><small>{selectedChoice.venue.name} · {selectedChoice.venue.location}</small></div> : null}
              <label>Ghi chú<textarea disabled={isPublished || staleStep5Snapshot || currentEntry.locked} rows={2} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
              {!dateOptions.length ? <p className="form-error">Không còn phương án lịch hợp lệ. Kiểm tra ngày thi đấu, khung giờ, sân, thời gian nghỉ, số trận/ngày hoặc lịch các trận nguồn.</p> : null}
              {draft.date && !venueOptions.length ? <p className="form-error">Không còn sân phù hợp trong ngày đã chọn. Thử ngày khác hoặc cập nhật thời gian khả dụng của sân.</p> : null}
              {draft.venue && !timeOptions.length ? <p className="form-error">Sân này không còn khung giờ hợp lệ do lịch sân, đội tham gia, thời gian nghỉ, trọng tài hoặc trận phụ thuộc.</p> : null}
              {saveError ? <p className="form-error" role="alert">{saveError}</p> : null}
              <div className="step5-schedule-actions"><button className="button button-primary" type="button" disabled={!selectedChoice || isPublished || staleStep5Snapshot || currentEntry.locked} onClick={() => void saveManualEntry()}>Lưu lịch</button>{currentEntry.scheduledAt && !currentEntry.locked ? <button className="button button-secondary" type="button" onClick={() => setEditing(false)}>Hủy chỉnh sửa</button> : null}{!activeVenues.length ? <button type="button" className="text-button" onClick={() => setSettingsSection("venues")}>Thêm sân khả dụng</button> : null}</div>
            </>}
            {constraintIssues.filter((issue) => issue.fixtureId === selectedFixture.id).map((issue) => <p className="form-error" role="alert" key={`${issue.code}-${issue.message}`}>{issue.message}</p>)}
          </> : null}
          {tab === "referees" && refereeAssignmentMethod === "MANUAL" ? <DrawDemoManualRefereeAssignmentPanel key={selectedFixture.id} fixture={selectedFixture} schedule={refereeSchedule[selectedFixture.id] ?? emptyEntry()} schedulePublished={isSchedulePublished} policyMode={step5.refereePolicy?.mode ?? "BY_PERIOD"} format={footballFormat} resources={resources} roster={refereeResources} fixtures={fixtures} schedules={refereeSchedule} assignmentsByFixture={refereeAssignments} publishedAssignmentsByFixture={publishedRefereeAssignments} publishedFixtureIds={refereePublishedIds} assignments={refereeAssignments[selectedFixture.id] ?? []} lockedSlotKeys={step5.lockedRefereeSlotKeysByFixture?.[selectedFixture.id] ?? []} matchLocked={(step5.refereeLockedFixtureIds ?? []).includes(selectedFixture.id)} onSave={(rows, baseSignature) => saveRefereeFixtureAssignments(selectedFixture.id, rows, baseSignature)} onDelete={(baseSignature) => deleteRefereeFixtureDraft(selectedFixture.id, baseSignature)} onToggleSlot={(key) => toggleRefereeSlotLock(selectedFixture.id, key)} onToggleMatch={() => toggleRefereeMatchLock(selectedFixture.id)} teamById={new Map(teams.map((team) => [team.teamId, team]))} /> : tab === "referees" ? <div className="step5-demo-checklist"><p><b>Lịch:</b> {currentEntry.scheduledAt && currentEntry.venue ? `${new Date(currentEntry.scheduledAt).toLocaleString("vi-VN")} · ${selectedVenue?.name ?? currentEntry.venue}` : "Chưa hoàn tất"}</p><p><b>Trọng tài:</b> {refereeAssignments[selectedFixture.id]?.map((assignment) => assignment.refereeName).filter(Boolean).join(", ") || "Chưa phân công"}</p><p><b>Trạng thái phân công:</b> {refereeStatus(selectedFixture.id)}</p><p>Đang ở chế độ tạo đề xuất. Chọn phạm vi và bấm “Tạo đề xuất phân công”; kết quả chỉ áp dụng sau khi BTC xác nhận trong panel.</p></div> : <div className="step5-demo-checklist"><p><b>Lịch:</b> {currentEntry.scheduledAt && currentEntry.venue ? `${new Date(currentEntry.scheduledAt).toLocaleString("vi-VN")} · ${selectedVenue?.name ?? currentEntry.venue}` : "Chưa hoàn tất"}</p><p><b>Trọng tài:</b> {refereeAssignments[selectedFixture.id]?.map((assignment) => assignment.refereeName).filter(Boolean).join(", ") || "Chưa phân công"}</p><p><b>Trạng thái lịch:</b> {isSchedulePublished ? "Đã công bố" : currentEntry.scheduledAt && currentEntry.venue ? "Lịch nháp" : "Chưa hoàn tất"}</p><p><b>Trạng thái phân công:</b> {refereeStatus(selectedFixture.id)}</p><p><b>Điều hành trận:</b> {refereePublishedIds.has(selectedFixture.id) && refereePositionReady(selectedFixture.id) ? "Đủ vị trí bắt buộc đã công bố" : "Chưa thể bắt đầu điều hành"}</p></div>}
          {tab === "schedule" && isSchedulePublished ? <span className="status-pill status-success">Lịch chính thức v{step5.scheduleVersion ?? 1} · công bố {step5.schedulePublishedAt ? new Date(step5.schedulePublishedAt).toLocaleString("vi-VN") : ""} bởi {step5.schedulePublishedBy ?? "BTC"} · chỉ đọc</span> : null}
        </>}
      </aside>
    </div>
    {tab === "review" ? <section className="step5-demo-publish"><div>
      <span className="eyebrow">HOÀN TẤT LỊCH THI ĐẤU</span><h3>Kiểm tra và công bố</h3>
      <div className="step5-review-stats"><article><span>Tổng trận</span><strong>{fixtures.length}</strong></article><article><span>Đã lưu</span><strong>{scheduledCount}</strong></article><article><span>Đã khóa</span><strong>{lockedScheduleCount}</strong></article><article><span>Đang giả lập</span><strong>{autoPreview?.scheduledFixtureIds.length ?? 0}</strong></article><article><span>Còn thiếu</span><strong>{fixtures.length - scheduledCount}</strong></article><article><span>Lỗi / cảnh báo</span><strong>{allValidationIssues.length} / {objectiveWarnings.filter((issue) => issue.severity !== "HARD").length}</strong></article></div>
      <p>Lịch công khai được tạo theo đúng phiên bản sơ đồ Bước 4. Trọng tài không bắt buộc trước khi công bố; dữ liệu phân công không được chép vào lịch thi đấu.</p>
      <span className={scheduleReady ? "status-pill status-success" : "status-pill status-warning"}>{isSchedulePublished ? `Đã công bố lịch v${step5.scheduleVersion ?? 1}` : scheduleReady ? "Lịch đủ điều kiện công bố" : "Cần xử lý vấn đề trước khi công bố"}</span>
      {Object.entries(groupedReviewIssues).map(([code, issues]) => <details className="step5-validation-summary" key={code}><summary>{code} · {issues.length} vấn đề · {new Set(issues.map((issue) => issue.fixtureId).filter(Boolean)).size} trận</summary>{issues.map((issue, index) => <p key={`${issue.fixtureId}-${issue.code}-${index}`}>{issue.fixtureId ? <b>{issue.fixtureId}: </b> : null}{issue.message}</p>)}</details>)}
      {isSchedulePublished ? <p>Đã công bố lúc {new Date(step5.schedulePublishedAt ?? step5.publishedAt!).toLocaleString("vi-VN")} · {step5.schedulePublishedBy ?? "BTC"} · sơ đồ {snapshotKey} · phiên bản lịch {step5.scheduleVersion ?? 1}. Bước 6 sử dụng nguyên fixture ID, vòng, đội/nguồn và khoảng chiếm dụng của bản này.</p> : null}
      </div><button className="button button-primary" type="button" disabled={!scheduleReady || isPublished} onClick={() => void publishSchedule()}>{isPublished ? "Lịch thi đấu đã công bố" : "Kiểm tra & công bố"}</button></section> : null}
    <DrawDemoScheduleSettingsPanel section={settingsSection} resources={resources} pitchType={footballFormat} competitionFormat={competitionFormat} regulation={regulation ?? null} startDate={startDate} endDate={endDate} tournamentId={tournamentId} tournamentName={tournamentName} diagramVersion={snapshotKey} fixtures={fixtures} scheduleByFixture={setupScheduleEntries} readOnly={isSchedulePublished} onClose={() => setSettingsSection(null)} onGoToVenues={() => { setActiveStage(1); setSettingsSection(null); }} onGoToTournamentInfo={onGoToTournamentInfo} onApply={saveResources} />
    <DrawDemoRefereeResourcesPanel open={refereeResourcesOpen} state={refereeResources} fixtures={fixtures} matchKinds={[...new Set(fixtures.map((fixture) => `${fixture.stage === "GROUP" ? "Vòng bảng" : "Knockout"}${fixture.groupName ? ` · ${fixture.groupName}` : ""}`))]} protectedRefereeNames={Object.values(publishedRefereeAssignments).flat().map((assignment) => assignment.refereeName)} protectedPositionIds={Object.values(publishedRefereeAssignments).flat().map((assignment) => assignment.positionId)} onClose={() => setRefereeResourcesOpen(false)} onSave={saveRefereeResources} />
  </section>;
}



