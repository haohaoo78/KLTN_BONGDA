import { useMemo, useState } from "react";
import { useDialog } from "./DialogProvider";
import { Modal } from "./Modal";
import type { DemoFixture, DemoScheduleAvailabilityProfile, DemoScheduleLocation, DemoScheduleResources, DemoScheduleVenue, DemoScheduleEntry, DemoVenueAvailabilityWindow, DemoVenueUnavailablePeriod } from "../utils/drawTestStorage";

type Props = {
  resources: DemoScheduleResources;
  fixtures: DemoFixture[];
  scheduleByFixture: Record<string, DemoScheduleEntry>;
  pitchType: 5 | 7 | 11;
  onChange: (next: DemoScheduleResources) => void;
  selectedVenueIds?: string[];
  onToggleVenue?: (venueId: string) => void;
  activeVenueId?: string | null;
  onViewVenue?: (venueId: string) => void;
  onPersistResources?: (next: DemoScheduleResources) => Promise<boolean>;
  availabilityTemplate?: { weekdays: number[]; windows: DemoVenueAvailabilityWindow[] };
};
type VenueSpec = { name: string; code: string; pitchType: 5 | 7 | 11; active: boolean; turnaroundMinutes: number; central: boolean; preferredStages: string[]; travelZone: string };
type LocationDraft = { name: string; address: string; contactName: string; contactPhone: string; notes: string };
type PeriodDraft = Pick<DemoVenueUnavailablePeriod, "startAt" | "endAt" | "reason">;
type ResourceFormSignature = {
  locationId: string; creatingLocation: boolean; locationDraft: LocationDraft; venueCount: number; venueSpecs: VenueSpec[];
  weekdays: number[]; availableSlots: DemoVenueAvailabilityWindow[]; periods: DemoVenueUnavailablePeriod[];
  periodDraft: PeriodDraft; availabilityConfirmed: boolean;
};

const dayOptions = [{ value: 1, label: "Thứ 2" }, { value: 2, label: "Thứ 3" }, { value: 3, label: "Thứ 4" }, { value: 4, label: "Thứ 5" }, { value: 5, label: "Thứ 6" }, { value: 6, label: "Thứ 7" }, { value: 0, label: "Chủ nhật" }];
const uid = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const blankLocation = (): LocationDraft => ({ name: "", address: "", contactName: "", contactPhone: "", notes: "" });
const slug = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 5) || "SAN";
const clockMinutes = (value: string) => { const [hour, minute] = value.split(":").map(Number); return hour * 60 + minute; };
const clockPosition = (value: string) => Math.max(0, Math.min(100, clockMinutes(value) / (24 * 60) * 100));
const stableSuffix = (value: string) => { let hash = 2166136261; for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619); return (hash >>> 0).toString(36); };

function normalizeResourceCatalog(source: DemoScheduleResources): DemoScheduleResources {
  const locations = [...(source.locations ?? [])];
  const profiles = [...(source.availabilityProfiles ?? [])];
  const venues = source.venues.map((original) => {
    const venue = { ...original, weekdays: [...(original.weekdays ?? [])], availableSlots: original.availableSlots?.map((window) => ({ ...window })), unavailablePeriods: [...(original.unavailablePeriods ?? [])], availabilityConfirmed: original.availabilityConfirmed === true };
    let location = locations.find((item) => item.id === venue.locationId);
    if (!location) {
      location = locations.find((item) => item.address.trim().toLocaleLowerCase("vi") === venue.location.trim().toLocaleLowerCase("vi"));
      if (!location) {
        const address = venue.location.trim();
        location = { id: `legacy-location-${stableSuffix(address || venue.id)}`, name: address || "Địa điểm chưa khai báo", address };
        locations.push(location);
      }
      venue.locationId = location.id;
    }
    const signature = JSON.stringify([venue.weekdays, venue.availableFrom, venue.availableTo, venue.availableSlots, venue.unavailablePeriods, venue.availabilityConfirmed]);
    let profile = profiles.find((item) => item.id === venue.availabilityProfileId);
    if (!profile) {
      profile = profiles.find((item) => JSON.stringify([item.weekdays, item.availableFrom, item.availableTo, item.availableSlots, item.unavailablePeriods, item.availabilityConfirmed]) === signature);
      if (!profile) {
        profile = { id: `legacy-profile-${stableSuffix(signature)}`, name: `Lịch ${location.name}`, weekdays: [...venue.weekdays], availableFrom: venue.availableFrom, availableTo: venue.availableTo, availableSlots: venue.availableSlots?.map((window) => ({ ...window })), unavailablePeriods: [...venue.unavailablePeriods], availabilityConfirmed: venue.availabilityConfirmed };
        profiles.push(profile);
      }
      venue.availabilityProfileId = profile.id;
    }
    return venue;
  });
  return { ...source, locations, availabilityProfiles: profiles, venues };
}
const newPeriod = (): PeriodDraft => ({ startAt: "", endAt: "", reason: "" });
function formSignature(value: ResourceFormSignature) { return JSON.stringify(value); }
const timeWindowsFrom = (venue: DemoScheduleVenue, slots: DemoScheduleResources["slots"]): DemoVenueAvailabilityWindow[] => venue.availableSlots?.length
  ? venue.availableSlots.map((window) => ({ ...window }))
  : venue.availableFrom && venue.availableTo ? [{ id: uid("window"), start: venue.availableFrom, end: venue.availableTo }]
    : slots.map((slot) => ({ id: uid("window"), start: slot.start, end: slot.end }));

function makeVenueSpecs(count: number, prefix: string, existingCount: number, pitchType: 5 | 7 | 11, turnaroundMinutes = 0): VenueSpec[] {
  return Array.from({ length: count }, (_, index) => {
    const number = existingCount + index + 1;
    return { name: `Sân ${number}`, code: `${prefix || "SAN"}-${String(number).padStart(2, "0")}`, pitchType, active: true, turnaroundMinutes, central: false, preferredStages: [], travelZone: "" };
  });
}

export function ScheduleResourceManagerPanel({ resources: rawResources, fixtures, scheduleByFixture, pitchType, onChange, selectedVenueIds, onToggleVenue, activeVenueId, onViewVenue, onPersistResources, availabilityTemplate }: Props) {
  const { confirm } = useDialog();
  const resources = useMemo(() => normalizeResourceCatalog(rawResources), [rawResources]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "LOCKED">("ALL");
  const [pitchFilter, setPitchFilter] = useState<"ALL" | "MATCH" | 5 | 7 | 11>("MATCH");
  const [showForm, setShowForm] = useState(false);
  const [editingVenueId, setEditingVenueId] = useState<string | null>(null);
  const [viewOnly, setViewOnly] = useState(false);
  const [availabilityOnly, setAvailabilityOnly] = useState(false);
  const [locationId, setLocationId] = useState("");
  const [creatingLocation, setCreatingLocation] = useState(false);
  const [locationDraft, setLocationDraft] = useState<LocationDraft>(blankLocation());
  const [venueCount, setVenueCount] = useState(1);
  const [venueSpecs, setVenueSpecs] = useState<VenueSpec[]>(() => makeVenueSpecs(1, "SAN", rawResources.venues.length, pitchType, rawResources.venues[0]?.turnaroundMinutes ?? 0));
  const [weekdays, setWeekdays] = useState<number[]>(resources.allowedWeekdays);
  const [availableSlots, setAvailableSlots] = useState<DemoVenueAvailabilityWindow[]>(() => resources.slots.map((slot) => ({ id: uid("window"), start: slot.start, end: slot.end })));
  const [periods, setPeriods] = useState<DemoVenueUnavailablePeriod[]>([]);
  const [periodDraft, setPeriodDraft] = useState<PeriodDraft>(newPeriod());
  const [availabilityConfirmed, setAvailabilityConfirmed] = useState(false);
  const [formError, setFormError] = useState("");
  const [savingResource, setSavingResource] = useState(false);
  const [initialFormSignature, setInitialFormSignature] = useState("");
  const [locationEdit, setLocationEdit] = useState<DemoScheduleLocation | null>(null);
  const [collapsedLocationIds, setCollapsedLocationIds] = useState<string[]>([]);
  const suggestedTurnaroundMinutes = resources.venues[0]?.turnaroundMinutes ?? 0;

  const scheduledCountByVenue = new Map<string, number>();
  const scheduledFixturesByVenue = new Map<string, DemoFixture[]>();
  for (const fixture of fixtures) {
    const entry = scheduleByFixture[fixture.id];
    if (entry?.scheduledAt && entry.venue) {
      scheduledCountByVenue.set(entry.venue, (scheduledCountByVenue.get(entry.venue) ?? 0) + 1);
      scheduledFixturesByVenue.set(entry.venue, [...(scheduledFixturesByVenue.get(entry.venue) ?? []), fixture]);
    }
  }
  const activeCount = resources.venues.filter((venue) => venue.active).length;
  const lockedCount = resources.venues.filter((venue) => !venue.active).length;
  const formDirty = showForm && initialFormSignature !== formSignature({ locationId, creatingLocation, locationDraft, venueCount, venueSpecs, weekdays, availableSlots, periods, periodDraft, availabilityConfirmed });
  const filteredVenues = resources.venues.filter((venue) => {
    const location = resources.locations?.find((item) => item.id === venue.locationId);
    const statusMatches = statusFilter === "ALL" || (statusFilter === "ACTIVE" && venue.active) || (statusFilter === "LOCKED" && !venue.active);
    const pitchMatches = pitchFilter === "ALL" || pitchFilter === "MATCH" && venue.pitchType === pitchType || typeof pitchFilter === "number" && venue.pitchType === pitchFilter;
    const search = `${venue.name} ${venue.code} ${location?.name ?? venue.location} ${location?.address ?? venue.location}`.toLocaleLowerCase("vi");
    return statusMatches && pitchMatches && search.includes(query.toLocaleLowerCase("vi"));
  });
  const groups = (resources.locations ?? []).map((location) => ({ location, venues: filteredVenues.filter((venue) => venue.locationId === location.id) })).filter((group) => group.venues.length > 0);
  const ungrouped = filteredVenues.filter((venue) => !venue.locationId || !(resources.locations ?? []).some((location) => location.id === venue.locationId));

  function resetForm() {
    setEditingVenueId(null); setAvailabilityOnly(false); setViewOnly(false); setLocationId(""); setCreatingLocation(false); setLocationDraft(blankLocation()); setVenueCount(1);
    const prefix = slug(resources.locations?.[0]?.name ?? "San");
    const specs = makeVenueSpecs(1, prefix, resources.venues.length, pitchType, suggestedTurnaroundMinutes);
    const nextWeekdays = [...(availabilityTemplate?.weekdays.length ? availabilityTemplate.weekdays : resources.allowedWeekdays)];
    const nextSlots = availabilityTemplate?.windows.length
      ? availabilityTemplate.windows.map((window) => ({ ...window, id: uid("window") }))
      : resources.slots.map((slot) => ({ id: uid("window"), start: slot.start, end: slot.end }));
    const nextPeriodDraft = newPeriod();
    setVenueSpecs(specs); setWeekdays(nextWeekdays); setAvailableSlots(nextSlots); setPeriods([]); setPeriodDraft(nextPeriodDraft); setAvailabilityConfirmed(false); setFormError("");
    setInitialFormSignature(formSignature({ locationId: "", creatingLocation: false, locationDraft: blankLocation(), venueCount: 1, venueSpecs: specs, weekdays: nextWeekdays, availableSlots: nextSlots, periods: [], periodDraft: nextPeriodDraft, availabilityConfirmed: false }));
    setShowForm(true);
  }

  function editVenue(venue: DemoScheduleVenue, availability = false, asViewOnly = false) {
    const location = resources.locations?.find((item) => item.id === venue.locationId);
    const nextLocationDraft = location ? { name: location.name, address: location.address, contactName: location.contactName ?? "", contactPhone: location.contactPhone ?? "", notes: location.notes ?? "" } : { ...blankLocation(), name: venue.location, address: venue.location };
    const specs = [{ name: venue.name, code: venue.code, pitchType: venue.pitchType, active: venue.active, turnaroundMinutes: venue.turnaroundMinutes, central: venue.central ?? false, preferredStages: [...(venue.preferredStages ?? [])], travelZone: venue.travelZone ?? "" }];
    const nextWeekdays = [...venue.weekdays]; const nextSlots = timeWindowsFrom(venue, resources.slots); const nextPeriods = [...venue.unavailablePeriods];
    const nextPeriodDraft = newPeriod(); const nextConfirmed = venue.availabilityConfirmed === true;
    setEditingVenueId(venue.id); setAvailabilityOnly(availability); setViewOnly(asViewOnly); setLocationId(venue.locationId ?? ""); setCreatingLocation(false);
    setLocationDraft(nextLocationDraft); setVenueCount(1); setVenueSpecs(specs); setWeekdays(nextWeekdays); setAvailableSlots(nextSlots); setPeriods(nextPeriods); setPeriodDraft(nextPeriodDraft); setAvailabilityConfirmed(nextConfirmed); setFormError("");
    setInitialFormSignature(formSignature({ locationId: venue.locationId ?? "", creatingLocation: false, locationDraft: nextLocationDraft, venueCount: 1, venueSpecs: specs, weekdays: nextWeekdays, availableSlots: nextSlots, periods: nextPeriods, periodDraft: nextPeriodDraft, availabilityConfirmed: nextConfirmed }));
    setShowForm(true);
  }

  function changeCount(value: number) {
    const count = Math.max(1, Math.min(24, value || 1));
    setVenueCount(count);
    const selectedLocationName = resources.locations?.find((location) => location.id === locationId)?.name;
    const codePrefix = slug(selectedLocationName || locationDraft.name || "San");
    setVenueSpecs((current) => Array.from({ length: count }, (_, index) => current[index] ?? makeVenueSpecs(1, codePrefix, resources.venues.length + index, pitchType, suggestedTurnaroundMinutes)[0]));
  }

  function changeAvailability<T extends "weekdays" | "availableFrom" | "availableTo" | "periods">(key: T, value: T extends "weekdays" ? number[] : T extends "periods" ? DemoVenueUnavailablePeriod[] : string) {
    setAvailabilityConfirmed(false);
    if (key === "weekdays") setWeekdays(value as number[]);
    else if (key === "periods") setPeriods(value as DemoVenueUnavailablePeriod[]);
  }

  async function saveForm() {
    setFormError("");
    if (!locationId && !(locationDraft.name.trim() && locationDraft.address.trim())) { setFormError("Chọn địa điểm có sẵn hoặc nhập tên và địa chỉ địa điểm mới."); return; }
    if (venueSpecs.some((venue) => !venue.code.trim() || !venue.name.trim() || ![5, 7, 11].includes(venue.pitchType))) { setFormError("Mỗi sân cần mã, tên và loại sân hợp lệ."); return; }
    const codeList = venueSpecs.map((venue) => venue.code.trim().toLocaleLowerCase());
    if (new Set(codeList).size !== codeList.length || codeList.some((code) => resources.venues.some((venue) => venue.code.trim().toLocaleLowerCase() === code && venue.id !== editingVenueId))) { setFormError("Mã sân bị trùng. Hãy chỉnh lại mã trước khi lưu."); return; }
    if (!weekdays.length || !availableSlots.length || availableSlots.some((window) => !window.start || !window.end || window.start >= window.end) || new Set(availableSlots.map((window) => window.id)).size !== availableSlots.length) { setFormError("Cần chọn ít nhất một thứ và mỗi khung giờ phải có giờ kết thúc sau giờ bắt đầu."); return; }
    if (periods.some((period) => !period.startAt || !period.endAt || period.startAt >= period.endAt)) { setFormError("Mỗi khoảng bảo trì cần thời điểm bắt đầu trước thời điểm kết thúc."); return; }
    const locations = [...(resources.locations ?? [])];
    let chosenLocation = locations.find((item) => item.id === locationId);
    if (!chosenLocation) {
      chosenLocation = { id: uid("location"), name: locationDraft.name.trim(), address: locationDraft.address.trim(), contactName: locationDraft.contactName.trim() || undefined, contactPhone: locationDraft.contactPhone.trim() || undefined, notes: locationDraft.notes.trim() || undefined };
      locations.push(chosenLocation);
    }
    const existingProfileId = resources.venues.find((venue) => venue.id === editingVenueId)?.availabilityProfileId;
    const profileId = editingVenueId && existingProfileId ? uid("availability") : existingProfileId ?? uid("availability");
    const availableFrom = availableSlots.reduce((value, window) => window.start < value ? window.start : value, availableSlots[0].start);
    const availableTo = availableSlots.reduce((value, window) => window.end > value ? window.end : value, availableSlots[0].end);
    const copiedWindows = availableSlots.map((window) => ({ ...window }));
    const profile: DemoScheduleAvailabilityProfile = { id: profileId, name: `Lịch ${chosenLocation.name}`, weekdays: [...weekdays], availableFrom, availableTo, availableSlots: copiedWindows, unavailablePeriods: periods.map((period) => ({ ...period })), availabilityConfirmed };
    const priorProfileId = resources.venues.find((venue) => venue.id === editingVenueId)?.availabilityProfileId;
    const availabilityProfiles = [...(resources.availabilityProfiles ?? []).filter((item) => item.id !== profileId && (item.id !== priorProfileId || resources.venues.some((venue) => venue.id !== editingVenueId && venue.availabilityProfileId === priorProfileId))), profile];
    const baseVenue = venueSpecs[0];
    const nextVenues = [...resources.venues];
    if (editingVenueId) {
      const current = resources.venues.find((venue) => venue.id === editingVenueId);
      if (!current) { setFormError("Sân đã thay đổi ở cửa sổ khác. Tải lại danh sách trước khi sửa."); return; }
      const updated: DemoScheduleVenue = { ...current, ...baseVenue, location: chosenLocation.address, locationId: chosenLocation.id, availabilityProfileId: profileId, weekdays: [...weekdays], availableFrom, availableTo, availableSlots: copiedWindows, unavailablePeriods: periods.map((period) => ({ ...period })), availabilityConfirmed, turnaroundMinutes: baseVenue.turnaroundMinutes, central: baseVenue.central, preferredStages: baseVenue.preferredStages };
      const groupIds = new Set([editingVenueId]);
      for (let index = 0; index < nextVenues.length; index += 1) if (groupIds.has(nextVenues[index].id)) {
        nextVenues[index] = nextVenues[index].id === editingVenueId ? updated : { ...nextVenues[index], availabilityProfileId: profileId, weekdays: [...weekdays], availableFrom, availableTo, availableSlots: copiedWindows.map((window) => ({ ...window })), unavailablePeriods: periods.map((period) => ({ ...period })), availabilityConfirmed };
      }
    } else {
      for (const spec of venueSpecs) nextVenues.push({ id: uid("venue"), ...spec, location: chosenLocation.address, locationId: chosenLocation.id, availabilityProfileId: profileId, weekdays: [...weekdays], availableFrom, availableTo, availableSlots: copiedWindows.map((window) => ({ ...window })), unavailablePeriods: periods.map((period) => ({ ...period })), availabilityConfirmed });
    }
    const nextResources = { ...resources, locations, availabilityProfiles, venues: nextVenues };
    setSavingResource(true);
    try {
      const persisted = onPersistResources ? await onPersistResources(nextResources) : false;
      if (!persisted) {
        setFormError("Chưa lưu được dữ liệu sân lên máy chủ. Hãy thử lại; các thay đổi chưa được xác nhận lưu.");
        return;
      }
      onChange(nextResources);
      setShowForm(false);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Không lưu được dữ liệu sân lên máy chủ.");
    } finally { setSavingResource(false); }
  }

  async function updateLocation(next: DemoScheduleLocation) {
    const current = resources.locations?.find((location) => location.id === next.id);
    if (!current) return;
    const nextResources = { ...resources, locations: (resources.locations ?? []).map((location) => location.id === next.id ? next : location), venues: resources.venues.map((venue) => venue.locationId === next.id ? { ...venue, location: next.address } : venue) };
    setSavingResource(true);
    try {
      const persisted = onPersistResources ? await onPersistResources(nextResources) : false;
      if (!persisted) { setFormError("Địa điểm chưa được lưu. Máy chủ chưa xác nhận thay đổi."); return; }
      onChange(nextResources);
      setLocationEdit(null);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Không lưu được địa điểm.");
    } finally { setSavingResource(false); }
  }

  async function removeVenue(venue: DemoScheduleVenue) {
    const count = scheduledCountByVenue.get(venue.code) ?? scheduledCountByVenue.get(venue.name) ?? 0;
    if (count > 0) { const linked = (scheduledFixturesByVenue.get(venue.code) ?? scheduledFixturesByVenue.get(venue.name) ?? []).map((fixture) => fixture.id).join(", "); setFormError(`Không thể xóa sân vì còn ${count} trận đang liên kết (${linked}). Hãy xử lý các lịch trước; trận và fixture sẽ được giữ nguyên.`); return; }
    if (!await confirm({ title: `Xóa sân ${venue.name}?`, description: "Sân chưa được dùng trong lịch. Địa điểm và các sân còn lại không bị xóa.", confirmLabel: "Xóa sân", danger: true })) return;
    const nextResources = { ...resources, venues: resources.venues.filter((item) => item.id !== venue.id), availabilityProfiles: (resources.availabilityProfiles ?? []).filter((profile) => profile.id !== venue.availabilityProfileId || resources.venues.some((item) => item.id !== venue.id && item.availabilityProfileId === profile.id)) };
    setSavingResource(true);
    try {
      const persisted = onPersistResources ? await onPersistResources(nextResources) : false;
      if (!persisted) { setFormError("Sân chưa được xóa. Máy chủ chưa xác nhận thay đổi."); return; }
      onChange(nextResources);
      setShowForm(false);
    } catch (cause) { setFormError(cause instanceof Error ? cause.message : "Không xóa được sân."); }
    finally { setSavingResource(false); }
  }

  async function toggleActive(venue: DemoScheduleVenue) {
    const fixturesOnVenue = scheduledFixturesByVenue.get(venue.code) ?? scheduledFixturesByVenue.get(venue.name) ?? [];
    if (venue.active && fixturesOnVenue.length) {
      const linked = fixturesOnVenue.map((fixture) => fixture.id).join(", ");
      setFormError(`Chưa thể khóa sân vì còn ${fixturesOnVenue.length} trận đã xếp lịch (${linked}). Hãy xử lý các lịch này trước; hệ thống không tự xóa hoặc chuyển trận.`);
      return;
    }
    const nextResources = { ...resources, venues: resources.venues.map((item) => item.id === venue.id ? { ...item, active: !item.active } : item) };
    setSavingResource(true); setFormError("");
    try {
      const persisted = onPersistResources ? await onPersistResources(nextResources) : false;
      if (!persisted) { setFormError("Không lưu được trạng thái sân lên máy chủ."); return; }
      onChange(nextResources);
      const updated = nextResources.venues.find((item) => item.id === venue.id)!;
      setVenueSpecs([{ name: updated.name, code: updated.code, pitchType: updated.pitchType, active: updated.active, turnaroundMinutes: updated.turnaroundMinutes, central: updated.central ?? false, preferredStages: [...(updated.preferredStages ?? [])], travelZone: updated.travelZone ?? "" }]);
      setViewOnly(true);
    } catch (cause) { setFormError(cause instanceof Error ? cause.message : "Không cập nhật được trạng thái sân."); }
    finally { setSavingResource(false); }
  }

  async function closeVenueForm() {
    if (formDirty && !await confirm({ title: "Bỏ thay đổi chưa lưu?", description: "Các chỉnh sửa trong form này sẽ không được lưu.", confirmLabel: "Bỏ thay đổi", danger: true })) return;
    setShowForm(false); setFormError("");
  }

  function cancelVenueEdit() {
    if (!editingVenueId) { setShowForm(false); return; }
    const venue = resources.venues.find((item) => item.id === editingVenueId);
    if (venue) editVenue(venue, false, true);
  }

  function availabilitySummary(venue: DemoScheduleVenue) {
    const days = venue.weekdays.map((day) => dayOptions.find((option) => option.value === day)?.label).filter(Boolean).join(", ");
    const windows = venue.availableSlots?.length ? venue.availableSlots.map((window) => `${window.start}–${window.end}`).join(", ") : `${venue.availableFrom}–${venue.availableTo}`;
    const range = venue.availabilityStartDate || venue.availabilityEndDate ? `${venue.availabilityStartDate || "Đầu giải"}–${venue.availabilityEndDate || "Cuối giải"}` : "Theo thời gian giải";
    return `${range} · ${days || "Chưa chọn thứ"} · ${windows} · ${venue.unavailablePeriods.length + (venue.dateOverrides?.length ?? 0)} ngoại lệ`;
  }

  function renderVenueRow(venue: DemoScheduleVenue, ungrouped = false) {
    const matchCount = scheduledCountByVenue.get(venue.code) ?? scheduledCountByVenue.get(venue.name) ?? 0;
    return <article className={`schedule-resource-row ${activeVenueId === venue.id ? "is-viewing" : ""}`} key={venue.id} onClick={(event) => { if (event.target instanceof Element && event.target.closest(".schedule-resource-select, button")) return; onViewVenue?.(venue.id); }}>
      {selectedVenueIds && onToggleVenue ? <label className="schedule-resource-select" title={`Chọn ${venue.name}`}><input type="checkbox" checked={selectedVenueIds.includes(venue.id)} onChange={() => onToggleVenue(venue.id)} /></label> : null}
      <span className="schedule-resource-pitch-icon" aria-hidden="true">{ungrouped ? "⚽" : <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="1"/><path d="M12 4v16M3 9h4v6H3m18-6h-4v6h4M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"/></svg>}</span>
      <div className="schedule-resource-row-main"><button type="button" className="schedule-resource-row-open" onClick={(event) => { event.stopPropagation(); onViewVenue?.(venue.id); }} aria-pressed={activeVenueId === venue.id}><strong>{venue.name}</strong><span>{venue.code} · {ungrouped ? "" : "Sân "}{venue.pitchType} người{venue.central ? " · Sân trung tâm" : ""} {venue.pitchType === pitchType ? "· Phù hợp loại bóng" : "· Khác loại bóng"}</span><small>{venue.location}{ungrouped ? "" : ` · ${availabilitySummary(venue)}`}</small></button></div>
      <span className="schedule-resource-match-count">{matchCount} trận</span>
      <span className={`schedule-resource-status ${venue.active ? "is-confirmed" : "is-inactive"}`}>{venue.active ? "Đang sử dụng" : "Đã khóa"}</span>
      <span className={`schedule-resource-availability-status ${venue.availabilityConfirmed ? "is-confirmed" : "is-unconfirmed"}`}>{venue.availabilityConfirmed ? "Giờ đã xác nhận" : "Giờ chưa xác nhận"}</span>
      <button className="button button-secondary schedule-resource-detail-action" type="button" onClick={(event) => { event.stopPropagation(); editVenue(venue, false, true); }}>Xem chi tiết</button>
    </article>;
  }

  return <div className="schedule-resource-manager">
    <header className="schedule-resource-manager-heading"><div><span className="eyebrow">NGUỒN LỰC THI ĐẤU</span><h3>Địa điểm và sân</h3><p>Chọn sân cho giải này; giờ hợp lệ sẽ được tính vào lập lịch sau khi lưu cấu hình.</p></div><button type="button" className="button button-primary" onClick={resetForm}>+ Thêm sân</button></header>
    <div className="schedule-resource-stats"><article><span>Địa điểm</span><b>{(resources.locations ?? []).length}</b></article><article><span>Tổng sân</span><b>{resources.venues.length}</b></article><article><span>Đang sử dụng</span><b>{activeCount}</b></article><article className={lockedCount ? "needs-confirmation" : ""}><span>Đã khóa</span><b>{lockedCount}</b></article></div>
    <div className="schedule-resource-list-toolbar"><label>Tìm sân hoặc địa điểm<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tên sân, mã sân, địa chỉ…" /></label><label>Loại bóng<select value={pitchFilter} onChange={(event) => setPitchFilter(event.target.value === "ALL" || event.target.value === "MATCH" ? event.target.value : Number(event.target.value) as 5 | 7 | 11)}><option value="MATCH">Phù hợp giải · {pitchType} người</option><option value="ALL">Tất cả loại sân</option><option value={5}>5 người</option><option value={7}>7 người</option><option value={11}>11 người</option></select></label><label>Trạng thái<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="ALL">Tất cả trạng thái</option><option value="ACTIVE">Đang sử dụng</option><option value="LOCKED">Đã khóa</option></select></label></div>
    {selectedVenueIds && onToggleVenue ? <div className="schedule-resource-selection-hint"><b>{selectedVenueIds.length} sân được chọn</b><span>Chọn sân bên dưới để áp dụng hàng loạt khung giờ ở cột bên phải. Thay đổi khả dụng sẽ cần xác nhận lại.</span></div> : null}
    <div className="schedule-resource-groups">
      {groups.map(({ location, venues }) => <section className="schedule-resource-group" key={location.id}>
        <header><div><h4>{location.name}</h4><p>{location.address}{location.contactName ? ` · ${location.contactName}` : ""}{location.contactPhone ? ` · ${location.contactPhone}` : ""}</p></div><div><span>{venues.length} sân</span><button type="button" className="text-button" aria-expanded={!collapsedLocationIds.includes(location.id)} onClick={() => setCollapsedLocationIds((current) => current.includes(location.id) ? current.filter((id) => id !== location.id) : [...current, location.id])}>{collapsedLocationIds.includes(location.id) ? "Mở danh sách" : "Thu gọn"}</button><button type="button" className="text-button" onClick={() => setLocationEdit(location)}>Sửa địa điểm</button></div></header>
        {collapsedLocationIds.includes(location.id) ? null : <div className="schedule-resource-rows">{venues.map((venue) => renderVenueRow(venue))}</div>}
      </section>)}
    {ungrouped.length ? <section className="schedule-resource-group"><header><div><h4>Địa điểm chưa phân loại</h4><p>Các sân cũ chưa có liên kết địa điểm có cấu trúc.</p></div><span>{ungrouped.length} sân</span></header><div className="schedule-resource-rows">{ungrouped.map((venue) => renderVenueRow(venue, true))}</div></section> : null}{!filteredVenues.length ? <div className="schedule-resource-empty"><strong>Không có sân phù hợp</strong><span>Thêm nguồn lực hoặc điều chỉnh tìm kiếm/trạng thái.</span></div> : null}
    </div>

    <Modal
      open={showForm}
      title={editingVenueId ? (viewOnly ? "Chi tiết sân" : availabilityOnly ? "Chỉnh lịch khả dụng" : "Chỉnh sửa sân") : "Thêm sân"}
      description={editingVenueId ? "Thông tin sân, trạng thái sử dụng và lịch khả dụng thuộc giải đấu hiện tại." : "Sân mới sẽ thuộc giải hiện tại và bắt đầu ở trạng thái Đang sử dụng."}
      eyebrow="NGUỒN LỰC"
      className="schedule-resource-form-modal"
      onClose={() => void closeVenueForm()}
    >
      <div className="schedule-resource-form schedule-resource-form-modal-body">
        {editingVenueId ? (() => { const venue = resources.venues.find((item) => item.id === editingVenueId); const count = venue ? (scheduledCountByVenue.get(venue.code) ?? scheduledCountByVenue.get(venue.name) ?? 0) : 0; return <div className="schedule-resource-detail-status-strip"><span className={`schedule-resource-status ${venue?.active ? "is-confirmed" : "is-inactive"}`}>{venue?.active ? "Đang sử dụng" : "Đã khóa"}</span><span>{count} trận đang được xếp trên sân này</span></div>; })() : null}
        <fieldset disabled={viewOnly} className="schedule-resource-readonly-fields">
        <section className="schedule-resource-form-section"><header><h4>Thông tin nguồn lực</h4><p>Loại sân mặc định theo giải; có thể chỉnh từng sân trước khi lưu.</p></header>
          <label>Địa điểm
            <select disabled={Boolean(editingVenueId)} value={creatingLocation ? "NEW" : locationId} onChange={(event) => {
              const value = event.target.value;
              setCreatingLocation(value === "NEW");
              setLocationId(value === "NEW" ? "" : value);
              if (value === "NEW") {
                setLocationDraft(blankLocation());
              const selectedLocation = resources.locations?.find((item) => item.id === value);
              if (selectedLocation) setVenueSpecs((current) => current.map((venue, index) => ({ ...venue, code: `${slug(selectedLocation.name)}-${String(resources.venues.length + index + 1).padStart(2, "0")}` })));
              }
            }}>
              <option value="">Chọn địa điểm</option>
              {(resources.locations ?? []).map((location) => <option key={location.id} value={location.id}>{location.name} · {location.address}</option>)}
              {!editingVenueId ? <option value="NEW">+ Thêm địa điểm mới</option> : null}
            </select>
          </label>
          {creatingLocation || (editingVenueId && !locationId) ? <div className="schedule-resource-form-grid">
            <label>Tên địa điểm<input value={locationDraft.name} onChange={(event) => {
              const name = event.target.value;
              setLocationDraft({ ...locationDraft, name });
              if (!editingVenueId) setVenueSpecs((current) => current.map((venue, index) => ({ ...venue, code: `${slug(name)}-${String(resources.venues.length + index + 1).padStart(2, "0")}` })));
            }} /></label>
            <label>Địa chỉ cụ thể<input value={locationDraft.address} onChange={(event) => setLocationDraft({ ...locationDraft, address: event.target.value })} /></label>
            <label>Người liên hệ (không bắt buộc)<input value={locationDraft.contactName} onChange={(event) => setLocationDraft({ ...locationDraft, contactName: event.target.value })} /></label>
            <label>Điện thoại liên hệ<input value={locationDraft.contactPhone} onChange={(event) => setLocationDraft({ ...locationDraft, contactPhone: event.target.value })} /></label>
            <label className="full-span">Ghi chú<input value={locationDraft.notes} onChange={(event) => setLocationDraft({ ...locationDraft, notes: event.target.value })} /></label>
          </div> : null}
          {!editingVenueId ? <label>Số sân sử dụng đồng thời<input type="number" min={1} max={24} value={venueCount} onChange={(event) => changeCount(Number(event.target.value))} /></label> : null}
          <div className="schedule-resource-specs">{venueSpecs.map((venue, index) => <div className="schedule-resource-spec" key={index}><strong>{editingVenueId ? "Thông tin sân" : `Sân ${index + 1}`}</strong><label>Tên sân<input disabled={availabilityOnly} value={venue.name} onChange={(event) => setVenueSpecs((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} /></label><label>Mã sân<input disabled={availabilityOnly} value={venue.code} onChange={(event) => setVenueSpecs((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, code: event.target.value } : item))} /></label><label>Loại sân<select disabled={availabilityOnly} value={venue.pitchType} onChange={(event) => setVenueSpecs((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, pitchType: Number(event.target.value) as 5 | 7 | 11 } : item))}><option value={5}>5 người</option><option value={7}>7 người</option><option value={11}>11 người</option></select></label><label>Chuyển tiếp riêng (phút)<input disabled={availabilityOnly} type="number" min={0} max={1440} value={venue.turnaroundMinutes} onChange={(event) => setVenueSpecs((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, turnaroundMinutes: Number(event.target.value) } : item))} /></label></div>)}</div>
        </section>
        <section className="schedule-resource-form-section"><header><h4>Lịch khả dụng dùng chung</h4><p>Ngày đề xuất từ thời gian giải; BTC cần xác nhận thực tế trước khi sân được dùng trong lựa chọn lập lịch.</p></header>
          <div className="schedule-resource-windows"><header><strong>Khung giờ trong ngày</strong><button type="button" className="button button-secondary" onClick={() => { setAvailableSlots((current) => [...current, { id: uid("window"), start: "", end: "" }]); setAvailabilityConfirmed(false); }}>+ Thêm khung giờ</button></header>{availableSlots.map((window, index) => <div className="schedule-resource-window-row" key={window.id}><span>Khung {index + 1}</span><label>Bắt đầu<input type="time" value={window.start} onChange={(event) => { setAvailableSlots((current) => current.map((item) => item.id === window.id ? { ...item, start: event.target.value } : item)); setAvailabilityConfirmed(false); }} /></label><label>Kết thúc<input type="time" value={window.end} onChange={(event) => { setAvailableSlots((current) => current.map((item) => item.id === window.id ? { ...item, end: event.target.value } : item)); setAvailabilityConfirmed(false); }} /></label><button type="button" className="text-button" aria-label={`Xóa khung ${index + 1}`} onClick={() => { setAvailableSlots((current) => current.filter((item) => item.id !== window.id)); setAvailabilityConfirmed(false); }}>Xóa</button></div>)}</div>
          <div className="schedule-settings-days"><strong>Thứ có thể sử dụng</strong>{dayOptions.map((day) => <label key={day.value}><input type="checkbox" checked={weekdays.includes(day.value)} onChange={() => changeAvailability("weekdays", weekdays.includes(day.value) ? weekdays.filter((item) => item !== day.value) : [...weekdays, day.value].sort((a,b)=>a-b))} />{day.label}</label>)}</div>
          <div className="schedule-resource-week-preview"><div><strong>Xem trước tuần khả dụng</strong><small>{resources.competitionStartDate || "Ngày bắt đầu chưa xác nhận"} – {resources.competitionEndDate || "Ngày kết thúc chưa xác nhận"}</small></div><div className="schedule-resource-week-grid">{dayOptions.map((day) => <div key={day.value} className={`schedule-resource-week-day ${weekdays.includes(day.value) && availableSlots.length ? "is-available" : "is-unavailable"}`}><span>{day.label.replace("Thứ ", "T")}</span><div>{availableSlots.map((window) => { const width = Math.max(0, clockPosition(window.end || "00:00") - clockPosition(window.start || "00:00")); return <i key={window.id} title={`${window.start || "--:--"}–${window.end || "--:--"}`} style={{ left: `${clockPosition(window.start || "00:00")}%`, width: `${width}%` }} />; })}</div></div>)}</div></div>
          <div className="schedule-resource-exception"><strong>Ngoại lệ, nghỉ hoặc bảo trì</strong><div className="schedule-resource-form-grid"><label>Bắt đầu<input type="datetime-local" value={periodDraft.startAt} onChange={(event) => setPeriodDraft({ ...periodDraft, startAt: event.target.value })} /></label><label>Kết thúc<input type="datetime-local" value={periodDraft.endAt} onChange={(event) => setPeriodDraft({ ...periodDraft, endAt: event.target.value })} /></label><label className="full-span">Lý do<input value={periodDraft.reason} onChange={(event) => setPeriodDraft({ ...periodDraft, reason: event.target.value })} placeholder="Bảo trì, không sử dụng…" /></label></div><button type="button" className="button button-secondary" disabled={!periodDraft.startAt || !periodDraft.endAt || periodDraft.startAt >= periodDraft.endAt} onClick={() => { changeAvailability("periods", [...periods, { id: uid("blackout"), ...periodDraft }]); setPeriodDraft(newPeriod()); }}>Thêm ngoại lệ</button>{periods.map((period) => <div className="schedule-resource-period" key={period.id}><span>{new Date(period.startAt).toLocaleString("vi-VN")} – {new Date(period.endAt).toLocaleString("vi-VN")}</span><small>{period.reason}</small><button type="button" className="text-button" onClick={() => changeAvailability("periods", periods.filter((item) => item.id !== period.id))}>Xóa</button></div>)}</div>
          <label className="schedule-resource-confirm"><input type="checkbox" checked={availabilityConfirmed} onChange={(event) => setAvailabilityConfirmed(event.target.checked)} /><span><b>Tôi xác nhận các sân đã chọn có thể sử dụng thực tế theo lịch này.</b><small>Chưa đặt sân, không phát sinh thuê hoặc thanh toán. Bỏ chọn để sân không xuất hiện trong phương án lập lịch.</small></span></label>
        </section>
        {editingVenueId ? (() => { const venue = resources.venues.find((item) => item.id === editingVenueId); if (!venue) return null; const location = resources.locations?.find((item) => item.id === venue.locationId); const count = scheduledCountByVenue.get(venue.code) ?? scheduledCountByVenue.get(venue.name) ?? 0; const fixturesOnVenue = scheduledFixturesByVenue.get(venue.code) ?? scheduledFixturesByVenue.get(venue.name) ?? []; return <section className="schedule-resource-form-section schedule-resource-linked-matches"><header><h4>Thời gian và lịch liên quan</h4><p>Thông tin giới hạn và các quan hệ lịch hiện có của sân.</p></header><dl><div><dt>Địa điểm</dt><dd>{location?.name ?? venue.location} · {location?.address ?? venue.location}</dd></div><div><dt>Ngày sử dụng</dt><dd>{venue.availabilityStartDate || resources.competitionStartDate || "Theo thời gian giải"} – {venue.availabilityEndDate || resources.competitionEndDate || "Theo thời gian giải"}</dd></div><div><dt>Ngày ngoại lệ riêng</dt><dd>{venue.dateOverrides?.length ? venue.dateOverrides.map((override) => `${override.date}${override.unavailable ? " · nghỉ" : ` · ${override.availableSlots.map((window) => `${window.start}–${window.end}`).join(", ")}`}`).join("; ") : "Không có"}</dd></div><div><dt>Trận đã xếp</dt><dd>{count}</dd></div></dl>{fixturesOnVenue.length ? <ul>{fixturesOnVenue.map((fixture) => <li key={fixture.id}>{fixture.id}{fixture.groupName ? ` · ${fixture.groupName}` : ""}{fixture.round ? ` · ${fixture.round}` : ""}</li>)}</ul> : null}</section>; })() : null}
        </fieldset>
        {formError ? <p className="form-error" role="alert">{formError}</p> : null}
        <footer className="schedule-resource-form-footer">
          {viewOnly && editingVenueId ? <>
            <button type="button" className="button button-secondary" disabled={savingResource} onClick={() => setShowForm(false)}>Đóng</button>
            <button type="button" className="button button-danger-secondary" disabled={savingResource} onClick={() => { const venue = resources.venues.find((item) => item.id === editingVenueId); if (venue) void removeVenue(venue); }}>Xóa sân</button>
            <button type="button" className="button button-secondary" disabled={savingResource} onClick={() => { const venue = resources.venues.find((item) => item.id === editingVenueId); if (venue) void toggleActive(venue); }}>{venueSpecs[0]?.active ? "Khóa sân" : "Mở khóa sân"}</button>
            <button type="button" className="button button-primary" onClick={() => { setFormError(""); setViewOnly(false); }}>Chỉnh sửa</button>
          </> : <>
            <button type="button" className="button button-secondary" disabled={savingResource} onClick={editingVenueId ? cancelVenueEdit : () => setShowForm(false)}>Hủy</button>
            <button type="button" className="button button-primary" disabled={savingResource} onClick={() => void saveForm()}>{savingResource ? "Đang lưu…" : editingVenueId ? "Lưu thay đổi" : `Thêm ${venueCount} sân`}</button>
          </>}
        </footer>
      </div>
    </Modal>

    <Modal open={Boolean(locationEdit)} title="Chỉnh sửa địa điểm" description="Thay đổi địa chỉ sẽ được kiểm tra trên mọi lịch đang sử dụng các sân trực thuộc." eyebrow="ĐỊA ĐIỂM" className="schedule-resource-detail-modal" onClose={() => setLocationEdit(null)}>
      {locationEdit ? <div className="schedule-resource-form-grid"><label>Tên địa điểm<input value={locationEdit.name} onChange={(event) => setLocationEdit({ ...locationEdit, name: event.target.value })} /></label><label>Địa chỉ cụ thể<input value={locationEdit.address} onChange={(event) => setLocationEdit({ ...locationEdit, address: event.target.value })} /></label><label>Liên hệ<input value={locationEdit.contactName ?? ""} onChange={(event) => setLocationEdit({ ...locationEdit, contactName: event.target.value })} /></label><label>Số điện thoại<input value={locationEdit.contactPhone ?? ""} onChange={(event) => setLocationEdit({ ...locationEdit, contactPhone: event.target.value })} /></label><label className="full-span">Ghi chú<input value={locationEdit.notes ?? ""} onChange={(event) => setLocationEdit({ ...locationEdit, notes: event.target.value })} /></label>{formError ? <p className="form-error full-span" role="alert">{formError}</p> : null}<footer className="schedule-resource-form-footer"><button className="button button-secondary" type="button" onClick={() => setLocationEdit(null)}>Hủy</button><button className="button button-primary" type="button" disabled={savingResource || !locationEdit.name.trim() || !locationEdit.address.trim()} onClick={() => void updateLocation(locationEdit)}>{savingResource ? "Đang lưu…" : "Cập nhật địa điểm"}</button></footer></div> : null}
    </Modal>
  </div>;
}
