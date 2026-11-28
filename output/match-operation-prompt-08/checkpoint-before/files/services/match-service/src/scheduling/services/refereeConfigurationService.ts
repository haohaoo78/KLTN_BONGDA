import { AppError } from "../../lib/errors";
import { assertCanManageTournament } from "../authorization";
import type { AuthenticatedRequest } from "../middleware/gatewayUser";
import { findRefereeConfiguration, saveRefereeConfiguration } from "../repositories/refereeConfigurationRepository";
import { effectiveRefereePositions, parseRefereeConfiguration, validateRefereeScopes } from "./refereeConfigurationValidation";
import { parseRefereeRequestId } from "./refereeTeamValidation";
import { getOfficialScheduleContext, getTournamentScheduleSettings } from "./schedulingService";

async function access(actor: AuthenticatedRequest, tournamentId: string) {
  parseRefereeRequestId(tournamentId);
  await assertCanManageTournament(actor, tournamentId);
  const tournament = await getTournamentScheduleSettings(tournamentId);
  let context: Awaited<ReturnType<typeof getOfficialScheduleContext>> | null = null;
  try { context = await getOfficialScheduleContext(tournamentId); }
  catch (error) { if (!(error instanceof AppError) || !["PUBLISHED_DRAW_REQUIRED", "PUBLISHED_FIXTURES_REQUIRED"].includes(error.code)) throw error; }
  const readOnlyReason = ["COMPLETED", "CANCELLED"].includes(tournament.status) ? "Giải đấu đã kết thúc hoặc đã hủy; cấu hình chỉ được xem."
    : !context?.schedulePublishedAt ? "Cần công bố đầy đủ lịch thi đấu ở Bước 5 trước khi lưu cấu hình trọng tài." : null;
  return { context, readOnlyReason };
}

function view(tournamentId: string, authorization: Awaited<ReturnType<typeof access>>, saved: Awaited<ReturnType<typeof findRefereeConfiguration>>) {
  const fixtures = (authorization.context?.fixtures ?? []).filter((fixture) => !fixture.bye).map((fixture, index) => ({
    id: fixture.id, label: `Trận ${index + 1} · ${fixture.round}${fixture.groupName ? ` · ${fixture.groupName}` : ""}`,
    stage: fixture.stage, roundNumber: fixture.roundNumber ?? null,
  }));
  return { tournamentId, readOnly: Boolean(authorization.readOnlyReason), readOnlyReason: authorization.readOnlyReason,
    configuration: saved?.configuration ?? null, revision: saved?.revision ?? 0, updatedAt: saved?.updatedAt ?? null, fixtures,
    effective: saved ? fixtures.map((fixture) => ({ matchId: fixture.id, ...effectiveRefereePositions(saved.configuration, fixture) })) : [] };
}

export async function getTournamentRefereeConfiguration(actor: AuthenticatedRequest, tournamentId: string) {
  const authorization = await access(actor, tournamentId);
  return view(tournamentId, authorization, await findRefereeConfiguration(tournamentId));
}

export async function putTournamentRefereeConfiguration(actor: AuthenticatedRequest, tournamentId: string, value: unknown) {
  const authorization = await access(actor, tournamentId);
  if (authorization.readOnlyReason) throw new AppError(409, authorization.readOnlyReason, "REFEREE_CONFIG_READ_ONLY");
  const { configuration, expectedRevision } = parseRefereeConfiguration(value);
  validateRefereeScopes(configuration, authorization.context!.fixtures.filter((fixture) => !fixture.bye));
  const saved = await saveRefereeConfiguration(tournamentId, configuration, expectedRevision, actor.userId!, async () => {
    const latest = await access(actor, tournamentId);
    if (latest.readOnlyReason) throw new AppError(409, latest.readOnlyReason, "REFEREE_CONFIG_READ_ONLY");
    validateRefereeScopes(configuration, latest.context!.fixtures.filter((fixture) => !fixture.bye));
  });
  return view(tournamentId, authorization, saved);
}
