import { AppError } from "../lib/errors";

export type MatchScoreInput = {
  homeScore: number;
  awayScore: number;
  homeExtraTimeScore?: number | null;
  awayExtraTimeScore?: number | null;
  homePenaltyScore?: number | null;
  awayPenaltyScore?: number | null;
};

/** Validate a score at the service boundary so direct API clients cannot bypass UI checks. */
export function validateMatchScore(input: MatchScoreInput): void {
  const scores = [
    input.homeScore,
    input.awayScore,
    input.homeExtraTimeScore,
    input.awayExtraTimeScore,
    input.homePenaltyScore,
    input.awayPenaltyScore,
  ];
  if (scores.some((score) => score != null && (!Number.isInteger(score) || score < 0 || score > 2147483647))) {
    throw new AppError(400, "Tỷ số phải là số nguyên không âm trong phạm vi lưu trữ.", "INVALID_SCORES");
  }
  if (!Number.isInteger(input.homeScore) || !Number.isInteger(input.awayScore)) {
    throw new AppError(400, "Phải nhập tỷ số chính thức cho cả hai đội.", "INVALID_SCORES");
  }

  const hasHomeExtraTime = input.homeExtraTimeScore != null;
  const hasAwayExtraTime = input.awayExtraTimeScore != null;
  if (hasHomeExtraTime !== hasAwayExtraTime) {
    throw new AppError(400, "Hãy nhập đủ tỷ số hiệp phụ cho cả hai đội.", "INVALID_EXTRA_TIME_SCORES");
  }
  if (hasHomeExtraTime && input.homeScore !== input.awayScore) {
    throw new AppError(400, "Chỉ nhập hiệp phụ khi hai đội hòa sau thời gian thi đấu chính thức.", "EXTRA_TIME_REQUIRES_TIE");
  }

  const hasHomePenalties = input.homePenaltyScore != null;
  const hasAwayPenalties = input.awayPenaltyScore != null;
  if (hasHomePenalties !== hasAwayPenalties) {
    throw new AppError(400, "Hãy nhập đủ tỷ số luân lưu cho cả hai đội.", "INVALID_PENALTY_SCORES");
  }
  if (hasHomePenalties) {
    const homeTotal = input.homeScore + (input.homeExtraTimeScore ?? 0);
    const awayTotal = input.awayScore + (input.awayExtraTimeScore ?? 0);
    if (homeTotal !== awayTotal) {
      throw new AppError(400, "Chỉ nhập luân lưu khi hai đội vẫn hòa sau thời gian thi đấu và hiệp phụ.", "PENALTIES_REQUIRE_TIE");
    }
    if (input.homePenaltyScore === input.awayPenaltyScore) {
      throw new AppError(400, "Tỷ số luân lưu phải xác định được đội thắng.", "PENALTIES_MUST_DECIDE_WINNER");
    }
  }
}
