import { getPool } from '../lib/db';
import { getPublishedDraw } from './fixtureGenerationService';
import { teamDetail } from './refereePortalService';
type Row=Record<string,any>;

export function aggregateOfficialStatistics(matches:Row[],events:Row[],lineups:Row[]){
 const official=matches.filter(m=>m.result_status==='APPROVED'&&['VERIFIED','LOCKED'].includes(m.status)),ids=new Set(official.map(m=>m.id));
 const teams=new Map<string,Row>(),players=new Map<string,Row>();
 const team=(id:string)=>{if(!teams.has(id))teams.set(id,{teamId:id,played:0,won:0,drawn:0,lost:0,goalsFor:0,goalsAgainst:0,administrativeMatches:0});return teams.get(id)!;};
 const player=(id:string,teamId:string)=>{const key=teamId+':'+id;if(!players.has(key))players.set(key,{playerId:id,teamId,goals:0,yellowCards:0,secondYellowCards:0,directRedCards:0,appearances:0,assists:null});return players.get(key)!;};
 let goals=0,administrativeGoals=0;const unresolved:string[]=[],appearanceUnknown:string[]=[];
 for(const m of official){
  const home=(m.home_score??0)+(m.home_extra_time_score??0),away=(m.away_score??0)+(m.away_extra_time_score??0),h=team(m.home_team_id),a=team(m.away_team_id),administrative=m.forfeit||m.result_origin==='ADMINISTRATIVE';
  h.played++;a.played++;h.goalsFor+=home;h.goalsAgainst+=away;a.goalsFor+=away;a.goalsAgainst+=home;
  if(m.winner_team_id===m.home_team_id||!m.winner_team_id&&home>away){h.won++;a.lost++;}else if(m.winner_team_id===m.away_team_id||!m.winner_team_id&&home<away){a.won++;h.lost++;}else{h.drawn++;a.drawn++;}
  const active=events.filter(e=>e.match_id===m.id&&!e.voided_at);
  for(const e of active){
   if(!e.player_id)continue;
   if(e.event_type==='YELLOW_CARD')player(e.player_id,e.team_id).yellowCards++;
   if(e.event_type==='SECOND_YELLOW_CARD'){const p=player(e.player_id,e.team_id);p.yellowCards++;p.secondYellowCards++;}
   if(e.event_type==='RED_CARD')player(e.player_id,e.team_id).directRedCards++;
  }
  if(administrative){administrativeGoals+=home+away;h.administrativeMatches++;a.administrativeMatches++;if(m.actual_started_at)appearanceUnknown.push(m.id);continue;}
  goals+=home+away;
  const scoring=active.filter(e=>['GOAL','PENALTY_GOAL','OWN_GOAL'].includes(e.event_type));
  let scoredHome=0,scoredAway=0;
  for(const e of scoring){if((e.team_id===m.home_team_id)!==(e.event_type==='OWN_GOAL'))scoredHome++;else scoredAway++;}
  const consistent=scoredHome===home&&scoredAway===away;
  if(!consistent)unresolved.push(m.id);
  for(const e of active){
   if(!e.player_id)continue;const p=player(e.player_id,e.team_id);
   if(consistent&&['GOAL','PENALTY_GOAL'].includes(e.event_type))p.goals++;
  }
  const squad=lineups.filter(l=>l.match_id===m.id);
  if(!m.actual_started_at||!squad.length||squad.some(l=>!l.confirmed_at))appearanceUnknown.push(m.id);
  else for(const id of new Set([...squad.filter(l=>l.is_starting).map(l=>l.player_id),...active.filter(e=>e.event_type==='SUBSTITUTION_IN').map(e=>e.player_id)])){
   const l=squad.find(l=>l.player_id===id);if(l)player(id,l.team_id).appearances++;
  }
 }
 return {officialMatchCount:official.length,publishedMatchCount:matches.length,fieldGoals:goals,administrativeScoreGoals:administrativeGoals,
  teams:[...teams.values()],players:[...players.values()],assistsCollected:false,appearanceUnknownMatchIds:appearanceUnknown,
  goalReconciliationMatchIds:unresolved,officialMatchIds:[...ids]};
}

export async function getOfficialTournamentStatistics(tournamentId:string){
 const draw=await getPublishedDraw(tournamentId),q=await getPool().connect();
 let matches:Row[],events:Row[],lineups:Row[];
 try{await q.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 matches=(await q.query(`SELECT m.*,r.status AS result_status,r.home_score,r.away_score,r.home_extra_time_score,r.away_extra_time_score,r.result_origin,
  slot.winner_team_id,
  c.actual_started_at,EXISTS(SELECT 1 FROM match_forfeit_decisions f WHERE f.match_id=m.id) AS forfeit
  FROM matches m JOIN match_fixture_generations g ON g.draw_version_id=m.draw_version_id AND g.stage=m.stage AND g.publication_status='PUBLISHED'
  LEFT JOIN match_results r ON r.match_id=m.id LEFT JOIN match_clock_states c ON c.match_id=m.id LEFT JOIN match_bracket_slots slot ON slot.match_id=m.id
  WHERE m.tournament_id=$1 AND m.draw_version_id=$2`,[tournamentId,draw.id])).rows;
 events=(await q.query("SELECT e.* FROM match_events e JOIN matches m ON m.id=e.match_id WHERE m.tournament_id=$1 AND m.draw_version_id=$2 AND e.voided_at IS NULL AND e.visibility='PUBLIC'",[tournamentId,draw.id])).rows;
 lineups=(await q.query('SELECT l.* FROM lineups l JOIN matches m ON m.id=l.match_id WHERE m.tournament_id=$1 AND m.draw_version_id=$2',[tournamentId,draw.id])).rows;
 await q.query('COMMIT');}catch(error){await q.query('ROLLBACK');throw error;}finally{q.release();}
 const stats=aggregateOfficialStatistics(matches,events,lineups);
 const identities=await Promise.all([...new Set(matches.flatMap(m=>[m.home_team_id,m.away_team_id]).filter(Boolean))].map(id=>teamDetail(id)));
 return {...stats,source:'APPROVED_RESULTS',teams:stats.teams.map(t=>({...t,name:identities.find(d=>d.team.id===t.teamId)?.team.name??null})),players:stats.players.map(p=>({...p,fullName:identities.find(d=>d.team.id===p.teamId)?.players.find(person=>person.id===p.playerId)?.fullName??null}))};
}
