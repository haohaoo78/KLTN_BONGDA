ALTER TABLE users
  ADD COLUMN IF NOT EXISTS institution_id UUID;

ALTER TABLE role_applications
  ADD COLUMN IF NOT EXISTS institution_id UUID,
  ADD COLUMN IF NOT EXISTS application_data JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_role_applications_school_status_created
  ON role_applications (institution_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_users_institution
  ON users (institution_id);
