import {useEffect,useState} from "react";
import {changeDemoTime,getDemoTime,type DemoTimeAction,type DemoTimeWorkspace} from "../../api/matchDemoTime";
import type {RefereeMatchContext} from "../../api/refereePortal";

export function MatchDemoTimePanel({context,refresh,disabled=false}:{context:RefereeMatchContext;refresh:()=>void;disabled?:boolean}) {
 const [data,setData]=useState<DemoTimeWorkspace|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
 useEffect(()=>{let active=true;setError("");void getDemoTime(context.match.id).then(d=>{if(active)setData(d);}).catch(e=>{if(active)setError(e instanceof Error?e.message:"Không đọc được thời gian kiểm thử.");});return()=>{active=false;};},[context.match.id,context.clock.version]);
 if(!data?.available)return error?<p className="rf-inline-error" role="alert">{error}</p>:null;
 const canControl=context.assignment.isFinalAuthority&&context.assignment.capabilities.includes("FINALIZE")&&(!context.readiness||context.readiness.crewPublished);
 async function change(action:DemoTimeAction){if(!data||busy)return;setBusy(true);setError("");try{setData(await changeDemoTime(context.match.id,action,data.revision??0,context.clock.version));refresh();}catch(e){setError(e instanceof Error?e.message:"Không đổi được thời gian kiểm thử.");refresh();}finally{setBusy(false);}}
 const phase=context.clock.phase,playing=context.match.status==="IN_PROGRESS"&&context.clock.isRunning;
 const actions:DemoTimeAction[]=phase==="NOT_STARTED"?["LINEUP","PREMATCH","KICKOFF"]:playing?["ADVANCE_MINUTE","PERIOD_END"]:phase==="HALF_TIME"?["HALF_TIME_END"]:[];
 return <details className="rf-card rf-card-padding rf-demo-time"><summary><strong>Demo Mode</strong> · {data.enabled?"Đang bật cho trận này":"Đang tắt"}{data.used?" · Có lịch sử kiểm thử":""}</summary>
  <p>Chỉ Development/Test trên giải DEMO được cho phép. Thời gian do backend quản lý; lịch chính thức giữ nguyên. Các thao tác lưu vẫn ghi dữ liệu thật của giải DEMO.</p>
  <p>Thời gian kiểm thử: <strong>{new Date(context.clock.serverNow??data.effectiveNow!).toLocaleString("vi-VN")}</strong>. Mốc lập đội hình được lấy trước hạn điều lệ; khi chưa quy định hạn, dùng một phút trước giờ đấu làm mốc kiểm thử.</p>
  {data.enabled?<p role="status">⚠ Trận đang dùng thời gian kiểm thử. Chuyển mốc không tự gửi đội hình, bắt đầu trận hoặc kết thúc hiệp. Không quay lùi thời gian; chỉ tắt trước khi bắt đầu hoặc sau khi kết thúc trận.</p>:null}
  {canControl?<div className="rf-card-actions"><button className="rf-button" type="button" disabled={busy||disabled||Boolean(data.enabled&&phase!=="NOT_STARTED"&&phase!=="ENDED")} onClick={()=>void change(data.enabled?"DISABLE":"ENABLE")}>{busy?"Đang cập nhật…":data.enabled?"Tắt Demo Mode":"Bật Demo Mode"}</button>{data.enabled?actions.map(action=><button className="rf-button" key={action} type="button" disabled={busy||disabled} onClick={()=>void change(action)}>{data.actions?.[action]}</button>):null}</div>:<p>Chỉ trọng tài được giao quyền xác nhận cuối của trận được đổi thời gian.</p>}
  {error?<p className="rf-inline-error" role="alert">{error}</p>:null}
 </details>;
}
