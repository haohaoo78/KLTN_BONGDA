const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '../src');
const cache = new Map();
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  // Environment substitution is restricted to this test loader; production uses Vite.
  const source = readFileSync(file, 'utf8').replaceAll('import.meta.env', '({})');
  const compiled = ts.transpileModule(source, { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const localRequire = (name) => {
    if (name.endsWith('.css')) return {};
    if (!name.startsWith('.')) return require(name);
    const base = path.resolve(path.dirname(file), name);
    const target = [base, `${base}.ts`, `${base}.tsx`].find((entry) => existsSync(entry));
    if (!target) throw new Error(`Missing test module ${base}`);
    return load(target);
  };
  new Function('require', 'module', 'exports', compiled)(localRequire, module, module.exports);
  return module.exports;
}
const modules = (file) => load(path.join(root, 'components/referee', file));
const {selectMatchLaw,resolveMatchOperationRules}=require('@sfl/shared');
function operationRules(method='PENALTIES_ONLY',stage='GROUP'){
  const rules=selectMatchLaw('VFF_7_433_2023');Object.assign(rules.values,{periodMinutes:25,halfTimeMinutes:10,groupDrawPolicy:'ALLOW_DRAW'});
  return resolveMatchOperationRules({regulationVersion:1,footballFormat:7,competitionFormat:'GROUP_AND_KNOCKOUT',rankingCriteria:[],rules:{matchDurationMinutes:50,knockoutDecisionMethod:method,extraTimeMinutes:20}},{id:'qa-rules',rules},stage);
}
test('periodic squad refresh preserves unsaved player choices',()=>{
  const {canApplySquadRefresh}=load(path.join(root,'api/matchSquad.ts'));
  assert.equal(canApplySquadRefresh(false,0,0),true);
  assert.equal(canApplySquadRefresh(true,2,2),false);
  assert.equal(canApplySquadRefresh(true,2,2,true),true);
});
test('a delayed response cannot erase edits made after an explicit refresh began',()=>{
  const {canApplySquadRefresh}=load(path.join(root,'api/matchSquad.ts'));
  assert.equal(canApplySquadRefresh(true,2,3,true),false);
  assert.equal(canApplySquadRefresh(true,2,3),false);
});
const squadSourceSample=()=>({squad:{revision:1,issues:[]},roster:{revision:'r1',players:[{id:'p1',eligible:true,reasons:[]}]},rules:{revision:1},match:{status:'SCHEDULED'},schedule:{status:'PUBLISHED'},tournament:{status:'PREPARING'},history:[]});
test('unchanged squad polling does not invent a remote-change warning',()=>{
  const {squadWorkspaceSource}=load(path.join(root,'api/matchSquad.ts')),a=squadSourceSample(),b=squadSourceSample();
  b.history=[{action:'READ'}];assert.equal(squadWorkspaceSource(a),squadWorkspaceSource(b));
});
test('squad source detects real review, eligibility, rules and match-status changes',()=>{
  const {squadWorkspaceSource}=load(path.join(root,'api/matchSquad.ts')),base=squadWorkspaceSource(squadSourceSample());
  for(const mutate of [d=>d.squad.revision++,d=>d.roster.players[0].eligible=false,d=>d.rules.revision++,d=>d.match.status='LINEUP_CONFIRMED']){const d=squadSourceSample();mutate(d);assert.notEqual(squadWorkspaceSource(d),base);}
});
const matchId = '11111111-1111-4111-8111-111111111111';
const item = { match: { id: matchId, status: 'SCHEDULED', stage: 'GROUP' }, schedule: { scheduledDate: '2026-12-17T18:30:00Z' },
  home: { id: 'h', name: 'Đội A', logoUrl: null }, away: { id: 'a', name: 'Đội B', logoUrl: null },
  tournament: { id: 't', name: 'Giải sinh viên', footballFormat: 7 }, roundLabel: 'Vòng 1', groupName: 'Bảng A', venueName: 'Sân 1',
  assignment: { position: 'REFEREE', label: 'Trọng tài chính', isFinalAuthority: true, capabilities: ['READ','RECORD_EVENT','EDIT_EVENT','MANAGE_REPORT','FINALIZE'] }, result: null, report: null,operationRules:operationRules(),events:[] };

test('server readiness distinguishes preparation from the right to start',()=>{
  const {clockActions}=modules('refereeOperation.ts');
  const context={...item,match:{...item.match,status:'LINEUP_CONFIRMED'},clock:{phase:'NOT_STARTED',isRunning:false},readiness:{crewPublished:true,tournamentStatus:'IN_PROGRESS',canPrepare:true,canStart:false}};
  assert.deepEqual(clockActions(context,Date.parse(item.schedule.scheduledDate)+1000),[]);
  assert.deepEqual(clockActions({...context,readiness:{...context.readiness,canStart:true}},Date.parse(item.schedule.scheduledDate)+1000),['START_MATCH']);
});
test('voided crew and paused tournament expose no clock operation buttons',()=>{
  const {clockActions}=modules('refereeOperation.ts');
  const context={...item,match:{...item.match,status:'IN_PROGRESS'},clock:{phase:'FIRST_HALF',isRunning:true},readiness:{crewPublished:false,tournamentStatus:'IN_PROGRESS'}};
  assert.deepEqual(clockActions(context),[]);
  assert.deepEqual(clockActions({...context,readiness:{crewPublished:true,tournamentStatus:'PAUSED'}}),[]);
});

test('six referee routes resolve without matching an invalid or unrelated path', () => {
  const { parseRefereeRoute, refereePaths } = modules('refereeRoutes.ts');
  for (const page of ['overview','assignments','reports']) assert.equal(parseRefereeRoute(refereePaths[page]).page, page);
  for (const page of ['assignment','operation','report']) assert.deepEqual(parseRefereeRoute(refereePaths[page](matchId)), {page, matchId});
  assert.equal(parseRefereeRoute('/referee/assignments/not-a-match').page, 'notFound');
  assert.equal(parseRefereeRoute('/btc').page, 'notFound');
});
test('overview has four real-data metric cards and no match operation inputs', () => {
  const { RefereeOverviewPage } = modules('RefereeOverviewPage.tsx');
  const html = renderToStaticMarkup(React.createElement(RefereeOverviewPage, { items: [item], fullName: 'Tên trọng tài' }));
  assert.equal((html.match(/class="rf-metric"/g) || []).length, 4);
  assert.match(html, /Tên trọng tài/); assert.match(html, /Đội A/);
  assert.doesNotMatch(html, /<(form|input|select|textarea)\b/);
  assert.doesNotMatch(html, /Bắt đầu trận|Ghi nhận bàn thắng|LINEUP_CONFIRMED|PUBLISHED/);
});
test('assignment filters intersect all fields and use Vietnamese local calendar dates', () => {
  const { filterRefereeAssignments: filter, emptyAssignmentFilters: defaults } = modules('RefereeAssignmentsPage.tsx');
  assert.equal(filter([item], {...defaults, from:'2026-12-18',to:'2026-12-18'}).length, 1);
  for (const value of [{ search:'không tồn tại' }, {tournamentId:'other'}, {position:'OTHER'}, {status:'FINISHED'}, {to:'2026-12-17'}, {from:'2026-12-19'}]) assert.equal(filter([item], {...defaults,...value}).length, 0);
  assert.equal(filter([item], {...defaults,search:'đội a',position:'REFEREE',status:'SCHEDULED',tournamentId:'t'}).length, 1);
});
test('assignment page links details and never offers accept/refuse assignment', () => {
  const { RefereeAssignmentsPage } = modules('RefereeAssignmentsPage.tsx');
  const html = renderToStaticMarkup(React.createElement(RefereeAssignmentsPage, {items:[item]}));
  assert.match(html, /Lịch phân công/); assert.match(html, new RegExp(`/referee/assignments/${matchId}`));
  assert.doesNotMatch(html, /Chấp nhận|Từ chối nhiệm vụ|Xác nhận nhận/);
});
test('match details show identity, rules, lineup and own duty without operation forms', () => {
  const { RefereeMatchDetailPage } = modules('RefereeMatchDetailPage.tsx');
  const context = {...item, rules:{matchDurationMinutes:50,knockoutDecisionMethod:'PENALTIES_ONLY'}, crew:[{refereeId:'u',fullName:'Trọng tài thử',label:'Trọng tài chính',isFinalAuthority:true,isMe:true}],lineups:[]};
  const html=renderToStaticMarkup(React.createElement(RefereeMatchDetailPage,{context}));
  for (const text of ['Điều lệ áp dụng','Tổ trọng tài','Đội hình thi đấu','Nhiệm vụ của bạn']) assert.match(html,new RegExp(text));
  assert.match(html,/Vào không gian tác nghiệp/); assert.doesNotMatch(html,/<(form|input|select)\b|Bắt đầu trận/);
});
test('operation permissions come from capabilities and final authority, never from a role selector', () => {
  const {clockActions,canRecordEvents}=modules('refereeOperation.ts');
  const context={...item,match:{...item.match,status:'IN_PROGRESS'},clock:{phase:'FIRST_HALF',isRunning:true}};
  assert.deepEqual(clockActions(context),['SUSPEND_PLAY','DECLARE_ADDED_TIME']); assert.equal(canRecordEvents(context),true);
  const assistant={...context,assignment:{...item.assignment,isFinalAuthority:false,capabilities:['READ','RECORD_EVENT']}};
  assert.deepEqual(clockActions(assistant),[]); assert.equal(canRecordEvents(assistant),true);
  const observer={...context,assignment:{...item.assignment,isFinalAuthority:false,capabilities:['READ']}};
  assert.deepEqual(clockActions(observer),[]); assert.equal(canRecordEvents(observer),false);
});
test('kickoff and decision rules constrain operation actions', () => {
  const {clockActions}=modules('refereeOperation.ts');
  const waiting={...item,match:{...item.match,status:'LINEUP_CONFIRMED'},clock:{phase:'NOT_STARTED',isRunning:false}};
  assert.deepEqual(clockActions(waiting,Date.parse('2026-01-01')),[]);
  assert.deepEqual(clockActions(waiting,Date.parse('2027-01-01')),['START_MATCH']);
  const completed={...item,match:{...item.match,stage:'KNOCKOUT',status:'IN_PROGRESS'},clock:{phase:'REGULATION_COMPLETE',isRunning:false},operationRules:operationRules('PENALTIES_ONLY','KNOCKOUT')};
  assert.deepEqual(clockActions(completed),['START_PENALTIES']);
  assert.deepEqual(clockActions({...completed,operationRules:operationRules('EXTRA_TIME_THEN_PENALTIES','KNOCKOUT')}),['START_EXTRA_TIME']);
  assert.deepEqual(clockActions({...completed,events:[{eventType:'GOAL',teamId:'h',phase:'FIRST_HALF'}]}),['END_MATCH']);
});
test('score aggregation counts own goals against the event team and respects halftime', () => {
  const {scoreFromEvents}=modules('refereeOperation.ts');
  const events=[{eventType:'GOAL',teamId:'h',minute:10,phase:'FIRST_HALF'},{eventType:'OWN_GOAL',teamId:'h',minute:28,phase:'FIRST_HALF'},{eventType:'PENALTY_GOAL',teamId:'a',minute:30,phase:'SECOND_HALF'},{eventType:'RED_CARD',teamId:'h',minute:15,phase:'FIRST_HALF'}];
  assert.deepEqual(scoreFromEvents(events,'h','a'),{home:1,away:2});
  assert.deepEqual(scoreFromEvents(events,'h','a','FIRST_HALF'),{home:1,away:1});
});
test('event minute continues across halves and includes running delta', () => {
  const {eventMinuteForClock,clockSeconds}=modules('refereeOperation.ts');
  assert.equal(eventMinuteForClock(45*60+5*60,30),50);
  assert.equal(eventMinuteForClock(119*60,120),121);
  assert.equal(clockSeconds(61),'01:01');
});
test('missing clock policy, administrative interruption and legacy clock review hide clock controls',()=>{
 const {clockActions}=modules('refereeOperation.ts'),base={...item,match:{...item.match,status:'IN_PROGRESS'},clock:{phase:'FIRST_HALF',isRunning:true,elapsedSeconds:1500}};
 assert.deepEqual(clockActions({...base,operationRules:null}),[]);
 assert.deepEqual(clockActions({...base,clock:{...base.clock,reviewRequired:true}}),[]);
 for(const interruption of ['POSTPONED','CANCELLED','ABANDONED'])assert.deepEqual(clockActions({...base,clock:{...base.clock,interruption}}),[]);
 assert.deepEqual(clockActions(base),['SUSPEND_PLAY','DECLARE_ADDED_TIME','END_PERIOD']);
});
test('event form captures actual period and revision without inferring the half from the minute',()=>{
 const {currentEventTiming}=modules('refereeOperation.ts');
 assert.deepEqual(currentEventTiming({...item,clock:{phase:'FIRST_HALF',version:9}},28*60),{phase:'FIRST_HALF',periodElapsedSeconds:1680,minute:28,expectedClockVersion:9});
 assert.equal(currentEventTiming({...item,clock:{phase:'SECOND_HALF',version:10}},0).minute,25);
});
test('operation initially shows only pre-match and no event entry forms', () => {
  const {RefereeOperationPage}=modules('RefereeOperationPage.tsx');
  const {DialogProvider}=load(path.join(root,'components/DialogProvider.tsx'));
  const context={...item,rules:{},lineups:[],events:[],crew:[],clock:{phase:'NOT_STARTED',isRunning:false,elapsedSeconds:0,version:0},playerNames:{}};
  const html=renderToStaticMarkup(React.createElement(DialogProvider,null,React.createElement(RefereeOperationPage,{context,refresh:()=>{}})));
  assert.match(html,/Chuẩn bị trận đấu/);assert.doesNotMatch(html,/rf-scoreboard|rf-event-form|rf-report-form|role="dialog"/);
  assert.doesNotMatch(html,/Chuyển nhiệm vụ|Phân công tự động/);
});
test('report list contains finished/recorded reports only and has no operation form', () => {
  const {RefereeReportsPage,reportableAssignments}=modules('RefereeReportsPage.tsx');
  assert.equal(reportableAssignments([item]).length,0);
  const finished={...item,match:{...item.match,status:'FINISHED'}};
  assert.equal(reportableAssignments([finished]).length,1);
  const html=renderToStaticMarkup(React.createElement(RefereeReportsPage,{items:[finished]}));
  assert.match(html,/Xem biên bản/);assert.doesNotMatch(html,/rf-event-form|Bắt đầu trận|rf-scoreboard/);
});
test('report detail is read-only and does not invent a report before the match', () => {
  const {RefereeReportDetailPage}=modules('RefereeReportsPage.tsx');
  const context={...item,rules:{},lineups:[],events:[],crew:[],clock:{phase:'NOT_STARTED',isRunning:false,elapsedSeconds:0,version:0},playerNames:{}};
  const html=renderToStaticMarkup(React.createElement(RefereeReportDetailPage,{context}));
  assert.match(html,/Biên bản chưa được gửi/);assert.doesNotMatch(html,/<(form|input|textarea)\b|Xác nhận kết quả &amp;/);
});
test('live operation shows capability tools with event modal closed initially', () => {
  const {RefereeOperationPage}=modules('RefereeOperationPage.tsx');const {DialogProvider}=load(path.join(root,'components/DialogProvider.tsx'));
  const context={...item,match:{...item.match,status:'IN_PROGRESS'},rules:{},lineups:[],events:[],crew:[],clock:{phase:'FIRST_HALF',isRunning:true,elapsedSeconds:60,totalElapsedSeconds:60,version:1},playerNames:{}};
  const render=(value)=>renderToStaticMarkup(React.createElement(DialogProvider,null,React.createElement(RefereeOperationPage,{context:value,refresh:()=>{}})));
  const html=render(context);assert.match(html,/rf-scoreboard/);assert.match(html,/Ghi nhận diễn biến/);assert.match(html,/Tạm dừng thi đấu/);assert.match(html,/Công bố bù giờ/);assert.doesNotMatch(html,/Kết thúc hiệp|rf-event-form|rf-report-form|Chuẩn bị trận đấu/);
  const observer=render({...context,assignment:{...item.assignment,isFinalAuthority:false,capabilities:['READ']}});
  assert.doesNotMatch(observer,/Kết thúc hiệp|Ghi nhận diễn biến<|>Bàn thắng</);assert.match(observer,/chưa cho phép ghi diễn biến/);
});
test('post-match draft is initialized from recorded events and has no live toolbox', () => {
  const {RefereeOperationPage}=modules('RefereeOperationPage.tsx');const {DialogProvider}=load(path.join(root,'components/DialogProvider.tsx'));
  const context={...item,match:{...item.match,status:'FINISHED'},rules:{matchDurationMinutes:50},lineups:[],events:[{id:'g',teamId:'h',eventType:'GOAL',minute:10}],crew:[],clock:{phase:'ENDED',isRunning:false,elapsedSeconds:1500,totalElapsedSeconds:3000,version:5},playerNames:{}};
  const html=renderToStaticMarkup(React.createElement(DialogProvider,null,React.createElement(RefereeOperationPage,{context,refresh:()=>{}})));
  assert.match(html,/rf-report-form/);assert.match(html,/Lưu nháp kết quả/);assert.match(html,/Xác nhận kết quả &amp; biên bản/);assert.doesNotMatch(html,/rf-toolbox|rf-event-form|rf-scoreboard/);
});
test('crew detail handles one to more than four people without creating new duty enums', () => {
  const {RefereeCrewCard}=modules('RefereeMatchDetailPage.tsx');
  for(const count of [1,2,3,4,5]){const crew=Array.from({length:count},(_,index)=>({refereeId:`u${index}`,fullName:`Người ${index}`,label:`Vị trí ${index}`,isMe:index===0,isFinalAuthority:index===0}));const html=renderToStaticMarkup(React.createElement(RefereeCrewCard,{context:{...item,crew}}));assert.equal((html.match(/<li /g)||[]).length,count);assert.equal((html.match(/class="is-me"/g)||[]).length,1);}
});
test('assignment search includes a group when the round label does not repeat it', () => {
  const {filterRefereeAssignments:filter,emptyAssignmentFilters:defaults}=modules('RefereeAssignmentsPage.tsx');
  assert.equal(filter([{...item,groupName:'Bảng D',roundLabel:'Lượt 2 · Vòng 3'}],{...defaults,search:'bảng d'}).length,1);
  assert.equal(filter([{...item,groupName:null}],{...defaults,search:'bảng d'}).length,0);
});
test('round labels retain the group once and preserve labels for existing operation/report pages',()=>{
  const {roundDescription}=modules('RefereeShared.tsx');
  assert.equal(roundDescription({groupName:'Bảng A',roundLabel:'Bảng A · Lượt 1 · Vòng 2'}),'Bảng A · Lượt 1 · Vòng 2');
  assert.equal(roundDescription({groupName:'Bảng A',roundLabel:'Vòng 2'}),'Bảng A · Vòng 2');
  assert.equal(roundDescription({groupName:null,roundLabel:'Tứ kết'}),'Tứ kết');
});

// Effects are exercised only in this isolated test harness; production uses React.
function hookHarness() {
  const originals=Object.fromEntries(['useState','useEffect','useCallback'].map(key=>[key,React[key]]));
  const slots=[];let cursor=0,effects=[];
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
  React.useState=(initial)=>{const index=cursor++;if(!slots[index])slots[index]={value:typeof initial==='function'?initial():initial};return [slots[index].value,next=>{slots[index].value=typeof next==='function'?next(slots[index].value):next;}];};
  React.useCallback=(callback,deps)=>{const index=cursor++;if(!slots[index]||!same(slots[index].deps,deps))slots[index]={value:callback,deps};return slots[index].value;};
  React.useEffect=(effect,deps)=>{const index=cursor++;if(!slots[index]||!same(slots[index].deps,deps)){const old=slots[index];slots[index]={deps};effects.push(()=>{old?.cleanup?.();slots[index].cleanup=effect();});}};
  return {render:callback=>{cursor=0;effects=[];const result=callback();effects.forEach(effect=>effect());return result;},close:()=>{slots.forEach(slot=>slot?.cleanup?.());Object.assign(React,originals);}};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('open match clears private context after access is revoked and keeps no stale fallback',async()=>{
  const api=load(path.join(root,'api/refereePortal.ts')),original=api.getRefereeContext;
  const {ApiError}=load(path.join(root,'api/client.ts'));
  const {useRefereeContext}=modules('useRefereeContext.ts');const harness=hookHarness();
  const requests=[];api.getRefereeContext=()=>new Promise((resolve,reject)=>requests.push({resolve,reject}));
  try{
    const render=()=>harness.render(()=>useRefereeContext(matchId,0));
    assert.equal(render().loading,true);
    requests[0].resolve(item);await settle();assert.equal(render().context,item);
    render().refresh();render();assert.equal(render().loading,true);
    requests[1].reject(new ApiError(403,'Không còn quyền truy cập','REFEREE_MATCH_FORBIDDEN'));await settle();
    const revoked=render();assert.equal(revoked.context,null);assert.equal(revoked.accessDenied,true);assert.equal(revoked.loading,false);assert.match(revoked.error,/Không còn quyền/);
    revoked.refresh();render();requests[2].reject(new ApiError(503,'Máy chủ không khả dụng'));await settle();
    assert.equal(render().context,null);assert.equal(render().accessDenied,false);assert.match(render().error,/không khả dụng/);
  }finally{harness.close();api.getRefereeContext=original;}
});
test('switching match URLs never exposes the previous context or an out-of-order response',async()=>{
  const api=load(path.join(root,'api/refereePortal.ts')),original=api.getRefereeContext;
  const {useRefereeContext}=modules('useRefereeContext.ts');const harness=hookHarness();
  const requests=[];api.getRefereeContext=id=>new Promise((resolve,reject)=>requests.push({id,resolve,reject}));
  try{
    let id=matchId;const render=()=>harness.render(()=>useRefereeContext(id,0));
    render();requests[0].resolve(item);await settle();assert.equal(render().context,item);
    render().refresh();render();
    id='22222222-2222-4222-8222-222222222222';assert.equal(render().context,null);
    const next={...item,match:{...item.match,id}};requests[2].resolve(next);await settle();assert.equal(render().context,next);
    requests[1].reject(new Error('Previous match error'));await settle();assert.equal(render().context,next);assert.equal(render().error,null);
    render().refresh();render();const updated={...next,assignment:{...next.assignment,isFinalAuthority:false,capabilities:['READ']}};
    requests[3].resolve(updated);await settle();assert.deepEqual(render().context.assignment.capabilities,['READ']);
  }finally{harness.close();api.getRefereeContext=original;}
});
test('personal refresh uses SSE, focus, reconnect and a visible-tab read check with cleanup',()=>{
  const originalGlobals={window:global.window,document:global.document,EventSource:global.EventSource};
  const windowTarget=new EventTarget(),documentTarget=new EventTarget(),timers=new Map();let stream;
  windowTarget.setInterval=(callback,delay)=>{assert.equal(delay,30000);timers.set(1,callback);return 1;};windowTarget.clearInterval=id=>timers.delete(id);
  documentTarget.visibilityState='visible';global.window=windowTarget;global.document=documentTarget;
  global.EventSource=class extends EventTarget{constructor(url,options){super();assert.match(url,/\/api\/matches\/live\/stream$/);assert.equal(options.withCredentials,true);stream=this;}close(){this.closed=true;}};
  const harness=hookHarness();let count=0;
  try{
    const connection=[];const {useRefereeRefresh}=modules('useRefereeRefresh.ts');harness.render(()=>useRefereeRefresh(()=>count++,value=>connection.push(value)));
    stream.onopen();assert.deepEqual(connection,[true]);assert.equal(count,0);
    stream.onerror();stream.onopen();assert.deepEqual(connection,[true,false,true]);assert.equal(count,1);
    stream.dispatchEvent(new Event('sync-required'));assert.equal(count,2);count=0;
    windowTarget.dispatchEvent(new Event('focus'));assert.equal(count,1);
    documentTarget.visibilityState='hidden';timers.get(1)();windowTarget.dispatchEvent(new Event('focus'));assert.equal(count,1);
    documentTarget.visibilityState='visible';documentTarget.dispatchEvent(new Event('visibilitychange'));windowTarget.dispatchEvent(new Event('online'));timers.get(1)();stream.dispatchEvent(new Event('match-update'));assert.equal(count,5);
    harness.close();assert.equal(stream.closed,true);assert.equal(timers.size,0);windowTarget.dispatchEvent(new Event('focus'));assert.equal(count,5);
  }finally{harness.close();for(const [key,value] of Object.entries(originalGlobals)){if(value===undefined)delete global[key];else global[key]=value;}}
});
test('no-assignment overview and list show genuine empty states without operation inputs',()=>{
  const {RefereeOverviewPage}=modules('RefereeOverviewPage.tsx');const {RefereeAssignmentsPage}=modules('RefereeAssignmentsPage.tsx');
  const overview=renderToStaticMarkup(React.createElement(RefereeOverviewPage,{items:[],fullName:'Trọng tài chưa được giao trận'}));
  const list=renderToStaticMarkup(React.createElement(RefereeAssignmentsPage,{items:[]}));
  assert.match(overview,/Chưa có trận đấu sắp tới/);assert.match(list,/Chưa có phân công chính thức/);
  assert.doesNotMatch(overview+list,/Chấp nhận nhiệm vụ|Từ chối nhiệm vụ|Bắt đầu trận|rf-event-form/);
});
module.exports = { load, modules, item, matchId };
