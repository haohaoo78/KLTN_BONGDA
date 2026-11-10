import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AuthUserPublic, UserProfilePublic, UserRole } from "@sfl/shared";
import {
  AuthApiError,
  getMe,
  forgotPassword,
  login,
  logout,
  register,
  activateStaffAccount,
  confirmEmailChange,
  resetPassword,
  resendVerification,
  verifyEmail,
} from "./api/auth";
import { getMyProfile, listUsers } from "./api/users";
import {
  addPlayer,
  deletePlayer,
  canManageTournaments,
  createTeam,
  createTournament,
  getMatches,
  getMySchedules,
  getMyTeams,
  getMyTournaments,
  getPublicTeams,
  getPublicTeamDetail,
  getTeamsForMyTournaments,
  getPlayers,
  getStandings,
  getTeams,
  getTournament,
  getTournaments,
  updatePlayer,
  type Match,
  type PublicTeam,
  type PublicTeamDetail,
  type RefereeSchedule,
  type Standing,
  type Team,
  type Tournament,
  type TournamentCreateInput,
} from "./api/competition";
import { getInstitutions, type Institution } from "./api/institutions";
import { InstitutionManager } from "./components/InstitutionManager";
import { StaffAccountManager } from "./components/StaffAccountManager";
import { AccountActivationPanel } from "./components/AccountActivationPanel";
import { TournamentCreateForm } from "./components/TournamentCreateForm";
import { RoleApplicationsPanel } from "./components/RoleApplicationsPanel";
import { ApprovalCenterPanel } from "./components/ApprovalCenterPanel";
import { PlayerTeamRequestsPanel } from "./components/PlayerTeamRequestsPanel";
import { ClubRequestsPanel } from "./components/ClubRequestsPanel";
import { TournamentWorkflowPanel } from "./components/TournamentWorkflowPanel";
import { TournamentDetailPanel } from "./components/TournamentDetailPanel";
import { MyTeamTournamentsPanel } from "./components/MyTeamTournamentsPanel";
import { BtcTournamentWorkspace } from "./components/BtcTournamentWorkspace";
import { MatchPauseRequestPanel } from "./components/MatchPauseRequestPanel";
import { MatchOperationsPanel } from "./components/MatchOperationsPanel";
import { AccountSettingsPanel } from "./components/AccountSettingsPanel";
import { NotificationBell, NotificationsPanel } from "./components/NotificationsPanel";
import { Modal } from "./components/Modal";
import "./App.css";

type Section = "overview" | "myAccount" | "accounts" | "roleApplications" | "notifications" | "tournaments" | "matches" | "standings" | "teams" | "institutions";

const roleLandingPaths: Record<UserRole, string> = {
  ADMIN: "/admin",
  BTC: "/btc",
  TEAM_CAPTAIN: "/team",
  PLAYER: "/player",
  REFEREE: "/referee",
  VIEWER: "/viewer",
};

const roleNavigation: Record<UserRole, Section[]> = {
  ADMIN: ["overview", "myAccount", "accounts", "notifications", "tournaments", "matches", "standings", "teams", "institutions"],
  BTC: ["overview", "myAccount", "roleApplications", "notifications", "tournaments", "matches", "standings", "teams"],
  TEAM_CAPTAIN: ["overview", "myAccount", "roleApplications", "notifications", "teams", "tournaments", "matches", "standings"],
  PLAYER: ["overview", "myAccount", "roleApplications", "notifications", "teams", "tournaments", "matches", "standings"],
  REFEREE: ["overview", "myAccount", "notifications", "matches", "tournaments"],
  VIEWER: ["overview", "myAccount", "roleApplications", "notifications", "tournaments", "matches", "standings", "teams"],
};

const navigation: { id: Section; label: string; short: string }[] = [
  { id: "overview", label: "Tổng quan", short: "01" },
  { id: "myAccount", label: "Tài khoản của tôi", short: "02" },
  { id: "accounts", label: "Quản lý tài khoản", short: "03" },
  { id: "roleApplications", label: "Yêu cầu vai trò", short: "04" },
  { id: "notifications", label: "Thông báo", short: "05" },
  { id: "tournaments", label: "Giải đấu", short: "06" },
  { id: "matches", label: "Lịch thi đấu", short: "07" },
  { id: "standings", label: "Bảng xếp hạng", short: "08" },
  { id: "teams", label: "Đội bóng", short: "09" },
  { id: "institutions", label: "Trường học", short: "10" },
];

function primaryRole(roles: UserRole[]): UserRole {
  const priority: UserRole[] = ["ADMIN", "BTC", "TEAM_CAPTAIN", "PLAYER", "REFEREE", "VIEWER"];
  return priority.find((role) => roles.includes(role)) ?? "VIEWER";
}

function roleTitle(role: UserRole): string {
  const titles: Record<UserRole, string> = {
    ADMIN: "Quản trị viên",
    BTC: "Ban tổ chức",
    TEAM_CAPTAIN: "Đội trưởng",
    PLAYER: "Cầu thủ",
    REFEREE: "Trọng tài",
    VIEWER: "Khán giả",
  };
  return titles[role];
}

const statusLabels: Record<string, string> = {
  DRAFT: "Bản nháp",
  OPEN_REGISTRATION: "Đang mở đăng ký",
  REGISTRATION_CLOSED: "Đã đóng đăng ký",
  ROSTER_LOCKED: "Đã chốt danh sách",
  PREPARING: "Đang chuẩn bị thi đấu",
  IN_PROGRESS: "Đang diễn ra",
  PAUSED: "Tạm dừng",
  COMPLETED: "Đã kết thúc",
  CANCELLED: "Đã hủy",
  SCHEDULED: "Sắp diễn ra",
  LINEUP_CONFIRMED: "Đã xác nhận đội hình",
  IN_PROGRESS_MATCH: "Đang thi đấu",
  FINISHED: "Đã kết thúc",
  VERIFIED: "Đã xác nhận",
  LOCKED: "Đã khóa",
  POSTPONED: "Tạm hoãn",
};

function formatDate(value: string | null): string {
  if (!value) return "Chưa cập nhật";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Chưa cập nhật";
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function formatMatchDate(value: string | null): string {
  if (!value) return "Chưa xếp lịch";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Chưa xếp lịch";
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function statusLabel(status: string): string {
  return statusLabels[status] ?? status.replaceAll("_", " ");
}

function isRegistrationPeriodOpen(tournament: Tournament, now = Date.now()): boolean {
  return tournament.status === "OPEN_REGISTRATION" && Boolean(tournament.registrationPeriods?.some((period) => {
    const startsAt = new Date(period.startDate).getTime();
    const endsAt = new Date(period.endDate).getTime();
    return Number.isFinite(startsAt) && Number.isFinite(endsAt) && startsAt <= now && now <= endsAt;
  }));
}

function captureFormBaseline(form: HTMLFormElement): void {
  form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input, select, textarea").forEach((field) => {
    if (field.dataset.navigationInitialValue !== undefined) return;
    field.dataset.navigationInitialValue = field instanceof HTMLInputElement && ["checkbox", "radio"].includes(field.type)
      ? String(field.checked)
      : field.value;
  });
}

function hasUnfinishedForm(): boolean {
  return Array.from(document.querySelectorAll("form")).some((form) => {
    if (form.getClientRects().length === 0) return false;
    if (form.dataset.navigationTouched !== "true") return false;
    return Array.from(form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input, select, textarea"))
      .some((field) => {
        if (field.disabled || ("readOnly" in field && field.readOnly)) return false;
        const initialValue = field.dataset.navigationInitialValue ?? (
          field instanceof HTMLInputElement && ["checkbox", "radio"].includes(field.type)
            ? String(field.defaultChecked)
            : field instanceof HTMLSelectElement
              ? Array.from(field.options).find((option) => option.defaultSelected)?.value ?? ""
              : field.defaultValue
        );
        const currentValue = field instanceof HTMLInputElement && ["checkbox", "radio"].includes(field.type)
          ? String(field.checked)
          : field.value;
        return currentValue !== initialValue;
      });
  });
}

function App() {
  const [user, setUser] = useState<AuthUserPublic | null>(null);
  const [profile, setProfile] = useState<UserProfilePublic | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [registerMode, setRegisterMode] = useState(false);
  const [verificationPending, setVerificationPending] = useState(false);
  const [verificationDeliveryFailed, setVerificationDeliveryFailed] = useState(false);
  const [forgotPasswordMode, setForgotPasswordMode] = useState(false);
  const [resetToken, setResetToken] = useState("");
  const [activationToken, setActivationToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [resending, setResending] = useState(false);
  const [section, setSection] = useState<Section>(() =>
    new URLSearchParams(window.location.search).has("manageTournament") ? "tournaments" : "overview",
  );
  const [pendingSection, setPendingSection] = useState<Section | null>(null);
  const [dashboardPath, setDashboardPath] = useState(window.location.pathname);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [assignedTournaments, setAssignedTournaments] = useState<
    Array<{ id: string; name: string; status: string }>
  >([]);
  const [refereeSchedules, setRefereeSchedules] = useState<RefereeSchedule[]>([]);
  const [adminUserCount, setAdminUserCount] = useState<number | null>(null);
  const [selectedTournamentId, setSelectedTournamentId] = useState("");
  const [showTournamentDetails, setShowTournamentDetails] = useState(false);
  const [registerTournamentId, setRegisterTournamentId] = useState("");
  const [myTeamManageTarget, setMyTeamManageTarget] = useState<{ teamId: string; tournamentId: string } | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [standings, setStandings] = useState<Standing[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [publicTeams, setPublicTeams] = useState<PublicTeam[]>([]);
  const [publicTeamsTotal, setPublicTeamsTotal] = useState(0);
  const [publicTeamsLoading, setPublicTeamsLoading] = useState(false);
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [competitionLoading, setCompetitionLoading] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [teamInstitutionId, setTeamInstitutionId] = useState("");
  const [teamUnitName, setTeamUnitName] = useState("");
  const [teamContactEmail, setTeamContactEmail] = useState("");
  const [teamContactPhone, setTeamContactPhone] = useState("");
  const [teamLogoUrl, setTeamLogoUrl] = useState("");
  const [teamKitColor, setTeamKitColor] = useState("");
  const [teamMaxPlayers, setTeamMaxPlayers] = useState("25");
  const [teamDescription, setTeamDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const verificationStarted = useRef(false);

  useEffect(() => {
    function rememberInitialFormValues(event: FocusEvent) {
      const target = event.target;
      if (target instanceof Element) {
        const form = target.closest("form");
        if (form instanceof HTMLFormElement) captureFormBaseline(form);
      }
    }
    function markFormAsEdited(event: Event) {
      const target = event.target;
      if (target instanceof Element) target.closest("form")?.setAttribute("data-navigation-touched", "true");
    }
    document.addEventListener("focusin", rememberInitialFormValues);
    document.addEventListener("input", markFormAsEdited, true);
    document.addEventListener("change", markFormAsEdited, true);
    return () => {
      document.removeEventListener("focusin", rememberInitialFormValues);
      document.removeEventListener("input", markFormAsEdited, true);
      document.removeEventListener("change", markFormAsEdited, true);
    };
  }, []);

  function requestSectionChange(target: Section) {
    if (target === section) return;
    if (hasUnfinishedForm()) {
      setPendingSection(target);
      return;
    }
    setSection(target);
  }

  function discardAndNavigate() {
    if (!pendingSection) return;
    document.querySelectorAll<HTMLFormElement>("form").forEach((form) => form.reset());
    setCreateOpen(false);
    setTeamName("");
    setTeamInstitutionId("");
    setTeamUnitName("");
    setTeamContactEmail("");
    setTeamContactPhone("");
    setTeamLogoUrl("");
    setTeamKitColor("");
    setTeamMaxPlayers("25");
    setTeamDescription("");
    setPendingSection(null);
    setSection(pendingSection);
  }

  const activeTournament = useMemo(
    () => tournaments.find((tournament) => tournament.id === selectedTournamentId) ?? tournaments[0] ?? null,
    [selectedTournamentId, tournaments],
  );

  const filterPublicTeams = useCallback((institutionId: string, search: string, offset = 0, isActive?: boolean, sortBy: "NAME" | "CREATED_AT" = "CREATED_AT") => {
    setPublicTeamsLoading(true);
    getPublicTeams({ institutionId, search, limit: 20, offset, isActive, sortBy })
      .then(({ items, total }) => { setPublicTeams(items); setPublicTeamsTotal(total); })
      .catch((err: unknown) => setError(`Không thể lọc danh bạ đội bóng: ${errorMessage(err)}`))
      .finally(() => setPublicTeamsLoading(false));
  }, []);
  const teamNames = useMemo(
    () => new Map(teams.map((team) => [team.id, team.name])),
    [teams],
  );

  const refreshSession = useCallback(async () => {
    setSessionLoading(true);
    try {
      const { user: current } = await getMe();
      setUser(current);
      try {
        const { user: fullProfile } = await getMyProfile();
        setProfile(fullProfile);
      } catch (err) {
        setProfile(null);
        setError(`Đã nhận diện phiên đăng nhập nhưng không tải được hồ sơ: ${errorMessage(err)}`);
      }
    } catch (err) {
      if (err instanceof AuthApiError && err.status === 401) {
        setUser(null);
        setProfile(null);
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setSessionLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    if (profile?.institutionId) {
      setTeamInstitutionId(profile.institutionId);
    }
  }, [profile?.institutionId]);

  useEffect(() => {
    const handlePopState = () => {
      setDashboardPath(window.location.pathname);
      setSection(new URLSearchParams(window.location.search).has("manageTournament") ? "tournaments" : "overview");
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (!user || sessionLoading) return;
    const expectedPath = roleLandingPaths[primaryRole(user.roles)];
    const requestedRoleRoute = Object.values(roleLandingPaths).includes(dashboardPath);
    if (requestedRoleRoute && dashboardPath !== expectedPath) {
      window.history.replaceState({}, "", expectedPath);
      setDashboardPath(expectedPath);
    }
  }, [dashboardPath, sessionLoading, user]);

  useEffect(() => {
    if (!user) {
      setAssignedTournaments([]);
      setRefereeSchedules([]);
      setAdminUserCount(null);
      return;
    }
    let active = true;
    if (user.roles.includes("BTC") && !user.roles.includes("ADMIN")) {
      getMyTournaments()
        .then(({ items }) => {
          if (active) setAssignedTournaments(items);
        })
        .catch((err: unknown) => {
          if (active) setError(`Không tải được giải được phân công: ${errorMessage(err)}`);
        });
    } else {
      setAssignedTournaments([]);
    }
    if (user.roles.includes("REFEREE")) {
      getMySchedules()
        .then(({ schedules }) => {
          if (active) setRefereeSchedules(schedules);
        })
        .catch((err: unknown) => {
          if (active) setError(`Không tải được lịch trọng tài: ${errorMessage(err)}`);
        });
    } else {
      setRefereeSchedules([]);
    }
    if (user.roles.includes("ADMIN")) {
      listUsers()
        .then(({ pagination }) => {
          if (active) setAdminUserCount(pagination.total);
        })
        .catch((err: unknown) => {
          if (active) setError(`Không tải được thống kê người dùng: ${errorMessage(err)}`);
        });
    } else {
      setAdminUserCount(null);
    }
    return () => {
      active = false;
    };
  }, [user, reload]);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("verify");
    if (!token || verificationStarted.current) return;
    verificationStarted.current = true;
    setSubmitting(true);
    setError(null);
    verifyEmail(token)
      .then(({ message }) => {
        setNotice(message);
        setRegisterMode(false);
        setVerificationPending(false);
      })
      .catch((err: unknown) => {
        setError(`Không thể xác minh email: ${errorMessage(err)}`);
        setRegisterMode(false);
      })
      .finally(() => {
        window.history.replaceState({}, "", window.location.pathname);
        setSubmitting(false);
      });
  }, []);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("reset");
    if (!token) return;
    setResetToken(token);
    setForgotPasswordMode(false);
    setRegisterMode(false);
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("activate");
    if (!token) return;
    setActivationToken(token);
    setForgotPasswordMode(false);
    setRegisterMode(false);
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("email-change");
    if (!token) return;
    setSubmitting(true);
    setError(null);
    confirmEmailChange(token)
      .then(({ message }) => {
        setUser(null);
        setProfile(null);
        setNotice(message);
      })
      .catch((err: unknown) => setError(`Không thể xác nhận email mới: ${errorMessage(err)}`))
      .finally(() => {
        window.history.replaceState({}, "", window.location.pathname);
        setSubmitting(false);
      });
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    getTournaments()
      .then(async ({ items }) => {
        // The public list is intentionally compact; hydrate registration windows so
        // the card uses the same dates the server checks before accepting a request.
        const detailedItems = await Promise.all(items.map(async (item) => {
          try {
            return (await getTournament(item.id)).tournament;
          } catch {
            return item;
          }
        }));
        if (!active) return;
        setTournaments(detailedItems);
        setSelectedTournamentId((current) =>
          detailedItems.some((tournament) => tournament.id === current)
            ? current
            : detailedItems[0]?.id ?? "",
        );
      })
      .catch((err: unknown) => {
        if (active) setError(`Không tải được danh sách giải đấu: ${errorMessage(err)}`);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reload]);

  useEffect(() => {
    let active = true;
    getInstitutions()
      .then(({ institutions: items }) => {
        if (active) setInstitutions(items);
      })
      .catch((err: unknown) => {
        if (active) setError(`Không tải được danh sách trường: ${errorMessage(err)}`);
      });
    return () => {
      active = false;
    };
  }, [reload]);

  useEffect(() => {
    if (!activeTournament) {
      setMatches([]);
      setStandings([]);
      setCompetitionLoading(false);
      return;
    }
    let active = true;
    setCompetitionLoading(true);
    setError(null);
    Promise.allSettled([
      getMatches(activeTournament.id),
      getStandings(activeTournament.id),
    ]).then(([matchResult, standingResult]) => {
      if (!active) return;
      if (matchResult.status === "fulfilled") {
        setMatches(matchResult.value.items);
      } else {
        setMatches([]);
        setError(`Không tải được lịch thi đấu: ${errorMessage(matchResult.reason)}`);
      }
      if (standingResult.status === "fulfilled") {
        setStandings(standingResult.value.standings);
      } else {
        setStandings([]);
        setError(`Không tải được bảng xếp hạng: ${errorMessage(standingResult.reason)}`);
      }
    }).finally(() => {
      if (active) setCompetitionLoading(false);
    });
    return () => {
      active = false;
    };
  }, [activeTournament]);

  useEffect(() => {
    if (!user) {
      setTeams([]);
      setTeamsLoading(false);
      return;
    }
    let active = true;
    setTeamsLoading(true);
    setError(null);
    const teamsRequest = user.roles.includes("ADMIN")
      ? getTeams()
      : user.roles.includes("BTC")
        ? getTeamsForMyTournaments()
        : user.roles.includes("TEAM_CAPTAIN") || user.roles.includes("PLAYER")
          ? getMyTeams().then(({ teams: items }) => ({ items, total: items.length }))
          : null;
    if (!teamsRequest) {
      setTeams([]);
      setTeamsLoading(false);
      return;
    }
    teamsRequest
      .then(({ items }) => {
        if (active) setTeams(items);
      })
      .catch((err: unknown) => {
        if (active) setError(`Không tải được danh sách đội bóng: ${errorMessage(err)}`);
      })
      .finally(() => {
        if (active) setTeamsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reload, section, user]);

  useEffect(() => {
    const canBrowseTeamDirectory = !user || user.roles.some((role) => ["ADMIN", "BTC", "TEAM_CAPTAIN", "PLAYER", "VIEWER"].includes(role));
    if (section !== "teams" || !canBrowseTeamDirectory) {
      setPublicTeams([]);
      setPublicTeamsLoading(false);
      return;
    }
    let active = true;
    setPublicTeamsLoading(true);
    getPublicTeams({ limit: 20, offset: 0 })
      .then(({ items, total }) => {
        if (active) { setPublicTeams(items); setPublicTeamsTotal(total); }
      })
      .catch((err: unknown) => {
        if (active) setError(`Không tải được danh sách CLB công khai: ${errorMessage(err)}`);
      })
      .finally(() => {
        if (active) setPublicTeamsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reload, section, user, profile?.institutionId]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const { user: loggedIn } = await login(email.trim(), password);
      setUser(loggedIn);
      const path = roleLandingPaths[primaryRole(loggedIn.roles)];
      window.history.pushState({}, "", path);
      setDashboardPath(path);
      setSection("overview");
      setPassword("");
      try {
        const { user: fullProfile } = await getMyProfile();
        setProfile(fullProfile);
      } catch (err) {
        setProfile(null);
        setError(`Đăng nhập thành công nhưng tải hồ sơ thất bại: ${errorMessage(err)}`);
      }
      setNotice("Đăng nhập thành công. Chào mừng bạn trở lại!");
    } catch (err) {
      if (err instanceof AuthApiError && err.code === "EMAIL_NOT_VERIFIED") {
        setVerificationPending(true);
      }
      setError(errorMessage(err, "Đăng nhập thất bại"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirmPassword) {
      setError("Mật khẩu xác nhận không khớp.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const { message } = await register({
        email: email.trim(),
        password,
        name: fullName.trim(),
      });
      setVerificationPending(true);
      setVerificationDeliveryFailed(false);
      setRegisterMode(false);
      setPassword("");
      setConfirmPassword("");
      setNotice(message);
    } catch (err) {
      if (err instanceof AuthApiError && err.code === "EMAIL_DELIVERY_FAILED") {
        setVerificationPending(true);
        setVerificationDeliveryFailed(true);
        setRegisterMode(false);
        setPassword("");
        setConfirmPassword("");
      }
      setError(errorMessage(err, "Không thể tạo tài khoản"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResendVerification() {
    setResending(true);
    setError(null);
    setNotice(null);
    try {
      const { message } = await resendVerification(email.trim());
      setVerificationDeliveryFailed(false);
      setNotice(message);
    } catch (err) {
      setError(errorMessage(err, "Không thể gửi lại email xác minh"));
    } finally {
      setResending(false);
    }
  }

  async function handleForgotPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const { message } = await forgotPassword(email.trim());
      setNotice(message);
      setForgotPasswordMode(false);
    } catch (err) {
      setError(errorMessage(err, "Không thể gửi yêu cầu đặt lại mật khẩu"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword !== confirmNewPassword) {
      setError("Mật khẩu xác nhận không khớp.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const { message } = await resetPassword(resetToken, newPassword);
      setResetToken("");
      setNewPassword("");
      setConfirmNewPassword("");
      setNotice(message);
    } catch (err) {
      setError(errorMessage(err, "Không thể đặt lại mật khẩu"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleActivateStaffAccount(password: string) {
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const { message } = await activateStaffAccount(activationToken, password);
      setActivationToken("");
      setNotice(message);
    } catch (err) {
      setError(errorMessage(err, "Không thể kích hoạt tài khoản."));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogout() {
    setSubmitting(true);
    setError(null);
    try {
      await logout();
      setUser(null);
      setProfile(null);
      setTeams([]);
      window.history.pushState({}, "", "/");
      setDashboardPath("/");
      setNotice("Bạn đã đăng xuất.");
    } catch (err) {
      setError(`Không thể đăng xuất: ${errorMessage(err)}`);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreateTournament(input: TournamentCreateInput) {
    setCreating(true);
    setError(null);
    try {
      await createTournament(input);
      setCreateOpen(false);
      setNotice("Đã tạo giải đấu mới.");
      setReload((value) => value + 1);
    } catch (err) {
      setError(`Không thể tạo giải đấu: ${errorMessage(err)}`);
    } finally {
      setCreating(false);
    }
  }

  async function handleCreateTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setError(null);
    try {
      await createTeam({
        name: teamName.trim(),
        description: teamDescription.trim() || undefined,
        logoUrl: teamLogoUrl.trim() || undefined,
        institutionId: teamInstitutionId,
        unitName: teamUnitName.trim() || undefined,
        representativeName: profile?.fullName ?? undefined,
        kitColor: teamKitColor.trim() || undefined,
        contactEmail: teamContactEmail.trim(),
        contactPhone: teamContactPhone.trim(),
        maxPlayers: Number(teamMaxPlayers),
      });
      setTeamName("");
      setTeamInstitutionId("");
      setTeamUnitName("");
      setTeamContactEmail("");
      setTeamContactPhone("");
      setTeamLogoUrl("");
      setTeamKitColor("");
      setTeamMaxPlayers("25");
      setTeamDescription("");
      setNotice("Đã tạo đội bóng mới.");
      setReload((value) => value + 1);
    } catch (err) {
      setError(`Không thể tạo đội bóng: ${errorMessage(err)}`);
    } finally {
      setCreating(false);
    }
  }

  const upcomingMatches = useMemo(
    () =>
      [...matches]
        .filter((match) => !["FINISHED", "VERIFIED", "LOCKED", "CANCELLED"].includes(match.status))
        .sort((a, b) =>
          (a.matchDate ? new Date(a.matchDate).getTime() : Number.MAX_SAFE_INTEGER) -
          (b.matchDate ? new Date(b.matchDate).getTime() : Number.MAX_SAFE_INTEGER),
        ),
    [matches],
  );

  const activeRole = user ? primaryRole(user.roles) : null;
  const pageTitle = section === "roleApplications"
    ? activeRole === "ADMIN" || activeRole === "BTC" ? "Duyệt yêu cầu vai trò" : "Đăng ký vai trò"
    : navigation.find((item) => item.id === section)?.label ?? "Tổng quan";
  const visibleNavigation = activeRole
    ? navigation.filter((item) => roleNavigation[activeRole].includes(item.id) && (activeRole !== "VIEWER" || item.id !== "institutions"))
    : navigation.filter((item) => !["myAccount", "accounts", "roleApplications", "institutions"].includes(item.id));

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); requestSectionChange("overview"); }}>
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 40 40" fill="none">
              <path d="M20 3.5 34 8.6v10.8c0 8.3-5.8 14.5-14 17.1C11.8 33.9 6 27.7 6 19.4V8.6L20 3.5Z" stroke="currentColor" strokeWidth="2" />
              <path d="m20 11 5.2 3.8-2 6.1h-6.4l-2-6.1L20 11Zm-5.2 3.8-5.4 1.8m13.8-1.8 5.4 1.8M17 20.9l-3.3 5.2m9.3-5.2 3.3 5.2M13.7 26.1h12.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span>
            <strong>SÂN CỎ</strong>
            <small>STUDENT FOOTBALL</small>
          </span>
        </a>

        <div className="nav-caption">KHÔNG GIAN QUẢN LÝ</div>
        <nav className="main-nav" aria-label="Điều hướng chính">
          {visibleNavigation.map((item) => (
            <button
              className={`nav-item ${section === item.id ? "is-active" : ""}`}
              key={item.id}
              onClick={() => requestSectionChange(item.id)}
              type="button"
            >
              <span className="nav-number">{item.short}</span>
              <span>{item.id === "roleApplications" && (activeRole === "ADMIN" || activeRole === "BTC") ? "Duyệt yêu cầu" : item.label}</span>
              {section === item.id ? <span className="nav-arrow">↗</span> : null}
            </button>
          ))}
        </nav>

        <div className="sidebar-spacer" />
        <div className="sidebar-season">
          <span className="season-dot" />
          <div>
            <span>MÙA GIẢI HIỆN TẠI</span>
            <strong>{new Date().getFullYear()} — {new Date().getFullYear() + 1}</strong>
          </div>
        </div>
        <div className="sidebar-account">
          <div className="avatar">{profile?.fullName?.slice(0, 1).toUpperCase() ?? "S"}</div>
          <div className="account-copy">
            <strong>{profile?.fullName ?? (user ? user.email : "Khách tham quan")}</strong>
            <span>{user ? user.roles.join(" · ") : "Chưa đăng nhập"}</span>
          </div>
          {user ? (
            <button className="icon-button logout-button" onClick={() => void handleLogout()} disabled={submitting} title="Đăng xuất" type="button">
              ↗
            </button>
          ) : null}
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb"><span>QUẢN LÝ GIẢI ĐẤU</span><b>/</b>{pageTitle}</div>
          <div className="topbar-actions">
            <span className="system-status"><i /> HỆ THỐNG HOẠT ĐỘNG</span>
            <button className="icon-button refresh-button" onClick={() => setReload((value) => value + 1)} title="Làm mới dữ liệu" type="button">↻</button>
            {!user ? (
              <div className="top-auth-actions">
                <a className="top-login" href="#login">Đăng nhập <span>↗</span></a>
                <a className="top-register" href="#login" onClick={() => setRegisterMode(true)}>Đăng ký ngay</a>
              </div>
            ) : (
              <NotificationBell userId={user.userId} onViewAll={() => requestSectionChange("notifications")} />
            )}
          </div>
        </header>

        <div className="page-wrap">
          {(error || notice) ? (
            <div className={`message-banner ${error ? "message-error" : "message-success"}`} role={error ? "alert" : "status"}>
              <span>{error ?? notice}</span>
              <button onClick={() => { setError(null); setNotice(null); }} type="button" aria-label="Đóng thông báo">×</button>
            </div>
          ) : null}

          <section className="page-heading">
            <div>
              <div className="eyebrow"><span className="eyebrow-line" /> MÙA GIẢI {new Date().getFullYear()}–{new Date().getFullYear() + 1}</div>
              <h1>{section === "overview" ? <>Nơi đam mê<br /><em>bắt đầu.</em></> : pageTitle}</h1>
              <p className="page-intro">{section === "overview" ? "Theo dõi giải đấu, lịch thi đấu và những khoảnh khắc đáng nhớ của bóng đá sinh viên." : sectionDescription(section)}</p>
            </div>
            {section === "tournaments" && user && canManageTournaments(user.roles) && !(user.roles.includes("BTC") && !user.roles.includes("ADMIN")) ? (
              <button className="primary-button" onClick={() => setCreateOpen((open) => !open)} type="button">
                <span>＋</span> Tạo giải đấu
              </button>
            ) : null}
          </section>

          {createOpen && user && canManageTournaments(user.roles) && !(user.roles.includes("BTC") && !user.roles.includes("ADMIN")) ? (
            <TournamentCreateForm
              institutions={institutions}
              userInstitutionId={profile?.institutionId ?? user.institutionId ?? null}
              isAdmin={false}
              disabled={creating}
              onSubmit={handleCreateTournament}
              onClose={() => setCreateOpen(false)}
            />
          ) : null}

          {section === "overview" ? (
            <>
              {user && activeRole ? (
                <RoleDashboard
                  role={activeRole}
                  fullName={profile?.fullName ?? user.email}
                  email={user.email}
                  teamCount={teams.length}
                  assignedTournaments={assignedTournaments}
                  refereeSchedules={refereeSchedules}
                  adminUserCount={adminUserCount}
                  onNavigate={requestSectionChange}
                  onSelectTournament={setSelectedTournamentId}
                />
              ) : null}
              {activeRole === "REFEREE" ? (
                <MatchOperationsPanel mode="referee" schedules={refereeSchedules} teamNames={teamNames} onNotice={setNotice} />
              ) : null}
              <Overview
                activeTournament={activeTournament}
                loading={loading}
                tournaments={tournaments}
                matches={upcomingMatches}
                standings={standings}
                teamNames={teamNames}
                onNavigate={requestSectionChange}
                onSelectTournament={setSelectedTournamentId}
                onExploreTournament={(id) => {
                  setSelectedTournamentId(id);
                  setShowTournamentDetails(true);
                  requestSectionChange("tournaments");
                }}
                selectedTournamentId={activeTournament?.id ?? ""}
              />
            </>
          ) : null}
          {section === "accounts" && activeRole === "ADMIN" ? <StaffAccountManager /> : null}
          {section === "myAccount" && profile ? (
            <AccountSettingsPanel
              profile={profile}
              institutionName={institutions.find((item) => item.id === profile.institutionId)?.name ?? null}
              institutions={institutions}
              onProfileChange={setProfile}
              onNotice={setNotice}
              onError={setError}
            />
          ) : null}
          {section === "notifications" && user ? <NotificationsPanel /> : null}
          {section === "roleApplications" && user ? (
            user.roles.includes("ADMIN") || user.roles.includes("BTC") ? (
              <ApprovalCenterPanel onNavigateToTeams={() => requestSectionChange("teams")} />
            ) : (
              <>
                <RoleApplicationsPanel
                  roles={user.roles}
                  reviewer={false}
                  email={profile?.email ?? user.email}
                  fullName={profile?.fullName ?? user.email}
                  onNotice={setNotice}
                />
                <ClubRequestsPanel
                  roles={user.roles}
                  institutionId={profile?.institutionId ?? user.institutionId ?? null}
                  institutionName={institutions.find((item) => item.id === (profile?.institutionId ?? user.institutionId))?.name ?? null}
                  institutions={institutions}
                  email={profile?.email ?? user.email}
                  onNotice={setNotice}
                />
              </>
            )
          ) : null}
          {section === "tournaments" ? (
            user?.roles.includes("BTC") ? (
              <BtcTournamentWorkspace
                assignedTournaments={assignedTournaments}
                institutions={institutions}
                userInstitutionId={profile?.institutionId ?? user.institutionId ?? null}
                creating={creating}
                onCreateTournament={handleCreateTournament}
                teamNames={teamNames}
                onNotice={setNotice}
                onOpenSection={(tournamentId, target) => {
                  setSelectedTournamentId(tournamentId);
                  requestSectionChange(target);
                }}
              />
            ) : (
            <>
              <TournamentList
                tournaments={tournaments}
                loading={loading}
                selectedId={activeTournament?.id ?? ""}
                institutions={institutions}
                canRegister={Boolean(user?.roles.includes("TEAM_CAPTAIN"))}
                onSelect={(id) => {
                  setSelectedTournamentId(id);
                  setShowTournamentDetails(true);
                }}
                onRegister={(id) => setRegisterTournamentId(id)}
                onViewTournament={(id) => {
                  setSelectedTournamentId(id);
                  setShowTournamentDetails(true);
                }}
              />
              {showTournamentDetails && activeTournament ? (
                <TournamentDetailPanel
                  key={activeTournament.id}
                  tournamentId={activeTournament.id}
                  institutions={institutions}
                  onClose={() => setShowTournamentDetails(false)}
                />
              ) : null}
              {user && (user.roles.includes("TEAM_CAPTAIN") || user.roles.includes("PLAYER")) ? (
                <MyTeamTournamentsPanel
                  canManage={user.roles.includes("TEAM_CAPTAIN")}
                  onManage={(teamId, tournamentId) => {
                    setMyTeamManageTarget({ teamId, tournamentId });
                  }}
                  onViewTournament={(tournamentId) => {
                    setSelectedTournamentId(tournamentId);
                    setShowTournamentDetails(true);
                  }}
                />
              ) : null}
              {user?.roles.includes("TEAM_CAPTAIN") ? (
                <Modal open={Boolean(registerTournamentId)} title="Đăng ký đội tham gia giải" description="Chọn đội do bạn điều hành và gửi hồ sơ đến ban tổ chức." onClose={() => setRegisterTournamentId("")}>
                  <TournamentWorkflowPanel
                    mode="captain"
                    assignedTournaments={[]}
                    initialTournamentId={registerTournamentId}
                    onNotice={(message) => {
                      setNotice(message);
                      if (message.includes("Đã gửi hồ sơ đăng ký giải")) setRegisterTournamentId("");
                    }}
                  />
                </Modal>
              ) : null}
              {user?.roles.includes("TEAM_CAPTAIN") && myTeamManageTarget ? (
                <Modal open title="Quản lý hồ sơ giải đấu" description="Cập nhật roster cầu thủ của đội tham gia giải." onClose={() => setMyTeamManageTarget(null)} className="modal-wide">
                  <TournamentWorkflowPanel
                    mode="captain"
                    assignedTournaments={[]}
                    initialTeamId={myTeamManageTarget.teamId}
                    initialTournamentId={myTeamManageTarget.tournamentId}
                    onNotice={setNotice}
                  />
                </Modal>
              ) : null}
            </>
            )
          ) : null}
          {section === "matches" ? (
            <>
              <MatchesView
                tournaments={tournaments}
                activeTournament={activeTournament}
                matches={matches}
                loading={competitionLoading}
                teamNames={teamNames}
                onSelectTournament={setSelectedTournamentId}
              />
              {user?.roles.includes("ADMIN") ? (
                <MatchPauseRequestPanel mode="admin" tournaments={tournaments} onNotice={setNotice} />
              ) : null}
              {user?.roles.includes("BTC") ? (
                <MatchPauseRequestPanel mode="btc" tournaments={assignedTournaments} onNotice={setNotice} />
              ) : null}
            </>
          ) : null}
          {section === "standings" ? (
            <StandingsView
              tournaments={tournaments}
              activeTournament={activeTournament}
              standings={standings}
              loading={competitionLoading}
              teamNames={teamNames}
              onSelectTournament={setSelectedTournamentId}
            />
          ) : null}
          {section === "teams" ? (
            <>
              <TeamsView
                teams={teams}
                ownedTeams={teams}
                directoryTeams={publicTeams}
                loading={teamsLoading || publicTeamsLoading || sessionLoading}
                canCreate={Boolean(user?.roles.includes("TEAM_CAPTAIN"))}
                canChooseInstitution={false}
                publicView={!user || (!user.roles.includes("ADMIN") && !user.roles.includes("BTC") && !user.roles.includes("TEAM_CAPTAIN") && !user.roles.includes("PLAYER"))}
                directoryAvailable={!user || user.roles.some((role) => ["ADMIN", "BTC", "TEAM_CAPTAIN", "PLAYER", "VIEWER"].includes(role))}
                personalTeamsAvailable={Boolean(user?.roles.some((role) => ["TEAM_CAPTAIN", "PLAYER"].includes(role)))}
                currentUserId={user?.userId ?? ""}
                requestMode={user?.roles.includes("TEAM_CAPTAIN") && user.roles.includes("PLAYER") ? "both" : user?.roles.includes("TEAM_CAPTAIN") ? "captain" : user?.roles.includes("PLAYER") ? "player" : null}
                profileInstitutionId={profile?.institutionId ?? user?.institutionId ?? null}
                profileFullName={profile?.fullName ?? user?.email ?? ""}
                profileStudentId={profile?.studentId ?? ""}
                profileData={profile?.profileData}
                institutions={institutions}
                tournaments={tournaments}
                onPublicFilter={filterPublicTeams}
                publicTeamsTotal={publicTeamsTotal}
                teamName={teamName}
                setTeamName={setTeamName}
                institutionId={teamInstitutionId}
                setInstitutionId={setTeamInstitutionId}
                unitName={teamUnitName}
                setUnitName={setTeamUnitName}
                contactEmail={teamContactEmail}
                setContactEmail={setTeamContactEmail}
                contactPhone={teamContactPhone}
                setContactPhone={setTeamContactPhone}
                logoUrl={teamLogoUrl}
                setLogoUrl={setTeamLogoUrl}
                kitColor={teamKitColor}
                setKitColor={setTeamKitColor}
                maxPlayers={teamMaxPlayers}
                setMaxPlayers={setTeamMaxPlayers}
                description={teamDescription}
                setDescription={setTeamDescription}
                representativeName={profile?.fullName ?? ""}
                creating={creating}
                onCreate={(event) => void handleCreateTeam(event)}
                onNotice={(message) => setNotice(message)}
              />
              {!user && !activationToken ? (
              <LoginPanel
                email={email}
                confirmPassword={confirmPassword}
                password={password}
                fullName={fullName}
                registerMode={registerMode}
                forgotPasswordMode={forgotPasswordMode}
                resetToken={resetToken}
                newPassword={newPassword}
                confirmNewPassword={confirmNewPassword}
                verificationPending={verificationPending}
                verificationDeliveryFailed={verificationDeliveryFailed}
                resending={resending}
                setEmail={setEmail}
                setPassword={setPassword}
                setConfirmPassword={setConfirmPassword}
                setFullName={setFullName}
                setRegisterMode={setRegisterMode}
                setForgotPasswordMode={setForgotPasswordMode}
                setNewPassword={setNewPassword}
                setConfirmNewPassword={setConfirmNewPassword}
                setVerificationPending={setVerificationPending}
                submitting={submitting}
                onSubmit={(event) => void handleLogin(event)}
                onRegister={(event) => void handleRegister(event)}
                onResend={() => void handleResendVerification()}
                onForgot={(event) => void handleForgotPassword(event)}
                onReset={(event) => void handleResetPassword(event)}
              />
              ) : null}
            </>
          ) : null}
          {section === "institutions" ? (
            <InstitutionManager canManage={Boolean(user?.roles.includes("ADMIN"))} />
          ) : null}

          {activationToken ? (
            <AccountActivationPanel
              submitting={submitting}
              onSubmit={handleActivateStaffAccount}
            />
          ) : null}
          {section !== "teams" && !user && !activationToken ? (
            <LoginPanel
              email={email}
              confirmPassword={confirmPassword}
              password={password}
              fullName={fullName}
              registerMode={registerMode}
              forgotPasswordMode={forgotPasswordMode}
              resetToken={resetToken}
              newPassword={newPassword}
              confirmNewPassword={confirmNewPassword}
              verificationPending={verificationPending}
              verificationDeliveryFailed={verificationDeliveryFailed}
              resending={resending}
              setEmail={setEmail}
              setPassword={setPassword}
              setConfirmPassword={setConfirmPassword}
              setFullName={setFullName}
              setRegisterMode={setRegisterMode}
              setForgotPasswordMode={setForgotPasswordMode}
              setNewPassword={setNewPassword}
              setConfirmNewPassword={setConfirmNewPassword}
              setVerificationPending={setVerificationPending}
              submitting={submitting}
              onSubmit={(event) => void handleLogin(event)}
              onRegister={(event) => void handleRegister(event)}
              onResend={() => void handleResendVerification()}
              onForgot={(event) => void handleForgotPassword(event)}
              onReset={(event) => void handleResetPassword(event)}
              compact
            />
          ) : null}

          <footer className="page-footer">
            <span>STUDENT FOOTBALL LEAGUE <b>·</b> {new Date().getFullYear()}</span>
            <span>Được xây dựng cho những người yêu bóng đá sinh viên.</span>
          </footer>
        </div>
      </main>
      <Modal
        open={pendingSection !== null}
        title="Hủy thao tác đang nhập?"
        description="Bạn đang mở hoặc chỉnh sửa biểu mẫu. Nếu rời mục này, nội dung chưa lưu sẽ bị xóa. Bạn có muốn hủy thao tác và chuyển sang chức năng khác không?"
        onClose={() => setPendingSection(null)}
        className="discard-changes-modal"
      >
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={() => setPendingSection(null)}>Ở lại biểu mẫu</button>
          <button className="primary-button discard-confirm-button" type="button" onClick={discardAndNavigate}>Hủy thao tác và chuyển mục</button>
        </div>
      </Modal>
    </div>
  );
}

function RoleDashboard(props: {
  role: UserRole;
  fullName: string;
  email: string;
  teamCount: number;
  assignedTournaments: Array<{ id: string; name: string; status: string }>;
  refereeSchedules: RefereeSchedule[];
  adminUserCount: number | null;
  onNavigate: (section: Section) => void;
  onSelectTournament: (id: string) => void;
}) {
  const description: Record<UserRole, string> = {
    ADMIN: "Theo dõi tổng quan hệ thống và truy cập các khu vực quản trị.",
    BTC: "Theo dõi các giải đấu được Admin phân công và dữ liệu điều hành.",
    TEAM_CAPTAIN: "Quản lý đội bóng của bạn và theo dõi các giải đấu đang mở.",
    PLAYER: "Theo dõi đội bóng, lịch thi đấu và kết quả công khai.",
    REFEREE: "Xem lịch trận đấu được giao và theo dõi thông tin thi đấu.",
    VIEWER: "Khám phá giải đấu, lịch thi đấu, đội bóng và bảng xếp hạng.",
  };
  return (
    <section className="role-dashboard">
      <article className="panel data-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">DASHBOARD · {props.role}</span>
            <h2>{roleTitle(props.role)} — {props.fullName}</h2>
          </div>
          <span className="status-pill">{props.email}</span>
        </div>
        <p>{description[props.role]}</p>
        <div className="feature-grid">
          {props.role === "ADMIN" ? (
            <article className="stat-card">
              <span className="stat-top">TÀI KHOẢN TOÀN HỆ THỐNG</span>
              <strong>{props.adminUserCount ?? "—"}</strong>
              <span className="stat-foot">Tổng tài khoản trong Auth Service</span>
            </article>
          ) : null}
          {props.role === "BTC" ? (
            <article className="stat-card">
              <span className="stat-top">GIẢI ĐƯỢC PHÂN CÔNG</span>
              <strong>{props.assignedTournaments.length}</strong>
              <span className="stat-foot">Danh sách tải từ API /my/tournaments</span>
            </article>
          ) : null}
          {props.role === "TEAM_CAPTAIN" || props.role === "PLAYER" ? (
            <article className="stat-card">
              <span className="stat-top">ĐỘI CỦA TÀI KHOẢN</span>
              <strong>{props.teamCount}</strong>
              <span className="stat-foot">Dữ liệu lấy từ API đội bóng</span>
            </article>
          ) : null}
          {props.role === "REFEREE" ? (
            <article className="stat-card">
              <span className="stat-top">TRẬN ĐƯỢC PHÂN CÔNG</span>
              <strong>{props.refereeSchedules.length}</strong>
              <span className="stat-foot">Lịch tải theo tài khoản trọng tài</span>
            </article>
          ) : null}
          {props.role === "VIEWER" ? (
            <article className="stat-card">
              <span className="stat-top">GIẢI ĐẤU CÔNG KHAI</span>
              <strong>Khám phá</strong>
              <span className="stat-foot">Không có quyền thao tác quản lý</span>
            </article>
          ) : null}
        </div>
        {props.role === "BTC" && props.assignedTournaments.length ? (
          <div className="fixture-list">
            {props.assignedTournaments.map((tournament) => (
              <button
                className="fixture-row"
                key={tournament.id}
                onClick={() => {
                  props.onSelectTournament(tournament.id);
                  props.onNavigate("tournaments");
                }}
                type="button"
              >
                <strong>{tournament.name}</strong><span>{statusLabel(tournament.status)}</span>
              </button>
            ))}
          </div>
        ) : null}
        {props.role === "REFEREE" && props.refereeSchedules.length ? (
          <div className="fixture-list">
            {props.refereeSchedules.slice(0, 5).map((schedule) => (
              <div className="fixture-row" key={schedule.id}>
                <strong>{formatMatchDate(schedule.scheduledDate)}</strong>
                <span>Trận {schedule.matchId.slice(0, 8)} · {statusLabel(schedule.status)}</span>
              </div>
            ))}
          </div>
        ) : null}
      </article>
    </section>
  );
}

function Overview(props: {
  activeTournament: Tournament | null;
  loading: boolean;
  tournaments: Tournament[];
  matches: Match[];
  standings: Standing[];
  teamNames: Map<string, string>;
  selectedTournamentId: string;
  onSelectTournament: (id: string) => void;
  onExploreTournament: (id: string) => void;
  onNavigate: (section: Section) => void;
}) {
  const { activeTournament, loading, tournaments, matches, standings, teamNames } = props;
  const activeCount = tournaments.filter((tournament) => ["OPEN_REGISTRATION", "IN_PROGRESS"].includes(tournament.status)).length;
  return (
    <>
      <section className="stats-grid" aria-label="Thống kê giải đấu">
        <article className="stat-card stat-highlight"><div className="stat-top"><span>GIẢI ĐẤU</span><span className="stat-icon">SFL</span></div><strong>{loading ? "—" : tournaments.length.toString().padStart(2, "0")}</strong><span className="stat-foot">Tổng số giải trong hệ thống</span></article>
        <article className="stat-card"><div className="stat-top"><span>ĐANG HOẠT ĐỘNG</span><span className="stat-icon">↗</span></div><strong>{loading ? "—" : activeCount.toString().padStart(2, "0")}</strong><span className="stat-foot">Mở đăng ký hoặc đang diễn ra</span></article>
        <article className="stat-card"><div className="stat-top"><span>TRẬN SẮP TỚI</span><span className="stat-icon">◷</span></div><strong>{loading ? "—" : matches.length.toString().padStart(2, "0")}</strong><span className="stat-foot">Thuộc giải đang được chọn</span></article>
        <article className="stat-card"><div className="stat-top"><span>ĐỘI TRÊN BẢNG</span><span className="stat-icon">◎</span></div><strong>{loading ? "—" : standings.length.toString().padStart(2, "0")}</strong><span className="stat-foot">Dữ liệu xếp hạng hiện có</span></article>
      </section>

      <div className="section-toolbar">
        <div><span className="eyebrow">ĐIỂM NHẤN MÙA GIẢI</span><h2>Đang diễn ra</h2></div>
        {tournaments.length ? (
          <label className="select-wrap"><span className="sr-only">Chọn giải đấu</span>
            <select value={activeTournament?.id ?? ""} onChange={(event) => props.onSelectTournament(event.target.value)}>
              {tournaments.map((tournament) => <option value={tournament.id} key={tournament.id}>{tournament.name}</option>)}
            </select>
          </label>
        ) : null}
      </div>

      <div className="feature-grid">
        <article className="feature-card">
          <div className="feature-banner"><span className="banner-label">MÙA GIẢI NỔI BẬT</span><span className="banner-ball">⚽</span><div className="banner-lines" /></div>
          {activeTournament ? (
            <div className="feature-details">
              <div className="feature-title-row"><div><span className="status-pill">{statusLabel(activeTournament.status)}</span><h3>{activeTournament.name}</h3></div><span className="feature-year">{new Date().getFullYear()}</span></div>
              <p>{activeTournament.description || "Giải đấu bóng đá sinh viên — nơi hội tụ tinh thần đồng đội và niềm đam mê sân cỏ."}</p>
              <div className="feature-meta"><span>⌖ {activeTournament.location || "Địa điểm sẽ cập nhật"}</span><span>◷ {formatDate(activeTournament.startDate)}{activeTournament.endDate ? ` — ${formatDate(activeTournament.endDate)}` : ""}</span><span>♧ Tối đa {activeTournament.maxTeams} đội</span></div>
              <button className="text-button" onClick={() => props.onExploreTournament(activeTournament.id)} type="button">Khám phá giải đấu <span>↗</span></button>
            </div>
          ) : (
            <EmptyState title="Chưa có giải đấu" detail="Các giải đấu mới sẽ xuất hiện tại đây khi được tạo." />
          )}
        </article>

        <article className="panel upcoming-panel">
          <div className="panel-heading"><div><span className="eyebrow">SÂN CỎ SẮP LĂN BÓNG</span><h2>Lịch thi đấu</h2></div><button className="subtle-link" onClick={() => props.onNavigate("matches")} type="button">Tất cả <span>↗</span></button></div>
          {matches.length ? (
            <div className="fixture-list">
              {matches.slice(0, 4).map((match, index) => (
                <FixtureRow key={match.id} match={match} index={index} teamNames={teamNames} />
              ))}
            </div>
          ) : <EmptyState title="Chưa có trận đấu" detail="Lịch thi đấu sẽ xuất hiện sau khi được lập." />}
        </article>
      </div>

      <article className="panel standings-preview">
        <div className="panel-heading"><div><span className="eyebrow">CUỘC ĐUA ĐIỂM SỐ</span><h2>Bảng xếp hạng</h2></div><button className="subtle-link" onClick={() => props.onNavigate("standings")} type="button">Chi tiết <span>↗</span></button></div>
        <StandingsTable standings={standings.slice(0, 5)} teamNames={teamNames} />
      </article>
    </>
  );
}

function TournamentList(props: {
  tournaments: Tournament[];
  loading: boolean;
  selectedId: string;
  institutions: Institution[];
  canRegister: boolean;
  onSelect: (id: string) => void;
  onRegister: (id: string) => void;
  onViewTournament: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState("");
  const [institutionId, setInstitutionId] = useState("");
  const [status, setStatus] = useState("");
  const filtered = props.tournaments.filter((tournament) => {
    const searchMatch = !search.trim() || tournament.name.toLocaleLowerCase("vi").includes(search.trim().toLocaleLowerCase("vi"));
    return searchMatch && (!scope || tournament.scope === scope) && (!status || tournament.status === status) && (!institutionId || tournament.organizingInstitutionId === institutionId);
  });
  if (props.loading) return <LoadingState />;
  if (!props.tournaments.length) return <EmptyState title="Chưa có giải đấu nào" detail="Khi ban tổ chức tạo giải mới, thông tin sẽ hiển thị tại đây." />;
  return (
    <section className="tournament-browser">
      <div className="panel-heading"><div><span className="eyebrow">TRA CỨU VÀ THAM GIA</span><h2>Tất cả giải đấu</h2><p>Tìm giải theo thể thức, đơn vị tổ chức và trạng thái hiện tại.</p></div><span className="status-pill">{filtered.length} / {props.tournaments.length} giải</span></div>
      <div className="tournament-filters" aria-label="Bộ lọc giải đấu">
        <label className="field">Tìm theo tên<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nhập tên giải đấu" /></label>
        <label className="field">Loại giải<select value={scope} onChange={(event) => setScope(event.target.value)}><option value="">Tất cả loại giải</option><option value="SINGLE_INSTITUTION">Giải nội bộ trường</option><option value="INTER_SCHOOL">Giải liên trường</option></select></label>
        <label className="field">Trường tổ chức<select value={institutionId} onChange={(event) => setInstitutionId(event.target.value)}><option value="">Tất cả trường</option>{props.institutions.map((institution) => <option key={institution.id} value={institution.id}>{institution.name}</option>)}</select></label>
        <label className="field">Tình trạng<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Tất cả trạng thái</option>{["OPEN_REGISTRATION", "REGISTRATION_CLOSED", "ROSTER_LOCKED", "PREPARING", "IN_PROGRESS", "PAUSED", "COMPLETED", "CANCELLED"].map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</select></label>
      </div>
      {filtered.length ? <div className="tournament-grid">
        {filtered.map((tournament, index) => {
          const registrationOpen = isRegistrationPeriodOpen(tournament);
          const actionLabel = registrationOpen && props.canRegister ? "Đăng ký tham gia" : tournament.status === "ROSTER_LOCKED" ? "Xem danh sách đội" : tournament.status === "PREPARING" ? "Xem bốc thăm & lịch" : tournament.status === "IN_PROGRESS" ? "Theo dõi giải đấu" : tournament.status === "COMPLETED" ? "Xem kết quả" : "Xem chi tiết giải";
          const registrationPeriods = tournament.registrationPeriods ?? [];
          const now = Date.now();
          const tournamentStatusLabel = tournament.status === "OPEN_REGISTRATION" && !registrationOpen
            ? registrationPeriods.length === 0
              ? "Chưa có kỳ đăng ký"
              : registrationPeriods.some((period) => new Date(period.startDate).getTime() > now)
                ? "Chưa đến kỳ đăng ký"
                : "Đã hết kỳ đăng ký"
            : statusLabel(tournament.status);
          return <article className={`tournament-card ${props.selectedId === tournament.id ? "selected" : ""}`} key={tournament.id}>
            <div className={`tournament-art art-${index % 3}`}><span>SFL<br />{String(new Date().getFullYear()).slice(-2)}</span><i>⚽</i></div>
            <div className="tournament-card-content">
              <button className="tournament-card-main" type="button" onClick={() => props.onSelect(tournament.id)}>
                <div className="tournament-card-top"><span className="status-pill">{tournamentStatusLabel}</span><span className="card-arrow">↗</span></div>
                <h3>{tournament.name}</h3>
                <p>{tournament.description || "Giải bóng đá sinh viên"}</p>
                <div className="tournament-card-meta"><span>⌖ {tournament.location || "Chưa cập nhật"}</span><span>♧ Tối đa {tournament.maxTeams} đội</span></div>
                <div className="tournament-date">{formatDate(tournament.startDate)}{tournament.endDate ? ` — ${formatDate(tournament.endDate)}` : ""}</div>
              </button>
              <button className={registrationOpen && props.canRegister ? "primary-button tournament-card-action" : "text-button tournament-card-action"} type="button" onClick={() => registrationOpen && props.canRegister ? props.onRegister(tournament.id) : props.onViewTournament(tournament.id)}>{actionLabel} <span>↗</span></button>
            </div>
          </article>;
        })}
      </div> : <EmptyState title="Không có giải phù hợp" detail="Thử thay đổi bộ lọc trạng thái, loại giải hoặc trường tổ chức." />}
    </section>
  );
}

function MatchesView(props: {
  tournaments: Tournament[];
  activeTournament: Tournament | null;
  matches: Match[];
  loading: boolean;
  teamNames: Map<string, string>;
  onSelectTournament: (id: string) => void;
}) {
  return (
    <section className="panel data-panel">
      <div className="panel-heading panel-heading-wrap"><div><span className="eyebrow">LỊCH TRÌNH MÙA GIẢI</span><h2>{props.activeTournament?.name ?? "Chọn giải đấu"}</h2></div><TournamentSelect tournaments={props.tournaments} activeId={props.activeTournament?.id ?? ""} onChange={props.onSelectTournament} /></div>
      {props.loading ? <LoadingState /> : props.matches.length ? (
        <div className="match-table">
          <div className="table-head match-row"><span>NGÀY & GIỜ</span><span>VÒNG ĐẤU</span><span>TRẬN ĐẤU</span><span>ĐỊA ĐIỂM</span><span>TRẠNG THÁI</span></div>
          {props.matches.map((match, index) => (
            <div className="match-row" key={match.id}>
              <span className="match-date">{formatMatchDate(match.matchDate)}</span>
              <span>{match.round || "Vòng đấu"}</span>
              <span className="match-teams"><strong>{props.teamNames.get(match.homeTeamId) || shortTeamName(match.homeTeamId, index * 2)}</strong><i>VS</i><strong>{props.teamNames.get(match.awayTeamId) || shortTeamName(match.awayTeamId, index * 2 + 1)}</strong></span>
              <span>{match.venue || "Chưa xếp sân"}</span>
              <span><span className={`status-pill status-${match.status.toLowerCase()}`}>{statusLabel(match.status)}</span></span>
            </div>
          ))}
        </div>
      ) : <EmptyState title="Lịch thi đấu chưa được cập nhật" detail="Khi ban tổ chức tạo lịch cho giải này, các trận đấu sẽ xuất hiện tại đây." />}
    </section>
  );
}

function StandingsView(props: {
  tournaments: Tournament[];
  activeTournament: Tournament | null;
  standings: Standing[];
  loading: boolean;
  teamNames: Map<string, string>;
  onSelectTournament: (id: string) => void;
}) {
  return (
    <section className="panel data-panel">
      <div className="panel-heading panel-heading-wrap"><div><span className="eyebrow">THÀNH TÍCH CÁC ĐỘI</span><h2>{props.activeTournament?.name ?? "Chọn giải đấu"}</h2></div><TournamentSelect tournaments={props.tournaments} activeId={props.activeTournament?.id ?? ""} onChange={props.onSelectTournament} /></div>
      {props.loading ? <LoadingState /> : props.standings.length ? <StandingsTable standings={props.standings} teamNames={props.teamNames} /> : <EmptyState title="Chưa có dữ liệu xếp hạng" detail="Bảng xếp hạng sẽ tự động cập nhật sau khi có kết quả trận đấu." />}
    </section>
  );
}

function TeamsView(props: {
  teams: Array<Pick<Team, "id" | "name" | "shortName" | "description" | "logoUrl" | "institutionId" | "unitName" | "kitColor" | "isActive">>;
  ownedTeams: Team[];
  directoryTeams: PublicTeam[];
  loading: boolean;
  canCreate: boolean;
  canChooseInstitution: boolean;
  publicView: boolean;
  directoryAvailable: boolean;
  personalTeamsAvailable: boolean;
  currentUserId: string;
  requestMode: "player" | "captain" | "both" | null;
  profileInstitutionId: string | null;
  profileFullName: string;
  profileStudentId: string;
  profileData: UserProfilePublic["profileData"];
  institutions: Institution[];
  tournaments: Tournament[];
  onPublicFilter: (institutionId: string, search: string, offset?: number, isActive?: boolean, sortBy?: "NAME" | "CREATED_AT") => void;
  publicTeamsTotal: number;
  teamName: string;
  setTeamName: (name: string) => void;
  institutionId: string;
  setInstitutionId: (value: string) => void;
  unitName: string;
  setUnitName: (value: string) => void;
  contactEmail: string;
  setContactEmail: (value: string) => void;
  contactPhone: string;
  setContactPhone: (value: string) => void;
  logoUrl: string;
  setLogoUrl: (value: string) => void;
  kitColor: string;
  setKitColor: (value: string) => void;
  maxPlayers: string;
  setMaxPlayers: (value: string) => void;
  description: string;
  setDescription: (value: string) => void;
  representativeName: string;
  creating: boolean;
  onCreate: (event: FormEvent<HTMLFormElement>) => void;
  onNotice: (message: string) => void;
}) {
  const [viewMode, setViewMode] = useState<"directory" | "mine">(
    props.requestMode === "player" || !props.directoryAvailable ? "mine" : "directory",
  );
  const [mineScope, setMineScope] = useState<"player" | "captain">(props.requestMode === "captain" ? "captain" : "player");
  const [createTeamFormOpen, setCreateTeamFormOpen] = useState(false);
  const [teamPanelAction, setTeamPanelAction] = useState<"overview" | "members" | "add">("overview");
  const [schoolFilter, setSchoolFilter] = useState("");
  const [teamSearch, setTeamSearch] = useState("");
  const [appliedSchoolFilter, setAppliedSchoolFilter] = useState("");
  const [appliedTeamSearch, setAppliedTeamSearch] = useState("");
  const [teamActivityFilter, setTeamActivityFilter] = useState<"" | "active" | "inactive">("");
  const [appliedTeamActivityFilter, setAppliedTeamActivityFilter] = useState<"" | "active" | "inactive">("");
  const [teamSortBy, setTeamSortBy] = useState<"NAME" | "CREATED_AT">("CREATED_AT");
  const [appliedTeamSortBy, setAppliedTeamSortBy] = useState<"NAME" | "CREATED_AT">("CREATED_AT");
  const [publicPage, setPublicPage] = useState(0);
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [publicTeamDetail, setPublicTeamDetail] = useState<PublicTeamDetail | null>(null);
  const [selectedPublicPlayerId, setSelectedPublicPlayerId] = useState("");
  const [players, setPlayers] = useState<Awaited<ReturnType<typeof getPlayers>>["players"]>([]);
  const [playersLoading, setPlayersLoading] = useState(false);
  const [playerSubmitting, setPlayerSubmitting] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [playerName, setPlayerName] = useState("");
  const [playerBirthDate, setPlayerBirthDate] = useState("");
  const [playerStudentId, setPlayerStudentId] = useState("");
  const [playerEmail, setPlayerEmail] = useState("");
  const [playerJersey, setPlayerJersey] = useState("");
  const [playerPosition, setPlayerPosition] = useState("");
  const [playerEvidenceUrl, setPlayerEvidenceUrl] = useState("");
  const [editingPlayerId, setEditingPlayerId] = useState<string | null>(null);
  const [memberForm, setMemberForm] = useState({ fullName: "", studentId: "", jerseyNumber: "", position: "" });
  const [memberDeleteTarget, setMemberDeleteTarget] = useState<Awaited<ReturnType<typeof getPlayers>>["players"][number] | null>(null);
  const isDirectory = props.publicView || (props.directoryAvailable && viewMode === "directory");
  const memberTeams = props.ownedTeams.filter((team) => team.isPlayer);
  const managedTeams = props.ownedTeams.filter((team) => team.captainId === props.currentUserId);
  const displayedTeams = isDirectory ? props.directoryTeams : mineScope === "captain" ? managedTeams : memberTeams;

  useEffect(() => {
    if (!selectedTeamId) {
      setPlayers([]);
      setPublicTeamDetail(null);
      return;
    }
    let active = true;
    setPlayersLoading(true);
    setPlayerError(null);
    if (isDirectory) {
      getPublicTeamDetail(selectedTeamId)
        .then((detail) => { if (active) setPublicTeamDetail(detail); })
        .catch((err: unknown) => { if (active) setPlayerError(`Không tải được hồ sơ công khai đội bóng: ${errorMessage(err)}`); })
        .finally(() => { if (active) setPlayersLoading(false); });
    } else {
      getPlayers(selectedTeamId)
        .then(({ players: items }) => { if (active) setPlayers(items); })
        .catch((err: unknown) => { if (active) setPlayerError(`Không tải được danh sách cầu thủ: ${errorMessage(err)}`); })
        .finally(() => { if (active) setPlayersLoading(false); });
    }
    return () => {
      active = false;
    };
  }, [selectedTeamId, isDirectory]);

  async function handleAddPlayer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTeamId) return;
    setPlayerSubmitting(true);
    setPlayerError(null);
    try {
      await addPlayer({
        teamId: selectedTeamId,
        fullName: playerName.trim(),
        birthDate: playerBirthDate,
        studentId: playerStudentId.trim() || undefined,
        contactEmail: playerEmail.trim() || undefined,
        jerseyNumber: playerJersey ? Number(playerJersey) : undefined,
        position: playerPosition || undefined,
        evidenceUrl: playerEvidenceUrl.trim() || undefined,
      });
      setPlayerName("");
      setPlayerBirthDate("");
      setPlayerStudentId("");
      setPlayerEmail("");
      setPlayerJersey("");
      setPlayerPosition("");
      setPlayerEvidenceUrl("");
      const { players: items } = await getPlayers(selectedTeamId);
      setPlayers(items);
      props.onNotice("Đã thêm cầu thủ vào hồ sơ đội.");
    } catch (err) {
      setPlayerError(errorMessage(err, "Không thể thêm cầu thủ."));
    } finally {
      setPlayerSubmitting(false);
    }
  }

  function startEditingPlayer(player: Awaited<ReturnType<typeof getPlayers>>["players"][number]) {
    setEditingPlayerId(player.id);
    setMemberForm({ fullName: player.fullName ?? "", studentId: player.studentId ?? "", jerseyNumber: player.jerseyNumber ? String(player.jerseyNumber) : "", position: player.position ?? "" });
  }

  async function savePlayerChanges(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingPlayerId || !selectedTeamId) return;
    setPlayerSubmitting(true);
    setPlayerError(null);
    try {
      await updatePlayer(editingPlayerId, {
        fullName: memberForm.fullName.trim(),
        studentId: memberForm.studentId.trim() || undefined,
        jerseyNumber: memberForm.jerseyNumber ? Number(memberForm.jerseyNumber) : undefined,
        position: memberForm.position || undefined,
      });
      const { players: items } = await getPlayers(selectedTeamId);
      setPlayers(items);
      setEditingPlayerId(null);
      props.onNotice("Đã cập nhật thông tin thành viên.");
    } catch (err) {
      setPlayerError(errorMessage(err, "Không thể cập nhật thành viên."));
    } finally {
      setPlayerSubmitting(false);
    }
  }

  async function removeManualPlayer() {
    if (!memberDeleteTarget || !selectedTeamId) return;
    setPlayerSubmitting(true);
    setPlayerError(null);
    try {
      await deletePlayer(memberDeleteTarget.id);
      const { players: items } = await getPlayers(selectedTeamId);
      setPlayers(items);
      setMemberDeleteTarget(null);
      props.onNotice("Đã xóa hồ sơ thành viên khỏi đội.");
    } catch (err) {
      setPlayerError(errorMessage(err, "Không thể xóa thành viên."));
    } finally {
      setPlayerSubmitting(false);
    }
  }

  const selectedTeam = props.ownedTeams.find((team) => team.id === selectedTeamId);
  const canManageSelectedTeam = Boolean(selectedTeam && selectedTeam.captainId === props.currentUserId);
  const visibleTeams = displayedTeams.filter((team) =>
    (!appliedSchoolFilter || team.institutionId === appliedSchoolFilter) &&
    (!appliedTeamActivityFilter || team.isActive === (appliedTeamActivityFilter === "active")) &&
    (!appliedTeamSearch || `${team.name} ${team.shortName ?? ""}`.toLocaleLowerCase().includes(appliedTeamSearch.trim().toLocaleLowerCase())),
  );

  function applyTeamFilters() {
    const effectiveSchool = schoolFilter;
    setSchoolFilter(effectiveSchool);
    setAppliedSchoolFilter(effectiveSchool);
    setAppliedTeamSearch(teamSearch);
    setAppliedTeamActivityFilter(teamActivityFilter);
    setAppliedTeamSortBy(teamSortBy);
    setPublicPage(0);
    if (isDirectory) props.onPublicFilter(effectiveSchool, teamSearch, 0, teamActivityFilter === "" ? undefined : teamActivityFilter === "active", teamSortBy);
  }

  function clearTeamFilters() {
    const effectiveSchool = "";
    setSchoolFilter(effectiveSchool);
    setTeamSearch("");
    setAppliedSchoolFilter(effectiveSchool);
    setAppliedTeamSearch("");
    setTeamActivityFilter("");
    setAppliedTeamActivityFilter("");
    setTeamSortBy("CREATED_AT");
    setAppliedTeamSortBy("CREATED_AT");
    setPublicPage(0);
    if (isDirectory) props.onPublicFilter(effectiveSchool, "", 0, undefined, "CREATED_AT");
  }

  function changePublicPage(nextPage: number) {
    const pageCount = Math.max(1, Math.ceil(props.publicTeamsTotal / 20));
    if (nextPage < 0 || nextPage >= pageCount) return;
    setPublicPage(nextPage);
    props.onPublicFilter(appliedSchoolFilter, appliedTeamSearch, nextPage * 20, appliedTeamActivityFilter === "" ? undefined : appliedTeamActivityFilter === "active", appliedTeamSortBy);
  }

  return (
    <>
      {props.personalTeamsAvailable ? (
        <nav className="team-view-tabs" aria-label="Chế độ xem đội bóng">
          <button className={isDirectory ? "is-active" : ""} type="button" onClick={() => { setViewMode("directory"); setSelectedTeamId(""); }}>Danh bạ câu lạc bộ</button>
          <button className={!isDirectory ? "is-active" : ""} type="button" onClick={() => { setViewMode("mine"); setSelectedTeamId(""); }}>Đội của tôi <span>{props.teams.length}</span></button>
        </nav>
      ) : null}
      {!isDirectory && props.requestMode === "both" ? (
        <nav className="team-view-tabs team-ownership-tabs" aria-label="Đội tham gia hoặc điều hành">
          <button className={mineScope === "player" ? "is-active" : ""} type="button" onClick={() => { setMineScope("player"); setSelectedTeamId(""); }}>Đội tôi tham gia <span>{memberTeams.length}</span></button>
          <button className={mineScope === "captain" ? "is-active" : ""} type="button" onClick={() => { setMineScope("captain"); setSelectedTeamId(""); }}>Đội tôi điều hành <span>{managedTeams.length}</span></button>
        </nav>
      ) : null}
      {!isDirectory && props.requestMode ? <PlayerTeamRequestsPanel mode={props.requestMode} viewMode={props.requestMode === "both" ? mineScope : undefined} onViewModeChange={setMineScope} ownedTeams={props.ownedTeams} fullName={props.profileFullName} studentId={props.profileStudentId} profileData={props.profileData} institutionId={props.profileInstitutionId} onNotice={props.onNotice} /> : null}
      {props.canCreate && !isDirectory ? (
        <section className="create-panel">
          <div className="panel-title-row"><div><span className="eyebrow">HỒ SƠ CÂU LẠC BỘ</span><h2>Tạo đội bóng</h2></div><button className="secondary-button" type="button" onClick={() => setCreateTeamFormOpen((open) => !open)}>{createTeamFormOpen ? "Đóng biểu mẫu" : "Tạo đội bóng mới"}</button></div>
          {createTeamFormOpen ? <form className="form-grid" onSubmit={props.onCreate}>
            <label className="field">
              Tên đội bóng
              <input value={props.teamName} onChange={(event) => props.setTeamName(event.target.value)} maxLength={255} required />
            </label>
            <label className="field">
              Trường đại diện
              {props.canChooseInstitution ? (
                <select value={props.institutionId} onChange={(event) => props.setInstitutionId(event.target.value)} required>
                  <option value="">Chọn trường</option>
                  {props.institutions.map((institution) => <option value={institution.id} key={institution.id}>{institution.name}</option>)}
                </select>
              ) : (
                <>
                  <input value={props.institutions.find((institution) => institution.id === props.institutionId)?.name ?? props.institutionId} readOnly required />
                  <small>Trường được lấy từ hồ sơ đã được BTC xác minh.</small>
                </>
              )}
            </label>
            <label className="field">
              Khoa / đơn vị trực thuộc
              <input value={props.unitName} onChange={(event) => props.setUnitName(event.target.value)} maxLength={255} />
            </label>
            <label className="field">
              Người đại diện
              <input value={props.representativeName} readOnly required aria-describedby="representative-help" />
              <small id="representative-help">Lấy từ hồ sơ tài khoản đang đăng nhập.</small>
            </label>
            <label className="field">
              Email liên hệ
              <input type="email" value={props.contactEmail} onChange={(event) => props.setContactEmail(event.target.value)} maxLength={255} required />
            </label>
            <label className="field">
              Số điện thoại liên hệ
              <input type="tel" value={props.contactPhone} onChange={(event) => props.setContactPhone(event.target.value)} pattern="[+()0-9 .-]{7,30}" maxLength={30} required />
            </label>
            <label className="field">
              Logo (URL)
              <input type="url" value={props.logoUrl} onChange={(event) => props.setLogoUrl(event.target.value)} maxLength={500} />
            </label>
            <label className="field">
              Màu áo
              <input value={props.kitColor} onChange={(event) => props.setKitColor(event.target.value)} maxLength={40} placeholder="Ví dụ: xanh navy - trắng" />
            </label>
            <label className="field">
              Số cầu thủ tối đa
              <input type="number" min={1} max={100} value={props.maxPlayers} onChange={(event) => props.setMaxPlayers(event.target.value)} required />
            </label>
            <label className="field field-wide">
              Mô tả đội bóng
              <textarea value={props.description} onChange={(event) => props.setDescription(event.target.value)} rows={3} maxLength={2000} />
            </label>
          
          {props.institutions.length === 0 ? <p className="form-help">Cần có ít nhất một trường đang hoạt động trước khi tạo đội. Hãy thêm trường trong mục Trường học.</p> : null}
          <button className="primary-button" disabled={props.creating || !props.institutions.length}>
            {props.creating ? "Đang tạo…" : "Lưu đội bóng"} <span>↗</span>
          </button>
          </form> : null}
        </section>
      ) : null}
      <section className="section-toolbar team-directory-toolbar">
        <div><span className="eyebrow">{isDirectory ? "DANH BẠ CÂU LẠC BỘ" : props.personalTeamsAvailable ? "ĐỘI CỦA TÔI" : "ĐỘI BÓNG"}</span><h2>{isDirectory ? "Khám phá câu lạc bộ" : props.personalTeamsAvailable ? "Đội bóng của bạn" : "Tìm đội bóng"}</h2></div>
        <div className="team-directory-filters">
          <label className="field">
            <span className="sr-only">Lọc theo trường</span>
            <select value={schoolFilter} onChange={(event) => setSchoolFilter(event.target.value)}>
              <option value="">Tất cả trường</option>
              {props.institutions.map((institution) => <option value={institution.id} key={institution.id}>{institution.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="sr-only">Tìm đội bóng</span>
            <input value={teamSearch} onChange={(event) => setTeamSearch(event.target.value)} placeholder="Tìm tên đội / CLB" />
          </label>
          <label className="field">
            <span className="sr-only">Trạng thái đội bóng</span>
            <select value={teamActivityFilter} onChange={(event) => setTeamActivityFilter(event.target.value as "" | "active" | "inactive")}>
              <option value="">Mọi trạng thái</option>
              <option value="active">Đang hoạt động</option>
              <option value="inactive">Tạm ngưng</option>
            </select>
          </label>
          <label className="field">
            <span className="sr-only">Sắp xếp câu lạc bộ</span>
            <select value={teamSortBy} onChange={(event) => setTeamSortBy(event.target.value as "NAME" | "CREATED_AT")}>
              <option value="CREATED_AT">Mới cập nhật</option>
              <option value="NAME">Tên A–Z</option>
            </select>
          </label>
          <div className="team-filter-actions"><button className="primary-button" type="button" onClick={applyTeamFilters}>Áp dụng</button><button className="text-button" type="button" onClick={clearTeamFilters}>Xóa bộ lọc</button></div>
        </div>
      </section>
      {props.loading ? <LoadingState /> : visibleTeams.length ? (
        <>
          <section className="team-grid">
          {visibleTeams.map((team, index) => (
              <article className="team-card" key={team.id}>
                <button className={`team-crest crest-${index % 4} ${isDirectory ? "team-crest-button" : ""}`} type="button" aria-label={`Xem chi tiết ${team.name}`} onClick={() => isDirectory && setSelectedTeamId(team.id)}>
                  {team.logoUrl ? <img src={team.logoUrl} alt="" /> : team.name.slice(0, 2).toUpperCase()}
                </button>
                <div>
                  <span className="eyebrow">{!isDirectory ? (props.ownedTeams.some((owned) => owned.id === team.id && owned.captainId === props.currentUserId) && props.ownedTeams.some((owned) => owned.id === team.id && owned.isPlayer) ? "BẠN THAM GIA VÀ ĐIỀU HÀNH" : props.ownedTeams.some((owned) => owned.id === team.id && owned.captainId === props.currentUserId) ? "BẠN ĐIỀU HÀNH ĐỘI NÀY" : "BẠN LÀ THÀNH VIÊN") : team.isActive ? "ĐỘI ĐANG HOẠT ĐỘNG" : "ĐỘI TẠM NGƯNG"}</span>
                  {isDirectory ? <h3><button className="public-detail-link" type="button" onClick={() => setSelectedTeamId(team.id)}>{team.name}</button></h3> : <h3>{team.name}</h3>}
                  <p>{team.description || "Chưa có mô tả đội bóng."}</p>
                  <p>{props.institutions.find((institution) => institution.id === team.institutionId)?.name ?? "Chưa liên kết trường"}{team.unitName ? ` · ${team.unitName}` : ""}</p>
                </div>
                {!isDirectory ? <button className="secondary-button" type="button" onClick={() => { setSelectedTeamId(team.id); setTeamPanelAction(props.ownedTeams.some((owned) => owned.id === team.id && owned.captainId === props.currentUserId) ? "overview" : "members"); }}>{props.ownedTeams.some((owned) => owned.id === team.id && owned.captainId === props.currentUserId) ? "Quản lý đội" : "Xem đội"}</button> : null}
              </article>
            ))}
          </section>
          {!visibleTeams.length ? <EmptyState title="Không tìm thấy đội phù hợp" detail="Thử chọn trường khác hoặc xóa từ khóa tìm kiếm." /> : null}
          {isDirectory ? <div className="notification-pagination team-directory-pagination"><span>{props.publicTeamsTotal} câu lạc bộ · Trang {publicPage + 1}/{Math.max(1, Math.ceil(props.publicTeamsTotal / 20))}</span><div><button className="text-button" type="button" disabled={publicPage === 0} onClick={() => changePublicPage(publicPage - 1)}>Trước</button><button className="text-button" type="button" disabled={(publicPage + 1) * 20 >= props.publicTeamsTotal} onClick={() => changePublicPage(publicPage + 1)}>Sau</button></div></div> : null}
          {!isDirectory && selectedTeam ? (
            <Modal open title={selectedTeam.name} description={canManageSelectedTeam ? "Không gian quản lý đội của bạn" : "Thông tin đội bạn tham gia"} onClose={() => setSelectedTeamId("")} className="team-management-modal">
              <div className="team-management-actions" role="tablist" aria-label="Chức năng đội bóng">
                <button className={teamPanelAction === "overview" ? "is-active" : ""} type="button" onClick={() => setTeamPanelAction("overview")}>Tổng quan</button>
                <button className={teamPanelAction === "members" ? "is-active" : ""} type="button" onClick={() => setTeamPanelAction("members")}>Danh sách cầu thủ</button>
                {canManageSelectedTeam ? <button className={teamPanelAction === "add" ? "is-active" : ""} type="button" onClick={() => setTeamPanelAction("add")}>Thêm cầu thủ</button> : null}
              </div>
              {teamPanelAction === "overview" ? <div className="team-overview-card"><span className="eyebrow">{selectedTeam.isActive ? "ĐỘI ĐANG HOẠT ĐỘNG" : "ĐỘI TẠM NGƯNG"}</span><p>{selectedTeam.description || "Đội chưa cập nhật phần giới thiệu."}</p><dl><div><dt>Trường</dt><dd>{props.institutions.find((institution) => institution.id === selectedTeam.institutionId)?.name ?? "Chưa liên kết trường"}</dd></div><div><dt>Đơn vị</dt><dd>{selectedTeam.unitName || "Chưa cập nhật"}</dd></div><div><dt>Đại diện</dt><dd>{selectedTeam.representativeName || "Chưa cập nhật"}</dd></div><div><dt>Email liên hệ</dt><dd>{selectedTeam.contactEmail || "Chưa cập nhật"}</dd></div><div><dt>Số điện thoại</dt><dd>{selectedTeam.contactPhone || "Chưa cập nhật"}</dd></div><div><dt>Sức chứa</dt><dd>Tối đa {selectedTeam.maxPlayers} cầu thủ</dd></div></dl>{canManageSelectedTeam ? <p className="form-help">Bạn là đội trưởng và có quyền quản lý danh sách thành viên.</p> : <p className="form-help">Bạn chỉ có quyền xem đội và gửi yêu cầu rời đội ở khu vực Đội tôi tham gia.</p>}</div> : null}
              {players.some((player) => player.userId === props.currentUserId) ? (() => {
                const myMembership = players.find((player) => player.userId === props.currentUserId)!;
                return <div className="my-team-role-card"><span className="team-role-icon">⚽</span><div><span className="eyebrow">VAI TRÒ CỦA BẠN</span><strong>{myMembership.isCaptain ? "Đội trưởng" : "Cầu thủ"}</strong><p>{myMembership.jerseyNumber ? `Áo số ${myMembership.jerseyNumber}` : "Chưa có số áo"} · {myMembership.position ?? "Chưa cập nhật vị trí"}</p></div></div>;
              })() : null}
              {playerError ? <p className="form-error" role="alert">{playerError}</p> : null}
              {canManageSelectedTeam && teamPanelAction === "add" ? <form className="form-grid" onSubmit={(event) => void handleAddPlayer(event)}>
                <label className="field">Họ và tên<input value={playerName} onChange={(event) => setPlayerName(event.target.value)} maxLength={255} required /></label>
                <label className="field">Ngày sinh<input type="date" value={playerBirthDate} onChange={(event) => setPlayerBirthDate(event.target.value)} required /></label>
                <label className="field">Mã số sinh viên<input value={playerStudentId} onChange={(event) => setPlayerStudentId(event.target.value)} maxLength={100} /></label>
                <label className="field">Email liên hệ<input type="email" value={playerEmail} onChange={(event) => setPlayerEmail(event.target.value)} maxLength={255} /></label>
                <label className="field">Số áo<input type="number" min={1} max={99} value={playerJersey} onChange={(event) => setPlayerJersey(event.target.value)} /></label>
                <label className="field">Vị trí thi đấu
                  <select value={playerPosition} onChange={(event) => setPlayerPosition(event.target.value)}>
                    <option value="">Chưa chọn</option><option value="GK">Thủ môn</option><option value="DEF">Hậu vệ</option><option value="MID">Tiền vệ</option><option value="FWD">Tiền đạo</option>
                  </select>
                </label>
                <label className="field field-wide">Liên kết minh chứng tư cách sinh viên<input type="url" value={playerEvidenceUrl} onChange={(event) => setPlayerEvidenceUrl(event.target.value)} maxLength={1000} /></label>
                {playerError ? <p className="field-wide form-error" role="alert">{playerError}</p> : null}
                <div className="field-wide form-actions"><button className="primary-button" disabled={playerSubmitting}>{playerSubmitting ? "Đang lưu…" : "Thêm cầu thủ"} <span>↗</span></button></div>
              </form> : null}
              {teamPanelAction === "members" && playersLoading ? <LoadingState /> : null}
              {teamPanelAction === "members" && !playersLoading && players.length ? (
                <div className="player-list">
                  {players.map((player) => (
                    <article className="player-row" key={player.id}>
                      <div className="player-row-main"><strong>{player.fullName ?? "Cầu thủ chưa cập nhật tên"}</strong><span>{player.isCaptain ? "Đội trưởng" : "Thành viên"}</span></div>
                      <span>{player.jerseyNumber ? `Áo số ${player.jerseyNumber}` : "Chưa có số áo"} · {player.position ?? "Chưa rõ vị trí"}</span>
                      {canManageSelectedTeam ? <><span>{player.studentId || "Chưa có mã sinh viên"}</span>{player.evidenceUrl ? <a href={player.evidenceUrl} target="_blank" rel="noreferrer">Xem minh chứng</a> : <span>Chưa có minh chứng</span>}
                        <div className="member-actions"><button className="text-button" type="button" onClick={() => startEditingPlayer(player)}>Chỉnh sửa</button>{!player.userId || player.leftAt ? <button className="text-button danger-text" type="button" onClick={() => setMemberDeleteTarget(player)}>Xóa</button> : <small>Thành viên có tài khoản cần gửi yêu cầu rời đội.</small>}</div>
                      </> : null}
                      {editingPlayerId === player.id ? <form className="member-edit-form" onSubmit={(event) => void savePlayerChanges(event)}><label className="field">Họ tên<input value={memberForm.fullName} onChange={(event) => setMemberForm({ ...memberForm, fullName: event.target.value })} required /></label><label className="field">Mã sinh viên<input value={memberForm.studentId} onChange={(event) => setMemberForm({ ...memberForm, studentId: event.target.value })} /></label><label className="field">Số áo<input type="number" min={1} max={99} value={memberForm.jerseyNumber} onChange={(event) => setMemberForm({ ...memberForm, jerseyNumber: event.target.value })} /></label><label className="field">Vị trí<select value={memberForm.position} onChange={(event) => setMemberForm({ ...memberForm, position: event.target.value })}><option value="">Chưa chọn</option><option value="GK">Thủ môn</option><option value="DEF">Hậu vệ</option><option value="MID">Tiền vệ</option><option value="FWD">Tiền đạo</option></select></label><div className="form-actions"><button className="primary-button" disabled={playerSubmitting}>Lưu thay đổi</button><button className="text-button" type="button" onClick={() => setEditingPlayerId(null)}>Hủy</button></div></form> : null}
                    </article>
                  ))}
                </div>
              ) : teamPanelAction === "members" && !playersLoading ? <EmptyState title="Chưa có cầu thủ" detail={canManageSelectedTeam ? "Chọn Thêm cầu thủ để cập nhật danh sách đội." : "Đội chưa công khai danh sách cầu thủ."} /> : null}
            </Modal>
          ) : null}
          {isDirectory && selectedTeamId ? (
            <section className="panel data-panel public-team-detail">
              <div className="panel-heading public-team-detail-heading">
                <div><span className="eyebrow">HỒ SƠ CÔNG KHAI</span><h2>{publicTeamDetail?.team.name ?? selectedTeam?.name ?? "Đội bóng"}</h2></div>
                <button className="text-button" type="button" onClick={() => { setSelectedTeamId(""); setSelectedPublicPlayerId(""); }}>Đóng</button>
              </div>
              {playersLoading ? <LoadingState /> : playerError ? <p className="form-error" role="alert">{playerError}</p> : publicTeamDetail ? (
                <>
                  <div className="public-team-summary">
                    <div className="public-team-crest">{publicTeamDetail.team.logoUrl ? <img src={publicTeamDetail.team.logoUrl} alt={`Logo ${publicTeamDetail.team.name}`} /> : <span>{publicTeamDetail.team.name.slice(0, 2).toUpperCase()}</span>}</div>
                    <div className="public-team-overview">
                      <div className="public-team-tags"><span className="public-team-tag">{publicTeamDetail.team.institutionName ?? "Chưa liên kết trường"}</span>{publicTeamDetail.team.unitName ? <span className="public-team-tag">{publicTeamDetail.team.unitName}</span> : null}</div>
                      <p className="public-team-description">{publicTeamDetail.team.description || "Câu lạc bộ chưa cập nhật phần giới thiệu."}</p>
                      <div className="public-team-facts"><div><span>ĐỘI TRƯỞNG</span><strong>{publicTeamDetail.players.find((player) => player.teamRole === "CAPTAIN")?.fullName ?? "Chưa công khai"}</strong></div><div><span>ĐẠI DIỆN CLB</span><strong>{publicTeamDetail.team.representativeName ?? "Chưa cập nhật"}</strong></div><div><span>THÀNH VIÊN</span><strong>{publicTeamDetail.players.length} cầu thủ</strong></div></div>
                    </div>
                  </div>
                  <div className="public-team-sections">
                    <section className="public-team-section public-team-tournaments"><div className="public-team-section-title"><span className="public-section-icon">🏆</span><div><span className="eyebrow">HÀNH TRÌNH THI ĐẤU</span><h3>Giải đấu tham gia</h3></div></div>{publicTeamDetail.team.tournamentIds.length ? <div className="public-tournament-list">{publicTeamDetail.team.tournamentIds.map((id) => <div className="public-tournament-item" key={id}><span>🏆</span><strong>{props.tournaments.find((tournament) => tournament.id === id)?.name ?? "Giải đấu"}</strong></div>)}</div> : <p className="public-section-empty">CLB chưa có giải đấu được công bố.</p>}</section>
                    <section className="public-team-section public-team-members"><div className="public-team-section-title"><span className="public-section-icon">👥</span><div><span className="eyebrow">ĐỘI HÌNH</span><h3>Thành viên câu lạc bộ</h3></div><span className="public-member-count">{publicTeamDetail.players.length}</span></div>{publicTeamDetail.players.length ? <div className="public-player-grid">{publicTeamDetail.players.map((player) => <button className="public-player-card" key={player.id} type="button" onClick={() => setSelectedPublicPlayerId(player.id)}><span className="player-avatar" aria-hidden="true">{player.fullName?.slice(0, 1) ?? "C"}</span><span className="public-player-copy"><strong>{player.fullName ?? "Cầu thủ"}</strong><small>{player.teamRole === "CAPTAIN" ? "ĐỘI TRƯỞNG" : "THÀNH VIÊN"}</small><span>{player.jerseyNumber ? `Áo số ${player.jerseyNumber}` : "Chưa có số áo"} · {player.position ?? "Chưa cập nhật vị trí"}</span></span><span className="public-player-chevron">↗</span></button>)}</div> : <p className="public-section-empty">Danh sách thành viên chưa được công khai.</p>}</section>
                  </div>
                  {selectedPublicPlayerId ? (() => {
                    const player = publicTeamDetail.players.find((item) => item.id === selectedPublicPlayerId);
                    return player ? <div className="public-player-detail" role="dialog" aria-modal="true" aria-label="Thông tin cầu thủ"><button className="text-button" type="button" onClick={() => setSelectedPublicPlayerId("")}>Đóng</button><h3>{player.fullName ?? "Cầu thủ"}</h3><p>{player.jerseyNumber ? `Áo số ${player.jerseyNumber}` : "Chưa có số áo"} · {player.position ?? "Chưa rõ vị trí"}</p><p>{publicTeamDetail.team.name} · {publicTeamDetail.team.institutionName ?? "Chưa liên kết trường"}</p><p>{player.teamRole === "CAPTAIN" ? "Đội trưởng" : "Thành viên"}</p><small>Chưa có thống kê thi đấu trong dữ liệu hiện tại.</small></div> : null;
                  })() : null}
                </>
              ) : null}
            </section>
          ) : null}
        </>
      ) : <EmptyState title={isDirectory ? "Chưa tìm thấy câu lạc bộ" : "Chưa có đội bóng"} detail={isDirectory ? "Thử thay đổi bộ lọc trường hoặc từ khóa tìm kiếm." : "Đội trưởng sẽ thấy đội mình quản lý; cầu thủ sẽ thấy các đội đã tham gia."} />}
      <Modal open={Boolean(memberDeleteTarget)} title="Xóa thành viên khỏi đội?" onClose={() => setMemberDeleteTarget(null)}>{memberDeleteTarget ? <><p>Bạn muốn xóa hồ sơ <strong>{memberDeleteTarget.fullName}</strong> khỏi danh sách đội?</p><div className="form-actions"><button className="danger-button" type="button" disabled={playerSubmitting} onClick={() => void removeManualPlayer()}>{playerSubmitting ? "Đang xóa…" : "Xóa thành viên"}</button><button className="text-button" type="button" onClick={() => setMemberDeleteTarget(null)}>Hủy</button></div></> : null}</Modal>
    </>
  );
}

function StandingsTable(props: { standings: Standing[]; teamNames: Map<string, string> }) {
  if (!props.standings.length) return <EmptyState title="Chưa có bảng xếp hạng" detail="Bảng điểm sẽ cập nhật sau khi các trận đấu có kết quả." />;
  return (
    <div className="standings-table">
      <div className="standing-row standing-header"><span>HẠNG</span><span>ĐỘI BÓNG</span><span>TRẬN</span><span>THẮNG</span><span>HÒA</span><span>THUA</span><span>HS</span><span>ĐIỂM</span></div>
      {props.standings.map((standing, index) => (
        <div className="standing-row" key={standing.id}>
          <span className={`rank rank-${index + 1}`}>{String(index + 1).padStart(2, "0")}</span>
          <strong className="standing-team"><span className={`team-mini mini-${index % 4}`}>{(props.teamNames.get(standing.teamId) ?? shortTeamName(standing.teamId, index)).slice(0, 1).toUpperCase()}</span>{props.teamNames.get(standing.teamId) || shortTeamName(standing.teamId, index)}</strong>
          <span>{standing.played}</span><span>{standing.won}</span><span>{standing.drawn}</span><span>{standing.lost}</span><span>{standing.goalDifference > 0 ? `+${standing.goalDifference}` : standing.goalDifference}</span><strong className="points">{standing.points}</strong>
        </div>
      ))}
    </div>
  );
}

function FixtureRow(props: { match: Match; index: number; teamNames: Map<string, string> }) {
  return (
    <div className="fixture-row">
      <div className="fixture-date"><strong>{formatMatchDate(props.match.matchDate).split(" ")[0]}</strong><span>{formatMatchDate(props.match.matchDate).split(" ")[1] ?? ""}</span></div>
      <div className="fixture-info"><strong>{props.teamNames.get(props.match.homeTeamId) || shortTeamName(props.match.homeTeamId, props.index * 2)}</strong><span className="fixture-vs">VS</span><strong>{props.teamNames.get(props.match.awayTeamId) || shortTeamName(props.match.awayTeamId, props.index * 2 + 1)}</strong><small>{props.match.venue || props.match.round || "Chưa xếp sân"}</small></div>
      <span className="fixture-arrow">↗</span>
    </div>
  );
}

function TournamentSelect(props: { tournaments: Tournament[]; activeId: string; onChange: (id: string) => void }) {
  if (!props.tournaments.length) return null;
  return (
    <label className="select-wrap"><span className="sr-only">Chọn giải đấu</span><select value={props.activeId} onChange={(event) => props.onChange(event.target.value)}>{props.tournaments.map((tournament) => <option key={tournament.id} value={tournament.id}>{tournament.name}</option>)}</select></label>
  );
}

function LoginPanel(props: {
  email: string;
  password: string;
  confirmPassword: string;
  fullName: string;
  registerMode: boolean;
  forgotPasswordMode: boolean;
  resetToken: string;
  newPassword: string;
  confirmNewPassword: string;
  verificationPending: boolean;
  verificationDeliveryFailed: boolean;
  resending: boolean;
  setEmail: (value: string) => void;
  setPassword: (value: string) => void;
  setConfirmPassword: (value: string) => void;
  setFullName: (value: string) => void;
  setRegisterMode: (value: boolean) => void;
  setForgotPasswordMode: (value: boolean) => void;
  setNewPassword: (value: string) => void;
  setConfirmNewPassword: (value: string) => void;
  setVerificationPending: (value: boolean) => void;
  submitting: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onRegister: (event: FormEvent<HTMLFormElement>) => void;
  onResend: () => void;
  onForgot: (event: FormEvent<HTMLFormElement>) => void;
  onReset: (event: FormEvent<HTMLFormElement>) => void;
  compact?: boolean;
}) {
  return (
    <section className={`login-panel ${props.compact ? "login-compact" : ""}`} id="login">
      <div className="login-copy"><span className="eyebrow">{props.verificationPending ? "CHỜ XÁC MINH EMAIL" : "DÀNH CHO THÀNH VIÊN"}</span><h2>{props.verificationPending ? props.verificationDeliveryFailed ? "Chưa gửi được email xác minh." : "Kiểm tra hộp thư của bạn." : props.registerMode ? "Tạo tài khoản mới." : props.compact ? "Không bỏ lỡ phần của bạn." : "Đăng nhập để quản lý đội bóng."}</h2><p>{props.verificationPending ? props.verificationDeliveryFailed ? `Tài khoản đã được tạo nhưng email xác minh chưa gửi được đến ${props.email}. Kiểm tra cấu hình/hộp thư rồi thử gửi lại; không cần đăng ký lại.` : `Liên kết xác minh đã được gửi đến ${props.email}. Hãy kiểm tra hộp thư và thư rác để kích hoạt tài khoản trước khi đăng nhập.` : props.registerMode ? "Đăng ký tạo tài khoản Khán giả (VIEWER) bằng email thật. Sau khi xác minh, bạn có thể gửi yêu cầu cấp quyền Đội trưởng hoặc Cầu thủ để Ban tổ chức xét duyệt." : "Đăng nhập để xem thông tin cá nhân và sử dụng các chức năng theo vai trò của bạn."}</p></div>
      {props.verificationPending ? (
        <div className="login-form"><button className="primary-button" onClick={props.onResend} disabled={props.resending}>{props.resending ? "Đang gửi…" : props.verificationDeliveryFailed ? "Thử gửi email xác minh lại" : "Gửi lại email xác minh"} <span>↗</span></button><button className="text-button" onClick={() => props.setVerificationPending(false)} type="button">Quay lại đăng nhập</button></div>
      ) : props.resetToken ? (
        <form className="login-form" onSubmit={props.onReset}>
          <label className="field">Mật khẩu mới<input type="password" autoComplete="new-password" minLength={8} value={props.newPassword} onChange={(event) => props.setNewPassword(event.target.value)} placeholder="Tối thiểu 8 ký tự" required /></label>
          <label className="field">Xác nhận mật khẩu mới<input type="password" autoComplete="new-password" minLength={8} value={props.confirmNewPassword} onChange={(event) => props.setConfirmNewPassword(event.target.value)} required /></label>
          <button className="primary-button" disabled={props.submitting}>{props.submitting ? "Đang cập nhật…" : "Đặt lại mật khẩu"} <span>↗</span></button>
        </form>
      ) : props.forgotPasswordMode ? (
        <form className="login-form" onSubmit={props.onForgot}>
          <label className="field">Email<input type="email" autoComplete="email" value={props.email} onChange={(event) => props.setEmail(event.target.value)} required /></label>
          <button className="primary-button" disabled={props.submitting}>{props.submitting ? "Đang gửi…" : "Gửi liên kết đặt lại"} <span>↗</span></button>
          <button className="text-button" onClick={() => props.setForgotPasswordMode(false)} type="button">Quay lại đăng nhập</button>
        </form>
      ) : props.registerMode ? (
        <form className="login-form" onSubmit={props.onRegister}>
          <label className="field">Họ và tên<input autoComplete="name" value={props.fullName} onChange={(event) => props.setFullName(event.target.value)} placeholder="Nguyễn Văn A" required /></label>
          <label className="field">Email<input type="email" autoComplete="email" value={props.email} onChange={(event) => props.setEmail(event.target.value)} placeholder="ten@truong.edu.vn" required /></label>
          <label className="field">Mật khẩu<input type="password" autoComplete="new-password" minLength={8} value={props.password} onChange={(event) => props.setPassword(event.target.value)} placeholder="Tối thiểu 8 ký tự" required /></label>
          <label className="field">Xác nhận mật khẩu<input type="password" autoComplete="new-password" minLength={8} value={props.confirmPassword} onChange={(event) => props.setConfirmPassword(event.target.value)} required /></label>
          <button className="primary-button" disabled={props.submitting}>{props.submitting ? "Đang gửi email…" : "Tạo tài khoản"} <span>↗</span></button>
          <button className="text-button" onClick={() => props.setRegisterMode(false)} type="button">Đã có tài khoản? Đăng nhập</button>
        </form>
      ) : (
        <form className="login-form" onSubmit={props.onSubmit}>
          <label className="field">Email<input type="email" autoComplete="username" value={props.email} onChange={(event) => props.setEmail(event.target.value)} placeholder="ten@truong.edu.vn" required /></label>
          <label className="field">Mật khẩu<input type="password" autoComplete="current-password" value={props.password} onChange={(event) => props.setPassword(event.target.value)} placeholder="Nhập mật khẩu" required /></label>
          <button className="primary-button" disabled={props.submitting}>{props.submitting ? "Đang xử lý…" : "Đăng nhập"} <span>↗</span></button>
          <button className="text-button" onClick={() => props.setForgotPasswordMode(true)} type="button">Quên mật khẩu?</button>
          <button className="text-button" onClick={() => props.setRegisterMode(true)} type="button">Chưa có tài khoản? Đăng ký</button>
        </form>
      )}
    </section>
  );
}

function EmptyState(props: { title: string; detail: string }) {
  return <div className="empty-state"><span className="empty-mark">S</span><h3>{props.title}</h3><p>{props.detail}</p></div>;
}

function LoadingState() {
  return <div className="loading-state"><span className="loader" /> Đang tải dữ liệu…</div>;
}

function shortTeamName(teamId: string, index: number): string {
  if (!teamId) return `Đội ${index + 1}`;
  return `Đội ${teamId.slice(0, 6).toUpperCase()}`;
}

function sectionDescription(section: Section): string {
  const descriptions: Record<Section, string> = {
    overview: "Theo dõi giải đấu, lịch thi đấu và những khoảnh khắc đáng nhớ của bóng đá sinh viên.",
    myAccount: "Xem hồ sơ, cập nhật thông tin cá nhân và quản lý bảo mật tài khoản.",
    accounts: "Quản lý tài khoản Ban tổ chức và Trọng tài, theo dõi trạng thái kích hoạt.",
    roleApplications: "Đăng ký quyền nghiệp vụ hoặc xét duyệt yêu cầu cấp vai trò.",
    notifications: "Theo dõi và tìm kiếm thông báo cá nhân theo trạng thái và thời gian.",
    tournaments: "Khám phá các giải đấu và theo dõi hành trình của mùa giải.",
    matches: "Cập nhật lịch trình, vòng đấu và địa điểm của từng trận.",
    standings: "Theo dõi thành tích và cuộc đua điểm số của các đội.",
    teams: "Quản lý thông tin đội bóng và chuẩn bị cho mùa giải.",
    institutions: "Quản lý danh mục trường học và đơn vị tham gia giải.",
  };
  return descriptions[section];
}

function errorMessage(error: unknown, fallback = "Đã xảy ra lỗi không xác định"): string {
  return error instanceof Error ? error.message : fallback;
}

export { App };
