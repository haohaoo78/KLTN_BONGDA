import type { Response,NextFunction } from "express";
import type { AuthenticatedRequest } from "../middleware/gatewayUser";
import { assertCanManageMatch } from "../scheduling/authorization";
import { demoTimeWorkspace,changeDemoTime } from "../services/matchDemoTimeService";
import { config } from "../config";
import { AppError } from "../lib/errors";
const validId=(id:string)=>{if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))throw new AppError(400,"Mã trận không hợp lệ.","VALIDATION_ERROR");};

export const matchDemoTimeController={
 async get(req:AuthenticatedRequest,res:Response,next:NextFunction){try{
  validId(req.params.matchId);
  await assertCanManageMatch(req,req.params.matchId,"READ");res.json(await demoTimeWorkspace(req.params.matchId));
 }catch(error){next(error);}},
 async change(req:AuthenticatedRequest,res:Response,next:NextFunction){try{
  validId(req.params.matchId);
  if(!["development","test"].includes(config.nodeEnv)||!config.matchDemoModeEnabled)throw new AppError(403,"Demo Mode bị vô hiệu hóa ở môi trường này.","DEMO_TIME_DISABLED");
  await assertCanManageMatch(req,req.params.matchId,"FINALIZE");
  res.json(await changeDemoTime(req.params.matchId,req.userId!,req.body));
 }catch(error){next(error);}}
};
