import { AppError } from "../lib/errors";

export type FairPlayWeights = { YELLOW:number; SECOND_YELLOW:number; RED:number; YELLOW_RED:number };
/** Only explicit machine-readable weights are actionable; prose is never guessed. */
export function parseFairPlayWeights(value:unknown):FairPlayWeights|null{
 try{const p=typeof value==='string'?JSON.parse(value):value;
  return p&&['YELLOW','SECOND_YELLOW','RED','YELLOW_RED'].every(k=>typeof p[k]==='number'&&Number.isFinite(p[k])&&p[k]>=0)?p:null;
 }catch{return null;}
}
export function fairPlayPenalty(events:Array<{event_type:string}>,weights:FairPlayWeights):number{
 const types=new Set(events.map(e=>e.event_type));
 if(types.has('RED_CARD')&&types.has('YELLOW_CARD'))return weights.YELLOW_RED;
 if(types.has('RED_CARD'))return weights.RED;
 if(types.has('SECOND_YELLOW_CARD'))return weights.SECOND_YELLOW;
 return events.filter(e=>e.event_type==='YELLOW_CARD').length*weights.YELLOW;
}
export type CardPolicy={yellowThreshold:number;yellowBan:number;directRedBan:number;secondYellowBan:number;scope:'TOURNAMENT'|'STAGE';reset:'CARRY_ALL'|'RESET_BEFORE_KNOCKOUT'|'RESET_EACH_STAGE';starts:'NEXT_TEAM_MATCH';baseVersion:number;supplementId:string|null;secondYellowAccumulation:string|null;directRedYellowAccumulation?:string|null;shootoutDiscipline:string|null;concurrentSanctions:string|null};
export function cardPolicy(effective:import('@sfl/shared').EffectiveMatchRules):CardPolicy{
 const v=effective.rules.values,b=effective.base.rules,missing:string[]=[];
 const threshold=b?.yellowCardsForSuspension,ban=b?.suspensionMatches;
 if(!Number.isInteger(threshold)||Number(threshold)<0)missing.push('ngưỡng tích lũy thẻ vàng');
 if(Number(threshold)>0&&(!Number.isInteger(ban)||Number(ban)<1))missing.push('số trận treo giò do tích lũy vàng');
 for(const k of ['directRedSuspensionMatches','secondYellowSuspensionMatches'])if(!Number.isInteger(v[k])||Number(v[k])<0)missing.push(k==='directRedSuspensionMatches'?'án đỏ trực tiếp':'án vàng thứ hai');
 if(!['TOURNAMENT','STAGE'].includes(String(v.disciplineScope)))missing.push('phạm vi thi hành');
 if(!['CARRY_ALL','RESET_BEFORE_KNOCKOUT','RESET_EACH_STAGE'].includes(String(v.cardResetPolicy)))missing.push('chuyển tiếp/xóa thẻ có cấu trúc');
 if(v.suspensionStarts!=='NEXT_TEAM_MATCH')missing.push('thời điểm thi hành có cấu trúc');
 if(!effective.base.regulationVersion)missing.push('phiên bản điều lệ');
 if(missing.length)throw new AppError(409,`Chưa đủ căn cứ tính án: ${missing.join('; ')}. Cần bổ sung điều lệ có phiên bản.`, 'DISCIPLINE_RULES_UNDEFINED',{missing});
 return {yellowThreshold:Number(threshold),yellowBan:Number(ban??0),directRedBan:Number(v.directRedSuspensionMatches),secondYellowBan:Number(v.secondYellowSuspensionMatches),scope:v.disciplineScope as CardPolicy['scope'],reset:v.cardResetPolicy as CardPolicy['reset'],starts:'NEXT_TEAM_MATCH',baseVersion:effective.base.regulationVersion!,supplementId:effective.supplement?.id??null,secondYellowAccumulation:typeof v.secondYellowAccumulation==='string'?v.secondYellowAccumulation:null,directRedYellowAccumulation:typeof v.directRedYellowAccumulation==='string'?v.directRedYellowAccumulation:null,shootoutDiscipline:typeof v.shootoutDiscipline==='string'?v.shootoutDiscipline:null,concurrentSanctions:typeof v.concurrentSanctions==='string'?v.concurrentSanctions:null};
}
