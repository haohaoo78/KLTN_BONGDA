import { useCallback, useEffect, useMemo, useState } from "react";
import { useDialog } from "./DialogProvider";
import { NOTIFICATION_REALTIME_EVENT } from "../api/client";
import { useMatchFeedInvalidation } from "../hooks/useMatchFeedInvalidation";
import { Modal } from "./Modal";
import {
  createTournamentSchedule,
  checkTournamentScheduleConflicts,
  assignScheduleReferees,
  getScheduleReferees,
  getScheduleRefereeHistory,
  getScheduleChangeHistory,
  getActiveVenues,
  getManagedTournamentSchedules,
  getPublicTournamentSchedules,
  getMatches,
  searchRefereeCandidates,
  updateTournamentSchedule,
  setTournamentScheduleLock,
  type Match,
  type TournamentSchedule,
  type RefereeCandidate,
  type ScheduleRefereeAssignment,
  type ScheduleRefereeAssignmentHistory,
  type ScheduleChangeHistory,
  type Venue,
} from "../api/competition";

type RefereeDraft = Pick<ScheduleRefereeAssignment, "refereeId" | "position" | "isFinalAuthority">;

const REFEREE_POSITIONS = [
  "REFEREE",
  "ASSISTANT_REFEREE_1",
  "ASSISTANT_REFEREE_2",
  "FOURTH_OFFICIAL",
  "MATCH_SECRETARY",
  "ASSISTANT_REFEREE_3",
  "ASSISTANT_REFEREE_4",
];

type Props = {
  tournaments: Array<{ id: string; name: string; status: string }>;
  teamNames?: Map<string, string>;
  mode?: "venues" | "referees";
  onNotice: (message: string) => void;
  onOpenPublicView?: () => void;
  onPublished?: () => void;
};

function localDateTimeInSevenDays(): string {
  const date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  date.setMinutes(0, 0, 0);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function toLocalDateTimeInput(value: string): string {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function matchParticipantLabel(teamId: string | null, side: "home" | "away", teamNames?: Map<string, string>): string {
  if (!teamId) return side === "home" ? "Đang chờ đội vào nhánh" : "Đang chờ đối thủ ở nhánh";
  return teamNames?.get(teamId) ?? teamId.slice(0, 8);
}

export function ScheduleManagementPanel({ tournaments, teamNames, mode = "venues", onNotice, onOpenPublicView, onPublished }: Props) {
  const { confirm } = useDialog();
  const [tournamentId, setTournamentId] = useState("");
  const [matches, setMatches] = useState<Match[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [schedules, setSchedules] = useState<TournamentSchedule[]>([]);
  const [selectedScheduleId, setSelectedScheduleId] = useState("");
  const [matchId, setMatchId] = useState("");
  const [venueId, setVenueId] = useState("");
  const [scheduledDate, setScheduledDate] = useState(localDateTimeInSevenDays);
  const [durationMinutes, setDurationMinutes] = useState(90);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [crewDrafts, setCrewDrafts] = useState<Record<string, RefereeDraft[]>>({});
  const [savedCrewDrafts, setSavedCrewDrafts] = useState<Record<string, RefereeDraft[]>>({});
  const [refereeCandidates, setRefereeCandidates] = useState<RefereeCandidate[]>([]);
  const [candidateSearch, setCandidateSearch] = useState("");
  const [scheduleSearch, setScheduleSearch] = useState("");
  const [dayFilter, setDayFilter] = useState("");
  const [roundFilter, setRoundFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [assignmentFilter, setAssignmentFilter] = useState("ALL");
  const [schedulePage, setSchedulePage] = useState(1);
  const [crewChangeReasons, setCrewChangeReasons] = useState<Record<string, string>>({});
  const [historyScheduleId, setHistoryScheduleId] = useState("");
  const [crewHistory, setCrewHistory] = useState<ScheduleRefereeAssignmentHistory[]>([]);
  const [scheduleDrafts, setScheduleDrafts] = useState<Record<string, { venueId: string; scheduledDate: string; durationMinutes: number; reason: string }>>({});
  const [editingScheduleId, setEditingScheduleId] = useState("");
  const [scheduleHistoryId, setScheduleHistoryId] = useState("");
  const [scheduleHistory, setScheduleHistory] = useState<ScheduleChangeHistory[]>([]);
  const [scheduleWorkspaceOpen, setScheduleWorkspaceOpen] = useState(false);
  const [conflictCheck, setConflictCheck] = useState<{ hasConflict: boolean; conflicts: Array<{ type: "venue" | "team" | "referee"; scheduleId: string; reason: string }> } | null>(null);
  const [realtimeRevision, setRealtimeRevision] = useState(0);
  const refreshRealtime = useCallback(() => setRealtimeRevision((revision) => revision + 1), []);
  useMatchFeedInvalidation(refreshRealtime);

  useEffect(() => {
    window.addEventListener(NOTIFICATION_REALTIME_EVENT, refreshRealtime);
    return () => window.removeEventListener(NOTIFICATION_REALTIME_EVENT, refreshRealtime);
  }, [refreshRealtime]);

  useEffect(() => {
    if (!tournaments.some((tournament) => tournament.id === tournamentId)) {
      setTournamentId(tournaments[0]?.id ?? "");
    }
  }, [tournamentId, tournaments]);

  useEffect(() => {
    if (!tournamentId) {
      setMatches([]);
      setVenues([]);
      setSchedules([]);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    Promise.all([
      getMatches(tournamentId),
      getActiveVenues(),
      getManagedTournamentSchedules(tournamentId),
    ]).then(async ([matchResult, venueResult, scheduleResult]) => {
      if (!active) return;
      setMatches(matchResult.items);
      setVenues(venueResult.venues.filter((venue) => venue.isActive));
      setSchedules(scheduleResult.schedules);
      setSelectedScheduleId((current) => scheduleResult.schedules.some((schedule) => schedule.id === current)
        ? current
        : scheduleResult.schedules[0]?.id ?? "");
      setScheduleDrafts((current) => Object.fromEntries(scheduleResult.schedules.map((schedule) => [schedule.id, current[schedule.id] ?? {
        venueId: schedule.venueId,
        scheduledDate: toLocalDateTimeInput(schedule.scheduledDate),
        durationMinutes: schedule.durationMinutes,
        reason: "",
      }])));
      const crews = await Promise.all(scheduleResult.schedules.map(async (schedule) => {
        const result = await getScheduleReferees(schedule.id);
        return [schedule.id, result.assignments.map(({ refereeId, position, isFinalAuthority }) => ({ refereeId, position, isFinalAuthority }))] as const;
      }));
      if (!active) return;
      setCrewDrafts(Object.fromEntries(crews));
      setSavedCrewDrafts(Object.fromEntries(crews));
      setVenueId((current) => venueResult.venues.some((venue) => venue.id === current)
        ? current
        : venueResult.venues.find((venue) => venue.isActive)?.id ?? "");
      setMatchId((current) => matchResult.items.some((match) => match.id === current)
        ? current
        : matchResult.items.find((match) => match.status === "UNSCHEDULED")?.id ?? "");
    }).catch((err: unknown) => {
      if (active) setError(err instanceof Error ? err.message : "Không tải được dữ liệu lịch thi đấu.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [tournamentId, realtimeRevision]);

  useEffect(() => {
    if (mode !== "referees") return;
    const timer = setTimeout(() => {
      void searchRefereeCandidates(candidateSearch).then(({ users }) => setRefereeCandidates(users))
        .catch((err: unknown) => setError(err instanceof Error ? err.message : "Không tải được danh sách trọng tài."));
    }, 250);
    return () => clearTimeout(timer);
  }, [candidateSearch, mode]);

  const scheduledMatchIds = useMemo(
    () => new Set(schedules.filter((schedule) => schedule.status !== "CANCELLED").map((schedule) => schedule.matchId)),
    [schedules],
  );
  const schedulableMatches = matches.filter((match) =>
    (match.status === "UNSCHEDULED" || match.status === "SCHEDULED") && !scheduledMatchIds.has(match.id),
  );
  const hasCompletePublishedSchedule = (publishedScheduleIds: ReadonlySet<string>) => {
    const requiredMatches = matches.filter((match) => match.status === "UNSCHEDULED" || match.status === "SCHEDULED");
    return requiredMatches.length > 0 && requiredMatches.every((match) => schedules.some((schedule) =>
      schedule.matchId === match.id && (publishedScheduleIds.has(schedule.id) || schedule.status === "PUBLISHED"),
    ));
  };
  const matchById = new Map(matches.map((match) => [match.id, match]));
  const venueById = new Map(venues.map((venue) => [venue.id, venue]));
  const roundOptions = [...new Set(schedules.map((schedule) => matchById.get(schedule.matchId)?.round).filter((round): round is string => Boolean(round)))].sort();
  const filteredSchedules = schedules.filter((schedule) => {
    const match = matchById.get(schedule.matchId);
    const scheduledDay = new Date(schedule.scheduledDate).toLocaleDateString("sv-SE");
    const crew = crewDrafts[schedule.id] ?? [];
    const home = match ? matchParticipantLabel(match.homeTeamId, "home", teamNames) : "";
    const away = match ? matchParticipantLabel(match.awayTeamId, "away", teamNames) : "";
    const officials = crew.map((item) => {
      const candidate = refereeCandidates.find((person) => person.userId === item.refereeId);
      return candidate ? `${candidate.fullName} ${candidate.email}` : item.refereeId;
    }).join(" ");
    const text = [match?.round, home, away, venueById.get(schedule.venueId)?.name, officials, scheduledDay].join(" ").toLocaleLowerCase();
    return (!scheduleSearch.trim() || text.includes(scheduleSearch.trim().toLocaleLowerCase())) &&
      (!dayFilter || scheduledDay === dayFilter) &&
      (!roundFilter || match?.round === roundFilter) &&
      (statusFilter === "ALL" || schedule.status === statusFilter) &&
      (assignmentFilter === "ALL" || (assignmentFilter === "ASSIGNED" ? crew.length > 0 : crew.length === 0));
  }).sort((left, right) => left.scheduledDate.localeCompare(right.scheduledDate));
  const schedulePageSize = 12;
  const schedulePageCount = Math.max(1, Math.ceil(filteredSchedules.length / schedulePageSize));
  const visibleSchedules = filteredSchedules.slice((schedulePage - 1) * schedulePageSize, schedulePage * schedulePageSize);
  const activeSchedule = visibleSchedules.find((schedule) => schedule.id === selectedScheduleId) ?? visibleSchedules[0] ?? null;
  const unassignedCount = schedules.filter((schedule) => !(crewDrafts[schedule.id] ?? []).length).length;
  const totalScheduleMatches = matches.filter((match) => match.status === "UNSCHEDULED" || match.status === "SCHEDULED").length;
  const scheduledMatchCount = matches.filter((match) => (match.status === "UNSCHEDULED" || match.status === "SCHEDULED") && scheduledMatchIds.has(match.id)).length;
  const unscheduledMatchCount = Math.max(0, totalScheduleMatches - scheduledMatchCount);

  async function handleCreate() {
    if (!tournamentId || !matchId || !venueId || !scheduledDate) {
      setError("Chọn trận, sân và thời gian trước khi lưu.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { schedule } = await createTournamentSchedule({
        tournamentId,
        matchId,
        venueId,
        scheduledDate: new Date(scheduledDate).toISOString(),
        durationMinutes,
      });
      setSchedules((current) => [schedule, ...current.filter((item) => item.id !== schedule.id)]);
      setSelectedScheduleId(schedule.id);
      setMatchId("");
      onNotice("Đã lưu lịch ở trạng thái nháp. Công bố để lịch hiển thị công khai.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không lưu được lịch thi đấu.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCheckConflicts() {
    if (!tournamentId || !matchId || !venueId || !scheduledDate || !Number.isInteger(durationMinutes) || durationMinutes < 1) {
      setError("Chọn trận, sân, ngày giờ và thời lượng hợp lệ trước khi kiểm tra.");
      return;
    }
    setSubmitting(true); setError(null); setConflictCheck(null);
    try {
      const result = await checkTournamentScheduleConflicts({ tournamentId, matchId, venueId, scheduledDate: new Date(scheduledDate).toISOString(), durationMinutes });
      setConflictCheck(result);
      onNotice(result.hasConflict ? `Phát hiện ${result.conflicts.length} xung đột lịch cần xử lý.` : "Kiểm tra lịch thành công: chưa phát hiện xung đột.");
    } catch (err) { setError(err instanceof Error ? err.message : "Không kiểm tra được xung đột lịch."); }
    finally { setSubmitting(false); }
  }

  async function handlePublishAllDrafts() {
    const drafts = schedules.filter((schedule) => schedule.status === "DRAFT");
    if (!drafts.length) return;
    if (!await confirm({ title: "Công bố toàn bộ lịch nháp?", description: `${drafts.length} trận sẽ được công bố lần lượt. Mỗi trận vẫn được backend kiểm tra xung đột; nếu có lỗi, thao tác dừng tại trận lỗi và phần đã công bố được báo rõ.`, confirmLabel: "Công bố lịch" })) return;
    setSubmitting(true); setError(null);
    let publishedCount = 0;
    const publishedScheduleIds = new Set(schedules.filter((schedule) => schedule.status === "PUBLISHED").map((schedule) => schedule.id));
    try {
      for (const draft of drafts) {
        const { schedule } = await updateTournamentSchedule(draft.id, { status: "PUBLISHED" });
        publishedCount += 1;
        publishedScheduleIds.add(schedule.id);
        setSchedules((current) => current.map((item) => item.id === schedule.id ? schedule : item));
      }
      onNotice(`Đã công bố ${publishedCount} lịch thi đấu.`);
      if (hasCompletePublishedSchedule(publishedScheduleIds)) onPublished?.();
    } catch (err) {
      setError(`${err instanceof Error ? err.message : "Không công bố được lịch."} Đã công bố ${publishedCount}/${drafts.length} trận; các lịch còn lại vẫn là bản nháp.`);
      onNotice(`Công bố lịch dừng ở lỗi: đã công bố ${publishedCount}/${drafts.length} trận. Hãy xử lý lỗi hiển thị rồi công bố tiếp.`);
    } finally { setSubmitting(false); }
  }

  async function handleOpenPublicSchedule() {
    if (!tournamentId || !onOpenPublicView) return;
    setSubmitting(true); setError(null);
    try {
      const { schedules: published } = await getPublicTournamentSchedules(tournamentId);
      if (!published.length) { setError("Chưa có lịch nào được công bố để xem công khai."); return; }
      onOpenPublicView();
    } catch (err) { setError(err instanceof Error ? err.message : "Không tải được lịch công khai."); }
    finally { setSubmitting(false); }
  }

  async function handlePublish(schedule: TournamentSchedule) {
    if (!await confirm({ title: "Công bố lịch trận?", description: "Lịch sẽ hiển thị công khai. Máy chủ sẽ kiểm tra lại thời gian, sân và điều kiện của đội trước khi lưu.", confirmLabel: "Công bố lịch" })) return;
    setSubmitting(true);
    setError(null);
    try {
      const { schedule: published } = await updateTournamentSchedule(schedule.id, { status: "PUBLISHED" });
      setSchedules((current) => current.map((item) => item.id === published.id ? published : item));
      onNotice("Đã công bố lịch thi đấu.");
      if (hasCompletePublishedSchedule(new Set([published.id]))) onPublished?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không công bố được lịch.");
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleOfficialScheduleLock(schedule: TournamentSchedule) {
    if (mode !== "venues" || schedule.status !== "DRAFT") return;
    setSubmitting(true); setError(null);
    try {
      const { schedule: updated } = await setTournamentScheduleLock(schedule.id, !schedule.isLocked);
      setSchedules((current) => current.map((item) => item.id === updated.id ? updated : item));
      onNotice(updated.isLocked ? "Đã khóa lịch nháp trong database nghiệp vụ." : "Đã mở khóa lịch nháp.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không đổi được trạng thái khóa lịch.");
    } finally { setSubmitting(false); }
  }

  async function saveScheduleChange(schedule: TournamentSchedule, status?: "CANCELLED") {
    const draft = scheduleDrafts[schedule.id];
    if (!draft) return;
    if (draft.reason.trim().length < 10) { setError("Nhập lý do thay đổi lịch tối thiểu 10 ký tự."); return; }
    if (!status && (!draft.venueId || !draft.scheduledDate || !Number.isInteger(draft.durationMinutes))) { setError("Chọn sân, thời gian và thời lượng hợp lệ."); return; }
    setSubmitting(true); setError(null);
    try {
      const result = await updateTournamentSchedule(schedule.id, {
        ...(status ? { status } : {
          venueId: draft.venueId,
          scheduledDate: new Date(draft.scheduledDate).toISOString(),
          durationMinutes: draft.durationMinutes,
        }),
        reason: draft.reason.trim(),
      });
      setSchedules((current) => current.map((item) => item.id === result.schedule.id ? result.schedule : item));
      setScheduleDrafts((current) => ({ ...current, [schedule.id]: { ...draft, reason: "" } }));
      setEditingScheduleId("");
      onNotice(result.notificationFailures?.length
        ? `Đã lưu thay đổi lịch; chưa gửi thông báo tới ${result.notificationFailures.length} người nhận.`
        : status ? "Đã hủy lịch, ghi lịch sử và gửi thông báo cho đội/trọng tài." : "Đã đổi lịch, ghi lịch sử và gửi thông báo cho đội/trọng tài.");
      const { history } = await getScheduleChangeHistory(schedule.id);
      setScheduleHistory(history);
      setScheduleHistoryId(schedule.id);
    } catch (err) { setError(err instanceof Error ? err.message : "Không cập nhật được lịch thi đấu."); }
    finally { setSubmitting(false); }
  }

  async function toggleScheduleHistory(scheduleId: string) {
    if (scheduleHistoryId === scheduleId) { setScheduleHistoryId(""); return; }
    setSubmitting(true); setError(null);
    try {
      const { history } = await getScheduleChangeHistory(scheduleId);
      setScheduleHistory(history);
      setScheduleHistoryId(scheduleId);
    } catch (err) { setError(err instanceof Error ? err.message : "Không tải được lịch sử thay đổi lịch."); }
    finally { setSubmitting(false); }
  }

  function updateCrew(scheduleId: string, index: number, changes: Partial<RefereeDraft>) {
    setCrewDrafts((current) => ({
      ...current,
      [scheduleId]: (current[scheduleId] ?? []).map((item, itemIndex) => itemIndex === index ? { ...item, ...changes } : item),
    }));
  }

  function changesSavedCrew(scheduleId: string): boolean {
    const saved = savedCrewDrafts[scheduleId] ?? [];
    const draft = crewDrafts[scheduleId] ?? [];
    return saved.some((current) => !draft.some((next) =>
      next.refereeId === current.refereeId &&
      next.position === current.position &&
      next.isFinalAuthority === current.isFinalAuthority
    ));
  }

  function addCrewOfficial(scheduleId: string) {
    setCrewDrafts((current) => {
      const crew = current[scheduleId] ?? [];
      const position = REFEREE_POSITIONS.find((candidate) => !crew.some((item) => item.position === candidate));
      if (!position) return current;
      return { ...current, [scheduleId]: [...crew, { refereeId: "", position, isFinalAuthority: crew.length === 0 }] };
    });
  }

  async function saveCrew(schedule: TournamentSchedule) {
    const assignments = crewDrafts[schedule.id] ?? [];
    if (assignments.length && assignments.some((item) => !item.refereeId)) { setError("Chọn tài khoản cho từng vị trí trước khi lưu."); return; }
    if (assignments.length && assignments.filter((item) => item.isFinalAuthority).length !== 1) { setError("Chọn đúng một trọng tài có quyền xác nhận kết quả cuối cùng."); return; }
    setSubmitting(true); setError(null);
    try {
      const { assignments: saved, notificationFailures } = await assignScheduleReferees(schedule.id, assignments, crewChangeReasons[schedule.id]);
      const savedDraft = saved.map(({ refereeId, position, isFinalAuthority }) => ({ refereeId, position, isFinalAuthority }));
      setCrewDrafts((current) => ({ ...current, [schedule.id]: savedDraft }));
      setSavedCrewDrafts((current) => ({ ...current, [schedule.id]: savedDraft }));
      setCrewChangeReasons((current) => ({ ...current, [schedule.id]: "" }));
      onNotice(notificationFailures.length
        ? `Đã lưu tổ trọng tài; chưa gửi được thông báo cho ${notificationFailures.length} tài khoản.`
        : "Đã lưu tổ trọng tài, ghi lịch sử và gửi thông báo cho người được thay đổi phân công.");
    } catch (err) { setError(err instanceof Error ? err.message : "Không lưu được tổ trọng tài."); }
    finally { setSubmitting(false); }
  }

  async function toggleCrewHistory(scheduleId: string) {
    if (historyScheduleId === scheduleId) { setHistoryScheduleId(""); return; }
    setSubmitting(true); setError(null);
    try {
      const { history } = await getScheduleRefereeHistory(scheduleId);
      setCrewHistory(history);
      setHistoryScheduleId(scheduleId);
    } catch (err) { setError(err instanceof Error ? err.message : "Không tải được lịch sử phân công."); }
    finally { setSubmitting(false); }
  }

  const scheduleSummary = mode === "venues" ? <section className="panel data-panel step5-schedule-summary">
      <div className="step5-schedule-summary-head"><div><span className="eyebrow">BƯỚC 5 · LẬP LỊCH THI ĐẤU</span><h2>Tiến độ lập lịch</h2></div></div>
      <div className="step5-schedule-stats"><article><span>Tổng số trận</span><strong>{totalScheduleMatches}</strong></article><article><span>Đã lập lịch</span><strong>{scheduledMatchCount}</strong></article><article><span>Chưa lập lịch</span><strong>{unscheduledMatchCount}</strong></article><article><span>Tiến độ</span><strong>{scheduledMatchCount} / {totalScheduleMatches}</strong></article><article><span>Hoàn thành</span><strong>{totalScheduleMatches ? Math.round(scheduledMatchCount / totalScheduleMatches * 100) : 0}%</strong></article></div>
      {loading ? <p className="muted">Đang cập nhật tiến độ lịch thi đấu…</p> : null}{error ? <p className="form-error" role="alert">{error}</p> : null}
    </section> : null;
  const scheduleWorkspace = <section className="panel data-panel schedule-management-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">ĐIỀU PHỐI THI ĐẤU</p>
          <h2>{mode === "referees" ? "Phân công trọng tài" : "Xếp lịch và phân công sân"}</h2>
        </div>
      </div>
      {tournaments.length === 0 ? (
        <p className="muted">Bạn chưa được phân công quản lý giải đấu nào.</p>
      ) : (
        <>
          {mode === "referees" ? <div className="schedule-form-grid">
            <label className="draw-field"><span>Tìm trọng tài theo tên hoặc email</span><input value={candidateSearch} onChange={(event) => setCandidateSearch(event.target.value)} placeholder="Nhập tên hoặc email" /></label>
            <p className="muted">Chỉ tài khoản REFEREE đang hoạt động và đã xác minh mới xuất hiện. Mỗi trận có thể có tổ trọng tài khác nhau, với đúng một người xác nhận kết quả cuối.</p>
          </div> : null}
          <label className="draw-field">
            <span>Giải đấu</span>
            <select value={tournamentId} onChange={(event) => setTournamentId(event.target.value)}>
              {tournaments.map((tournament) => (
                <option key={tournament.id} value={tournament.id}>{tournament.name}</option>
              ))}
            </select>
          </label>
          {loading ? <p className="muted">Đang tải trận, sân và lịch hiện có…</p> : null}
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          {mode === "venues" ? <><div className="schedule-form-grid">
            <label className="draw-field">
              <span>Trận chưa xếp lịch *</span>
              <select value={matchId} onChange={(event) => { setMatchId(event.target.value); setConflictCheck(null); }}>
                <option value="">Chọn trận</option>
                {schedulableMatches.map((match) => (
                  <option key={match.id} value={match.id}>
                    {match.round ?? "Vòng bảng"} · {matchParticipantLabel(match.homeTeamId, "home", teamNames)} – {matchParticipantLabel(match.awayTeamId, "away", teamNames)}
                  </option>
                ))}
              </select>
            </label>
            <label className="draw-field">
              <span>Sân đang hoạt động *</span>
              <select value={venueId} onChange={(event) => { setVenueId(event.target.value); setConflictCheck(null); }}>
                <option value="">Chọn sân</option>
                {venues.map((venue) => (
                  <option key={venue.id} value={venue.id}>{venue.name} · {venue.location}</option>
                ))}
              </select>
            </label>
            <label className="draw-field">
              <span>Ngày và giờ *</span>
              <input type="datetime-local" value={scheduledDate} onChange={(event) => { setScheduledDate(event.target.value); setConflictCheck(null); }} />
            </label>
            <label className="draw-field">
              <span>Thời lượng (phút) *</span>
              <input type="number" min={1} max={240} value={durationMinutes} onChange={(event) => { setDurationMinutes(Number(event.target.value)); setConflictCheck(null); }} />
            </label>
          </div>
          <p className="muted">Lịch được kiểm tra xung đột sân, đội bóng, thời gian nghỉ và thời hạn giải. Bản nháp chưa hiển thị công khai; phân công trọng tài là phần tiếp theo trong bước Lập lịch.</p>
          <div className="draw-actions">
            <button type="button" className="button button-secondary" disabled={submitting || loading || !matchId || !venueId || !scheduledDate} onClick={() => void handleCheckConflicts()}>
              {submitting ? "Đang kiểm tra…" : "Kiểm tra xung đột"}
            </button>
            <button type="button" className="button button-primary" disabled={submitting || loading || !schedulableMatches.length || !venues.length} onClick={() => void handleCreate()}>
              {submitting ? "Đang lưu…" : "Lưu trận vào bản nháp"}
            </button>
          </div></> : null}
          {conflictCheck ? <div className={conflictCheck.hasConflict ? "form-error schedule-conflict-result" : "form-success schedule-conflict-result"} role="status">
            <strong>{conflictCheck.hasConflict ? "Có xung đột cần xử lý" : "Không phát hiện xung đột"}</strong>
            {conflictCheck.conflicts.map((item, index) => <span key={`${item.scheduleId}-${index}`}>{item.type === "venue" ? "Sân" : item.type === "team" ? "Đội" : "Trọng tài"}: {item.reason}</span>)}
          </div> : null}
          <div className="schedule-console">
            <div className="schedule-list-heading">
              <div><h3>{mode === "referees" ? "Điều phối trọng tài" : "Điều phối lịch thi đấu"}</h3><p>{filteredSchedules.length} / {schedules.length} trận · {unassignedCount} trận chưa có trọng tài</p></div>
              <div className="schedule-summary-pills"><span><strong>{schedules.filter((item) => item.status === "PUBLISHED").length}</strong> đã công bố</span><span><strong>{schedules.filter((item) => item.status === "DRAFT").length}</strong> bản nháp</span></div>
            </div>
            {mode === "venues" ? <div className="button-row schedule-bulk-actions">
              <button type="button" className="button button-primary" disabled={submitting || !schedules.some((schedule) => schedule.status === "DRAFT")} onClick={() => void handlePublishAllDrafts()}>{submitting ? "Đang công bố…" : `Công bố lịch nháp (${schedules.filter((schedule) => schedule.status === "DRAFT").length})`}</button>
              <button type="button" className="button button-secondary" disabled={submitting || !onOpenPublicView || !schedules.some((schedule) => schedule.status === "PUBLISHED")} onClick={() => void handleOpenPublicSchedule()}>Xem lịch công khai</button>
            </div> : null}
            <div className={`schedule-filter-bar ${mode === "referees" ? "schedule-filter-bar-referees" : ""}`}>
              <label className="draw-field schedule-search-field"><span>Tìm trận, đội, sân{mode === "referees" ? " hoặc trọng tài" : ""}</span><input value={scheduleSearch} onChange={(event) => { setScheduleSearch(event.target.value); setSchedulePage(1); }} placeholder="Nhập tên đội hoặc thông tin trận" /></label>
              <label className="draw-field"><span>Ngày thi đấu</span><input type="date" value={dayFilter} onChange={(event) => { setDayFilter(event.target.value); setSchedulePage(1); }} /></label>
              <label className="draw-field"><span>Vòng / bảng</span><select value={roundFilter} onChange={(event) => { setRoundFilter(event.target.value); setSchedulePage(1); }}><option value="">Tất cả</option>{roundOptions.map((round) => <option key={round} value={round}>{round}</option>)}</select></label>
              <label className="draw-field"><span>Trạng thái lịch</span><select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setSchedulePage(1); }}><option value="ALL">Tất cả</option><option value="PUBLISHED">Đã công bố</option><option value="DRAFT">Bản nháp</option><option value="CANCELLED">Đã hủy</option></select></label>
              {mode === "referees" ? <label className="draw-field"><span>Trọng tài</span><select value={assignmentFilter} onChange={(event) => { setAssignmentFilter(event.target.value); setSchedulePage(1); }}><option value="ALL">Tất cả trận</option><option value="UNASSIGNED">Chưa phân công</option><option value="ASSIGNED">Đã phân công</option></select></label> : null}
              <button type="button" className="button button-secondary schedule-filter-reset" onClick={() => { setScheduleSearch(""); setDayFilter(""); setRoundFilter(""); setStatusFilter("ALL"); setAssignmentFilter("ALL"); setSchedulePage(1); }}>Xóa lọc</button>
            </div>
            {!schedules.length ? <p className="muted">Chưa có lịch.</p> : !filteredSchedules.length ? <div className="schedule-empty-state"><strong>Không tìm thấy trận phù hợp</strong><span>Thử đổi bộ lọc hoặc xóa từ khóa tìm kiếm.</span></div> : <div className="schedule-workbench">
              <section className="schedule-workbench-pane schedule-match-list">
                <div className="schedule-pane-heading"><strong>Danh sách trận</strong><span>{filteredSchedules.length} trận</span></div>
                <div className="schedule-match-items">
                  {visibleSchedules.map((schedule) => {
                    const match = matchById.get(schedule.matchId);
                    const crewCount = (crewDrafts[schedule.id] ?? []).length;
                    return <button key={schedule.id} type="button" className={`schedule-match-item ${activeSchedule?.id === schedule.id ? "is-selected" : ""}`} onClick={() => setSelectedScheduleId(schedule.id)}>
                      <span className="schedule-match-item-top"><strong>{match?.round ?? "Trận đấu"}</strong><span className={`status-pill status-${schedule.status.toLowerCase()}`}>{schedule.status === "PUBLISHED" ? "Đã công bố" : schedule.status === "DRAFT" ? schedule.isLocked ? "Đã khóa · bản nháp" : "Bản nháp" : schedule.status}</span></span>
                      <span className="schedule-match-item-teams">{match ? matchParticipantLabel(match.homeTeamId, "home", teamNames) : "—"}<b>vs</b>{match ? matchParticipantLabel(match.awayTeamId, "away", teamNames) : "—"}</span>
                      <span className="schedule-match-item-meta">{new Date(schedule.scheduledDate).toLocaleString("vi-VN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {venueById.get(schedule.venueId)?.name ?? "Chưa chọn sân"}</span>
                      <span className={`schedule-match-item-officials ${crewCount ? "is-assigned" : ""}`}>{crewCount ? `⚑ ${crewCount} trọng tài` : "Chưa phân công trọng tài"}</span>
                    </button>;
                  })}
                </div>
                {schedulePageCount > 1 ? <div className="schedule-pagination"><span>Trang {schedulePage} / {schedulePageCount}</span><div className="button-row"><button type="button" className="button button-secondary" disabled={schedulePage <= 1} onClick={() => setSchedulePage((page) => page - 1)}>Trước</button><button type="button" className="button button-secondary" disabled={schedulePage >= schedulePageCount} onClick={() => setSchedulePage((page) => page + 1)}>Tiếp</button></div></div> : null}
              </section>
              {activeSchedule ? <section className="schedule-workbench-pane schedule-match-detail">
                {(() => {
                  const schedule = activeSchedule;
                  const match = matchById.get(schedule.matchId);
                  const home = match ? matchParticipantLabel(match.homeTeamId, "home", teamNames) : "—";
                  const away = match ? matchParticipantLabel(match.awayTeamId, "away", teamNames) : "—";
                  return <>
                    <div className="schedule-detail-header">
                      <div><p className="eyebrow">{mode === "referees" ? "TỔ TRỌNG TÀI" : "CHI TIẾT LỊCH"}</p><h3>{match?.round ?? "Thông tin trận đấu"}</h3></div>
                      <span className={`status-pill status-${schedule.status.toLowerCase()}`}>{schedule.status === "PUBLISHED" ? "Đã công bố" : schedule.status === "DRAFT" ? "Bản nháp" : schedule.status}</span>
                    </div>
                    <div className="schedule-scoreboard"><strong>{home}</strong><span>VS</span><strong>{away}</strong></div>
                    <div className="schedule-detail-meta"><span>◷ {new Date(schedule.scheduledDate).toLocaleString("vi-VN")}</span><span>⌖ {venueById.get(schedule.venueId)?.name ?? "Chưa chọn sân"}</span><span>◴ {schedule.durationMinutes} phút</span></div>
                    {mode === "referees" ? <div className="schedule-detail-section">
                      <div className="schedule-pane-heading"><strong>Tổ trọng tài</strong><span>{(crewDrafts[schedule.id] ?? []).length} vị trí</span></div>
                      {schedule.status === "PUBLISHED" && changesSavedCrew(schedule.id) ? <label className="draw-field"><span>Lý do thay đổi *</span><input maxLength={500} value={crewChangeReasons[schedule.id] ?? ""} onChange={(event) => setCrewChangeReasons((current) => ({ ...current, [schedule.id]: event.target.value }))} /></label> : null}
                      {(crewDrafts[schedule.id] ?? []).length ? <div className="schedule-official-list">{(crewDrafts[schedule.id] ?? []).map((official, index) => {
                        const options = refereeCandidates.some((candidate) => candidate.userId === official.refereeId)
                          ? refereeCandidates
                          : [...refereeCandidates, ...(official.refereeId ? [{ userId: official.refereeId, fullName: official.refereeId, email: "Đã phân công" }] : [])];
                        return <div className="schedule-official-row" key={`${schedule.id}-${index}`}>
                          <label className="draw-field"><span>Vị trí</span><select value={official.position} onChange={(event) => updateCrew(schedule.id, index, { position: event.target.value, ...(event.target.value !== "REFEREE" && official.isFinalAuthority ? { isFinalAuthority: false } : {}) })}>{[...new Set([...REFEREE_POSITIONS, official.position])].map((position) => <option key={position} value={position}>{position.replaceAll("_", " ")}</option>)}</select></label>
                          <label className="draw-field"><span>Trọng tài</span><select value={official.refereeId} onChange={(event) => updateCrew(schedule.id, index, { refereeId: event.target.value })}><option value="">Chọn trọng tài</option>{options.map((candidate) => <option key={candidate.userId} value={candidate.userId}>{candidate.fullName} · {candidate.email}</option>)}</select></label>
                          <label className="draw-field"><span>Xác nhận kết quả cuối</span><select value={official.isFinalAuthority ? "yes" : "no"} disabled={official.position !== "REFEREE"} onChange={(event) => updateCrew(schedule.id, index, { isFinalAuthority: event.target.value === "yes" })}><option value="no">Không</option><option value="yes">Có</option></select></label>
                          <button type="button" className="text-button danger-text-button" onClick={() => setCrewDrafts((current) => ({ ...current, [schedule.id]: (current[schedule.id] ?? []).filter((_, itemIndex) => itemIndex !== index) }))}>Gỡ</button>
                        </div>;
                      })}</div> : <div className="schedule-empty-inline">Chưa có trọng tài. Thêm vị trí để bắt đầu phân công.</div>}
                      <div className="button-row"><button type="button" className="button button-secondary" disabled={submitting || (crewDrafts[schedule.id] ?? []).length >= REFEREE_POSITIONS.length} onClick={() => addCrewOfficial(schedule.id)}>+ Thêm vị trí</button><button type="button" className="button button-primary" disabled={submitting || loading || (schedule.status === "PUBLISHED" && changesSavedCrew(schedule.id) && !(crewChangeReasons[schedule.id] ?? "").trim())} onClick={() => void saveCrew(schedule)}>Lưu phân công</button></div>
                      <button type="button" className="text-button" disabled={submitting} onClick={() => void toggleCrewHistory(schedule.id)}>{historyScheduleId === schedule.id ? "Ẩn lịch sử" : "Xem lịch sử phân công"}</button>
                      {historyScheduleId === schedule.id ? <div className="draw-history">{!crewHistory.length ? <p className="muted">Chưa có lần thay đổi tổ trọng tài.</p> : crewHistory.map((entry) => <article className="schedule-history-entry" key={entry.id}><strong>{new Date(entry.changedAt).toLocaleString("vi-VN")}</strong><span>Trước: {entry.beforeAssignments.length ? entry.beforeAssignments.map((item) => `${item.position} · ${item.refereeId.slice(0, 8)}`).join("; ") : "Chưa phân công"}</span><span>Sau: {entry.afterAssignments.length ? entry.afterAssignments.map((item) => `${item.position} · ${item.refereeId.slice(0, 8)}`).join("; ") : "Đã gỡ tổ trọng tài"}</span><small>{entry.reason ?? "Không ghi lý do"}</small></article>)}</div> : null}
                    </div> : <div className="schedule-detail-section">
                      <div className="schedule-pane-heading"><strong>Thông tin sân và thời gian</strong><span>{schedule.durationMinutes} phút</span></div>
                      {mode === "venues" && schedule.isLocked ? <p className="message-banner message-info">Lịch nháp đã khóa; mở khóa trước khi đổi ngày, giờ hoặc sân.</p> : null}
                      {schedule.status === "DRAFT" ? <div className="button-row"><button type="button" className="button button-primary" disabled={submitting} onClick={() => void handlePublish(schedule)}>Công bố lịch</button>{mode === "venues" ? <button type="button" className="button button-secondary" disabled={submitting} onClick={() => void toggleOfficialScheduleLock(schedule)}>{schedule.isLocked ? "Mở khóa" : "Khóa lịch"}</button> : null}</div> : <div className="button-row"><button type="button" className="button button-secondary" disabled={submitting || schedule.isLocked} onClick={() => setEditingScheduleId((current) => current === schedule.id ? "" : schedule.id)}>{editingScheduleId === schedule.id ? "Đóng chỉnh sửa" : "Đổi lịch"}</button><button type="button" className="text-button" disabled={submitting} onClick={() => void toggleScheduleHistory(schedule.id)}>{scheduleHistoryId === schedule.id ? "Ẩn lịch sử" : "Lịch sử thay đổi"}</button></div>}
                      {editingScheduleId === schedule.id && !schedule.isLocked ? <div className="schedule-form-grid schedule-reschedule-form">
                        <label className="draw-field"><span>Sân *</span><select value={scheduleDrafts[schedule.id]?.venueId ?? schedule.venueId} onChange={(event) => setScheduleDrafts((current) => ({ ...current, [schedule.id]: { ...current[schedule.id], venueId: event.target.value, scheduledDate: current[schedule.id]?.scheduledDate ?? toLocalDateTimeInput(schedule.scheduledDate), durationMinutes: current[schedule.id]?.durationMinutes ?? schedule.durationMinutes, reason: current[schedule.id]?.reason ?? "" } }))}>{venues.map((venue) => <option key={venue.id} value={venue.id}>{venue.name} · {venue.location}</option>)}</select></label>
                        <label className="draw-field"><span>Ngày và giờ *</span><input type="datetime-local" value={scheduleDrafts[schedule.id]?.scheduledDate ?? toLocalDateTimeInput(schedule.scheduledDate)} onChange={(event) => setScheduleDrafts((current) => ({ ...current, [schedule.id]: { ...current[schedule.id], venueId: current[schedule.id]?.venueId ?? schedule.venueId, scheduledDate: event.target.value, durationMinutes: current[schedule.id]?.durationMinutes ?? schedule.durationMinutes, reason: current[schedule.id]?.reason ?? "" } }))} /></label>
                        <label className="draw-field"><span>Thời lượng (phút)</span><input type="number" min={1} max={240} value={scheduleDrafts[schedule.id]?.durationMinutes ?? schedule.durationMinutes} onChange={(event) => setScheduleDrafts((current) => ({ ...current, [schedule.id]: { ...current[schedule.id], venueId: current[schedule.id]?.venueId ?? schedule.venueId, scheduledDate: current[schedule.id]?.scheduledDate ?? toLocalDateTimeInput(schedule.scheduledDate), durationMinutes: Number(event.target.value), reason: current[schedule.id]?.reason ?? "" } }))} /></label>
                        <label className="draw-field schedule-change-reason"><span>Lý do thay đổi *</span><textarea maxLength={500} rows={2} value={scheduleDrafts[schedule.id]?.reason ?? ""} onChange={(event) => setScheduleDrafts((current) => ({ ...current, [schedule.id]: { ...current[schedule.id], venueId: current[schedule.id]?.venueId ?? schedule.venueId, scheduledDate: current[schedule.id]?.scheduledDate ?? toLocalDateTimeInput(schedule.scheduledDate), durationMinutes: current[schedule.id]?.durationMinutes ?? schedule.durationMinutes, reason: event.target.value } }))} placeholder="Ví dụ: sân bảo trì, thời tiết xấu…" /></label>
                      <div className="button-row"><button type="button" className="button button-primary" disabled={submitting} onClick={() => void saveScheduleChange(schedule)}>Lưu lịch mới</button><button type="button" className="text-button danger-text-button" disabled={submitting || !(scheduleDrafts[schedule.id]?.reason.trim().length >= 10)} onClick={async () => { if (await confirm({ title: "Hủy lịch trận này?", description: "Lịch sẽ bị hủy, lý do được lưu và các bên liên quan sẽ được thông báo.", confirmLabel: "Hủy lịch", danger: true })) await saveScheduleChange(schedule, "CANCELLED"); }}>Hủy lịch</button></div>
                      </div> : null}
                      {scheduleHistoryId === schedule.id ? <div className="draw-history">{scheduleHistory.length ? scheduleHistory.map((entry) => <article className="schedule-history-entry" key={entry.id}><strong>{new Date(entry.changedAt).toLocaleString("vi-VN")}</strong><span>{new Date(entry.before.scheduledDate).toLocaleString("vi-VN")} → {new Date(entry.after.scheduledDate).toLocaleString("vi-VN")}</span><small>Đổi bởi {entry.changedBy} · {entry.reason ?? "Không ghi lý do"}</small></article>) : <p className="muted">Chưa có lần thay đổi lịch.</p>}</div> : null}
                    </div>}
                  </>;
                })()}
              </section> : null}
            </div>}
          </div>
        </>
      )}
    </section>;
  return <>{scheduleSummary}{mode === "venues" ? scheduleWorkspace : <Modal open={!scheduleWorkspaceOpen} title="Phân công trọng tài" description="Bố trí trọng tài cho lịch thi đấu đã công bố." onClose={() => setScheduleWorkspaceOpen(true)} className="schedule-workspace-modal">{scheduleWorkspace}</Modal>}</>;
}
