import { AppError } from "../lib/errors";
import { config } from "../config";
import { generateGroupFixtures } from "../repositories/matchRepository";
import type { FixtureGenerationResult, GeneratedFixtureInput } from "../models/match";

type PublishedDraw = {
  id: string;
  tournamentId: string;
  status: string;
  groups: Array<{
    id: string;
    name: string;
    assignments: Array<{ teamId: string }>;
  }>;
};

type TournamentDetails = {
  id: string;
  status: string;
  competitionFormat: "ROUND_ROBIN" | "GROUP_AND_KNOCKOUT" | "KNOCKOUT";
};

async function getPublishedDraw(tournamentId: string): Promise<PublishedDraw> {
  if (!config.internalApiKey) {
    throw new AppError(503, "Tournament integration is not configured", "SERVICE_MISCONFIGURED");
  }
  const endpoint = new URL(
    `/internal/tournaments/${encodeURIComponent(tournamentId)}/published-draw`,
    config.tournamentServiceUrl,
  ).toString();
  let response: Response;
  try {
    response = await fetch(endpoint, {
      headers: { "x-gateway-internal-key": config.internalApiKey },
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new AppError(503, "Tournament service is unavailable", "UPSTREAM_UNAVAILABLE");
  }
  if (response.status === 404) {
    throw new AppError(409, "Chỉ có thể tạo lịch từ phương án chia bảng đã công bố", "PUBLISHED_DRAW_REQUIRED");
  }
  if (!response.ok) {
    throw new AppError(502, "Could not load the published draw", "UPSTREAM_ERROR");
  }
  const body = await response.json() as { draw?: PublishedDraw };
  if (!body.draw || body.draw.tournamentId !== tournamentId || body.draw.status !== "PUBLISHED") {
    throw new AppError(502, "Tournament service returned an invalid published draw", "UPSTREAM_ERROR");
  }
  return body.draw;
}

async function getTournamentDetails(tournamentId: string): Promise<TournamentDetails> {
  const endpoint = new URL(
    `/tournaments/${encodeURIComponent(tournamentId)}`,
    config.tournamentServiceUrl,
  ).toString();
  let response: Response;
  try {
    response = await fetch(endpoint, { signal: AbortSignal.timeout(5_000) });
  } catch {
    throw new AppError(503, "Tournament service is unavailable", "UPSTREAM_UNAVAILABLE");
  }
  if (!response.ok) {
    throw new AppError(502, "Could not load tournament configuration", "UPSTREAM_ERROR");
  }
  const body = await response.json() as { tournament?: TournamentDetails };
  if (!body.tournament || body.tournament.id !== tournamentId) {
    throw new AppError(502, "Tournament service returned invalid configuration", "UPSTREAM_ERROR");
  }
  return body.tournament;
}

function createRoundRobinFixtures(
  draw: PublishedDraw,
  legs: 1 | 2,
): GeneratedFixtureInput[] {
  const fixtures: GeneratedFixtureInput[] = [];
  for (const group of draw.groups) {
    const teamIds = group.assignments.map((assignment) => assignment.teamId);
    if (teamIds.length < 2) {
      throw new AppError(409, `${group.name} phải có ít nhất hai đội`, "INVALID_DRAW_GROUP");
    }
    const rotation: Array<string | null> = [...teamIds];
    if (rotation.length % 2 !== 0) rotation.push(null);
    const singleLegRoundCount = rotation.length - 1;
    const gamesPerRound = rotation.length / 2;
    let current = rotation;

    for (let leg = 1; leg <= legs; leg += 1) {
      for (let roundIndex = 0; roundIndex < singleLegRoundCount; roundIndex += 1) {
        for (let pairIndex = 0; pairIndex < gamesPerRound; pairIndex += 1) {
          const first = current[pairIndex];
          const second = current[current.length - 1 - pairIndex];
          if (!first || !second) continue;
          const homeTeamId = (roundIndex + leg) % 2 === 0 ? first : second;
          const awayTeamId = homeTeamId === first ? second : first;
          fixtures.push({
            tournamentId: draw.tournamentId,
            drawVersionId: draw.id,
            groupId: group.id,
            groupName: group.name,
            roundNumber: roundIndex + 1 + (leg - 1) * singleLegRoundCount,
            leg,
            round: `${group.name} · Lượt ${leg} · Vòng ${roundIndex + 1}`,
            homeTeamId,
            awayTeamId,
          });
        }
        const fixed = current[0];
        const rotating = current.slice(1);
        rotating.unshift(rotating.pop() ?? null);
        current = [fixed, ...rotating];
      }
      current = rotation;
    }
  }
  return fixtures;
}

export async function generateTournamentFixtures(
  tournamentId: string,
  legs: 1 | 2,
  generatedBy: string,
): Promise<FixtureGenerationResult & { knockoutStagePending: boolean }> {
  const tournament = await getTournamentDetails(tournamentId);
  if (!["PREPARING", "IN_PROGRESS"].includes(tournament.status)) {
    throw new AppError(409, "Giải phải ở trạng thái chuẩn bị hoặc đang diễn ra để tạo lịch", "FIXTURE_STAGE_NOT_READY");
  }
  if (tournament.competitionFormat === "KNOCKOUT") {
    throw new AppError(
      409,
      "Chưa thể tạo trận knock-out tự động: các nhánh cần hỗ trợ đội thắng từ trận trước, không thể gán đội giả định",
      "KNOCKOUT_FIXTURES_UNSUPPORTED",
    );
  }
  const draw = await getPublishedDraw(tournamentId);
  const allTeamIds = draw.groups.flatMap((group) => group.assignments.map((assignment) => assignment.teamId));
  if (new Set(allTeamIds).size !== allTeamIds.length) {
    throw new AppError(409, "Một đội xuất hiện ở nhiều bảng trong bản chia đã công bố", "INVALID_PUBLISHED_DRAW");
  }
  const fixtures = createRoundRobinFixtures(draw, legs);
  if (fixtures.length > 992) {
    throw new AppError(409, "Số trận vượt giới hạn tạo lịch tự động", "TOO_MANY_FIXTURES");
  }
  const result = await generateGroupFixtures(
    tournamentId,
    draw.id,
    legs,
    fixtures,
    generatedBy,
  );
  return {
    ...result,
    knockoutStagePending: tournament.competitionFormat === "GROUP_AND_KNOCKOUT",
  };
}
