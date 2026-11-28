import {Pool} from "pg";
export const matchClockTimingSql=`
 ALTER TABLE match_clock_states ADD COLUMN phase_started_at TIMESTAMPTZ,
  ADD COLUMN actual_started_at TIMESTAMPTZ, ADD COLUMN actual_ended_at TIMESTAMPTZ,
  ADD COLUMN elapsed_milliseconds BIGINT, ADD COLUMN total_elapsed_milliseconds BIGINT,
  ADD COLUMN added_time_seconds INTEGER NOT NULL DEFAULT 0 CHECK(added_time_seconds>=0),
  ADD COLUMN interruption_kind VARCHAR(30) CHECK(interruption_kind IN ('CLOCK_STOP','PLAY_SUSPENDED','POSTPONED','ABANDONED','CANCELLED')),
  ADD COLUMN interruption_reason TEXT,ADD COLUMN timing_model_version INTEGER NOT NULL DEFAULT 0 CHECK(timing_model_version IN (0,1));
 CREATE TABLE match_clock_action_history (
  id BIGSERIAL PRIMARY KEY,match_id UUID NOT NULL REFERENCES matches(id),version INTEGER NOT NULL,
  action VARCHAR(40) NOT NULL,actor_id UUID NOT NULL,reason TEXT,before_snapshot JSONB NOT NULL,after_snapshot JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(match_id,version)
 );
 CREATE FUNCTION protect_match_clock_action_history() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'Clock action history is append-only'; END; $$ LANGUAGE plpgsql;
 CREATE TRIGGER protect_match_clock_action_history BEFORE UPDATE OR DELETE ON match_clock_action_history FOR EACH ROW EXECUTE FUNCTION protect_match_clock_action_history();
 ALTER TABLE match_events DROP CONSTRAINT IF EXISTS match_events_minute_check;
 ALTER TABLE match_events ADD CONSTRAINT match_events_minute_check CHECK(minute IS NULL OR minute>=0),
  ADD COLUMN phase VARCHAR(40) CHECK(phase IN ('FIRST_HALF','SECOND_HALF','EXTRA_TIME_FIRST_HALF','EXTRA_TIME_SECOND_HALF','PENALTIES')),
  ADD COLUMN period_elapsed_seconds INTEGER CHECK(period_elapsed_seconds>=0),
  ADD COLUMN added_time_seconds INTEGER CHECK(added_time_seconds>=0),ADD COLUMN event_sequence BIGSERIAL;
 CREATE UNIQUE INDEX match_events_sequence ON match_events(event_sequence);
`;
export async function applyMatchClockTimingMigration(databaseUrl:string){
 const p=new Pool({connectionString:databaseUrl}),c=await p.connect();try{await c.query("BEGIN");await c.query("SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)");
 if(!(await c.query("SELECT 1 FROM sfl_schema_migrations WHERE version=24")).rowCount){await c.query(matchClockTimingSql);await c.query("INSERT INTO sfl_schema_migrations(version,name) VALUES(24,'period-clock-timing-and-interruption-audit')");}await c.query("COMMIT");
 }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();await p.end();}
}
