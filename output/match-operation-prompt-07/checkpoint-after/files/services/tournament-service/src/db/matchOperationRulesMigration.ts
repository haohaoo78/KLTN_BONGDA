/** Additive only: no updates to published regulations, draws or fixtures. */
export const matchOperationRulesSql = `
  CREATE TABLE IF NOT EXISTS regulation_operation_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id UUID NOT NULL REFERENCES tournaments(id),
    base_regulation_version INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    status VARCHAR(16) NOT NULL CHECK (status IN ('DRAFT','PUBLISHED')),
    rules JSONB NOT NULL CHECK (jsonb_typeof(rules)='object'),
    reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_by UUID,
    published_at TIMESTAMPTZ,
    UNIQUE (tournament_id, revision),
    FOREIGN KEY (tournament_id, base_regulation_version) REFERENCES regulation_versions(tournament_id, version),
    CHECK ((status='DRAFT' AND published_by IS NULL AND published_at IS NULL) OR
           (status='PUBLISHED' AND published_by IS NOT NULL AND published_at IS NOT NULL))
  );
  CREATE INDEX IF NOT EXISTS idx_regulation_operation_rules_base
    ON regulation_operation_rules(tournament_id, base_regulation_version, revision DESC);
  CREATE OR REPLACE FUNCTION protect_published_operation_rules() RETURNS trigger AS $$
  BEGIN
    IF TG_OP='DELETE' OR OLD.status='PUBLISHED' OR
       NEW.id<>OLD.id OR NEW.tournament_id<>OLD.tournament_id OR
       NEW.base_regulation_version<>OLD.base_regulation_version OR NEW.revision<>OLD.revision OR
       NEW.rules<>OLD.rules OR NEW.reason<>OLD.reason OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at THEN
      RAISE EXCEPTION 'Operation rule versions are immutable; create a new revision';
    END IF;
    RETURN NEW;
  END; $$ LANGUAGE plpgsql;
  DROP TRIGGER IF EXISTS protect_operation_rule_version ON regulation_operation_rules;
  CREATE TRIGGER protect_operation_rule_version BEFORE UPDATE OR DELETE ON regulation_operation_rules
    FOR EACH ROW EXECUTE FUNCTION protect_published_operation_rules();
`;
