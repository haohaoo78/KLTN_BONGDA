import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../middleware/gatewayUser";
import { assertCanManageMatch, assertCanManageTournament } from "../scheduling/authorization";
import { getMatchOperationReadiness, getTournamentOperationReadiness } from "../services/matchOperationReadinessService";

export const matchOperationReadinessController = {
  async internal(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try { res.json({ readiness: await getTournamentOperationReadiness(req.params.tournamentId) }); } catch (e) { next(e); }
  },
  async tournament(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try { await assertCanManageTournament(req, req.params.tournamentId); res.json({ readiness: await getTournamentOperationReadiness(req.params.tournamentId) }); } catch (e) { next(e); }
  },
  async match(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try { await assertCanManageMatch(req, req.params.matchId, "READ"); res.json({ readiness: await getMatchOperationReadiness(req.params.matchId) }); } catch (e) { next(e); }
  },
};
