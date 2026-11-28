import type { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "../middleware/gatewayUser";
import { getRefereeAssignmentSuggestions, getRefereeAssignmentWorkspace, saveRefereeAssignmentDraft } from "../services/refereeAssignmentService";
import { publishRefereeAssignments, replacePublishedReferee, getRefereePublicationHistory } from "../services/refereePublicationService";
import { resendRefereePublicationEmail } from "../services/refereePublicationDelivery";

export const refereeAssignmentController = {
  async publish(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try { res.json(await publishRefereeAssignments(req, req.params.tournamentId, req.body)); } catch (error) { next(error); }
  },
  async replace(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try { res.json(await replacePublishedReferee(req, req.params.tournamentId, req.params.matchId, req.body)); } catch (error) { next(error); }
  },
  async history(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try { res.json(await getRefereePublicationHistory(req, req.params.tournamentId, req.params.matchId)); } catch (error) { next(error); }
  },
  async resend(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try { res.json(await resendRefereePublicationEmail(req, req.params.tournamentId, req.params.matchId, req.body)); } catch (error) { next(error); }
  },
  async list(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try { res.json(await getRefereeAssignmentWorkspace(req, req.params.tournamentId)); } catch (error) { next(error); }
  },
  async suggestions(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try { res.json(await getRefereeAssignmentSuggestions(req, req.params.tournamentId, req.params.matchId, req.query.search)); } catch (error) { next(error); }
  },
  async save(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try { res.json(await saveRefereeAssignmentDraft(req, req.params.tournamentId, req.params.matchId, req.body)); } catch (error) { next(error); }
  },
  async preview(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try { res.json(await getRefereeAssignmentSuggestions(req, req.params.tournamentId, req.params.matchId, req.body?.search, req.body?.positions)); } catch (error) { next(error); }
  },
};
