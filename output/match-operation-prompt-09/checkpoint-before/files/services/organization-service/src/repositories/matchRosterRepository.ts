import { createHash } from "node:crypto";
import { getPool } from "../lib/db";
import { AppError } from "../lib/errors";

/** Official submitted roster, including approved amendments. Never the club directory. */
export async function readMatchRoster(tournamentId: string, teamId: string) {
 const client=await getPool().connect();
 try {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const r=await client.query(`SELECT tr.id,tr.status,tr.version,tr.submitted_roster,t.name,t.logo_url,t.captain_id FROM teams t
    LEFT JOIN team_registrations tr ON tr.team_id=t.id AND tr.tournament_id=$1 WHERE t.id=$2`,[tournamentId,teamId]);
  if(!r.rowCount)throw new AppError(404,"Không tìm thấy đội bóng.","TEAM_NOT_FOUND");
  const row=r.rows[0];
  const data=await client.query(`SELECT r.player_id,r.review_status,p.full_name,p.position,p.jersey_number,p.left_at,
    invitation.status AS invitation_status,to_jsonb(p)->>'avatar_url' AS avatar_url
    FROM rosters r LEFT JOIN players p ON p.id=r.player_id AND p.team_id=r.team_id
    LEFT JOIN LATERAL (SELECT status FROM tournament_player_invitations i WHERE i.team_id=r.team_id
      AND i.tournament_id=r.tournament_id AND i.player_id=r.player_id ORDER BY updated_at DESC LIMIT 1) invitation ON TRUE
    WHERE r.tournament_id=$1 AND r.team_id=$2 ORDER BY r.player_id`,[tournamentId,teamId]);
  const snapshots=new Map<string,any>((row.submitted_roster??[]).map((p:any)=>[p.playerId,p]));
  const records=new Map<string,any>(data.rows.map(p=>[p.player_id,p]));
  const ids=[...new Set([...snapshots.keys(),...records.keys()])].sort();
  const players=ids.map(id=>{
   const p=records.get(id),s=snapshots.get(id),reasons:string[]=[];
   if(row.status!=="APPROVED")reasons.push("Hồ sơ đội chưa được duyệt hoặc không còn hiệu lực.");
   if(!s||!p)reasons.push("Không thuộc roster chính thức hiện hành của giải.");
   if(p?.invitation_status!=="ACCEPTED")reasons.push("Chưa xác nhận tham gia hoặc đã rút khỏi giải.");
   if(p?.left_at||!p?.full_name)reasons.push("Hồ sơ cầu thủ không còn hoạt động trong đội.");
   if(p?.review_status==="REJECTED")reasons.push("Hồ sơ cầu thủ không đủ điều kiện.");
   return {id,fullName:s?.playerName??p?.full_name??"Chưa cập nhật tên",avatarUrl:p?.avatar_url??null,
    position:s?.position??p?.position??null,jerseyNumber:s?.jerseyNumber??p?.jersey_number??null,eligible:!reasons.length,reasons};
  });
  const revision=createHash("sha256").update(JSON.stringify([row.id,row.status,row.version,players])).digest("hex");
  await client.query("COMMIT");
  return {teamId,tournamentId,teamName:row.name,logoUrl:row.logo_url,captainId:row.captain_id,registrationStatus:row.status??null,revision,players};
 }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
}
