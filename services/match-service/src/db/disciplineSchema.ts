export const schemaSql = `
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL,
  match_id UUID NOT NULL,
  tournament_id UUID NOT NULL,
  team_id UUID NOT NULL,
  card_type VARCHAR(20) NOT NULL,
  minute INTEGER,
  reason TEXT,
  issued_by UUID NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cards_type_check CHECK (card_type IN ('YELLOW', 'RED'))
);

CREATE TABLE IF NOT EXISTS suspensions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL,
  tournament_id UUID NOT NULL,
  team_id UUID NOT NULL,
  type VARCHAR(50) NOT NULL,
  start_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ NOT NULL,
  reason TEXT,
  match_id UUID,
  issued_by UUID NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT suspensions_type_check CHECK (type IN ('YELLOW_CARDS', 'RED_CARD', 'DISCIPLINARY'))
);

CREATE TABLE IF NOT EXISTS complaints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL,
  tournament_id UUID NOT NULL,
  team_id UUID NOT NULL,
  submitted_by UUID NOT NULL,
  complaint_type VARCHAR(50) NOT NULL,
  description TEXT NOT NULL,
  evidence TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  decision TEXT,
  decision_reason TEXT,
  CONSTRAINT complaints_status_check CHECK (
    status IN ('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CLOSED')
  )
);

CREATE TABLE IF NOT EXISTS disciplinary_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id UUID REFERENCES complaints(id) ON DELETE SET NULL,
  player_id UUID,
  action VARCHAR(100) NOT NULL,
  additional_matches_suspended INTEGER,
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  issued_by UUID NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_cards_player ON cards (player_id);
CREATE INDEX IF NOT EXISTS idx_cards_match ON cards (match_id);
CREATE INDEX IF NOT EXISTS idx_cards_tournament ON cards (tournament_id);
CREATE INDEX IF NOT EXISTS idx_suspensions_player ON suspensions (player_id);
CREATE INDEX IF NOT EXISTS idx_suspensions_tournament ON suspensions (tournament_id);
CREATE INDEX IF NOT EXISTS idx_suspensions_active ON suspensions (is_active);
CREATE INDEX IF NOT EXISTS idx_complaints_match ON complaints (match_id);
CREATE INDEX IF NOT EXISTS idx_complaints_tournament ON complaints (tournament_id);
CREATE INDEX IF NOT EXISTS idx_complaints_team ON complaints (team_id);
CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints (status);
CREATE INDEX IF NOT EXISTS idx_decisions_complaint ON disciplinary_decisions (complaint_id);
`;
