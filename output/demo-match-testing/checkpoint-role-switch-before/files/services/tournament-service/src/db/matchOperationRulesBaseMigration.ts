/** New version: migration 26 has already been applied and must stay unchanged. */
export const matchOperationRulesBaseSql = `
  ALTER TABLE regulation_operation_rules ADD COLUMN IF NOT EXISTS base_snapshot JSONB
    CHECK (base_snapshot IS NULL OR jsonb_typeof(base_snapshot)='object');
  CREATE OR REPLACE FUNCTION protect_published_operation_rules() RETURNS trigger AS $$
  BEGIN
    IF TG_OP='DELETE' OR OLD.status='PUBLISHED' OR
       NEW.id<>OLD.id OR NEW.tournament_id<>OLD.tournament_id OR
       NEW.base_regulation_version<>OLD.base_regulation_version OR NEW.revision<>OLD.revision OR
       NEW.rules<>OLD.rules OR NEW.reason<>OLD.reason OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at OR
       NEW.base_snapshot IS DISTINCT FROM OLD.base_snapshot THEN
      RAISE EXCEPTION 'Operation rule versions are immutable; create a new revision';
    END IF;
    RETURN NEW;
  END; $$ LANGUAGE plpgsql;
`;
