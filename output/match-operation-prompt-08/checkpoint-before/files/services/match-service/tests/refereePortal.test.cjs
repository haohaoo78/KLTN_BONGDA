const test = require('node:test');
const assert = require('node:assert/strict');
// Unit-only projections: an accidental unstubbed database access must fail closed.
process.env.DATABASE_URL = 'postgresql://unused@127.0.0.1:1/referee_portal_unit';
process.env.SCHEDULING_DATABASE_URL = process.env.DATABASE_URL;
process.env.DISCIPLINE_DATABASE_URL = process.env.DATABASE_URL;
const matchRepository = require('../dist/repositories/matchRepository');
const matchService = require('../dist/services/matchService');
const fixtureService = require('../dist/services/fixtureGenerationService');
const schedulingRepository = require('../dist/scheduling/repositories/schedulingRepository');
const publicationRepository = require('../dist/scheduling/repositories/refereePublicationRepository');
const configurationRepository = require('../dist/scheduling/repositories/refereeConfigurationRepository');
const schedulingService = require('../dist/scheduling/services/schedulingService');
const clockRepository = require('../dist/repositories/matchClockRepository');
const lineupRepository = require('../dist/repositories/lineupRepository');
const operationRules = require('../dist/services/matchOperationRulesService');
const operationReadiness = require('../dist/services/matchOperationReadinessService');
const operationSchedule = require('../dist/scheduling/repositories/matchOperationReadinessRepository');
const matchSquad = require('../dist/services/matchSquadService');
const shootoutRepository=require('../dist/repositories/matchShootoutRepository');
const {getRefereePortalAssignments, getRefereeMatchContext} = require('../dist/services/refereePortalService');
const {AppError} = require('../dist/lib/errors');
const matchId = '11111111-1111-4111-8111-111111111111';
const actor = {userId:'22222222-2222-4222-8222-222222222222',userRoles:['REFEREE']};
const tournamentId = '33333333-3333-4333-8333-333333333333';
const match = {id:matchId,tournamentId,homeTeamId:'home',awayTeamId:'away',status:'SCHEDULED',round:'Bang A · Luot 1 · Vong 2'};
const schedule = {id:'schedule',matchId,tournamentId,venueId:'venue',scheduledDate:'2026-12-18T01:15:00Z',status:'PUBLISHED'};

async function withProjection(run, overrides={}) {
  const restored=[];
  const patch=(object,key,value)=>{const original=object[key];restored.push(()=>{object[key]=original;});object[key]=value;};
  const positions=[{code:'REFEREE',label:'Trong tai chinh',required:true,capabilities:['RECORD_EVENT','MANAGE_REPORT','FINALIZE']}];
  patch(shootoutRepository,'getShootoutWorkspace',async()=>null);
  patch(matchService,'getMatch',async()=>match);
  patch(matchRepository,'listManagedTournamentFixtures',async()=>({stages:[{status:'PUBLISHED',matches:[{...match,stage:'GROUP',drawVersionId:'draw',groupId:'group',roundNumber:2,leg:1}]}]}));
  patch(matchRepository,'listKnockoutBracket',async()=>[]);
  patch(matchRepository,'findMatchResultByMatchId',async()=>null);
  patch(fixtureService,'getPublishedDraw',async()=>({id:'draw',groups:[{id:'group',name:'Bang A'}],config:{fixtureRegulationSnapshot:{regulationVersion:1,competitionFormat:'GROUP_AND_KNOCKOUT',rules:{publishedVersion:1,matchDurationMinutes:90,pointsForWin:3}}}}));
  patch(schedulingService,'getTournamentScheduleSettings',async()=>({id:tournamentId,name:'Official tournament',footballFormat:11,competitionFormat:'GROUP_AND_KNOCKOUT',rules:{publishedVersion:2,matchDurationMinutes:100,pointsForWin:4}}));
  patch(schedulingRepository,'listSchedulesByReferee',async()=>[schedule]);
  patch(schedulingRepository,'listScheduleRefereeAssignments',async()=>[{refereeId:actor.userId,position:'REFEREE',isFinalAuthority:true}]);
  patch(schedulingRepository,'getTournamentScheduleResources',async()=>({resources:{venues:[{id:'venue',name:'Official venue',location:'Official address'}]}}));
  patch(schedulingRepository,'findVenueById',async()=>({name:'Venue catalog',location:'Catalog address'}));
  patch(publicationRepository,'publishedRefereePositions',async()=>positions);
  patch(publicationRepository,'refereeDeliveryViews',async()=>[{refereeId:actor.userId,scheduleId:'schedule',fullName:'Actual referee'}]);
  patch(configurationRepository,'configuredPositionsForMatch',async()=>{throw Error('Do not replace the published capability snapshot with current configuration');});
  patch(lineupRepository,'findMatchReportByMatchId',async()=>null);
  patch(lineupRepository,'listLineups',async()=>[]);
  patch(lineupRepository,'listMatchEvents',async()=>[]);
  patch(matchSquad,'preparation',async()=>({squads:[],issues:[],ready:false,inconsistent:false}));
  patch(clockRepository,'getMatchClock',async()=>({phase:'NOT_STARTED',isRunning:false}));
  patch(operationSchedule,'readOperationSchedule',async()=>null);
  patch(operationReadiness,'getMatchOperationReadiness',async()=>({canPrepare:true,canStart:false,crewPublished:true}));
  patch(operationRules,'getEffectiveMatchRules',async()=>({base:{regulationVersion:1,rules:{matchDurationMinutes:90,pointsForWin:3}},supplement:null,bindingRevision:0,missing:{}}));
  const originalFetch=global.fetch;
  global.fetch=async(url)=>({ok:true,json:async()=>{const id=decodeURIComponent(new URL(url).pathname.split('/').pop());return {team:{id,name:id==='home'?'Official home':'Official away',logoUrl:null},players:[]};}});
  try { await run({patch,positions,...overrides}); }
  finally { global.fetch=originalFetch;restored.reverse().forEach(restore=>restore()); }
}

test('portal projection retains official fixture stage, group, round and leg',async()=>withProjection(async()=>{
  const {items}=await getRefereePortalAssignments(actor);assert.equal(items.length,1);
  const item=items[0];assert.equal(item.match.stage,'GROUP');assert.equal(item.match.groupId,'group');assert.equal(item.match.roundNumber,2);assert.equal(item.match.leg,1);
  assert.equal(item.groupName,'Bang A');assert.equal(item.roundLabel,match.round);
  assert.equal(item.venueName,'Official venue');assert.equal(item.home.name,'Official home');assert.equal(item.report,null);
}));
test('match detail reads published regulation and capability snapshots, not newer mutable settings',async()=>withProjection(async()=>{
  const detail=await getRefereeMatchContext(actor,matchId);
  assert.equal(detail.rules.publishedVersion,1);assert.equal(detail.rules.matchDurationMinutes,90);assert.equal(detail.rules.pointsForWin,3);
  assert.deepEqual(detail.assignment.capabilities,['READ','RECORD_EVENT','MANAGE_REPORT','FINALIZE']);assert.equal(detail.crew[0].isMe,true);assert.equal(detail.crew[0].fullName,'Actual referee');
}));
test('knockout metadata comes from the published structure and remains independent of group labels',async()=>withProjection(async({patch})=>{
  patch(matchRepository,'listManagedTournamentFixtures',async()=>({stages:[{status:'PUBLISHED',matches:[{...match,stage:'KNOCKOUT',groupId:null,round:'Tu ket',roundNumber:1,leg:1}]}]}));
  const {items}=await getRefereePortalAssignments(actor);assert.equal(items[0].match.stage,'KNOCKOUT');assert.equal(items[0].groupName,null);assert.equal(items[0].roundLabel,'Tu ket');
}));
test('draft fixture metadata does not replace an assigned legacy match',async()=>withProjection(async({patch})=>{
  patch(matchRepository,'listManagedTournamentFixtures',async()=>({stages:[{status:'DRAFT',matches:[{...match,stage:'KNOCKOUT',round:'Draft round'}]}]}));
  const {items}=await getRefereePortalAssignments(actor);assert.equal(items[0].match.stage,undefined);assert.equal(items[0].roundLabel,match.round);
}));
test('replacement or revocation removes personal access, including a multi-role organizer',async()=>withProjection(async({patch})=>{
  patch(schedulingRepository,'listSchedulesByReferee',async()=>[]);
  patch(clockRepository,'getMatchClock',async()=>{throw Error('Must not initialize a clock for an unauthorized reader');});
  assert.deepEqual(await getRefereePortalAssignments(actor),{items:[]});
  for(const userRoles of [['REFEREE'],['BTC','REFEREE']]) await assert.rejects(getRefereeMatchContext({...actor,userRoles},matchId),{code:'REFEREE_MATCH_FORBIDDEN',status:403});
}));
test('portal rejects anonymous, wrong role and invalid match ID',async()=>withProjection(async()=>{
  await assert.rejects(getRefereePortalAssignments({}),{code:'UNAUTHENTICATED'});
  await assert.rejects(getRefereePortalAssignments({...actor,userRoles:['BTC']}),{code:'FORBIDDEN'});
  await assert.rejects(getRefereeMatchContext(actor,'not-a-uuid'));
}));
test('upstream or database failures remain errors, without synthetic teams or schedules',async()=>withProjection(async({patch})=>{
  global.fetch=async()=>({ok:false});await assert.rejects(getRefereePortalAssignments(actor),{code:'REFEREE_TEAMS_UNAVAILABLE'});
  patch(matchRepository,'listManagedTournamentFixtures',async()=>{throw new AppError(503,'Database unavailable','DB_UNAVAILABLE');});
  await assert.rejects(getRefereePortalAssignments(actor),{code:'DB_UNAVAILABLE'});
}));
