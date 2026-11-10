import { Request, Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../middleware/gatewayUser";
import { AppError } from "../lib/errors";
import { assertCanManageTournament } from "../authorization";
import {
  getVenue,
  getVenues,
  createNewVenue,
  updateVenueInfo,
  removeVenue,
  getVenueAvailability,
  createNewVenueAvailability,
  removeVenueAvailability,
  getSchedule,
  getPublicSchedule,
  getSchedules,
  getSchedulesForManager,
  getScheduleByMatchId,
  getSchedulesForReferee,
  checkConflicts,
  createNewSchedule,
  updateScheduleInfo,
  removeSchedule,
} from "../services/schedulingService";

export const schedulingController = {
  // Venues
  async getVenueById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const venue = await getVenue(id);
      res.json({ venue });
    } catch (err) {
      next(err);
    }
  },

  async listMySchedules(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.userId) {
        throw new AppError(401, "Missing user authentication", "UNAUTHENTICATED");
      }
      const schedules = await getSchedulesForReferee(req.userId);
      res.json({ schedules });
    } catch (err) {
      next(err);
    }
  },

  async listVenues(req: Request, res: Response, next: NextFunction) {
    try {
      const isActive = req.query.isActive === "true" ? true : req.query.isActive === "false" ? false : undefined;
      const venues = await getVenues(isActive);
      res.json({ venues });
    } catch (err) {
      next(err);
    }
  },

  async createVenue(req: Request, res: Response, next: NextFunction) {
    try {
      const input = {
        name: req.body.name,
        location: req.body.location,
        capacity: req.body.capacity,
        surface: req.body.surface,
      };
      const venue = await createNewVenue(input);
      res.status(201).json({ venue });
    } catch (err) {
      next(err);
    }
  },

  async updateVenue(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const input = {
        name: req.body.name,
        location: req.body.location,
        capacity: req.body.capacity,
        surface: req.body.surface,
        isActive: req.body.isActive,
      };
      const venue = await updateVenueInfo(id, input);
      res.json({ venue });
    } catch (err) {
      next(err);
    }
  },

  async deleteVenue(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      await removeVenue(id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },

  // Venue Availability
  async listVenueAvailability(req: Request, res: Response, next: NextFunction) {
    try {
      const { venueId } = req.params;
      const availability = await getVenueAvailability(venueId);
      res.json({ availability });
    } catch (err) {
      next(err);
    }
  },

  async createVenueAvailability(req: Request, res: Response, next: NextFunction) {
    try {
      const input = {
        venueId: req.body.venueId,
        availableFrom: req.body.availableFrom,
        availableTo: req.body.availableTo,
        reason: req.body.reason,
      };
      const availability = await createNewVenueAvailability(input);
      res.status(201).json({ availability });
    } catch (err) {
      next(err);
    }
  },

  async deleteVenueAvailability(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      await removeVenueAvailability(id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },

  // Schedules
  async getScheduleById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const schedule = await getPublicSchedule(id);
      res.json({ schedule });
    } catch (err) {
      next(err);
    }
  },

  async listSchedules(req: Request, res: Response, next: NextFunction) {
    try {
      const { tournamentId } = req.params;
      const schedules = await getSchedules(tournamentId, "PUBLISHED");
      res.json({ schedules });
    } catch (err) {
      next(err);
    }
  },

  async listManagedSchedules(req: Request, res: Response, next: NextFunction) {
    try {
      const { tournamentId } = req.params;
      await assertCanManageTournament(req as AuthenticatedRequest, tournamentId);
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const schedules = await getSchedulesForManager(tournamentId, status);
      res.json({ schedules });
    } catch (err) {
      next(err);
    }
  },

  async getScheduleByMatchId(req: Request, res: Response, next: NextFunction) {
    try {
      const { matchId } = req.params;
      const schedule = await getScheduleByMatchId(matchId);
      res.json({ schedule });
    } catch (err) {
      next(err);
    }
  },

  async checkScheduleConflicts(req: Request, res: Response, next: NextFunction) {
    try {
      await assertCanManageTournament(
        req as AuthenticatedRequest,
        req.body.tournamentId,
      );
      const input = {
        tournamentId: req.body.tournamentId,
        matchId: req.body.matchId,
        venueId: req.body.venueId,
        refereeId: req.body.refereeId,
        scheduledDate: req.body.scheduledDate,
        durationMinutes: req.body.durationMinutes,
      };
      const conflictCheck = await checkConflicts(input);
      res.json(conflictCheck);
    } catch (err) {
      next(err);
    }
  },

  async createSchedule(req: Request, res: Response, next: NextFunction) {
    try {
      await assertCanManageTournament(
        req as AuthenticatedRequest,
        req.body.tournamentId,
      );
      const input = {
        tournamentId: req.body.tournamentId,
        matchId: req.body.matchId,
        venueId: req.body.venueId,
        refereeId: req.body.refereeId,
        scheduledDate: req.body.scheduledDate,
        durationMinutes: req.body.durationMinutes,
      };
      const createdBy = (req as any).userId;
      const schedule = await createNewSchedule(input, createdBy);
      res.status(201).json({ schedule });
    } catch (err) {
      next(err);
    }
  },

  async updateSchedule(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const existing = await getSchedule(id);
      await assertCanManageTournament(
        req as AuthenticatedRequest,
        existing.tournamentId,
      );
      const input = {
        venueId: req.body.venueId,
        refereeId: req.body.refereeId,
        scheduledDate: req.body.scheduledDate,
        durationMinutes: req.body.durationMinutes,
        status: req.body.status,
      };
      const schedule = await updateScheduleInfo(id, input);
      res.json({ schedule });
    } catch (err) {
      next(err);
    }
  },

  async deleteSchedule(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const existing = await getSchedule(id);
      await assertCanManageTournament(
        req as AuthenticatedRequest,
        existing.tournamentId,
      );
      await removeSchedule(id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
};
