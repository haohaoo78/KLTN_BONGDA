import { Request, Response, NextFunction } from "express";
import {
  getSeasons,
  createNewSeason,
  toggleSeason,
  getRegulationVersions,
  createNewRegulationVersion,
  getGroups,
  createNewGroup,
  getDraws,
  createNewDraw,
  performDraw,
  clearDraws,
} from "../services/seasonService";

export const seasonController = {
  async listSeasons(req: Request, res: Response, next: NextFunction) {
    try {
      const isActive = req.query.isActive === "true" ? true : req.query.isActive === "false" ? false : undefined;
      const seasons = await getSeasons(isActive);
      res.json({ seasons });
    } catch (err) {
      next(err);
    }
  },

  async createSeason(req: Request, res: Response, next: NextFunction) {
    try {
      const input = {
        name: req.body.name,
        year: req.body.year,
        description: req.body.description,
      };
      const season = await createNewSeason(input);
      res.status(201).json({ season });
    } catch (err) {
      next(err);
    }
  },

  async updateSeason(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const isActive = req.body.isActive;
      const season = await toggleSeason(id, isActive);
      res.json({ season });
    } catch (err) {
      next(err);
    }
  },

  async listRegulationVersions(req: Request, res: Response, next: NextFunction) {
    try {
      const { tournamentId } = req.params;
      const versions = await getRegulationVersions(tournamentId);
      res.json({ versions });
    } catch (err) {
      next(err);
    }
  },

  async createRegulationVersion(req: Request, res: Response, next: NextFunction) {
    try {
      const input = {
        tournamentId: req.body.tournamentId,
        version: req.body.version,
        title: req.body.title,
        content: req.body.content,
        effectiveDate: req.body.effectiveDate,
      };
      const createdBy = (req as any).userId;
      const version = await createNewRegulationVersion(input, createdBy);
      res.status(201).json({ version });
    } catch (err) {
      next(err);
    }
  },

  async listGroups(req: Request, res: Response, next: NextFunction) {
    try {
      const { tournamentId } = req.params;
      const groups = await getGroups(tournamentId);
      res.json({ groups });
    } catch (err) {
      next(err);
    }
  },

  async createGroup(req: Request, res: Response, next: NextFunction) {
    try {
      const input = {
        tournamentId: req.body.tournamentId,
        name: req.body.name,
        stage: req.body.stage,
        maxTeams: req.body.maxTeams,
      };
      const group = await createNewGroup(input);
      res.status(201).json({ group });
    } catch (err) {
      next(err);
    }
  },

  async listDraws(req: Request, res: Response, next: NextFunction) {
    try {
      const { tournamentId } = req.params;
      const groupId = req.query.groupId as string | undefined;
      const draws = await getDraws(tournamentId, groupId);
      res.json({ draws });
    } catch (err) {
      next(err);
    }
  },

  async createDraw(req: Request, res: Response, next: NextFunction) {
    try {
      const input = {
        tournamentId: req.body.tournamentId,
        groupId: req.body.groupId,
        teamId: req.body.teamId,
        position: req.body.position,
      };
      const drawnBy = (req as any).userId;
      const draw = await createNewDraw(input, drawnBy);
      res.status(201).json({ draw });
    } catch (err) {
      next(err);
    }
  },

  async performDraw(req: Request, res: Response, next: NextFunction) {
    try {
      const { tournamentId } = req.params;
      const { teamIds } = req.body;
      const drawnBy = (req as any).userId;
      const draws = await performDraw(tournamentId, teamIds, drawnBy);
      res.status(201).json({ draws });
    } catch (err) {
      next(err);
    }
  },

  async clearDraws(req: Request, res: Response, next: NextFunction) {
    try {
      const { tournamentId } = req.params;
      await clearDraws(tournamentId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
};
