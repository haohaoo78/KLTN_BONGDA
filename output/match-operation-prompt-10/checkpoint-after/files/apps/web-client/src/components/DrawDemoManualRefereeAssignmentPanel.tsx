import { useMemo, useState } from "react";
import type { DrawCandidate } from "../api/competition";
import {
  type DemoFixture, type DemoRefereeAssignment, type DemoRefereeModelPosition, type DemoRefereeResource,
  type DemoRefereeResourceState, type DemoScheduleEntry, type DemoScheduleResources,
} from "../utils/drawTestStorage";
import { validateCrewMembers, validateRefereeAssignment, type RefereeDuty, type RefereeTeamAffiliation } from "../utils/refereeResourceValidation";

type Slot = { key: string; position: DemoRefereeModelPosition; slotIndex: number };
type Props = {
  fixture: DemoFixture;
  schedule: DemoScheduleEntry;
  schedulePublished: boolean;
  policyMode: "BY_PERIOD" | "WHOLE_TOURNAMENT";
  format: 5 | 7 | 11;
  resources: DemoScheduleResources;
  roster: DemoRefereeResourceState;
  fixtures: DemoFixture[];
  schedules: Record<string, DemoScheduleEntry>;
  assignmentsByFixture: Record<string, DemoRefereeAssignment[]>;
  publishedAssignmentsByFixture: Record<string, DemoRefereeAssignment[]>;
  publishedFixtureIds: Set<string>;
  assignments: DemoRefereeAssignment[];
  lockedSlotKeys: string[];
  matchLocked: boolean;
  onSave: (rows: DemoRefereeAssignment[], baseSignature: string) => string | false;
  onDelete: (baseSignature: string) => Promise<boolean>;
  onToggleSlot: (key: string) => void;
  onToggleMatch: () => void;
  teamById: Map<string, DrawCandidate>;
};

const slotKey = (positionId: string, slotIndex: number) => `${positionId}:${slotIndex}`;
const labelForTeam = (team?: DrawCandidate) => ({ club: team?.name, school: team?.institutionName ?? undefined, unit: team?.institutionName ?? undefined });

export function DrawDemoManualRefereeAssignmentPanel(props: Props) {
  const {
    fixture, schedule, schedulePublished, policyMode, format, resources, roster, fixtures, schedules,
    assignmentsByFixture, publishedAssignmentsByFixture, publishedFixtureIds, lockedSlotKeys, matchLocked,
    teamById,
  } = props;
  const [mode, setMode] = useState<"INDIVIDUAL" | "CREW">("INDIVIDUAL");
  const [selectedCrewId, setSelectedCrewId] = useState("");
  const [rows, setRows] = useState<DemoRefereeAssignment[]>(props.assignments.map((row) => ({ ...row })));
  const [baseSignature, setBaseSignature] = useState(() => JSON.stringify(props.assignments));
  const canEdit = !publishedFixtureIds.has(fixture.id) && !matchLocked && Boolean(schedule.scheduledAt && schedule.venue) && (policyMode === "WHOLE_TOURNAMENT" || schedulePublished);
  const requirementKeys = [fixture.id, fixture.groupName ? `${fixture.stage === "GROUP" ? "Vòng bảng" : "Knockout"} · ${fixture.groupName}` : "", fixture.stage === "GROUP" ? "Vòng bảng" : "Knockout", fixture.stage];
  const requirement = requirementKeys.map((key) => roster.matchRequirements[key]).find(Boolean);
  const model = roster.models.find((item) => item.id === requirement?.positionModelId) ?? roster.models.find((item) => item.isDefault);
  const positions = useMemo(() => {
    if (model?.positions.length) return model.positions;
    return roster.models.flatMap((item) => item.positions).filter((position, index, all) => all.findIndex((entry) => entry.id === position.id) === index);
  }, [model, roster.models]);
  const slots: Slot[] = positions.flatMap((position) => Array.from({ length: Math.max(0, position.requiredCount) }, (_, slotIndex) => ({ key: slotKey(position.id, slotIndex), position, slotIndex })));
  const currentRows = publishedFixtureIds.has(fixture.id) ? publishedAssignmentsByFixture[fixture.id] ?? [] : rows;
  const knownTeams = [fixture.homeTeamId, fixture.awayTeamId].filter((id): id is string => Boolean(id));
  const affiliationsByTeamId: Record<string, RefereeTeamAffiliation> = Object.fromEntries(knownTeams.map((id) => [id, labelForTeam(teamById.get(id))]));
  const unknownOpponentNeedsCheck = roster.neutralRules.some((rule) => rule.mandatory) && ((!fixture.homeTeamId && Boolean(fixture.homeSource)) || (!fixture.awayTeamId && Boolean(fixture.awaySource)));

  const allDuties: RefereeDuty[] = fixtures.flatMap((other) => {
    if (other.id === fixture.id) return [];
    const entry = schedules[other.id];
    if (!entry?.scheduledAt) return [];
    const rowsForFixture = publishedFixtureIds.has(other.id) ? publishedAssignmentsByFixture[other.id] ?? [] : assignmentsByFixture[other.id] ?? [];
    const timing = other.stage === "GROUP" ? resources.groupTiming : resources.knockoutTiming;
    const end = new Date(entry.scheduledAt).getTime() + (timing.halfMinutes * 2 + timing.halftimeBreakMinutes + timing.extraTimeReserveMinutes + timing.penaltyReserveMinutes + timing.transitionAfterMinutes) * 60_000;
    const start = new Date(entry.scheduledAt).getTime() - timing.preparationBeforeMinutes * 60_000;
    const venue = resources.venues.find((item) => item.code === entry.venue || item.name === entry.venue);
    const refereeIds = new Set(rowsForFixture.map((row) => row.refereeId).filter((id): id is string => Boolean(id)));
    for (const row of rowsForFixture) if (!row.refereeId) {
      const legacy = roster.referees.find((referee) => referee.displayName.trim().toLocaleLowerCase("vi") === row.refereeName.trim().toLocaleLowerCase("vi"));
      if (legacy) refereeIds.add(legacy.id);
    }
    return [...refereeIds].map((refereeId) => ({ fixtureId: other.id, refereeId, startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString(), location: venue?.travelZone ?? venue?.location ?? entry.venue, teamIds: [other.homeTeamId, other.awayTeamId].filter((id): id is string => Boolean(id)) }));
  });

  const getRow = (slot: Slot) => currentRows.find((row) => row.positionId === slot.position.id && (row.slotIndex ?? 0) === slot.slotIndex);
  const getCandidateIssues = (referee: DemoRefereeResource, slot: Slot) => validateRefereeAssignment({
    referee, position: slot.position, fixture, schedule, resources, roster, format, affiliationsByTeamId, existingDuties: allDuties,
  });
  const alreadySelected = (refereeId: string, forSlotKey: string) => currentRows.some((row) => row.refereeId === refereeId && slotKey(row.positionId, row.slotIndex ?? 0) !== forSlotKey);
  const eligibleForSlot = (slot: Slot) => roster.referees.filter((referee) => !alreadySelected(referee.id, slot.key) && !getCandidateIssues(referee, slot).some((issue) => issue.severity === "BLOCK"));
  const updateSlot = (slot: Slot, refereeId: string) => {
    const referee = roster.referees.find((item) => item.id === refereeId);
    setRows((current) => {
      const next = [...current];
      const index = next.findIndex((row) => row.positionId === slot.position.id && (row.slotIndex ?? 0) === slot.slotIndex);
      const assignment: DemoRefereeAssignment = {
        positionId: slot.position.id, slotIndex: slot.slotIndex, refereeId: referee?.id, refereeName: referee?.displayName ?? "",
        eligibilityConfirmed: Boolean(referee), availabilityConfirmed: Boolean(referee), source: mode,
        validationStatus: unknownOpponentNeedsCheck ? "NEEDS_RECHECK" : "VALID",
        validationMessages: unknownOpponentNeedsCheck ? ["Nguồn đội chưa xác định; cần kiểm tra trung lập khi có đội thực tế."] : [],
      };
      if (index >= 0) next[index] = { ...next[index], ...assignment };
      else next.push(assignment);
      return next;
    });
  };
  const selectedCrew = roster.crews.find((crew) => crew.id === selectedCrewId);
  const crewEvaluation = (crewId: string) => {
    const crew = roster.crews.find((item) => item.id === crewId);
    if (!crew) return ["Không tìm thấy tổ."];
    const messages: string[] = [];
    if (crew.status !== "ACTIVE") messages.push("Tổ chưa hoạt động.");
    const template = roster.crewTemplates.find((item) => item.id === crew.templateId);
    if (!template) messages.push("Thiếu mẫu tổ.");
    const activeSlots = slots.filter((slot) => slot.position.required);
    if (crew.members.length !== activeSlots.length) messages.push(`Tổ có ${crew.members.length} thành viên nhưng mô hình cần ${activeSlots.length} vị trí bắt buộc.`);
    const crewIssues = validateCrewMembers(crew.members, new Map(roster.referees.map((referee) => [referee.id, referee])));
    messages.push(...crewIssues.filter((issue) => issue.severity === "BLOCK").map((issue) => issue.message));
    if (template) {
      const expected = new Map<string, number>();
      for (const slot of activeSlots) expected.set(slot.position.id, (expected.get(slot.position.id) ?? 0) + 1);
      const templateCounts = template.positionCounts ?? Object.fromEntries(template.positionIds.map((id) => [id, 1]));
      if (JSON.stringify(Object.fromEntries([...expected].sort())) !== JSON.stringify(Object.fromEntries(Object.entries(templateCounts).filter(([, count]) => count > 0).sort()))) messages.push("Mẫu tổ không khớp vị trí và số lượng của mô hình trận.");
    }
    const normalizedMembers = crew.members.map((member) => ({ refereeId: member.refereeId, positionId: member.positionId, slotIndex: member.slotIndex ?? 0 }));
    for (const slot of activeSlots) {
      const member = normalizedMembers.find((item) => item.positionId === slot.position.id && item.slotIndex === slot.slotIndex);
      if (!member) { messages.push(`Thiếu ${slot.position.label} · vị trí ${slot.slotIndex + 1}.`); continue; }
      const referee = roster.referees.find((item) => item.id === member.refereeId);
      if (referee) messages.push(...getCandidateIssues(referee, slot).filter((issue) => issue.severity === "BLOCK").map((issue) => `${referee.displayName}: ${issue.message}`));
    }
    return [...new Set(messages)];
  };
  const eligibleCrews = roster.crews.filter((crew) => crewEvaluation(crew.id).length === 0);
  const excludedCrews = roster.crews.filter((crew) => !eligibleCrews.some((item) => item.id === crew.id));
  const assignedRequired = slots.filter((slot) => slot.position.required && Boolean(getRow(slot)?.refereeId || getRow(slot)?.refereeName.trim())).length;
  const requiredCount = slots.filter((slot) => slot.position.required).length;
  const importanceLabels: Record<string, string> = { ORDINARY: "Thông thường", QUALIFICATION: "Tranh suất đi tiếp", PLACEMENT: "Tranh thứ hạng", DECISIVE: "Trận quyết định", SEMIFINAL: "Bán kết", FINAL: "Chung kết" };
  const validationMessages = currentRows.flatMap((row) => {
    if (!row.refereeId) return row.refereeName ? ["Phân công cũ chưa liên kết hồ sơ trọng tài; chọn lại từ danh sách nguồn lực để xác minh."] : [];
    const slot = slots.find((item) => item.position.id === row.positionId && item.slotIndex === (row.slotIndex ?? 0));
    const referee = roster.referees.find((item) => item.id === row.refereeId);
    if (!slot || !referee) return ["Vị trí hoặc hồ sơ trọng tài không còn tồn tại."];
    return getCandidateIssues(referee, slot).filter((issue) => issue.severity === "BLOCK").map((issue) => issue.message);
  });
  const workload = useMemo(() => {
    const counts = new Map<string, number>();
    for (const other of fixtures) {
      const rowsForFixture = publishedFixtureIds.has(other.id) ? publishedAssignmentsByFixture[other.id] ?? [] : assignmentsByFixture[other.id] ?? [];
      for (const row of rowsForFixture) {
        const refereeId = row.refereeId ?? roster.referees.find((item) => item.displayName.trim().toLocaleLowerCase("vi") === row.refereeName.trim().toLocaleLowerCase("vi"))?.id;
        if (refereeId) counts.set(refereeId, (counts.get(refereeId) ?? 0) + 1);
      }
    }
    return [...roster.referees].map((referee) => ({ referee, count: counts.get(referee.id) ?? 0 })).filter((item) => item.count > 0).sort((a, b) => b.count - a.count);
  }, [assignmentsByFixture, fixtures, publishedAssignmentsByFixture, publishedFixtureIds, roster.referees]);
  const selectionIssues = currentRows.flatMap((row) => {
    if (!row.refereeId) return [];
    const slot = slots.find((item) => item.position.id === row.positionId && item.slotIndex === (row.slotIndex ?? 0));
    const referee = roster.referees.find((item) => item.id === row.refereeId);
    return slot && referee ? getCandidateIssues(referee, slot).filter((issue) => issue.severity === "WARNING").map((issue) => issue.message) : [];
  });

  const applyCrew = (crewId: string) => {
    const crew = roster.crews.find((item) => item.id === crewId);
    if (!crew || crewEvaluation(crewId).length) return;
    const members = slots.filter((slot) => slot.position.required).flatMap((slot) => {
      const member = crew.members.find((item) => item.positionId === slot.position.id && (item.slotIndex ?? 0) === slot.slotIndex);
      const referee = roster.referees.find((item) => item.id === member?.refereeId);
      return referee ? [{ positionId: slot.position.id, slotIndex: slot.slotIndex, refereeId: referee.id, refereeName: referee.displayName, eligibilityConfirmed: true, availabilityConfirmed: true, source: "CREW" as const, validationStatus: unknownOpponentNeedsCheck ? "NEEDS_RECHECK" as const : "VALID" as const, validationMessages: unknownOpponentNeedsCheck ? ["Nguồn đội chưa xác định; cần kiểm tra trung lập khi có đội thực tế."] : [] }] : [];
    });
    setRows(members);
  };

  return <section className="step5-referee-match-panel">
    <div className="step5-schedule-summary"><span className={`step5-schedule-state ${schedulePublished ? "is-scheduled" : ""}`}>{schedulePublished ? "Lịch chính thức" : "Lịch nháp"}</span><strong>{schedule.scheduledAt ? new Date(schedule.scheduledAt).toLocaleDateString("vi-VN") : "Chưa lập lịch"}</strong>{schedule.scheduledAt ? <span>{new Date(schedule.scheduledAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })} · {schedule.venue}</span> : null}</div>
    <p className="form-help">{requirement?.importance ? `Tính chất trận: ${importanceLabels[requirement.importance] ?? requirement.importance}. ` : "Tính chất trận: thông thường. "}{model?.name ? `Mô hình: ${model.name}. ` : "Chưa có mô hình trọng tài áp dụng. "}{requiredCount} vị trí bắt buộc · {slots.length} vị trí cấu hình.</p>
    <div className="step5-method-picker" role="group" aria-label="Phương thức phân công trọng tài"><button type="button" className={mode === "INDIVIDUAL" ? "is-active" : ""} onClick={() => setMode("INDIVIDUAL")}>Phân công từng cá nhân<span>Chọn người đủ điều kiện cho từng vị trí</span></button><button type="button" className={mode === "CREW" ? "is-active" : ""} onClick={() => setMode("CREW")}>Phân công theo tổ<span>Chọn tổ đã đáp ứng đầy đủ điều kiện</span></button></div>
    {!schedule.scheduledAt || !schedule.venue ? <p className="form-error">Trận cần có ngày, giờ và sân trước khi phân công. Không đổi lịch để ép đủ trọng tài.</p> : null}
    {!canEdit && !publishedFixtureIds.has(fixture.id) ? <p className="form-help">Chế độ theo vòng cần lịch đã công bố. Chính sách toàn giải cho phép chuẩn bị phân công nháp trên trận đã có lịch nháp.</p> : null}
    {mode === "CREW" ? <div className="step5-referee-crew-editor"><label>Tổ trọng tài<select disabled={!canEdit} value={selectedCrewId} onChange={(event) => { setSelectedCrewId(event.target.value); applyCrew(event.target.value); }}><option value="">Chọn tổ đủ điều kiện</option>{eligibleCrews.map((crew) => <option key={crew.id} value={crew.id}>{crew.code} · {crew.name}</option>)}</select></label>{selectedCrew ? <div className="step5-referee-crew-members"><strong>{selectedCrew.name} · thành viên theo vị trí</strong>{slots.map((slot) => { const row = publishedFixtureIds.has(fixture.id) ? getRow(slot) : rows.find((item) => item.positionId === slot.position.id && (item.slotIndex ?? 0) === slot.slotIndex); const locked = matchLocked || publishedFixtureIds.has(fixture.id) || lockedSlotKeys.includes(slot.key); return <label key={slot.key}>{slot.position.label} {slot.slotIndex + 1}<select disabled={!canEdit || locked || !slot.position.required} value={row?.refereeId ?? ""} onChange={(event) => updateSlot(slot, event.target.value)}><option value="">{slot.position.required ? "Chọn người đủ điều kiện" : "Tùy chọn · chưa phân công"}</option>{eligibleForSlot(slot).map((referee) => <option key={referee.id} value={referee.id}>{referee.displayName} · {referee.level} · {referee.experienceYears} năm</option>)}</select></label>; })}</div> : null}{excludedCrews.length ? <details><summary>{excludedCrews.length} tổ không khả dụng · xem nguyên nhân</summary>{excludedCrews.map((crew) => <p key={crew.id}><b>{crew.code} · {crew.name}:</b> {crewEvaluation(crew.id).join("; ")}</p>)}</details> : null}</div> : <div className="step5-referee-individual-editor">{slots.map((slot) => { const row = publishedFixtureIds.has(fixture.id) ? getRow(slot) : rows.find((item) => item.positionId === slot.position.id && (item.slotIndex ?? 0) === slot.slotIndex); const publishedRow = getRow(slot); const locked = matchLocked || publishedFixtureIds.has(fixture.id) || lockedSlotKeys.includes(slot.key) || Boolean(row?.locked); const candidateOptions = eligibleForSlot(slot); return <fieldset className="step5-referee-assignment" key={slot.key}><legend>{slot.position.label}{slot.position.required ? " · bắt buộc" : " · tùy chọn"}{slot.position.requiredCount > 1 ? ` · vị trí ${slot.slotIndex + 1}` : ""}</legend><label>Trọng tài<select disabled={!canEdit || locked} value={row?.refereeId ?? ""} onChange={(event) => updateSlot(slot, event.target.value)}><option value="">{candidateOptions.length ? "Chọn trọng tài đủ điều kiện" : "Không có ứng viên khả dụng"}</option>{candidateOptions.map((referee) => <option key={referee.id} value={referee.id}>{referee.displayName} · {referee.level} · {referee.experienceYears} năm</option>)}</select></label>{row?.refereeId ? <><small>{roster.referees.find((referee) => referee.id === row.refereeId)?.organization ?? ""} · trạng thái {row.validationStatus === "NEEDS_RECHECK" ? "Cần xác minh đội thực tế" : "Đã qua kiểm tra hiện tại"}</small>{unknownOpponentNeedsCheck ? <p className="schedule-objective-warning">Nguồn đội chưa xác định. Có thể lưu nháp; chưa thể công bố do chưa xác nhận được điều kiện trung lập.</p> : null}</> : null}<div className="step5-schedule-actions"><button className="button button-secondary" type="button" disabled={!row || !canEdit || publishedFixtureIds.has(fixture.id)} onClick={() => props.onToggleSlot(slot.key)}>{lockedSlotKeys.includes(slot.key) || row?.locked ? "Mở khóa vị trí" : "Khóa vị trí"}</button></div>{publishedRow?.refereeName && !row ? <small>Đã công bố: {publishedRow.refereeName}</small> : null}</fieldset>; })}</div>}
    {validationMessages.length ? <div className="form-error"><b>Cần xử lý trước khi lưu:</b>{[...new Set(validationMessages)].map((message) => <p key={message}>{message}</p>)}</div> : null}
    {selectionIssues.length ? <div className="schedule-objective-warning"><b>Cảnh báo tối ưu:</b>{[...new Set(selectionIssues)].map((message) => <p key={message}>{message}</p>)}</div> : null}
    <p>{assignedRequired}/{requiredCount} vị trí bắt buộc đã phân công · {rows.filter((row) => row.refereeId || row.refereeName).length}/{slots.length} vị trí đã có người</p>
    {publishedFixtureIds.has(fixture.id) ? <p className="status-pill status-success">Đã công bố · phân công chính thức chỉ đọc. Thay đổi tổ nguồn lực không sửa lại dữ liệu đã công bố.</p> : <div className="step5-schedule-actions"><button className="button button-primary" type="button" disabled={!canEdit || validationMessages.length > 0} onClick={() => { const normalized = rows.map((row) => ({ ...row })); const signature = props.onSave(normalized, baseSignature); if (signature) { setRows(normalized); setBaseSignature(signature); } }}>Lưu phân công nháp</button><button className="button button-secondary" type="button" disabled={!canEdit || !rows.length} onClick={async () => { if (await props.onDelete(baseSignature)) { setRows([]); setBaseSignature("[]"); } }}>Xóa bản nháp</button><button className="button button-secondary" type="button" disabled={publishedFixtureIds.has(fixture.id)} onClick={props.onToggleMatch}>{matchLocked ? "Mở khóa trận" : "Khóa phân công trận"}</button></div>}
    {mode === "CREW" && !eligibleCrews.length ? <p className="form-help">Chưa có tổ nào đáp ứng đầy đủ mô hình, chuyên môn, khả dụng và điều kiện trung lập.</p> : null}
    {workload.length ? <details className="step5-schedule-statistics"><summary>Khối lượng nhiệm vụ trọng tài</summary><div className="step5-schedule-statistics-grid">{workload.map(({ referee, count }) => <p key={referee.id}>{referee.displayName}: <b>{count}</b> trận đã phân công</p>)}</div></details> : null}
  </section>;
}
