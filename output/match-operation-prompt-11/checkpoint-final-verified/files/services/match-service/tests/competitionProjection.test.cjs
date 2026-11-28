const test=require('node:test'),assert=require('node:assert/strict');
process.env.DATABASE_URL='postgresql://unused@127.0.0.1:1/unit';process.env.SCHEDULING_DATABASE_URL=process.env.DATABASE_URL;process.env.DISCIPLINE_DATABASE_URL=process.env.DATABASE_URL;
const {rankHybridGroup}=require('../dist/services/hybridQualification');
const {fairPlayPenalty,parseFairPlayWeights}=require('../dist/services/competitionPolicies');
const {projectCardBans}=require('../dist/discipline/services/disciplineProjection');
const {aggregateOfficialStatistics}=require('../dist/services/officialStatisticsService');
const f=(a,b,x,y,extra={})=>({homeTeamId:a,awayTeamId:b,homeScore:x,awayScore:y,status:'VERIFIED',resultStatus:'APPROVED',...extra});
const base={groupId:'g',advancingTeamsPerGroup:1,rankingCriteria:['POINTS','GOAL_DIFFERENCE'],pointsForWin:5,pointsForDraw:2,pointsForLoss:1};
test('canonical table supports non-3/1/0, two legs and excludes unapproved scores',()=>{
 const rows=rankHybridGroup({...base,fixtures:[f('A','B',2,0),f('B','A',1,1)]});assert.deepEqual(rows.map(r=>[r.teamId,r.points,r.played,r.won,r.drawn,r.lost,r.goalsAgainst]),[['A',7,2,1,1,0,1],['B',3,2,0,1,1,3]]);
 const draft=rankHybridGroup({...base,fixtures:[f('A','B',99,0,{resultStatus:'PENDING'})],preview:true});assert(draft.every(t=>t.points===0&&t.played===0));
});
test('HEAD_TO_HEAD has only its declared metrics and waits for all required meetings',()=>{
 const cycle=[f('A','B',3,0),f('B','C',1,0),f('C','A',2,0)];
 assert.throws(()=>rankHybridGroup({...base,rankingCriteria:['POINTS','HEAD_TO_HEAD'],headToHeadPolicy:'POINTS',fixtures:cycle}),e=>e.code==='GROUP_STANDINGS_TIE');
 assert.throws(()=>rankHybridGroup({...base,rankingCriteria:['POINTS','HEAD_TO_HEAD'],fixtures:cycle}),e=>e.code==='HEAD_TO_HEAD_POLICY_REQUIRED');
 const preview=rankHybridGroup({...base,rankingCriteria:['HEAD_TO_HEAD','GOALS_FOR'],headToHeadPolicy:'POINTS',fixtures:[f('A','B',1,0),f('B','A',0,0,{resultStatus:'PENDING'})],preview:true});assert(preview.every(t=>!t.groupRank&&t.rankingIssue));
});
test('fair-play uses explicit weights and missing policy never breaks a tie with fabricated zeros',()=>{
 const w={YELLOW:2,SECOND_YELLOW:7,RED:9,YELLOW_RED:12};assert.deepEqual(parseFairPlayWeights(JSON.stringify(w)),w);assert.equal(parseFairPlayWeights('Use normal fair play'),null);
 assert.equal(fairPlayPenalty([{event_type:'YELLOW_CARD'},{event_type:'SECOND_YELLOW_CARD'}],w),7);
 assert.equal(fairPlayPenalty([{event_type:'YELLOW_CARD'},{event_type:'RED_CARD'}],w),12);
 const rows=rankHybridGroup({...base,fixtures:[f('A','B',0,0)],rankingCriteria:['POINTS','FAIR_PLAY'],fairPlayPoints:{A:9,B:2}});assert.equal(rows[0].teamId,'B');
 assert.throws(()=>rankHybridGroup({...base,fixtures:[f('A','B',0,0)],rankingCriteria:['POINTS','FAIR_PLAY']}),e=>e.code==='FAIR_PLAY_POLICY_REQUIRED');
});
test('duplicate pairings cannot masquerade as a complete group and zero fixture preview does not qualify teams',()=>{
 assert.throws(()=>rankHybridGroup({...base,fixtures:[f('A','B',1,0),f('A','B',0,1),f('A','C',1,0)]}),e=>e.code==='GROUP_FIXTURES_INCOMPLETE');
 assert(rankHybridGroup({...base,teamIds:['A','B'],fixtures:[],preview:true}).every(r=>r.played===0&&!r.groupRank));
});
const policy={yellowThreshold:2,yellowBan:1,directRedBan:2,secondYellowBan:1,scope:'TOURNAMENT',reset:'CARRY_ALL',starts:'NEXT_TEAM_MATCH',baseVersion:1,supplementId:'s',secondYellowAccumulation:'EXCLUDE_MATCH',shootoutDiscipline:'RED_ONLY',concurrentSanctions:'SEQUENTIAL'};
const card=(id,match,kind,date,p=policy,phase='FIRST_HALF',sequence=1)=>({id,matchId:match,kind,date,policy:p,stage:'GROUP',phase,sequence,teamId:'A',actor:'ref'});
const game=(id,date,patch={})=>({id,date,teamIds:['A','B'],stage:'GROUP',official:true,fieldPlayed:true,playerRegistered:false,...patch});
test('yellow thresholds are deterministic under replay/void, not based on worker processing timestamps',()=>{
 const a=card('a','m1','YELLOW_CARD','2026-12-01'),b=card('b','m2','YELLOW_CARD','2026-12-02');
 assert.equal(projectCardBans([a,b],[]).length,1);assert.deepEqual(projectCardBans([a,b],[]),projectCardBans([a,b],[]));assert.equal(projectCardBans([b],[]).length,0);
 const ban=projectCardBans([a,b],[game('bye','2026-12-03',{fieldPlayed:false}),game('forfeit','2026-12-04',{fieldPlayed:false}),game('postponed','2026-12-05',{official:false}),game('registered','2026-12-06',{playerRegistered:true}),game('valid','2026-12-07')])[0];assert.deepEqual(ban.served,['valid']);
});
test('second-yellow, direct-red, scope, reset and sequential sanctions use declared policies',()=>{
 const entries=[card('a','m1','YELLOW_CARD','2026-12-01'),card('b','m1','SECOND_YELLOW_CARD','2026-12-01',policy,'FIRST_HALF',2),card('c','m1','RED_CARD','2026-12-01',policy,'FIRST_HALF',3)];
 const bans=projectCardBans(entries,[game('x','2026-12-02'),game('y','2026-12-03'),game('z','2026-12-04')]);assert.deepEqual(bans.map(b=>[b.count,b.served]),[[1,['x']],[2,['y','z']]]);
 const stage={...policy,scope:'STAGE'};assert.equal(projectCardBans([card('r','m1','RED_CARD','2026-12-01',stage)],[game('k','2026-12-02',{stage:'KNOCKOUT'})])[0].served.length,0);
 assert.throws(()=>projectCardBans(entries.map(c=>({...c,policy:{...policy,secondYellowAccumulation:null}})),[]),e=>e.code==='DISCIPLINE_RULES_UNDEFINED');
});
test('shootout cards and stage reset are not inferred from football format',()=>{
 assert.equal(projectCardBans([card('a','m1','YELLOW_CARD','2026-12-01',policy,'PENALTIES'),card('b','m2','YELLOW_CARD','2026-12-02')],[]).length,0);
 const p={...policy,reset:'RESET_BEFORE_KNOCKOUT'};assert.equal(projectCardBans([card('a','m1','YELLOW_CARD','2026-12-01',p),{...card('b','m2','YELLOW_CARD','2026-12-02',p),stage:'KNOCKOUT'}],[]).length,0);
});
test('a yellow followed by a direct red uses an explicit accumulation policy',()=>{
 const first=card('a','m1','YELLOW_CARD','2026-12-01'),red=card('b','m1','RED_CARD','2026-12-01',policy,'FIRST_HALF',2),next=card('c','m2','YELLOW_CARD','2026-12-02');
 assert.throws(()=>projectCardBans([first,red,next],[]),e=>e.code==='DISCIPLINE_RULES_UNDEFINED');
 const withPolicy=value=>[first,red,next].map(c=>({...c,policy:{...c.policy,directRedYellowAccumulation:value}}));
 assert.equal(projectCardBans(withPolicy('EXCLUDE_MATCH'),[]).filter(b=>b.type==='YELLOW_CARDS').length,0);
 assert.equal(projectCardBans(withPolicy('COUNT_FIRST'),[]).filter(b=>b.type==='YELLOW_CARDS').length,1);
});
test('official statistics separate live, penalties, own goals and administrative scores',()=>{
 const m={id:'m',status:'VERIFIED',result_status:'APPROVED',home_team_id:'A',away_team_id:'B',home_score:1,away_score:1,home_extra_time_score:1,away_extra_time_score:0,home_penalty_score:5,away_penalty_score:4,result_origin:'FIELD',actual_started_at:'2026-01-01'};
 const e=(kind,team,player)=>({match_id:'m',event_type:kind,team_id:team,player_id:player});
 const stats=aggregateOfficialStatistics([m,{...m,id:'draft',result_status:'PENDING'},{...m,id:'forfeit',forfeit:true,home_score:3,away_score:0,home_extra_time_score:null}], [e('GOAL','A','a'),e('PENALTY_GOAL','A','a'),e('OWN_GOAL','A','a'),e('YELLOW_CARD','B','b')],[{match_id:'m',team_id:'A',player_id:'a',is_starting:true,confirmed_at:'2026-01-01'}]);
 assert.equal(stats.officialMatchCount,2);assert.equal(stats.fieldGoals,3);assert.equal(stats.administrativeScoreGoals,3);assert.equal(stats.players.find(p=>p.playerId==='a').goals,2);assert.equal(stats.players.find(p=>p.playerId==='a').appearances,1);assert.equal(stats.players[0].assists,null);
});
test('the existing standings read is empty before a published draw; calculation remains strict for writes',async()=>{
 const fixtures=require('../dist/services/fixtureGenerationService'),repo=require('../dist/repositories/matchRepository'),projection=require('../dist/repositories/competitionProjectionRepository'),{AppError}=require('../dist/lib/errors'),db=require('../dist/lib/db'),original=fixtures.getPublishedDraw,originalPool=db.getPool;
 db.getPool=()=>({connect:async()=>({query:async sql=>{assert(['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY','ROLLBACK'].includes(sql));return{rows:[]};},release(){}})});
 fixtures.getPublishedDraw=async()=>{throw new AppError(409,'No published draw','PUBLISHED_DRAW_REQUIRED');};
 try{assert.deepEqual(await repo.listStandings('test-tournament'),[]);await assert.rejects(()=>projection.computeCompetitionStandings('test-tournament'),e=>e.code==='PUBLISHED_DRAW_REQUIRED');}
 finally{fixtures.getPublishedDraw=original;db.getPool=originalPool;}
});
