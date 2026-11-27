import { Request, Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../middleware/gatewayUser";
import { AppError } from "../lib/errors";
import { assertCanManageTournament } from "../authorization";
import type { ScheduleRefereeAssignmentInput } from "../models/scheduling";
import type { Schedule } from "../models/scheduling";
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
  setScheduleLocked,
  getTournamentSchedulingResources,
  saveTournamentSchedulingResources,
  publishTournamentSchedules,
  removeSchedule,
  searchRefereeCandidates,
  getScheduleOfficials,
  getScheduleOfficialsHistory,
  getScheduleChangesHistory,
  assignScheduleOfficials,
  getTournamentScheduleSettings,
} from "../services/schedulingService";

function publicScheduleView(schedule: Schedule, venueName: string, venueLocation: string) {
  return {
    id: schedule.id,
    tournamentId: schedule.tournamentId,
    matchId: schedule.matchId,
    venueId: schedule.venueId,
    scheduledDate: schedule.scheduledDate,
    durationMinutes: schedule.durationMinutes,
    status: schedule.status,
    venueName,
    venueLocation,
  };
}

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
      const tournament = await getTournamentScheduleSettings(schedule.tournamentId);
      if (tournament.status === "DRAFT") throw new AppError(404, "Schedule not found", "SCHEDULE_NOT_FOUND");
      const venue = await getVenue(schedule.venueId);
      res.json({ schedule: publicScheduleView(schedule, venue.name, venue.location) });
    } catch (err) {
      next(err);
    }
  },

  async listSchedules(req: Request, res: Response, next: NextFunction) {
    try {
      const { tournamentId } = req.params;
      const tournament = await getTournamentScheduleSettings(tournamentId);
      if (tournament.status === "DRAFT") throw new AppError(404, "Tournament not found", "TOURNAMENT_NOT_FOUND");
      const published = await getSchedules(tournamentId, "PUBLISHED");
      const schedules = await Promise.all(published.map(async (schedule) => {
        const venue = await getVenue(schedule.venueId);
        return publicScheduleView(schedule, venue.name, venue.location);
      }));
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

  async getTournamentScheduleResources(req: Request, res: Response, next: NextFunction) {
    try {
      const authenticatedReq = req as AuthenticatedRequest;
      const { tournamentId } = req.params;
      await assertCanManageTournament(authenticatedReq, tournamentId);
      const stored = await getTournamentSchedulingResources(tournamentId);
      res.json({ resources: stored?.resources ?? null, revision: stored?.revision ?? 0, updatedAt: stored?.updatedAt ?? null });
    } catch (err) { next(err); }
  },

  async saveTournamentScheduleResources(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { tournamentId } = req.params;
      await assertCanManageTournament(req, tournamentId);
      if (!req.userId) throw new AppError(401, "Missing user authentication", "UNAUTHENTICATED");
      const expectedRevision = req.body?.expectedRevision === null || req.body?.expectedRevision === undefined
        ? null : Number(req.body.expectedRevision);
      if (expectedRevision !== null && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)) {
        throw new AppError(400, "expectedRevision không hợp lệ", "INVALID_SCHEDULE_RESOURCES_REVISION");
      }
      const saved = await saveTournamentSchedulingResources(tournamentId, req.body?.resources, req.userId, expectedRevision);
      res.json(saved);
    } catch (err) { next(err); }
  },

  async setScheduleLock(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const schedule = await getSchedule(req.params.id);
      await assertCanManageTournament(req, schedule.tournamentId);
      if (!req.userId) throw new AppError(401, "Missing user authentication", "UNAUTHENTICATED");
      if (typeof req.body?.isLocked !== "boolean") throw new AppError(400, "isLocked phải là boolean", "VALIDATION_ERROR");
      const updated = await setScheduleLocked(schedule.id, req.body.isLocked);
      res.json({ schedule: updated });
    } catch (err) { next(err); }
  },

  async publishTournamentSchedules(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { tournamentId } = req.params;
      await assertCanManageTournament(req, tournamentId);
      if (!req.userId) throw new AppError(401, "Missing user authentication", "UNAUTHENTICATED");
      res.json(await publishTournamentSchedules(tournamentId, req.userId));
    } catch (err) { next(err); }
  },

  async listRefereeCandidates(req: Request, res: Response, next: NextFunction) {
    try {
      const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
      if (search.length > 100) throw new AppError(400, "Search text is too long", "VALIDATION_ERROR");
      const users = await searchRefereeCandidates(search);
      res.json({ users });
    } catch (err) {
      next(err);
    }
  },

  async listScheduleOfficials(req: Request, res: Response, next: NextFunction) {
    try {
      const schedule = await getSchedule(req.params.id);
      await assertCanManageTournament(req as AuthenticatedRequest, schedule.tournamentId);
      const assignments = await getScheduleOfficials(schedule.id);
      res.json({ assignments });
    } catch (err) {
      next(err);
    }
  },

  async listScheduleOfficialsHistory(req: Request, res: Response, next: NextFunction) {
    try {
      const schedule = await getSchedule(req.params.id);
      await assertCanManageTournament(req as AuthenticatedRequest, schedule.tournamentId);
      const history = await getScheduleOfficialsHistory(schedule.id);
      res.json({ history });
    } catch (err) {
      next(err);
    }
  },

  async listScheduleChangesHistory(req: Request, res: Response, next: NextFunction) {
    try {
      const schedule = await getSchedule(req.params.id);
      await assertCanManageTournament(req as AuthenticatedRequest, schedule.tournamentId);
      const history = await getScheduleChangesHistory(schedule.id);
      res.json({ history });
    } catch (err) {
      next(err);
    }
  },

  async replaceScheduleOfficials(req: Request, res: Response, next: NextFunction) {
    try {
      const schedule = await getSchedule(req.params.id);
      await assertCanManageTournament(req as AuthenticatedRequest, schedule.tournamentId);
      const assignments = req.body?.assignments;
      if (!Array.isArray(assignments) || assignments.some((item: unknown) => !item || typeof item !== "object")) {
        throw new AppError(400, "assignments must be an array", "VALIDATION_ERROR");
      }
      const changedBy = (req as AuthenticatedRequest).userId;
      if (!changedBy) throw new AppError(401, "Missing user authentication", "UNAUTHENTICATED");
      const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : undefined;
      const result = await assignScheduleOfficials(schedule.id, assignments as ScheduleRefereeAssignmentInput[], changedBy, reason);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async getScheduleByMatchId(req: Request, res: Response, next: NextFunction) {
    try {
      const { matchId } = req.params;
      const schedule = await getScheduleByMatchId(matchId);
      const tournament = await getTournamentScheduleSettings(schedule.tournamentId);
      if (tournament.status === "DRAFT") throw new AppError(404, "Schedule not found", "SCHEDULE_NOT_FOUND");
      const venue = await getVenue(schedule.venueId);
      res.json({ schedule: publicScheduleView(schedule, venue.name, venue.location) });
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

  async updateSchedule(req: AuthenticatedRequest, res: Response, next: NextFunction) {
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
        reason: typeof req.body.reason === "string" ? req.body.reason.trim() : undefined,
      };
      if (!req.userId) throw new AppError(401, "Missing user authentication", "UNAUTHENTICATED");
      const { schedule, notificationFailures } = await updateScheduleInfo(id, input, req.userId);
      res.json({ schedule, notificationFailures });
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
