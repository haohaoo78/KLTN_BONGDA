import type { DemoFixture, DemoScheduleEntry, DemoScheduleResources } from "./schedulingTypes";
import { validateSchedulePlan, validateScheduleResourceConfiguration, type ScheduleConstraintIssue } from "./scheduleConstraintValidation";

export type ScheduleResourceImpact = {
  issues: ScheduleConstraintIssue[];
  newlyInvalidIssues: ScheduleConstraintIssue[];
  affectedFixtureIds: string[];
  affectedLockedFixtureIds: string[];
  recommendations: string[];
  requiresConfirmation: boolean;
};

const issueKey = (issue: ScheduleConstraintIssue) => `${issue.fixtureId}:${issue.code}:${issue.message}`;
const mapById = <T extends { id: string }>(items: T[] | undefined) => new Map((items ?? []).map((item) => [item.id, JSON.stringify(item)]));

/** Analyze a candidate resource change against existing test schedules without editing or moving any entry. */
export function analyzeScheduleResourceChange(
  fixtures: DemoFixture[],
  entries: Record<string, DemoScheduleEntry>,
  current: DemoScheduleResources,
  candidate: DemoScheduleResources,
  pitchType: 5 | 7 | 11,
): ScheduleResourceImpact {
  const catalogIssues = validateScheduleResourceConfiguration(candidate, pitchType, fixtures);
  const issues = [...catalogIssues, ...validateSchedulePlan(fixtures, entries, candidate, pitchType)];
  const beforeIssues = validateSchedulePlan(fixtures, entries, current, pitchType);
  const previousKeys = new Set(beforeIssues.map(issueKey));
  const newlyInvalidIssues = issues.filter((issue) => issue.fixtureId && !previousKeys.has(issueKey(issue)));
  const affected = new Set(newlyInvalidIssues.map((issue) => issue.fixtureId).filter(Boolean));

  const changedVenueIds = new Set<string>();
  const previousVenues = mapById(current.venues);
  const nextVenues = mapById(candidate.venues);
  for (const id of new Set([...previousVenues.keys(), ...nextVenues.keys()])) {
    if (previousVenues.get(id) !== nextVenues.get(id)) changedVenueIds.add(id);
  }
  const changedCodes = new Set<string>();
  for (const venue of [...current.venues, ...candidate.venues]) if (changedVenueIds.has(venue.id)) {
    changedCodes.add(venue.code);
    changedCodes.add(venue.name);
  }

  const changedLocations = new Set<string>();
  const previousLocations = mapById(current.locations);
  const nextLocations = mapById(candidate.locations);
  for (const id of new Set([...previousLocations.keys(), ...nextLocations.keys()])) {
    if (previousLocations.get(id) !== nextLocations.get(id)) changedLocations.add(id);
  }
  const changedProfiles = new Set<string>();
  const previousProfiles = mapById(current.availabilityProfiles);
  const nextProfiles = mapById(candidate.availabilityProfiles);
  for (const id of new Set([...previousProfiles.keys(), ...nextProfiles.keys()])) {
    if (previousProfiles.get(id) !== nextProfiles.get(id)) changedProfiles.add(id);
  }

  const sharedScheduleFields: Array<keyof DemoScheduleResources> = [
    "competitionStartDate", "competitionEndDate", "allowedWeekdays", "slots", "blockedDates", "groupTiming", "knockoutTiming",
    "minimumTeamRestMinutes", "maximumMatchesPerTeamPerDay", "travelBufferMinutes", "scheduleMode", "maximumRoundsPerDay",
    "requireSimultaneousGroupFinalRound", "maximumKnockoutRestDifferenceMinutes", "enforceKnockoutRestDifference", "maximumRoundsPerDayRequired",
    "sameVenueAcrossRoundRequired", "rotateVenues", "rotateTimeSlots", "rotateTimeSlotsRequired", "maximumConsecutiveHomeAway",
    "maximumKnockoutRestDifferenceRequired", "centralVenuePreferredStages",
  ];
  const globalScheduleChange = sharedScheduleFields.some((key) => JSON.stringify(current[key]) !== JSON.stringify(candidate[key]));

  for (const fixture of fixtures) {
    const entry = entries[fixture.id];
    if (!entry?.scheduledAt || !entry.venue) continue;
    const oldVenue = current.venues.find((venue) => venue.code === entry.venue || venue.name === entry.venue);
    const nextVenue = candidate.venues.find((venue) => venue.code === entry.venue || venue.name === entry.venue);
    const linkedLocationChanged = Boolean(oldVenue?.locationId && changedLocations.has(oldVenue.locationId)
      || nextVenue?.locationId && changedLocations.has(nextVenue.locationId));
    const linkedProfileChanged = Boolean(oldVenue?.availabilityProfileId && changedProfiles.has(oldVenue.availabilityProfileId)
      || nextVenue?.availabilityProfileId && changedProfiles.has(nextVenue.availabilityProfileId));
    if (globalScheduleChange || changedCodes.has(entry.venue) || linkedLocationChanged || linkedProfileChanged) affected.add(fixture.id);
  }

  const affectedFixtureIds = [...affected].sort();
  const affectedLockedFixtureIds = affectedFixtureIds.filter((id) => entries[id]?.locked === true);
  const recommendations = newlyInvalidIssues.length
    ? [...new Set(newlyInvalidIssues.map((issue) => `${issue.fixtureId}: ${issue.message}`))]
    : affectedFixtureIds.length
      ? ["Lịch của các trận bị ảnh hưởng được giữ nguyên. Xem lại từng trận trước khi công bố."]
      : [];
  return {
    issues,
    newlyInvalidIssues,
    affectedFixtureIds,
    affectedLockedFixtureIds,
    recommendations,
    requiresConfirmation: affectedFixtureIds.length > 0,
  };
}
