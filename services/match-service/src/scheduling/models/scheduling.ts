export interface Venue {
  id: string;
  name: string;
  location: string;
  capacity: number | null;
  surface: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface VenueCreateInput {
  name: string;
  location: string;
  capacity?: number;
  surface?: string;
}

export interface VenueUpdateInput {
  name?: string;
  location?: string;
  capacity?: number;
  surface?: string;
  isActive?: boolean;
}

export interface VenueAvailability {
  id: string;
  venueId: string;
  availableFrom: string;
  availableTo: string;
  reason: string | null;
  createdAt: string;
}

export interface VenueAvailabilityCreateInput {
  venueId: string;
  availableFrom: string;
  availableTo: string;
  reason?: string;
}

export type ScheduleStatus = "DRAFT" | "PUBLISHED" | "CANCELLED" | "RESCHEDULED";

export interface Schedule {
  id: string;
  tournamentId: string;
  matchId: string;
  venueId: string;
  refereeId: string | null;
  scheduledDate: string;
  durationMinutes: number;
  status: ScheduleStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleCreateInput {
  tournamentId: string;
  matchId: string;
  venueId: string;
  refereeId?: string;
  scheduledDate: string;
  durationMinutes?: number;
}

export interface ScheduleUpdateInput {
  venueId?: string;
  refereeId?: string;
  scheduledDate?: string;
  durationMinutes?: number;
  status?: ScheduleStatus;
}

export interface ConflictCheck {
  hasConflict: boolean;
  conflicts: Array<{
    type: "venue" | "team" | "referee";
    scheduleId: string;
    reason: string;
  }>;
}
