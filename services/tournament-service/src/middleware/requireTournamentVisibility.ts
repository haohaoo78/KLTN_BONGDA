import type { NextFunction, Response } from "express";
import { AppError } from "../lib/errors";
import { getPool } from "../lib/db";
import type { AuthenticatedRequest } from "./gatewayUser";

export function requireTournamentVisibility(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
): void {
  void (async () => {
    const tournamentId = req.params.tournamentId;
    if (!tournamentId) {
      throw new AppError(404, "Tournament not found", "TOURNAMENT_NOT_FOUND");
    }
    const result = await getPool().query<{ status: string; created_by: string }>(
      "SELECT status, created_by FROM tournaments WHERE id = $1",
      [tournamentId],
    );
    const tournament = result.rows[0];
    if (!tournament) {
      throw new AppError(404, "Tournament not found", "TOURNAMENT_NOT_FOUND");
    }
    const roles = req.userRoles ?? [];
    const canSeeDraft = !roles.includes("ADMIN") &&
      roles.includes("BTC") &&
      req.userId === tournament.created_by;
    if (tournament.status === "DRAFT" && !canSeeDraft) {
      throw new AppError(404, "Tournament not found", "TOURNAMENT_NOT_FOUND");
    }
    next();
  })().catch(next);
}
