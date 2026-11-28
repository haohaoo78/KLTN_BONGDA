import type { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "../middleware/gatewayUser";
import { getTournamentRefereeConfiguration, putTournamentRefereeConfiguration } from "../services/refereeConfigurationService";

export const refereeConfigurationController = {
  async get(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try { res.json(await getTournamentRefereeConfiguration(req, req.params.tournamentId)); } catch (error) { next(error); }
  },
  async put(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try { res.json(await putTournamentRefereeConfiguration(req, req.params.tournamentId, req.body)); } catch (error) { next(error); }
  },
};
