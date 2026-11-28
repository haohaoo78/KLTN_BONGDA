export const schemaSql = `
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS venues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  location VARCHAR(255) NOT NULL,
  capacity INTEGER,
  surface VARCHAR(50),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT venues_capacity_check CHECK (capacity IS NULL OR capacity > 0)
);

CREATE TABLE IF NOT EXISTS venue_availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  available_from TIMESTAMPTZ NOT NULL,
  available_to TIMESTAMPTZ NOT NULL,
  reason VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT venue_availability_dates_check CHECK (available_from < available_to)
);

CREATE TABLE IF NOT EXISTS schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL,
  match_id UUID NOT NULL,
  venue_id UUID NOT NULL REFERENCES venues(id),
  referee_id UUID,
  scheduled_date TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 90,
  status VARCHAR(50) NOT NULL DEFAULT 'DRAFT',
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT schedules_status_check CHECK (
    status IN ('DRAFT', 'PUBLISHED', 'CANCELLED', 'RESCHEDULED')
  ),
  CONSTRAINT schedules_duration_check CHECK (duration_minutes > 0)
);

CREATE INDEX IF NOT EXISTS idx_venues_active ON venues (is_active);
CREATE INDEX IF NOT EXISTS idx_venue_availability_venue ON venue_availability (venue_id);
CREATE INDEX IF NOT EXISTS idx_venue_availability_dates ON venue_availability (available_from, available_to);
CREATE INDEX IF NOT EXISTS idx_schedules_tournament ON schedules (tournament_id);
CREATE INDEX IF NOT EXISTS idx_schedules_match ON schedules (match_id);
CREATE INDEX IF NOT EXISTS idx_schedules_venue ON schedules (venue_id);
CREATE INDEX IF NOT EXISTS idx_schedules_referee ON schedules (referee_id);
CREATE INDEX IF NOT EXISTS idx_schedules_date ON schedules (scheduled_date);
CREATE INDEX IF NOT EXISTS idx_schedules_status ON schedules (status);
`;
