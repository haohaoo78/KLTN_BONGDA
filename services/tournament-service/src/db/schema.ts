export const schemaSql = `
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS tournaments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'DRAFT',
  location VARCHAR(255),
  organizer_name VARCHAR(255),
  organizer_contact_name VARCHAR(255),
  organizer_email VARCHAR(255),
  organizer_phone VARCHAR(50),
  scope VARCHAR(30) NOT NULL DEFAULT 'INTER_SCHOOL',
  football_format SMALLINT NOT NULL DEFAULT 7,
  competition_format VARCHAR(40) NOT NULL DEFAULT 'ROUND_ROBIN',
  min_teams INTEGER NOT NULL DEFAULT 2,
  max_teams INTEGER NOT NULL DEFAULT 32,
  min_players INTEGER NOT NULL DEFAULT 7,
  max_players_per_team INTEGER NOT NULL DEFAULT 25,
  start_date DATE,
  end_date DATE,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tournaments_status_check CHECK (
    status IN ('DRAFT', 'OPEN_REGISTRATION', 'REGISTRATION_CLOSED', 'ROSTER_LOCKED', 'PREPARING', 'IN_PROGRESS', 'PAUSED', 'COMPLETED', 'CANCELLED')
  ),
  CONSTRAINT tournaments_scope_check CHECK (scope IN ('SINGLE_INSTITUTION', 'INTER_SCHOOL')),
  CONSTRAINT tournaments_football_format_check CHECK (football_format IN (7, 11)),
  CONSTRAINT tournaments_competition_format_check CHECK (
    competition_format IN ('ROUND_ROBIN', 'GROUP_AND_KNOCKOUT', 'KNOCKOUT')
  ),
  CONSTRAINT tournaments_team_limits_check CHECK (min_teams > 0 AND max_teams >= min_teams),
  CONSTRAINT tournaments_player_limits_check CHECK (
    min_players >= football_format AND max_players_per_team >= min_players
  ),
  CONSTRAINT tournaments_dates_check CHECK (
    (start_date IS NULL AND end_date IS NULL) OR
    (start_date IS NOT NULL AND end_date IS NOT NULL AND start_date <= end_date)
  ),
  CONSTRAINT tournaments_max_teams_check CHECK (max_teams > 0)
);

CREATE TABLE IF NOT EXISTS seasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  year INTEGER NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT seasons_year_check CHECK (year > 2000 AND year < 2100)
);

CREATE TABLE IF NOT EXISTS registration_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  start_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT registration_periods_dates_check CHECK (start_date < end_date)
);

CREATE TABLE IF NOT EXISTS tournament_allowed_institutions (
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  institution_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tournament_id, institution_id)
);

CREATE TABLE IF NOT EXISTS tournament_rules (
  tournament_id UUID PRIMARY KEY REFERENCES tournaments(id) ON DELETE CASCADE,
  eligibility_description TEXT NOT NULL DEFAULT '',
  points_for_win INTEGER NOT NULL DEFAULT 3,
  points_for_draw INTEGER NOT NULL DEFAULT 1,
  points_for_loss INTEGER NOT NULL DEFAULT 0,
  advancing_teams_per_group INTEGER NOT NULL DEFAULT 2,
  yellow_cards_for_suspension INTEGER NOT NULL DEFAULT 3,
  suspension_matches INTEGER NOT NULL DEFAULT 1,
  complaint_window_hours INTEGER NOT NULL DEFAULT 24,
  minimum_rest_minutes INTEGER NOT NULL DEFAULT 30,
  match_duration_minutes INTEGER NOT NULL DEFAULT 90,
  forfeit_policy VARCHAR(40) NOT NULL DEFAULT 'ORGANIZER_DECISION',
  forfeit_winner_score INTEGER NOT NULL DEFAULT 3,
  forfeit_loser_score INTEGER NOT NULL DEFAULT 0,
  published_version INTEGER NOT NULL DEFAULT 0,
  published_at TIMESTAMPTZ,
  published_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tournament_rules_points_check CHECK (
    points_for_win >= 0 AND points_for_draw >= 0 AND points_for_loss >= 0
  ),
  CONSTRAINT tournament_rules_advance_check CHECK (advancing_teams_per_group > 0),
  CONSTRAINT tournament_rules_discipline_check CHECK (
    yellow_cards_for_suspension > 0 AND suspension_matches > 0
  ),
  CONSTRAINT tournament_rules_complaint_check CHECK (complaint_window_hours > 0),
  CONSTRAINT tournament_rules_rest_check CHECK (minimum_rest_minutes >= 30),
  CONSTRAINT tournament_rules_duration_check CHECK (match_duration_minutes > 0),
  CONSTRAINT tournament_rules_forfeit_check CHECK (
    forfeit_policy IN ('ORGANIZER_DECISION', 'WALKOVER', 'NO_AUTOMATIC_RESULT')
  ),
  CONSTRAINT tournament_rules_forfeit_score_check CHECK (
    forfeit_winner_score >= 0 AND forfeit_loser_score >= 0
  )
);

CREATE TABLE IF NOT EXISTS tournament_ranking_criteria (
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  priority SMALLINT NOT NULL,
  criterion VARCHAR(30) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tournament_id, priority),
  CONSTRAINT tournament_ranking_criteria_unique UNIQUE (tournament_id, criterion),
  CONSTRAINT tournament_ranking_criterion_check CHECK (
    criterion IN ('POINTS', 'GOAL_DIFFERENCE', 'GOALS_FOR', 'HEAD_TO_HEAD', 'FAIR_PLAY', 'LOT_DRAW')
  )
);

CREATE TABLE IF NOT EXISTS tournament_organizers (
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  assigned_by UUID NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tournament_id, user_id)
);

CREATE TABLE IF NOT EXISTS regulation_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  effective_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT regulation_versions_unique UNIQUE (tournament_id, version)
);

CREATE TABLE IF NOT EXISTS groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  stage VARCHAR(50) NOT NULL,
  max_teams INTEGER NOT NULL DEFAULT 4,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT groups_stage_check CHECK (stage IN ('GROUP_STAGE', 'QUARTER_FINALS', 'SEMI_FINALS', 'FINAL'))
);

CREATE TABLE IF NOT EXISTS draws (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
  team_id UUID NOT NULL,
  position INTEGER NOT NULL,
  drawn_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  drawn_by UUID NOT NULL,
  CONSTRAINT draws_unique UNIQUE (group_id, team_id)
);

CREATE TABLE IF NOT EXISTS regulations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tournaments_status ON tournaments (status);
CREATE INDEX IF NOT EXISTS idx_tournaments_created_by ON tournaments (created_by);
CREATE INDEX IF NOT EXISTS idx_seasons_active ON seasons (is_active);
CREATE INDEX IF NOT EXISTS idx_registration_periods_tournament ON registration_periods (tournament_id);
CREATE INDEX IF NOT EXISTS idx_tournament_allowed_institutions_institution ON tournament_allowed_institutions (institution_id);
CREATE INDEX IF NOT EXISTS idx_regulation_versions_tournament ON regulation_versions (tournament_id);
CREATE INDEX IF NOT EXISTS idx_regulation_versions_version ON regulation_versions (tournament_id, version);
CREATE INDEX IF NOT EXISTS idx_groups_tournament ON groups (tournament_id);
CREATE INDEX IF NOT EXISTS idx_groups_stage ON groups (stage);
CREATE INDEX IF NOT EXISTS idx_draws_tournament ON draws (tournament_id);
CREATE INDEX IF NOT EXISTS idx_draws_group ON draws (group_id);
CREATE INDEX IF NOT EXISTS idx_draws_team ON draws (team_id);
CREATE INDEX IF NOT EXISTS idx_regulations_tournament ON regulations (tournament_id);
CREATE INDEX IF NOT EXISTS idx_tournament_organizers_user ON tournament_organizers (user_id);
`;
