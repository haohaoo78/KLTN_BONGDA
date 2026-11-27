const fs=require('node:fs'),p='services/match-service/src/repositories/lineupRepository.ts';let s=fs.readFileSync(p,'utf8');
s=s.replaceAll('SELECT id, match_id, team_id, player_id, event_type, minute, description, created_by, created_at, voided_at, voided_by, void_reason','SELECT id, match_id, team_id, player_id, event_type, minute, description, created_by, created_at, voided_at, voided_by, void_reason,phase,period_elapsed_seconds,added_time_seconds,event_sequence');
s=s.replace('query += ` ORDER BY minute ASC, created_at ASC`;','query += ` ORDER BY event_sequence ASC`;');
s=s.replace('SELECT team_id, player_id, event_type, minute, description, created_by, created_at\r\n','SELECT team_id, player_id, event_type, minute, description, created_by, created_at,phase,period_elapsed_seconds,added_time_seconds,event_sequence\r\n').replace('SELECT team_id, player_id, event_type, minute, description, created_by, created_at\n','SELECT team_id, player_id, event_type, minute, description, created_by, created_at,phase,period_elapsed_seconds,added_time_seconds,event_sequence\n');
s=s.replace('minute: row.minute, description: row.description, createdBy: row.created_by,','phase:row.phase??null,periodElapsedSeconds:row.period_elapsed_seconds??null,addedTimeSeconds:row.added_time_seconds??null,eventSequence:row.event_sequence??null,\n        minute: row.minute, description: row.description, createdBy: row.created_by,');
const marker='    const submittedAt = new Date().toISOString();';if(!s.includes(marker))throw Error('Report derivation marker');
s=s.replace(marker,`    // A legacy minute cannot determine a half. Preserve unknown halftime data as null.
    const goals=events.rows.filter(e=>['GOAL','PENALTY_GOAL','OWN_GOAL'].includes(e.event_type));
    let halfHome=0,halfAway=0;
    const knownTiming=goals.every(e=>e.phase!=null);
    for(const e of goals.filter(e=>e.phase==='FIRST_HALF')){const home=e.team_id===match.home_team_id;if(home!==(e.event_type==='OWN_GOAL'))halfHome++;else halfAway++;}
    input={...input,homeScoreAtHalfTime:knownTiming?halfHome:undefined,awayScoreAtHalfTime:knownTiming?halfAway:undefined};
${marker}`);
fs.writeFileSync(p,s);
const q='services/match-service/src/models/match.ts';s=fs.readFileSync(q,'utf8').replace('"minute" | "description" | "createdBy" | "createdAt">','"minute" | "description" | "createdBy" | "createdAt" | "phase" | "periodElapsedSeconds" | "addedTimeSeconds" | "eventSequence">');fs.writeFileSync(q,s);
const r='apps/web-client/src/components/MatchOperationsPanel.tsx';s=fs.readFileSync(r,'utf8').replace('Number(eventMinute) > 120','Number(eventMinute) > 2147483647');fs.writeFileSync(r,s);
