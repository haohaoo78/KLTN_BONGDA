const test=require('node:test'),assert=require('node:assert/strict');
process.env.DATABASE_URL='postgresql://unused@127.0.0.1:1/demo_unit';process.env.SCHEDULING_DATABASE_URL=process.env.DATABASE_URL;
const {config}=require('../dist/config');
const {demoTimeAllowed,matchOperationNow}=require('../dist/services/matchOperationTime');
const t='9f765a91-b8ab-4716-a083-0cf8a113db1b';
test('demo time is opt-in, tournament-scoped, and cannot be enabled in production',()=>{
 config.matchDemoModeEnabled=true;config.matchDemoTournamentIds=[t];
 for(const nodeEnv of ['production','staging','unknown']){config.nodeEnv=nodeEnv;assert.equal(demoTimeAllowed(t),false);}
 for(const nodeEnv of ['development','test']){config.nodeEnv=nodeEnv;assert.equal(demoTimeAllowed(t),true);assert.equal(demoTimeAllowed('other'),false);}
 config.matchDemoModeEnabled=false;assert.equal(demoTimeAllowed(t),false);
});
test('only the selected match domain receives the offset; native Date is unchanged',async()=>{
 config.nodeEnv='test';config.matchDemoModeEnabled=true;config.matchDemoTournamentIds=[t];
 const real=Date.now(),offset=86400000;
 const effective=await matchOperationNow('match',{query:async()=>({rows:[{tournament_id:t,enabled:true,offset_milliseconds:String(offset)}]})});
 assert(effective.getTime()>=real+offset&&effective.getTime()<real+offset+1000);assert(Date.now()<real+1000);
 const ordinary=await matchOperationNow('other',{query:async()=>({rows:[{tournament_id:'other',enabled:false}]})});assert(Math.abs(ordinary.getTime()-Date.now())<1000);
});
test('configuration removal never silently reverts an active simulated clock',async()=>{
 config.nodeEnv='production';config.matchDemoModeEnabled=true;
 await assert.rejects(matchOperationNow('match',{query:async()=>({rows:[{tournament_id:t,enabled:true,offset_milliseconds:123}]})}),{code:'DEMO_TIME_CONFIGURATION_DISABLED'});
 config.nodeEnv='test';config.matchDemoModeEnabled=false;
 await assert.rejects(matchOperationNow('match',{query:async()=>({rows:[{tournament_id:t,enabled:true,offset_milliseconds:123}]})}),{code:'DEMO_TIME_CONFIGURATION_DISABLED'});
});
