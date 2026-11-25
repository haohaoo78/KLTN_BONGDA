import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useDialog } from "./DialogProvider";
import { ScheduleResourceManagerPanel } from "./ScheduleResourceManagerPanel";
import type { DemoScheduleAvailabilityProfile, DemoScheduleResources, DemoScheduleVenue, DemoVenueAvailabilityWindow, DemoVenueUnavailablePeriod } from "../utils/drawTestStorage";
import "./schedule-setup.css";

type Props = {
  resources: DemoScheduleResources;
  savedResources: DemoScheduleResources;
  pitchType: 5 | 7 | 11;
  fixtures: Parameters<typeof ScheduleResourceManagerPanel>[0]["fixtures"];
  scheduleByFixture: Parameters<typeof ScheduleResourceManagerPanel>[0]["scheduleByFixture"];
  officialStartDate: string;
  officialEndDate: string;
  readOnly: boolean;
  saving: boolean;
  saveNotice: string;
  error: string;
  onChange: Dispatch<SetStateAction<DemoScheduleResources>>;
  onSave: () => void;
  onPersistResources: (resources: DemoScheduleResources) => Promise<boolean>;
};

const days = [{ value: 1, label: "Thứ 2" }, { value: 2, label: "Thứ 3" }, { value: 3, label: "Thứ 4" }, { value: 4, label: "Thứ 5" }, { value: 5, label: "Thứ 6" }, { value: 6, label: "Thứ 7" }, { value: 0, label: "Chủ nhật" }];
const makeId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const inclusiveDays = (start: string, end: string) => start && end && start <= end ? Math.floor((new Date(`${end}T12:00:00Z`).getTime() - new Date(`${start}T12:00:00Z`).getTime()) / 86_400_000) + 1 : 0;
const addDays = (value: string, amount: number) => {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
};
const timeMinutes = (value: string) => { const [hour, minute] = value.split(":").map(Number); return hour * 60 + minute; };
const timeLabel = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString("vi-VN", { weekday: "short", day: "2-digit", month: "2-digit" });
const labelDay = (value: number) => days.find((day) => day.value === value)?.label ?? "";

function weeklyWindows(venue: DemoScheduleVenue, resources: DemoScheduleResources): DemoVenueAvailabilityWindow[] {
  if (venue.availableSlots?.length) return venue.availableSlots.map((slot) => ({ ...slot }));
  if (venue.availableFrom && venue.availableTo) return [{ id: `${venue.id}-legacy`, start: venue.availableFrom, end: venue.availableTo }];
  return resources.slots.map((slot, index) => ({ id: `${venue.id}-common-${index}`, start: slot.start, end: slot.end }));
}

function windowsForDate(venue: DemoScheduleVenue, resources: DemoScheduleResources, date: string): DemoVenueAvailabilityWindow[] {
  if ((venue.availabilityStartDate && date < venue.availabilityStartDate) || (venue.availabilityEndDate && date > venue.availabilityEndDate)) return [];
  if (resources.blockedDates.includes(date)) return [];
  const override = venue.dateOverrides?.find((item) => item.date === date);
  if (override) return override.unavailable ? [] : override.availableSlots;
  return venue.weekdays.includes(new Date(`${date}T12:00:00Z`).getUTCDay()) ? weeklyWindows(venue, resources) : [];
}

function availabilityState(venue: DemoScheduleVenue, resources: DemoScheduleResources, date: string) {
  const windows = windowsForDate(venue, resources, date);
  const override = venue.dateOverrides?.find((item) => item.date === date);
  const dayStart = new Date(`${date}T00:00:00`).getTime();
  const dayEnd = dayStart + 86_400_000;
  const exceptions = venue.unavailablePeriods.filter((period) => {
    const start = new Date(period.startAt).getTime(); const end = new Date(period.endAt).getTime();
    return Number.isFinite(start) && Number.isFinite(end) && start < dayEnd && end > dayStart;
  });
  if (!windows.length || exceptions.some((period) => new Date(period.startAt).getTime() <= dayStart && new Date(period.endAt).getTime() >= dayEnd)) {
    return { kind: "off" as const, windows, label: override?.unavailable || resources.blockedDates.includes(date) ? "Ngày nghỉ" : "Không sử dụng" };
  }
  const label = venue.availabilityConfirmed ? "Đã xác nhận khả dụng" : "Có cấu hình · chưa xác nhận";
  return { kind: venue.availabilityConfirmed ? "confirmed" as const : "unconfirmed" as const, windows, label: exceptions.length ? `${label} · có ngoại lệ` : label };
}

function hoursForVenueDate(venue: DemoScheduleVenue, resources: DemoScheduleResources, date: string) {
  const windows = windowsForDate(venue, resources, date).map((window) => ({ start: timeMinutes(window.start), end: timeMinutes(window.end) })).filter((window) => Number.isFinite(window.start) && window.end > window.start);
  if (!windows.length) return 0;
  const dayStart = new Date(`${date}T00:00:00`).getTime();
  const dayEnd = dayStart + 86_400_000;
  const blackouts = venue.unavailablePeriods.map((period) => ({ start: Math.max(dayStart, new Date(period.startAt).getTime()), end: Math.min(dayEnd, new Date(period.endAt).getTime()) }))
    .filter((period) => Number.isFinite(period.start) && Number.isFinite(period.end) && period.start < period.end)
    .map((period) => ({ start: Math.max(0, (period.start - dayStart) / 60_000), end: Math.min(1440, (period.end - dayStart) / 60_000) }))
    .sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const blackout of blackouts) {
    const last = merged[merged.length - 1];
    if (last && blackout.start <= last.end) last.end = Math.max(last.end, blackout.end);
    else merged.push({ ...blackout });
  }
  return windows.reduce((total, window) => total + Math.max(0, window.end - window.start - merged.reduce((blocked, period) => blocked + Math.max(0, Math.min(window.end, period.end) - Math.max(window.start, period.start)), 0)), 0) / 60;
}

function availabilityTotals(resources: DemoScheduleResources, start: string, end: string) {
  if (!start || !end || start > end) return { hours: 0, days: 0 };
  const availableDates = new Set<string>();
  let hours = 0;
  const first = new Date(`${start}T12:00:00Z`); const last = new Date(`${end}T12:00:00Z`);
  const count = Math.min(730, Math.floor((last.getTime() - first.getTime()) / 86_400_000) + 1);
  for (let offset = 0; offset < count; offset += 1) {
    const date = addDays(start, offset);
    let daily = 0;
    for (const venue of resources.venues) daily += hoursForVenueDate(venue, resources, date);
    hours += daily;
    if (daily > 0) availableDates.add(date);
  }
  return { hours, days: availableDates.size };
}

function boundsFor(venue: DemoScheduleVenue, start: string, end: string) {
  return { start: venue.availabilityStartDate || start, end: venue.availabilityEndDate || end };
}

export function Step5VenueAvailabilityWorkspace({ resources, savedResources, pitchType, fixtures, scheduleByFixture, officialStartDate, officialEndDate, readOnly, saving, saveNotice, error, onChange, onSave, onPersistResources }: Props) {
  const { confirm } = useDialog();
  const [selectedVenueIds, setSelectedVenueIds] = useState<string[]>([]);
  const [activeVenueId, setActiveVenueId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(officialStartDate);
  const [template, setTemplate] = useState("ALL_DAY");
  const [commonStartDate, setCommonStartDate] = useState(officialStartDate);
  const [commonEndDate, setCommonEndDate] = useState(officialEndDate);
  const [commonWeekdays, setCommonWeekdays] = useState<number[]>(() => resources.allowedWeekdays.length ? resources.allowedWeekdays : days.map((item) => item.value));
  const [commonWindows, setCommonWindows] = useState<DemoVenueAvailabilityWindow[]>(() => resources.slots.length
    ? resources.slots.map((slot) => ({ id: makeId("common"), start: slot.start, end: slot.end }))
    : [{ id: makeId("common"), start: "07:00", end: "11:30" }, { id: makeId("common"), start: "13:30", end: "17:30" }]);
  const [newBlockedDate, setNewBlockedDate] = useState("");
  const [commonError, setCommonError] = useState("");
  const [commonNotice, setCommonNotice] = useState("");
  const [copyTargets, setCopyTargets] = useState<string[]>([]);
  const [confirmCopiedAvailability, setConfirmCopiedAvailability] = useState(false);
  const [exceptionStart, setExceptionStart] = useState("");
  const [exceptionEnd, setExceptionEnd] = useState("");
  const [exceptionReason, setExceptionReason] = useState("");
  const [exceptionError, setExceptionError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [calendarOffset, setCalendarOffset] = useState(0);
  const [calendarFilter, setCalendarFilter] = useState<"ALL" | "MATCH" | "CONFIRMED" | "UNCONFIRMED">("ALL");
  const [detailProfileId, setDetailProfileId] = useState("");

  useEffect(() => {
    setSelectedVenueIds((current) => {
      const active = resources.venues.filter((venue) => venue.active && venue.pitchType === pitchType).map((venue) => venue.id);
      return current.filter((id) => active.includes(id));
    });
  }, [resources.venues, pitchType]);

  const activeVenue = resources.venues.find((venue) => venue.id === activeVenueId) ?? null;
  const currentBounds = activeVenue ? boundsFor(activeVenue, officialStartDate, officialEndDate) : null;
  const localDayOverride = activeVenue?.dateOverrides?.find((item) => item.date === selectedDate) ?? null;
  const selectedDateWindows = activeVenue ? windowsForDate(activeVenue, resources, selectedDate) : [];
  const selectedDateStatus = activeVenue ? availabilityState(activeVenue, resources, selectedDate) : null;
  const detailDirty = activeVenue ? JSON.stringify(activeVenue) !== JSON.stringify(savedResources.venues.find((venue) => venue.id === activeVenue.id)) : false;
  const resourcesDirty = JSON.stringify(resources) !== JSON.stringify(savedResources);
  const activeWeekdayLabels = activeVenue?.weekdays.map(labelDay).join(", ") ?? "";

  const firstCalendarDate = useMemo(() => officialStartDate ? addDays(officialStartDate, calendarOffset * 7) : "", [officialStartDate, calendarOffset]);
  const calendarDates = useMemo(() => firstCalendarDate && officialEndDate ? Array.from({ length: 7 }, (_, index) => addDays(firstCalendarDate, index)).filter((date) => date >= officialStartDate && date <= officialEndDate) : [], [firstCalendarDate, officialStartDate, officialEndDate]);
  const visibleVenues = activeVenue ? [activeVenue].filter((venue) => calendarFilter === "ALL"
    || calendarFilter === "MATCH" && venue.pitchType === pitchType
    || calendarFilter === "CONFIRMED" && venue.availabilityConfirmed === true
    || calendarFilter === "UNCONFIRMED" && venue.availabilityConfirmed !== true) : [];
  const chosenVenues = resources.venues.filter((venue) => selectedVenueIds.includes(venue.id));
  const commonHours = commonWindows.reduce((sum, window) => sum + Math.max(0, timeMinutes(window.end) - timeMinutes(window.start)) / 60, 0);
  const commonDays = inclusiveDays(commonStartDate, commonEndDate);
  const summaryAvailability = useMemo(() => availabilityTotals(resources, officialStartDate, officialEndDate), [resources, officialStartDate, officialEndDate]);

  async function openVenue(venueId: string, date?: string) {
    const venue = resources.venues.find((item) => item.id === venueId);
    if (!venue) return;
    if (activeVenue && activeVenue.id !== venueId && detailDirty) {
      const accepted = await confirm({ title: `Thay đổi của ${activeVenue.name} chưa lưu`, description: "Các chỉnh sửa vẫn đang nằm trong bản nháp của giải và chưa ghi lên máy chủ. Chuyển sân để tiếp tục; hãy lưu cấu hình trước khi rời Công đoạn 1.", confirmLabel: "Chuyển sân" });
      if (!accepted) return;
    }
    setActiveVenueId(venue.id);
    setDetailError("");
    const range = boundsFor(venue, officialStartDate, officialEndDate);
    setSelectedDate(date && date >= range.start && date <= range.end ? date : range.start);
    const sharedProfile = Boolean(venue.availabilityProfileId && resources.venues.some((item) => item.id !== venue.id && item.availabilityProfileId === venue.availabilityProfileId));
    setDetailProfileId(sharedProfile || !venue.availabilityProfileId ? makeId("availability") : venue.availabilityProfileId);
    setCopyTargets([]);
  }

  function updateVenue(venueId: string, transform: (venue: DemoScheduleVenue) => DemoScheduleVenue, availabilityChanged = true) {
    onChange((current) => {
      const oldVenue = current.venues.find((item) => item.id === venueId);
      if (!oldVenue) return current;
      const transformed = transform(oldVenue);
      const nextVenue = availabilityChanged ? { ...transformed, availabilityConfirmed: false } : transformed;
      const profileId = detailProfileId || nextVenue.availabilityProfileId || makeId("availability");
      const venueWithProfile = { ...nextVenue, availabilityProfileId: profileId };
      const location = current.locations?.find((item) => item.id === venueWithProfile.locationId);
      const profile: DemoScheduleAvailabilityProfile = {
        id: profileId, name: `Lịch ${location?.name ?? venueWithProfile.name}`, weekdays: [...venueWithProfile.weekdays],
        availableFrom: venueWithProfile.availableFrom, availableTo: venueWithProfile.availableTo,
        availableSlots: venueWithProfile.availableSlots?.map((window) => ({ ...window })),
        unavailablePeriods: venueWithProfile.unavailablePeriods.map((period) => ({ ...period })),
        availabilityConfirmed: venueWithProfile.availabilityConfirmed === true,
      };
      const nextVenues = current.venues.map((item) => item.id === venueId ? venueWithProfile : item);
      const stillUsed = nextVenues.some((item) => item.id !== venueId && item.availabilityProfileId === oldVenue.availabilityProfileId);
      const profiles = [...(current.availabilityProfiles ?? []).filter((item) => item.id !== profileId && (item.id !== oldVenue.availabilityProfileId || stillUsed)), profile];
      return { ...current, venues: nextVenues, availabilityProfiles: profiles };
    });
  }

  function onToggleVenue(venueId: string) {
    setSelectedVenueIds((current) => current.includes(venueId) ? current.filter((id) => id !== venueId) : [...current, venueId]);
  }

  function chooseTemplate(key: string) {
    setTemplate(key);
    setCommonError("");
    if (key === "CUSTOM") return;
    const ranges: Record<string, Array<[string, string]>> = {
      ALL_DAY: [["07:00", "11:30"], ["13:30", "17:30"]], MORNING: [["07:00", "11:30"]],
      AFTERNOON: [["13:30", "17:30"]], EVENING: [["17:00", "21:00"]], WEEKEND: [["07:00", "11:30"], ["13:30", "17:30"]],
    };
    setCommonWindows((ranges[key] ?? []).map(([start, end]) => ({ id: makeId("window"), start, end })));
    if (key === "WEEKEND") setCommonWeekdays([0, 6]);
    else if (template === "WEEKEND") setCommonWeekdays(days.map((day) => day.value));
  }

  async function applyCommonToSelected() {
    setCommonError(""); setCommonNotice("");
    if (!officialStartDate || !officialEndDate) { setCommonError("Giải chưa có thời gian tổ chức hợp lệ; hãy bổ sung tại Bước 1."); return; }
    if (commonStartDate < officialStartDate || commonEndDate > officialEndDate || commonStartDate > commonEndDate) { setCommonError("Khoảng ngày sử dụng phải nằm trong thời gian tổ chức giải."); return; }
    if (!commonWeekdays.length || !commonWindows.length || commonWindows.some((window) => !window.start || !window.end || window.start >= window.end)) { setCommonError("Chọn ít nhất một ngày trong tuần và nhập các khoảng giờ hợp lệ."); return; }
    if (!selectedVenueIds.length) { setCommonError("Tích chọn ít nhất một sân ở cột bên trái để áp dụng cấu hình."); return; }
    if (chosenVenues.some((venue) => venue.dateOverrides?.some((override) => override.date < commonStartDate || override.date > commonEndDate))) { setCommonError("Một sân đang có ngoại lệ theo ngày nằm ngoài khoảng mới. Hãy xử lý ngoại lệ đó trong chi tiết sân trước khi áp dụng."); return; }
    const windows = commonWindows.map((window) => ({ ...window, id: makeId("window") }));
    const availableFrom = windows.reduce((min, window) => window.start < min ? window.start : min, windows[0].start);
    const availableTo = windows.reduce((max, window) => window.end > max ? window.end : max, windows[0].end);
    const profileId = makeId("availability");
    onChange((current) => ({
      ...current,
      allowedWeekdays: [...commonWeekdays],
      availabilityProfiles: [...(current.availabilityProfiles ?? []), { id: profileId, name: "Lịch áp dụng hàng loạt", weekdays: [...commonWeekdays], availableFrom, availableTo, availableSlots: windows, unavailablePeriods: [], availabilityConfirmed: false }],
      venues: current.venues.map((venue) => selectedVenueIds.includes(venue.id) ? {
        ...venue, availabilityStartDate: commonStartDate, availabilityEndDate: commonEndDate,
        weekdays: [...commonWeekdays], availableFrom, availableTo, availableSlots: windows.map((window) => ({ ...window })),
        availabilityProfileId: profileId, availabilityConfirmed: false,
      } : venue),
    }));
    setCommonNotice(`Đã đưa cấu hình vào bản nháp cho ${selectedVenueIds.length} sân; lịch từng sân cần được xác nhận trước khi lập.`);
    setActiveVenueId(null);
  }

  function addCommonWindow() {
    setTemplate("CUSTOM");
    setCommonWindows((current) => [...current, { id: makeId("window"), start: "", end: "" }]);
  }

  function updateCommonWindow(id: string, patch: Partial<DemoVenueAvailabilityWindow>) {
    setCommonWindows((current) => current.map((window) => window.id === id ? { ...window, ...patch } : window));
  }

  function toggleCommonDay(day: number) {
    setCommonWeekdays((current) => current.includes(day) ? current.filter((item) => item !== day) : [...current, day].sort((a, b) => a - b));
  }

  function updateDayOverride(date: string, unavailable: boolean, availableSlots: DemoVenueAvailabilityWindow[]) {
    if (!activeVenue) return;
    updateVenue(activeVenue.id, (venue) => ({ ...venue, dateOverrides: [...(venue.dateOverrides ?? []).filter((item) => item.date !== date), { date, unavailable, availableSlots }].sort((a, b) => a.date.localeCompare(b.date)) }));
  }

  function removeDayOverride(date: string) {
    if (!activeVenue) return;
    updateVenue(activeVenue.id, (venue) => ({ ...venue, dateOverrides: (venue.dateOverrides ?? []).filter((item) => item.date !== date) }));
  }

  function updateDayWindow(id: string, patch: Partial<DemoVenueAvailabilityWindow>) {
    const windows = selectedDateWindows.map((window) => window.id === id ? { ...window, ...patch } : window);
    updateDayOverride(selectedDate, false, windows);
  }

  function addDayWindow() {
    const current = selectedDateWindows.length ? selectedDateWindows : weeklyWindows(activeVenue!, resources);
    const seed = current.length ? current : [{ id: makeId("window"), start: "07:00", end: "11:30" }];
    updateDayOverride(selectedDate, false, [...seed, { id: makeId("window"), start: "", end: "" }]);
  }

  async function applyCopyToSelected() {
    if (!activeVenue || !copyTargets.length) return;
    const copyProfileId = makeId("availability");
    const range = boundsFor(activeVenue, officialStartDate, officialEndDate);
    onChange((current) => {
      const selected = current.venues.find((venue) => venue.id === activeVenue.id);
      if (!selected) return current;
      const location = current.locations?.find((item) => item.id === selected.locationId);
      const copiedWindows = weeklyWindows(selected, current).map((window) => ({ ...window, id: makeId("window") }));
      const from = copiedWindows.reduce((min, window) => window.start < min ? window.start : min, copiedWindows[0]?.start ?? selected.availableFrom);
      const to = copiedWindows.reduce((max, window) => window.end > max ? window.end : max, copiedWindows[0]?.end ?? selected.availableTo);
      const profile: DemoScheduleAvailabilityProfile = { id: copyProfileId, name: `Lịch ${location?.name ?? selected.name}`, weekdays: [...selected.weekdays], availableFrom: from, availableTo: to, availableSlots: copiedWindows, unavailablePeriods: selected.unavailablePeriods.map((period) => ({ ...period })), availabilityConfirmed: confirmCopiedAvailability };
      return { ...current, availabilityProfiles: [...(current.availabilityProfiles ?? []), profile], venues: current.venues.map((venue) => copyTargets.includes(venue.id) ? {
        ...venue, availabilityStartDate: range.start, availabilityEndDate: range.end, weekdays: [...selected.weekdays], availableFrom: from, availableTo: to,
        availableSlots: copiedWindows.map((window) => ({ ...window })), unavailablePeriods: selected.unavailablePeriods.map((period) => ({ ...period })),
        dateOverrides: (selected.dateOverrides ?? []).map((item) => ({ ...item, availableSlots: item.availableSlots.map((window) => ({ ...window, id: makeId("window") })) })),
        availabilityProfileId: copyProfileId, availabilityConfirmed: confirmCopiedAvailability,
      } : venue) };
    });
    setCopyTargets([]); setConfirmCopiedAvailability(false);
  }

  function addException() {
    setExceptionError("");
    if (!activeVenue || !exceptionStart || !exceptionEnd || exceptionStart >= exceptionEnd) { setExceptionError("Chọn khoảng bắt đầu và kết thúc hợp lệ."); return; }
    const nextPeriod: DemoVenueUnavailablePeriod = { id: makeId("exception"), startAt: new Date(exceptionStart).toISOString(), endAt: new Date(exceptionEnd).toISOString(), reason: exceptionReason.trim() || "Ngoại lệ khả dụng" };
    updateVenue(activeVenue.id, (venue) => ({ ...venue, unavailablePeriods: [...venue.unavailablePeriods, nextPeriod] }));
    setExceptionStart(""); setExceptionEnd(""); setExceptionReason("");
  }

  return <div className="step5-venue-availability-workspace">
    <div className="step5-stage1-grid">
      <div className="step5-stage1-venues">
        {!readOnly ? <ScheduleResourceManagerPanel resources={resources} fixtures={fixtures} scheduleByFixture={scheduleByFixture} pitchType={pitchType}
          selectedVenueIds={selectedVenueIds} onToggleVenue={onToggleVenue} activeVenueId={activeVenueId}
          onViewVenue={(venueId) => openVenue(venueId)} onPersistResources={onPersistResources} availabilityTemplate={{ weekdays: commonWeekdays, windows: commonWindows }}
          onChange={onChange} /> : <div className="schedule-resource-manager"><header className="schedule-resource-manager-heading"><div><span className="eyebrow">NGUỒN LỰC THI ĐẤU</span><h3>Địa điểm và sân</h3><p>Danh mục đang ở chế độ chỉ đọc sau khi công bố.</p></div></header>{resources.venues.map((venue) => <button key={venue.id} type="button" className={`schedule-resource-row schedule-resource-readonly-row ${activeVenueId === venue.id ? "is-viewing" : ""}`} onClick={() => openVenue(venue.id)}>{venue.name} · {venue.code}<small>{venue.location} · {venue.pitchType} người</small></button>)}</div>}
      </div>

      <aside className="step5-stage1-availability" aria-label="Cấu hình thời gian sử dụng sân">
        {!activeVenue ? <>
          <header><div><span className="eyebrow">CẤU HÌNH CHUNG</span><h3>Thời gian sử dụng sân</h3><p>Chọn mẫu giờ để điền nhanh, sau đó chỉnh ngày, thứ và ngoại lệ nếu cần.</p></div></header>
          <div className="step5-stage1-date-range"><span>Thời gian tổ chức giải · chỉ đọc</span><b>{officialStartDate ? timeLabel(officialStartDate) : "Chưa có ngày bắt đầu"} – {officialEndDate ? timeLabel(officialEndDate) : "Chưa có ngày kết thúc"}</b><small>Khoảng ngày áp dụng không thể vượt thời gian chính thức của giải.</small></div>
          <div className="step5-stage1-common-range"><label>Ngày bắt đầu sử dụng<input type="date" min={officialStartDate || undefined} max={officialEndDate || undefined} value={commonStartDate} disabled={readOnly} onChange={(event) => setCommonStartDate(event.target.value)} /></label><label>Ngày kết thúc sử dụng<input type="date" min={officialStartDate || undefined} max={officialEndDate || undefined} value={commonEndDate} disabled={readOnly} onChange={(event) => setCommonEndDate(event.target.value)} /></label></div>
          <div className="step5-stage1-template-list" aria-label="Mẫu thời gian">{([ ["ALL_DAY", "Cả ngày"], ["MORNING", "Buổi sáng"], ["AFTERNOON", "Buổi chiều"], ["EVENING", "Buổi tối"], ["WEEKEND", "Cuối tuần"], ["CUSTOM", "Tùy chỉnh"] ] as const).map(([id, label]) => <button key={id} type="button" className={template === id ? "is-selected" : ""} disabled={readOnly} onClick={() => chooseTemplate(id)}>{label}</button>)}</div>
          <div className="step5-stage1-window-list"><div className="step5-stage1-subheading"><b>Khung giờ trong ngày</b><button type="button" className="text-button" disabled={readOnly} onClick={addCommonWindow}>+ Thêm khoảng</button></div>{commonWindows.map((window, index) => <div className="step5-stage1-window" key={window.id}><span>Khoảng {index + 1}</span><label>Từ<input type="time" disabled={readOnly} value={window.start} onChange={(event) => updateCommonWindow(window.id, { start: event.target.value })} /></label><label>Đến<input type="time" disabled={readOnly} value={window.end} onChange={(event) => updateCommonWindow(window.id, { end: event.target.value })} /></label><button type="button" className="text-button" disabled={readOnly} aria-label={`Xóa khoảng ${index + 1}`} onClick={() => setCommonWindows((current) => current.filter((item) => item.id !== window.id))}>Xóa</button></div>)}</div>
          <div className="step5-stage1-days"><b>Ngày trong tuần áp dụng</b><div>{days.map((day) => <label key={day.value}><input type="checkbox" checked={commonWeekdays.includes(day.value)} disabled={readOnly} onChange={() => toggleCommonDay(day.value)} />{day.label}</label>)}</div></div>
          <div className="step5-stage1-exclusions"><b>Ngày nghỉ chung của giải</b><div className="schedule-blocked-date-add"><input aria-label="Ngày nghỉ chung" type="date" min={officialStartDate || undefined} max={officialEndDate || undefined} value={newBlockedDate} disabled={readOnly} onChange={(event) => setNewBlockedDate(event.target.value)} /><button type="button" className="button button-secondary" disabled={readOnly || !newBlockedDate || resources.blockedDates.includes(newBlockedDate)} onClick={() => { onChange((current) => ({ ...current, blockedDates: [...current.blockedDates, newBlockedDate].sort() })); setNewBlockedDate(""); }}>Thêm ngày nghỉ</button></div><div className="schedule-blocked-date-list">{resources.blockedDates.map((date) => <span key={date}>{timeLabel(date)}<button type="button" disabled={readOnly} aria-label={`Bỏ ngày nghỉ ${date}`} onClick={() => onChange((current) => ({ ...current, blockedDates: current.blockedDates.filter((item) => item !== date) }))}>×</button></span>)}{!resources.blockedDates.length ? <small>Chưa có ngày nghỉ toàn giải.</small> : null}</div></div>
          <div className="step5-stage1-apply-summary"><b>{selectedVenueIds.length ? `Áp dụng cho ${selectedVenueIds.length} sân đã chọn` : "Chọn sân để áp dụng cấu hình"}</b><span>{chosenVenues.length ? chosenVenues.map((venue) => venue.name).join(" · ") : "Tích chọn các sân ở cột trái."}</span><small>{commonDays} ngày trong phạm vi · {Math.round(commonHours * commonDays * commonWeekdays.length / 7 * 10) / 10} giờ sân dự kiến</small></div>
          {commonError ? <p className="form-error" role="alert">{commonError}</p> : null}{commonNotice ? <p className="form-help" role="status">{commonNotice}</p> : null}
          <button type="button" className="button button-primary step5-stage1-apply" disabled={readOnly || !selectedVenueIds.length} onClick={() => void applyCommonToSelected()}>Áp dụng cho các sân đã chọn</button>
          {resourcesDirty && !readOnly ? <button type="button" className="button button-secondary" disabled={saving} onClick={onSave}>{saving ? "Đang lưu…" : "Lưu cấu hình sân"}</button> : null}
        </> : <>
          <header className="step5-stage1-detail-header"><div><span className="eyebrow">CHI TIẾT SÂN</span><h3>{activeVenue.name}</h3><p>{activeVenue.code} · Sân {activeVenue.pitchType} người · {activeVenue.location}</p></div><div className={`step5-stage1-detail-status ${activeVenue.availabilityConfirmed ? "is-confirmed" : "is-unconfirmed"}`}>{activeVenue.availabilityConfirmed ? "Đã xác nhận khả dụng" : "Cần xác nhận lại"}</div></header>
          <button type="button" className="text-button step5-stage1-back-common" onClick={() => setActiveVenueId(null)}>← Cấu hình chung</button>
          <div className="step5-stage1-date-range"><span>Thời gian tổ chức giải · chỉ đọc</span><b>{officialStartDate} – {officialEndDate}</b><small>Ngày sử dụng riêng của sân phải nằm trong khoảng trên.</small></div>
          {currentBounds ? <div className="step5-stage1-common-range"><label>Ngày bắt đầu sử dụng<input type="date" min={officialStartDate || undefined} max={officialEndDate || undefined} value={currentBounds.start} disabled={readOnly} onChange={(event) => { const value = event.target.value; if (value < officialStartDate || value > currentBounds.end || value > officialEndDate) return; if (activeVenue.dateOverrides?.some((item) => item.date < value)) { setDetailError("Hãy xử lý ngoại lệ nằm trước ngày bắt đầu mới trước khi thu hẹp khoảng sử dụng."); return; } updateVenue(activeVenue.id, (venue) => ({ ...venue, availabilityStartDate: value })); if (selectedDate < value) setSelectedDate(value); }} /></label><label>Ngày kết thúc sử dụng<input type="date" min={officialStartDate || undefined} max={officialEndDate || undefined} value={currentBounds.end} disabled={readOnly} onChange={(event) => { const value = event.target.value; if (value > officialEndDate || value < currentBounds.start || value < officialStartDate) return; if (activeVenue.dateOverrides?.some((item) => item.date > value)) { setDetailError("Hãy xử lý ngoại lệ nằm sau ngày kết thúc mới trước khi thu hẹp khoảng sử dụng."); return; } updateVenue(activeVenue.id, (venue) => ({ ...venue, availabilityEndDate: value })); if (selectedDate > value) setSelectedDate(value); }} /></label></div> : null}{detailError ? <p className="form-error" role="alert">{detailError}</p> : null}
          <section className="step5-stage1-day-editor"><header><div><h4>{selectedDate ? timeLabel(selectedDate) : "Chọn ngày"}</h4><p>{selectedDateStatus?.label} · {localDayOverride ? "Cấu hình riêng cho ngày này" : `Theo lịch lặp: ${activeWeekdayLabels || "chưa chọn thứ"}`}</p></div><label>Ngày đang xem<input type="date" min={currentBounds?.start || officialStartDate || undefined} max={currentBounds?.end || officialEndDate || undefined} value={selectedDate} disabled={readOnly} onChange={(event) => setSelectedDate(event.target.value)} /></label></header>
            <div className="step5-stage1-day-windows">{selectedDateWindows.map((window, index) => <div className="step5-stage1-window" key={window.id}><span>Khung {index + 1}</span><label>Từ<input type="time" value={window.start} disabled={readOnly} onChange={(event) => updateDayWindow(window.id, { start: event.target.value })} /></label><label>Đến<input type="time" value={window.end} disabled={readOnly} onChange={(event) => updateDayWindow(window.id, { end: event.target.value })} /></label><button type="button" className="text-button" disabled={readOnly || selectedDateWindows.length <= 1} onClick={() => updateDayOverride(selectedDate, false, selectedDateWindows.filter((item) => item.id !== window.id))}>Xóa</button></div>)}{!selectedDateWindows.length ? <div className="step5-stage1-day-empty">Ngày này hiện không có giờ sử dụng. Thêm khung giờ riêng hoặc đánh dấu ngày nghỉ.</div> : null}
              <button type="button" className="button button-secondary" disabled={readOnly} onClick={addDayWindow}>+ Thêm khung giờ cho riêng ngày này</button>
            </div>
            <div className="step5-stage1-day-actions"><button type="button" className="button button-secondary" disabled={readOnly || !localDayOverride} onClick={() => removeDayOverride(selectedDate)}>Dùng lại lịch hàng tuần</button><button type="button" className="button button-secondary" disabled={readOnly} onClick={() => updateDayOverride(selectedDate, true, [])}>{localDayOverride?.unavailable ? "Đã đánh dấu ngày nghỉ" : "Đánh dấu ngày nghỉ"}</button></div>
          </section>
          <section className="step5-stage1-subsection"><h4>Lịch lặp hàng tuần</h4><p>Chỉnh lịch lặp sẽ áp dụng cho các ngày không có ngoại lệ riêng.</p><div className="step5-stage1-days">{days.map((day) => <label key={day.value}><input type="checkbox" checked={activeVenue.weekdays.includes(day.value)} disabled={readOnly} onChange={() => updateVenue(activeVenue.id, (venue) => ({ ...venue, weekdays: venue.weekdays.includes(day.value) ? venue.weekdays.filter((item) => item !== day.value) : [...venue.weekdays, day.value].sort((a, b) => a - b) }))} />{day.label}</label>)}</div></section>
          <section className="step5-stage1-subsection"><h4>Ngoại lệ và bảo trì</h4><div className="step5-stage1-exception-form"><label>Bắt đầu<input type="datetime-local" value={exceptionStart} disabled={readOnly} onChange={(event) => setExceptionStart(event.target.value)} /></label><label>Kết thúc<input type="datetime-local" value={exceptionEnd} disabled={readOnly} onChange={(event) => setExceptionEnd(event.target.value)} /></label><label>Lý do<input value={exceptionReason} disabled={readOnly} onChange={(event) => setExceptionReason(event.target.value)} placeholder="Bảo trì, sự kiện riêng…" /></label><button type="button" className="button button-secondary" disabled={readOnly || !exceptionStart || !exceptionEnd} onClick={addException}>Thêm ngoại lệ</button></div>{exceptionError ? <p className="form-error" role="alert">{exceptionError}</p> : null}<div className="schedule-resource-period-list">{activeVenue.unavailablePeriods.map((period) => <div className="schedule-resource-period" key={period.id}><span>{new Date(period.startAt).toLocaleString("vi-VN")} – {new Date(period.endAt).toLocaleString("vi-VN")}</span><small>{period.reason}</small><button type="button" className="text-button" disabled={readOnly} onClick={() => updateVenue(activeVenue.id, (venue) => ({ ...venue, unavailablePeriods: venue.unavailablePeriods.filter((item) => item.id !== period.id) }))}>Xóa</button></div>)}{!activeVenue.unavailablePeriods.length ? <small>Chưa có ngoại lệ.</small> : null}</div></section>
          <label className="schedule-resource-confirm step5-stage1-confirm"><input type="checkbox" checked={activeVenue.availabilityConfirmed === true} disabled={readOnly} onChange={(event) => updateVenue(activeVenue.id, (venue) => ({ ...venue, availabilityConfirmed: event.target.checked }), false)} /><span><b>Tôi xác nhận lịch sử dụng thực tế của sân này.</b><small>Thay đổi giờ hoặc ngày sẽ yêu cầu xác nhận lại.</small></span></label>
          <section className="step5-stage1-copy"><header><div><h4>Áp dụng cấu hình sang sân khác</h4><p>Chọn chính xác các sân nhận. Giờ theo ngày, khoảng ngày, ngoại lệ và lịch lặp sẽ được sao chép.</p></div></header><div className="step5-stage1-copy-targets">{resources.venues.filter((venue) => venue.id !== activeVenue.id).map((venue) => <label key={venue.id}><input type="checkbox" disabled={readOnly} checked={copyTargets.includes(venue.id)} onChange={() => setCopyTargets((current) => current.includes(venue.id) ? current.filter((id) => id !== venue.id) : [...current, venue.id])} />{venue.name} · {venue.location}</label>)}</div><label className="schedule-resource-inline-check"><input type="checkbox" checked={confirmCopiedAvailability} disabled={readOnly} onChange={(event) => setConfirmCopiedAvailability(event.target.checked)} /> Tôi đã xác nhận lịch này phù hợp với các sân được chọn</label><button type="button" className="button button-secondary" disabled={readOnly || !copyTargets.length} onClick={() => void applyCopyToSelected()}>Áp dụng cho {copyTargets.length} sân đã chọn</button></section>
          {resourcesDirty ? <div className="step5-stage1-unsaved"><span>{detailDirty ? "Có thay đổi sân chưa lưu lên máy chủ." : "Có thay đổi khả dụng chưa lưu trong bản nháp của giải."}</span><button type="button" className="button button-primary" disabled={readOnly || saving} onClick={onSave}>{saving ? "Đang lưu…" : "Lưu cấu hình sân"}</button></div> : <p className="step5-stage1-saved" role="status">Cấu hình sân đã lưu.</p>}
        </>}
      </aside>
    </div>

    <section className="step5-stage1-calendar" aria-label="Lịch khả dụng theo ngày">
      <header><div><span className="eyebrow">LỊCH KHẢ DỤNG</span><h3>{activeVenue ? `Lịch của ${activeVenue.name}` : "Sân theo ngày"}</h3><p>{activeVenue ? "Bấm vào ô ngày để chỉnh đúng lịch khả dụng ở cột bên phải." : "Chọn một sân để xem lịch khả dụng."}</p></div><div className="step5-stage1-calendar-controls">{activeVenue ? <label>Lọc trạng thái<select value={calendarFilter} onChange={(event) => setCalendarFilter(event.target.value as typeof calendarFilter)}><option value="ALL">Mọi trạng thái</option><option value="MATCH">Phù hợp loại bóng · {pitchType} người</option><option value="CONFIRMED">Đã xác nhận</option><option value="UNCONFIRMED">Chưa xác nhận</option></select></label> : null}<button type="button" className="button button-secondary" disabled={calendarOffset <= 0} onClick={() => setCalendarOffset((current) => Math.max(0, current - 1))}>← Tuần trước</button><span>{calendarDates.length ? `${timeLabel(calendarDates[0])} – ${timeLabel(calendarDates[calendarDates.length - 1])}` : "Không có ngày trong phạm vi"}</span><button type="button" className="button button-secondary" disabled={!calendarDates.length || addDays(calendarDates[calendarDates.length - 1], 1) > officialEndDate} onClick={() => setCalendarOffset((current) => current + 1)}>Tuần sau →</button></div></header>
      <div className="step5-stage1-calendar-scroll">{!activeVenue ? <div className="step5-stage1-day-empty">Chọn một sân để xem lịch khả dụng.</div> : !visibleVenues.length ? <div className="step5-stage1-day-empty">Sân đang chọn không khớp bộ lọc.</div> : <table><thead><tr><th>Sân / địa điểm</th>{calendarDates.map((date) => <th key={date}>{timeLabel(date)}</th>)}</tr></thead><tbody>{visibleVenues.map((venue) => <tr key={venue.id}><th><button type="button" onClick={() => openVenue(venue.id)} aria-pressed={activeVenueId === venue.id}>{venue.name}<small>{venue.location}</small></button></th>{calendarDates.map((date) => { const state = availabilityState(venue, resources, date); return <td key={date}><button type="button" className={`step5-stage1-calendar-cell is-${state.kind} ${activeVenueId === venue.id && selectedDate === date ? "is-selected" : ""}`} title={`${venue.name} · ${date} · ${state.label}`} onClick={() => openVenue(venue.id, date)}><strong>{state.kind === "off" ? "—" : state.kind === "confirmed" ? "✓" : "!"} {state.kind === "off" ? state.label : state.windows.map((window) => `${window.start}–${window.end}`).join(" · ")}</strong><small>{state.label}</small></button></td>; })}</tr>)}</tbody></table>}</div>
      <footer className="step5-stage1-calendar-legend"><span><i className="is-confirmed" />Đã xác nhận khả dụng</span><span><i className="is-unconfirmed" />Có cấu hình nhưng chưa xác nhận</span><span><i className="is-off" />Không sử dụng / ngày nghỉ</span></footer>
    </section>

    <div className="step5-stage1-summary"><article><span>Sân được chọn</span><b>{selectedVenueIds.length}</b></article><article><span>Địa điểm</span><b>{new Set(chosenVenues.map((venue) => venue.locationId ?? venue.location)).size}</b></article><article><span>Ngày có giờ sử dụng</span><b>{summaryAvailability.days}</b></article><article><span>Tổng thời gian ước tính</span><b>{Math.round(summaryAvailability.hours * 10) / 10} giờ sân</b></article></div>
    {error ? <p className="form-error" role="alert">{error}</p> : null}{saveNotice ? <p className="step5-setup-save-notice" role="status">{saveNotice}</p> : null}
  </div>;
}
