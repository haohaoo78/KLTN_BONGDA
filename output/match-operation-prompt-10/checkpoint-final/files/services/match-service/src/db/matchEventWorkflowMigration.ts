import {Pool} from 'pg';
export const matchEventWorkflowSql=`
 ALTER TABLE match_events DROP CONSTRAINT match_events_type_check;
 ALTER TABLE match_events ADD CONSTRAINT match_events_type_check CHECK(event_type IN ('GOAL','PENALTY_GOAL','OWN_GOAL','YELLOW_CARD','SECOND_YELLOW_CARD','RED_CARD','SUBSTITUTION_OUT','SUBSTITUTION_IN','INJURY','PLAYER_LEAVE','PLAYER_RETURN','REPLACEMENT_IN','INCIDENT')),
 ADD COLUMN operation_id UUID, ADD COLUMN request_hash TEXT,ADD COLUMN substitution_id UUID,ADD COLUMN related_player_id UUID,ADD COLUMN opportunity_id UUID,
 ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),ADD COLUMN supersedes_event_id UUID REFERENCES match_events(id),ADD COLUMN logical_sequence BIGINT,
 ADD COLUMN visibility VARCHAR(20) NOT NULL DEFAULT 'PUBLIC' CHECK(visibility IN ('PUBLIC','CREW'));
 ALTER TABLE match_events DROP CONSTRAINT match_events_phase_check;
 ALTER TABLE match_events ADD CONSTRAINT match_events_phase_check CHECK(phase IN ('NOT_STARTED','FIRST_HALF','HALF_TIME','SECOND_HALF','REGULATION_COMPLETE','EXTRA_TIME_FIRST_HALF','EXTRA_TIME_HALF_TIME','EXTRA_TIME_SECOND_HALF','EXTRA_TIME_COMPLETE','PENALTIES','ENDED'));
 CREATE UNIQUE INDEX match_event_operation_once ON match_events(match_id,operation_id,event_type) WHERE operation_id IS NOT NULL;
 CREATE INDEX match_event_substitution ON match_events(substitution_id) WHERE substitution_id IS NOT NULL;
 CREATE FUNCTION protect_match_event_history() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'Event history is append-only'; END; $$ LANGUAGE plpgsql;
 CREATE TRIGGER protect_match_event_history BEFORE UPDATE OR DELETE ON match_event_history FOR EACH ROW EXECUTE FUNCTION protect_match_event_history();
`;
export async function applyMatchEventWorkflowMigration(url:string){const pool=new Pool({connectionString:url}),c=await pool.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)');if(!(await c.query('SELECT 1 FROM sfl_schema_migrations WHERE version=25')).rowCount){await c.query(matchEventWorkflowSql);await c.query("INSERT INTO sfl_schema_migrations(version,name) VALUES(25,'atomic-match-events-and-operation-idempotency')");}await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();await pool.end();}}
