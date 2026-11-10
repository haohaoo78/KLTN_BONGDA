import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  getClubRequests,
  reviewClubRequest,
  type ClubRequest,
} from "../api/competition";
import {
  listRoleApplications,
  reviewRoleApplication,
  type RoleApplication,
} from "../api/users";
import { getInstitutions, type Institution } from "../api/institutions";

type RequestType = "PLAYER" | "TEAM_CAPTAIN" | "CLUB";
type RequestStatus = "ALL" | "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN";
type ReviewItem =
  | { kind: "role"; request: RoleApplication }
  | { kind: "club"; request: ClubRequest };

type Props = {
  onNavigateToTeams: () => void;
};

const typeLabels: Record<RequestType, string> = {
  PLAYER: "Đăng ký vai trò PLAYER",
  TEAM_CAPTAIN: "Đăng ký vai trò TEAM_CAPTAIN",
  CLUB: "Thành lập đội bóng / CLB",
};

const statusLabels: Record<Exclude<RequestStatus, "ALL">, string> = {
  PENDING: "Chờ duyệt",
  APPROVED: "Đã duyệt",
  REJECTED: "Đã từ chối",
  WITHDRAWN: "Đã hủy",
};

const pageSize = 10;

export function ApprovalCenterPanel({ onNavigateToTeams }: Props) {
  const [requestType, setRequestType] = useState<RequestType>("PLAYER");
  const [status, setStatus] = useState<RequestStatus>("PENDING");
  const [requestTypeDraft, setRequestTypeDraft] = useState<RequestType>("PLAYER");
  const [statusDraft, setStatusDraft] = useState<RequestStatus>("PENDING");
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [institutionIdDraft, setInstitutionIdDraft] = useState("");
  const [institutionId, setInstitutionId] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [fromDraft, setFromDraft] = useState("");
  const [toDraft, setToDraft] = useState("");
  const [search, setSearch] = useState("");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [page, setPage] = useState(0);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (requestType === "CLUB") {
        const result = await getClubRequests({
          status: status === "ALL" || status === "WITHDRAWN" ? undefined : status,
          search: search || undefined,
          createdFrom: createdFrom || undefined,
          createdTo: createdTo || undefined,
          limit: pageSize,
          offset: page * pageSize,
        });
        setItems(result.requests.map((request) => ({ kind: "club", request })));
        setTotal(result.pagination.total);
      } else {
        const result = await listRoleApplications({
          status: status === "ALL" ? undefined : status,
          requestedRole: requestType,
          search: search || undefined,
          institutionId: institutionId || undefined,
          createdFrom: createdFrom || undefined,
          createdTo: createdTo || undefined,
          limit: pageSize,
          offset: page * pageSize,
        });
        setItems(result.applications.map((request) => ({ kind: "role", request })));
        setTotal(result.pagination.total);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Không tải được danh sách yêu cầu.");
    } finally {
      setLoading(false);
    }
  }, [createdFrom, createdTo, page, requestType, search, status]);

  useEffect(() => {
    void load();
  }, [load]);

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

  async function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (fromDraft && toDraft && fromDraft > toDraft) {
      setError("Từ ngày không được sau Đến ngày.");
      return;
    }
    setPage(0);
    setSearch(searchDraft.trim());
    setCreatedFrom(fromDraft);
    setCreatedTo(toDraft);
    setRequestType(requestTypeDraft);
    setStatus(statusDraft);
    setInstitutionId(requestTypeDraft === "CLUB" ? "" : institutionIdDraft);
    if (requestTypeDraft === "CLUB") setInstitutionIdDraft("");
    setSelectedId(null);
  }

  function resetFilters() {
    setRequestTypeDraft("PLAYER");
    setStatusDraft("PENDING");
    setSearchDraft("");
    setFromDraft("");
    setToDraft("");
    setInstitutionIdDraft("");
    setRequestType("PLAYER");
    setStatus("PENDING");
    setSearch("");
    setCreatedFrom("");
    setCreatedTo("");
    setInstitutionId("");
    setPage(0);
    setSelectedId(null);
  }

  async function decide(item: ReviewItem, decision: "APPROVED" | "REJECTED") {
    const note = decisionNotes[item.request.id]?.trim() ?? "";
    if (decision === "REJECTED" && !note) {
      setError("Cần nhập lý do khi từ chối.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      let notificationWarning: string | undefined;
      if (item.kind === "role") {
        const result = await reviewRoleApplication({
          applicationId: item.request.id,
          decision,
          decisionNote: note || undefined,
        });
        notificationWarning = result.notificationWarning;
      } else {
        await reviewClubRequest({
          requestId: item.request.id,
          decision,
          decisionNote: note || undefined,
        });
      }
      setNotice(notificationWarning ??
        (decision === "APPROVED" ? "Đã duyệt yêu cầu." : "Đã từ chối yêu cầu."));
      await load();
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "Không xử lý được yêu cầu.");
    } finally {
      setBusy(false);
    }
  }

  const selected = items.find((item) => item.request.id === selectedId) ?? null;
  const pageCount = Math.ceil(total / pageSize);

  return (
    <div className="institution-manager approval-management">
      <section className="panel data-panel">
        <div className="panel-heading panel-heading-wrap">
          <div><span className="eyebrow">ADMIN / BTC · THEO PHẠM VI ĐƯỢC GIAO</span><h2>Danh sách yêu cầu xét duyệt</h2></div>
          <span className="status-pill">{total} yêu cầu</span>
        </div>
        <p>Đăng ký PLAYER, TEAM_CAPTAIN và thành lập CLB là các quy trình riêng. Duyệt TEAM_CAPTAIN không tự duyệt CLB hoặc tự tạo đội bóng.</p>
        <form className="form-grid" onSubmit={(event) => void applyFilters(event)}>
          <label className="field">Loại yêu cầu
            <select value={requestTypeDraft} onChange={(event) => {
              const nextType = event.target.value as RequestType;
              setRequestTypeDraft(nextType);
              if (nextType === "CLUB" && statusDraft === "WITHDRAWN") setStatusDraft("ALL");
            }}>
              <option value="PLAYER">{typeLabels.PLAYER}</option>
              <option value="TEAM_CAPTAIN">{typeLabels.TEAM_CAPTAIN}</option>
              <option value="CLUB">{typeLabels.CLUB}</option>
            </select>
          </label>
          <label className="field">Trạng thái
            <select value={statusDraft} onChange={(event) => setStatusDraft(event.target.value as RequestStatus)}>
              <option value="PENDING">Chờ duyệt</option>
              <option value="APPROVED">Đã duyệt</option>
              <option value="REJECTED">Đã từ chối</option>
              {requestTypeDraft !== "CLUB" ? <option value="WITHDRAWN">Đã hủy</option> : null}
              <option value="ALL">Tất cả</option>
            </select>
          </label>
          <label className="field">Tìm kiếm
            <input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} maxLength={100} placeholder="Họ tên, email, tên CLB…" />
          </label>
          <label className="field">Từ ngày
            <input type="date" value={fromDraft} onChange={(event) => setFromDraft(event.target.value)} />
          </label>
          <label className="field">Đến ngày
            <input type="date" value={toDraft} onChange={(event) => setToDraft(event.target.value)} />
          </label>
          {requestTypeDraft !== "CLUB" ? (
            <label className="field">Trường học
              <select value={institutionIdDraft} onChange={(event) => setInstitutionIdDraft(event.target.value)}>
                <option value="">Tất cả trường trong phạm vi</option>
                {institutions.map((institution) => (
                  <option value={institution.id} key={institution.id}>{institution.name}</option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="field form-actions">
            <button className="primary-button">Áp dụng bộ lọc</button>
            <button className="text-button" type="button" onClick={resetFilters}>Đặt lại</button>
          </div>
        </form>

        <div className="active-filter-list">
          <strong>Bộ lọc đang áp dụng:</strong>
          <span>{typeLabels[requestType]}</span>
          <span>{status === "ALL" ? "Mọi trạng thái" : statusLabels[status]}</span>
          {search ? <span>Từ khóa: {search}</span> : null}
          {institutionId ? (
            <span>Trường: {institutions.find((item) => item.id === institutionId)?.name ?? institutionId}</span>
          ) : null}
          {createdFrom || createdTo ? <span>Ngày gửi: {createdFrom || "đầu"} – {createdTo || "nay"}</span> : null}
        </div>

        {(error || notice) ? (
          <div className={`message-banner ${error ? "message-error" : "message-success"}`} role={error ? "alert" : "status"}>{error ?? notice}</div>
        ) : null}
        {loading ? <div className="loading-state">Đang tải yêu cầu…</div> : items.length ? (
          <>
            <div style={{ overflowX: "auto", borderRadius: 14, border: "1px solid #e6efeb", background: "#fff" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
                <thead style={{ background: "#f3f7f6" }}>
                  <tr>
                    <th style={{ textAlign: "left", padding: "14px 12px", fontSize: 12, color: "#49615f" }}>Loại</th>
                    <th style={{ textAlign: "left", padding: "14px 12px", fontSize: 12, color: "#49615f" }}>Người gửi</th>
                    <th style={{ textAlign: "left", padding: "14px 12px", fontSize: 12, color: "#49615f" }}>Email</th>
                    <th style={{ textAlign: "left", padding: "14px 12px", fontSize: 12, color: "#49615f" }}>Đơn vị</th>
                    <th style={{ textAlign: "left", padding: "14px 12px", fontSize: 12, color: "#49615f" }}>Ngày gửi</th>
                    <th style={{ textAlign: "left", padding: "14px 12px", fontSize: 12, color: "#49615f" }}>Trạng thái</th>
                    <th style={{ textAlign: "left", padding: "14px 12px", fontSize: 12, color: "#49615f" }}>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const request = item.request;
                    const fullName = item.kind === "role" ? item.request.fullName : item.request.captainName;
                    const email = item.kind === "role" ? item.request.email : item.request.contactEmail;
                    const type = item.kind === "role" ? typeLabels[requestType] : typeLabels.CLUB;
                    const statusLabel = statusLabels[request.status];
                    return (
                      <tr key={`${item.kind}-${request.id}`} style={{ borderTop: "1px solid #edf1ef" }}>
                        <td style={{ padding: "14px 12px", verticalAlign: "top" }}><span className="eyebrow">{type}</span></td>
                        <td style={{ padding: "14px 12px", verticalAlign: "top", fontWeight: 600 }}>{fullName}</td>
                        <td style={{ padding: "14px 12px", verticalAlign: "top", color: "#4c5d59" }}>{email}</td>
                        <td style={{ padding: "14px 12px", verticalAlign: "top" }}>
                          {item.kind === "club"
                            ? item.request.name
                            : institutions.find((institution) => institution.id === item.request.institutionId)?.name ?? item.request.institutionId}
                        </td>
                        <td style={{ padding: "14px 12px", verticalAlign: "top", color: "#4c5d59" }}>{new Date(request.createdAt).toLocaleString("vi-VN")}</td>
                        <td style={{ padding: "14px 12px", verticalAlign: "top" }}>
                          <span className="status-pill" style={{ background: request.status === "PENDING" ? "#fff5db" : request.status === "APPROVED" ? "#dcfce7" : "#fee2e2", color: request.status === "PENDING" ? "#92400e" : request.status === "APPROVED" ? "#14532d" : "#991b1b" }}>{statusLabel}</span>
                        </td>
                        <td style={{ padding: "14px 12px", verticalAlign: "top" }}>
                          <div className="button-row" style={{ justifyContent: "flex-start" }}>
                            <button className="text-button" type="button" onClick={() => setSelectedId(selectedId === request.id ? null : request.id)}>
                              {selectedId === request.id ? "Đóng" : "Xem"}
                            </button>
                            {request.status === "PENDING" ? (
                              <>
                                <button className="primary-button" type="button" disabled={busy} onClick={() => void decide(item, "APPROVED")}>Duyệt</button>
                                <button className="text-button" type="button" disabled={busy} onClick={() => void decide(item, "REJECTED")}>Từ chối</button>
                              </>
                            ) : null}
                          </div>
                          {request.status === "PENDING" ? (
                            <label className="field" style={{ marginTop: 10 }}>
                              Lý do xét duyệt
                              <textarea value={decisionNotes[request.id] ?? ""} onChange={(event) => setDecisionNotes((current) => ({ ...current, [request.id]: event.target.value }))} maxLength={2000} rows={2} placeholder="Bắt buộc nếu từ chối" />
                            </label>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="section-toolbar">
              <span className="muted-copy">Trang {page + 1} / {Math.max(pageCount, 1)}</span>
              <div className="form-actions">
                <button className="text-button" type="button" disabled={page === 0 || loading} onClick={() => setPage((current) => current - 1)}>Trước</button>
                <button className="text-button" type="button" disabled={page + 1 >= pageCount || loading} onClick={() => setPage((current) => current + 1)}>Sau</button>
              </div>
            </div>
          </>
        ) : <div className="empty-state"><h3>Không có yêu cầu phù hợp</h3></div>}

        {selected ? (
          <section className="panel data-panel">
            <div className="panel-heading"><div><span className="eyebrow">CHI TIẾT VÀ LỊCH SỬ XÉT DUYỆT</span><h3>{selected.kind === "role" ? selected.request.fullName : selected.request.name}</h3></div></div>
            <p>Ngày gửi: {new Date(selected.request.createdAt).toLocaleString("vi-VN")}</p>
            <p>Trạng thái: {statusLabels[selected.request.status]}</p>
            <p>Người xét duyệt: {selected.request.reviewedBy ?? "Chưa có"}</p>
            <p>Thời điểm xét duyệt: {selected.request.reviewedAt ? new Date(selected.request.reviewedAt).toLocaleString("vi-VN") : "Chưa có"}</p>
            <p>Lý do / ghi chú: {selected.request.decisionNote || "Không có"}</p>
            <pre className="request-detail">
              {JSON.stringify(
                selected.kind === "role"
                  ? selected.request.applicationData
                  : {
                      captainName: selected.request.captainName,
                      contactEmail: selected.request.contactEmail,
                      contactPhone: selected.request.contactPhone,
                      unitName: selected.request.unitName,
                      description: selected.request.description,
                      initialMembers: selected.request.initialMembers,
                    },
                null,
                2,
              )}
            </pre>
          </section>
        ) : null}
        <div className="panel-heading">
          <p>Yêu cầu gia nhập/rời đội do đại diện đội xử lý trong Quản lý đội bóng; BTC chỉ can thiệp yêu cầu rời đội theo phạm vi và điều kiện quá hạn.</p>
          <button className="text-button" type="button" onClick={onNavigateToTeams}>Mở Quản lý đội bóng ↗</button>
        </div>
      </section>
    </div>
  );
}
