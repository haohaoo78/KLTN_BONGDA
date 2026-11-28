// Compatibility re-export; Match Service and web client use the same planner implementation.
import { buildAutomaticRefereePlan } from "../../../../packages/shared/src/automaticRefereePlanner";
export { automaticRefereeBaseSignature, buildAutomaticRefereePlan } from "../../../../packages/shared/src/automaticRefereePlanner";
export type { AutoRefereeConfiguration, AutoRefereeMethod, AutoRefereeObjective, AutoRefereePreview, AutoRefereePlannerInput } from "../../../../packages/shared/src/automaticRefereePlanner";
export const runAutoRefereePlanner = async (input: Parameters<typeof buildAutomaticRefereePlan>[0]) => buildAutomaticRefereePlan(input);
