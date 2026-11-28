import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type { MatchReport, MatchReportCreateInput, MatchReportSubmissionSnapshot, MatchReportUpdateInput } from "../models/match";
import { getPool } from "../lib/db";
import { AppError } from "../lib/errors";
import { assertRecordedOutcome } from "./matchOutcomeRepository";
import { getMatchShootout } from "./matchShootoutRepository";
import { advanceApprovedKnockoutWinner, recalculateStandings } from "./matchRepository";
import { publishMatchUpdate } from "../realtime/matchRealtime";

type Row = Record<string, any>;
type Query = Pick<PoolClient, "query">;
export interface ReportPreparationOptions {
  approveOrdinary?: boolean;
  /** Loaded through existing services while the Scheduling lease is held. */
  loadContext?: () => Promise<Record<string, unknown>>;
}

function mapReport(row: Row): MatchReport {
  return { id:row.id,matchId:row.match_id,refereeId:row.referee_id,homeCaptainId:row.home_captain_id,
    awayCaptainId:row.away_captain_id,homeScoreAtHalfTime:row.home_score_at_half_time,awayScoreAtHalfTime:row.away_score_at_half_time,
    attendance:row.attendance,weather:row.weather,notes:row.notes,submittedBy:row.submitted_by,
    submittedAt:new Date(row.submitted_at).toISOString(),verifiedBy:row.verified_by,
    verifiedAt:row.verified_at?new Date(row.verified_at).toISOString():null,status:row.status,
    reviewNote:row.review_note,submissionSnapshots:row.submission_snapshots??[],version:row.version,
    requiresOrganizerReview:row.requires_organizer_review,draft:row.draft,reviewHistory:row.review_history??[] };
}
const projection=`SELECT r.*,COALESCE((SELECT jsonb_agg(jsonb_build_object('id',v.id,'status',v.status,
 'reviewNote',v.review_note,'reviewedBy',v.reviewed_by,'reviewedAt',v.reviewed_at,'reportVersion',v.report_version)
 ORDER BY v.reviewed_at,v.id) FROM match_report_reviews v WHERE v.report_id=r.id),'[]'::jsonb) AS review_history FROM match_reports r`;
async function reportRows(query:Query,where:string,values:unknown[]) {
 const result=await query.query(`${projection} WHERE ${where}`,values);
 if(result.rows.length>1)throw new AppError(409,"Có nhiều biên bản cũ cho cùng trận. Cần người có thẩm quyền đối chiếu.","REPORT_HISTORY_REVIEW_REQUIRED");
 return result.rows[0]?mapReport(result.rows[0]):null;
}
export async function findMatchReportByMatchId(matchId:string){return reportRows(getPool(),'r.match_id=$1',[matchId]);}
export async function findMatchReportById(id:string){return reportRows(getPool(),'r.id=$1',[id]);}

export function validateReportInput(input:MatchReportCreateInput) {
 if(input.action!==undefined&&!['SAVE_DRAFT','SUBMIT'].includes(input.action))throw new AppError(400,'Thao tác biên bản không hợp lệ.','VALIDATION_ERROR');
 if(input.attendance!=null&&(!Number.isSafeInteger(input.attendance)||input.attendance<0||input.attendance>2147483647))throw new AppError(400,'Số khán giả phải là số nguyên không âm.','VALIDATION_ERROR');
 for(const [field,max] of [['weather',100],['notes',2000]] as const)if(input[field]!=null&&(typeof input[field]!=='string'||input[field]!.length>max))throw new AppError(400,`${field==='weather'?'Thời tiết':'Ghi chú'} tối đa ${max} ký tự.`,'VALIDATION_ERROR');
 validateConcurrency(input);
}
function validateConcurrency(input:{operationId?:string;expectedVersion?:number}){
 if(input.expectedVersion!=null&&(!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0))throw new AppError(400,'Phiên bản biên bản không hợp lệ.','VALIDATION_ERROR');
 if(input.operationId!=null&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.operationId))throw new AppError(400,'Mã thao tác biên bản không hợp lệ.','VALIDATION_ERROR');
 // Legacy callers remain compatible; every new workflow action supplies both.
 if((input.operationId!=null)!==(input.expectedVersion!=null))throw new AppError(400,'Cần cung cấp cả phiên bản và mã thao tác.','REPORT_CONCURRENCY_REQUIRED');
}
function checkVersion(report:MatchReport|null,version?:number){
 if(version!=null&&(report?.version??0)!==version)throw new AppError(409,'Biên bản đã thay đổi trên thiết bị khác. Hãy tải lại để kiểm tra.','REPORT_VERSION_CONFLICT',{expectedVersion:version,actualVersion:report?.version??0});
}
function hash(value:unknown){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
async function replay(c:PoolClient,matchId:string,actor:string,input:{operationId?:string},requestHash:string){
 if(!input.operationId)return null;
 const row=(await c.query('SELECT request_hash,response FROM match_report_operations WHERE match_id=$1 AND actor_id=$2 AND operation_id=$3',[matchId,actor,input.operationId])).rows[0];
 if(row&&row.request_hash!==requestHash)throw new AppError(409,'Mã thao tác đã dùng cho nội dung khác. Hãy tải lại.','REPORT_OPERATION_REUSED');
 return row?.response as MatchReport|undefined;
}
async function receipt(c:PoolClient,report:MatchReport,actor:string,operationId:string|undefined,requestHash:string){
 if(operationId)await c.query('INSERT INTO match_report_operations(match_id,actor_id,operation_id,request_hash,response) VALUES($1,$2,$3,$4,$5::jsonb)',[report.matchId,actor,operationId,requestHash,JSON.stringify(report)]);
}
async function lockMatch(c:PoolClient,matchId:string){
 const match=(await c.query('SELECT * FROM matches WHERE id=$1 FOR UPDATE',[matchId])).rows[0];
 if(!match)throw new AppError(404,'Không tìm thấy trận.','MATCH_NOT_FOUND');
 // All report paths use Match -> report order, identical to clock/event writers.
 await c.query('SELECT id FROM match_reports WHERE match_id=$1 FOR UPDATE',[matchId]);
 return match;
}
function fields(input:MatchReportCreateInput){return {attendance:input.attendance??null,weather:input.weather?.trim()||null,notes:input.notes?.trim()||null,requiresOrganizerReview:input.requiresOrganizerReview===true};}
function scores(row:Row){return {homeScore:row.home_score,awayScore:row.away_score,homeExtraTimeScore:row.home_extra_time_score,awayExtraTimeScore:row.away_extra_time_score,homePenaltyScore:row.home_penalty_score,awayPenaltyScore:row.away_penalty_score};}
export function sameReportScore(snapshot:unknown,current:ReturnType<typeof scores>):boolean{
 if(!snapshot||typeof snapshot!=='object')return false;
 return (Object.keys(current) as Array<keyof typeof current>).every(key=>((snapshot as Record<string,unknown>)[key]??null)===(current[key]??null));
}
async function pendingResult(c:PoolClient,matchId:string){
 const result=await c.query('SELECT * FROM match_results WHERE match_id=$1 FOR UPDATE',[matchId]);
 if(result.rows.length!==1||result.rows[0].status!=='PENDING')throw new AppError(409,'Cần đúng một kết quả chưa công nhận được tổng hợp sau khi kết thúc trận.','MATCH_RESULT_REQUIRED');
 await assertRecordedOutcome(c,matchId,scores(result.rows[0]));
 return result.rows[0];
}
async function submissionSnapshot(c:PoolClient,match:Row,input:MatchReportCreateInput,actor:string,version:number,options:ReportPreparationOptions):Promise<MatchReportSubmissionSnapshot>{
 const result=await pendingResult(c,input.matchId);
 const context=options.loadContext?await options.loadContext():{};
 const [players,events,clock,periods]=await Promise.all([
  c.query('SELECT * FROM lineups WHERE match_id=$1 ORDER BY team_id,is_starting DESC,jersey_number NULLS LAST,player_id',[input.matchId]),
  c.query('SELECT * FROM match_events WHERE match_id=$1 AND voided_at IS NULL ORDER BY COALESCE(logical_sequence,event_sequence)',[input.matchId]),
  c.query('SELECT * FROM match_clock_states WHERE match_id=$1',[input.matchId]),
  c.query('SELECT action,version,before_snapshot,after_snapshot,occurred_at FROM match_clock_action_history WHERE match_id=$1 ORDER BY version',[input.matchId])
 ]);
 const goals=events.rows.filter(e=>['GOAL','PENALTY_GOAL','OWN_GOAL'].includes(e.event_type));
 let halfHome=0,halfAway=0;
 for(const e of goals.filter(e=>e.phase==='FIRST_HALF')){if((e.team_id===match.home_team_id)!==(e.event_type==='OWN_GOAL'))halfHome++;else halfAway++;}
 const names=(context.playerNames??{}) as Record<string,string>,known=goals.every(e=>e.phase!=null);
 const row=clock.rows[0];
 return {version,context,submittedAt:new Date().toISOString(),result:scores(result),
  report:{...fields(input),submittedBy:actor,requiresOrganizerReview:input.requiresOrganizerReview===true,homeScoreAtHalfTime:known?halfHome:null,awayScoreAtHalfTime:known?halfAway:null},
  lineups:players.rows.map(p=>({teamId:p.team_id,playerId:p.player_id,fullName:names[p.player_id]??null,position:p.position,jerseyNumber:p.jersey_number,isStarting:p.is_starting,confirmedBy:p.confirmed_by,confirmedAt:p.confirmed_at?new Date(p.confirmed_at).toISOString():null})),
  events:events.rows.map(e=>({id:e.id,teamId:e.team_id,playerId:e.player_id,playerName:e.player_id?names[e.player_id]??null:null,eventType:e.event_type,minute:e.minute,description:e.description,createdBy:e.created_by,createdAt:new Date(e.created_at).toISOString(),phase:e.phase,periodElapsedSeconds:e.period_elapsed_seconds,addedTimeSeconds:e.added_time_seconds,eventSequence:e.logical_sequence??e.event_sequence,visibility:e.visibility,relatedPlayerId:e.related_player_id,substitutionId:e.substitution_id})),
  clock:row?{phase:row.phase,elapsedSeconds:row.elapsed_seconds,totalElapsedSeconds:row.total_elapsed_seconds,updatedAt:new Date(row.updated_at).toISOString(),actualStartedAt:row.actual_started_at?new Date(row.actual_started_at).toISOString():null,actualEndedAt:row.actual_ended_at?new Date(row.actual_ended_at).toISOString():null} as MatchReportSubmissionSnapshot['clock']:null,
  shootout:await getMatchShootout(input.matchId,c),periods:periods.rows,
 };
}
async function assertNoUnresolvedException(c:PoolClient,matchId:string){
 const pending=await c.query('SELECT 1 FROM match_preparation_issues WHERE match_id=$1 AND resolved_at IS NULL LIMIT 1',[matchId]);
 if(pending.rowCount)throw new AppError(409,'Trận còn vấn đề trước trận chưa được BTC xử lý. Cần chuyển hồ sơ ngoại lệ.','REPORT_ORGANIZER_REVIEW_REQUIRED');
}
async function approveInTransaction(c:PoolClient,report:MatchReport,match:Row,actor:string,note:string|null=null,organizer=false){
 if(match.status!=='FINISHED')throw new AppError(409,'Trận phải kết thúc trước khi công nhận kết quả.','MATCH_NOT_FINISHED');
 if(report.requiresOrganizerReview&&!organizer)throw new AppError(409,'Biên bản ngoại lệ cần BTC xử lý đúng thẩm quyền.','REPORT_ORGANIZER_REVIEW_REQUIRED');
 if(!organizer)await assertNoUnresolvedException(c,match.id);
 const result=await pendingResult(c,match.id),snapshot=report.submissionSnapshots.at(-1);
 if(!sameReportScore(snapshot?.result,scores(result)))throw new AppError(409,'Kết quả hiện tại không khớp lần nộp biên bản. Cần yêu cầu điều chỉnh có lý do.','REPORT_SNAPSHOT_STALE');
 await c.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',[match.tournament_id]);
 await c.query("UPDATE match_reports SET status='APPROVED',verified_by=$2,verified_at=NOW(),review_note=$3,draft=NULL,version=version+1 WHERE id=$1",[report.id,actor,note]);
 await c.query("INSERT INTO match_report_reviews(report_id,status,review_note,reviewed_by,report_version) VALUES($1,'APPROVED',$2,$3,$4)",[report.id,note,actor,report.version+1]);
 await c.query("UPDATE match_results SET status='APPROVED' WHERE match_id=$1",[match.id]);
 await c.query("UPDATE matches SET status='VERIFIED',updated_at=NOW() WHERE id=$1",[match.id]);
 const s=scores(result),home=s.homeScore+(s.homeExtraTimeScore??0),away=s.awayScore+(s.awayExtraTimeScore??0);
 const bracket=(await c.query('SELECT id FROM match_bracket_slots WHERE match_id=$1 FOR UPDATE',[match.id])).rowCount;
 if(bracket){
  if(home===away&&(s.homePenaltyScore==null||s.awayPenaltyScore==null||s.homePenaltyScore===s.awayPenaltyScore))throw new AppError(409,'Trận loại trực tiếp chưa xác định đội thắng.','KNOCKOUT_WINNER_REQUIRED');
  const homeWins=home!==away?home>away:s.homePenaltyScore!>s.awayPenaltyScore!;
  await advanceApprovedKnockoutWinner(c,match.id,homeWins?match.home_team_id:match.away_team_id);
 }
 await recalculateStandings(c,match.tournament_id);
 // Durable Match event and pg_notify are in the same transaction. NOTIFY is delivered only after COMMIT.
 // Scheduling is only read under its own lease; no cross-database writes pretend to share this transaction.
 await publishMatchUpdate(c,match.id,'match.finalized');
 return (await reportRows(c,'r.id=$1',[report.id]))!;
}

/** Prepare, submit and (for the final authority) approve atomically. */
export async function finalizeMatchReport(input:MatchReportCreateInput,actor:string,options:ReportPreparationOptions={}):Promise<MatchReport>{
 validateReportInput(input);
 const action=input.action??'SUBMIT',requestHash=hash({action,matchId:input.matchId,refereeId:input.refereeId,...fields(input),requiresOrganizerReview:input.requiresOrganizerReview===true,expectedVersion:input.expectedVersion??null});
 const c=await getPool().connect();
 try{
  await c.query('BEGIN');const match=await lockMatch(c,input.matchId);
  const prior=await reportRows(c,'r.match_id=$1',[input.matchId]);
  const replayed=await replay(c,input.matchId,actor,input,requestHash);if(replayed){await c.query('COMMIT');return replayed;}
  if(prior?.status==='APPROVED'){
   // Compatible retries from pre-operation-id clients return the one existing official record.
   if(!input.operationId&&prior.submittedBy===actor){await c.query('COMMIT');return prior;}
   throw new AppError(409,'Kết quả đã được công nhận. Hãy sử dụng yêu cầu đính chính.','MATCH_RESULT_LOCKED');
  }
  checkVersion(prior,input.expectedVersion);
  if(match.status!=='FINISHED')throw new AppError(409,'Chỉ hoàn thiện biên bản sau khi trận kết thúc.','MATCH_NOT_FINISHED');
  if(prior&&!['DRAFT','REVISION_REQUIRED'].includes(prior.status))throw new AppError(409,'Biên bản đã gửi. Người xác nhận cuối có thể tiếp tục xác nhận hoặc yêu cầu điều chỉnh.','REPORT_ALREADY_SUBMITTED');
  const version=(prior?.version??0)+1,requires=input.requiresOrganizerReview===true;
  const snapshot=action==='SUBMIT'?await submissionSnapshot(c,match,input,actor,version,options):null;
  const f=fields(input),values=[input.matchId,actor,input.homeCaptainId??null,input.awayCaptainId??null,snapshot?.report?.homeScoreAtHalfTime??null,snapshot?.report?.awayScoreAtHalfTime??null,f.attendance,f.weather,f.notes,actor,action==='SAVE_DRAFT'?'DRAFT':'PENDING',requires,action==='SAVE_DRAFT'?JSON.stringify(f):null,snapshot?JSON.stringify([snapshot]):'[]',version];
  if(prior)await c.query(`UPDATE match_reports SET referee_id=$2,home_captain_id=$3,away_captain_id=$4,home_score_at_half_time=$5,away_score_at_half_time=$6,
   attendance=$7,weather=$8,notes=$9,submitted_by=$10,status=$11,requires_organizer_review=$12,draft=$13::jsonb,
   submission_snapshots=submission_snapshots||$14::jsonb,version=$15,submitted_at=NOW(),verified_by=NULL,verified_at=NULL,review_note=NULL WHERE match_id=$1`,values);
  else await c.query(`INSERT INTO match_reports(match_id,referee_id,home_captain_id,away_captain_id,home_score_at_half_time,away_score_at_half_time,attendance,weather,notes,submitted_by,status,requires_organizer_review,draft,submission_snapshots,version)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15)`,values);
  let report=(await reportRows(c,'r.match_id=$1',[input.matchId]))!;
  if(snapshot&&options.approveOrdinary&&!requires)report=await approveInTransaction(c,report,match,actor);
  else await publishMatchUpdate(c,input.matchId,action==='SAVE_DRAFT'?'match.report.draft.saved':'match.report.submitted');
  await receipt(c,report,actor,input.operationId,requestHash);await c.query('COMMIT');return report;
 }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}

/** A separately appointed final authority can confirm a helper's ordinary submission. */
export async function confirmMatchReport(id:string,actor:string,input:{expectedVersion?:number;operationId?:string;decision?:'APPROVE'|'REQUEST_CHANGES';reason?:string}):Promise<MatchReport>{
 validateConcurrency(input);const decision=input.decision??'APPROVE';
 if(decision==='REQUEST_CHANGES'&&(typeof input.reason!=='string'||input.reason.trim().length<5||input.reason.length>2000))throw new AppError(400,'Cần lý do yêu cầu điều chỉnh từ 5 đến 2000 ký tự.','VALIDATION_ERROR');
 const c=await getPool().connect(),requestHash=hash({action:'CONFIRM',id,decision,reason:input.reason?.trim()??null,expectedVersion:input.expectedVersion??null});
 try{await c.query('BEGIN');const reference=(await c.query('SELECT match_id FROM match_reports WHERE id=$1',[id])).rows[0];
  if(!reference)throw new AppError(404,'Không tìm thấy biên bản.','REPORT_NOT_FOUND');
  const match=await lockMatch(c,reference.match_id),report=(await reportRows(c,'r.id=$1',[id]))!;
  const replayed=await replay(c,match.id,actor,input,requestHash);if(replayed){await c.query('COMMIT');return replayed;}
  if(report.status==='APPROVED'&&decision==='APPROVE'){await receipt(c,report,actor,input.operationId,requestHash);await c.query('COMMIT');return report;}
  checkVersion(report,input.expectedVersion);
  if(report.status!=='PENDING')throw new AppError(409,'Chỉ xác nhận biên bản đã gửi đang chờ xử lý.','REPORT_NOT_SUBMITTED');
  if(report.requiresOrganizerReview)throw new AppError(409,'Biên bản ngoại lệ cần BTC xử lý.','REPORT_ORGANIZER_REVIEW_REQUIRED');
  let approved:MatchReport;
  if(decision==='REQUEST_CHANGES'){
    if(match.status!=='FINISHED')throw new AppError(409,'Không thể yêu cầu sửa kết quả chính thức bằng luồng biên bản.','MATCH_RESULT_LOCKED');
    await c.query("UPDATE match_reports SET status='REVISION_REQUIRED',review_note=$2,verified_by=$3,verified_at=NOW(),version=version+1 WHERE id=$1",[id,input.reason!.trim(),actor]);
    await c.query("INSERT INTO match_report_reviews(report_id,status,review_note,reviewed_by,report_version) VALUES($1,'REVISION_REQUIRED',$2,$3,$4)",[id,input.reason!.trim(),actor,report.version+1]);
    await publishMatchUpdate(c,match.id,'match.report.updated');approved=(await reportRows(c,'r.id=$1',[id]))!;
  }else approved=await approveInTransaction(c,report,match,actor);
  await receipt(c,approved,actor,input.operationId,requestHash);await c.query('COMMIT');return approved;
 }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}

/** Organizer review remains the authorized exception/revision workflow. */
export async function updateMatchReport(id:string,input:MatchReportUpdateInput):Promise<MatchReport|null>{
 if(!input.status||!input.verifiedBy)return null;validateConcurrency(input);
 const c=await getPool().connect(),actor=input.verifiedBy,requestHash=hash({action:'REVIEW',id,status:input.status,note:input.reviewNote??null,expectedVersion:input.expectedVersion??null});
 try{await c.query('BEGIN');const reference=(await c.query('SELECT match_id FROM match_reports WHERE id=$1',[id])).rows[0];
  if(!reference){await c.query('ROLLBACK');return null;}
  const match=await lockMatch(c,reference.match_id),report=(await reportRows(c,'r.id=$1',[id]))!;
  const replayed=await replay(c,match.id,actor,input,requestHash);if(replayed){await c.query('COMMIT');return replayed;}
  if(report.status===input.status&&report.verifiedBy===actor){await c.query('COMMIT');return report;}
  checkVersion(report,input.expectedVersion);
  if(report.status!=='PENDING')throw new AppError(409,'Chỉ xử lý biên bản đang chờ.','REPORT_ALREADY_REVIEWED');
  if(!report.requiresOrganizerReview)throw new AppError(409,'Biên bản thông thường do người xác nhận cuối trong tổ trọng tài xử lý.','FINAL_AUTHORITY_REQUIRED');
  let updated:MatchReport;
  if(input.status==='APPROVED'){
   if(!report.requiresOrganizerReview)throw new AppError(409,'Biên bản thông thường do trọng tài có thẩm quyền xác nhận.','FINAL_AUTHORITY_REQUIRED');
   updated=await approveInTransaction(c,report,match,actor,input.reviewNote??null,true);
  }else{
   if(!['REJECTED','REVISION_REQUIRED'].includes(input.status))throw new AppError(400,'Trạng thái xử lý không hợp lệ.','VALIDATION_ERROR');
   if(!input.reviewNote?.trim()||input.reviewNote.length>2000)throw new AppError(400,'Cần lý do xử lý tối đa 2000 ký tự.','VALIDATION_ERROR');
   await c.query('UPDATE match_reports SET status=$2,verified_by=$3,verified_at=NOW(),review_note=$4,version=version+1 WHERE id=$1',[id,input.status,actor,input.reviewNote]);
   await c.query('INSERT INTO match_report_reviews(report_id,status,review_note,reviewed_by,report_version) VALUES($1,$2,$3,$4,$5)',[id,input.status,input.reviewNote,actor,report.version+1]);
   await c.query('UPDATE match_results SET status=$2 WHERE match_id=$1',[match.id,input.status==='REJECTED'?'REJECTED':'PENDING']);
   await publishMatchUpdate(c,match.id,'match.report.updated');updated=(await reportRows(c,'r.id=$1',[id]))!;
  }
  await receipt(c,updated,actor,input.operationId,requestHash);await c.query('COMMIT');return updated;
 }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}
