import { FormEvent, useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import type { UserProfilePublic, UserRole } from "@sfl/shared";
import {
  createStaffAccount,
  getUserById,
  getUserProfileHistory,
  listUsers,
  resendStaffActivation,
  updateUserAccount,
} from "../api/users";
import { getInstitutions, type Institution } from "../api/institutions";
import { InstitutionSelector } from "./InstitutionSelector";

type StaffRole = "BTC" | "REFEREE";
type StatusFilter = "" | "pending" | "active" | "inactive" | "disabled";
type SortField = "fullName" | "email" | "createdAt";
type SortDirection = "asc" | "desc";

const managedRoles: UserRole[] = [
  "ADMIN",
  "BTC",
  "TEAM_CAPTAIN",
  "PLAYER",
  "REFEREE",
  "VIEWER",
];

const roleColors: Record<UserRole, { text: string; bg: string }> = {
  ADMIN: { text: "#0f5c6d", bg: "#dff7fb" },
  BTC: { text: "#7c2d12", bg: "#fde7d7" },
  TEAM_CAPTAIN: { text: "#14532d", bg: "#dcfce7" },
  PLAYER: { text: "#1d4ed8", bg: "#dbeafe" },
  REFEREE: { text: "#7c3aed", bg: "#ede9fe" },
  VIEWER: { text: "#4b5563", bg: "#f3f4f6" },
};

const statusColors = {
  active: { text: "#14532d", bg: "#dcfce7" },
  pending: { text: "#92400e", bg: "#fef3c7" },
  inactive: { text: "#991b1b", bg: "#fee2e2" },
  disabled: { text: "#4b5563", bg: "#e5e7eb" },
};

function formatDate(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("vi-VN");
}

function getStatusMeta(account: UserProfilePublic) {
  if (account.accountStatus === "DISABLED") {
    return { label: "Đã vô hiệu hóa", key: "disabled" } as const;
  }
  if (account.accountStatus === "LOCKED") {
    return { label: "Bị khóa", key: "inactive" } as const;
  }
  if (!account.emailVerified) {
    return { label: "Chưa kích hoạt", key: "pending" } as const;
  }
  if (!account.isActive) {
    return { label: "Bị khóa", key: "inactive" } as const;
  }
  return { label: "Đang hoạt động", key: "active" } as const;
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "U";
}

export function StaffAccountManager() {
  const [accounts, setAccounts] = useState<UserProfilePublic[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState({ total: 0, active: 0, locked: 0, pending: 0, disabled: 0 });
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [offset, setOffset] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const [searchInput, setSearchInput] = useState("");
  const [roleInput, setRoleInput] = useState<UserRole | "">("");
  const [statusInput, setStatusInput] = useState<StatusFilter>("");
  const [institutionInput, setInstitutionInput] = useState("");
  const [createdFromInput, setCreatedFromInput] = useState("");
  const [createdToInput, setCreatedToInput] = useState("");
  const [filters, setFilters] = useState({
    search: "",
    role: "" as UserRole | "",
    status: "" as StatusFilter,
    institutionId: "",
    createdFrom: "",
    createdTo: "",
  });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<UserProfilePublic | null>(null);
  const [selectedHistory, setSelectedHistory] = useState<Array<{ id: number; changedAt: string; changes: Record<string, unknown> }>>([]);
  const [saveDraft, setSaveDraft] = useState<{
    fullName: string;
    phone: string;
    studentId: string;
    institutionId: string;
    roles: UserRole[];
    accountStatus: "ACTIVE" | "LOCKED" | "DISABLED";
    statusReason: string;
  } | null>(null);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("BTC");
  const [institutionId, setInstitutionId] = useState("");

  const displayAccounts = accounts;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.floor(offset / pageSize) + 1;

  const loadAccounts = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await listUsers({
        search: filters.search || undefined,
        role: (filters.role as UserRole) || undefined,
        status: (filters.status as "pending" | "active" | "inactive" | "disabled") || undefined,
        institutionId: filters.institutionId || undefined,
        createdFrom: filters.createdFrom || undefined,
        createdTo: filters.createdTo || undefined,
        sortBy: sortField,
        sortDirection,
        limit: pageSize,
        offset,
      });
      setAccounts(result.users);
      setTotal(result.pagination.total);
      setStats(result.statistics);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Không tải được dữ liệu tài khoản.");
    } finally {
      setBusy(false);
    }
  }, [filters, offset, pageSize, sortDirection, sortField]);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    let active = true;
    getInstitutions()
      .then(({ institutions: result }) => {
        if (active) setInstitutions(result);
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Không tải được danh mục trường.");
      });
    return () => { active = false; };
  }, []);

  const activeFilterList = useMemo(() => {
    const list: string[] = [];
    if (filters.search) list.push(`Từ khóa: ${filters.search}`);
    if (filters.role) list.push(`Vai trò: ${filters.role}`);
    if (filters.status) {
      const label = filters.status === "active" ? "Đang hoạt động" :
        filters.status === "pending" ? "Chưa xác minh" :
          filters.status === "disabled" ? "Đã vô hiệu hóa" : "Bị khóa";
      list.push(`Trạng thái: ${label}`);
    }
    if (filters.institutionId) {
      list.push(`Trường: ${institutions.find((item) => item.id === filters.institutionId)?.name ?? filters.institutionId}`);
    }
    if (filters.createdFrom || filters.createdTo) {
      list.push(`Ngày tạo: ${filters.createdFrom || "đầu"} – ${filters.createdTo || "nay"}`);
    }
    return list;
  }, [filters, institutions]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await createStaffAccount({
        email: email.trim(),
        fullName: fullName.trim(),
        role,
        institutionId: role === "BTC" ? institutionId : undefined,
      });
      setEmail("");
      setFullName("");
      setInstitutionId("");
      setCreateOpen(false);
      setNotice(`Đã tạo tài khoản ${role === "BTC" ? "Ban tổ chức" : "Trọng tài"} và gửi email kích hoạt.`);
      setOffset(0);
      setFilters({ search: "", role: "", status: "", institutionId: "", createdFrom: "", createdTo: "" });
      setSearchInput("");
      setRoleInput("");
      setStatusInput("");
      setInstitutionInput("");
      setCreatedFromInput("");
      setCreatedToInput("");
      void loadAccounts();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Không thể tạo tài khoản.");
    } finally {
      setBusy(false);
    }
  }

  async function openDetail(account: UserProfilePublic) {
    setDetailLoading(true);
    setDetailOpen(true);
    setError(null);
    try {
      const [userResult, historyResult] = await Promise.all([
        getUserById(account.userId),
        getUserProfileHistory(account.userId),
      ]);
      setSelectedAccount(userResult.user);
      setSelectedHistory(historyResult.history);
    } catch (viewError) {
      setSelectedAccount(null);
      setSelectedHistory([]);
      setError(viewError instanceof Error ? viewError.message : "Không thể mở thông tin tài khoản.");
    } finally {
      setDetailLoading(false);
    }
  }

  function openEdit(account: UserProfilePublic) {
    setEditingAccountId(account.userId);
    setSaveDraft({
      fullName: account.fullName,
      phone: account.profileData?.phone ?? "",
      studentId: account.studentId ?? "",
      institutionId: account.institutionId ?? "",
      roles: [...account.roles],
      accountStatus: account.accountStatus ?? (account.isActive ? "ACTIVE" : "LOCKED"),
      statusReason: "",
    });
  }

  async function saveEditedAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingAccountId || !saveDraft) return;
    const trimmedName = saveDraft.fullName.trim();
    if (!trimmedName) {
      setError("Họ tên không được để trống.");
      return;
    }
    if (!saveDraft.roles.length) {
      setError("Tài khoản phải có ít nhất một vai trò.");
      return;
    }
    if (saveDraft.roles.includes("BTC") && !saveDraft.institutionId) {
      setError("BTC phải được gắn với trường học phù hợp.");
      return;
    }
    if (saveDraft.accountStatus !== "ACTIVE" && !saveDraft.statusReason.trim()) {
      setError("Cần ghi lý do khi khóa hoặc vô hiệu hóa tài khoản.");
      return;
    }
    const original = accounts.find((account) => account.userId === editingAccountId);
    if (original && JSON.stringify([...original.roles].sort()) !== JSON.stringify([...saveDraft.roles].sort()) &&
      !window.confirm(`Xác nhận thay đổi vai trò của ${original.fullName}? Quyền truy cập sẽ được cập nhật ngay.`)) {
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const updateResult = await updateUserAccount(editingAccountId, {
        fullName: trimmedName,
        studentId: saveDraft.studentId || null,
        roles: saveDraft.roles,
        institutionId: saveDraft.institutionId || null,
        accountStatus: saveDraft.accountStatus,
        statusReason: saveDraft.statusReason.trim() || null,
        profileData: { phone: saveDraft.phone.trim() || null },
      });
      setNotice(updateResult.notificationWarning ?? "Đã lưu thay đổi tài khoản.");
      setEditingAccountId(null);
      setSaveDraft(null);
      setOffset(0);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Không thể lưu tài khoản.");
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleLock(account: UserProfilePublic) {
    if (account.accountStatus === "DISABLED") {
      setError("Tài khoản đã vô hiệu hóa. Hãy dùng quy trình khôi phục riêng nếu cần.");
      return;
    }
    const nextState = !account.isActive;
    if (nextState && !account.emailVerified) {
      setError("Không thể mở khóa: tài khoản chưa xác minh email.");
      return;
    }
    if (!window.confirm(
      nextState
        ? `Mở khóa ${account.fullName}? Hệ thống không thay đổi trạng thái xác minh email hoặc vai trò.`
        : `Khóa ${account.fullName}? Các phiên đăng nhập hiện tại sẽ không còn hợp lệ ở lần kiểm tra tiếp theo.`,
    )) return;
    const reason = nextState
      ? ""
      : window.prompt(`Nhập lý do khóa ${account.email}:`);
    if (reason === null) return;
    const trimmedReason = reason.trim();
    if (!nextState && !trimmedReason) {
      setError("Lý do khóa tài khoản là bắt buộc.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const updateResult = await updateUserAccount(account.userId, {
        accountStatus: nextState ? "ACTIVE" : "LOCKED",
        statusReason: nextState ? null : trimmedReason,
      });
      setNotice(updateResult.notificationWarning ??
        (nextState ? `Đã mở khóa tài khoản ${account.email}.` : `Đã khóa tài khoản ${account.email}.`));
      setOffset(0);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Không thể cập nhật trạng thái tài khoản.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSoftDelete(account: UserProfilePublic) {
    if (!window.confirm(
      `Vô hiệu hóa ${account.fullName} (${account.email})? Tài khoản không thể đăng nhập; dữ liệu lịch sử được giữ lại.`,
    )) return;
    const reason = window.prompt(`Nhập lý do vô hiệu hóa ${account.email}:`);
    if (reason === null) return;
    if (!reason.trim()) {
      setError("Lý do vô hiệu hóa là bắt buộc.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const updateResult = await updateUserAccount(account.userId, {
        accountStatus: "DISABLED",
        statusReason: reason.trim(),
      });
      setNotice(updateResult.notificationWarning ??
        `Đã vô hiệu hóa tài khoản ${account.email}; dữ liệu lịch sử được giữ nguyên.`);
      setOffset(0);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Không thể vô hiệu hóa tài khoản.");
    } finally {
      setBusy(false);
    }
  }

  async function handleResendActivation(account: UserProfilePublic) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await resendStaffActivation(account.userId);
      setNotice(result.message);
    } catch (resendError) {
      setError(resendError instanceof Error ? resendError.message : "Không thể gửi lại email kích hoạt.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel data-panel account-management" style={{ display: "grid", gap: 20 }}>
      <div className="panel-heading" style={{ alignItems: "center" }}>
        <div>
          <span className="eyebrow">QUẢN TRỊ HỆ THỐNG</span>
          <h2>Quản lý tài khoản</h2>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span className="status-pill">{total} tài khoản</span>
          <button className="primary-button" type="button" onClick={() => setCreateOpen(true)}>+ Tạo tài khoản</button>
        </div>
      </div>

      <div className="stats-grid account-stats-grid">
        <div className="stat-card"><span>Tổng tài khoản</span><strong>{stats.total}</strong></div>
        <div className="stat-card"><span>Đang hoạt động</span><strong>{stats.active}</strong></div>
        <div className="stat-card"><span>Bị khóa</span><strong>{stats.locked}</strong></div>
        <div className="stat-card"><span>Chưa kích hoạt</span><strong>{stats.pending}</strong></div>
        <div className="stat-card"><span>Đã vô hiệu hóa</span><strong>{stats.disabled}</strong></div>
      </div>

      <div className="account-filter-panel">
        <div className="account-filter-grid">
          <label className="field">Tìm kiếm
            <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Họ tên, email, MSSV hoặc mã tài khoản" />
          </label>
          <label className="field">Vai trò
            <select value={roleInput} onChange={(event) => setRoleInput(event.target.value as UserRole | "")}>
              <option value="">Tất cả</option>
              {managedRoles.map((roleName) => <option value={roleName} key={roleName}>{roleName}</option>)}
            </select>
          </label>
          <label className="field">Trạng thái
            <select value={statusInput} onChange={(event) => setStatusInput(event.target.value as StatusFilter)}>
              <option value="">Tất cả</option>
              <option value="active">Đang hoạt động</option>
              <option value="pending">Chưa kích hoạt</option>
              <option value="inactive">Bị khóa</option>
              <option value="disabled">Đã vô hiệu hóa</option>
            </select>
          </label>
          <label className="field">Trường học
            <select value={institutionInput} onChange={(event) => setInstitutionInput(event.target.value)}>
              <option value="">Tất cả trường</option>
              {institutions.map((institution) => (
                <option key={institution.id} value={institution.id}>{institution.name}</option>
              ))}
            </select>
          </label>
          <label className="field">Tạo từ ngày
            <input type="date" value={createdFromInput} onChange={(event) => setCreatedFromInput(event.target.value)} />
          </label>
          <label className="field">Đến ngày
            <input type="date" value={createdToInput} onChange={(event) => setCreatedToInput(event.target.value)} />
          </label>
        </div>

        <div className="account-filter-footer">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {activeFilterList.length ? activeFilterList.map((item) => (
              <span key={item} className="status-pill" style={{ background: "#edf5f3", color: "#1d3a34" }}>{item}</span>
            )) : <span style={{ color: "#5d6d68" }}>Không có bộ lọc đang áp dụng</span>}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="primary-button" type="button" onClick={() => {
              if (createdFromInput && createdToInput && createdFromInput > createdToInput) {
                setError("Ngày bắt đầu không được sau ngày kết thúc.");
                return;
              }
              setFilters({
                search: searchInput.trim(), role: roleInput, status: statusInput,
                institutionId: institutionInput, createdFrom: createdFromInput, createdTo: createdToInput,
              });
              setOffset(0);
            }}>
              Lọc
            </button>
            <button className="text-button" type="button" onClick={() => {
              setSearchInput(""); setRoleInput(""); setStatusInput(""); setInstitutionInput("");
              setCreatedFromInput(""); setCreatedToInput("");
              setFilters({ search: "", role: "", status: "", institutionId: "", createdFrom: "", createdTo: "" });
              setOffset(0);
            }}>
              Đặt lại
            </button>
          </div>
        </div>
      </div>

      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {notice ? <p className="form-help" role="status">{notice}</p> : null}

      {busy && !accounts.length ? <p>Đang tải dữ liệu...</p> : null}

      {!busy && !displayAccounts.length ? (
        <div className="empty-state"><h3>Không tìm thấy tài khoản</h3><p>Thay đổi bộ lọc hoặc tạo tài khoản mới.</p></div>
      ) : (
        <div style={{ overflowX: "auto", borderRadius: 16, border: "1px solid #e4eee9", background: "#fff" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
            <thead style={{ background: "#f6f8f7" }}>
              <tr>
                <th style={thStyle}>STT</th>
                <th style={thStyle}><button className="account-sort-button" type="button" onClick={() => {
                  setSortField("fullName");
                  setSortDirection((value) => sortField === "fullName" && value === "asc" ? "desc" : "asc");
                }}>Tài khoản {sortField === "fullName" ? (sortDirection === "asc" ? "↑" : "↓") : ""}</button></th>
                <th style={thStyle}>Trường</th>
                <th style={thStyle}>Vai trò</th>
                <th style={thStyle}><button className="account-sort-button" type="button" onClick={() => {
                  setSortField("createdAt");
                  setSortDirection((value) => sortField === "createdAt" && value === "asc" ? "desc" : "asc");
                }}>Ngày tạo {sortField === "createdAt" ? (sortDirection === "asc" ? "↑" : "↓") : ""}</button></th>
                <th style={thStyle}>Trạng thái</th>
                <th style={thStyle}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {displayAccounts.map((account, index) => {
                const status = getStatusMeta(account);
                return (
                  <tr key={account.userId} style={{ borderTop: "1px solid #edf2f1" }}>
                    <td style={tdStyle}>{offset + index + 1}</td>
                    <td style={tdStyle}>
                      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                        <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#e9f7ef", display: "grid", placeItems: "center", fontWeight: 700, color: "#1b5e5b" }}>
                          {getInitials(account.fullName)}
                        </div>
                        <div>
                          <div style={{ fontWeight: 700 }}>{account.fullName}</div>
                          <div style={{ color: "#5b6c68" }}>{account.email}</div>
                        </div>
                      </div>
                    </td>
                    <td style={tdStyle}>{institutions.find((item) => item.id === account.institutionId)?.name ?? "—"}</td>
                    <td style={tdStyle}>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {account.roles.length ? account.roles.map((roleName) => (
                          <span key={`${account.userId}-${roleName}`} style={{ display: "inline-flex", padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700, color: roleColors[roleName].text, background: roleColors[roleName].bg }}>
                            {roleName}
                          </span>
                        )) : <span style={{ color: "#5d6d68" }}>—</span>}
                      </div>
                    </td>
                    <td style={tdStyle}>{formatDate(account.createdAt)}</td>
                    <td style={tdStyle}>
                      <span style={{ display: "inline-flex", padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700, color: statusColors[status.key].text, background: statusColors[status.key].bg }}>
                        {status.label}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button className="text-button" type="button" onClick={() => void openDetail(account)}>Xem</button>
                        <button className="text-button" type="button" onClick={() => openEdit(account)}>Sửa</button>
                        {account.accountStatus !== "DISABLED" ? (
                          <button className="text-button" type="button" onClick={() => void handleToggleLock(account)}>{account.isActive ? "Khóa" : "Mở khóa"}</button>
                        ) : <span className="muted-copy">Đã vô hiệu hóa</span>}
                        {account.accountStatus !== "DISABLED" ? (
                          <button className="text-button danger-text-button" type="button" onClick={() => void handleSoftDelete(account)}>Vô hiệu hóa</button>
                        ) : null}
                        {!account.emailVerified && (account.roles.includes("BTC") || account.roles.includes("REFEREE")) ? (
                          <button className="text-button" type="button" onClick={() => void handleResendActivation(account)}>Gửi lại</button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span>Hiển thị</span>
          <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setOffset(0); }}>
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
          </select>
          <span>mỗi trang</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="text-button" type="button" disabled={offset === 0} onClick={() => setOffset((value) => Math.max(0, value - pageSize))}>Trước</button>
          <span>{currentPage}/{totalPages}</span>
          <button className="text-button" type="button" disabled={offset + pageSize >= total} onClick={() => setOffset((value) => value + pageSize)}>Sau</button>
        </div>
      </div>

      {createOpen ? (
        <div className="account-dialog-backdrop" style={overlayStyle} onClick={() => setCreateOpen(false)}>
          <div style={drawerStyle} onClick={(event) => event.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h3 style={{ margin: 0 }}>Tạo tài khoản</h3>
              <button className="text-button" type="button" onClick={() => setCreateOpen(false)}>Đóng</button>
            </div>
            <form className="form-grid" onSubmit={(event) => void handleCreate(event)}>
              <label className="field">Họ và tên<input value={fullName} onChange={(event) => setFullName(event.target.value)} required /></label>
              <label className="field">Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
              <label className="field">Vai trò<select value={role} onChange={(event) => { setRole(event.target.value as StaffRole); setInstitutionId(""); }}>
                <option value="BTC">Ban tổ chức (BTC)</option>
                <option value="REFEREE">Trọng tài</option>
              </select></label>
              {role === "BTC" ? <InstitutionSelector label="Trường phụ trách" value={institutionId} onChange={setInstitutionId} required /> : null}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <button className="text-button" type="button" onClick={() => setCreateOpen(false)}>Hủy</button>
                <button className="primary-button" type="submit" disabled={busy}>{busy ? "Đang xử lý..." : "Tạo tài khoản"}</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {editingAccountId && saveDraft ? (
        <div className="account-dialog-backdrop" style={overlayStyle} onClick={() => { setEditingAccountId(null); setSaveDraft(null); }}>
          <div style={drawerStyle} onClick={(event) => event.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h3 style={{ margin: 0 }}>Chỉnh sửa tài khoản</h3>
              <button className="text-button" type="button" onClick={() => { setEditingAccountId(null); setSaveDraft(null); }}>Đóng</button>
            </div>
            <form className="form-grid" onSubmit={(event) => void saveEditedAccount(event)}>
              <label className="field">Họ tên<input value={saveDraft.fullName} onChange={(event) => setSaveDraft((current) => current ? { ...current, fullName: event.target.value } : current)} required /></label>
              <label className="field">Số điện thoại<input value={saveDraft.phone} onChange={(event) => setSaveDraft((current) => current ? { ...current, phone: event.target.value } : current)} /></label>
              <label className="field">MSSV / Mã định danh<input value={saveDraft.studentId} onChange={(event) => setSaveDraft((current) => current ? { ...current, studentId: event.target.value } : current)} /></label>
              <InstitutionSelector
                label="Trường học / phạm vi BTC"
                value={saveDraft.institutionId}
                onChange={(value) => setSaveDraft((current) => current ? { ...current, institutionId: value } : current)}
                required={saveDraft.roles.includes("BTC")}
              />
              <div className="field">
                <span style={{ display: "block", marginBottom: 8, fontWeight: 600 }}>Vai trò</span>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
                  {managedRoles.map((roleName) => (
                    <label key={roleName} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input type="checkbox" checked={saveDraft.roles.includes(roleName)} onChange={(event) => setSaveDraft((current) => {
                        if (!current) return current;
                        const nextRoles = event.target.checked ? [...current.roles, roleName] : current.roles.filter((candidate) => candidate !== roleName);
                        return { ...current, roles: nextRoles };
                      })} />
                      {roleName}
                    </label>
                  ))}
                </div>
              </div>
              <label className="field">Trạng thái tài khoản
                <select value={saveDraft.accountStatus} onChange={(event) => setSaveDraft((current) => current ? { ...current, accountStatus: event.target.value as "ACTIVE" | "LOCKED" | "DISABLED" } : current)}>
                  <option value="ACTIVE">Đang hoạt động</option>
                  <option value="LOCKED">Bị khóa</option>
                  <option value="DISABLED">Đã vô hiệu hóa</option>
                </select>
              </label>
              {saveDraft.accountStatus !== "ACTIVE" ? (
                <label className="field field-wide">Lý do khóa / vô hiệu hóa
                  <textarea value={saveDraft.statusReason} maxLength={500} required onChange={(event) => setSaveDraft((current) => current ? { ...current, statusReason: event.target.value } : current)} />
                </label>
              ) : null}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <button className="text-button" type="button" onClick={() => { setEditingAccountId(null); setSaveDraft(null); }}>Hủy</button>
                <button className="primary-button" type="submit" disabled={busy}>{busy ? "Đang lưu..." : "Lưu thay đổi"}</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {detailOpen && selectedAccount ? (
        <div className="account-dialog-backdrop" style={overlayStyle} onClick={() => { setDetailOpen(false); setSelectedAccount(null); setSelectedHistory([]); }}>
          <div style={{ ...drawerStyle, width: "min(720px, calc(100vw - 28px))" }} onClick={(event) => event.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 14 }}>
              <div>
                <div className="eyebrow">THÔNG TIN CHI TIẾT</div>
                <h3 style={{ margin: 0 }}>{selectedAccount.fullName}</h3>
              </div>
              <button className="text-button" type="button" onClick={() => { setDetailOpen(false); setSelectedAccount(null); setSelectedHistory([]); }}>Đóng</button>
            </div>

            {detailLoading ? <p>Đang tải thông tin...</p> : (
              <div style={{ display: "grid", gap: 18 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
                  <div style={infoCardStyle}><strong>Email</strong><span>{selectedAccount.email}</span></div>
                  <div style={infoCardStyle}><strong>Trạng thái xác minh</strong><span>{selectedAccount.emailVerified ? "Đã xác minh" : "Chưa xác minh"}</span></div>
                  <div style={infoCardStyle}><strong>Số điện thoại</strong><span>{selectedAccount.profileData?.phone ?? "—"}</span></div>
                  <div style={infoCardStyle}><strong>MSSV / định danh</strong><span>{selectedAccount.studentId ?? "—"}</span></div>
                  <div style={infoCardStyle}><strong>Trường</strong><span>{institutions.find((item) => item.id === selectedAccount.institutionId)?.name ?? "—"}</span></div>
                  <div style={infoCardStyle}><strong>Trạng thái</strong><span>{getStatusMeta(selectedAccount).label}</span></div>
                  <div style={infoCardStyle}><strong>Vai trò</strong><span>{selectedAccount.roles.join(", ") || "—"}</span></div>
                  <div style={infoCardStyle}><strong>Ngày tạo</strong><span>{formatDate(selectedAccount.createdAt)}</span></div>
                  <div style={infoCardStyle}><strong>Cập nhật gần nhất</strong><span>{formatDate(selectedAccount.updatedAt)}</span></div>
                </div>

                <div>
                  <h4 style={{ margin: "0 0 10px" }}>Lịch sử thay đổi</h4>
                  {selectedHistory.length ? (
                    <div style={{ display: "grid", gap: 8 }}>
                      {selectedHistory.map((entry) => (
                        <div key={entry.id} style={{ border: "1px solid #e2e8e8", borderRadius: 10, background: "#f8faf9", padding: 10 }}>
                          <div style={{ fontWeight: 600 }}>{new Date(entry.changedAt).toLocaleString("vi-VN")}</div>
                          <pre style={{ margin: "8px 0 0", whiteSpace: "pre-wrap", fontFamily: "inherit" }}>{JSON.stringify(entry.changes, null, 2)}</pre>
                        </div>
                      ))}
                    </div>
                  ) : <p style={{ margin: 0, color: "#5f6d68" }}>Chưa có lịch sử thay đổi.</p>}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(20, 26, 25, 0.46)",
  display: "grid",
  placeItems: "center",
  zIndex: 1200,
};

const drawerStyle: CSSProperties = {
  width: "min(640px, calc(100vw - 28px))",
  maxHeight: "86vh",
  overflowY: "auto",
  background: "#fff",
  borderRadius: 18,
  padding: 20,
  boxShadow: "0 20px 60px rgba(19, 35, 31, 0.18)",
};

const infoCardStyle: CSSProperties = {
  border: "1px solid #e4efe9",
  borderRadius: 12,
  background: "#f8faf9",
  padding: 10,
  display: "grid",
  gap: 4,
};

const thStyle: CSSProperties = {
  textAlign: "left",
  padding: "12px 14px",
  fontSize: 12,
  color: "#42514d",
  textTransform: "uppercase",
};

const tdStyle: CSSProperties = {
  padding: "14px",
  verticalAlign: "top",
  color: "#1f2a28",
};
