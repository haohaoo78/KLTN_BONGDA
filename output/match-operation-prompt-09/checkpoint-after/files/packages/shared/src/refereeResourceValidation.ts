import type {
  DemoFixture, DemoRefereePositionModel,
  DemoRefereeResource, DemoRefereeResourceState, DemoScheduleEntry, DemoScheduleResources,
} from "./schedulingTypes";

export type RefereeIssue = { code: string; message: string; severity: "BLOCK" | "WARNING" };
export type RefereeTeamAffiliation = { club?: string; school?: string; unit?: string };
export type RefereeDuty = { fixtureId: string; refereeId: string; startsAt: string; endsAt: string; location?: string; teamIds?: string[] };

export type RefereeAssignmentCheckInput = {
  referee: DemoRefereeResource;
  position: DemoRefereePositionModel["positions"][number];
  fixture: DemoFixture;
  schedule: DemoScheduleEntry;
  resources: DemoScheduleResources;
  roster: DemoRefereeResourceState;
  format: 5 | 7 | 11;
  affiliationsByTeamId: Record<string, RefereeTeamAffiliation>;
  existingDuties: RefereeDuty[];
  travelMinutesBetween?: (from: string | undefined, to: string | undefined) => number;
};

const levelRank: Record<string, number> = { UNVERIFIED: -1, ENTRY: 0, CITY: 1, NATIONAL: 2, INTERNATIONAL: 3 };
const overlaps = (startA: number, endA: number, startB: number, endB: number) => startA < endB && startB < endA;
const normalized = (value: string | undefined) => (value ?? "").trim().toLocaleLowerCase("vi");

function toLocalMinutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

/** Shared hard-constraint checker for future manual, automatic and publication flows. */
export function validateRefereeAssignment(input: RefereeAssignmentCheckInput): RefereeIssue[] {
  const { referee, position, fixture, schedule, resources, roster, format } = input;
  const issues: RefereeIssue[] = [];
  if (!schedule.scheduledAt) return [{ code: "MATCH_NOT_SCHEDULED", message: "Trận chưa có lịch thi đấu.", severity: "BLOCK" }];
  const startsAt = new Date(schedule.scheduledAt);
  const startMs = startsAt.getTime();
  const timing = fixture.stage === "GROUP" ? resources.groupTiming : resources.knockoutTiming;
  const playMinutes = timing.halfMinutes * 2 + timing.halftimeBreakMinutes + timing.extraTimeReserveMinutes + timing.penaltyReserveMinutes;
  const endMs = startMs + playMinutes * 60_000;
  const localDate = `${startsAt.getFullYear()}-${String(startsAt.getMonth() + 1).padStart(2, "0")}-${String(startsAt.getDate()).padStart(2, "0")}`;
  const assignmentDay = localDate;
  const dutyStartMs = startMs - timing.preparationBeforeMinutes * 60_000;
  const dutyEndMs = endMs + timing.transitionAfterMinutes * 60_000;
  const stageLabel = fixture.stage === "GROUP" ? "Vòng bảng" : "Knockout";
  const scopedKey = fixture.groupName ? `${stageLabel} · ${fixture.groupName}` : stageLabel;
  const requirement = input.roster.matchRequirements[fixture.id] ?? input.roster.matchRequirements[scopedKey] ?? input.roster.matchRequirements[stageLabel] ?? input.roster.matchRequirements[fixture.stage];
  const minRequiredLevel = Math.max(levelRank[position.minimumLevel] ?? 0, levelRank[requirement?.minimumLevel ?? "ENTRY"] ?? 0);
  const minExperience = Math.max(position.minimumExperienceYears, requirement?.minimumExperienceYears ?? 0);

  if (referee.participationStatus !== "ACTIVE") issues.push({ code: "NOT_IN_TOURNAMENT", message: "Trọng tài chưa xác nhận tham gia giải.", severity: "BLOCK" });
  const dutyStatusApplies = (!referee.dutyStatusFrom || assignmentDay >= referee.dutyStatusFrom) && (!referee.dutyStatusTo || assignmentDay <= referee.dutyStatusTo);
  if (dutyStatusApplies && referee.dutyStatus !== "ACTIVE") issues.push({ code: "DUTY_INACTIVE", message: referee.dutyStatus === "SUSPENDED" ? "Trọng tài đang bị đình chỉ nhiệm vụ." : "Trọng tài đang tạm ngưng nhiệm vụ.", severity: "BLOCK" });
  if (!referee.formats.includes(format) || !position.formats.includes(format)) issues.push({ code: "FORMAT_MISMATCH", message: `Chuyên môn chưa phù hợp bóng đá ${format} người.`, severity: "BLOCK" });
  if (!referee.positionIds.includes(position.id)) issues.push({ code: "POSITION_NOT_QUALIFIED", message: `Hồ sơ chưa xác nhận đủ chuyên môn cho vị trí ${position.label}.`, severity: "BLOCK" });
  if ((levelRank[referee.level] ?? -1) < minRequiredLevel) issues.push({ code: "LEVEL_TOO_LOW", message: "Cấp độ chuyên môn thấp hơn yêu cầu của vị trí/trận.", severity: "BLOCK" });
  if (referee.experienceYears < minExperience) issues.push({ code: "EXPERIENCE_TOO_LOW", message: `Yêu cầu ít nhất ${minExperience} năm kinh nghiệm.`, severity: "BLOCK" });

  const dutyStart = new Date(dutyStartMs);
  const dutyEnd = new Date(dutyEndMs);
  const assignmentWeekday = dutyStart.getDay();
  const dayWindows = referee.availability.filter((window) => window.weekday === assignmentWeekday);
  if (dutyStart.toDateString() !== dutyEnd.toDateString()) issues.push({ code: "DUTY_SPANS_DAYS", message: "Ca trực vượt qua ngày khả dụng đã khai báo; cần cấu hình khung giờ phù hợp.", severity: "BLOCK" });
  const startMinute = dutyStart.getHours() * 60 + dutyStart.getMinutes();
  const endMinute = dutyEnd.getHours() * 60 + dutyEnd.getMinutes();
  if (!dayWindows.some((window) => startMinute >= toLocalMinutes(window.start) && endMinute <= toLocalMinutes(window.end))) {
    issues.push({ code: "OUTSIDE_AVAILABILITY", message: "Khoảng thời gian làm nhiệm vụ nằm ngoài khung giờ khả dụng.", severity: "BLOCK" });
  }
  if (referee.unavailablePeriods.some((period) => overlaps(dutyStartMs, dutyEndMs, new Date(period.startAt).getTime(), new Date(period.endAt).getTime()))) {
    issues.push({ code: "UNAVAILABLE_PERIOD", message: "Trọng tài có khoảng thời gian không khả dụng trùng trận.", severity: "BLOCK" });
  }

  const sameDayDuties = input.existingDuties.filter((duty) => {
    const date = new Date(duty.startsAt);
    return duty.refereeId === referee.id && duty.fixtureId !== fixture.id && date.getFullYear() === startsAt.getFullYear() && date.getMonth() === startsAt.getMonth() && date.getDate() === startsAt.getDate();
  });
  if (sameDayDuties.length >= referee.maximumMatchesPerDay) issues.push({ code: "DAILY_LIMIT", message: "Vượt số trận tối đa trong ngày của trọng tài.", severity: "BLOCK" });
  for (const duty of input.existingDuties.filter((row) => row.refereeId === referee.id && row.fixtureId !== fixture.id)) {
    const dutyStart = new Date(duty.startsAt).getTime(); const dutyEnd = new Date(duty.endsAt).getTime();
    if (overlaps(dutyStartMs, dutyEndMs, dutyStart, dutyEnd)) {
      issues.push({ code: "DUTY_OVERLAP", message: "Trọng tài đang có nhiệm vụ khác trùng thời gian.", severity: "BLOCK" });
      continue;
    }
    const gap = dutyStartMs >= dutyEnd ? dutyStartMs - dutyEnd : dutyStart - dutyEndMs;
    const travel = input.travelMinutesBetween?.(duty.location, schedule.venue) ?? resources.travelBufferMinutes;
    if (gap < (referee.minimumRestMinutes + travel) * 60_000) issues.push({ code: "REST_OR_TRAVEL", message: "Chưa đủ thời gian nghỉ và di chuyển giữa hai nhiệm vụ.", severity: "BLOCK" });
  }

  const matchTeams = [fixture.homeTeamId, fixture.awayTeamId].filter((teamId): teamId is string => Boolean(teamId));
  const affiliations = matchTeams.map((teamId) => input.affiliationsByTeamId[teamId]).filter(Boolean);
  for (const rule of roster.neutralRules) {
    const refereeValue = rule.scope === "CLUB" ? referee.club : rule.scope === "SCHOOL" ? referee.organization : rule.scope === "UNIT" ? referee.organization : referee.notes;
    const teamValues = affiliations.map((item) => rule.scope === "CLUB" ? item.club : rule.scope === "SCHOOL" ? item.school : rule.scope === "UNIT" ? item.unit : "");
    const conflict = Boolean(normalized(refereeValue) && teamValues.some((value) => normalized(value) === normalized(refereeValue)))
      && (!rule.value.trim() || normalized(rule.value) === normalized(refereeValue));
    if (conflict) issues.push({ code: "NEUTRALITY_CONFLICT", message: `${rule.scope === "CLUB" ? "CLB" : rule.scope === "SCHOOL" ? "Trường" : "Đơn vị"} liên quan trùng với một đội trong trận: ${rule.value}.`, severity: rule.mandatory ? "BLOCK" : "WARNING" });
  }
  const repeatLimit = roster.repeatTeamDutyLimit;
  if (repeatLimit) {
    const repeated = input.existingDuties.filter((duty) => duty.refereeId === referee.id && duty.fixtureId !== fixture.id && (duty.teamIds ?? []).some((teamId) => matchTeams.includes(teamId))).length;
    if (repeated >= repeatLimit.maximum) issues.push({ code: "REPEATED_TEAM_ASSIGNMENTS", message: `Trọng tài đã điều hành ${repeated} trận có cùng đội; giới hạn cấu hình là ${repeatLimit.maximum}.`, severity: repeatLimit.mandatory ? "BLOCK" : "WARNING" });
  }
  return issues;
}

/** Crew check keeps membership person-specific and prevents duplicate positions for one person in a match. */
export function validateCrewMembers(members: Array<{ refereeId: string; positionId: string }>, refereeById: Map<string, DemoRefereeResource>): RefereeIssue[] {
  const issues: RefereeIssue[] = [];
  if (new Set(members.map((member) => member.refereeId)).size !== members.length) issues.push({ code: "DUPLICATE_CREW_MEMBER", message: "Một trọng tài không thể giữ nhiều vị trí trong cùng một tổ/trận.", severity: "BLOCK" });
  for (const member of members) {
    const referee = refereeById.get(member.refereeId);
    if (!referee) issues.push({ code: "REFEREE_MISSING", message: "Không tìm thấy hồ sơ trọng tài trong nguồn lực giải.", severity: "BLOCK" });
    else if (referee.participationStatus !== "ACTIVE" || referee.dutyStatus !== "ACTIVE") issues.push({ code: "REFEREE_UNAVAILABLE", message: `${referee.displayName} chưa sẵn sàng tham gia tổ.`, severity: "BLOCK" });
  }
  return issues;
}


