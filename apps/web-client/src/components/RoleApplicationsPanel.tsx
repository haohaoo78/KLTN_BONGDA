import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { UserRole } from "@sfl/shared";
import {
  getMyRoleApplications,
  listRoleApplications,
  reviewRoleApplication,
  submitRoleApplication,
  updateMyRoleApplication,
  withdrawMyRoleApplication,
  type RoleApplication,
} from "../api/users";
import { getInstitutions } from "../api/institutions";
import { InstitutionSelector } from "./InstitutionSelector";
import { Modal } from "./Modal";

type Props = {
  roles: UserRole[];
  reviewer: boolean;
  email: string;
  fullName: string;
  onNotice: (message: string) => void;
};

const roleLabels = {
  TEAM_CAPTAIN: "Đội trưởng / Đại diện đội",
  PLAYER: "Cầu thủ",
} as const;

const statusLabels = {
  PENDING: "Chờ xét duyệt",
  APPROVED: "Đã duyệt",
  REJECTED: "Đã từ chối",
  WITHDRAWN: "Đã hủy",
} as const;

const emptyProfile = {
  birthDate: "",
  gender: "",
  phone: "",
  faculty: "",
  major: "",
  studentId: "",
  representativeType: "",
  representativeOther: "",
  staffId: "",
  teamPosition: "",
  academicYear: "",
  evidenceUrl: "",
  playingPosition: "",
  dominantFoot: "",
  heightCm: "",
  weightKg: "",
  reason: "",
  commitment: "",
};

const applicationFieldLabels: Record<string, string> = {
  birthDate: "Ngày sinh",
  gender: "Giới tính",
  phone: "Số điện thoại",
  faculty: "Khoa / phòng ban",
  major: "Ngành học",
  studentId: "Mã số sinh viên",
  representativeType: "Đối tượng đại diện",
  representativeOther: "Mô tả đối tượng đại diện",
  staffId: "Mã giảng viên / nhân viên",
  teamPosition: "Chức vụ trong đội",
  academicYear: "Khóa / năm học",
  evidenceUrl: "Minh chứng",
  playingPosition: "Vị trí thi đấu",
  dominantFoot: "Chân thuận",
  heightCm: "Chiều cao (cm)",
  weightKg: "Cân nặng (kg)",
  reason: "Lý do đăng ký",
  commitment: "Cam kết",
};

function applicationProfile(data: Record<string, unknown>) {
  return Object.fromEntries(
    Object.keys(emptyProfile).map((key) => [
      key,
      typeof data[key] === "string" ? data[key] as string : "",
    ]),
  ) as typeof emptyProfile;
}

export function RoleApplicationsPanel({ roles, reviewer, email, fullName, onNotice }: Props) {
  const [applications, setApplications] = useState<RoleApplication[]>([]);
  const [requestedRole, setRequestedRole] = useState<"TEAM_CAPTAIN" | "PLAYER">("TEAM_CAPTAIN");
  const [message, setMessage] = useState("");
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({});
  const [institutionNames, setInstitutionNames] = useState<Record<string, string>>({});
  const [institutionId, setInstitutionId] = useState("");
  const [profile, setProfile] = useState(emptyProfile);
  const [editingApplicationId, setEditingApplicationId] = useState<string | null>(null);
  const [requestFormOpen, setRequestFormOpen] = useState(false);
  const [detailApplication, setDetailApplication] = useState<RoleApplication | null>(null);
  const [withdrawApplication, setWithdrawApplication] = useState<RoleApplication | null>(null);
  const [roleFilter, setRoleFilter] = useState<"ALL" | "TEAM_CAPTAIN" | "PLAYER">("ALL");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = reviewer
        ? await listRoleApplications({ status: "PENDING" })
        : await getMyRoleApplications();
      setApplications(result.applications);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được yêu cầu vai trò.");
    } finally {
      setLoading(false);
    }
  }, [reviewer]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let active = true;
    getInstitutions()
      .then(({ institutions: result }) => {
        if (active) {
          setInstitutionNames(Object.fromEntries(result.map((institution) => [institution.id, institution.name])));
        }
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Không tải được danh mục trường.");
      });
    return () => {
      active = false;
    };
  }, []);

  const availableRoles = useMemo(
    () => (["TEAM_CAPTAIN", "PLAYER"] as const).filter((role) => !roles.includes(role)),
    [roles],
  );
  const pendingRoles = new Set(
    applications.filter((application) => application.status === "PENDING")
      .map((application) => application.requestedRole),
  );
  const requestableRoles = availableRoles.filter((role) => !pendingRoles.has(role));
  const visibleApplications = applications.filter((application) => roleFilter === "ALL" || application.requestedRole === roleFilter);

  useEffect(() => {
    if (availableRoles.length && !availableRoles.includes(requestedRole)) {
      setRequestedRole(availableRoles[0]);
    }
  }, [availableRoles, requestedRole]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (!institutionId) {
        setError("Vui lòng chọn trường từ danh mục.");
        return;
      }
      const applicationData: Record<string, unknown> = {
        birthDate: profile.birthDate,
        gender: profile.gender,
        phone: profile.phone,
        faculty: profile.faculty,
        major: profile.major,
        studentId: profile.studentId,
        representativeType: profile.representativeType,
        representativeOther: profile.representativeOther,
        staffId: profile.staffId,
        teamPosition: profile.teamPosition,
        academicYear: profile.academicYear,
        evidenceUrl: profile.evidenceUrl,
        playingPosition: profile.playingPosition,
        dominantFoot: profile.dominantFoot,
        heightCm: profile.heightCm,
        weightKg: profile.weightKg,
        reason: profile.reason,
        commitment: profile.commitment,
      };
      if (editingApplicationId) {
        await updateMyRoleApplication({
          applicationId: editingApplicationId,
          institutionId,
          applicationData,
          message: message.trim(),
        });
        onNotice("Đã cập nhật hồ sơ yêu cầu.");
      } else {
        await submitRoleApplication({
          requestedRole,
          institutionId,
          applicationData,
          message: message.trim(),
        });
        onNotice("Đã gửi yêu cầu. Ban tổ chức sẽ xem xét và phản hồi trên tài khoản của bạn.");
      }
      setEditingApplicationId(null);
      setRequestFormOpen(false);
      setMessage("");
      setInstitutionId("");
      setProfile(emptyProfile);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không gửi được yêu cầu.");
    } finally {
      setSubmitting(false);
    }
  }

  function startEditing(application: RoleApplication) {
    setEditingApplicationId(application.id);
    setRequestedRole(application.requestedRole);
    setInstitutionId(application.institutionId);
    setProfile(applicationProfile(application.applicationData));
    setMessage(application.message);
    setError(null);
    setRequestFormOpen(true);
  }

  function cancelEditing() {
    setEditingApplicationId(null);
    setInstitutionId("");
    setMessage("");
    setProfile(emptyProfile);
    setRequestFormOpen(false);
  }

  async function handleWithdraw(application: RoleApplication) {
    setSubmitting(true);
    setError(null);
    try {
      await withdrawMyRoleApplication(application.id);
      if (editingApplicationId === application.id) cancelEditing();
      setWithdrawApplication(null);
      onNotice("Đã hủy yêu cầu. Lịch sử yêu cầu vẫn được lưu.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không hủy được yêu cầu.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReview(application: RoleApplication, decision: "APPROVED" | "REJECTED") {
    const decisionNote = decisionNotes[application.id]?.trim() ?? "";
    if (decision === "REJECTED" && !decisionNote) {
      setError("Cần ghi lý do khi từ chối yêu cầu.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await reviewRoleApplication({
        applicationId: application.id,
        decision,
        decisionNote: decisionNote || undefined,
      });
      onNotice(decision === "APPROVED" ? "Đã duyệt và cấp vai trò." : "Đã từ chối yêu cầu.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không xử lý được yêu cầu.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="institution-manager">
      {!reviewer && requestableRoles.length > 0 ? (
        <section className="role-request-intro panel">
          <div><span className="eyebrow">ĐĂNG KÝ NGHIỆP VỤ</span><h2>Bạn muốn tham gia với vai trò nào?</h2><p>Gửi hồ sơ để Ban tổ chức xác minh và phản hồi.</p></div>
          <button className="primary-button" type="button" onClick={() => setRequestFormOpen(true)}>Tạo yêu cầu <span>↗</span></button>
        </section>
      ) : null}
      {!reviewer && (requestableRoles.length > 0 || editingApplicationId !== null) ? (
        <Modal
          open={requestFormOpen || editingApplicationId !== null}
          title={editingApplicationId ? "Chỉnh sửa yêu cầu" : "Đăng ký vai trò"}
          description="Điền thông tin để Ban tổ chức xác minh hồ sơ của bạn."
          onClose={() => editingApplicationId ? cancelEditing() : setRequestFormOpen(false)}
          className="role-application-modal"
        >
        <form className="create-panel" onSubmit={(event) => void handleSubmit(event)}>
          <div className="panel-title-row">
            <div>
              <span className="eyebrow">{editingApplicationId ? "CHỈNH SỬA HỒ SƠ" : "ĐĂNG KÝ VAI TRÒ"}</span>
              <h2>{editingApplicationId ? "Chỉnh sửa yêu cầu đang chờ" : "Gửi yêu cầu tham gia nghiệp vụ"}</h2>
            </div>
            <button className="text-button" type="button" onClick={() => editingApplicationId ? cancelEditing() : setRequestFormOpen(false)}>Đóng</button>
          </div>
          <div className="form-grid">
            <label className="field">
              Vai trò muốn đăng ký
              <select
                value={requestedRole}
                disabled={editingApplicationId !== null}
                onChange={(event) => setRequestedRole(event.target.value as "TEAM_CAPTAIN" | "PLAYER")}
              >
                {(editingApplicationId ? [requestedRole] : requestableRoles).map((role) => (
                  <option key={role} value={role}>{roleLabels[role]}</option>
                ))}
              </select>
            </label>
            <InstitutionSelector
              label={requestedRole === "TEAM_CAPTAIN" ? "Trường đại diện" : "Trường đang theo học"}
              value={institutionId}
              onChange={setInstitutionId}
              required
            />
            <label className="field">Họ tên
              <input value={fullName} readOnly />
            </label>
            <label className="field">Email đăng ký
              <input type="email" value={email} readOnly />
            </label>
            <label className="field">Ngày sinh
              <input type="date" value={profile.birthDate} onChange={(event) => setProfile((current) => ({ ...current, birthDate: event.target.value }))} required />
            </label>
            <label className="field">Giới tính
              <select value={profile.gender} onChange={(event) => setProfile((current) => ({ ...current, gender: event.target.value }))} required>
                <option value="">Chọn giới tính</option><option value="MALE">Nam</option><option value="FEMALE">Nữ</option><option value="OTHER">Khác</option>
              </select>
            </label>
            <label className="field">Số điện thoại
              <input type="tel" value={profile.phone} onChange={(event) => setProfile((current) => ({ ...current, phone: event.target.value }))} maxLength={30} required />
            </label>
            <label className="field">{requestedRole === "TEAM_CAPTAIN" ? "Khoa / phòng ban" : "Khoa / viện"}
              <input value={profile.faculty} onChange={(event) => setProfile((current) => ({ ...current, faculty: event.target.value }))} maxLength={255} required />
            </label>
            {requestedRole === "TEAM_CAPTAIN" ? (
              <>
                <label className="field">Đối tượng đại diện
                  <select value={profile.representativeType} onChange={(event) => setProfile((current) => ({ ...current, representativeType: event.target.value, representativeOther: "" }))} required>
                    <option value="">Chọn đối tượng</option>
                    <option value="STUDENT">Sinh viên</option>
                    <option value="LECTURER">Giảng viên</option>
                    <option value="STAFF">Cán bộ / nhân viên</option>
                    <option value="OTHER">Khác (BTC xét theo điều lệ)</option>
                  </select>
                </label>
                <label className="field">Chức vụ trong đội
                  <input value={profile.teamPosition} onChange={(event) => setProfile((current) => ({ ...current, teamPosition: event.target.value }))} maxLength={100} placeholder="Ví dụ: Đội trưởng, đại diện CLB" required />
                </label>
                {profile.representativeType === "STUDENT" ? (
                  <label className="field">Mã số sinh viên <small>(không bắt buộc)</small>
                    <input value={profile.studentId} onChange={(event) => setProfile((current) => ({ ...current, studentId: event.target.value }))} maxLength={100} />
                  </label>
                ) : null}
                {profile.representativeType === "LECTURER" || profile.representativeType === "STAFF" ? (
                  <label className="field">Mã giảng viên / nhân viên <small>(nếu có)</small>
                    <input value={profile.staffId} onChange={(event) => setProfile((current) => ({ ...current, staffId: event.target.value }))} maxLength={100} />
                  </label>
                ) : null}
                {profile.representativeType === "OTHER" ? (
                  <label className="field field-wide">Mô tả đối tượng đại diện
                    <input value={profile.representativeOther} onChange={(event) => setProfile((current) => ({ ...current, representativeOther: event.target.value }))} maxLength={255} required />
                  </label>
                ) : null}
              </>
            ) : (
              <>
                <label className="field">Ngành học
                  <input value={profile.major} onChange={(event) => setProfile((current) => ({ ...current, major: event.target.value }))} maxLength={255} required />
                </label>
                <label className="field">Mã số sinh viên
                  <input value={profile.studentId} onChange={(event) => setProfile((current) => ({ ...current, studentId: event.target.value }))} maxLength={100} required />
                </label>
                <label className="field">Khóa / năm học
                  <input value={profile.academicYear} onChange={(event) => setProfile((current) => ({ ...current, academicYear: event.target.value }))} maxLength={100} required />
                </label>
              </>
            )}
            <label className="field field-wide">{requestedRole === "TEAM_CAPTAIN" ? "Liên kết minh chứng tư cách đại diện" : "Liên kết minh chứng đang học"}
              <input type="url" value={profile.evidenceUrl} onChange={(event) => setProfile((current) => ({ ...current, evidenceUrl: event.target.value }))} maxLength={1000} placeholder="URL ảnh thẻ hoặc giấy xác nhận" required />
            </label>
            {requestedRole === "PLAYER" ? (
              <>
                <label className="field">Vị trí sở trường
                  <select value={profile.playingPosition} onChange={(event) => setProfile((current) => ({ ...current, playingPosition: event.target.value }))} required>
                    <option value="">Chọn vị trí</option><option value="GK">Thủ môn</option><option value="DEF">Hậu vệ</option><option value="MID">Tiền vệ</option><option value="FWD">Tiền đạo</option>
                  </select>
                </label>
                <label className="field">Chân thuận
                  <select value={profile.dominantFoot} onChange={(event) => setProfile((current) => ({ ...current, dominantFoot: event.target.value }))} required>
                    <option value="">Chọn chân thuận</option><option value="RIGHT">Phải</option><option value="LEFT">Trái</option><option value="BOTH">Hai chân</option>
                  </select>
                </label>
                <label className="field">Chiều cao (cm)
                  <input type="number" min="100" max="250" value={profile.heightCm} onChange={(event) => setProfile((current) => ({ ...current, heightCm: event.target.value }))} />
                </label>
                <label className="field">Cân nặng (kg)
                  <input type="number" min="30" max="200" value={profile.weightKg} onChange={(event) => setProfile((current) => ({ ...current, weightKg: event.target.value }))} />
                </label>
              </>
            ) : (
              <>
                <label className="field field-wide">Lý do đăng ký làm đội trưởng
                  <textarea value={profile.reason} onChange={(event) => setProfile((current) => ({ ...current, reason: event.target.value }))} maxLength={2000} required />
                </label>
                <label className="field field-wide">
                  <span><input type="checkbox" checked={profile.commitment === "true"} onChange={(event) => setProfile((current) => ({ ...current, commitment: event.target.checked ? "true" : "" }))} required /> Tôi cam kết chịu trách nhiệm với đội bóng và tuân thủ điều lệ.</span>
                </label>
              </>
            )}
            <label className="field">
              Thông tin trường, đội hoặc minh chứng liên quan
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                maxLength={2000}
                rows={4}
                required
                placeholder="Cung cấp trường học, đội bóng và thông tin để BTC xác minh."
              />
            </label>
          </div>
          {requestedRole === "TEAM_CAPTAIN" ? (
            <p className="form-help">Đội trưởng/đại diện không bắt buộc có mã sinh viên. BTC sẽ xét tư cách đại diện theo điều lệ; điều kiện sinh viên áp dụng cho cầu thủ.</p>
          ) : null}
          <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={() => editingApplicationId ? cancelEditing() : setRequestFormOpen(false)}>Hủy</button>
          <button className="primary-button" disabled={submitting}>
            {submitting ? "Đang lưu…" : editingApplicationId ? "Lưu thay đổi" : "Gửi yêu cầu"} <span>↗</span>
          </button>
          </div>
        </form>
        </Modal>
      ) : !reviewer ? (
        <div className="panel"><p>
          {applications.some((application) => application.status === "PENDING")
            ? "Bạn đã gửi yêu cầu đang chờ xét duyệt. Có thể mở chi tiết để sửa hoặc hủy yêu cầu."
            : "Tài khoản của bạn đã có các vai trò nghiệp vụ có thể tự đăng ký."}
        </p></div>
      ) : null}

      {error ? <div className="message-banner message-error" role="alert">{error}</div> : null}
      <section className="panel data-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">{reviewer ? "XÉT DUYỆT" : "THEO DÕI HỒ SƠ"}</span>
            <h2>{reviewer ? "Yêu cầu đang chờ" : "Yêu cầu của tôi"}</h2>
          </div>
          <div className="role-application-toolbar">
            {!reviewer ? (
              <label className="field role-application-filter">Lọc theo vai trò
                <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as typeof roleFilter)}>
                  <option value="ALL">Tất cả vai trò</option>
                  <option value="PLAYER">Cầu thủ</option>
                  <option value="TEAM_CAPTAIN">Đội trưởng / Đại diện đội</option>
                </select>
              </label>
            ) : null}
            <button className="secondary-button" type="button" onClick={() => void load()}>Tải lại</button>
          </div>
        </div>
        {loading ? <div className="loading-state">Đang tải dữ liệu…</div> : visibleApplications.length ? (
          <div className="role-application-table-wrap">
            <table className="role-application-table">
              <thead><tr><th>Vai trò</th>{reviewer ? <th>Người đăng ký</th> : null}<th>Trường</th><th>Trạng thái</th><th>Ngày gửi</th><th>Thao tác</th></tr></thead>
              <tbody>{visibleApplications.map((application) => (
                <tr key={application.id}>
                  <td data-label="Vai trò"><strong>{roleLabels[application.requestedRole]}</strong></td>
                  {reviewer ? <td data-label="Người đăng ký"><strong>{application.fullName}</strong><small>{application.email}</small></td> : null}
                  <td data-label="Trường">{institutionNames[application.institutionId] ?? application.institutionId}</td>
                  <td data-label="Trạng thái"><span className={`institution-status ${application.status === "APPROVED" ? "status-active" : application.status === "PENDING" ? "status-draft" : "status-suspended"}`}><i />{statusLabels[application.status]}</span></td>
                  <td data-label="Ngày gửi">{new Date(application.createdAt).toLocaleDateString("vi-VN")}</td>
                  <td data-label="Thao tác">
                    <div className="role-application-table-actions">
                      <button className="table-action-button" type="button" onClick={() => setDetailApplication(application)}>Chi tiết</button>
                      {!reviewer && application.status === "PENDING" ? <>
                        <button className="table-action-button is-active" type="button" disabled={submitting} onClick={() => startEditing(application)}>Chỉnh sửa</button>
                        <button className="table-action-button danger-text-button" type="button" disabled={submitting} onClick={() => setWithdrawApplication(application)}>Thu hồi</button>
                      </> : null}
                      {reviewer && application.status === "PENDING" ? <>
                        <input className="role-review-note" aria-label="Lý do từ chối" value={decisionNotes[application.id] ?? ""} onChange={(event) => setDecisionNotes((current) => ({ ...current, [application.id]: event.target.value }))} placeholder="Lý do nếu từ chối" maxLength={2000} />
                        <button className="table-action-button action-activate" type="button" disabled={submitting} onClick={() => void handleReview(application, "APPROVED")}>Duyệt</button>
                        <button className="table-action-button danger-text-button" type="button" disabled={submitting} onClick={() => void handleReview(application, "REJECTED")}>Từ chối</button>
                      </> : null}
                    </div>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <h3>{reviewer ? "Không có yêu cầu đang chờ" : applications.length ? "Không có yêu cầu phù hợp bộ lọc" : "Bạn chưa gửi yêu cầu vai trò"}</h3>
            <p>{reviewer ? "Yêu cầu mới sẽ xuất hiện tại đây sau khi tài khoản được xác minh." : applications.length ? "Thử chọn một vai trò khác để xem các yêu cầu." : "Sau khi đăng ký và xác minh email, bạn có thể gửi yêu cầu."}</p>
          </div>
        )}
      </section>
      <Modal open={detailApplication !== null} title="Chi tiết yêu cầu vai trò" description="Thông tin hồ sơ đã gửi để Ban tổ chức xét duyệt." onClose={() => setDetailApplication(null)} className="role-application-detail-modal">
        {detailApplication ? <>
          <div className="role-application-detail-summary"><span className="institution-status status-active"><i />{statusLabels[detailApplication.status]}</span><strong>{roleLabels[detailApplication.requestedRole]}</strong><small>Gửi lúc {new Date(detailApplication.createdAt).toLocaleString("vi-VN")}</small></div>
          <dl className="application-details role-application-detail-grid">
            <div><dt>Họ tên</dt><dd>{detailApplication.fullName}</dd></div>
            <div><dt>Email</dt><dd>{detailApplication.email}</dd></div>
            <div><dt>Trường</dt><dd>{institutionNames[detailApplication.institutionId] ?? detailApplication.institutionId}</dd></div>
            {Object.entries(detailApplication.applicationData).map(([key, value]) => (
              <div key={key}><dt>{applicationFieldLabels[key] ?? key}</dt><dd>{typeof value === "boolean" ? (value ? "Có" : "Không") : String(value ?? "—")}</dd></div>
            ))}
            <div className="field-wide"><dt>Thông tin bổ sung</dt><dd>{detailApplication.message || "—"}</dd></div>
            {detailApplication.reviewedAt ? <div><dt>Xét duyệt lúc</dt><dd>{new Date(detailApplication.reviewedAt).toLocaleString("vi-VN")}</dd></div> : null}
            {detailApplication.decisionNote ? <div className="field-wide"><dt>Ý kiến xét duyệt</dt><dd>{detailApplication.decisionNote}</dd></div> : null}
          </dl>
          {!reviewer && detailApplication.status === "PENDING" ? <div className="modal-actions">
            <button className="secondary-button" type="button" onClick={() => { startEditing(detailApplication); setDetailApplication(null); }}>Chỉnh sửa yêu cầu</button>
            <button className="primary-button discard-confirm-button" type="button" disabled={submitting} onClick={() => { setDetailApplication(null); setWithdrawApplication(detailApplication); }}>Thu hồi yêu cầu</button>
          </div> : null}
        </> : null}
      </Modal>
      <Modal open={withdrawApplication !== null} title="Thu hồi yêu cầu?" description="Yêu cầu đã thu hồi sẽ được lưu trong lịch sử và không thể khôi phục." onClose={() => setWithdrawApplication(null)} className="discard-changes-modal">
        <div className="modal-actions">
          <button className="secondary-button" type="button" disabled={submitting} onClick={() => setWithdrawApplication(null)}>Giữ yêu cầu</button>
          <button className="primary-button discard-confirm-button" type="button" disabled={submitting || !withdrawApplication} onClick={() => withdrawApplication && void handleWithdraw(withdrawApplication)}>{submitting ? "Đang thu hồi…" : "Xác nhận thu hồi"}</button>
        </div>
      </Modal>
    </div>
  );
}
