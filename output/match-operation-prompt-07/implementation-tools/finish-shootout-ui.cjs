const fs=require('fs');function edit(p,a,b){let s=fs.readFileSync(p,'utf8');if(!s.includes(a))throw Error('Missing '+p);fs.writeFileSync(p,s.replace(a,b));}
const panel='apps/web-client/src/components/referee/RefereeShootoutPanel.tsx';
edit(panel,'{label(p.playerId)}</label>)}</div>','{label(p.playerId)}{final?<span><input type="checkbox" aria-label={`Không thể tiếp tục: ${label(p.playerId)}`} checked={unavailable.includes(p.playerId)} disabled={busy} onChange={e=>{setUnavailable(ids=>e.target.checked?[...ids,p.playerId]:ids.filter(id=>id!==p.playerId));if(e.target.checked)setSelected(ids=>ids.filter(id=>id!==p.playerId));changed();}}/> Không thể tiếp tục</span>:null}</label>)}</div>');
edit(panel,'{current?<label className="rf-field">Lý do thay đổi','{current||unavailable.length?<label className="rf-field">Lý do thay đổi');
edit(panel,'firstTeamId:first,eligiblePlayerIds:selected,keepers,reason','firstTeamId:first,eligiblePlayerIds:selected,unavailablePlayerIds:unavailable,keepers,reason');
edit(panel,"setEdit(null);setReason('');refresh();","setEdit(null);setReason('');setUnavailable([]);refresh();");
// Label actual playing totals consistently on existing referee pages.
edit('apps/web-client/src/components/referee/RefereeMatchDetailPage.tsx','`${context.result.homeScore} : ${context.result.awayScore}`','`${context.result.homeScore+(context.result.homeExtraTimeScore??0)} : ${context.result.awayScore+(context.result.awayExtraTimeScore??0)}`');
edit('apps/web-client/src/components/referee/RefereeReportsPage.tsx','`${item.result.homeScore} – ${item.result.awayScore}`','`${item.result.homeScore+(item.result.homeExtraTimeScore??0)} – ${item.result.awayScore+(item.result.awayExtraTimeScore??0)}`');
// Validate the proposed method again when an organizer approves an audited correction.
edit('services/match-service/src/repositories/matchRepository.ts',"import {assertRecordedOutcome}","import {getEffectiveMatchRules,assertResultRulePolicy} from '../services/matchOperationRulesService';\nimport {assertRecordedOutcome}");
edit('services/match-service/src/repositories/matchRepository.ts','const proposal = request.proposed_result;','const proposal = request.proposed_result;\n      assertResultRulePolicy(await getEffectiveMatchRules(request.match_id,client),proposal,true);');
