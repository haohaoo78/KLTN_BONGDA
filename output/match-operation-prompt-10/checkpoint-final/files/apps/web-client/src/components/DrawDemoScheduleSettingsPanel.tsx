import { createContext, useCallback, useEffect, useMemo, useState, useContext } from "react";
import { analyzeScheduleSetup as analyzeScheduleSetupTest } from "../api/testWorkflow";
import { analyzeScheduleSetup as analyzeScheduleSetupShared, normalizeScheduleDecisionTiming, type ScheduleSetupAnalysis, type ScheduleSetupTournamentContext } from "../../../../packages/shared/src/scheduleSetupAnalysis";
import type { TournamentRules } from "../api/competition";
import { Step5VenueAvailabilityWorkspace } from "./Step5VenueAvailabilityWorkspace";
import "./schedule-setup.css";
import type { DemoFixture, DemoMatchTimingProfile, DemoScheduleEntry, DemoScheduleResources, ScheduleSettingProvenance } from "../utils/drawTestStorage";

type Section = "overview" | "time" | "duration" | "conditions" | "format" | "objectives" | "capacity" | "venues";
type Props = {
  section: Section | null;
  resources: DemoScheduleResources;
  pitchType: 5 | 7 | 11;
  competitionFormat: "ROUND_ROBIN" | "GROUP_AND_KNOCKOUT" | "KNOCKOUT";
  regulation: TournamentRules | null;
  startDate?: string | null;
  endDate?: string | null;
  tournamentId: string;
  tournamentName: string;
  diagramVersion: string;
  formatMismatchText?: string;
  fixtures: DemoFixture[];
  scheduleByFixture: Record<string, DemoScheduleEntry>;
  readOnly?: boolean;
  officialMode?: boolean;
  embedded?: boolean;
  onClose: () => void;
  onContinue?: () => void;
  onGoToVenues?: () => void;
  onGoToTournamentInfo?: () => void;
  onAnalyzeSetup?: (resources: DemoScheduleResources) => Promise<ScheduleSetupAnalysis>;
  onApply: (resources: DemoScheduleResources) => Promise<boolean>;
};

type Step5FieldActionState = {
  readOnly: boolean;
  currentResources: DemoScheduleResources;
  pendingConfirmKeys: Set<string>;
  editingSettingKeys: Set<string>;
  invalidSettingKeys: Map<string, string>;
  suggestedResources: DemoScheduleResources | null;
  onConfirm: (key: string) => void;
  onCancelConfirmation: (key: string) => void;
  onEdit: (key: string) => void;
};
const Step5FieldActionContext = createContext<Step5FieldActionState | null>(null);
function fieldProvenance(settingKey: string, provenance?: ScheduleSettingProvenance, actions?: Step5FieldActionState | null) {
  return provenance ?? actions?.currentResources.setupProvenance?.[settingKey] ?? actions?.suggestedResources?.setupProvenance?.[settingKey];
}

const navItems: Array<{ id: Exclude<Section, "venues">; label: string; hint: string }> = [
  { id: "overview", label: "Tổng quan", hint: "Những gì đã có và còn cần xác nhận" },
  { id: "time", label: "Ngày & khung giờ", hint: "Ngày giải, ngày nghỉ, giờ thi đấu" },
  { id: "duration", label: "Thời lượng trận", hint: "Thời gian đá và thời gian dùng sân" },
  { id: "conditions", label: "Nghỉ & di chuyển", hint: "Thời gian hồi phục giữa các trận" },
  { id: "format", label: "Điều kiện theo thể thức", hint: "Vòng tròn, loại trực tiếp, kết hợp" },
  { id: "objectives", label: "Ưu tiên xếp lịch", hint: "Chọn điều BTC muốn ưu tiên" },
  { id: "capacity", label: "Khả năng xếp đủ trận", hint: "So sánh nhu cầu với nguồn lực" },
];
const dayOptions = [{ value: 1, label: "Thứ 2" }, { value: 2, label: "Thứ 3" }, { value: 3, label: "Thứ 4" }, { value: 4, label: "Thứ 5" }, { value: 5, label: "Thứ 6" }, { value: 6, label: "Thứ 7" }, { value: 0, label: "Chủ nhật" }];
const newId = () => `slot-${crypto.randomUUID()}`;
const fieldKey = (section: "groupTiming" | "knockoutTiming", key: keyof DemoMatchTimingProfile) => `${section}.${key}`;
function readSettingValue(resources: DemoScheduleResources | null | undefined, key: string): unknown {
  return resources ? key.split(".").reduce<unknown>((value, part) => value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined, resources) : undefined;
}
function writeSettingValue(resources: DemoScheduleResources, key: string, value: unknown): DemoScheduleResources {
  const [root, child] = key.split(".");
  if (!root) return resources;
  if (!child) return { ...resources, [root]: value } as DemoScheduleResources;
  const current = (resources as unknown as Record<string, unknown>)[root];
  return { ...resources, [root]: { ...(current && typeof current === "object" ? current as Record<string, unknown> : {}), [child]: value } } as DemoScheduleResources;
}
function suggestedValueLabel(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.every((item) => item && typeof item === "object" && "start" in item && "end" in item)) return value.map((item) => `${"label" in (item as object) ? `${String((item as { label: unknown }).label)} ` : ""}${String((item as { start: unknown }).start)}–${String((item as { end: unknown }).end)}`).join(", ");
    return value.length ? `${value.length} mục` : "Chưa có giá trị";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (value && typeof value === "object" && "startDate" in value && "endDate" in value) {
    const range = value as { startDate?: unknown; endDate?: unknown };
    return [range.startDate, range.endDate].filter(Boolean).join(" – ") || "Dùng toàn bộ thời gian giải";
  }
  return value === undefined || value === null ? "" : "Đề xuất có sẵn";
}
const minuteLabel = (value: number) => `${value} phút`;
const sourceLabels: Record<ScheduleSettingProvenance["source"], string> = {
  REGULATION: "Điều lệ",
  CALCULATED: "Hệ thống tính",
  SYSTEM_PROPOSED: "Đề xuất · cần xác nhận",
  ORGANIZER_CONFIRMED: "BTC đã xác nhận",
};

function editableSetupKeys(resources: DemoScheduleResources): string[] {
  const timingKeys = ["halfMinutes", "halftimeBreakMinutes", "preparationBeforeMinutes", "transitionAfterMinutes", "extraTimeReserveMinutes", "penaltyReserveMinutes"];
  return [...new Set([
    ...Object.keys(resources.setupProvenance ?? {}),
    "competitionStartDate", "competitionEndDate", "allowedWeekdays", "slots", "scheduleMode",
    "minimumTeamRestMinutes", "maximumMatchesPerTeamPerDay", "travelBufferMinutes", "maximumRoundsPerDay",
    "maximumRoundsPerDayRequired", "requireSimultaneousGroupFinalRound", "stageDateRanges.GROUP", "stageDateRanges.KNOCKOUT",
    ...timingKeys.map((key) => `groupTiming.${key}`), ...timingKeys.map((key) => `knockoutTiming.${key}`),
  ])];
}

function TimingFields({ title, groupKey, value, onChange, provenance, readOnly, decisionMethod, protectedTiming }: {
  title: string;
  groupKey: "groupTiming" | "knockoutTiming";
  value: DemoMatchTimingProfile;
  onChange: (key: keyof DemoMatchTimingProfile, value: number) => void;
  provenance: Record<string, ScheduleSettingProvenance>;
  readOnly: boolean;
  decisionMethod: TournamentRules["knockoutDecisionMethod"] | undefined;
  protectedTiming: boolean;
}) {
  const actions = useContext(Step5FieldActionContext);
  const usesExtraTime = groupKey === "knockoutTiming" && decisionMethod === "EXTRA_TIME_THEN_PENALTIES";
  const usesPenalties = groupKey === "knockoutTiming" && (usesExtraTime || decisionMethod === "PENALTIES_ONLY");
  const fields: Array<[keyof DemoMatchTimingProfile, string]> = [
    ["halfMinutes", "Mỗi hiệp"], ["halftimeBreakMinutes", "Nghỉ giữa hiệp"],
    ["preparationBeforeMinutes", "Chuẩn bị sân"], ["transitionAfterMinutes", "Chuyển tiếp/dọn sân"],
    ...(usesExtraTime ? [["extraTimeReserveMinutes", "Dự phòng hiệp phụ"]] as Array<[keyof DemoMatchTimingProfile, string]> : []),
    ...(usesPenalties ? [["penaltyReserveMinutes", "Dự phòng penalty"]] as Array<[keyof DemoMatchTimingProfile, string]> : []),
  ];
  const extraTime = usesExtraTime || protectedTiming ? value.extraTimeReserveMinutes : 0;
  const penalties = usesPenalties || protectedTiming ? value.penaltyReserveMinutes : 0;
  const protectedLegacyReserve = protectedTiming && (!usesExtraTime && value.extraTimeReserveMinutes > 0 || !usesPenalties && value.penaltyReserveMinutes > 0);
  const decisionExplanation = groupKey === "groupTiming"
    ? "Vòng bảng/vòng tròn không áp dụng hiệp phụ và penalty; không cộng dự phòng cho hai mục này."
    : decisionMethod === "PENALTIES_ONLY"
      ? "Điều lệ quy định đá luân lưu trực tiếp khi hòa; không thi đấu hiệp phụ và không cộng dự phòng hiệp phụ."
      : usesExtraTime ? "Hiệp phụ lấy đúng thời lượng từ điều lệ; dự phòng penalty được cấu hình riêng."
        : "Điều lệ không áp dụng hiệp phụ hoặc penalty; không cộng dự phòng cho hai mục này.";
  const play = value.halfMinutes * 2 + extraTime + penalties;
  const onField = value.halfMinutes * 2 + value.halftimeBreakMinutes + extraTime + penalties;
  const occupied = onField + value.preparationBeforeMinutes + value.transitionAfterMinutes;
  const timelineSegments = [
    { key: "prep", label: "Chuẩn bị", value: value.preparationBeforeMinutes, color: "prep" },
    { key: "play", label: "Thi đấu & dự phòng", value: onField, color: "play" },
    { key: "handoff", label: "Chuyển tiếp", value: value.transitionAfterMinutes, color: "transition" },
  ].filter((item) => item.value > 0);
  return <section className="step5-setup-duration-card">
    <header><div><h3>{title}</h3><p><b>2 hiệp</b> theo luật thi đấu bóng đá. Điều chỉnh chỉ mở cho thông số không bị điều lệ khóa; giá trị đề xuất cần BTC xác nhận.</p></div><span className="step5-setup-pill">{minuteLabel(occupied)} chiếm sân</span></header>
    <div className="step5-setup-fields">{fields.map(([key, label]) => {
      const settingKey = fieldKey(groupKey, key);
      const meta = fieldProvenance(settingKey, provenance[settingKey], actions);
      const regulationLocked = meta?.source === "REGULATION" && meta.adjustable === false;
      const editing = actions?.editingSettingKeys.has(settingKey) ?? true;
      return <div className="step5-field-control" key={key}>
        <label className="step5-setup-field">
          <span>{label}<small>{meta?.explanation ?? "Chưa có giá trị nguồn xác định."}</small></span>
          <div><input type="number" min={0} max={240} value={value[key]} data-setting-input={settingKey} aria-invalid={actions?.invalidSettingKeys.has(settingKey) || undefined} disabled={readOnly || regulationLocked || !editing}
            onChange={(event) => onChange(key, Number(event.target.value))} /><em>phút</em></div>
        </label>
        <FieldStateActions settingKey={settingKey} provenance={meta} valueExists={Number.isFinite(value[key])} />
      </div>;
    })}</div>
    <small>{decisionExplanation}</small>
    {protectedLegacyReserve ? <small className="form-error">Cấu hình đã lưu còn thời gian dự phòng khác điều lệ và đang được lịch đã khóa/công bố sử dụng. Hệ thống giữ nguyên thời lượng đã lưu; chỉ cập nhật qua quy trình thay đổi nguồn lực hợp lệ.</small> : null}
    <div className="step5-setup-timing-summary">
      <div className="step5-setup-timeline" aria-label={`Timeline ${title}`}>{timelineSegments.map((segment) => <span key={segment.key} className={segment.color} style={{ flexGrow: segment.value }} title={`${segment.label}: ${segment.value} phút`} />)}</div>
      <div className="step5-setup-duration-metrics"><span>Thời gian thi đấu <b>{minuteLabel(play)}</b></span><span>Kết thúc dự kiến sau kickoff <b>{minuteLabel(onField)}</b></span><span>Sân dùng lại sau <b>{minuteLabel(occupied)}</b></span></div>
      <small>Thời gian thi đấu không gồm chuẩn bị sân và chuyển tiếp. Khoảng chiếm dụng gồm chuẩn bị + thi đấu/giải quyết hòa + chuyển tiếp, cộng thêm chuyển tiếp riêng của từng sân.</small>
    </div>
  </section>;
}

function ProvenanceBadge({ value }: { value?: ScheduleSettingProvenance }) {
  if (!value) return <span className="step5-setup-source is-missing">Chưa xác định</span>;
  const label = value.source === "ORGANIZER_CONFIRMED" && !value.confirmed ? "BTC đã chỉnh · chờ xác nhận" : sourceLabels[value.source];
  return <span className={`step5-setup-source source-${value.source.toLowerCase()} ${value.confirmed ? "is-confirmed" : "is-pending"}`}>{label}</span>;
}

function FieldStateActions({ settingKey, provenance, valueExists = true, invalidMessage, canEdit = true, blockedReason, blockedAction }: {
  settingKey: string;
  provenance?: ScheduleSettingProvenance;
  valueExists?: boolean;
  invalidMessage?: string;
  canEdit?: boolean;
  blockedReason?: string;
  blockedAction?: { label: string; onClick: () => void };
}) {
  const actions = useContext(Step5FieldActionContext);
  if (!actions) return <ProvenanceBadge value={provenance} />;
  const effectiveProvenance = fieldProvenance(settingKey, provenance, actions);
  const regulationLocked = effectiveProvenance?.source === "REGULATION" && effectiveProvenance.adjustable === false;
  const blocked = !canEdit;
  const isProposal = Boolean(effectiveProvenance && (effectiveProvenance.source === "SYSTEM_PROPOSED" || effectiveProvenance.source === "CALCULATED" || effectiveProvenance.source === "ORGANIZER_CONFIRMED") && !effectiveProvenance.confirmed);
  const awaitingSave = actions.pendingConfirmKeys.has(settingKey);
  const error = invalidMessage ?? actions.invalidSettingKeys.get(settingKey);
  const disabled = actions.readOnly || Boolean(error);
  const suggestedValue = readSettingValue(actions.suggestedResources, settingKey);
  const hasSuggestedValue = settingValueExists(actions.suggestedResources ?? ({} as DemoScheduleResources), settingKey);
  const hasCurrentValue = valueExists && settingValueExists(actions.currentResources, settingKey);
  const canUseValue = hasCurrentValue || hasSuggestedValue;
  const suggestedDiffers = hasSuggestedValue && JSON.stringify(suggestedValue) !== JSON.stringify(readSettingValue(actions.currentResources, settingKey));
  return <div className="step5-field-state-actions" data-setting-key={settingKey}>
    <div className="step5-field-state-status">
      {awaitingSave ? <span className="step5-setup-source source-organizer_confirmed is-pending">Chờ lưu xác nhận</span> : <ProvenanceBadge value={effectiveProvenance} />}
      {regulationLocked ? <span className="step5-field-locked" title={effectiveProvenance?.explanation}>🔒 Khóa theo điều lệ{effectiveProvenance?.explanation ? ` · ${effectiveProvenance.explanation}` : ""}</span> : null}
      {blocked ? <span className="step5-field-locked">🔒 {blockedReason ?? "Chưa đủ dữ liệu để chỉnh thông số này."}{blockedAction && !actions.readOnly ? <button type="button" className="text-button" onClick={blockedAction.onClick}>{blockedAction.label} →</button> : null}</span> : null}
      {actions.readOnly ? <span className="step5-field-locked">🔒 Lịch đã công bố</span> : null}
      {error ? <span className="step5-field-invalid" role="alert">Giá trị chưa hợp lệ · {error}</span> : null}
      {isProposal && hasSuggestedValue && suggestedDiffers ? <span className="step5-field-suggestion">Hệ thống đề xuất: {suggestedValueLabel(suggestedValue)}</span> : null}
    </div>
    {!regulationLocked && !blocked && !actions.readOnly ? <div className="step5-field-action-buttons">
      {canUseValue ? <button type="button" className="text-button" onClick={() => actions.onEdit(settingKey)}>{actions.editingSettingKeys.has(settingKey) ? "Đang chỉnh sửa" : "Chỉnh sửa"}</button> : <button type="button" className="text-button" onClick={() => actions.onEdit(settingKey)}>Thiết lập ngay</button>}
      {isProposal && canUseValue ? awaitingSave
        ? <button type="button" className="text-button" onClick={() => actions.onCancelConfirmation(settingKey)}>Hủy xác nhận</button>
        : <button type="button" className="button button-secondary" disabled={disabled} onClick={() => actions.onConfirm(settingKey)}>Xác nhận</button>
        : null}
    </div> : null}
  </div>;
}

export function DrawDemoScheduleSettingsPanel({
  section, resources, pitchType, competitionFormat, regulation, startDate, endDate, tournamentId, tournamentName, diagramVersion, formatMismatchText,
  fixtures, scheduleByFixture, readOnly = false, officialMode = false, embedded = false, onClose, onContinue, onGoToVenues, onGoToTournamentInfo, onAnalyzeSetup, onApply,
}: Props) {
  const timingTournament = useMemo<ScheduleSetupTournamentContext>(() => ({
    tournamentId, name: tournamentName, status: "PREPARING", startDate: startDate ?? null, endDate: endDate ?? null,
    location: null, footballFormat: pitchType, competitionFormat,
    teamCount: new Set(fixtures.flatMap((fixture) => [fixture.homeTeamId, fixture.awayTeamId]).filter((id): id is string => Boolean(id))).size,
    regulationVersion: regulation?.publishedVersion ?? null, rules: regulation,
  }), [competitionFormat, endDate, fixtures, pitchType, regulation, startDate, tournamentId, tournamentName]);
  const protectedTimingStages = useMemo(() => new Set(fixtures.filter((fixture) => {
    const entry = scheduleByFixture[fixture.id];
    return Boolean(entry?.locked || entry?.officialStatus === "PUBLISHED");
  }).map((fixture) => fixture.stage)), [fixtures, scheduleByFixture]);
  const normalizedResources = useMemo(() => normalizeScheduleDecisionTiming(timingTournament, resources, protectedTimingStages), [timingTournament, resources, protectedTimingStages]);
  const [draft, setDraft] = useState(normalizedResources);
  const [activeSection, setActiveSection] = useState<Exclude<Section, "venues">>(section && section !== "venues" ? section : "overview");
  const [newBlockedDate, setNewBlockedDate] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [analysis, setAnalysis] = useState<ScheduleSetupAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const [pendingConfirmKeys, setPendingConfirmKeys] = useState<string[]>([]);
  const [editingSettingKeys, setEditingSettingKeys] = useState<string[]>(() => editableSetupKeys(resources));
  const [pendingFocusSettingKey, setPendingFocusSettingKey] = useState("");
  const [saveNotice, setSaveNotice] = useState("");
  const hasKnockout = fixtures.some((fixture) => fixture.stage === "KNOCKOUT");
  const hasGroups = fixtures.some((fixture) => fixture.stage === "GROUP");
  const provenance = draft.setupProvenance ?? {};
  const suggestedResources = analysis?.suggestedResources ?? null;
  const effectiveProvenance = { ...(suggestedResources?.setupProvenance ?? {}), ...provenance };
  const isRelevantProvenanceKey = (key: string) => {
    if (key === "groupTiming.extraTimeReserveMinutes" || key === "groupTiming.penaltyReserveMinutes") return false;
    if (key === "knockoutTiming.extraTimeReserveMinutes") return hasKnockout && regulation?.knockoutDecisionMethod === "EXTRA_TIME_THEN_PENALTIES";
    if (key === "knockoutTiming.penaltyReserveMinutes") return hasKnockout && (regulation?.knockoutDecisionMethod === "PENALTIES_ONLY" || regulation?.knockoutDecisionMethod === "EXTRA_TIME_THEN_PENALTIES");
    return key.startsWith("groupTiming.") ? hasGroups : key.startsWith("knockoutTiming.") ? hasKnockout : true;
  };
  const relevantProvenance = Object.entries(effectiveProvenance).filter(([key]) => isRelevantProvenanceKey(key));
  const pendingConfirmSet = new Set(pendingConfirmKeys);
  const isAwaitingConfirmation = (item?: ScheduleSettingProvenance) => Boolean(item && (item.source === "SYSTEM_PROPOSED" || item.source === "CALCULATED" || item.source === "ORGANIZER_CONFIRMED") && !item.confirmed);
  const proposalEntries = relevantProvenance.filter(([, item]) => isAwaitingConfirmation(item));
  const unresolved = proposalEntries.filter(([key]) => !pendingConfirmSet.has(key));
  const unresolvedWithoutValue = unresolved.filter(([key]) => !settingValueExists(draft, key) && !settingValueExists(suggestedResources ?? ({} as DemoScheduleResources), key));
  const proposalCandidate = (key: string, base: DemoScheduleResources = draft) => {
    const source = effectiveProvenance[key];
    const shouldUseSystemSuggestion = (source?.source === "SYSTEM_PROPOSED" || source?.source === "CALCULATED")
      && settingValueExists(suggestedResources ?? ({} as DemoScheduleResources), key);
    return shouldUseSystemSuggestion ? writeSettingValue(base, key, readSettingValue(suggestedResources, key)) : base;
  };
  const validationIssues = getDraftValidationIssues(draft).filter((issue) => {
    if (!isRelevantProvenanceKey(issue.key)) return false;
    const source = effectiveProvenance[issue.key];
    const suggested = (source?.source === "SYSTEM_PROPOSED" || source?.source === "CALCULATED")
      && settingValueExists(suggestedResources ?? ({} as DemoScheduleResources), issue.key);
    return !suggested || getDraftValidationIssues(proposalCandidate(issue.key)).some((candidateIssue) => candidateIssue.key === issue.key);
  });
  const invalidSettingKeys = new Map(validationIssues.map((issue) => [issue.key, issue.message]));
  for (const [key] of unresolved) {
    const issue = getDraftValidationIssues(proposalCandidate(key)).find((item) => item.key === key);
    if (issue) invalidSettingKeys.set(key, issue.message);
  }
  const validUnresolved = unresolved.filter(([key]) => !invalidSettingKeys.has(key) && settingValueExists(proposalCandidate(key), key));
  const isDirty = JSON.stringify(draft) !== JSON.stringify(resources) || pendingConfirmKeys.length > 0;
  const staleRegulation = typeof regulation?.publishedVersion === "number" && draft.setupRegulationVersion !== regulation.publishedVersion;

  useEffect(() => {
    if (!section) return;
    setError("");
    setAnalysisError("");
    setActiveSection(section === "venues" ? "overview" : section);
  }, [section]);

  useEffect(() => {
    setDraft((current) => JSON.stringify(current) === JSON.stringify(normalizedResources) ? current : normalizedResources);
    setPendingConfirmKeys([]);
    setEditingSettingKeys(editableSetupKeys(resources));
    setSaveNotice("");
  }, [normalizedResources]);

  useEffect(() => {
    if (!pendingFocusSettingKey) return;
    const frame = window.requestAnimationFrame(() => {
      const input = document.querySelector<HTMLElement>(`[data-setting-input="${pendingFocusSettingKey}"]`);
      if (input) {
        input.focus();
        setPendingFocusSettingKey("");
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeSection, pendingFocusSettingKey]);

  const runAnalysis = useCallback(async () => {
    if (!section || section === "venues") return;
    setAnalysisLoading(true);
    setAnalysisError("");
    try {
      if (onAnalyzeSetup) {
        setAnalysis(await onAnalyzeSetup(draft));
      } else if (officialMode) {
        const tournamentContext: ScheduleSetupTournamentContext = {
          tournamentId, name: tournamentName, status: "PREPARING", startDate: startDate ?? null, endDate: endDate ?? null,
          location: null, footballFormat: pitchType, competitionFormat,
          teamCount: new Set(fixtures.flatMap((fixture) => [fixture.homeTeamId, fixture.awayTeamId]).filter((id): id is string => Boolean(id))).size,
          regulationVersion: regulation?.publishedVersion ?? null, rules: regulation,
        };
        setAnalysis(await analyzeScheduleSetupShared({ tournament: tournamentContext, fixtures: fixtures.filter((fixture) => !fixture.bye), entries: scheduleByFixture, resources: draft, maxRuntimeMs: 1_500 }));
      } else {
        const result = await analyzeScheduleSetupTest({
          tournamentId,
          diagramVersion,
          fixtures: fixtures.filter((fixture) => !fixture.bye),
          entries: scheduleByFixture,
          resources: draft,
          pitchType,
          maxRuntimeMs: 1_500,
        });
        if (result.tournamentId !== tournamentId || result.diagramVersion !== diagramVersion) throw new Error("Phân tích trả về thuộc giải hoặc phiên bản sơ đồ khác.");
        setAnalysis(result.analysis);
      }
    } catch (cause) {
      setAnalysisError(cause instanceof Error ? cause.message : "Không thể phân tích cấu hình nguồn lực.");
    } finally { setAnalysisLoading(false); }
  }, [competitionFormat, diagramVersion, draft, endDate, fixtures, officialMode, onAnalyzeSetup, pitchType, regulation, scheduleByFixture, section, startDate, tournamentId, tournamentName]);

  useEffect(() => {
    if (!section || section === "venues" || (activeSection !== "overview" && activeSection !== "capacity")) return;
    const timer = window.setTimeout(() => void runAnalysis(), 350);
    return () => window.clearTimeout(timer);
  }, [section, activeSection, runAnalysis]);

  if (!section) return null;

  function setResources(next: DemoScheduleResources) { setDraft(next); }
  function update<K extends keyof DemoScheduleResources>(key: K, value: DemoScheduleResources[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }
  function markProposed(key: string, explanation: string) {
    setPendingConfirmKeys((current) => current.filter((item) => item !== key));
    setSaveNotice("");
    setDraft((current) => {
      const existing = current.setupProvenance?.[key];
      if (existing?.source === "REGULATION" && !existing.adjustable) return current;
      return { ...current, setupProvenance: { ...(current.setupProvenance ?? {}), [key]: {
        source: "ORGANIZER_CONFIRMED", sourceLabel: "BTC đã chỉnh sửa · cần xác nhận lại", explanation, confirmed: false, adjustable: true,
      } } };
    });
  }
  function markConfirmed(keys: string[]) {
    let candidate = draft;
    const eligible: string[] = [];
    for (const key of keys) {
      const existing = effectiveProvenance[key];
      if (!isAwaitingConfirmation(existing) || existing?.source === "REGULATION" && !existing.adjustable) continue;
      const nextCandidate = proposalCandidate(key, candidate);
      if (!settingValueExists(nextCandidate, key) || getDraftValidationIssues(nextCandidate).some((issue) => issue.key === key)) continue;
      candidate = nextCandidate;
      eligible.push(key);
    }
    if (!eligible.length) return;
    if (JSON.stringify(candidate) !== JSON.stringify(draft)) setDraft(candidate);
    setPendingConfirmKeys((current) => [...new Set([...current, ...eligible])]);
    setSaveNotice("");
  }
  function confirmAllProposals() {
    markConfirmed(validUnresolved.map(([key]) => key));
  }
  function cancelPendingConfirmation(key: string) {
    setPendingConfirmKeys((current) => current.filter((item) => item !== key));
  }
  function beginSettingEdit(key: string) {
    if (!settingValueExists(draft, key) && settingValueExists(suggestedResources ?? ({} as DemoScheduleResources), key)) {
      setDraft((current) => writeSettingValue(current, key, readSettingValue(suggestedResources, key)));
    }
    setEditingSettingKeys((current) => current.includes(key) ? current : [...current, key]);
    setPendingFocusSettingKey(key);
  }
  function cancelDraftChanges() {
    setDraft(normalizedResources);
    setPendingConfirmKeys([]);
    setEditingSettingKeys([]);
    setSaveNotice("");
    setError("");
  }
  function resolveIssue(message: string) {
    const normalizedMessage = message.toLocaleLowerCase("vi");
    const validationKey = validationIssues.find((issue) => issue.message === message)?.key;
    const key = validationKey ?? Object.keys(effectiveProvenance).find((item) => message.includes(item))
      ?? Object.keys(effectiveProvenance).find((item) => normalizedMessage.includes(settingLabel(item).toLocaleLowerCase("vi")))
      ?? (message.toLowerCase().includes("khung giờ") ? "slots"
        : message.toLowerCase().includes("ngày trong tuần") ? "allowedWeekdays"
          : message.toLowerCase().includes("đội nghỉ") || message.toLowerCase().includes("nghỉ tối thiểu") ? "minimumTeamRestMinutes"
            : null);
    if (!key && /(sân|địa điểm)/.test(normalizedMessage) && /(chưa có|thiếu|bổ sung|khả dụng|xác nhận)/.test(normalizedMessage)) {
      onGoToVenues?.();
      return;
    }
    if (!key && /(ngày chính thức|thời gian chính thức|thông tin giải)/.test(normalizedMessage)) {
      onGoToTournamentInfo?.();
      return;
    }
    if (key) {
      setActiveSection(sectionForSettingKey(key));
      beginSettingEdit(key);
      return;
    }
    setActiveSection("capacity");
  }

  const fieldActionState: Step5FieldActionState = {
    readOnly,
    currentResources: draft,
    pendingConfirmKeys: pendingConfirmSet,
    editingSettingKeys: new Set(editingSettingKeys),
    invalidSettingKeys,
    suggestedResources,
    onConfirm: (key) => markConfirmed([key]),
    onCancelConfirmation: cancelPendingConfirmation,
    onEdit: beginSettingEdit,
  };
  const slotsProvenance = fieldProvenance("slots", provenance.slots, fieldActionState);
  const weekdaysProvenance = fieldProvenance("allowedWeekdays", provenance.allowedWeekdays, fieldActionState);
  const scheduleModeProvenance = fieldProvenance("scheduleMode", provenance.scheduleMode, fieldActionState);
  function updateTiming(group: "groupTiming" | "knockoutTiming", key: keyof DemoMatchTimingProfile, value: number) {
    update(group, { ...draft[group], [key]: value });
    markProposed(`${group}.${key}`, "BTC vừa chỉnh giá trị. Xác nhận nhóm này để cho phép hệ thống dùng khi kiểm tra và lập lịch.");
  }
  function toggleDay(day: number) {
    const values = draft.allowedWeekdays.includes(day) ? draft.allowedWeekdays.filter((item) => item !== day) : [...draft.allowedWeekdays, day].sort((a, b) => a - b);
    update("allowedWeekdays", values);
    markProposed("allowedWeekdays", "Ngày tổ chức phải nằm trong thời gian giải và có ít nhất một sân khả dụng.");
  }
  function changeStageDate(stage: "GROUP" | "KNOCKOUT", part: "startDate" | "endDate", value: string) {
    const prior = draft.stageDateRanges?.[stage] ?? { startDate: "", endDate: "" };
    update("stageDateRanges", { ...(draft.stageDateRanges ?? {}), [stage]: { ...prior, [part]: value } });
    markProposed(`stageDateRanges.${stage}`, "Khoảng ngày riêng cho giai đoạn; vẫn phải nằm trong thời gian chính thức của giải.");
  }
  function toggleObjective(objective: NonNullable<DemoScheduleResources["defaultObjectives"]>[number]) {
    const current = draft.defaultObjectives ?? [];
    update("defaultObjectives", current.includes(objective) ? current.filter((item) => item !== objective) : [...current, objective]);
  }
  function moveObjective(objective: NonNullable<DemoScheduleResources["defaultObjectives"]>[number], delta: -1 | 1) {
    const current = [...(draft.defaultObjectives ?? [])];
    const index = current.indexOf(objective);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= current.length) return;
    [current[index], current[target]] = [current[target], current[index]];
    update("defaultObjectives", current);
  }
  async function save(continueToNext = false, stayOpen = false) {
    if (readOnly) return;
    setError("");
    let candidateDraft = draft;
    if (section === "venues" && continueToNext) {
      const officialStartDate = dateOnly(startDate);
      const officialEndDate = dateOnly(endDate);
      const venues = draft.venues.map((venue) => {
        const windows = venue.availableSlots?.length ? venue.availableSlots : venue.availableFrom && venue.availableTo ? [{ start: venue.availableFrom, end: venue.availableTo }] : [];
        const start = venue.availabilityStartDate || officialStartDate;
        const end = venue.availabilityEndDate || officialEndDate;
        const validAvailability = venue.active && venue.weekdays.length > 0 && windows.length > 0
          && windows.every((window) => Boolean(window.start && window.end && window.start < window.end))
          && venue.weekdays.some((day) => draft.allowedWeekdays.includes(day))
          && windows.some((window) => draft.slots.some((slot) => Boolean(slot.start && slot.end && slot.start < slot.end && slot.start < window.end && slot.end > window.start)))
          && Boolean(officialStartDate && officialEndDate && start >= officialStartDate && end <= officialEndDate && start <= end);
        return { ...venue, availabilityConfirmed: validAvailability };
      });
      const confirmedVenueIds = new Set(venues.filter((venue) => venue.availabilityConfirmed).map((venue) => venue.availabilityProfileId).filter((id): id is string => Boolean(id)));
      candidateDraft = { ...draft, venues, availabilityProfiles: (draft.availabilityProfiles ?? []).map((profile) => ({ ...profile, availabilityConfirmed: confirmedVenueIds.has(profile.id) })) };
    }
    const invalid = section === "venues" ? null : getDraftValidationIssues(candidateDraft).find((issue) => isRelevantProvenanceKey(issue.key));
    if (invalid) {
      setError(invalid.message);
      setActiveSection(sectionForSettingKey(invalid.key));
      beginSettingEdit(invalid.key);
      return;
    }
    setSaving(true);
    try {
      const proposalKeys = section === "venues" ? [] : [...new Set([...pendingConfirmKeys, ...validUnresolved.map(([key]) => key)])];
      if (section !== "venues") for (const [key] of validUnresolved) candidateDraft = proposalCandidate(key, candidateDraft);
      const invalidProposal = section === "venues" ? null : getDraftValidationIssues(candidateDraft).find((issue) => isRelevantProvenanceKey(issue.key));
      if (invalidProposal) {
        setError(invalidProposal.message);
        setActiveSection(sectionForSettingKey(invalidProposal.key));
        setSaving(false);
        return;
      }
      const nextProvenance = { ...(candidateDraft.setupProvenance ?? {}) };
      for (const key of proposalKeys) {
        const existing = nextProvenance[key];
        if (!existing || existing.source === "REGULATION" && !existing.adjustable || !settingValueExists(candidateDraft, key) || invalidSettingKeys.has(key)) continue;
        nextProvenance[key] = { ...existing, source: "ORGANIZER_CONFIRMED", sourceLabel: "BTC đã xác nhận", confirmed: true };
      }
      const candidate = { ...candidateDraft, setupProvenance: nextProvenance, setupRegulationVersion: regulation?.publishedVersion ?? candidateDraft.setupRegulationVersion };
      const applied = await onApply(candidate);
      if (applied) {
        setDraft(candidate);
        setPendingConfirmKeys([]);
        setEditingSettingKeys([]);
        setSaveNotice("Đã lưu các thay đổi xuống Match Service.");
        if (continueToNext) onContinue?.();
        else if (!stayOpen) onClose();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể lưu thiết lập. Hãy tải lại dữ liệu rồi thử lại.");
    } finally { setSaving(false); }
  }

  const officialStart = regulation?.publishedAt ? "Bản điều lệ đã công bố" : "Điều lệ hiện hành";
  const analysisNeeds = (analysis?.blockingReasons ?? []).filter((message) => !/cần btc xác nhận thông số hệ thống đề xuất/i.test(message));
  const validAnalysis = analysis && analysis.tournament.tournamentId === tournamentId;
  const timingGroups = [
    ...(hasGroups ? [{ id: "groupTiming" as const, title: competitionFormat === "ROUND_ROBIN" ? "Vòng tròn" : "Vòng bảng" }] : []),
    ...(hasKnockout ? [{ id: "knockoutTiming" as const, title: "Knockout" }] : []),
  ];
  const objectives = objectiveOptions(hasKnockout);
  const chosenObjectives = draft.defaultObjectives ?? [];
  const objectiveRank = new Map(chosenObjectives.map((item, index) => [item, index + 1]));
  const orderedObjectives = [...objectives].sort((a, b) => (objectiveRank.get(a.id) ?? 999) - (objectiveRank.get(b.id) ?? 999));
  return section === "venues" ? <section className={`step5-settings-workspace schedule-resource-workspace ${embedded ? "is-embedded" : ""}`} aria-label="Sân và thời gian tổ chức">
    {!embedded ? <header className="step5-settings-workspace-heading"><div><span className="eyebrow">BƯỚC 5 · CÔNG ĐOẠN 1</span><h2>Sân & thời gian</h2><p>Chọn địa điểm và khai báo thời gian sân có thể sử dụng. Mẫu giờ không phải xác nhận đặt sân.</p></div><button type="button" className="button button-secondary" onClick={onClose}>← Quay lại</button></header> : null}
    <div className="schedule-resource-modal-content">
      {readOnly ? <div className="step5-setup-readonly"><strong>Lịch chính thức đã công bố</strong><span>Nguồn lực gắn với lịch hiện tại ở chế độ chỉ đọc. Thay đổi lịch phải qua nghiệp vụ điều chỉnh riêng.</span></div> : null}
            <Step5VenueAvailabilityWorkspace resources={draft} savedResources={resources} pitchType={pitchType} fixtures={fixtures} scheduleByFixture={scheduleByFixture} officialStartDate={dateOnly(startDate)} officialEndDate={dateOnly(endDate)} readOnly={readOnly} saving={saving} saveNotice={saveNotice} error={error} onChange={setDraft} onSave={() => { void save(false, true); }} onPersistResources={async (candidate) => { const applied = await onApply(candidate); if (applied) { setDraft(candidate); setSaveNotice("Đã lưu thông tin sân vào Match Service."); } return applied; }} />
      <footer className="schedule-settings-footer"><span>Lưu và tiếp tục sẽ ghi cấu hình sân và xác nhận giờ hợp lệ đã khai báo cho các sân đang sử dụng.</span><div>{!readOnly ? <button type="button" className="button button-primary" disabled={saving} onClick={() => void save(true)}>{saving ? "Đang lưu…" : "Lưu và tiếp tục"}</button> : null}</div></footer>
    </div>
  </section> : <Step5FieldActionContext.Provider value={fieldActionState}><section className={`step5-settings-workspace schedule-setup-workspace ${embedded ? "is-embedded" : ""}`} aria-label="Điều kiện thi đấu">
    {!embedded ? <header className="step5-settings-workspace-heading"><div><span className="eyebrow">BƯỚC 5 · CÔNG ĐOẠN 2</span><h2>Điều kiện thi đấu</h2><p>Thông số được đối chiếu với điều lệ và sơ đồ. Backend vẫn kiểm tra tính hợp lệ trước khi lưu hoặc xếp lịch.</p>{formatMismatchText ? <p className="step5-ws-format-warning" role="alert">{formatMismatchText}</p> : null}</div><button type="button" className="button button-secondary" onClick={onClose}>← Quay lại</button></header> : formatMismatchText ? <p className="step5-ws-format-warning" role="alert">{formatMismatchText}</p> : null}
    <div className="schedule-setup-shell">
      <div className="schedule-setup-main">
        <div className="schedule-setup-scroll">
          {activeSection !== "overview" ? <div className="step5-settings-subpage-toolbar"><span>{navItems.find((item) => item.id === activeSection)?.label}</span><button type="button" className="button button-secondary" onClick={() => setActiveSection("overview")}>← Quay lại điều kiện cơ bản</button></div> : null}
          {validationIssues.length ? <IssueList title="Giá trị cần sửa" items={validationIssues.map((issue) => issue.message)} onResolve={resolveIssue} /> : null}
          {unresolvedWithoutValue.length ? <IssueList title="Thông số chưa có giá trị" items={unresolvedWithoutValue.map(([key]) => `${settingLabel(key)} chưa có giá trị; thiết lập trước khi xác nhận.`)} onResolve={resolveIssue} /> : null}
          {activeSection === "overview" ? <section className="schedule-setup-page">
            <header className="schedule-setup-page-heading"><div><span className="eyebrow">THÔNG SỐ CƠ BẢN · {competitionFormatLabel(competitionFormat)}</span><h3>Thời lượng và điều kiện thi đấu</h3><p>Điều lệ {regulation?.publishedVersion ? `phiên bản ${regulation.publishedVersion}` : "hiện hành"}. Các giá trị cho phép chỉnh sửa sẽ được kiểm tra và lưu cùng lúc.</p></div><div className="step5-setup-header-actions"><span className={readOnly ? "status-pill status-success" : isDirty || validUnresolved.length + unresolvedWithoutValue.length + invalidSettingKeys.size > 0 ? "status-pill status-warning" : "status-pill status-success"}>{readOnly ? "Lịch đã công bố · chỉ đọc" : isDirty ? "Có thay đổi chưa lưu" : validUnresolved.length ? `${validUnresolved.length} đề xuất chờ xác nhận` : unresolvedWithoutValue.length ? `${unresolvedWithoutValue.length} thông số thiếu giá trị` : invalidSettingKeys.size ? `${invalidSettingKeys.size} giá trị không hợp lệ` : "Thiết lập đã lưu"}</span><button type="button" className="button button-secondary" disabled={readOnly || !validUnresolved.length} onClick={confirmAllProposals}>Xác nhận tất cả đề xuất hợp lệ ({validUnresolved.length})</button></div></header>
            {staleRegulation ? <div className="schedule-setup-issues"><h4>Điều lệ đã đổi phiên bản</h4><p>Thiết lập này được lập theo phiên bản {draft.setupRegulationVersion ?? "chưa gắn"}; phiên bản hiện hành là {regulation?.publishedVersion}. Hãy đối chiếu lại đề xuất; thông số bắt buộc không thể chỉnh tại Bước 5.</p><button type="button" className="button button-secondary" disabled={analysisLoading} onClick={() => void runAnalysis()}>{analysisLoading ? "Đang đối chiếu…" : "Xử lý ngay · đối chiếu điều lệ"}</button></div> : null}
            <div className="step5-setup-two-column">
              <div className="step5-setup-basic-column">
                <section className="step5-setup-subsection"><header><div><h4>Thời lượng trận</h4><p>{officialStart}. Thông số bắt buộc từ điều lệ không thể sửa tại Bước 5.</p></div></header>{timingGroups.map((group) => <TimingFields key={group.id} title={group.title} groupKey={group.id} value={draft[group.id]} onChange={(key, value) => updateTiming(group.id, key, value)} provenance={provenance} readOnly={readOnly} decisionMethod={regulation?.knockoutDecisionMethod} protectedTiming={protectedTimingStages.has(group.id === "groupTiming" ? "GROUP" : "KNOCKOUT")} />)}</section>
                <section className="step5-setup-subsection"><header><div><h4>Nghỉ và số trận mỗi ngày</h4><p>Giá trị đề xuất cần BTC xác nhận trước khi hệ thống dùng để xếp lịch.</p></div></header><div className="schedule-setup-fields-grid"><SettingNumber settingKey="minimumTeamRestMinutes" label="Nghỉ tối thiểu giữa hai trận của đội" unit="phút" value={draft.minimumTeamRestMinutes} provenance={provenance.minimumTeamRestMinutes} readOnly={readOnly} onChange={(value) => { update("minimumTeamRestMinutes", value); markProposed("minimumTeamRestMinutes", "Giá trị chỉnh sửa phải được xác nhận và vẫn tuân thủ điều lệ."); }} /><SettingNumber settingKey="maximumMatchesPerTeamPerDay" valueExists={draft.maximumMatchesPerTeamPerDay > 0} label="Số trận tối đa của một đội trong ngày" unit="trận" value={draft.maximumMatchesPerTeamPerDay} provenance={provenance.maximumMatchesPerTeamPerDay} readOnly={readOnly} onChange={(value) => { update("maximumMatchesPerTeamPerDay", value); markProposed("maximumMatchesPerTeamPerDay", "Giới hạn điều hành đề xuất; BTC xác nhận theo thể thức và thời gian giải."); }} /></div></section>
              </div>
              <aside className="step5-setup-capacity-column"><header><div><span className="eyebrow">PHÂN TÍCH NGUỒN LỰC</span><h4>{analysisLoading ? "Đang tính khả năng tổ chức…" : validAnalysis ? searchStatusLabel(analysis.search.status) : "Đang chuẩn bị phân tích"}</h4><p>{validAnalysis ? `Ước tính ${analysis.requirement.estimatedOccupiedHours} giờ sân cho ${analysis.counts.fixtures} trận thực tế. Đây là công suất sơ bộ, không bảo đảm xếp được toàn bộ trận.` : "Đối chiếu lịch giải, sân đã xác nhận, thời lượng trận và ràng buộc hiện hành."}</p></div><button type="button" className="button button-secondary" disabled={analysisLoading} onClick={() => void runAnalysis()}>{analysisLoading ? "Đang tính…" : "Tính lại"}</button></header>
                <div className="schedule-setup-overview-grid"><article><span>Trận cần tổ chức</span><strong>{validAnalysis ? analysis.counts.fixtures : fixtures.filter((fixture) => !fixture.bye).length}</strong><small>BYE không chiếm sân</small></article><article><span>Sân phù hợp đã xác nhận</span><strong>{validAnalysis ? analysis.capacity.confirmedMatchingVenues : draft.venues.filter((venue) => venue.pitchType === pitchType && venue.active && venue.availabilityConfirmed).length}</strong><small>{validAnalysis ? `${analysis.capacity.locations} địa điểm` : `${draft.locations?.length ?? 0} địa điểm`}</small></article><article><span>Khung trận ước tính</span><strong>{validAnalysis ? analysis.search.scheduled : "—"}</strong><small>{validAnalysis ? `Trong ${analysis.search.elapsedMs ?? 0} ms tìm kiếm` : "Chờ dữ liệu nguồn lực"}</small></article><article><span>Khung giờ dự phòng</span><strong>{validAnalysis ? Math.max(0, analysis.capacity.theoreticalAvailableHours - analysis.requirement.estimatedOccupiedHours).toFixed(1) : "—"}</strong><small>Giờ sân dư theo công suất lý thuyết</small></article></div>
                <div className="schedule-setup-analysis-inline"><div><strong>{validAnalysis ? `${analysis.capacity.theoreticalAvailableHours} giờ sân lý thuyết / ${analysis.requirement.estimatedOccupiedHours} giờ nhu cầu` : "Phân tích khả năng xếp lịch"}</strong><p>{validAnalysis ? `${analysis.capacity.daysWithCapacity} ngày có công suất · ${Math.round(analysis.capacity.averageCapacityMinutesPerDay / 60 * 10) / 10} giờ sân/ngày trung bình.` : `Thời gian giải ${regulationStartLabel(startDate, endDate)} · dự kiến ${regulation?.plannedPitchCount ?? "chưa cấu hình"} sân theo điều lệ.`}</p></div></div>
                {analysisNeeds.length ? <IssueList title="Còn thiếu hoặc cần xác nhận" items={analysisNeeds} onResolve={resolveIssue} /> : null}{validAnalysis && analysis.recommendations.length ? <IssueList title="Gợi ý xử lý" items={analysis.recommendations} onResolve={resolveIssue} /> : null}{analysisError ? <p className="form-error" role="alert">{analysisError}</p> : null}
              </aside>
            </div>
            <details className="step5-advanced-settings"><summary><span><b>Thiết lập nâng cao</b><small>Ràng buộc theo thể thức, hiệp phụ, di chuyển, vòng đồng thời và mục tiêu ưu tiên</small></span></summary><div className="step5-advanced-groups"><section><h4>Ngày và lịch thi đấu</h4><div>{navItems.filter((item) => item.id === "time" || item.id === "duration" || item.id === "conditions").map((item) => <button type="button" key={item.id} onClick={() => setActiveSection(item.id)}>{item.label} →</button>)}</div></section><section><h4>Ràng buộc và mục tiêu nâng cao</h4><div>{navItems.filter((item) => item.id === "format" || item.id === "objectives" || item.id === "capacity").map((item) => <button type="button" key={item.id} onClick={() => setActiveSection(item.id)}>{item.label} →</button>)}</div></section></div><p className="step5-setup-explanation">Các ràng buộc bắt buộc, mục tiêu tối ưu, quan hệ phụ thuộc và thứ tự ưu tiên hiện có vẫn được Match Service giữ nguyên.</p></details>
          </section> : null}

          {activeSection === "time" ? <section className="schedule-setup-page">
            <PageHeading title="Thời gian tổ chức" description="Ngày giải được kế thừa. Có thể thu hẹp thời gian lập lịch; API sẽ chặn phạm vi vượt ra ngoài điều lệ." />
            <div className="schedule-setup-inherited-callout"><b>Khoảng chính thức: {regulationStartLabel(startDate, endDate)}</b><span>Kế thừa từ giải; không thể mở rộng tại bước này.</span></div>
            <div className="schedule-setup-fields-grid">
              <SetupDateField settingKey="competitionStartDate" label="Ngày bắt đầu xếp trận" value={draft.competitionStartDate} min={dateOnly(startDate)} max={dateOnly(endDate)} provenance={provenance.competitionStartDate} disabled={readOnly || !dateOnly(startDate) || !dateOnly(endDate)} blockedReason={!dateOnly(startDate) || !dateOnly(endDate) ? "Ngày chính thức phải được bổ sung tại Bước 1." : undefined} blockedAction={!readOnly && onGoToTournamentInfo && (!dateOnly(startDate) || !dateOnly(endDate)) ? { label: "Mở Bước 1", onClick: onGoToTournamentInfo } : undefined} onChange={(value) => { update("competitionStartDate", value); markProposed("competitionStartDate", "Ngày xếp trận nằm trong thời gian chính thức của giải."); }} />
              <SetupDateField settingKey="competitionEndDate" label="Ngày kết thúc xếp trận" value={draft.competitionEndDate} min={dateOnly(startDate)} max={dateOnly(endDate)} provenance={provenance.competitionEndDate} disabled={readOnly || !dateOnly(startDate) || !dateOnly(endDate)} blockedReason={!dateOnly(startDate) || !dateOnly(endDate) ? "Ngày chính thức phải được bổ sung tại Bước 1." : undefined} blockedAction={!readOnly && onGoToTournamentInfo && (!dateOnly(startDate) || !dateOnly(endDate)) ? { label: "Mở Bước 1", onClick: onGoToTournamentInfo } : undefined} onChange={(value) => { update("competitionEndDate", value); markProposed("competitionEndDate", "Ngày xếp trận nằm trong thời gian chính thức của giải."); }} />
            </div>
            {(!dateOnly(startDate) || !dateOnly(endDate)) ? <IssueList title="Thiếu ngày chính thức" items={["Giải chưa có đầy đủ ngày chính thức. Hãy bổ sung ngày trong Bước 1; Bước 5 không tự mở rộng thời gian giải."]} onResolve={resolveIssue} /> : null}
            {stageRangeVisible(competitionFormat, fixtures, "GROUP") ? <StageDateEditor stage="GROUP" label="Vòng bảng" resources={draft} officialStart={dateOnly(startDate)} officialEnd={dateOnly(endDate)} readOnly={readOnly} onChange={changeStageDate} /> : null}
            {stageRangeVisible(competitionFormat, fixtures, "KNOCKOUT") ? <StageDateEditor stage="KNOCKOUT" label="Knockout" resources={draft} officialStart={dateOnly(startDate)} officialEnd={dateOnly(endDate)} readOnly={readOnly} onChange={changeStageDate} /> : null}
            <div className="schedule-settings-days step5-setup-day-picker"><strong>Ngày trong tuần được phép tổ chức</strong>{dayOptions.map((day) => <label key={day.value}><input type="checkbox" data-setting-input="allowedWeekdays" checked={draft.allowedWeekdays.includes(day.value)} disabled={readOnly || weekdaysProvenance?.source === "REGULATION" && weekdaysProvenance.adjustable === false || !editingSettingKeys.includes("allowedWeekdays")} onChange={() => toggleDay(day.value)} />{day.label}</label>)}<FieldStateActions settingKey="allowedWeekdays" provenance={weekdaysProvenance} valueExists={draft.allowedWeekdays.length > 0} /></div>
            <section className="step5-setup-subsection"><header><div><h4>Khung giờ chung</h4><p>Được kế thừa từ điều lệ hoặc tổng hợp từ các sân đã xác nhận. Từng sân vẫn áp dụng lịch riêng.</p></div></header>
              <FieldStateActions settingKey="slots" provenance={slotsProvenance} valueExists={draft.slots.length > 0} />
              {draft.slots.map((slot) => <div className="schedule-slot-row" key={slot.id}><label>Tên khung<input data-setting-input="slots" value={slot.label} disabled={readOnly || slotsProvenance?.source === "REGULATION" && slotsProvenance.adjustable === false || !editingSettingKeys.includes("slots")} onChange={(event) => { update("slots", draft.slots.map((item) => item.id === slot.id ? { ...item, label: event.target.value } : item)); markProposed("slots", "BTC đã thay đổi khung giờ chung; xác nhận lại trước khi lập lịch."); }} /></label><label>Bắt đầu<input type="time" data-setting-input="slots" value={slot.start} disabled={readOnly || slotsProvenance?.source === "REGULATION" && slotsProvenance.adjustable === false || !editingSettingKeys.includes("slots")} onChange={(event) => { update("slots", draft.slots.map((item) => item.id === slot.id ? { ...item, start: event.target.value } : item)); markProposed("slots", "Khung giờ phải nằm trong giờ điều lệ và giao với khả dụng từng sân."); }} /></label><label>Kết thúc<input type="time" data-setting-input="slots" value={slot.end} disabled={readOnly || slotsProvenance?.source === "REGULATION" && slotsProvenance.adjustable === false || !editingSettingKeys.includes("slots")} onChange={(event) => { update("slots", draft.slots.map((item) => item.id === slot.id ? { ...item, end: event.target.value } : item)); markProposed("slots", "Khung giờ phải nằm trong giờ điều lệ và giao với khả dụng từng sân."); }} /></label><label>Ưu tiên<select value={slot.priority ?? "NORMAL"} disabled={readOnly || slotsProvenance?.source === "REGULATION" && slotsProvenance.adjustable === false || !editingSettingKeys.includes("slots")} onChange={(event) => update("slots", draft.slots.map((item) => item.id === slot.id ? { ...item, priority: event.target.value as typeof slot.priority } : item))}><option value="PREFERRED">Ưu tiên</option><option value="NORMAL">Bình thường</option><option value="RESTRICTED">Hạn chế</option></select></label><button type="button" className="text-button" disabled={readOnly || slotsProvenance?.source === "REGULATION" && slotsProvenance.adjustable === false || !editingSettingKeys.includes("slots")} onClick={() => { update("slots", draft.slots.filter((item) => item.id !== slot.id)); markProposed("slots", "BTC đã thay đổi danh sách khung giờ; xác nhận lại."); }}>Xóa</button></div>)}
              <button type="button" className="button button-secondary" data-setting-input="slots" disabled={readOnly || slotsProvenance?.source === "REGULATION" && slotsProvenance.adjustable === false || !editingSettingKeys.includes("slots")} onClick={() => { update("slots", [...draft.slots, { id: newId(), label: `Khung ${draft.slots.length + 1}`, start: "", end: "" }]); markProposed("slots", "BTC đã thêm khung giờ mới; cần nhập khoảng giờ hợp lệ rồi xác nhận."); }}>+ Thêm khung giờ</button>
            </section>
            <section className="step5-setup-subsection"><header><div><h4>Ngày nghỉ / không tổ chức</h4><p>Không nhận lịch vào các ngày được đánh dấu nghỉ.</p></div></header><div className="schedule-blocked-date-add"><input aria-label="Ngày nghỉ" type="date" min={dateOnly(startDate)} max={dateOnly(endDate)} value={newBlockedDate} disabled={readOnly} onChange={(event) => setNewBlockedDate(event.target.value)} /><button type="button" className="button button-secondary" disabled={readOnly || !newBlockedDate || draft.blockedDates.includes(newBlockedDate)} onClick={() => { update("blockedDates", [...draft.blockedDates, newBlockedDate].sort()); setNewBlockedDate(""); }}>Thêm ngày nghỉ</button></div><div className="schedule-blocked-date-list">{draft.blockedDates.map((date) => <span key={date}>{new Date(`${date}T12:00:00`).toLocaleDateString("vi-VN")}<button type="button" disabled={readOnly} aria-label={`Bỏ ngày nghỉ ${date}`} onClick={() => update("blockedDates", draft.blockedDates.filter((item) => item !== date))}>×</button></span>)}{!draft.blockedDates.length ? <small>Chưa có ngày nghỉ riêng.</small> : null}</div></section>
          </section> : null}

          {activeSection === "duration" ? <section className="schedule-setup-page">
            <PageHeading title="Thời lượng trận đấu" description="Thời lượng hiệp có thể bị khóa theo điều lệ; chuẩn bị, nghỉ và chuyển tiếp được cấu hình riêng. Timeline phân biệt thời gian thi đấu với thời gian sân bận." />
            {timingGroups.map((group) => <div key={group.id} className="step5-setup-duration-block">
              <TimingFields title={group.title} groupKey={group.id} value={draft[group.id]} onChange={(key, value) => updateTiming(group.id, key, value)} provenance={provenance} readOnly={readOnly} decisionMethod={regulation?.knockoutDecisionMethod} protectedTiming={protectedTimingStages.has(group.id === "groupTiming" ? "GROUP" : "KNOCKOUT")} />
            </div>)}
            {hasKnockout ? <div className="schedule-setup-inherited-callout"><b>Phân định trận hòa theo điều lệ</b><span>{regulation?.knockoutDecisionMethod === "EXTRA_TIME_THEN_PENALTIES" ? `Hiệp phụ ${regulation.extraTimeMinutes} phút, sau đó đá penalty nếu còn hòa.` : regulation?.knockoutDecisionMethod === "PENALTIES_ONLY" ? "Đá penalty trực tiếp, không thi đấu hiệp phụ." : "Không áp dụng hiệp phụ hoặc penalty."}</span></div> : null}
          </section> : null}

          {activeSection === "conditions" ? <section className="schedule-setup-page">
            <PageHeading title="Điều kiện thi đấu" description="Điều lệ là giới hạn bắt buộc. Đề xuất chưa được xác nhận sẽ chặn lập lịch cho đến khi BTC xác nhận hoặc điều chỉnh." />
            <div className="schedule-setup-fields-grid">
              <SettingNumber settingKey="minimumTeamRestMinutes" label="Nghỉ tối thiểu giữa hai trận của đội" unit="phút" value={draft.minimumTeamRestMinutes} provenance={provenance.minimumTeamRestMinutes} readOnly={readOnly} onChange={(value) => { update("minimumTeamRestMinutes", value); markProposed("minimumTeamRestMinutes", "Giá trị chỉnh sửa phải được xác nhận và vẫn tuân thủ điều lệ."); }} />
              <SettingNumber settingKey="maximumMatchesPerTeamPerDay" valueExists={draft.maximumMatchesPerTeamPerDay > 0} label="Số trận tối đa của một đội trong ngày" unit="trận" value={draft.maximumMatchesPerTeamPerDay} provenance={provenance.maximumMatchesPerTeamPerDay} readOnly={readOnly} onChange={(value) => { update("maximumMatchesPerTeamPerDay", value); markProposed("maximumMatchesPerTeamPerDay", "Giới hạn điều hành đề xuất; BTC xác nhận theo thể thức và thời gian giải."); }} />
              <SettingNumber settingKey="travelBufferMinutes" label="Thời gian di chuyển giữa địa điểm" unit="phút" value={draft.travelBufferMinutes} provenance={provenance.travelBufferMinutes} readOnly={readOnly} onChange={(value) => { update("travelBufferMinutes", value); markProposed("travelBufferMinutes", "Không tự ước lượng tuyến đường. Nhập thời gian chuyển địa điểm nếu giải dùng nhiều nơi."); }} />
              <SettingNumber settingKey="maximumRoundsPerDay" label="Số vòng tối đa trong ngày (0 = không giới hạn)" unit="vòng" value={draft.maximumRoundsPerDay ?? 0} provenance={provenance.maximumRoundsPerDay} readOnly={readOnly} onChange={(value) => { update("maximumRoundsPerDay", value || undefined); markProposed("maximumRoundsPerDay", "Chỉ đặt giới hạn nếu điều lệ hoặc kế hoạch tổ chức yêu cầu."); }} />
            </div>
            <div className="schedule-setup-toggle-list"><label><input type="checkbox" checked={draft.maximumRoundsPerDayRequired ?? false} disabled={readOnly} onChange={(event) => update("maximumRoundsPerDayRequired", event.target.checked)} /> Áp dụng giới hạn vòng/ngày như ràng buộc bắt buộc</label><label><input type="checkbox" checked={draft.requireSimultaneousGroupFinalRound ?? false} disabled={readOnly || !hasGroups} onChange={(event) => update("requireSimultaneousGroupFinalRound", event.target.checked)} /> Vòng cuối bảng phải cùng ngày/giờ khi điều lệ yêu cầu</label></div>
          </section> : null}

          {activeSection === "format" ? <section className="schedule-setup-page">
            <PageHeading title="Ràng buộc thể thức" description="Chỉ hiển thị nhóm phù hợp fixture đã công bố. Không thay thể thức, đội, trận hoặc quan hệ nguồn." />
            <div className="schedule-setup-inherited-callout"><b>{competitionFormatLabel(competitionFormat)}</b><span>{fixtures.length} fixture từ sơ đồ Bước 4 · nguồn authoritative của trận không chỉnh sửa ở Bước 5.</span></div>
            {hasGroups ? <section className="step5-setup-subsection"><h4>{competitionFormat === "ROUND_ROBIN" ? "Vòng và lượt đấu" : "Ràng buộc vòng bảng"}</h4><div className="step5-field-control"><label className="step5-setup-field">Hình thức tổ chức<select data-setting-input="scheduleMode" value={draft.scheduleMode ?? "CENTRALIZED"} disabled={readOnly || scheduleModeProvenance?.source === "REGULATION" && scheduleModeProvenance.adjustable === false || !editingSettingKeys.includes("scheduleMode")} onChange={(event) => { update("scheduleMode", event.target.value as "CENTRALIZED" | "HOME_AWAY"); markProposed("scheduleMode", "Chọn sân tập trung hoặc sân nhà–sân khách dựa trên nguồn lực thực tế."); }}><option value="CENTRALIZED">Thi đấu tập trung</option><option value="HOME_AWAY">Sân nhà – sân khách</option></select></label><FieldStateActions settingKey="scheduleMode" provenance={scheduleModeProvenance} valueExists={Boolean(draft.scheduleMode)} /></div>{draft.scheduleMode === "HOME_AWAY" ? <p className="step5-setup-explanation">Chỉ dùng nếu fixture Bước 4 và danh mục sân đã xác định sân chủ nhà; không tự đảo đội.</p> : null}<label><input type="checkbox" checked={draft.sameVenueAcrossRoundRequired ?? false} disabled={readOnly} onChange={(event) => update("sameVenueAcrossRoundRequired", event.target.checked)} /> Cùng bảng/vòng ưu tiên dùng cùng địa điểm khi khả thi</label><label><input type="checkbox" checked={draft.rotateVenues ?? false} disabled={readOnly} onChange={(event) => update("rotateVenues", event.target.checked)} /> Ưu tiên phân bổ sân luân phiên</label><label><input type="checkbox" checked={draft.rotateTimeSlots ?? false} disabled={readOnly} onChange={(event) => update("rotateTimeSlots", event.target.checked)} /> Ưu tiên luân phiên khung giờ</label></section> : null}
            {hasKnockout ? <section className="step5-setup-subsection"><h4>Ràng buộc knockout</h4><SettingNumber settingKey="maximumKnockoutRestDifferenceMinutes" label="Chênh lệch thời gian nghỉ giữa nhánh tối đa" unit="phút" value={draft.maximumKnockoutRestDifferenceMinutes ?? 0} provenance={provenance.maximumKnockoutRestDifferenceMinutes} readOnly={readOnly} onChange={(value) => { update("maximumKnockoutRestDifferenceMinutes", value || undefined); markProposed("maximumKnockoutRestDifferenceMinutes", "Đây là ngưỡng fairness; chỉ bắt buộc khi BTC hoặc điều lệ yêu cầu."); }} /><label><input type="checkbox" checked={draft.maximumKnockoutRestDifferenceRequired ?? false} disabled={readOnly} onChange={(event) => update("maximumKnockoutRestDifferenceRequired", event.target.checked)} /> Chênh lệch nghỉ là ràng buộc bắt buộc</label><label>Sân trung tâm ưu tiên ở vòng (mỗi dòng một vòng)<textarea rows={3} value={(draft.centralVenuePreferredStages ?? []).join("\n")} disabled={readOnly} onChange={(event) => update("centralVenuePreferredStages", event.target.value.split("\n").map((item) => item.trim()).filter(Boolean))} placeholder="Bán kết\nChung kết" /></label><p className="step5-setup-explanation">Trận nguồn, đội tiềm năng, BYE và thứ tự phụ thuộc luôn lấy từ Bước 4; phần này chỉ điều chỉnh thời gian và ưu tiên tổ chức.</p></section> : null}
          </section> : null}

          {activeSection === "objectives" ? <section className="schedule-setup-page">
            <PageHeading title="Mục tiêu tối ưu" description="Các mục tiêu chỉ xếp hạng phương án. Chúng không được nới ràng buộc bắt buộc." />
            <div className="step5-setup-inherited-callout"><b>Mặc định: cân bằng tổng thể</b><span>Hard constraints vẫn được kiểm tra trước mọi tiêu chí tối ưu.</span></div>
            <div className="step5-setup-objectives">{orderedObjectives.map((objective) => { const rank = objectiveRank.get(objective.id); return <label key={objective.id} className={rank ? "is-selected" : ""}><input type="checkbox" checked={Boolean(rank)} disabled={readOnly} onChange={() => toggleObjective(objective.id)} /><span><b>{objective.label}{rank ? ` · Ưu tiên ${rank}` : ""}</b><small>{objective.description}</small></span>{rank ? <span className="step5-setup-objective-controls"><button type="button" aria-label={`Đưa ${objective.label} lên`} disabled={readOnly || rank === 1} onClick={() => moveObjective(objective.id, -1)}>↑</button><button type="button" aria-label={`Đưa ${objective.label} xuống`} disabled={readOnly || rank === chosenObjectives.length} onClick={() => moveObjective(objective.id, 1)}>↓</button></span> : null}</label>; })}</div>
            <p className="step5-setup-explanation">Cấu hình này là thứ tự ưu tiên của trợ lý tự động. Nó không thay đổi điều lệ, thời lượng bắt buộc, thời gian nghỉ tối thiểu hoặc lịch đã khóa.</p>
          </section> : null}

          {activeSection === "capacity" ? <section className="schedule-setup-page">
            <PageHeading title="Phân tích nguồn lực" description="Công suất giờ sân là điều kiện sơ bộ. Hệ thống chạy tìm lịch có giới hạn thời gian để phân biệt phương án tìm được với trường hợp chưa thể kết luận." />
            <div className="schedule-setup-analysis-actions"><button type="button" className="button button-primary" disabled={analysisLoading} onClick={() => void runAnalysis()}>{analysisLoading ? "Đang phân tích…" : "Phân tích khả năng tổ chức"}</button><span>{analysis?.search.elapsedMs !== null && analysis?.search.elapsedMs !== undefined ? `Tìm kiếm ${analysis.search.elapsedMs} ms` : "Không thay đổi lịch khi phân tích"}</span></div>
            {analysisError ? <p className="form-error" role="alert">{analysisError}</p> : null}
            {validAnalysis ? <><div className="schedule-setup-analysis-grid">
              <Metric label="Nhu cầu sân sơ bộ" value={`${analysis.requirement.estimatedOccupiedHours} giờ`} note={`${analysis.counts.fixtures} trận thực tế`} />
              <Metric label="Giờ sân khả dụng lý thuyết" value={`${analysis.capacity.theoreticalAvailableHours} giờ`} note={`${analysis.capacity.confirmedMatchingVenues} sân đã xác nhận`} />
              <Metric label="Sân đồng thời cần thiết" value={String(analysis.requirement.requiredSimultaneousVenues)} note={draft.requireSimultaneousGroupFinalRound ? "Theo ràng buộc vòng cuối" : "Theo cấu trúc hiện tại"} />
              <Metric label="Trận đã có lịch / phương án" value={`${Math.min(analysis.counts.fixtures, analysis.counts.scheduled + analysis.search.scheduled)}/${analysis.counts.fixtures}`} note={searchStatusLabel(analysis.search.status)} />
              <Metric label="Ngày có công suất" value={`${analysis.capacity.daysWithCapacity} ngày`} note={`${Math.round(analysis.capacity.averageCapacityMinutesPerDay / 60 * 10) / 10} giờ sân/ngày trung bình`} />
              <Metric label="Sân bổ sung · ước lượng" value={analysis.capacity.additionalVenuesTheoretical === null ? "Chưa ước tính" : String(analysis.capacity.additionalVenuesTheoretical)} note="Chỉ suy ra từ tổng giờ sân; không phải lịch khả thi" />
            </div><div className="schedule-setup-analysis-verdict"><b>{searchStatusLabel(analysis.search.status)}</b><span>{analysis.search.startDate && analysis.search.endDate ? `Khung thời gian tìm được: ${analysis.search.startDate} – ${analysis.search.endDate}.` : "Chưa có lịch nào được lưu hoặc công bố từ phân tích."}</span></div>
              <p className="step5-setup-explanation">Điều lệ dự kiến {analysis.tournament.rules?.plannedPitchCount ?? "chưa cấu hình"} sân và {analysis.tournament.rules?.playableHoursPerDay ?? "chưa cấu hình"} giờ/ngày. Nguồn lực thực tế được tính riêng từ sân và khả dụng đã xác nhận.</p>
              {analysis.blockingReasons.length ? <IssueList title="Điều kiện còn thiếu" items={analysis.blockingReasons} onResolve={resolveIssue} /> : null}
              {analysis.search.missing.length ? <IssueList title="Trận chưa tìm được vị trí" items={analysis.search.missing.map((item) => `${item.fixtureId}: ${item.reason}`)} onResolve={resolveIssue} /> : null}
              {analysis.recommendations.length ? <IssueList title="Hướng xử lý" items={analysis.recommendations} onResolve={resolveIssue} /> : null}
              {analysis.scheduleIssues.length ? <IssueList title="Lỗi trên lịch hiện tại" items={analysis.scheduleIssues.slice(0, 20).map((issue) => `${issue.fixtureId || "Thiết lập"}: ${issue.message}`)} onResolve={resolveIssue} /> : null}
              <small className="step5-setup-disclaimer">Công suất lý thuyết không chứng minh lịch khả thi. Phương án tìm được ở đây chỉ phục vụ phân tích; không tạo lịch nháp, không khóa lịch và không công bố.</small>
            </> : !analysisLoading ? <div className="step5-setup-empty"><strong>Chưa có kết quả phân tích</strong><span>Nhấn phân tích để hệ thống đọc bản điều lệ, fixture, nguồn lực và lịch hiện tại từ các nguồn có thẩm quyền.</span></div> : null}
          </section> : null}
        </div>
        {error ? <p className="form-error step5-setup-error" role="alert">{error}</p> : null}
        {saveNotice ? <p className="step5-setup-save-notice" role="status">{saveNotice}</p> : null}
        <footer className="schedule-setup-footer"><span>{readOnly ? "Thiết lập đã khóa sau công bố lịch." : isDirty ? `${pendingConfirmKeys.length} xác nhận đang chờ lưu · thay đổi chưa gửi lên máy chủ` : `${validUnresolved.length} đề xuất chờ xác nhận · ${unresolvedWithoutValue.length} thông số thiếu giá trị · lịch đã có không tự xóa hoặc di chuyển`}</span><div>{!embedded ? <button type="button" className="button button-secondary" onClick={onClose}>Đóng</button> : null}{!readOnly && isDirty ? <><button type="button" className="button button-secondary" disabled={saving} onClick={cancelDraftChanges}>Hủy</button><button type="button" className="button button-primary" disabled={saving} onClick={() => void save(false, true)}>{saving ? "Đang lưu…" : "Lưu thay đổi"}</button>{embedded ? <button type="button" className="button button-primary" disabled={saving} onClick={() => void save(true)}>{saving ? "Đang kiểm tra & lưu…" : "Lưu và tiếp tục"}</button> : null}</> : !readOnly ? <button type="button" className="button button-primary" disabled={saving} onClick={() => void save(true)}>{saving ? "Đang kiểm tra & lưu…" : "Lưu và tiếp tục"}</button> : null}</div></footer>
      </div>
    </div>
  </section></Step5FieldActionContext.Provider>;
}

function PageHeading({ title, description }: { title: string; description: string }) {
  return <header className="schedule-setup-page-heading"><div><span className="eyebrow">THIẾT LẬP BƯỚC 5</span><h3>{title}</h3><p>{description}</p></div></header>;
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return <article className="schedule-setup-metric"><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}

function IssueList({ title, items, onResolve }: { title: string; items: string[]; onResolve?: (message: string) => void }) {
  if (!items.length) return null;
  return <section className="schedule-setup-issues"><h4>{title}</h4>{items.slice(0, 14).map((item, index) => <div className="schedule-setup-issue-row" key={`${index}-${item}`}><p>{item}</p>{onResolve ? <button type="button" className="text-button" onClick={() => onResolve(item)}>Xử lý ngay →</button> : null}</div>)}</section>;
}

function StageDateEditor({ stage, label, resources, officialStart, officialEnd, readOnly, onChange }: {
  stage: "GROUP" | "KNOCKOUT";
  label: string;
  resources: DemoScheduleResources;
  officialStart: string;
  officialEnd: string;
  readOnly: boolean;
  onChange: (stage: "GROUP" | "KNOCKOUT", part: "startDate" | "endDate", value: string) => void;
}) {
  const range = resources.stageDateRanges?.[stage] ?? { startDate: "", endDate: "" };
  const settingKey = `stageDateRanges.${stage}`;
  const actions = useContext(Step5FieldActionContext);
  const editing = actions?.editingSettingKeys.has(settingKey) ?? true;
  const provenance = fieldProvenance(settingKey, resources.setupProvenance?.[settingKey], actions);
  const blocked = !officialStart || !officialEnd;
  const locked = provenance?.source === "REGULATION" && provenance.adjustable === false;
  const disabled = readOnly || blocked || locked;
  return <section className="step5-setup-stage-range"><div><strong>Khoảng ngày riêng · {label}</strong><FieldStateActions settingKey={settingKey} provenance={provenance} valueExists={Boolean(range.startDate || range.endDate)} canEdit={!blocked} blockedReason={!officialStart || !officialEnd ? "Cần ngày chính thức từ Bước 1." : undefined} /></div><div className="schedule-setup-fields-grid"><label>Từ<input type="date" data-setting-input={settingKey} min={officialStart || undefined} max={officialEnd || undefined} value={range.startDate} disabled={disabled || !editing} onChange={(event) => onChange(stage, "startDate", event.target.value)} /></label><label>Đến<input type="date" data-setting-input={settingKey} min={officialStart || undefined} max={officialEnd || undefined} value={range.endDate} disabled={disabled || !editing} onChange={(event) => onChange(stage, "endDate", event.target.value)} /></label></div><small>Để trống cả hai ô nếu dùng toàn bộ thời gian tổ chức của giải. Backend chặn ngày nằm ngoài điều lệ.</small></section>;
}

function SetupDateField({ label, value, min, max, provenance, disabled, settingKey, blockedReason, blockedAction, onChange }: { label: string; value: string; min?: string; max?: string; provenance?: ScheduleSettingProvenance; disabled: boolean; settingKey: string; blockedReason?: string; blockedAction?: { label: string; onClick: () => void }; onChange: (value: string) => void }) {
  const actions = useContext(Step5FieldActionContext);
  const editing = actions?.editingSettingKeys.has(settingKey) ?? true;
  const effectiveProvenance = fieldProvenance(settingKey, provenance, actions);
  const locked = effectiveProvenance?.source === "REGULATION" && effectiveProvenance.adjustable === false;
  return <div className="step5-field-control"><label className="step5-setup-field"><span>{label}<small>{effectiveProvenance?.explanation}</small></span><input type="date" data-setting-input={settingKey} aria-invalid={actions?.invalidSettingKeys.has(settingKey) || undefined} value={value} min={min || undefined} max={max || undefined} disabled={disabled || locked || !editing} onChange={(event) => onChange(event.target.value)} /></label><FieldStateActions settingKey={settingKey} provenance={effectiveProvenance} valueExists={Boolean(value)} canEdit={!blockedReason} blockedReason={blockedReason} blockedAction={blockedAction} /></div>;
}

function SettingNumber({ label, unit, value, provenance, readOnly, settingKey, valueExists, onChange }: { label: string; unit: string; value: number; provenance?: ScheduleSettingProvenance; readOnly: boolean; settingKey: string; valueExists?: boolean; onChange: (value: number) => void }) {
  const actions = useContext(Step5FieldActionContext);
  const editing = actions?.editingSettingKeys.has(settingKey) ?? true;
  const effectiveProvenance = fieldProvenance(settingKey, provenance, actions);
  const locked = effectiveProvenance?.source === "REGULATION" && effectiveProvenance.adjustable === false;
  return <div className="step5-field-control"><label className="step5-setup-field"><span>{label}<small>{effectiveProvenance?.explanation}</small></span><div><input type="number" min={0} data-setting-input={settingKey} aria-invalid={actions?.invalidSettingKeys.has(settingKey) || undefined} value={value} disabled={readOnly || locked || !editing} onChange={(event) => onChange(Number(event.target.value))} /><em>{unit}</em></div></label><FieldStateActions settingKey={settingKey} provenance={effectiveProvenance} valueExists={valueExists ?? Number.isFinite(value)} /></div>;
}

function competitionFormatLabel(format: Props["competitionFormat"]) {
  return format === "ROUND_ROBIN" ? "Vòng tròn" : format === "KNOCKOUT" ? "Loại trực tiếp" : "Kết hợp";
}

function regulationStartLabel(start?: string | null, end?: string | null) {
  return start && end ? `${new Date(start).toLocaleDateString("vi-VN")} – ${new Date(end).toLocaleDateString("vi-VN")}` : "Chưa có khoảng ngày chính thức";
}

function dateOnly(value?: string | null) { return value?.slice(0, 10) ?? ""; }
function stageRangeVisible(format: Props["competitionFormat"], fixtures: DemoFixture[], stage: "GROUP" | "KNOCKOUT") {
  return (stage === "GROUP" ? format !== "KNOCKOUT" : format !== "ROUND_ROBIN") && fixtures.some((fixture) => fixture.stage === stage);
}
function getDraftValidationIssues(resources: DemoScheduleResources): Array<{ key: string; message: string }> {
  const issues: Array<{ key: string; message: string }> = [];
  if (resources.competitionStartDate && resources.competitionEndDate && resources.competitionStartDate > resources.competitionEndDate) {
    issues.push({ key: "competitionEndDate", message: "Ngày kết thúc phải bằng hoặc sau ngày bắt đầu." });
  }
  if (resources.slots.some((slot) => !slot.label.trim() || slot.start >= slot.end)) {
    issues.push({ key: "slots", message: "Mỗi khung giờ cần tên và giờ kết thúc sau giờ bắt đầu." });
  }
  for (const [group, timing] of [["groupTiming", resources.groupTiming], ["knockoutTiming", resources.knockoutTiming]] as const) {
    for (const [key, value] of Object.entries(timing)) {
      if (value === null || value === undefined) continue;
      if (!Number.isFinite(value) || value < 0) issues.push({ key: `${group}.${key}`, message: "Giá trị phải là số không âm." });
      else if (key === "halfMinutes" && value === 0) issues.push({ key: `${group}.${key}`, message: "Mỗi hiệp phải có thời lượng lớn hơn 0." });
    }
  }
  for (const [key, value] of [["minimumTeamRestMinutes", resources.minimumTeamRestMinutes], ["maximumMatchesPerTeamPerDay", resources.maximumMatchesPerTeamPerDay], ["travelBufferMinutes", resources.travelBufferMinutes], ["maximumRoundsPerDay", resources.maximumRoundsPerDay ?? 0]] as const) {
    if (!Number.isFinite(value) || value < 0) issues.push({ key, message: "Giá trị phải là số không âm." });
    else if (key === "maximumMatchesPerTeamPerDay" && value === 0) issues.push({ key, message: "Số trận tối đa mỗi đội trong ngày phải lớn hơn 0." });
  }
  for (const [stage, range] of Object.entries(resources.stageDateRanges ?? {})) {
    if (range.startDate && range.endDate && range.startDate > range.endDate) issues.push({ key: `stageDateRanges.${stage}`, message: `Ngày bắt đầu của giai đoạn ${stage} phải bằng hoặc trước ngày kết thúc.` });
  }
  return issues;
}
function sectionForSettingKey(key: string): Exclude<Section, "venues"> {
  if (key.startsWith("groupTiming.") || key.startsWith("knockoutTiming.")) return "duration";
  if (["competitionStartDate", "competitionEndDate", "allowedWeekdays", "slots", "blockedDates"].includes(key) || key.startsWith("stageDateRanges.")) return "time";
  if (["minimumTeamRestMinutes", "maximumMatchesPerTeamPerDay", "travelBufferMinutes", "maximumRoundsPerDay", "maximumRoundsPerDayRequired", "requireSimultaneousGroupFinalRound"].includes(key)) return "conditions";
  if (key === "defaultObjectives") return "objectives";
  if (key === "scheduleMode" || key.includes("Venue") || key.includes("venue")) return "format";
  return "overview";
}
function settingValueExists(resources: DemoScheduleResources, key: string): boolean {
  if (key.startsWith("groupTiming.")) return Number.isFinite(Number(resources.groupTiming?.[key.slice(12) as keyof DemoMatchTimingProfile]));
  if (key.startsWith("knockoutTiming.")) return Number.isFinite(Number(resources.knockoutTiming?.[key.slice(15) as keyof DemoMatchTimingProfile]));
  if (key === "competitionStartDate" || key === "competitionEndDate") return Boolean(resources[key]);
  if (key === "allowedWeekdays") return (resources.allowedWeekdays?.length ?? 0) > 0;
  if (key === "slots") return (resources.slots?.length ?? 0) > 0;
  if (key === "minimumTeamRestMinutes") return Number.isFinite(resources.minimumTeamRestMinutes);
  if (key === "maximumMatchesPerTeamPerDay") return Number.isFinite(resources.maximumMatchesPerTeamPerDay) && resources.maximumMatchesPerTeamPerDay > 0;
  if (key === "travelBufferMinutes") return Number.isFinite(resources.travelBufferMinutes);
  if (key === "scheduleMode") return Boolean(resources.scheduleMode);
  if (key.startsWith("stageDateRanges.")) {
    const range = readSettingValue(resources, key) as { startDate?: string; endDate?: string } | undefined;
    return Boolean(range && (range.startDate || range.endDate));
  }
  const value = readSettingValue(resources, key);
  if (value === undefined || value === null || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  return true;
}
function settingLabel(key: string) {
  const labels: Record<string, string> = {
    competitionStartDate: "Ngày bắt đầu xếp trận", competitionEndDate: "Ngày kết thúc xếp trận", allowedWeekdays: "Ngày trong tuần",
    slots: "Khung giờ chung", minimumTeamRestMinutes: "Nghỉ tối thiểu", maximumMatchesPerTeamPerDay: "Số trận/đội/ngày",
    travelBufferMinutes: "Di chuyển giữa địa điểm", maximumRoundsPerDay: "Số vòng tối đa trong ngày", scheduleMode: "Hình thức tổ chức",
    "stageDateRanges.GROUP": "Khoảng ngày vòng bảng", "stageDateRanges.KNOCKOUT": "Khoảng ngày knockout",
    maximumKnockoutRestDifferenceMinutes: "Chênh lệch thời gian nghỉ giữa nhánh", "groupTiming.halfMinutes": "Thời lượng hiệp vòng bảng",
    "groupTiming.halftimeBreakMinutes": "Nghỉ giữa hiệp vòng bảng", "groupTiming.preparationBeforeMinutes": "Chuẩn bị sân vòng bảng",
    "groupTiming.transitionAfterMinutes": "Chuyển tiếp sân vòng bảng", "knockoutTiming.halfMinutes": "Thời lượng hiệp knockout",
    "knockoutTiming.halftimeBreakMinutes": "Nghỉ giữa hiệp knockout", "knockoutTiming.preparationBeforeMinutes": "Chuẩn bị sân knockout",
    "knockoutTiming.transitionAfterMinutes": "Chuyển tiếp sân knockout", "knockoutTiming.extraTimeReserveMinutes": "Hiệp phụ knockout",
    "knockoutTiming.penaltyReserveMinutes": "Dự phòng penalty knockout",
  };
  return labels[key] ?? key;
}
function searchStatusLabel(status: ScheduleSetupAnalysis["search"]["status"]) {
  const labels: Record<ScheduleSetupAnalysis["search"]["status"], string> = {
    NOT_RUN: "Chưa chạy tìm kiếm", COMPLETE: "Đã tìm thấy lịch đầy đủ", PARTIAL: "Tìm được lịch hợp lệ một phần",
    INFEASIBLE: "Không tìm thấy lịch đầy đủ trong cấu hình hiện tại", TIMEOUT: "Chưa thể kết luận · hết giới hạn tìm kiếm", NO_TARGETS: "Không có trận cần xếp",
  };
  return labels[status];
}
function objectiveOptions(hasKnockout: boolean) {
  return [
    { id: "MINIMIZE_CHANGES" as const, label: "Hạn chế đổi lịch hiện tại", description: "Nếu có lịch nháp chưa khóa, ưu tiên giữ nguyên ngày, giờ và sân khi chúng vẫn hợp lệ." },
    { id: "COMPLETION" as const, label: "Hoàn thành sớm", description: "Ưu tiên lịch kết thúc sớm nhưng vẫn giữ các điều kiện bắt buộc." },
    { id: "REST" as const, label: "Thời gian nghỉ", description: "Ưu tiên khoảng nghỉ hợp lý cho các đội." },
    { id: "FAIRNESS" as const, label: "Công bằng sân và giờ", description: "Giảm chênh lệch sân và khung giờ giữa các đội." },
    { id: "TRAVEL" as const, label: "Hạn chế di chuyển", description: "Ưu tiên giữ đội ở cùng khu vực/sân khi điều kiện khác tương đương; không đoán khoảng cách tuyến đường." },
    { id: "VENUE_USE" as const, label: "Sử dụng sân", description: "Giảm khoảng trống và phân bổ công suất sân." },
    ...(hasKnockout ? [{ id: "BRANCH_REST" as const, label: "Cân bằng nghỉ giữa nhánh", description: "Hạn chế lệch thời gian nghỉ giữa các nhánh knockout." }, { id: "CENTRAL_VENUE" as const, label: "Ưu tiên sân trung tâm", description: "Dùng sân trung tâm cho vòng quan trọng khi khả thi." }] : []),
  ];
}
