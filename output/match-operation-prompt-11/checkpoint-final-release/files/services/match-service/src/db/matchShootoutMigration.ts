import {Pool} from 'pg';
export const matchShootoutSql=`
 CREATE TABLE match_shootouts(match_id UUID PRIMARY KEY REFERENCES matches(id),version INTEGER NOT NULL CHECK(version>0),state JSONB NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_by UUID NOT NULL);
 CREATE TABLE match_shootout_history(id BIGSERIAL PRIMARY KEY,match_id UUID NOT NULL REFERENCES matches(id),version INTEGER NOT NULL,operation_id UUID NOT NULL,request_hash TEXT NOT NULL,action TEXT NOT NULL,actor_id UUID NOT NULL,reason TEXT,before_snapshot JSONB,after_snapshot JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(match_id,version),UNIQUE(match_id,operation_id));
 CREATE FUNCTION protect_match_shootout_history() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'Shootout history is append-only'; END; $$ LANGUAGE plpgsql;
 CREATE TRIGGER protect_match_shootout_history BEFORE UPDATE OR DELETE ON match_shootout_history FOR EACH ROW EXECUTE FUNCTION protect_match_shootout_history();
 ALTER TABLE match_results ADD COLUMN score_source TEXT, ADD COLUMN winner_team_id UUID, ADD COLUMN finished_at TIMESTAMPTZ;
 ALTER TABLE match_results ADD CONSTRAINT match_result_score_source_check CHECK(score_source IS NULL OR score_source='EVENTS_V1');
`;
export async function applyMatchShootoutMigration(url:string){const p=new Pool({connectionString:url}),c=await p.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)');if(!(await c.query('SELECT 1 FROM sfl_schema_migrations WHERE version=26')).rowCount){await c.query(matchShootoutSql);await c.query("INSERT INTO sfl_schema_migrations(version,name) VALUES(26,'audited-per-kick-shootout-and-stage-results')");}await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();await p.end();}}
