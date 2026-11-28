const test=require('node:test'),assert=require('node:assert/strict');
const {refereeAssignmentEmailContent,EmailDeliveryService}=require('../dist/services/emailDeliveryService');
const input=()=>({eventKey:'referee-assignment:11111111-1111-4111-8111-111111111111',email:'referee@example.test',fullName:'<Referee>',tournamentId:'tournament',tournamentName:'Cup & League',matchId:'match-1',matchLabel:'Team A — Team B',position:'Trọng tài chính',scheduledAt:'2026-12-18T01:15:00Z',venueName:'Sân 3',location:'TP.HCM',kind:'PUBLISHED'});
test('official email contains actual assignment data, local time and access guidance with escaped HTML',()=>{
 const content=refereeAssignmentEmailContent(input());for(const text of ['Cup & League','Team A — Team B','Trọng tài chính','08:15','Sân 3','TP.HCM','không cần xác nhận'])assert.ok(content.text.includes(text),text);assert.ok(content.html.includes('&lt;Referee&gt;'));assert.ok(content.html.includes('Cup &amp; League'));assert.ok(content.text.includes('/referee?match=match-1'));
 const removed=refereeAssignmentEmailContent({...input(),kind:'REPLACED_OUT',reason:'Không khả dụng'});assert.ok(removed.text.includes('quyền điều hành tương ứng đã được cập nhật'));assert.ok(removed.text.includes('Không khả dụng'));
});
test('replayed delivery reads its ledger without creating a transport or sending SMTP',async()=>{
 const {createHash}=require('node:crypto');const value=input(),hash=createHash('sha256').update(JSON.stringify(value,Object.keys(value).filter(k=>k!=='eventKey').sort())).digest('hex');let queries=0;
 const pool={async query(sql){queries++;if(sql.startsWith('INSERT'))return {rowCount:0,rows:[]};return {rows:[{payload_hash:hash,status:'SENT',sent_at:'2026-11-25T15:00:00Z',error_code:null}]};}};
 const result=await new EmailDeliveryService(pool).sendRefereeAssignmentEmail(value);assert.equal(result.status,'SENT');assert.equal(queries,2);
});
for(const uncertain of [false,true])test(uncertain?'ambiguous SMTP timeout stays pending and cannot send twice':'definitive SMTP failure is durable and an explicit new event may retry',async()=>{
 const mailer=require('nodemailer'),{config}=require('../dist/config'),saved={...config},original=mailer.createTransport,ledger=new Map();let sends=0,fail=true;
 const pool={async query(sql,params){const key=params[0];if(sql.startsWith('INSERT')){if(ledger.has(key))return {rowCount:0,rows:[]};ledger.set(key,{payload_hash:params[2],status:'PENDING',error_code:null});return {rowCount:1,rows:[{}]};}if(sql.startsWith('SELECT'))return {rows:[ledger.get(key)]};if(sql.includes("status='SENT'"))Object.assign(ledger.get(key),{status:'SENT',sent_at:new Date()});else if(sql.includes("status='FAILED'"))Object.assign(ledger.get(key),{status:'FAILED',error_code:params[1]});else if(sql.includes('EMAIL_STATUS_UNCERTAIN'))ledger.get(key).error_code='EMAIL_STATUS_UNCERTAIN';else throw Error('Unexpected SQL');return {rowCount:1,rows:[]};}};
 try{
  Object.assign(config,{smtpHost:'unit.invalid',smtpPort:587,smtpUser:'',smtpPassword:'',mailFrom:'unit@example.invalid',mailDeliveryMode:'smtp'});
  mailer.createTransport=()=>({async sendMail(mail){sends++;if(fail)throw Object.assign(new Error('Unit SMTP fault'),uncertain?{code:'ETIMEDOUT',command:'DATA'}:{code:'ESMTP',responseCode:550,command:'DATA'});return {accepted:[mail.to],messageId:'unit-only'};},close(){}});
  const service=new EmailDeliveryService(pool),value=input();const first=await service.sendRefereeAssignmentEmail(value);assert.equal(first.status,uncertain?'PENDING':'FAILED');fail=false;assert.equal((await service.sendRefereeAssignmentEmail(value)).status,first.status);assert.equal(sends,1);
  if(!uncertain){assert.equal((await service.sendRefereeAssignmentEmail({...value,eventKey:value.eventKey+'-retry'})).status,'SENT');assert.equal(sends,2);}
 }finally{mailer.createTransport=original;Object.assign(config,saved);}
});
