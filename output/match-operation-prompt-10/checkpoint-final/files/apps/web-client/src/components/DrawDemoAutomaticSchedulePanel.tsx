import { useMemo, useState } from "react";
import type { DrawCandidate } from "../api/competition";
import type { AutoScheduleConfiguration, AutoScheduleObjective, AutoSchedulePreview, DemoFixture, DemoScheduleEntry, DemoScheduleResources } from "../utils/drawTestStorage";
import { MAX_AUTOMATIC_SCHEDULE_RUNTIME_MS, selectFixturesForAutomaticSchedule } from "../utils/automaticSchedulePlanner";

const objectiveLabels: Record<AutoScheduleObjective, string> = {
  MINIMIZE_CHANGES: "Hạn chế thay đổi lịch hiện tại",
  REST: "Đảm bảo thời gian nghỉ hợp lý",
  FAIRNESS: "Xoay tua sân và khung giờ công bằng",
  TRAVEL: "Hạn chế di chuyển giữa sân",
  VENUE_USE: "Tối ưu sử dụng sân",
  COMPLETION: "Hoàn thành giải sớm",
  BRANCH_REST: "Cân bằng thời gian nghỉ giữa các nhánh",
  CENTRAL_VENUE: "Ưu tiên sân trung tâm cho vòng quan trọng",
};

const objectiveOrder: AutoScheduleObjective[] = ["MINIMIZE_CHANGES", "REST", "FAIRNESS", "TRAVEL", "VENUE_USE", "COMPLETION", "BRANCH_REST", "CENTRAL_VENUE"];

export function defaultAutoScheduleConfiguration(startDate = "", endDate = ""): AutoScheduleConfiguration {
  return {
    scope: { phase: "ALL", groups: [], rounds: [], onlyUnscheduled: true, legs: [], fixtureIds: [], dateRange: { start: startDate, end: endDate } },
    objectives: objectiveOrder,
    maxRuntimeMs: MAX_AUTOMATIC_SCHEDULE_RUNTIME_MS,
  };
}

type MultiSelectOption = { value: string; label: string; searchText?: string };
type SearchableMultiSelectProps = {
  label: string;
  options: MultiSelectOption[];
  values: string[];
  disabled: boolean;
  emptyLabel: string;
  onChange: (values: string[]) => void;
};

function SearchableMultiSelect({ label, options, values, disabled, emptyLabel, onChange }: SearchableMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = new Set(values);
  const selectedLabels = options.filter((option) => selected.has(option.value));
  const normalizedQuery = query.trim().toLocaleLowerCase("vi-VN");
  const filteredOptions = options.filter((option) => `${option.label} ${option.searchText ?? ""}`.toLocaleLowerCase("vi-VN").includes(normalizedQuery));
  const allFilteredSelected = filteredOptions.length > 0 && filteredOptions.every((option) => selected.has(option.value));

  const toggleValue = (value: string) => onChange(selected.has(value) ? values.filter((item) => item !== value) : [...values, value]);
  const toggleFiltered = () => {
    if (allFilteredSelected) {
      const remove = new Set(filteredOptions.map((option) => option.value));
      onChange(values.filter((value) => !remove.has(value)));
      return;
    }
    onChange([...new Set([...values, ...filteredOptions.map((option) => option.value)])]);
  };

  return <div className="step5-assistant-multiselect">
    <span className="step5-assistant-field-label">{label}</span>
    <button className="step5-assistant-multiselect-trigger" type="button" disabled={disabled} aria-expanded={open} onClick={() => setOpen((current) => !current)}>
      <span>{values.length ? `${values.length} mục đã chọn` : emptyLabel}</span><span aria-hidden="true">⌄</span>
    </button>
    {selectedLabels.length ? <div className="step5-assistant-selected-chips" aria-label={`${label} đã chọn`}>
      {selectedLabels.map((option) => <span className="step5-assistant-chip" key={option.value}>{option.label}<button type="button" disabled={disabled} aria-label={`Bỏ chọn ${option.label}`} onClick={() => toggleValue(option.value)}>×</button></span>)}
    </div> : <small className="step5-assistant-hint">Để trống để áp dụng toàn bộ trong phạm vi.</small>}
    {open ? <div className="step5-assistant-multiselect-menu">
      <label className="step5-assistant-search"><span aria-hidden="true">⌕</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Tìm ${label.toLocaleLowerCase("vi-VN")}`} aria-label={`Tìm ${label.toLocaleLowerCase("vi-VN")}`} /></label>
      {filteredOptions.length ? <>
        <label className="step5-assistant-select-all"><input type="checkbox" checked={allFilteredSelected} onChange={toggleFiltered} /> Chọn tất cả kết quả <span>({filteredOptions.length})</span></label>
        <div className="step5-assistant-option-list" role="group" aria-label={`Các lựa chọn ${label}`}>
          {filteredOptions.map((option) => <label key={option.value}><input type="checkbox" checked={selected.has(option.value)} onChange={() => toggleValue(option.value)} /><span>{option.label}</span></label>)}
        </div>
      </> : <p className="step5-assistant-empty">Không tìm thấy mục phù hợp.</p>}
      <div className="step5-assistant-menu-footer"><span>{values.length} mục đã chọn</span><button type="button" className="text-button" onClick={() => setOpen(false)}>Xong</button></div>
    </div> : null}
  </div>;
}

type Props = {
  configuration: AutoScheduleConfiguration;
  preview: AutoSchedulePreview | null;
  fixtures: DemoFixture[];
  teams: DrawCandidate[];
  currentEntries: Record<string, DemoScheduleEntry>;
  resources: DemoScheduleResources;
  pitchType: 5 | 7 | 11;
  running: boolean;
  disabled: boolean;
  runDisabled?: boolean;
  runDisabledReason?: string;
  showRunAction?: boolean;
  error?: string;
  onChange: (configuration: AutoScheduleConfiguration) => void;
  onRun: () => void;
  onCancel: () => void;
};

function phaseMatches(fixture: DemoFixture, phase: AutoScheduleConfiguration["scope"]["phase"]) {
  return phase === "ALL" || (phase === "GROUP" && fixture.stage === "GROUP") || (phase === "KNOCKOUT" && fixture.stage === "KNOCKOUT");
}

function sortRounds(rounds: string[]) {
  return [...rounds].sort((left, right) => Number(left.match(/\d+/)?.[0] ?? 999) - Number(right.match(/\d+/)?.[0] ?? 999) || left.localeCompare(right, "vi"));
}

export function DrawDemoAutomaticSchedulePanel({ configuration, preview, fixtures, teams, currentEntries, resources, pitchType, running, disabled, runDisabled = false, runDisabledReason, showRunAction = true, error, onChange, onRun, onCancel }: Props) {
  const [matchQuery, setMatchQuery] = useState("");
  const scope = configuration.scope;
  const teamNames = useMemo(() => new Map(teams.map((team) => [team.teamId, team.shortName || team.name])), [teams]);
  const hasGroup = fixtures.some((fixture) => fixture.stage === "GROUP");
  const hasKnockout = fixtures.some((fixture) => fixture.stage === "KNOCKOUT");
  const allGroups = [...new Set(fixtures.filter((fixture) => fixture.stage === "GROUP" && fixture.groupName).map((fixture) => fixture.groupName!))].sort((left, right) => left.localeCompare(right, "vi"));
  const phaseFixtures = fixtures.filter((fixture) => phaseMatches(fixture, scope.phase));
  const groupFilteredFixtures = phaseFixtures.filter((fixture) => !scope.groups.length || Boolean(fixture.groupName && scope.groups.includes(fixture.groupName)));
  const roundOptions = sortRounds([...new Set(groupFilteredFixtures.map((fixture) => fixture.round))]);
  const roundFilteredFixtures = groupFilteredFixtures.filter((fixture) => !scope.rounds.length || scope.rounds.includes(fixture.round));
  const legOptions = [...new Set(roundFilteredFixtures.map((fixture) => fixture.leg).filter((leg): leg is number => Number.isInteger(leg)))].sort((left, right) => left - right);
  const allTargets = selectFixturesForAutomaticSchedule(fixtures, currentEntries, configuration);
  const explicitScope = { ...scope, fixtureIds: [] };
  const selectableFixtures = selectFixturesForAutomaticSchedule(fixtures, currentEntries, { ...configuration, scope: explicitScope });
  const selectableIds = new Set(selectableFixtures.map((fixture) => fixture.id));
  const selectedFixtureIds = (scope.fixtureIds ?? []).filter((id) => selectableIds.has(id));
  const selectedFixtureSet = new Set(selectedFixtureIds);
  const allSelectableChosen = selectableFixtures.length > 0 && selectableFixtures.every((fixture) => selectedFixtureSet.has(fixture.id));
  const groups = allGroups.filter((group) => scope.phase !== "KNOCKOUT" && phaseFixtures.some((fixture) => fixture.groupName === group));
  const objectiveChoices = objectiveOrder.filter((item) => (item !== "BRANCH_REST" || hasKnockout) && (item !== "CENTRAL_VENUE" || hasKnockout));
  const visibleObjectives = configuration.objectives.filter((objective) => objectiveChoices.includes(objective));
  const totalFixtures = fixtures.filter((fixture) => !fixture.bye).length;
  const lockedCount = Object.values(currentEntries).filter((entry) => entry.locked).length;
  const scheduledCount = fixtures.filter((fixture) => !fixture.bye && Boolean(currentEntries[fixture.id]?.scheduledAt)).length;
  const confirmedVenueCount = resources.venues.filter((venue) => venue.active && venue.pitchType === pitchType && venue.availabilityConfirmed === true).length;
  const dateStart = scope.dateRange?.start ?? resources.competitionStartDate;
  const dateEnd = scope.dateRange?.end ?? resources.competitionEndDate;
  const allowedDateStart = resources.officialCompetitionStartDate || resources.competitionStartDate;
  const allowedDateEnd = resources.officialCompetitionEndDate || resources.competitionEndDate;
  const dateOrderInvalid = Boolean(dateStart && dateEnd && dateStart > dateEnd);
  const dateOutsideCompetition = Boolean((allowedDateStart && dateStart && dateStart < allowedDateStart) || (allowedDateEnd && dateEnd && dateEnd > allowedDateEnd));
  const dateRangeInvalid = dateOrderInvalid || dateOutsideCompetition;
  const startDateMax = dateEnd && allowedDateEnd ? (dateEnd < allowedDateEnd ? dateEnd : allowedDateEnd) : dateEnd || allowedDateEnd || undefined;
  const endDateMin = dateStart && allowedDateStart ? (dateStart > allowedDateStart ? dateStart : allowedDateStart) : dateStart || allowedDateStart || undefined;

  const changeScope = (update: Partial<AutoScheduleConfiguration["scope"]>) => {
    const nextScope = { ...scope, ...update };
    const baseConfiguration = { ...configuration, scope: { ...nextScope, fixtureIds: [] } };
    const allowedFixtureIds = new Set(selectFixturesForAutomaticSchedule(fixtures, currentEntries, baseConfiguration).map((fixture) => fixture.id));
    const fixtureIds = (nextScope.fixtureIds ?? []).filter((id) => allowedFixtureIds.has(id));
    onChange({ ...configuration, scope: { ...nextScope, fixtureIds } });
  };

  const matchName = (teamId: string | null, source?: string) => source || (teamId ? teamNames.get(teamId) ?? "Đội đang chờ xác định" : "Đội đang chờ xác định");
  const fixtureSearchText = (fixture: DemoFixture) => [fixture.id, fixture.round, fixture.groupName, matchName(fixture.homeTeamId, fixture.homeSource), matchName(fixture.awayTeamId, fixture.awaySource)].filter(Boolean).join(" ").toLocaleLowerCase("vi-VN");
  const changeSpecificFixture = (fixtureId: string, checked: boolean) => {
    const next = new Set(selectedFixtureIds);
    if (checked) next.add(fixtureId); else next.delete(fixtureId);
    changeScope({ fixtureIds: [...next] });
  };
  const toggleAllSelectableFixtures = () => {
    if (allSelectableChosen) {
      const selectable = new Set(selectableFixtures.map((fixture) => fixture.id));
      changeScope({ fixtureIds: selectedFixtureIds.filter((id) => !selectable.has(id)) });
      return;
    }
    changeScope({ fixtureIds: [...new Set([...selectedFixtureIds, ...selectableFixtures.map((fixture) => fixture.id)])] });
  };
  const resetFilters = () => onChange({
    ...configuration,
    scope: defaultAutoScheduleConfiguration(resources.competitionStartDate, resources.competitionEndDate).scope,
  });
  const moveObjective = (objective: AutoScheduleObjective, direction: -1 | 1) => {
    const visibleIndex = visibleObjectives.indexOf(objective);
    const destination = visibleObjectives[visibleIndex + direction];
    if (!destination) return;
    const next = [...configuration.objectives];
    const currentIndex = next.indexOf(objective);
    const destinationIndex = next.indexOf(destination);
    [next[currentIndex], next[destinationIndex]] = [next[destinationIndex], next[currentIndex]];
    onChange({ ...configuration, objectives: next });
  };

  const statusLabel = preview?.status === "COMPLETE" ? "Đã tìm được lịch hợp lệ cho phạm vi"
    : preview?.status === "PARTIAL" ? "Đề xuất được một phần lịch"
      : preview?.status === "TIMEOUT" ? "Chưa tìm thấy đủ lịch trong giới hạn xử lý"
        : preview?.status === "INFEASIBLE" ? "Không tìm được phương án hợp lệ"
          : preview?.status === "NO_TARGETS" ? "Không có trận phù hợp phạm vi" : "";
  const unplacedCount = preview ? Math.max(0, preview.selectedFixtureIds.length - preview.scheduledFixtureIds.length) : 0;

  return <section className="step5-auto-panel" aria-label="Trợ lý lập lịch">
    <header className="step5-assistant-header"><div><span className="eyebrow">TRỢ LÝ LẬP LỊCH · MATCH SERVICE</span><h3>Trợ lý lập lịch</h3><p>Tạo lịch thi đấu tự động theo các ràng buộc, giữ nguyên lịch đã khóa và cho phép điều chỉnh sau.</p></div></header>

    <div className="step5-assistant-stats" aria-label="Thống kê lịch thi đấu">
      <article><strong>{totalFixtures}</strong><span>Tổng số trận</span></article>
      <article><strong>{confirmedVenueCount}</strong><span>Số sân đã xác nhận</span></article>
      <article><strong>{lockedCount}</strong><span>Số lịch đã khóa</span></article>
      <article><strong>{scheduledCount}<small> / {totalFixtures}</small></strong><span>Số trận đã có lịch / tổng trận</span></article>
    </div>

    <div className="step5-assistant-grid">
      <section className="step5-assistant-card step5-assistant-scope" aria-labelledby="step5-assistant-scope-title">
        <header><div><span className="step5-assistant-card-kicker">01 · PHẠM VI</span><h4 id="step5-assistant-scope-title">Thiết lập phạm vi lập lịch</h4><p>Để trống các bộ lọc để áp dụng cho toàn bộ phạm vi đã chọn.</p></div></header>

        <fieldset className="step5-assistant-phase"><legend>Giai đoạn</legend><div role="radiogroup" aria-label="Giai đoạn lập lịch">
          <label className={scope.phase === "ALL" ? "is-active" : ""}><input type="radio" name="schedule-phase" value="ALL" disabled={disabled || running} checked={scope.phase === "ALL"} onChange={() => changeScope({ phase: "ALL", groups: [], rounds: [], legs: [], fixtureIds: [] })} />Toàn bộ giải</label>
          {hasGroup ? <label className={scope.phase === "GROUP" ? "is-active" : ""}><input type="radio" name="schedule-phase" value="GROUP" disabled={disabled || running} checked={scope.phase === "GROUP"} onChange={() => changeScope({ phase: "GROUP", groups: [], rounds: [], legs: [], fixtureIds: [] })} />{!hasKnockout && !allGroups.length ? "Vòng tròn" : "Vòng bảng"}</label> : null}
          {hasKnockout ? <label className={scope.phase === "KNOCKOUT" ? "is-active" : ""}><input type="radio" name="schedule-phase" value="KNOCKOUT" disabled={disabled || running} checked={scope.phase === "KNOCKOUT"} onChange={() => changeScope({ phase: "KNOCKOUT", groups: [], rounds: [], legs: [], fixtureIds: [] })} />Vòng loại trực tiếp</label> : null}
        </div></fieldset>

        <div className="step5-assistant-filter-grid">
          {groups.length ? <SearchableMultiSelect label="Bảng đấu" options={groups.map((group) => ({ value: group, label: group }))} values={scope.groups} disabled={disabled || running} emptyLabel="Tất cả bảng trong giai đoạn" onChange={(groups) => changeScope({ groups, rounds: [], legs: [], fixtureIds: [] })} /> : null}
          {roundOptions.length ? <SearchableMultiSelect label="Vòng đấu" options={roundOptions.map((round) => ({ value: round, label: round }))} values={scope.rounds} disabled={disabled || running} emptyLabel="Tất cả vòng trong phạm vi" onChange={(rounds) => changeScope({ rounds, legs: [], fixtureIds: [] })} /> : null}
          {legOptions.length > 1 ? <SearchableMultiSelect label="Lượt thi đấu" options={legOptions.map((leg) => ({ value: String(leg), label: `Lượt ${leg}` }))} values={(scope.legs ?? []).map(String)} disabled={disabled || running} emptyLabel="Tất cả lượt" onChange={(legs) => changeScope({ legs: legs.map(Number), fixtureIds: [] })} /> : null}
        </div>

        <div className="step5-assistant-date-grid">
          <label>Từ ngày<input type="date" value={dateStart} min={allowedDateStart || undefined} max={startDateMax} disabled={disabled || running} aria-invalid={dateRangeInvalid} onChange={(event) => changeScope({ dateRange: { start: event.target.value, end: dateEnd } })} /></label>
          <label>Đến ngày<input type="date" value={dateEnd} min={endDateMin} max={allowedDateEnd || undefined} disabled={disabled || running} aria-invalid={dateRangeInvalid} onChange={(event) => changeScope({ dateRange: { start: dateStart, end: event.target.value } })} /></label>
        </div>
        {dateRangeInvalid ? <p className="step5-assistant-inline-error" role="alert">{dateOrderInvalid ? "Ngày bắt đầu phải trước hoặc bằng ngày kết thúc." : "Khoảng ngày phải nằm trong thời gian chính thức của giải."}</p> : null}

        <label className="step5-assistant-only-unscheduled"><input type="checkbox" disabled={disabled || running} checked={scope.onlyUnscheduled} onChange={(event) => changeScope({ onlyUnscheduled: event.target.checked })} /><span><b>Chỉ áp dụng cho các trận chưa có lịch</b><small>Mặc định bật để giữ nguyên lịch hiện tại; lịch đã khóa và lịch chính thức luôn được bảo vệ.</small></span></label>

        <details className="step5-assistant-fixture-picker">
          <summary><span><b>Chọn trận cụ thể</b><small>Lọc thêm theo mã trận, đội, bảng hoặc vòng.</small></span><span className="step5-assistant-picker-count">{selectedFixtureIds.length ? `${selectedFixtureIds.length} đã chọn` : `${allTargets.length} trận trong phạm vi`}</span></summary>
          <div className="step5-assistant-picker-body">
            <label className="step5-assistant-search"><span aria-hidden="true">⌕</span><input value={matchQuery} onChange={(event) => setMatchQuery(event.target.value)} placeholder="Tìm mã trận, đội, bảng, vòng" aria-label="Tìm trận theo mã, đội, bảng hoặc vòng" /></label>
            <label className="step5-assistant-select-all"><input type="checkbox" checked={allSelectableChosen} disabled={disabled || running || !selectableFixtures.length} onChange={toggleAllSelectableFixtures} /> Chọn tất cả trận thuộc phạm vi <span>({selectableFixtures.length})</span></label>
            <div className="step5-assistant-match-list" role="group" aria-label="Chọn trận cụ thể">
              {selectableFixtures.filter((fixture) => !matchQuery.trim() || fixtureSearchText(fixture).includes(matchQuery.trim().toLocaleLowerCase("vi-VN"))).map((fixture) => <label key={fixture.id}>
                <input type="checkbox" disabled={disabled || running} checked={selectedFixtureSet.has(fixture.id)} onChange={(event) => changeSpecificFixture(fixture.id, event.target.checked)} />
                <span><b>{fixture.id}</b><small>{matchName(fixture.homeTeamId, fixture.homeSource)} <i>vs</i> {matchName(fixture.awayTeamId, fixture.awaySource)}</small><small>{fixture.groupName ? `${fixture.groupName} · ` : ""}{fixture.round}{fixture.leg ? ` · Lượt ${fixture.leg}` : ""}</small></span>
              </label>)}
              {!selectableFixtures.length ? <p className="step5-assistant-empty">Không có trận nào trong phạm vi hiện tại.</p> : null}
              {selectableFixtures.length && !selectableFixtures.some((fixture) => fixtureSearchText(fixture).includes(matchQuery.trim().toLocaleLowerCase("vi-VN"))) && matchQuery.trim() ? <p className="step5-assistant-empty">Không tìm thấy trận phù hợp.</p> : null}
            </div>
            <p className="step5-assistant-target-count"><b>{allTargets.length}</b> trận thực sự được chọn để lập lịch</p>
          </div>
        </details>
      </section>

      <section className="step5-assistant-card step5-assistant-priorities" aria-labelledby="step5-assistant-priority-title">
        <header><div><span className="step5-assistant-card-kicker">02 · MỤC TIÊU</span><h4 id="step5-assistant-priority-title">Ưu tiên tối ưu <small>(tùy chọn)</small></h4><p>Sắp xếp mục tiêu theo mức quan trọng với giải đấu.</p></div></header>
        {visibleObjectives.length ? <ol>{visibleObjectives.map((objective, index) => <li key={objective}>
          <span className="step5-assistant-priority-number">{index + 1}</span><b>{objectiveLabels[objective]}</b>
          <div><button type="button" aria-label={`Tăng ưu tiên ${objectiveLabels[objective]}`} disabled={disabled || running || index === 0} onClick={() => moveObjective(objective, -1)}>↑</button><button type="button" aria-label={`Giảm ưu tiên ${objectiveLabels[objective]}`} disabled={disabled || running || index === visibleObjectives.length - 1} onClick={() => moveObjective(objective, 1)}>↓</button></div>
        </li>)}</ol> : <p className="step5-assistant-empty">Chưa có mục tiêu tối ưu trong cấu hình.</p>}
        <p className="step5-assistant-priority-note">Đây là thứ tự ưu tiên tối ưu, không thay thế các ràng buộc bắt buộc.</p>
      </section>
    </div>

    <footer className="step5-assistant-actions">
      <button type="button" className="button button-secondary" disabled={disabled || running} onClick={resetFilters}>Đặt lại</button>
      <div className="step5-assistant-actions-primary">
        {showRunAction && (preview || running) ? <button type="button" className="button button-secondary" disabled={disabled && !running} onClick={onCancel}>{running ? "Dừng xử lý" : "Hủy phương án"}</button> : null}
        {showRunAction ? <button className="button button-primary" type="button" disabled={disabled || runDisabled || running || dateRangeInvalid || !allTargets.length} onClick={onRun}>{running ? "Đang tạo lịch…" : "Tạo lịch tự động"}</button> : null}
      </div>
    </footer>
    {runDisabledReason && !disabled ? <p className="step5-assistant-run-blocker" role="status">{runDisabledReason}</p> : null}
    {error ? <p className="step5-assistant-error" role="alert">{error}</p> : null}
    {running ? <div className="step5-assistant-running" role="status"><span className="loading-spinner" /> Match Service đang tìm lịch hợp lệ, tối đa {Math.ceil(configuration.maxRuntimeMs / 60_000)} phút. Có thể dừng xử lý; bản nháp chưa bị thay đổi.</div> : null}
    {preview ? <section className="step5-assistant-result" aria-live="polite">
      <header><div><span className={`status-pill ${preview.status === "COMPLETE" ? "status-success" : "status-warning"}`}>{statusLabel}</span><small>{preview.elapsedMs} ms xử lý</small></div></header>
      <div className="step5-assistant-result-stats"><article><strong>{preview.scheduledFixtureIds.length}</strong><span>Trận lập được</span></article><article><strong>{unplacedCount}</strong><span>Trận chưa lập được</span></article><article><strong>{preview.selectedFixtureIds.length}</strong><span>Trận trong phạm vi</span></article></div>
      {preview.searchLimitReached ? <p className="step5-assistant-hint">Đã chạm giới hạn tìm kiếm. Kết quả hiện tại chưa chứng minh rằng không còn phương án tốt hơn.</p> : null}
      {preview.missing.length || preview.warnings.length || preview.candidateRejections?.length ? <details className="step5-assistant-errors">
        <summary>Xem chi tiết lỗi và lưu ý {preview.missing.length ? `(${preview.missing.length})` : ""}</summary>
        {preview.missing.length ? <ul>{preview.missing.map((item) => <li key={item.fixtureId}><b>{item.fixtureId}</b> · {item.reason}</li>)}</ul> : null}
        {preview.candidateRejections?.length ? <ul>{preview.candidateRejections.slice(0, 12).map((item) => <li key={item.code}><b>{item.code}</b> · {item.count} lựa chọn bị loại{item.examples[0] ? ` · ${item.examples[0]}` : ""}</li>)}</ul> : null}
        {preview.warnings.length ? <ul>{preview.warnings.slice(0, 12).map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul> : null}
      </details> : null}
    </section> : null}
  </section>;
}

