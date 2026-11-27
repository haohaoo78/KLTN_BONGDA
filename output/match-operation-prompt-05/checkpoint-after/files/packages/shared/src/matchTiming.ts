/** Persisted match phases are shared; this is not a second state machine. */
export type MatchClockPhase = "NOT_STARTED"|"FIRST_HALF"|"HALF_TIME"|"SECOND_HALF"|"REGULATION_COMPLETE"|"EXTRA_TIME_FIRST_HALF"|"EXTRA_TIME_HALF_TIME"|"EXTRA_TIME_SECOND_HALF"|"EXTRA_TIME_COMPLETE"|"PENALTIES"|"ENDED";
export const MATCH_CLOCK_ACTIONS=["START_MATCH","PAUSE","SUSPEND_PLAY","RESUME","DECLARE_ADDED_TIME","END_PERIOD","START_NEXT_PERIOD","START_EXTRA_TIME","START_PENALTIES","END_MATCH"] as const;
export type MatchClockAction=typeof MATCH_CLOCK_ACTIONS[number];
export type ClockInterruption="CLOCK_STOP"|"PLAY_SUSPENDED"|"POSTPONED"|"ABANDONED"|"CANCELLED";
export type MatchClockActionOptions={reason?:string;addedTimeSeconds?:number};
export interface MatchClockState {
 matchId:string;phase:MatchClockPhase;elapsedSeconds:number;totalElapsedSeconds:number;isRunning:boolean;
 startedAt:string|null;updatedBy:string|null;updatedAt:string;version:number;
 serverNow?:string;phaseStartedAt?:string|null;actualStartedAt?:string|null;actualEndedAt?:string|null;
 elapsedMilliseconds?:number;totalElapsedMilliseconds?:number;addedTimeSeconds?:number;
 interruption?:ClockInterruption|null;interruptionReason?:string|null;reviewRequired?:boolean;timingModelVersion?:number;
}
export const PLAYING_CLOCK_PHASES:readonly MatchClockPhase[]=["FIRST_HALF","SECOND_HALF","EXTRA_TIME_FIRST_HALF","EXTRA_TIME_SECOND_HALF"];
export function periodTiming(phase:MatchClockPhase,periodMinutes:number,extraTimeMinutes:number|null){
 const index=PLAYING_CLOCK_PHASES.indexOf(phase);if(index<0)return null;
 const minutes=index<2?periodMinutes:extraTimeMinutes==null?null:extraTimeMinutes/2;if(minutes==null||!Number.isFinite(minutes)||minutes<=0)return null;
 return {index,nominalSeconds:minutes*60,baseMinute:index<2?index*periodMinutes:periodMinutes*2+(index-2)*minutes};
}
export type MatchEventTiming={phase?:MatchClockPhase|null;periodElapsedSeconds?:number|null;addedTimeSeconds?:number|null;eventSequence?:string|null;minute:number|null;createdAt:string;id:string};
export function eventTimeLabel(event:Pick<MatchEventTiming,"minute"|"addedTimeSeconds">):string{
 if(event.minute==null)return "—";const added=event.addedTimeSeconds??0;
 return added>0?`${event.minute-Math.floor(added/60)}+${Math.max(1,Math.ceil(added/60))}`:String(event.minute);
}
export function compareMatchEventTiming(a:MatchEventTiming,b:MatchEventTiming):number{
 if(a.phase&&b.phase){const order=(p:MatchClockPhase)=>p==="PENALTIES"?4:PLAYING_CLOCK_PHASES.indexOf(p);const d=order(a.phase)-order(b.phase);if(d)return d;const seconds=(a.periodElapsedSeconds??0)-(b.periodElapsedSeconds??0);if(seconds)return seconds;}
 else {const minutes=(a.minute??0)-(b.minute??0);if(minutes)return minutes;}
 if(a.eventSequence&&b.eventSequence){const x=BigInt(a.eventSequence),y=BigInt(b.eventSequence);if(x!==y)return x<y?-1:1;}
 return a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id);
}
/** Extrapolate a received official snapshot with a monotonic browser delta. */
export const clockElapsedMilliseconds=(clock:MatchClockState,deltaMilliseconds=0)=>(clock.elapsedMilliseconds??clock.elapsedSeconds*1000)+(clock.isRunning?Math.max(0,deltaMilliseconds):0);
