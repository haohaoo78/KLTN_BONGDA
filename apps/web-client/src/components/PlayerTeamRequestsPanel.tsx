import { FormEvent, useCallback, useEffect, useState } from "react";
import type { UserProfilePublic } from "@sfl/shared";
import { Modal } from "./Modal";
import {
  getMyPlayerLeaveRequests,
  getMyPlayerTeamRequests,
  getPublicTeamDetail,
  getPlayers,
  getTeamPlayerLeaveRequests,
  getTeamPlayerRequests,
  getMyManagedTeams,
  getTeams,
  respondPlayerLeaveRequest,
  respondPlayerTeamRequest,
  submitPlayerLeaveRequest,
  submitPlayerTeamRequest,
  withdrawPlayerLeaveRequest,
  withdrawPlayerTeamRequest,
  type Player,
  type PlayerLeaveRequest,
  type PlayerTeamRequest,
  type PublicTeamDetail,
  type Team,
} from "../api/competition";

type Props = {
  mode: "player" | "captain" | "both";
  viewMode?: "player" | "captain";
  onViewModeChange?: (mode: "player" | "captain") => void;
  ownedTeams: Team[];
  fullName: string;
  studentId: string;
  profileData?: UserProfilePublic["profileData"];
  institutionId?: string | null;
  onNotice: (message: string) => void;
};

const requestStatusLabels: Record<PlayerTeamRequest["status"], string> = {
  PENDING: "Chờ đội trưởng",
  APPROVED: "Đã được thêm vào đội",
  REJECTED: "Đã từ chối",
  WITHDRAWN: "Đã rút yêu cầu",
};

const leaveStatusLabels: Record<PlayerLeaveRequest["status"], string> = {
  PENDING: "Chờ xử lý",
  APPROVED: "Đã duyệt rời đội",
  REJECTED: "Đã từ chối",
  WITHDRAWN: "Đã rút yêu cầu",
};

const playerProfileLabels: Record<string, string> = {
  gender: "Giới tính",
  faculty: "Khoa",
  major: "Ngành học",
  academicYear: "Niên khóa",
  playingPosition: "Vị trí thi đấu",
  dominantFoot: "Chân thuận",
  heightCm: "Chiều cao",
  weightKg: "Cân nặng",
  phone: "Điện thoại",
};

function playerProfileEntries(profileData?: UserProfilePublic["profileData"]) {
  if (!profileData) return [];
  return Object.entries(playerProfileLabels)
    .map(([key, label]) => ({ key, label, value: profileData[key as keyof NonNullable<UserProfilePublic["profileData"]>] }))
    .filter((entry): entry is { key: string; label: string; value: string } => typeof entry.value === "string" && Boolean(entry.value.trim()));
}

export function PlayerTeamRequestsPanel({
  mode: accountMode,
  viewMode,
  onViewModeChange,
  ownedTeams,
  fullName,
  studentId,
  profileData,
  institutionId,
  onNotice,
}: Props) {
  const [localCombinedView, setLocalCombinedView] = useState<"player" | "captain">("player");
  const combinedView = viewMode ?? localCombinedView;
  const mode = accountMode === "both" ? combinedView : accountMode;
  const changeCombinedView = (next: "player" | "captain") => {
    if (onViewModeChange) onViewModeChange(next);
    else setLocalCombinedView(next);
  };
  const [teams, setTeams] = useState<Team[]>([]);
  const [requests, setRequests] = useState<PlayerTeamRequest[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<PlayerLeaveRequest[]>([]);
  const [members, setMembers] = useState<Player[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [selectedTeamDetail, setSelectedTeamDetail] = useState<PublicTeamDetail | null>(null);
  const [teamPreviewOpen, setTeamPreviewOpen] = useState(false);
  const [teamDetailLoading, setTeamDetailLoading] = useState(false);
  const [applicantName, setApplicantName] = useState(fullName);
  const [applicantStudentId, setApplicantStudentId] = useState(studentId);
  const [joinMessage, setJoinMessage] = useState("");
  const [leaveReason, setLeaveReason] = useState("");
  const [decisionReasons, setDecisionReasons] = useState<Record<string, string>>({});
  const [requestKind, setRequestKind] = useState<"JOIN" | "LEAVE">("JOIN");
  const [requestStatus, setRequestStatus] = useState<PlayerTeamRequest["status"] | "ALL">("ALL");
  const [requestSearch, setRequestSearch] = useState("");
  const [requestedFrom, setRequestedFrom] = useState("");
  const [requestedTo, setRequestedTo] = useState("");
  const [requestPage, setRequestPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joinHistoryOpen, setJoinHistoryOpen] = useState(false);
  const [selectedJoinRequest, setSelectedJoinRequest] = useState<PlayerTeamRequest | null>(null);
  const [playerActionOpen, setPlayerActionOpen] = useState<"join" | "leave" | null>(null);
  const [managerRequestsOpen, setManagerRequestsOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (mode === "player") {
        const [teamResult, requestResult, leaveResult] = await Promise.all([
          getTeams(),
          getMyPlayerTeamRequests(),
          getMyPlayerLeaveRequests(),
        ]);
        setTeams(teamResult.items.filter((team) => team.isActive && Boolean(institutionId) && team.institutionId === institutionId));
        setRequests(requestResult.requests);
        setLeaveRequests(leaveResult.requests);
        const currentTeam = ownedTeams.find((team) => team.isActive);
        setMembers(currentTeam ? (await getPlayers(currentTeam.id)).players : []);
      } else if (mode === "captain") {
        const { teams: captainTeams } = await getMyManagedTeams();
        setTeams(captainTeams);
        const [joinLists, leaveLists] = await Promise.all([
          Promise.all(captainTeams.map((team) => getTeamPlayerRequests(team.id))),
          Promise.all(captainTeams.map((team) => getTeamPlayerLeaveRequests(team.id))),
        ]);
        setRequests(joinLists.flatMap((result) => result.requests));
        setLeaveRequests(leaveLists.flatMap((result) => result.requests));
        setMembers([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được dữ liệu thành viên.");
    } finally {
      setLoading(false);
    }
  }, [mode, ownedTeams, institutionId]);

  useEffect(() => {
    setApplicantName(fullName);
    setApplicantStudentId(studentId);
  }, [fullName, studentId]);

  useEffect(() => {
    if (mode !== "player" || !selectedTeamId) {
      setSelectedTeamDetail(null);
      return;
    }
    let active = true;
    setTeamDetailLoading(true);
    getPublicTeamDetail(selectedTeamId)
      .then((detail) => { if (active) setSelectedTeamDetail(detail); })
      .catch((err: unknown) => { if (active) setError(err instanceof Error ? err.message : "Không tải được chi tiết câu lạc bộ."); })
      .finally(() => { if (active) setTeamDetailLoading(false); });
    return () => { active = false; };
  }, [mode, selectedTeamId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await submitPlayerTeamRequest({
        teamId: selectedTeamId,
        fullName: applicantName.trim(),
        birthDate: profileData?.birthDate ?? undefined,
        studentId: applicantStudentId.trim() || undefined,
        profileData: Object.fromEntries(playerProfileEntries(profileData).map(({ key, value }) => [key, value])),
        message: joinMessage.trim() || undefined,
      });
      setJoinMessage("");
      onNotice("Đã gửi yêu cầu tham gia đội bóng.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không gửi được yêu cầu.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLeave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await submitPlayerLeaveRequest(leaveReason.trim());
      setLeaveReason("");
      onNotice("Đã gửi yêu cầu rời đội. Bạn vẫn là thành viên cho đến khi yêu cầu được duyệt.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không gửi được yêu cầu rời đội.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleJoinDecision(request: PlayerTeamRequest, status: "APPROVED" | "REJECTED") {
    const reason = decisionReasons[request.id]?.trim() ?? "";
    if (status === "REJECTED" && !reason) {
      setError("Cần nhập lý do khi từ chối yêu cầu gia nhập.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await respondPlayerTeamRequest(request.id, status, reason || undefined);
      onNotice(status === "APPROVED"
        ? `${request.fullName ?? "Cầu thủ"} đã được thêm vào đội.`
        : "Đã từ chối yêu cầu gia nhập đội.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không xử lý được yêu cầu.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLeaveDecision(request: PlayerLeaveRequest, decision: "APPROVED" | "REJECTED") {
    const reason = decisionReasons[request.id]?.trim() ?? "";
    if (decision === "REJECTED" && !reason) {
      setError("Cần nhập lý do khi từ chối yêu cầu rời đội.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await respondPlayerLeaveRequest({
        requestId: request.id,
        decision,
        decisionReason: reason || undefined,
      });
      onNotice(decision === "APPROVED" ? "Đã duyệt yêu cầu rời đội." : "Đã từ chối yêu cầu rời đội.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không xử lý được yêu cầu rời đội.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleWithdraw(id: string, leave = false) {
    setSubmitting(true);
    setError(null);
    try {
      if (leave) await withdrawPlayerLeaveRequest(id);
      else await withdrawPlayerTeamRequest(id);
      onNotice("Đã rút yêu cầu đang chờ.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không rút được yêu cầu.");
    } finally {
      setSubmitting(false);
    }
  }

  const teamById = new Map(teams.map((team) => [team.id, team.name]));
  const currentTeam = mode === "player" ? ownedTeams.find((team) => team.isPlayer && team.isActive) : undefined;
  const pendingLeave = leaveRequests.find((request) => request.status === "PENDING");
  const hasPendingJoin = requests.some((request) => request.status === "PENDING");
  const invalidDateRange = Boolean(requestedFrom && requestedTo && requestedFrom > requestedTo);
  const searchTerm = requestSearch.trim().toLocaleLowerCase("vi");
  const filteredJoinRequests = requests.filter((request) => {
    if (invalidDateRange) return false;
    const matchesStatus = requestStatus === "ALL" || request.status === requestStatus;
    const created = request.createdAt.slice(0, 10);
    const matchesDate = (!requestedFrom || created >= requestedFrom) &&
      (!requestedTo || created <= requestedTo);
    const matchesSearch = !searchTerm || [
      request.fullName,
      request.studentId,
      request.contactEmail,
      request.message,
      teamById.get(request.teamId),
    ].some((value) => value?.toLocaleLowerCase("vi").includes(searchTerm));
    return matchesStatus && matchesDate && matchesSearch;
  });
  const filteredLeaveRequests = leaveRequests.filter((request) => {
    if (invalidDateRange) return false;
    const matchesStatus = requestStatus === "ALL" || request.status === requestStatus;
    const created = request.requestedAt.slice(0, 10);
    const matchesDate = (!requestedFrom || created >= requestedFrom) &&
      (!requestedTo || created <= requestedTo);
    const matchesSearch = !searchTerm || [
      request.playerName,
      request.teamName,
      request.reason,
    ].some((value) => value.toLocaleLowerCase("vi").includes(searchTerm));
    return matchesStatus && matchesDate && matchesSearch;
  });
  const managerRows = mode === "player"
    ? []
    : requestKind === "JOIN"
      ? filteredJoinRequests.map((request) => ({ kind: "JOIN" as const, request }))
      : filteredLeaveRequests.map((request) => ({ kind: "LEAVE" as const, request }));
  const pageCount = Math.ceil(managerRows.length / 10);
  const joinRequestsForDisplay = mode === "player"
    ? requests
    : requestKind === "JOIN"
      ? managerRows.slice(requestPage * 10, requestPage * 10 + 10)
          .flatMap((row) => row.kind === "JOIN" ? [row.request] : [])
      : [];
  const leaveRequestsForDisplay = mode === "player"
    ? leaveRequests
    : requestKind === "LEAVE"
      ? managerRows.slice(requestPage * 10, requestPage * 10 + 10)
          .flatMap((row) => row.kind === "LEAVE" ? [row.request] : [])
      : [];

  return (
    <section className="panel data-panel">
      {accountMode === "both" && viewMode === undefined ? (
        <nav className="workspace-tabs team-role-tabs" aria-label="Phạm vi đội bóng">
          <button className={mode === "player" ? "is-active" : ""} type="button" onClick={() => { changeCombinedView("player"); setSelectedTeamId(""); setError(null); }}>
            Đội tôi tham gia
          </button>
          <button className={mode === "captain" ? "is-active" : ""} type="button" onClick={() => { changeCombinedView("captain"); setSelectedTeamId(""); setError(null); }}>
            Đội tôi điều hành
          </button>
        </nav>
      ) : null}
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{mode === "player" ? "HỒ SƠ CẦU THỦ" : "QUẢN LÝ THÀNH VIÊN"}</span>
          <h2>{mode === "player" ? "Đội bóng và yêu cầu của tôi" : "Yêu cầu thành viên"}</h2>
          {accountMode === "both" ? <p className="form-help">{mode === "player" ? "Đội bạn đang là thành viên: xem đội hình và gửi yêu cầu rời đội. Quyền quản lý đội được tách riêng ở tab bên cạnh." : "Chỉ các đội bạn đang điều hành xuất hiện ở đây. Bạn có thể chỉnh sửa đội và xử lý yêu cầu gia nhập hoặc rời đội."}</p> : null}
        </div>
        <div className="button-row">{mode === "captain" ? <button className="secondary-button" type="button" onClick={() => setManagerRequestsOpen(true)}>Yêu cầu đội bóng <span>{requests.filter((item) => item.status === "PENDING").length + leaveRequests.filter((item) => item.status === "PENDING").length}</span></button> : null}<button className="text-button" type="button" onClick={() => void load()}>Tải lại</button></div>
      </div>

      {mode === "player" && !currentTeam && !hasPendingJoin ? (
        <>
        {!institutionId ? <div className="message-banner message-error">Tài khoản chưa có trường trong hồ sơ nên chưa thể gửi yêu cầu tham gia câu lạc bộ.</div> : null}
        <button className="secondary-button" type="button" onClick={() => setPlayerActionOpen("join")}>Tìm đội và gửi yêu cầu tham gia</button>
        <Modal open={playerActionOpen === "join"} title="Yêu cầu tham gia đội" description="Chọn câu lạc bộ cùng trường, xem thông tin và gửi hồ sơ cầu thủ cho đội trưởng." onClose={() => setPlayerActionOpen(null)} className="player-request-action-modal">
        <form className="form-grid player-request-form" onSubmit={(event) => void handleJoin(event)}>
          <label className="field">
            Đội bóng
            <select value={selectedTeamId} onChange={(event) => { setSelectedTeamId(event.target.value); setSelectedTeamDetail(null); setTeamPreviewOpen(false); setError(null); }} required>
              <option value="">Chọn câu lạc bộ cùng trường</option>
              {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
          </label>
          {teamDetailLoading ? <div className="field-wide loading-state">Đang tải giới thiệu câu lạc bộ…</div> : null}
          {selectedTeamDetail ? <div className="field-wide join-team-preview">
            <div className="join-team-preview-heading"><span className="join-team-crest">{selectedTeamDetail.team.logoUrl ? <img src={selectedTeamDetail.team.logoUrl} alt="" /> : selectedTeamDetail.team.name.slice(0, 2).toUpperCase()}</span><div><span className="eyebrow">ĐÃ CHỌN CÂU LẠC BỘ</span><h3>{selectedTeamDetail.team.name}</h3><span className="join-team-school">{selectedTeamDetail.team.institutionName ?? "Chưa liên kết trường"}</span></div></div>
            <button className="secondary-button" type="button" onClick={() => setTeamPreviewOpen(true)}>Xem hồ sơ câu lạc bộ</button>
          </div> : null}
          <div className="field-wide player-request-profile-card">
            <div className="player-request-profile-heading"><span className="player-request-profile-avatar">{applicantName.slice(0, 1).toUpperCase() || "C"}</span><div><span className="eyebrow">THÔNG TIN GỬI KÈM TỰ ĐỘNG</span><strong>{applicantName || "Chưa cập nhật họ tên"}</strong><span>MSSV: {applicantStudentId || "Chưa có trong hồ sơ"}</span></div><span className="profile-autofill-badge">Từ hồ sơ</span></div>
            {profileData?.birthDate || playerProfileEntries(profileData).length ? <dl className="player-request-profile-facts">{profileData?.birthDate ? <div><dt>Ngày sinh</dt><dd>{profileData.birthDate}</dd></div> : null}{playerProfileEntries(profileData).map(({ key, label, value }) => <div key={key}><dt>{label}</dt><dd>{key === "heightCm" ? `${value} cm` : key === "weightKg" ? `${value} kg` : value}</dd></div>)}</dl> : <p className="player-request-profile-empty">Hồ sơ chưa có thông tin cầu thủ bổ sung. Đội trưởng vẫn sẽ nhận họ tên, mã sinh viên và email tài khoản.</p>}
            <small>Họ tên, mã sinh viên, email và thông tin cầu thủ trong hồ sơ sẽ được gửi cho đội trưởng cùng yêu cầu.</small>
          </div>
          <label className="field field-wide">Lời nhắn
            <textarea value={joinMessage} onChange={(event) => setJoinMessage(event.target.value)} maxLength={2000} rows={3} />
          </label>
          <div className="field-wide form-actions">
            <button className="primary-button" disabled={submitting || !teams.length || !institutionId || !selectedTeamDetail || teamDetailLoading}>
              {submitting ? "Đang gửi…" : "Gửi yêu cầu gia nhập"}
            </button>
          </div>
        </form>
        </Modal>
        </>
      ) : null}

      {currentTeam ? (
        <div className="message-banner message-success">
          Đội hiện tại: <strong>{currentTeam.name}</strong>. Bạn vẫn thuộc đội trong thời gian chờ duyệt yêu cầu rời đội.
        </div>
      ) : null}

      {mode === "player" && currentTeam && !pendingLeave ? (
        <>
        <button className="secondary-button" type="button" onClick={() => setPlayerActionOpen("leave")}>Gửi yêu cầu rời đội</button>
        <Modal open={playerActionOpen === "leave"} title="Yêu cầu rời đội" description={`Đội trưởng sẽ xét duyệt yêu cầu của bạn tại ${currentTeam.name}.`} onClose={() => setPlayerActionOpen(null)}>
        <form className="form-grid" onSubmit={(event) => void handleLeave(event)}>
          <label className="field field-wide">Lý do xin rời đội
            <textarea value={leaveReason} onChange={(event) => setLeaveReason(event.target.value)} maxLength={2000} rows={3} required />
          </label>
          <div className="field-wide form-actions">
            <button className="text-button" disabled={submitting || !leaveReason.trim()}>Gửi yêu cầu rời đội</button>
          </div>
        </form>
        </Modal>
        </>
      ) : null}

      {mode === "player" && pendingLeave ? (
        <div className="message-banner">
          Yêu cầu rời đội đang chờ xử lý: {pendingLeave.reason}
          <button className="text-button" type="button" disabled={submitting} onClick={() => void handleWithdraw(pendingLeave.id, true)}>Rút yêu cầu</button>
        </div>
      ) : null}

      {mode === "player" && currentTeam ? (
        <div className="institution-list">
          <h3>Thành viên đang hoạt động</h3>
          {members.map((member) => (
            <article className="institution-row" key={member.id}>
              <div>
                <h3>{member.fullName ?? "Cầu thủ"}</h3>
                <p>{member.position ?? "Chưa cập nhật vị trí"}{member.jerseyNumber ? ` · Số áo ${member.jerseyNumber}` : ""}{member.isCaptain ? " · Đội trưởng trong đội hình" : ""}</p>
              </div>
            </article>
          ))}
          {!members.length ? <p>Đội chưa có danh sách thành viên được trả về.</p> : null}
        </div>
      ) : null}

      {error ? <div className="message-banner message-error" role="alert">{error}</div> : null}
      {loading ? <div className="loading-state">Đang tải dữ liệu…</div> : null}

      <Modal open={mode === "captain" && managerRequestsOpen} title="Yêu cầu thành viên đội bóng" description="Chọn loại yêu cầu để xem hồ sơ và xử lý theo vai trò đội trưởng." onClose={() => setManagerRequestsOpen(false)} className="team-requests-management-modal">
      {mode !== "player" ? (
        <div className="section-toolbar">
          <label className="field">Loại yêu cầu
            <select value={requestKind} onChange={(event) => { setRequestKind(event.target.value as "JOIN" | "LEAVE"); setRequestPage(0); }}>
              {mode === "captain" ? <option value="JOIN">Gia nhập đội</option> : null}
              <option value="LEAVE">Rời đội</option>
            </select>
          </label>
          <label className="field">Trạng thái
            <select value={requestStatus} onChange={(event) => { setRequestStatus(event.target.value as PlayerTeamRequest["status"] | "ALL"); setRequestPage(0); }}>
              <option value="ALL">Tất cả</option>
              <option value="PENDING">Chờ xử lý</option>
              <option value="APPROVED">Đã duyệt</option>
              <option value="REJECTED">Đã từ chối</option>
              <option value="WITHDRAWN">Đã rút</option>
            </select>
          </label>
          <label className="field">Tìm kiếm
            <input value={requestSearch} onChange={(event) => { setRequestSearch(event.target.value); setRequestPage(0); }} maxLength={100} />
          </label>
          <label className="field">Từ ngày
            <input type="date" value={requestedFrom} onChange={(event) => { setRequestedFrom(event.target.value); setRequestPage(0); }} />
          </label>
          <label className="field">Đến ngày
            <input type="date" value={requestedTo} onChange={(event) => { setRequestedTo(event.target.value); setRequestPage(0); }} />
          </label>
        </div>
      ) : null}
      {mode !== "player" && invalidDateRange ? (
        <div className="message-banner message-error" role="alert">Từ ngày không được sau Đến ngày.</div>
      ) : null}

      {mode === "player" ? (
        <button className="request-history-trigger" type="button" onClick={() => setJoinHistoryOpen(true)}>
          <span className="request-history-icon" aria-hidden="true">◷</span>
          <span><strong>Lịch sử yêu cầu gia nhập đội</strong><small>Xem danh sách và trạng thái các yêu cầu đã gửi</small></span>
          <span className="request-history-count">{requests.length}</span>
          <span className="request-history-arrow" aria-hidden="true">›</span>
        </button>
      ) : null}

      {mode === "captain" && joinRequestsForDisplay.length ? (
        <div className="institution-list">
          <h3>Lịch sử yêu cầu gia nhập đội</h3>
          {joinRequestsForDisplay.map((request) => (
            <article className="institution-row" key={request.id}>
              <div>
                <span className="eyebrow">{teamById.get(request.teamId) ?? "Đội bóng"} · {requestStatusLabels[request.status]}</span>
                <p>Gửi lúc: {new Date(request.createdAt).toLocaleString("vi-VN")}</p>
                <h3>{request.fullName ?? "Cầu thủ"}</h3>
                {request.studentId ? <p>MSSV: {request.studentId}</p> : null}
                {request.birthDate ? <p>Ngày sinh: {request.birthDate}</p> : null}
                {request.contactEmail ? <p>Email: {request.contactEmail}</p> : null}
                {Object.entries(request.profileData ?? {}).filter(([, value]) => Boolean(value)).length ? <dl className="request-player-profile-facts">{Object.entries(request.profileData ?? {}).filter(([, value]) => Boolean(value)).map(([key, value]) => <div key={key}><dt>{playerProfileLabels[key] ?? key}</dt><dd>{key === "heightCm" ? `${value} cm` : key === "weightKg" ? `${value} kg` : value}</dd></div>)}</dl> : null}
                {request.message ? <p>{request.message}</p> : null}
                {request.reviewedBy ? <p>Người xử lý: {request.reviewedBy}{request.respondedAt ? ` · ${new Date(request.respondedAt).toLocaleString("vi-VN")}` : ""}</p> : null}
                {request.decisionReason ? <p>Lý do xử lý: {request.decisionReason}</p> : null}
              </div>
              {mode === "captain" && request.status === "PENDING" ? (
                <div className="form-grid">
                  <label className="field">Lý do nếu từ chối
                    <textarea
                      value={decisionReasons[request.id] ?? ""}
                      onChange={(event) => setDecisionReasons((current) => ({ ...current, [request.id]: event.target.value }))}
                      maxLength={2000}
                      rows={2}
                    />
                  </label>
                  <div className="button-row">
                    <button className="primary-button" type="button" disabled={submitting} onClick={() => void handleJoinDecision(request, "APPROVED")}>Duyệt</button>
                    <button className="text-button" type="button" disabled={submitting || !decisionReasons[request.id]?.trim()} onClick={() => void handleJoinDecision(request, "REJECTED")}>Từ chối</button>
                  </div>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}

      {leaveRequestsForDisplay.length ? (
        <div className="institution-list">
          <h3>{mode === "player" ? "Lịch sử yêu cầu rời đội" : "Yêu cầu rời đội"}</h3>
          {leaveRequestsForDisplay.map((request) => (
            <article className="institution-row" key={request.id}>
              <div>
                <span className="eyebrow">
                  {request.teamName} · {leaveStatusLabels[request.status]}
                  {request.overdue && request.status === "PENDING" ? " · QUÁ 3 NGÀY" : ""}
                </span>
                <h3>{request.playerName}</h3>
                <p>Gửi lúc: {new Date(request.requestedAt).toLocaleString("vi-VN")}</p>
                <p>{request.reason}</p>
                {request.reviewedBy ? <p>Người xử lý: {request.reviewedBy}{request.reviewedAt ? ` · ${new Date(request.reviewedAt).toLocaleString("vi-VN")}` : ""}</p> : null}
                {request.decisionReason ? <p>Lý do xử lý: {request.decisionReason}</p> : null}
              </div>
              {mode === "captain" && request.status === "PENDING" ? (
                <div className="form-grid">
                  <label className="field">Lý do nếu từ chối
                    <textarea
                      value={decisionReasons[request.id] ?? ""}
                      onChange={(event) => setDecisionReasons((current) => ({ ...current, [request.id]: event.target.value }))}
                      maxLength={2000}
                      rows={2}
                    />
                  </label>
                  <div className="button-row">
                    <button className="primary-button" type="button" disabled={submitting} onClick={() => void handleLeaveDecision(request, "APPROVED")}>Duyệt rời đội</button>
                    <button className="text-button" type="button" disabled={submitting || !decisionReasons[request.id]?.trim()} onClick={() => void handleLeaveDecision(request, "REJECTED")}>Từ chối</button>
                  </div>
                </div>
              ) : null}
              {mode === "player" && request.status === "PENDING" ? (
                <button className="text-button" type="button" disabled={submitting} onClick={() => void handleWithdraw(request.id, true)}>Rút yêu cầu</button>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}

      {mode !== "player" ? (
        <div className="section-toolbar">
          <span className="muted-copy">{managerRows.length} yêu cầu · Trang {requestPage + 1} / {Math.max(pageCount, 1)}</span>
          <div className="form-actions">
            <button className="text-button" type="button" disabled={requestPage === 0} onClick={() => setRequestPage((current) => current - 1)}>Trước</button>
            <button className="text-button" type="button" disabled={requestPage + 1 >= pageCount} onClick={() => setRequestPage((current) => current + 1)}>Sau</button>
          </div>
        </div>
      ) : null}

      {!loading && mode !== "player" && managerRows.length === 0 && !invalidDateRange ? (
        <div className="empty-state"><p>Không có yêu cầu phù hợp với bộ lọc.</p></div>
      ) : null}
      </Modal>

      <Modal open={mode === "player" && joinHistoryOpen && !selectedJoinRequest} title="Lịch sử yêu cầu gia nhập đội" description="Chọn một yêu cầu để xem đầy đủ thông tin và kết quả xử lý." onClose={() => setJoinHistoryOpen(false)} className="join-request-modal">
        {requests.length ? <div className="join-history-list">
          {requests.map((request) => <button className="join-history-item" type="button" key={request.id} onClick={() => { setSelectedJoinRequest(request); setJoinHistoryOpen(false); }}>
            <span className="join-history-item-main"><strong>{teamById.get(request.teamId) ?? "Đội bóng"}</strong><small>Gửi lúc {new Date(request.createdAt).toLocaleString("vi-VN")}</small></span>
            <span className={`join-history-status join-history-status-${request.status.toLowerCase()}`}>{requestStatusLabels[request.status]}</span>
            <span className="request-history-arrow" aria-hidden="true">›</span>
          </button>)}
        </div> : <div className="empty-state"><p>Bạn chưa gửi yêu cầu gia nhập đội nào.</p></div>}
      </Modal>

      {selectedJoinRequest ? <Modal open title="Chi tiết yêu cầu gia nhập" description={teamById.get(selectedJoinRequest.teamId) ?? "Đội bóng"} onClose={() => setSelectedJoinRequest(null)} className="join-request-modal">
        <div className="join-request-detail">
          <div className="join-request-detail-heading"><span className={`join-history-status join-history-status-${selectedJoinRequest.status.toLowerCase()}`}>{requestStatusLabels[selectedJoinRequest.status]}</span><span>Gửi lúc {new Date(selectedJoinRequest.createdAt).toLocaleString("vi-VN")}</span></div>
          <h3>{selectedJoinRequest.fullName ?? "Cầu thủ"}</h3>
          <dl className="request-player-profile-facts">
            {selectedJoinRequest.studentId ? <div><dt>Mã sinh viên</dt><dd>{selectedJoinRequest.studentId}</dd></div> : null}
            {selectedJoinRequest.birthDate ? <div><dt>Ngày sinh</dt><dd>{selectedJoinRequest.birthDate}</dd></div> : null}
            {selectedJoinRequest.contactEmail ? <div><dt>Email</dt><dd>{selectedJoinRequest.contactEmail}</dd></div> : null}
            {Object.entries(selectedJoinRequest.profileData ?? {}).filter(([, value]) => Boolean(value)).map(([key, value]) => <div key={key}><dt>{playerProfileLabels[key] ?? key}</dt><dd>{key === "heightCm" ? `${value} cm` : key === "weightKg" ? `${value} kg` : value}</dd></div>)}
          </dl>
          {selectedJoinRequest.message ? <div className="join-request-message"><strong>Lời nhắn</strong><p>{selectedJoinRequest.message}</p></div> : null}
          {selectedJoinRequest.reviewedBy ? <p className="join-request-review">Người xử lý: {selectedJoinRequest.reviewedBy}{selectedJoinRequest.respondedAt ? ` · ${new Date(selectedJoinRequest.respondedAt).toLocaleString("vi-VN")}` : ""}</p> : null}
          {selectedJoinRequest.decisionReason ? <div className="join-request-message"><strong>Lý do xử lý</strong><p>{selectedJoinRequest.decisionReason}</p></div> : null}
          <div className="button-row join-request-detail-actions"><button className="text-button" type="button" onClick={() => { setSelectedJoinRequest(null); setJoinHistoryOpen(true); }}>Quay lại danh sách</button>{selectedJoinRequest.status === "PENDING" ? <button className="text-button" type="button" disabled={submitting} onClick={() => { void handleWithdraw(selectedJoinRequest.id); setSelectedJoinRequest(null); }}>Thu hồi yêu cầu</button> : null}</div>
        </div>
      </Modal> : null}

      <Modal open={teamPreviewOpen && Boolean(selectedTeamDetail)} title="Hồ sơ câu lạc bộ" description="Thông tin công khai trước khi bạn gửi yêu cầu gia nhập." onClose={() => setTeamPreviewOpen(false)} className="club-preview-modal">
        {selectedTeamDetail ? <div className="public-team-detail club-preview-detail">
          <div className="public-team-summary">
            <div className="public-team-crest">{selectedTeamDetail.team.logoUrl ? <img src={selectedTeamDetail.team.logoUrl} alt={`Logo ${selectedTeamDetail.team.name}`} /> : <span>{selectedTeamDetail.team.name.slice(0, 2).toUpperCase()}</span>}</div>
            <div className="public-team-overview">
              <div className="public-team-tags"><span className="public-team-tag">{selectedTeamDetail.team.institutionName ?? "Chưa liên kết trường"}</span>{selectedTeamDetail.team.unitName ? <span className="public-team-tag">{selectedTeamDetail.team.unitName}</span> : null}</div>
              <p className="public-team-description">{selectedTeamDetail.team.description || "Câu lạc bộ chưa cập nhật phần giới thiệu."}</p>
              <div className="public-team-facts"><div><span>ĐỘI TRƯỞNG</span><strong>{selectedTeamDetail.players.find((player) => player.teamRole === "CAPTAIN")?.fullName ?? "Chưa công khai"}</strong></div><div><span>ĐẠI DIỆN CLB</span><strong>{selectedTeamDetail.team.representativeName ?? "Chưa cập nhật"}</strong></div><div><span>THÀNH VIÊN</span><strong>{selectedTeamDetail.players.length} cầu thủ</strong></div></div>
            </div>
          </div>
          <section className="public-team-section public-team-members"><div className="public-team-section-title"><span className="public-section-icon">👥</span><div><span className="eyebrow">ĐỘI HÌNH</span><h3>Thành viên câu lạc bộ</h3></div><span className="public-member-count">{selectedTeamDetail.players.length}</span></div>{selectedTeamDetail.players.length ? <div className="public-player-grid">{selectedTeamDetail.players.map((player) => <article className="public-player-card club-preview-player" key={player.id}><span className="player-avatar" aria-hidden="true">{player.fullName?.slice(0, 1) ?? "C"}</span><span className="public-player-copy"><strong>{player.fullName ?? "Cầu thủ"}</strong><small>{player.teamRole === "CAPTAIN" ? "ĐỘI TRƯỞNG" : "THÀNH VIÊN"}</small><span>{player.jerseyNumber ? `Áo số ${player.jerseyNumber}` : "Chưa có số áo"} · {player.position ?? "Chưa cập nhật vị trí"}</span></span></article>)}</div> : <p className="public-section-empty">Danh sách thành viên chưa được công khai.</p>}</section>
          <div className="club-preview-actions"><button className="primary-button" type="button" onClick={() => setTeamPreviewOpen(false)}>Tiếp tục gửi yêu cầu</button></div>
        </div> : null}
      </Modal>
    </section>
  );
}
