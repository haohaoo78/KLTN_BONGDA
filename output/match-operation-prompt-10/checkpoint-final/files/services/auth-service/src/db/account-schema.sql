CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  student_id VARCHAR(50),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  email_verified BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower_unique ON users (LOWER(email));

CREATE TABLE IF NOT EXISTS user_roles (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL,
  PRIMARY KEY (user_id, role),
  CONSTRAINT user_roles_role_check CHECK (
    role IN ('ADMIN', 'BTC', 'TEAM_CAPTAIN', 'PLAYER', 'REFEREE', 'VIEWER')
  )
);

ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;
ALTER TABLE user_roles ADD CONSTRAINT user_roles_role_check CHECK (
  role IN ('ADMIN', 'BTC', 'TEAM_CAPTAIN', 'PLAYER', 'REFEREE', 'VIEWER')
);

CREATE TABLE IF NOT EXISTS password_resets (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token VARCHAR(255) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
DECLARE
  user_id_type TEXT;
BEGIN
  SELECT data_type INTO user_id_type
  FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name = 'password_resets'
    AND column_name = 'user_id';

  IF user_id_type IS NOT NULL AND user_id_type <> 'uuid' THEN
    IF EXISTS (SELECT 1 FROM password_resets) THEN
      RAISE EXCEPTION 'Cannot migrate password_resets.user_id with existing rows';
    END IF;
    ALTER TABLE password_resets ALTER COLUMN user_id TYPE UUID USING NULL::UUID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'password_resets_user_id_fkey'
      AND conrelid = 'password_resets'::regclass
  ) THEN
    ALTER TABLE password_resets
      ADD CONSTRAINT password_resets_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_password_resets_user_id ON password_resets (user_id);
CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets (token);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_password_resets_updated_at ON password_resets;
CREATE TRIGGER update_password_resets_updated_at
  BEFORE UPDATE ON password_resets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
