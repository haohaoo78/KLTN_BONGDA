import type { MatchPreparation,MatchSquad,SquadEntry,SquadRoster,PreparationIssue,EffectiveMatchRules } from "@sfl/shared";
import { createHash } from "node:crypto";
import { getPool } from "../lib/db";
import { config } from "../config";
import { AppError } from "../lib/errors";
import { getEffectiveMatchRules } from "./matchOperationRulesService";
import { checkPlayerSuspension } from "../discipline/services/disciplineService";
import { withOperationScheduleLock } from "../scheduling/repositories/matchOperationReadinessRepository";
import { getTournamentScheduleSettings } from "../scheduling/services/schedulingService";
import { squadEntries,squadRecord,squadHistory,squadTransaction,replaceSquadEntries,type SquadQuery } from "../repositories/matchSquadRepository";
import { publishMatchUpdate } from "../realtime/matchRealtime";
import { validateSquad } from "./matchSquadValidation";
import { getPublishedDraw } from "./fixtureGenerationService";
const signature=(r:EffectiveMatchRules)=>createHash("sha256").update(JSON.stringify(r)).digest("hex");
const revision=(n:unknown)=>{if(!Number.isInteger(n)||Number(n)<0)throw new AppError(400,"Cần expectedRevision không âm để tránh ghi đè đội hình.","SQUAD_VERSION_REQUIRED");return Number(n);};
export function parseSquadEntries(input:unknown):SquadEntry[]{
 if(!Array.isArray(input)||input.length>100)throw new AppError(400,"Danh sách đội hình không hợp lệ.","SQUAD_INVALID");
 return input.map(p=>{if(!p||typeof p.playerId!=="string"||!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(p.playerId)||typeof p.isStarting!=="boolean"||p.position!=null&&(typeof p.position!=="string"||p.position.length>50)||p.jerseyNumber!=null&&(!Number.isInteger(p.jerseyNumber)||p.jerseyNumber<1))throw new AppError(400,"Cầu thủ, số áo hoặc vị trí không hợp lệ.","SQUAD_INVALID");return {playerId:p.playerId,jerseyNumber:p.jerseyNumber??null,position:p.position?.trim().toUpperCase()||null,isStarting:p.isStarting};});
}
export async function matchRoster(tournamentId:string,teamId:string,matchId:string,q?:SquadQuery):Promise<SquadRoster>{
 let response:Response;try{response=await fetch(new URL(`/internal/tournaments/${tournamentId}/teams/${teamId}/match-roster`,config.organizationServiceUrl),{headers:{"x-gateway-internal-key":config.internalApiKey},signal:AbortSignal.timeout(6000)});}catch{throw new AppError(503,"Không thể kiểm tra roster chính thức.","SQUAD_ROSTER_UNAVAILABLE");}
 if(!response.ok)throw new AppError(502,"Không đọc được roster chính thức; không dùng danh sách CLB thay thế.","SQUAD_ROSTER_UNAVAILABLE");
 const {roster}=await response.json() as {roster:SquadRoster};if(roster?.teamId!==teamId||roster.tournamentId!==tournamentId||!Array.isArray(roster.players))throw new AppError(502,"Dữ liệu roster không hợp lệ.","SQUAD_ROSTER_INVALID");
 await Promise.all(roster.players.map(async p=>{if(p.eligible&&await checkPlayerSuspension(p.id,tournamentId,matchId,q)){p.eligible=false;p.reasons.push("Cầu thủ đang bị treo giò trong trận này.");}}));return roster;
}
function teamInMatch(match:any,teamId:string){if(![match.home_team_id,match.away_team_id].includes(teamId))throw new AppError(403,"Đội không tham gia trận này.","SQUAD_TEAM_MISMATCH");}
function beforeMatch(match:any){if(!["SCHEDULED","LINEUP_CONFIRMED"].includes(match.status))throw new AppError(409,"Trạng thái trận không cho phép chỉnh đội hình trước trận. Trong trận phải dùng sự kiện phù hợp.","SQUAD_MATCH_LOCKED");}
export async function readTeamSquad(match:any,teamId:string,q:SquadQuery=getPool(),rules?:EffectiveMatchRules){
 teamInMatch(match,teamId);const [record,entries,roster,effective]=await Promise.all([squadRecord(q,match.id,teamId),squadEntries(q,match.id,teamId),matchRoster(match.tournament_id,teamId,match.id,q),rules??getEffectiveMatchRules(match.id,q)]);
 const issues=validateSquad(entries,roster,effective);
 if(record?.status!=="SUBMITTED")issues.push({code:"SQUAD_NOT_SUBMITTED",message:"Đội trưởng chưa gửi đội hình hiện hành."});
 if(record?.status==="SUBMITTED"&&(record.roster_revision!==roster.revision||record.rules_revision!==signature(effective)))issues.push({code:"SQUAD_SOURCE_CHANGED",message:"Roster hoặc quy tắc áp dụng đã thay đổi; cần kiểm tra và gửi lại đội hình."});
 const squad:MatchSquad={matchId:match.id,teamId,revision:record?.revision??0,status:record?.status??"DRAFT",submittedAt:record?.submitted_at?.toISOString()??null,reviewedAt:record?.reviewed_at?.toISOString()??null,note:record?.note??null,rosterRevision:record?.roster_revision??null,entries,issues,valid:!issues.length};
 return {squad,roster,rules:effective};
}
export async function preparation(matchId:string,q:SquadQuery=getPool()):Promise<MatchPreparation>{
 const m=(await q.query("SELECT * FROM matches WHERE id=$1",[matchId])).rows[0];if(!m)throw new AppError(404,"Không tìm thấy trận.","MATCH_NOT_FOUND");
 const rules=await getEffectiveMatchRules(matchId,q),squads=await Promise.all([m.home_team_id,m.away_team_id].filter(Boolean).map(async id=>(await readTeamSquad(m,id,q,rules)).squad));
 const issues=(await q.query("SELECT id,match_id,team_id,kind,description,resolved_at,resolution,created_at FROM match_preparation_issues WHERE match_id=$1 ORDER BY created_at DESC",[matchId])).rows.map(r=>({id:r.id,matchId:r.match_id,teamId:r.team_id,kind:r.kind,description:r.description,resolvedAt:r.resolved_at?.toISOString()??null,resolution:r.resolution,createdAt:r.created_at.toISOString()})) as PreparationIssue[];
 const ready=squads.length===2&&squads.every(s=>s.valid&&s.reviewedAt!==null)&&!issues.some(i=>!i.resolvedAt);
 return {squads,issues,ready,inconsistent:m.status==="LINEUP_CONFIRMED"&&!ready};
}
export async function saveSquad(matchId:string,teamId:string,actorId:string,input:{entries:unknown;expectedRevision:unknown;submit?:boolean;append?:boolean;confirm?:boolean}){
 const expected=revision(input.expectedRevision);
 return withOperationScheduleLock(matchId,async context=>squadTransaction(matchId,async(c,m)=>{
  teamInMatch(m,teamId);beforeMatch(m);if(m.status==="LINEUP_CONFIRMED")throw new AppError(409,"Trận đã sẵn sàng. Cần người có thẩm quyền mở lại chuẩn bị trước khi sửa.","SQUAD_MATCH_LOCKED");
  const draw=await getPublishedDraw(m.tournament_id),fixture=await c.query("SELECT 1 FROM match_fixture_generations WHERE draw_version_id=$1 AND stage=$2 AND publication_status='PUBLISHED'",[m.draw_version_id,m.stage]);
  if(draw.id!==m.draw_version_id||!fixture.rowCount)throw new AppError(409,"Trận không thuộc sơ đồ chính thức hiện hành.","SQUAD_FIXTURE_REQUIRED");
  const tour=await getTournamentScheduleSettings(m.tournament_id);if(!["PREPARING","IN_PROGRESS"].includes(tour.status))throw new AppError(409,"Giải chưa cho phép chuẩn bị đội hình.","SQUAD_TOURNAMENT_STATE");
  const {squad,roster,rules}=await readTeamSquad(m,teamId,c);if(squad.revision!==expected)throw new AppError(409,"Đội hình đã thay đổi ở thiết bị khác. Hãy tải lại trước khi lưu.","SQUAD_VERSION_CONFLICT");
  if(roster.captainId!==actorId)throw new AppError(403,"Bạn không còn là người đại diện hiện tại của đội.","SQUAD_CAPTAIN_CHANGED");
  const v=rules.rules.values,submit=input.submit===true||input.confirm===true;
  const deadlines=[...(!input.confirm?[v.lineupEditMinutes]:[]),...(submit?[v.lineupSubmissionMinutes]:[])];
  if(deadlines.some(deadline=>typeof deadline==="number"&&Date.now()>Date.parse(context.schedule.scheduledDate)-deadline*60000))throw new AppError(409,"Đã qua hạn đội hình theo điều lệ. Cần xử lý theo thẩm quyền thay đổi sát giờ, không tự bỏ hạn.","SQUAD_DEADLINE_PASSED");
  const parsed=input.confirm?squad.entries:parseSquadEntries(input.entries),entries=input.append?[...squad.entries,...parsed]:parsed,issues=validateSquad(entries,roster,rules,submit);
  if(issues.length)throw new AppError(409,"Đội hình chưa hợp lệ.","SQUAD_INVALID",{issues});
  await replaceSquadEntries(c,matchId,teamId,entries,submit?actorId:null);
  await c.query(`INSERT INTO match_squads(match_id,team_id,revision,status,submitted_by,submitted_at,roster_revision,rules_revision)
   VALUES($1,$2,$3,$4,$5,CASE WHEN $5::uuid IS NULL THEN NULL ELSE NOW() END,$6,$7)
   ON CONFLICT(match_id,team_id) DO UPDATE SET revision=EXCLUDED.revision,status=EXCLUDED.status,submitted_by=EXCLUDED.submitted_by,submitted_at=EXCLUDED.submitted_at,
    reviewed_by=NULL,reviewed_at=NULL,roster_revision=EXCLUDED.roster_revision,rules_revision=EXCLUDED.rules_revision,updated_at=NOW()`,[matchId,teamId,expected+1,submit?"SUBMITTED":"DRAFT",submit?actorId:null,roster.revision,signature(rules)]);
  await squadHistory(c,matchId,teamId,expected+1,submit?"SUBMITTED":"DRAFT_SAVED",actorId,null,{before:squad,entries,rosterRevision:roster.revision,rulesRevision:signature(rules)});
  await publishMatchUpdate(c,matchId,"match.lineup.changed");return {revision:expected+1};
 }));
}
export async function reviewSquad(matchId:string,teamId:string,actorId:string,expectedInput:unknown,approve:boolean,note:string){
 if(note.length>2000)throw new AppError(400,"Nội dung kiểm tra tối đa 2000 ký tự.","SQUAD_INVALID");
 const expected=revision(expectedInput);
 return squadTransaction(matchId,async(c,m)=>{teamInMatch(m,teamId);beforeMatch(m);const {squad}=await readTeamSquad(m,teamId,c);if(squad.revision!==expected)throw new AppError(409,"Đội hình vừa thay đổi.","SQUAD_VERSION_CONFLICT");
  if(approve&&!squad.valid)throw new AppError(409,"Đội trưởng chưa gửi đội hình hợp lệ.","SQUAD_INVALID",{issues:squad.issues});
  if(!approve&&!note.trim())throw new AppError(400,"Cần nêu nội dung phải điều chỉnh.","SQUAD_REASON_REQUIRED");
  if(!squad.revision)throw new AppError(409,"Chưa có bản đội hình để kiểm tra.","SQUAD_NOT_SUBMITTED");
  await c.query("UPDATE match_squads SET revision=revision+1,status=$3,reviewed_by=$4,reviewed_at=CASE WHEN $5 THEN NOW() ELSE NULL END,note=$6,updated_at=NOW() WHERE match_id=$1 AND team_id=$2",[matchId,teamId,approve?"SUBMITTED":"CHANGES_REQUESTED",actorId,approve,note.trim()||null]);
  if(!approve){await c.query("UPDATE lineups SET confirmed_by=NULL,confirmed_at=NULL WHERE match_id=$1 AND team_id=$2",[matchId,teamId]);if(m.status==="LINEUP_CONFIRMED")await c.query("UPDATE matches SET status='SCHEDULED',updated_at=NOW() WHERE id=$1",[matchId]);}
  await squadHistory(c,matchId,teamId,expected+1,approve?"REVIEWED":"CHANGES_REQUESTED",actorId,note,squad);
  await publishMatchUpdate(c,matchId,"match.lineup.changed");return {revision:expected+1};
 });
}
export async function preparationIssue(matchId:string,actorId:string,input:{teamId?:string;kind:string;description:string}){
 if(!["TEAM_ABSENT","INSUFFICIENT_PLAYERS","INELIGIBLE_PLAYER","VENUE_UNSAFE","OTHER"].includes(input.kind)||typeof input.description!=="string"||!input.description.trim()||input.description.length>2000)throw new AppError(400,"Cần loại vấn đề và nội dung cụ thể.","SQUAD_ISSUE_INVALID");
 return squadTransaction(matchId,async(c,m)=>{beforeMatch(m);if(input.teamId)teamInMatch(m,input.teamId);const r=await c.query("INSERT INTO match_preparation_issues(match_id,team_id,kind,description,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id",[matchId,input.teamId??null,input.kind,input.description.trim(),actorId]);
  if(m.status==="LINEUP_CONFIRMED")await c.query("UPDATE matches SET status='SCHEDULED',updated_at=NOW() WHERE id=$1",[matchId]);await squadHistory(c,matchId,input.teamId??null,0,"ISSUE_REPORTED",actorId,input.description,{issueId:r.rows[0].id,kind:input.kind});await publishMatchUpdate(c,matchId,"match.lineup.changed");return r.rows[0];});
}
export async function organizerPreparation(matchId:string,actorId:string,input:{action:string;issueId?:string;reason:string}){
 if(typeof input.reason!=="string"||!input.reason.trim()||input.reason.length>2000)throw new AppError(400,"Cần lý do xử lý có thẩm quyền.","SQUAD_REASON_REQUIRED");
 return withOperationScheduleLock(matchId,()=>squadTransaction(matchId,async(c,m)=>{beforeMatch(m);
  const before={matchStatus:m.status,squads:(await c.query("SELECT * FROM match_squads WHERE match_id=$1",[matchId])).rows,lineups:(await c.query("SELECT * FROM lineups WHERE match_id=$1",[matchId])).rows};
  if(input.action==="RESOLVE_ISSUE"){const r=await c.query("UPDATE match_preparation_issues SET resolved_by=$3,resolved_at=NOW(),resolution=$4 WHERE id=$1 AND match_id=$2 AND resolved_at IS NULL RETURNING id",[input.issueId,matchId,actorId,input.reason]);if(!r.rowCount)throw new AppError(409,"Vấn đề không tồn tại hoặc đã được xử lý.","SQUAD_ISSUE_CONFLICT");}
  else if(input.action==="REOPEN"){const clock=await c.query("SELECT phase FROM match_clock_states WHERE match_id=$1",[matchId]);if(clock.rows.some(r=>r.phase!=="NOT_STARTED")||(await c.query("SELECT 1 FROM match_events WHERE match_id=$1 LIMIT 1",[matchId])).rowCount)throw new AppError(409,"Trận đã có dữ liệu thi đấu, không thể mở lại bằng quy trình trước trận.","SQUAD_MATCH_LOCKED");
   await c.query("UPDATE matches SET status='SCHEDULED',updated_at=NOW() WHERE id=$1",[matchId]);await c.query("UPDATE match_squads SET status='CHANGES_REQUESTED',reviewed_at=NULL,reviewed_by=NULL,revision=revision+1,note=$2 WHERE match_id=$1",[matchId,input.reason]);await c.query("UPDATE lineups SET confirmed_by=NULL,confirmed_at=NULL WHERE match_id=$1",[matchId]);
  }else throw new AppError(400,"Thao tác không hợp lệ.","SQUAD_INVALID");
  await squadHistory(c,matchId,null,0,input.action,actorId,input.reason,{before,input});await publishMatchUpdate(c,matchId,"match.lineup.changed");return {updated:true};
 }));
}
export async function confirmPreparedMatch(matchId:string,actorId:string){
 return squadTransaction(matchId,async(c,m)=>{
  if(m.status!=="SCHEDULED")throw new AppError(409,"Chỉ xác nhận chuẩn bị khi trận đang chờ thi đấu.","MATCH_LINEUPS_NOT_READY");
  const checked=await preparation(matchId,c);
  if(!checked.ready)throw new AppError(409,"Hai đội cần gửi đội hình hợp lệ, được trọng tài kiểm tra và xử lý các vấn đề trước trận.","MATCH_LINEUPS_NOT_READY",{preparation:checked});
  await c.query("UPDATE matches SET status='LINEUP_CONFIRMED',updated_at=NOW() WHERE id=$1",[matchId]);
  await squadHistory(c,matchId,null,0,"MATCH_READY",actorId,null,checked);
  await publishMatchUpdate(c,matchId,"match.status.changed");
 });
}
