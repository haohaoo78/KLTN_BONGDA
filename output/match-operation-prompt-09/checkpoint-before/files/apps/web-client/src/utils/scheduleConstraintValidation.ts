// Compatibility re-export. Scheduling rules are implemented in @sfl/shared
// and consumed by both the browser and Match Service.
export {
  getFinalRoundClusterOptions,
  getFinalRoundFixturesByGroup,
  getManualScheduleCandidates,
  getScheduleObjectiveWarnings,
  getScheduleStatistics,
  matchPlayMinutes,
  validateSchedulePlan,
  venueOccupiedMinutes,
} from "../../../../packages/shared/src/scheduleConstraintValidation";
export type {
  FinalRoundClusterOption,
  ManualScheduleCandidate,
  ScheduleConstraintIssue,
} from "../../../../packages/shared/src/scheduleConstraintValidation";
