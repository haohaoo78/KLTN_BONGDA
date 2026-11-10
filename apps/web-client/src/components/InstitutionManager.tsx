import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  createInstitution,
  getInstitutionHistory,
  getManagedInstitutions,
  setInstitutionStatus,
  updateInstitution,
  type Institution,
  type InstitutionHistoryItem,
  type InstitutionInput,
  type InstitutionType,
} from "../api/institutions";
import {
  createStaffAccount,
  listUsers,
  updateUserAccount,
} from "../api/users";
import type { UserProfilePublic } from "@sfl/shared";
import { Modal } from "./Modal";

type Props = {
  canManage: boolean;
};

type InstitutionForm = {
  name: string;
  code: string;
  institutionType: InstitutionType;
  address: string;
  officialWebsite: string;
  contactEmail: string;
  contactPhone: string;
};

const typeLabels: Record<InstitutionType, string> = {
  UNIVERSITY: "Đại học",
  COLLEGE: "Cao đẳng",
  OTHER: "Khác",
};

const statusLabels: Record<Institution["status"], string> = {
  DRAFT: "Bản nháp",
  ACTIVE: "Đang hoạt động",
  SUSPENDED: "Tạm khóa",
};

const emptyForm: InstitutionForm = {
  name: "",
  code: "",
  institutionType: "UNIVERSITY",
  address: "",
  officialWebsite: "",
  contactEmail: "",
  contactPhone: "",
};

function toInput(form: InstitutionForm): InstitutionInput {
  return {
    name: form.name.trim(),
    code: form.code.trim().toUpperCase() || null,
    institutionType: form.institutionType,
    address: form.address.trim() || null,
    officialWebsite: form.officialWebsite.trim() || null,
    contactEmail: form.contactEmail.trim() || null,
    contactPhone: form.contactPhone.trim() || null,
    city: "TP. Hồ Chí Minh",
  };
}

function fromInstitution(institution: Institution): InstitutionForm {
  return {
    name: institution.name,
    code: institution.code ?? "",
    institutionType: institution.institutionType,
    address: institution.address ?? "",
    officialWebsite: institution.officialWebsite ?? "",
    contactEmail: institution.contactEmail ?? "",
    contactPhone: institution.contactPhone ?? "",
  };
}

export function InstitutionManager({ canManage }: Props) {
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<InstitutionType | "">("");
  const [statusFilter, setStatusFilter] = useState<Institution["status"] | "">("");
  const [form, setForm] = useState<InstitutionForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [institutionDialogOpen, setInstitutionDialogOpen] = useState(false);
  const [btcDialogOpen, setBtcDialogOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [history, setHistory] = useState<InstitutionHistoryItem[]>([]);
  const [assignedStaff, setAssignedStaff] = useState<UserProfilePublic[]>([]);
  const [staffSearch, setStaffSearch] = useState("");
  const [staffCandidates, setStaffCandidates] = useState<UserProfilePublic[]>([]);
  const [staffCandidateToAssign, setStaffCandidateToAssign] = useState<UserProfilePublic | null>(null);
  const [staffForm, setStaffForm] = useState({ fullName: "", email: "" });

  const selectedInstitution = useMemo(
    () => institutions.find((institution) => institution.id === selectedId) ?? null,
    [institutions, selectedId],
  );

  const loadInstitutions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { institutions: result } = await getManagedInstitutions({
        search: search.trim() || undefined,
        institutionType: typeFilter || undefined,
        status: statusFilter || undefined,
      });
      setInstitutions(result);
      if (selectedId && !result.some((institution) => institution.id === selectedId)) {
        setSelectedId(null);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Không tải được danh mục trường.");
    } finally {
      setLoading(false);
    }
  }, [search, selectedId, statusFilter, typeFilter]);

  useEffect(() => {
    void loadInstitutions();
  }, [loadInstitutions]);

  const loadSchoolDetails = useCallback(async (institutionId: string) => {
    setError(null);
    try {
      const [staffResult, historyResult] = await Promise.all([
        listUsers({ role: "BTC", institutionId, limit: 100 }),
        getInstitutionHistory(institutionId),
      ]);
      setAssignedStaff(staffResult.users.filter((user) => user.roles.includes("BTC")));
      setHistory(historyResult.history);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Không tải được thông tin Ban tổ chức.");
    }
  }, []);

  useEffect(() => {
    if (selectedId) void loadSchoolDetails(selectedId);
  }, [loadSchoolDetails, selectedId]);

  useEffect(() => {
    if (staffSearch.trim().length < 2) {
      setStaffCandidates([]);
      return;
    }
    let active = true;
    listUsers({ role: "BTC", search: staffSearch.trim(), limit: 20 })
      .then(({ users }) => {
        if (active) setStaffCandidates(users.filter((user) => user.roles.includes("BTC")));
      })
      .catch((searchError: unknown) => {
        if (active) setError(searchError instanceof Error ? searchError.message : "Không tìm được tài khoản BTC.");
      });
    return () => {
      active = false;
    };
  }, [staffSearch]);

  if (!canManage) {
    return <div className="message-banner message-error" role="alert">Chỉ ADMIN được quản lý danh mục trường.</div>;
  }

  async function handleSaveInstitution(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (editingId) {
        await updateInstitution(editingId, toInput(form));
        setNotice("Đã cập nhật thông tin trường.");
        setEditingId(null);
      } else {
        const { institution } = await createInstitution(toInput(form));
        setSelectedId(institution.id);
        setNotice("Đã tạo trường ở trạng thái Bản nháp. Hãy phân công BTC rồi kích hoạt.");
      }
      setForm(emptyForm);
      setInstitutionDialogOpen(false);
      await loadInstitutions();
      if (editingId) await loadSchoolDetails(editingId);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Không thể lưu thông tin trường.");
    } finally {
      setBusy(false);
    }
  }

  async function handleStatusChange(institution: Institution, status: Institution["status"]) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await setInstitutionStatus(institution.id, status);
      setNotice(status === "ACTIVE"
        ? "Đã kích hoạt trường. Trường đủ điều kiện xuất hiện trong biểu mẫu đăng ký."
        : status === "SUSPENDED"
          ? "Đã tạm khóa trường; dữ liệu, đội bóng và hồ sơ cũ được giữ nguyên."
          : "Đã chuyển trường về Bản nháp.");
      await loadInstitutions();
      await loadSchoolDetails(institution.id);
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "Không đổi được trạng thái trường.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateBtc(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedInstitution) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await createStaffAccount({
        fullName: staffForm.fullName.trim(),
        email: staffForm.email.trim(),
        role: "BTC",
        institutionId: selectedInstitution.id,
      });
      setStaffForm({ fullName: "", email: "" });
      setBtcDialogOpen(false);
      setNotice("Đã tạo BTC và gửi email kích hoạt qua SMTP. Tài khoản cần hoàn tất kích hoạt để đăng nhập.");
      await loadSchoolDetails(selectedInstitution.id);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Không tạo được tài khoản BTC.");
    } finally {
      setBusy(false);
    }
  }

  async function handleAssignBtc(user: UserProfilePublic) {
    if (!selectedInstitution || user.institutionId === selectedInstitution.id) return;
    setStaffCandidateToAssign(user);
  }

  async function confirmAssignBtc() {
    if (!selectedInstitution || !staffCandidateToAssign) return;
    const user = staffCandidateToAssign;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await updateUserAccount(user.userId, { institutionId: selectedInstitution.id });
      setStaffSearch("");
      setStaffCandidates([]);
      setStaffCandidateToAssign(null);
      setNotice(`Đã phân công ${user.email} phụ trách ${selectedInstitution.name}.`);
      await loadSchoolDetails(selectedInstitution.id);
    } catch (assignError) {
      setError(assignError instanceof Error ? assignError.message : "Không thể phân công BTC.");
    } finally {
      setBusy(false);
    }
  }

  function startEditing(institution: Institution) {
    setEditingId(institution.id);
    setForm(fromInstitution(institution));
    setInstitutionDialogOpen(true);
  }

  return (
    <div className="institution-manager">
      <section className="panel data-panel institution-overview-panel">
        <div className="panel-heading panel-heading-wrap">
          <div><span className="eyebrow">KHÔNG GIAN QUẢN TRỊ</span><h2>Quản lý trường học</h2><p>Quản lý danh mục, trạng thái hoạt động và tài khoản Ban tổ chức theo từng trường.</p></div>
          <button className="primary-button" type="button" onClick={() => {
            setEditingId(null);
            setForm(emptyForm);
            setInstitutionDialogOpen(true);
          }}><span>＋</span> Thêm trường</button>
        </div>
      </section>

      {(error || notice) ? (
        <div className={`message-banner ${error ? "message-error" : "message-success"}`} role={error ? "alert" : "status"}>
          {error ?? notice}
        </div>
      ) : null}

      <section className="panel data-panel">
        <div className="panel-heading panel-heading-wrap institution-list-heading">
          <div><span className="eyebrow">DANH MỤC HỆ THỐNG</span><h2>Danh sách trường</h2><p>Thông tin liên hệ, trạng thái và thao tác quản lý từng trường.</p></div>
          <div className="button-row">
            <span className="institution-result-count">{institutions.length} <small>trường</small></span>
            <button className="secondary-button institution-refresh-button" type="button" onClick={() => void loadInstitutions()} disabled={loading}><span aria-hidden="true">↻</span> {loading ? "Đang tải…" : "Tải lại"}</button>
          </div>
        </div>
        <div className="section-toolbar">
          <label className="field">Tìm trường
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tên, mã trường…" maxLength={100} />
          </label>
          <label className="field">Loại trường
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as InstitutionType | "")}>
              <option value="">Tất cả</option>
              <option value="UNIVERSITY">Đại học</option>
              <option value="COLLEGE">Cao đẳng</option>
              <option value="OTHER">Khác</option>
            </select>
          </label>
          <label className="field">Trạng thái
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as Institution["status"] | "")}>
              <option value="">Tất cả</option>
              <option value="DRAFT">Bản nháp</option>
              <option value="ACTIVE">Đang hoạt động</option>
              <option value="SUSPENDED">Tạm khóa</option>
            </select>
          </label>
        </div>
        {loading ? <div className="loading-state">Đang tải dữ liệu…</div> : institutions.length ? (
          <div className="institution-table-wrap">
            <table className="institution-table">
              <thead><tr><th scope="col">Trường học</th><th scope="col">Thông tin liên hệ</th><th scope="col">Trạng thái</th><th scope="col">Thao tác</th></tr></thead>
              <tbody>{institutions.map((institution) => (
                <tr key={institution.id} className={selectedId === institution.id ? "is-selected" : ""}>
                  <td data-label="Trường học">
                    <div className="institution-name-cell">
                      <span className="institution-avatar" aria-hidden="true">{institution.name.slice(0, 1).toLocaleUpperCase("vi-VN")}</span>
                      <div><strong>{institution.name}</strong><span>{typeLabels[institution.institutionType]} <i>·</i> Mã: {institution.code || "Chưa cập nhật"}</span><small>{institution.address || "Chưa cập nhật địa chỉ"}</small></div>
                    </div>
                  </td>
                  <td data-label="Thông tin liên hệ"><div className="institution-contact-cell"><span><b aria-hidden="true">✉</b>{institution.contactEmail || "Chưa có email"}</span><span><b aria-hidden="true">☎</b>{institution.contactPhone || "Chưa có số điện thoại"}</span></div></td>
                  <td data-label="Trạng thái"><span className={`institution-status status-${institution.status.toLowerCase()}`}><i />{statusLabels[institution.status]}</span></td>
                  <td data-label="Thao tác">
                    <div className="institution-table-actions">
                      <button className="table-action-button" type="button" onClick={() => startEditing(institution)}><span aria-hidden="true">✎</span> Chỉnh sửa</button>
                      <button className={`table-action-button ${selectedId === institution.id ? "is-active" : ""}`} type="button" onClick={() => setSelectedId(selectedId === institution.id ? null : institution.id)}><span aria-hidden="true">▤</span>{selectedId === institution.id ? "Ẩn BTC" : "BTC / lịch sử"}</button>
                      {institution.status !== "ACTIVE" ? (
                        <button className="table-action-button action-activate" type="button" disabled={busy} onClick={() => void handleStatusChange(institution, "ACTIVE")}><span aria-hidden="true">✓</span> Kích hoạt</button>
                      ) : (
                        <button className="table-action-button action-suspend" type="button" disabled={busy} onClick={() => void handleStatusChange(institution, "SUSPENDED")}><span aria-hidden="true">Ⅱ</span> Tạm khóa</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <div className="empty-state"><h3>Chưa có trường phù hợp</h3></div>}
      </section>

      {selectedInstitution ? (
        <Modal
          open={Boolean(selectedInstitution)}
          title={`Ban tổ chức và lịch sử`}
          description={`Thông tin quản lý nội bộ của ${selectedInstitution.name}.`}
          onClose={() => setSelectedId(null)}
          className="institution-detail-modal"
        >
        <section className="institution-detail-content">
          <div className="panel-heading">
            <div><span className="eyebrow">PHÂN CÔNG VÀ KIỂM SOÁT</span><h2>{selectedInstitution.name}</h2><p>Ban tổ chức và lịch sử thay đổi của trường.</p></div>
            <div className="button-row">
              <span className="status-pill">{statusLabels[selectedInstitution.status]}</span>
              <button className="primary-button" type="button" onClick={() => { setStaffForm({ fullName: "", email: "" }); setBtcDialogOpen(true); }}><span>＋</span> Tạo tài khoản BTC</button>
            </div>
          </div>
          <p>Trường chưa thể kích hoạt nếu chưa có tài khoản BTC được gắn với school_id này. Tài khoản BTC mới được kích hoạt bằng email SMTP hiện tại.</p>
          <div className="institution-list">
            {assignedStaff.map((staff) => (
              <article className="institution-row" key={staff.userId}>
                <div><h3>{staff.fullName}</h3><p>{staff.email}</p></div>
                <div className="institution-contact">
                  <span>{staff.emailVerified ? "Email đã xác minh" : "Chờ xác minh email"}</span>
                  <span>{staff.isActive ? "Tài khoản đang hoạt động" : "Chờ kích hoạt / đang khóa"}</span>
                </div>
              </article>
            ))}
            {!assignedStaff.length ? <div className="empty-state"><p>Chưa có BTC được phân công.</p></div> : null}
          </div>

          <div className="form-grid">
            <label className="field field-wide">Tìm tài khoản BTC hiện có để phân công
              <input value={staffSearch} onChange={(event) => setStaffSearch(event.target.value)} maxLength={100} placeholder="Nhập ít nhất 2 ký tự họ tên hoặc email" />
            </label>
          </div>
          {staffCandidates.filter((candidate) => candidate.institutionId !== selectedInstitution.id).map((candidate) => (
            <article className="institution-row" key={candidate.userId}>
              <div><h3>{candidate.fullName}</h3><p>{candidate.email}</p></div>
              <div className="institution-contact"><span>{candidate.institutionId ? "Đang thuộc trường khác" : "Chưa phân công"}</span></div>
              <button className="text-button" type="button" disabled={busy} onClick={() => void handleAssignBtc(candidate)}>Phân công trường này</button>
            </article>
          ))}

          <div className="panel-heading"><div><span className="eyebrow">NHẬT KÝ</span><h3>Lịch sử thay đổi trường</h3></div></div>
          {history.length ? (
            <div className="institution-list">
              {history.map((item) => (
                <article className="institution-row" key={item.id}>
                  <div>
                    <span className="eyebrow">{new Date(item.changedAt).toLocaleString("vi-VN")} · {item.action} · ADMIN {item.actorId}</span>
                    <p>{JSON.stringify(item.after)}</p>
                  </div>
                </article>
              ))}
            </div>
          ) : <div className="empty-state"><p>Chưa có thay đổi nào được ghi nhận.</p></div>}
        </section>
        </Modal>
      ) : null}

      <Modal
        open={Boolean(staffCandidateToAssign && selectedInstitution)}
        title="Xác nhận phân công BTC"
        description={staffCandidateToAssign && selectedInstitution
          ? `${staffCandidateToAssign.email} sẽ được chuyển từ ${staffCandidateToAssign.institutionId ? "trường hiện tại" : "chưa phân công"} sang phụ trách ${selectedInstitution.name}.`
          : undefined}
        onClose={() => { if (!busy) setStaffCandidateToAssign(null); }}
        className="account-modal"
      >
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={() => setStaffCandidateToAssign(null)} disabled={busy}>Hủy</button>
          <button className="primary-button" type="button" onClick={() => void confirmAssignBtc()} disabled={busy}>
            {busy ? "Đang phân công…" : "Xác nhận phân công"}<span>↗</span>
          </button>
        </div>
      </Modal>

      <Modal
        open={institutionDialogOpen}
        title={editingId ? "Chỉnh sửa thông tin trường" : "Thêm trường học"}
        description={editingId ? "Cập nhật thông tin liên hệ và danh mục của trường." : "Trường mới sẽ ở trạng thái Bản nháp. Phân công BTC trước khi kích hoạt trường."}
        onClose={() => {
          if (busy) return;
          setInstitutionDialogOpen(false);
          setEditingId(null);
          setForm(emptyForm);
        }}
        className="institution-modal"
      >
        <form className="form-grid" onSubmit={(event) => void handleSaveInstitution(event)}>
          <label className="field field-wide">Tên trường
            <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} maxLength={255} placeholder="Ví dụ: Đại học ..." required />
          </label>
          <label className="field">Mã trường <small>(nếu có)</small>
            <input value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))} maxLength={50} placeholder="Mã định danh" />
          </label>
          <label className="field">Loại trường
            <select value={form.institutionType} onChange={(event) => setForm((current) => ({ ...current, institutionType: event.target.value as InstitutionType }))}>
              <option value="UNIVERSITY">{typeLabels.UNIVERSITY}</option>
              <option value="COLLEGE">{typeLabels.COLLEGE}</option>
              <option value="OTHER">{typeLabels.OTHER}</option>
            </select>
          </label>
          <label className="field field-wide">Địa chỉ
            <input value={form.address} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} maxLength={2000} placeholder="Địa chỉ liên hệ" />
          </label>
          <label className="field">Website chính thức
            <input type="url" value={form.officialWebsite} onChange={(event) => setForm((current) => ({ ...current, officialWebsite: event.target.value }))} maxLength={500} placeholder="https://..." />
          </label>
          <label className="field">Email liên hệ
            <input type="email" value={form.contactEmail} onChange={(event) => setForm((current) => ({ ...current, contactEmail: event.target.value }))} maxLength={255} placeholder="contact@school.edu.vn" />
          </label>
          <label className="field field-wide">Số điện thoại
            <input type="tel" value={form.contactPhone} onChange={(event) => setForm((current) => ({ ...current, contactPhone: event.target.value }))} maxLength={30} placeholder="Số liên hệ" />
          </label>
          <div className="field-wide modal-actions">
            <button className="secondary-button" type="button" onClick={() => { setInstitutionDialogOpen(false); setEditingId(null); setForm(emptyForm); }} disabled={busy}>Hủy</button>
            <button className="primary-button" disabled={busy}>{busy ? "Đang lưu…" : editingId ? "Lưu thay đổi" : "Tạo trường"}<span>↗</span></button>
          </div>
        </form>
      </Modal>

      <Modal
        open={btcDialogOpen && Boolean(selectedInstitution)}
        title="Tạo tài khoản Ban tổ chức"
        description={selectedInstitution ? `Tài khoản mới sẽ được gắn với ${selectedInstitution.name}. Liên kết kích hoạt được gửi qua email.` : undefined}
        onClose={() => { if (!busy) setBtcDialogOpen(false); }}
        className="account-modal"
      >
        <form className="form-grid" onSubmit={(event) => void handleCreateBtc(event)}>
          <label className="field field-wide">Họ và tên
            <input value={staffForm.fullName} onChange={(event) => setStaffForm((current) => ({ ...current, fullName: event.target.value }))} maxLength={255} required />
          </label>
          <label className="field field-wide">Email công tác
            <input type="email" value={staffForm.email} onChange={(event) => setStaffForm((current) => ({ ...current, email: event.target.value }))} maxLength={255} placeholder="ten@truong.edu.vn" required />
          </label>
          <div className="field-wide modal-actions">
            <button className="secondary-button" type="button" onClick={() => setBtcDialogOpen(false)} disabled={busy}>Hủy</button>
            <button className="primary-button" disabled={busy}>{busy ? "Đang tạo…" : "Tạo và gửi email kích hoạt"}<span>↗</span></button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
