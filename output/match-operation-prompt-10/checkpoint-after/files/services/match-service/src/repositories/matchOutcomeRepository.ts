import type {PoolClient} from 'pg';
import {matchStageScores,projectShootout,type ShootoutData} from '@sfl/shared';
import {AppError} from '../lib/errors';
import {getPool} from '../lib/db';
import {getEffectiveMatchRules,assertResultRulePolicy} from '../services/matchOperationRulesService';
import {validateMatchScore,type MatchScoreInput} from '../services/matchResultValidation';
type Query=Pick<PoolClient,'query'>;
export async function stageOutcome(matchId:string,c:Query=getPool()){
 const m=(await c.query('SELECT home_team_id,away_team_id FROM matches WHERE id=$1',[matchId])).rows[0];
 if(!m)throw new AppError(404,'Không tìm thấy trận.','MATCH_NOT_FOUND');
 const events=(await c.query('SELECT team_id AS "teamId",event_type AS "eventType",phase FROM match_events WHERE match_id=$1 AND voided_at IS NULL',[matchId])).rows;
 const scores=matchStageScores(events,m.home_team_id,m.away_team_id);
 const phases=(await c.query("SELECT action,before_snapshot->>'phase' AS phase FROM match_clock_action_history WHERE match_id=$1 ORDER BY version",[matchId])).rows;
 const extraStarted=phases.some(r=>r.action==='START_EXTRA_TIME'),extraComplete=phases.some(r=>r.action==='END_PERIOD'&&r.phase==='EXTRA_TIME_SECOND_HALF');
 const regulationComplete=phases.some(r=>r.action==='END_PERIOD'&&r.phase==='SECOND_HALF');
 const shootoutRow=(await c.query('SELECT state FROM match_shootouts WHERE match_id=$1',[matchId])).rows[0];
 const shootout=shootoutRow?projectShootout(shootoutRow.state as ShootoutData):null;
 const input:MatchScoreInput={homeScore:scores.regulation.home,awayScore:scores.regulation.away,homeExtraTimeScore:extraStarted?scores.extraTime.home:null,awayExtraTimeScore:extraStarted?scores.extraTime.away:null,homePenaltyScore:shootout?.winnerTeamId?shootout.score.home:null,awayPenaltyScore:shootout?.winnerTeamId?shootout.score.away:null};
 const winnerTeamId=scores.total.home!==scores.total.away?(scores.total.home>scores.total.away?m.home_team_id:m.away_team_id):shootout?.winnerTeamId??null;
 return {...scores,input,winnerTeamId,shootout,extraStarted,extraComplete,regulationComplete};
}
/** Called under the Match row lock. Never approves a result or recalculates standings. */
export async function saveFinishedOutcome(c:PoolClient,matchId:string,actorId:string,finishedAt:Date){
 const outcome=await stageOutcome(matchId,c),rules=await getEffectiveMatchRules(matchId,c);
 if(outcome.unknownPhase)throw new AppError(409,'Có bàn thắng cũ chưa xác định được hiệp. Cần kiểm tra trước khi kết thúc.','RESULT_EVENT_PHASE_UNKNOWN');
 if(!outcome.regulationComplete||outcome.extraStarted&&!outcome.extraComplete)throw new AppError(409,'Chưa hoàn tất các hiệp theo trình tự.','RESULT_PERIODS_INCOMPLETE');
 validateMatchScore(outcome.input);assertResultRulePolicy(rules,outcome.input,true);
 if(outcome.shootout&&!outcome.shootout.winnerTeamId)throw new AppError(409,'Loạt luân lưu chưa xác định đội thắng.','SHOOTOUT_RESULT_REQUIRED');
 const s=outcome.input;
 const existing=(await c.query('SELECT id,status FROM match_results WHERE match_id=$1 FOR UPDATE',[matchId])).rows;
 if(existing.length>1)throw new AppError(409,'Trận có nhiều bản kết quả cũ, cần người có thẩm quyền đối chiếu.','RESULT_HISTORY_REVIEW_REQUIRED');
 if(existing[0]?.status==='APPROVED')throw new AppError(409,'Kết quả đã được công nhận.','MATCH_RESULT_LOCKED');
 const values=[matchId,s.homeScore,s.awayScore,s.homeExtraTimeScore,s.awayExtraTimeScore,s.homePenaltyScore,s.awayPenaltyScore,actorId,outcome.winnerTeamId,finishedAt];
 if(existing.length)await c.query(`UPDATE match_results SET home_score=$2,away_score=$3,home_extra_time_score=$4,away_extra_time_score=$5,home_penalty_score=$6,away_penalty_score=$7,recorded_by=$8,recorded_at=NOW(),score_source='EVENTS_V1',winner_team_id=$9,finished_at=COALESCE(finished_at,$10),status='PENDING' WHERE match_id=$1`,values);
 else await c.query(`INSERT INTO match_results(match_id,home_score,away_score,home_extra_time_score,away_extra_time_score,home_penalty_score,away_penalty_score,recorded_by,status,score_source,winner_team_id,finished_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'PENDING','EVENTS_V1',$9,$10)`,values);
 return outcome;
}
export async function assertRecordedOutcome(c:Query,matchId:string,input:MatchScoreInput){
 const clock=(await c.query('SELECT phase,timing_model_version FROM match_clock_states WHERE match_id=$1',[matchId])).rows[0];
 const rules=await getEffectiveMatchRules(matchId,c);validateMatchScore(input);assertResultRulePolicy(rules,input,true);
 // Legacy results retain their existing authority/audit workflow; never fabricate event phases.
 if(clock?.timing_model_version!==1){if(input.homeExtraTimeScore!=null||input.homePenaltyScore!=null)throw new AppError(409,'Kết quả cũ thiếu mốc các hiệp/lượt sút. Cần quy trình đối chiếu có thẩm quyền; không tự tạo lịch sử.','RESULT_STAGE_REVIEW_REQUIRED');return;}
 if(clock.phase!=='ENDED')throw new AppError(409,'Phải kết thúc thi đấu bằng đồng hồ chính thức trước khi ghi kết quả.','MATCH_NOT_FINISHED');
 const o=await stageOutcome(matchId,c);
 if(o.unknownPhase||!o.regulationComplete||o.extraStarted&&!o.extraComplete)throw new AppError(409,'Dữ liệu các hiệp chưa đầy đủ.','RESULT_PERIODS_INCOMPLETE');
 for(const key of ['homeScore','awayScore','homeExtraTimeScore','awayExtraTimeScore','homePenaltyScore','awayPenaltyScore'] as const)if((input[key]??null)!==(o.input[key]??null))throw new AppError(409,'Tỷ số phải khớp các sự kiện từng hiệp và loạt luân lưu đã ghi nhận. Hãy đính chính nguồn nếu nhập sai.','RESULT_EVENT_MISMATCH',{field:key,expected:o.input[key]??null});
}
