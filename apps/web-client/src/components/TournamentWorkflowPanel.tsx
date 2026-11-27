import { useCallback, useEffect, useState } from "react";
import { Modal } from "./Modal";
import { ApiError, NOTIFICATION_REALTIME_EVENT } from "../api/client";
import {
  createTeamRegistration,
  resubmitTeamRegistration,
  createTournamentInvitations,
  getTeamTournamentInvitations,
  getTournamentRegistrationDraft,
  saveTournamentRegistrationDraft,
  deleteTournamentRegistrationDraft,
  getTeamPlayerTournamentWithdrawals,
  decidePlayerTournamentWithdrawal,
  getTournamentEligiblePlayers,
  manageTeamTournamentInvitation,
  getTeamRegistrationHistory,
  createRegistrationChangeRequest,
  getRegistrationChangeRequests,
  getTournamentRegistrationChangeRequests,
  decideRegistrationChangeRequest,
  getTeamRegistrationApprovalReviews,
  openTeamRegistrationApprovalReview,
  respondTeamRegistrationApprovalReview,
  decideTeamRegistrationApprovalReview,
  getMyTeamRegistration,
  getMyTeamRegistrations,
  getTournamentRegistrationOptions,
  getTournament,
  getTournamentRegulations,
  getPlayers,
  getTeam,
  getTournamentRegistrations,
  getTournamentRosters,
  getMyManagedTeams,
  linkTeamToVerifiedSchool,
  updateTeamRegistration,
  getTournamentWithdrawalRequests,
  decideTeamWithdrawalRequest,
  withdrawTeamRegistration,
  requestTeamRegistrationWithdrawal,
  getRegistrationWithdrawalRequests,
  cancelTeamWithdrawalRequest,
  type Player,
  type RosterEntry,
  type Team,
  type TeamRegistration,
  type Tournament,
  type TournamentRegulation,
  type TournamentRegistrationOption,
  type TournamentPlayerInvitation,
  type TeamRegistrationVersion,
  type TeamWithdrawalRequest,
  type ApprovalReview,
  type PlayerTournamentWithdrawalRequest,
  type RegistrationChangeRequest,
} from "../api/competition";

type AssignedTournament = { id: string; name: string; status: string };

function isRegistrationPeriodOpen(tournament: Tournament | undefined): boolean {
  if (tournament?.status !== "OPEN_REGISTRATION") return false;
  const now = Date.now();
  return (tournament.registrationPeriods ?? []).some((period) => {
    const start = /^\d{4}-\d{2}-\d{2}$/.test(period.startDate)
      ? new Date(`${period.startDate}T00:00:00+07:00`).getTime() : new Date(period.startDate).getTime();
    const end = /^\d{4}-\d{2}-\d{2}$/.test(period.endDate)
      ? new Date(`${period.endDate}T23:59:59.999+07:00`).getTime() : new Date(period.endDate).getTime();
    return Number.isFinite(start) && Number.isFinite(end) && start <= now && now <= end;
  });
}

function canOpenApprovedRegistrationReview(tournament: Tournament | undefined): boolean {
  return isRegistrationPeriodOpen(tournament);
}

function formatViDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("day")}/${part("month")}/${part("year")} ${part("hour")}:${part("minute")}`;
}

type ApprovalReviewAction = "RETAIN_APPROVAL" | "REQUEST_EXPLANATION" | "REVOKE_APPROVAL" | "REQUEST_SUPPLEMENT";
type RegistrationDetailTab = "application" | "history";
type RegistrationPlayerSnapshot = {
  playerId: string;
  playerName?: string | null;
  fullName?: string | null;
  studentId?: string | null;
  birthDate?: string | null;
  jerseyNumber?: number | null;
  position?: string | null;
  lineupRole?: "STARTER" | "SUBSTITUTE";
  isGoalkeeper?: boolean;
  competitionRole?: string;
};
type CaptainRegistrationTab = "select" | "invitations" | "roster" | "withdrawals";

const playerPositionLabels: Record<string, string> = { GK: "Thủ môn", DEF: "Hậu vệ", MID: "Tiền vệ", FWD: "Tiền đạo" };
const competitionRoleLabels: Record<string, string> = { PLAYER: "Cầu thủ", PLAYING_CAPTAIN: "Đội trưởng thi đấu", VICE_CAPTAIN: "Đội phó" };

function formatViDate(value: string | null | undefined): string {
  if (!value) return "—";
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(dateOnly ? `${value}T12:00:00+07:00` : value);
  if (!Number.isFinite(date.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("day")}/${part("month")}/${part("year")}`;
}

function formatHistoryNote(value: string | null | undefined): string {
  return (value ?? "").replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z/g, (date) => formatViDateTime(date));
}

function getRegistrationIfPresent(teamId: string, tournamentId: string) {
  return getMyTeamRegistration(teamId, tournamentId).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  });
}

function approvalReviewActionLabel(action: ApprovalReviewAction): string {
  return action === "RETAIN_APPROVAL" ? "Giữ nguyên phê duyệt"
    : action === "REQUEST_EXPLANATION" ? "Yêu cầu giải trình/bổ sung"
      : action === "REQUEST_SUPPLEMENT" ? "Yêu cầu bổ sung thêm"
        : "Thu hồi phê duyệt";
}

function approvalHistoryActionLabel(action: TeamRegistrationVersion["action"]): string {
  return action === "APPROVED" ? "BTC duyệt hồ sơ"
    : action === "APPROVAL_REVIEW_OPENED" ? "Mở xem xét lại / yêu cầu bổ sung"
      : action === "APPROVAL_REVIEW_RESPONSE" ? "Đội gửi giải trình"
        : action === "APPROVAL_REVIEW_RETAINED" ? "BTC giữ nguyên phê duyệt"
          : action === "APPROVAL_REVOKED" ? "BTC thu hồi phê duyệt"
            : action === "RESUBMITTED" ? "Đội gửi hồ sơ bổ sung"
              : action === "SUBMITTED" ? "Đội nộp hồ sơ"
                : action === "REJECTED" ? "BTC từ chối hồ sơ"
                  : action === "WITHDRAWN" ? "Đội rút hồ sơ"
                    : action === "WAITLISTED" ? "Chuyển hồ sơ sang chờ suất"
                      : action === "CONFLICT_ADJUSTMENT_REQUIRED" ? "Tự động yêu cầu điều chỉnh trùng cầu thủ"
                        : action === "ADJUSTMENT_RESUBMITTED" ? "Đội gửi lại roster đã điều chỉnh"
                          : action === "ADJUSTMENT_EXPIRED" ? "Hết hạn điều chỉnh hồ sơ"
                    : action === "LOCKED" ? "Chốt roster"
                      : "Cập nhật hồ sơ";
}

type Props = {
  mode: "captain" | "btc";
  assignedTournaments: AssignedTournament[];
  onNotice: (message: string) => void;
  initialTeamId?: string;
  initialTournamentId?: string;
  onViewApprovedRoster?: () => void;
};

const registrationStatusLabels: Record<TeamRegistration["status"], string> = {
  PENDING: "Chờ duyệt",
  APPROVED: "Đã duyệt",
  REJECTED: "Bị từ chối",
  APPROVAL_REVOKED: "Bị thu hồi phê duyệt",
  REVISION_REQUIRED: "Cần bổ sung",
  NEEDS_SUPPLEMENT: "Cần bổ sung",
  WITHDRAWN: "Đã rút",
  WAITLIST: "Chờ suất",
  CONFLICT_ADJUSTMENT_REQUIRED: "Cần điều chỉnh – Trùng cầu thủ",
};

const tournamentStatusLabels: Record<string, string> = {
  DRAFT: "Bản nháp",
  OPEN_REGISTRATION: "Đang mở đăng ký",
  REGISTRATION_CLOSED: "Đã đóng đăng ký",
  ROSTER_LOCKED: "Đã chốt danh sách",
  PREPARING: "Đang chuẩn bị",
  IN_PROGRESS: "Đang diễn ra",
  PAUSED: "Tạm dừng",
  COMPLETED: "Đã kết thúc",
  CANCELLED: "Đã hủy",
};

export function TournamentWorkflowPanel({ mode, assignedTournaments, onNotice, initialTeamId, initialTournamentId, onViewApprovedRoster }: Props) {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [registrations, setRegistrations] = useState<TeamRegistration[]>([]);
  const [registrationReloadRevision, setRegistrationReloadRevision] = useState(0);
  const [schoolCounts, setSchoolCounts] = useState<Array<{
    institutionId: string;
    institutionName: string;
    pending: number;
    approved: number;
    total: number;
  }>>([]);
  const [registrationOptions, setRegistrationOptions] = useState<TournamentRegistrationOption[]>([]);
  const [loadingRegistrationOptions, setLoadingRegistrationOptions] = useState(false);
  const [selectedTournamentId, setSelectedTournamentId] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [registrationStatusFilter, setRegistrationStatusFilter] = useState<TeamRegistration["status"] | "SUPPLEMENT" | "APPROVAL_REVIEW_OPEN" | "">("");
  const [approvalReviewOpenRegistrationIds, setApprovalReviewOpenRegistrationIds] = useState<string[]>([]);
  const [registrationInstitutionFilter, setRegistrationInstitutionFilter] = useState("");
  const [registrationSearch, setRegistrationSearch] = useState("");
  const [appliedRegistrationSearch, setAppliedRegistrationSearch] = useState("");
  const [registrationPage, setRegistrationPage] = useState(1);
  const [selectedRegistrationId, setSelectedRegistrationId] = useState("");
  const [decision, setDecision] = useState<{ registration: TeamRegistration; status: "APPROVED" | "REJECTED" | "NEEDS_SUPPLEMENT" } | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [decisionAllowResubmission, setDecisionAllowResubmission] = useState(false);
  const [supplementDeadline, setSupplementDeadline] = useState("");
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [registrationDetailLoading, setRegistrationDetailLoading] = useState(false);
  const [registrationHistoryLoading, setRegistrationHistoryLoading] = useState(false);
  const [rosters, setRosters] = useState<RosterEntry[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [registrationNotes, setRegistrationNotes] = useState("");
  const [hasRegistrationDraft, setHasRegistrationDraft] = useState(false);
  const [submittedLineup, setSubmittedLineup] = useState<Record<string, { role: "STARTER" | "SUBSTITUTE"; goalkeeper: boolean; competitionRole: "PLAYER" | "PLAYING_CAPTAIN" | "VICE_CAPTAIN"; jerseyNumber: number | null; position: string | null }>>({});
  const [invitations, setInvitations] = useState<TournamentPlayerInvitation[]>([]);
  const [playerWithdrawalRequests, setPlayerWithdrawalRequests] = useState<PlayerTournamentWithdrawalRequest[]>([]);
  const [playerWithdrawalDecision, setPlayerWithdrawalDecision] = useState<{ request: PlayerTournamentWithdrawalRequest; decision: "APPROVED" | "REJECTED" } | null>(null);
  const [playerWithdrawalDecisionNote, setPlayerWithdrawalDecisionNote] = useState("");
  const [eligiblePlayerIds, setEligiblePlayerIds] = useState<string[]>([]);
  const [unavailablePlayerIds, setUnavailablePlayerIds] = useState<string[]>([]);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [registrationHistory, setRegistrationHistory] = useState<TeamRegistrationVersion[]>([]);
  const [approvalReviewsByRegistrationId, setApprovalReviewsByRegistrationId] = useState<Record<string, ApprovalReview[]>>({});
  const [registrationDetailTab, setRegistrationDetailTab] = useState<RegistrationDetailTab>("application");
  const [selectedRosterPlayerId, setSelectedRosterPlayerId] = useState<string | null>(null);
  const [rosterPlayerSearch, setRosterPlayerSearch] = useState("");
  const [regulations, setRegulations] = useState<TournamentRegulation[]>([]);
  const [regulationsLoading, setRegulationsLoading] = useState(false);
  const [registrationAction, setRegistrationAction] = useState<"APPROVED" | "REJECTED" | "NEEDS_SUPPLEMENT" | null>(null);
  const [registrationActionNote, setRegistrationActionNote] = useState("");
  const [registrationActionDeadline, setRegistrationActionDeadline] = useState("");
  const [registrationActionError, setRegistrationActionError] = useState<string | null>(null);
  const [withdrawalRequests, setWithdrawalRequests] = useState<TeamWithdrawalRequest[]>([]);
  const [withdrawalDecision, setWithdrawalDecision] = useState<{ request: TeamWithdrawalRequest; decision: "APPROVED" | "REJECTED" } | null>(null);
  const [withdrawalDecisionNote, setWithdrawalDecisionNote] = useState("");
  const [approvalReviewTarget, setApprovalReviewTarget] = useState<TeamRegistration | null>(null);
  const [approvalReviews, setApprovalReviews] = useState<ApprovalReview[]>([]);
  const [approvalReviewAction, setApprovalReviewAction] = useState<ApprovalReviewAction | null>(null);
  const [approvalReviewDetailsLoading, setApprovalReviewDetailsLoading] = useState(false);
  const [approvalReviewReason, setApprovalReviewReason] = useState("");
  const [approvalReviewDeadline, setApprovalReviewDeadline] = useState("");
  const [approvalReviewDecisionNote, setApprovalReviewDecisionNote] = useState("");
  const [playerSearch, setPlayerSearch] = useState("");
  const [playerPositionFilter, setPlayerPositionFilter] = useState("");
  const [playerInvitationFilter, setPlayerInvitationFilter] = useState<"ALL" | "AVAILABLE" | "PENDING" | "ACCEPTED">("ALL");
  const [captainRegistrationTab, setCaptainRegistrationTab] = useState<CaptainRegistrationTab>("select");
  const [editingSubmittedRegistration, setEditingSubmittedRegistration] = useState(false);
  const [changeRequestReason, setChangeRequestReason] = useState("");
  const [changeRequestKind, setChangeRequestKind] = useState<RegistrationChangeRequest["requestKind"]>("APPROVED_AMENDMENT");
  const [changeRosterPlayerIds, setChangeRosterPlayerIds] = useState<string[]>([]);
  const [changeRequests, setChangeRequests] = useState<RegistrationChangeRequest[]>([]);
  const [registrationChangeHistory, setRegistrationChangeHistory] = useState<RegistrationChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [savingRegistrationDraft, setSavingRegistrationDraft] = useState(false);
  const [linkingSchool, setLinkingSchool] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setRegistrationPage(1), [selectedTournamentId, registrationStatusFilter, registrationInstitutionFilter, appliedRegistrationSearch]);
  useEffect(() => {
    if (mode !== "btc" || !selectedTournamentId) { setChangeRequests([]); return; }
    let active = true;
    getTournamentRegistrationChangeRequests(selectedTournamentId).then(({changeRequests: items}) => { if (active) setChangeRequests(items); }).catch((err: unknown) => { if (active) setError(err instanceof Error ? err.message : "Không tải được yêu cầu thay đổi roster."); });
    return () => { active = false; };
  }, [mode, selectedTournamentId]);
  useEffect(() => {
    setChangeRosterPlayerIds(invitations.filter((item) => item.status === "ACCEPTED").map((item) => item.player_id));
  }, [invitations]);
  useEffect(() => {
    setSubmittedLineup({});
    setEditingSubmittedRegistration(false);
    setHasRegistrationDraft(false);
    setCaptainRegistrationTab("select");
  }, [selectedTeamId, selectedTournamentId]);

  useEffect(() => {
    if (mode !== "captain" || !selectedTeamId || !selectedTournamentId) return;
    let active = true;
    getTournamentRegistrationDraft(selectedTeamId, selectedTournamentId).then(({ draft }) => {
      if (!active || !draft) return;
      setHasRegistrationDraft(true);
      if (draft.editingSubmitted) {
        setEditingSubmittedRegistration(true);
        setCaptainRegistrationTab("roster");
      }
      setSubmittedLineup(Object.fromEntries(draft.roster.map((entry) => [entry.playerId, {
        role: entry.lineupRole,
        goalkeeper: entry.isGoalkeeper,
        competitionRole: entry.competitionRole,
        jerseyNumber: entry.proposedJerseyNumber,
        position: entry.position,
      }])));
      setRegistrationNotes(draft.notes);
    }).catch((draftError: unknown) => {
      if (active) setError(draftError instanceof Error ? draftError.message : "Không tải được bản nháp đăng ký.");
    });
    return () => { active = false; };
  }, [mode, selectedTeamId, selectedTournamentId]);

  const selectedTournament = tournaments.find((item) => item.id === selectedTournamentId);
  const selectedTeam = teams.find((item) => item.id === selectedTeamId);
  const selectedTeamRegistration = registrations.find((item) => item.teamId === selectedTeamId && item.tournamentId === selectedTournamentId);
  useEffect(() => {
    if (mode !== "captain" || !selectedTeamRegistration) { setRegistrationChangeHistory([]); return; }
    let active = true;
    getRegistrationChangeRequests(selectedTeamRegistration.id).then(({changeRequests:items}) => { if (active) setRegistrationChangeHistory(items); }).catch((err: unknown) => { if (active) setError(err instanceof Error ? err.message : "Không tải được lịch sử thay đổi roster."); });
    return () => { active = false; };
  }, [mode, selectedTeamRegistration?.id]);
  const allTournamentRegistrations = registrations.filter((item) => item.tournamentId === selectedTournamentId);
  const activeApprovalReview = approvalReviews.find((review) => review.registrationId === approvalReviewTarget?.id && ["OPEN", "RESPONDED", "SUPPLEMENT_REQUIRED"].includes(review.status));
  const tournamentRegistrations = allTournamentRegistrations.filter((item) => {
    const team = teams.find((candidate) => candidate.id === item.teamId);
    const matchesStatus = !registrationStatusFilter
      || (registrationStatusFilter === "SUPPLEMENT" ? ["NEEDS_SUPPLEMENT", "REVISION_REQUIRED"].includes(item.status)
        : registrationStatusFilter === "WAITLIST" ? item.status === "WAITLIST" || Boolean(item.waitlistReason)
        : registrationStatusFilter === "APPROVAL_REVIEW_OPEN" ? approvalReviewOpenRegistrationIds.includes(item.id)
          : item.status === registrationStatusFilter);
    return matchesStatus
      && (!registrationInstitutionFilter || item.institutionId === registrationInstitutionFilter)
      && (!appliedRegistrationSearch || `${team?.name ?? ""} ${team?.representativeName ?? ""} ${team?.contactEmail ?? ""} ${item.institutionName ?? ""}`.toLocaleLowerCase("vi").includes(appliedRegistrationSearch.toLocaleLowerCase("vi")));
  });
  const registrationPageSize = 12;
  const registrationPageCount = Math.max(1, Math.ceil(tournamentRegistrations.length / registrationPageSize));
  const safeRegistrationPage = Math.min(registrationPage, registrationPageCount);
  const visibleRegistrations = tournamentRegistrations.slice(
    (safeRegistrationPage - 1) * registrationPageSize,
    safeRegistrationPage * registrationPageSize,
  );
  const registrationStatusCounts = allTournamentRegistrations.reduce<Record<string, number>>((counts, item) => {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
    return counts;
  }, {});
  const pendingApplicationCount = (registrationStatusCounts.PENDING ?? 0)
    + (registrationStatusCounts.NEEDS_SUPPLEMENT ?? 0)
    + (registrationStatusCounts.REVISION_REQUIRED ?? 0)
    + (registrationStatusCounts.WAITLIST ?? 0)
    + (registrationStatusCounts.CONFLICT_ADJUSTMENT_REQUIRED ?? 0);
  const approvedCount = registrationStatusCounts.APPROVED ?? 0;
  const statusQuickFilters: Array<{ value: TeamRegistration["status"] | "SUPPLEMENT" | "APPROVAL_REVIEW_OPEN" | ""; label: string; count: number }> = [
    { value: "", label: "Tất cả", count: allTournamentRegistrations.length },
    { value: "PENDING", label: "Chờ duyệt", count: registrationStatusCounts.PENDING ?? 0 },
    { value: "WAITLIST", label: "Chờ suất", count: (registrationStatusCounts.WAITLIST ?? 0) + allTournamentRegistrations.filter((item) => Boolean(item.waitlistReason) && ["NEEDS_SUPPLEMENT", "REVISION_REQUIRED"].includes(item.status)).length },
    { value: "CONFLICT_ADJUSTMENT_REQUIRED", label: "Hồ sơ cần điều chỉnh", count: registrationStatusCounts.CONFLICT_ADJUSTMENT_REQUIRED ?? 0 },
    { value: "APPROVED", label: "Đã duyệt", count: approvedCount },
    { value: "SUPPLEMENT", label: "Cần bổ sung", count: (registrationStatusCounts.NEEDS_SUPPLEMENT ?? 0) + (registrationStatusCounts.REVISION_REQUIRED ?? 0) },
    { value: "APPROVAL_REVIEW_OPEN", label: "Chờ đội giải trình", count: allTournamentRegistrations.filter((item) => approvalReviewOpenRegistrationIds.includes(item.id)).length },
    { value: "REJECTED", label: "Từ chối", count: registrationStatusCounts.REJECTED ?? 0 },
    { value: "APPROVAL_REVOKED", label: "Thu hồi duyệt", count: registrationStatusCounts.APPROVAL_REVOKED ?? 0 },
    { value: "WITHDRAWN", label: "Đã rút", count: registrationStatusCounts.WITHDRAWN ?? 0 },
  ];
  const selectedRegistrationOption = registrationOptions.find(
    (option) => option.tournament.id === selectedTournamentId,
  );
  const teamById = new Map(teams.map((team) => [team.id, team]));
  const registrationById = new Map(registrations.map((item) => [item.id, item]));
  const detailRegistration = registrationById.get(selectedRegistrationId);
  const detailTeam = detailRegistration ? teamById.get(detailRegistration.teamId) : undefined;
  const latestSubmittedSnapshot = registrationHistory
    .filter((version) => ["SUBMITTED", "RESUBMITTED"].includes(version.action))
    .sort((a, b) => b.version - a.version || b.createdAt.localeCompare(a.createdAt))[0];
  const submittedRosterSnapshot = (latestSubmittedSnapshot?.rosterSnapshot ?? []) as RegistrationPlayerSnapshot[];
  const registrationRosterRows = submittedRosterSnapshot.length
    ? submittedRosterSnapshot.map((snapshot) => ({
      playerId: snapshot.playerId,
      playerName: snapshot.playerName ?? snapshot.fullName ?? null,
      studentId: snapshot.studentId ?? null,
      birthDate: snapshot.birthDate ?? null,
      jerseyNumber: snapshot.jerseyNumber ?? null,
      position: snapshot.position ?? null,
      lineupRole: snapshot.lineupRole ?? "SUBSTITUTE" as const,
      isGoalkeeper: snapshot.isGoalkeeper ?? false,
      competitionRole: snapshot.competitionRole ?? "PLAYER",
      roster: rosters.find((entry) => entry.playerId === snapshot.playerId),
    }))
    : rosters.map((entry) => ({
      playerId: entry.playerId,
      playerName: entry.playerNameSnapshot ?? null,
      studentId: entry.studentIdSnapshot ?? null,
      birthDate: null,
      jerseyNumber: entry.jerseyNumberSnapshot ?? null,
      position: entry.positionSnapshot ?? null,
      lineupRole: entry.lineupRole,
      isGoalkeeper: entry.isGoalkeeper,
      competitionRole: entry.competitionRole ?? "PLAYER",
      roster: entry,
    }));
  const filteredRegistrationRosterRows = registrationRosterRows.filter((row) => {
    const player = players.find((item) => item.id === row.playerId);
    return `${row.playerName ?? player?.fullName ?? ""} ${row.studentId ?? player?.studentId ?? ""} ${row.jerseyNumber ?? player?.jerseyNumber ?? ""}`
      .toLocaleLowerCase("vi").includes(rosterPlayerSearch.trim().toLocaleLowerCase("vi"));
  });
  const selectedRosterSnapshot = registrationRosterRows.find((row) => row.playerId === selectedRosterPlayerId);
  const selectedRosterPlayer = selectedRosterPlayerId ? players.find((player) => player.id === selectedRosterPlayerId) : undefined;

  const handleLinkSelectedTeam = async () => {
    if (!selectedTeam || selectedTeam.institutionId || linkingSchool) return;
    setLinkingSchool(true);
    setError(null);
    try {
      const { team } = await linkTeamToVerifiedSchool(selectedTeam.id);
      setTeams((current) => current.map((item) => item.id === team.id ? team : item));
      onNotice(`Đã liên kết ${team.name} với trường đã xác minh trên hồ sơ đội trưởng.`);
    } catch (linkError) {
      setError(linkError instanceof Error ? linkError.message : "Không thể liên kết đội với trường.");
    } finally {
      setLinkingSchool(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (mode === "captain") {
        const teamResult = await getMyManagedTeams();
        setTeams(teamResult.teams);
        setTournaments([]);
        setRegistrationOptions([]);
        setRegistrations([]);
        setSelectedTournamentId("");
        setSelectedTeamId((current) =>
          teamResult.teams.some((item) => item.id === initialTeamId)
            ? initialTeamId!
            : teamResult.teams.some((item) => item.id === current)
            ? current
            : teamResult.teams[0]?.id ?? "",
        );
      } else {
        const tournamentList = await Promise.all(
          assignedTournaments.map(async (item) => (await getTournament(item.id)).tournament),
        );
        setTournaments(tournamentList);
        setSelectedTournamentId((current) =>
          tournamentList.some((item) => item.id === current)
            ? current
            : tournamentList[0]?.id ?? "",
        );
        // Refreshing the BTC panel must refetch registrations even when the
        // selected tournament did not change. Clearing the rows here used to
        // leave the panel empty because the registration effect only depends
        // on selectedTournamentId and filter values.
        setRegistrationReloadRevision((revision) => revision + 1);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được dữ liệu đăng ký giải.");
    } finally {
      setLoading(false);
    }
  }, [assignedTournaments, initialTeamId, initialTournamentId, mode]);

  useEffect(() => {
    if (mode !== "captain") {
      setRegistrationOptions([]);
      setLoadingRegistrationOptions(false);
      return;
    }
    const team = teams.find((item) => item.id === selectedTeamId);
    if (!team?.institutionId) {
      setRegistrationOptions([]);
      setTournaments([]);
      setSelectedTournamentId("");
      setLoadingRegistrationOptions(false);
      return;
    }
    let active = true;
    setLoadingRegistrationOptions(true);
    setError(null);
    Promise.allSettled([getTournamentRegistrationOptions(team.institutionId), getMyTeamRegistrations(team.id)])
      .then(async ([optionsResult, registrationsResult]) => {
        if (!active) return;
        if (optionsResult.status === "rejected") throw optionsResult.reason;
        const { options } = optionsResult.value;
        // Registration history is useful for showing an existing application, but a
        // failure to load it must not prevent the captain from choosing a tournament.
        const teamRegistrations = registrationsResult.status === "fulfilled"
          ? registrationsResult.value.registrations
          : [];
        setRegistrations(teamRegistrations);
        const existingTournaments = await Promise.all(teamRegistrations.map(async (registration) => {
          try {
            return (await getTournament(registration.tournamentId)).tournament;
          } catch {
            return null;
          }
        }));
        const combined = [...existingTournaments.filter((item): item is Tournament => item !== null), ...options.map((option) => option.tournament)]
          .filter((tournament, index, all) => all.findIndex((item) => item.id === tournament.id) === index);
        setRegistrationOptions(options);
        setTournaments(combined);
        setSelectedTournamentId((current) =>
          combined.some((item) => item.id === initialTournamentId)
            ? initialTournamentId!
            : combined.some((item) => item.id === current)
            ? current
            : combined[0]?.id ?? "",
        );
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Không tải được giải đủ điều kiện.");
      })
      .finally(() => {
        if (active) setLoadingRegistrationOptions(false);
      });
    return () => { active = false; };
  }, [initialTournamentId, mode, selectedTeamId, teams]);

  useEffect(() => {
    if (mode !== "captain" || !selectedTeamId) return;
    let active = true;
    getPlayers(selectedTeamId).then(({ players: teamPlayers }) => {
      if (active) setPlayers(teamPlayers.filter((player) => !player.leftAt));
    }).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : "Không tải được danh sách cầu thủ của đội.");
    });
    return () => { active = false; };
  }, [mode, selectedTeamId]);

  useEffect(() => {
    if (mode !== "btc") {
      setRegistrations([]);
      setSchoolCounts([]);
      return;
    }
    if (!selectedTournamentId) {
      setRegistrations([]);
      setSchoolCounts([]);
      setTeams([]);
      return;
    }
    let active = true;
    setLoading(true);
    Promise.all([getTournamentRegistrations(selectedTournamentId), getTournamentWithdrawalRequests(selectedTournamentId)])
      .then(async ([{ registrations: result, schoolCounts: counts }, { withdrawalRequests: withdrawals }]) => {
        const [teamList, approvalReviewStatuses] = await Promise.all([
          Promise.all(
          [...new Set([...result, ...withdrawals].map((registration) => registration.teamId))].map(async (teamId) =>
            (await getTeam(teamId)).team,
          )),
          Promise.all(result.filter((registration) => ["APPROVED", "APPROVAL_REVOKED", "REJECTED", "WITHDRAWN"].includes(registration.status)).map(async (registration) => {
            const { reviews } = await getTeamRegistrationApprovalReviews(registration.id);
            return { registrationId: registration.id, reviews };
          })),
        ]);
        if (!active) return;
        setRegistrations(result);
        setApprovalReviewsByRegistrationId(Object.fromEntries(approvalReviewStatuses.map((item) => [item.registrationId, item.reviews])));
        setApprovalReviewOpenRegistrationIds(approvalReviewStatuses.filter((item) => item.reviews.some((review) => review.status === "OPEN")).map((item) => item.registrationId));
        setWithdrawalRequests(withdrawals);
        setSchoolCounts(counts);
        setTeams(teamList);
        setSelectedRegistrationId((current) =>
          result.some((item) => item.id === current) ? current : "",
        );
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Không tải được hồ sơ đăng ký.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [
    mode,
    registrationReloadRevision,
    selectedTournamentId,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const refresh = () => setRegistrationReloadRevision((revision) => revision + 1);
    window.addEventListener(NOTIFICATION_REALTIME_EVENT, refresh);
    return () => window.removeEventListener(NOTIFICATION_REALTIME_EVENT, refresh);
  }, []);

  // Withdrawal requests are created in Organization Service while the BTC
  // workspace is scoped to a tournament. Refresh just this queue periodically
  // so an open review screen receives new requests without forcing a full
  // registrations/roster reload or requiring the organizer to press Refresh.
  useEffect(() => {
    if (mode !== "btc" || !selectedTournamentId) return;
    let active = true;
    const refreshWithdrawalQueue = () => {
      getTournamentWithdrawalRequests(selectedTournamentId)
        .then(({ withdrawalRequests: items }) => {
          if (active) setWithdrawalRequests(items);
        })
        .catch(() => undefined);
    };
    const interval = window.setInterval(refreshWithdrawalQueue, 15_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [mode, selectedTournamentId]);

  useEffect(() => {
    const captainRegistration = selectedTeamRegistration;
    if (mode === "captain" && (!captainRegistration || !selectedTeamId || !selectedTournamentId)) {
      setRosters([]); return;
    }
    if (mode === "btc" && !selectedRegistrationId) {
      setRosters([]);
      setPlayers([]);
      setRegistrationDetailLoading(false);
      return;
    }
    const registration = mode === "btc" ? registrationById.get(selectedRegistrationId) : captainRegistration;
    if (!registration) return;
    let active = true;
    setRegistrationDetailLoading(mode === "btc");
    const loadRoster = getTournamentRosters(registration.tournamentId, registration.teamId);
    const loadPlayers = mode === "btc" ? getPlayers(registration.teamId, true) : null;
    Promise.all([loadRoster, loadPlayers]).then(([rosterResult, playerResult]) => {
      if (!active) return;
      setRosters(rosterResult.rosters);
      if (mode === "captain") {
        // The generic team roster can contain every club member. It is not the
        // tournament roster and must never seed the invitation selection/counts.
        const registration = captainRegistration;
        if (registration?.notes) setRegistrationNotes(registration.notes);
      }
      if (playerResult) setPlayers(playerResult.players);
    }).catch((err: unknown) => {
      if (active) setError(err instanceof Error ? err.message : "Không tải được roster.");
    }).finally(() => {
      if (active) setRegistrationDetailLoading(false);
    });
    return () => {
      active = false;
    };
  }, [mode, selectedRegistrationId, registrations, selectedTeamId, selectedTeamRegistration, selectedTournamentId]);

  useEffect(() => {
    if (mode !== "captain" || !selectedTeamId || !selectedTournamentId) { setInvitations([]); return; }
    let active = true;
    const refresh = () => {
      getTeamTournamentInvitations(selectedTeamId, selectedTournamentId)
        .then(({ invitations: items }) => { if (active) setInvitations(items); })
        .catch(() => undefined);
      getTeamPlayerTournamentWithdrawals(selectedTeamId, selectedTournamentId)
        .then(({ withdrawalRequests }) => { if (active) setPlayerWithdrawalRequests(withdrawalRequests); })
        .catch(() => undefined);
      getTournamentEligiblePlayers(selectedTeamId, selectedTournamentId)
        .then(({ eligiblePlayerIds: eligible, unavailablePlayerIds: unavailable }) => {
          if (active) { setEligiblePlayerIds(eligible); setUnavailablePlayerIds(unavailable); setAvailabilityError(null); }
        })
        .catch((err: unknown) => {
          if (active) setAvailabilityError(err instanceof Error ? err.message : "Không thể xác minh quyền tham gia của cầu thủ.");
        });
    };
    refresh();
    const refreshTimer = window.setInterval(refresh, 5000);
    return () => { active = false; window.clearInterval(refreshTimer); };
  }, [mode, selectedTeamId, selectedTournamentId]);

  useEffect(() => {
    if (mode !== "captain" || !selectedTeamId || !selectedTournamentId) {
      setEligiblePlayerIds([]);
      setUnavailablePlayerIds([]);
      setAvailabilityLoading(false);
      setAvailabilityError(null);
      return;
    }
    let active = true;
    setAvailabilityLoading(true);
    setAvailabilityError(null);
    setEligiblePlayerIds([]);
    setUnavailablePlayerIds([]);
    getTournamentEligiblePlayers(selectedTeamId, selectedTournamentId)
      .then(({ eligiblePlayerIds: eligible, unavailablePlayerIds: unavailable }) => {
        if (active) { setEligiblePlayerIds(eligible); setUnavailablePlayerIds(unavailable); }
      })
      .catch((err: unknown) => { if (active) { setAvailabilityError(err instanceof Error ? err.message : "Không kiểm tra được cầu thủ đã được duyệt ở giải trùng lịch."); setError("Không thể xác minh lịch cầu thủ. Tạm khóa gửi hồ sơ cho đến khi tải lại kiểm tra thành công."); } })
      .finally(() => { if (active) setAvailabilityLoading(false); });
    return () => { active = false; };
  }, [mode, selectedTeamId, selectedTournamentId, registrationReloadRevision]);

  useEffect(() => {
    if (mode !== "btc" || !selectedRegistrationId) { setRegistrationHistory([]); setRegistrationHistoryLoading(false); return; }
    let active = true;
    setRegistrationHistoryLoading(true);
    getTeamRegistrationHistory(selectedRegistrationId)
      .then(({ versions }) => { if (active) setRegistrationHistory(versions); })
      .catch((err: unknown) => { if (active) setError(err instanceof Error ? err.message : "Không tải được lịch sử hồ sơ đội."); })
      .finally(() => { if (active) setRegistrationHistoryLoading(false); });
    return () => { active = false; };
  }, [mode, selectedRegistrationId]);

  useEffect(() => {
    if (mode !== "btc" || !selectedRegistrationId) { setRegulations([]); setRegulationsLoading(false); return; }
    const registration = registrations.find((item) => item.id === selectedRegistrationId);
    if (!registration) return;
    let active = true;
    setRegulationsLoading(true);
    getTournamentRegulations(registration.tournamentId)
      .then(({ regulations: items }) => { if (active) setRegulations(items); })
      .catch((err: unknown) => { if (active) setError(err instanceof Error ? err.message : "Không tải được điều lệ giải."); })
      .finally(() => { if (active) setRegulationsLoading(false); });
    return () => { active = false; };
  }, [mode, selectedRegistrationId, registrations]);

  async function refreshRoster() {
    if (!selectedTournamentId || !selectedTeamId) return;
    const [{ rosters: entries }, { players: teamPlayers }] = await Promise.all([
      getTournamentRosters(selectedTournamentId, selectedTeamId), getPlayers(selectedTeamId),
    ]);
    setRosters(entries); setPlayers(teamPlayers);
  }

  async function handleSendInvitations() {
    if (!selectedTeamId || !selectedTournamentId || !selectedRoster.length) return;
    setSubmitting(true); setError(null);
    try {
      const payload = selectedRoster.map(([playerId, selection]) => {
        const player = players.find((entry) => entry.id === playerId)!;
        return { playerId, competitionRole: selection.competitionRole,
          lineupRole: selection.role, isGoalkeeper: selection.goalkeeper,
          proposedJerseyNumber: selection.jerseyNumber, position: selection.position };
      });
      if (selectedTeamRegistration && ["PENDING", "REJECTED"].includes(selectedTeamRegistration.status)) {
        const draftRoster = Object.entries(submittedLineup).map(([playerId, selection]) => ({
          playerId, competitionRole: selection.competitionRole, lineupRole: selection.role,
          isGoalkeeper: selection.goalkeeper, proposedJerseyNumber: selection.jerseyNumber, position: selection.position,
        }));
        await saveTournamentRegistrationDraft(selectedTeamId, selectedTournamentId, draftRoster, registrationNotes.trim());
      }
      const result = await createTournamentInvitations(selectedTeamId, selectedTournamentId, payload, registrationNotes.trim());
      setInvitations((current) => [...result.invitations, ...current.filter((old) => !result.invitations.some((item) => item.player_id === old.player_id))]);
      setSubmittedLineup((current) => { const next = { ...current }; selectedRoster.forEach(([playerId]) => delete next[playerId]); return next; });
      setCaptainRegistrationTab("invitations");
      onNotice(`Đã gửi ${result.invitations.length} lời mời; thông báo đã được xếp hàng gửi đến tài khoản cầu thủ.`);
    } catch (err) { setError(err instanceof Error ? err.message : "Không gửi được lời mời."); }
    finally { setSubmitting(false); }
  }

  async function handleSaveRegistrationDraft() {
    if (!selectedTeamId || !selectedTournamentId || savingRegistrationDraft) return;
    setSavingRegistrationDraft(true);
    setError(null);
    try {
      const rosterByPlayer = new Map(acceptedInvitations.map((entry) => {
        const selection = submittedLineup[entry.player_id];
        return [entry.player_id, {
        playerId: entry.player_id,
        competitionRole: selection?.competitionRole ?? entry.competition_role,
        lineupRole: selection?.role ?? entry.lineup_role,
        isGoalkeeper: selection?.goalkeeper ?? entry.is_goalkeeper,
        proposedJerseyNumber: selection?.jerseyNumber ?? entry.proposed_jersey_number,
        position: selection?.position ?? entry.position_snapshot,
      }] as const;
      }));
      selectedRoster.forEach(([playerId, selection]) => rosterByPlayer.set(playerId, {
        playerId,
        competitionRole: selection.competitionRole,
        lineupRole: selection.role,
        isGoalkeeper: selection.goalkeeper,
        proposedJerseyNumber: selection.jerseyNumber,
        position: selection.position,
      }));
      const roster = [...rosterByPlayer.values()];
      await saveTournamentRegistrationDraft(selectedTeamId, selectedTournamentId, roster, registrationNotes.trim());
      setHasRegistrationDraft(true);
      onNotice(`Đã lưu nháp ${roster.length} cầu thủ cho ${selectedTournament?.name ?? "giải đấu"}. Chưa gửi lời mời cho cầu thủ.`);
    } catch (err) { setError(err instanceof Error ? err.message : "Không lưu được bản nháp đăng ký."); }
    finally { setSavingRegistrationDraft(false); }
  }

  async function handleInvitationAction(invitation: TournamentPlayerInvitation, action: "remind" | "cancel") {
    if (!selectedTeamId || !selectedTournamentId) return;
    setSubmitting(true); setError(null);
    try {
      const { invitation: updated } = await manageTeamTournamentInvitation(selectedTeamId, selectedTournamentId, invitation.id, action);
      setInvitations((current) => current.map((item) => item.id === updated.id ? updated : item));
      onNotice(action === "remind" ? "Đã gửi nhắc nhở cầu thủ." : "Đã thu hồi lời mời.");
    } catch (err) { setError(err instanceof Error ? err.message : "Không cập nhật được lời mời."); }
    finally { setSubmitting(false); }
  }

  async function handlePlayerWithdrawalDecision(request: PlayerTournamentWithdrawalRequest, decision: "APPROVED" | "REJECTED") {
    setPlayerWithdrawalDecision({ request, decision });
    setPlayerWithdrawalDecisionNote("");
  }

  async function submitPlayerWithdrawalDecision() {
    if (!playerWithdrawalDecision) return;
    const { request, decision } = playerWithdrawalDecision;
    const note = playerWithdrawalDecisionNote.trim();
    if (decision === "REJECTED" && note.length < 5) { setError("Cần ghi lý do từ chối ít nhất 5 ký tự."); return; }
    setSubmitting(true); setError(null);
    try {
      const result = await decidePlayerTournamentWithdrawal(request.id, decision, note);
      setPlayerWithdrawalRequests((current) => current.map((item) => item.id === request.id ? result.withdrawalRequest : item));
      if (decision === "APPROVED") {
        if (selectedTeamId && selectedTournamentId) {
          const [invitationResult, registrationResult, draftResult, requestResult] = await Promise.all([
            getTeamTournamentInvitations(selectedTeamId, selectedTournamentId),
            getRegistrationIfPresent(selectedTeamId, selectedTournamentId),
            getTournamentRegistrationDraft(selectedTeamId, selectedTournamentId),
            getTeamPlayerTournamentWithdrawals(selectedTeamId, selectedTournamentId),
          ]);
          setInvitations(invitationResult.invitations);
          setPlayerWithdrawalRequests(requestResult.withdrawalRequests);
          if (registrationResult?.registration) setRegistrations((current) => [registrationResult.registration, ...current.filter((item) => item.id !== registrationResult.registration.id)]);
          if (registrationResult?.registration.status === "PENDING") setEditingSubmittedRegistration(true);
          if (draftResult.draft) {
            setHasRegistrationDraft(true);
            setSubmittedLineup(Object.fromEntries(draftResult.draft.roster.map((entry) => [entry.playerId, {
              role: entry.lineupRole, goalkeeper: entry.isGoalkeeper, competitionRole: entry.competitionRole,
              jerseyNumber: entry.proposedJerseyNumber, position: entry.position,
            }])));
            setRegistrationNotes(draftResult.draft.notes);
          }
          setCaptainRegistrationTab("roster");
          setEditingSubmittedRegistration(registrationResult?.registration.status === "PENDING");
        } else {
          setInvitations((current) => current.map((item) => item.id === request.invitationId ? { ...item, status: "WITHDRAWN" } : item));
        }
      }
      setPlayerWithdrawalDecision(null);
      onNotice(decision === "APPROVED" ? "Đã chấp thuận yêu cầu rút. Hồ sơ vẫn PENDING; bản DRAFT_CHANGES đã mở và BTC tạm thời không thể duyệt phiên bản cũ." : "Đã từ chối yêu cầu rút; cầu thủ vẫn thuộc roster.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không xử lý được yêu cầu rút.");
      if (selectedTeamId && selectedTournamentId) {
        try {
          const [requestResult, invitationResult, registrationResult] = await Promise.all([
            getTeamPlayerTournamentWithdrawals(selectedTeamId, selectedTournamentId),
            getTeamTournamentInvitations(selectedTeamId, selectedTournamentId),
            getRegistrationIfPresent(selectedTeamId, selectedTournamentId),
          ]);
          setPlayerWithdrawalRequests(requestResult.withdrawalRequests);
          setInvitations(invitationResult.invitations);
          if (registrationResult?.registration) setRegistrations((current) => [registrationResult.registration, ...current.filter((item) => item.id !== registrationResult.registration.id)]);
        } catch { /* Keep the original operation error; the next manual refresh can retry the reads. */ }
      }
    }
    finally { setSubmitting(false); }
  }

  async function retryPlayerWithdrawalSync(request: PlayerTournamentWithdrawalRequest) {
    setSubmitting(true); setError(null);
    try {
      const result = await decidePlayerTournamentWithdrawal(request.id, "APPROVED", request.decisionNote ?? "");
      setPlayerWithdrawalRequests((current) => current.map((item) => item.id === request.id ? result.withdrawalRequest : item));
      onNotice("Đã đồng bộ lại quyền tham gia và roster.");
    } catch (err) { setError(err instanceof Error ? err.message : "Chưa đồng bộ được quyền tham gia; hãy thử lại."); }
    finally { setSubmitting(false); }
  }

  async function handleRegister() {
    if (!selectedTournamentId || !selectedTeamId) return;
    setSubmitting(true);
    setError(null);
    try {
      let registration: TeamRegistration;
      let currentRegistration = selectedTeamRegistration;
      // A captain can arrive here immediately after approving a player withdrawal.
      // Fetch the authoritative registration before choosing create vs resubmit so
      // stale panel state can never create a duplicate application.
      if (!currentRegistration && editingSubmittedRegistration) {
        currentRegistration = (await getMyTeamRegistration(selectedTeamId, selectedTournamentId)).registration;
        setRegistrations((current) => [currentRegistration!, ...current.filter((item) => item.id !== currentRegistration!.id)]);
      }
      if (currentRegistration && (["REVISION_REQUIRED", "NEEDS_SUPPLEMENT", "CONFLICT_ADJUSTMENT_REQUIRED"].includes(currentRegistration.status)
        || (currentRegistration.status === "PENDING" && editingSubmittedRegistration)
        || (currentRegistration.status === "REJECTED" && currentRegistration.resubmissionAllowed))) {
        registration = (await resubmitTeamRegistration(currentRegistration.id)).registration;
      } else {
        if (currentRegistration) throw new Error("Hồ sơ này đã tồn tại. Hãy tải lại dữ liệu trước khi gửi lại để tránh tạo hồ sơ trùng.");
        const accepted = invitations.filter((entry) => entry.status === "ACCEPTED" && !unavailablePlayerIds.includes(entry.player_id));
        const roster = accepted.map((entry) => ({ playerId: entry.player_id, lineupRole: entry.lineup_role, isGoalkeeper: entry.is_goalkeeper }));
        registration = (await createTeamRegistration({ tournamentId: selectedTournamentId, teamId: selectedTeamId, notes: registrationNotes.trim() || undefined, roster })).registration;
      }
      await deleteTournamentRegistrationDraft(selectedTeamId, selectedTournamentId).catch(() => undefined);
      setHasRegistrationDraft(false);
      onNotice("Đã gửi hồ sơ đăng ký giải. BTC sẽ cập nhật kết quả xét duyệt.");
      setRegistrations((current) => [
        registration,
        ...current.filter((item) => item.id !== registration.id),
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không đăng ký được đội vào giải.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmitRegistrationChange(kind = changeRequestKind) {
    if (!selectedTeamRegistration || !changeRequestReason.trim()) return;
    setSubmitting(true); setError(null);
    try {
      const playerIds = changeRosterPlayerIds;
      await createRegistrationChangeRequest(selectedTeamRegistration.id, kind, playerIds, changeRequestReason.trim());
      const {changeRequests: history} = await getRegistrationChangeRequests(selectedTeamRegistration.id);
      setRegistrationChangeHistory(history);
      setChangeRequestReason("");
      onNotice(kind === "LOCKED_PLAYER_ADDITION" ? "Đã gửi yêu cầu bổ sung cầu thủ cho BTC." : "Đã gửi đề xuất chỉnh sửa hồ sơ đã duyệt cho BTC.");
    } catch (err) { setError(err instanceof Error ? err.message : "Không gửi được yêu cầu thay đổi roster."); }
    finally { setSubmitting(false); }
  }

  async function handleChangeRequestDecision(request: RegistrationChangeRequest, decisionValue: "APPROVED"|"REJECTED") {
    const note = window.prompt(decisionValue === "APPROVED" ? "Ghi căn cứ chấp thuận:" : "Nhập lý do từ chối:")?.trim() ?? "";
    if (!note) return;
    setSubmitting(true); setError(null);
    try {
      const {changeRequest} = await decideRegistrationChangeRequest(request.id, decisionValue, note);
      setChangeRequests((current) => current.map((item) => item.id === request.id ? changeRequest : item));
      const {registrations: refreshed} = await getTournamentRegistrations(selectedTournamentId);
      setRegistrations((current) => [...refreshed, ...current.filter((item) => item.tournamentId !== selectedTournamentId)]);
      onNotice(decisionValue === "APPROVED" ? "Đã chấp thuận thay đổi roster." : "Đã từ chối yêu cầu thay đổi roster.");
    } catch (err) { setError(err instanceof Error ? err.message : "Không quyết định được yêu cầu."); }
    finally { setSubmitting(false); }
  }

  const formationSize = selectedTournament?.footballFormat ?? 7;
  const selectedRoster = Object.entries(submittedLineup).filter(([playerId]) =>
    eligiblePlayerIds.includes(playerId) && !invitations.some((invitation) => invitation.player_id === playerId && ["PENDING", "ACCEPTED"].includes(invitation.status)),
  );
  const acceptedInvitations = [...new Map(invitations
    .filter((entry) => entry.status === "ACCEPTED" && !unavailablePlayerIds.includes(entry.player_id))
    .sort((a, b) => (a.responded_at ?? "").localeCompare(b.responded_at ?? ""))
    .map((entry) => [entry.player_id, entry])).values()].map((entry) => {
      const selection = editingSubmittedRegistration ? submittedLineup[entry.player_id] : undefined;
      return selection ? {
        ...entry,
        lineup_role: selection.role,
        is_goalkeeper: selection.goalkeeper,
        proposed_jersey_number: selection.jerseyNumber,
        position_snapshot: selection.position,
      } : entry;
    });
  const pendingInvitations = [...new Map(invitations.filter((entry) => entry.status === "PENDING").map((entry) => [entry.player_id, entry])).values()];
  const starterCount = acceptedInvitations.filter((entry) => entry.lineup_role === "STARTER").length;
  const startingGoalkeeperCount = acceptedInvitations.filter((entry) => entry.lineup_role === "STARTER" && entry.is_goalkeeper).length;
  const matchingPlayers = players.filter((player) => {
    if (availabilityError || player.leftAt || !player.userId || !eligiblePlayerIds.includes(player.id) || unavailablePlayerIds.includes(player.id)) return false;
    if (playerPositionFilter && player.position !== playerPositionFilter) return false;
    if (!`${player.fullName ?? ""} ${player.studentId ?? ""}`.toLocaleLowerCase("vi").includes(playerSearch.trim().toLocaleLowerCase("vi"))) return false;
    return !invitations.some((item) => item.player_id === player.id && ["PENDING", "ACCEPTED"].includes(item.status));
  });
  const rosterRequirements = {
    minPlayers: selectedTournament?.minPlayers ?? 1,
    maxPlayers: selectedTournament?.maxPlayersPerTeam ?? 30,
    minGoalkeepers: selectedTournament?.minGoalkeepers ?? 1,
  };
  const rosterIssues = [
    acceptedInvitations.length < rosterRequirements.minPlayers ? `Cần thêm ${rosterRequirements.minPlayers - acceptedInvitations.length} cầu thủ đã xác nhận.` : "",
    acceptedInvitations.length > rosterRequirements.maxPlayers ? `Vượt tối đa ${rosterRequirements.maxPlayers} cầu thủ.` : "",
    acceptedInvitations.filter((entry) => entry.is_goalkeeper).length < rosterRequirements.minGoalkeepers ? `Cần thêm ${rosterRequirements.minGoalkeepers - acceptedInvitations.filter((entry) => entry.is_goalkeeper).length} thủ môn đã xác nhận.` : "",
    starterCount !== formationSize ? `Đội hình xuất phát cần đúng ${formationSize} cầu thủ đã xác nhận.` : "",
    startingGoalkeeperCount !== 1 ? "Đội hình xuất phát cần đúng 1 thủ môn." : "",
    acceptedInvitations.some((entry) => {
      const player = players.find((candidate) => candidate.id === entry.player_id);
      return !player?.fullName?.trim() || !player.studentId?.trim();
    }) ? "Một số cầu thủ thiếu họ tên hoặc MSSV hợp lệ." : "",
  ].filter(Boolean);
  const rosterReady = rosterIssues.length === 0;
  const registrationPeriodOpen = isRegistrationPeriodOpen(selectedTournament);
  const canEditCurrentSubmission = Boolean(selectedTeamRegistration && registrationPeriodOpen && (
    selectedTeamRegistration.status === "PENDING"
      || selectedTeamRegistration.status === "NEEDS_SUPPLEMENT"
      || selectedTeamRegistration.status === "REVISION_REQUIRED"
      || selectedTeamRegistration.status === "CONFLICT_ADJUSTMENT_REQUIRED"
      || (selectedTeamRegistration.status === "REJECTED" && selectedTeamRegistration.resubmissionAllowed)
  ));

  async function startEditingSubmittedRegistration() {
    if (!selectedTeamRegistration || !selectedTeamId || !selectedTournamentId || !canEditCurrentSubmission) return;
    setSubmitting(true); setError(null);
    try {
      const roster = rosters.map((entry) => {
        const player = players.find((item) => item.id === entry.playerId);
        return [entry.playerId, {
          role: entry.lineupRole, goalkeeper: entry.isGoalkeeper,
          competitionRole: entry.competitionRole ?? "PLAYER",
          jerseyNumber: entry.jerseyNumberSnapshot ?? player?.jerseyNumber ?? null,
          position: entry.positionSnapshot ?? player?.position ?? null,
        }] as const;
      });
      setSubmittedLineup(Object.fromEntries(roster));
      setEditingSubmittedRegistration(true);
      setCaptainRegistrationTab("select");
      const editableRoster = roster.map(([playerId, selection]) => ({ playerId, competitionRole: selection.competitionRole, lineupRole: selection.role, isGoalkeeper: selection.goalkeeper, proposedJerseyNumber: selection.jerseyNumber, position: selection.position }));
      await saveTournamentRegistrationDraft(selectedTeamId, selectedTournamentId, editableRoster, registrationNotes.trim());
      onNotice("Đã mở bản chỉnh sửa riêng. Hồ sơ đã nộp vẫn được giữ nguyên cho BTC đến khi bạn gửi lại.");
    } catch (err) { setError(err instanceof Error ? err.message : "Không thể mở bản chỉnh sửa hồ sơ."); }
    finally { setSubmitting(false); }
  }

  function openDecision(registration: TeamRegistration, status: "APPROVED" | "REJECTED" | "NEEDS_SUPPLEMENT") {
    setSelectedRegistrationId(registration.id);
    setRegistrationDetailTab("application");
    setSelectedRosterPlayerId(null);
    setRegistrationAction(null);
    setDecision({ registration, status });
    setDecisionNote("");
    setDecisionAllowResubmission(false);
    const deadline = new Date(Date.now() + 72 * 60 * 60 * 1000);
    setSupplementDeadline(new Date(deadline.getTime() - deadline.getTimezoneOffset() * 60_000).toISOString().slice(0, 16));
    setDecisionError(null);
  }

  async function confirmDecision() {
    if (!decision) return;
    if (decision.status !== "APPROVED" && !decisionNote.trim()) {
      setDecisionError(decision.status === "REJECTED" ? "Vui lòng ghi lý do từ chối hồ sơ đội." : "Vui lòng mô tả nội dung đội cần bổ sung.");
      return;
    }
    if (decision.status === "NEEDS_SUPPLEMENT" && (!supplementDeadline || new Date(supplementDeadline).getTime() <= Date.now())) {
      setDecisionError("Hạn bổ sung phải là thời điểm trong tương lai.");
      return;
    }
    setSubmitting(true);
    setDecisionError(null);
    try {
      const { registration: updated } = await updateTeamRegistration(
        decision.registration.id,
        decision.status,
        decisionNote.trim() || undefined,
        decision.status === "NEEDS_SUPPLEMENT" ? new Date(supplementDeadline).toISOString() : undefined,
        decision.status === "REJECTED" ? decisionAllowResubmission : undefined,
      );
      setRegistrations((current) => current.map((item) => item.id === updated.id ? updated : item));
      const updatedRows = registrations.map((item) => item.id === updated.id ? updated : item);
      const updatedSchoolCounts = new Map<string, { pending: number; approved: number; total: number }>();
      for (const item of updatedRows) {
        if (!item.institutionId) continue;
        const counts = updatedSchoolCounts.get(item.institutionId) ?? { pending: 0, approved: 0, total: 0 };
        if (item.status === "PENDING") counts.pending += 1;
        if (item.status === "APPROVED") counts.approved += 1;
        if (item.status !== "WITHDRAWN") counts.total += 1;
        updatedSchoolCounts.set(item.institutionId, counts);
      }
      setSchoolCounts((current) => current.map((school) => ({ ...school, ...(updatedSchoolCounts.get(school.institutionId) ?? {}) })));
      setDecision(null);
      setDecisionError(null);
      setRegistrationAction(null);
      setRegistrationActionNote("");
      setRegistrationActionError(null);
      // The next application is chosen by the backend FIFO queue. Refresh all
      // rows so its action buttons do not retain the previous queue flags.
      setRegistrationReloadRevision((revision) => revision + 1);
      setRegistrationHistoryLoading(true);
      void getTeamRegistrationHistory(updated.id).then(({ versions }) => setRegistrationHistory(versions)).catch(() => undefined).finally(() => setRegistrationHistoryLoading(false));
      onNotice(decision.status === "APPROVED" ? "Đã duyệt hồ sơ đội." : decision.status === "REJECTED" ? "Đã từ chối hồ sơ đội." : "Đã gửi yêu cầu bổ sung cho đội.");
    } catch (err) {
      setDecisionError(err instanceof Error ? err.message : "Không cập nhật được hồ sơ đăng ký.");
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmWithdrawalDecision() {
    if (!withdrawalDecision || submitting) return;
    if (withdrawalDecision.decision === "REJECTED" && withdrawalDecisionNote.trim().length < 5) return;
    setSubmitting(true);
    setError(null);
    try {
      const { withdrawalRequest } = await decideTeamWithdrawalRequest(
        withdrawalDecision.request.id,
        withdrawalDecision.decision,
        withdrawalDecisionNote.trim(),
      );
      setWithdrawalRequests((current) => current.map((item) => item.id === withdrawalRequest.id ? withdrawalRequest : item));
      if (withdrawalDecision.decision === "APPROVED") {
        setRegistrations((current) => current.map((item) => item.id === withdrawalRequest.registrationId ? { ...item, status: "WITHDRAWN" } : item));
      }
      setWithdrawalDecision(null);
      setWithdrawalDecisionNote("");
      setRegistrationReloadRevision((revision) => revision + 1);
      onNotice(withdrawalDecision.decision === "APPROVED" ? "Đã chấp thuận rút đội và cập nhật hồ sơ." : "Đã từ chối yêu cầu rút đội.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể lưu quyết định rút đội.");
      // A definitive business rejection may return the item to PENDING so BTC
      // can make a different decision. Close the stale decision modal and
      // reload the queue while keeping the server error visible.
      setWithdrawalDecision(null);
      setWithdrawalDecisionNote("");
      setRegistrationReloadRevision((revision) => revision + 1);
    } finally { setSubmitting(false); }
  }

  async function openApprovalReview(registration: TeamRegistration) {
    setApprovalReviewTarget(registration);
    setApprovalReviewAction(null);
    setApprovalReviewReason("");
    setApprovalReviewDecisionNote("");
    setError(null);
    setApprovalReviewDetailsLoading(true);
    const deadline = new Date(Date.now() + 48 * 60 * 60 * 1000);
    setApprovalReviewDeadline(new Date(deadline.getTime() - deadline.getTimezoneOffset() * 60_000).toISOString().slice(0, 16));
    setSubmitting(false);
    try {
      const [reviewResult, historyResult, rosterResult, playerResult] = await Promise.all([
        getTeamRegistrationApprovalReviews(registration.id),
        getTeamRegistrationHistory(registration.id),
        getTournamentRosters(registration.tournamentId, registration.teamId),
        getPlayers(registration.teamId, true),
      ]);
      const { reviews } = reviewResult;
      setApprovalReviews(reviews);
      setApprovalReviewsByRegistrationId((current) => ({ ...current, [registration.id]: reviews }));
      setApprovalReviewOpenRegistrationIds((current) => {
        const hasOpen = reviews.some((review) => review.status === "OPEN");
        return hasOpen ? (current.includes(registration.id) ? current : [...current, registration.id]) : current.filter((id) => id !== registration.id);
      });
      setRegistrationHistory(historyResult.versions);
      setRosters(rosterResult.rosters);
      setPlayers(playerResult.players);
    } catch (err) { setError(err instanceof Error ? err.message : "Không tải được lịch sử xem xét lại."); }
    finally { setApprovalReviewDetailsLoading(false); }
  }

  async function submitApprovalReviewAction() {
    if (!approvalReviewTarget || !approvalReviewAction || !approvalReviewDeadline || submitting) return;
    if (["REQUEST_EXPLANATION", "REQUEST_SUPPLEMENT", "REVOKE_APPROVAL"].includes(approvalReviewAction) && approvalReviewReason.trim().length < 10) return;
    if (new Date(approvalReviewDeadline).getTime() <= Date.now()) return;
    setSubmitting(true); setError(null);
    try {
      const reason = approvalReviewAction === "RETAIN_APPROVAL"
        ? approvalReviewReason.trim() || "BTC xác nhận đã rà soát và giữ nguyên phê duyệt."
        : approvalReviewReason.trim();
      const { review } = await openTeamRegistrationApprovalReview(approvalReviewTarget.id, reason, new Date(approvalReviewDeadline).toISOString());
      setApprovalReviews((current) => [review, ...current]);
      if (approvalReviewAction === "REQUEST_EXPLANATION") {
        setApprovalReviewOpenRegistrationIds((current) => current.includes(approvalReviewTarget.id) ? current : [...current, approvalReviewTarget.id]);
        setApprovalReviewsByRegistrationId((current) => ({ ...current, [approvalReviewTarget.id]: [review, ...(current[approvalReviewTarget.id] ?? [])] }));
        setApprovalReviewAction(null);
        setApprovalReviewReason("");
        void Promise.all([getTeamRegistrationApprovalReviews(approvalReviewTarget.id), getTeamRegistrationHistory(approvalReviewTarget.id)])
          .then(([reviewResult, historyResult]) => {
            setApprovalReviews(reviewResult.reviews);
            setApprovalReviewsByRegistrationId((current) => ({ ...current, [approvalReviewTarget.id]: reviewResult.reviews }));
            setRegistrationHistory(historyResult.versions);
          }).catch(() => undefined);
        onNotice("Đã gửi yêu cầu giải trình; đội vẫn giữ suất trong khi chờ phản hồi của đội trưởng.");
        return;
      }
      const finalDecision = approvalReviewAction === "REVOKE_APPROVAL" ? "REVOKE_APPROVAL" : "RETAIN_APPROVAL";
      const { review: updated, registration } = await decideTeamRegistrationApprovalReview(review.id, finalDecision, approvalReviewReason.trim());
      setApprovalReviews((current) => current.map((item) => item.id === updated.id ? updated : item));
      setApprovalReviewsByRegistrationId((current) => ({ ...current, [approvalReviewTarget.id]: (current[approvalReviewTarget.id] ?? []).map((item) => item.id === updated.id ? updated : item) }));
      setApprovalReviewOpenRegistrationIds((current) => current.filter((id) => id !== registration.id));
      setRegistrations((current) => current.map((item) => item.id === registration.id ? registration : item));
      setApprovalReviewAction(null);
      setApprovalReviewReason("");
      const updatedRows = registrations.map((item) => item.id === registration.id ? registration : item);
      setRegistrations(updatedRows);
      setSchoolCounts((current) => current.map((school) => {
        const rows = updatedRows.filter((item) => item.institutionId === school.institutionId);
        return { ...school, approved: rows.filter((item) => item.status === "APPROVED").length, pending: rows.filter((item) => item.status === "PENDING").length, total: rows.filter((item) => item.status !== "WITHDRAWN").length };
      }));
      void Promise.all([getTeamRegistrationApprovalReviews(registration.id), getTeamRegistrationHistory(registration.id)])
        .then(([reviewResult, historyResult]) => {
          setApprovalReviews(reviewResult.reviews);
          setApprovalReviewsByRegistrationId((current) => ({ ...current, [registration.id]: reviewResult.reviews }));
          setRegistrationHistory(historyResult.versions);
        }).catch(() => undefined);
      onNotice(finalDecision === "REVOKE_APPROVAL" ? "Đã thu hồi phê duyệt, giải phóng suất và thông báo đội trưởng." : "Đã giữ nguyên phê duyệt và lưu lịch sử xử lý.");
    } catch (err) { setError(err instanceof Error ? err.message : "Không thể mở yêu cầu xem xét lại."); }
    finally { setSubmitting(false); }
  }

  async function resolveApprovalReview(review: ApprovalReview, decision: "RETAIN_APPROVAL" | "REVOKE_APPROVAL" | "REQUEST_SUPPLEMENT"): Promise<boolean> {
    if (!approvalReviewTarget || submitting) return false;
    if (decision !== "RETAIN_APPROVAL" && approvalReviewDecisionNote.trim().length < 10) return false;
    if (decision === "REQUEST_SUPPLEMENT" && (!approvalReviewDeadline || new Date(approvalReviewDeadline).getTime() <= Date.now())) return false;
    setSubmitting(true); setError(null);
    try {
      const { review: updated, registration } = await decideTeamRegistrationApprovalReview(review.id, decision, approvalReviewDecisionNote.trim(), decision === "REQUEST_SUPPLEMENT" ? new Date(approvalReviewDeadline).toISOString() : undefined);
      setApprovalReviews((current) => current.map((item) => item.id === updated.id ? updated : item));
      setApprovalReviewOpenRegistrationIds((current) => current.filter((id) => id !== registration.id));
      setRegistrations((current) => current.map((item) => item.id === registration.id ? registration : item));
      setApprovalReviewDecisionNote("");
      setApprovalReviewsByRegistrationId((current) => ({ ...current, [approvalReviewTarget.id]: (current[approvalReviewTarget.id] ?? []).map((item) => item.id === updated.id ? updated : item) }));
      const updatedRows = registrations.map((item) => item.id === registration.id ? registration : item);
      setSchoolCounts((current) => current.map((school) => {
        const rows = updatedRows.filter((item) => item.institutionId === school.institutionId);
        return { ...school, approved: rows.filter((item) => item.status === "APPROVED").length, pending: rows.filter((item) => item.status === "PENDING").length, total: rows.filter((item) => item.status !== "WITHDRAWN").length };
      }));
      void Promise.all([getTeamRegistrationApprovalReviews(registration.id), getTeamRegistrationHistory(registration.id)])
        .then(([reviewResult, historyResult]) => {
          setApprovalReviews(reviewResult.reviews);
          setApprovalReviewsByRegistrationId((current) => ({ ...current, [registration.id]: reviewResult.reviews }));
          setRegistrationHistory(historyResult.versions);
        }).catch(() => undefined);
      onNotice(decision === "RETAIN_APPROVAL" ? "Đã giữ nguyên phê duyệt." : decision === "REQUEST_SUPPLEMENT" ? "Đã yêu cầu đội giải trình/bổ sung; đội vẫn giữ suất cho đến khi BTC xử lý xong." : "Đã thu hồi phê duyệt, giải phóng suất và lưu lịch sử.");
      return true;
    } catch (err) { setError(err instanceof Error ? err.message : "Không thể hoàn tất xem xét lại."); }
    finally { setSubmitting(false); }
    return false;
  }

  async function submitExistingApprovalReviewAction() {
    if (!activeApprovalReview || !approvalReviewAction) return;
    if (approvalReviewAction === "REQUEST_EXPLANATION") return;
    const decision = approvalReviewAction === "RETAIN_APPROVAL" ? "RETAIN_APPROVAL"
      : approvalReviewAction === "REVOKE_APPROVAL" ? "REVOKE_APPROVAL" : "REQUEST_SUPPLEMENT";
    if (await resolveApprovalReview(activeApprovalReview, decision)) setApprovalReviewAction(null);
  }

  return (
    <section className="panel data-panel tournament-workflow-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{mode === "captain" ? "HỒ SƠ ĐỘI BÓNG" : "CÔNG TÁC GIẢI ĐẤU"}</span>
          <h2>{mode === "captain" ? "Đăng ký đội tham gia giải" : "Xét duyệt đăng ký đội"}</h2>
        </div>
        <button className="text-button" type="button" onClick={() => void load()}>Tải lại</button>
      </div>
      {mode === "captain" ? (
        <div className="form-grid">
          <div className="field registration-context-field"><span>Giải đấu</span><strong>{selectedTournament?.name ?? (loading || loadingRegistrationOptions ? "Đang tải thông tin giải…" : initialTournamentId ? "Không tìm thấy giải theo ngữ cảnh đăng ký" : "Chưa chọn giải đăng ký")}</strong>{selectedTournament ? <small>{tournamentStatusLabels[selectedTournament.status] ?? selectedTournament.status} · {selectedTournament.organizerName ?? "Ban tổ chức"}</small> : null}</div>
          {teams.length > 1 ? (
            <label className="field registration-context-field">
              <span>Đội đăng ký</span>
              <select value={selectedTeamId} onChange={(event) => setSelectedTeamId(event.target.value)}>
                {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
              </select>
              <small>{selectedTeam?.institutionName ?? "Trường chưa được liên kết"}</small>
            </label>
          ) : (
            <div className="field registration-context-field"><span>Đội đăng ký</span><strong>{selectedTeam?.name ?? (loading ? "Đang tải đội…" : "Chưa có đội được quản lý")}</strong><small>{selectedTeam?.institutionName ?? "Trường chưa được liên kết"}</small></div>
          )}
          {!loading && !teams.length ? (
            <div className="field-wide empty-state">
              <h3>Chưa có đội để đăng ký</h3>
              <p>Chỉ đội do bạn điều hành mới có thể nộp hồ sơ giải đấu.</p>
            </div>
          ) : null}
          {selectedTeam && !selectedTeam.institutionId ? (
            <div className="field-wide message-banner message-warning" role="status">
              <div>
                <strong>Đội này chưa có trường liên kết.</strong>
                <p>Liên kết đội với trường đã xác minh trên hồ sơ đội trưởng để tải các giải đủ điều kiện đăng ký.</p>
              </div>
              <button className="button-secondary" type="button" disabled={linkingSchool || submitting} onClick={() => void handleLinkSelectedTeam()}>
                {linkingSchool ? "Đang liên kết…" : "Liên kết trường của tôi"}
              </button>
            </div>
          ) : null}
          {selectedRegistrationOption ? (
            <p className="field-wide form-help">
              Trường hiện có {selectedRegistrationOption.registeredTeamsForInstitution} đội đã đăng ký
              {selectedRegistrationOption.maxTeamsPerInstitution === null
                ? " · không giới hạn riêng theo trường."
                : ` / ${selectedRegistrationOption.maxTeamsPerInstitution} đội tối đa.`}
            </p>
          ) : null}
          {selectedRegistrationOption && !selectedRegistrationOption.eligible ? (
            <div className="field-wide message-banner message-warning" role="status">
              {selectedRegistrationOption.ineligibilityReason ?? "Đội chưa đủ điều kiện đăng ký giải này."}
            </div>
          ) : null}
          {selectedTournament && selectedTeam ? <div className="field-wide message-banner message-info"><strong>Thông tin giải và CLB được lấy từ ngữ cảnh đăng ký</strong><br />BTC: {selectedTournament.organizerName ?? "Ban tổ chức giải"} · {selectedTournament.footballFormat ?? 7} người · {formatViDate(selectedTournament.startDate)} – {formatViDate(selectedTournament.endDate)} · Roster {selectedTournament.minPlayers ?? "—"}–{selectedTournament.maxPlayersPerTeam ?? "—"} cầu thủ, tối thiểu {selectedTournament.minGoalkeepers ?? 1} thủ môn. Lời mời chỉ hợp lệ khi cầu thủ đang thuộc CLB và chưa xác nhận roster ở giải bị trùng thời gian.</div> : null}
          {!tournaments.length && registrationOptions.length ? (
            <div className="field-wide empty-state">
              <h3>Chưa có giải phù hợp</h3>
              {registrationOptions.map((option) => (
                <p key={option.tournament.id}>
                  {option.tournament.name}: {option.ineligibilityReason ?? "Không đủ điều kiện tham gia."}
                </p>
              ))}
            </div>
          ) : null}
          <p className="field-wide form-help">Hồ sơ đăng ký chỉ mở sau khi đủ cầu thủ đã đồng ý lời mời. Cầu thủ đã được duyệt ở giải có lịch trùng sẽ bị ẩn khỏi danh sách chọn.</p>
        </div>
      ) : (
        <>
          <div className="assigned-tournament-info">
            <span className="eyebrow">GIẢI ĐANG QUẢN LÝ</span>
            <strong>{selectedTournament?.name ?? (loading ? "Đang tải thông tin giải…" : "Chưa có giải được phân công")}</strong>
            {selectedTournament ? <span>Trạng thái: {tournamentStatusLabels[selectedTournament.status] ?? selectedTournament.status}</span> : null}
          </div>
          {selectedTournamentId ? (
            <div className="form-grid registration-filters">
              <label className="field">Trường
                <select value={registrationInstitutionFilter} onChange={(event) => setRegistrationInstitutionFilter(event.target.value)}>
                  <option value="">Tất cả trường</option>
                  {schoolCounts.map((school) => (
                    <option key={school.institutionId} value={school.institutionId}>{school.institutionName}</option>
                  ))}
                </select>
              </label>
              <label className="field">Đội / đội trưởng
                <input value={registrationSearch} onChange={(event) => setRegistrationSearch(event.target.value)} placeholder="Tìm tên đội, đội trưởng hoặc trường" />
              </label>
              <div className="button-row field-wide">
                <button className="primary-button" type="button" onClick={() => setAppliedRegistrationSearch(registrationSearch.trim())}>Lọc hồ sơ</button>
                <button className="text-button" type="button" onClick={() => {
                  setRegistrationSearch("");
                  setAppliedRegistrationSearch("");
                  setRegistrationStatusFilter("");
                  setRegistrationInstitutionFilter("");
                }}>Đặt lại</button>
              </div>
            </div>
          ) : null}
          {selectedTournamentId ? <div className="registration-result-summary" aria-live="polite">
            <div className="registration-status-counts">
              {statusQuickFilters.map((filter) => <button
                key={filter.value || "ALL"}
                type="button"
                className={`registration-status-filter${registrationStatusFilter === filter.value ? " active" : ""}`}
                aria-pressed={registrationStatusFilter === filter.value}
                onClick={() => setRegistrationStatusFilter(filter.value)}
              >{filter.label}<strong>{filter.count}</strong></button>)}
            </div>
            <strong className="registration-capacity-summary">Còn {Math.max(0, (selectedTournament?.maxTeams ?? 0) - approvedCount)} / {selectedTournament?.maxTeams ?? "—"} suất chỉ tiêu</strong>
            {selectedTournament && approvedCount >= (selectedTournament.minTeams ?? 2) ? <div className={`registration-lock-actions${selectedTournament.status === "REGISTRATION_CLOSED" ? " registration-lock-ready" : ""}`}>
              {selectedTournament.status === "REGISTRATION_CLOSED" ? <span className="registration-ready-note" role="status">Đã đủ số đội tối thiểu · kiểm tra điều kiện chốt danh sách</span> : null}
              <button className="button-secondary approved-roster-button" type="button" onClick={() => onViewApprovedRoster ? onViewApprovedRoster() : setRegistrationStatusFilter("APPROVED")}>Xem danh sách đã duyệt ({approvedCount})</button>
            </div> : null}
          </div> : null}
          {selectedTournamentId && schoolCounts.length ? (
            <div className="institution-list registration-school-summary">
              {schoolCounts.map((school) => {
                const override = selectedTournament?.institutionTeamLimits?.find(
                  (limit) => limit.institutionId === school.institutionId,
                );
                const cap = override ? override.maxTeams : selectedTournament?.defaultMaxTeamsPerInstitution ?? null;
                return (
                  <article className="institution-row" key={school.institutionId}>
                    <div>
                      <strong>{school.institutionName}</strong>
                      <p>Đã duyệt {school.approved} · Chờ duyệt {school.pending}</p>
                    </div>
                    <strong>{school.approved} / {cap ?? "∞"} đội đã duyệt</strong>
                  </article>
                );
              })}
            </div>
          ) : null}
        </>
      )}
      {error ? <div className="message-banner message-error" role="alert">{error}</div> : null}
      {loading ? <div className="loading-state" role="status">Đang tải dữ liệu…</div> : mode === "btc" ? (
        tournamentRegistrations.length ? (
          <>
          <div className="institution-list">
            {visibleRegistrations.map((registration) => {
              const registrationReviewHistory = approvalReviewsByRegistrationId[registration.id] ?? [];
              const hasOpenReview = registrationReviewHistory.some((review) => ["OPEN", "RESPONDED", "SUPPLEMENT_REQUIRED"].includes(review.status));
              const canStartReview = registration.status === "APPROVED" && canOpenApprovedRegistrationReview(selectedTournament);
              const isReviewingRegistration = registration.status === "PENDING" && selectedRegistrationId === registration.id;
              const queueLabel = isReviewingRegistration
                ? "Đang duyệt"
                : registration.isNextInQueue
                  ? "Chờ đến lượt"
                  : "Chưa đến lượt";
              return <article className="institution-row registration-review-card" key={registration.id}>
                <div>
                  <p className="registration-queue-position"><strong>#{registration.submissionSequence}</strong></p>
                  {registration.waitlistReason ? <span className="status-pill status-waitlist">Chờ suất · {["NEEDS_SUPPLEMENT", "REVISION_REQUIRED"].includes(registration.status) ? "cần bổ sung" : "hồ sơ hoàn thiện"}</span> : null}
                  <span className={`status-pill status-${registration.status.toLowerCase()}`}>{registrationStatusLabels[registration.status]}</span>
                  <h3>{teamById.get(registration.teamId)?.name ?? "Đội bóng"}</h3>
                  <p className="registration-review-meta">{registration.institutionName ?? "Chưa xác định trường"} · {teamById.get(registration.teamId)?.unitName ?? "Chưa khai báo khoa/đơn vị"}</p>
                  <p>Gửi lúc {new Date(registration.submittedAt).toLocaleString("vi-VN")} · Đội hình gửi {registration.rosterCount ?? 0} · Đã xác nhận {registration.confirmedRosterCount ?? 0} cầu thủ</p>
                  <p>Đại diện: {teamById.get(registration.teamId)?.representativeName ?? "—"} · Liên hệ: {teamById.get(registration.teamId)?.contactEmail ?? "—"} / {teamById.get(registration.teamId)?.contactPhone ?? "—"}</p>
                  <p className="registration-review-note">{registration.notes || "Đội chưa gửi ghi chú kèm theo."}</p>
                  {registration.status === "WAITLIST" || registration.waitlistReason ? <p className="registration-review-note">Lý do chờ suất: {registration.waitlistReason === "INSTITUTION_CAPACITY" ? "đã đủ chỉ tiêu theo trường" : registration.waitlistReason === "TOURNAMENT_CAPACITY" ? "đã đủ số đội tối đa của giải" : "giải hoặc trường đã đủ chỉ tiêu"}. {["NEEDS_SUPPLEMENT", "REVISION_REQUIRED"].includes(registration.status) ? "Chưa đủ điều kiện được xét khi có suất; đội trưởng vẫn cần hoàn thiện trước hạn." : "Hồ sơ đã hoàn thiện; BTC có thể xem xét khi phát sinh suất."}</p> : null}
                  {registration.supplementDeadline ? <p>Hạn bổ sung: {new Date(registration.supplementDeadline).toLocaleString("vi-VN")}{registration.supplementCompletedAt ? ` · Hoàn tất bổ sung: ${new Date(registration.supplementCompletedAt).toLocaleString("vi-VN")}` : ""}</p> : null}
                </div>
                <div className="button-row">
                  <button className={`registration-detail-button${registration.status === "PENDING" ? ` queue-${isReviewingRegistration ? "reviewing" : registration.isNextInQueue ? "next" : "waiting"}` : ""}`} type="button" onClick={() => { setDecision(null); setRegistrationAction(null); setRegistrationActionError(null); setRegistrationDetailTab("application"); setSelectedRosterPlayerId(null); setSelectedRegistrationId(registration.id); }}>
                    <span>Xem chi tiết yêu cầu</span>
                    {registration.status === "PENDING" ? <span className="registration-queue-button-state">{queueLabel}</span> : null}
                  </button>
                  {registration.status === "APPROVED" && canStartReview
                    ? <button className="text-button" type="button" disabled={submitting} onClick={() => void openApprovalReview(registration)}>Xem xét lại</button>
                    : registrationReviewHistory.length && (registration.status === "APPROVED" || ["APPROVAL_REVOKED", "REJECTED", "WITHDRAWN"].includes(registration.status))
                      ? <button className="text-button" type="button" disabled={submitting} onClick={() => void openApprovalReview(registration)}>{hasOpenReview ? "Đang xử lý rà soát" : "Lịch sử xem xét lại"}</button>
                      : null}
                </div>
              </article>;
            })}
          </div>
          {registrationPageCount > 1 ? <div className="button-row registration-pagination" aria-label="Phân trang hồ sơ">
            <button className="button-secondary" type="button" disabled={safeRegistrationPage <= 1} onClick={() => setRegistrationPage(safeRegistrationPage - 1)}>Trang trước</button>
            <span>Trang {safeRegistrationPage} / {registrationPageCount} · {tournamentRegistrations.length} hồ sơ</span>
            <button className="button-secondary" type="button" disabled={safeRegistrationPage >= registrationPageCount} onClick={() => setRegistrationPage(safeRegistrationPage + 1)}>Trang sau</button>
          </div> : null}
          </>
        ) : <div className="empty-state registration-empty-state"><span aria-hidden="true">▤</span><h3>Không có hồ sơ phù hợp</h3><p>{registrationStatusFilter || registrationInstitutionFilter || appliedRegistrationSearch ? "Thử xóa một vài bộ lọc để xem thêm hồ sơ." : "Các đội gửi hồ sơ vào giải này sẽ xuất hiện tại đây để BTC xem xét."}</p><button type="button" className="text-button" onClick={() => { setRegistrationSearch(""); setAppliedRegistrationSearch(""); setRegistrationStatusFilter(""); setRegistrationInstitutionFilter(""); }}>Đặt lại bộ lọc</button></div>
      ) : (
        <CaptainRegistrationStatus
          teams={teams}
          tournamentId={selectedTournamentId}
          selectedTeamId={selectedTeamId}
          initialRegistration={registrations.find((item) =>
            item.tournamentId === selectedTournamentId && item.teamId === selectedTeamId,
          ) ?? null}
          onRegistrationChange={(updated) => setRegistrations((current) => current.map((item) => item.id === updated.id ? updated : item))}
        />
      )}
      {mode === "btc" && withdrawalRequests.length ? <section className="panel data-panel withdrawal-request-list">
        <div className="panel-heading"><div><span className="eyebrow">NGOẠI LỆ ĐĂNG KÝ</span><h3>Yêu cầu rút đội</h3><p>Đội đã duyệt vẫn giữ trạng thái cho tới khi BTC quyết định.</p></div></div>
        <div className="institution-list">{withdrawalRequests.map((request) => <article className="institution-row" key={request.id}>
          <div><span className={`status-pill status-${request.status.toLowerCase()}`}>{request.status === "PENDING" ? "Chờ BTC" : request.status === "PROCESSING" ? "Đang đồng bộ quyết định" : request.status === "APPROVED" ? "Đã chấp thuận" : request.status === "CANCELLED" ? "Đội đã hủy" : "Đã từ chối"}</span><h4>{teamById.get(request.teamId)?.name ?? "Đội bóng"}</h4><p>{new Date(request.createdAt).toLocaleString("vi-VN")}</p><p>{request.reason}</p>{request.decisionNote ? <p>Quyết định: {request.decisionNote}</p> : null}</div>
          {request.status === "PENDING" ? <div className="button-row"><button className="primary-button" type="button" disabled={submitting} onClick={() => { setWithdrawalDecision({ request, decision: "APPROVED" }); setWithdrawalDecisionNote(""); }}>Chấp thuận</button><button className="text-button danger-text-button" type="button" disabled={submitting} onClick={() => { setWithdrawalDecision({ request, decision: "REJECTED" }); setWithdrawalDecisionNote(""); }}>Từ chối</button></div> : request.status === "PROCESSING" && request.desiredDecision ? <button className="button-secondary" type="button" disabled={submitting} onClick={() => { setWithdrawalDecision({ request, decision: request.desiredDecision! }); setWithdrawalDecisionNote(request.decisionNote ?? ""); }}>Thử đồng bộ lại quyết định</button> : null}
        </article>)}</div>
      </section> : null}
      {mode === "captain" && selectedTournament && selectedTeam && (!selectedTeamRegistration || ["REVISION_REQUIRED", "NEEDS_SUPPLEMENT", "CONFLICT_ADJUSTMENT_REQUIRED"].includes(selectedTeamRegistration.status) || (editingSubmittedRegistration && ["PENDING", "REJECTED"].includes(selectedTeamRegistration.status)) || selectedTeamRegistration.status === "APPROVED") ? (
        <div className="roster-review">
          <header className="captain-registration-summary">
            <div><span className="eyebrow">HỒ SƠ THAM GIA</span><h3>{selectedTournament.name}</h3><p>{selectedTournament.organizerName ?? "Ban tổ chức"} · {formatViDate(selectedTournament.startDate)} – {formatViDate(selectedTournament.endDate)} · {selectedTournament.footballFormat ?? 7} người</p></div>
            <span className={`status-pill ${registrationPeriodOpen ? "status-approved" : "status-rejected"}`}>{registrationPeriodOpen ? "Đang trong hạn đăng ký" : "Đã đóng / ngoài hạn đăng ký"}</span>
            <div className="captain-registration-facts"><span><small>CLB</small><strong>{selectedTeam.name}</strong></span><span><small>Trường</small><strong>{selectedTeam.institutionName ?? "Chưa liên kết"}</strong></span><span><small>Roster theo điều lệ</small><strong>{rosterRequirements.minPlayers}–{rosterRequirements.maxPlayers} cầu thủ · tối thiểu {rosterRequirements.minGoalkeepers} GK</strong></span><span><small>Hạn đăng ký</small><strong>{formatViDate((selectedTournament.registrationPeriods ?? []).find((period) => period.startDate && period.endDate)?.endDate)}</strong></span></div>
          </header>
          <section className="captain-roster-progress" aria-label="Tiến độ roster">
            <div className="captain-roster-metrics"><article><small>Đã xác nhận / tối thiểu</small><strong>{acceptedInvitations.length} / {rosterRequirements.minPlayers}</strong></article><article><small>Chờ xác nhận</small><strong>{pendingInvitations.length}</strong></article><article><small>Còn thiếu</small><strong>{Math.max(0, rosterRequirements.minPlayers - acceptedInvitations.length)}</strong></article><article><small>Thủ môn</small><strong>{acceptedInvitations.filter((entry) => entry.is_goalkeeper).length} / {rosterRequirements.minGoalkeepers}</strong></article></div>
            <progress max={rosterRequirements.minPlayers} value={Math.min(acceptedInvitations.length, rosterRequirements.minPlayers)} aria-label="Tiến độ số cầu thủ tối thiểu" />
            {rosterIssues.length ? <p className="message-banner message-warning">{rosterIssues.join(" ")}</p> : <p className="message-banner message-success">Roster hiện đáp ứng số lượng và vị trí thủ môn theo điều lệ.</p>}
          </section>
          <nav className="captain-registration-tabs" aria-label="Quản lý hồ sơ đăng ký">
            {([ ["select", `Chọn cầu thủ (${matchingPlayers.length})`], ["invitations", `Lời mời (${invitations.length})`], ["roster", `Roster (${acceptedInvitations.length})`], ["withdrawals", `Yêu cầu rút (${playerWithdrawalRequests.length})`] ] as Array<[CaptainRegistrationTab, string]>).map(([tab, label]) => <button key={tab} type="button" className={captainRegistrationTab === tab ? "active" : ""} aria-current={captainRegistrationTab === tab ? "page" : undefined} onClick={() => setCaptainRegistrationTab(tab)}>{label}</button>)}
          </nav>
          {captainRegistrationTab === "select" ? <section className="captain-registration-tab-panel">
            <div className="form-grid tournament-player-filters"><label className="field">Tìm theo tên hoặc MSSV<input value={playerSearch} onChange={(event) => setPlayerSearch(event.target.value)} placeholder="Nhập tên hoặc mã sinh viên" /></label><label className="field">Vị trí<select value={playerPositionFilter} onChange={(event) => setPlayerPositionFilter(event.target.value)}><option value="">Tất cả vị trí</option><option value="GK">Thủ môn</option><option value="DEF">Hậu vệ</option><option value="MID">Tiền vệ</option><option value="FWD">Tiền đạo</option></select></label><div className="tournament-player-filter-actions"><span>{matchingPlayers.length} cầu thủ đủ điều kiện</span><button className="text-button" type="button" disabled={!matchingPlayers.length} onClick={() => setSubmittedLineup((current) => { const next = { ...current }; matchingPlayers.forEach((player) => { next[player.id] = next[player.id] ?? { role: "SUBSTITUTE", goalkeeper: false, competitionRole: "PLAYER", jerseyNumber: player.jerseyNumber, position: player.position }; }); return next; })}>Chọn tất cả</button></div></div>
            {availabilityError ? <p className="message-banner message-error" role="alert">Không thể xác minh xung đột lịch. Hệ thống tạm khóa lời mời: {availabilityError}</p> : null}
            {availabilityLoading ? <p className="form-help">Đang xác minh cầu thủ theo thời gian tổ chức giải…</p> : <div className="tournament-lineup-list">{matchingPlayers.length ? matchingPlayers.map((player) => { const selection = submittedLineup[player.id]; return <article className="tournament-lineup-row" key={player.id}><label className="tournament-lineup-player"><input type="checkbox" checked={Boolean(selection)} onChange={(event) => setSubmittedLineup((current) => { const next = { ...current }; if (!event.target.checked) delete next[player.id]; else next[player.id] = { role: "SUBSTITUTE", goalkeeper: false, competitionRole: "PLAYER", jerseyNumber: player.jerseyNumber, position: player.position }; return next; })} /><span><strong>{player.fullName ?? "Chưa có họ tên"}</strong><small>MSSV {player.studentId ?? "—"} · Số áo {player.jerseyNumber ?? "—"} · {playerPositionLabels[player.position ?? ""] ?? "Chưa khai báo vị trí"}</small></span></label>{selection ? <div className="tournament-lineup-controls"><select aria-label="Vai trò trong giải" value={selection.competitionRole} onChange={(event) => setSubmittedLineup((current) => ({ ...current, [player.id]: { ...current[player.id], competitionRole: event.target.value as "PLAYER" | "PLAYING_CAPTAIN" | "VICE_CAPTAIN" } }))}><option value="PLAYER">Cầu thủ</option><option value="PLAYING_CAPTAIN">Đội trưởng thi đấu</option><option value="VICE_CAPTAIN">Đội phó</option></select><select aria-label="Vị trí dự kiến" value={selection.position ?? ""} onChange={(event) => setSubmittedLineup((current) => ({ ...current, [player.id]: { ...current[player.id], position: event.target.value || null, goalkeeper: event.target.value === "GK" } }))}><option value="">Chọn vị trí</option><option value="GK">Thủ môn</option><option value="DEF">Hậu vệ</option><option value="MID">Tiền vệ</option><option value="FWD">Tiền đạo</option></select><select aria-label="Vai trò đội hình" value={selection.role} onChange={(event) => setSubmittedLineup((current) => ({ ...current, [player.id]: { ...current[player.id], role: event.target.value as "STARTER" | "SUBSTITUTE" } }))}><option value="STARTER">Đá chính</option><option value="SUBSTITUTE">Dự bị</option></select><input aria-label="Số áo" type="number" min="1" max="99" value={selection.jerseyNumber ?? ""} onChange={(event) => setSubmittedLineup((current) => ({ ...current, [player.id]: { ...current[player.id], jerseyNumber: event.target.value ? Number(event.target.value) : null } }))} placeholder="Số áo" /></div> : null}</article>; }) : <div className="empty-state tournament-player-empty"><h3>Không có cầu thủ phù hợp</h3><p>Cầu thủ đã xác nhận ở giải trùng thời gian và lời mời đang hiệu lực không xuất hiện ở đây.</p></div>}</div>}
            {hasRegistrationDraft && !selectedTeamRegistration ? <button className="text-button danger-text-button" type="button" disabled={savingRegistrationDraft || submitting} onClick={() => { if (!selectedTeamId || !selectedTournamentId) return; setSavingRegistrationDraft(true); void deleteTournamentRegistrationDraft(selectedTeamId, selectedTournamentId).then(() => { setHasRegistrationDraft(false); setSubmittedLineup({}); setRegistrationNotes(""); onNotice("Đã hủy bản nháp đăng ký; đội bóng vẫn được giữ trong CLB."); }).catch((err) => setError(err instanceof Error ? err.message : "Không hủy được bản nháp.")).finally(() => setSavingRegistrationDraft(false)); }}>Hủy bản nháp</button> : null}
            <div className="button-row captain-roster-actions">{selectedTeamRegistration?.status !== "APPROVED" ? <button className="button-secondary" type="button" disabled={savingRegistrationDraft || submitting} onClick={() => void handleSaveRegistrationDraft()}>{savingRegistrationDraft ? "Đang lưu nháp…" : "Lưu nháp"}</button> : <span className="form-help">Roster chính thức chỉ đổi sau khi BTC chấp thuận yêu cầu.</span>}<button className="primary-button" type="button" disabled={submitting || availabilityLoading || Boolean(availabilityError) || selectedRoster.length === 0 || (selectedTeamRegistration?.status === "APPROVED" && ["ROSTER_LOCKED","PREPARING","IN_PROGRESS"].includes(selectedTournament.status) && selectedRoster.length !== 1)} onClick={() => void handleSendInvitations()}>Gửi lời mời ({selectedRoster.length} cầu thủ)</button></div>
          </section> : null}
          {captainRegistrationTab === "invitations" ? <section className="captain-registration-tab-panel"><div className="invitation-status-filters"><label className="field">Lọc trạng thái<select value={playerInvitationFilter} onChange={(event) => setPlayerInvitationFilter(event.target.value as typeof playerInvitationFilter)}><option value="ALL">Tất cả</option><option value="AVAILABLE">Đang hiệu lực</option><option value="PENDING">Chờ xác nhận</option><option value="ACCEPTED">Đã đồng ý</option></select></label><span>{invitations.length} lời mời được lưu</span></div>{invitations.filter((item) => playerInvitationFilter === "ALL" || (playerInvitationFilter === "AVAILABLE" ? ["PENDING", "ACCEPTED"].includes(item.status) : item.status === playerInvitationFilter)).length ? invitations.filter((item) => playerInvitationFilter === "ALL" || (playerInvitationFilter === "AVAILABLE" ? ["PENDING", "ACCEPTED"].includes(item.status) : item.status === playerInvitationFilter)).map((invitation) => <article className="institution-row" key={invitation.id}><div><span className={`status-pill status-${invitation.status.toLowerCase()}`}>{invitation.status === "PENDING" ? "Chờ xác nhận" : invitation.status === "ACCEPTED" ? "Đã đồng ý" : invitation.status === "DECLINED" ? "Đã từ chối" : invitation.status === "EXPIRED" ? "Hết hạn" : invitation.status === "INVALIDATED" ? "Vô hiệu hóa" : invitation.status === "WITHDRAWN" ? "Đã rút" : "Đã hủy"}</span><h4>{invitation.full_name ?? "Cầu thủ"}</h4><p>MSSV {invitation.student_id ?? "—"} · {playerPositionLabels[invitation.position_snapshot ?? ""] ?? "Chưa rõ vị trí"} · Hạn phản hồi {formatViDateTime(invitation.expires_at)}</p>{invitation.status === "INVALIDATED" ? <p>{invitation.status_reason ?? `Trùng lịch với ${invitation.conflict_tournament_name ?? "giải khác"}`}</p> : null}</div>{invitation.status === "PENDING" ? <div className="button-row"><button className="text-button" type="button" disabled={submitting} onClick={() => void handleInvitationAction(invitation, "remind")}>Gửi nhắc lại</button><button className="text-button danger-text-button" type="button" disabled={submitting} onClick={() => void handleInvitationAction(invitation, "cancel")}>Hủy lời mời</button></div> : null}</article>) : <div className="empty-state"><h3>Chưa có lời mời thuộc bộ lọc</h3><p>Lời mời mới gửi sẽ được theo dõi tại đây.</p></div>}</section> : null}
          {captainRegistrationTab === "roster" ? <section className="captain-registration-tab-panel"><div className="roster-condition-row"><span>{acceptedInvitations.length} / {rosterRequirements.minPlayers}–{rosterRequirements.maxPlayers} cầu thủ</span><span>{acceptedInvitations.filter((entry) => entry.is_goalkeeper).length} / {rosterRequirements.minGoalkeepers} thủ môn tối thiểu</span><span>{acceptedInvitations.length > rosterRequirements.maxPlayers ? "Vượt giới hạn" : rosterIssues.length ? "Chưa đạt điều lệ" : "Đạt điều lệ"}</span></div>{editingSubmittedRegistration ? <p className="form-help">Bạn đang sửa bản nháp riêng. Có thể điều chỉnh vai trò đội hình; các thông tin đã xác nhận như số áo, vị trí và thủ môn được giữ nguyên.</p> : null}{acceptedInvitations.length ? <div className="registration-roster-table-wrap"><table className="registration-roster-table"><thead><tr><th>STT</th><th>Họ tên</th><th>MSSV</th><th>Số áo</th><th>Vị trí</th><th>Đội hình</th><th>Trạng thái</th></tr></thead><tbody>{acceptedInvitations.map((entry, index) => { const playerName = entry.full_name ?? players.find((player) => player.id === entry.player_id)?.fullName ?? "Cầu thủ"; return <tr key={entry.id}><td>{index + 1}</td><td>{playerName}</td><td>{entry.student_id ?? players.find((player) => player.id === entry.player_id)?.studentId ?? "—"}</td><td>{entry.proposed_jersey_number ?? "—"}</td><td>{playerPositionLabels[entry.position_snapshot ?? ""] ?? "Chưa khai báo"}</td><td>{editingSubmittedRegistration ? <select aria-label={`Vai trò đội hình ${playerName}`} value={entry.lineup_role} onChange={(event) => setSubmittedLineup((current) => ({ ...current, [entry.player_id]: { ...(current[entry.player_id] ?? { role: entry.lineup_role, goalkeeper: entry.is_goalkeeper, competitionRole: entry.competition_role, jerseyNumber: entry.proposed_jersey_number, position: entry.position_snapshot }), role: event.target.value as "STARTER" | "SUBSTITUTE" } }))}><option value="STARTER">Đá chính</option><option value="SUBSTITUTE">Dự bị</option></select> : entry.lineup_role === "STARTER" ? "Đá chính" : "Dự bị"}</td><td><span className="status-pill status-approved">Đã xác nhận</span></td></tr>; })}</tbody></table></div> : <div className="empty-state"><h3>Chưa có cầu thủ xác nhận</h3><p>Đội trưởng không thể xác nhận thay cầu thủ; roster chỉ tính lời mời đã đồng ý.</p></div>}</section> : null}
          {captainRegistrationTab === "withdrawals" ? <section className="captain-registration-tab-panel">{playerWithdrawalRequests.length ? playerWithdrawalRequests.map((request) => <article className="institution-row" key={request.id}><div><span className={`status-pill status-${request.status.toLowerCase()}`}>{request.status === "PENDING" ? "Chờ đội trưởng" : request.status === "PROCESSING" ? "Đang xử lý" : request.status === "APPROVED" ? "Đã chấp nhận" : "Đã từ chối"}</span><h4>{request.playerName ?? "Cầu thủ"} · {request.position ?? "Chưa rõ vị trí"}</h4><p>{request.reason}</p><p>Gửi lúc {formatViDateTime(request.createdAt)}</p>{request.decisionNote ? <p>Ghi chú quyết định: {request.decisionNote}</p> : null}</div>{request.status === "APPROVED" ? <button className="text-button" type="button" disabled={submitting} onClick={() => void retryPlayerWithdrawalSync(request)}>Đồng bộ lại quyền tham gia</button> : request.status === "PENDING" ? <div className="button-row"><button className="primary-button" type="button" disabled={submitting} onClick={() => void handlePlayerWithdrawalDecision(request, "APPROVED")}>Chấp nhận rút</button><button className="text-button" type="button" disabled={submitting} onClick={() => void handlePlayerWithdrawalDecision(request, "REJECTED")}>Từ chối</button></div> : null}</article>) : <div className="empty-state"><h3>Chưa có yêu cầu rút</h3><p>Yêu cầu mới của cầu thủ sẽ xuất hiện ở đây, kèm lý do và lịch sử xử lý.</p></div>}</section> : null}
          {selectedTeamRegistration && ["REVISION_REQUIRED", "NEEDS_SUPPLEMENT"].includes(selectedTeamRegistration.status) ? <p className="message-banner message-warning">BTC yêu cầu bổ sung: {selectedTeamRegistration.notes}{selectedTeamRegistration.supplementDeadline ? ` · Hạn: ${new Date(selectedTeamRegistration.supplementDeadline).toLocaleString("vi-VN")}` : ""}</p> : null}
          {selectedTeamRegistration?.status === "CONFLICT_ADJUSTMENT_REQUIRED" ? <div className="message-banner message-warning"><strong>Cần điều chỉnh roster do trùng lịch giải</strong><p>Thay cầu thủ bị trùng bằng thành viên khác, gửi lời mời và chờ họ xác nhận trước khi gửi lại hồ sơ.</p><ul>{(selectedTeamRegistration.registrationConflicts ?? []).map((conflict) => <li key={`${conflict.playerId}-${conflict.conflictingTournamentId}`}>{conflict.playerName ?? players.find((player) => player.id === conflict.playerId)?.fullName ?? "Cầu thủ"} đã được duyệt tại {conflict.conflictingTournamentName}.</li>)}</ul><p>Hạn điều chỉnh: {selectedTeamRegistration.adjustmentDeadline ? new Date(selectedTeamRegistration.adjustmentDeadline).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : "trước khi đóng đăng ký"}</p></div> : null}
          {availabilityLoading ? <p className="form-help">Đang kiểm tra quyền tham gia của cầu thủ theo ngày tổ chức các giải…</p> : null}
          {selectedTeamRegistration?.status === "PENDING" ? <p className="message-banner message-info">Hồ sơ đang chờ BTC xét duyệt.</p> : null}
          {selectedTeamRegistration?.status === "APPROVED" ? <><p className="message-banner message-success">Hồ sơ đội đã được BTC duyệt. Mọi thay đổi roster cần được BTC chấp thuận trước khi có hiệu lực.</p><section className="captain-registration-tab-panel"><h3>{["ROSTER_LOCKED","PREPARING","IN_PROGRESS"].includes(selectedTournament.status) ? "Yêu cầu bổ sung cầu thủ sau khi khóa roster" : "Yêu cầu chỉnh sửa hồ sơ đã duyệt"}</h3><p>{["ROSTER_LOCKED","PREPARING","IN_PROGRESS"].includes(selectedTournament.status) ? "Chỉ thêm đúng một cầu thủ mới; Match service chặn nếu vòng bảng cuối đã bắt đầu, cầu thủ đã xuất hiện trong trận hoặc giải chỉ loại trực tiếp." : "Chọn roster đề xuất. Bản chính thức vẫn giữ nguyên trong khi BTC xem xét."}</p><fieldset className="registration-change-roster-select"><legend>Roster đề xuất · {changeRosterPlayerIds.length} cầu thủ đã xác nhận</legend>{acceptedInvitations.map((entry) => <label key={entry.id}><input type="checkbox" checked={changeRosterPlayerIds.includes(entry.player_id)} onChange={(event) => setChangeRosterPlayerIds((current) => event.target.checked ? [...new Set([...current,entry.player_id])] : current.filter((id) => id !== entry.player_id))} /><span>{entry.full_name ?? "Cầu thủ"} · {playerPositionLabels[entry.position_snapshot ?? ""] ?? "Chưa rõ vị trí"}</span></label>)}</fieldset><label className="field">Lý do đề xuất<textarea value={changeRequestReason} maxLength={2000} rows={3} onChange={(event) => setChangeRequestReason(event.target.value)} placeholder="Nêu lý do và căn cứ thay đổi" /></label><button className="primary-button" type="button" disabled={submitting || !changeRequestReason.trim() || changeRosterPlayerIds.length === 0 || registrationChangeHistory.some((item) => item.status === "PENDING" || item.status === "PROCESSING")} onClick={() => void handleSubmitRegistrationChange(["ROSTER_LOCKED","PREPARING","IN_PROGRESS"].includes(selectedTournament.status) ? "LOCKED_PLAYER_ADDITION" : "APPROVED_AMENDMENT")}>{submitting ? "Đang gửi…" : registrationChangeHistory.some((item) => item.status === "PENDING" || item.status === "PROCESSING") ? "Đang chờ BTC xử lý yêu cầu" : ["ROSTER_LOCKED","PREPARING","IN_PROGRESS"].includes(selectedTournament.status) ? `Gửi BTC yêu cầu bổ sung (${changeRosterPlayerIds.length} cầu thủ)` : `Gửi đề xuất chỉnh sửa (${changeRosterPlayerIds.length} cầu thủ)`}</button>{registrationChangeHistory.length ? <div className="registration-change-history"><h4>Lịch sử yêu cầu</h4>{registrationChangeHistory.map((item) => <article key={item.id}><strong>{item.requestKind === "LOCKED_PLAYER_ADDITION" ? "Bổ sung sau khóa roster" : "Chỉnh sửa hồ sơ"} · {item.status}</strong><p>{item.reason}</p><small>{formatViDateTime(item.createdAt)}{item.decisionNote ? ` · BTC: ${item.decisionNote}` : ""}</small></article>)}</div> : null}</section></> : null}
          {(!selectedTeamRegistration || ["REVISION_REQUIRED", "NEEDS_SUPPLEMENT", "CONFLICT_ADJUSTMENT_REQUIRED"].includes(selectedTeamRegistration.status) || editingSubmittedRegistration) ? <>
            {editingSubmittedRegistration && selectedTeamRegistration ? <p className="message-banner message-info"><strong>DRAFT_CHANGES · Hồ sơ vẫn PENDING</strong><br />Đang chỉnh sửa từ phiên bản {selectedTeamRegistration.version ?? 1}. Bản đã gửi được giữ nguyên; BTC không thể duyệt phiên bản cũ cho đến khi bạn gửi lại hoặc hủy chỉnh sửa.</p> : null}
            <footer className="captain-registration-footer"><label className="field">Ghi chú hồ sơ<textarea value={registrationNotes} maxLength={2000} rows={2} onChange={(event) => setRegistrationNotes(event.target.value)} placeholder="Ghi chú cần gửi cùng hồ sơ (không bắt buộc)" /></label><div className="captain-registration-submit"><div>{rosterIssues.length ? <p>{rosterIssues.join(" ")}</p> : <p>Roster đủ điều kiện nộp cho BTC.</p>}</div><button className="primary-button" type="button" disabled={submitting || loading || availabilityLoading || Boolean(availabilityError) || (!selectedRegistrationOption?.eligible && !["REVISION_REQUIRED", "NEEDS_SUPPLEMENT", "CONFLICT_ADJUSTMENT_REQUIRED"].includes(selectedTeamRegistration?.status ?? "") && !editingSubmittedRegistration) || !rosterReady} onClick={() => void handleRegister()}>{submitting ? "Đang gửi…" : selectedTeamRegistration || editingSubmittedRegistration ? `Gửi lại hồ sơ (${acceptedInvitations.length})` : `Gửi hồ sơ BTC (${acceptedInvitations.length})`}</button></div></footer>
          </> : null}
        </div>
      ) : mode === "captain" && selectedTeamRegistration ? <section className="captain-registration-tracking"><span className={`status-pill status-${selectedTeamRegistration.status.toLowerCase()}`}>{registrationStatusLabels[selectedTeamRegistration.status]}</span><h3>Hồ sơ đã được gửi</h3><p>{selectedTeam?.name ?? "Đội bóng"} · {selectedTournament?.name ?? "Giải đấu"}</p><p>{selectedTeamRegistration.status === "REJECTED" ? `Lý do: ${selectedTeamRegistration.notes ?? "BTC không ghi thêm lý do."}` : "Roster đã nộp được giữ nguyên trong lịch sử phiên bản."}</p>{selectedTeamRegistration.submittedAt ? <small>Gửi lúc {formatViDateTime(selectedTeamRegistration.submittedAt)} · Phiên bản {selectedTeamRegistration.version ?? 1}</small> : null}{selectedTeamRegistration.status === "PENDING" ? <p>BTC đang xét duyệt. Nếu còn hạn, bạn có thể tạo bản chỉnh sửa riêng; BTC không thể quyết định hồ sơ cũ trong thời gian bản sửa mở.</p> : null}{selectedTeamRegistration.status === "REJECTED" && !selectedTeamRegistration.resubmissionAllowed ? <p>Quyết định từ chối không cho phép nộp lại hồ sơ này.</p> : null}{canEditCurrentSubmission && !editingSubmittedRegistration ? <div className="button-row"><button className="primary-button" type="button" disabled={submitting || registrationDetailLoading} onClick={() => void startEditingSubmittedRegistration()}>{submitting ? "Đang mở…" : selectedTeamRegistration.status === "PENDING" ? "Cập nhật hồ sơ" : "Chỉnh sửa và nộp lại"}</button></div> : null}{editingSubmittedRegistration ? <button className="text-button" type="button" disabled={submitting} onClick={() => { if (selectedTeamId && selectedTournamentId) void deleteTournamentRegistrationDraft(selectedTeamId, selectedTournamentId).then(() => setEditingSubmittedRegistration(false)).catch((err) => setError(err instanceof Error ? err.message : "Không thể hủy bản chỉnh sửa.")); }}>Hủy bản chỉnh sửa</button> : null}</section> : null}
      {mode === "captain" && selectedTeamRegistration?.status === "PENDING" && !editingSubmittedRegistration && playerWithdrawalRequests.length ? <section className="panel data-panel captain-pending-player-withdrawals"><header><h3>Yêu cầu cầu thủ xin rút</h3><p>Hồ sơ đang chờ BTC; xử lý yêu cầu trước khi hồ sơ có thể được duyệt.</p></header><div className="institution-list">{playerWithdrawalRequests.map((request) => <article className="institution-row" key={request.id}><div><span className={`status-pill status-${request.status.toLowerCase()}`}>{request.status === "PENDING" ? "Chờ đội trưởng" : request.status === "PROCESSING" ? "Đang xử lý" : request.status === "APPROVED" ? "Đã chấp nhận" : "Đã từ chối"}</span><h4>{request.playerName ?? "Cầu thủ"} · {request.position ?? "Chưa rõ vị trí"}</h4><p>{request.reason}</p><small>Gửi lúc {formatViDateTime(request.createdAt)}</small>{request.decisionNote ? <p>Ghi chú quyết định: {request.decisionNote}</p> : null}</div>{request.status === "PENDING" ? <div className="button-row"><button className="primary-button" type="button" disabled={submitting} onClick={() => void handlePlayerWithdrawalDecision(request, "APPROVED")}>Chấp nhận rút</button><button className="text-button" type="button" disabled={submitting} onClick={() => void handlePlayerWithdrawalDecision(request, "REJECTED")}>Từ chối</button></div> : request.status === "APPROVED" ? <button className="text-button" type="button" disabled={submitting} onClick={() => void retryPlayerWithdrawalSync(request)}>Đồng bộ lại quyền tham gia</button> : null}</article>)}</div></section> : null}      {mode === "btc" && selectedTournamentId && changeRequests.length ? <section className="registration-change-requests"><header><h3>Yêu cầu thay đổi roster</h3><span>{changeRequests.filter((item) => item.status === "PENDING" || item.status === "PROCESSING").length} đang chờ</span></header>{changeRequests.map((request) => <article className="institution-row" key={request.id}><div><span className={`status-pill status-${request.status.toLowerCase()}`}>{request.status === "PENDING" ? "Chờ BTC" : request.status === "PROCESSING" ? "Đang đồng bộ quyết định" : request.status === "APPROVED" ? "Đã chấp thuận" : "Đã từ chối"}</span><h4>{request.requestKind === "LOCKED_PLAYER_ADDITION" ? "Bổ sung cầu thủ sau khóa roster" : "Chỉnh sửa hồ sơ đã duyệt"}</h4><p>{request.reason}</p><p>Phiên bản gốc {request.baseVersion} · gửi lúc {formatViDateTime(request.createdAt)}</p><details><summary>Xem roster cũ và đề xuất</summary><p>Roster cũ: {request.previousRoster.map((player) => String(player.fullName ?? player.playerName ?? player.playerId ?? "Cầu thủ")).join(", ")}</p><p>Đề xuất: {request.proposedRoster.map((player) => String(player.fullName ?? player.playerName ?? player.playerId ?? "Cầu thủ")).join(", ")}</p></details>{request.decisionNote ? <p>Ghi chú BTC: {request.decisionNote}</p> : null}</div>{request.status === "PENDING" ? <div className="button-row"><button className="primary-button" type="button" disabled={submitting} onClick={() => void handleChangeRequestDecision(request,"APPROVED")}>Chấp thuận</button><button className="text-button" type="button" disabled={submitting} onClick={() => void handleChangeRequestDecision(request,"REJECTED")}>Từ chối</button></div> : null}</article>)}</section> : null}
      {playerWithdrawalDecision ? <Modal open eyebrow="YÊU CẦU RÚT CẦU THỦ" title={playerWithdrawalDecision.decision === "APPROVED" ? "Chấp thuận cầu thủ rút?" : "Từ chối yêu cầu rút?"} description={playerWithdrawalDecision.decision === "APPROVED" ? "Cầu thủ được gỡ khỏi bản roster chỉnh sửa; hồ sơ đã nộp vẫn giữ PENDING và snapshot cũ được bảo toàn. BTC tạm thời không thể duyệt cho đến khi đội gửi phiên bản mới." : "Cầu thủ vẫn thuộc roster và giữ quyền tham gia giải trùng lịch."} onClose={() => { if (!submitting) setPlayerWithdrawalDecision(null); }}>
        <p><strong>{playerWithdrawalDecision.request.playerName ?? "Cầu thủ"}</strong> · {playerWithdrawalDecision.request.tournamentName ?? selectedTournament?.name ?? "Giải đấu"}</p>
        <p>Lý do cầu thủ: {playerWithdrawalDecision.request.reason}</p>
        <label className="field">{playerWithdrawalDecision.decision === "REJECTED" ? "Lý do từ chối *" : "Ghi chú cho cầu thủ"}<textarea value={playerWithdrawalDecisionNote} maxLength={2000} rows={3} onChange={(event) => setPlayerWithdrawalDecisionNote(event.target.value)} placeholder={playerWithdrawalDecision.decision === "REJECTED" ? "Nhập lý do từ chối (ít nhất 5 ký tự)" : "Ghi chú (không bắt buộc)"} /></label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="modal-actions"><button className="secondary-button" type="button" disabled={submitting} onClick={() => setPlayerWithdrawalDecision(null)}>Quay lại</button><button className="primary-button" type="button" disabled={submitting || (playerWithdrawalDecision.decision === "REJECTED" && playerWithdrawalDecisionNote.trim().length < 5)} onClick={() => void submitPlayerWithdrawalDecision()}>{submitting ? "Đang xử lý…" : playerWithdrawalDecision.decision === "APPROVED" ? "Chấp thuận rút" : "Xác nhận từ chối"}</button></div>
      </Modal> : null}
      {withdrawalDecision ? <Modal open eyebrow="YÊU CẦU RÚT ĐỘI" title={withdrawalDecision.decision === "APPROVED" ? "Chấp thuận rút đội?" : "Từ chối yêu cầu rút đội?"} description="Quyết định được ghi lịch sử và thông báo cho đội trưởng." onClose={() => { if (!submitting) setWithdrawalDecision(null); }}>
        <p>{teamById.get(withdrawalDecision.request.teamId)?.name ?? "Đội bóng"} · {withdrawalDecision.request.reason}</p>
        <label className="field">Ghi chú quyết định / phương án xử lý *<textarea value={withdrawalDecisionNote} maxLength={2000} rows={4} onChange={(event) => setWithdrawalDecisionNote(event.target.value)} placeholder="Ghi căn cứ và phương án theo điều lệ (ít nhất 5 ký tự)" /></label>
        {withdrawalDecision.decision === "APPROVED" ? <p className="form-help">Hồ sơ chỉ chuyển sang Đã rút sau khi Tournament xác nhận cập nhật được. Nếu giải đã xác nhận bảng, công bố lịch hoặc đang thi đấu, hệ thống hiện khóa chấp thuận vì chưa có quy trình điều chỉnh dây chuyền an toàn cho kết quả và nhánh đấu.</p> : null}
        <div className="modal-actions"><button className="secondary-button" type="button" disabled={submitting} onClick={() => setWithdrawalDecision(null)}>Quay lại</button><button className="primary-button" type="button" disabled={submitting || withdrawalDecisionNote.trim().length < 5} onClick={() => void confirmWithdrawalDecision()}>{submitting ? "Đang lưu…" : "Xác nhận quyết định"}</button></div>
      </Modal> : null}
          {approvalReviewTarget ? <Modal open eyebrow="XEM XÉT LẠI PHÊ DUYỆT" title={teamById.get(approvalReviewTarget.teamId)?.name ?? "Hồ sơ đội bóng"} description={teamById.get(approvalReviewTarget.teamId)?.institutionName ?? approvalReviewTarget.institutionName ?? "Chưa xác định trường"} onClose={() => { if (!submitting) { setApprovalReviewTarget(null); setApprovalReviewAction(null); } }} className="approval-review-modal">
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="approval-review-heading">
          <div><span className={`status-pill status-${approvalReviewTarget.status.toLowerCase()}`}>{approvalReviewTarget.status} · {registrationStatusLabels[approvalReviewTarget.status]}</span><span className="approval-review-sequence">Hồ sơ #{approvalReviewTarget.submissionSequence}</span></div>
          <button className="text-button" type="button" onClick={() => { setSelectedRegistrationId(approvalReviewTarget.id); setApprovalReviewTarget(null); setApprovalReviewAction(null); }}>Xem chi tiết hồ sơ đầy đủ</button>
        </div>
        {approvalReviewDetailsLoading ? <p className="muted" role="status">Đang tải thông tin hồ sơ, roster và lịch sử…</p> : <>
          <section className="approval-review-section">
            <h3>Thông tin đăng ký</h3>
            <div className="approval-review-facts">
              <div><small>Trường</small><strong>{teamById.get(approvalReviewTarget.teamId)?.institutionName ?? approvalReviewTarget.institutionName ?? "—"}</strong></div>
              <div><small>Đội trưởng / đại diện</small><strong>{teamById.get(approvalReviewTarget.teamId)?.representativeName ?? "—"}</strong></div>
              <div><small>Liên hệ</small><strong>{teamById.get(approvalReviewTarget.teamId)?.contactEmail ?? "—"}{teamById.get(approvalReviewTarget.teamId)?.contactPhone ? ` · ${teamById.get(approvalReviewTarget.teamId)?.contactPhone}` : ""}</strong></div>
              <div><small>Nộp hồ sơ</small><strong>{formatViDateTime(approvalReviewTarget.submittedAt || approvalReviewTarget.registeredAt)}</strong></div>
              <div><small>Roster xác nhận</small><strong>{approvalReviewTarget.confirmedRosterCount ?? rosters.length} / {approvalReviewTarget.rosterCount ?? rosters.length} cầu thủ</strong></div>
              <div><small>BTC duyệt</small><strong>{formatViDateTime(approvalReviewTarget.approvedAt)} · {approvalReviewTarget.approvedBy ?? "Không có mã người duyệt"}</strong></div>
            </div>
            {approvalReviewTarget.notes ? <p className="approval-review-note"><b>Ghi chú hồ sơ:</b> {approvalReviewTarget.notes}</p> : null}
          </section>
          <section className="approval-review-section">
            <h3>Roster đã xác nhận <span>{rosters.length}</span></h3>
            {rosters.length ? <div className="approval-review-roster">{rosters.map((entry) => {
              const player = players.find((item) => item.id === entry.playerId);
              return <article key={entry.id}><strong>{entry.playerNameSnapshot ?? player?.fullName ?? `Cầu thủ ${entry.playerId.slice(0, 8)}`}</strong><span>{entry.jerseyNumberSnapshot ?? player?.jerseyNumber ?? "—"} · {entry.positionSnapshot ?? player?.position ?? "Chưa khai báo vị trí"}</span><small>{entry.lineupRole === "STARTER" ? "Đá chính" : "Dự bị"}{entry.isGoalkeeper ? " · Thủ môn" : ""} · MSSV {entry.studentIdSnapshot ?? player?.studentId ?? "—"}</small></article>;
            })}</div> : <p className="muted">Không có dữ liệu roster.</p>}
          </section>
          <section className="approval-review-section">
            <h3>Lịch sử phê duyệt và xem xét</h3>
            {registrationHistory.filter((event) => ["SUBMITTED", "RESUBMITTED", "APPROVED"].includes(event.action)).length ? <ol className="approval-review-timeline">{registrationHistory.filter((event) => ["SUBMITTED", "RESUBMITTED", "APPROVED"].includes(event.action)).slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((event, index) => {
              const actionLabel = approvalHistoryActionLabel(event.action);
              const transition = event.action === "APPROVED" ? "Chờ duyệt → APPROVED"
                : event.action === "RESUBMITTED" ? "Cần bổ sung → Chờ duyệt" : "Chưa đăng ký → Chờ duyệt";
              return <li key={`${event.version}-${event.action}-${event.createdAt}-${index}`}><span className="approval-review-timeline-dot" /><div><div className="approval-review-timeline-title"><strong>{actionLabel}</strong><time>{formatViDateTime(event.createdAt)}</time></div>{transition ? <small>{transition}</small> : null}{event.note ? <p>{event.note}</p> : null}<small>Người thực hiện: {event.actorId}</small></div></li>;
            })}</ol> : <p className="muted">Chưa có lịch sử phê duyệt.</p>}
            {approvalReviews.flatMap((review) => review.events ?? []).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((event) => {
              const eventLabel = event.eventType === "OPENED" ? "Mở yêu cầu giải trình"
                : event.eventType === "TEAM_RESPONDED" ? "Đội trưởng gửi giải trình"
                  : event.eventType === "SUPPLEMENT_REQUESTED" ? "BTC yêu cầu bổ sung thêm"
                    : event.eventType === "RETAINED" ? "BTC giữ nguyên phê duyệt"
                      : "BTC thu hồi phê duyệt";
              return <article className="approval-review-event" key={event.id}><div className="approval-review-timeline-title"><strong>{eventLabel}</strong><time>{formatViDateTime(event.createdAt)}</time></div><small>{event.statusBefore} → {event.statusAfter} · Người thực hiện: {event.actorId}</small>{event.note ? <p>{event.note}</p> : null}</article>;
            })}
            {approvalReviews.map((review) => <article className={`approval-review-current ${["OPEN", "RESPONDED", "SUPPLEMENT_REQUIRED"].includes(review.status) ? "is-open" : "is-complete"}`} key={review.id}>
              <div><span className={`status-pill status-${review.status.toLowerCase()}`}>{review.status === "OPEN" ? "Chờ đội giải trình" : review.status === "SUPPLEMENT_REQUIRED" ? "Chờ đội bổ sung" : review.status === "RESPONDED" ? "Đội đã phản hồi · chờ BTC" : review.status === "RETAINED" ? "Đã hoàn tất · giữ nguyên duyệt" : "Đã hoàn tất · thu hồi duyệt"}</span><small>Người mở: {review.requestedBy} · {formatViDateTime(review.createdAt)} · Hạn: {formatViDateTime(review.supplementDeadline ?? review.responseDeadline)}</small></div>
              <p>{review.reason || "Không có lý do được ghi nhận."}</p>
              {review.teamResponse ? <p><b>Phản hồi đội trưởng:</b> {review.teamResponse}</p> : null}
              {review.decisionNote ? <p><b>Quyết định BTC:</b> {review.decisionNote}</p> : null}
              {review.decidedAt ? <small>Người quyết định: {review.decidedBy ?? "—"} · {formatViDateTime(review.decidedAt)}</small> : null}
            </article>)}
          </section>
          {activeApprovalReview && approvalReviewTarget.status === "APPROVED" ? <section className="approval-review-section approval-review-actions">
            <h3>Yêu cầu đang xử lý</h3>
            <p className="form-help">Đội vẫn giữ suất. Chọn quyết định tiếp theo; chỉ có thể chốt danh sách sau khi yêu cầu được hoàn tất.</p>
            <div className="approval-review-choice-grid">
              {(["RETAIN_APPROVAL", ...(registrationPeriodOpen ? ["REQUEST_SUPPLEMENT" as const] : []), "REVOKE_APPROVAL"] as ApprovalReviewAction[]).map((action) => <button type="button" key={action} className={`approval-review-choice${approvalReviewAction === action ? " selected" : ""}${action === "REVOKE_APPROVAL" ? " is-danger" : ""}`} aria-pressed={approvalReviewAction === action} disabled={action === "REVOKE_APPROVAL" && ["ROSTER_LOCKED", "PREPARING", "IN_PROGRESS", "PAUSED", "COMPLETED"].includes(selectedTournament?.status ?? "")} onClick={() => { setApprovalReviewAction(action); setApprovalReviewDecisionNote(""); }}>{approvalReviewActionLabel(action)}<small>{action === "RETAIN_APPROVAL" ? "Kết thúc xem xét, giữ APPROVED và suất." : action === "REQUEST_SUPPLEMENT" ? "Gửi nội dung cần bổ sung và thời hạn cho đội." : "Thu hồi APPROVED, giải phóng suất tham gia."}</small></button>)}
            </div>
            {approvalReviewAction ? <div className="approval-review-action-form">
              {approvalReviewAction !== "RETAIN_APPROVAL" ? <label className="field">{approvalReviewAction === "REVOKE_APPROVAL" ? "Lý do thu hồi phê duyệt *" : "Nội dung cần bổ sung *"}<textarea value={approvalReviewDecisionNote} maxLength={2000} rows={3} onChange={(event) => setApprovalReviewDecisionNote(event.target.value)} placeholder="Ghi rõ căn cứ và nội dung để đội trưởng nắm được…" /></label> : <p className="form-help">Xác nhận giữ nguyên trạng thái APPROVED và giải phóng yêu cầu đang chờ.</p>}
              {approvalReviewAction === "REQUEST_SUPPLEMENT" ? <label className="field">Hạn phản hồi *<input type="datetime-local" value={approvalReviewDeadline} onChange={(event) => setApprovalReviewDeadline(event.target.value)} /></label> : null}
              <button type="button" className={approvalReviewAction === "REVOKE_APPROVAL" ? "danger-button" : "primary-button"} disabled={submitting || (approvalReviewAction !== "RETAIN_APPROVAL" && approvalReviewDecisionNote.trim().length < 10) || (approvalReviewAction === "REQUEST_SUPPLEMENT" && (!approvalReviewDeadline || new Date(approvalReviewDeadline).getTime() <= Date.now()))} onClick={() => void submitExistingApprovalReviewAction()}>{submitting ? "Đang lưu…" : approvalReviewAction === "REVOKE_APPROVAL" ? "Xác nhận thu hồi phê duyệt" : approvalReviewAction === "REQUEST_SUPPLEMENT" ? "Gửi yêu cầu bổ sung" : "Xác nhận giữ nguyên phê duyệt"}</button>
            </div> : null}
          </section> : approvalReviewTarget.status === "APPROVED" && canOpenApprovedRegistrationReview(selectedTournament) ? <section className="approval-review-section approval-review-actions">
            <h3>Chọn hướng xử lý</h3>
            <div className="approval-review-choice-grid">
              {(["RETAIN_APPROVAL", "REQUEST_EXPLANATION", "REVOKE_APPROVAL"] as ApprovalReviewAction[]).map((action) => <button type="button" key={action} className={`approval-review-choice${approvalReviewAction === action ? " selected" : ""}${action === "REVOKE_APPROVAL" ? " is-danger" : ""}`} aria-pressed={approvalReviewAction === action} onClick={() => { setApprovalReviewAction(action); setApprovalReviewReason(""); }}>{approvalReviewActionLabel(action)}<small>{action === "RETAIN_APPROVAL" ? "Kết thúc xem xét, giữ APPROVED và suất." : action === "REQUEST_EXPLANATION" ? "Gửi yêu cầu có lý do và hạn phản hồi; đội vẫn giữ suất." : "Thu hồi phê duyệt sau khi xác nhận lý do."}</small></button>)}
            </div>
            {approvalReviewAction ? <div className="approval-review-action-form">
              {approvalReviewAction === "REQUEST_EXPLANATION" || approvalReviewAction === "REVOKE_APPROVAL" ? <label className="field">{approvalReviewAction === "REVOKE_APPROVAL" ? "Lý do thu hồi phê duyệt *" : "Lý do / nội dung cần giải trình *"}<textarea value={approvalReviewReason} maxLength={2000} rows={3} onChange={(event) => setApprovalReviewReason(event.target.value)} placeholder="Nêu rõ căn cứ và nội dung đội cần xử lý…" /></label> : <label className="field">Ghi chú (không bắt buộc)<textarea value={approvalReviewReason} maxLength={2000} rows={2} onChange={(event) => setApprovalReviewReason(event.target.value)} placeholder="Ghi nhận nội dung rà soát nếu cần" /></label>}
              {approvalReviewAction !== "RETAIN_APPROVAL" ? <label className="field">Hạn phản hồi *<input type="datetime-local" value={approvalReviewDeadline} onChange={(event) => setApprovalReviewDeadline(event.target.value)} /></label> : null}
              {approvalReviewAction === "REVOKE_APPROVAL" ? <p className="message-banner message-warning">Xác nhận sẽ chuyển hồ sơ sang APPROVAL_REVOKED và giải phóng suất tham gia.</p> : null}
              <button type="button" className={approvalReviewAction === "REVOKE_APPROVAL" ? "danger-button" : "primary-button"} disabled={submitting || (["REQUEST_EXPLANATION", "REVOKE_APPROVAL"].includes(approvalReviewAction) && approvalReviewReason.trim().length < 10) || (approvalReviewAction !== "RETAIN_APPROVAL" && (!approvalReviewDeadline || new Date(approvalReviewDeadline).getTime() <= Date.now()))} onClick={() => void submitApprovalReviewAction()}>{submitting ? "Đang lưu…" : approvalReviewAction === "REVOKE_APPROVAL" ? "Xác nhận thu hồi phê duyệt" : approvalReviewAction === "REQUEST_EXPLANATION" ? "Gửi yêu cầu giải trình" : "Xác nhận giữ nguyên phê duyệt"}</button>
            </div> : null}
          </section> : <p className="message-banner message-info">Đã hết hạn hoặc đăng ký đã đóng. Không thể mở yêu cầu xem xét lại mới; lịch sử hồ sơ vẫn được xem.</p>}
        </>}
        <div className="modal-actions"><button className="secondary-button" type="button" disabled={submitting} onClick={() => { setApprovalReviewTarget(null); setApprovalReviewAction(null); }}>Đóng</button></div>
      </Modal> : null}
      {mode === "btc" && selectedRegistrationId ? (
        <Modal
          open
          eyebrow="HỒ SƠ ĐĂNG KÝ GIẢI"
          title={`${detailTeam?.name ?? "Hồ sơ đội bóng"}`}
          description={`${selectedTournament?.name ?? "Giải đấu"} · ${detailTeam?.institutionName ?? detailRegistration?.institutionName ?? "Chưa xác định trường"}`}
          onClose={() => { if (!submitting) { setSelectedRegistrationId(""); setDecision(null); setDecisionError(null); setSelectedRosterPlayerId(null); } }}
          className="tournament-registration-modal"
        >
        <div className="registration-detail-shell">
          <div className="registration-detail-status"><span className={`status-pill status-${(detailRegistration?.status ?? "PENDING").toLowerCase()}`}>{detailRegistration ? registrationStatusLabels[detailRegistration.status] : "Đang tải"}</span><span>Hồ sơ #{detailRegistration?.submissionSequence ?? "—"}</span><span>Nộp lúc {formatViDateTime(detailRegistration?.submittedAt ?? detailRegistration?.registeredAt)}</span></div>
          {detailRegistration?.status === "PENDING" ? <div className="message-banner message-info registration-queue-detail-note" role="status">
            <strong>Hồ sơ đang chờ BTC duyệt.</strong>
            {detailRegistration.isNextInQueue === true
              ? <span>Đây là hồ sơ đến lượt xử lý tiếp theo theo thứ tự đăng ký.</span>
              : detailRegistration.isNextInQueue === false
                ? <span>Hồ sơ này chưa đến lượt. BTC đang xử lý các hồ sơ đăng ký trước; vị trí của đội là #{detailRegistration.submissionSequence}.</span>
                : <span>Hệ thống đang xác định thứ tự xử lý hồ sơ.</span>}
          </div> : null}
          <div className="registration-detail-tabs" role="tablist" aria-label="Nội dung hồ sơ">
            <button type="button" role="tab" aria-selected={registrationDetailTab === "application"} className={registrationDetailTab === "application" ? "active" : ""} onClick={() => setRegistrationDetailTab("application")}>Hồ sơ đăng ký</button>
            <button type="button" role="tab" aria-selected={registrationDetailTab === "history"} className={registrationDetailTab === "history" ? "active" : ""} onClick={() => setRegistrationDetailTab("history")}>Lịch sử xử lý</button>
          </div>
          {registrationDetailTab === "application" ? <div className="registration-detail-content">
            {registrationDetailLoading || registrationHistoryLoading ? <div className="loading-state" role="status">Đang tải hồ sơ đã gửi…</div> : <>
              <section className="registration-detail-section"><h3>Thông tin đăng ký</h3><div className="registration-detail-facts">
                <div><small>Đội / trường</small><strong>{detailTeam?.name ?? "Đội bóng"} · {detailTeam?.institutionName ?? detailRegistration?.institutionName ?? "Chưa xác định"}</strong></div>
                <div><small>Khoa / đơn vị</small><strong>{detailTeam?.unitName ?? "—"}</strong></div>
                <div><small>Đội trưởng / đại diện</small><strong>{detailTeam?.representativeName ?? "—"}</strong></div>
                <div><small>Liên hệ đăng ký</small><strong>{detailTeam?.contactPhone ?? "Chưa cung cấp số điện thoại"}</strong></div>
                <div><small>Ngày gửi</small><strong>{formatViDateTime(detailRegistration?.submittedAt ?? detailRegistration?.registeredAt)}</strong></div>
                <div><small>BTC phê duyệt</small><strong>{formatViDateTime(detailRegistration?.approvedAt)}{detailRegistration?.approvedBy ? ` · ${detailRegistration.approvedBy}` : ""}</strong></div>
              </div>{detailRegistration?.notes ? <p className="registration-detail-note"><b>Ghi chú trong hồ sơ:</b> {detailRegistration.notes}</p> : null}</section>
              <section className="registration-detail-section"><h3>Điều lệ và điều kiện</h3><div className="registration-detail-facts compact">
                <div><small>Đối tượng</small><strong>{selectedTournament?.scope === "SINGLE_INSTITUTION" ? "Nội bộ trường" : selectedTournament?.scope === "INTER_SCHOOL" ? "Liên trường" : "Theo điều lệ giải"}</strong></div>
                <div><small>Thể thức</small><strong>{selectedTournament?.footballFormat ?? 7} người · {selectedTournament?.competitionFormat === "ROUND_ROBIN" ? "Vòng tròn" : selectedTournament?.competitionFormat === "KNOCKOUT" ? "Loại trực tiếp" : "Bảng và loại trực tiếp"}</strong></div>
                <div><small>Số đội</small><strong>Tối thiểu {selectedTournament?.minTeams ?? "—"} · Tối đa {selectedTournament?.maxTeams ?? "—"}</strong></div>
                <div><small>Roster</small><strong>{selectedTournament?.minPlayers ?? "—"}–{selectedTournament?.maxPlayersPerTeam ?? "—"} cầu thủ</strong></div>
              </div>{selectedTournament?.rules?.eligibilityDescription ? <p className="registration-detail-note">{selectedTournament.rules.eligibilityDescription}</p> : null}
                {regulations.length ? <details className="registration-regulations"><summary>Xem điều lệ đầy đủ</summary>{regulationsLoading ? <p>Đang tải điều lệ…</p> : regulations.map((regulation: TournamentRegulation) => <article key={regulation.id}><h4>{regulation.title}</h4><p>{regulation.content}</p></article>)}</details> : null}
              </section>
              <section className="registration-detail-section"><div className="registration-roster-heading"><div><h3>Danh sách cầu thủ đã nộp</h3><p>{registrationRosterRows.length} cầu thủ trong phiên bản hồ sơ gửi BTC · yêu cầu {selectedTournament?.minPlayers ?? "—"}–{selectedTournament?.maxPlayersPerTeam ?? "—"}</p></div><label className="registration-roster-search">Tìm cầu thủ<input value={rosterPlayerSearch} onChange={(event) => setRosterPlayerSearch(event.target.value)} placeholder="Tên, MSSV hoặc số áo" /></label></div>
                {selectedRosterPlayer ? <div className="registration-player-view"><div className="registration-player-card"><div className="registration-player-heading"><div><small>CHI TIẾT CẦU THỦ</small><h4>{selectedRosterSnapshot?.playerName ?? selectedRosterPlayer.fullName ?? "Cầu thủ"}</h4></div><button type="button" className="text-button" onClick={() => setSelectedRosterPlayerId(null)}>Quay lại danh sách</button></div><div className="registration-detail-facts compact"><div><small>Mã sinh viên</small><strong>{selectedRosterSnapshot?.studentId ?? selectedRosterPlayer.studentId ?? "—"}</strong></div><div><small>Ngày sinh</small><strong>{formatViDate(selectedRosterSnapshot?.birthDate ?? selectedRosterPlayer.birthDate)}</strong></div><div><small>Số áo</small><strong>{selectedRosterSnapshot?.jerseyNumber ?? selectedRosterPlayer.jerseyNumber ?? "—"}</strong></div><div><small>Vị trí</small><strong>{playerPositionLabels[String(selectedRosterSnapshot?.position ?? selectedRosterPlayer.position ?? "")] ?? "Chưa khai báo"}</strong></div><div><small>Vai trò thi đấu</small><strong>{competitionRoleLabels[String(selectedRosterSnapshot?.competitionRole ?? "PLAYER")] ?? "Cầu thủ"}</strong></div><div><small>Đội hình</small><strong>{selectedRosterSnapshot?.lineupRole === "STARTER" ? "Đá chính" : "Dự bị"}{selectedRosterSnapshot?.isGoalkeeper ? " · Thủ môn" : ""}</strong></div></div>{selectedRosterSnapshot?.roster?.evidenceUrl ? <a href={selectedRosterSnapshot.roster.evidenceUrl} target="_blank" rel="noreferrer">Mở minh chứng đã nộp</a> : null}</div></div> : <div className="registration-roster-table-wrap"><table className="registration-roster-table"><thead><tr><th>#</th><th>Số áo</th><th>Họ tên</th><th>MSSV</th><th>Ngày sinh</th><th>Vị trí</th><th></th></tr></thead><tbody>{filteredRegistrationRosterRows.map((row, index) => { const player = players.find((item) => item.id === row.playerId); return <tr key={row.playerId}><td>{index + 1}</td><td>{row.jerseyNumber ?? player?.jerseyNumber ?? "—"}</td><td>{row.playerName ?? player?.fullName ?? "Cầu thủ"}</td><td>{row.studentId ?? player?.studentId ?? "—"}</td><td>{formatViDate(row.birthDate ?? player?.birthDate)}</td><td>{playerPositionLabels[String(row.position ?? player?.position ?? "")] ?? "Chưa khai báo"}</td><td><button type="button" className="text-button" onClick={() => { setSelectedRosterPlayerId(row.playerId); }}>Xem chi tiết</button></td></tr>; })}</tbody></table>{filteredRegistrationRosterRows.length === 0 ? <p className="muted">Không tìm thấy cầu thủ phù hợp.</p> : null}</div>}
              </section>
          {decision ? <section className="registration-decision-inline"><h3>{decision.status === "APPROVED" ? "Xác nhận duyệt toàn bộ hồ sơ" : decision.status === "REJECTED" ? "Từ chối hồ sơ đội" : "Yêu cầu đội bổ sung"}</h3><p>BTC xét thông tin đội và roster đã gửi như một hồ sơ thống nhất.</p>{decision.status !== "APPROVED" ? <label className="field">{decision.status === "REJECTED" ? "Lý do từ chối *" : "Nội dung cần bổ sung *"}<textarea autoFocus value={decisionNote} maxLength={2000} rows={3} onChange={(event) => { setDecisionNote(event.target.value); setDecisionError(null); }} /></label> : null}{decision.status === "REJECTED" && registrationPeriodOpen ? <label className="checkbox-field"><input type="checkbox" checked={decisionAllowResubmission} onChange={(event) => setDecisionAllowResubmission(event.target.checked)} /> Cho phép đội chỉnh sửa và nộp lại hồ sơ nếu còn hạn đăng ký</label> : null}{decision.status === "NEEDS_SUPPLEMENT" ? <label className="field">Hạn bổ sung *<input type="datetime-local" value={supplementDeadline} min={new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16)} onChange={(event) => setSupplementDeadline(event.target.value)} /></label> : null}{decisionError ? <p className="form-error" role="alert">{decisionError}</p> : null}<div className="modal-actions"><button type="button" className="secondary-button" disabled={submitting} onClick={() => { setDecision(null); setDecisionError(null); }}>Hủy</button><button type="button" className="primary-button" disabled={submitting || (decision.status !== "APPROVED" && !decisionNote.trim()) || (decision.status === "NEEDS_SUPPLEMENT" && (!supplementDeadline || new Date(supplementDeadline).getTime() <= Date.now()))} onClick={() => void confirmDecision()}>{submitting ? "Đang lưu…" : decision.status === "APPROVED" ? "Xác nhận duyệt đội" : decision.status === "REJECTED" ? "Xác nhận từ chối" : "Gửi yêu cầu bổ sung"}</button></div></section> : null}
              {!decision && detailRegistration && ["PENDING", "WAITLIST"].includes(detailRegistration.status) ? <div className="registration-detail-footer"><span>{detailRegistration.status === "WAITLIST" ? "Hồ sơ chờ suất được xét theo thứ tự đăng ký khi đủ điều kiện." : "Đang xử lý theo thứ tự đăng ký."}</span><div className="button-row"><button type="button" className="primary-button" disabled={submitting || (detailRegistration.status === "PENDING" && !detailRegistration.isNextInQueue)} onClick={() => openDecision(detailRegistration, "APPROVED")}>Duyệt hồ sơ</button>{registrationPeriodOpen ? <button type="button" className="button-secondary" disabled={submitting || (detailRegistration.status === "PENDING" && !detailRegistration.isNextInQueue)} onClick={() => openDecision(detailRegistration, "NEEDS_SUPPLEMENT")}>Yêu cầu bổ sung</button> : null}<button type="button" className="text-button danger-text-button" disabled={submitting || (detailRegistration.status === "PENDING" && !detailRegistration.isNextInQueue)} onClick={() => openDecision(detailRegistration, "REJECTED")}>Từ chối</button></div></div> : null}
            </>}</div> : <section className="registration-detail-section registration-history-content"><h3>Lịch sử xử lý hồ sơ</h3>{registrationHistoryLoading ? <div className="loading-state" role="status">Đang tải lịch sử…</div> : registrationHistory.length ? <ol className="approval-review-timeline">{registrationHistory.slice().sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).map((version,index) => <li key={`${version.version}-${version.action}-${version.createdAt}`}><span className="approval-review-timeline-dot"/><div><div className="approval-review-timeline-title"><strong>{approvalHistoryActionLabel(version.action)}</strong><time>{formatViDateTime(version.createdAt)}</time></div><small>Lần {version.version} · {version.rosterSnapshot.length} cầu thủ trong snapshot · Người thực hiện: {version.actorId}</small>{version.note ? <p>{formatHistoryNote(version.note)}</p> : null}</div></li>)}</ol> : <p className="muted">Chưa ghi nhận lịch sử xử lý.</p>}{approvalReviewsByRegistrationId[selectedRegistrationId]?.length ? approvalReviewsByRegistrationId[selectedRegistrationId].map((review) => <article className="approval-review-current" key={review.id}><div><span className="status-pill">{review.status === "RETAINED" ? "Đã hoàn tất · giữ nguyên duyệt" : review.status === "REVOKED" ? "Đã hoàn tất · thu hồi duyệt" : review.status === "RESPONDED" ? "Đội đã phản hồi · chờ BTC" : "Yêu cầu đang mở"}</span><small>Mở lúc {formatViDateTime(review.createdAt)} · Hạn {formatViDateTime(review.supplementDeadline ?? review.responseDeadline)}</small></div><p>{formatHistoryNote(review.reason)}</p>{review.teamResponse ? <p><b>Phản hồi đội:</b> {formatHistoryNote(review.teamResponse)}</p> : null}{review.decisionNote ? <p><b>Quyết định BTC:</b> {formatHistoryNote(review.decisionNote)}</p> : null}</article>) : null}</section>}
          </div>
        </Modal>
      ) : null}
    </section>
  );
}

function CaptainRegistrationStatus(props: {
  teams: Team[];
  tournamentId: string;
  selectedTeamId: string;
  initialRegistration: TeamRegistration | null;
  onRegistrationChange: (registration: TeamRegistration) => void;
}) {
  const [registration, setRegistration] = useState<TeamRegistration | null>(null);
  const [approvalReviews, setApprovalReviews] = useState<ApprovalReview[]>([]);
  const [teamWithdrawalRequests, setTeamWithdrawalRequests] = useState<TeamWithdrawalRequest[]>([]);
  const [withdrawalReason, setWithdrawalReason] = useState("");
  const [withdrawalBusy, setWithdrawalBusy] = useState(false);
  const [reviewResponses, setReviewResponses] = useState<Record<string, string>>({});
  const [sendingReviewResponse, setSendingReviewResponse] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!props.tournamentId || !props.selectedTeamId) {
      setRegistration(null);
      return;
    }
    if (props.initialRegistration) {
      setRegistration(props.initialRegistration);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    getMyTeamRegistration(props.selectedTeamId, props.tournamentId)
      .then(({ registration: result }) => {
        if (active) setRegistration(result);
      })
      .catch((err: unknown) => {
        if (active && err instanceof Error && "status" in err && err.status === 404) {
          setRegistration(null);
        } else if (active) {
          setError(err instanceof Error ? err.message : "Không tải được trạng thái đăng ký.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [props.initialRegistration, props.selectedTeamId, props.tournamentId]);
  useEffect(() => {
    if (!registration || registration.status !== "APPROVED") { setApprovalReviews([]); return; }
    let active = true;
    getTeamRegistrationApprovalReviews(registration.id)
      .then(({ reviews }) => { if (active) setApprovalReviews(reviews); })
      .catch((err: unknown) => { if (active) setError(err instanceof Error ? err.message : "Không tải được yêu cầu giải trình."); });
    return () => { active = false; };
  }, [registration?.id, registration?.status]);

  useEffect(() => {
    if (!registration) { setTeamWithdrawalRequests([]); return; }
    let active = true;
    getRegistrationWithdrawalRequests(registration.id)
      .then(({ withdrawalRequests }) => { if (active) setTeamWithdrawalRequests(withdrawalRequests); })
      .catch((err: unknown) => { if (active) setError(err instanceof Error ? err.message : "Không tải được lịch sử yêu cầu rút đội."); });
    return () => { active = false; };
  }, [registration?.id]);

  async function submitTeamWithdrawal() {
    if (!registration || withdrawalBusy || withdrawalReason.trim().length < 10) return;
    setWithdrawalBusy(true); setError(null);
    try {
      if (registration.status === "APPROVED") {
        const { withdrawalRequest } = await requestTeamRegistrationWithdrawal(registration.id, withdrawalReason.trim());
        setTeamWithdrawalRequests((current) => [withdrawalRequest, ...current]);
      } else {
        const { registration: updated } = await withdrawTeamRegistration(registration.id, withdrawalReason.trim());
        setRegistration(updated);
        props.onRegistrationChange(updated);
      }
      setWithdrawalReason("");
    } catch (err) { setError(err instanceof Error ? err.message : "Không gửi được yêu cầu rút đội."); }
    finally { setWithdrawalBusy(false); }
  }

  async function cancelTeamWithdrawal(request: TeamWithdrawalRequest) {
    if (withdrawalBusy) return;
    setWithdrawalBusy(true); setError(null);
    try {
      const { withdrawalRequest } = await cancelTeamWithdrawalRequest(request.id);
      setTeamWithdrawalRequests((current) => current.map((item) => item.id === withdrawalRequest.id ? withdrawalRequest : item));
    } catch (err) { setError(err instanceof Error ? err.message : "Không hủy được yêu cầu rút."); }
    finally { setWithdrawalBusy(false); }
  }

  async function sendReviewResponse(review: ApprovalReview) {
    const response = (reviewResponses[review.id] ?? "").trim();
    if (response.length < 10 || sendingReviewResponse) return;
    setSendingReviewResponse(true); setError(null);
    try {
      const { review: updated } = await respondTeamRegistrationApprovalReview(review.id, response);
      setApprovalReviews((current) => current.map((item) => item.id === updated.id ? updated : item));
      setReviewResponses((current) => ({ ...current, [review.id]: "" }));
    } catch (err) { setError(err instanceof Error ? err.message : "Không gửi được giải trình."); }
    finally { setSendingReviewResponse(false); }
  }
  if (loading) return <div className="loading-state">Đang kiểm tra trạng thái đăng ký…</div>;
  if (error) return <div className="message-banner message-error" role="alert">{error}</div>;
  return registration ? (
    <div className="captain-registration-status">
      <div className="message-banner message-success" role="status">
        {props.teams.find((team) => team.id === registration.teamId)?.name}: {registrationStatusLabels[registration.status]}
      </div>
      {!["WITHDRAWN", "REJECTED", "APPROVAL_REVOKED"].includes(registration.status) ? <section className="panel data-panel team-withdrawal-captain-panel">
        <h3>{registration.status === "APPROVED" ? "Yêu cầu rút khỏi giải" : "Rút hồ sơ đăng ký"}</h3>
        <p>{registration.status === "APPROVED"
          ? "Đội vẫn thuộc danh sách tham gia cho đến khi BTC quyết định. Nếu giải đã chia bảng, lập lịch hoặc thi đấu, BTC cần xác nhận phương án xử lý ảnh hưởng trước khi hoàn tất."
          : "Hồ sơ sẽ chuyển sang Đã rút, lời mời còn hiệu lực sẽ bị hủy và quyền tham gia cầu thủ trong giải được giải phóng. Đội bóng vẫn được giữ trong CLB."}</p>
        <label className="field">Lý do {registration.status === "APPROVED" ? "yêu cầu rút" : "rút hồ sơ"} *<textarea rows={3} maxLength={2000} value={withdrawalReason} onChange={(event) => setWithdrawalReason(event.target.value)} placeholder="Nhập lý do (ít nhất 10 ký tự)" /></label>
        <button className={registration.status === "APPROVED" ? "button-secondary" : "text-button danger-text-button"} type="button" disabled={withdrawalBusy || withdrawalReason.trim().length < 10} onClick={() => void submitTeamWithdrawal()}>{withdrawalBusy ? "Đang gửi…" : registration.status === "APPROVED" ? "Gửi yêu cầu rút BTC" : "Rút hồ sơ"}</button>
        {teamWithdrawalRequests.length ? <div className="team-withdrawal-history"><h4>Lịch sử yêu cầu rút đội</h4>{teamWithdrawalRequests.map((request) => <article className="institution-row" key={request.id}><div><span className={`status-pill status-${request.status.toLowerCase()}`}>{request.status === "PENDING" ? "Chờ BTC" : request.status === "PROCESSING" ? "Đang xử lý" : request.status === "APPROVED" ? "Đã chấp thuận" : request.status === "REJECTED" ? "Bị từ chối" : "Đã hủy"}</span><p>{request.reason}</p>{request.decisionNote ? <p>Quyết định: {request.decisionNote}</p> : null}<small>Gửi lúc {formatViDateTime(request.createdAt)}{request.decidedAt ? ` · Cập nhật ${formatViDateTime(request.decidedAt)}` : ""}</small></div>{request.status === "PENDING" ? <button type="button" className="text-button" disabled={withdrawalBusy} onClick={() => void cancelTeamWithdrawal(request)}>Hủy yêu cầu</button> : null}</article>)}</div> : null}
      </section> : null}
      {approvalReviews.filter((review) => ["OPEN", "SUPPLEMENT_REQUIRED"].includes(review.status)).map((review) => <section className="panel data-panel" key={review.id}>
        <h3>{review.status === "SUPPLEMENT_REQUIRED" ? "BTC yêu cầu bổ sung/giải trình hồ sơ đã duyệt" : "BTC yêu cầu giải trình hồ sơ đã duyệt"}</h3><p>{review.decisionNote ?? review.reason}</p><p>Hạn phản hồi: {new Date(review.supplementDeadline ?? review.responseDeadline).toLocaleString("vi-VN")}</p>
        <label className="field">Nội dung giải trình *<textarea maxLength={2000} rows={4} value={reviewResponses[review.id] ?? ""} onChange={(event) => setReviewResponses((current) => ({ ...current, [review.id]: event.target.value }))} placeholder="Phản hồi nội dung BTC yêu cầu…" /></label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button className="primary-button" type="button" disabled={sendingReviewResponse || (reviewResponses[review.id] ?? "").trim().length < 10} onClick={() => void sendReviewResponse(review)}>{sendingReviewResponse ? "Đang gửi…" : "Gửi giải trình"}</button>
      </section>)}
      {approvalReviews.filter((review) => !["OPEN", "SUPPLEMENT_REQUIRED"].includes(review.status)).map((review) => <p className="form-help" key={review.id}>{review.status === "RESPONDED" ? "Đã gửi giải trình; đang chờ BTC quyết định." : review.status === "RETAINED" ? `BTC giữ nguyên phê duyệt${review.decisionNote ? `: ${review.decisionNote}` : "."}` : `BTC đã thu hồi phê duyệt: ${review.decisionNote ?? "xem lịch sử hồ sơ"}`}</p>)}
    </div>
  ) : null;
}
