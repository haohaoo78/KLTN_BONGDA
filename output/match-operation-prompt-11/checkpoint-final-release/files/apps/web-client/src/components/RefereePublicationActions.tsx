import { useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client";
import { getRefereeAssignmentDetail, getRefereePublicationHistory, replacePublishedReferee, resendRefereeAssignmentEmail,
  type RefereeAssignmentDetail, type RefereeAssignmentMatch, type RefereePublicationVersion } from "../api/refereeAssignment";
import { Modal } from "./Modal";
import { RefereePicker } from "./RefereePicker";

export const refereeEmailStatus = (status: "PENDING" | "SENT" | "FAILED") => ({ PENDING: "◷ Chờ kết quả SMTP", SENT: "✓ SMTP đã tiếp nhận", FAILED: "⚠ Gửi thất bại" })[status];
export function refereePublicationError(error: unknown) {
  const conflicts = error instanceof ApiError && Array.isArray(error.details?.conflicts) ? error.details.conflicts as Array<{ matchId: string; position: string; issues: Array<{ message: string }> }> : [];
  const issues = error instanceof ApiError && Array.isArray(error.details?.issues) ? error.details.issues.filter((issue): issue is string => typeof issue === "string") : [];
  return [error instanceof Error ? error.message : "Không thể hoàn tất thao tác.", ...issues, ...conflicts.flatMap((row) => row.issues.map((issue) => `${row.matchId.slice(0, 8).toUpperCase()} · ${row.position}: ${issue.message}`))].join(" ");
}

export function RefereePublicationActions({ tournamentId, match, people, disabled, onChanged, onBusyChange }: {
  tournamentId: string; match: RefereeAssignmentMatch; people: Array<{ userId: string; fullName: string }>; disabled: boolean;
  onChanged: () => void; onBusyChange: (busy: boolean) => void;
}) {
  const [modal, setModal] = useState<"HISTORY" | "REPLACE" | "EMAIL" | null>(null), [history, setHistory] = useState<RefereePublicationVersion[]>([]);
  const [detail, setDetail] = useState<RefereeAssignmentDetail | null>(null), [position, setPosition] = useState(""), [person, setPerson] = useState(""), [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const generation = useRef(0), active = useRef(true), retry = useRef<{ payload: string; id: string } | null>(null);
  const busyCallback = useRef(onBusyChange); busyCallback.current = onBusyChange;
  useEffect(() => { active.current = true; return () => { active.current = false; generation.current++; busyCallback.current(false); }; }, []);
  const currentPosition = detail?.positions.find((p) => p.code === position), currentSlot = detail?.slots.find((slot) => slot.position === position);
  const names = new Map(people.map((person) => [person.userId, person.fullName]));
  async function open(kind: "HISTORY" | "REPLACE" | "EMAIL") {
    const seq = ++generation.current; setModal(kind); setError(""); setNotice(""); setPerson(""); setReason(""); setDetail(null); setHistory([]); setLoading(true); retry.current = null;
    try {
      if (kind === "HISTORY") {
        const result = await getRefereePublicationHistory(tournamentId, match.matchId);
        if (active.current && seq === generation.current) setHistory(result.versions);
      } else if (kind === "REPLACE") {
        const result = await getRefereeAssignmentDetail(tournamentId, match.matchId);
        if (active.current && seq === generation.current) { setDetail(result); setPosition(result.slots[0]?.position ?? ""); }
      }
    } catch (failure) { if (active.current && seq === generation.current) setError(refereePublicationError(failure)); }
    finally { if (active.current && seq === generation.current) setLoading(false); }
  }
  function close() { if (saving) return; generation.current++; setModal(null); }
  async function replace() {
    if (!detail?.canReplace || !detail.publication || !currentSlot || !person || !reason.trim()) return;
    const body = { expectedPublicationRevision: detail.publication.revision, scheduleSignature: detail.scheduleSignature, position, oldRefereeId: currentSlot.refereeId, newRefereeId: person, reason: reason.trim() };
    const payload = JSON.stringify(body); if (retry.current?.payload !== payload) retry.current = { payload, id: crypto.randomUUID() };
    setSaving(true); busyCallback.current(true); setError("");
    try {
      await replacePublishedReferee(tournamentId, match.matchId, { ...body, requestId: retry.current.id });
      if (!active.current) return;
      setNotice("Đã lưu phiên bản thay thế và cập nhật quyền điều hành. Thông báo/email được xử lý theo trạng thái thực tế."); setModal(null); onChanged();
    } catch (failure) { if (active.current) setError(refereePublicationError(failure)); }
    finally { if (active.current) { setSaving(false); busyCallback.current(false); } }
  }
  async function resend() {
    if (!match.publication) return;
    const payload = `EMAIL:${match.publication.revision}`;
    if (retry.current?.payload !== payload) retry.current = { payload, id: crypto.randomUUID() };
    setSaving(true); busyCallback.current(true); setError("");
    try {
      await resendRefereeAssignmentEmail(tournamentId, match.matchId, retry.current.id, match.publication.revision);
      if (!active.current) return;
      retry.current = null;
      setNotice("Đã tiếp nhận yêu cầu. Thư đã gửi không bị gửi lại; thư chưa rõ kết quả dùng lại mã gửi cũ để tránh trùng. Tải lại trạng thái sau vài giây."); onChanged();
    } catch (failure) { if (active.current) setError(refereePublicationError(failure)); }
    finally { if (active.current) { setSaving(false); busyCallback.current(false); } }
  }
  return <div className="referee-publication-actions" onClick={(event) => event.stopPropagation()}>
    <details><summary aria-label={`Thao tác trận ${match.matchId}`}>⋯</summary><div className="referee-publication-menu"><button type="button" onClick={() => { void open("HISTORY"); }}>Lịch sử</button><button type="button" disabled={disabled || !match.publication} onClick={() => { void open("REPLACE"); }}>Thay thế trọng tài</button><button type="button" disabled={disabled || !match.publication} onClick={() => { void open("EMAIL"); }}>Thông báo & gửi lại email</button></div></details>
    {notice && !modal ? <small role="status">{notice}</small> : null}
    <Modal open={Boolean(modal)} onClose={close} title={modal === "HISTORY" ? "Lịch sử phân công" : modal === "REPLACE" ? "Thay thế trọng tài" : "Thông báo & email"} description={`Trận ${match.matchId.slice(0, 8).toUpperCase()}`} className="referee-publication-modal" eyebrow="CÔNG BỐ & THEO DÕI">
      {loading ? <p>Đang tải dữ liệu chính thức…</p> : null}{error ? <p className="form-error" role="alert">{error}</p> : null}{notice ? <p className="form-success" role="status">{notice}</p> : null}
      {modal === "HISTORY" && !loading ? <div className="referee-publication-history">{history.length ? history.map((version) => <article key={version.revision}><header><b>Phiên bản {version.revision}{version.voidedAt ? " (Đã thu hồi)" : ""} · {version.action === "PUBLISH" ? "Công bố" : "Thay thế"}</b><time>{new Date(version.publishedAt).toLocaleString("vi-VN")}</time></header><small>BTC thực hiện: {version.publishedBy}</small>{version.voidReason ? <p className="form-error">{version.voidReason}</p> : null}{version.reason ? <p>Lý do: {version.reason}</p> : null}<ul>{version.slots.map((slot) => <li key={slot.position}>{version.positions.find((p) => p.code === slot.position)?.label ?? slot.position}: <strong>{names.get(slot.refereeId) ?? slot.refereeId}</strong></li>)}</ul></article>) : <p>Chưa có phiên bản công bố trong luồng này.</p>}</div> : null}
      {modal === "REPLACE" && detail && !loading ? <><p>{detail.crew.map((slot) => `${slot.label}: ${slot.fullName}`).join(" · ")}</p>{!detail.canReplace ? <p className="form-error">Trận đã bị khóa nghiệp vụ; không thể thay thế.</p> : <><label>Vị trí cần thay<select value={position} disabled={saving} onChange={(event) => { setPosition(event.target.value); setPerson(""); }} >{detail.slots.map((slot) => <option key={slot.position} value={slot.position}>{detail.positions.find((p) => p.code === slot.position)?.label ?? slot.position}</option>)}</select></label>{currentPosition ? <RefereePicker position={{ ...currentPosition, label: `Người thay thế · ${currentPosition.label}` }} candidates={(detail.suggestions.find((item) => item.position === position)?.candidates ?? []).filter((candidate) => candidate.userId !== currentSlot?.refereeId)} chosenIds={detail.slots.filter((slot) => slot.position !== position).map((slot) => slot.refereeId)} value={person} disabled={saving} onChange={setPerson} /> : null}<label>Lý do thay thế<textarea value={reason} maxLength={1000} disabled={saving} rows={3} onChange={(event) => setReason(event.target.value)} /></label><footer><button type="button" className="button button-secondary" disabled={saving} onClick={close}>Hủy</button><button type="button" className="button button-primary" disabled={saving || !person || !reason.trim()} onClick={() => { void replace(); }}>{saving ? "Đang lưu…" : "Lưu thay thế"}</button></footer></>}</> : null}
      {modal === "EMAIL" ? <><div className="referee-publication-email-list">{match.deliveries.map((delivery) => <article key={delivery.id}><b>{delivery.fullName} · {delivery.kind === "REPLACED_OUT" ? "Được thay thế" : "Nhận phân công"}</b><span>{refereeEmailStatus(delivery.emailStatus)}{delivery.sentAt ? ` · ${new Date(delivery.sentAt).toLocaleString("vi-VN")}` : ""}</span>{delivery.errorCode ? <small>Mã lỗi: {delivery.errorCode}</small> : null}<small>Thông báo trong hệ thống: {delivery.notificationStatus === "SENT" ? "Đã lưu" : delivery.notificationStatus === "FAILED" ? "Thất bại" : "Chờ xử lý"}</small></article>)}</div><p className="referee-picker-hint">SMTP tiếp nhận không đồng nghĩa thư đã vào hộp thư. Thư lỗi không hủy phân công. Không có yêu cầu xác nhận nhận việc.</p><footer><button type="button" className="button button-secondary" onClick={onChanged} disabled={saving}>Tải lại trạng thái</button><button type="button" className="button button-secondary" disabled={saving || disabled || !match.deliveries.some((item) => item.emailStatus !== "SENT" || item.notificationStatus !== "SENT")} onClick={() => { void resend(); }}>{saving ? "Đang xử lý…" : "Gửi lại / kiểm tra email"}</button></footer></> : null}
    </Modal>
  </div>;
}
