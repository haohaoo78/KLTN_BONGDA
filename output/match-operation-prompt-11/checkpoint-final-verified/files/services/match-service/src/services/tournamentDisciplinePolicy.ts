import { config } from "../config";
import { AppError } from "../lib/errors";

export interface TournamentDisciplinePolicy {
  complaintWindowHours: number | null;
  forfeitPolicy: "ORGANIZER_DECISION" | "WALKOVER" | "NO_AUTOMATIC_RESULT" | null;
  forfeitWinnerScore: number | null;
  forfeitLoserScore: number | null;
  yellowCardsForSuspension: number | null;
  suspensionMatches: number | null;
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
  if(!policy)throw new AppError(502,"Tournament policy is missing","INVALID_UPSTREAM_POLICY");
  const normalized={...policy,complaintWindowHours:policy.complaintWindowHours??null,forfeitPolicy:policy.forfeitPolicy??null,forfeitWinnerScore:policy.forfeitWinnerScore??null,forfeitLoserScore:policy.forfeitLoserScore??null,yellowCardsForSuspension:policy.yellowCardsForSuspension??null,suspensionMatches:policy.suspensionMatches??null};
  if(normalized.complaintWindowHours!==null&&(!Number.isFinite(normalized.complaintWindowHours)||normalized.complaintWindowHours<0))throw new AppError(502,"Complaint window is invalid","INVALID_UPSTREAM_POLICY");
  if(normalized.forfeitPolicy!==null&&!["ORGANIZER_DECISION","WALKOVER","NO_AUTOMATIC_RESULT"].includes(normalized.forfeitPolicy))throw new AppError(502,"Forfeit policy is invalid","INVALID_UPSTREAM_POLICY");
  for(const [value,label] of [[normalized.forfeitWinnerScore,"winner score"],[normalized.forfeitLoserScore,"loser score"],[normalized.yellowCardsForSuspension,"yellow threshold"],[normalized.suspensionMatches,"suspension matches"]] as const)if(value!==null&&(!Number.isInteger(value)||value<0))throw new AppError(502,"Tournament "+label+" is invalid","INVALID_UPSTREAM_POLICY");
  return normalized;
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
