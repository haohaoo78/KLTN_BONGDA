/** Score contract: regulation goals, incremental extra-time goals, then played total.
 * Shootout kicks never participate in any of those three values. */
export type StageScore = {home:number;away:number};
export type OutcomeEvent = {teamId:string;eventType:string;phase?:string|null;voidedAt?:string|null};
export function matchStageScores(events:readonly OutcomeEvent[],homeId:string|null,awayId:string|null){
 const regulation:StageScore={home:0,away:0},extraTime:StageScore={home:0,away:0};let unknownPhase=false;
 for(const e of events){if(e.voidedAt||!['GOAL','PENALTY_GOAL','OWN_GOAL'].includes(e.eventType)||e.phase==='PENALTIES')continue;
  if(e.teamId!==homeId&&e.teamId!==awayId)continue;
  const target=['EXTRA_TIME_FIRST_HALF','EXTRA_TIME_SECOND_HALF'].includes(e.phase??'')?extraTime:regulation;
  if(!['FIRST_HALF','SECOND_HALF','EXTRA_TIME_FIRST_HALF','EXTRA_TIME_SECOND_HALF'].includes(e.phase??''))unknownPhase=true;
  target[(e.teamId===homeId)!==(e.eventType==='OWN_GOAL')?'home':'away']++;
 }
 return {regulation,extraTime,total:{home:regulation.home+extraTime.home,away:regulation.away+extraTime.away},unknownPhase};
}
export type ShootoutAttempt={id:string;turn:number;attempt:number;teamId:string;playerId:string;cycleId:string;eligibleCycleIds:string[];outcome:'SCORED'|'MISSED'|'RETAKE'|'VOID';recordedBy:string;recordedAt:string};
export type ShootoutData={homeId:string;awayId:string;firstTeamId:string;initialKicks:number;eligible:Record<string,string[]>;keepers:Record<string,string>;cycleIds:Record<string,string>;unavailable:string[];keeperSubstitutions?:Record<string,number>;attempts:ShootoutAttempt[]};
export class ShootoutError extends Error{constructor(public code:string,message:string){super(message);}}
const fail=(code:string,message:string):never=>{throw new ShootoutError(code,message);};
/** Replay also validates a correction: later kicks cannot survive an earlier winning kick. */
export function projectShootout(s:ShootoutData){
 const score:Record<string,number>={[s.homeId]:0,[s.awayId]:0},taken:Record<string,number>={[s.homeId]:0,[s.awayId]:0};
 const counts:Record<string,number>={};let winnerTeamId:string|null=null,turn=1,pending:ShootoutAttempt|null=null;
 if(![s.homeId,s.awayId].includes(s.firstTeamId)||!Number.isInteger(s.initialKicks)||s.initialKicks<1)fail('SHOOTOUT_SETUP_INVALID','Thiết lập luân lưu không hợp lệ.');
 for(const k of s.attempts){if(k.outcome==='VOID')continue;
  if(winnerTeamId)fail('SHOOTOUT_CHAIN_INVALID','Lượt phía sau không còn hợp lệ vì loạt sút đã có đội thắng. Đính chính từ lượt cuối.');
  const nextTeam=turn%2===1?s.firstTeamId:s.firstTeamId===s.homeId?s.awayId:s.homeId;
  if(k.turn!==turn||k.teamId!==nextTeam||!k.eligibleCycleIds.length||!k.eligibleCycleIds.includes(k.cycleId))fail('SHOOTOUT_ORDER_INVALID','Sai đội, thứ tự hoặc cầu thủ của lượt sút.');
  if(pending&&(pending.playerId!==k.playerId||k.attempt!==pending.attempt+1))fail('SHOOTOUT_RETAKE_INVALID','Quả đá lại phải giữ đúng cầu thủ và lượt sút.');
  if(!pending&&k.attempt!==1)fail('SHOOTOUT_RETAKE_INVALID','Phiên bản lượt sút không hợp lệ.');
  const min=Math.min(...k.eligibleCycleIds.map(id=>counts[id]??0));
  if((counts[k.cycleId]??0)>min)fail('SHOOTOUT_KICKER_REPEATED','Cầu thủ khác đủ điều kiện phải thực hiện trước khi cầu thủ này sút lại.');
  if(k.outcome==='RETAKE'){pending=k;continue;}
  pending=null;counts[k.cycleId]=(counts[k.cycleId]??0)+1;taken[k.teamId]++;if(k.outcome==='SCORED')score[k.teamId]++;
  const h=s.homeId,a=s.awayId,n=s.initialKicks;
  if(taken[h]<=n&&taken[a]<=n){if(score[h]>score[a]+Math.max(0,n-taken[a]))winnerTeamId=h;else if(score[a]>score[h]+Math.max(0,n-taken[h]))winnerTeamId=a;}
  if(!winnerTeamId&&taken[h]>=n&&taken[a]>=n&&taken[h]===taken[a]&&score[h]!==score[a])winnerTeamId=score[h]>score[a]?h:a;
  turn++;
 }
 const nextTeamId=winnerTeamId?null:turn%2===1?s.firstTeamId:s.firstTeamId===s.homeId?s.awayId:s.homeId;
 const active=nextTeamId?s.eligible[nextTeamId]??[]:[],min=active.length?Math.min(...active.map(id=>counts[s.cycleIds[id]??id]??0)):0;
 const nextPlayerIds=winnerTeamId?[]:pending?[pending.playerId]:active.filter(id=>(counts[s.cycleIds[id]??id]??0)===min);
 return {score:{home:score[s.homeId],away:score[s.awayId]},taken:{home:taken[s.homeId],away:taken[s.awayId]},winnerTeamId,nextTeamId,nextPlayerIds,nextTurn:turn,retakePending:Boolean(pending),suddenDeath:taken[s.homeId]>=s.initialKicks&&taken[s.awayId]>=s.initialKicks,counts};
}
