import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { UserRole } from "@sfl/shared";
import {
  getClubRequests,
  getMyClubRequests,
  reviewClubRequest,
  submitClubRequest,
  type ClubRequest,
} from "../api/competition";

type Props = {
  roles: UserRole[];
  institutionId: string | null;
  institutionName: string | null;
  institutions: Array<{ id: string; name: string }>;
  email: string;
  onNotice: (message: string) => void;
};

const statusLabels = {
  PENDING: "Chờ duyệt",
  APPROVED: "Đã duyệt",
  REJECTED: "Đã từ chối",
} as const;

export function ClubRequestsPanel({
  roles,
  institutionId,
  institutionName,
  institutions,
  email,
  onNotice,
}: Props) {
  const reviewer = roles.includes("BTC");
  const applicant = roles.includes("TEAM_CAPTAIN");
  const [requests, setRequests] = useState<ClubRequest[]>([]);
  const [status, setStatus] = useState<ClubRequest["status"]>("PENDING");
  const [search, setSearch] = useState("");
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({});
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [unitName, setUnitName] = useState("");
  const [description, setDescription] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [contactEmail, setContactEmail] = useState(email);
  const [contactPhone, setContactPhone] = useState("");
  const [initialMembersText, setInitialMembersText] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!reviewer && !applicant) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = reviewer
        ? await getClubRequests(status)
        : await getMyClubRequests();
      setRequests(result.requests);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Không tải được yêu cầu CLB.");
    } finally {
      setLoading(false);
    }
  }, [applicant, reviewer, status]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setContactEmail(email);
  }, [email]);

  const visibleRequests = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("vi");
    if (!term) return requests;
    return requests.filter((request) =>
      [request.name, request.shortName, request.captainName, request.contactEmail]
        .some((value) => value?.toLocaleLowerCase("vi").includes(term)),
    );
  }, [requests, search]);

  if (!reviewer && !applicant) return null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const initialMembers = initialMembersText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [fullName = "", studentId = "", position = ""] = line.split(",").map((part) => part.trim());
        return { fullName, studentId, position };
      });
    setSubmitting(true);
    setError(null);
    try {
      await submitClubRequest({
        name: name.trim(),
        shortName: shortName.trim() || undefined,
        unitName: unitName.trim() || undefined,
        description: description.trim() || undefined,
        logoUrl: logoUrl.trim() || undefined,
        contactEmail: contactEmail.trim(),
        contactPhone: contactPhone.trim(),
        initialMembers,
      });
      setName("");
      setShortName("");
      setUnitName("");
      setDescription("");
      setLogoUrl("");
      setContactPhone("");
      setInitialMembersText("");
      onNotice("Đã gửi yêu cầu tạo CLB đến BTC trường để xét duyệt.");
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Không gửi được yêu cầu tạo CLB.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReview(request: ClubRequest, decision: "APPROVED" | "REJECTED") {
    const decisionNote = decisionNotes[request.id]?.trim() ?? "";
    if (decision === "REJECTED" && !decisionNote) {
      setError("Cần ghi lý do khi từ chối yêu cầu.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await reviewClubRequest({
        requestId: request.id,
        decision,
        decisionNote: decisionNote || undefined,
      });
      onNotice(decision === "APPROVED" ? "Đã duyệt yêu cầu và tạo CLB." : "Đã từ chối yêu cầu tạo CLB.");
      await load();
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "Không xử lý được yêu cầu.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="institution-manager">
      {applicant ? (
        <form className="create-panel" onSubmit={(event) => void handleSubmit(event)}>
          <div className="panel-title-row">
            <div>
              <span className="eyebrow">ĐĂNG KÝ CÂU LẠC BỘ</span>
              <h2>Gửi yêu cầu tạo CLB</h2>
            </div>
          </div>
          <p>Trường trực thuộc: <strong>{institutionName ?? institutionId ?? "Chưa có trường được xác minh"}</strong></p>
          {!institutionId ? <p className="form-error">Tài khoản cần được BTC xác minh trường trước khi gửi yêu cầu.</p> : null}
          <div className="form-grid">
            <label className="field">Tên CLB
              <input value={name} onChange={(event) => setName(event.target.value)} maxLength={255} required />
            </label>
            <label className="field">Tên viết tắt
              <input value={shortName} onChange={(event) => setShortName(event.target.value)} maxLength={100} />
            </label>
            <label className="field">Khoa / viện
              <input value={unitName} onChange={(event) => setUnitName(event.target.value)} maxLength={255} />
            </label>
            <label className="field">Logo (URL, không bắt buộc)
              <input type="url" value={logoUrl} onChange={(event) => setLogoUrl(event.target.value)} maxLength={500} />
            </label>
            <label className="field">Email liên hệ
              <input type="email" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} maxLength={255} required />
            </label>
            <label className="field">Số điện thoại liên hệ
              <input type="tel" value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} maxLength={30} required />
            </label>
            <label className="field field-wide">Giới thiệu CLB
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={5000} rows={4} />
            </label>
            <label className="field field-wide">Thành viên ban đầu (mỗi dòng: Họ tên, MSSV, vị trí)
              <textarea value={initialMembersText} onChange={(event) => setInitialMembersText(event.target.value)} maxLength={5000} rows={4} placeholder="Nguyễn Văn A, 123456, MID" />
              <small>Danh sách chỉ được lưu để BTC xét duyệt; thành viên chưa được tự động thêm vào đội.</small>
            </label>
          </div>
          <button className="primary-button" disabled={submitting || !institutionId}>
            {submitting ? "Đang gửi…" : "Gửi BTC xét duyệt"} <span>↗</span>
          </button>
        </form>
      ) : null}

      {error ? <div className="message-banner message-error" role="alert">{error}</div> : null}
      <section className="panel data-panel">
        <div className="panel-heading panel-heading-wrap">
          <div>
            <span className="eyebrow">{reviewer ? "XÉT DUYỆT THEO TRƯỜNG" : "THEO DÕI HỒ SƠ"}</span>
            <h2>{reviewer ? "Yêu cầu tạo CLB" : "Yêu cầu CLB của tôi"}</h2>
            {reviewer && !roles.includes("ADMIN") ? <p>Phạm vi: {institutionName ?? institutionId ?? "Chưa được phân công"}</p> : null}
          </div>
          <div className="section-toolbar">
            <label className="field">Tìm kiếm
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tên CLB hoặc đội trưởng" />
            </label>
            {reviewer ? (
              <label className="field">Trạng thái
                <select value={status} onChange={(event) => setStatus(event.target.value as ClubRequest["status"])}>
                  <option value="PENDING">Chờ duyệt</option>
                  <option value="APPROVED">Đã duyệt</option>
                  <option value="REJECTED">Đã từ chối</option>
                </select>
              </label>
            ) : null}
            <button className="text-button" type="button" onClick={() => void load()}>Tải lại · {requests.length}</button>
          </div>
        </div>
        {loading ? <div className="loading-state">Đang tải dữ liệu…</div> : visibleRequests.length ? (
          <div className="institution-list">
            {visibleRequests.map((request) => {
              const waitingHours = Math.max(0, Math.floor((Date.now() - new Date(request.createdAt).getTime()) / 3_600_000));
              return (
                <article className="institution-row" key={request.id}>
                  <div>
                    <span className="eyebrow">{statusLabels[request.status]} · {new Date(request.createdAt).toLocaleString("vi-VN")}</span>
                    <h3>{request.name}{request.shortName ? ` (${request.shortName})` : ""}</h3>
                    <p>Đội trưởng: {request.captainName} · {request.contactEmail} · {request.contactPhone}</p>
                    <p>Trường: {institutions.find((school) => school.id === request.institutionId)?.name ?? (institutionId === request.institutionId ? institutionName : null) ?? request.institutionId}{request.unitName ? ` · ${request.unitName}` : ""}</p>
                    {request.status === "PENDING" ? <p>{waitingHours >= 24 ? "Cảnh báo: " : ""}Đã chờ {waitingHours} giờ</p> : null}
                    {request.description ? <p>{request.description}</p> : null}
                    {request.decisionNote ? <p>Phản hồi: {request.decisionNote}</p> : null}
                    {request.approvedTeamId ? <p>Mã CLB đã tạo: {request.approvedTeamId}</p> : null}
                    <details>
                      <summary>Hồ sơ và thành viên ban đầu ({request.initialMembers.length})</summary>
                      <pre>{JSON.stringify(request.initialMembers, null, 2)}</pre>
                    </details>
                  </div>
                  {reviewer && request.status === "PENDING" ? (
                    <div className="role-application-actions">
                      <label className="field">Ghi chú / lý do
                        <input value={decisionNotes[request.id] ?? ""} onChange={(event) => setDecisionNotes((current) => ({ ...current, [request.id]: event.target.value }))} maxLength={2000} placeholder="Bắt buộc nếu từ chối" />
                      </label>
                      <div className="button-row">
                        <button className="primary-button" type="button" disabled={submitting} onClick={() => void handleReview(request, "APPROVED")}>Duyệt</button>
                        <button className="text-button" type="button" disabled={submitting} onClick={() => void handleReview(request, "REJECTED")}>Từ chối</button>
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : <div className="empty-state"><h3>Không có yêu cầu</h3><p>Chưa có hồ sơ phù hợp với bộ lọc hiện tại.</p></div>}
      </section>
    </div>
  );
}
