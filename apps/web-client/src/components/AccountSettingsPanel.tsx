import { FormEvent, useEffect, useState } from "react";
import type { UserProfilePublic } from "@sfl/shared";
import type { Institution } from "../api/institutions";
import {
  changeMyPassword,
  getMyProfileHistory,
  getMyRoleApplications,
  requestEmailChange,
  updateMyProfile,
  type AccountProfileHistoryRecord,
  type RoleApplication,
} from "../api/users";
import { Modal } from "./Modal";

type Props = {
  profile: UserProfilePublic;
  institutionName: string | null;
  institutions: Institution[];
  onProfileChange: (profile: UserProfilePublic) => void;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
};

const profileLabels: Record<string, string> = {
  birthDate: "Ngày sinh",
  gender: "Giới tính",
  phone: "Số điện thoại",
  faculty: "Khoa/phòng ban",
  major: "Ngành",
  academicYear: "Khóa học",
  representativeType: "Đối tượng đại diện",
  staffId: "Mã giảng viên/nhân viên",
  teamPosition: "Chức vụ trong đội",
  playingPosition: "Vị trí thi đấu",
  dominantFoot: "Chân thuận",
  heightCm: "Chiều cao (cm)",
  weightKg: "Cân nặng (kg)",
  reason: "Lý do đăng ký",
  address: "Địa chỉ",
  commitment: "Cam kết",
  fullName: "Họ và tên",
  studentId: "Mã sinh viên",
  institutionId: "Trường học",
  roles: "Vai trò",
  accountStatus: "Trạng thái tài khoản",
  statusReason: "Lý do thay đổi trạng thái",
  action: "Thao tác",
};

const roleLabels: Record<string, string> = {
  ADMIN: "Quản trị viên", BTC: "Ban tổ chức", TEAM_CAPTAIN: "Đội trưởng",
  PLAYER: "Cầu thủ", REFEREE: "Trọng tài", VIEWER: "Khán giả",
};

const valueLabels: Record<string, string> = {
  FEMALE: "Nữ", MALE: "Nam", OTHER: "Khác",
  RIGHT: "Phải", LEFT: "Trái", BOTH: "Hai chân",
  GK: "Thủ môn", CB: "Trung vệ", LB: "Hậu vệ trái", RB: "Hậu vệ phải",
  CM: "Tiền vệ trung tâm", CDM: "Tiền vệ phòng ngự", CAM: "Tiền vệ tấn công",
  LW: "Tiền đạo cánh trái", RW: "Tiền đạo cánh phải", ST: "Tiền đạo",
};

function normalizeChanges(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function changeSummary(value: unknown): string {
  const changes = normalizeChanges(value);
  if (changes.action === "ROLE_APPLICATION_APPROVED") return "Được duyệt và cấp vai trò";
  const profileData = typeof changes.profileData === "object" && changes.profileData !== null
    ? Object.keys(changes.profileData)
    : [];
  const fields = [...Object.keys(changes).filter((key) => !["action", "actorUserId", "roleApplicationId", "before", "after"].includes(key)), ...profileData];
  const labels = [...new Set(fields)].map((key) => profileLabels[key] ?? key);
  return labels.length ? `Cập nhật ${labels.join(", ").toLocaleLowerCase("vi-VN")}` : "Cập nhật hồ sơ";
}

function historyRows(
  value: unknown,
  institutions: Institution[],
  prefix = "",
): Array<{ label: string; value: string }> {
  if (prefix === "") value = normalizeChanges(value);
  if (Array.isArray(value)) {
    return [{ label: prefix || "Giá trị", value: value.map((item) => roleLabels[String(item)] ?? String(item)).join(", ") || "Chưa có" }];
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, nested]) => {
      if (["actorUserId", "roleApplicationId"].includes(key)) return [];
      if (["before", "after", "profileData"].includes(key)) {
        const section = key === "before" ? "Trước đó" : key === "after" ? "Sau đó" : prefix;
        return historyRows(nested, institutions, section);
      }
      const label = profileLabels[key] ?? key;
      return historyRows(nested, institutions, prefix ? `${prefix} · ${label}` : label);
    });
  }
  if (value === undefined) return [];
  if (prefix.endsWith("Trường học") && typeof value === "string") {
    return [{ label: prefix, value: institutions.find((institution) => institution.id === value)?.name ?? value }];
  }
  if (prefix.endsWith("Vai trò") && typeof value === "string") {
    return [{ label: prefix, value: roleLabels[value] ?? value }];
  }
  const displayValue = value === null || value === "" ? "Chưa có" : valueLabels[String(value)] ?? roleLabels[String(value)] ?? String(value);
  return [{ label: prefix || "Giá trị", value: displayValue }];
}

function historyValueMap(value: unknown, institutions: Institution[]): Map<string, string> {
  const rows = historyRows(value, institutions);
  return new Map(rows.filter((row) => row.label !== "Thao tác").map(({ label, value: rowValue }) => [label, rowValue]));
}

function historyComparison(value: unknown, institutions: Institution[]) {
  const changes = normalizeChanges(value);
  const before = historyValueMap(changes.before, institutions);
  const after = historyValueMap(changes.after, institutions);
  if (!after.size) {
    const snapshot = { ...changes };
    delete snapshot.before;
    delete snapshot.after;
    delete snapshot.action;
    delete snapshot.actorUserId;
    delete snapshot.roleApplicationId;
    for (const [label, nextValue] of historyValueMap(snapshot, institutions)) after.set(label, nextValue);
  }
  const labels = [...new Set([...before.keys(), ...after.keys()])];
  return labels.map((label) => ({
    label,
    before: before.get(label) ?? "—",
    after: after.get(label) ?? "—",
  }));
}

type PlayerProfileForm = {
  birthDate: string;
  gender: string;
  faculty: string;
  major: string;
  academicYear: string;
  playingPosition: string;
  dominantFoot: string;
  heightCm: string;
  weightKg: string;
};

const emptyPlayerProfile: PlayerProfileForm = {
  birthDate: "", gender: "", faculty: "", major: "", academicYear: "",
  playingPosition: "", dominantFoot: "", heightCm: "", weightKg: "",
};

function playerProfileFrom(data: Record<string, unknown> | undefined): PlayerProfileForm {
  return Object.fromEntries(Object.keys(emptyPlayerProfile).map((key) => [
    key,
    typeof data?.[key] === "string" ? data[key] as string : "",
  ])) as PlayerProfileForm;
}

export function AccountSettingsPanel({ profile, institutionName, institutions, onProfileChange, onNotice, onError }: Props) {
  const [fullName, setFullName] = useState(profile.fullName);
  const [studentId, setStudentId] = useState(profile.studentId ?? "");
  const [phone, setPhone] = useState(profile.profileData?.phone ?? "");
  const [address, setAddress] = useState(profile.profileData?.address ?? "");
  const [playerProfile, setPlayerProfile] = useState<PlayerProfileForm>(playerProfileFrom(profile.profileData));
  const [email, setEmail] = useState("");
  const [emailChangePassword, setEmailChangePassword] = useState("");
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [applications, setApplications] = useState<RoleApplication[]>([]);
  const [history, setHistory] = useState<AccountProfileHistoryRecord[]>([]);
  const [saving, setSaving] = useState(false);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [roleHistoryDialogOpen, setRoleHistoryDialogOpen] = useState(false);
  const [expandedHistoryId, setExpandedHistoryId] = useState<number | null>(null);
  const [expandedRoleHistoryId, setExpandedRoleHistoryId] = useState<string | null>(null);

  useEffect(() => {
    setFullName(profile.fullName);
    setStudentId(profile.studentId ?? "");
    setPhone(profile.profileData?.phone ?? "");
    setAddress(profile.profileData?.address ?? "");
    setPlayerProfile(playerProfileFrom(profile.profileData));
  }, [profile.fullName, profile.studentId, profile.profileData]);

  useEffect(() => {
    let active = true;
    getMyProfileHistory()
      .then(({ history: changes }) => { if (active) setHistory(changes); })
      .catch((error: unknown) => { if (active) onError(error instanceof Error ? error.message : "Không tải được lịch sử hồ sơ."); });
    getMyRoleApplications()
      .then(({ applications: items }) => {
        if (!active) return;
        setApplications(items);
        const approvedPlayerApplication = items.find((item) => item.requestedRole === "PLAYER" && item.status === "APPROVED");
        if (approvedPlayerApplication) {
          const applicationData = approvedPlayerApplication.applicationData;
          if (!profile.studentId && typeof applicationData.studentId === "string") setStudentId(applicationData.studentId);
          setPlayerProfile((current) => {
            const fallback = playerProfileFrom(applicationData);
            return Object.fromEntries(Object.keys(current).map((key) => [key, current[key as keyof PlayerProfileForm] || fallback[key as keyof PlayerProfileForm]])) as PlayerProfileForm;
          });
        }
      })
      .catch((error: unknown) => { if (active) onError(error instanceof Error ? error.message : "Không tải được hồ sơ vai trò."); });
    return () => {
      active = false;
    };
  }, [onError, profile.studentId]);

  const approvedRoleApplications = applications.filter((application) => application.status === "APPROVED");

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const { user } = await updateMyProfile({
        fullName: fullName.trim(),
        profileData: { phone: phone.trim() || null, address: address.trim() || null },
      });
      onProfileChange(user);
      onNotice("Đã cập nhật thông tin cá nhân.");
      try {
        const { history: changes } = await getMyProfileHistory();
        setHistory(changes);
      } catch (error) {
        onError(error instanceof Error ? error.message : "Không tải lại được lịch sử hồ sơ.");
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : "Không cập nhật được hồ sơ.");
    } finally {
      setSaving(false);
    }
  }

  async function savePlayerProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const { user } = await updateMyProfile({
        fullName: profile.fullName,
        studentId: studentId.trim() || null,
        profileData: playerProfile,
      });
      onProfileChange(user);
      onNotice("Đã cập nhật thông tin cầu thủ.");
      try {
        const { history: changes } = await getMyProfileHistory();
        setHistory(changes);
      } catch (error) {
        onError(error instanceof Error ? error.message : "Không tải lại được lịch sử hồ sơ.");
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : "Không cập nhật được thông tin cầu thủ.");
    } finally {
      setSaving(false);
    }
  }

  async function changeEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const result = await requestEmailChange({
        email: email.trim(),
        currentPassword: emailChangePassword,
      });
      setEmail("");
      setEmailChangePassword("");
      setEmailDialogOpen(false);
      onNotice(result.message);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Không gửi được email xác nhận.");
    } finally {
      setSaving(false);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const result = await changeMyPassword({ oldPassword, newPassword });
      setOldPassword("");
      setNewPassword("");
      setPasswordDialogOpen(false);
      onNotice(result.message);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Không đổi được mật khẩu.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dashboard-grid account-settings-page">
      <section className="panel data-panel">
        <div className="panel-heading account-profile-heading">
          <div><span className="eyebrow">HỒ SƠ CÁ NHÂN</span><h2>Thông tin cá nhân</h2><p>Cập nhật thông tin liên hệ của bạn.</p></div>
          <div className="account-profile-actions">
            {approvedRoleApplications.length ? <button className="secondary-button" type="button" onClick={() => setRoleHistoryDialogOpen(true)}><span aria-hidden="true">♙</span> Lịch sử vai trò</button> : null}
            <button className="secondary-button" type="button" onClick={() => setHistoryDialogOpen(true)}><span aria-hidden="true">◷</span> Lịch sử thay đổi</button>
          </div>
        </div>
        <form className="form-grid" onSubmit={(event) => void saveProfile(event)}>
          <label className="field">Họ và tên
            <input value={fullName} onChange={(event) => setFullName(event.target.value)} maxLength={255} required />
          </label>
          <label className="field">Số điện thoại
            <input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={50} />
          </label>
          <label className="field">Địa chỉ liên hệ
            <input value={address} onChange={(event) => setAddress(event.target.value)} maxLength={255} />
          </label>
          <div className="field-wide form-actions">
            <button className="primary-button" disabled={saving || !fullName.trim()}>{saving ? "Đang lưu…" : "Lưu thay đổi"}<span>↗</span></button>
          </div>
        </form>
      </section>

      <section className="panel data-panel account-security-panel">
        <div className="panel-heading"><div><span className="eyebrow">ĐĂNG NHẬP VÀ BẢO MẬT</span><h2>Bảo mật tài khoản</h2><p>Quản lý email và mật khẩu dùng để đăng nhập.</p></div></div>
        <div className="security-action-list">
          <article className="security-action-card">
            <div className="security-action-icon" aria-hidden="true">＠</div>
            <div className="security-action-copy">
              <span className="eyebrow">EMAIL ĐĂNG NHẬP</span>
              <strong>{profile.email}</strong>
              <span className={profile.emailVerified ? "security-status is-verified" : "security-status"}>
                <i />{profile.emailVerified ? "Đã xác minh" : "Chưa xác minh"}
              </span>
            </div>
            <button className="secondary-button" type="button" onClick={() => setEmailDialogOpen(true)}>Đổi email</button>
          </article>
          <article className="security-action-card">
            <div className="security-action-icon" aria-hidden="true">••</div>
            <div className="security-action-copy">
              <span className="eyebrow">MẬT KHẨU</span>
              <strong>Định kỳ cập nhật mật khẩu</strong>
              <span className="muted-copy">Dùng mật khẩu mới có ít nhất 8 ký tự.</span>
            </div>
            <button className="secondary-button" type="button" onClick={() => setPasswordDialogOpen(true)}>Đổi mật khẩu</button>
          </article>
        </div>
        <div className="account-facts">
          <div><span>Vai trò</span><strong>{profile.roles.join(" · ") || "Chưa có"}</strong></div>
          <div><span>Trường</span><strong>{institutionName ?? (profile.institutionId ? "Đang tải thông tin trường" : "Chưa liên kết")}</strong></div>
          <div><span>Mã sinh viên</span><strong>{(profile.studentId ?? studentId) || "Chưa có"}</strong></div>
        </div>
      </section>

      {profile.roles.includes("PLAYER") ? (
        <section className="panel data-panel player-profile-panel">
          <div className="panel-heading"><div><span className="eyebrow">HỒ SƠ VẬN ĐỘNG VIÊN</span><h2>Thông tin cầu thủ</h2><p>Cập nhật mã sinh viên, thông tin học tập và hồ sơ thi đấu.</p></div></div>
          <form className="form-grid player-profile-form" onSubmit={(event) => void savePlayerProfile(event)}>
            <label className="field">Mã sinh viên
              <input value={studentId} onChange={(event) => setStudentId(event.target.value)} maxLength={100} placeholder="Nhập mã sinh viên" required />
            </label>
            <label className="field">Ngày sinh
              <input type="date" value={playerProfile.birthDate} onChange={(event) => setPlayerProfile((current) => ({ ...current, birthDate: event.target.value }))} />
            </label>
            <label className="field">Giới tính
              <select value={playerProfile.gender} onChange={(event) => setPlayerProfile((current) => ({ ...current, gender: event.target.value }))}>
                <option value="">Chọn giới tính</option><option value="MALE">Nam</option><option value="FEMALE">Nữ</option><option value="OTHER">Khác</option>
              </select>
            </label>
            <label className="field">Khoa
              <input value={playerProfile.faculty} onChange={(event) => setPlayerProfile((current) => ({ ...current, faculty: event.target.value }))} maxLength={200} />
            </label>
            <label className="field">Ngành học
              <input value={playerProfile.major} onChange={(event) => setPlayerProfile((current) => ({ ...current, major: event.target.value }))} maxLength={200} />
            </label>
            <label className="field">Khóa / năm học
              <input value={playerProfile.academicYear} onChange={(event) => setPlayerProfile((current) => ({ ...current, academicYear: event.target.value }))} maxLength={200} />
            </label>
            <label className="field">Vị trí thi đấu
              <select value={playerProfile.playingPosition} onChange={(event) => setPlayerProfile((current) => ({ ...current, playingPosition: event.target.value }))}>
                <option value="">Chọn vị trí</option><option value="GK">Thủ môn</option><option value="DEF">Hậu vệ</option><option value="MID">Tiền vệ</option><option value="FWD">Tiền đạo</option>
              </select>
            </label>
            <label className="field">Chân thuận
              <select value={playerProfile.dominantFoot} onChange={(event) => setPlayerProfile((current) => ({ ...current, dominantFoot: event.target.value }))}>
                <option value="">Chọn chân thuận</option><option value="RIGHT">Chân phải</option><option value="LEFT">Chân trái</option><option value="BOTH">Hai chân</option>
              </select>
            </label>
            <label className="field">Chiều cao (cm)
              <input type="number" min="100" max="250" value={playerProfile.heightCm} onChange={(event) => setPlayerProfile((current) => ({ ...current, heightCm: event.target.value }))} />
            </label>
            <label className="field">Cân nặng (kg)
              <input type="number" min="30" max="200" value={playerProfile.weightKg} onChange={(event) => setPlayerProfile((current) => ({ ...current, weightKg: event.target.value }))} />
            </label>
            <div className="field-wide form-actions"><button className="primary-button" disabled={saving || !studentId.trim()}>{saving ? "Đang lưu…" : "Lưu thông tin cầu thủ"}<span>↗</span></button></div>
          </form>
        </section>
      ) : null}

      <Modal
        open={historyDialogOpen}
        title="Lịch sử thay đổi hồ sơ"
        description="Các lần cập nhật thông tin cá nhân đã được ghi nhận cho tài khoản này."
        onClose={() => { setHistoryDialogOpen(false); setExpandedHistoryId(null); }}
        className="account-history-modal"
      >
        {history.length ? (
          <div className="account-history-list">
            {history.map((item) => (
              <article className="account-history-item" key={item.id}>
                <button
                  className="account-history-trigger"
                  type="button"
                  aria-expanded={expandedHistoryId === item.id}
                  onClick={() => setExpandedHistoryId(expandedHistoryId === item.id ? null : item.id)}
                >
                  <span className="account-history-trigger-icon" aria-hidden="true">◷</span>
                  <span className="account-history-trigger-copy">
                    <strong>{changeSummary(item.changes)}</strong>
                    <small>{new Date(item.changedAt).toLocaleString("vi-VN")}</small>
                  </span>
                  <span className="account-history-chevron" aria-hidden="true">{expandedHistoryId === item.id ? "−" : "+"}</span>
                </button>
                {expandedHistoryId === item.id ? (
                  <div className="history-comparison">
                    <div className="history-comparison-head"><span>Thông tin</span><span>Trước đó</span><span>Sau đó</span></div>
                    {historyComparison(item.changes, institutions).map((row) => (
                      <div className="history-comparison-row" key={row.label}>
                        <strong>{row.label}</strong><span>{row.before}</span><span>{row.after}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        ) : <div className="empty-state"><p>Chưa có thay đổi hồ sơ được ghi nhận.</p></div>}
      </Modal>

      <Modal
        open={roleHistoryDialogOpen}
        title="Lịch sử đăng ký vai trò"
        description="Các yêu cầu vai trò đã gửi và trạng thái xét duyệt của tài khoản."
        onClose={() => setRoleHistoryDialogOpen(false)}
        className="account-history-modal"
      >
        <div className="account-history-list role-approval-history-list">
          {approvedRoleApplications.map((application) => (
            <article className="account-history-item role-approval-history-item" key={application.id}>
              <button className="account-history-trigger" type="button" aria-expanded={expandedRoleHistoryId === application.id}
                onClick={() => setExpandedRoleHistoryId(expandedRoleHistoryId === application.id ? null : application.id)}>
                <span className="role-approval-history-icon" aria-hidden="true">✓</span>
                <span className="role-approval-history-copy">
                  <strong>{application.requestedRole === "PLAYER" ? "Cầu thủ" : "Đội trưởng"} đã được duyệt</strong>
                  <small>{institutions.find((institution) => institution.id === application.institutionId)?.name ?? "Trường đã đăng ký"}</small>
                  <small>{new Date(application.reviewedAt ?? application.updatedAt).toLocaleString("vi-VN")}</small>
                </span>
                <span className="institution-status status-active"><i />Đã duyệt</span>
                <span className="account-history-chevron" aria-hidden="true">{expandedRoleHistoryId === application.id ? "−" : "+"}</span>
              </button>
              {expandedRoleHistoryId === application.id ? (
                <dl className="role-approval-details">
                  <div><dt>Vai trò được cấp</dt><dd>{roleLabels[application.requestedRole] ?? application.requestedRole}</dd></div>
                  <div><dt>Trường</dt><dd>{institutions.find((institution) => institution.id === application.institutionId)?.name ?? "Trường đã đăng ký"}</dd></div>
                  {historyRows(application.applicationData, institutions).map((row) => (
                    <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>
                  ))}
                </dl>
              ) : null}
            </article>
          ))}
        </div>
      </Modal>

      <Modal
        open={emailDialogOpen}
        title="Đổi email đăng nhập"
        description="Email hiện tại chỉ được thay đổi sau khi bạn xác nhận liên kết gửi đến địa chỉ mới."
        onClose={() => setEmailDialogOpen(false)}
        className="account-modal"
      >
        <form className="form-grid" onSubmit={(event) => void changeEmail(event)}>
          <label className="field field-wide">Email mới
            <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" required />
          </label>
          <label className="field field-wide">Mật khẩu hiện tại
            <input type="password" autoComplete="current-password" value={emailChangePassword} onChange={(event) => setEmailChangePassword(event.target.value)} required />
          </label>
          <div className="field-wide modal-actions">
            <button className="secondary-button" type="button" onClick={() => setEmailDialogOpen(false)} disabled={saving}>Hủy</button>
            <button className="primary-button" disabled={saving}>{saving ? "Đang gửi…" : "Gửi email xác nhận"}<span>↗</span></button>
          </div>
        </form>
      </Modal>

      <Modal
        open={passwordDialogOpen}
        title="Đổi mật khẩu"
        description="Xác nhận mật khẩu hiện tại, sau đó nhập mật khẩu mới có ít nhất 8 ký tự."
        onClose={() => setPasswordDialogOpen(false)}
        className="account-modal"
      >
        <form className="form-grid" onSubmit={(event) => void changePassword(event)}>
          <label className="field field-wide">Mật khẩu hiện tại
            <input type="password" autoComplete="current-password" value={oldPassword} onChange={(event) => setOldPassword(event.target.value)} required />
          </label>
          <label className="field field-wide">Mật khẩu mới
            <input type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="Tối thiểu 8 ký tự" required />
          </label>
          <div className="field-wide modal-actions">
            <button className="secondary-button" type="button" onClick={() => setPasswordDialogOpen(false)} disabled={saving}>Hủy</button>
            <button className="primary-button" disabled={saving}>{saving ? "Đang cập nhật…" : "Cập nhật mật khẩu"}<span>↗</span></button>
          </div>
        </form>
      </Modal>

    </div>
  );
}
