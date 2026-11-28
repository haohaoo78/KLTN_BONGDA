import { AppError } from "../lib/errors";

export type BracketMatchReadiness = {
  status: string;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeResolved: boolean;
  awayResolved: boolean;
};

/** A bracket match may be scheduled before entrants are known; operations still require resolved entrants. */
export function assertBracketMatchSchedulable(slot: BracketMatchReadiness | null): void {
  if (!slot) return;
  if (slot.status === "WAITING") return;
  if (slot.status !== "READY" || !slot.homeResolved || !slot.awayResolved || !slot.homeTeamId || !slot.awayTeamId) {
    throw new AppError(409, "Vị trí nhánh này chưa thể xếp lịch", "BRACKET_SLOT_NOT_SCHEDULABLE");
  }
  if (slot.homeTeamId === slot.awayTeamId) {
    throw new AppError(409, "Một đội không thể gặp chính mình trong nhánh đấu", "INVALID_BRACKET_MATCH");
  }
}
