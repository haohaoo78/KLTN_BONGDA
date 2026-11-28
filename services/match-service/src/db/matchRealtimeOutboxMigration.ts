import { Pool } from 'pg';

export const matchRealtimeOutboxSql=`
 ALTER TABLE match_realtime_events
  ADD COLUMN source_system VARCHAR(30), ADD COLUMN source_event_id BIGINT;
 CREATE UNIQUE INDEX match_realtime_source_once
  ON match_realtime_events(source_system,source_event_id) WHERE source_system IS NOT NULL AND source_event_id IS NOT NULL;
`;

export const schedulingRealtimeOutboxSql=`
 CREATE TABLE scheduling_realtime_outbox(
  id BIGSERIAL PRIMARY KEY,match_id UUID NOT NULL,event_type TEXT NOT NULL,source_table TEXT NOT NULL,source_operation TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_until TIMESTAMPTZ,dispatched_at TIMESTAMPTZ,last_error TEXT
 );
 CREATE INDEX scheduling_realtime_outbox_pending ON scheduling_realtime_outbox(next_attempt_at,id) WHERE dispatched_at IS NULL;
 CREATE FUNCTION enqueue_scheduling_realtime_event() RETURNS trigger AS $$
 DECLARE sid UUID; mid UUID; op TEXT; kind TEXT;
 BEGIN
  op:=TG_OP;
  IF TG_TABLE_NAME='schedules' THEN
   sid:=CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
   mid:=CASE WHEN TG_OP='DELETE' THEN OLD.match_id ELSE NEW.match_id END;
  ELSE
   sid:=CASE WHEN TG_OP='DELETE' THEN OLD.schedule_id ELSE NEW.schedule_id END;
   SELECT match_id INTO mid FROM schedules WHERE id=sid;
  END IF;
  IF mid IS NULL THEN IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
  kind:=CASE
   WHEN TG_TABLE_NAME='schedule_referee_assignments' OR TG_TABLE_NAME='schedule_referee_publications' OR TG_TABLE_NAME='schedule_referee_drafts' OR TG_TABLE_NAME='schedule_referee_draft_slots' THEN 'referees.changed'
   ELSE 'schedule.changed' END;
  INSERT INTO scheduling_realtime_outbox(match_id,event_type,source_table,source_operation) VALUES(mid,kind,TG_TABLE_NAME,op);
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
 END; $$ LANGUAGE plpgsql;
 CREATE TRIGGER scheduling_realtime_outbox AFTER INSERT OR UPDATE OR DELETE ON schedules FOR EACH ROW EXECUTE FUNCTION enqueue_scheduling_realtime_event();
 CREATE TRIGGER scheduling_realtime_outbox AFTER INSERT OR UPDATE OR DELETE ON schedule_referee_assignments FOR EACH ROW EXECUTE FUNCTION enqueue_scheduling_realtime_event();
 CREATE TRIGGER scheduling_realtime_outbox AFTER INSERT OR UPDATE OR DELETE ON schedule_referee_publications FOR EACH ROW EXECUTE FUNCTION enqueue_scheduling_realtime_event();
 CREATE TRIGGER scheduling_realtime_outbox AFTER INSERT OR UPDATE OR DELETE ON schedule_referee_drafts FOR EACH ROW EXECUTE FUNCTION enqueue_scheduling_realtime_event();
 CREATE TRIGGER scheduling_realtime_outbox AFTER INSERT OR UPDATE OR DELETE ON schedule_referee_draft_slots FOR EACH ROW EXECUTE FUNCTION enqueue_scheduling_realtime_event();
`;

async function apply(url:string,version:number,name:string,sql:string){
 const p=new Pool({connectionString:url}),c=await p.connect();
 try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)');
  if(!(await c.query('SELECT 1 FROM sfl_schema_migrations WHERE version=$1',[version])).rowCount){await c.query(sql);await c.query('INSERT INTO sfl_schema_migrations(version,name) VALUES($1,$2)',[version,name]);}
  await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();await p.end();}
}
export const applyMatchRealtimeOutboxMigration=(url:string)=>apply(url,31,'ordered-idempotent-realtime-replay-and-snapshot-cursor',matchRealtimeOutboxSql);
export const applySchedulingRealtimeOutboxMigration=(url:string)=>apply(url,1015,'transactional-scheduling-realtime-outbox',schedulingRealtimeOutboxSql);
