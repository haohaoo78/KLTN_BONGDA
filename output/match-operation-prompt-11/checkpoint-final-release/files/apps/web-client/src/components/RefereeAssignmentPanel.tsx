import { useEffect, useMemo, useRef, useState } from "react";
import type { DemoFixture } from "@sfl/shared";
import { ApiError } from "../api/client";
import { getDrawManagement, type DrawCandidate } from "../api/competition";
import { getRefereeAssignmentDetail, getRefereeAssignmentWorkspace, previewRefereeAssignmentPositions, saveRefereeAssignment, publishRefereeAssignments,
  type RefereeAssignmentDetail, type RefereeAssignmentMatch, type RefereeAssignmentStatus, type RefereeAssignmentWorkspace, type RefereeCandidateSuggestion, type RefereeDraftSlot } from "../api/refereeAssignment";
import type { RefereePosition } from "../api/refereeConfiguration";
import type { DrawTestState } from "../utils/drawTestStorage";
import { groupRefereeMatches, refereeFixtureCaption, refereeMatchDate, refereeMatchTime } from "../utils/refereeMatchView";
import { DrawDemoFixtureWorkspace } from "./DrawDemoFixtureWorkspace";
import { ScheduleMatchGroups } from "./ScheduleMatchGroups";
import { RefereePicker } from "./RefereePicker";
import { RefereePublicationActions, refereeEmailStatus, refereePublicationError } from "./RefereePublicationActions";
import { RefereePositionEditor } from "./RefereeConfigurationPanel";
import "./referee-assignment-panel.css";

const labels: Record<RefereeAssignmentStatus, string> = { UNASSIGNED: "○ Chưa phân công", PARTIAL: "◐ Còn thiếu", COMPLETE: "✓ Đã phân công đủ", CONFLICT: "⚠ Có xung đột", PUBLISHED: "📣 Đã công bố" };
const diagramLabels: Record<RefereeAssignmentStatus, string> = { UNASSIGNED: "Chưa phân công", PARTIAL: "Phân công nháp chưa đầy đủ", COMPLETE: "Phân công nháp đầy đủ", CONFLICT: "Cần xác minh lại", PUBLISHED: "Đã công bố" };
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const errorText = (error: unknown) => error instanceof Error ? error.message : "Không thể tải hoặc lưu phân công trọng tài.";


type Props = { tournamentId: string; tournamentName: string; onBusyChange: (value: boolean) => void; onConfigure: () => void; onGoToSchedule?: () => void; onSaved: () => void; reviewMode?: boolean; onAdjust?: () => void };
export function RefereeAssignmentPanel({ tournamentId, tournamentName, onBusyChange, onConfigure, onGoToSchedule, onSaved, reviewMode = false, onAdjust }: Props) {
  const [data, setData] = useState<RefereeAssignmentWorkspace | null>(null), [drawData, setDrawData] = useState<Awaited<ReturnType<typeof getDrawManagement>> | null>(null);
  const [loading, setLoading] = useState(true), [loadingDetail, setLoadingDetail] = useState(false), [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState(""), [detail, setDetail] = useState<RefereeAssignmentDetail | null>(null);
  const [positions, setPositions] = useState<RefereePosition[]>([]), [slots, setSlots] = useState<RefereeDraftSlot[]>([]), [preview, setPreview] = useState<RefereeAssignmentDetail | null>(null);
  const [view, setView] = useState<"LIST" | "CALENDAR" | "DIAGRAM">("LIST"), [query, setQuery] = useState(""), [stage, setStage] = useState("ALL"), [group, setGroup] = useState("ALL"), [round, setRound] = useState("ALL"), [status, setStatus] = useState("ALL"), [venue, setVenue] = useState("ALL"), [calendarDay, setCalendarDay] = useState("");
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [selectedForPublication, setSelectedForPublication] = useState<string[]>([]), [fromDate, setFromDate] = useState(""), [toDate, setToDate] = useState("");
  const publicationRequest = useRef<{ payload: string; id: string } | null>(null);
  const loadSeq = useRef(0), detailSeq = useRef(0), previewController = useRef<AbortController | null>(null), active = useRef(true), busyCallback = useRef(onBusyChange);
  busyCallback.current = onBusyChange;
  const dirty = Boolean(detail && (JSON.stringify(positions) !== JSON.stringify(detail.positions) || JSON.stringify(slots) !== JSON.stringify(detail.slots)));
  const disabled = !detail || detail.readOnly || data?.readOnly || loadingDetail || saving;
  const suggestions = preview?.suggestions ?? detail?.suggestions ?? [];
  async function load() {
    const seq = ++loadSeq.current; setLoading(true);
    try {
      const [workspace, draw] = await Promise.all([getRefereeAssignmentWorkspace(tournamentId), getDrawManagement(tournamentId)]);
      if (!active.current || seq !== loadSeq.current) return null;
      setData(workspace); setDrawData(draw); return workspace;
    } catch (failure) { if (active.current && seq === loadSeq.current) { setData(null); setError(errorText(failure)); } return null; }
    finally { if (active.current && seq === loadSeq.current) setLoading(false); }
  }
  useEffect(() => {
    active.current = true; void load();
    return () => { active.current = false; loadSeq.current += 1; detailSeq.current += 1; previewController.current?.abort(); busyCallback.current(false); };
  }, [tournamentId]);
  async function chooseMatch(matchId: string, force = false) {
    if (saving || matchId === selectedId && !force) return;
    if (dirty && !force) { setError("Lưu hoặc hủy thay đổi ở trận đang chọn trước khi chuyển sang trận khác."); return; }
    const seq = ++detailSeq.current; previewController.current?.abort(); setSelectedId(matchId); setLoadingDetail(true); setDetail(null); setPreview(null); setError(""); setNotice(""); setSlots([]); setPositions([]);
    try {
      const result = await getRefereeAssignmentDetail(tournamentId, matchId);
      if (!active.current || seq !== detailSeq.current) return;
      setDetail(result); setPositions(copy(result.positions)); setSlots(copy(result.slots));
    } catch (failure) { if (active.current && seq === detailSeq.current) setError(errorText(failure)); }
    finally { if (active.current && seq === detailSeq.current) setLoadingDetail(false); }
  }
  async function changePositions(next: RefereePosition[]) {
    if (disabled || !detail) return;
    const qualificationChanged = JSON.stringify(next.map((row) => [row.code, [...row.capabilities].sort()])) !== JSON.stringify(positions.map((row) => [row.code, [...row.capabilities].sort()]));
    setPositions(next); setSlots((current) => current.filter((slot) => next.some((position) => position.code === slot.position))); setError(""); setNotice("");
    if (!qualificationChanged) return;
    previewController.current?.abort(); const controller = new AbortController(); previewController.current = controller;
    const matchId = detail.matchId, seq = detailSeq.current;
    setLoadingDetail(true);
    try {
      const result = await previewRefereeAssignmentPositions(tournamentId, matchId, next, controller.signal);
      if (active.current && seq === detailSeq.current && !controller.signal.aborted) setPreview(result);
    } catch (failure) { if (active.current && seq === detailSeq.current && !controller.signal.aborted) { setPreview(null); setError(errorText(failure)); } }
    finally { if (active.current && seq === detailSeq.current && !controller.signal.aborted) setLoadingDetail(false); }
  }
  function resetChanges() { if (!detail || saving) return; previewController.current?.abort(); setPositions(copy(detail.positions)); setSlots(copy(detail.slots)); setPreview(null); setLoadingDetail(false); setError(""); setNotice(""); }
  async function save(nextMatch: boolean) {
    if (disabled || !detail || !dirty || error && positions.length !== suggestions.length) return;
    setSaving(true); busyCallback.current(true); setError(""); setNotice(""); const seq = detailSeq.current;
    try {
      const result = await saveRefereeAssignment(tournamentId, detail.matchId, { slots, expectedRevision: detail.revision, configurationRevision: detail.configurationRevision, scheduleSignature: detail.scheduleSignature,
        ...(JSON.stringify(positions) !== JSON.stringify(detail.positions) ? { matchPositions: positions } : {}) });
      if (!active.current || seq !== detailSeq.current) return;
      setDetail(result); setPositions(copy(result.positions)); setSlots(copy(result.slots)); setPreview(null);
      const workspace = await load(); onSaved();
      if (!active.current || seq !== detailSeq.current) return;
      setNotice(result.complete ? "Đã lưu bản nháp đủ phân công. Chưa công bố và chưa gửi email." : `Đã lưu bản nháp. Còn thiếu: ${result.missing.join(", ") || "vị trí bắt buộc"}.`);
      if (nextMatch && workspace) {
        const index = workspace.matches.findIndex((row) => row.matchId === result.matchId);
        const remaining = [...workspace.matches.slice(index + 1), ...workspace.matches.slice(0, index)].find((row) => !["COMPLETE", "PUBLISHED"].includes(row.status));
        if (remaining) {
          // The next match is loaded only after BTC explicitly chooses Save & next.
          const nextDetail = await getRefereeAssignmentDetail(tournamentId, remaining.matchId);
          if (!active.current || seq !== detailSeq.current) return;
          setSelectedId(remaining.matchId); setDetail(nextDetail); setPositions(copy(nextDetail.positions)); setSlots(copy(nextDetail.slots)); setNotice(`Đã lưu trận trước; đang phân công ${remaining.matchId}.`);
        }
      }
    } catch (failure) {
      if (active.current && seq === detailSeq.current) {
        const conflicts = failure instanceof ApiError && Array.isArray(failure.details?.conflicts) ? failure.details.conflicts as Array<{ position: string; issues: Array<{ message: string }> }> : [];
        setError([errorText(failure), ...conflicts.flatMap((conflict) => conflict.issues.map((issue) => `${positions.find((position) => position.code === conflict.position)?.label ?? conflict.position}: ${issue.message}`))].join(" "));
      }
    } finally { if (active.current && seq === detailSeq.current) { setSaving(false); busyCallback.current(false); } }
  }
  const teams: DrawCandidate[] = drawData?.eligibleTeams ?? [];
  const teamNames = new Map(teams.map((team) => [team.teamId, team.name]));
  const pair = (fixture: DemoFixture) => `${teamNames.get(fixture.homeTeamId ?? "") ?? fixture.homeSource ?? "Chờ xác định"} — ${teamNames.get(fixture.awayTeamId ?? "") ?? fixture.awaySource ?? "Chờ xác định"}`;
  const matches = data?.matches ?? [], context = data?.scheduleContext;
  const matchById = new Map(matches.map((match) => [match.matchId, match]));
  const shown = matches.filter((match) => (stage === "ALL" || match.fixture.stage === stage) && (group === "ALL" || match.fixture.groupName === group) && (round === "ALL" || match.fixture.round === round) && (status === "ALL" || match.status === status) && (venue === "ALL" || match.schedule.venueId === venue)
    && (!fromDate || refereeMatchDate(match.schedule.scheduledDate) >= fromDate) && (!toDate || refereeMatchDate(match.schedule.scheduledDate) <= toDate)
    && `${match.matchId} ${pair(match.fixture)} ${match.fixture.groupName ?? ""} ${match.fixture.round}`.toLocaleLowerCase("vi").includes(query.trim().toLocaleLowerCase("vi")));
  const format = context?.tournamentContext.competitionFormat ?? "ROUND_ROBIN";
  const groups = groupRefereeMatches(shown.map((match) => match.fixture), format);
  const dates = [...new Set(shown.map((match) => refereeMatchDate(match.schedule.scheduledDate)))].sort();
  const date = calendarDay || dates[0] || "";
  const dayMatches = shown.filter((match) => refereeMatchDate(match.schedule.scheduledDate) === date);
  const state = useMemo<DrawTestState | null>(() => {
    if (!context || !drawData) return null;
    const draw = [drawData.latestVersion, ...drawData.history].find((row) => row?.id === context.drawVersionId && row.status === "PUBLISHED");
    if (!draw) return null;
    const allocated = draw.groups.map((item) => [...item.assignments].sort((left, right) => left.position - right.position));
    const slots = allocated.flatMap((rows) => rows.map((row) => row.teamId));
    return { version: 1, tournamentId, configuration: null, directSession: null,
      publication: { method: draw.method === "MANUAL" ? "MANUAL" : "RANDOM", format: context.tournamentContext.competitionFormat,
        teamIds: slots.filter((id): id is string => Boolean(id)), slots, teamsPerGroup: allocated.map((rows) => rows.length), groupCount: allocated.length,
        qualifiersPerGroup: context.rules?.advancingTeamsPerGroup ?? 0, extraQualificationSlots: 0, publishedAt: draw.publishedAt ?? draw.createdAt },
      fixtures: context.fixtures, fixturesPublishedAt: context.schedulePublishedAt, completedSteps: { step3: true, step4: true }, currentStep: 6, updatedAt: context.schedulePublishedAt ?? draw.createdAt };
  }, [context, drawData, tournamentId]);
  const renderBadge = (match: RefereeAssignmentMatch) => <span className={`referee-assignment-badge is-${match.status.toLowerCase()}`}>{labels[match.status]}{match.isPublished && match.status === "CONFLICT" ? " · Đã công bố" : ""}</span>;
  const eligibleToPublish = (row: RefereeAssignmentMatch) => !row.isPublished && row.status === "COMPLETE" && !row.issues.length;
  const publishScope = shown.filter((row) => selectedForPublication.includes(row.matchId) && eligibleToPublish(row));
  const visibleEligible = shown.filter(eligibleToPublish);
  async function refreshPublication() { await load(); if (selectedId) await chooseMatch(selectedId, true); onSaved(); }
  async function publish() {
    if (!publishScope.length || saving || data?.readOnly) return;
    const payload = JSON.stringify(publishScope.map((row) => [row.matchId, row.revision, row.configurationRevision, row.scheduleSignature]));
    if (publicationRequest.current?.payload !== payload) publicationRequest.current = { payload, id: crypto.randomUUID() };
    setSaving(true); busyCallback.current(true); setError(""); setNotice("");
    try {
      const result = await publishRefereeAssignments(tournamentId, publicationRequest.current.id, publishScope);
      if (!active.current) return;
      setSelectedForPublication([]); publicationRequest.current = null; await load(); onSaved();
      if (selectedId) { const next = await getRefereeAssignmentDetail(tournamentId, selectedId); setDetail(next); setPositions(copy(next.positions)); setSlots(copy(next.slots)); }
      setNotice(`Đã công bố ${result.publishedMatchIds.length} trận. Thông báo/email đã được ghi nhận để gửi; tải lại để xem kết quả SMTP thực tế.`);
    } catch (failure) { if (active.current) setError(refereePublicationError(failure)); }
    finally { if (active.current) { setSaving(false); busyCallback.current(false); } }
  }
  const reviewActions = (row: RefereeAssignmentMatch) => <RefereePublicationActions tournamentId={tournamentId} match={row} people={data?.people ?? []} disabled={saving || Boolean(data?.readOnly)} onChanged={() => { void refreshPublication(); }} onBusyChange={onBusyChange} />;
  function renderRow(fixture: DemoFixture) {
    const match = matchById.get(fixture.id)!;
    return <tr key={fixture.id} className={selectedId === fixture.id ? "is-selected" : ""} onClick={() => { void chooseMatch(fixture.id); }}>{reviewMode ? <td onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label={`Chọn công bố trận ${fixture.id}`} checked={publishScope.some((row) => row.matchId === fixture.id)} disabled={!eligibleToPublish(match) || saving || Boolean(data?.readOnly)} onChange={(event) => setSelectedForPublication((previous) => event.target.checked ? [...new Set([...previous, fixture.id])] : previous.filter((id) => id !== fixture.id))} /></td> : null}<td><button className="step5-list-match-link" type="button" onClick={(event) => { event.stopPropagation(); void chooseMatch(fixture.id); }} title={fixture.id} aria-label={fixture.id} aria-pressed={selectedId === fixture.id}>{fixture.id.slice(0, 8).toUpperCase()}</button></td><td>{pair(fixture)}<small>{refereeFixtureCaption(fixture)}</small></td><td>{new Date(match.schedule.scheduledDate).toLocaleDateString("vi-VN")}<small>{refereeMatchTime(match.schedule.scheduledDate)} · {match.venueName}</small></td>{reviewMode ? <td>{match.crew.length ? match.crew.map((slot) => <small key={slot.position}><b>{slot.label}</b>: {slot.fullName}</small>) : <small>Chưa chọn người</small>}</td> : null}<td>{renderBadge(match)}<small>{match.assigned} đã chọn · {match.required} bắt buộc</small>{reviewMode && match.deliveries.length ? <small>{match.deliveries.some((item) => item.emailStatus === "FAILED") ? "⚠ Có email gửi thất bại" : match.deliveries.some((item) => item.emailStatus === "PENDING") ? "◷ Email chờ xác nhận" : "✓ SMTP đã tiếp nhận"}</small> : null}{reviewMode && match.issues.map((issue, index) => <small className="form-error" key={index}>{issue.message}</small>)}</td>{reviewMode ? <td>{reviewActions(match)}</td> : null}</tr>;
  }
  const selected = matchById.get(selectedId);
  const missing = positions.filter((position) => position.required && !slots.some((slot) => slot.position === position.code));
  return <section className={`referee-assignment${reviewMode ? " is-review" : ""}`} role="tabpanel" id={`step6-team-panel-${reviewMode ? 3 : 2}`} aria-labelledby={`step6-team-tab-${reviewMode ? 3 : 2}`}>
    {reviewMode ? <header className="referee-review-title"><h3>Kiểm tra, công bố & theo dõi</h3><p>Công bố các trận đã đủ người trong phạm vi BTC chọn. Lịch thi đấu giữ nguyên theo Bước 5.</p></header> : null}
    <div className="step6-team-metrics">{(reviewMode ? [["Trận phân công đủ", data?.stats.complete], ["Trận còn thiếu", data?.stats.missing], ["Trận có xung đột", data?.stats.conflicts], ["Trận đã công bố", data?.stats.published]] : [["Tổng số trận", data?.stats.total], ["Đã phân công đủ", data?.stats.complete], ["Còn thiếu phân công", data?.stats.missing], ["Tỷ lệ hoàn thành", data ? `${data.stats.completionRate}%` : undefined]]).map(([label, value]) => <article key={label}><span>{label}</span><strong>{value ?? "—"}</strong></article>)}</div>
    {error ? <p className="form-error" role="alert">{error}</p> : null}{notice ? <p className="form-success" role="status">{notice}</p> : null}
    {data?.readOnlyReason ? <div className="step6-team-readonly"><p>{data.readOnlyReason}</p>{onGoToSchedule ? <button type="button" className="button button-secondary" onClick={onGoToSchedule}>Quay lại Bước 5</button> : null}</div> : null}
    {data?.configurationRequired && !data.readOnly ? <div className="step6-team-readonly">Chưa có cấu hình trọng tài đã lưu. <button type="button" className="text-button" onClick={onConfigure}>Mở Cấu hình trọng tài</button></div> : null}
    <div className="referee-assignment-layout"><section className="step5-workspace referee-match-browser" aria-label="Chọn trận để phân công"><header><h3>Trận đấu đã có lịch chính thức</h3><button type="button" className="button button-secondary" disabled={loading || saving || dirty} onClick={() => { setError(""); void load(); if (selectedId) void chooseMatch(selectedId, true); }}>Tải lại</button></header>
      <div className="step5-ws-view-tabs" role="tablist" aria-label="Chế độ xem trận">{([ ["LIST", "Danh sách trận"], ["CALENDAR", "Lịch theo ngày/sân"], ["DIAGRAM", "Sơ đồ thi đấu"] ] as const).map(([value, label]) => <button type="button" role="tab" aria-selected={view === value} key={value} onClick={() => setView(value)}>{label}</button>)}</div>
      <div className="referee-match-filters"><input type="search" aria-label="Tìm trận đấu" placeholder="Mã trận, đội, nguồn đi tiếp…" value={query} onChange={(event) => setQuery(event.target.value)} /><details><summary>Bộ lọc</summary><div>{new Set(matches.map((match) => match.fixture.stage)).size > 1 ? <label>Giai đoạn<select value={stage} onChange={(event) => { setStage(event.target.value); setGroup("ALL"); setRound("ALL"); }}><option value="ALL">Tất cả</option><option value="GROUP">Vòng bảng</option><option value="KNOCKOUT">Loại trực tiếp</option></select></label> : null}{matches.some((match) => match.fixture.groupName) ? <label>Bảng<select value={group} onChange={(event) => setGroup(event.target.value)}><option value="ALL">Tất cả bảng</option>{[...new Set(matches.filter((match) => stage === "ALL" || match.fixture.stage === stage).map((match) => match.fixture.groupName).filter(Boolean))].map((name) => <option key={name}>{name}</option>)}</select></label> : null}<label>Vòng<select value={round} onChange={(event) => setRound(event.target.value)}><option value="ALL">Tất cả vòng</option>{[...new Set(matches.filter((match) => stage === "ALL" || match.fixture.stage === stage).map((match) => match.fixture.round))].map((name) => <option key={name}>{name}</option>)}</select></label><label>Sân<select value={venue} onChange={(event) => setVenue(event.target.value)}><option value="ALL">Tất cả sân</option>{[...new Map(matches.map((match) => [match.schedule.venueId, match.venueName])).entries()].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label><label>Phân công<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="ALL">Mọi trạng thái</option>{Object.entries(labels).map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label><button type="button" className="text-button" onClick={() => { setQuery(""); setStage("ALL"); setGroup("ALL"); setRound("ALL"); setStatus("ALL"); setVenue("ALL"); setFromDate(""); setToDate(""); }}>Xóa lọc</button></div></details></div>
      {reviewMode ? <div className="referee-review-date-filter"><label>Từ ngày<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label><label>Đến ngày<input type="date" min={fromDate || undefined} value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>{fromDate && toDate && fromDate > toDate ? <p className="form-error">Ngày kết thúc phải từ ngày bắt đầu trở đi.</p> : null}</div> : null}
      <div className="referee-match-views">{loading && !data ? <p>Đang tải lịch từ Match Service…</p> : !data ? <p>Chưa tải được dữ liệu. Bấm Tải lại để thử lại.</p> : !matches.length ? <div className="step5-empty-view">Chưa có trận nào có lịch chính thức. Công bố lịch ở Bước 5 trước khi phân công.</div> : <>
        {view === "LIST" ? <ScheduleMatchGroups groups={groups} columns={<>{reviewMode ? <th><span className="sr-only">Chọn công bố</span></th> : null}<th>Mã trận</th><th>Đội / nguồn đi tiếp</th><th>Lịch thi đấu</th>{reviewMode ? <th>Trọng tài theo vị trí</th> : null}<th>Phân công</th>{reviewMode ? <th>Thao tác</th> : null}</>} renderRow={renderRow} /> : null}
        {view === "CALENDAR" ? <div className="step5-ws-calendar referee-match-calendar"><header className="step5-ws-calendar-heading"><h4>Lịch theo ngày/sân</h4><label>Ngày xem<input type="date" value={date} onChange={(event) => setCalendarDay(event.target.value)} /></label></header><div className="referee-calendar-dates">{dates.map((day) => <button type="button" key={day} className={date === day ? "is-selected" : ""} onClick={() => setCalendarDay(day)}>{new Date(`${day}T12:00:00`).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" })}</button>)}</div>{!dayMatches.length ? <p className="step5-empty-view">Không có trận trong ngày được chọn.</p> : [...new Map(dayMatches.map((match) => [match.schedule.venueId, match.venueName])).entries()].map(([id, name]) => <section className="referee-calendar-venue" key={id}><h5>{name}</h5><div className="referee-calendar-track"><div className="referee-calendar-axis">{[0, 6, 12, 18, 24].map((hour) => <span key={hour}>{String(hour).padStart(2, "0")}:00</span>)}</div>{dayMatches.filter((match) => match.schedule.venueId === id).map((match) => {
          const [hour, minute] = refereeMatchTime(match.schedule.scheduledDate).split(":").map(Number), left = (hour * 60 + minute) / 1440 * 100;
          return <button type="button" key={match.matchId} className={`referee-calendar-match is-${match.status.toLowerCase()} ${selectedId === match.matchId ? "is-selected" : ""}`} style={{ left: `${left}%`, width: `${Math.min(100 - left, Math.max(match.schedule.durationMinutes / 1440 * 100, 8))}%` }} onClick={() => { void chooseMatch(match.matchId); }}><b>{match.matchId}</b><span>{pair(match.fixture)}</span><small>{refereeMatchTime(match.schedule.scheduledDate)} · {refereeFixtureCaption(match.fixture)}</small>{renderBadge(match)}</button>;
        })}</div></section>)}</div> : null}
        {view === "DIAGRAM" ? state ? <DrawDemoFixtureWorkspace officialMode readOnly diagramOnly closeGroupOnFixtureSelect tournamentId={tournamentId} tournamentName={tournamentName} teams={teams} publishedState={state} selectedFixtureId={selectedId} schedulePublished scheduleByFixture={context?.entries} fixtureFilter={(fixture) => shown.some((match) => match.matchId === fixture.id)} onFixtureSelect={(fixture) => { void chooseMatch(fixture.id); }} scheduleDisplayByFixture={Object.fromEntries(matches.map((match) => [match.matchId, { status: match.schedule.isLocked ? "LOCKED" as const : "SCHEDULED" as const, venueName: match.venueName, endLabel: refereeMatchTime(new Date(Date.parse(match.schedule.scheduledDate) + match.schedule.durationMinutes * 60000).toISOString()) }]))} refereeDisplayByFixture={Object.fromEntries(matches.map((match) => [match.matchId, { status: diagramLabels[match.status], assigned: match.assigned, required: match.required, published: match.status === "PUBLISHED", tone: match.status.toLowerCase() as Lowercase<RefereeAssignmentStatus> }]))} /> : <p className="form-error">Không tải được kết quả bốc thăm chính thức tương ứng để hiển thị sơ đồ.</p> : null}
      </>}</div></section>
      <aside style={reviewMode && !selected ? { display: "none" } : undefined} className="referee-assignment-editor" aria-label="Phân công trận đã chọn"><header><span className="eyebrow">PHÂN CÔNG TRỌNG TÀI</span><h3>{selected ? "Trận đã chọn" : "Chọn một trận đấu"}</h3><p>{selected?.matchId ?? "Chọn từ danh sách, lịch hoặc sơ đồ bên trái."}</p></header>{loadingDetail && !detail ? <p>Đang phân tích gợi ý…</p> : selected && detail ? <>
        <section className="referee-assignment-match-info"><h4>{pair(selected.fixture)}</h4><p>{refereeFixtureCaption(selected.fixture)}</p><dl><div><dt>Ngày & giờ</dt><dd>{new Date(selected.schedule.scheduledDate).toLocaleDateString("vi-VN")} · {refereeMatchTime(selected.schedule.scheduledDate)}</dd></div><div><dt>Sân</dt><dd>{selected.venueName}</dd></div><div><dt>Khoảng làm nhiệm vụ</dt><dd>{refereeMatchTime(detail.occupancy.occupiedFrom)}–{refereeMatchTime(detail.occupancy.occupiedTo)}</dd></div><div><dt>Nghỉ tối thiểu</dt><dd>{detail.minimumRestMinutes} phút{!detail.minimumRestMinutes ? " · chưa đặt yêu cầu riêng" : ""}</dd></div></dl>{renderBadge(detail)}</section>
        {detail.readOnlyReason ? <p className="step6-team-readonly">{detail.readOnlyReason}</p> : null}{detail.issues.length ? <ul className="referee-assignment-issues">{detail.issues.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}</ul> : null}
        {reviewMode ? <div className="referee-review-crew"><ul>{detail.crew.map((slot) => <li key={slot.position}>{slot.label}: <strong>{slot.fullName}</strong></li>)}</ul>{detail.publication ? <p>Đã công bố · Phiên bản {detail.publication.revision} · {new Date(detail.publication.publishedAt).toLocaleString("vi-VN")}</p> : <p>Bản nháp chưa công bố.</p>}{detail.deliveries.map((item) => <p key={item.id}>{item.fullName}: {refereeEmailStatus(item.emailStatus)}{item.errorCode ? ` · ${item.errorCode}` : ""}</p>)}{view !== "LIST" ? reviewActions(selected) : null}</div> : <><div className="referee-assignment-pickers">{positions.map((position) => <RefereePicker key={`${detail.matchId}:${position.code}`} position={position} value={slots.find((slot) => slot.position === position.code)?.refereeId ?? ""} chosenIds={slots.map((slot) => slot.refereeId)} candidates={suggestions.find((item) => item.position === position.code)?.candidates ?? []} disabled={Boolean(disabled)} onChange={(refereeId) => { setSlots((previous) => [...previous.filter((slot) => slot.position !== position.code), ...(refereeId ? [{ position: position.code, refereeId }] : [])].sort((a, b) => a.position.localeCompare(b.position))); setError(""); setNotice(""); }} />)}</div>
        <details className="referee-config referee-assignment-match-config"><summary>Điều chỉnh cấu hình riêng của trận</summary><p>Chỉ thay đổi các vị trí của trận đang chọn; cấu hình được lưu cùng phân công.</p><RefereePositionEditor positions={positions} onChange={(next) => { void changePositions(next); }} name="trận đang chọn" disabled={Boolean(disabled) || !positions.length} /></details>
        <p className="referee-assignment-completeness">{missing.length ? `◐ Còn thiếu ${missing.length} vị trí bắt buộc. Có thể lưu nháp để bổ sung sau.` : positions.length ? "✓ Đã chọn đủ vị trí bắt buộc. Lưu để ghi vào hệ thống." : "Lưu cấu hình trọng tài trước khi chọn người."}{loadingDetail ? " Đang cập nhật gợi ý…" : ""}</p>
        <footer className="referee-assignment-actions"><button type="button" className="text-button" disabled={!dirty || saving} onClick={resetChanges}>Hủy thay đổi</button><div><button type="button" className="button button-secondary" disabled={Boolean(disabled) || !dirty} onClick={() => { void save(false); }}>{saving ? "Đang lưu…" : "Lưu phân công"}</button><button type="button" className="button button-primary" disabled={Boolean(disabled) || !dirty} onClick={() => { void save(true); }}>Lưu & chuyển trận tiếp theo</button></div></footer></>}
      </> : !loadingDetail ? <div className="referee-assignment-empty"><span aria-hidden="true">♙</span><strong>Chưa chọn trận</strong><p>Ngày, giờ, sân và các vị trí sẽ được lấy từ dữ liệu đã lưu. Hệ thống không tự gán trọng tài.</p></div> : null}</aside>
    </div>
    {reviewMode ? <footer className="referee-review-footer"><div><button type="button" className="button button-secondary" disabled={saving} onClick={onAdjust}>Quay lại phân công</button><label><input type="checkbox" checked={visibleEligible.length > 0 && visibleEligible.every((row) => publishScope.some((selected) => selected.matchId === row.matchId))} disabled={saving || !visibleEligible.length || Boolean(data?.readOnly)} onChange={(event) => setSelectedForPublication(event.target.checked ? [...new Set([...selectedForPublication, ...visibleEligible.map((row) => row.matchId)])] : selectedForPublication.filter((id) => !visibleEligible.some((row) => row.matchId === id)))} />Chọn các trận hợp lệ trong bộ lọc</label><small>Đã chọn {publishScope.length} trận · {visibleEligible.length} trận hợp lệ trong phạm vi đang xem</small></div><button type="button" className="button button-primary" disabled={saving || loading || !publishScope.length || Boolean(data?.readOnly)} onClick={() => { void publish(); }}>{saving ? "Đang công bố…" : "Công bố phân công"}</button></footer> : null}
  </section>;
}
