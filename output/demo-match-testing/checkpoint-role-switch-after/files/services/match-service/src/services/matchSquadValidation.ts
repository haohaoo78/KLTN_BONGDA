import type { EffectiveMatchRules,SquadEntry,SquadRoster,SquadIssue } from "@sfl/shared";
export function validateSquad(entries:SquadEntry[],roster:SquadRoster,rules:EffectiveMatchRules,complete=true):SquadIssue[]{
 const issues:SquadIssue[]=[],ids=new Set<string>(),shirts=new Set<number>(),v=rules.rules.values;
 const add=(code:string,message:string,playerId?:string,field?:string)=>issues.push({code,message,playerId,field});
 if(complete&&rules.missing.LINEUP.length)add("MATCH_RULES_UNDEFINED",`Chưa đủ quy tắc đội hình: ${rules.missing.LINEUP.join("; ")}.`);
 for(const p of entries){
  if(ids.has(p.playerId))add("SQUAD_DUPLICATE_PLAYER","Cầu thủ xuất hiện nhiều lần.",p.playerId);ids.add(p.playerId);
  const player=roster.players.find(r=>r.id===p.playerId);
  if(!player?.eligible)add("SQUAD_PLAYER_INELIGIBLE",player?.reasons.join(" ")||"Cầu thủ không thuộc roster chính thức của đội trong giải.",p.playerId);
  if(p.jerseyNumber!==null&&(!Number.isInteger(p.jerseyNumber)||p.jerseyNumber<1||v.shirtNumbers==="UNIQUE_1_99"&&p.jerseyNumber>99))add("SQUAD_SHIRT_INVALID","Số áo không đúng quy định áp dụng.",p.playerId,"jerseyNumber");
  if(p.jerseyNumber===null&&complete)add("SQUAD_SHIRT_REQUIRED","Cần nhập số áo.",p.playerId,"jerseyNumber");
  if(p.jerseyNumber!==null){if(shirts.has(p.jerseyNumber))add("SQUAD_DUPLICATE_SHIRT","Số áo bị trùng trong đội hình trận.",p.playerId,"jerseyNumber");shirts.add(p.jerseyNumber);}
 }
 const starters=entries.filter(p=>p.isStarting),bench=entries.length-starters.length,gk=starters.filter(p=>["GK","GOALKEEPER"].includes(p.position??"")).length;
 if(typeof v.startingPlayers==="number"&&starters.length>v.startingPlayers)add("SQUAD_STARTER_LIMIT",`Chỉ được tối đa ${v.startingPlayers} cầu thủ xuất phát.`);
 if(complete&&typeof v.minimumPlayers==="number"&&starters.length<v.minimumPlayers)add("SQUAD_TOO_FEW_PLAYERS",`Cần ít nhất ${v.minimumPlayers} cầu thủ xuất phát.`);
 if(typeof v.maxSubstitutes==="number"&&bench>v.maxSubstitutes)add("SQUAD_BENCH_LIMIT",`Chỉ được tối đa ${v.maxSubstitutes} cầu thủ dự bị.`);
 if(typeof v.goalkeepers==="number"&&(gk>v.goalkeepers||complete&&gk!==v.goalkeepers))add("SQUAD_GOALKEEPER_REQUIRED",`Cần đúng ${v.goalkeepers} thủ môn trong đội hình xuất phát.`);
 return issues;
}
