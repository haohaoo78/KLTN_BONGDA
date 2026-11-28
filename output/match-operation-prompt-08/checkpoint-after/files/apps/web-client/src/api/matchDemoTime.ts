import { apiFetch } from "./client";
export type DemoTimeAction="ENABLE"|"DISABLE"|"LINEUP"|"PREMATCH"|"KICKOFF"|"ADVANCE_MINUTE"|"PERIOD_END"|"HALF_TIME_END";
export type DemoTimeWorkspace={available:boolean;enabled?:boolean;used?:boolean;revision?:number;effectiveNow?:string;realNow?:string;actions?:Record<string,string>};
export const getDemoTime=(matchId:string)=>apiFetch<DemoTimeWorkspace>(`/matches/${matchId}/demo-time`);
export const changeDemoTime=(matchId:string,action:DemoTimeAction,expectedRevision:number,expectedClockVersion:number)=>apiFetch<DemoTimeWorkspace>(`/matches/${matchId}/demo-time`,{method:"POST",body:JSON.stringify({action,expectedRevision,expectedClockVersion})});
