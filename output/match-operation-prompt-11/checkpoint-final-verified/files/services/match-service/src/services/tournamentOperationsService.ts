import type { PoolClient } from 'pg';
import { getPool } from '../lib/db';
import { getPool as disciplinePool } from '../discipline/lib/db';
import { getPool as schedulingPool } from '../scheduling/lib/db';
import { AppError } from '../lib/errors';
import { config } from '../config';
import { getPublishedDraw } from './fixtureGenerationService';
import { computeCompetitionStandings } from '../repositories/competitionProjectionRepository';
import { teamDetail } from './refereePortalService';
import { complaintDeadline } from './complaintDeadlineService';
type Query=Pick<PoolClient,'query'>;
type Row=Record<string,any>;
export async function operationGovernance(tournamentId:string){
 let r:Response;try{r=await fetch(new URL(`/internal/tournaments/${encodeURIComponent(tournamentId)}/operation-governance`,config.tournamentServiceUrl),{headers:{'x-gateway-internal-key':config.internalApiKey},signal:AbortSignal.timeout(8000)});}catch{throw new AppError(503,'Không đọc được quy tắc quản lý giải chính thức.','TOURNAMENT_GOVERNANCE_UNAVAILABLE');}
 if(!r.ok)throw new AppError(502,'Không xác minh được quy tắc quản lý giải.','TOURNAMENT_GOVERNANCE_UNAVAILABLE');return (await r.json() as {governance:Row}).governance;
}
export async function tournamentOperationSummary(tournamentId:string,q:Query=getPool(),dq:Query=disciplinePool()){
 const governance=await operationGovernance(tournamentId),blockers:Array<{code:string;message:string;matchId?:string}>=[];
 let draw:Awaited<ReturnType<typeof getPublishedDraw>>|null=null;
 try{draw=await getPublishedDraw(tournamentId);}catch(e){if(!(e instanceof AppError)||e.code!=='PUBLISHED_DRAW_REQUIRED')throw e;}
 const rows=(await q.query(`SELECT m.*,r.status AS result_status,r.home_score,r.away_score,r.home_extra_time_score,r.away_extra_time_score,r.home_penalty_score,r.away_penalty_score,r.result_origin,r.winner_team_id,
  report.status AS report_status,report.requires_organizer_review,
  c.phase,c.is_running,c.actual_started_at,c.actual_ended_at,
  EXISTS(SELECT 1 FROM match_forfeit_decisions f WHERE f.match_id=m.id) AS forfeit,
  (SELECT row_to_json(d) FROM match_administrative_decisions d WHERE d.match_id=m.id AND d.action IN ('CANCEL','RECOGNIZE') ORDER BY revision DESC LIMIT 1) AS resolution,
  slot.status AS slot_status,slot.slot_type,slot.round_number AS bracket_round,slot.winner_team_id AS bracket_winner,
  (SELECT COUNT(*)::int FROM match_administrative_cases a WHERE a.match_id=m.id AND a.resolved_at IS NULL) AS open_cases,
  (SELECT COUNT(*)::int FROM match_preparation_issues a WHERE a.match_id=m.id AND a.resolved_at IS NULL) AS preparation_issues,
  (SELECT COUNT(*)::int FROM match_pause_requests a WHERE a.match_id=m.id AND a.status='PENDING') AS pending_pause,
  g.publication_status AS fixture_publication
  FROM matches m LEFT JOIN match_results r ON r.match_id=m.id LEFT JOIN match_reports report ON report.match_id=m.id
  LEFT JOIN match_clock_states c ON c.match_id=m.id LEFT JOIN match_bracket_slots slot ON slot.match_id=m.id
  LEFT JOIN match_fixture_generations g ON g.draw_version_id=m.draw_version_id AND g.stage=m.stage
  WHERE m.tournament_id=$1 AND ($2::uuid IS NULL OR m.draw_version_id=$2) ORDER BY m.match_date NULLS LAST,m.stage,m.round_number,m.id`,[tournamentId,draw?.id??null])).rows as Row[];
 const fixtures=rows.filter(m=>m.slot_status!=='BYE');
 for(const m of fixtures){
  const official=['VERIFIED','LOCKED'].includes(m.status)&&m.result_status==='APPROVED';
  const cancelled=m.status==='CANCELLED'&&m.resolution?.action==='CANCEL'&&m.resolution.rule_snapshot?.rules?.values?.cancelledMatchPolicy==='EXCLUDE_FROM_COMPETITION';
  m.resolved=official&&(m.report_status==='APPROVED'||m.forfeit||m.resolution?.action==='RECOGNIZE')||cancelled;
  m.missing_report=m.status==='FINISHED'&&m.report_status!=='APPROVED'&&!m.forfeit&&!m.resolution;
  m.needs_organizer=Boolean(m.open_cases||m.preparation_issues||m.pending_pause||m.requires_organizer_review&&m.report_status==='PENDING'||m.status==='POSTPONED');
  if(m.fixture_publication!=='PUBLISHED')blockers.push({code:'FIXTURE_NOT_PUBLISHED',message:'Sơ đồ trận chưa công bố.',matchId:m.id});
  if(!m.resolved)blockers.push({code:'MATCH_UNRESOLVED',message:'Trận chưa có kết quả chính thức hoặc quyết định giải quyết hợp lệ.',matchId:m.id});
  if(m.open_cases||m.preparation_issues||m.pending_pause)blockers.push({code:'MATCH_INCIDENT_OPEN',message:'Còn hồ sơ sự cố hoặc yêu cầu hoãn chưa xử lý.',matchId:m.id});
  if(m.is_running)blockers.push({code:'CLOCK_RUNNING',message:'Đồng hồ trận vẫn đang chạy.',matchId:m.id});
 }
 const [complaints,appeals,corrections,conflicts,pending,disciplinePending,disciplineFence]=await Promise.all([
  dq.query("SELECT id,match_id,status FROM complaints WHERE tournament_id=$1 AND status IN ('PENDING','UNDER_REVIEW')",[tournamentId]),
  dq.query("SELECT a.id,c.match_id FROM complaint_appeals a JOIN complaints c ON c.id=a.complaint_id WHERE c.tournament_id=$1 AND a.status='PENDING'",[tournamentId]),
  q.query("SELECT id,match_id FROM match_result_correction_requests WHERE tournament_id=$1 AND status='PENDING'",[tournamentId]),
  q.query('SELECT id,match_id,kind FROM competition_projection_conflicts WHERE tournament_id=$1 AND resolved_at IS NULL',[tournamentId]),
  q.query("SELECT id,target FROM match_administrative_outbox WHERE payload->>'tournamentId'=$1 AND completed_at IS NULL",[tournamentId]),
  q.query("SELECT id FROM match_event_discipline_outbox WHERE payload->>'tournamentId'=$1 AND processed_at IS NULL",[tournamentId]),
  dq.query('SELECT request_id,state,prepared_at,completed_at FROM tournament_operation_completion_fences WHERE tournament_id=$1',[tournamentId])]);
 const v=governance.values;
 if((complaints.rowCount||appeals.rowCount)&&v.complaintsBlockCompletion!=='NO')blockers.push({code:'OPEN_COMPLAINTS',message:v.complaintsBlockCompletion==='YES'?'Còn khiếu nại/kháng nghị đang mở có ảnh hưởng theo điều lệ.':'Chưa xác định chính sách kết thúc khi còn khiếu nại/kháng nghị mở.'});
 if(corrections.rowCount)blockers.push({code:'CORRECTIONS_PENDING',message:'Còn yêu cầu điều chỉnh kết quả chưa giải quyết.'});
 if(conflicts.rowCount)blockers.push({code:'PROJECTION_CONFLICTS',message:'Còn xung đột đội đi tiếp hoặc thứ hạng cần BTC giải quyết.'});
 if(pending.rowCount||disciplinePending.rowCount)blockers.push({code:'SYNCHRONIZATION_PENDING',message:'Đồng bộ lịch, thông báo hoặc kỷ luật chưa hoàn tất. Xem trạng thái giao nhận, không kết luận đã đồng bộ.'});
 if(v.completionWaitPolicy==='WAIT_DECLARED_WINDOWS'){
  for(const m of fixtures.filter(m=>m.result_status==='APPROVED')){
   try{const deadline=await complaintDeadline(m.id,undefined,q);if(!deadline.expired)blockers.push({code:'COMPLAINT_WINDOW_OPEN',message:'Điều lệ yêu cầu chờ hết thời hạn khiếu nại.',matchId:m.id});}
   catch(e){blockers.push({code:'COMPLAINT_POLICY_UNDEFINED',message:e instanceof Error?e.message:'Thiếu quy tắc khiếu nại.',matchId:m.id});}
  }
  const decisions=(await dq.query("SELECT match_id,reviewed_at FROM complaints WHERE tournament_id=$1 AND status IN ('APPROVED','REJECTED','CLOSED')",[tournamentId])).rows;
  for(const d of decisions){try{const deadline=await complaintDeadline(d.match_id,new Date(d.reviewed_at).toISOString(),q);if(!deadline.expired)blockers.push({code:'APPEAL_WINDOW_OPEN',message:'Điều lệ yêu cầu chờ hết hạn kháng nghị.',matchId:d.match_id});}catch(e){blockers.push({code:'APPEAL_POLICY_UNDEFINED',message:e instanceof Error?e.message:'Thiếu quy tắc kháng nghị.',matchId:d.match_id});}}
 }
 if(v.tournamentCompletionPolicy!=='BTC_CONFIRM')blockers.push({code:'COMPLETION_AUTHORITY_UNDEFINED',message:'Chưa xác định quy trình xác nhận kết thúc giải trong bản bổ sung điều lệ.'});
 if(!draw||!fixtures.length)blockers.push({code:'PUBLISHED_FIXTURES_REQUIRED',message:'Cần sơ đồ thi đấu chính thức có trận hợp lệ.'});
 let standings:Row[]=[];let championTeamId:string|null=null;
 if(draw){
  if(draw.config?.fixtureRegulationSnapshot?.competitionFormat==='ROUND_ROBIN'||fixtures.some(m=>m.stage==='GROUP')){
   try{const table=await computeCompetitionStandings(tournamentId,q);standings=table.groups.map(g=>({...g}));if(table.competitionFormat==='ROUND_ROBIN')championTeamId=table.groups.length===1?table.groups[0].championTeamId:null;}
   catch(e){blockers.push({code:'STANDINGS_UNRESOLVED',message:e instanceof Error?e.message:'Chưa tính được BXH.'});}
  }
  const finals=fixtures.filter(m=>m.stage==='KNOCKOUT'&&m.slot_type!=='THIRD_PLACE').sort((a,b)=>(b.bracket_round??0)-(a.bracket_round??0));
  if(finals.length){const final=finals[0];if(final.resolved&&final.result_status==='APPROVED')championTeamId=final.bracket_winner??final.winner_team_id??null;}
 }
 if(!championTeamId)blockers.push({code:'CHAMPION_UNRESOLVED',message:'Chưa xác định được đội vô địch từ BXH cuối hoặc trận chung kết có kết quả chính thức.'});
 const fence=(await q.query('SELECT request_id,state,prepared_at,completed_at FROM competition_completion_fences WHERE tournament_id=$1',[tournamentId])).rows[0]??null;
 const stats={total:fixtures.length,notStarted:fixtures.filter(m=>['UNSCHEDULED','SCHEDULED','LINEUP_CONFIRMED'].includes(m.status)).length,inProgress:fixtures.filter(m=>m.status==='IN_PROGRESS').length,fieldFinished:fixtures.filter(m=>m.status==='FINISHED').length,official:fixtures.filter(m=>m.result_status==='APPROVED').length,missingReports:fixtures.filter(m=>m.missing_report).length,needsOrganizer:fixtures.filter(m=>m.needs_organizer).length,resolved:fixtures.filter(m=>m.resolved).length,byes:rows.length-fixtures.length};
 return {tournamentId,governance,stats,matches:fixtures,standings,championTeamId,blockers,canComplete:!blockers.length,open:{complaints:complaints.rows,appeals:appeals.rows,corrections:corrections.rows,conflicts:conflicts.rows},synchronization:{pending:pending.rowCount??0,disciplinePending:disciplinePending.rowCount??0},fence,disciplineFence:disciplineFence.rows[0]??null};
}
export async function tournamentOperationsWorkspace(tournamentId:string){
 const summary=await tournamentOperationSummary(tournamentId);
 const draw=await getPublishedDraw(tournamentId);
 const ids=[...new Set([...summary.matches.flatMap(m=>[m.home_team_id,m.away_team_id]),summary.championTeamId].filter((id):id is string=>Boolean(id)))];
 const identities=await Promise.all(ids.map(async id=>[id,(await teamDetail(id)).team] as const)),teamMap=Object.fromEntries(identities);
 const crew=(await schedulingPool().query(`SELECT s.match_id,a.position,a.referee_id,a.is_final_authority,
  COALESCE(msg.payload->>'fullName','Chưa cập nhật tên trọng tài') AS full_name
  FROM schedules s JOIN schedule_referee_assignments a ON a.schedule_id=s.id AND a.is_active=TRUE
  LEFT JOIN LATERAL (SELECT payload FROM referee_assignment_messages WHERE schedule_id=s.id AND referee_id=a.referee_id ORDER BY created_at DESC LIMIT 1) msg ON TRUE
  WHERE s.tournament_id=$1`,[tournamentId])).rows as Row[];
 const schedules=(await schedulingPool().query(`SELECT s.match_id,s.scheduled_date,s.duration_minutes,s.status AS schedule_status,s.operation_status,s.is_locked,v.name AS venue_name,v.location AS venue_location
  FROM schedules s LEFT JOIN venues v ON v.id=s.venue_id WHERE s.tournament_id=$1 AND s.status<>'CANCELLED'`,[tournamentId])).rows as Row[];
 const groupNames=new Map(draw.groups.map(g=>[g.id,g.name])),scheduleMap=new Map(schedules.map(s=>[s.match_id,s]));
 const crewMap=new Map<string,Row[]>();for(const a of crew)crewMap.set(a.match_id,[...(crewMap.get(a.match_id)??[]),{position:a.position,fullName:a.full_name,isFinalAuthority:a.is_final_authority}]);
 const matches=summary.matches.map(m=>{const s=scheduleMap.get(m.id);return {id:m.id,status:m.status,stage:m.stage,round:m.round,roundNumber:m.round_number,leg:m.leg,groupName:groupNames.get(m.group_id)??null,
  matchDate:s?.scheduled_date??m.match_date,venue:s?.venue_name??m.venue,venueLocation:s?.venue_location??null,
  homeTeamId:m.home_team_id,awayTeamId:m.away_team_id,homeTeam:m.home_team_id?teamMap[m.home_team_id]??null:null,awayTeam:m.away_team_id?teamMap[m.away_team_id]??null:null,
  homeScore:m.home_score,awayScore:m.away_score,homeExtraTimeScore:m.home_extra_time_score,awayExtraTimeScore:m.away_extra_time_score,homePenaltyScore:m.home_penalty_score,awayPenaltyScore:m.away_penalty_score,
  resultStatus:m.result_status,reportStatus:m.report_status,fixturePublished:m.fixture_publication==='PUBLISHED',forfeit:m.forfeit===true,resolved:m.resolved,
  missingReport:m.missing_report,needsOrganizer:m.needs_organizer,slotType:m.slot_type,openCases:m.open_cases,pendingPause:m.pending_pause,
  crew:crewMap.get(m.id)??[],scheduleStatus:s?.schedule_status??null,scheduleOperationStatus:s?.operation_status??null,hasLockedSchedule:s?.is_locked===true};});
 return {...summary,matches,teams:teamMap,crew};
}
export async function prepareTournamentCompletion(tournamentId:string,requestId:string){
 const d=await disciplinePool().connect();let activeRequestId=requestId,disciplineFenceCreated=false,resumed=false,preview:Row|null=null;
 try{
  await d.query('BEGIN');await d.query('SELECT pg_advisory_xact_lock(hashtextextended($1,10))',[tournamentId]);
  const oldD=(await d.query('SELECT * FROM tournament_operation_completion_fences WHERE tournament_id=$1 FOR UPDATE',[tournamentId])).rows[0];
  if(oldD){activeRequestId=oldD.request_id;resumed=true;}
  else{
   preview=await tournamentOperationSummary(tournamentId,getPool(),d);
   if(!preview.canComplete)throw new AppError(409,'Giải chưa đủ điều kiện kết thúc.','MATCHES_NOT_FINAL',{blockers:preview.blockers});
   await d.query("INSERT INTO tournament_operation_completion_fences(tournament_id,request_id,state,snapshot) VALUES($1,$2,'PREPARED',$3::jsonb)",[tournamentId,activeRequestId,JSON.stringify(preview)]);
   disciplineFenceCreated=true;
  }
  await d.query('COMMIT');
 }catch(e){await d.query('ROLLBACK');throw e;}finally{d.release();}
 const c=await getPool().connect();try{
  await c.query('BEGIN');await c.query('SELECT id FROM matches WHERE tournament_id=$1 ORDER BY id FOR UPDATE',[tournamentId]);
  const old=(await c.query('SELECT * FROM competition_completion_fences WHERE tournament_id=$1 FOR UPDATE',[tournamentId])).rows[0];
  if(old){activeRequestId=old.request_id;resumed=true;}
  else{
   const readiness=await tournamentOperationSummary(tournamentId,c,disciplinePool());
   if(!readiness.canComplete)throw new AppError(409,'Giải chưa đủ điều kiện kết thúc.','MATCHES_NOT_FINAL',{blockers:readiness.blockers});
   await c.query("INSERT INTO competition_completion_fences(tournament_id,request_id,state,snapshot) VALUES($1,$2,'PREPARED',$3::jsonb)",[tournamentId,activeRequestId,JSON.stringify(readiness)]);
   preview=readiness as Row;
  }
  await c.query('COMMIT');return {...(preview??old.snapshot),requestId:activeRequestId,resumed};
 }catch(e){await c.query('ROLLBACK');if(disciplineFenceCreated){await disciplinePool().query("DELETE FROM tournament_operation_completion_fences WHERE tournament_id=$1 AND request_id=$2 AND state='PREPARED'",[tournamentId,activeRequestId]).catch(()=>undefined);}throw e;}finally{c.release();}
}
export async function settleTournamentCompletion(tournamentId:string,requestId:string,commit:boolean){
 const governance=await operationGovernance(tournamentId);
 if(commit&&governance.status!=='COMPLETED'||!commit&&governance.status==='COMPLETED')throw new AppError(409,'Trạng thái giải chưa cho phép đối soát yêu cầu kết thúc.','COMPLETION_STATE_MISMATCH');
 if(commit){const updated=await getPool().query("UPDATE competition_completion_fences SET state='COMPLETED',completed_at=COALESCE(completed_at,NOW()) WHERE tournament_id=$1 AND request_id=$2 RETURNING request_id",[tournamentId,requestId]);if(!updated.rowCount)throw new AppError(409,'Không tìm thấy yêu cầu kết thúc để đối soát.','COMPLETION_FENCE_NOT_FOUND');await disciplinePool().query("UPDATE tournament_operation_completion_fences SET state='COMPLETED',completed_at=COALESCE(completed_at,NOW()) WHERE tournament_id=$1 AND request_id=$2",[tournamentId,requestId]);}
 else{await getPool().query("DELETE FROM competition_completion_fences WHERE tournament_id=$1 AND request_id=$2 AND state='PREPARED'",[tournamentId,requestId]);await disciplinePool().query("DELETE FROM tournament_operation_completion_fences WHERE tournament_id=$1 AND request_id=$2 AND state='PREPARED'",[tournamentId,requestId]);}
 return {settled:true};
}
