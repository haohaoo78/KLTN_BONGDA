// Isolated QA host for the real routers. Time is controlled over parent IPC only;
// no test endpoint or clock override is added to the production service.
const assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(__dirname,'..');
for(const key of ['DATABASE_URL','SCHEDULING_DATABASE_URL','DISCIPLINE_DATABASE_URL'])assert(/^\/sfl_prompt06_qa_/.test(new URL(process.env[key]).pathname),'QA databases only');
assert.equal(process.env.PORT,'19505');assert(process.send,'Only the controlled QA parent may start this host');
const express=require(path.join(root,'services/match-service/node_modules/express'));
const timers=require('node:test').mock.timers;
timers.enable({apis:['Date'],now:Number(process.env.QA_NOW)});
const app=express();app.use(express.json());app.get('/health',(_req,res)=>res.json({status:'ok'}));
app.use(require(path.join(root,'services/match-service/dist/routes/matchRoutes')).matchRoutes);
app.use(require(path.join(root,'services/match-service/dist/scheduling/routes/schedulingRoutes')).schedulingRoutes);
app.use(require(path.join(root,'services/match-service/dist/discipline/routes/disciplineRoutes')).disciplineRoutes);
app.use(require(path.join(root,'services/match-service/dist/middleware/errorHandler')).errorHandler);
let server;const realtime=require(path.join(root,'services/match-service/dist/realtime/matchRealtime'));
async function close(){await realtime.stopMatchRealtimeListener();server?.closeAllConnections();await new Promise(resolve=>server?server.close(resolve):resolve());for(const file of ['lib/db','scheduling/lib/db','discipline/lib/db'])await require(path.join(root,'services/match-service/dist',file)).closePool();timers.reset();process.exit(0);}
process.on('message',async message=>{try{if(message.op==='time'){timers.setTime(message.now);process.send({id:message.id,now:Date.now()});}else if(message.op==='outbox'){const count=await require(path.join(root,'services/match-service/dist/discipline/services/matchEventDisciplineOutbox')).processMatchEventDisciplineOutbox();process.send({id:message.id,count});}else if(message.op==='close')await close();}catch(error){process.send({id:message.id,error:error.message});}});
realtime.startMatchRealtimeListener().then(()=>{server=app.listen(19505,'127.0.0.1',()=>process.send({ready:true}));}).catch(error=>{console.error(error);process.exit(1);});
