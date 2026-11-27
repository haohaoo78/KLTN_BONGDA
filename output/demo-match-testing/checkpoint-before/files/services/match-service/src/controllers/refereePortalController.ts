import type { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "../middleware/gatewayUser";
import { getRefereePortalAssignments, getRefereeMatchContext } from "../services/refereePortalService";

export const refereePortalController = {
  async list(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try { res.json(await getRefereePortalAssignments(req)); } catch (error) { next(error); }
  },
  async detail(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try { res.json(await getRefereeMatchContext(req, req.params.matchId)); } catch (error) { next(error); }
  },
};
