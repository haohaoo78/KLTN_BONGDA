import { AppError } from "../lib/errors";

export function assertKickoffReached(scheduledDate: string | null, now = Date.now()): void {
  if (!scheduledDate) {
    throw new AppError(409, "A published kickoff time is required before a referee can start the match", "MATCH_SCHEDULE_REQUIRED");
  }

  const kickoff = Date.parse(scheduledDate);
  if (!Number.isFinite(kickoff)) {
    throw new AppError(409, "The scheduled kickoff time is invalid", "MATCH_SCHEDULE_INVALID");
  }

  if (kickoff > now) {
    throw new AppError(409, "A referee cannot start a match before its scheduled kickoff", "MATCH_KICKOFF_NOT_REACHED");
  }
}
