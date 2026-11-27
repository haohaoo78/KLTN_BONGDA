import type { Request,Response,NextFunction } from "express";
import { readMatchRoster } from "../repositories/matchRosterRepository";
export async function matchRosterController(req:Request,res:Response,next:NextFunction) {
 try{res.json({roster:await readMatchRoster(req.params.tournamentId,req.params.teamId)});}catch(e){next(e);}
}
