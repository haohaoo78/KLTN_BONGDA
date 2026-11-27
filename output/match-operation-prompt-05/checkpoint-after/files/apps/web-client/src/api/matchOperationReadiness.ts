import { apiFetch } from "./client";
import type { TournamentOperationReadiness } from "@sfl/shared";
export const getTournamentOperationReadiness = (tournamentId: string) => apiFetch<{ readiness: TournamentOperationReadiness }>(`/tournaments/${encodeURIComponent(tournamentId)}/fixtures/operation-readiness`);
