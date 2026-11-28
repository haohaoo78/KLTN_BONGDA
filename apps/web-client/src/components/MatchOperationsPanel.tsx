import { BtcPreparationQueue } from "./BtcPreparationPanel";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useDialog } from "./DialogProvider";
import { NOTIFICATION_REALTIME_EVENT } from "../api/client";
import { useMatchFeedInvalidation } from "../hooks/useMatchFeedInvalidation";
import {
  getMatchById,
  getManagedMatchReport,
  getManagedMatchResult,
  getMatches,
  getMatchEvents,
  getMatchLineups,
  getMatchClock,
  applyMatchClockAction,
  createMatchEvent,
  voidMatchEvent,
  recordMatchResult,
  createResultCorrectionRequest,
  getResultCorrectionRequests,
  reviewResultCorrectionRequest,
  reviewMatchReport,
  submitMatchReport,
  updateRefereeMatchStatus,
  decideMatchForfeit,
  getForfeitDecisions,
  getComplaintAppeals,
  reviewComplaintAppeal,
  getTournamentComplaints,
  reviewTournamentComplaint,
  type Match,
  type MatchEvent,
  type MatchClock,
  type MatchClockAction,
  type MatchLineup,
  type MatchReport,
  type MatchResult,
  type MatchResultCorrectionRequest,
  type RefereeSchedule,
  type ComplaintAppeal,
  type TournamentComplaint,
} from "../api/competition";

type TournamentRef = { id: string; name: string };
type Props = {
  mode: "referee" | "btc";
  schedules?: RefereeSchedule[];
  tournaments?: TournamentRef[];
  teamNames: Map<string, string>;
  onNotice: (message: string) => void;
};

type MatchWork = { match: Match; result: MatchResult | null; report: MatchReport | null; tournamentName: string };
type CorrectionWork = { request: MatchResultCorrectionRequest; match: Match | null; tournamentName: string };
type ForfeitWork = { match: Match; tournamentName: string };
type ForfeitHistoryWork = { decision: { id: string; matchId: string; forfeitingTeamId: string; winnerTeamId: string; reason: string; policy: string; homeScore: number; awayScore: number; decidedBy: string; createdAt: string }; tournamentName: string };
type AppealWork = { appeal: ComplaintAppeal; tournamentName: string };
type ComplaintWork = { complaint: TournamentComplaint; tournamentName: string };

function missing(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "status" in error && (error as { status?: number }).status === 404);
}

function matchSideLabel(teamId: string | null, side: "home" | "away", names: Map<string, string>): string {
  return teamId ? names.get(teamId) ?? teamId.slice(0, 8) : side === "home" ? "Đang chờ đội vào nhánh" : "Đang chờ đối thủ ở nhánh";
}

export function MatchOperationsPanel({ mode, schedules = [], tournaments = [], teamNames, onNotice }: Props) {
  const { confirm, prompt } = useDialog();
  const [items, setItems] = useState<MatchWork[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [homeScore, setHomeScore] = useState("0");
  const [awayScore, setAwayScore] = useState("0");
  const [homeExtraTime, setHomeExtraTime] = useState("");
  const [awayExtraTime, setAwayExtraTime] = useState("");
  const [homePenalties, setHomePenalties] = useState("");
  const [awayPenalties, setAwayPenalties] = useState("");
  const [halfHome, setHalfHome] = useState("0");
  const [halfAway, setHalfAway] = useState("0");
  const [attendance, setAttendance] = useState("");
  const [weather, setWeather] = useState("");
  const [notes, setNotes] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [requiresOrganizerReview, setRequiresOrganizerReview] = useState(false);
  const [matchEvents, setMatchEvents] = useState<MatchEvent[]>([]);
  const [matchLineups, setMatchLineups] = useState<MatchLineup[]>([]);
  const [matchClock, setMatchClock] = useState<MatchClock | null>(null);
  const [clockNow, setClockNow] = useState(Date.now());
  const [eventType, setEventType] = useState<MatchEvent["eventType"]>("GOAL");
  const [eventTeamId, setEventTeamId] = useState("");
  const [eventPlayerId, setEventPlayerId] = useState("");
  const [eventMinute, setEventMinute] = useState("");
  const [eventDescription, setEventDescription] = useState("");
  const [correctionRequests, setCorrectionRequests] = useState<CorrectionWork[]>([]);
  const [correctionDrafts, setCorrectionDrafts] = useState<Record<string, { homeScore: string; awayScore: string; reason: string }>>({});
  const [correctionSubmitting, setCorrectionSubmitting] = useState(false);
  const [correctionReviewNotes, setCorrectionReviewNotes] = useState<Record<string, string>>({});
  const [forfeitCandidates, setForfeitCandidates] = useState<ForfeitWork[]>([]);
  const [forfeitHistory, setForfeitHistory] = useState<ForfeitHistoryWork[]>([]);
  const [forfeitDrafts, setForfeitDrafts] = useState<Record<string, { forfeitingTeamId: string; reason: string }>>({});
  const [forfeitSubmitting, setForfeitSubmitting] = useState(false);
  const [appeals, setAppeals] = useState<AppealWork[]>([]);
  const [appealReasons, setAppealReasons] = useState<Record<string, string>>({});
  const [appealBusy, setAppealBusy] = useState(false);
  const [complaints, setComplaints] = useState<ComplaintWork[]>([]);
  const [complaintDrafts, setComplaintDrafts] = useState<Record<string, { decision: string; reason: string }>>({});
  const [realtimeRevision, setRealtimeRevision] = useState(0);
  const refreshRealtime = useCallback(() => setRealtimeRevision((revision) => revision + 1), []);
  useMatchFeedInvalidation(refreshRealtime);

  const selected = items.find((item) => item.match.id === selectedId) ?? null;
  const selectedRefereeAssignment = schedules.find((schedule) => schedule.matchId === selectedId)?.myAssignment;
  const refereeCanFinalize = selectedRefereeAssignment?.isFinalAuthority === true;
  const optionalResultScoresValid = [homeExtraTime, awayExtraTime, homePenalties, awayPenalties]
    .every((score) => !score || (Number.isInteger(Number(score)) && Number(score) >= 0));
  const workIds = useMemo(() => mode === "referee"
    ? schedules.map((schedule) => ({ id: schedule.matchId, tournamentName: "Lịch được phân công" }))
    : tournaments.map((tournament) => ({ id: tournament.id, tournamentName: tournament.name })),
  [mode, schedules, tournaments]);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      let matchesWithTournament: Array<{ match: Match; tournamentName: string }>;
      if (mode === "referee") {
        matchesWithTournament = (await Promise.all(schedules.map(async (schedule) => {
          try { return { match: (await getMatchById(schedule.matchId)).match, tournamentName: "Lịch được phân công" }; }
          catch (err) { if (missing(err)) return null; throw err; }
        }))).filter((item): item is { match: Match; tournamentName: string } => item !== null);
      } else {
        matchesWithTournament = (await Promise.all(tournaments.map(async (tournament) => {
          const result = await getMatches(tournament.id);
          return result.items.map((match) => ({ match, tournamentName: tournament.name }));
        }))).flat();
      }
      const work = await Promise.all(matchesWithTournament.map(async ({ match, tournamentName }) => {
        const [result, report] = await Promise.all([
          getManagedMatchResult(match.id).then((value) => value.result).catch((err: unknown) => missing(err) ? null : Promise.reject(err)),
          getManagedMatchReport(match.id).then((value) => value.report).catch((err: unknown) => missing(err) ? null : Promise.reject(err)),
        ]);
        return { match, result, report, tournamentName };
      }));
      if (mode === "btc") {
        setForfeitCandidates(matchesWithTournament
          .filter(({ match }) => Boolean(match.homeTeamId && match.awayTeamId) && (match.status === "SCHEDULED" || match.status === "LINEUP_CONFIRMED"))
          .map(({ match, tournamentName }) => ({ match, tournamentName })));
        const correctionResults = await Promise.all(tournaments.map(async (tournament) => {
          const { requests } = await getResultCorrectionRequests(tournament.id, "PENDING");
          return requests.map((request) => ({
            request,
            match: matchesWithTournament.find((item) => item.match.id === request.matchId)?.match ?? null,
            tournamentName: tournament.name,
          }));
        }));
        setCorrectionRequests(correctionResults.flat());
        const forfeitResults = await Promise.all(tournaments.map(async (tournament) => {
          const { decisions } = await getForfeitDecisions(tournament.id);
          return decisions.map((decision) => ({ decision, tournamentName: tournament.name }));
        }));
        setForfeitHistory(forfeitResults.flat());
        const appealResults = await Promise.all(tournaments.map(async (tournament) => {
          const { appeals: tournamentAppeals } = await getComplaintAppeals(tournament.id, "PENDING");
          return tournamentAppeals.map((appeal) => ({ appeal, tournamentName: tournament.name }));
        }));
        setAppeals(appealResults.flat());
        const complaintResults = await Promise.all(tournaments.map(async (tournament) => {
          const { complaints: tournamentComplaints } = await getTournamentComplaints(tournament.id);
          return tournamentComplaints
            .filter((complaint) => complaint.status === "PENDING" || complaint.status === "UNDER_REVIEW")
            .map((complaint) => ({ complaint, tournamentName: tournament.name }));
        }));
        setComplaints(complaintResults.flat());
      } else {
        setForfeitCandidates([]);
        setForfeitHistory([]);
        setCorrectionRequests([]);
        setAppeals([]);
        setComplaints([]);
      }
      const visible = mode === "btc"
        ? work.filter((item) => item.report?.status === "PENDING" && item.report.requiresOrganizerReview !== false)
        : work.sort((a, b) => (a.match.matchDate ?? "").localeCompare(b.match.matchDate ?? ""));
      setItems(visible);
      setSelectedId((current) => visible.some((item) => item.match.id === current) ? current : visible[0]?.match.id ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được công việc trận đấu.");
    } finally { setLoading(false); }
  }

  useEffect(() => { void refresh(); // refresh when the assigned work changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, schedules.map((item) => item.matchId).join(","), tournaments.map((item) => item.id).join(","), realtimeRevision]);

  useEffect(() => {
    window.addEventListener(NOTIFICATION_REALTIME_EVENT, refreshRealtime);
    return () => window.removeEventListener(NOTIFICATION_REALTIME_EVENT, refreshRealtime);
  }, [refreshRealtime]);

  useEffect(() => {
    if (!selected) return;
    setHomeScore(String(selected.result?.homeScore ?? 0));
    setAwayScore(String(selected.result?.awayScore ?? 0));
    setHomeExtraTime(selected.result?.homeExtraTimeScore == null ? "" : String(selected.result.homeExtraTimeScore));
    setAwayExtraTime(selected.result?.awayExtraTimeScore == null ? "" : String(selected.result.awayExtraTimeScore));
    setHomePenalties(selected.result?.homePenaltyScore == null ? "" : String(selected.result.homePenaltyScore));
    setAwayPenalties(selected.result?.awayPenaltyScore == null ? "" : String(selected.result.awayPenaltyScore));
    setNotes(selected.result?.notes ?? "");
    setHalfHome("0"); setHalfAway("0"); setAttendance(""); setWeather(""); setReviewNote(""); setRequiresOrganizerReview(false);
  }, [selectedId]);

  useEffect(() => {
    let current = true;
    setMatchEvents([]); setMatchLineups([]); setMatchClock(null); setEventPlayerId(""); setEventTeamId(selected?.match.homeTeamId ?? "");
    if (mode !== "referee" || !selected) return () => { current = false; };
    Promise.all([getMatchEvents(selected.match.id), getMatchLineups(selected.match.id), getMatchClock(selected.match.id)])
      .then(([eventsResult, lineupsResult, clockResult]) => { if (current) { setMatchEvents(eventsResult.events); setMatchLineups(lineupsResult.lineups); setMatchClock(clockResult.clock); } })
      .catch((err: unknown) => { if (current) setError(err instanceof Error ? err.message : "Không tải được diễn biến hoặc đội hình trận."); });
    return () => { current = false; };
  }, [mode, selectedId]);

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  async function refereeAction() {
    if (!selected) return;
    setBusy(true); setError(null);
    try {
      await updateRefereeMatchStatus(selected.match.id, "LINEUP_CONFIRMED");
      onNotice("Đã xác nhận sẵn sàng đội hình.");
      await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Không cập nhật được trạng thái trận."); }
    finally { setBusy(false); }
  }

  async function clockAction(action: MatchClockAction) {
    if (!selected || !matchClock || busy) return;
    if (action === "END_PERIOD" && !await confirm({ title: "Kết thúc giai đoạn đang chạy?", description: "Đồng hồ sẽ dừng và lưu thời gian đã trôi qua. Bạn có thể bắt đầu hiệp kế tiếp theo điều lệ.", confirmLabel: "Kết thúc giai đoạn" })) return;
    if (action === "END_MATCH" && !await confirm({ title: "Kết thúc trận đấu?", description: "Thao tác này khóa đồng hồ trận và chuyển trận sang bước ghi tỷ số, lập biên bản.", confirmLabel: "Kết thúc trận" })) return;
    setBusy(true); setError(null);
    try {
      const result = await applyMatchClockAction(selected.match.id, action, matchClock.version);
      setMatchClock(result.clock);
      if (action === "END_MATCH" || action === "END_PERIOD" && result.clock.phase === "ENDED") {
        onNotice("Đã kết thúc trận và lưu đồng hồ.");
        await refresh();
      } else if (action === "START_MATCH") {
        onNotice("Đã bắt đầu hiệp một.");
        await refresh();
      } else {
        const messages: Partial<Record<MatchClockAction, string>> = {
          START_MATCH: "Đã bắt đầu hiệp một.",
          PAUSE: "Đã tạm dừng và lưu đồng hồ trận.",
          RESUME: "Đã tiếp tục đồng hồ trận.",
          END_PERIOD: "Đã kết thúc giai đoạn và lưu thời gian.",
          START_NEXT_PERIOD: "Đã bắt đầu hiệp tiếp theo.",
          START_EXTRA_TIME: "Đã bắt đầu hiệp phụ.",
          START_PENALTIES: "Đã bắt đầu loạt luân lưu.",
        };
        onNotice(messages[action] ?? "Đã cập nhật trạng thái đồng hồ.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không cập nhật được đồng hồ trận.");
      try { setMatchClock((await getMatchClock(selected.match.id)).clock); } catch { /* keep the last known state */ }
    } finally { setBusy(false); }
  }

  const clockElapsed = matchClock
    ? matchClock.elapsedSeconds + (matchClock.isRunning && matchClock.startedAt ? Math.max(0, Math.floor((clockNow - new Date(matchClock.startedAt).getTime()) / 1000)) : 0)
    : 0;
  const displayedClockSeconds = matchClock?.phase === "ENDED" ? matchClock.totalElapsedSeconds : clockElapsed;
  const clockLabel = `${String(Math.floor(displayedClockSeconds / 60)).padStart(2, "0")}:${String(displayedClockSeconds % 60).padStart(2, "0")}`;
  const clockPhaseLabels: Record<string, string> = {
    NOT_STARTED: "Chưa bắt đầu", FIRST_HALF: "Hiệp một", HALF_TIME: "Nghỉ giữa hiệp",
    SECOND_HALF: "Hiệp hai", REGULATION_COMPLETE: "Hết thời gian chính thức",
    EXTRA_TIME_FIRST_HALF: "Hiệp phụ một", EXTRA_TIME_HALF_TIME: "Nghỉ giữa hai hiệp phụ",
    EXTRA_TIME_SECOND_HALF: "Hiệp phụ hai", EXTRA_TIME_COMPLETE: "Hết hiệp phụ",
    PENALTIES: "Luân lưu", ENDED: "Đã kết thúc",
  };

  async function submitResultAndReport() {
    if (!selected) return;
    const pairedInputs = [[homeExtraTime, awayExtraTime], [homePenalties, awayPenalties]];
    if (pairedInputs.some(([home, away]) => Boolean(home) !== Boolean(away))) {
      setError("Hãy nhập đủ tỷ số hai đội cho từng hiệp phụ hoặc loạt luân lưu.");
      return;
    }
    setBusy(true); setError(null);
    try {
      await recordMatchResult({
        matchId: selected.match.id, homeScore: Number(homeScore), awayScore: Number(awayScore),
        homeExtraTimeScore: homeExtraTime ? Number(homeExtraTime) : undefined,
        awayExtraTimeScore: awayExtraTime ? Number(awayExtraTime) : undefined,
        homePenaltyScore: homePenalties ? Number(homePenalties) : undefined,
        awayPenaltyScore: awayPenalties ? Number(awayPenalties) : undefined,
        notes: notes.trim() || undefined,
      });
      const report = await submitMatchReport({
        matchId: selected.match.id,
        homeScoreAtHalfTime: Number(halfHome), awayScoreAtHalfTime: Number(halfAway),
        attendance: attendance ? Number(attendance) : undefined,
        weather: weather.trim() || undefined, notes: notes.trim() || undefined,
        requiresOrganizerReview,
      });
      onNotice(report.report.status === "APPROVED"
        ? "Trọng tài có thẩm quyền đã xác nhận kết quả chính thức; bảng xếp hạng đã cập nhật."
        : "Đã gửi biên bản ngoại lệ cho BTC xem xét; kết quả chưa được tính chính thức.");
      await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Không gửi được kết quả và biên bản."); }
    finally { setBusy(false); }
  }

  async function review(status: "APPROVED" | "REJECTED" | "REVISION_REQUIRED") {
    if (!selected?.report) return;
    if (status === "APPROVED" && !await confirm({ title: "Duyệt kết quả trận đấu?", description: "Biên bản được duyệt sẽ trở thành kết quả chính thức và cập nhật bảng xếp hạng, nhánh đấu.", confirmLabel: "Duyệt kết quả" })) return;
    setBusy(true); setError(null);
    try {
      await reviewMatchReport(selected.report.id, status, reviewNote.trim() || undefined);
      onNotice(status === "APPROVED" ? "Đã duyệt kết quả chính thức và cập nhật bảng xếp hạng." : status === "REJECTED" ? "Đã từ chối biên bản và lưu lý do." : "Đã yêu cầu trọng tài chỉnh sửa, bổ sung biên bản.");
      await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Không cập nhật được biên bản."); }
    finally { setBusy(false); }
  }

  async function addEvent() {
    if (!selected || !eventMinute || !Number.isInteger(Number(eventMinute)) || Number(eventMinute) < 0 || Number(eventMinute) > 2147483647 || busy) return;
    setBusy(true); setError(null);
    try {
      await createMatchEvent({ matchId: selected.match.id, teamId: eventTeamId, playerId: eventPlayerId || undefined, eventType, minute: Number(eventMinute), description: eventDescription.trim() || undefined });
      setMatchEvents((await getMatchEvents(selected.match.id)).events); setEventPlayerId(""); setEventMinute(""); setEventDescription("");
      onNotice("Đã ghi nhận diễn biến trận đấu.");
    } catch (err) { setError(err instanceof Error ? err.message : "Không ghi được sự kiện trận đấu."); }
    finally { setBusy(false); }
  }

  async function correctEvent(event: MatchEvent) {
    const reason = await prompt({ title: "Đính chính diễn biến trận", description: "Lý do được lưu cùng lịch sử thay đổi.", label: "Lý do đính chính", placeholder: "Nhập lý do (ít nhất 5 ký tự)…", required: true, confirmLabel: "Lưu lý do" });
    if (!reason?.trim() || reason.trim().length < 5 || busy) return;
    setBusy(true); setError(null);
    try { await voidMatchEvent(event.id, reason.trim()); setMatchEvents((await getMatchEvents(event.matchId)).events); onNotice("Đã đính chính sự kiện và lưu lịch sử."); }
    catch (err) { setError(err instanceof Error ? err.message : "Không đính chính được sự kiện."); }
    finally { setBusy(false); }
  }

  async function submitCorrectionRequest() {
    if (!selected || !selected.result) return;
    const draft = correctionDrafts[selected.match.id] ?? { homeScore: String(selected.result.homeScore), awayScore: String(selected.result.awayScore), reason: "" };
    if (draft.reason.trim().length < 10) { setError("Giải thích lý do đính chính (ít nhất 10 ký tự)."); return; }
    setCorrectionSubmitting(true); setError(null);
    try {
      await createResultCorrectionRequest(selected.match.id, {
        homeScore: Number(draft.homeScore), awayScore: Number(draft.awayScore), notes: selected.result.notes ?? undefined, reason: draft.reason.trim(),
      });
      setCorrectionDrafts((current) => ({ ...current, [selected.match.id]: { ...draft, reason: "" } }));
      onNotice("Đã gửi yêu cầu sửa kết quả cho BTC xét duyệt.");
    } catch (err) { setError(err instanceof Error ? err.message : "Không gửi được yêu cầu sửa kết quả."); }
    finally { setCorrectionSubmitting(false); }
  }

  async function decideCorrection(item: CorrectionWork, decision: "APPROVED" | "REJECTED") {
    const reviewReason = correctionReviewNotes[item.request.id]?.trim() ?? "";
    if (decision === "REJECTED" && reviewReason.length < 5) { setError("Nhập lý do từ chối ít nhất 5 ký tự."); return; }
    if (decision === "APPROVED" && !await confirm({ title: "Duyệt yêu cầu đính chính?", description: "Kết quả chính thức và bảng xếp hạng sẽ được cập nhật. Nếu đội thắng playoff thay đổi, trận kế tiếp chỉ được cập nhật khi chưa lên lịch hoặc bắt đầu; lịch sử và Match ID được giữ nguyên.", confirmLabel: "Duyệt đính chính" })) return;
    setCorrectionSubmitting(true); setError(null);
    try {
      await reviewResultCorrectionRequest(item.request.id, decision, reviewReason);
      setCorrectionRequests((current) => current.filter((entry) => entry.request.id !== item.request.id));
      await refresh();
      onNotice(decision === "APPROVED" ? "Đã duyệt đính chính; kết quả, bảng xếp hạng và trận playoff chưa lên lịch đã được đồng bộ." : "Đã từ chối yêu cầu và lưu lý do.");
    } catch (err) { setError(err instanceof Error ? err.message : "Không xử lý được yêu cầu sửa kết quả."); }
    finally { setCorrectionSubmitting(false); }
  }

  async function submitForfeit(item: ForfeitWork) {
    const draft = forfeitDrafts[item.match.id];
    if (!draft || draft.reason.trim().length < 10) { setError("Ghi rõ lý do xử thua (ít nhất 10 ký tự)."); return; }
    const forfeitingName = teamNames.get(draft.forfeitingTeamId) ?? "đội được chọn";
    if (!await confirm({ title: `Xử thua ${forfeitingName}?`, description: "Tỷ số theo điều lệ sẽ được ghi chính thức và cập nhật bảng xếp hạng hoặc nhánh đấu.", confirmLabel: "Xác nhận xử thua", danger: true })) return;
    setForfeitSubmitting(true); setError(null);
    try {
      const { result } = await decideMatchForfeit(item.match.id, { forfeitingTeamId: draft.forfeitingTeamId, reason: draft.reason.trim() });
      onNotice(`Đã ghi nhận xử thua; kết quả chính thức ${result.homeScore} – ${result.awayScore} đã cập nhật.`);
      setForfeitDrafts((current) => { const next = { ...current }; delete next[item.match.id]; return next; });
      await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Không ghi nhận được quyết định xử thua."); }
    finally { setForfeitSubmitting(false); }
  }

  async function decideAppeal(item: AppealWork, status: "APPROVED" | "REJECTED") {
    const reason = appealReasons[item.appeal.id]?.trim() ?? "";
    if (reason.length < 5) { setError("Ghi lý do quyết định kháng nghị (ít nhất 5 ký tự)."); return; }
    if (status === "APPROVED" && !await confirm({ title: "Chấp thuận kháng nghị?", description: "Hồ sơ khiếu nại sẽ được mở lại để BTC xem xét. Thao tác này không tự sửa tỷ số hoặc nhánh đấu.", confirmLabel: "Chấp thuận" })) return;
    setAppealBusy(true); setError(null);
    try {
      await reviewComplaintAppeal(item.appeal.id, status, reason);
      setAppeals((current) => current.filter((entry) => entry.appeal.id !== item.appeal.id));
      onNotice(status === "APPROVED" ? "Đã chấp thuận kháng nghị. Hãy mở hồ sơ khiếu nại và lập quyết định xử lý tiếp theo." : "Đã bác kháng nghị và lưu lý do.");
    } catch (err) { setError(err instanceof Error ? err.message : "Không xử lý được kháng nghị."); }
    finally { setAppealBusy(false); }
  }

  async function decideComplaint(item: ComplaintWork, status: "APPROVED" | "REJECTED" | "CLOSED") {
    const draft = complaintDrafts[item.complaint.id] ?? { decision: "", reason: "" };
    if (status === "REJECTED" && draft.reason.trim().length < 5) { setError("Nhập lý do bác khiếu nại (ít nhất 5 ký tự)."); return; }
    if (status === "APPROVED" && draft.decision.trim().length < 5) { setError("Mô tả biện pháp xử lý (ít nhất 5 ký tự)."); return; }
    setAppealBusy(true); setError(null);
    try {
      await reviewTournamentComplaint(item.complaint.id, { status, decision: draft.decision.trim() || undefined, decisionReason: draft.reason.trim() || undefined });
      setComplaints((current) => current.filter((entry) => entry.complaint.id !== item.complaint.id));
      onNotice(status === "APPROVED" ? "Đã ghi nhận kết luận khiếu nại. Kiểm tra riêng luồng sửa kết quả nếu quyết định ảnh hưởng tỷ số." : status === "REJECTED" ? "Đã bác khiếu nại và lưu lý do." : "Đã đóng hồ sơ khiếu nại.");
    } catch (err) { setError(err instanceof Error ? err.message : "Không cập nhật được khiếu nại."); }
    finally { setAppealBusy(false); }
  }

  return <section className="panel data-panel match-operations-panel">
    <div className="panel-heading panel-heading-wrap"><div><span className="eyebrow">{"THEO DÕI KẾT QUẢ"}</span><h2>{"Kết quả và biên bản cần xử lý"}</h2><p>{"Theo dõi kết quả chính thức và xử lý các biên bản ngoại lệ được chuyển đến BTC."}</p></div><button className="text-button" type="button" onClick={() => void refresh()}>Tải lại</button></div>
    {error ? <div className="message-banner message-error" role="alert">{error}</div> : null}
    {mode==="btc"?<BtcPreparationQueue matches={forfeitCandidates} teamNames={teamNames}/>:null}
    {loading ? <p className="loading-state">Đang tải…</p> : !items.length ? <div className="empty-state"><h3>{"Chưa có biên bản chờ duyệt"}</h3><p>{"Biên bản sẽ xuất hiện ở đây sau khi trọng tài kết thúc trận và gửi kết quả."}</p></div> : <>
          <div className="form-grid">
        <label className="field field-wide">{"Biên bản cần xem"}<select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{items.map(({ match, report, tournamentName }) => <option key={match.id} value={match.id}>{tournamentName} · {matchSideLabel(match.homeTeamId, "home", teamNames)} – {matchSideLabel(match.awayTeamId, "away", teamNames)}{report ? ` · ${new Date(report.submittedAt).toLocaleString("vi-VN")}` : ""}</option>)}</select></label>
      </div>
      {selected ? <div className="match-operation-detail">
        <p><strong>{matchSideLabel(selected.match.homeTeamId, "home", teamNames)} – {matchSideLabel(selected.match.awayTeamId, "away", teamNames)}</strong> · {selected.match.round ?? "Trận đấu"} · Trạng thái: {selected.match.status}</p>
        {selected.report ? <>
          <dl className="match-report-summary"><div><dt>Trạng thái</dt><dd>{selected.report.status}</dd></div><div><dt>Giờ gửi</dt><dd>{new Date(selected.report.submittedAt).toLocaleString("vi-VN")}</dd></div><div><dt>Tỷ số cuối</dt><dd>{selected.result ? `${selected.result.homeScore} – ${selected.result.awayScore}` : "Chưa có kết quả"}</dd></div><div><dt>Hiệp một</dt><dd>{selected.report.homeScoreAtHalfTime ?? "—"} – {selected.report.awayScoreAtHalfTime ?? "—"}</dd></div><div><dt>Khán giả / thời tiết</dt><dd>{selected.report.attendance ?? "—"} · {selected.report.weather ?? "—"}</dd></div><div><dt>Ghi chú trọng tài</dt><dd>{selected.report.notes || "Không có"}</dd></div></dl>
          {selected.report.submissionSnapshots?.length ? <section className="match-report-snapshot"><h4>Đội hình và diễn biến tại thời điểm nộp</h4><p className="form-help">Mỗi lần nộp được lưu riêng để BTC đối chiếu cả bản gửi lại.</p>{selected.report.submissionSnapshots.map((snapshot, index) => <details key={`${snapshot.submittedAt}-${index}`} open={index === selected.report!.submissionSnapshots.length - 1}><summary>Lần gửi {index + 1} · {new Date(snapshot.submittedAt).toLocaleString("vi-VN")}</summary><p><strong>Tỷ số trong bản gửi:</strong> {snapshot.result ? `${snapshot.result.homeScore}–${snapshot.result.awayScore}` : "Chưa ghi nhận"} · <strong>Thời lượng đồng hồ:</strong> {Math.floor((snapshot.clock?.totalElapsedSeconds ?? 0) / 60)} phút</p><div className="match-report-snapshot-grid">{[selected.match.homeTeamId, selected.match.awayTeamId].filter((teamId): teamId is string => Boolean(teamId)).map((teamId) => <div key={teamId}><h5>{matchSideLabel(teamId, teamId === selected.match.homeTeamId ? "home" : "away", teamNames)}</h5><ul>{snapshot.lineups.filter((row) => row.teamId === teamId).map((row) => <li key={row.playerId}><strong>{row.jerseyNumber ? `#${row.jerseyNumber} · ` : ""}{row.playerId.slice(0, 8)}</strong> · {row.isStarting ? "Đá chính" : "Dự bị"}{row.position ? ` · ${row.position}` : ""}{row.confirmedAt ? " · Đã xác nhận" : " · Chưa xác nhận"}</li>)}</ul></div>)}</div><h5>Diễn biến được gửi</h5>{snapshot.events.length ? <ul>{snapshot.events.map((event, eventIndex) => <li key={`${event.createdAt}-${eventIndex}`}><strong>{event.minute ?? "—"}′ · {event.eventType.replaceAll("_", " ")}</strong> · {matchSideLabel(event.teamId, event.teamId === selected.match.homeTeamId ? "home" : "away", teamNames)}{event.playerId ? ` · ${event.playerId.slice(0, 8)}` : ""}{event.description ? ` · ${event.description}` : ""}</li>)}</ul> : <p className="form-help">Không có sự kiện trận trong bản gửi này.</p>}</details>)}</section> : <p className="form-help">Biên bản cũ chưa có snapshot đội hình và sự kiện tại thời điểm nộp.</p>}
          <label className="field">Ghi chú xét duyệt<input maxLength={2000} value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="Bắt buộc khi từ chối hoặc yêu cầu bổ sung" /></label>
          <div className="button-row"><button className="primary-button" disabled={busy || selected.match.status !== "FINISHED" || selected.result?.status !== "PENDING"} type="button" onClick={() => void review("APPROVED")}>{busy ? "Đang xử lý…" : "Duyệt kết quả chính thức"}</button><button className="button button-secondary" disabled={busy || !reviewNote.trim()} type="button" onClick={() => void review("REVISION_REQUIRED")}>Yêu cầu chỉnh sửa</button><button className="text-button danger-text-button" disabled={busy || !reviewNote.trim()} type="button" onClick={() => void review("REJECTED")}>Từ chối biên bản</button></div>
          {selected.match.status !== "FINISHED" || !selected.result || selected.result.status !== "PENDING" ? <p className="form-help">Chỉ duyệt khi trận đã kết thúc và có tỷ số đang chờ xét duyệt.</p> : null}
        </> : null}
      </div> : null}
    </>}
    {mode === "btc" ? <>
        <section className="result-correction-queue"><div className="panel-heading"><div><span className="eyebrow">XỬ LÝ NGOẠI LỆ</span><h3>Đội bỏ cuộc / không có mặt</h3><p>Chỉ dùng trước khi trận bắt đầu. Tỷ số được lấy từ điều lệ giải; thao tác sẽ ghi audit, cập nhật bảng xếp hạng và nhánh đấu.</p></div><span className="status-pill">{forfeitCandidates.length} trận có thể xử lý</span></div>{forfeitCandidates.length ? forfeitCandidates.map((item) => { const homeTeamId = item.match.homeTeamId!; const awayTeamId = item.match.awayTeamId!; const draft = forfeitDrafts[item.match.id] ?? { forfeitingTeamId: homeTeamId, reason: "" }; return <article className="result-correction-card" key={item.match.id}><strong>{item.tournamentName} · {matchSideLabel(homeTeamId, "home", teamNames)} – {matchSideLabel(awayTeamId, "away", teamNames)}</strong><div className="form-grid"><label className="field">Đội bị xử thua<select value={draft.forfeitingTeamId} onChange={(event) => setForfeitDrafts((current) => ({ ...current, [item.match.id]: { ...draft, forfeitingTeamId: event.target.value } }))}><option value={homeTeamId}>{matchSideLabel(homeTeamId, "home", teamNames)}</option><option value={awayTeamId}>{matchSideLabel(awayTeamId, "away", teamNames)}</option></select></label><label className="field field-wide">Biên bản / căn cứ<textarea rows={2} maxLength={2000} value={draft.reason} onChange={(event) => setForfeitDrafts((current) => ({ ...current, [item.match.id]: { ...draft, reason: event.target.value } }))} placeholder="Ghi nhận xác minh, thời gian chờ, liên hệ đội và căn cứ điều lệ" /></label><div className="field-wide form-actions"><button className="button button-secondary" type="button" disabled={forfeitSubmitting || draft.reason.trim().length < 10} onClick={() => void submitForfeit(item)}>{forfeitSubmitting ? "Đang ghi nhận…" : "Xác nhận xử thua theo điều lệ"}</button></div></div></article>; }) : <div className="empty-state"><p>Không có trận trước giờ thi đấu đang chờ xử lý bỏ cuộc.</p></div>}</section>
      <section className="result-correction-queue"><div className="panel-heading"><div><span className="eyebrow">AUDIT</span><h3>Lịch sử quyết định xử thua</h3><p>Hiển thị căn cứ, người quyết định và tỷ số đã áp dụng theo điều lệ.</p></div></div>{forfeitHistory.length ? forfeitHistory.map(({ decision, tournamentName }) => <article className="result-correction-card" key={decision.id}><strong>{tournamentName} · {teamNames.get(decision.forfeitingTeamId) ?? decision.forfeitingTeamId.slice(0, 8)} bị xử thua</strong><p>Kết quả: {decision.homeScore}–{decision.awayScore} · Chính sách: {decision.policy} · {new Date(decision.createdAt).toLocaleString("vi-VN")}</p><p>Căn cứ: {decision.reason}</p><small>Trận {decision.matchId} · người quyết định {decision.decidedBy}</small></article>) : <div className="empty-state"><p>Chưa có quyết định xử thua được ghi nhận.</p></div>}</section>
        <section className="result-correction-queue"><div className="panel-heading"><div><span className="eyebrow">LỊCH SỬ KẾT QUẢ</span><h3>Yêu cầu đính chính</h3><p>BTC xem xét hồ sơ và lý do. Nếu sửa đội thắng playoff, backend chỉ cập nhật nhánh khi các trận phụ thuộc còn chưa xếp lịch và chưa phát sinh đội hình, biên bản hay diễn biến.</p></div><span className="status-pill">{correctionRequests.length} chờ xử lý</span></div>{correctionRequests.length ? correctionRequests.map((item) => <article className="result-correction-card" key={item.request.id}><div><strong>{item.tournamentName} · {item.match ? `${matchSideLabel(item.match.homeTeamId, "home", teamNames)} – ${matchSideLabel(item.match.awayTeamId, "away", teamNames)}` : "Trận đấu"}</strong><p>Kết quả: {item.request.originalResult.homeScore} – {item.request.originalResult.awayScore} → <b>{item.request.proposedResult.homeScore} – {item.request.proposedResult.awayScore}</b></p><p>Lý do: {item.request.reason}</p></div><label className="field">Ghi chú xét duyệt<input value={correctionReviewNotes[item.request.id] ?? ""} onChange={(event) => setCorrectionReviewNotes((current) => ({ ...current, [item.request.id]: event.target.value }))} placeholder="Bắt buộc nếu từ chối" /></label><div className="button-row"><button className="primary-button" type="button" disabled={correctionSubmitting} onClick={() => void decideCorrection(item, "APPROVED")}>Duyệt đính chính</button><button className="text-button danger-text-button" type="button" disabled={correctionSubmitting || (correctionReviewNotes[item.request.id]?.trim().length ?? 0) < 5} onClick={() => void decideCorrection(item, "REJECTED")}>Từ chối</button></div></article>) : <div className="empty-state"><p>Không có yêu cầu đính chính đang chờ.</p></div>}</section>
      <section className="result-correction-queue"><div className="panel-heading"><div><span className="eyebrow">KHIẾU NẠI</span><h3>Kháng nghị chờ xử lý</h3><p>BTC chỉ quyết định kháng nghị; chấp thuận sẽ yêu cầu xem xét lại hồ sơ gốc và không tự đảo tỷ số hay kết quả playoff.</p></div><span className="status-pill">{appeals.length} chờ xử lý</span></div>{appeals.length ? appeals.map((item) => <article className="result-correction-card" key={item.appeal.id}><strong>{item.tournamentName} · Kháng nghị hồ sơ {item.appeal.complaintId.slice(0, 8)}</strong><p>{item.appeal.description}</p>{item.appeal.evidence ? <p><b>Chứng cứ:</b> {item.appeal.evidence}</p> : null}<small>Gửi lúc {new Date(item.appeal.submittedAt).toLocaleString("vi-VN")} · người gửi {item.appeal.submittedBy}</small><label className="field">Lý do quyết định<input maxLength={2000} value={appealReasons[item.appeal.id] ?? ""} onChange={(event) => setAppealReasons((current) => ({ ...current, [item.appeal.id]: event.target.value }))} placeholder="Bắt buộc cho cả hai quyết định" /></label><div className="button-row"><button className="primary-button" type="button" disabled={appealBusy || (appealReasons[item.appeal.id]?.trim().length ?? 0) < 5} onClick={() => void decideAppeal(item, "APPROVED")}>Chấp thuận kháng nghị</button><button className="text-button danger-text-button" type="button" disabled={appealBusy || (appealReasons[item.appeal.id]?.trim().length ?? 0) < 5} onClick={() => void decideAppeal(item, "REJECTED")}>Bác kháng nghị</button></div></article>) : <div className="empty-state"><p>Không có kháng nghị đang chờ xử lý.</p></div>}</section>
      <section className="result-correction-queue"><div className="panel-heading"><div><span className="eyebrow">HỒ SƠ KHIẾU NẠI</span><h3>Khiếu nại cần kết luận</h3><p>Chấp thuận kết luận không tự sửa tỷ số; nếu cần thay kết quả, dùng hồ sơ đính chính có kiểm soát.</p></div><span className="status-pill">{complaints.length} đang mở</span></div>{complaints.length ? complaints.map((item) => { const draft = complaintDrafts[item.complaint.id] ?? { decision: "", reason: "" }; return <article className="result-correction-card" key={item.complaint.id}><strong>{item.tournamentName} · {item.complaint.complaintType} · {teamNames.get(item.complaint.teamId) ?? "Đội khiếu nại"}</strong><p>{item.complaint.description}</p>{item.complaint.evidence ? <p><b>Chứng cứ:</b> {item.complaint.evidence}</p> : null}<small>Gửi lúc {new Date(item.complaint.submittedAt).toLocaleString("vi-VN")} · trận {item.complaint.matchId}</small><label className="field">Kết luận / biện pháp<input maxLength={2000} value={draft.decision} onChange={(event) => setComplaintDrafts((current) => ({ ...current, [item.complaint.id]: { ...draft, decision: event.target.value } }))} placeholder="Bắt buộc khi chấp thuận" /></label><label className="field">Lý do / căn cứ<textarea rows={2} maxLength={2000} value={draft.reason} onChange={(event) => setComplaintDrafts((current) => ({ ...current, [item.complaint.id]: { ...draft, reason: event.target.value } }))} /></label><div className="button-row"><button className="primary-button" type="button" disabled={appealBusy || draft.decision.trim().length < 5} onClick={() => void decideComplaint(item, "APPROVED")}>Chấp thuận</button><button className="button button-secondary" type="button" disabled={appealBusy || item.complaint.status === "UNDER_REVIEW"} onClick={() => void decideComplaint(item, "CLOSED")}>Đóng hồ sơ</button><button className="text-button danger-text-button" type="button" disabled={appealBusy || draft.reason.trim().length < 5} onClick={() => void decideComplaint(item, "REJECTED")}>Bác khiếu nại</button></div></article>; }) : <div className="empty-state"><p>Không có khiếu nại nào đang chờ kết luận.</p></div>}</section>
    </> : null}
  </section>;
}
