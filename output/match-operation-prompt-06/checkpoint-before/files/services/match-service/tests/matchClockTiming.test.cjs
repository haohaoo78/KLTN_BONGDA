const test=require('node:test'),assert=require('node:assert/strict');
process.env.DATABASE_URL='postgresql://unused@127.0.0.1:1/clock_unit';
process.env.SCHEDULING_DATABASE_URL=process.env.DATABASE_URL;
const {selectMatchLaw,resolveMatchOperationRules,periodTiming,eventTimeLabel,compareMatchEventTiming,clockElapsedMilliseconds}=require('@sfl/shared');
const {assertClockTimingAction,transitionMatchClock}=require('../dist/services/matchClockWorkflow');
const {clockAccrued,mapClock}=require('../dist/repositories/matchClockRepository');
const {deriveMatchEventTiming}=require('../dist/services/matchEventTiming');
function rules(law='IFAB_2026_27',method='PENALTIES_ONLY',stage='KNOCKOUT'){
 const r=selectMatchLaw(law);Object.assign(r.values,{periodMinutes:law.includes('FUTSAL')?20:law.includes('VFF')?25:45,halfTimeMinutes:10,groupDrawPolicy:'ALLOW_DRAW'});
 return resolveMatchOperationRules({regulationVersion:1,footballFormat:law.includes('FUTSAL')?5:law.includes('VFF')?7:11,competitionFormat:'GROUP_AND_KNOCKOUT',rankingCriteria:[],rules:{matchDurationMinutes:Number(r.values.periodMinutes)*2,extraTimeMinutes:law.includes('VFF')?20:30,knockoutDecisionMethod:method}},{id:'v1',rules:r},stage);
}
const input=(changes={})=>({status:'IN_PROGRESS',phase:'FIRST_HALF',isRunning:true,elapsedSeconds:2700,addedTimeSeconds:0,interruption:null,rules:rules(),action:'END_PERIOD',options:{},score:{home:0,away:0},...changes});
test('every clock action is constrained by the match lifecycle',()=>{
 for(const status of ['SCHEDULED','POSTPONED','CANCELLED','FINISHED','VERIFIED','LOCKED']) assert.throws(()=>assertClockTimingAction(input({status})),{code:'MATCH_CLOCK_STATE_INVALID'});
 assert.throws(()=>assertClockTimingAction(input({action:'START_MATCH'})),{code:'MATCH_CLOCK_STATE_INVALID'});
 assert.doesNotThrow(()=>assertClockTimingAction(input({status:'LINEUP_CONFIRMED',phase:'NOT_STARTED',action:'START_MATCH'})));
});
test('continuous and stopped clock policies expose different pause semantics',()=>{
 assert.throws(()=>assertClockTimingAction(input({action:'PAUSE'})),{code:'CLOCK_STOP_NOT_ALLOWED'});
 assert.doesNotThrow(()=>assertClockTimingAction(input({rules:rules('FIFA_FUTSAL_2026_27'),action:'PAUSE'})));
 assert.throws(()=>assertClockTimingAction(input({action:'SUSPEND_PLAY'})),{code:'CLOCK_REASON_REQUIRED'});
 assert.doesNotThrow(()=>assertClockTimingAction(input({action:'SUSPEND_PLAY',options:{reason:'Unsafe playing conditions'}})));
 assert.throws(()=>assertClockTimingAction(input({action:'RESUME'})),{code:'INVALID_CLOCK_TRANSITION'});
});
test('VFF seven-a-side uses its configured half and continuous clock rather than eleven-player durations',()=>{
 const r=rules('VFF_7_433_2023');assert.deepEqual(r.missing.CLOCK,[]);
 assert.throws(()=>assertClockTimingAction(input({rules:r,elapsedSeconds:1499})),{code:'CLOCK_PERIOD_NOT_COMPLETE'});
 assert.doesNotThrow(()=>assertClockTimingAction(input({rules:r,elapsedSeconds:1500})));
 assert.throws(()=>assertClockTimingAction(input({rules:r,action:'PAUSE'})),{code:'CLOCK_STOP_NOT_ALLOWED'});
});
test('added time stays with its period, may increase and cannot be reduced',()=>{
 assert.doesNotThrow(()=>assertClockTimingAction(input({action:'DECLARE_ADDED_TIME',addedTimeSeconds:180,options:{addedTimeSeconds:240}})));
 assert.throws(()=>assertClockTimingAction(input({action:'DECLARE_ADDED_TIME',addedTimeSeconds:180,options:{addedTimeSeconds:120}})),{code:'ADDED_TIME_CANNOT_DECREASE'});
 assert.throws(()=>assertClockTimingAction(input({action:'DECLARE_ADDED_TIME',rules:rules('FIFA_FUTSAL_2026_27'),options:{addedTimeSeconds:60}})),{code:'ADDED_TIME_NOT_ALLOWED'});
 assert.throws(()=>assertClockTimingAction(input({elapsedSeconds:2699})),{code:'CLOCK_PERIOD_NOT_COMPLETE'});
 assert.throws(()=>assertClockTimingAction(input({elapsedSeconds:2819,addedTimeSeconds:120})),{code:'CLOCK_PERIOD_NOT_COMPLETE'});
 assert.doesNotThrow(()=>assertClockTimingAction(input({elapsedSeconds:2820,addedTimeSeconds:120})));
});
test('temporary suspension and administrative interruption cannot be treated as ordinary pause',()=>{
 assert.throws(()=>assertClockTimingAction(input({interruption:'PLAY_SUSPENDED'})),{code:'MATCH_PLAY_SUSPENDED'});
 assert.doesNotThrow(()=>assertClockTimingAction(input({action:'RESUME',interruption:'PLAY_SUSPENDED'})));
 for(const interruption of ['POSTPONED','ABANDONED','CANCELLED'])assert.throws(()=>assertClockTimingAction(input({action:'RESUME',interruption})),{code:'MATCH_CONTINUATION_DECISION_REQUIRED'});
});
test('cannot skip halves, start twice, resume penalties or end before a valid decision',()=>{
 for(const [phase,running,action] of [['FIRST_HALF',true,'START_MATCH'],['FIRST_HALF',true,'START_NEXT_PERIOD'],['HALF_TIME',false,'END_MATCH'],['PENALTIES',false,'RESUME'],['ENDED',false,'START_MATCH']])assert.throws(()=>transitionMatchClock(phase,running,action),{code:'INVALID_CLOCK_TRANSITION'});
 assert.throws(()=>assertClockTimingAction(input({phase:'REGULATION_COMPLETE',action:'END_MATCH'})),{code:'MATCH_WINNER_REQUIRED'});
 assert.throws(()=>assertClockTimingAction(input({phase:'REGULATION_COMPLETE',action:'START_PENALTIES',score:{home:1,away:0}})),{code:'MATCH_NOT_TIED'});
 assert.throws(()=>assertClockTimingAction(input({phase:'PENALTIES'})),{code:'SHOOTOUT_RESULT_REQUIRED'});
 assert.doesNotThrow(()=>assertClockTimingAction(input({phase:'REGULATION_COMPLETE',action:'END_MATCH',rules:rules('IFAB_2026_27','PENALTIES_ONLY','GROUP')})));
});
test('millisecond snapshots survive rebasing without double counting or losing fractional seconds',()=>{
 const row={match_id:'m',phase:'FIRST_HALF',elapsed_seconds:10,total_elapsed_seconds:10,elapsed_milliseconds:'10900',total_elapsed_milliseconds:'10900',is_running:true,started_at:new Date('2026-01-01T00:00:00Z'),updated_at:new Date('2026-01-01'),version:1,timing_model_version:1};
 const time=clockAccrued(row,new Date('2026-01-01T00:00:00.150Z'));assert.equal(time.elapsedMilliseconds,11050);
 assert.equal(clockAccrued({...row,elapsed_milliseconds:time.elapsedMilliseconds,total_elapsed_milliseconds:time.totalElapsedMilliseconds,started_at:new Date('2026-01-01T00:00:00.150Z')},new Date('2026-01-01T00:00:00.250Z')).elapsedMilliseconds,11150);
 assert.equal(mapClock(row,'IN_PROGRESS',new Date('2026-01-01T00:00:00.150Z')).serverNow,'2026-01-01T00:00:00.150Z');
 assert.equal(clockElapsedMilliseconds({elapsedMilliseconds:11050,isRunning:true},150),11200);
 assert.equal(clockElapsedMilliseconds({elapsedMilliseconds:11050,isRunning:false},150),11050);
});
test('legacy active or inconsistent clocks are flagged without inventing a phase or running time',()=>{
 const row={match_id:'m',phase:'FIRST_HALF',elapsed_seconds:10,total_elapsed_seconds:10,is_running:true,started_at:new Date('2026-01-01'),updated_at:new Date('2026-01-01'),version:1};
 assert.equal(mapClock(row,'IN_PROGRESS').reviewRequired,true);assert.equal(mapClock(row,'IN_PROGRESS').isRunning,false);
 assert.equal(mapClock({...row,timing_model_version:1},'CANCELLED').isRunning,false);
 assert.equal(mapClock({...row,timing_model_version:1},'POSTPONED').interruption,'POSTPONED');
});
test('first-half stoppage goal keeps its phase even beyond half duration',()=>{
 const r=deriveMatchEventTiming({minute:48,phase:'FIRST_HALF',periodElapsedSeconds:2880,expectedClockVersion:3},{phase:'FIRST_HALF',version:3,elapsedSeconds:2881,timing_model_version:1},rules());
 assert.deepEqual(r,{phase:'FIRST_HALF',periodElapsedSeconds:2880,minute:48,addedTimeSeconds:180});assert.equal(eventTimeLabel(r),'45+3');
 assert.throws(()=>deriveMatchEventTiming({phase:'SECOND_HALF'},{phase:'FIRST_HALF',version:3,elapsedSeconds:2881,timing_model_version:1},rules()),{code:'EVENT_PHASE_CHANGED'});
 assert.throws(()=>deriveMatchEventTiming({expectedClockVersion:2},{phase:'FIRST_HALF',version:3,elapsedSeconds:2881,timing_model_version:1},rules()),{code:'CLOCK_VERSION_CONFLICT'});
});
test('events beyond minute 120 are not clamped, future period times and shootout events are rejected',()=>{
 const r=deriveMatchEventTiming({periodElapsedSeconds:960},{phase:'EXTRA_TIME_SECOND_HALF',version:5,elapsedSeconds:960,timing_model_version:1},rules('IFAB_2026_27','EXTRA_TIME_THEN_PENALTIES'));
 assert.equal(r.minute,121);assert.equal(r.addedTimeSeconds,60);assert.equal(eventTimeLabel(r),'120+1');
 assert.throws(()=>deriveMatchEventTiming({periodElapsedSeconds:961},{phase:'EXTRA_TIME_SECOND_HALF',version:5,elapsedSeconds:960,timing_model_version:1},rules('IFAB_2026_27','EXTRA_TIME_THEN_PENALTIES')),{code:'EVENT_TIME_INVALID'});
 assert.throws(()=>deriveMatchEventTiming({},{phase:'PENALTIES',version:5,elapsedSeconds:0,timing_model_version:1},rules()),{code:'EVENT_PHASE_INVALID'});
 assert.throws(()=>deriveMatchEventTiming({},{phase:'FIRST_HALF',version:5,elapsedSeconds:1201,timing_model_version:1},rules('FIFA_FUTSAL_2026_27')),{code:'EVENT_PERIOD_EXPIRED'});
});
test('phase order and sequence produce deterministic ordering for same-minute events',()=>{
 const a={id:'a',createdAt:'x',phase:'FIRST_HALF',minute:48,periodElapsedSeconds:2880,eventSequence:'999'},b={...a,id:'b',phase:'SECOND_HALF',minute:45,periodElapsedSeconds:1,eventSequence:'1000'};
 assert(compareMatchEventTiming(a,b)<0);assert(compareMatchEventTiming({...a,eventSequence:'9007199254740993'},{...a,eventSequence:'9007199254740994'})<0);
 assert.deepEqual(periodTiming('EXTRA_TIME_SECOND_HALF',45,30),{index:3,nominalSeconds:900,baseMinute:105});
});
