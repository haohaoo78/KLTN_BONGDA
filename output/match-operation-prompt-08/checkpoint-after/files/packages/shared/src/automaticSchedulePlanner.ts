import type {
  AutoScheduleConfiguration,
  AutoScheduleObjective,
  AutoSchedulePreview,
  DemoFixture,
  DemoScheduleEntry,
  DemoScheduleResources,
} from "./schedulingTypes";
import {
  getAutomaticScheduleCandidates,
  getFinalRoundFixturesByGroup,
  getScheduleObjectiveWarnings,
  matchPlayMinutes,
  validateSchedulePlan,
} from "./scheduleConstraintValidation";

export type AutomaticSchedulePlan = AutoSchedulePreview & { searchLimitReached: boolean };

/** One bounded budget shared by the official client, API parser and planner. */
export const MAX_AUTOMATIC_SCHEDULE_RUNTIME_MS = 120_000;

const minute = 60_000;
const roundIndex = (round: string) => Number(round.match(/\d+/)?.[0] ?? Number.MAX_SAFE_INTEGER);
const groupRoundIndex = (fixture: DemoFixture) => fixture.roundNumber
  ?? Number(fixture.round.match(/(?:vòng|round)\s*(\d+)/i)?.[1] ?? fixture.round.match(/\d+/)?.[0] ?? Number.MAX_SAFE_INTEGER);
// Demo fixture IDs can contain numeric group IDs and a league/leg segment
// (for example TEST-1-R2-L1-M3), so do not assume alphabetic groups only.
const sourceFixtureId = (source?: string) => source?.match(/(TEST-[A-Z0-9]+-R\d+(?:-L\d+)?-M\d+)/i)?.[1]
  ?? source?.match(/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/i)?.[1];

export function selectFixturesForAutomaticSchedule(
  fixtures: DemoFixture[], entries: Record<string, DemoScheduleEntry>, configuration: AutoScheduleConfiguration,
) {
  const { phase, groups, rounds, onlyUnscheduled } = configuration.scope;
  return fixtures.filter((fixture) => {
    if (fixture.bye) return false;
    if (phase === "GROUP" && fixture.stage !== "GROUP") return false;
    if (phase === "KNOCKOUT" && fixture.stage !== "KNOCKOUT") return false;
    if (groups.length && (!fixture.groupName || !groups.includes(fixture.groupName))) return false;
    if (rounds.length && !rounds.includes(fixture.round)) return false;
    if (configuration.scope.legs?.length && (!fixture.leg || !configuration.scope.legs.includes(fixture.leg))) return false;
    if (configuration.scope.fixtureIds?.length && !configuration.scope.fixtureIds.includes(fixture.id)) return false;
    const date = entries[fixture.id]?.scheduledAt?.slice(0, 10);
    const range = configuration.scope.dateRange;
    if (range && date && ((range.start && date < range.start) || (range.end && date > range.end))) return false;
    if (onlyUnscheduled && entries[fixture.id]?.scheduledAt) return false;
    return true;
  });
}

export function automaticScheduleBaseSignature(
  fixtures: DemoFixture[], entries: Record<string, DemoScheduleEntry>, resources: DemoScheduleResources,
) {
  return JSON.stringify({
    fixtures: fixtures.map((fixture) => [fixture.id, fixture.stage, fixture.groupName, fixture.round, fixture.leg, fixture.homeTeamId, fixture.awayTeamId, fixture.homeSource, fixture.awaySource, fixture.bye]),
    entries,
    resources,
  });
}

function orderByDependencies(fixtures: DemoFixture[]) {
  const byId = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  const sourceDependencies = (fixture: DemoFixture) => [fixture.homeSource, fixture.awaySource]
    .map(sourceFixtureId).filter((id): id is string => Boolean(id)).map((id) => byId.get(id)).filter((item): item is DemoFixture => Boolean(item));
  const visited = new Set<string>();
  const ordered: DemoFixture[] = [];
  const visit = (fixture: DemoFixture) => {
    if (visited.has(fixture.id)) return;
    visited.add(fixture.id);
    sourceDependencies(fixture).forEach(visit);
    ordered.push(fixture);
  };
  [...fixtures].sort((a, b) => {
    if (a.stage !== b.stage) return a.stage === "GROUP" ? -1 : 1;
    if (a.stage === "GROUP") return (a.leg ?? 1) - (b.leg ?? 1) || groupRoundIndex(a) - groupRoundIndex(b) || (a.groupName ?? "").localeCompare(b.groupName ?? "") || a.id.localeCompare(b.id);
    return roundIndex(a.round) - roundIndex(b.round) || a.id.localeCompare(b.id);
  }).forEach(visit);
  return ordered;
}

function objectiveCost(
  priority: AutoScheduleObjective,
  fixture: DemoFixture,
  candidate: { scheduledAt: string; venue: { id: string; location?: string; locationId?: string; travelZone?: string; central?: boolean; preferredStages?: string[] }; slotId: string },
  fixtures: DemoFixture[],
  entries: Record<string, DemoScheduleEntry>,
  originalEntries: Record<string, DemoScheduleEntry>,
  resources: DemoScheduleResources,
) {
  const assigned = fixtures.filter((item) => entries[item.id]?.scheduledAt);
  const venueCounts = new Map<string, number>();
  const slotCounts = new Map<string, number>();
  const teamUsage = new Map<string, Map<string, number>>();
  const teamStarts = new Map<string, Array<{ start: number; end: number }>>();
  const teamVenueAreas = new Map<string, string[]>();
  const venueByCode = new Map(resources.venues.flatMap((venue) => [[venue.code, venue], [venue.name, venue]]));
  for (const item of assigned) {
    const entry = entries[item.id];
    const venueId = venueByCode.get(entry.venue)?.id ?? entry.venue;
    venueCounts.set(venueId, (venueCounts.get(venueId) ?? 0) + 1);
    if (entry.slotId) slotCounts.set(entry.slotId, (slotCounts.get(entry.slotId) ?? 0) + 1);
    for (const teamId of [item.homeTeamId, item.awayTeamId].filter((id): id is string => Boolean(id))) {
      const usage = teamUsage.get(teamId) ?? new Map<string, number>();
      usage.set("venue:" + venueId, (usage.get("venue:" + venueId) ?? 0) + 1);
      if (entry.slotId) usage.set("slot:" + entry.slotId, (usage.get("slot:" + entry.slotId) ?? 0) + 1);
      teamUsage.set(teamId, usage);
      const list = teamStarts.get(teamId) ?? [];
      list.push({ start: new Date(entry.scheduledAt).getTime(), end: new Date(entry.scheduledAt).getTime() + matchPlayMinutes(item, resources) * minute });
      teamStarts.set(teamId, list);
      const area = venueByCode.get(entry.venue);
      const areas = teamVenueAreas.get(teamId) ?? [];
      if (area) areas.push(area.travelZone?.trim() || area.locationId || area.location.trim() || area.id);
      teamVenueAreas.set(teamId, areas);
    }
  }
  const candidateTime = new Date(candidate.scheduledAt).getTime();
  const candidateTeams = [fixture.homeTeamId, fixture.awayTeamId].filter((id): id is string => Boolean(id));
  const slot = resources.slots.find((item) => item.id === candidate.slotId);
  switch (priority) {
    case "MINIMIZE_CHANGES": {
      const original = originalEntries[fixture.id];
      if (!original?.scheduledAt || !original.venue) return 0;
      const originalVenue = venueByCode.get(original.venue)?.id ?? original.venue;
      return original.scheduledAt === candidate.scheduledAt && originalVenue === candidate.venue.id && (!original.slotId || original.slotId === candidate.slotId) ? 0 : 1;
    }
    case "COMPLETION": {
      const begin = new Date(`${resources.competitionStartDate}T00:00:00`).getTime();
      const days = Math.max(1, (new Date(`${resources.competitionEndDate}T23:59:59`).getTime() - begin) / (24 * 60 * minute));
      return Math.max(0, (candidateTime - begin) / (24 * 60 * minute)) / days;
    }
    case "VENUE_USE": {
      const current = [...venueCounts.values()];
      const mean = current.length ? current.reduce((sum, count) => sum + count, 0) / Math.max(1, resources.venues.filter((venue) => venue.active && venue.availabilityConfirmed === true).length) : 0;
      return Math.abs((venueCounts.get(candidate.venue.id) ?? 0) + 1 - mean);
    }
    case "FAIRNESS": {
      const usage = candidateTeams.flatMap((teamId) => {
        const current = teamUsage.get(teamId);
        return [current?.get("venue:" + candidate.venue.id) ?? 0, current?.get("slot:" + candidate.slotId) ?? 0];
      });
      return usage.reduce((sum, count) => sum + count, 0) + (slot?.priority === "RESTRICTED" ? 5 : 0)
        + (resources.rotateVenues ? (venueCounts.get(candidate.venue.id) ?? 0) * 0.5 : 0)
        + (resources.rotateTimeSlots ? (slotCounts.get(candidate.slotId) ?? 0) * 0.5 : 0);
    }
    case "REST": {
      const duration = matchPlayMinutes(fixture, resources) * minute;
      let restCost = 0;
      for (const teamId of candidateTeams) for (const prior of teamStarts.get(teamId) ?? []) {
        const gap = candidateTime >= prior.start ? candidateTime - prior.end : prior.start - (candidateTime + duration);
        const restMinutes = Math.max(0, gap / minute);
        const preferredRest = Math.max(resources.minimumTeamRestMinutes, 1) * 1.5;
        restCost += Math.abs(restMinutes - preferredRest) / preferredRest;
      }
      return restCost;
    }
    case "TRAVEL": {
      const candidateArea = candidate.venue.travelZone?.trim() || candidate.venue.locationId || candidate.venue.location?.trim() || candidate.venue.id;
      return candidateTeams.reduce((cost, teamId) => cost + (teamVenueAreas.get(teamId) ?? []).filter((area) => area !== candidateArea).length, 0);
    }
    case "BRANCH_REST": {
      if (fixture.stage !== "KNOCKOUT") return 0;
      return getScheduleObjectiveWarnings(fixtures, { ...entries, [fixture.id]: { scheduledAt: candidate.scheduledAt, durationMinutes: matchPlayMinutes(fixture, resources), venue: candidate.venue.id, slotId: candidate.slotId, refereeNames: [], notes: "" } }, resources)
        .filter((warning) => warning.code === "KNOCKOUT_REST_IMBALANCE").length;
    }
    case "CENTRAL_VENUE": {
      const important = resources.centralVenuePreferredStages?.includes(fixture.round) || candidate.venue.preferredStages?.includes(fixture.round);
      return important && !candidate.venue.central && !candidate.venue.preferredStages?.includes(fixture.round) ? 1 : 0;
    }
  }
}

function candidateScore(
  fixture: DemoFixture,
  candidate: { scheduledAt: string; venue: { id: string; location?: string; locationId?: string; travelZone?: string; central?: boolean; preferredStages?: string[] }; slotId: string },
  fixtures: DemoFixture[],
  entries: Record<string, DemoScheduleEntry>,
  originalEntries: Record<string, DemoScheduleEntry>,
  resources: DemoScheduleResources,
  objectives: AutoScheduleObjective[],
) {
  // Respect BTC's ordered priorities lexicographically. A lower-ranked goal
  // must never outweigh a better result for a higher-ranked goal merely
  // because their numeric scales differ.
  return objectives.map((objective) => objectiveCost(objective, fixture, candidate, fixtures, entries, originalEntries, resources));
}

export async function buildAutomaticSchedulePlan(args: {
  fixtures: DemoFixture[];
  currentEntries: Record<string, DemoScheduleEntry>;
  resources: DemoScheduleResources;
  configuration: AutoScheduleConfiguration;
  pitchType: 5 | 7 | 11;
  now?: () => number;
  shouldCancel?: () => boolean;
}): Promise<AutomaticSchedulePlan> {
  const { fixtures, currentEntries, resources, configuration, pitchType } = args;
  const now = args.now ?? (() => performance.now());
  const started = now();
  const runtimeBudget = Math.max(500, Math.min(MAX_AUTOMATIC_SCHEDULE_RUNTIME_MS, configuration.maxRuntimeMs));
  const deadline = started + runtimeBudget;
  const allFixtures = fixtures.filter((fixture) => !fixture.bye);
  const selected = selectFixturesForAutomaticSchedule(allFixtures, currentEntries, configuration);
  const selectedIds = new Set(selected.map((fixture) => fixture.id));
  const frozen = new Set(selected.filter((fixture) => currentEntries[fixture.id]?.locked || currentEntries[fixture.id]?.officialStatus === "PUBLISHED").map((fixture) => fixture.id));
  const targets = orderByDependencies(selected.filter((fixture) => !frozen.has(fixture.id)));
  const baseEntries: Record<string, DemoScheduleEntry> = { ...currentEntries };
  for (const fixture of targets) delete baseEntries[fixture.id];
  let working = { ...baseEntries };
  let best = { ...working };
  let bestCount = selected.filter((fixture) => Boolean(working[fixture.id]?.scheduledAt)).length;
  let bestObjectiveScore: number[] = configuration.objectives.map(() => 0);
  let exploredNodes = 0;
  let timedOut = false;
  let searchLimitReached = false;
  let foundComplete = false;
  const maximumNodes = Math.max(1_200, Math.ceil(runtimeBudget / 15_000) * 1_200);
  const maximumChoices = 7;
  const compareObjectiveScore = (left: number[], right: number[]) => {
    for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
      if (Math.abs(left[index] - right[index]) > 1e-9) return left[index] - right[index];
    }
    return 0;
  };
  const candidateRejectionCounts = new Map<string, { count: number; examples: Set<string> }>();
  const noteRejectedCandidate = (code: string, message: string) => {
    const current = candidateRejectionCounts.get(code) ?? { count: 0, examples: new Set<string>() };
    current.count += 1;
    if (current.examples.size < 3) current.examples.add(message);
    candidateRejectionCounts.set(code, current);
  };

  const yieldControl = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  const search = async (index: number, objectiveScore: number[] = configuration.objectives.map(() => 0), feasibilityFirst = false) => {
    // A long official request must let disconnect/health events run between
    // fixture candidate batches, not only after recursive backtracking.
    await yieldControl();
    if (args.shouldCancel?.()) { timedOut = true; return; }
    exploredNodes += 1;
    if (exploredNodes > maximumNodes || now() >= deadline) { timedOut = true; return; }
    const placed = selected.filter((fixture) => Boolean(working[fixture.id]?.scheduledAt)).length;
    // A full-count candidate becomes an incumbent only after the leaf's
    // whole-plan validation. A focused edit can miss a cluster-wide issue.
    if (placed < selected.length && (placed > bestCount || (placed === bestCount && compareObjectiveScore(objectiveScore, bestObjectiveScore) < 0))) {
      bestCount = placed; best = { ...working }; bestObjectiveScore = [...objectiveScore];
    }
    if (index >= targets.length) {
      if (selected.every((item) => Boolean(working[item.id]?.scheduledAt))
        && !validateSchedulePlan(allFixtures, working, resources, pitchType).length
        && !getScheduleObjectiveWarnings(allFixtures, working, resources).some((issue) => issue.severity === "HARD")) {
        if (!foundComplete || compareObjectiveScore(objectiveScore, bestObjectiveScore) < 0) {
          best = { ...working }; bestCount = selected.length; bestObjectiveScore = [...objectiveScore];
        }
        foundComplete = true;
      }
      return;
    }
    const fixture = targets[index];
    const candidates = getAutomaticScheduleCandidates(fixture, allFixtures, working, resources, pitchType, { maximumCandidates: feasibilityFirst ? 24 : 96, maximumPerBucket: feasibilityFirst ? 1 : 3, maximumProbes: 20_000, existingEntry: currentEntries[fixture.id], dateRange: configuration.scope.dateRange, shouldStop: () => now() >= deadline || Boolean(args.shouldCancel?.()), onLimitReached: () => { searchLimitReached = true; }, onRejected: noteRejectedCandidate });
    await yieldControl();
    if (args.shouldCancel?.() || now() >= deadline) { timedOut = true; return; }
    const ranked = candidates.map((candidate, order) => ({ candidate, order, score: candidateScore(fixture, candidate, allFixtures, working, currentEntries, resources, configuration.objectives) }))
      .sort((left, right) => {
        // Obtain a complete feasible incumbent before spending the budget on
        // preferred rest/fairness slots that may leave no room for descendants.
        // The subsequent optimization keeps BTC's exact lexicographic order.
        if (feasibilityFirst) {
          const time = left.candidate.scheduledAt.localeCompare(right.candidate.scheduledAt);
          if (time) return time;
        }
        for (let index = 0; index < Math.min(left.score.length, right.score.length); index += 1) {
          const difference = left.score[index] - right.score[index];
          if (Math.abs(difference) > 1e-9) return difference;
        }
        return left.order - right.order;
      });
    if (ranked.length > maximumChoices) searchLimitReached = true;
    const choices = ranked.slice(0, maximumChoices);
    if (!choices.length) {
      await search(index + 1, objectiveScore, feasibilityFirst);
      return;
    }
    for (const { candidate, score } of choices) {
      if (timedOut) break;
      working = {
        ...working,
        [fixture.id]: {
          ...(currentEntries[fixture.id] ?? { refereeNames: [], notes: "" }),
          scheduledAt: candidate.scheduledAt,
          durationMinutes: matchPlayMinutes(fixture, resources),
          venue: candidate.venue.code,
          slotId: candidate.slotId,
          refereeNames: currentEntries[fixture.id]?.refereeNames ?? [],
          notes: currentEntries[fixture.id]?.notes ?? "",
          locked: false,
        },
      };
      // Check the complete partial plan before descending. Existing locked and
      // out-of-scope schedules remain part of every validation pass.
      // The candidate generator has validated this target against every current
      // assignment and its dependants. Full-plan validation is reserved for the
      // completed candidate (and again when BTC applies it).
      await search(index + 1, objectiveScore.map((value, scoreIndex) => value + (score[scoreIndex] ?? 0)), feasibilityFirst);
      delete working[fixture.id];
      if (currentEntries[fixture.id]?.scheduledAt) working[fixture.id] = currentEntries[fixture.id];
      if (feasibilityFirst && foundComplete) break;
      if (exploredNodes % 10 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  };

  const preexistingIssues = validateSchedulePlan(allFixtures, currentEntries, resources, pitchType);
  const warnings: string[] = [];
  if (!selected.length) {
    return { status: "NO_TARGETS", generatedAt: new Date().toISOString(), elapsedMs: Math.round(now() - started), exploredNodes, selectedFixtureIds: [], scheduledFixtureIds: [], missing: [], proposedEntries: currentEntries, baseSignature: automaticScheduleBaseSignature(fixtures, currentEntries, resources), warnings: ["Không có trận cần lập lịch trong phạm vi; bản nháp không thay đổi."], searchLimitReached: false };
  }
  if (preexistingIssues.length) {
    return { status: "INFEASIBLE", generatedAt: new Date().toISOString(), elapsedMs: Math.round(now() - started), exploredNodes, selectedFixtureIds: selected.map((fixture) => fixture.id), scheduledFixtureIds: [], missing: targets.map((fixture) => ({ fixtureId: fixture.id, reason: "Bản lịch hiện tại đã có lỗi ràng buộc; hãy xử lý trước khi chạy tự động." })), proposedEntries: currentEntries, baseSignature: automaticScheduleBaseSignature(fixtures, currentEntries, resources), warnings: preexistingIssues.slice(0, 8).map((issue) => issue.fixtureId + ": " + issue.message), searchLimitReached: false };
  }
  const activeVenueCount = resources.venues.filter((venue) => venue.active && venue.pitchType === pitchType && venue.availabilityConfirmed === true).length;
  const resourceBlocker = !resources.competitionStartDate || !resources.competitionEndDate || resources.competitionStartDate > resources.competitionEndDate
    ? "Chưa cấu hình khoảng ngày thi đấu hợp lệ."
    : !resources.allowedWeekdays.length ? "Chưa cấu hình ngày trong tuần được phép thi đấu."
      : !resources.slots.length ? "Chưa cấu hình khung giờ thi đấu."
      : !activeVenueCount ? `Không có sân ${pitchType} người đã được xác nhận khả dụng trong cấu hình nguồn lực.` : "";
  if (resourceBlocker) {
    return { status: "INFEASIBLE", generatedAt: new Date().toISOString(), elapsedMs: Math.round(now() - started), exploredNodes, selectedFixtureIds: selected.map((fixture) => fixture.id), scheduledFixtureIds: [], missing: targets.map((fixture) => ({ fixtureId: fixture.id, reason: resourceBlocker })), proposedEntries: currentEntries, baseSignature: automaticScheduleBaseSignature(fixtures, currentEntries, resources), warnings: [resourceBlocker], searchLimitReached: false };
  }
  if (!targets.length) {
    const hardObjectives = getScheduleObjectiveWarnings(allFixtures, currentEntries, resources).filter((issue) => issue.severity === "HARD");
    const valid = validateSchedulePlan(allFixtures, currentEntries, resources, pitchType).length === 0 && !hardObjectives.length;
    return { status: valid ? "COMPLETE" : "INFEASIBLE", generatedAt: new Date().toISOString(), elapsedMs: Math.round(now() - started), exploredNodes: 0, selectedFixtureIds: selected.map((fixture) => fixture.id), scheduledFixtureIds: selected.map((fixture) => fixture.id), missing: [], proposedEntries: currentEntries, baseSignature: automaticScheduleBaseSignature(fixtures, currentEntries, resources), warnings: [...hardObjectives.map((issue) => issue.message), "Tất cả trận trong phạm vi đều đã khóa hoặc đã công bố; lịch được giữ nguyên."], searchLimitReached: false };
  }

  await search(0, configuration.objectives.map(() => 0), true);
  if (foundComplete && !timedOut && now() < deadline && exploredNodes < maximumNodes) {
    working = { ...baseEntries };
    await search(0);
  }
  const scheduledFixtureIds = selected.filter((fixture) => Boolean(best[fixture.id]?.scheduledAt)).map((fixture) => fixture.id);
  const missing = selected.filter((fixture) => !best[fixture.id]?.scheduledAt).map((fixture) => {
    const sourceIds = [fixture.homeSource, fixture.awaySource].map(sourceFixtureId).filter((id): id is string => Boolean(id));
    const unscheduledParent = allFixtures.find((candidate) => sourceIds.includes(candidate.id) && !best[candidate.id]?.scheduledAt);
    const qualifiedGroups = [fixture.homeSource, fixture.awaySource]
      .map((source) => source?.match(/(?:Nhất|Nhì|Hạng\s+\d+)\s+bảng\s+(.+)/i)?.[1]?.trim())
      .filter((name): name is string => Boolean(name));
    const missingGroupGames = qualifiedGroups.flatMap((name) => allFixtures.filter((candidate) => candidate.stage === "GROUP"
      && (candidate.groupName ?? "").replace(/^bảng\s+/i, "").trim().toLocaleLowerCase() === name.replace(/^bảng\s+/i, "").trim().toLocaleLowerCase()
      && !best[candidate.id]?.scheduledAt));
    const finalGroup = getFinalRoundFixturesByGroup(allFixtures).find((group) => group.fixtures.some((item) => item.id === fixture.id));
    const insufficientFinalPitches = resources.requireSimultaneousGroupFinalRound && fixture.stage === "GROUP" && finalGroup
      && resources.venues.filter((venue) => venue.active && venue.pitchType === pitchType && venue.availabilityConfirmed === true).length < finalGroup.fixtures.length;
    return {
      fixtureId: fixture.id,
      reason: timedOut
        ? "Chưa bố trí được trong giới hạn tính toán; chưa thể kết luận cấu hình không khả thi."
        : unscheduledParent
          ? `Chưa xếp được trận nguồn ${unscheduledParent.id}; cần đưa các trận nguồn vào phạm vi hoặc bổ sung nguồn lực.`
          : missingGroupGames.length
            ? `Nguồn thứ hạng vòng bảng còn ${missingGroupGames.length} trận chưa xếp lịch; mở rộng phạm vi sang các trận của bảng liên quan.`
            : insufficientFinalPitches
              ? `Cụm vòng cuối cần ${finalGroup.fixtures.length} sân khả dụng đồng thời nhưng nguồn lực hiện có không đủ.`
              : "Không tìm thấy ngày–sân–giờ hợp lệ trong phương án đã xét; kiểm tra ngày, sân, khung giờ, thời gian nghỉ hoặc giới hạn trận/ngày.",
    };
  });
  const finalIssues = validateSchedulePlan(allFixtures, best, resources, pitchType);
  if (finalIssues.length) warnings.push(...finalIssues.slice(0, 8).map((issue) => issue.fixtureId + ": " + issue.message));
  const finalObjective = getScheduleObjectiveWarnings(allFixtures, best, resources);
  warnings.push(...finalObjective.filter((issue) => issue.severity !== "HARD").slice(0, 20).map((issue) => issue.message));
  if (timedOut) warnings.push("Đã hết giới hạn thời gian tìm kiếm; kết quả hiện tại chưa chứng minh rằng không còn phương án hợp lệ.");
  else if (searchLimitReached && scheduledFixtureIds.length < selected.length) warnings.push("Đã giới hạn số phương án thử cho mỗi trận; kết quả một phần không chứng minh rằng toàn bộ lịch là bất khả thi.");
  // Exhausting a time/node/candidate bound is not proof that the schedule is
  // impossible. Report an inconclusive search instead of a false INFEASIBLE.
  const status: AutomaticSchedulePlan["status"] = foundComplete ? "COMPLETE" : timedOut || searchLimitReached ? "TIMEOUT" : scheduledFixtureIds.length ? "PARTIAL" : "INFEASIBLE";
  return {
    status,
    generatedAt: new Date().toISOString(),
    elapsedMs: Math.round(now() - started),
    exploredNodes,
    selectedFixtureIds: selected.map((fixture) => fixture.id),
    scheduledFixtureIds,
    missing,
    proposedEntries: best,
    baseSignature: automaticScheduleBaseSignature(fixtures, currentEntries, resources),
    warnings: [...new Set(warnings)],
    searchLimitReached,
    candidateRejections: [...candidateRejectionCounts].map(([code, value]) => ({ code, count: value.count, examples: [...value.examples] })).sort((a, b) => b.count - a.count),
  };
}
