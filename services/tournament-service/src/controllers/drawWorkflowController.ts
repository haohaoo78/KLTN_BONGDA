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
} from "../services/drawWorkflowService";
import type { DrawPlanInput } from "../models/drawWorkflow";

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
    seedings: input.seedings,
    changeReason: input.changeReason,
  };
}

export const drawWorkflowController = {
  async management(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await getDrawManagement(req.params.tournamentId));
    } catch (error) {
      next(error);
    }
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
      const draw = await confirmDrawWorkflow(req.params.tournamentId, getUserId(req));
      res.json({ draw });
    } catch (error) {
      next(error);
    }
  },

  async publish(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const draw = await publishDrawWorkflow(req.params.tournamentId, getUserId(req));
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
};
