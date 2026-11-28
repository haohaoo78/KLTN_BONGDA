import { AppError } from "../lib/errors";
import { config } from "../config";
import { getDrawManagement } from "./drawWorkflowService";
import { getTournament } from "./tournamentService";
import { deleteDrawTestSnapshot, getDrawTestSnapshot, saveDrawTestSnapshot } from "../repositories/drawTestSnapshotRepository";

function ensureTestEnvironment(): void {
  if (config.nodeEnv === "production" || (config.nodeEnv !== "development" && config.nodeEnv !== "test")) {
    throw new AppError(404, "Not found", "NOT_FOUND");
  }
}

async function ensureTestTournament(tournamentId: string): Promise<void> {
  ensureTestEnvironment();
  const tournament = await getTournament(tournamentId);
  if (!["ROSTER_LOCKED", "PREPARING", "IN_PROGRESS", "PAUSED"].includes(tournament.status)) {
    throw new AppError(404, "Test workflow storage is not available", "NOT_FOUND");
  }
}

function readTeamIds(state: Record<string, unknown>): string[] {
  const ids: string[] = [];
  const config = state.configuration;
  const publication = state.publication;
  for (const candidate of [config, publication]) {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      const teamIds = (candidate as Record<string, unknown>).teamIds;
      if (Array.isArray(teamIds)) ids.push(...teamIds.filter((id): id is string => typeof id === "string"));
    }
  }
  return ids;
}

function validateState(tournamentId: string, value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError(400, "Test workflow state must be an object", "INVALID_TEST_WORKFLOW_STATE");
  }
  const state = value as Record<string, unknown>;
  if (state.tournamentId !== tournamentId || state.version !== 1) {
    throw new AppError(400, "Test state version or tournament scope is invalid", "INVALID_TEST_WORKFLOW_STATE");
  }
  const serialized = JSON.stringify(state);
  if (Buffer.byteLength(serialized, "utf8") > 2_000_000) {
    throw new AppError(413, "Test workflow state exceeds the 2 MB limit", "TEST_WORKFLOW_STATE_TOO_LARGE");
  }
  if (Array.isArray(state.fixtures) && state.fixtures.length > 512) {
    throw new AppError(413, "Too many test fixtures", "TEST_WORKFLOW_STATE_TOO_LARGE");
  }
  return state;
}

async function assertOfficialTeams(tournamentId: string, state: Record<string, unknown>): Promise<void> {
  const ids = readTeamIds(state);
  if (!ids.length) return;
  const management = await getDrawManagement(tournamentId);
  const eligible = new Set(management.eligibleTeams.map((team) => team.teamId));
  if (ids.some((id) => !eligible.has(id))) {
    throw new AppError(409, "Test allocation may only refer to teams eligible in the actual tournament", "TEST_TEAM_NOT_ELIGIBLE");
  }
}

export async function loadDrawTestSnapshot(tournamentId: string) {
  await ensureTestTournament(tournamentId);
  return (await getDrawTestSnapshot(tournamentId)) ?? { state: null, revision: 0, updatedAt: null };
}

export async function storeDrawTestSnapshot(tournamentId: string, value: unknown, userId: string, expectedRevision: unknown) {
  await ensureTestTournament(tournamentId);
  const state = validateState(tournamentId, value);
  await assertOfficialTeams(tournamentId, state);
  const revision = expectedRevision === null ? null : Number(expectedRevision);
  if (revision !== null && (!Number.isSafeInteger(revision) || revision < 1)) {
    throw new AppError(400, "Expected revision is invalid", "INVALID_TEST_WORKFLOW_REVISION");
  }
  const saved = await saveDrawTestSnapshot(tournamentId, state, userId, revision);
  if (!saved) throw new AppError(409, "Test state changed in another tab. Reload the latest snapshot before saving.", "TEST_WORKFLOW_REVISION_CONFLICT");
  return saved;
}

export async function removeDrawTestSnapshot(tournamentId: string) {
  await ensureTestTournament(tournamentId);
  await deleteDrawTestSnapshot(tournamentId);
  return { reset: true };
}

export async function loadPublicDrawTestSnapshot(tournamentId: string) {
  await ensureTestTournament(tournamentId);
  const saved = await getDrawTestSnapshot(tournamentId);
  const state = saved?.state;
  if (!state) return { state: null, revision: 0, updatedAt: null };
  const directSession = state.directSession && typeof state.directSession === "object"
    ? state.directSession as Record<string, unknown>
    : null;
  const directStatus = directSession?.status;
  const publicCeremony = directSession && ["SCHEDULED", "POSTPONED", "LIVE", "PAUSED", "COMPLETED", "CANCELLED"].includes(String(directStatus))
    ? directSession
    : null;
  // Public/test viewers receive only published draw and fixture content. Drafts,
  // direct-session controls and workflow internals are intentionally omitted.
  return {
    revision: saved.revision,
    updatedAt: saved.updatedAt,
    state: {
      version: 1,
      tournamentId,
      publication: state.publication ?? null,
      fixtures: state.fixturesPublishedAt ? state.fixtures ?? [] : [],
      fixturesPublishedAt: state.fixturesPublishedAt ?? null,
      directSession: publicCeremony ? {
        status: publicCeremony.status,
        eventName: publicCeremony.eventName,
        scheduledAt: publicCeremony.scheduledAt,
        timeZone: publicCeremony.timeZone,
        announcement: publicCeremony.announcement,
        location: publicCeremony.location,
        format: publicCeremony.format,
        teamIds: publicCeremony.teamIds,
        teamsPerGroup: publicCeremony.teamsPerGroup,
        qualifiersPerGroup: publicCeremony.qualifiersPerGroup,
        extraQualificationSlots: publicCeremony.extraQualificationSlots,
        totalPicks: publicCeremony.totalPicks,
        revealedCount: publicCeremony.revealedCount,
        slots: publicCeremony.slots,
        history: publicCeremony.history,
      } : null,
      completedSteps: { step3: Boolean((state.completedSteps as { step3?: unknown } | undefined)?.step3), step4: Boolean((state.completedSteps as { step4?: unknown } | undefined)?.step4) },
    },
  };
}

export async function loadInternalPublishedDrawTestSnapshot(tournamentId: string) {
  await ensureTestTournament(tournamentId);
  const tournament = await getTournament(tournamentId);
  const saved = await getDrawTestSnapshot(tournamentId);
  const state = saved?.state;
  const completed = state?.completedSteps as { step3?: unknown; step4?: unknown } | undefined;
  if (!state?.publication || !state.fixturesPublishedAt || completed?.step4 !== true || !Array.isArray(state.fixtures)) {
    throw new AppError(409, "A published test draw and fixture diagram are required before scheduling", "TEST_DRAW_NOT_PUBLISHED");
  }
  const fixtures = state.fixtures as Array<Record<string, unknown>>;
  const officialTeamIds = [...new Set(fixtures.flatMap((fixture) => [fixture.homeTeamId, fixture.awayTeamId]).filter((id): id is string => typeof id === "string"))];
  const diagramVersion = JSON.stringify({
    publishedAt: state.fixturesPublishedAt,
    allocation: state.publication,
    fixtures: fixtures.map((fixture) => [fixture.id, fixture.stage, fixture.groupName, fixture.round, fixture.leg, fixture.homeTeamId, fixture.awayTeamId, fixture.homeSource, fixture.awaySource, fixture.bye]),
  });
  return {
    diagramVersion,
    publication: state.publication,
    fixtures: state.fixtures,
    revision: saved?.revision ?? 0,
    tournamentContext: {
      tournamentId: tournament.id,
      name: tournament.name,
      status: tournament.status,
      startDate: tournament.startDate,
      endDate: tournament.endDate,
      location: tournament.location,
      footballFormat: tournament.footballFormat,
      competitionFormat: tournament.competitionFormat,
      teamCount: officialTeamIds.length,
      regulationVersion: tournament.rules?.publishedVersion ?? null,
      rules: tournament.rules ?? null,
    },
  };
}
