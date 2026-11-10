export const schemaSql = `
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL,
  home_team_id UUID NOT NULL,
  away_team_id UUID NOT NULL,
  match_date TIMESTAMPTZ,
  venue VARCHAR(255),
  round VARCHAR(100),
  status VARCHAR(50) NOT NULL DEFAULT 'SCHEDULED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT matches_status_check CHECK (
    status IN ('UNSCHEDULED', 'SCHEDULED', 'LINEUP_CONFIRMED', 'IN_PROGRESS', 'FINISHED', 'VERIFIED', 'LOCKED', 'CANCELLED', 'POSTPONED')
  ),
  CONSTRAINT matches_teams_check CHECK (home_team_id != away_team_id)
);

CREATE TABLE IF NOT EXISTS match_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  home_score INTEGER NOT NULL DEFAULT 0,
  away_score INTEGER NOT NULL DEFAULT 0,
  home_extra_time_score INTEGER,
  away_extra_time_score INTEGER,
  home_penalty_score INTEGER,
  away_penalty_score INTEGER,
  recorded_by UUID NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT,
  CONSTRAINT match_results_scores_check CHECK (
    home_score >= 0 AND away_score >= 0
  )
);

CREATE TABLE IF NOT EXISTS lineups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  team_id UUID NOT NULL,
  player_id UUID NOT NULL,
  position VARCHAR(50),
  jersey_number INTEGER,
  is_starting BOOLEAN NOT NULL DEFAULT TRUE,
  confirmed_by UUID,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lineups_jersey_check CHECK (jersey_number IS NULL OR (jersey_number >= 1 AND jersey_number <= 99))
);

CREATE TABLE IF NOT EXISTS match_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  team_id UUID NOT NULL,
  player_id UUID,
  event_type VARCHAR(50) NOT NULL,
  minute INTEGER,
  description TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT match_events_type_check CHECK (
    event_type IN ('GOAL', 'YELLOW_CARD', 'RED_CARD', 'SUBSTITUTION_IN', 'SUBSTITUTION_OUT', 'OWN_GOAL', 'PENALTY_GOAL')
  ),
  CONSTRAINT match_events_minute_check CHECK (minute IS NULL OR (minute >= 0 AND minute <= 120))
);

CREATE TABLE IF NOT EXISTS match_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  referee_id UUID NOT NULL,
  home_captain_id UUID,
  away_captain_id UUID,
  home_score_at_half_time INTEGER,
  away_score_at_half_time INTEGER,
  attendance INTEGER,
  weather VARCHAR(100),
  notes TEXT,
  submitted_by UUID NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_by UUID,
  verified_at TIMESTAMPTZ,
  status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
  CONSTRAINT match_reports_status_check CHECK (
    status IN ('PENDING', 'APPROVED', 'REJECTED')
  )
);

CREATE TABLE IF NOT EXISTS standings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL,
  team_id UUID NOT NULL,
  played INTEGER NOT NULL DEFAULT 0,
  won INTEGER NOT NULL DEFAULT 0,
  drawn INTEGER NOT NULL DEFAULT 0,
  lost INTEGER NOT NULL DEFAULT 0,
  goals_for INTEGER NOT NULL DEFAULT 0,
  goals_against INTEGER NOT NULL DEFAULT 0,
  goal_difference INTEGER NOT NULL DEFAULT 0,
  points INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT standings_unique UNIQUE (tournament_id, team_id),
  CONSTRAINT standings_positive CHECK (
    played >= 0 AND won >= 0 AND drawn >= 0 AND lost >= 0 AND
    goals_for >= 0 AND goals_against >= 0 AND points >= 0
  )
);

CREATE INDEX IF NOT EXISTS idx_matches_tournament ON matches (tournament_id);
CREATE INDEX IF NOT EXISTS idx_matches_date ON matches (match_date);
CREATE INDEX IF NOT EXISTS idx_matches_status ON matches (status);
CREATE INDEX IF NOT EXISTS idx_matches_teams ON matches (home_team_id, away_team_id);
CREATE INDEX IF NOT EXISTS idx_match_results_match ON match_results (match_id);
CREATE INDEX IF NOT EXISTS idx_lineups_match ON lineups (match_id);
CREATE INDEX IF NOT EXISTS idx_lineups_team ON lineups (team_id);
CREATE INDEX IF NOT EXISTS idx_lineups_player ON lineups (player_id);
CREATE INDEX IF NOT EXISTS idx_match_events_match ON match_events (match_id);
CREATE INDEX IF NOT EXISTS idx_match_events_team ON match_events (team_id);
CREATE INDEX IF NOT EXISTS idx_match_events_player ON match_events (player_id);
CREATE INDEX IF NOT EXISTS idx_match_events_type ON match_events (event_type);
CREATE INDEX IF NOT EXISTS idx_match_reports_match ON match_reports (match_id);
CREATE INDEX IF NOT EXISTS idx_match_reports_status ON match_reports (status);
CREATE INDEX IF NOT EXISTS idx_standings_tournament ON standings (tournament_id);
CREATE INDEX IF NOT EXISTS idx_standings_team ON standings (team_id);

CREATE TABLE IF NOT EXISTS match_fixture_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL,
  draw_version_id UUID NOT NULL UNIQUE,
  legs SMALLINT NOT NULL,
  generated_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT match_fixture_generations_legs_check CHECK (legs IN (1, 2))
);
`;
