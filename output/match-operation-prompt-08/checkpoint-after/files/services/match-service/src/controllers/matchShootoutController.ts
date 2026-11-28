import type {Response,NextFunction} from 'express';
import type {AuthenticatedRequest} from '../middleware/gatewayUser';
import {assertCanManageMatch} from '../scheduling/authorization';
import {withRefereeOperation} from '../services/matchOperationReadinessService';
import {changeShootout,getShootoutWorkspace} from '../repositories/matchShootoutRepository';
export const matchShootoutController={
 async get(req:AuthenticatedRequest,res:Response,next:NextFunction){try{await assertCanManageMatch(req,req.params.matchId,'READ');res.json(await getShootoutWorkspace(req.params.matchId));}catch(e){next(e);}},
 async change(req:AuthenticatedRequest,res:Response,next:NextFunction){try{const action=req.body.action,cap=action==='KICK'?'RECORD_EVENT':action==='CORRECT'||action==='VOID_LAST'?'EDIT_EVENT':'FINALIZE';res.json(await withRefereeOperation(req,req.params.matchId,cap,()=>changeShootout(req.params.matchId,req.body,req.userId!)));}catch(e){next(e);}}
};
