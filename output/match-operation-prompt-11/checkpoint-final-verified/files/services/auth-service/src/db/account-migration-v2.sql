CREATE TABLE IF NOT EXISTS staff_account_invites (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_account_invites_user_id
  ON staff_account_invites (user_id);
CREATE INDEX IF NOT EXISTS idx_staff_account_invites_pending
  ON staff_account_invites (expires_at)
  WHERE used_at IS NULL;
