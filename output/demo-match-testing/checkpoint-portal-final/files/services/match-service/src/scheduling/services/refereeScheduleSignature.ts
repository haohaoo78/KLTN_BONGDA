import { createHash } from "node:crypto";
import type { Schedule } from "../models/scheduling";

export function refereeScheduleSignature(schedule: Pick<Schedule, "id" | "matchId" | "venueId" | "scheduledDate" | "durationMinutes" | "status">): string {
  return createHash("sha256").update(JSON.stringify([schedule.id, schedule.matchId, schedule.venueId, new Date(schedule.scheduledDate).toISOString(), schedule.durationMinutes, schedule.status])).digest("hex");
}
