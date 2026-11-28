import {apiFetch} from './client';
import type {ShootoutData,projectShootout} from '@sfl/shared';
export type ShootoutView=ShootoutData&ReturnType<typeof projectShootout>&{version:number};
export type ShootoutWorkspace={current:ShootoutView|null;candidates:Array<{playerId:string;teamId:string;jerseyNumber:number|null;position:string|null}>;requiresEqualNumbers:boolean;issues:string[]};
export type ShootoutCommand={action:'SETUP'|'KICK'|'RETAKE'|'CORRECT'|'VOID_LAST'|'ELIGIBILITY'|'REPLACE_KEEPER';operationId:string;expectedVersion:number;expectedClockVersion:number;firstTeamId?:string;eligiblePlayerIds?:string[];unavailablePlayerIds?:string[];keepers?:Record<string,string>;playerId?:string;scored?:boolean;attemptId?:string;reason?:string;teamId?:string;replacedPlayerId?:string};
export const changeMatchShootout=(matchId:string,input:ShootoutCommand)=>apiFetch<ShootoutView>(`/matches/${encodeURIComponent(matchId)}/shootout/actions`,{method:'POST',body:JSON.stringify(input)});
