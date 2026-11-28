import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError } from "../api/client";
import { getRefereeConfiguration, saveRefereeConfiguration, type RefereeCapability, type RefereeConfiguration, type RefereeConfigurationOverride, type RefereeConfigurationResponse, type RefereePosition } from "../api/refereeConfiguration";
import "./referee-configuration-panel.css";

const capabilities: Array<{ code: RefereeCapability; label: string }> = [
  { code: "RECORD_EVENT", label: "Ghi sự kiện" }, { code: "EDIT_EVENT", label: "Sửa sự kiện" },
  { code: "MANAGE_REPORT", label: "Quản lý biên bản" },
];
const stageName = (stage: string) => stage === "GROUP" ? "Vòng bảng / vòng tròn" : "Loại trực tiếp";
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export function refereeTemplate(count: number): RefereePosition[] {
  const all: RefereeCapability[] = ["RECORD_EVENT", "EDIT_EVENT", "MANAGE_REPORT", "FINALIZE"];
  const main: RefereePosition = { code: "REFEREE", label: "Trọng tài chính", required: true, capabilities: all };
  if (count === 1) return [main];
  if (count === 2) return [main, { code: "MATCH_SECRETARY", label: "Thư ký trận đấu", required: true, capabilities: ["RECORD_EVENT", "MANAGE_REPORT"] }];
  const rows: RefereePosition[] = [main, ...[1, 2].map((index): RefereePosition => ({ code: `ASSISTANT_REFEREE_${index}`, label: `Trợ lý trọng tài ${index}`, required: true, capabilities: ["RECORD_EVENT"] }))];
  if (count === 4) rows.push({ code: "FOURTH_OFFICIAL", label: "Trọng tài bàn", required: true, capabilities: ["RECORD_EVENT", "MANAGE_REPORT"] });
  return rows;
}

export function RefereePositionEditor({ positions, onChange, name, disabled }: { positions: RefereePosition[]; onChange: (positions: RefereePosition[]) => void; name: string; disabled: boolean }) {
  function change(index: number, patch: Partial<RefereePosition>) { onChange(positions.map((row, current) => current === index ? { ...row, ...patch } : row)); }
  function finalAuthority(index: number) {
    onChange(positions.map((row, current) => ({ ...row, required: current === index || row.required,
      capabilities: [...row.capabilities.filter((cap) => cap !== "FINALIZE"), ...(current === index ? ["FINALIZE" as const] : [])] })));
  }
  function remove(index: number) {
    const next = positions.filter((_, current) => current !== index);
    if (!next.some((row) => row.capabilities.includes("FINALIZE"))) next[0] = { ...next[0], required: true, capabilities: [...next[0].capabilities, "FINALIZE"] };
    onChange(next);
  }
  return <div className="referee-config-positions">
    <div className="referee-config-templates" aria-label={`Mẫu nhanh ${name}`}><span>Mẫu nhanh</span>{[1, 2, 3, 4].map((count) => <button type="button" className="button button-secondary" key={count} disabled={disabled} onClick={() => onChange(refereeTemplate(count))}>{count} trọng tài</button>)}</div>
    <div className="referee-config-table-wrap"><table className="referee-config-table"><thead><tr><th>Vị trí trọng tài</th><th>Nhiệm vụ & quyền</th><th>Yêu cầu</th><th><span className="sr-only">Thao tác</span></th></tr></thead><tbody>{positions.map((position, index) => {
      const final = position.capabilities.includes("FINALIZE");
      return <tr key={position.code}><td><label><span className="sr-only">Tên vị trí {index + 1} · {name}</span><input required maxLength={120} value={position.label} onChange={(event) => change(index, { label: event.target.value })} disabled={disabled} /></label><small>Vị trí {index + 1}</small></td><td><div className="referee-config-capabilities">{capabilities.map((capability) => <label key={capability.code}><input type="checkbox" disabled={disabled} checked={position.capabilities.includes(capability.code)} onChange={(event) => change(index, { capabilities: event.target.checked ? [...position.capabilities, capability.code] : position.capabilities.filter((cap) => cap !== capability.code) })} />{capability.label}</label>)}<label className={final ? "is-authority" : ""}><input type="radio" name={`final-${name}`} checked={final} disabled={disabled} onChange={() => finalAuthority(index)} />Xác nhận kết quả cuối cùng</label></div></td><td><label className="referee-config-required"><input type="checkbox" checked={position.required} disabled={disabled || final} onChange={(event) => change(index, { required: event.target.checked })} />{position.required ? "Bắt buộc" : "Tùy chọn"}</label></td><td><button type="button" className="text-button" aria-label={`Bỏ vị trí ${position.label} · ${name}`} disabled={disabled || positions.length === 1} onClick={() => remove(index)}>Bỏ</button></td></tr>;
    })}</tbody></table></div>
    <button type="button" className="button button-secondary referee-config-add-position" disabled={disabled || positions.length >= 64} onClick={() => onChange([...positions, { code: `CUSTOM_${crypto.randomUUID().replaceAll("-", "").toUpperCase()}`, label: `Vị trí bổ sung ${positions.length + 1}`, required: false, capabilities: ["RECORD_EVENT"] }])}>+ Thêm vị trí</button>
  </div>;
}

export function RefereeConfigurationPanel({ tournamentId, onBusyChange }: { tournamentId: string; onBusyChange: (busy: boolean) => void }) {
  const [data, setData] = useState<RefereeConfigurationResponse | null>(null);
  const [draft, setDraft] = useState<RefereeConfiguration>({ defaultPositions: refereeTemplate(1), overrides: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [impacts, setImpacts] = useState<Array<{ matchId: string; reasons: string[] }>>([]);
  const sequence = useRef(0);
  const alive = useRef(true);
  const busyCallback = useRef(onBusyChange);
  busyCallback.current = onBusyChange;
  const readOnly = loading || saving || !data || data.tournamentId !== tournamentId || data.readOnly;
  const dirty = Boolean(data && JSON.stringify(draft) !== JSON.stringify(data.configuration));
  async function load() {
    const request = ++sequence.current;
    setLoading(true); setError(""); setNotice(""); setImpacts([]);
    try {
      const result = await getRefereeConfiguration(tournamentId);
      if (alive.current && sequence.current === request) { setData(result); setDraft(copy(result.configuration ?? { defaultPositions: refereeTemplate(1), overrides: [] })); }
    } catch (failure) { if (alive.current && sequence.current === request) { setData(null); setError(failure instanceof Error ? failure.message : "Không tải được cấu hình trọng tài."); } }
    finally { if (alive.current && sequence.current === request) setLoading(false); }
  }
  useEffect(() => {
    alive.current = true; setData(null); void load();
    return () => { alive.current = false; sequence.current += 1; busyCallback.current(false); };
  }, [tournamentId]);
  function update(next: RefereeConfiguration) { setDraft(next); setNotice(""); setError(""); setImpacts([]); }
  async function save(event: FormEvent) {
    event.preventDefault(); if (readOnly || !data) return;
    setSaving(true); busyCallback.current(true); setError(""); setNotice(""); setImpacts([]);
    const request = sequence.current;
    try {
      const result = await saveRefereeConfiguration(tournamentId, draft, data.revision);
      if (alive.current && request === sequence.current) { setData(result); setDraft(copy(result.configuration!)); setNotice("Đã lưu cấu hình trọng tài. Cấu hình áp dụng theo trận, vòng, giai đoạn rồi đến mặc định của giải."); }
    } catch (failure) {
      if (alive.current && request === sequence.current) {
        setError(failure instanceof Error ? failure.message : "Không lưu được cấu hình.");
        if (failure instanceof ApiError && Array.isArray(failure.details?.impacts)) setImpacts(failure.details.impacts as Array<{ matchId: string; reasons: string[] }>);
      }
    } finally { if (alive.current && request === sequence.current) { setSaving(false); busyCallback.current(false); } }
  }
  const fixtures = data?.fixtures ?? [];
  const stages = [...new Set(fixtures.map((fixture) => fixture.stage))];
  const rounds = [...new Set(fixtures.filter((fixture) => fixture.roundNumber).map((fixture) => `${fixture.stage}:${fixture.roundNumber}`))];
  function patchOverride(id: string, patch: Partial<RefereeConfigurationOverride>) { update({ ...draft, overrides: draft.overrides.map((row) => row.id === id ? { ...row, ...patch } : row) }); }
  function scopeChange(id: string, scope: RefereeConfigurationOverride["scope"]) {
    const row = draft.overrides.find((item) => item.id === id)!;
    const target = scope === "MATCH" ? { matchId: fixtures[0]?.id } : scope === "ROUND" ? { stage: (rounds[0]?.split(":")[0] ?? stages[0]) as "GROUP" | "KNOCKOUT", roundNumber: Number(rounds[0]?.split(":")[1]) } : { stage: stages[0] };
    update({ ...draft, overrides: draft.overrides.map((item) => item.id === id ? { id, scope, positions: row.positions, ...target } : item) });
  }
  const final = draft.defaultPositions.find((position) => position.capabilities.includes("FINALIZE"));
  return <section className="referee-config" role="tabpanel" id="step6-team-panel-1" aria-labelledby="step6-team-tab-1">
    <form onSubmit={(event) => { void save(event); }}>
      <header className="referee-config-heading"><div><h3>Cấu hình mặc định cho giải</h3><p>Chọn mẫu gợi ý, sau đó điều chỉnh vị trí và quyền điều hành phù hợp.</p></div><span className={`referee-config-status ${dirty ? "is-dirty" : ""}`}>{loading ? "Đang tải…" : !data ? "Chưa tải được dữ liệu" : dirty ? "Chưa lưu thay đổi" : "Đã lưu"}</span></header>
      {data?.readOnlyReason ? <p className="step6-team-readonly" role="status">{data.readOnlyReason}</p> : null}
      {error ? <div className="form-error" role="alert"><p>{error}</p>{impacts.length ? <ul>{impacts.map((impact) => <li key={impact.matchId}><strong>{fixtures.find((fixture) => fixture.id === impact.matchId)?.label ?? impact.matchId}</strong><ul>{impact.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></li>)}</ul> : null}<button type="button" className="button button-secondary" disabled={loading || saving} onClick={() => { void load(); }}>Tải lại cấu hình</button></div> : null}
      {notice ? <p className="form-success" role="status">{notice}</p> : null}
      <div className="referee-config-layout"><section className="referee-config-card"><h4>Vị trí & nhiệm vụ</h4><RefereePositionEditor positions={draft.defaultPositions} onChange={(defaultPositions) => update({ ...draft, defaultPositions })} name="mặc định" disabled={readOnly} /><p className="referee-config-hint">Các mẫu là gợi ý. Có thể thêm vị trí và giao nhiều nhiệm vụ cho cùng một người. Mỗi người chỉ giữ một vị trí trong tổ trọng tài.</p></section>
        <aside className="referee-config-card referee-config-summary"><h4>Tóm tắt cấu hình</h4><dl><div><dt>Số vị trí</dt><dd>{draft.defaultPositions.length}</dd></div><div><dt>Bắt buộc</dt><dd>{draft.defaultPositions.filter((position) => position.required).length}</dd></div><div><dt>Tùy chọn</dt><dd>{draft.defaultPositions.filter((position) => !position.required).length}</dd></div><div><dt>Ngoại lệ</dt><dd>{draft.overrides.length}</dd></div></dl><section><span>Xác nhận kết quả cuối cùng</span><strong>{final?.label || "Chưa chọn"}</strong><p>Chỉ một vị trí bắt buộc có quyền xác nhận cuối cùng cho mỗi trận.</p></section><p className="referee-config-inheritance">Ưu tiên: <b>Trận → Vòng → Giai đoạn → Giải</b></p><small>{data?.configuration ? `Đã lưu lúc ${new Date(data.updatedAt!).toLocaleString("vi-VN")}` : "Mẫu gợi ý chưa được lưu vào hệ thống."}</small></aside>
      </div>
      <details className="referee-config-exceptions"><summary>Cấu hình ngoại lệ <span>{draft.overrides.length ? `${draft.overrides.length} phạm vi` : "Theo giai đoạn, vòng hoặc trận · không bắt buộc"}</span></summary><div className="referee-config-exception-content"><p className="referee-config-hint">Mỗi ngoại lệ thay thế toàn bộ cấu hình mặc định trong phạm vi được chọn. Các trận khác tiếp tục kế thừa cấu hình giải.</p>{draft.overrides.map((row, index) => <section className="referee-config-card referee-config-override" key={row.id}><header><h4>Ngoại lệ {index + 1}</h4><button type="button" className="text-button" disabled={readOnly} onClick={() => update({ ...draft, overrides: draft.overrides.filter((item) => item.id !== row.id) })}>Bỏ ngoại lệ</button></header><div className="referee-config-scope-fields"><label>Áp dụng theo<select disabled={readOnly} value={row.scope} onChange={(event) => scopeChange(row.id, event.target.value as RefereeConfigurationOverride["scope"])}><option value="STAGE">Giai đoạn</option>{rounds.length ? <option value="ROUND">Vòng đấu</option> : null}<option value="MATCH">Trận đấu</option></select></label>{row.scope === "STAGE" ? <label>Giai đoạn<select disabled={readOnly} value={row.stage} onChange={(event) => patchOverride(row.id, { stage: event.target.value as "GROUP" | "KNOCKOUT" })}>{stages.map((stage) => <option key={stage} value={stage}>{stageName(stage)}</option>)}</select></label> : row.scope === "ROUND" ? <label>Vòng đấu<select disabled={readOnly} value={`${row.stage}:${row.roundNumber}`} onChange={(event) => { const [stage, round] = event.target.value.split(":"); patchOverride(row.id, { stage: stage as "GROUP" | "KNOCKOUT", roundNumber: Number(round) }); }}>{rounds.map((round) => <option key={round} value={round}>{stageName(round.split(":")[0])} · Vòng {round.split(":")[1]}</option>)}</select></label> : <label>Trận đấu<select disabled={readOnly} value={row.matchId} onChange={(event) => patchOverride(row.id, { matchId: event.target.value })}>{fixtures.map((fixture) => <option key={fixture.id} value={fixture.id}>{fixture.label}</option>)}</select></label>}</div><RefereePositionEditor positions={row.positions} onChange={(positions) => patchOverride(row.id, { positions })} name={`ngoại lệ ${index + 1}`} disabled={readOnly} /></section>)}<button type="button" className="button button-secondary" disabled={readOnly || !stages.length} onClick={() => update({ ...draft, overrides: [...draft.overrides, { id: crypto.randomUUID(), scope: "STAGE", stage: stages[0], positions: copy(draft.defaultPositions) }] })}>+ Thêm cấu hình ngoại lệ</button></div></details>
      <footer className="referee-config-actions"><p>Áp dụng cho toàn giải, trừ các ngoại lệ. Phân công đã lưu được kiểm tra trước khi đổi cấu hình.</p><button type="submit" className="button button-primary" disabled={readOnly || !dirty}>{saving ? "Đang lưu…" : "Lưu cấu hình"}</button></footer>
    </form>
  </section>;
}
