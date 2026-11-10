-- Auth Service Database Schema (PostgreSQL)
-- Database: sfl_auth

-- Email verifications table
CREATE TABLE IF NOT EXISTS email_verifications (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  email VARCHAR(255) NOT NULL,
  token VARCHAR(255) NOT NULL UNIQUE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  verified_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_email_verifications_user_id ON email_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_email_verifications_token ON email_verifications(token);
CREATE INDEX IF NOT EXISTS idx_email_verifications_email ON email_verifications(email);

-- Refresh tokens table
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  token VARCHAR(255) NOT NULL UNIQUE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  revoked_at TIMESTAMP WITH TIME ZONE,
  replaced_by_token VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

DO $$
DECLARE
  user_id_type TEXT;
  has_rows BOOLEAN;
BEGIN
  SELECT data_type INTO user_id_type
  FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name = 'email_verifications'
    AND column_name = 'user_id';

  IF user_id_type IS NOT NULL AND user_id_type <> 'uuid' THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM email_verifications)' INTO has_rows;
    IF has_rows THEN
      RAISE EXCEPTION 'Cannot migrate email_verifications.user_id with existing rows';
    END IF;
    ALTER TABLE email_verifications ALTER COLUMN user_id TYPE UUID USING NULL::UUID;
  END IF;

  SELECT data_type INTO user_id_type
  FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name = 'refresh_tokens'
    AND column_name = 'user_id';

  IF user_id_type IS NOT NULL AND user_id_type <> 'uuid' THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM refresh_tokens)' INTO has_rows;
    IF has_rows THEN
      RAISE EXCEPTION 'Cannot migrate refresh_tokens.user_id with existing rows';
    END IF;
    ALTER TABLE refresh_tokens ALTER COLUMN user_id TYPE UUID USING NULL::UUID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON refresh_tokens(token);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_replaced_by ON refresh_tokens(replaced_by_token);

-- Update timestamps trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply update timestamp triggers
DROP TRIGGER IF EXISTS update_email_verifications_updated_at ON email_verifications;
CREATE TRIGGER update_email_verifications_updated_at
  BEFORE UPDATE ON email_verifications
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_refresh_tokens_updated_at ON refresh_tokens;
CREATE TRIGGER update_refresh_tokens_updated_at
  BEFORE UPDATE ON refresh_tokens
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
