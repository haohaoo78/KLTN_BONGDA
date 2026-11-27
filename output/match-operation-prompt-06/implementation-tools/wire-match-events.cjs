const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
function edit(file,fn){const p=path.join(root,file);fs.writeFileSync(p,fn(fs.readFileSync(p,'utf8')));}
edit('services/match-service/src/repositories/lineupRepository.ts',s=>{
 s="import {writeMatchEvent,voidRecordedEvent,mapEvent} from './matchEventMutationRepository';\n"+s;
 const start=s.indexOf('export async function createMatchEvent('),end=s.indexOf('// Match Reports',start);
 s=s.slice(0,start)+`export const createMatchEvent=writeMatchEvent;\nexport const deleteMatchEvent=voidRecordedEvent;\n\n`+s.slice(end);
 s=s.replace('export async function listMatchEvents(matchId: string, teamId?: string)','export async function listMatchEvents(matchId: string, teamId?: string, includeCrew=false)');
 s=s.replace(/SELECT id, match_id, team_id, player_id, event_type, minute, description, created_by, created_at, voided_at, voided_by, void_reason,phase,period_elapsed_seconds,added_time_seconds,event_sequence/g,'SELECT *');
 s=s.replace('const params: unknown[] = [matchId];\n\n  if (teamId) {\n    query += ` AND team_id = $2`;\n    params.push(teamId);\n  }\n\n  query += ` ORDER BY event_sequence ASC`;','const params: unknown[] = [matchId];\n  if(!includeCrew)query+=` AND visibility=\'PUBLIC\'`;\n  if(teamId){query+=` AND team_id=$2`;params.push(teamId);}\n  query+=` ORDER BY event_sequence ASC`;');
 s=s.replace('return result.rows.map(mapMatchEvent);','return result.rows.map(mapEvent);').replace('mapMatchEvent(result.rows[0])','mapEvent(result.rows[0])');return s;
});
edit('services/match-service/src/services/refereePortalService.ts',s=>s.replace('listMatchEvents(matchId)','listMatchEvents(matchId,undefined,true)'));
edit('services/match-service/src/services/lineupService.ts',s=>{
 const start=s.indexOf('  const rules = await getEffectiveMatchRules(input.matchId);'),end=s.indexOf('\nexport async function removeMatchEvent',start);
 s=s.slice(0,start)+'  return createMatchEvent(input,createdBy);\n}\n'+s.slice(end);
 s=s.replace('reason: string): Promise<void>','reason: string,expectedRevision?:number): Promise<void>').replace('deleteMatchEvent(id, actorId, reason)','deleteMatchEvent(id, actorId, reason,expectedRevision)');return s;
});
edit('services/match-service/src/controllers/lineupController.ts',s=>s.replace('matchId: req.body.matchId,\n        teamId:', 'operationId:req.body.operationId,relatedPlayerId:req.body.relatedPlayerId,opportunityId:req.body.opportunityId,visibility:req.body.visibility,\n        matchId: req.body.matchId,\n        teamId:').replace('removeMatchEvent(id, (req as any).userId, reason)','removeMatchEvent(id, (req as any).userId, reason,req.body?.expectedRevision)'));
edit('services/match-service/src/discipline/controllers/disciplineController.ts',s=>{
 s="import {addMatchEvent} from '../../services/lineupService';\n"+s;
 s=s.replace('() => issueCard(input, authReq.userId ?? "")','() => addMatchEvent({matchId:input.matchId,teamId:input.teamId,playerId:input.playerId,eventType:input.cardType===\'RED\'?\'RED_CARD\':req.body.secondYellow===true?\'SECOND_YELLOW_CARD\':\'YELLOW_CARD\',minute:input.minute,description:input.reason,operationId:req.body.operationId,phase:req.body.phase,periodElapsedSeconds:req.body.periodElapsedSeconds,expectedClockVersion:req.body.expectedClockVersion}, authReq.userId ?? "")');
 s=s.replace('res.status(201).json({ card });','res.status(201).json({ event:card,disciplineSync:"PENDING" });');return s;
});
