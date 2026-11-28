import {compareMatchEventTiming} from './matchTiming';
export type EventPlayer={playerId:string;teamId:string;isStarting:boolean};
export type PlayingEvent={id?:string;teamId:string;playerId?:string|null;eventType:string;phase?:any;periodElapsedSeconds?:number|null;eventSequence?:string|null;createdAt?:string;minute?:number|null;voidedAt?:string|null;substitutionId?:string|null;relatedPlayerId?:string|null;opportunityId?:string|null};
export type EventRules={substitutionMode?:unknown;returnSubstitutes?:unknown;maxSubstitutions?:unknown;substitutionOpportunities?:unknown;extraTimeSubstitutions?:unknown;extraTimeOpportunities?:unknown;redCardReduction?:unknown;periodMinutes?:unknown;extraTimeMinutes?:unknown};
export function projectMatchPlayers(players:EventPlayer[],events:PlayingEvent[],rules:EventRules,strict=true){
 const onField=new Set(players.filter(p=>p.isStarting).map(p=>p.playerId)),dismissed=new Set<string>(),used=new Set<string>(),temporarilyOff=new Set<string>(),yellow=new Map<string,number>(),substitutions=new Map<string,number>(),opportunities=new Map<string,Set<string>>();
 const reductions:Array<{playerId:string;teamId:string;time:number;released:boolean;replaced:boolean}>=[];let inShootout=false;
 const time=(e:PlayingEvent)=>{const p=Number(rules.periodMinutes)*60,x=Number(rules.extraTimeMinutes??0)*30;return (e.periodElapsedSeconds??0)+({FIRST_HALF:0,HALF_TIME:p,SECOND_HALF:p,REGULATION_COMPLETE:p*2,EXTRA_TIME_FIRST_HALF:p*2,EXTRA_TIME_HALF_TIME:p*2+x,EXTRA_TIME_SECOND_HALF:p*2+x,EXTRA_TIME_COMPLETE:p*2+x*2,ENDED:p*2+x*2}[String(e.phase)]??0);};
 const fail=(event:PlayingEvent,message:string)=>{if(strict)throw Object.assign(new Error(message),{code:'EVENT_CHAIN_INVALID',eventId:event.id});};
 for(const e of [...events].filter(e=>!e.voidedAt).sort((a,b)=>compareMatchEventTiming({...a,id:a.id??'',minute:a.minute??null,createdAt:a.createdAt??''},{...b,id:b.id??'',minute:b.minute??null,createdAt:b.createdAt??''}))){
  const p=players.find(p=>p.playerId===e.playerId&&p.teamId===e.teamId),id=e.playerId;
  if(e.phase==='PENALTIES'&&!inShootout){yellow.clear();inShootout=true;}
  if(['GOAL','PENALTY_GOAL','OWN_GOAL'].includes(e.eventType)){if(!p||!id||!onField.has(id)||dismissed.has(id))fail(e,'Cầu thủ ghi bàn phải đang thi đấu và chưa bị truất quyền.');
   if(rules.redCardReduction==='FUTSAL_TWO_MINUTES'){const sides=[...new Set(players.map(p=>p.teamId))],benefit=e.eventType==='OWN_GOAL'?sides.find(t=>t!==e.teamId):e.teamId,other=sides.find(t=>t!==benefit),count=(team?:string)=>players.filter(p=>p.teamId===team&&onField.has(p.playerId)).length;
    if(count(benefit)>count(other)){const pending=reductions.find(r=>r.teamId===other&&!r.replaced&&!r.released&&time(e)-r.time<120);if(pending)pending.released=true;}}
  }
  if(['YELLOW_CARD','SECOND_YELLOW_CARD','RED_CARD'].includes(e.eventType)){
   if(!p||!id||dismissed.has(id)){fail(e,'Cầu thủ nhận thẻ không thuộc đội hình hợp lệ hoặc đã bị truất quyền.');continue;}
   const count=yellow.get(id)??0;
   if(e.eventType==='YELLOW_CARD'){if(count>=1)fail(e,'Cầu thủ đã nhận thẻ vàng; cần ghi thẻ vàng thứ hai.');yellow.set(id,count+1);}
   else if(e.eventType==='SECOND_YELLOW_CARD'){if(count!==1)fail(e,'Thẻ vàng thứ hai cần một thẻ vàng còn hiệu lực trước đó.');yellow.set(id,2);if(onField.has(id)||temporarilyOff.has(id))reductions.push({playerId:id,teamId:e.teamId,time:time(e),released:e.phase==='NOT_STARTED',replaced:false});dismissed.add(id);onField.delete(id);temporarilyOff.delete(id);}
   else {if(onField.has(id)||temporarilyOff.has(id))reductions.push({playerId:id,teamId:e.teamId,time:time(e),released:e.phase==='NOT_STARTED',replaced:false});dismissed.add(id);onField.delete(id);temporarilyOff.delete(id);}
  }
  if(e.eventType==='PLAYER_LEAVE'){if(!id||!onField.has(id))fail(e,'Cầu thủ rời sân phải đang thi đấu.');if(id){onField.delete(id);temporarilyOff.add(id);}}
  if(e.eventType==='PLAYER_RETURN'){if(!p||!id||!temporarilyOff.has(id)||onField.has(id)||dismissed.has(id)||used.has(id))fail(e,'Cầu thủ không đủ điều kiện trở lại sau rời sân tạm thời.');if(id){onField.add(id);temporarilyOff.delete(id);}}
  if(e.eventType==='REPLACEMENT_IN'){
   const reduction=reductions.find(r=>r.teamId===e.teamId&&r.playerId===e.relatedPlayerId&&!r.replaced);
   if(!p||!id||onField.has(id)||dismissed.has(id)||used.has(id)&&rules.returnSubstitutes!=='YES'||!reduction||!(reduction.released||rules.redCardReduction==='FUTSAL_TWO_MINUTES'&&time(e)-reduction.time>=120))fail(e,'Chưa đủ điều kiện bổ sung người sau truất quyền theo bộ luật.');
   if(reduction)reduction.replaced=true;if(id)onField.add(id);
  }
  if(e.eventType==='SUBSTITUTION_OUT'){
   if(!p||!id||!(onField.has(id)||temporarilyOff.has(id))||dismissed.has(id))fail(e,'Cầu thủ ra phải đang thi đấu.');
   if(!e.substitutionId||!e.relatedPlayerId||!events.some(x=>!x.voidedAt&&x.eventType==='SUBSTITUTION_IN'&&x.substitutionId===e.substitutionId&&x.playerId===e.relatedPlayerId&&x.relatedPlayerId===id&&x.teamId===e.teamId))fail(e,'Thay người thiếu cặp vào/ra nguyên tử.');
   if(id){onField.delete(id);temporarilyOff.delete(id);used.add(id);}
  }
  if(e.eventType==='SUBSTITUTION_IN'){
   if(!p||!id||onField.has(id)||dismissed.has(id)||rules.returnSubstitutes!=='YES'&&used.has(id))fail(e,'Cầu thủ vào không đủ điều kiện hoặc không được tái nhập sân.');
   if(!e.substitutionId||!events.some(x=>!x.voidedAt&&x.eventType==='SUBSTITUTION_OUT'&&x.substitutionId===e.substitutionId&&x.playerId===e.relatedPlayerId&&x.relatedPlayerId===id&&x.teamId===e.teamId))fail(e,'Thay người thiếu cặp vào/ra nguyên tử.');
   const n=(substitutions.get(e.teamId)??0)+1;substitutions.set(e.teamId,n);
   const extra=String(e.phase).startsWith('EXTRA_TIME');
   if(rules.substitutionMode==='LIMITED'){
    const max=Number(rules.maxSubstitutions)+(extra?Number(rules.extraTimeSubstitutions??0):0);
    if(n>max)fail(e,'Đã vượt số cầu thủ được thay theo điều lệ.');
    const o=opportunities.get(e.teamId)??new Set<string>();
    if(!['HALF_TIME','EXTRA_TIME_HALF_TIME','REGULATION_COMPLETE'].includes(String(e.phase)))o.add(e.opportunityId??e.substitutionId??String(e.id));
    opportunities.set(e.teamId,o);
    if(o.size>Number(rules.substitutionOpportunities)+(extra?Number(rules.extraTimeOpportunities??0):0))fail(e,'Đã vượt số cơ hội thay người theo điều lệ.');
   }
   if(id)onField.add(id);
  }
 }
 return {onField,dismissed,used,temporarilyOff,yellow,substitutions,opportunities,reductions};
}
