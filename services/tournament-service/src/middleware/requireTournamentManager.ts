import type { NextFunction, Response } from "express";
import { AppError } from "../lib/errors";
import type { AuthenticatedRequest } from "./gatewayUser";
import { hasTournamentAssignment } from "../repositories/organizerRepository";
import { getPool } from "../lib/db";

async function getTournamentId(req: AuthenticatedRequest): Promise<string | undefined> {
  const path = req.originalUrl.split("?")[0] ?? req.path;
  const candidate =
    req.params.tournamentId ??
    req.params.id ??
    req.body?.tournamentId ??
    req.query.tournamentId;
  if (typeof candidate === "string" && candidate) {
    if (path.startsWith("/registration-periods/")) {
      const result = await getPool().query<{ tournament_id: string }>(
        "SELECT tournament_id FROM registration_periods WHERE id = $1",
        [candidate],
      );
      return result.rows[0]?.tournament_id;
    }
    if (path.startsWith("/regulations/")) {
      const result = await getPool().query<{ tournament_id: string }>(
        "SELECT tournament_id FROM regulations WHERE id = $1",
        [candidate],
      );
      return result.rows[0]?.tournament_id;
    }
    if (path.startsWith("/groups/")) {
      const result = await getPool().query<{ tournament_id: string }>(
        "SELECT tournament_id FROM groups WHERE id = $1",
        [candidate],
      );
      return result.rows[0]?.tournament_id;
    }
    if (path.startsWith("/draws/")) {
      const result = await getPool().query<{ tournament_id: string }>(
        "SELECT tournament_id FROM draws WHERE id = $1",
        [candidate],
      );
      return result.rows[0]?.tournament_id;
    }
    if (path.startsWith("/regulation-versions/")) {
      const result = await getPool().query<{ tournament_id: string }>(
        "SELECT tournament_id FROM regulation_versions WHERE id = $1",
        [candidate],
      );
      return result.rows[0]?.tournament_id;
    }
    if (path.startsWith("/draws") && !path.includes("/draws/")) {
      if (req.body?.tournamentId && typeof req.body.tournamentId === "string") {
        return req.body.tournamentId;
      }
      if (req.query?.tournamentId && typeof req.query.tournamentId === "string") {
        return req.query.tournamentId;
      }
    }
    if (path.startsWith("/groups") && !path.includes("/groups/")) {
      if (req.body?.tournamentId && typeof req.body.tournamentId === "string") {
        return req.body.tournamentId;
      }
      if (req.query?.tournamentId && typeof req.query.tournamentId === "string") {
        return req.query.tournamentId;
      }
    }
    return candidate;
  }
  return undefined;
}

export function requireTournamentManager(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
): void {
  void (async () => {
    const roles = req.userRoles ?? [];
    if (!roles.includes("BTC") || !req.userId) {
      throw new AppError(403, "Insufficient permissions", "FORBIDDEN");
    }

    const tournamentId = await getTournamentId(req);
    if (!tournamentId) {
      console.warn(
        `[tournament-service] missing tournament scope for ${req.method} ${req.originalUrl}`,
      );
      throw new AppError(403, "A tournament scope could not be determined for this operation", "TOURNAMENT_SCOPE_REQUIRED");
    }
    if (!(await hasTournamentAssignment(tournamentId, req.userId))) {
      throw new AppError(403, "You are not assigned to manage this tournament", "FORBIDDEN");
    }
    const tournament = await getPool().query<{ status: string; created_by: string }>(
      "SELECT status, created_by FROM tournaments WHERE id = $1",
      [tournamentId],
    );
    if (!tournament.rowCount) {
      throw new AppError(404, "Tournament not found", "TOURNAMENT_NOT_FOUND");
    }
    if (tournament.rows[0].status === "DRAFT" && tournament.rows[0].created_by !== req.userId) {
      throw new AppError(404, "Tournament not found", "TOURNAMENT_NOT_FOUND");
    }
    next();
  })().catch(next);
}
