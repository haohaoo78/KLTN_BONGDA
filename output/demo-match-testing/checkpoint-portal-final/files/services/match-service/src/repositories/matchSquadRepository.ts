import type { PoolClient } from "pg";
import type { SquadEntry } from "@sfl/shared";
import { getPool } from "../lib/db";
import { AppError } from "../lib/errors";
export type SquadQuery=Pick<PoolClient,"query">;
export async function squadRecord(q:SquadQuery,matchId:string,teamId:string){return (await q.query("SELECT * FROM match_squads WHERE match_id=$1 AND team_id=$2",[matchId,teamId])).rows[0]??null;}
export async function squadEntries(q:SquadQuery,matchId:string,teamId:string):Promise<SquadEntry[]>{return (await q.query("SELECT player_id,jersey_number,position,is_starting FROM lineups WHERE match_id=$1 AND team_id=$2 ORDER BY is_starting DESC,player_id",[matchId,teamId])).rows.map(r=>({playerId:r.player_id,jerseyNumber:r.jersey_number,position:r.position,isStarting:r.is_starting}));}
export async function squadHistory(q:SquadQuery,matchId:string,teamId:string|null,revision:number,action:string,actorId:string,reason:string|null,snapshot:unknown){await q.query("INSERT INTO match_squad_history(match_id,team_id,revision,action,actor_id,reason,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)",[matchId,teamId,revision,action,actorId,reason,JSON.stringify(snapshot)]);}
export async function squadTransaction<T>(matchId:string,task:(c:PoolClient,match:any)=>Promise<T>):Promise<T>{
 const c=await getPool().connect();try{await c.query("BEGIN");const r=await c.query("SELECT * FROM matches WHERE id=$1 FOR UPDATE",[matchId]);if(!r.rowCount)throw new AppError(404,"Không tìm thấy trận.","MATCH_NOT_FOUND");const result=await task(c,r.rows[0]);await c.query("COMMIT");return result;}catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
}
/** All legacy and bulk lineup writes use this replacement inside the same match lock. */
export async function replaceSquadEntries(c:PoolClient,matchId:string,teamId:string,entries:SquadEntry[],submitter:string|null){
 await c.query("DELETE FROM lineups WHERE match_id=$1 AND team_id=$2 AND NOT(player_id=ANY($3::uuid[]))",[matchId,teamId,entries.map(p=>p.playerId)]);
 for(const p of entries){const updated=await c.query("UPDATE lineups SET position=$4,jersey_number=$5,is_starting=$6,confirmed_by=$7,confirmed_at=CASE WHEN $7::uuid IS NULL THEN NULL ELSE NOW() END WHERE match_id=$1 AND team_id=$2 AND player_id=$3",[matchId,teamId,p.playerId,p.position,p.jerseyNumber,p.isStarting,submitter]);
  if(!updated.rowCount)await c.query("INSERT INTO lineups(match_id,team_id,player_id,position,jersey_number,is_starting,confirmed_by,confirmed_at) VALUES($1,$2,$3,$4,$5,$6,$7,CASE WHEN $7::uuid IS NULL THEN NULL ELSE NOW() END)",[matchId,teamId,p.playerId,p.position,p.jerseyNumber,p.isStarting,submitter]);
 }
}
