import { getPool } from '../lib/db';
import { getPool as schedulingPool } from '../scheduling/lib/db';
import { config } from '../config';
import { publishMatchUpdate } from '../realtime/matchRealtime';

let timer:NodeJS.Timeout|null=null,processing=false;
/** Each target commits in its own database. A receipt/revision makes replay safe. */
export async function processAdministrativeDelivery(limit=20){
 if(processing)return 0;processing=true;let count=0;
 try{for(let i=0;i<limit;i++){
  const c=await getPool().connect();try{await c.query('BEGIN');
   const job=(await c.query('SELECT * FROM match_administrative_outbox WHERE completed_at IS NULL AND next_attempt_at<=NOW() ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1')).rows[0];
   if(!job){await c.query('COMMIT');break;}const p=job.payload;
   try{
    if(job.target==='SCHEDULING'){
     const s=await schedulingPool().connect();try{await s.query('BEGIN');
      const schedules=(await s.query("SELECT * FROM schedules WHERE match_id=$1 ORDER BY updated_at DESC LIMIT 1 FOR UPDATE",[p.matchId])).rows;
      for(const row of schedules)if(row.operation_revision<p.revision){
       await s.query("UPDATE schedules SET operation_status=$2,operation_revision=$3,operation_decision_id=$4,status=CASE WHEN $2='CANCELLED' THEN 'CANCELLED' ELSE status END,updated_at=NOW() WHERE id=$1",[row.id,p.operationStatus,p.revision,job.decision_id]);
       if(p.operationStatus==='CANCELLED'){
        await s.query("UPDATE schedule_referee_publications SET voided_at=NOW(),voided_by=$2,void_reason=$3 WHERE schedule_id=$1 AND voided_at IS NULL",[row.id,p.actorId,p.reason]);
        await s.query('UPDATE schedule_referee_assignments SET is_active=FALSE WHERE schedule_id=$1 AND is_active=TRUE',[row.id]);
       }
      }
      await s.query('COMMIT');
     }catch(e){await s.query('ROLLBACK');throw e;}finally{s.release();}
     await publishMatchUpdate(c,p.matchId,'match.schedule.administrative-state');
    }else{
     const recipients=new Set<string>();
     for(const teamId of [p.homeTeamId,p.awayTeamId].filter(Boolean)){
      const r=await fetch(new URL(`/internal/teams/${encodeURIComponent(teamId)}/captain-notification-recipient`,config.organizationServiceUrl),{headers:{'x-gateway-internal-key':config.internalApiKey},signal:AbortSignal.timeout(5000)});
      if(!r.ok)throw new Error('RECIPIENT_LOOKUP_FAILED');const b=await r.json() as {userId?:string};if(b.userId)recipients.add(b.userId);
     }
     // Preserve published recipients even when the cancellation has deactivated the crew.
     const crew=await schedulingPool().query(`SELECT DISTINCT a.referee_id FROM schedule_referee_assignments a JOIN schedules s ON s.id=a.schedule_id WHERE s.match_id=$1`,[p.matchId]);
     crew.rows.forEach(r=>recipients.add(r.referee_id));
     for(const userId of recipients){const r=await fetch(new URL('/internal/notifications',config.notificationServiceUrl),{method:'POST',headers:{'content-type':'application/json','x-internal-api-key':config.internalApiKey},signal:AbortSignal.timeout(5000),body:JSON.stringify({userId,type:'SYSTEM',title:'Quyết định tổ chức trận đấu',body:p.reason,data:{category:'MATCH_ADMINISTRATIVE_DECISION',matchId:p.matchId,tournamentId:p.tournamentId,decisionId:job.decision_id},idempotencyKey:`match-decision:${job.decision_id}:${userId}`})});if(!r.ok)throw new Error('NOTIFICATION_DELIVERY_FAILED');}
    }
    await c.query('UPDATE match_administrative_outbox SET completed_at=NOW(),attempts=attempts+1,error_code=NULL WHERE id=$1',[job.id]);count++;
   }catch{
    await c.query("UPDATE match_administrative_outbox SET attempts=attempts+1,error_code='DELIVERY_RETRY_REQUIRED',next_attempt_at=NOW()+INTERVAL '30 seconds' WHERE id=$1",[job.id]);
   }
   await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }}finally{processing=false;}return count;
}
export function startAdministrativeDelivery(){if(timer)return;timer=setInterval(()=>void processAdministrativeDelivery().catch(e=>console.error('[match-administration] delivery retry',e instanceof Error?e.message:'failed')),5000);timer.unref();}
export function stopAdministrativeDelivery(){if(timer)clearInterval(timer);timer=null;}
