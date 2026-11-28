import { Pool } from "pg";
export const matchSquadSql=`
 ALTER TABLE lineups DROP CONSTRAINT IF EXISTS lineups_jersey_check;
 ALTER TABLE lineups ADD CONSTRAINT lineups_jersey_check CHECK(jersey_number IS NULL OR jersey_number>0);
 CREATE TABLE IF NOT EXISTS match_squads (
  match_id UUID NOT NULL REFERENCES matches(id),team_id UUID NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),
  status VARCHAR(30) NOT NULL CHECK(status IN ('DRAFT','SUBMITTED','CHANGES_REQUESTED')),
  submitted_by UUID,submitted_at TIMESTAMPTZ,reviewed_by UUID,reviewed_at TIMESTAMPTZ,
  roster_revision TEXT,rules_revision TEXT,note TEXT,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(match_id,team_id)
 );
 CREATE TABLE IF NOT EXISTS match_squad_history (
  id BIGSERIAL PRIMARY KEY,match_id UUID NOT NULL REFERENCES matches(id),team_id UUID,revision INTEGER NOT NULL,
  action VARCHAR(40) NOT NULL,actor_id UUID NOT NULL,reason TEXT,snapshot JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 );
 CREATE TABLE IF NOT EXISTS match_preparation_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),match_id UUID NOT NULL REFERENCES matches(id),team_id UUID,
  kind VARCHAR(40) NOT NULL CHECK(kind IN ('TEAM_ABSENT','INSUFFICIENT_PLAYERS','INELIGIBLE_PLAYER','VENUE_UNSAFE','OTHER')),
  description TEXT NOT NULL CHECK(length(trim(description))>0),created_by UUID NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_by UUID,resolved_at TIMESTAMPTZ,resolution TEXT
 );
 CREATE INDEX IF NOT EXISTS match_squad_history_match ON match_squad_history(match_id,id);
 CREATE OR REPLACE FUNCTION protect_match_squad_history() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'Squad history is append-only'; END; $$ LANGUAGE plpgsql;
 CREATE TRIGGER protect_match_squad_history BEFORE UPDATE OR DELETE ON match_squad_history FOR EACH ROW EXECUTE FUNCTION protect_match_squad_history();
`;
export async function applyMatchSquadMigration(databaseUrl:string){
 const pool=new Pool({connectionString:databaseUrl}),c=await pool.connect();
 try{await c.query("BEGIN");await c.query("SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)");
  if(!(await c.query("SELECT 1 FROM sfl_schema_migrations WHERE version=23")).rowCount){await c.query(matchSquadSql);await c.query("INSERT INTO sfl_schema_migrations(version,name) VALUES(23,'versioned-match-squads-and-preparation-issues')");}
  await c.query("COMMIT");
 }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();await pool.end();}
}
