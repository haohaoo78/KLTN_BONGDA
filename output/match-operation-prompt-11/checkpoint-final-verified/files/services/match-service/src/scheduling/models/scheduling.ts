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

export interface ScheduleRefereeAssignment {
  id: string;
  scheduleId: string;
  refereeId: string;
  position: string;
  isFinalAuthority: boolean;
  assignedBy: string;
  assignedAt: string;
}

export interface RefereeCandidate {
  userId: string;
  fullName: string;
  email: string;
}

export interface ScheduleRefereeAssignmentInput {
  refereeId: string;
  position: string;
  isFinalAuthority?: boolean;
}

export interface ScheduleRefereeAssignmentHistory {
  id: string;
  beforeAssignments: Array<{ refereeId: string; position: string; isFinalAuthority: boolean }>;
  afterAssignments: Array<{ refereeId: string; position: string; isFinalAuthority: boolean }>;
  changedBy: string;
  reason: string | null;
  changedAt: string;
}

export interface ScheduleChangeHistory {
  id: string;
  before: Pick<Schedule, "venueId" | "scheduledDate" | "durationMinutes" | "status">;
  after: Pick<Schedule, "venueId" | "scheduledDate" | "durationMinutes" | "status">;
  changedBy: string;
  reason: string | null;
  changedAt: string;
}

export interface Schedule {
  operationStatus?: string | null;
  id: string;
  tournamentId: string;
  matchId: string;
  venueId: string;
  refereeId: string | null;
  myAssignment?: { position: string; isFinalAuthority: boolean };
  scheduledDate: string;
  durationMinutes: number;
  status: ScheduleStatus;
  isLocked: boolean;
  notes?: string;
  slotId?: string | null;
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
  notes?: string;
  slotId?: string;
  locked?: boolean;
}

export interface ScheduleUpdateInput {
  venueId?: string;
  refereeId?: string;
  scheduledDate?: string;
  durationMinutes?: number;
  status?: ScheduleStatus;
  reason?: string;
  notes?: string;
  slotId?: string;
}

export interface ConflictCheck {
  hasConflict: boolean;
  conflicts: Array<{
    type: "venue" | "team" | "referee";
    scheduleId: string;
    reason: string;
  }>;
}
