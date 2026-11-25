import { Request, Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../middleware/gatewayUser";
import { AppError } from "../lib/errors";
import {
  confirmDrawWorkflow,
  getDrawManagement,
  getPublicDraw,
  previewDraw,
  publishDrawWorkflow,
  saveDrawWorkflowDraft,
  getPublicLiveDraw,
  getManagerLiveDraw,
  startLiveDraw,
  startScheduledLiveDraw,
  rescheduleLiveDraw,
  advanceLiveDrawPick,
  controlLiveDraw,
  finalizeLiveDrawDraft,
} from "../services/drawWorkflowService";
import type { DrawPlanInput } from "../models/drawWorkflow";
import { subscribeToLiveDraw } from "../realtime/liveDrawRealtime";
import { getDrawTestConfiguration, resetDrawTestConfiguration, saveDrawTestConfiguration } from "../services/drawTestConfigurationService";
import { loadDrawTestSnapshot, loadInternalPublishedDrawTestSnapshot, loadPublicDrawTestSnapshot, removeDrawTestSnapshot, storeDrawTestSnapshot } from "../services/drawTestSnapshotService";

function getUserId(req: AuthenticatedRequest): string {
  if (!req.userId) {
    throw new AppError(401, "Missing user authentication", "UNAUTHENTICATED");
  }
  return req.userId;
}

function parsePlan(body: unknown): DrawPlanInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AppError(400, "Draw configuration is required", "VALIDATION_ERROR");
  }
  const input = body as Partial<DrawPlanInput>;
  if (typeof input.method !== "string" || typeof input.groupCount !== "number") {
    throw new AppError(400, "method and groupCount are required", "VALIDATION_ERROR");
  }
  return {
    method: input.method as DrawPlanInput["method"],
    groupCount: input.groupCount,
    maxTeamsPerGroup: input.maxTeamsPerGroup,
    noSameInstitution: input.noSameInstitution === true,
    groups: input.groups,
    seededTeamIds: input.seededTeamIds,
    changeReason: input.changeReason,
  };
}

function parseSchedule(body: unknown) {
  const value = body as { eventName?: unknown; scheduledAt?: unknown; timeZone?: unknown; announcement?: unknown; location?: unknown };
  if (!value || typeof value.eventName !== "string" || typeof value.scheduledAt !== "string" || typeof value.timeZone !== "string") {
    throw new AppError(400, "eventName, scheduledAt và timeZone là bắt buộc", "INVALID_LIVE_DRAW_SCHEDULE");
  }
  if (value.announcement !== undefined && typeof value.announcement !== "string") {
    throw new AppError(400, "announcement không hợp lệ", "INVALID_LIVE_DRAW_SCHEDULE");
  }
  if (value.location !== undefined && typeof value.location !== "string") throw new AppError(400, "location không hợp lệ", "INVALID_LIVE_DRAW_SCHEDULE");
  return { eventName: value.eventName, scheduledAt: value.scheduledAt, timeZone: value.timeZone, announcement: value.announcement ?? "", location: value.location ?? "" };
}

export const drawWorkflowController = {
  async management(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await getDrawManagement(req.params.tournamentId));
    } catch (error) {
      next(error);
    }
  },

  async testConfiguration(req: Request, res: Response, next: NextFunction) {
    try { res.json(await getDrawTestConfiguration(req.params.tournamentId)); }
    catch (error) { next(error); }
  },

  async saveTestConfiguration(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try { res.json(await saveDrawTestConfiguration(req.params.tournamentId, req.body, getUserId(req))); }
    catch (error) { next(error); }
  },

  async resetTestConfiguration(req: Request, res: Response, next: NextFunction) {
    try { res.json(await resetDrawTestConfiguration(req.params.tournamentId)); }
    catch (error) { next(error); }
  },

  async testState(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try { res.json(await loadDrawTestSnapshot(req.params.tournamentId)); }
    catch (error) { next(error); }
  },

  async saveTestState(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.userId) throw new AppError(401, "Missing user authentication", "UNAUTHENTICATED");
      res.json(await storeDrawTestSnapshot(req.params.tournamentId, req.body?.state, req.userId, req.body?.expectedRevision ?? null));
    } catch (error) { next(error); }
  },

  async resetTestState(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try { res.json(await removeDrawTestSnapshot(req.params.tournamentId)); }
    catch (error) { next(error); }
  },

  async publicTestState(req: Request, res: Response, next: NextFunction) {
    try { res.json(await loadPublicDrawTestSnapshot(req.params.tournamentId)); }
    catch (error) { next(error); }
  },

  async internalPublishedTestState(req: Request, res: Response, next: NextFunction) {
    try { res.json(await loadInternalPublishedDrawTestSnapshot(req.params.tournamentId)); }
    catch (error) { next(error); }
  },

  async publicDraw(req: Request, res: Response, next: NextFunction) {
    try {
      const draw = await getPublicDraw(req.params.tournamentId);
      res.json({ draw });
    } catch (error) {
      next(error);
    }
  },

  async preview(req: Request, res: Response, next: NextFunction) {
    try {
      const input = parsePlan(req.body);
      res.json(await previewDraw(req.params.tournamentId, input));
    } catch (error) {
      next(error);
    }
  },

  async saveDraft(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const input = parsePlan(req.body);
      const draw = await saveDrawWorkflowDraft(req.params.tournamentId, input, getUserId(req));
      res.status(201).json({ draw });
    } catch (error) {
      next(error);
    }
  },

  async confirm(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const method = (req.body as { method?: unknown } | undefined)?.method;
      if (method !== "RANDOM" && method !== "SEEDED" && method !== "MANUAL") throw new AppError(400, "method không hợp lệ", "INVALID_DRAW_METHOD");
      const draw = await confirmDrawWorkflow(req.params.tournamentId, method, getUserId(req));
      res.json({ draw });
    } catch (error) {
      next(error);
    }
  },

  async publish(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const method = (req.body as { method?: unknown } | undefined)?.method;
      if (method !== "RANDOM" && method !== "SEEDED" && method !== "MANUAL") throw new AppError(400, "method không hợp lệ", "INVALID_DRAW_METHOD");
      const draw = await publishDrawWorkflow(req.params.tournamentId, method, getUserId(req));
      res.json({ draw });
    } catch (error) {
      next(error);
    }
  },

  async internalPublishedDraw(req: Request, res: Response, next: NextFunction) {
    try {
      const draw = await getPublicDraw(req.params.tournamentId);
      if (!draw) {
        throw new AppError(404, "Published group draw not found", "PUBLISHED_DRAW_NOT_FOUND");
      }
      res.json({ draw });
    } catch (error) {
      next(error);
    }
  },

  async publicLive(req: Request, res: Response, next: NextFunction) {
    try { res.json({ session: await getPublicLiveDraw(req.params.tournamentId) }); }
    catch (error) { next(error); }
  },

  liveStream(req: Request, res: Response, next: NextFunction) {
    try { subscribeToLiveDraw(req.params.tournamentId, res); }
    catch (error) { next(error); }
  },

  async managementLive(req: Request, res: Response, next: NextFunction) {
    try { res.json({ session: await getManagerLiveDraw(req.params.tournamentId) }); }
    catch (error) { next(error); }
  },

  async startLive(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try { res.status(201).json({ session: await startLiveDraw(req.params.tournamentId, parsePlan(req.body), getUserId(req), parseSchedule(req.body)) }); }
    catch (error) { next(error); }
  },

  async startScheduled(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try { res.json({ session: await startScheduledLiveDraw(req.params.tournamentId, getUserId(req)) }); }
    catch (error) { next(error); }
  },

  async updateSchedule(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const body = req.body as { status?: unknown; cancellationReason?: unknown };
      if (body?.status !== "SCHEDULED" && body?.status !== "POSTPONED" && body?.status !== "CANCELLED") {
        throw new AppError(400, "Trạng thái lịch không hợp lệ", "VALIDATION_ERROR");
      }
      if (body.status === "CANCELLED" && (typeof body.cancellationReason !== "string" || !body.cancellationReason.trim())) throw new AppError(400, "Nhập lý do hủy lịch", "LIVE_DRAW_CANCELLATION_REASON_REQUIRED");
      const schedule = body.status === "CANCELLED" ? undefined : parseSchedule(req.body);
      res.json({ session: await rescheduleLiveDraw(req.params.tournamentId, getUserId(req), body.status, schedule, typeof body.cancellationReason === "string" ? body.cancellationReason : undefined) });
    } catch (error) { next(error); }
  },

  async advanceLive(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const body = req.body as { expectedSequence?: unknown; requestKey?: unknown } | undefined;
      const expectedSequence = body?.expectedSequence;
      if (!Number.isInteger(expectedSequence) || (expectedSequence as number) < 0) throw new AppError(400, "expectedSequence không hợp lệ", "VALIDATION_ERROR");
      const headerKey = req.headers["idempotency-key"];
      const requestKey = typeof body?.requestKey === "string" ? body.requestKey : typeof headerKey === "string" ? headerKey : "";
      if (requestKey.length < 8 || requestKey.length > 120) throw new AppError(400, "Idempotency-Key phải có từ 8 đến 120 ký tự", "INVALID_IDEMPOTENCY_KEY");
      res.json(await advanceLiveDrawPick(req.params.tournamentId, expectedSequence as number, getUserId(req), requestKey));
    }
    catch (error) { next(error); }
  },

  async controlLive(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const status = (req.body as { status?: unknown } | undefined)?.status;
      if (status !== "PAUSED" && status !== "LIVE" && status !== "CANCELLED") throw new AppError(400, "Trạng thái phiên không hợp lệ", "VALIDATION_ERROR");
      res.json({ session: await controlLiveDraw(req.params.tournamentId, getUserId(req), status) });
    } catch (error) { next(error); }
  },

  async finalizeLive(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try { res.json(await finalizeLiveDrawDraft(req.params.tournamentId, getUserId(req))); }
    catch (error) { next(error); }
  },
};
