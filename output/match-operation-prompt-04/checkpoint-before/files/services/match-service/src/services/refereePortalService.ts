import { config } from "../config";
import { AppError } from "../lib/errors";
import type { AuthenticatedRequest } from "../middleware/gatewayUser";
import { getMatch } from "./matchService";
import { getPublishedDraw } from "./fixtureGenerationService";
import { findMatchResultByMatchId, listKnockoutBracket, listManagedTournamentFixtures } from "../repositories/matchRepository";
import { findMatchReportByMatchId, listLineups, listMatchEvents } from "../repositories/lineupRepository";
import { getMatchClock } from "../repositories/matchClockRepository";
import { configuredCrewHasCapability, type CrewCapability } from "../scheduling/crewValidation";
import { configuredPositionsForMatch } from "../scheduling/repositories/refereeConfigurationRepository";
import { refereeDeliveryViews, publishedRefereePositions } from "../scheduling/repositories/refereePublicationRepository";
import { findVenueById, getTournamentScheduleResources, listScheduleRefereeAssignments, listSchedulesByReferee } from "../scheduling/repositories/schedulingRepository";
import { getTournamentScheduleSettings } from "../scheduling/services/schedulingService";
import { parseRefereeRequestId } from "../scheduling/services/refereeTeamValidation";
import type { Schedule } from "../scheduling/models/scheduling";
import { getEffectiveMatchRules } from "./matchOperationRulesService";
import { assertOperationActor, getMatchOperationReadiness } from "./matchOperationReadinessService";
import { readOperationSchedule } from "../scheduling/repositories/matchOperationReadinessRepository";

type TeamDetail = { team: { id: string; name: string; logoUrl: string | null }; players: Array<{ id: string; fullName: string | null }> };
async function teamDetail(id: string): Promise<TeamDetail> {
  let response: Response;
  try {
    response = await fetch(new URL(`/public/teams/${encodeURIComponent(id)}`, config.organizationServiceUrl), {
      headers: { "x-gateway-internal-key": config.internalApiKey }, signal: AbortSignal.timeout(8000),
    });
  } catch { throw new AppError(503, "Không thể tải thông tin đội bóng.", "REFEREE_TEAMS_UNAVAILABLE"); }
  if (!response.ok) throw new AppError(502, "Không thể tải thông tin đội bóng chính thức.", "REFEREE_TEAMS_UNAVAILABLE");
  const body = await response.json() as TeamDetail;
  if (body.team?.id !== id || !body.team.name || !Array.isArray(body.players)) throw new AppError(502, "Thông tin đội bóng không hợp lệ.", "REFEREE_TEAMS_INVALID");
  return body;
}

function identity(actor: AuthenticatedRequest): string {
  if (!actor.userId) throw new AppError(401, "Vui lòng đăng nhập lại.", "UNAUTHENTICATED");
  if (!actor.userRoles?.includes("REFEREE")) throw new AppError(403, "Chức năng này dành cho trọng tài.", "FORBIDDEN");
  return actor.userId;
}

/** Read projection only. Published position snapshots are business history, not test data. */
async function rows(actor: AuthenticatedRequest, schedules: Schedule[]) {
  const userId = identity(actor);
  const tournamentIds = [...new Set(schedules.map((schedule) => schedule.tournamentId))];
  const tournaments = new Map(await Promise.all(tournamentIds.map(async (id) => {
    const [tournament, draw, bracket, resources, deliveries, fixtures] = await Promise.all([
      getTournamentScheduleSettings(id),
      getPublishedDraw(id).catch((error: unknown) => { if (error instanceof AppError && error.code === "PUBLISHED_DRAW_REQUIRED") return null; throw error; }),
      listKnockoutBracket(id), getTournamentScheduleResources(id), refereeDeliveryViews(id), listManagedTournamentFixtures(id),
    ]);
    const fixtureMatches = new Map(fixtures.stages.filter((stage) => stage.status === "PUBLISHED")
      .flatMap((stage) => stage.matches.map((match) => [match.id, match] as const)));
    return [id, { tournament, draw, bracket, resources, deliveries, fixtureMatches }] as const;
  })));
  const matches = await Promise.all(schedules.map((schedule) => getMatch(schedule.matchId)));
  const teamIds = [...new Set(matches.flatMap((match) => [match.homeTeamId, match.awayTeamId]).filter((id): id is string => Boolean(id)))];
  const teams = new Map(await Promise.all(teamIds.map(async (id) => [id, await teamDetail(id)] as const)));
  return Promise.all(schedules.map(async (schedule, index) => {
    const loaded = tournaments.get(schedule.tournamentId)!;
    // The legacy match lookup omits fixture metadata. Use the existing official
    // fixture projection for stage/group/round; never infer structure from text.
    const match = loaded.fixtureMatches.get(schedule.matchId) ?? matches[index];
    const [positions, crew, venue, result, report] = await Promise.all([
      publishedRefereePositions(match.id).then((published) => published ?? configuredPositionsForMatch(match.tournamentId, match.id)),
      listScheduleRefereeAssignments(schedule.id), findVenueById(schedule.venueId), findMatchResultByMatchId(match.id), findMatchReportByMatchId(match.id),
    ]);
    const assignment = crew.find((item) => item.refereeId === userId);
    // Preserve existing legacy assignment behavior. Final authority is never inferred from a user role.
    const position = assignment?.position ?? "REFEREE";
    const isFinalAuthority = assignment?.isFinalAuthority === true;
    const capabilities = (["READ", "RECORD_EVENT", "EDIT_EVENT", "MANAGE_REPORT", "FINALIZE"] as CrewCapability[])
      .filter((capability) => configuredCrewHasCapability(position, isFinalAuthority, capability, positions));
    const group = loaded.draw?.groups.find((item) => item.id === match.groupId);
    const slot = loaded.bracket.find((item) => item.matchId === match.id);
    const side = (teamId: string | null, home: boolean) => {
      if (teamId) {
        const detail = teams.get(teamId)!;
        return { id: teamId, name: detail.team.name, logoUrl: detail.team.logoUrl };
      }
      const qualification = home ? slot?.homeQualification : slot?.awayQualification;
      const sourceId = home ? slot?.homeSourceSlotId : slot?.awaySourceSlotId;
      const source = loaded.bracket.find((item) => item.id === sourceId);
      const sourceGroup = loaded.draw?.groups.find((item) => item.id === qualification?.groupId);
      const outcome = (home ? slot?.homeSourceOutcome : slot?.awaySourceOutcome) === "LOSER" ? "Thua" : "Thắng";
      return { id: null, logoUrl: null, name: qualification ? `${qualification.groupRank === 1 ? "Nhất" : qualification.groupRank === 2 ? "Nhì" : `Hạng ${qualification.groupRank}`} ${sourceGroup?.name ?? "bảng đấu"}`
        : source ? `${outcome} trận ${source.roundNumber}.${source.position}` : "Chờ xác định đội" };
    };
    const resourceVenues = loaded.resources?.resources.venues as Array<{ id: string; name: string; location?: string }> | undefined;
    const resourceVenue = resourceVenues?.find((item) => item.id === schedule.venueId);
    const ownPosition = positions?.find((item) => item.code === position);
    const crewView = crew.map((item) => ({ refereeId: item.refereeId, position: item.position,
      label: positions?.find((p) => p.code === item.position)?.label ?? "Trọng tài", isFinalAuthority: item.isFinalAuthority, isMe: item.refereeId === userId,
      fullName: [...loaded.deliveries].reverse().find((delivery) => delivery.refereeId === item.refereeId && delivery.scheduleId === schedule.id)?.fullName ?? "Chưa cập nhật tên trọng tài" }));
    const home = side(match.homeTeamId, true), away = side(match.awayTeamId, false);
    const regulation = loaded.draw?.config?.fixtureRegulationSnapshot;
    const rules = regulation?.rules ?? loaded.tournament.rules ?? null;
    const roundLabel = match.round ?? (match.roundNumber ? `Vòng ${match.roundNumber}` : "Chưa cập nhật vòng đấu");
    return { match, schedule, home, away,
      tournament: { id: loaded.tournament.id, name: loaded.tournament.name, footballFormat: loaded.tournament.footballFormat, competitionFormat: regulation?.competitionFormat ?? loaded.tournament.competitionFormat },
      roundLabel, groupName: group?.name ?? null,
      venueName: resourceVenue?.name ?? venue?.name ?? "Chưa cập nhật sân", venueLocation: resourceVenue?.location ?? venue?.location ?? loaded.tournament.location,
      assignment: { position, label: ownPosition?.label ?? "Trọng tài", isFinalAuthority, capabilities }, crew: crewView, result, report,
      rules: rules ? { ...rules, publishedVersion: regulation?.regulationVersion ?? rules.publishedVersion } : null,
      playerNames: Object.fromEntries([home.id, away.id].flatMap((id) => id ? teams.get(id)!.players.map((player) => [player.id, player.fullName ?? "Chưa cập nhật tên cầu thủ"]) : [])),
    };
  }));
}

export async function getRefereePortalAssignments(actor: AuthenticatedRequest) {
  const userId = identity(actor);
  const items = await rows(actor, await listSchedulesByReferee(userId));
  return { items: items.map(({ rules: _rules, playerNames: _players, crew: _crew, ...item }) => item) };
}

export async function getRefereeMatchContext(actor: AuthenticatedRequest, matchId: string) {
  const userId = identity(actor);
  parseRefereeRequestId(matchId);
  // Always require the referee's own active assignment, even for a multi-role BTC account.
  const schedules = (await listSchedulesByReferee(userId)).filter((schedule) => schedule.matchId === matchId);
  if (!schedules.length) throw new AppError(403, "Bạn không được phân công điều hành trận đấu này.", "REFEREE_MATCH_FORBIDDEN");
  const operationSchedule = await readOperationSchedule(matchId);
  if (operationSchedule?.publication) await assertOperationActor(operationSchedule, userId, "READ");
  const [item] = await rows(actor, schedules);
  if (!item.assignment.capabilities.includes("READ")) throw new AppError(403, "Vị trí được phân công không còn quyền truy cập trận.", "REFEREE_MATCH_FORBIDDEN");
  const [clock, lineups, events, operationRules, readiness] = await Promise.all([getMatchClock(matchId), listLineups(matchId), listMatchEvents(matchId), getEffectiveMatchRules(matchId), getMatchOperationReadiness(matchId)]);
  return { ...item, clock, operationRules, readiness,
    rules: operationRules.base.rules ? { ...operationRules.base.rules, publishedVersion: operationRules.base.regulationVersion } : null,
    lineups: lineups.map((lineup) => ({ ...lineup, fullName: item.playerNames[lineup.playerId] ?? "Chưa cập nhật tên cầu thủ" })),
    events: events.map((event) => ({ ...event, playerName: event.playerId ? item.playerNames[event.playerId] ?? "Chưa cập nhật tên cầu thủ" : null })),
  };
}
