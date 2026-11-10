CREATE TABLE IF NOT EXISTS role_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_role VARCHAR(50) NOT NULL,
  message TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  decision_note TEXT,
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT role_applications_role_check CHECK (
    requested_role IN ('TEAM_CAPTAIN', 'PLAYER')
  ),
  CONSTRAINT role_applications_status_check CHECK (
    status IN ('PENDING', 'APPROVED', 'REJECTED')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_role_applications_pending_unique
  ON role_applications (user_id, requested_role)
  WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_role_applications_status_created
  ON role_applications (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_role_applications_user_created
  ON role_applications (user_id, created_at DESC);

DROP TRIGGER IF EXISTS update_role_applications_updated_at ON role_applications;
CREATE TRIGGER update_role_applications_updated_at
  BEFORE UPDATE ON role_applications
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
