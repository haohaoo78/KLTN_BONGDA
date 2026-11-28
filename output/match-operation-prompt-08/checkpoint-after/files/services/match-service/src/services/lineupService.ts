import type {
  Lineup,
  MatchEvent,
  MatchEventCreateInput,
  MatchReport,
  MatchReportCreateInput,
  MatchReportUpdateInput,
} from "../models/match";
import { AppError } from "../lib/errors";
import { assertRuleOperation, assertResultRulePolicy, getEffectiveMatchRules } from "./matchOperationRulesService";
import {
  listLineups,
  listMatchEvents,
  findMatchEventById,
  createMatchEvent,
  deleteMatchEvent,
  findMatchReportByMatchId,
  findMatchReportById,
  finalizeMatchReport,
  updateMatchReport,
  confirmMatchReport as confirmReport,
} from "../repositories/lineupRepository";
import { findMatchResultByMatchId } from "../repositories/matchRepository";
import { getMatch } from "./matchService";
import { checkPlayerSuspension } from "../discipline/services/disciplineService";
import { config } from "../config";
import { getPool } from "../lib/db";
import type { AuthenticatedRequest } from "../middleware/gatewayUser";
import { withOperationScheduleLock } from "../scheduling/repositories/matchOperationReadinessRepository";
import { assertOperationActor, getMatchOperationReadiness } from "./matchOperationReadinessService";
import { configuredCrewHasCapability } from "../scheduling/crewValidation";
import { getRefereeMatchContext } from "./refereePortalService";

// Lineup Service
export async function getLineups(matchId: string, teamId?: string): Promise<Lineup[]> {
  const allowed=await getPool().query(`SELECT s.team_id FROM match_squads s WHERE s.match_id=$1 AND s.status='SUBMITTED'
    UNION SELECT l.team_id FROM lineups l JOIN matches m ON m.id=l.match_id
    WHERE m.id=$1 AND m.status IN ('IN_PROGRESS','FINISHED','VERIFIED','LOCKED')`,[matchId]);
  return (await listLineups(matchId,teamId)).filter(p=>allowed.rows.some(r=>r.team_id===p.teamId));
}

// Match Event Service
export async function getMatchEvents(matchId: string, teamId?: string): Promise<MatchEvent[]> {
  return listMatchEvents(matchId, teamId);
}

export async function getMatchEventById(id: string): Promise<MatchEvent> {
  const event = await findMatchEventById(id);
  if (!event) {
    throw new AppError(404, "Match event not found", "EVENT_NOT_FOUND");
  }
  return event;
}

export async function addMatchEvent(input: MatchEventCreateInput, createdBy: string): Promise<MatchEvent> {
  if (input.minute !== undefined && (!Number.isInteger(input.minute)||input.minute < 0 || input.minute > 2147483647)) {
    throw new AppError(400, "Phút thi đấu phải là số nguyên không âm.", "INVALID_MINUTE");
  }
  if(input.expectedClockVersion!=null&&(!Number.isInteger(input.expectedClockVersion)||input.expectedClockVersion<0))throw new AppError(400,"Phiên bản đồng hồ không hợp lệ.","VALIDATION_ERROR");

  return createMatchEvent(input,createdBy);
}

export async function removeMatchEvent(id: string, actorId: string, reason: string,expectedRevision?:number): Promise<void> {
  const deleted = await deleteMatchEvent(id, actorId, reason,expectedRevision);
  if (!deleted) {
    throw new AppError(404, "Match event not found", "EVENT_NOT_FOUND");
  }
}

// Match Report Service
export async function getMatchReport(matchId: string): Promise<MatchReport> {
  const report = await findMatchReportByMatchId(matchId);
  if (!report) {
    throw new AppError(404, "Match report not found", "REPORT_NOT_FOUND");
  }
  return report;
}

export async function getMatchReportById(id: string): Promise<MatchReport> {
  const report = await findMatchReportById(id);
  if (!report) {
    throw new AppError(404, "Match report not found", "REPORT_NOT_FOUND");
  }
  return report;
}

export async function submitMatchReport(input: MatchReportCreateInput, submittedBy: string, actor: AuthenticatedRequest): Promise<MatchReport> {
  return reportAuthority(actor,input.matchId,"MANAGE_REPORT",async context=>{
    assertRuleOperation(await getEffectiveMatchRules(input.matchId), "FINALIZE");
    const own=context.crew.find(member=>member.refereeId===submittedBy)!;
    const final=own.isFinalAuthority===true&&configuredCrewHasCapability(own.position,true,"FINALIZE",context.publication!.positions);
    return finalizeMatchReport(input, submittedBy, {approveOrdinary:final,loadContext:async()=>{
      const view=await getRefereeMatchContext(actor,input.matchId);
      return {match:view.match,schedule:view.schedule,tournament:view.tournament,home:view.home,away:view.away,
        roundLabel:view.roundLabel,groupName:view.groupName,venueName:view.venueName,venueLocation:view.venueLocation,
        crew:view.crew.map(({isMe,...member})=>member),playerNames:view.playerNames,rules:view.rules,
        operationRules:view.operationRules,preparation:view.preparation,submittedByName:view.crew.find(m=>m.refereeId===submittedBy)?.fullName??null};
    }});
  });
}

/** Specialized report gate permits an authenticated retry after the Match commit;
 * it does not relax the clock/event readiness gate or skip the current crew lease. */
async function reportAuthority<T>(actor:AuthenticatedRequest,matchId:string,capability:"MANAGE_REPORT"|"FINALIZE",task:(context:import("../scheduling/repositories/matchOperationReadinessRepository").OperationScheduleContext)=>Promise<T>){
  if(!actor.userId||!actor.userRoles?.includes("REFEREE"))throw new AppError(403,"Thao tác biên bản yêu cầu trọng tài được phân công.","REFEREE_MATCH_FORBIDDEN");
  return withOperationScheduleLock(matchId,async context=>{
    await assertOperationActor(context,actor.userId!,capability);
    if(capability==="FINALIZE"&&!context.crew.some(m=>m.refereeId===actor.userId&&m.isFinalAuthority))throw new AppError(403,"Chỉ người xác nhận cuối của trận được thực hiện.","FINAL_AUTHORITY_REQUIRED");
    const readiness=await getMatchOperationReadiness(matchId,context);
    const completed=["VERIFIED","LOCKED"].includes(readiness.matchStatus);
    if(!readiness.fixturePublished||!readiness.teamsResolved||(!completed&&(!["PREPARING","IN_PROGRESS"].includes(readiness.tournamentStatus)||readiness.matchStatus!=="FINISHED")))throw new AppError(409,"Trận hoặc giải chưa cho phép hoàn thiện biên bản.","MATCH_OPERATION_NOT_READY");
    return task(context);
  });
}

export async function confirmSubmittedMatchReport(id:string,actor:AuthenticatedRequest,input:{expectedVersion:number;operationId:string;decision?:"APPROVE"|"REQUEST_CHANGES";reason?:string}){
  const report=await getMatchReportById(id);
  return reportAuthority(actor,report.matchId,"FINALIZE",async()=>{
    assertRuleOperation(await getEffectiveMatchRules(report.matchId),"FINALIZE");
    return confirmReport(id,actor.userId!,input);
  });
}

export async function reviewMatchReport(id: string, input: MatchReportUpdateInput, verifiedBy: string): Promise<MatchReport> {
  if (input.status === "APPROVED") {
    const report = await getMatchReportById(id);
    const result = await findMatchResultByMatchId(report.matchId);
    if (result) assertResultRulePolicy(await getEffectiveMatchRules(report.matchId), result, true);
  }
  const updated = await updateMatchReport(id, { ...input, verifiedBy });
  if (!updated) {
    throw new AppError(404, "Match report not found", "REPORT_NOT_FOUND");
  }
  return updated;
}
