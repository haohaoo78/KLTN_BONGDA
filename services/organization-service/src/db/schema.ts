export const schemaSql = `
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS institutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  code VARCHAR(50) NOT NULL UNIQUE,
  institution_type VARCHAR(30) NOT NULL DEFAULT 'UNIVERSITY',
  address TEXT,
  contact_email VARCHAR(255),
  contact_phone VARCHAR(50),
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT institutions_type_check CHECK (
    institution_type IN ('UNIVERSITY', 'COLLEGE', 'OTHER')
  ),
  CONSTRAINT institutions_status_check CHECK (
    status IN ('DRAFT', 'ACTIVE', 'SUSPENDED')
  )
);

CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  logo_url VARCHAR(500),
  institution_id UUID REFERENCES institutions(id) ON DELETE SET NULL,
  captain_id UUID NOT NULL,
  contact_email VARCHAR(255),
  contact_phone VARCHAR(50),
  max_players INTEGER NOT NULL DEFAULT 25,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  unit_name VARCHAR(255),
  representative_name VARCHAR(255),
  kit_color VARCHAR(40),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT teams_max_players_check CHECK (max_players > 0)
);

CREATE TABLE IF NOT EXISTS team_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  tournament_id UUID NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  approved_by UUID,
  notes TEXT,
  CONSTRAINT team_registrations_status_check CHECK (
    status IN ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN')
  ),
  CONSTRAINT team_registrations_unique UNIQUE (team_id, tournament_id)
);

CREATE TABLE IF NOT EXISTS rosters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  tournament_id UUID NOT NULL,
  player_id UUID NOT NULL,
  evidence_url VARCHAR(500),
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT rosters_unique UNIQUE (team_id, tournament_id, player_id)
);

CREATE TABLE IF NOT EXISTS players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID,
  full_name VARCHAR(255),
  birth_date DATE,
  student_id VARCHAR(100),
  contact_email VARCHAR(255),
  evidence_url VARCHAR(1000),
  jersey_number INTEGER,
  position VARCHAR(50),
  is_captain BOOLEAN NOT NULL DEFAULT FALSE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  left_at TIMESTAMPTZ,
  CONSTRAINT players_unique_team_user UNIQUE (team_id, user_id),
  CONSTRAINT players_jersey_number_check CHECK (jersey_number IS NULL OR jersey_number > 0),
  CONSTRAINT players_position_check CHECK (
    position IS NULL OR position IN ('GK', 'DEF', 'MID', 'FWD')
  )
);

CREATE TABLE IF NOT EXISTS player_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  message TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMPTZ,
  CONSTRAINT player_requests_status_check CHECK (
    status IN ('PENDING', 'APPROVED', 'REJECTED')
  ),
  CONSTRAINT player_requests_unique UNIQUE (team_id, user_id, status)
);

CREATE INDEX IF NOT EXISTS idx_institutions_active ON institutions (is_active);
CREATE INDEX IF NOT EXISTS idx_teams_institution ON teams (institution_id);
CREATE INDEX IF NOT EXISTS idx_teams_captain ON teams (captain_id);
CREATE INDEX IF NOT EXISTS idx_teams_active ON teams (is_active);
CREATE INDEX IF NOT EXISTS idx_team_registrations_tournament ON team_registrations (tournament_id);
CREATE INDEX IF NOT EXISTS idx_team_registrations_status ON team_registrations (status);
CREATE INDEX IF NOT EXISTS idx_rosters_tournament ON rosters (tournament_id);
CREATE INDEX IF NOT EXISTS idx_rosters_team ON rosters (team_id);
CREATE INDEX IF NOT EXISTS idx_players_team ON players (team_id);
CREATE INDEX IF NOT EXISTS idx_players_user ON players (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_players_one_active_team_per_user
  ON players (user_id) WHERE user_id IS NOT NULL AND left_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_player_requests_team ON player_requests (team_id);
CREATE INDEX IF NOT EXISTS idx_player_requests_status ON player_requests (status);
`;
