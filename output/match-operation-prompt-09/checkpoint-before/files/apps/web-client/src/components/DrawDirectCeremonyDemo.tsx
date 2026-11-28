import { useEffect, useMemo, useState } from "react";
import type { DrawCandidate, DrawTestConfiguration } from "../api/competition";
import { useDialog } from "./DialogProvider";

type CeremonyStatus = "SCHEDULED" | "POSTPONED" | "LIVE" | "PAUSED" | "CANCELLED" | "COMPLETED";
type CeremonyPick = { teamId: string; groupIndex: number; groupName: string; position: number; seedGroup: number | null; sequence: number };
type CeremonyLog = { at: string; label: string; detail: string };
type CeremonyState = {
  version: 1; tournamentId: string; eventName: string; date: string; time: string; timeZone: string; announcement: string;
  status: CeremonyStatus; plan: CeremonyPick[]; revealed: number; createdAt: string; updatedAt: string;
  log: CeremonyLog[]; simulation: "REAL" | "BEFORE" | "DUE"; offline: boolean; teamSnapshot: DrawCandidate[];
};
type Props = { tournamentId: string; tournamentName: string; configuration: DrawTestConfiguration; teams: DrawCandidate[]; onNotice: (message: string) => void };

const storageKey = (id: string) => `sfl.draw.direct-ceremony.demo.v1.${id}`;
const nowIso = () => new Date().toISOString();
const groupName = (index: number) => `Bảng ${String.fromCharCode(65 + index)}`;
function shuffle<T>(items: T[]): T[] {
  const values = [...items];
  for (let i = values.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [values[i], values[j]] = [values[j], values[i]]; }
  return values;
}
function makePlan(config: DrawTestConfiguration, teams: DrawCandidate[]): CeremonyPick[] {
  const byId = new Map(teams.map((team) => [team.teamId, team]));
  const capacities = config.format === "KNOCKOUT"
    ? [2 ** Math.ceil(Math.log2(Math.max(2, teams.length)))]
    : config.teamsPerGroup;
  const slots = capacities.flatMap((capacity, groupIndex) => Array.from({ length: capacity }, (_, position) => ({ groupIndex, groupName: config.format === "KNOCKOUT" ? "Nhánh loại trực tiếp" : groupName(groupIndex), position: position + 1 })));
  const byeCount = config.format === "KNOCKOUT" ? slots.length - teams.length : 0;
  const byePositions = config.byePolicy === "SEEDED_FIRST"
    ? new Set(slots.slice(0, byeCount).map((slot) => slot.position - 1))
    : new Set(shuffle(slots.map((_, index) => index)).slice(0, byeCount));
  const usable = slots.filter((_, index) => !byePositions.has(index));
  const candidates = shuffle(teams);
  const attempts = 1500;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const remaining = shuffle(candidates);
    const result: CeremonyPick[] = [];
    const schools = new Map<number, Set<string>>();
    const pots = new Map<number, Set<number>>();
    let failed = false;
    for (const slot of usable) {
      const eligible = shuffle(remaining.filter((team) => {
        const pot = config.seedGroups[team.teamId];
        const schoolId = team.institutionId;
        return !(pot && pots.get(slot.groupIndex)?.has(pot))
          && !(config.separateSameInstitution && schoolId && schools.get(slot.groupIndex)?.has(schoolId));
      }));
      if (!eligible.length) { failed = true; break; }
      const team = eligible[0];
      remaining.splice(remaining.findIndex((item) => item.teamId === team.teamId), 1);
      const pot = config.seedGroups[team.teamId] || null;
      result.push({ teamId: team.teamId, groupIndex: slot.groupIndex, groupName: slot.groupName, position: slot.position, seedGroup: pot, sequence: 0 });
      if (pot) { const set = pots.get(slot.groupIndex) ?? new Set<number>(); set.add(pot); pots.set(slot.groupIndex, set); }
      if (team.institutionId) { const set = schools.get(slot.groupIndex) ?? new Set<string>(); set.add(team.institutionId); schools.set(slot.groupIndex, set); }
    }
    if (!failed && remaining.length === 0) return shuffle(result).map((pick, index) => ({ ...pick, sequence: index + 1 }));
  }
  throw new Error("Không tìm được phương án hợp lệ với các ràng buộc hiện tại. Hãy điều chỉnh nhóm hạt giống hoặc ràng buộc rồi áp dụng lại cấu hình.");
}
function zonedDateTime(date: string, time: string, timeZone: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const utcWallTime = Date.UTC(year, month - 1, day, hour, minute);
  const offset = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" }).formatToParts(new Date(utcWallTime)).find((part) => part.type === "timeZoneName")?.value ?? "GMT+00:00";
  const match = offset.match(/GMT([+-])(\d{2}):(\d{2})/);
  const minutes = match ? (Number(match[2]) * 60 + Number(match[3])) * (match[1] === "+" ? 1 : -1) : 0;
  return utcWallTime - minutes * 60_000;
}
function countdown(timestamp: number, now: number) {
  let seconds = Math.max(0, Math.floor((timestamp - now) / 1000));
  const days = Math.floor(seconds / 86_400); seconds %= 86_400;
  const hours = Math.floor(seconds / 3600); seconds %= 3600;
  const minutes = Math.floor(seconds / 60); seconds %= 60;
  return `${days} ngày · ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
function defaultDateTime() { const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000); return { date: tomorrow.toISOString().slice(0, 10), time: "18:30" }; }
function statusLabel(status: CeremonyStatus, due: boolean) {
  if (status === "SCHEDULED" || status === "POSTPONED") return due ? "Đã đến giờ · Chờ BTC bắt đầu" : status === "POSTPONED" ? "Đã hoãn" : "Sắp diễn ra · Chưa đến giờ";
  return ({ LIVE: "LIVE · Đang bốc thăm", PAUSED: "Tạm dừng", CANCELLED: "Đã hủy", COMPLETED: "Hoàn thành" } as const)[status];
}

export function DrawDirectCeremonyDemo({ tournamentId, tournamentName, configuration, teams, onNotice }: Props) {
  const { confirm } = useDialog();
  const key = storageKey(tournamentId);
  const selectedTeams = useMemo(() => teams.filter((team) => configuration.teamIds.includes(team.teamId)), [teams, configuration.teamIds]);
  const [state, setState] = useState<CeremonyState | null>(null);
  const [eventName, setEventName] = useState("Lễ bốc thăm chia bảng");
  const [date, setDate] = useState(defaultDateTime().date);
  const [time, setTime] = useState(defaultDateTime().time);
  const [timeZone, setTimeZone] = useState("Asia/Ho_Chi_Minh");
  const [announcement, setAnnouncement] = useState("");
  const [clock, setClock] = useState(Date.now());
  const [flashPick, setFlashPick] = useState(false);
  const [isPicking, setIsPicking] = useState(false);
  const [boardExpanded, setBoardExpanded] = useState(false);
  const [boardZoom, setBoardZoom] = useState(1);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(key);
      const parsed = saved ? JSON.parse(saved) as CeremonyState : null;
      if (parsed?.version === 1 && parsed.tournamentId === tournamentId) {
        setState(parsed); setEventName(parsed.eventName); setDate(parsed.date); setTime(parsed.time); setTimeZone(parsed.timeZone); setAnnouncement(parsed.announcement);
      } else setState(null);
    } catch { setState(null); }
  }, [key, tournamentId]);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    const onStorage = (event: StorageEvent) => { if (event.key === key && event.newValue) { try { setState(JSON.parse(event.newValue) as CeremonyState); } catch { /* ignore malformed demo state */ } } };
    window.addEventListener("storage", onStorage);
    return () => { window.clearInterval(timer); window.removeEventListener("storage", onStorage); };
  }, [key]);
  useEffect(() => { if (!flashPick) return; const timer = window.setTimeout(() => setFlashPick(false), 1000); return () => window.clearTimeout(timer); }, [flashPick]);

  const due = Boolean(state && (state.simulation === "DUE" || (state.simulation === "REAL" && clock >= zonedDateTime(state.date, state.time, state.timeZone))));
  const formatName = configuration.format === "ROUND_ROBIN" ? "Vòng tròn" : configuration.format === "KNOCKOUT" ? "Loại trực tiếp" : "Vòng bảng + loại trực tiếp";
  const visiblePicks = state?.plan.slice(0, state.revealed) ?? [];
  const latestPick = visiblePicks.at(-1) ?? null;
  const unpicked = selectedTeams.filter((team) => !visiblePicks.some((pick) => pick.teamId === team.teamId));
  const capacities = configuration.format === "KNOCKOUT" ? [2 ** Math.ceil(Math.log2(Math.max(2, selectedTeams.length)))] : configuration.teamsPerGroup;
  const groupCount = capacities.length;
  const slots = capacities.flatMap((capacity, groupIndex) => Array.from({ length: capacity }, (_, position) => ({ groupIndex, groupName: configuration.format === "KNOCKOUT" ? "Nhánh loại trực tiếp" : groupName(groupIndex), position: position + 1 })));
  const byeCount = configuration.format === "KNOCKOUT" ? slots.length - selectedTeams.length : 0;
  const byePositions = useMemo(() => configuration.byePolicy === "SEEDED_FIRST" ? new Set(slots.slice(0, byeCount).map((slot) => slot.position - 1)) : new Set(shuffle(slots.map((_, index) => index)).slice(0, byeCount)), [configuration.byePolicy, slots.length, byeCount]);
  const resolvedDue = due;
  const assignedPosition = (pick: CeremonyPick) => configuration.format === "KNOCKOUT" ? `P${pick.position}` : `${pick.groupName.replace("Bảng ", "")}${pick.position}`;

  function persist(next: CeremonyState) { setState(next); localStorage.setItem(key, JSON.stringify(next)); }
  function log(next: CeremonyState, label: string, detail: string) { return { ...next, updatedAt: nowIso(), log: [...next.log, { at: nowIso(), label, detail }] }; }
  function publishSchedule() {
    if (!eventName.trim() || !date || !time || selectedTeams.length < 2) return;
    let plan: CeremonyPick[];
    try { plan = makePlan(configuration, selectedTeams); } catch (error) { onNotice(error instanceof Error ? error.message : "Cấu hình chưa khả thi."); return; }
    const { date: nextDate, time: nextTime } = { date, time };
    if (zonedDateTime(date, time, timeZone) <= Date.now()) { onNotice("Ngày giờ buổi lễ phải nằm trong tương lai. Dùng mô phỏng ‘Đã đến giờ’ sau khi công bố lịch để kiểm thử."); return; }
    const base: CeremonyState = { version: 1, tournamentId, eventName: eventName.trim(), date: nextDate, time: nextTime, timeZone, announcement: announcement.trim(), status: "SCHEDULED", plan, revealed: 0, createdAt: nowIso(), updatedAt: nowIso(), log: [], simulation: "REAL", offline: false, teamSnapshot: selectedTeams };
    persist(log(base, "Đã công bố lịch bốc thăm", `${nextDate} ${nextTime} (${timeZone})`));
    onNotice("Đã công bố lịch buổi bốc thăm thử nghiệm trên trình duyệt này.");
  }
  async function updateSchedule(action: "save" | "postpone" | "cancel") {
    if (!state || state.status === "LIVE" || state.status === "PAUSED" || state.status === "COMPLETED") return;
    const labels = { save: "Cập nhật lịch", postpone: "Hoãn buổi lễ", cancel: "Hủy buổi lễ" };
    if (!await confirm({ title: `${labels[action]}?`, description: action === "cancel" ? "Buổi lễ demo sẽ chuyển sang trạng thái đã hủy. Lịch sử vẫn được giữ." : "Thông tin lịch sẽ được cập nhật và lưu vào lịch sử demo trên trình duyệt này.", confirmLabel: labels[action], danger: action === "cancel" })) return;
    const next = action === "cancel" ? { ...state, status: "CANCELLED" as const } : { ...state, eventName: eventName.trim(), date, time, timeZone, announcement: announcement.trim(), status: action === "postpone" ? "POSTPONED" as const : "SCHEDULED" as const };
    persist(log(next, labels[action], action === "cancel" ? "BTC đã hủy trước khi bắt đầu." : `${date} ${time} (${timeZone})`));
  }
  async function start() {
    if (!state || !resolvedDue || state.offline || !await confirm({ title: "Bắt đầu buổi bốc thăm?", description: "Sau khi bắt đầu, từng lượt sẽ được ghi nhận theo thứ tự. Không thể bốc lại, hoàn tác hoặc đổi vị trí đã mở.", confirmLabel: "Bắt đầu buổi lễ" })) return;
    persist(log({ ...state, status: "LIVE" }, "BTC bắt đầu buổi lễ", "Phiên bắt đầu theo thao tác chủ động của BTC."));
  }
  async function nextPick() {
    if (isPicking || !state || state.status !== "LIVE" || state.offline || state.revealed >= state.plan.length) return;
    setIsPicking(true);
    setFlashPick(true);
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 850));
      setState((current) => {
        if (!current || current.status !== "LIVE" || current.offline) return current;
        const revealed = current.revealed + 1;
        const pick = current.plan[revealed - 1];
        const team = teams.find((item) => item.teamId === pick.teamId) ?? current.teamSnapshot.find((item) => item.teamId === pick.teamId);
        const next = log({ ...current, revealed, status: revealed === current.plan.length ? "COMPLETED" : "LIVE" }, revealed === current.plan.length ? "Hoàn tất và khóa kết quả" : `Lượt ${revealed}`, `${team?.name ?? "Đội bóng"} → ${assignedPosition(pick)}`);
        localStorage.setItem(key, JSON.stringify(next));
        return next;
      });
    } finally { setIsPicking(false); }
  }
  function setOffline(offline: boolean) { if (state) persist(log({ ...state, offline }, offline ? "Mất kết nối mô phỏng" : "Đã kết nối lại", offline ? "Thao tác tạm khóa, dữ liệu đã ghi nhận được giữ nguyên." : "Đã tiếp tục từ lượt đã ghi nhận gần nhất.")); }
  function setSimulation(simulation: "REAL" | "BEFORE" | "DUE") { if (state) persist(log({ ...state, simulation }, simulation === "DUE" ? "Giả lập đã đến giờ" : simulation === "BEFORE" ? "Giả lập trước giờ" : "Dùng đồng hồ thật", "Chỉ thay đổi đồng hồ kiểm thử của trình duyệt này.")); }
  function resetDemo() { localStorage.removeItem(key); setState(null); setEventName("Lễ bốc thăm chia bảng"); setAnnouncement(""); setDate(defaultDateTime().date); setTime(defaultDateTime().time); onNotice("Đã xóa riêng dữ liệu buổi lễ demo trên trình duyệt này."); }

  return <section className="direct-draw-demo" aria-label="Buổi lễ bốc thăm trực tiếp demo">
    <div className="direct-draw-demo-banner"><span>DEV · GIẢ LẬP BUỔI LỄ</span><strong>Lịch, đồng hồ và lượt bốc lưu trên trình duyệt này; chưa ghi bản chia chính thức lên backend hoặc đồng bộ thiết bị khác.</strong></div>
    {!state ? <div className="direct-draw-setup">
      <header><div><p className="eyebrow">TỔ CHỨC BUỔI LỄ</p><h3>{tournamentName}</h3><p>{formatName} · {selectedTeams.length} đội chính thức · {groupCount} {configuration.format === "KNOCKOUT" ? "nhánh" : "bảng"}</p></div><span className="direct-draw-status">Chưa công bố lịch</span></header>
      <div className="direct-draw-form">
        <label>Tên buổi lễ<input value={eventName} maxLength={160} onChange={(event) => setEventName(event.target.value)} /></label>
        <label>Ngày tổ chức<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <label>Giờ tổ chức<input type="time" value={time} onChange={(event) => setTime(event.target.value)} /></label>
        <label>Múi giờ<select value={timeZone} onChange={(event) => setTimeZone(event.target.value)}><option value="Asia/Ho_Chi_Minh">Asia/Ho_Chi_Minh (UTC+07:00)</option><option value="UTC">UTC</option><option value="Asia/Bangkok">Asia/Bangkok (UTC+07:00)</option></select></label>
        <label className="direct-draw-wide">Nội dung thông báo<textarea rows={3} value={announcement} onChange={(event) => setAnnouncement(event.target.value)} placeholder="Thông tin gửi đến các đội tham dự…" /></label>
      </div>
      <div className="direct-draw-preview-grid"><article><h4>Đội chính thức <small>{selectedTeams.length}</small></h4><div className="direct-draw-team-strip">{selectedTeams.map((team) => <span key={team.teamId}>{team.logoUrl ? <img src={team.logoUrl} alt="" /> : <b>{(team.shortName || team.name).slice(0, 2)}</b>}<strong>{team.name}</strong><small>{team.institutionName}</small></span>)}</div></article><article><h4>Quy tắc và ràng buộc</h4><p>{configuration.format === "ROUND_ROBIN" ? `${configuration.roundRobinLegs} lượt · ${configuration.teamsPerGroup.map((size, i) => `${groupName(i)} ${size} đội`).join(" · ")}` : configuration.format === "KNOCKOUT" ? `${selectedTeams.length} đội · ${capacities[0]} vị trí · ${byeCount} BYE · ${Math.log2(capacities[0])} vòng` : `${configuration.groupCount} bảng · ${configuration.qualifiersPerGroup} đội/bảng + ${configuration.extraQualificationSlots} suất bổ sung · ${configuration.knockoutPairing}`}</p><p>{configuration.separateSameInstitution ? "Tách đội cùng trường là bắt buộc." : "Không bật ràng buộc tách trường."} Pot được lấy từ cấu hình kiểm thử.</p></article></div>
      <div className="direct-draw-preview"><h4>Xem trước sơ đồ phân bổ</h4><div className={configuration.format === "KNOCKOUT" ? "direct-draw-bracket" : "direct-draw-groups"}>{capacities.map((capacity, groupIndex) => <article key={groupIndex}><strong>{configuration.format === "KNOCKOUT" ? "Nhánh đấu" : groupName(groupIndex)}</strong>{Array.from({ length: capacity }, (_, i) => <span key={i}>{configuration.format === "KNOCKOUT" ? `P${i + 1}` : `${String.fromCharCode(65 + groupIndex)}${i + 1}`} · vị trí dự kiến</span>)}</article>)}</div></div>
      <aside className="direct-draw-notice-preview"><strong>Xem trước thông báo</strong><p>{announcement.trim() || "Các đội tham dự được mời theo dõi buổi bốc thăm trực tiếp."}</p><span>{date} · {time} · {timeZone}</span></aside>
      <button type="button" className="button button-primary" disabled={selectedTeams.length < 2 || !eventName.trim() || !date || !time} onClick={publishSchedule}>Công bố lịch bốc thăm</button>
    </div> : <>
      <header className="direct-draw-event-header"><div className="direct-draw-trophy" aria-hidden="true">⚽</div><div><p className="eyebrow">{tournamentName}</p><h3>{state.eventName}</h3><p>{new Date(`${state.date}T${state.time}:00`).toLocaleString("vi-VN", { dateStyle: "full", timeStyle: "short" })} · {state.timeZone}</p></div><span className={`direct-draw-status ${state.status === "LIVE" ? "is-live" : ""}`}>{statusLabel(state.status, due)}</span></header>
      <div className="direct-draw-countdown"><strong>{state.status === "LIVE" ? "BUỔI LỄ ĐANG DIỄN RA" : state.status === "PAUSED" ? "BUỔI LỄ TẠM DỪNG" : state.status === "COMPLETED" ? "KẾT QUẢ ĐÃ KHÓA" : due ? "ĐÃ ĐẾN GIỜ · CHỜ BTC BẮT ĐẦU" : "BUỔI LỄ SẮP DIỄN RA"}</strong><span>{!due && (state.status === "SCHEDULED" || state.status === "POSTPONED") ? countdown(zonedDateTime(state.date, state.time, state.timeZone), clock) : `${state.revealed}/${state.plan.length} lượt đã mở`}</span><progress max={state.plan.length} value={state.revealed} /></div>
      {state.announcement ? <p className="direct-draw-announcement">{state.announcement}</p> : null}
      <div className="direct-draw-tools"><label>Giả lập thời điểm<select value={state.simulation} disabled={state.status === "LIVE" || state.status === "PAUSED" || state.status === "COMPLETED" || state.status === "CANCELLED"} onChange={(event) => setSimulation(event.target.value as "REAL" | "BEFORE" | "DUE")}><option value="REAL">Theo đồng hồ thật</option><option value="BEFORE">Giả lập chưa đến giờ</option><option value="DUE">Giả lập đã đến giờ</option></select></label><label>Kết nối<select value={state.offline ? "OFFLINE" : "ONLINE"} disabled={state.status === "COMPLETED" || state.status === "CANCELLED"} onChange={(event) => setOffline(event.target.value === "OFFLINE")}><option value="ONLINE">Đang kết nối</option><option value="OFFLINE">Mô phỏng mất kết nối</option></select></label><span>{state.offline ? "Mất kết nối · lượt đã ghi nhận được giữ nguyên" : "Đang đồng bộ trong tab trình duyệt này"}</span></div>
      {state.status === "SCHEDULED" || state.status === "POSTPONED" ? <div className="direct-draw-controls"><button type="button" className="button button-primary" disabled={!due || state.offline} onClick={() => void start()}>{due ? "Bắt đầu bốc thăm" : "Chưa đến giờ bắt đầu"}</button><button type="button" className="button button-secondary" onClick={() => void updateSchedule("save")}>Thay đổi lịch</button><button type="button" className="button button-secondary" onClick={() => void updateSchedule("postpone")}>Hoãn buổi lễ</button><button type="button" className="button button-danger" onClick={() => void updateSchedule("cancel")}>Hủy lịch</button></div> : null}
      {state.status === "LIVE" || state.status === "PAUSED" ? <div className="direct-draw-controls"><button type="button" className="button button-primary" disabled={state.status !== "LIVE" || state.offline || isPicking || state.revealed >= state.plan.length} onClick={() => void nextPick()}>{isPicking ? "Đang trộn lá thăm…" : state.revealed === 0 ? "Bốc lá thăm đầu tiên" : "Bốc lá thăm tiếp theo"}</button>{state.status === "LIVE" ? <button className="button button-secondary" type="button" disabled={state.offline || isPicking} onClick={() => persist(log({ ...state, status: "PAUSED" }, "Tạm dừng buổi lễ", "BTC tạm dừng phiên."))}>Tạm dừng</button> : <button className="button button-primary" type="button" disabled={state.offline || isPicking} onClick={() => persist(log({ ...state, status: "LIVE" }, "Tiếp tục buổi lễ", "BTC tiếp tục từ lượt đã công khai gần nhất."))}>Tiếp tục</button>}</div> : null}
      {state.status === "CANCELLED" ? <div className="direct-draw-controls"><strong>Buổi lễ đã hủy. Lịch sử vẫn được giữ lại.</strong><button type="button" className="button button-secondary" onClick={resetDemo}>Tạo lịch mới cho demo</button></div> : null}
      <div className="direct-draw-stage-grid"><section className={`direct-draw-ball ${flashPick ? "mixing" : ""} ${latestPick ? "revealed" : ""}`} aria-live="polite"><span className="direct-draw-ball-glow" /><div className="direct-draw-envelope">{state.status === "LIVE" && state.revealed < state.plan.length ? flashPick ? "ĐANG TRỘN" : "LÁ THĂM" : state.status === "COMPLETED" ? "HOÀN TẤT" : "BUỔI LỄ"}</div>{latestPick ? (() => { const team = teams.find((item) => item.teamId === latestPick.teamId) ?? state.teamSnapshot.find((item) => item.teamId === latestPick.teamId); return <div className="direct-draw-reveal-team">{team?.logoUrl ? <img src={team.logoUrl} alt="" /> : <b>{(team?.shortName || team?.name || "ĐỘI").slice(0, 3)}</b>}<strong>{team?.name ?? latestPick.teamId}</strong><span>{team?.institutionName ?? ""}</span><em>Pot {latestPick.seedGroup ?? "—"} · {assignedPosition(latestPick)}</em></div>; })() : <p>Đội và vị trí được khóa theo quy tắc trước khi BTC bắt đầu.</p>}</section>
        <section className={`direct-draw-board ${boardExpanded ? "is-expanded" : ""}`}><header><div><span className="eyebrow">SƠ ĐỒ CẬP NHẬT TỪNG LƯỢT</span><strong>{formatName}</strong></div><span>{visiblePicks.length}/{selectedTeams.length}</span><div className="direct-draw-zoom-controls"><button type="button" className="button button-secondary" aria-label="Thu nhỏ sơ đồ" disabled={boardZoom <= 0.7} onClick={() => setBoardZoom((value) => Math.max(0.7, Number((value - 0.1).toFixed(1))))}>−</button><span>{Math.round(boardZoom * 100)}%</span><button type="button" className="button button-secondary" aria-label="Phóng to sơ đồ" disabled={boardZoom >= 1.5} onClick={() => setBoardZoom((value) => Math.min(1.5, Number((value + 0.1).toFixed(1))))}>＋</button></div><button type="button" className="button button-secondary" onClick={() => setBoardExpanded((value) => !value)}>{boardExpanded ? "Thu sơ đồ" : "Mở rộng sơ đồ"}</button></header><div className="direct-draw-board-viewport"><div className="direct-draw-board-zoom" style={{ transform: `scale(${boardZoom})`, width: `${100 / boardZoom}%` }}>{configuration.format === "KNOCKOUT" ? <div className="direct-draw-knockout-board">{slots.map((slot, index) => { const pick = visiblePicks.find((item) => item.position === slot.position); const isBye = byePositions.has(index); return <article className={pick && latestPick?.teamId === pick.teamId ? "just-drawn" : ""} key={index}><b>P{slot.position}</b><span>{isBye ? "BYE · miễn vòng" : pick ? teams.find((team) => team.teamId === pick.teamId)?.name ?? "Đội vừa bốc" : "Chưa bốc"}</span></article>; })}</div> : <div className="direct-draw-groups">{capacities.map((capacity, groupIndex) => <article key={groupIndex}><header><strong>{groupName(groupIndex)}</strong><span>{visiblePicks.filter((pick) => pick.groupIndex === groupIndex).length}/{capacity}</span></header>{Array.from({ length: capacity }, (_, position) => { const pick = visiblePicks.find((item) => item.groupIndex === groupIndex && item.position === position + 1); return <div className={pick && latestPick?.teamId === pick.teamId ? "just-drawn" : ""} key={position}><b>{String.fromCharCode(65 + groupIndex)}{position + 1}</b><span>{pick ? teams.find((team) => team.teamId === pick.teamId)?.name ?? "Đội vừa bốc" : "Vị trí còn trống"}</span>{pick?.seedGroup ? <small>Pot {pick.seedGroup}</small> : null}</div>; })}</article>)}</div>}</div></div></section></div>
      <div className="direct-draw-lower-grid"><section><h4>Đội còn lại <small>{unpicked.length}</small></h4><div className="direct-draw-remaining">{unpicked.map((team) => <span key={team.teamId}>{team.logoUrl ? <img src={team.logoUrl} alt="" /> : <b>{(team.shortName || team.name).slice(0, 2)}</b>}<span><strong>{team.name}</strong><small>{team.institutionName}</small></span>{configuration.seedGroups[team.teamId] ? <em>Pot {configuration.seedGroups[team.teamId]}</em> : null}</span>)}</div></section><section><h4>Lịch sử buổi lễ</h4><ol className="direct-draw-history">{[...state.log].reverse().map((item, index) => <li key={`${item.at}-${index}`}><strong>{item.label}</strong><span>{item.detail}</span><time>{new Date(item.at).toLocaleString("vi-VN")}</time></li>)}</ol></section></div>
      {state.status === "COMPLETED" ? <div className="direct-draw-completed"><strong>Buổi bốc thăm đã hoàn tất</strong><p>Kết quả demo đã tự khóa sau lượt cuối. Không thể bốc lại hoặc hoàn tác. Đây chưa phải bản chia chính thức của giải và chưa mở Bước 4.</p></div> : null}
      {state.status !== "LIVE" && state.status !== "PAUSED" && state.status !== "COMPLETED" && state.status !== "CANCELLED" ? <button className="button button-secondary direct-draw-reset" type="button" onClick={() => void updateSchedule("cancel")}>Hủy lịch buổi lễ</button> : null}
    </>}
  </section>;
}

export function DirectDrawPublicView({ tournamentId }: { tournamentId: string }) {
  const [state, setState] = useState<CeremonyState | null>(null);
  const key = storageKey(tournamentId);
  useEffect(() => {
    const refresh = () => { try { const value = localStorage.getItem(key); setState(value ? JSON.parse(value) as CeremonyState : null); } catch { setState(null); } };
    refresh(); window.addEventListener("storage", refresh); const timer = window.setInterval(refresh, 1500);
    return () => { window.removeEventListener("storage", refresh); window.clearInterval(timer); };
  }, [key]);
  if (!state || state.status === "CANCELLED") return null;
  const title = state.status === "LIVE" ? "LIVE · Buổi bốc thăm đang diễn ra" : state.status === "PAUSED" ? "Buổi lễ tạm dừng" : state.status === "COMPLETED" ? "Buổi lễ đã hoàn thành" : state.simulation === "DUE" || (state.simulation === "REAL" && Date.now() >= zonedDateTime(state.date, state.time, state.timeZone)) ? "Đã đến giờ · Chờ BTC bắt đầu" : state.status === "POSTPONED" ? "Buổi lễ đã hoãn" : "Buổi lễ sắp diễn ra";
  const latest = state.plan[state.revealed - 1];
  const latestTeam = latest ? state.teamSnapshot?.find((item) => item.teamId === latest.teamId) : null;
  return <section className="tournament-detail-section public-direct-draw"><div className="public-direct-draw-head"><div><span className="eyebrow">BỐC THĂM TRỰC TIẾP · BẢN DEMO CÙNG TRÌNH DUYỆT</span><h3>{state.eventName}</h3><p>{new Date(zonedDateTime(state.date, state.time, state.timeZone)).toLocaleString("vi-VN", { dateStyle: "full", timeStyle: "short", timeZone: state.timeZone })} · {state.timeZone}</p></div><strong>{title}</strong></div>{state.announcement ? <p>{state.announcement}</p> : null}<progress max={state.plan.length} value={state.revealed} /><span>{state.revealed}/{state.plan.length} lượt đã mở</span>{latest && latestTeam ? <article className="public-direct-draw-latest"><strong>Đội vừa được bốc · {latest.groupName} · vị trí {latest.position}</strong><span>{latestTeam.name} · {latestTeam.institutionName}</span></article> : null}<ol>{state.plan.slice(0, state.revealed).map((pick) => { const team = state.teamSnapshot?.find((item) => item.teamId === pick.teamId); return <li key={pick.sequence}>{pick.groupName} · vị trí {pick.position} · {team?.name ?? "Đội bóng"} · {team?.institutionName ?? ""} · Pot {pick.seedGroup ?? "—"}</li>; })}</ol><small>Trình diễn demo lưu trên trình duyệt này. Người xem ở thiết bị khác chưa được đồng bộ.</small></section>;
}
