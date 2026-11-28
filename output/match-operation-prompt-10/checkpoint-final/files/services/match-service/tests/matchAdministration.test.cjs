const test=require('node:test'),assert=require('node:assert/strict');
const {administrationActions,actionPolicyReady}=require('../dist/repositories/matchAdministrationRepository');
test('administrative decisions respect match outcome and hold state',()=>{
 assert.deepEqual(administrationActions('IN_PROGRESS','FIRST_HALF',false),['SUSPEND','POSTPONE','CANCEL','RECOGNIZE','FORFEIT','DISMISS']);
 assert.deepEqual(administrationActions('POSTPONED','FIRST_HALF',false,'POSTPONED'),['CONTINUE','REPLAY','CANCEL','RECOGNIZE','FORFEIT','DISMISS']);
 assert.deepEqual(administrationActions('POSTPONED','FIRST_HALF',false,'REPLAY_REQUIRED'),['DISMISS']);
 assert.deepEqual(administrationActions('FINISHED','ENDED',false),['RECOGNIZE','DISMISS']);
 assert.deepEqual(administrationActions('VERIFIED','ENDED',true),['DISMISS']);
 assert.deepEqual(administrationActions('CANCELLED','NOT_STARTED',false),['DISMISS']);
});
test('administrative decisions stay unavailable until the published rules declare their own policy',()=>{
 const rules={rules:{values:{forfeitPolicy:null,forfeitWinnerScore:null,forfeitLoserScore:null,cancelledMatchPolicy:null,matchInterruptionPolicy:null,matchCancellationPolicy:null,resultRecognitionPolicy:null}},missing:{FINALIZE:['result authority']}};
 for(const action of ['POSTPONE','SUSPEND','CONTINUE','REPLAY','CANCEL','RECOGNIZE','FORFEIT'])assert.equal(actionPolicyReady(action,rules),false,action+' must not be inferred');
 rules.rules.values.matchInterruptionPolicy='Điều lệ mô tả thẩm quyền hoãn, tạm dừng, tiếp tục và đá lại.';
 rules.rules.values.matchCancellationPolicy='Điều lệ mô tả thẩm quyền hủy trận.';rules.rules.values.cancelledMatchPolicy='EXCLUDE_FROM_COMPETITION';
 rules.rules.values.resultRecognitionPolicy='Quy trình điều lệ công nhận kết quả hành chính.';rules.missing.FINALIZE=[];
 rules.rules.values.forfeitPolicy='WALKOVER';rules.rules.values.forfeitWinnerScore=2;rules.rules.values.forfeitLoserScore=0;
 for(const action of ['POSTPONE','SUSPEND','CONTINUE','REPLAY','CANCEL','RECOGNIZE','FORFEIT'])assert.equal(actionPolicyReady(action,rules),true,action+' is explicitly declared');
});
