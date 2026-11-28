import { useEffect, useRef, useState } from "react";
import type { RefereeMatchContext } from "../../api/refereePortal";
import { ApiError } from "../../api/client";
import { confirmMatchReport, submitMatchReport, type MatchReportDraft } from "../../api/competition";
import { Modal } from "../Modal";
import { useDialog } from "../DialogProvider";
import { RefereeReportDocument } from "./RefereeReportDocument";
import { canConfirmReport, canPrepareReport, reportDocumentFromCurrent, reportDocumentFromSubmission } from "./reportDocumentModel";
import { MetricCards, RefereeLink, StatusBadge, TeamMark } from "./RefereeShared";
import { refereeError } from "./refereeOperation";
import { refereePaths } from "./refereeRoutes";

export function RefereeAfterMatchPanel({ context, refresh, disabled = false }: { context: RefereeMatchContext; refresh: () => void; disabled?: boolean }) {
  const { confirm, prompt } = useDialog();
  const saved = context.report?.draft ?? context.report;
  const [weather, setWeather] = useState(saved?.weather ?? "");
  const [attendance, setAttendance] = useState(saved?.attendance?.toString() ?? "");
  const [notes, setNotes] = useState(saved?.notes ?? "");
  const [exception, setException] = useState(context.report?.draft?.requiresOrganizerReview ?? context.report?.requiresOrganizerReview ?? false);
  const [version, setVersion] = useState(context.report?.version ?? 0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const operationId = useRef(crypto.randomUUID());
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!dirty) {
      const source = context.report?.draft ?? context.report;
      setWeather(source?.weather ?? ""); setAttendance(source?.attendance?.toString() ?? ""); setNotes(source?.notes ?? "");
      setException(context.report?.draft?.requiresOrganizerReview ?? context.report?.requiresOrganizerReview ?? false);
      setVersion(context.report?.version ?? 0);
    }
  }, [context.report, dirty]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const fields: MatchReportDraft = { attendance: attendance === "" ? undefined : Number(attendance), weather: weather.trim() || undefined, notes: notes.trim() || undefined, requiresOrganizerReview: exception };
  const document = reportDocumentFromCurrent(context, fields);
  const canWork = context.readiness ? context.readiness.crewPublished && !["PAUSED", "COMPLETED", "CANCELLED"].includes(context.readiness.tournamentStatus) : true;
  const prepare = canWork && canPrepareReport(context);
  const finalAuthority = context.assignment.isFinalAuthority && context.assignment.capabilities.includes("FINALIZE");
  const finalConfirm = canWork && canConfirmReport(context);
  const blocked = busy || disabled;
  const changedRemotely = dirty && version !== (context.report?.version ?? 0);
  const snapshot = context.report?.submissionSnapshots.at(-1);
  const submittedDocument = snapshot ? reportDocumentFromSubmission(snapshot, context.report!.submissionSnapshots.length - 1) : null;
  const total = document.result ? { home: document.result.homeScore + (document.result.homeExtraTimeScore ?? 0), away: document.result.awayScore + (document.result.awayExtraTimeScore ?? 0) } : null;
  function change(setter: (value: string) => void, value: string) { setter(value); setDirty(true); operationId.current = crypto.randomUUID(); }
  async function work(action: () => Promise<void>) {
    if (blocked) return;
    setBusy(true); setError(null); setNotice(null);
    try { await action(); } catch (err) {
      if (err instanceof ApiError && [403, 409].includes(err.status)) refresh();
      if (mounted.current) setError(refereeError(err));
    } finally { if (mounted.current) setBusy(false); }
  }
  async function save(action: "SAVE_DRAFT" | "SUBMIT") {
    if (attendance !== "" && (!Number.isInteger(Number(attendance)) || Number(attendance) < 0)) { setError("Số khán giả phải là số nguyên không âm."); return; }
    if (action === "SUBMIT" && !await confirm({ title: finalAuthority && !exception ? "Xác nhận kết quả và biên bản?" : "Gửi biên bản?", description: exception ? "Hồ sơ ngoại lệ được chuyển BTC xử lý; kết quả chưa trở thành chính thức." : finalAuthority ? "Kết quả được công nhận theo thẩm quyền của bạn và đồng bộ sau khi lưu thành công." : "Biên bản được chuyển người có thẩm quyền xác nhận cuối trong tổ trọng tài.", confirmLabel: finalAuthority && !exception ? "Xác nhận kết quả" : "Gửi biên bản" })) return;
    await work(async () => {
      const response = await submitMatchReport({ matchId: context.match.id, ...fields, attendance: fields.attendance ?? undefined, weather: fields.weather ?? undefined, notes: fields.notes ?? undefined, action, expectedVersion: version, operationId: operationId.current });
      setVersion(response.report.version); setDirty(false); operationId.current = crypto.randomUUID();
      setNotice(response.report.status === "APPROVED" ? "Đã xác nhận biên bản và kết quả chính thức." : action === "SAVE_DRAFT" ? "Đã lưu nháp biên bản. Ghi chú và thông tin bổ sung được giữ sau khi tải lại." : exception ? "Đã gửi hồ sơ ngoại lệ đến BTC." : "Đã gửi biên bản đến người xác nhận cuối."); refresh();
    });
  }
  async function confirmSubmitted() {
    if (!context.report || !await confirm({ title: "Xác nhận biên bản đã được chuẩn bị?", description: "Kiểm tra bản nộp và diễn biến trước khi công nhận kết quả chính thức.", confirmLabel: "Xác nhận kết quả" })) return;
    await work(async () => { await confirmMatchReport(context.report!.id, { expectedVersion: context.report!.version, operationId: operationId.current }); setNotice("Đã xác nhận biên bản và kết quả chính thức."); operationId.current = crypto.randomUUID(); refresh(); });
  }
  async function requestChanges(){
    if(!context.report)return;
    const reason=await prompt({title:"Yêu cầu điều chỉnh biên bản",description:"Giữ bản đã nộp và ghi lý do để người chuẩn bị bổ sung; không mở lại trận.",label:"Nội dung cần điều chỉnh",required:true});
    if(!reason||reason.trim().length<5){if(reason)setError("Nhập lý do ít nhất 5 ký tự.");return;}
    await work(async()=>{await confirmMatchReport(context.report!.id,{expectedVersion:context.report!.version,operationId:operationId.current,decision:"REQUEST_CHANGES",reason:reason.trim()});operationId.current=crypto.randomUUID();setNotice("Đã yêu cầu người chuẩn bị điều chỉnh biên bản.");refresh();});
  }
  return <div className="rf-stack">
    <article className="rf-card"><header className="rf-card-header"><h2>Kết quả và biên bản</h2>{context.report ? <StatusBadge status={context.report.status} report /> : <span className="rf-badge">Chưa nộp biên bản</span>}</header><div className="rf-report-result"><div><TeamMark team={context.home} /><strong>{context.home.name}</strong></div><strong className="rf-report-score">{total ? `${total.home} – ${total.away}` : "—"}</strong><div><TeamMark team={context.away} /><strong>{context.away.name}</strong></div></div><div className="rf-card-padding"><p>{context.result?.status === "APPROVED" ? "Kết quả đã được công nhận. Muốn thay đổi phải gửi yêu cầu đính chính đúng thẩm quyền." : "Trận đã kết thúc thi đấu; kết quả chưa chính thức cho đến khi được xác nhận đúng thẩm quyền."}</p>{document.result?.homeExtraTimeScore != null ? <p>Hai hiệp chính: {document.result.homeScore} – {document.result.awayScore} · Bàn hiệp phụ: {document.result.homeExtraTimeScore} – {document.result.awayExtraTimeScore}</p> : null}{document.result?.homePenaltyScore != null ? <p>Luân lưu: {document.result.homePenaltyScore} – {document.result.awayPenaltyScore} · không cộng vào bàn thắng trận.</p> : null}<RefereeLink className="rf-text-link" href={refereePaths.report(context.match.id)}>Xem biên bản và lịch sử phiên bản →</RefereeLink></div></article>
    <MetricCards items={[{ label: "Bàn thắng trong trận", value: total ? total.home + total.away : 0, icon: "whistle" }, { label: "Thẻ phạt", value: context.events.filter((event) => ["YELLOW_CARD", "SECOND_YELLOW_CARD", "RED_CARD"].includes(event.eventType)).length, icon: "clock" }, { label: "Lần thay người", value: context.events.filter((event) => event.eventType === "SUBSTITUTION_OUT").length, icon: "check" }, { label: "Sự cố đã ghi", value: context.events.filter((event) => ["INCIDENT", "INJURY"].includes(event.eventType)).length, icon: "calendar" }]} />
    {error ? <div className="rf-error" role="alert">{error}</div> : null}{notice ? <p className="rf-success" role="status">{notice}</p> : null}
    {context.report?.reviewNote ? <p className="rf-clock-notice">Ý kiến xử lý: {context.report.reviewNote}</p> : null}
    {changedRemotely ? <p className="rf-inline-error" role="alert">Biên bản đã thay đổi trên thiết bị khác. Nội dung đang nhập được giữ lại; tải bản mới trước khi tiếp tục.</p> : null}
    {prepare ? <form className="rf-card" onSubmit={(event) => { event.preventDefault(); void save("SUBMIT"); }}><header className="rf-card-header"><h2>Hoàn thiện biên bản</h2><span className="rf-count">{dirty ? "Có thay đổi chưa lưu" : context.report?.status === "DRAFT" ? "Bản nháp đã lưu" : "Tổng hợp từ dữ liệu trận"}</span></header><div className="rf-report-form"><p className="rf-full-width">Tỷ số, bàn thắng, thẻ, thay người và đội hình được tổng hợp tự động. Nếu nguồn có sai sót, thực hiện đính chính có lý do; không nhập lại tỷ số tại đây.</p><label className="rf-field">Khán giả (nếu có)<input type="number" min="0" step="1" value={attendance} onChange={(event) => change(setAttendance, event.target.value)} disabled={blocked} /></label><label className="rf-field">Thời tiết<input value={weather} maxLength={100} onChange={(event) => change(setWeather, event.target.value)} disabled={blocked} /></label><label className="rf-field rf-full-width">Ghi chú bổ sung<textarea value={notes} maxLength={2000} onChange={(event) => change(setNotes, event.target.value)} rows={4} disabled={blocked} /></label><label className="rf-checkbox rf-full-width"><input type="checkbox" checked={exception} onChange={(event) => { setException(event.target.checked); setDirty(true); operationId.current = crypto.randomUUID(); }} disabled={blocked} />Hồ sơ có ngoại lệ cần BTC xử lý</label></div><div className="rf-card-actions"><button className="rf-button" type="button" disabled={blocked} onClick={() => setPreview(true)}>Xem trước biên bản</button>{changedRemotely ? <button className="rf-button" type="button" disabled={blocked} onClick={() => { setDirty(false); refresh(); }}>Tải bản biên bản mới</button> : <><button className="rf-button" type="button" disabled={blocked} onClick={() => void save("SAVE_DRAFT")}>Lưu nháp biên bản</button><button className="rf-button primary" type="submit" disabled={blocked}>{busy ? "Đang lưu…" : finalAuthority && !exception ? "Xác nhận kết quả & biên bản" : exception ? "Gửi BTC xử lý ngoại lệ" : "Gửi người xác nhận cuối"}</button></>}</div></form> : context.report?.status === "PENDING" ? <article className="rf-card rf-card-padding"><h2>{context.report.requiresOrganizerReview ? "Hồ sơ ngoại lệ đang chờ BTC" : "Biên bản đang chờ người xác nhận cuối"}</h2><p>{context.report.requiresOrganizerReview ? "Kết quả được giữ ở trạng thái chờ xử lý theo quy trình ngoại lệ." : finalConfirm ? "Người chuẩn bị đã nộp biên bản. Kiểm tra bản nộp trước khi xác nhận." : "Chỉ người có quyền xác nhận cuối và được chỉ định cho trận này mới công nhận kết quả."}</p><div className="rf-card-actions"><button className="rf-button" type="button" onClick={() => setPreview(true)} disabled={!submittedDocument}>Xem bản biên bản đã nộp</button>{finalConfirm ? <button className="rf-button" type="button" disabled={blocked} onClick={()=>void requestChanges()}>Yêu cầu điều chỉnh</button> : null}{finalConfirm ? <button className="rf-button primary" type="button" disabled={blocked} onClick={() => void confirmSubmitted()}>Xác nhận kết quả & biên bản</button> : null}</div></article> : !context.report || context.report.status === "DRAFT" ? <article className="rf-card rf-card-padding"><p className="rf-muted">Bạn không được giao quyền chuẩn bị biên bản. Người có quyền quản lý biên bản cần hoàn thiện và gửi trước khi xác nhận.</p></article> : null}
    <Modal open={preview} title={prepare ? "Xem trước biên bản" : "Biên bản đã nộp"} onClose={() => setPreview(false)}><div className="rf-report-print-controls"><button type="button" className="rf-button" onClick={() => window.print()}>In / Lưu PDF</button></div>{prepare ? <RefereeReportDocument document={document} /> : submittedDocument ? <RefereeReportDocument document={submittedDocument} /> : <p>Chưa có bản nộp để xem.</p>}</Modal>
  </div>;
}
