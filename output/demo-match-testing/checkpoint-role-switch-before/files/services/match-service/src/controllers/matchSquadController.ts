import type { Response,NextFunction } from "express";
import type { AuthenticatedRequest } from "../middleware/gatewayUser";
import { assertCanSubmitComplaintForTeam,assertCanManageMatch } from "../scheduling/authorization";
import { readOperationSchedule } from "../scheduling/repositories/matchOperationReadinessRepository";
import { withRefereeOperation } from "../services/matchOperationReadinessService";
import { readTeamSquad,saveSquad,preparation,reviewSquad,preparationIssue,organizerPreparation } from "../services/matchSquadService";
import { getPool } from "../lib/db";
import { getTournamentScheduleSettings } from "../scheduling/services/schedulingService";
import { getMatch } from "../services/matchService";
import { AppError } from "../lib/errors";
import { config } from "../config";
import { demoTimeWorkspace } from "../services/matchDemoTimeService";
const wrap=(task:(req:AuthenticatedRequest,res:Response)=>Promise<unknown>)=>async(req:AuthenticatedRequest,res:Response,next:NextFunction)=>{try{await task(req,res);}catch(e){next(e);}};
async function captain(req:AuthenticatedRequest,matchId:string,teamId:string){
 await assertCanSubmitComplaintForTeam(req,teamId);const m=await getMatch(matchId);if(![m.homeTeamId,m.awayTeamId].includes(teamId))throw new AppError(403,"Đội không tham gia trận này.","SQUAD_TEAM_MISMATCH");
}
export const matchSquadController={
 workspace:wrap(async(req,res)=>{
  const {matchId,teamId}=req.params;
  let own=false;
  if(req.userRoles?.includes("TEAM_CAPTAIN")){try{await captain(req,matchId,teamId);own=true;}catch(e){if(!(e instanceof AppError)||e.status!==403)throw e;}}
  if(!own)await assertCanManageMatch(req,matchId,"READ");
  const m=(await getPool().query("SELECT * FROM matches WHERE id=$1",[matchId])).rows[0];if(!m)throw new AppError(404,"Không tìm thấy trận.","MATCH_NOT_FOUND");
  const [view,context,tour]=await Promise.all([readTeamSquad(m,teamId),readOperationSchedule(matchId),getTournamentScheduleSettings(m.tournament_id)]);
  const otherId=m.home_team_id===teamId?m.away_team_id:m.home_team_id;
  const r=await fetch(new URL(`/public/teams/${otherId}`,config.organizationServiceUrl),{headers:{"x-gateway-internal-key":config.internalApiKey},signal:AbortSignal.timeout(6000)});if(!r.ok)throw new AppError(502,"Không đọc được đội đối thủ.","SQUAD_ROSTER_UNAVAILABLE");const other=await r.json() as {team:{id:string;name:string;logoUrl:string|null}};
  const history=(await getPool().query("SELECT revision,action,reason,created_at FROM match_squad_history WHERE match_id=$1 AND (team_id=$2 OR team_id IS NULL) ORDER BY id DESC LIMIT 30",[matchId,teamId])).rows;
  res.json({...view,demoTime:await demoTimeWorkspace(matchId),match:await getMatch(matchId),schedule:context?.schedule??null,tournament:{id:tour.id,name:tour.name,status:tour.status},opponent:other.team,history});
 }),
 save:wrap(async(req,res)=>{const{matchId,teamId}=req.params;await captain(req,matchId,teamId);res.json(await saveSquad(matchId,teamId,req.userId!,{entries:req.body.entries,expectedRevision:req.body.expectedRevision,submit:req.body.submit===true}));}),
 legacyAdd:wrap(async(req,res)=>{const{matchId,teamId}=req.body;await captain(req,matchId,teamId);await saveSquad(matchId,teamId,req.userId!,{entries:[{playerId:req.body.playerId,jerseyNumber:req.body.jerseyNumber??null,position:req.body.position??null,isStarting:req.body.isStarting??true}],expectedRevision:req.body.expectedRevision,append:true});res.status(201).json({saved:true});}),
 legacyConfirm:wrap(async(req,res)=>{const{matchId,teamId}=req.params;await captain(req,matchId,teamId);await saveSquad(matchId,teamId,req.userId!,{entries:[],expectedRevision:req.body.expectedRevision,confirm:true});res.status(204).send();}),
 legacyDelete:wrap(async(req,res)=>{const{matchId,teamId}=req.params;await captain(req,matchId,teamId);await saveSquad(matchId,teamId,req.userId!,{entries:[],expectedRevision:req.body.expectedRevision});res.status(204).send();}),
 preparation:wrap(async(req,res)=>{await assertCanManageMatch(req,req.params.matchId,"READ");res.json({preparation:await preparation(req.params.matchId)});}),
 review:wrap(async(req,res)=>{if(!["APPROVE","REQUEST_CHANGES"].includes(req.body.action))throw new AppError(400,"Thao tác kiểm tra không hợp lệ.","SQUAD_INVALID");res.json(await withRefereeOperation(req,req.params.matchId,"FINALIZE",()=>reviewSquad(req.params.matchId,req.params.teamId,req.userId!,req.body.expectedRevision,req.body.action==="APPROVE",typeof req.body.note==="string"?req.body.note:"")));}),
 reportIssue:wrap(async(req,res)=>res.status(201).json(await withRefereeOperation(req,req.params.matchId,"RECORD_EVENT",()=>preparationIssue(req.params.matchId,req.userId!,req.body)))),
 organizer:wrap(async(req,res)=>{await assertCanManageMatch(req,req.params.matchId,"READ");if(!req.userRoles?.includes("BTC"))throw new AppError(403,"Chỉ BTC quản lý giải được xử lý ngoại lệ.","FORBIDDEN");res.json(await organizerPreparation(req.params.matchId,req.userId!,req.body));}),
};
