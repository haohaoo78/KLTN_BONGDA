import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  addRefereeTeamMember, getRefereeTeam, lookupRefereeAccount, resendRefereeAccessEmail, updateRefereeTeamMember,
  type RefereeAccountLookup, type RefereeTeamIdentity, type RefereeTeamLevel, type RefereeTeamMember,
  type RefereeTeamPosition, type RefereeTeamProfile, type RefereeTeamResponse,
} from "../api/refereeTeam";
import "./step6-referee-workspace.css";

type Props = { tournamentId: string; tournamentName: string; onNotice?: (message: string) => void };
type DrawerMode = "add" | "detail" | "edit";
type AccountFilter = "ALL" | "ACTIVE" | "UNACTIVATED" | "RESTRICTED";
const tabs = ["Đội ngũ trọng tài", "Cấu hình trọng tài", "Phân công", "Công bố & theo dõi"];
const levels: Array<{ value: RefereeTeamLevel; label: string }> = [
  { value: "UNVERIFIED", label: "Chưa xác minh" }, { value: "ENTRY", label: "Cơ bản" },
  { value: "CITY", label: "Cấp thành phố" }, { value: "NATIONAL", label: "Quốc gia" }, { value: "INTERNATIONAL", label: "Quốc tế" },
];
const positions: Array<{ value: RefereeTeamPosition; label: string }> = [
  { value: "REFEREE", label: "Trọng tài chính" }, { value: "ASSISTANT_REFEREE_1", label: "Trợ lý 1" },
  { value: "ASSISTANT_REFEREE_2", label: "Trợ lý 2" }, { value: "ASSISTANT_REFEREE_3", label: "Trợ lý 3" },
  { value: "ASSISTANT_REFEREE_4", label: "Trợ lý 4" }, { value: "FOURTH_OFFICIAL", label: "Trọng tài thứ tư" },
  { value: "MATCH_SECRETARY", label: "Thư ký trận đấu" },
];
const blankProfile = (): RefereeTeamProfile => ({ organization: "", club: "", formats: [], level: "UNVERIFIED", experienceYears: 0, positions: [], unavailablePeriods: [], notes: "" });
const copyProfile = (profile: RefereeTeamProfile): RefereeTeamProfile => ({ ...profile, formats: [...profile.formats], positions: [...profile.positions], unavailablePeriods: profile.unavailablePeriods.map((period) => ({ ...period })) });
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Không thể hoàn tất yêu cầu. Vui lòng thử lại.";
const searchText = (value: string) => value.toLocaleLowerCase("vi").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replaceAll("đ", "d");
const formatDate = (value: string | null) => value ? new Date(value).toLocaleString("vi-VN") : "Chưa có";

function accountState(identity: RefereeTeamIdentity): Exclude<AccountFilter, "ALL"> {
  if (identity.accountStatus === "LOCKED" || identity.accountStatus === "DISABLED") return "RESTRICTED";
  if (!identity.emailVerified) return "UNACTIVATED";
  return identity.isActive ? "ACTIVE" : "RESTRICTED";
}
function accountLabel(identity: RefereeTeamIdentity): string {
  if (identity.accountStatus === "DISABLED") return "Đã vô hiệu hóa";
  return ({ ACTIVE: "Đã kích hoạt", UNACTIVATED: "Chưa kích hoạt", RESTRICTED: "Tạm khóa" })[accountState(identity)];
}
function emailLabel(member: RefereeTeamMember): string {
  return ({ SENT: "SMTP đã tiếp nhận", PENDING: "Chưa xác nhận gửi", FAILED: "Gửi email thất bại" })[member.accessEmail.status];
}

export function Step6RefereeWorkspace({ tournamentId, tournamentName, onNotice }: Props) {
  const [tab, setTab] = useState(0);
  const [data, setData] = useState<RefereeTeamResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [accountFilter, setAccountFilter] = useState<AccountFilter>("ALL");
  const [assignmentFilter, setAssignmentFilter] = useState("ALL");
  const [page, setPage] = useState(0);
  const [drawer, setDrawer] = useState<DrawerMode | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [profile, setProfile] = useState<RefereeTeamProfile>(blankProfile);
  const [lookup, setLookup] = useState<RefereeAccountLookup | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resending, setResending] = useState(false);
  const [formError, setFormError] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [periodReason, setPeriodReason] = useState("");
  const loadSequence = useRef(0);
  const lookupSequence = useRef(0);
  const contextGeneration = useRef(0);
  const selected = data?.members.find((member) => member.id === selectedId) ?? null;
  const readOnly = data?.tournamentId !== tournamentId || data.readOnly !== false;

  const reload = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true); setLoadError("");
    try {
      const response = await getRefereeTeam(tournamentId);
      if (sequence === loadSequence.current) setData(response);
    } catch (error) {
      if (sequence === loadSequence.current) setLoadError(errorMessage(error));
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [tournamentId]);

  useEffect(() => {
    contextGeneration.current += 1;
    setData(null); setDrawer(null); setSelectedId(null); setTab(0); setNotice(""); setSearch(""); setPage(0);
    setAccountFilter("ALL"); setAssignmentFilter("ALL"); setSaving(false); setResending(false); lookupSequence.current += 1;
    void reload();
    return () => { loadSequence.current += 1; lookupSequence.current += 1; contextGeneration.current += 1; };
  }, [reload]);

  useEffect(() => {
    if (!drawer) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || saving || resending) return;
      event.preventDefault(); lookupSequence.current += 1; setLookingUp(false); setDrawer(null); setFormError("");
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [drawer, saving, resending]);

  const filtered = useMemo(() => (data?.members ?? []).filter((member) => {
    const text = searchText(`${member.identity.fullName} ${member.identity.email} ${member.profile.organization} ${member.profile.club}`);
    return text.includes(searchText(search.trim())) && (accountFilter === "ALL" || accountState(member.identity) === accountFilter)
      && (assignmentFilter === "ALL" || (assignmentFilter === "ASSIGNED" ? member.assignmentCount > 0 : member.assignmentCount === 0));
  }), [data, search, accountFilter, assignmentFilter]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / 10));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(currentPage * 10, currentPage * 10 + 10);

  function announce(message: string) { setNotice(message); onNotice?.(message); }
  function closeDrawer() { if (saving || resending) return; lookupSequence.current += 1; setLookingUp(false); setDrawer(null); setFormError(""); }
  function openAdd() {
    lookupSequence.current += 1; setSelectedId(null); setEmail(""); setFullName(""); setPhone(""); setLookup(null);
    setLookingUp(false); setProfile(blankProfile()); setFormError(""); setPeriodStart(""); setPeriodEnd(""); setPeriodReason(""); setDrawer("add");
  }
  function openMember(member: RefereeTeamMember, mode: DrawerMode) {
    if (saving || resending) return;
    lookupSequence.current += 1; setSelectedId(member.id); setEmail(member.identity.email); setFullName(member.identity.fullName);
    setPhone(member.identity.phone ?? ""); setProfile(copyProfile(member.profile)); setFormError(""); setLookingUp(false);
    setPeriodStart(""); setPeriodEnd(""); setPeriodReason(""); setDrawer(mode);
  }
  function changeEmail(value: string) {
    lookupSequence.current += 1; setEmail(value); setLookup(null); setLookingUp(false); setFullName(""); setPhone(""); setFormError("");
  }
  async function checkEmail() {
    const normalized = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) { setFormError("Nhập địa chỉ email hợp lệ để tra cứu."); return; }
    const sequence = ++lookupSequence.current;
    setLookingUp(true); setFormError(""); setLookup(null);
    try {
      const result = await lookupRefereeAccount(tournamentId, normalized);
      if (sequence !== lookupSequence.current) return;
      setEmail(normalized); setLookup(result); setFullName(result.account?.fullName ?? ""); setPhone(result.account?.phone ?? "");
    } catch (error) { if (sequence === lookupSequence.current) setFormError(errorMessage(error)); }
    finally { if (sequence === lookupSequence.current) setLookingUp(false); }
  }
  function acceptMember(member: RefereeTeamMember) {
    setData((previous) => previous ? { ...previous, members: previous.members.some((row) => row.id === member.id)
      ? previous.members.map((row) => row.id === member.id ? member : row) : [...previous.members, member] } : previous);
    setSelectedId(member.id); setProfile(copyProfile(member.profile)); setEmail(member.identity.email); setFullName(member.identity.fullName); setPhone(member.identity.phone ?? "");
  }
  async function saveMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (saving || readOnly) return;
    if (drawer === "add" && (!lookup || lookup.alreadyMember)) { setFormError("Tra cứu email và chọn tài khoản chưa nằm trong đội ngũ giải."); return; }
    if (drawer === "add" && !lookup?.found && !fullName.trim()) { setFormError("Nhập họ tên cho tài khoản mới."); return; }
    const generation = contextGeneration.current;
    setSaving(true); setFormError("");
    try {
      const result = drawer === "add"
        ? await addRefereeTeamMember(tournamentId, { email: email.trim().toLowerCase(), ...(!lookup?.found ? { fullName: fullName.trim(), ...(phone.trim() ? { phone: phone.trim() } : {}) } : {}), profile, requestId: crypto.randomUUID() })
        : selected ? await updateRefereeTeamMember(tournamentId, selected.id, profile) : null;
      if (!result) throw new Error("Không tìm thấy trọng tài cần cập nhật. Hãy tải lại danh sách.");
      if (generation !== contextGeneration.current) return;
      acceptMember(result.member); setDrawer("detail");
      announce(drawer === "add" ? `Đã thêm ${result.member.identity.fullName} vào đội ngũ. ${emailLabel(result.member)}.` : "Đã lưu hồ sơ trọng tài của giải.");
      await reload();
    } catch (error) { if (generation === contextGeneration.current) setFormError(errorMessage(error)); }
    finally { if (generation === contextGeneration.current) setSaving(false); }
  }
  async function resendAccess() {
    if (!selected || readOnly || resending) return;
    const generation = contextGeneration.current;
    setResending(true); setFormError("");
    try {
      const result = await resendRefereeAccessEmail(tournamentId, selected.id, crypto.randomUUID());
      if (generation !== contextGeneration.current) return;
      acceptMember(result.member); announce(`${emailLabel(result.member)}. Trạng thái được cập nhật từ hệ thống gửi email.`); await reload();
    } catch (error) { if (generation === contextGeneration.current) setFormError(errorMessage(error)); }
    finally { if (generation === contextGeneration.current) setResending(false); }
  }
  function addUnavailablePeriod() {
    const startAt = new Date(periodStart); const endAt = new Date(periodEnd);
    if (!periodStart || !periodEnd || !Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime()) || startAt >= endAt || !periodReason.trim()) {
      setFormError("Khoảng không khả dụng cần thời gian bắt đầu trước kết thúc và lý do."); return;
    }
    setProfile((previous) => ({ ...previous, unavailablePeriods: [...previous.unavailablePeriods, { id: crypto.randomUUID(), startAt: startAt.toISOString(), endAt: endAt.toISOString(), reason: periodReason.trim() }] }));
    setPeriodStart(""); setPeriodEnd(""); setPeriodReason(""); setFormError("");
  }

  const advancedFields = <details className="step6-team-advanced"><summary>Thông tin nâng cao <span>Chuyên môn, vị trí & lịch không khả dụng</span></summary><div className="step6-team-advanced-content">
    <label>CLB / đơn vị liên quan<input value={profile.club} maxLength={200} onChange={(event) => setProfile({ ...profile, club: event.target.value })} /></label>
    <fieldset><legend>Loại bóng đá</legend><div className="step6-team-choices">{([5, 7, 11] as const).map((format) => <label key={format}><input type="checkbox" checked={profile.formats.includes(format)} onChange={(event) => setProfile({ ...profile, formats: event.target.checked ? [...profile.formats, format] : profile.formats.filter((value) => value !== format) })} />{format} người</label>)}</div></fieldset>
    <div className="step6-team-field-pair"><label>Trình độ<select value={profile.level} onChange={(event) => setProfile({ ...profile, level: event.target.value as RefereeTeamLevel })}>{levels.map((level) => <option key={level.value} value={level.value}>{level.label}</option>)}</select></label><label>Kinh nghiệm (năm)<input type="number" min={0} max={80} step={1} value={profile.experienceYears} onChange={(event) => setProfile({ ...profile, experienceYears: Number(event.target.value) })} /></label></div>
    <fieldset><legend>Vị trí chuyên môn</legend><div className="step6-team-choices is-vertical">{positions.map((position) => <label key={position.value}><input type="checkbox" checked={profile.positions.includes(position.value)} onChange={(event) => setProfile({ ...profile, positions: event.target.checked ? [...profile.positions, position.value] : profile.positions.filter((value) => value !== position.value) })} />{position.label}</label>)}</div></fieldset>
    <section className="step6-team-period-editor"><h4>Thời gian không khả dụng</h4><div className="step6-team-field-pair"><label>Từ lúc<input type="datetime-local" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} /></label><label>Đến lúc<input type="datetime-local" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} /></label></div><label>Lý do<input value={periodReason} maxLength={500} onChange={(event) => setPeriodReason(event.target.value)} /></label><button type="button" className="button button-secondary" onClick={addUnavailablePeriod}>Thêm khoảng thời gian</button>
      {profile.unavailablePeriods.length ? <ul className="step6-team-period-list">{profile.unavailablePeriods.map((period) => <li key={period.id}><span><b>{formatDate(period.startAt)} – {formatDate(period.endAt)}</b><small>{period.reason}</small></span><button type="button" className="text-button text-danger" aria-label={`Bỏ khoảng không khả dụng ${period.reason}`} onClick={() => setProfile({ ...profile, unavailablePeriods: profile.unavailablePeriods.filter((row) => row.id !== period.id) })}>Bỏ</button></li>)}</ul> : <p>Chưa khai báo khoảng không khả dụng.</p>}
    </section><label>Ghi chú<textarea rows={3} maxLength={2000} value={profile.notes} onChange={(event) => setProfile({ ...profile, notes: event.target.value })} /></label>
  </div></details>;

  return <section className="step6-referee-workspace" aria-label="Không gian phân công trọng tài">
    <header className="step6-team-heading"><div><span className="eyebrow">BƯỚC 6</span><h2>Phân công trọng tài</h2><p>{tournamentName}</p></div></header>
    <nav className="step6-team-tabs" aria-label="Công đoạn phân công trọng tài" role="tablist">{tabs.map((title, index) => <button key={title} type="button" role="tab" disabled={saving || resending} id={`step6-team-tab-${index}`} aria-controls={`step6-team-panel-${index}`} aria-selected={tab === index} onClick={() => { setTab(index); closeDrawer(); }}><span>{index + 1}</span>{title}</button>)}</nav>
    {tab !== 0 ? <section className="step6-team-pending" role="tabpanel" id={`step6-team-panel-${tab}`} aria-labelledby={`step6-team-tab-${tab}`}><span className="eyebrow">{tabs[tab]}</span><h3>Chưa triển khai</h3><p>Công đoạn này chưa có thao tác nghiệp vụ trong phiên bản hiện tại.</p></section> : <section role="tabpanel" id="step6-team-panel-0" aria-labelledby="step6-team-tab-0">
      <div className="step6-team-metrics">{[["Tổng trọng tài", data?.stats.totalMembers], ["Đã có phân công", data?.stats.assignedMembers], ["Chưa phân công", data?.stats.unassignedMembers], ["Tổng lượt phân công", data?.stats.totalAssignments]].map(([label, value]) => <article key={label}><span>{label}</span><strong>{value ?? "—"}</strong></article>)}</div>
      {data?.readOnly ? <p className="step6-team-readonly" role="status">{data.readOnlyReason || "Công bố lịch thi đấu ở Bước 5 để quản lý đội ngũ trọng tài của giải."}</p> : null}
      {loadError ? <p className="form-error" role="alert">{loadError}</p> : null}{notice ? <p className="form-success" role="status">{notice}</p> : null}
      <div className={`step6-team-layout ${drawer ? "is-drawer-open" : ""}`}>
        <section className="step6-team-list" aria-label="Danh sách đội ngũ trọng tài"><header><div><h3>Đội ngũ trọng tài</h3><p>Thông tin tài khoản và hồ sơ chuyên môn theo giải.</p></div><div className="step6-team-list-actions"><button className="button button-secondary" type="button" disabled={loading || saving || resending} onClick={() => { void reload(); }}>{loading ? "Đang tải…" : "Tải lại"}</button><button className="button button-primary" type="button" disabled={readOnly || saving || resending} onClick={openAdd}>+ Thêm trọng tài</button></div></header>
          <div className="step6-team-filters"><label className="step6-team-search">Tìm trọng tài<input type="search" placeholder="Họ tên, email, đơn vị…" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} /></label><label>Tài khoản<select value={accountFilter} onChange={(event) => { setAccountFilter(event.target.value as AccountFilter); setPage(0); }}><option value="ALL">Tất cả trạng thái</option><option value="ACTIVE">Đã kích hoạt</option><option value="UNACTIVATED">Chưa kích hoạt</option><option value="RESTRICTED">Bị hạn chế</option></select></label><label>Phân công<select value={assignmentFilter} onChange={(event) => { setAssignmentFilter(event.target.value); setPage(0); }}><option value="ALL">Tất cả</option><option value="ASSIGNED">Đã có phân công</option><option value="UNASSIGNED">Chưa phân công</option></select></label></div>
          <div className="step6-team-table-wrap"><table><thead><tr><th>Họ tên</th><th>Email</th><th>Đơn vị</th><th>Tài khoản</th><th>Số trận</th><th>Thao tác</th></tr></thead><tbody>{pageRows.map((member) => <tr key={member.id} className={selectedId === member.id && drawer ? "is-selected" : ""}><td><button className="step6-team-name" type="button" onClick={() => openMember(member, "detail")}>{member.identity.fullName}</button></td><td>{member.identity.email}</td><td>{member.profile.organization || "Chưa khai báo"}</td><td><span className={`step6-team-badge is-${accountState(member.identity).toLowerCase()}`}>{accountLabel(member.identity)}</span><small className={`step6-team-email is-${member.accessEmail.status.toLowerCase()}`} title="SMTP tiếp nhận chỉ xác nhận máy chủ email đã nhận yêu cầu; không xác nhận thư đã vào hộp thư đến.">{emailLabel(member)}</small></td><td className="step6-team-count">{member.assignmentCount}</td><td><div className="step6-team-row-actions"><button type="button" className="text-button" onClick={() => openMember(member, "detail")}>Chi tiết</button><button type="button" className="text-button" disabled={readOnly || saving || resending} onClick={() => openMember(member, "edit")}>Sửa</button></div></td></tr>)}</tbody></table>
            {!pageRows.length ? <div className="step6-team-empty"><strong>{loading ? "Đang tải đội ngũ trọng tài…" : !data ? "Chưa tải được dữ liệu" : data.members.length ? "Không có trọng tài phù hợp bộ lọc" : "Chưa có trọng tài trong đội ngũ"}</strong><span>{loading ? "Đang đọc dữ liệu từ hệ thống." : data?.members.length ? "Thử thay đổi từ khóa hoặc bộ lọc." : "Thêm trọng tài bằng email để quản lý hồ sơ theo giải."}</span></div> : null}
          </div><footer className="step6-team-pagination"><span>{!data ? loading ? "Đang tải dữ liệu…" : "Chưa tải được dữ liệu" : filtered.length ? `${currentPage * 10 + 1}–${Math.min((currentPage + 1) * 10, filtered.length)} / ${filtered.length} trọng tài` : "0 trọng tài"}</span><div><button type="button" className="button button-secondary" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Trước</button><span>{currentPage + 1} / {pageCount}</span><button type="button" className="button button-secondary" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}>Sau</button></div></footer>
        </section>
        {drawer ? <aside className="step6-team-drawer" aria-labelledby="step6-team-drawer-title"><header><div><span className="eyebrow">HỒ SƠ TRỌNG TÀI</span><h3 id="step6-team-drawer-title">{drawer === "add" ? "Thêm trọng tài" : drawer === "edit" ? "Chỉnh sửa hồ sơ" : "Chi tiết trọng tài"}</h3></div><button type="button" className="step6-team-close" aria-label="Đóng hồ sơ trọng tài" disabled={saving || resending} onClick={closeDrawer}>×</button></header>
          {formError ? <p className="form-error" role="alert">{formError}</p> : null}
          {drawer === "detail" && selected ? <div className="step6-team-detail"><h4>{selected.identity.fullName}</h4><span className={`step6-team-badge is-${accountState(selected.identity).toLowerCase()}`}>{accountLabel(selected.identity)}</span><dl><dt>Email</dt><dd>{selected.identity.email}</dd><dt>Điện thoại</dt><dd>{selected.identity.phone || "Chưa khai báo"}</dd><dt>Đơn vị</dt><dd>{selected.profile.organization || "Chưa khai báo"}</dd><dt>Đã phân công</dt><dd>{selected.assignmentCount} trận</dd></dl>
            <section className={`step6-team-delivery is-${selected.accessEmail.status.toLowerCase()}`}><strong>{emailLabel(selected)}</strong><p>{selected.accessEmail.status === "SENT" ? "Máy chủ SMTP đã tiếp nhận email hướng dẫn truy cập. Đây không phải xác nhận thư đã vào hộp thư đến." : selected.accessEmail.status === "FAILED" ? "Email chưa gửi thành công. Hồ sơ trọng tài vẫn được giữ trong đội ngũ; có thể gửi lại." : "Hệ thống chưa xác nhận được kết quả gửi email. Không tự động gửi lại; chỉ gửi lại khi BTC nhấn nút bên dưới."}</p><small>Lần gửi gần nhất: {formatDate(selected.accessEmail.lastAttemptAt)}</small>{selected.accessEmail.errorCode ? <small>Mã lỗi: {selected.accessEmail.errorCode}</small> : null}<button type="button" className="button button-secondary" disabled={readOnly || resending || saving} onClick={() => { void resendAccess(); }}>{resending ? "Đang gửi…" : "Gửi lại email truy cập"}</button></section>
            <details className="step6-team-advanced"><summary>Thông tin nâng cao</summary><dl><dt>Trình độ / kinh nghiệm</dt><dd>{levels.find((level) => level.value === selected.profile.level)?.label ?? selected.profile.level} · {selected.profile.experienceYears} năm</dd><dt>Loại bóng đá</dt><dd>{selected.profile.formats.map((format) => `${format} người`).join(", ") || "Chưa khai báo"}</dd><dt>Vị trí</dt><dd>{selected.profile.positions.map((position) => positions.find((item) => item.value === position)?.label ?? position).join(", ") || "Chưa khai báo"}</dd><dt>CLB / đơn vị liên quan</dt><dd>{selected.profile.club || "Chưa khai báo"}</dd><dt>Không khả dụng</dt><dd>{selected.profile.unavailablePeriods.length ? selected.profile.unavailablePeriods.map((period) => <p key={period.id}>{formatDate(period.startAt)} – {formatDate(period.endAt)}<br />{period.reason}</p>) : "Chưa khai báo"}</dd><dt>Ghi chú</dt><dd>{selected.profile.notes || "Chưa có"}</dd></dl></details>
            <footer className="step6-team-form-actions"><button type="button" className="button button-secondary" onClick={closeDrawer}>Đóng</button><button type="button" className="button button-primary" disabled={readOnly || resending} onClick={() => openMember(selected, "edit")}>Chỉnh sửa hồ sơ</button></footer>
          </div> : <form className="step6-team-form" onSubmit={(event) => { void saveMember(event); }}>
            <fieldset disabled={saving || readOnly}><label>Email{drawer === "add" ? <div className="step6-team-email-lookup"><input type="email" required maxLength={254} value={email} onChange={(event) => changeEmail(event.target.value)} autoComplete="email" /><button type="button" className="button button-secondary" disabled={lookingUp || !email.trim()} onClick={() => { void checkEmail(); }}>{lookingUp ? "Đang tìm…" : "Tra cứu"}</button></div> : <input type="email" value={email} readOnly />}</label>
              {drawer === "add" && lookup ? <p className={`step6-team-lookup-result ${lookup.alreadyMember ? "is-error" : ""}`} role="status">{lookup.alreadyMember ? "Tài khoản này đã có trong đội ngũ của giải. Hãy mở hồ sơ trong danh sách." : lookup.found ? "Đã tìm thấy tài khoản. Thông tin định danh được lấy từ hồ sơ hiện có." : "Chưa có tài khoản. Nhập họ tên để tạo tài khoản và gửi liên kết truy cập an toàn."}</p> : drawer === "add" ? <p className="step6-team-hint">Tra cứu email trước khi thêm để tránh tạo trùng tài khoản.</p> : <p className="step6-team-hint">Thông tin định danh thuộc tài khoản và không chỉnh sửa tại hồ sơ giải.</p>}
              <label>Họ tên<input value={fullName} required={drawer === "add" && lookup?.found === false} readOnly={drawer !== "add" || lookup?.found !== false} maxLength={200} onChange={(event) => setFullName(event.target.value)} autoComplete="name" /></label><label>Số điện thoại <span>(không bắt buộc)</span><input type="tel" value={phone} readOnly={drawer !== "add" || lookup?.found !== false} maxLength={30} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" /></label><label>Trường / đơn vị<input value={profile.organization} maxLength={200} onChange={(event) => setProfile({ ...profile, organization: event.target.value })} /></label>
              {advancedFields}
            </fieldset><footer className="step6-team-form-actions"><button type="button" className="button button-secondary" disabled={saving} onClick={closeDrawer}>Hủy</button><button type="submit" className="button button-primary" disabled={saving || readOnly || lookingUp || drawer === "add" && (!lookup || lookup.alreadyMember)}>{saving ? "Đang lưu…" : drawer === "add" ? "Thêm vào đội ngũ" : "Lưu thay đổi"}</button></footer>
          </form>}
        </aside> : null}
      </div>
    </section>}
  </section>;
}
