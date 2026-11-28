import type {
  DemoFixture, DemoRefereeAssignment, DemoRefereeCrew, DemoRefereeResourceState,
  DemoScheduleEntry, DemoScheduleResources,
} from "./schedulingTypes";
import { validateRefereeAssignment, type RefereeDuty, type RefereeTeamAffiliation } from "./refereeResourceValidation";

export type AutoRefereeMethod = "CREW" | "INDIVIDUAL" | "MIXED";
export type AutoRefereeObjective = "UPCOMING" | "FEWEST_CANDIDATES" | "EXPERIENCE" | "BALANCE" | "REST" | "TEAM_REPEAT" | "CREW_CONTINUITY";
export type AutoRefereeConfiguration = {
  rounds: string[];
  groups: string[];
  dates: string[];
  onlyUnassignedFixtures: boolean;
  onlyMissingSlots: boolean;
  method: AutoRefereeMethod;
  objectives: AutoRefereeObjective[];
  maxRuntimeMs: number;
};
export type AutoRefereeMissing = { fixtureId: string; positionId: string; slotIndex: number; reason: string };
export type AutoRefereePreview = {
  status: "COMPLETE" | "PARTIAL" | "NO_TARGETS" | "TIMEOUT";
  generatedAt: string;
  elapsedMs: number;
  exploredNodes: number;
  targetFixtureIds: string[];
  changedFixtureIds: string[];
  proposedAssignmentsByFixture: Record<string, DemoRefereeAssignment[]>;
  missing: AutoRefereeMissing[];
  refereeWorkload: Array<{ refereeId: string; refereeName: string; assignments: number }>;
  crewWorkload: Array<{ crewId: string; crewName: string; assignments: number }>;
  warnings: string[];
  baseSignature: string;
};
export type AutoRefereePlannerInput = {
  fixtures: DemoFixture[];
  schedules: Record<string, DemoScheduleEntry>;
  resources: DemoScheduleResources;
  roster: DemoRefereeResourceState;
  currentAssignments: Record<string, DemoRefereeAssignment[]>;
  publishedAssignments: Record<string, DemoRefereeAssignment[]>;
  publishedFixtureIds: string[];
  lockedFixtureIds: string[];
  lockedSlotKeysByFixture: Record<string, string[]>;
  teamAffiliations: Record<string, RefereeTeamAffiliation>;
  format: 5 | 7 | 11;
  configuration: AutoRefereeConfiguration;
};

type Slot = { fixture: DemoFixture; position: DemoRefereeResourceState["models"][number]["positions"][number]; slotIndex: number; key: string };
type Candidate = { refereeId: string; crewId?: string; source: "INDIVIDUAL" | "CREW" };

function slotKey(positionId: string, slotIndex: number) { return `${positionId}:${slotIndex}`; }
function importanceRank(value: string | undefined) { return ({ FINAL: 5, SEMIFINAL: 4, DECISIVE: 3, QUALIFICATION: 2, PLACEMENT: 1, ORDINARY: 0 } as Record<string, number>)[value ?? "ORDINARY"] ?? 0; }
function stable(value: unknown) { return JSON.stringify(value); }

function fixturePositions(fixture: DemoFixture, roster: DemoRefereeResourceState) {
  const stageLabel = fixture.stage === "GROUP" ? "Vòng bảng" : "Knockout";
  const requirement = roster.matchRequirements[fixture.id]
    ?? roster.matchRequirements[fixture.groupName ? `${stageLabel} · ${fixture.groupName}` : ""]
    ?? roster.matchRequirements[stageLabel]
    ?? roster.matchRequirements[fixture.stage];
  return roster.models.find((model) => model.id === requirement?.positionModelId)?.positions
    ?? roster.models.find((model) => model.isDefault)?.positions
    ?? [];
}

function hasAssignment(rows: DemoRefereeAssignment[], slot: Slot) {
  return rows.some((row) => row.positionId === slot.position.id && (row.slotIndex ?? 0) === slot.slotIndex && Boolean(row.refereeId));
}

function dutyFor(input: AutoRefereePlannerInput, fixture: DemoFixture, assignment: DemoRefereeAssignment): RefereeDuty | null {
  const refereeId = assignment.refereeId;
  const schedule = input.schedules[fixture.id];
  if (!refereeId || !schedule?.scheduledAt) return null;
  const timing = fixture.stage === "GROUP" ? input.resources.groupTiming : input.resources.knockoutTiming;
  const start = new Date(schedule.scheduledAt).getTime() - timing.preparationBeforeMinutes * 60_000;
  const end = new Date(schedule.scheduledAt).getTime() + (timing.halfMinutes * 2 + timing.halftimeBreakMinutes + timing.extraTimeReserveMinutes + timing.penaltyReserveMinutes + timing.transitionAfterMinutes) * 60_000;
  const venue = input.resources.venues.find((item) => item.code === schedule.venue || item.name === schedule.venue);
  return { fixtureId: fixture.id, refereeId, startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString(), location: venue?.travelZone ?? venue?.location ?? schedule.venue, teamIds: [fixture.homeTeamId, fixture.awayTeamId].filter((id): id is string => Boolean(id)) };
}

export function automaticRefereeBaseSignature(input: AutoRefereePlannerInput) {
  return stable({
    fixtures: input.fixtures.map((item) => [item.id, item.stage, item.round, item.groupName, item.homeTeamId, item.awayTeamId, item.homeSource, item.awaySource, item.bye]),
    schedules: input.fixtures.map((item) => [item.id, input.schedules[item.id]?.scheduledAt ?? "", input.schedules[item.id]?.venue ?? ""]),
    roster: input.roster,
    assignments: input.currentAssignments,
    published: input.publishedAssignments,
    publishedIds: input.publishedFixtureIds,
    locks: [input.lockedFixtureIds, input.lockedSlotKeysByFixture],
    format: input.format,
    configuration: input.configuration,
  });
}

/** Greedy-first bounded backtracking planner. It never relaxes hard constraints. */
export function buildAutomaticRefereePlan(input: AutoRefereePlannerInput): AutoRefereePreview {
  const startedAt = performance.now();
  const deadline = startedAt + Math.min(5_000, Math.max(100, input.configuration.maxRuntimeMs));
  const fixtures = input.fixtures.filter((fixture) => !fixture.bye && input.schedules[fixture.id]?.scheduledAt && input.schedules[fixture.id]?.venue);
  const publishedIds = new Set(input.publishedFixtureIds);
  const lockedFixtures = new Set(input.lockedFixtureIds);
  const assignmentMap: Record<string, DemoRefereeAssignment[]> = Object.fromEntries(Object.entries(input.currentAssignments).map(([id, rows]) => [id, rows.map((row) => ({ ...row }))]));
  const lockedKeys = input.lockedSlotKeysByFixture;
  const targetFixtures = fixtures.filter((fixture) => {
    if (publishedIds.has(fixture.id)) return false;
    if (lockedFixtures.has(fixture.id)) return false;
    if (input.configuration.rounds.length && !input.configuration.rounds.includes(fixture.round)) return false;
    if (input.configuration.groups.length && !input.configuration.groups.includes(fixture.groupName ?? "Knockout")) return false;
    const date = input.schedules[fixture.id]?.scheduledAt.slice(0, 10) ?? "";
    if (input.configuration.dates.length && !input.configuration.dates.includes(date)) return false;
    const rows = assignmentMap[fixture.id] ?? [];
    if (input.configuration.onlyUnassignedFixtures && rows.some((row) => row.refereeId)) return false;
    return true;
  });
  if (!targetFixtures.length) return { status: "NO_TARGETS", generatedAt: new Date().toISOString(), elapsedMs: 0, exploredNodes: 0, targetFixtureIds: [], changedFixtureIds: [], proposedAssignmentsByFixture: assignmentMap, missing: [], refereeWorkload: [], crewWorkload: [], warnings: ["Không có trận đã lập lịch phù hợp phạm vi và điều kiện đã chọn."], baseSignature: automaticRefereeBaseSignature(input) };

  const targetIds = new Set(targetFixtures.map((item) => item.id));
  const fixedDuties: RefereeDuty[] = [];
  const selectedInFixture = new Map<string, Set<string>>();
  for (const fixture of fixtures) {
    const rows = publishedIds.has(fixture.id) ? input.publishedAssignments[fixture.id] ?? [] : assignmentMap[fixture.id] ?? [];
    for (const row of rows) {
      const isFixed = publishedIds.has(fixture.id) || !targetIds.has(fixture.id) || lockedFixtures.has(fixture.id) || Boolean(row.locked) || (lockedKeys[fixture.id] ?? []).includes(slotKey(row.positionId, row.slotIndex ?? 0)) || (input.configuration.onlyMissingSlots && targetIds.has(fixture.id));
      if (!isFixed) continue;
      const duty = dutyFor(input, fixture, row);
      if (duty) fixedDuties.push(duty);
      const selected = selectedInFixture.get(fixture.id) ?? new Set<string>();
      selected.add(row.refereeId ?? "");
      selected.delete("");
      if (selected.size) selectedInFixture.set(fixture.id, selected);
    }
  }
  const workingDuties = [...fixedDuties];
  const remaining: Slot[] = [];
  const modelMissing: AutoRefereeMissing[] = [];
  for (const fixture of targetFixtures) {
    const positions = fixturePositions(fixture, input.roster);
    if (!positions.some((position) => position.required && position.requiredCount > 0)) {
      modelMissing.push({ fixtureId: fixture.id, positionId: "__MODEL__", slotIndex: 0, reason: "Chưa cấu hình mô hình với vị trí trọng tài bắt buộc cho trận này." });
      continue;
    }
    for (const position of positions.filter((item) => item.required && item.requiredCount > 0)) {
      for (let slotIndex = 0; slotIndex < position.requiredCount; slotIndex += 1) {
        const slot = { fixture, position, slotIndex, key: slotKey(position.id, slotIndex) };
        const rows = assignmentMap[fixture.id] ?? [];
        const fixed = publishedIds.has(fixture.id) || lockedFixtures.has(fixture.id) || (lockedKeys[fixture.id] ?? []).includes(slot.key) || rows.some((row) => row.positionId === position.id && (row.slotIndex ?? 0) === slotIndex && (row.locked || Boolean(row.refereeId) && !input.configuration.onlyMissingSlots));
        if (fixed || (input.configuration.onlyMissingSlots && hasAssignment(rows, slot))) continue;
        remaining.push(slot);
      }
    }
  }

  const candidateCache = new Map<string, Candidate[]>();
  const eligibleCrewCache = new Map<string, Set<string>>();
  const eligibleCrewsForFixture = (fixture: DemoFixture) => {
    const cached = eligibleCrewCache.get(fixture.id);
    if (cached) return cached;
    const requiredSlots = fixturePositions(fixture, input.roster).filter((position) => position.required && position.requiredCount > 0)
      .flatMap((position) => Array.from({ length: position.requiredCount }, (_, slotIndex) => ({ position, slotIndex })));
    const valid = new Set<string>();
    for (const crew of input.roster.crews.filter((item) => item.status === "ACTIVE")) {
      const template = input.roster.crewTemplates.find((item) => item.id === crew.templateId);
      if (!template) continue;
      const expected = new Map<string, number>();
      for (const slot of requiredSlots) expected.set(slot.position.id, (expected.get(slot.position.id) ?? 0) + 1);
      const templateCounts = template.positionCounts ?? Object.fromEntries(template.positionIds.map((id) => [id, 1]));
      if (JSON.stringify(Object.fromEntries([...expected].sort())) !== JSON.stringify(Object.fromEntries(Object.entries(templateCounts).filter(([, count]) => count > 0).sort()))) continue;
      const normalizedMembers = crew.members.map((member) => ({ ...member, slotIndex: member.slotIndex ?? 0 }));
      if (new Set(normalizedMembers.map((member) => member.refereeId)).size !== normalizedMembers.length) continue;
      if (normalizedMembers.length !== requiredSlots.length || normalizedMembers.some((member) => !requiredSlots.some((slot) => slot.position.id === member.positionId && slot.slotIndex === member.slotIndex))) continue;
      const complete = requiredSlots.every(({ position, slotIndex }) => {
        const member = normalizedMembers.find((item) => item.positionId === position.id && item.slotIndex === slotIndex);
        const referee = input.roster.referees.find((item) => item.id === member?.refereeId);
        if (!member || !referee) return false;
        const issues = validateRefereeAssignment({ referee, position, fixture, schedule: input.schedules[fixture.id], resources: input.resources, roster: input.roster, format: input.format, affiliationsByTeamId: input.teamAffiliations, existingDuties: workingDuties });
        return !issues.some((issue) => issue.severity === "BLOCK");
      });
      if (complete) valid.add(crew.id);
    }
    eligibleCrewCache.set(fixture.id, valid);
    return valid;
  };
  const candidateFor = (slot: Slot): Candidate[] => {
    const key = `${slot.fixture.id}|${slot.key}`;
    const cached = candidateCache.get(key);
    if (cached) return cached;
    const options: Candidate[] = [];
    const requirement = input.roster.matchRequirements[slot.fixture.id]
      ?? input.roster.matchRequirements[slot.fixture.groupName ? `${slot.fixture.stage === "GROUP" ? "Vòng bảng" : "Knockout"} · ${slot.fixture.groupName}` : ""]
      ?? input.roster.matchRequirements[slot.fixture.stage === "GROUP" ? "Vòng bảng" : "Knockout"]
      ?? input.roster.matchRequirements[slot.fixture.stage];
    const importance = importanceRank(requirement?.importance);
    const crewIds = new Set(input.roster.crews.filter((crew) => eligibleCrewsForFixture(slot.fixture).has(crew.id) && crew.members.some((member) => member.positionId === slot.position.id && (member.slotIndex ?? 0) === slot.slotIndex)).map((crew) => crew.id));
    const refs = input.roster.referees.filter((referee) => {
      const issues = validateRefereeAssignment({ referee, position: slot.position, fixture: slot.fixture, schedule: input.schedules[slot.fixture.id], resources: input.resources, roster: input.roster, format: input.format, affiliationsByTeamId: input.teamAffiliations, existingDuties: workingDuties });
      return !issues.some((issue) => issue.severity === "BLOCK");
    });
    for (const referee of refs) {
      const assignedIds = selectedInFixture.get(slot.fixture.id) ?? new Set<string>();
      if (assignedIds.has(referee.id)) continue;
    if (input.configuration.method === "CREW") {
        for (const crewId of crewIds) options.push({ refereeId: referee.id, crewId, source: "CREW" });
      } else if (input.configuration.method === "MIXED") {
        for (const crewId of crewIds) options.push({ refereeId: referee.id, crewId, source: "CREW" });
        options.push({ refereeId: referee.id, source: "INDIVIDUAL" });
      } else options.push({ refereeId: referee.id, source: "INDIVIDUAL" });
    }
    const currentCounts = new Map<string, number>();
    for (const fixture of input.fixtures) {
      const rows = publishedIds.has(fixture.id) ? input.publishedAssignments[fixture.id] ?? [] : input.currentAssignments[fixture.id] ?? [];
      for (const row of rows) if (row.refereeId) currentCounts.set(row.refereeId, (currentCounts.get(row.refereeId) ?? 0) + 1);
    }
    const currentCrewFixtureCounts = new Map<string, number>();
    for (const fixture of input.fixtures) {
      const rows = publishedIds.has(fixture.id) ? input.publishedAssignments[fixture.id] ?? [] : input.currentAssignments[fixture.id] ?? [];
      for (const crewId of new Set(rows.map((row) => row.crewId).filter((id): id is string => Boolean(id)))) currentCrewFixtureCounts.set(crewId, (currentCrewFixtureCounts.get(crewId) ?? 0) + 1);
    }
    const objectiveOrder = input.configuration.objectives;
    const objectiveWeight = (objective: AutoRefereeObjective) => Math.max(1, objectiveOrder.length - objectiveOrder.indexOf(objective));
    const scheduledAt = new Date(input.schedules[slot.fixture.id].scheduledAt).getTime();
    options.sort((a, b) => {
      const ra = input.roster.referees.find((item) => item.id === a.refereeId)!;
      const rb = input.roster.referees.find((item) => item.id === b.refereeId)!;
      let scoreA = 0; let scoreB = 0;
      if (objectiveOrder.includes("BALANCE")) { scoreA += (currentCounts.get(a.refereeId) ?? 0) * 12 * objectiveWeight("BALANCE"); scoreB += (currentCounts.get(b.refereeId) ?? 0) * 12 * objectiveWeight("BALANCE"); }
      if (objectiveOrder.includes("BALANCE") && a.crewId) scoreA += (currentCrewFixtureCounts.get(a.crewId) ?? 0) * 8 * objectiveWeight("BALANCE");
      if (objectiveOrder.includes("BALANCE") && b.crewId) scoreB += (currentCrewFixtureCounts.get(b.crewId) ?? 0) * 8 * objectiveWeight("BALANCE");
      if (objectiveOrder.includes("EXPERIENCE") && importance >= 3) {
        const verifiedAverage = (refereeId: string) => {
          const ratings = input.roster.evaluations.filter((evaluation) => evaluation.refereeId === refereeId && evaluation.verificationStatus === "VERIFIED" && evaluation.rating !== null).map((evaluation) => evaluation.rating as number);
          return ratings.length ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length : 0;
        };
        scoreA -= (ra.experienceYears * 3 + verifiedAverage(a.refereeId)) * objectiveWeight("EXPERIENCE");
        scoreB -= (rb.experienceYears * 3 + verifiedAverage(b.refereeId)) * objectiveWeight("EXPERIENCE");
      }
      if (objectiveOrder.includes("CREW_CONTINUITY") && a.crewId) scoreA -= 2 * objectiveWeight("CREW_CONTINUITY");
      if (objectiveOrder.includes("CREW_CONTINUITY") && b.crewId) scoreB -= 2 * objectiveWeight("CREW_CONTINUITY");
      if (objectiveOrder.includes("TEAM_REPEAT")) {
        const teams = [slot.fixture.homeTeamId, slot.fixture.awayTeamId].filter((id): id is string => Boolean(id));
        const repeatA = workingDuties.filter((duty) => duty.refereeId === a.refereeId && (duty.teamIds ?? []).some((id) => teams.includes(id))).length;
        const repeatB = workingDuties.filter((duty) => duty.refereeId === b.refereeId && (duty.teamIds ?? []).some((id) => teams.includes(id))).length;
        scoreA += repeatA * 5 * objectiveWeight("TEAM_REPEAT"); scoreB += repeatB * 5 * objectiveWeight("TEAM_REPEAT");
      }
      if (objectiveOrder.includes("UPCOMING")) { scoreA += Math.max(0, scheduledAt - Date.now()) / 86_400_000 / 1000; scoreB += Math.max(0, scheduledAt - Date.now()) / 86_400_000 / 1000; }
      if (objectiveOrder.includes("REST")) {
        const lastDutyA = workingDuties.filter((item) => item.refereeId === a.refereeId).map((item) => Math.abs(scheduledAt - new Date(item.startsAt).getTime())).sort((x, y) => x - y)[0] ?? Number.MAX_SAFE_INTEGER;
        const lastDutyB = workingDuties.filter((item) => item.refereeId === b.refereeId).map((item) => Math.abs(scheduledAt - new Date(item.startsAt).getTime())).sort((x, y) => x - y)[0] ?? Number.MAX_SAFE_INTEGER;
        scoreA -= Math.min(lastDutyA, 3 * 86_400_000) / 86_400_000; scoreB -= Math.min(lastDutyB, 3 * 86_400_000) / 86_400_000;
      }
      return scoreA - scoreB || a.refereeId.localeCompare(b.refereeId);
    });
    candidateCache.set(key, options);
    return options;
  };

  // Most constrained positions first, then upcoming/high-importance matches.
  remaining.sort((a, b) => {
    const count = candidateFor(a).length - candidateFor(b).length;
    if (count) return count;
    const aTime = new Date(input.schedules[a.fixture.id].scheduledAt).getTime();
    const bTime = new Date(input.schedules[b.fixture.id].scheduledAt).getTime();
    if (aTime !== bTime) return aTime - bTime;
    return importanceRank(input.roster.matchRequirements[a.fixture.id]?.importance) - importanceRank(input.roster.matchRequirements[b.fixture.id]?.importance);
  });

  const baseAssignments = Object.fromEntries(Object.entries(assignmentMap).map(([id, rows]) => [id, rows.map((row) => ({ ...row }))]));
  let bestAssignments = baseAssignments;
  let bestPlaced = 0;
  let exploredNodes = 0;
  let timedOut = false;
  const chosenByFixture = new Map<string, string>();
  const tentative: Array<{ slot: Slot; candidate: Candidate }> = [];
  const apply = (slot: Slot, candidate: Candidate) => {
    const referee = input.roster.referees.find((item) => item.id === candidate.refereeId)!;
    const unknownNeedsCheck = input.roster.neutralRules.some((rule) => rule.mandatory) && ((!slot.fixture.homeTeamId && Boolean(slot.fixture.homeSource)) || (!slot.fixture.awayTeamId && Boolean(slot.fixture.awaySource)));
    const row: DemoRefereeAssignment = { positionId: slot.position.id, slotIndex: slot.slotIndex, refereeId: referee.id, refereeName: referee.displayName, eligibilityConfirmed: true, availabilityConfirmed: true, source: candidate.source, crewId: candidate.crewId, validationStatus: unknownNeedsCheck ? "NEEDS_RECHECK" : "VALID", validationMessages: unknownNeedsCheck ? ["Nguồn đội chưa xác định; cần kiểm tra trung lập khi có đội thực tế."] : [] };
    const rows = assignmentMap[slot.fixture.id] ?? [];
    const index = rows.findIndex((item) => item.positionId === slot.position.id && (item.slotIndex ?? 0) === slot.slotIndex);
    if (index >= 0) rows[index] = row; else rows.push(row);
    assignmentMap[slot.fixture.id] = rows;
    const duty = dutyFor(input, slot.fixture, row); if (duty) workingDuties.push(duty);
    const assigned = selectedInFixture.get(slot.fixture.id) ?? new Set<string>(); assigned.add(referee.id); selectedInFixture.set(slot.fixture.id, assigned);
    if (candidate.crewId) chosenByFixture.set(slot.fixture.id, candidate.crewId);
  };
  const undo = (slot: Slot, candidate: Candidate) => {
    const rows = assignmentMap[slot.fixture.id] ?? [];
    assignmentMap[slot.fixture.id] = rows.filter((item) => !(item.positionId === slot.position.id && (item.slotIndex ?? 0) === slot.slotIndex));
    const dutyIndex = workingDuties.findIndex((item) => item.fixtureId === slot.fixture.id && item.refereeId === candidate.refereeId);
    if (dutyIndex >= 0) workingDuties.splice(dutyIndex, 1);
    const assigned = selectedInFixture.get(slot.fixture.id); assigned?.delete(candidate.refereeId); if (!assigned?.size) selectedInFixture.delete(slot.fixture.id);
    if (candidate.crewId && !tentative.some((item) => item.slot.fixture.id === slot.fixture.id && item.candidate.crewId === candidate.crewId)) chosenByFixture.delete(slot.fixture.id);
  };

  function search(index: number): boolean {
    exploredNodes += 1;
    if (performance.now() >= deadline || exploredNodes > 20_000) { timedOut = true; return false; }
    if (index > bestPlaced) { bestPlaced = index; bestAssignments = Object.fromEntries(Object.entries(assignmentMap).map(([id, rows]) => [id, rows.map((row) => ({ ...row }))])); }
    if (index >= remaining.length) return true;
    const slot = remaining[index];
    const currentCrew = chosenByFixture.get(slot.fixture.id);
    const options = candidateFor(slot).filter((candidate) => {
      if (selectedInFixture.get(slot.fixture.id)?.has(candidate.refereeId)) return false;
      if (currentCrew && candidate.crewId !== currentCrew) return false;
      if (input.configuration.method === "CREW" && !candidate.crewId) return false;
      if (input.configuration.method === "CREW" && candidate.crewId) {
        const fixedRows = (assignmentMap[slot.fixture.id] ?? []).filter((row) => {
          const key = slotKey(row.positionId, row.slotIndex ?? 0);
          return row.refereeId && (row.locked || lockedFixtures.has(slot.fixture.id) || (lockedKeys[slot.fixture.id] ?? []).includes(key) || input.configuration.onlyMissingSlots);
        });
        const crew = input.roster.crews.find((item) => item.id === candidate.crewId);
        if (fixedRows.some((row) => row.crewId && row.crewId !== candidate.crewId || crew?.members.find((member) => member.positionId === row.positionId && (member.slotIndex ?? 0) === (row.slotIndex ?? 0))?.refereeId !== row.refereeId)) return false;
      }
      return true;
    });
    for (const candidate of options) {
      // Revalidate after earlier tentative assignments; no hard constraint is relaxed.
      const referee = input.roster.referees.find((item) => item.id === candidate.refereeId)!;
      const issues = validateRefereeAssignment({ referee, position: slot.position, fixture: slot.fixture, schedule: input.schedules[slot.fixture.id], resources: input.resources, roster: input.roster, format: input.format, affiliationsByTeamId: input.teamAffiliations, existingDuties: workingDuties });
      if (issues.some((issue) => issue.severity === "BLOCK")) continue;
      apply(slot, candidate); tentative.push({ slot, candidate });
      if (search(index + 1)) return true;
      tentative.pop(); undo(slot, candidate);
      if (timedOut) break;
    }
    if (input.configuration.method !== "CREW") {
      if (search(index + 1)) return true;
    }
    return false;
  }

  search(0);
  const completeRows = bestAssignments;
  const missing = [...modelMissing, ...remaining.flatMap((slot) => {
    const row = (completeRows[slot.fixture.id] ?? []).find((item) => item.positionId === slot.position.id && (item.slotIndex ?? 0) === slot.slotIndex);
    if (row?.refereeId) return [];
    const count = candidateFor(slot).length;
    const reason = count ? (timedOut ? "Giới hạn thời gian tìm kiếm; thuật toán chưa xác nhận được phương án đầy đủ." : "Vị trí còn trống sau khi giữ nguyên các nhiệm vụ tương thích và ưu tiên cân bằng.") : "Không có ứng viên vượt qua toàn bộ điều kiện bắt buộc hiện tại.";
    return [{ fixtureId: slot.fixture.id, positionId: slot.position.id, slotIndex: slot.slotIndex, reason }];
  })];
  const workload = new Map<string, number>(); const crewDutyFixtures = new Map<string, Set<string>>();
  for (const fixture of input.fixtures) {
    const rows = publishedIds.has(fixture.id) ? input.publishedAssignments[fixture.id] ?? [] : completeRows[fixture.id] ?? [];
    for (const row of rows) {
      if (row.refereeId) workload.set(row.refereeId, (workload.get(row.refereeId) ?? 0) + 1);
      if (row.crewId) { const fixtureSet = crewDutyFixtures.get(row.crewId) ?? new Set<string>(); fixtureSet.add(fixture.id); crewDutyFixtures.set(row.crewId, fixtureSet); }
    }
  }
  const changedFixtureIds = targetFixtures.filter((fixture) => stable(completeRows[fixture.id] ?? []) !== stable(baseAssignments[fixture.id] ?? [])).map((fixture) => fixture.id);
  const warnings: string[] = [];
  if (input.configuration.method !== "INDIVIDUAL" && input.configuration.method !== "MIXED" && !input.roster.crews.some((crew) => crew.status === "ACTIVE")) warnings.push("Không có tổ trọng tài đang hoạt động.");
  for (const fixture of targetFixtures) if (input.roster.neutralRules.some((rule) => rule.mandatory) && ((!fixture.homeTeamId && Boolean(fixture.homeSource)) || (!fixture.awayTeamId && Boolean(fixture.awaySource)))) warnings.push(`${fixture.id}: nguồn đội chưa xác định; cần xác minh trung lập trước khi công bố.`);
  if (timedOut) warnings.push("Đã chạm giới hạn tính toán; kết quả một phần được giữ để BTC xem xét, không nới lỏng ràng buộc.");
  return {
    status: missing.length === 0 ? "COMPLETE" : timedOut ? "TIMEOUT" : "PARTIAL",
    generatedAt: new Date().toISOString(), elapsedMs: Math.round(performance.now() - startedAt), exploredNodes,
    targetFixtureIds: targetFixtures.map((fixture) => fixture.id), changedFixtureIds,
    proposedAssignmentsByFixture: completeRows, missing,
    refereeWorkload: [...workload].map(([refereeId, assignments]) => ({ refereeId, refereeName: input.roster.referees.find((item) => item.id === refereeId)?.displayName ?? refereeId, assignments })).sort((a, b) => b.assignments - a.assignments),
    crewWorkload: [...crewDutyFixtures].map(([crewId, fixtures]) => ({ crewId, crewName: input.roster.crews.find((item) => item.id === crewId)?.name ?? crewId, assignments: fixtures.size })).sort((a, b) => b.assignments - a.assignments),
    warnings, baseSignature: automaticRefereeBaseSignature(input),
  };
}

