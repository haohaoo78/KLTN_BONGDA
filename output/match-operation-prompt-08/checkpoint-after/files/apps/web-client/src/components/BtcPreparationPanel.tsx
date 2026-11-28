import { useCallback,useEffect,useState } from "react";
import type { MatchPreparation } from "@sfl/shared";
import { getPreparation,organizerPreparation } from "../api/matchSquad";
import { useDialog } from "./DialogProvider";
import type { Match } from "../api/competition";
export function BtcPreparationQueue({matches,teamNames}:{matches:Array<{match:Match;tournamentName:string}>;teamNames:Map<string,string>}){
 const [id,setId]=useState("");return <section className="result-correction-queue"><h3>Kiểm tra trước trận</h3><label className="field">Trận cần xử lý<select value={id} onChange={e=>setId(e.target.value)}><option value="">Chọn trận để xem đội hình và vấn đề cần xử lý</option>{matches.map(({match,tournamentName})=><option key={match.id} value={match.id}>{tournamentName} · {teamNames.get(match.homeTeamId??"")??"Đội chủ nhà"} — {teamNames.get(match.awayTeamId??"")??"Đội khách"} · {match.round||"Vòng đấu"}</option>)}</select></label>{id?<BtcPreparationPanel key={id} matchId={id}/>:null}</section>;
}
export function BtcPreparationPanel({matchId}:{matchId:string}){
 const [data,setData]=useState<MatchPreparation|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);const {prompt}=useDialog();
 const load=useCallback(async()=>{try{setData((await getPreparation(matchId)).preparation);setError("");}catch(e){setError(e instanceof Error?e.message:"Không đọc được chuẩn bị trận.");}},[matchId]);
 useEffect(()=>{setData(null);void load();const t=window.setInterval(()=>void load(),30000);return()=>window.clearInterval(t);},[load]);
 async function act(action:"REOPEN"|"RESOLVE_ISSUE",issueId?:string){const reason=await prompt({title:action==="REOPEN"?"Mở lại chuẩn bị trận":"Ghi nhận kết luận của BTC",description:"Lưu người xử lý, lý do và lịch sử. Không tự xác nhận sẵn sàng hoặc xử thua.",label:"Lý do / kết luận",required:true});if(!reason)return;setBusy(true);try{await organizerPreparation(matchId,{action,reason,issueId});await load();}catch(e){setError(e instanceof Error?e.message:"Không xử lý được ngoại lệ.");}finally{setBusy(false);}}
 return <section className="result-correction-queue"><h3>Chuẩn bị trận & vấn đề cần BTC xử lý</h3>{error?<p role="alert" className="inline-error">{error}</p>:null}{data?.inconsistent?<div><p className="inline-error">Trạng thái sẵn sàng không còn khớp hồ sơ đội hình. Cần kiểm tra trước khi quyết định mở lại.</p><button className="button-secondary" type="button" disabled={busy} onClick={()=>void act("REOPEN")}>Mở lại chuẩn bị có lý do</button></div>:null}{data?.issues.filter(i=>!i.resolvedAt).map(i=><div key={i.id}><p>{i.description}</p><button className="button-secondary" type="button" disabled={busy} onClick={()=>void act("RESOLVE_ISSUE",i.id)}>Ghi nhận kết luận xử lý</button></div>)}{data&&!data.inconsistent&&!data.issues.some(i=>!i.resolvedAt)?<p>Không có vấn đề trước trận đang chờ xử lý.</p>:null}</section>;
}
