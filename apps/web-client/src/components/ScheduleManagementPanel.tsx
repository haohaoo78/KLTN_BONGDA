import { useEffect, useMemo, useState } from "react";
import {
  createTournamentSchedule,
  getActiveVenues,
  getManagedTournamentSchedules,
  getMatches,
  updateTournamentSchedule,
  type Match,
  type TournamentSchedule,
  type Venue,
} from "../api/competition";

type Props = {
  tournaments: Array<{ id: string; name: string; status: string }>;
  mode?: "venues" | "referees";
  onNotice: (message: string) => void;
};

function localDateTimeInSevenDays(): string {
  const date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  date.setMinutes(0, 0, 0);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function ScheduleManagementPanel({ tournaments, mode = "venues", onNotice }: Props) {
  const [tournamentId, setTournamentId] = useState("");
  const [matches, setMatches] = useState<Match[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [schedules, setSchedules] = useState<TournamentSchedule[]>([]);
  const [matchId, setMatchId] = useState("");
  const [venueId, setVenueId] = useState("");
  const [refereeId, setRefereeId] = useState("");
  const [scheduledDate, setScheduledDate] = useState(localDateTimeInSevenDays);
  const [durationMinutes, setDurationMinutes] = useState(90);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refereeDrafts, setRefereeDrafts] = useState<Record<string, string>>({});

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
    ]).then(([matchResult, venueResult, scheduleResult]) => {
      if (!active) return;
      setMatches(matchResult.items);
      setVenues(venueResult.venues.filter((venue) => venue.isActive));
      setSchedules(scheduleResult.schedules);
      setRefereeDrafts(Object.fromEntries(scheduleResult.schedules.map((schedule) => [schedule.id, schedule.refereeId ?? ""])));
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
  }, [tournamentId]);

  const scheduledMatchIds = useMemo(
    () => new Set(schedules.filter((schedule) => schedule.status !== "CANCELLED").map((schedule) => schedule.matchId)),
    [schedules],
  );
  const schedulableMatches = matches.filter((match) =>
    (match.status === "UNSCHEDULED" || match.status === "SCHEDULED") && !scheduledMatchIds.has(match.id),
  );
  const matchById = new Map(matches.map((match) => [match.id, match]));
  const venueById = new Map(venues.map((venue) => [venue.id, venue]));

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
        refereeId: refereeId.trim() || undefined,
        scheduledDate: new Date(scheduledDate).toISOString(),
        durationMinutes,
      });
      setSchedules((current) => [schedule, ...current.filter((item) => item.id !== schedule.id)]);
      setMatchId("");
      onNotice("Đã lưu lịch ở trạng thái nháp. Công bố để lịch hiển thị công khai.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không lưu được lịch thi đấu.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePublish(schedule: TournamentSchedule) {
    setSubmitting(true);
    setError(null);
    try {
      const { schedule: published } = await updateTournamentSchedule(schedule.id, { status: "PUBLISHED" });
      setSchedules((current) => current.map((item) => item.id === published.id ? published : item));
      onNotice("Đã công bố lịch thi đấu.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không công bố được lịch.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAssignReferee(schedule: TournamentSchedule) {
    const refereeId = refereeDrafts[schedule.id]?.trim();
    if (!refereeId) { setError("Nhập mã tài khoản trọng tài cần phân công."); return; }
    setSubmitting(true); setError(null);
    try {
      const { schedule: updated } = await updateTournamentSchedule(schedule.id, { refereeId });
      setSchedules((current) => current.map((item) => item.id === updated.id ? updated : item));
      onNotice("Đã phân công trọng tài cho trận.");
    } catch (err) { setError(err instanceof Error ? err.message : "Không phân công được trọng tài."); }
    finally { setSubmitting(false); }
  }

  return (
    <section className="panel data-panel schedule-management-panel">
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
              <select value={matchId} onChange={(event) => setMatchId(event.target.value)}>
                <option value="">Chọn trận</option>
                {schedulableMatches.map((match) => (
                  <option key={match.id} value={match.id}>
                    {match.round ?? "Vòng bảng"} · {match.homeTeamId.slice(0, 8)} – {match.awayTeamId.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
            <label className="draw-field">
              <span>Sân đang hoạt động *</span>
              <select value={venueId} onChange={(event) => setVenueId(event.target.value)}>
                <option value="">Chọn sân</option>
                {venues.map((venue) => (
                  <option key={venue.id} value={venue.id}>{venue.name} · {venue.location}</option>
                ))}
              </select>
            </label>
            <label className="draw-field">
              <span>Ngày và giờ *</span>
              <input type="datetime-local" value={scheduledDate} onChange={(event) => setScheduledDate(event.target.value)} />
            </label>
            <label className="draw-field">
              <span>Thời lượng (phút) *</span>
              <input type="number" min={1} max={240} value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value))} />
            </label>
          </div>
          <p className="muted">Lịch được kiểm tra xung đột sân, đội bóng, thời gian nghỉ và thời hạn giải. Bản nháp chưa hiển thị công khai; phân công trọng tài thực hiện tại bước 6.</p>
          <div className="draw-actions">
            <button type="button" className="button button-primary" disabled={submitting || loading || !schedulableMatches.length || !venues.length} onClick={() => void handleCreate()}>
              Lưu lịch nháp
            </button>
          </div></> : null}
          <div className="draw-history">
            <h3>Lịch đã tạo</h3>
            {!schedules.length ? <p className="muted">Chưa có lịch.</p> : schedules.map((schedule) => {
              const match = matchById.get(schedule.matchId);
              return (
                <article key={schedule.id} className="schedule-row">
                  <div>
                    <strong>{match?.round ?? "Trận đấu"} · {venueById.get(schedule.venueId)?.name ?? "Sân"}</strong>
                    <span>{match?.homeTeamId.slice(0, 8) ?? "—"} – {match?.awayTeamId.slice(0, 8) ?? "—"} · {new Date(schedule.scheduledDate).toLocaleString("vi-VN")}</span>
                  </div>
                  <span className={`status-pill status-${schedule.status.toLowerCase()}`}>{schedule.status === "PUBLISHED" ? "Đã công bố" : schedule.status === "DRAFT" ? "Bản nháp" : schedule.status}</span>
                  {mode === "referees" ? <div className="schedule-referee-assignment"><label className="draw-field"><span>Mã tài khoản trọng tài</span><input value={refereeDrafts[schedule.id] ?? ""} onChange={(event) => setRefereeDrafts((current) => ({ ...current, [schedule.id]: event.target.value }))} placeholder="UUID tài khoản REFEREE" /></label><button type="button" className="button button-secondary" disabled={submitting || !(refereeDrafts[schedule.id] ?? "").trim()} onClick={() => void handleAssignReferee(schedule)}>Lưu phân công</button><small>{schedule.refereeId ? `Đã gán: ${schedule.refereeId}` : "Chưa phân công"}</small></div> : null}
                  {mode === "venues" && schedule.status === "DRAFT" ? (
                    <button type="button" className="button button-secondary" disabled={submitting} onClick={() => void handlePublish(schedule)}>
                      Công bố
                    </button>
                  ) : null}
                </article>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
