import { Request, Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../middleware/gatewayUser";
import { AppError } from "../lib/errors";
import { isFixtureMatchPublic } from "../repositories/matchRepository";
import { getMatch } from "../services/matchService";
import { config } from "../config";
import { assertCanManageLineup, assertCanManageMatch } from "../scheduling/authorization";
import { withRefereeOperation } from "../services/matchOperationReadinessService";
import { configuredCrewHasCapability } from "../scheduling/crewValidation";
import {
  getLineups,
  getMatchEvents,
  getMatchEventById,
  addMatchEvent,
  removeMatchEvent,
  getMatchReport,
  getMatchReportById,
  submitMatchReport,
  reviewMatchReport,
  confirmSubmittedMatchReport,
} from "../services/lineupService";

export const lineupController = {
  // Lineups
  async listLineups(req: Request, res: Response, next: NextFunction) {
    try {
      const { matchId } = req.params;
      await assertPublicFixtureMatch(matchId);
      const teamId = req.query.teamId as string | undefined;
      const lineups = await getLineups(matchId, teamId);
      res.json({ lineups });
    } catch (err) {
      next(err);
    }
  },

  // Match Events
  async listMatchEvents(req: Request, res: Response, next: NextFunction) {
    try {
      const { matchId } = req.params;
      await assertPublicFixtureMatch(matchId);
      const teamId = req.query.teamId as string | undefined;
      const events = await getMatchEvents(matchId, teamId);
      res.json({ events });
    } catch (err) {
      next(err);
    }
  },

  async createMatchEvent(req: Request, res: Response, next: NextFunction) {
    try {
      await assertCanManageMatch(req as AuthenticatedRequest, req.body.matchId, "RECORD_EVENT");
      const input = {
        operationId:req.body.operationId,relatedPlayerId:req.body.relatedPlayerId,opportunityId:req.body.opportunityId,visibility:req.body.visibility,
        matchId: req.body.matchId,
        teamId: req.body.teamId,
        playerId: req.body.playerId,
        eventType: req.body.eventType,
        minute: req.body.minute,
          phase:req.body.phase,periodElapsedSeconds:req.body.periodElapsedSeconds,expectedClockVersion:req.body.expectedClockVersion,
        description: req.body.description,
      };
      const createdBy = (req as any).userId;
      const event = await withRefereeOperation(req as AuthenticatedRequest, input.matchId, "RECORD_EVENT", () => addMatchEvent(input, createdBy));
      res.status(201).json({ event });
    } catch (err) {
      next(err);
    }
  },

  async correctMatchEvent(req:Request,res:Response,next:NextFunction){
    try{const old=await getMatchEventById(req.params.id),actor=req as AuthenticatedRequest;
      await assertCanManageMatch(actor,old.matchId,'EDIT_EVENT');
      const input={matchId:old.matchId,teamId:req.body.teamId,playerId:req.body.playerId,eventType:req.body.eventType,minute:req.body.minute,phase:req.body.phase,periodElapsedSeconds:req.body.periodElapsedSeconds,expectedClockVersion:req.body.expectedClockVersion,operationId:req.body.operationId,relatedPlayerId:req.body.relatedPlayerId,opportunityId:req.body.opportunityId,visibility:req.body.visibility,description:req.body.description,supersedesId:old.id,expectedRevision:req.body.expectedRevision,correctionReason:req.body.correctionReason};
      const event=await withRefereeOperation(actor,old.matchId,'EDIT_EVENT',()=>addMatchEvent(input,actor.userId!));res.json({event});
    }catch(e){next(e);}
  },
  async deleteMatchEvent(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const event = await getMatchEventById(id);
      await assertCanManageMatch(req as AuthenticatedRequest, event.matchId, "EDIT_EVENT");
        const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
        if (reason.length < 5) throw new AppError(400, "A correction reason of at least 5 characters is required", "EVENT_VOID_REASON_REQUIRED");
        await withRefereeOperation(req as AuthenticatedRequest, event.matchId, "EDIT_EVENT", () => removeMatchEvent(id, (req as any).userId, reason,req.body?.expectedRevision));
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },

  // Match Reports
  async getMatchReport(req: Request, res: Response, next: NextFunction) {
    try {
      const { matchId } = req.params;
      if (!await isFixtureMatchPublic(matchId)) throw new AppError(404, "Match not found", "MATCH_NOT_FOUND");
      let report = null;
      try { report = await getMatchReport(matchId); }
      catch (err) {
        if (!(err instanceof AppError) || err.code !== "REPORT_NOT_FOUND") throw err;
      }
      if (report?.status !== "APPROVED") report = null;
      if(report)report={...report,draft:null,reviewHistory:[],submissionSnapshots:report.submissionSnapshots?.map(s=>({...s,context:s.context?Object.fromEntries(Object.entries(s.context).filter(([key])=>!['preparation','operationRules','submittedByName'].includes(key))):undefined,events:s.events.filter(e=>e.visibility!=='CREW')}))};
      res.json({ report });
    } catch (err) {
      next(err);
    }
  },

  async getManagedMatchReport(req: Request, res: Response, next: NextFunction) {
    try {
      const { matchId } = req.params;
      await assertCanManageMatch(req as AuthenticatedRequest, matchId);
      let report = null;
      try { report = await getMatchReport(matchId); }
      catch (err) {
        if (!(err instanceof AppError) || err.code !== "REPORT_NOT_FOUND") throw err;
      }
      res.json({ report });
    } catch (err) {
      next(err);
    }
  },

  async createMatchReport(req: Request, res: Response, next: NextFunction) {
    try {
      const authenticatedReq = req as AuthenticatedRequest;
      const refereeId = typeof req.body.refereeId === "string"
        ? req.body.refereeId
        : authenticatedReq.userId;
      await assertCanManageMatch(authenticatedReq, req.body.matchId, "MANAGE_REPORT");
      if (
        authenticatedReq.userRoles?.includes("REFEREE") &&
        refereeId !== authenticatedReq.userId
      ) {
        throw new AppError(403, "A referee can submit reports only as themselves", "FORBIDDEN");
      }
      const input = {
        matchId: req.body.matchId,
        refereeId,
        homeCaptainId: req.body.homeCaptainId,
        awayCaptainId: req.body.awayCaptainId,
        homeScoreAtHalfTime: req.body.homeScoreAtHalfTime,
        awayScoreAtHalfTime: req.body.awayScoreAtHalfTime,
        attendance: req.body.attendance,
        weather: req.body.weather,
        notes: req.body.notes,
        requiresOrganizerReview: req.body.requiresOrganizerReview === true,
        action:req.body.action,expectedVersion:req.body.expectedVersion,operationId:req.body.operationId,
      };
      const submittedBy = (req as any).userId;
      const report = await submitMatchReport(input, submittedBy,authenticatedReq);
      res.status(201).json({ report });
    } catch (err) {
      next(err);
    }
  },

  async confirmMatchReport(req:Request,res:Response,next:NextFunction){
    try {
      const {expectedVersion,operationId,decision,reason}=req.body;
      if(!Number.isSafeInteger(expectedVersion)||expectedVersion<1||typeof operationId!=="string")throw new AppError(400,"Cần phiên bản và mã thao tác xác nhận biên bản.","REPORT_CONCURRENCY_REQUIRED");
      if(decision!==undefined&&!["APPROVE","REQUEST_CHANGES"].includes(decision))throw new AppError(400,"Thao tác xác nhận không hợp lệ.","VALIDATION_ERROR");
      const report=await confirmSubmittedMatchReport(req.params.id,req as AuthenticatedRequest,{expectedVersion,operationId,decision,reason});
      res.json({report});
    }catch(error){next(error);}
  },

  async reviewMatchReport(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const status = req.body.status;
      if (!["APPROVED", "REJECTED", "REVISION_REQUIRED"].includes(status)) {
        throw new AppError(400, "status must be APPROVED, REJECTED, or REVISION_REQUIRED", "VALIDATION_ERROR");
      }
      const reviewNote = typeof req.body.reviewNote === "string" ? req.body.reviewNote.trim() : "";
      if ((status === "REJECTED" || status === "REVISION_REQUIRED") && !reviewNote) {
        throw new AppError(400, "A reason is required when rejecting or requesting revisions", "VALIDATION_ERROR");
      }
      if (reviewNote.length > 2000) {
        throw new AppError(400, "reviewNote must be at most 2000 characters", "VALIDATION_ERROR");
      }
      const existingReport = await getMatchReportById(id);
      await assertCanManageMatch(
        req as AuthenticatedRequest,
        existingReport.matchId,
      );
      const input = {
        status: status as "APPROVED" | "REJECTED" | "REVISION_REQUIRED",
        reviewNote: reviewNote || null,
        verifiedBy: (req as any).userId,
        expectedVersion:req.body.expectedVersion,operationId:req.body.operationId,
      };
      const report = await reviewMatchReport(id, input, input.verifiedBy);
      res.json({ report });
    } catch (err) {
      next(err);
    }
  },
};

async function assertPublicFixtureMatch(matchId: string): Promise<void> {
  const match = await getMatch(matchId);
  let response: globalThis.Response;
  try {
    response = await fetch(new URL(`/tournaments/${encodeURIComponent(match.tournamentId)}`, config.tournamentServiceUrl), {
      headers: { "x-gateway-internal-key": config.internalApiKey }, signal: AbortSignal.timeout(5000),
    });
  } catch { throw new AppError(503, "Không xác minh được trạng thái công khai của giải đấu.", "TOURNAMENT_VISIBILITY_UNAVAILABLE"); }
  if (response.status === 404) throw new AppError(404, "Match not found", "MATCH_NOT_FOUND");
  if (!response.ok) throw new AppError(503, "Không xác minh được trạng thái công khai của giải đấu.", "TOURNAMENT_VISIBILITY_UNAVAILABLE");
  const body = await response.json() as { tournament?: { status?: string } };
  if (!body.tournament || body.tournament.status === "DRAFT" || !await isFixtureMatchPublic(matchId)) throw new AppError(404, "Match not found", "MATCH_NOT_FOUND");
}
