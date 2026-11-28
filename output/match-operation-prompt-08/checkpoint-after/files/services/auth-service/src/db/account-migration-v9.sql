CREATE TABLE IF NOT EXISTS referee_account_requests (
  actor_user_id UUID NOT NULL REFERENCES users(id),
  tournament_id UUID NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  request_hash VARCHAR(64) NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id),
  account_created BOOLEAN NOT NULL,
  role_added BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(actor_user_id,tournament_id,idempotency_key)
);

CREATE TABLE IF NOT EXISTS referee_account_access_deliveries (
  event_key VARCHAR(255) PRIMARY KEY,
  actor_user_id UUID NOT NULL REFERENCES users(id),
  tournament_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id),
  request_hash VARCHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK(status IN ('PENDING','SENT','FAILED')),
  error_code VARCHAR(80),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_referee_access_deliveries_user_created ON referee_account_access_deliveries(user_id,created_at DESC);
