import { useState } from "react";
import type { RefereePosition } from "../api/refereeConfiguration";
import type { RefereeCandidateSuggestion } from "../api/refereeAssignment";

export function RefereePicker({ position, candidates, value, chosenIds, disabled, onChange }: {
  position: RefereePosition; candidates: RefereeCandidateSuggestion[]; value: string; chosenIds: string[]; disabled: boolean; onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false), [search, setSearch] = useState("");
  const selected = candidates.find((candidate) => candidate.userId === value);
  const filtered = candidates.filter((candidate) => `${candidate.fullName} ${candidate.email} ${candidate.organization}`.toLocaleLowerCase("vi").includes(search.trim().toLocaleLowerCase("vi")));
  return <section className="referee-picker"><header><strong>{position.label}</strong><span>{position.required ? "Bắt buộc" : "Tùy chọn"}{position.capabilities.includes("FINALIZE") ? " · Xác nhận cuối cùng" : ""}</span></header>
    <button type="button" className={`referee-picker-trigger ${value && !selected?.eligible ? "has-conflict" : ""}`} disabled={disabled} aria-expanded={open} aria-label={`Chọn ${position.label}`} onClick={() => setOpen(!open)}><span>{selected?.fullName ?? (value ? "Trọng tài cần kiểm tra lại" : "Chọn trọng tài…")}</span><span aria-hidden="true">⌄</span></button>
    {value ? <div className="referee-picker-selection"><span>{selected?.eligible ? "✓ Phù hợp" : "⚠ Không phù hợp"}{selected ? ` · ${selected.totalAssignments} trận khác` : ""}</span><button type="button" className="text-button" disabled={disabled} onClick={() => onChange("")}>Bỏ chọn</button></div> : <p className="referee-picker-hint">Hệ thống chỉ gợi ý. BTC chọn người trước khi lưu.</p>}
    {selected && !selected.eligible ? <ul className="referee-assignment-issues">{selected.issues.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}</ul> : null}
    {open && !disabled ? <div className="referee-picker-options"><input type="search" value={search} aria-label={`Tìm trọng tài · ${position.label}`} placeholder="Tìm tên, email, đơn vị…" onChange={(event) => setSearch(event.target.value)} /><div role="group" aria-label={`Gợi ý ${position.label}`} className="referee-picker-results">{filtered.map((candidate) => {
      const duplicate = chosenIds.includes(candidate.userId) && candidate.userId !== value;
      return <button type="button" key={candidate.userId} disabled={!candidate.eligible || duplicate} className={value === candidate.userId ? "is-selected" : ""} onClick={() => { onChange(candidate.userId); setOpen(false); setSearch(""); }}><strong>{candidate.fullName}<span>{candidate.eligible && !duplicate ? "✓ Phù hợp" : "⚠ Không khả dụng"}</span></strong><small>{candidate.email}{candidate.organization ? ` · ${candidate.organization}` : ""}</small><small>{candidate.totalAssignments} trận khác · {candidate.restMinutes === null ? "Chưa có nhiệm vụ liền kề" : `Khoảng nghỉ gần nhất ${candidate.restMinutes} phút`}</small>{duplicate ? <em>Đã chọn cho vị trí khác trong trận.</em> : candidate.issues.map((issue, index) => <em key={`${issue.code}-${index}`}>{issue.message}</em>)}</button>;
    })}{!filtered.length ? <p>Không tìm thấy trọng tài trong đội ngũ phù hợp tìm kiếm.</p> : null}</div></div> : null}
  </section>;
}

