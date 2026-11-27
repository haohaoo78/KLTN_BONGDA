import { config } from "../config";
import { AppError } from "../lib/errors";

export interface TournamentDisciplinePolicy {
  complaintWindowHours: number;
  forfeitPolicy: "ORGANIZER_DECISION" | "WALKOVER" | "NO_AUTOMATIC_RESULT";
  forfeitWinnerScore: number;
  forfeitLoserScore: number;
  yellowCardsForSuspension: number;
  suspensionMatches: number;
  publishedVersion: number;
  publishedAt: string | null;
}

export async function getTournamentDisciplinePolicy(tournamentId: string, matchId?: string): Promise<TournamentDisciplinePolicy> {
  if (matchId) {
    const { getEffectiveMatchRules } = await import("./matchOperationRulesService");
    const effective = await getEffectiveMatchRules(matchId);
    if (!effective.base.regulationVersion || !effective.base.rules) throw new AppError(409, "Trận chưa có căn cứ điều lệ chính thức.", "MATCH_RULES_SOURCE_MISSING");
    return validateDisciplinePolicy({ ...effective.base.rules, publishedVersion: effective.base.regulationVersion } as unknown as TournamentDisciplinePolicy);
  }
  if (!config.internalApiKey) {
    throw new AppError(503, "Tournament policy access is not configured", "SERVICE_MISCONFIGURED");
  }
  let response: Response;
  try {
    const endpoint = new URL(
      `/internal/tournaments/${encodeURIComponent(tournamentId)}/discipline-policy`,
      config.tournamentServiceUrl,
    );
    response = await fetch(endpoint, {
      headers: { "x-gateway-internal-key": config.internalApiKey },
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new AppError(503, "Tournament policy service is unavailable", "UPSTREAM_UNAVAILABLE");
  }
  if (!response.ok) {
    throw new AppError(502, "Tournament rules could not be verified", "UPSTREAM_ERROR");
  }
  const body = await response.json() as { policy?: TournamentDisciplinePolicy };
  return validateDisciplinePolicy(body.policy);
}

function validateDisciplinePolicy(policy: TournamentDisciplinePolicy | undefined): TournamentDisciplinePolicy {
  if (!policy || !Number.isFinite(policy.complaintWindowHours) || policy.complaintWindowHours < 0
    || !["ORGANIZER_DECISION", "WALKOVER", "NO_AUTOMATIC_RESULT"].includes(policy.forfeitPolicy)
    || !Number.isInteger(policy.forfeitWinnerScore) || policy.forfeitWinnerScore < 0
    || !Number.isInteger(policy.forfeitLoserScore) || policy.forfeitLoserScore < 0) {
    throw new AppError(502, "Tournament returned an invalid discipline policy", "INVALID_UPSTREAM_POLICY");
  }
  if (!Number.isInteger(policy.yellowCardsForSuspension) || policy.yellowCardsForSuspension < 0
    || !Number.isInteger(policy.suspensionMatches) || policy.suspensionMatches < 1) {
    throw new AppError(502, "Tournament returned an invalid suspension policy", "INVALID_UPSTREAM_POLICY");
  }
  return policy;
}

export function complaintDeadlineExceeded(
  finalizedAt: string,
  complaintWindowHours: number,
  now = Date.now(),
): boolean {
  const finalizedTime = Date.parse(finalizedAt);
  if (!Number.isFinite(finalizedTime) || !Number.isFinite(complaintWindowHours) || complaintWindowHours < 0) {
    throw new AppError(500, "Cannot validate complaint deadline from invalid tournament data", "INVALID_COMPLAINT_DEADLINE");
  }
  return now > finalizedTime + complaintWindowHours * 60 * 60 * 1000;
}
