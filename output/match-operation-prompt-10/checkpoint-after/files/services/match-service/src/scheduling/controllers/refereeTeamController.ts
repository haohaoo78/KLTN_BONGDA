import type { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "../middleware/gatewayUser";
import { createTournamentRefereeMember, getTournamentRefereeTeam, lookupTournamentRefereeAccount, patchTournamentRefereeMember, resendTournamentRefereeAccess } from "../services/refereeTeamService";

export const refereeTeamController = {
  async list(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try { res.json(await getTournamentRefereeTeam(req, req.params.tournamentId)); } catch (error) { next(error); }
  },
  async lookup(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try { res.json(await lookupTournamentRefereeAccount(req, req.params.tournamentId, req.query.email)); } catch (error) { next(error); }
  },
  async add(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try { const result = await createTournamentRefereeMember(req, req.params.tournamentId, req.body); res.status(result.created ? 201 : 200).json(result); } catch (error) { next(error); }
  },
  async patch(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try { res.json(await patchTournamentRefereeMember(req, req.params.tournamentId, req.params.memberId, req.body)); } catch (error) { next(error); }
  },
  async resend(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try { res.json(await resendTournamentRefereeAccess(req, req.params.tournamentId, req.params.memberId, req.body)); } catch (error) { next(error); }
  },
};
