import type { PoolClient } from 'pg';
import { getPool } from '../lib/db';
import { AppError } from '../lib/errors';
import { getEffectiveMatchRules } from './matchOperationRulesService';
import { matchOperationNow } from './matchOperationTime';

type Query = Pick<PoolClient,'query'>;
/** Only immutable business timestamps are anchors. updated_at is never a deadline. */
export async function complaintDeadline(matchId:string, appealPublishedAt?:string, q:Query=getPool()) {
 const rules=await getEffectiveMatchRules(matchId,q), v=rules.rules.values;
 const row=(await q.query(`SELECT m.status,c.actual_ended_at,r.recorded_at,r.status AS result_status,
  p.verified_at,p.status AS report_status,f.created_at AS forfeit_at,
  (SELECT created_at FROM match_administrative_decisions d WHERE d.match_id=m.id AND d.action='RECOGNIZE' ORDER BY revision DESC LIMIT 1) AS recognition_at
  FROM matches m LEFT JOIN match_clock_states c ON c.match_id=m.id
  LEFT JOIN match_results r ON r.match_id=m.id LEFT JOIN match_reports p ON p.match_id=m.id
  LEFT JOIN match_forfeit_decisions f ON f.match_id=m.id WHERE m.id=$1`,[matchId])).rows[0];
 if(!row)throw new AppError(404,'Không tìm thấy trận.','MATCH_NOT_FOUND');
 if(!['FINISHED','VERIFIED','LOCKED','CANCELLED'].includes(row.status))throw new AppError(409,'Trận chưa đến giai đoạn tiếp nhận khiếu nại sau trận. Sự cố trước/trong trận phải được ghi nhận ở hồ sơ sự cố.','COMPLAINT_MATCH_NOT_FINAL');
 const anchor=appealPublishedAt?v.appealAnchor:v.complaintAnchor;
 const hours=appealPublishedAt?v.appealWindowHours:rules.base.rules?.complaintWindowHours;
 let at:unknown=null;
 if(appealPublishedAt&&anchor==='DECISION_PUBLISHED_AT')at=appealPublishedAt;
 else if(!appealPublishedAt&&anchor==='ACTUAL_ENDED_AT')at=row.actual_ended_at;
 else if(!appealPublishedAt&&['FINALIZED_AT','PUBLISHED_AT'].includes(String(anchor))&&row.result_status==='APPROVED')at=row.report_status==='APPROVED'?row.verified_at:row.forfeit_at??row.recognition_at;
 if(!Number.isFinite(Number(hours))||typeof hours!=='number'||hours<0||!at||!Number.isFinite(new Date(at as string).getTime()))throw new AppError(409,'Chưa đủ mốc và thời hạn chính thức cho nghiệp vụ này. Cần bổ sung điều lệ có phiên bản; không dùng thời điểm cập nhật trận hoặc hạn của nghiệp vụ khác.','COMPLAINT_POLICY_UNDEFINED');
 const anchoredAt=new Date(at as string).toISOString(),deadline=new Date(Date.parse(anchoredAt)+hours*3600000).toISOString();
 return {anchor,anchoredAt,hours,deadline,baseRegulationVersion:rules.base.regulationVersion,supplementId:rules.supplement?.id??null,expired:(await matchOperationNow(matchId,q)).getTime()>Date.parse(deadline)};
}
