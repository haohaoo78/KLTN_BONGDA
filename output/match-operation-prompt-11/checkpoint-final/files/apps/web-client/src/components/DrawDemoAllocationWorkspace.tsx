import { useEffect, useMemo, useRef, useState } from "react";
import type { DrawCandidate, DrawPlanInput, DrawPreview, DrawVersion, LiveDrawScheduleInput, LiveDrawSession } from "../api/competition";
import { useDialog } from "./DialogProvider";

type AllocationMethod = "DIRECT" | "RANDOM" | "MANUAL";
type AllocationDraft = {
  method: AllocationMethod;
  slots: Array<string | null>;
  status: "DRAFT" | "PUBLISHED";
  directStatus?: "WAITING" | "SCHEDULED" | "POSTPONED" | "LIVE" | "PAUSED" | "COMPLETED" | "CANCELLED";
  directOrder?: string[];
  directEventName?: string;
  directScheduledAt?: string;
  directTimeZone?: string;
  directAnnouncement?: string;
  directLocation?: string;
  directHistory?: Array<{ at: string; type: string; detail: string }>;
  updatedAt: string;
};
type AllocationControl = { lock: "NONE" | "DIRECT_SCHEDULED" | "DIRECT_STARTED" | "OFFICIAL"; officialMethod?: AllocationMethod; lockedAt?: string };
type OfficialDrawConfiguration = {
  format: "ROUND_ROBIN" | "KNOCKOUT" | "GROUP_AND_KNOCKOUT";
  teamIds: string[];
  groupCount: number;
  teamsPerGroup: number[];
  roundRobinLegs: 1 | 2;
  qualifiersPerGroup: number;
  extraQualificationSlots: number;
  knockoutPairing: "GROUP_RANK" | "REDRAW" | "FIXED_CROSSOVER";
  thirdPlaceMatch: boolean;
  seededTeamIds: string[];
  separateSameInstitution: boolean;
  sameInstitutionPolicy: "NONE" | "PREFER_SEPARATE" | "REQUIRE_SEPARATE";
  byePolicy: "AUTOMATIC" | "SEEDED_FIRST";
  method: AllocationMethod | null;
  rulesPublished: boolean;
};

type Props = {
  tournamentId: string;
  configuration: OfficialDrawConfiguration;
  teams: DrawCandidate[];
  history: DrawVersion[];
  latestVersion: DrawVersion | null;
  liveSession: LiveDrawSession | null;
  canEdit: boolean;
  onPreview: (plan: DrawPlanInput) => Promise<DrawPreview>;
  onSaveDraft: (plan: DrawPlanInput) => Promise<DrawVersion>;
  onConfirm: (method: DrawVersion["method"]) => Promise<DrawVersion>;
  onPublish: (method: DrawVersion["method"]) => Promise<DrawVersion>;
  onStartLiveDraw: (plan: DrawPlanInput, schedule: LiveDrawScheduleInput) => Promise<LiveDrawSession>;
  onStartScheduledLiveDraw: () => Promise<LiveDrawSession>;
  onUpdateLiveSchedule: (status: "SCHEDULED" | "POSTPONED" | "CANCELLED", schedule?: LiveDrawScheduleInput, reason?: string) => Promise<LiveDrawSession>;
  onAdvanceLiveDraw: (expectedSequence: number, requestKey: string) => Promise<{ session: LiveDrawSession; draw: DrawVersion | null }>;
  onControlLiveDraw: (status: "PAUSED" | "LIVE") => Promise<LiveDrawSession>;
  onContinue: () => void;
  onNotice: (message: string) => void;
};

function seededShuffle<T>(items: T[], seedText: string): T[] {
  const result = [...items];
  let seed = 2166136261;
  for (const character of seedText) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619) >>> 0;
  for (let index = result.length - 1; index > 0; index -= 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const target = seed % (index + 1);
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function groupName(index: number): string {
  let value = index + 1;
  let label = "";
  while (value) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return `Bảng ${label}`;
}

function knockoutSeedSlotIndexes(seedCount: number, bracketSize: number): number[] {
  if (seedCount < 1) return [];
  let order = [1, 2];
  while (order.length < bracketSize) {
    const nextSize = order.length * 2;
    order = order.flatMap((seed) => [seed, nextSize + 1 - seed]);
  }
  return Array.from({ length: seedCount }, (_, index) => order.indexOf(index + 1));
}

function bracketByeIndexes(tournamentId: string, teamIds: string[], bracketSize: number, byePolicy: "AUTOMATIC" | "SEEDED_FIRST", seededIds: string[]): Set<number> {
  const teamCount = teamIds.length;
  const byeCount = Math.max(0, bracketSize - teamCount);
  if (byeCount === 0) return new Set();
  const allIndexes = Array.from({ length: bracketSize }, (_, index) => index);
  const seedSlots = knockoutSeedSlotIndexes(seededIds.length, bracketSize);
  const seeded = new Set(seedSlots);
  const openIndexes = allIndexes.filter((index) => !seeded.has(index));
  if (byePolicy === "SEEDED_FIRST" && seedSlots.length) {
    const paired = seedSlots.map((index) => index % 2 === 0 ? index + 1 : index - 1).filter((index) => openIndexes.includes(index));
    const remaining = openIndexes.filter((index) => !paired.includes(index));
    return new Set([...paired, ...remaining].slice(0, byeCount));
  }
  if (byePolicy === "SEEDED_FIRST") return new Set(allIndexes.slice(0, byeCount));
  return new Set(seededShuffle(openIndexes, `${tournamentId}:${[...teamIds].sort().join(":")}`).slice(0, byeCount));
}

function zonedInputToIso(date: string, time: string, timeZone: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let instant = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(instant));
    const values = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
    instant += target - Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute);
  }
  return new Date(instant).toISOString();
}

export function DrawDemoAllocationWorkspace({ tournamentId, configuration, teams, history: savedHistory, latestVersion, liveSession, canEdit, onPreview, onSaveDraft: persistDraft, onConfirm, onPublish, onStartLiveDraw, onStartScheduledLiveDraw, onUpdateLiveSchedule, onAdvanceLiveDraw, onControlLiveDraw, onContinue, onNotice }: Props) {
  const { confirm, prompt } = useDialog();
  const selectedTeams = useMemo(() => teams.filter((team) => configuration.teamIds.includes(team.teamId)), [teams, configuration.teamIds]);
  const [draft, setDraft] = useState<AllocationDraft | null>(null);
  const [method, setMethod] = useState<AllocationMethod | null>(configuration.method);
  const [control, setControl] = useState<AllocationControl>({ lock: "NONE" });
  const [seededTeamIds, setSeededTeamIds] = useState(configuration.seededTeamIds);
  const [seeded, setSeeded] = useState(configuration.seededTeamIds.length > 0);
  const [seedSearch, setSeedSearch] = useState("");
  const separateSameInstitution = configuration.separateSameInstitution;
  const institutionLimit = configuration.separateSameInstitution ? 1 : Math.max(1, ...configuration.teamsPerGroup);
  const byePolicy = configuration.byePolicy;
  const thirdPlaceMatch = configuration.thirdPlaceMatch;
  const knockoutPairing = configuration.knockoutPairing;
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [institution, setInstitution] = useState("");
  const [validation, setValidation] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [history, setHistory] = useState<Array<Array<string | null>>>([]);
  const [directEventName, setDirectEventName] = useState("Lễ bốc thăm giải đấu");
  const [directDate, setDirectDate] = useState(() => new Date().toLocaleDateString("en-CA"));
  const [directTime, setDirectTime] = useState(() => new Date(Date.now() + 15 * 60_000).toTimeString().slice(0, 5));
  const [directTimeZone, setDirectTimeZone] = useState("Asia/Ho_Chi_Minh");
  const [directAnnouncement, setDirectAnnouncement] = useState("");
  const [directLocation, setDirectLocation] = useState("");
  const [clock, setClock] = useState(Date.now());
  const [drawing, setDrawing] = useState(false);
  const [working, setWorking] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [boardZoom, setBoardZoom] = useState(100);
  const boardViewportRef = useRef<HTMLDivElement>(null);
  const animationTimerRef = useRef<number | null>(null);
  const groups = configuration.format === "KNOCKOUT" ? 1 : configuration.groupCount;
  const capacities = useMemo(() => configuration.format === "KNOCKOUT"
    ? [2 ** Math.ceil(Math.log2(Math.max(2, selectedTeams.length)))]
    : configuration.teamsPerGroup, [configuration.format, configuration.teamsPerGroup, selectedTeams.length]);
  const slots = useMemo(() => capacities.flatMap((capacity, groupIndex) => Array.from({ length: capacity }, (_, position) => ({
    index: capacities.slice(0, groupIndex).reduce((sum, size) => sum + size, 0) + position,
    groupIndex,
    position,
    groupName: configuration.format === "KNOCKOUT" ? "Nhánh loại trực tiếp" : groupName(groupIndex),
    key: `${groupIndex}:${position}`,
  }))), [capacities, configuration.format]);
  const byeIndexes = useMemo(() => {
    if (configuration.format !== "KNOCKOUT") return new Set<number>();
    return bracketByeIndexes(tournamentId, selectedTeams.map((team) => team.teamId), capacities[0], byePolicy, seeded ? seededTeamIds : []);
  }, [capacities, selectedTeams.length, configuration.format, byePolicy, seeded, seededTeamIds]);

  function seedSlotEntries(ids: string[]) {
    if (configuration.format === "ROUND_ROBIN" || ids.length === 0) return [] as Array<{ teamId: string; slotIndex: number }>;
    if (configuration.format === "GROUP_AND_KNOCKOUT") {
      return ids.flatMap((teamId, groupIndex) => {
        const slot = slots.find((item) => item.groupIndex === groupIndex && item.position === 0);
        return slot ? [{ teamId, slotIndex: slot.index }] : [];
      });
    }
    const positions = knockoutSeedSlotIndexes(ids.length, capacities[0]);
    const nextByes = bracketByeIndexes(tournamentId, selectedTeams.map((team) => team.teamId), capacities[0], byePolicy, ids);
    return ids.flatMap((teamId, index) => {
      const slot = slots.find((item) => item.groupIndex === 0 && item.position === positions[index] && !nextByes.has(item.index));
      return slot ? [{ teamId, slotIndex: slot.index }] : [];
    });
  }

  function updateSeedSelection(nextIds: string[]) {
    if (!draft || alreadyPublished) return;
    const maximum = configuration.format === "GROUP_AND_KNOCKOUT" ? groups : Math.max(0, selectedTeams.length - 1);
    const acceptedIds = nextIds.slice(0, maximum);
    const nextSlots = [...draft.slots];
    const previousSeeds = new Set(seededTeamIds);
    for (let index = 0; index < nextSlots.length; index += 1) {
      if (nextSlots[index] && previousSeeds.has(nextSlots[index]!)) nextSlots[index] = null;
    }
    const seedEntries = seedSlotEntries(acceptedIds);
    const protectedSlots = new Set(seedEntries.map((entry) => entry.slotIndex));
    const nextByes = configuration.format === "KNOCKOUT"
      ? bracketByeIndexes(tournamentId, selectedTeams.map((team) => team.teamId), capacities[0], byePolicy, acceptedIds)
      : new Set<number>();
    for (const entry of seedEntries) {
      const oldIndex = nextSlots.indexOf(entry.teamId);
      if (oldIndex >= 0 && oldIndex !== entry.slotIndex) nextSlots[oldIndex] = null;
      const displaced = nextSlots[entry.slotIndex];
      if (displaced && displaced !== entry.teamId) {
        const freeSlot = slots.find((slot) => !protectedSlots.has(slot.index) && !nextByes.has(slot.index) && nextSlots[slot.index] === null);
        if (!freeSlot) {
          setValidation(["Không còn vị trí trống để giữ nguyên các đội đã phân bổ khi đổi đội hạt giống."]);
          return;
        }
        nextSlots[freeSlot.index] = displaced;
      }
      nextSlots[entry.slotIndex] = entry.teamId;
    }
    setSeeded(true);
    setSeededTeamIds(acceptedIds);
    if (acceptedIds.length !== nextIds.length) setMessage(`Thể thức này cho phép chọn tối đa ${maximum} đội hạt giống.`);
    else setMessage(configuration.format === "GROUP_AND_KNOCKOUT"
      ? `Đã tự xếp ${acceptedIds.length} đội hạt giống vào A1, B1…; các đội còn lại vẫn giữ vị trí trống.`
      : `Đã tự xếp ${acceptedIds.length} đội hạt giống vào các vị trí phù hợp trên cây đấu.`);
    setValidation([]);
    saveCurrentDraft({ ...draft, slots: nextSlots, updatedAt: new Date().toISOString() });
  }

  function toggleSeedUse(enabled: boolean) {
    setSeeded(enabled);
    if (!enabled) {
      setSeededTeamIds([]);
      setMessage("Đã tắt đội hạt giống. Các đội đã phân bổ vẫn giữ nguyên vị trí hiện tại.");
      setValidation([]);
    } else {
      setMessage(configuration.format === "GROUP_AND_KNOCKOUT"
        ? `Chọn đúng ${groups} đội; mỗi đội sẽ tự xếp vào vị trí đầu một bảng.`
        : "Chọn một hoặc nhiều đội để tự xếp vào các vị trí phù hợp trên cây đấu.");
    }
  }

  useEffect(() => {
    setSeededTeamIds(configuration.seededTeamIds);
    setSelectedTeamId(null);
    setValidation([]);
    setMessage("");
    const saved = latestVersion ?? null;
    const savedSeedIds = Array.isArray(saved?.config.seededTeamIds)
      ? saved.config.seededTeamIds.filter((teamId): teamId is string => typeof teamId === "string")
      : configuration.seededTeamIds;
    const nextSeedIds = liveSession?.seededTeamIds ?? savedSeedIds;
    const nextSeeded = configuration.format !== "ROUND_ROBIN" && nextSeedIds.length > 0;
    const initialByeIndexes = configuration.format === "KNOCKOUT"
      ? bracketByeIndexes(tournamentId, selectedTeams.map((team) => team.teamId), capacities[0], byePolicy, nextSeeded ? nextSeedIds : [])
      : new Set<number>();
    setSeededTeamIds(nextSeedIds);
    setSeeded(nextSeeded);
    const nextMethod: AllocationMethod | null = liveSession ? "DIRECT" : saved ? saved.method === "MANUAL" ? "MANUAL" : "RANDOM" : configuration.method;
    const nextSlots = Array<string | null>(slots.length).fill(null);
    if (nextSeeded) {
      const preassigned = configuration.format === "GROUP_AND_KNOCKOUT"
        ? nextSeedIds.map((teamId, groupIndex) => ({ teamId, groupIndex, position: 0 }))
        : nextSeedIds.map((teamId, index) => ({ teamId, groupIndex: 0, position: knockoutSeedSlotIndexes(nextSeedIds.length, capacities[0])[index] }));
      for (const seed of preassigned) {
        const target = slots.find((slot) => slot.groupIndex === seed.groupIndex && slot.position === seed.position);
        if (target && !initialByeIndexes.has(target.index)) nextSlots[target.index] = seed.teamId;
      }
    }
    const sourceAssignments = liveSession
      ? liveSession.picks.map((pick) => ({ groupIndex: pick.groupIndex, position: pick.position, teamId: pick.teamId }))
      : saved?.groups.flatMap((group, groupIndex) => group.assignments.map((assignment) => ({ groupIndex, position: assignment.position, teamId: assignment.teamId }))) ?? [];
    for (const assignment of sourceAssignments) {
      const target = slots.find((slot) => slot.groupIndex === assignment.groupIndex && slot.position + 1 === assignment.position);
      if (target) nextSlots[target.index] = assignment.teamId;
    }
    const savedStatus = saved?.status === "PUBLISHED" || liveSession?.status === "FINALIZED" ? "PUBLISHED" : "DRAFT";
    const directStatus: AllocationDraft["directStatus"] = liveSession?.status === "FINALIZED" || liveSession?.status === "COMPLETED"
      ? "COMPLETED"
      : liveSession?.status as AllocationDraft["directStatus"];
    setMethod(nextMethod);
    setDraft({ method: nextMethod ?? "RANDOM", slots: nextSlots, status: savedStatus, directStatus, directOrder: liveSession?.picks.slice().sort((a, b) => a.sequence - b.sequence).map((pick) => pick.teamId), directEventName: liveSession?.eventName, directScheduledAt: liveSession?.scheduledAt, directTimeZone: liveSession?.timeZone, directAnnouncement: liveSession?.announcement, directLocation: liveSession?.location, directHistory: liveSession?.history.map((event) => ({ at: event.at, type: event.type, detail: event.detail })), updatedAt: saved?.publishedAt ?? saved?.createdAt ?? liveSession?.createdAt ?? new Date().toISOString() });
    const officialLock = saved?.status === "PUBLISHED" || liveSession?.status === "FINALIZED";
    const scheduledLock = Boolean(liveSession && ["SCHEDULED", "POSTPONED"].includes(liveSession.status));
    const startedLock = Boolean(liveSession && ["LIVE", "PAUSED", "COMPLETED"].includes(liveSession.status));
    setControl({ lock: officialLock ? "OFFICIAL" : scheduledLock ? "DIRECT_SCHEDULED" : startedLock ? "DIRECT_STARTED" : "NONE", officialMethod: liveSession?.status === "FINALIZED" ? "DIRECT" : saved?.method === "SEEDED" ? "RANDOM" : saved?.method, lockedAt: saved?.publishedAt ?? liveSession?.createdAt });
    if (liveSession) {
      setDirectEventName(liveSession.eventName);
      setDirectTimeZone(liveSession.timeZone);
      setDirectAnnouncement(liveSession.announcement);
      setDirectLocation(liveSession.location ?? "");
      const scheduled = new Date(liveSession.scheduledAt);
      setDirectDate(new Intl.DateTimeFormat("en-CA", { timeZone: liveSession.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(scheduled));
      setDirectTime(new Intl.DateTimeFormat("en-GB", { timeZone: liveSession.timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(scheduled));
    }
  }, [tournamentId, latestVersion?.id, latestVersion?.status, latestVersion?.publishedAt, liveSession?.sessionId, liveSession?.status, liveSession?.revealedCount, liveSession?.seededTeamIds?.join(":"), slots.length, configuration.method, configuration.seededTeamIds.join(":"), configuration.format, capacities]);

  useEffect(() => {
    if (draft?.directStatus !== "SCHEDULED") return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [draft?.directStatus]);


  useEffect(() => () => { if (animationTimerRef.current !== null) window.clearTimeout(animationTimerRef.current); }, []);

  function continueToFixtures() { onContinue(); }

  const assigned = draft?.slots.filter((teamId): teamId is string => Boolean(teamId)) ?? [];
  const assignedSet = new Set(assigned);
  const unassignedTeams = selectedTeams.filter((team) => !assignedSet.has(team.teamId));
  const institutions = [...new Set(selectedTeams.map((team) => team.institutionName).filter((value): value is string => Boolean(value)))].sort();
  const teamPoolTeams = method === "DIRECT" ? unassignedTeams : selectedTeams;
  const visibleTeams = teamPoolTeams.filter((team) => (!institution || team.institutionName === institution)
    && (!search.trim() || `${team.name} ${team.shortName ?? ""} ${team.teamId}`.toLocaleLowerCase("vi").includes(search.trim().toLocaleLowerCase("vi"))));
  const alreadyPublished = draft?.status === "PUBLISHED";

  function chooseMethod(next: AllocationMethod) {
    if (!draft || !canEdit || control.lock === "OFFICIAL" || control.lock === "DIRECT_STARTED" || (control.lock === "DIRECT_SCHEDULED" && next !== "DIRECT")) return;
    setMethod(next);
    const apiMethod = next === "MANUAL" ? "MANUAL" : "RANDOM";
    const saved = savedHistory.find((item) => (item.method === apiMethod || (apiMethod === "RANDOM" && item.method === "SEEDED")) && ["DRAFT", "CONFIRMED", "PUBLISHED"].includes(item.status));
    if (saved) {
      const storedSeeds = Array.isArray(saved.config.seededTeamIds)
        ? saved.config.seededTeamIds.filter((teamId): teamId is string => typeof teamId === "string")
        : [];
      setSeededTeamIds(storedSeeds);
      setSeeded(storedSeeds.length > 0);
      setDraft(versionToDraft(saved));
    } else {
      const nextSlots = Array<string | null>(slots.length).fill(null);
      if (seeded) for (const entry of seedSlotEntries(seededTeamIds)) nextSlots[entry.slotIndex] = entry.teamId;
      setDraft({ method: next, slots: nextSlots, status: "DRAFT", updatedAt: new Date().toISOString() });
    }
    setSelectedTeamId(null); setValidation([]); setMessage("");
  }

  function versionToDraft(version: DrawVersion): AllocationDraft {
    const values = Array<string | null>(slots.length).fill(null);
    version.groups.forEach((group, groupIndex) => group.assignments.forEach((assignment) => {
      const slot = slots.find((item) => item.groupIndex === groupIndex && item.position + 1 === assignment.position);
      if (slot) values[slot.index] = assignment.teamId;
    }));
    return { method: version.method === "MANUAL" ? "MANUAL" : "RANDOM", slots: values, status: version.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT", updatedAt: version.publishedAt ?? version.createdAt };
  }

  function planFor(slotValues: Array<string | null>, allocationMethod: AllocationMethod, includeAssignments: boolean): DrawPlanInput {
    const apiMethod = allocationMethod === "MANUAL" ? "MANUAL" : "RANDOM";
    const plan: DrawPlanInput = {
      method: apiMethod,
      groupCount: groups,
      teamsPerGroup: capacities,
      ...(configuration.format === "GROUP_AND_KNOCKOUT" ? { maxTeamsPerGroup: Math.max(...capacities) } : configuration.format === "KNOCKOUT" ? { maxTeamsPerGroup: capacities[0] } : {}),
      noSameInstitution: separateSameInstitution,
      ...(seeded && seededTeamIds.length ? { seededTeamIds } : {}),
    };
    if (includeAssignments || allocationMethod === "MANUAL") {
      plan.groups = capacities.map((_, groupIndex) => {
        const groupSlots = slots.filter((slot) => slot.groupIndex === groupIndex && slotValues[slot.index]);
        return { name: groupName(groupIndex), teamIds: groupSlots.map((slot) => slotValues[slot.index] as string), positions: groupSlots.map((slot) => slot.position + 1) };
      });
    }
    return plan;
  }

  function saveCurrentDraft(next: AllocationDraft) {
    setDraft(next);
  }

  function setDrawLock(next: AllocationControl) {
    setControl(next);
  }

  function groupTeamIds(slotValues: Array<string | null>) {
    return capacities.map((_, groupIndex) => slots.filter((slot) => slot.groupIndex === groupIndex).map((slot) => slotValues[slot.index]).filter((teamId): teamId is string => Boolean(teamId)));
  }

  function validate(slotValues: Array<string | null>, requireComplete: boolean): string[] {
    const issues: string[] = [];
    const teamIds = slotValues.filter((teamId): teamId is string => Boolean(teamId));
    const duplicates = [...new Set(teamIds.filter((teamId, index) => teamIds.indexOf(teamId) !== index))];
    if (duplicates.length) issues.push(`Có ${duplicates.length} đội bị phân bổ trùng.`);
    const unknown = teamIds.filter((teamId) => !configuration.teamIds.includes(teamId));
    if (unknown.length) issues.push("Có đội không thuộc danh sách hợp lệ của giải.");
    if (requireComplete) {
      const missing = configuration.teamIds.filter((teamId) => !teamIds.includes(teamId));
      if (missing.length) issues.push(`Còn ${missing.length} đội chưa được phân bổ.`);
    }
    if (seeded) {
      if (configuration.format === "GROUP_AND_KNOCKOUT" && seededTeamIds.length !== groups) issues.push(`Chọn đúng ${groups} đội hạt giống, mỗi bảng một đội.`);
      if (configuration.format === "KNOCKOUT" && seededTeamIds.length < 1) issues.push("Chọn ít nhất một đội hạt giống hoặc tắt tùy chọn này.");
      for (const entry of seedSlotEntries(seededTeamIds)) {
        if (slotValues[entry.slotIndex] !== entry.teamId) issues.push("Vị trí của đội hạt giống phải được giữ nguyên.");
      }
    }
    if (configuration.format === "KNOCKOUT") {
      for (const index of byeIndexes) if (slotValues[index]) issues.push(`Vị trí P${index + 1} đã dành cho BYE.`);
      if (requireComplete && teamIds.length !== selectedTeams.length) issues.push(`Cây đấu cần đủ ${selectedTeams.length} đội và ${capacities[0] - selectedTeams.length} vị trí BYE.`);
      return [...new Set(issues)];
    }
    const byId = new Map(selectedTeams.map((team) => [team.teamId, team]));
    groupTeamIds(slotValues).forEach((groupIds, index) => {
      if (groupIds.length > capacities[index]) issues.push(`${groupName(index)} vượt sức chứa ${capacities[index]}.`);
      if (separateSameInstitution) {
        const schools = groupIds.map((id) => byId.get(id)?.institutionId).filter((id): id is string => Boolean(id));
        if (schools.some((schoolId) => schools.filter((candidate) => candidate === schoolId).length > institutionLimit)) issues.push(`${groupName(index)} vượt giới hạn ${institutionLimit} đội cùng trường.`);
      }
    });
    if (requireComplete && configuration.teamIds.length !== teamIds.length) issues.push("Số đội phân bổ không khớp số đội được chọn.");
    if (configuration.format === "GROUP_AND_KNOCKOUT" && configuration.qualifiersPerGroup * groups + configuration.extraQualificationSlots > configuration.teamIds.length) issues.push("Tổng suất đi tiếp vượt số đội đã chọn.");
    return [...new Set(issues)];
  }

  function commitSlots(next: Array<string | null>) {
    if (!draft || alreadyPublished) return;
    setHistory((current) => [...current.slice(-19), draft.slots]);
    saveCurrentDraft({ ...draft, slots: next, updatedAt: new Date().toISOString() });
    setValidation([]);
    setMessage("");
  }

  function canPut(slotIndex: number, teamId: string): string | null {
    if (byeIndexes.has(slotIndex)) return "Vị trí này dành cho BYE.";
    const slot = slots[slotIndex];
    if (!slot || !draft) return "Vị trí không hợp lệ.";
    if (seeded) {
      const fixedSeed = seedSlotEntries(seededTeamIds).find((entry) => entry.slotIndex === slotIndex);
      if (fixedSeed && fixedSeed.teamId !== teamId) return "Vị trí này đã được giữ cho đội hạt giống.";
      const currentSeedSlot = seedSlotEntries(seededTeamIds).find((entry) => entry.teamId === teamId);
      if (currentSeedSlot && currentSeedSlot.slotIndex !== slotIndex) return "Đội hạt giống phải giữ nguyên vị trí đã được gán.";
    }
    const currentIndex = draft.slots.indexOf(teamId);
    const replacingId = draft.slots[slotIndex];
    const next = [...draft.slots];
    if (currentIndex >= 0) next[currentIndex] = replacingId;
    next[slotIndex] = teamId;
    const issues = validate(next, false);
    return issues[0] ?? null;
  }

  function placeAt(slotIndex: number) {
    if (!draft || !selectedTeamId || alreadyPublished) return;
    placeTeamAt(slotIndex, selectedTeamId);
  }

  function placeTeamAt(slotIndex: number, teamId: string) {
    if (!draft || alreadyPublished) return;
    const reason = canPut(slotIndex, teamId);
    if (reason) { setValidation([reason]); return; }
    const next = [...draft.slots];
    const oldIndex = next.indexOf(teamId);
    const replacingId = next[slotIndex];
    if (oldIndex >= 0) next[oldIndex] = replacingId;
    next[slotIndex] = teamId;
    commitSlots(next);
    setSelectedTeamId(null);
  }

  function removeFromSlot(slotIndex: number) {
    if (!draft || alreadyPublished || !draft.slots[slotIndex]) return;
    if (seeded && seededTeamIds.includes(draft.slots[slotIndex]!)) return;
    const next = [...draft.slots];
    next[slotIndex] = null;
    commitSlots(next);
  }

  async function randomize() {
    if (!draft || method !== "RANDOM" || alreadyPublished || !canEdit || !configuration.rulesPublished || feasibilityIssues.length > 0) return;
    setWorking(true);
    setValidation([]);
    setMessage("Đang tạo phương án trên dịch vụ bốc thăm của giải đấu…");
    try {
      const result = await onPreview(planFor(Array(slots.length).fill(null), "RANDOM", false));
      const next = Array<string | null>(slots.length).fill(null);
      result.groups.forEach((group, groupIndex) => group.assignments.forEach((assignment) => {
        const target = slots.find((slot) => slot.groupIndex === groupIndex && slot.position + 1 === assignment.position);
        if (target) next[target.index] = assignment.teamId;
      }));
      setHistory((current) => [...current.slice(-19), draft.slots]);
      setDraft({ ...draft, method: "RANDOM", slots: next, status: "DRAFT", updatedAt: new Date().toISOString() });
      setMethod("RANDOM");
      setMessage("Đã tạo phương án theo điều lệ và đội đủ điều kiện. Lưu bản nháp để giữ phương án sau khi tải lại.");
    } catch (error) {
      setValidation([error instanceof Error ? error.message : "Dịch vụ không tạo được phương án chia."]);
      setMessage("Không tạo được phương án. Dữ liệu đã lưu vẫn được giữ nguyên.");
    } finally {
      setWorking(false);
    }
  }

  function schedulePayload(): LiveDrawScheduleInput {
    return { eventName: directEventName.trim(), scheduledAt: zonedInputToIso(directDate, directTime, directTimeZone), timeZone: directTimeZone, announcement: directAnnouncement, location: directLocation.trim() };
  }

  async function publishDirectSchedule() {
    if (!draft || alreadyPublished || !canEdit || (control.lock !== "NONE" && control.lock !== "DIRECT_SCHEDULED") || feasibilityIssues.length > 0 || !configuration.rulesPublished || !directEventName.trim()) return;
    if (new Date(zonedInputToIso(directDate, directTime, directTimeZone)).getTime() <= Date.now()) { setValidation(["Lịch bốc thăm phải được đặt ở thời điểm tương lai."]); return; }
    if (!await confirm({ title: control.lock === "DIRECT_SCHEDULED" ? "Cập nhật lịch bốc thăm?" : "Công bố lịch bốc thăm trực tiếp?", description: "Lịch và phiên bốc thăm được lưu trong hệ thống giải đấu. Khi đã công bố lịch, các phương thức khác tạm khóa cho đến khi hủy lịch hợp lệ.", confirmLabel: control.lock === "DIRECT_SCHEDULED" ? "Cập nhật lịch" : "Công bố lịch" })) return;
    setWorking(true);
    try {
      const schedule = schedulePayload();
      const session = liveSession && ["SCHEDULED", "POSTPONED"].includes(liveSession.status)
        ? await onUpdateLiveSchedule("SCHEDULED", schedule)
        : await onStartLiveDraw(planFor(Array(slots.length).fill(null), "DIRECT", false), schedule);
      setMethod("DIRECT");
      const nextSeedIds = session.seededTeamIds ?? seededTeamIds;
      setSeededTeamIds(nextSeedIds);
      setSeeded(nextSeedIds.length > 0);
      const nextSlots: Array<string | null> = Array(slots.length).fill(null);
      for (const entry of seedSlotEntries(nextSeedIds)) nextSlots[entry.slotIndex] = entry.teamId;
      setDraft({ method: "DIRECT", slots: nextSlots, status: "DRAFT", directStatus: session.status === "FINALIZED" || session.status === "COMPLETED" ? "COMPLETED" : session.status, directEventName: session.eventName, directScheduledAt: session.scheduledAt, directTimeZone: session.timeZone, directAnnouncement: session.announcement, directLocation: session.location, directHistory: session.history.map((event) => ({ at: event.at, type: event.type, detail: event.detail })), updatedAt: new Date().toISOString() });
      setDrawLock({ lock: "DIRECT_SCHEDULED", lockedAt: session.createdAt });
      setValidation([]);
      setMessage("Đã lưu lịch bốc thăm vào hệ thống. Những phương thức khác sẽ khóa đến khi phiên được hủy hợp lệ.");
      setEditingSchedule(false);
      onNotice("Đã công bố lịch bốc thăm trực tiếp trên hệ thống giải đấu.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không thể lưu lịch bốc thăm.");
      setValidation([error instanceof Error ? error.message : "Không thể lưu lịch bốc thăm."]);
    } finally { setWorking(false); }
  }

  async function cancelDirectSchedule() {
    if (!draft || draft.directStatus !== "SCHEDULED" || (draft.directOrder?.length ?? 0) > 0 || !liveSession) return;
    const reason = await prompt({ title: "Lý do hủy lịch bốc thăm", description: "Chỉ được hủy trước khi bắt đầu và trước khi có lượt bốc nào. Lý do sẽ được lưu trong lịch sử phiên.", label: "Lý do hủy", placeholder: "Nhập lý do…", confirmLabel: "Tiếp tục hủy", danger: true });
    if (!reason || !await confirm({ title: "Xác nhận hủy lịch?", description: `Lịch bốc thăm sẽ bị hủy và mở lại các phương thức khác. Lý do: ${reason}`, confirmLabel: "Hủy lịch", danger: true })) return;
    setWorking(true);
    try {
      const session = await onUpdateLiveSchedule("CANCELLED", undefined, reason);
      saveCurrentDraft({ ...draft, directStatus: "CANCELLED", directHistory: session.history.map((event) => ({ at: event.at, type: event.type, detail: event.detail })), updatedAt: new Date().toISOString() });
      setDrawLock({ lock: "NONE" });
      setMessage("Đã hủy lịch bốc thăm trên hệ thống. Có thể chọn lại phương thức.");
    } catch (error) { setValidation([error instanceof Error ? error.message : "Không thể hủy lịch bốc thăm."]); }
    finally { setWorking(false); }
  }

  async function beginDirectSimulation() {
    if (!draft || alreadyPublished || !liveSession || !["SCHEDULED", "POSTPONED"].includes(liveSession.status) || new Date(liveSession.scheduledAt).getTime() > clock) return;
    setWorking(true);
    try {
      const session = await onStartScheduledLiveDraw();
      saveCurrentDraft({ ...draft, directStatus: "LIVE", directHistory: session.history.map((event) => ({ at: event.at, type: event.type, detail: event.detail })), updatedAt: new Date().toISOString() });
      setDrawLock({ lock: "DIRECT_STARTED", lockedAt: session.createdAt });
      setMessage("BTC đã bắt đầu phiên bốc thăm. Mỗi lượt sẽ được lưu vào hệ thống.");
    } catch (error) { setValidation([error instanceof Error ? error.message : "Không thể bắt đầu phiên bốc thăm."]); }
    finally { setWorking(false); }
  }

  async function revealDirectSimulation() {
    if (!draft || alreadyPublished || draft.directStatus !== "LIVE" || !liveSession) return;
    setWorking(true);
    try {
      const result = await onAdvanceLiveDraw(liveSession.revealedCount, crypto.randomUUID());
      const nextSlots = Array<string | null>(slots.length).fill(null);
      for (const entry of seedSlotEntries(liveSession.seededTeamIds ?? seededTeamIds)) nextSlots[entry.slotIndex] = entry.teamId;
      result.session.picks.forEach((pick) => {
        const target = slots.find((slot) => slot.groupIndex === pick.groupIndex && slot.position + 1 === pick.position);
        if (target) nextSlots[target.index] = pick.teamId;
      });
      const isComplete = Boolean(result.draw);
      setDraft({ ...draft, slots: result.draw ? versionToDraft(result.draw).slots : nextSlots, directStatus: isComplete ? "COMPLETED" : result.session.status === "FINALIZED" ? "COMPLETED" : "LIVE", directOrder: result.session.picks.slice().sort((a, b) => a.sequence - b.sequence).map((pick) => pick.teamId), directHistory: result.session.history.map((event) => ({ at: event.at, type: event.type, detail: event.detail })), status: isComplete ? "PUBLISHED" : "DRAFT", updatedAt: new Date().toISOString() });
      setValidation([]);
      setMessage(isComplete ? "Phiên bốc thăm hoàn tất và kết quả đã được công bố chính thức." : `Đã lưu lượt bốc ${result.session.revealedCount} / ${result.session.totalPicks}.`);
      if (result.draw) {
        setDrawLock({ lock: "OFFICIAL", officialMethod: "DIRECT", lockedAt: result.draw.publishedAt ?? undefined });
        onNotice("Bốc thăm trực tiếp đã được công bố chính thức. Bước 4 đã được mở.");
      }
    } catch (error) {
      setValidation([error instanceof Error ? error.message : "Không thể ghi nhận lượt bốc."]);
      setMessage("Lượt bốc chưa được ghi nhận; kết quả trên hệ thống được giữ nguyên.");
    } finally { setWorking(false); }
  }

  function revealDirectWithAnimation() {
    if (drawing || working || draft?.directStatus !== "LIVE") return;
    setDrawing(true);
    animationTimerRef.current = window.setTimeout(() => {
      animationTimerRef.current = null;
      void revealDirectSimulation();
      setDrawing(false);
    }, 1100);
  }

  async function toggleBoardFullscreen() {
    const element = boardViewportRef.current;
    if (!element) return;
    if (document.fullscreenElement === element) await document.exitFullscreen();
    else await element.requestFullscreen?.();
  }

  async function setDirectSimulationStatus(status: "LIVE" | "PAUSED") {
    if (!draft || alreadyPublished || !liveSession) return;
    setWorking(true);
    try {
      const session = await onControlLiveDraw(status);
      saveCurrentDraft({ ...draft, directStatus: status, directHistory: session.history.map((event) => ({ at: event.at, type: event.type, detail: event.detail })), updatedAt: new Date().toISOString() });
      setMessage(status === "PAUSED" ? "Phiên bốc thăm đã tạm dừng." : "Phiên bốc thăm đã tiếp tục.");
    } catch (error) { setValidation([error instanceof Error ? error.message : "Không thể cập nhật trạng thái phiên."]); }
    finally { setWorking(false); }
  }

  async function validateCurrent() {
    if (!method || !draft || assigned.length !== selectedTeams.length) {
      setValidation([`Cần phân bổ đủ ${selectedTeams.length} đội trước khi kiểm tra.`]);
      return;
    }
    setWorking(true);
    setValidation([]);
    try {
      await onPreview(planFor(draft.slots, method, true));
      setMessage("Phân bổ hợp lệ theo điều lệ, roster và các ràng buộc của hệ thống.");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Phân bổ không hợp lệ theo điều lệ của giải.";
      setValidation([detail]);
      setMessage("Phân bổ chưa đạt điều kiện nghiệp vụ.");
    } finally { setWorking(false); }
  }

  async function saveDraft() {
    if (!method || !draft || alreadyPublished || control.lock !== "NONE" || !canEdit) return;
    const issues = validate(draft.slots, true);
    if (issues.length) { setValidation(issues); setMessage("Chưa thể lưu: hãy sửa các lỗi phân bổ trước."); return; }
    setWorking(true);
    setValidation([]);
    try {
      const plan = planFor(draft.slots, method, true);
      const saved = await persistDraft(plan);
      setDraft({ ...versionToDraft(saved), updatedAt: saved.createdAt });
      setMessage(`Đã lưu bản nháp phiên bản ${saved.version} vào database của giải.`);
      onNotice(`Đã lưu bản nháp chia bảng phiên bản ${saved.version}.`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Không lưu được bản nháp vào hệ thống.";
      setValidation([detail]);
      setMessage(`Không lưu được bản nháp: ${detail}`);
    } finally { setWorking(false); }
  }

  function reopenDraft() {
    if (!method) return;
    const apiMethod = method === "MANUAL" ? "MANUAL" : "RANDOM";
    const saved = savedHistory.find((item) => (item.method === apiMethod || (apiMethod === "RANDOM" && item.method === "SEEDED")) && ["DRAFT", "CONFIRMED", "PUBLISHED"].includes(item.status));
    if (!saved) { setMessage("Không có bản nháp đã lưu cho phương thức này."); return; }
    const savedSeeds = Array.isArray(saved.config.seededTeamIds) ? saved.config.seededTeamIds.filter((teamId): teamId is string => typeof teamId === "string") : [];
    setSeededTeamIds(savedSeeds);
    setSeeded(savedSeeds.length > 0);
    setDraft(versionToDraft(saved));
    setValidation([]);
    setMessage(`Đã tải lại bản nháp phiên bản ${saved.version} từ database.`);
  }

  async function cancelDraft() {
    if (!await confirm({ title: "Hủy các thay đổi chưa lưu?", description: "Các thay đổi trên màn hình sẽ được bỏ. Bản nháp đã lưu trong database không bị xóa.", confirmLabel: "Hủy thay đổi", danger: true })) return;
    if (control.lock !== "NONE") return;
    const apiMethod = method === "MANUAL" ? "MANUAL" : "RANDOM";
    const saved = savedHistory.find((item) => (item.method === apiMethod || (apiMethod === "RANDOM" && item.method === "SEEDED")) && ["DRAFT", "CONFIRMED"].includes(item.status));
    setDraft(saved ? versionToDraft(saved) : { method: method ?? "RANDOM", slots: Array(slots.length).fill(null), status: "DRAFT", updatedAt: new Date().toISOString() });
    setHistory([]); setValidation([]); setMessage("Đã hủy các thay đổi chưa lưu.");
  }

  async function publishOfficialResult() {
    if (!method || !draft || alreadyPublished || control.lock !== "NONE" || method === "DIRECT" || !canEdit || !configuration.rulesPublished) return;
    const issues = validate(draft.slots, true);
    setValidation(issues);
    if (issues.length) { setMessage("Chưa thể công bố: hãy sửa các lỗi phân bổ trước."); return; }
    const plan = planFor(draft.slots, method, true);
    const isKnockout = configuration.format === "KNOCKOUT";
    if (!await confirm({ title: isKnockout ? "Công bố kết quả phân nhánh?" : "Công bố bảng đấu?", description: "Hệ thống sẽ lưu bản nháp, xác nhận, kiểm tra lại toàn bộ ràng buộc và công bố kết quả chính thức cho giải.", confirmLabel: "Công bố chính thức" })) return;
    setWorking(true);
    try {
      const saved = await persistDraft(plan);
      await onConfirm(saved.method);
      const published = await onPublish(saved.method);
      setDraft({ ...versionToDraft(published), updatedAt: published.publishedAt ?? new Date().toISOString() });
      setDrawLock({ lock: "OFFICIAL", officialMethod: method, lockedAt: published.publishedAt ?? undefined });
      setMessage("Đã công bố kết quả phân bổ chính thức.");
      onNotice("Đã công bố kết quả phân bổ chính thức. Bước 4 đã được mở.");
      onContinue();
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Không công bố được kết quả phân bổ.";
      setValidation([detail]);
      setMessage(`Chưa thể công bố: ${detail}`);
    } finally { setWorking(false); }
  }

  if (!draft) return <section className="draw-demo-workspace"><p className="muted">Đang tải workspace phân bổ chính thức…</p></section>;
  const complete = Boolean(method) && assigned.length === configuration.teamIds.length && validate(draft.slots, true).length === 0;
  const selectedTeam = selectedTeamId ? selectedTeams.find((team) => team.teamId === selectedTeamId) : null;
  const qualifiers = configuration.qualifiersPerGroup * groups + configuration.extraQualificationSlots;
  const feasibilityIssues: string[] = [];
  if (!method) feasibilityIssues.push("Chọn một trong ba phương thức chia bảng để bắt đầu.");
  if (!configuration.rulesPublished) feasibilityIssues.push("Điều lệ giải chưa được công bố. Hệ thống chưa cho phép tạo, lưu hoặc công bố kết quả bốc thăm.");
  if (!canEdit) feasibilityIssues.push("Giải chưa ở trạng thái được phép bốc thăm hoặc tài khoản không có quyền quản lý.");
  if (configuration.format !== "KNOCKOUT" && capacities.reduce((sum, capacity) => sum + capacity, 0) !== selectedTeams.length) feasibilityIssues.push("Tổng sức chứa bảng phải bằng số đội chính thức.");
  if (configuration.format === "GROUP_AND_KNOCKOUT" && (qualifiers < 2 || qualifiers > selectedTeams.length)) feasibilityIssues.push("Tổng suất đi tiếp phải từ 2 đến tổng số đội.");
  if (seeded && configuration.format === "GROUP_AND_KNOCKOUT" && seededTeamIds.length !== groups) feasibilityIssues.push(`Chọn đúng ${groups} đội hạt giống, mỗi bảng một đội.`);
  if (seeded && configuration.format === "KNOCKOUT" && seededTeamIds.length === 0) feasibilityIssues.push("Chọn ít nhất một đội hạt giống hoặc tắt tùy chọn này.");
  if (seeded && seedSlotEntries(seededTeamIds).some((entry) => draft.slots[entry.slotIndex] !== entry.teamId)) feasibilityIssues.push("Vị trí các đội hạt giống phải được giữ nguyên.");
  if (separateSameInstitution && configuration.format === "GROUP_AND_KNOCKOUT") {
    const institutionCounts = new Map<string, number>();
    selectedTeams.forEach((team) => { if (team.institutionId) institutionCounts.set(team.institutionId, (institutionCounts.get(team.institutionId) ?? 0) + 1); });
    const maxPerInstitution = groups * institutionLimit;
    if ([...institutionCounts.values()].some((count) => count > maxPerInstitution)) feasibilityIssues.push(`Giới hạn trường hiện tại không thể xếp đủ đội (tối đa ${maxPerInstitution} đội của một trường).`);
  }
  const directRevealedTeamIds = draft.directOrder ?? [];
  const directTotalPicks = liveSession?.totalPicks ?? Math.max(0, selectedTeams.length - (seeded ? seededTeamIds.length : 0));
  const directCompleted = method === "DIRECT" && draft.directStatus === "COMPLETED" && alreadyPublished;

  return <section className="draw-demo-workspace" aria-label="Bốc thăm và chia bảng chính thức">
    <header className="draw-demo-workspace-heading">
      <div><span className="draw-dev-badge">BƯỚC 3 · DỮ LIỆU VÀ ĐIỀU LỆ CHÍNH THỨC</span><h3>Bốc thăm & chia bảng</h3><p>{configuration.format === "ROUND_ROBIN" ? "Vòng tròn" : configuration.format === "KNOCKOUT" ? "Loại trực tiếp" : "Kết hợp: vòng bảng + loại trực tiếp"} · {selectedTeams.length} đội đủ điều kiện đã chốt.</p></div>
      <span className={`draw-demo-status ${alreadyPublished ? "published" : "draft"}`}>{alreadyPublished ? "Đã công bố · chỉ xem" : latestVersion ? `Bản ${latestVersion.status === "DRAFT" ? "nháp" : latestVersion.status === "CONFIRMED" ? "đã xác nhận" : latestVersion.status === "ARCHIVED" ? "lưu lịch sử" : "đã công bố"}` : draft.slots.some(Boolean) ? "Có phương án chưa lưu" : "Chưa phân bổ"}</span>
    </header>
    <div className="draw-demo-summary">
      <article><strong>{selectedTeams.length}</strong><span>Tổng số đội</span></article><article><strong>{capacities.reduce((sum, value) => sum + value, 0)}</strong><span>Số vị trí</span></article><article><strong>{assigned.length}</strong><span>Đã phân bổ</span></article><article><strong>{unassignedTeams.length}</strong><span>Chưa phân bổ</span></article><article><strong>{configuration.format === "KNOCKOUT" ? capacities[0] - selectedTeams.length : groups}</strong><span>{configuration.format === "KNOCKOUT" ? "BYE" : "Số bảng"}</span></article>
    </div>
    <details className="draw-demo-rules"><summary>Điều lệ và ràng buộc áp dụng</summary><div className="draw-demo-rule-controls">
      <p><strong>Thể thức:</strong> {configuration.format === "ROUND_ROBIN" ? "Vòng tròn, một bảng duy nhất" : configuration.format === "KNOCKOUT" ? "Loại trực tiếp, một nhánh" : "Vòng bảng + loại trực tiếp"}</p>
      {configuration.format !== "KNOCKOUT" ? <p><strong>Sức chứa bảng:</strong> {capacities.join(" / ")} · <strong>Vòng bảng:</strong> {configuration.roundRobinLegs} lượt · <strong>Đội cùng trường:</strong> {configuration.sameInstitutionPolicy === "REQUIRE_SEPARATE" ? "bắt buộc tách" : configuration.sameInstitutionPolicy === "PREFER_SEPARATE" ? "ưu tiên tách" : "không bắt buộc tách"}</p> : null}
      {configuration.format === "KNOCKOUT" || configuration.format === "GROUP_AND_KNOCKOUT" ? <p><strong>BYE:</strong> {byePolicy === "SEEDED_FIRST" ? "ưu tiên hạt giống" : "tự động"} · <strong>Tranh hạng ba:</strong> {thirdPlaceMatch ? "có" : "không"}</p> : null}
      {configuration.format === "GROUP_AND_KNOCKOUT" ? <p><strong>Suất đi tiếp:</strong> {configuration.qualifiersPerGroup} đội/bảng{configuration.extraQualificationSlots ? ` + ${configuration.extraQualificationSlots} suất bổ sung` : ""} · <strong>Ghép cặp knockout:</strong> {knockoutPairing}</p> : null}
      <p>Các giá trị này được đọc từ điều lệ đã lưu; workspace bốc thăm không ghi đè quy định của giải.</p>
    </div></details>
    {!directCompleted ? <><section className="draw-demo-allocation-config" aria-label="Cấu hình chia bảng">
      <h4>Cấu hình chia bảng</h4>
      <div className="draw-demo-methods" role="group" aria-label="Phương thức bốc thăm">
        {([["DIRECT", "Bốc thăm trực tiếp", "Ghi nhận từng lượt bốc trên hệ thống"], ["RANDOM", "Bốc thăm ngẫu nhiên", "Tạo phương án theo điều lệ"], ["MANUAL", "Sắp xếp thủ công", "Chọn đội và vị trí"]] as const).map(([value, title, description]) => {
          const methodLocked = !canEdit || !configuration.rulesPublished || control.lock === "OFFICIAL" || control.lock === "DIRECT_STARTED" || (control.lock === "DIRECT_SCHEDULED" && value !== "DIRECT");
          const lockReason = control.lock === "OFFICIAL" ? `Đã công bố ${control.officialMethod === "DIRECT" ? "bốc thăm trực tiếp" : control.officialMethod === "RANDOM" ? "kết quả ngẫu nhiên" : "kết quả thủ công"}.` : control.lock === "DIRECT_SCHEDULED" ? "Giải đã công bố lịch bốc thăm trực tiếp." : control.lock === "DIRECT_STARTED" ? "Phiên bốc thăm trực tiếp đã bắt đầu." : "";
          return <button key={value} type="button" aria-pressed={method === value} className={method === value ? "active" : ""} disabled={methodLocked} title={methodLocked ? lockReason : undefined} onClick={() => chooseMethod(value)}>{methodLocked ? <span aria-hidden="true">🔒 </span> : null}<strong>{title}</strong><small>{methodLocked ? lockReason : description}</small></button>;
        })}
      </div>
      {configuration.format !== "ROUND_ROBIN" ? <div className="draw-demo-seed-config">
        <label><input type="checkbox" checked={seeded} disabled={!canEdit || !configuration.rulesPublished || alreadyPublished || control.lock !== "NONE"} onChange={(event) => toggleSeedUse(event.target.checked)} /> Sử dụng đội hạt giống</label>
        {seeded ? <>
          <input type="search" aria-label="Tìm đội hạt giống" placeholder="Tìm đội hạt giống…" value={seedSearch} onChange={(event) => setSeedSearch(event.target.value)} disabled={!canEdit || alreadyPublished} />
          <div className="draw-demo-seed-list" role="group" aria-label="Chọn đội hạt giống">
            {selectedTeams.filter((team) => !seedSearch.trim() || `${team.name} ${team.institutionName ?? ""}`.toLocaleLowerCase("vi").includes(seedSearch.trim().toLocaleLowerCase("vi"))).map((team) => {
              const checked = seededTeamIds.includes(team.teamId);
              return <label key={team.teamId}><input type="checkbox" checked={checked} disabled={!canEdit || alreadyPublished || control.lock !== "NONE" || (!checked && configuration.format === "GROUP_AND_KNOCKOUT" && seededTeamIds.length >= groups) || (!checked && configuration.format === "KNOCKOUT" && seededTeamIds.length >= selectedTeams.length - 1)} onChange={(event) => updateSeedSelection(event.target.checked ? [...seededTeamIds, team.teamId] : seededTeamIds.filter((id) => id !== team.teamId))} /><span>{team.name}<small>{team.institutionName ?? ""}</small></span></label>;
            })}
            {selectedTeams.filter((team) => !seedSearch.trim() || `${team.name} ${team.institutionName ?? ""}`.toLocaleLowerCase("vi").includes(seedSearch.trim().toLocaleLowerCase("vi"))).length === 0 ? <p className="muted">Không có đội phù hợp.</p> : null}
          </div>
          <small>{configuration.format === "GROUP_AND_KNOCKOUT" ? `Chọn đúng ${groups} đội. Đội được chọn tự động xếp lần lượt vào A1, B1…` : "Chọn một hoặc nhiều đội. Hệ thống tự rải các đội này vào vị trí phù hợp trên nhánh; các phương thức khác chỉ xử lý đội còn lại."} Đã chọn {seededTeamIds.length}.</small>
        </> : null}
      </div> : null}
    </section>
    <section className={`draw-demo-feasibility ${feasibilityIssues.length ? "invalid" : "valid"}`} aria-live="polite"><strong>{feasibilityIssues.length ? "Cấu hình chưa khả thi" : "Cấu hình khả thi"}</strong>{feasibilityIssues.length ? <ul>{feasibilityIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : <p>{selectedTeams.length} đội · {configuration.format === "KNOCKOUT" ? `${capacities[0]} vị trí, ${capacities[0] - selectedTeams.length} BYE` : `${groups} bảng · ${configuration.roundRobinLegs} lượt`}{configuration.format === "GROUP_AND_KNOCKOUT" ? ` · ${qualifiers} suất đi tiếp` : ""}</p>}</section>
    {method === "RANDOM" ? <div className="draw-demo-random-config">
       <div><strong>Cấu hình bốc thăm</strong><p>{capacities.length === 1 && configuration.format === "KNOCKOUT" ? `${capacities[0]} vị trí cây đấu · ${capacities[0] - selectedTeams.length} BYE` : `${groups} bảng · sức chứa ${capacities.join(" / ")}`}</p><small>Hạt giống: {seeded ? `${seededTeamIds.length} đội giữ vị trí` : "không dùng"} · Tách trường: {separateSameInstitution ? "bật" : "tắt"} · {configuration.format === "KNOCKOUT" ? "Quy tắc BYE " + (byePolicy === "SEEDED_FIRST" ? "ưu tiên hạt giống" : "tự động") : `${configuration.roundRobinLegs} lượt vòng bảng`}{configuration.format === "GROUP_AND_KNOCKOUT" ? ` · ${configuration.qualifiersPerGroup} đội/bảng + ${configuration.extraQualificationSlots} suất bổ sung · ${knockoutPairing}` : ""}{thirdPlaceMatch && configuration.format !== "ROUND_ROBIN" ? " · có tranh hạng ba" : ""}</small></div>
      <button type="button" className="button button-primary" disabled={!canEdit || !configuration.rulesPublished || working || alreadyPublished || feasibilityIssues.length > 0} onClick={() => void randomize()}>{working ? "Đang tạo phương án…" : assigned.length ? "Bốc thăm lại" : "Thực hiện bốc thăm ngẫu nhiên"}</button>
    </div> : method === "MANUAL" ? <div className="draw-demo-manual-toolbar">
      <div><strong>{selectedTeam ? `Đang chọn: ${selectedTeam.name}` : "Chọn đội trong danh sách rồi chọn vị trí"}</strong><p>{selectedTeam ? "Các vị trí hợp lệ được viền xanh; bấm hoặc kéo đội vào vị trí." : "Bấm đội cần xếp trong Danh sách đội chính thức."}</p></div>
    </div> : method === "DIRECT" ? <div className="draw-demo-direct-config">
      <header><span className="draw-dev-badge">BUỔI LỄ BỐC THĂM</span><h4>Cấu hình và công bố lịch bốc thăm trực tiếp</h4><p>Lịch buổi lễ được lưu riêng với lịch thi đấu và đồng bộ cho người theo dõi.</p></header>
      {(draft.directStatus === "SCHEDULED" || draft.directStatus === "POSTPONED") && draft.directScheduledAt && !editingSchedule ? <div className="draw-demo-direct-scheduled" role="status">
        <div><span>ĐÃ CÔNG BỐ LỊCH</span><strong>{draft.directEventName ?? directEventName}</strong><small>{new Intl.DateTimeFormat("vi-VN", { dateStyle: "full", timeStyle: "short", timeZone: draft.directTimeZone ?? directTimeZone }).format(new Date(draft.directScheduledAt))} · {draft.directTimeZone ?? directTimeZone}</small>{draft.directAnnouncement ? <p>{draft.directAnnouncement}</p> : null}</div>
        {draft.directLocation ? <p>Địa điểm: {draft.directLocation}</p> : null}
        <div className="draw-demo-countdown">{new Date(draft.directScheduledAt).getTime() > clock ? <>Bắt đầu sau <strong>{Math.floor((new Date(draft.directScheduledAt).getTime() - clock) / 60_000)} phút {Math.floor(((new Date(draft.directScheduledAt).getTime() - clock) % 60_000) / 1000)} giây</strong></> : <strong>Đã đến giờ · Chờ BTC bắt đầu</strong>}</div>
        <button type="button" className="button button-primary" disabled={working || new Date(draft.directScheduledAt).getTime() > clock} onClick={() => void beginDirectSimulation()}>Bắt đầu bốc thăm</button>
        <button type="button" className="button button-secondary" disabled={directRevealedTeamIds.length > 0 || working} onClick={() => setEditingSchedule(true)}>Thay đổi lịch</button>
        <button type="button" className="button button-danger" disabled={directRevealedTeamIds.length > 0 || working} onClick={() => void cancelDirectSchedule()}>Hủy lịch</button>
      </div> : draft.directStatus === "LIVE" || draft.directStatus === "PAUSED" || draft.directStatus === "COMPLETED" ? <div className="draw-demo-direct-session-summary">
        <div className="draw-demo-live-heading"><span className={`draw-live-status draw-live-status-${draft.directStatus.toLowerCase()}`}>{draft.directStatus === "LIVE" ? "LIVE · ĐANG BỐC THĂM" : draft.directStatus === "PAUSED" ? "TẠM DỪNG" : "HOÀN THÀNH"}</span><strong>{draft.directEventName ?? directEventName}</strong><small>{directRevealedTeamIds.length}/{directTotalPicks} lượt · {seededTeamIds.length} đội hạt giống · {draft.directScheduledAt ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(draft.directScheduledAt)) : ""}</small></div>
        <progress max={Math.max(1, directTotalPicks)} value={directRevealedTeamIds.length} />
      </div> : <>
        <div className="draw-demo-direct-form">
          <label>Tên buổi lễ<input value={directEventName} maxLength={180} onChange={(event) => setDirectEventName(event.target.value)} placeholder="Lễ bốc thăm giải đấu" /></label>
          <label>Ngày tổ chức<input type="date" value={directDate} onChange={(event) => setDirectDate(event.target.value)} /></label>
          <label>Giờ tổ chức<input type="time" value={directTime} onChange={(event) => setDirectTime(event.target.value)} /></label>
          <label>Múi giờ<input value={directTimeZone} onChange={(event) => setDirectTimeZone(event.target.value)} placeholder="Asia/Ho_Chi_Minh" /></label>
          <label>Địa điểm (không bắt buộc)<input value={directLocation} maxLength={300} onChange={(event) => setDirectLocation(event.target.value)} placeholder="Tên hội trường / địa chỉ" /></label>
          <label className="draw-demo-direct-announcement">Nội dung thông báo<textarea rows={3} maxLength={2000} value={directAnnouncement} onChange={(event) => setDirectAnnouncement(event.target.value)} placeholder="Thông tin dành cho các đội và người theo dõi" /></label>
        </div>
        <div className="draw-demo-direct-preview"><strong>Xem trước buổi lễ</strong><span>{directEventName || "Tên buổi lễ"}</span><small>{directDate && directTime ? `${directDate} · ${directTime} · ${directTimeZone}` : "Chọn ngày giờ tổ chức"}</small><p>{selectedTeams.length} đội chính thức · {capacities.length === 1 && configuration.format === "KNOCKOUT" ? `${capacities[0]} vị trí phân nhánh` : `${groups} bảng`} · Quy tắc phân bổ hiện tại được giữ nguyên.</p>{directAnnouncement ? <small>{directAnnouncement}</small> : null}</div>
        <button type="button" className="button button-primary" disabled={!canEdit || !configuration.rulesPublished || working || feasibilityIssues.length > 0 || !directEventName.trim() || !directDate || !directTime || !directTimeZone.trim()} onClick={() => void publishDirectSchedule()}>{liveSession && ["SCHEDULED", "POSTPONED"].includes(liveSession.status) ? "Lưu thay đổi lịch" : "Công bố lịch bốc thăm"}</button>
      </>}
    </div> : null}
    </> : <>
      <section className="draw-demo-complete-handoff draw-demo-completion" role="status">
        <h4>Buổi lễ bốc thăm hoàn tất</h4>
        <p>Kết quả đã được công bố chính thức. Bước 4 đã được mở.</p>
        <button type="button" className="button button-primary" onClick={continueToFixtures}>Chuyển đến Sơ đồ thi đấu →</button>
      </section>
      {renderDirectHistory()}
    </>}
    <div className={`draw-demo-board-layout method-${directCompleted ? "complete" : method?.toLowerCase() ?? "unselected"}`}>
      {!directCompleted ? <aside className="draw-demo-method-sidepanel">
        {method === "DIRECT" ? <section className="draw-demo-draw-stage" aria-label="Màn hình bốc thăm trực tiếp">
          <header><div><span className={`draw-live-status draw-live-status-${(draft.directStatus ?? "WAITING").toLowerCase()}`}>{draft.directStatus === "LIVE" ? "LIVE · ĐANG BỐC THĂM" : draft.directStatus === "PAUSED" ? "TẠM DỪNG" : draft.directStatus === "COMPLETED" ? "HOÀN THÀNH" : draft.directStatus === "SCHEDULED" ? "SẮP DIỄN RA" : "CHƯA BẮT ĐẦU"}</span><h4>{draft.directEventName ?? "Lễ bốc thăm"}</h4><small>{directRevealedTeamIds.length}/{directTotalPicks} lượt đã mở · {seededTeamIds.length} đội hạt giống giữ vị trí</small></div></header>
          <div className={`draw-demo-urn ${drawing ? "drawing" : ""}`} aria-hidden="true"><span>⚽</span><i /><i /><i /></div>
          <div className="draw-demo-reveal-card" aria-live="polite">
            {directRevealedTeamIds.length ? (() => { const teamId = directRevealedTeamIds.at(-1)!; const team = selectedTeams.find((candidate) => candidate.teamId === teamId); const slotIndex = draft.slots.indexOf(teamId); const slot = slots[slotIndex]; return <><span>LÁ THĂM VỪA MỞ · LƯỢT {directRevealedTeamIds.length}</span>{drawing ? <b className="draw-demo-hidden-ticket">?</b> : team?.logoUrl ? <img src={team.logoUrl} alt="" /> : <b>{(team?.shortName ?? team?.name ?? "ĐỘI").slice(0, 2).toUpperCase()}</b>}<strong>{drawing ? "Đang mở lá thăm…" : team?.name ?? "Đội vừa được bốc"}</strong><small>{team?.institutionName ?? ""}</small><em>{slot ? `${slot.groupName} · vị trí ${slot.position + 1}` : "Đang xác định vị trí"}</em></>; })() : <><span>THÙNG PHIẾU</span><b className="draw-demo-hidden-ticket">?</b><strong>Chưa mở lá thăm</strong><small>Đội hạt giống đã được đặt sẵn; lá thăm chỉ phân bổ các đội còn lại.</small></>}
          </div>
          <progress max={Math.max(1, directTotalPicks)} value={directRevealedTeamIds.length} aria-label="Tiến độ bốc thăm" />
          <div className="draw-demo-draw-actions">
          {draft.directStatus === "LIVE" ? <><button type="button" className="button button-primary" disabled={drawing || working || directRevealedTeamIds.length >= directTotalPicks} onClick={revealDirectWithAnimation}>{drawing || working ? "Đang trộn lá thăm…" : "Bốc lá thăm tiếp theo"}</button><button type="button" className="button button-secondary" disabled={working || drawing} onClick={() => void setDirectSimulationStatus("PAUSED")}>Tạm dừng</button></> : draft.directStatus === "PAUSED" ? <button type="button" className="button button-primary" disabled={working} onClick={() => void setDirectSimulationStatus("LIVE")}>Tiếp tục bốc thăm</button> : draft.directStatus === "COMPLETED" ? <div className="draw-demo-complete-handoff" role="status"><p>Buổi lễ hoàn tất · kết quả đã công bố chính thức.</p><strong>Bước 4 đã được mở</strong><button type="button" className="button button-primary" onClick={continueToFixtures}>Chuyển ngay đến Sơ đồ thi đấu</button></div> : draft.directStatus === "SCHEDULED" || draft.directStatus === "POSTPONED" ? <p>Buổi lễ đang chờ đến giờ và BTC bắt đầu.</p> : <p>Thiết lập và công bố lịch để chuẩn bị buổi lễ trực tiếp.</p>}
          </div>
        </section> : null}
        {renderTeamPool()}
      </aside> : null}
      <div className="draw-demo-board-column">
        <div className="draw-demo-board-toolbar"><strong>{configuration.format === "KNOCKOUT" ? "Sơ đồ phân nhánh" : "Sơ đồ phân bảng"}</strong><div><button type="button" aria-label="Thu nhỏ sơ đồ" title="Thu nhỏ" onClick={() => setBoardZoom((zoom) => Math.max(60, zoom - 10))}>−</button><output>{boardZoom}%</output><button type="button" aria-label="Phóng to sơ đồ" title="Phóng to" onClick={() => setBoardZoom((zoom) => Math.min(150, zoom + 10))}>＋</button><button type="button" onClick={() => setBoardZoom(100)}>Vừa khung</button><button type="button" onClick={() => void toggleBoardFullscreen()}>Toàn màn hình</button></div></div>
        <div className="draw-demo-board-viewport" ref={boardViewportRef}>
      <div className="draw-demo-board" style={{ zoom: `${boardZoom}%` }} role="list" aria-label={configuration.format === "KNOCKOUT" ? "Sơ đồ phân nhánh" : "Sơ đồ phân bảng"}>
        {configuration.format === "KNOCKOUT" ? <div className="draw-demo-bracket"><header><strong>Sơ đồ vị trí phân nhánh</strong><span>{capacities[0]} vị trí · {capacities[0] - selectedTeams.length} BYE · {Math.log2(capacities[0])} vòng</span></header><div className="draw-demo-bracket-slots">{slots.map((slot) => renderSlot(slot))}</div></div>
          : <div className="draw-demo-group-grid">{capacities.map((capacity, groupIndex) => <article className="draw-demo-group-card" key={groupIndex}><header><div><strong>{groupName(groupIndex)}</strong><small>{groupTeamIds(draft.slots)[groupIndex].length}/{capacity} đội{configuration.format === "GROUP_AND_KNOCKOUT" ? ` · ${configuration.qualifiersPerGroup} suất đi tiếp` : ""}</small></div><span>{groupTeamIds(draft.slots)[groupIndex].length}/{capacity}</span></header><div className="draw-demo-group-slots">{slots.filter((slot) => slot.groupIndex === groupIndex).map((slot) => renderSlot(slot))}</div></article>)}</div>}
      </div>
        </div>
      </div>
    </div>
    {!directCompleted ? <>
    {renderDirectHistory()}
    <section className="draw-demo-validation" aria-live="polite"><header><strong>Kiểm tra kết quả</strong><span className={complete ? "valid" : "invalid"}>{complete ? "Đủ đội" : `${unassignedTeams.length} đội chưa phân bổ`}</span></header>{validation.length ? validation.map((issue) => <p className="form-error" key={issue}>{issue}</p>) : message ? <p>{message}</p> : <p>{separateSameInstitution ? "Sẽ kiểm tra tách trường bắt buộc." : "Không có ràng buộc tách trường bắt buộc."} Kiểm tra trùng đội, sức chứa{seeded ? " và vị trí đội hạt giống" : ""} trước khi công bố.</p>}</section>
    <footer className="draw-demo-actions">
      <button type="button" className="button button-secondary" disabled={alreadyPublished || method === "DIRECT" || !history.length} onClick={() => { const previous = history.at(-1); if (previous) { setDraft({ ...draft, slots: previous, updatedAt: new Date().toISOString() }); setHistory((items) => items.slice(0, -1)); setValidation([]); } }}>Hoàn tác</button>
      <button type="button" className="button button-secondary" disabled={!method || !savedHistory.some((item) => (method === "MANUAL" ? item.method === "MANUAL" : item.method === "RANDOM" || item.method === "SEEDED") && ["DRAFT", "CONFIRMED"].includes(item.status)) || control.lock !== "NONE"} onClick={reopenDraft}>Mở lại bản nháp</button>
      <button type="button" className="button button-secondary" disabled={!method || !canEdit || !configuration.rulesPublished || working || alreadyPublished || method === "DIRECT" || control.lock !== "NONE"} onClick={() => void saveDraft()}>Lưu bản nháp</button>
      <button type="button" className="button button-secondary" disabled={!method || working || alreadyPublished || method === "DIRECT" || control.lock !== "NONE"} onClick={() => void cancelDraft()}>Hủy thay đổi</button>
      <button type="button" className="button button-secondary" disabled={!method || working || method === "DIRECT" || !canEdit || !configuration.rulesPublished} onClick={() => void validateCurrent()}>Kiểm tra kết quả</button>
      {!method ? <button type="button" className="button button-primary" disabled>Chọn phương thức chia bảng</button> : method === "DIRECT" ? <button type="button" className="button button-primary" disabled>{alreadyPublished ? "Đã công bố tự động sau lượt cuối" : "Hoàn tất tự động sau lượt cuối"}</button> : <button type="button" className="button button-primary" disabled={!canEdit || !configuration.rulesPublished || working || alreadyPublished || !complete} onClick={() => void publishOfficialResult()}>{configuration.format === "KNOCKOUT" ? "Công bố kết quả phân nhánh" : "Công bố bảng đấu"}</button>}
    </footer>
    {alreadyPublished ? <p className="draw-demo-scope-note" role="status">Kết quả phân bổ đã được công bố trong database. Bước 4 nhận kết quả chính thức từ dịch vụ giải đấu.</p> : <p className="draw-demo-scope-note">Bản nháp chưa lưu chỉ nằm trong phiên làm việc hiện tại. Khi chọn “Lưu bản nháp”, dữ liệu được ghi vào database của giải và có thể tải lại trên thiết bị khác.</p>}
    </> : null}
  </section>;

  function renderDirectHistory() {
    if (!draft) return null;
    return method === "DIRECT" ? <details className="draw-demo-draw-history draw-demo-session-history"><summary>Lịch sử buổi bốc thăm · {directRevealedTeamIds.length} lượt</summary>
      <p className="muted">Các lượt bốc đã được điền vào sơ đồ phân bổ. Đây là nhật ký của cùng một kết quả.</p>
      {directRevealedTeamIds.length ? <ol>{directRevealedTeamIds.map((teamId, index) => { const team = selectedTeams.find((candidate) => candidate.teamId === teamId); const slot = slots[draft.slots.indexOf(teamId)]; return <li key={`${teamId}-${index}`}><span>{index + 1}</span><div><strong>{team?.name ?? "Đội"}</strong><small>{slot ? `${slot.groupName} · vị trí ${slot.position + 1}` : ""}</small></div></li>; })}</ol> : <p>Chưa có lượt bốc nào.</p>}
      {draft.directHistory?.length ? <details className="draw-demo-draw-history"><summary>Nhật ký tổ chức buổi lễ</summary><ol>{draft.directHistory.filter((event) => event.type !== "PICK").map((event, index) => <li key={`${event.at}-${index}`}><time>{new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(event.at))}</time><div><strong>{{ SCHEDULED: "Đã hẹn giờ", STARTED: "Bắt đầu", PAUSED: "Tạm dừng", RESUMED: "Tiếp tục", PUBLISHED: "Đã công bố", CANCELLED: "Đã hủy", RESCHEDULED: "Đổi giờ tổ chức" }[event.type] ?? "Cập nhật buổi lễ"}</strong><small>{event.detail}</small></div></li>)}</ol></details> : null}
    </details> : null;
  }

  function renderSlot(slot: typeof slots[number]) {
    const teamId = draft?.slots[slot.index] ?? null;
    const team = teamId ? selectedTeams.find((candidate) => candidate.teamId === teamId) : null;
    const bye = byeIndexes.has(slot.index);
    const slotLocked = alreadyPublished || method === "DIRECT";
    const isSeededTeam = Boolean(teamId && seeded && seededTeamIds.includes(teamId));
    const justRevealed = method === "DIRECT" && Boolean(teamId && teamId === directRevealedTeamIds.at(-1));
    const reason = selectedTeamId ? canPut(slot.index, selectedTeamId) : null;
    const canPlace = Boolean(selectedTeamId && !reason && !slotLocked);
    return <div key={slot.key} className={`draw-demo-slot ${team ? "filled" : "empty"} ${team && team.teamId === selectedTeamId ? "selected" : ""} ${justRevealed ? "just-revealed" : ""} ${isSeededTeam ? "seeded" : ""} ${bye ? "bye" : ""} ${canPlace ? "valid-target" : ""} ${reason && selectedTeamId ? "invalid-target" : ""}`} role="listitem" onDragOver={(event) => { if (!bye && !slotLocked) event.preventDefault(); }} onDrop={(event) => { event.preventDefault(); const dragged = event.dataTransfer.getData("text/plain"); if (dragged) placeTeamAt(slot.index, dragged); else placeAt(slot.index); }}>
      {justRevealed ? <small className="draw-demo-revealed-label">✓ Vừa bốc · lượt {directRevealedTeamIds.length}</small> : null}
      <button type="button" className="draw-demo-slot-main" disabled={slotLocked || bye || isSeededTeam || (!team && !canPlace)} title={bye ? "Vị trí này dành cho BYE." : isSeededTeam ? "Vị trí đã khóa cho đội hạt giống." : slotLocked ? "Lượt trực tiếp đã xác lập, không thể sửa vị trí." : reason ?? (team ? "Bấm để chọn đội trong ô." : canPlace ? "Vị trí hợp lệ." : selectedTeamId ? "Vị trí chưa hợp lệ." : "Chọn đội để phân bổ.")} onClick={() => { if (selectedTeamId) placeAt(slot.index); else if (team && !isSeededTeam) setSelectedTeamId(team.teamId); }}>
        <span className="draw-demo-slot-code">{configuration.format === "KNOCKOUT" ? `P${slot.position + 1}` : `${String.fromCharCode(65 + slot.groupIndex)}${slot.position + 1}`}</span>
        {bye ? <span className="draw-demo-bye-label">BYE · miễn vòng</span> : team ? <><span className="draw-team-logo">{team.logoUrl ? <img src={team.logoUrl} alt="" /> : (team.shortName ?? team.name).slice(0, 2).toUpperCase()}</span><span className="draw-demo-slot-team"><strong>{team.name}</strong><small>{team.institutionName ?? ""}</small>{isSeededTeam ? <small>★ Đội hạt giống · giữ vị trí</small> : null}</span></> : <span className="draw-demo-slot-empty">{reason && selectedTeamId ? reason : "Vị trí trống · chọn đội"}</span>}
      </button>
      {team && !slotLocked && !isSeededTeam ? <button type="button" className="draw-demo-slot-remove" aria-label={`Gỡ ${team.name} khỏi vị trí`} onClick={() => removeFromSlot(slot.index)}>Gỡ</button> : null}
      {reason && selectedTeamId && !bye ? <small className="draw-demo-invalid-reason">Không hợp lệ: {reason}</small> : null}
    </div>;
  }

  function renderTeamPool() {
    return <details className="draw-demo-team-pool" open={method === "MANUAL" || method === "DIRECT" || seeded}>
      <summary><strong>{method === "DIRECT" ? "Đội còn lại trong thùng phiếu" : "Danh sách đội chính thức"}</strong><span>{method === "DIRECT" ? `${unassignedTeams.length} chưa bốc · ${directRevealedTeamIds.length} đã bốc` : `${selectedTeams.length} đội · ${assigned.length} đã phân bổ`}</span></summary>
      <div className="draw-demo-search"><input aria-label="Tìm trong danh sách đội chính thức" placeholder="Tìm đội hoặc trường…" value={search} onChange={(event) => setSearch(event.target.value)} /><select aria-label="Lọc danh sách theo trường" value={institution} onChange={(event) => setInstitution(event.target.value)}><option value="">Tất cả trường</option>{institutions.map((name) => <option key={name}>{name}</option>)}</select></div>
      <div className="draw-demo-team-list">{visibleTeams.map((team) => { const position = draft?.slots.findIndex((teamId) => teamId === team.teamId) ?? -1; const slot = position >= 0 ? slots[position] : null; const isSeededTeam = seeded && seededTeamIds.includes(team.teamId); return <div key={team.teamId} className={`draw-demo-team-card ${selectedTeamId === team.teamId ? "selected" : ""} ${isSeededTeam ? "seeded" : ""}`}><button type="button" className="draw-demo-team-pick" draggable={method === "MANUAL" && !alreadyPublished && !isSeededTeam} disabled={alreadyPublished || method !== "MANUAL" || isSeededTeam} onDragStart={(event) => { event.dataTransfer.setData("text/plain", team.teamId); setSelectedTeamId(team.teamId); }} onClick={() => { if (method === "MANUAL" && !isSeededTeam) setSelectedTeamId((current) => current === team.teamId ? null : team.teamId); }}><span className="draw-team-logo">{team.logoUrl ? <img src={team.logoUrl} alt="" /> : (team.shortName ?? team.name).slice(0, 2).toUpperCase()}</span><span><strong>{team.name}</strong><small>{team.institutionName ?? "Chưa liên kết trường"}</small><small>{isSeededTeam ? "★ Đội hạt giống · vị trí cố định" : slot ? `Đã xếp tại ${configuration.format === "KNOCKOUT" ? "P" : String.fromCharCode(65 + slot.groupIndex)}${slot.position + 1}` : "Chưa phân bổ"}</small></span><em>{slot ? `${configuration.format === "KNOCKOUT" ? "P" : String.fromCharCode(65 + slot.groupIndex)}${slot.position + 1}` : "Chưa phân bổ"}</em></button></div>; })}{visibleTeams.length === 0 ? <p className="muted">{method === "DIRECT" && unassignedTeams.length === 0 ? "Đã bốc hết đội. Xem kết quả trên sơ đồ bên trên." : "Không có đội khớp bộ lọc."}</p> : null}</div>
    </details>;
  }
}
