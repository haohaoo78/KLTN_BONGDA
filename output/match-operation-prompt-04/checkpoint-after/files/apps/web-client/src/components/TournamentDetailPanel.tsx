import { useCallback, useEffect, useState } from "react";
import { useDialog } from "./DialogProvider";
import {
  createTournamentRegulation,
  deleteTournamentRegulation,
  getTournament,
  getPublicTeams,
  getPublishedTournamentDraw,
  getPublicTournamentFixtures,
  getPublishedTournamentTeams,
  getTournamentLiveDraw,
  getMatchResult,
  getStandings,
  getTournamentRegulations,
  getTournamentRegulationVersions,
  updateTournament,
  updateTournamentRegulation,
  type DrawVersion,
  type RegulationVersion,
  type Tournament,
  type TournamentCompetitionConfig,
  type TournamentRegulation,
  type MatchResult,
  type Standing,
  type PublicTournamentTeam,
  type LiveDrawSession,
  type PublicFixtureBundle,
} from "../api/competition";
import type { Institution } from "../api/institutions";
import { Modal } from "./Modal";
import { MatchOperationRulesSection } from "./MatchOperationRulesSection";
import { API_BASE, ApiError, NOTIFICATION_REALTIME_EVENT } from "../api/client";
import { useMatchFeedInvalidation } from "../hooks/useMatchFeedInvalidation";
import { PublicTournamentCompetitionPanel } from "./PublicTournamentCompetitionPanel";
import { getPublicScheduleWorkflowTestState } from "../api/testWorkflow";
import type { DemoStep5State } from "../utils/drawTestStorage";
import { emptyDrawTestState, hydrateDrawTestState, subscribeDrawTestState, type DrawTestState } from "../utils/drawTestStorage";

type Props = {
  tournamentId: string;
  institutions: Institution[];
  canManage?: boolean;
  onNotice?: (message: string) => void;
  onClose: () => void;
};

const formatLabels: Record<string, string> = {
  SINGLE_INSTITUTION: "Trong một trường",
  INTER_SCHOOL: "Liên trường",
  ROUND_ROBIN: "Vòng tròn",
  GROUP_AND_KNOCKOUT: "Vòng bảng và loại trực tiếp",
  KNOCKOUT: "Loại trực tiếp",
  ORGANIZER_DECISION: "BTC quyết định",
  WALKOVER: "Xử thắng theo điều lệ",
  NO_AUTOMATIC_RESULT: "Không tự động xác định kết quả",
};

const defaultTournamentCompetitionConfig: TournamentCompetitionConfig = {
  groupCountMode: "AUTO_BY_CAPACITY", groupCount: null, groupAllocation: "BALANCED",
  sameInstitutionPolicy: "NONE", knockoutPairing: "GROUP_RANK", fixedPairingRule: "STANDARD_CROSSOVER",
  knockoutLegs: 1, thirdPlaceMatch: false, byePolicy: "AUTOMATIC", schedulingStartTime: "08:00", schedulingEndTime: "22:00",
};

function dateLabel(value: string | null | undefined): string {
  if (!value) return "Chưa cập nhật";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Chưa cập nhật"
    : new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function dateInputValue(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

export function TournamentDetailPanel({
  tournamentId,
  institutions,
  canManage = false,
  onNotice,
  onClose,
}: Props) {
  const { confirm } = useDialog();
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [regulations, setRegulations] = useState<TournamentRegulation[]>([]);
  const [versions, setVersions] = useState<RegulationVersion[]>([]);
  const [publishedDraw, setPublishedDraw] = useState<DrawVersion | null>(null);
  const [publishedTestSchedule, setPublishedTestSchedule] = useState<DemoStep5State | null>(null);
  const [liveDraw, setLiveDraw] = useState<LiveDrawSession | null>(null);
  const [drawLoading, setDrawLoading] = useState(true);
  const [drawError, setDrawError] = useState<string | null>(null);
  const [drawTestError, setDrawTestError] = useState<string | null>(null);
  const [testScheduleError, setTestScheduleError] = useState<string | null>(null);
  const [publicFixtures, setPublicFixtures] = useState<PublicFixtureBundle | null>(null);
  const [fixturesLoading, setFixturesLoading] = useState(true);
  const [fixturesError, setFixturesError] = useState<string | null>(null);
  const [liveConnection, setLiveConnection] = useState<"connected" | "reconnecting">("connected");
  const [drawTeamNames, setDrawTeamNames] = useState<Map<string, string>>(new Map());
  const [participatingTeams, setParticipatingTeams] = useState<PublicTournamentTeam[]>([]);
  const [publicResults, setPublicResults] = useState<Map<string, MatchResult>>(new Map());
  // A viewer must never render manager-only browser cache while the public,
  // server-filtered snapshot is loading.
  const [drawTestState, setDrawTestState] = useState<DrawTestState>(() => emptyDrawTestState(tournamentId));
  const [publicStandings, setPublicStandings] = useState<Standing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setDrawTestState(emptyDrawTestState(tournamentId));
    const reloadPublicTestState = () => {
      setDrawTestError(null);
      void hydrateDrawTestState(tournamentId, "PUBLIC").then((state) => {
        if (active) setDrawTestState(state);
      }).catch((cause: unknown) => {
        if (!active) return;
        if (cause instanceof ApiError && cause.status === 404) {
          setDrawTestState(emptyDrawTestState(tournamentId));
          return;
        }
        setDrawTestError(cause instanceof Error ? cause.message : "Không tải được snapshot công khai từ máy chủ.");
      });
    };
    reloadPublicTestState();
    const unsubscribe = subscribeDrawTestState(tournamentId, reloadPublicTestState);
    return () => { active = false; unsubscribe(); };
  }, [tournamentId]);
  const [editingDetails, setEditingDetails] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [maxTeams, setMaxTeams] = useState("");
  const [editCompetitionFormat, setEditCompetitionFormat] = useState<Tournament["competitionFormat"]>("ROUND_ROBIN");
  const [editCompetitionConfig, setEditCompetitionConfig] = useState<TournamentCompetitionConfig>(defaultTournamentCompetitionConfig);
  const [editRoundRobinLegs, setEditRoundRobinLegs] = useState<1 | 2>(1);
  const [editMaxTeamsPerGroup, setEditMaxTeamsPerGroup] = useState(4);
  const [editAdvancingTeams, setEditAdvancingTeams] = useState(2);
  const [editKnockoutDecision, setEditKnockoutDecision] = useState<NonNullable<Tournament["rules"]>["knockoutDecisionMethod"]>("PENALTIES_ONLY");
  const [editExtraTimeMinutes, setEditExtraTimeMinutes] = useState(30);
  const [saving, setSaving] = useState(false);
  const [editingRegulationId, setEditingRegulationId] = useState("");
  const [regulationTitle, setRegulationTitle] = useState("");
  const [regulationContent, setRegulationContent] = useState("");
  const [creatingRegulation, setCreatingRegulation] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<RegulationVersion | null>(null);
  const [realtimeRevision, setRealtimeRevision] = useState(0);

  const refreshMatchData = useCallback(() => {
    if (!editingDetails && !creatingRegulation && !editingRegulationId) {
      setRealtimeRevision((revision) => revision + 1);
    }
  }, [editingDetails, creatingRegulation, editingRegulationId]);
  useMatchFeedInvalidation(refreshMatchData);

  useEffect(() => {
    window.addEventListener(NOTIFICATION_REALTIME_EVENT, refreshMatchData);
    return () => window.removeEventListener(NOTIFICATION_REALTIME_EVENT, refreshMatchData);
  }, [refreshMatchData]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    Promise.all([
      getTournament(tournamentId),
      getTournamentRegulations(tournamentId),
      getTournamentRegulationVersions(tournamentId),
      getStandings(tournamentId),
    ])
      .then(async ([detail, regulationResult, versionResult, standingsResult]) => {
        if (!active) return;
        setTournament(detail.tournament);
        setName(detail.tournament.name);
        setDescription(detail.tournament.description ?? "");
        setLocation(detail.tournament.location ?? "");
        setStartDate(dateInputValue(detail.tournament.startDate));
        setEndDate(dateInputValue(detail.tournament.endDate));
        setMaxTeams(String(detail.tournament.maxTeams));
        setRegulations(regulationResult.regulations);
        setVersions(versionResult.versions);
        setPublicStandings(standingsResult.standings);
        const [registeredResult, publicTeamResult] = await Promise.all([
          detail.tournament.status === "DRAFT"
            ? Promise.resolve({ teams: [] as PublicTournamentTeam[] })
            : getPublishedTournamentTeams(tournamentId),
          getPublicTeams({ limit: 100, offset: 0 }),
        ]);
        if (!active) return;
        setParticipatingTeams(registeredResult.teams);
        const teamMap = new Map(publicTeamResult.items.map((team) => [team.id, team.name]));
        for (const team of registeredResult.teams) teamMap.set(team.id, team.name);
        setDrawTeamNames(teamMap);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Không tải được thông tin giải đấu.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [tournamentId, realtimeRevision]);

  useEffect(() => {
    let active = true;
    setPublishedTestSchedule(null);
    setTestScheduleError(null);
    getPublicScheduleWorkflowTestState<DemoStep5State>(tournamentId)
      .then(({ state }) => { if (active) setPublishedTestSchedule(state); })
      .catch((cause: unknown) => {
        if (!active) return;
        if (cause instanceof ApiError && cause.status === 404) { setPublishedTestSchedule(null); return; }
        setTestScheduleError(cause instanceof Error ? cause.message : "Không tải được lịch kiểm thử công khai từ máy chủ.");
      });
    return () => { active = false; };
  }, [tournamentId, realtimeRevision]);

  useEffect(() => {
    let active = true;
    setDrawLoading(true);
    setDrawError(null);
    setPublishedDraw(null);
    getPublishedTournamentDraw(tournamentId)
      .then(({ draw }) => { if (active) setPublishedDraw(draw); })
      .catch((cause: unknown) => { if (active) setDrawError(cause instanceof Error ? cause.message : "Không thể tải dữ liệu công bố."); })
      .finally(() => { if (active) setDrawLoading(false); });
    return () => { active = false; };
  }, [tournamentId, realtimeRevision]);

  useEffect(() => {
    let active = true;
    setFixturesLoading(true);
    setFixturesError(null);
    setPublicFixtures(null);
    setPublicResults(new Map());
    getPublicTournamentFixtures(tournamentId)
      .then(async (bundle) => {
        if (!active) return;
        setPublicFixtures(bundle);
        const matches = bundle.stages.flatMap((stage) => stage.matches);
        const results = await Promise.all(matches.map(async (match) => {
          const { result } = await getMatchResult(match.id);
          return result?.status === "APPROVED" ? [match.id, result] as const : null;
        }));
        if (active) setPublicResults(new Map(results.filter((entry): entry is readonly [string, MatchResult] => entry !== null)));
      })
      .catch((cause: unknown) => { if (active) setFixturesError(cause instanceof Error ? cause.message : "Không thể tải sơ đồ đã công bố."); })
      .finally(() => { if (active) setFixturesLoading(false); });
    return () => { active = false; };
  }, [tournamentId, realtimeRevision]);

  useEffect(() => {
    let active = true;
    if (!tournamentId) return;
    setLiveDraw(null);
    const refresh = () => void getTournamentLiveDraw(tournamentId)
      .then(({ session }) => { if (active) { setLiveDraw(session); setLiveConnection("connected"); } })
      .catch(() => { if (active) setLiveConnection("reconnecting"); });
    refresh();
    const base = API_BASE.replace(/\/$/, "");
    const stream = new EventSource(`${base}/tournaments/${encodeURIComponent(tournamentId)}/live-draw/stream`, { withCredentials: true });
    stream.onopen = () => { if (active) setLiveConnection("connected"); refresh(); };
    stream.onmessage = () => { refresh(); setRealtimeRevision((revision) => revision + 1); };
    stream.onerror = () => { if (active) setLiveConnection("reconnecting"); };
    const fallback = window.setInterval(() => { refresh(); setRealtimeRevision((revision) => revision + 1); }, 15_000);
    return () => { active = false; stream.close(); window.clearInterval(fallback); };
  }, [tournamentId]);

  async function saveDetails() {
    if (!tournament || !name.trim() || !location.trim()) {
      setError("Tên giải và địa điểm không được để trống.");
      return;
    }
    if ((startDate && endDate && startDate > endDate) || !Number.isInteger(Number(maxTeams)) || Number(maxTeams) < 2) {
      setError("Ngày kết thúc phải sau ngày bắt đầu và giới hạn đội phải từ 2 trở lên.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { tournament: updated } = await updateTournament(tournament.id, {
        name: name.trim(),
        description: description.trim(),
        location: location.trim(),
        startDate,
        endDate,
        maxTeams: Number(maxTeams),
        competitionFormat: editCompetitionFormat,
        competitionConfig: {
          ...(({ groupDrawMethod: _groupDrawMethod, ...config }) => config)(editCompetitionConfig as TournamentCompetitionConfig & { groupDrawMethod?: unknown }),
          groupCount: editCompetitionFormat === "GROUP_AND_KNOCKOUT" && editCompetitionConfig.groupCountMode === "FIXED" ? editCompetitionConfig.groupCount : null,
        },
        roundRobinLegs: editRoundRobinLegs,
        maxTeamsPerGroup: editCompetitionFormat === "GROUP_AND_KNOCKOUT" ? editMaxTeamsPerGroup : null,
        advancingTeamsPerGroup: editAdvancingTeams,
        knockoutDecisionMethod: editKnockoutDecision,
        extraTimeMinutes: editExtraTimeMinutes,
      });
      setTournament(updated);
      setEditingDetails(false);
      onNotice?.("Đã cập nhật thông tin giải đấu.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể cập nhật giải đấu.");
    } finally {
      setSaving(false);
    }
  }

  function beginEditDetails() {
    if (!tournament) return;
    setName(tournament.name);
    setDescription(tournament.description ?? "");
    setLocation(tournament.location ?? "");
    setStartDate(dateInputValue(tournament.startDate));
    setEndDate(dateInputValue(tournament.endDate));
    setMaxTeams(String(tournament.maxTeams));
    setEditCompetitionFormat(tournament.competitionFormat ?? "ROUND_ROBIN");
    setEditCompetitionConfig({ ...defaultTournamentCompetitionConfig, ...tournament.rules?.competitionConfig });
    setEditRoundRobinLegs(tournament.rules?.roundRobinLegs ?? 1);
    setEditMaxTeamsPerGroup(tournament.rules?.maxTeamsPerGroup ?? 4);
    setEditAdvancingTeams(tournament.rules?.advancingTeamsPerGroup ?? 2);
    setEditKnockoutDecision(tournament.rules?.knockoutDecisionMethod ?? "PENALTIES_ONLY");
    setEditExtraTimeMinutes(tournament.rules?.extraTimeMinutes ?? 30);
    setEditingDetails(true);
  }

  async function saveRegulation(regulationId?: string) {
    if (!regulationTitle.trim() || !regulationContent.trim()) {
      setError("Tiêu đề và nội dung điều lệ không được để trống.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (regulationId) {
        const { regulation } = await updateTournamentRegulation(regulationId, {
          title: regulationTitle.trim(),
          content: regulationContent.trim(),
        });
        setRegulations((current) => current.map((item) => item.id === regulation.id ? regulation : item));
        onNotice?.("Đã cập nhật điều lệ.");
      } else {
        const { regulation } = await createTournamentRegulation(tournamentId, {
          title: regulationTitle.trim(),
          content: regulationContent.trim(),
        });
        setRegulations((current) => [...current, regulation]);
        onNotice?.("Đã thêm điều lệ.");
      }
      setEditingRegulationId("");
      setRegulationTitle("");
      setRegulationContent("");
      setCreatingRegulation(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể lưu điều lệ.");
    } finally {
      setSaving(false);
    }
  }

  async function removeRegulation(regulationId: string) {
    if (!await confirm({ title: "Xóa điều lệ khỏi bản nháp?", description: "Điều lệ này sẽ bị xóa khỏi bản nháp hiện tại của giải đấu.", confirmLabel: "Xóa điều lệ", danger: true })) return;
    setSaving(true);
    setError(null);
    try {
      await deleteTournamentRegulation(regulationId);
      setRegulations((current) => current.filter((item) => item.id !== regulationId));
      onNotice?.("Đã xóa điều lệ.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể xóa điều lệ.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <section className="panel data-panel"><p>Đang tải thông tin chi tiết giải đấu…</p></section>;
  if (error) return <section className="panel data-panel"><p className="form-error" role="alert">{error}</p></section>;
  if (!tournament) return null;

  const rules = tournament.rules;
  const allowedSchools = (tournament.allowedInstitutionIds ?? [])
    .map((id) => institutions.find((institution) => institution.id === id)?.name)
    .filter((name): name is string => Boolean(name));
  const allowedLevels = tournament.allowedInstitutionLevels ?? ["UNIVERSITY", "COLLEGE"];

  return (
    <section className="panel data-panel tournament-detail">
      <div className="panel-heading panel-heading-wrap">
        <div>
          <span className="eyebrow">CHI TIẾT GIẢI ĐẤU</span>
          <h2>{tournament.name}</h2>
          <span className="tournament-status-chip">{tournament.status.replaceAll("_", " ")}</span>
        </div>
        <div className="tournament-detail-actions">
          {canManage && tournament.status === "DRAFT" && !editingDetails ? (
            <button className="button button-secondary" onClick={beginEditDetails} type="button">Chỉnh sửa thông tin</button>
          ) : null}
          <button className="text-button" onClick={onClose} type="button">Đóng</button>
        </div>
      </div>
      {tournament.description ? <p>{tournament.description}</p> : null}
      {canManage && tournament.status !== "DRAFT" ? (
      <p className="btc-tournament-hint">Thông tin cấu trúc và điều lệ đã khóa sau khi giải rời bản nháp để tránh ảnh hưởng đăng ký, chia bảng và lịch thi đấu.</p>
      ) : null}
      {editingDetails ? (
      <div className="tournament-edit-form">
        <label><span>Tên giải *</span><input value={name} maxLength={255} onChange={(event) => setName(event.target.value)} /></label>
        <label><span>Địa điểm *</span><input value={location} maxLength={255} onChange={(event) => setLocation(event.target.value)} /></label>
        <label><span>Ngày bắt đầu</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
        <label><span>Ngày kết thúc</span><input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
        <label><span>Số đội tối đa *</span><input type="number" min="2" max="256" value={maxTeams} onChange={(event) => setMaxTeams(event.target.value)} /></label>
        <label><span>Thể thức thi đấu</span><select value={editCompetitionFormat ?? "ROUND_ROBIN"} onChange={(event) => setEditCompetitionFormat(event.target.value as NonNullable<Tournament["competitionFormat"]>)}>
          <option value="ROUND_ROBIN">Vòng tròn</option><option value="GROUP_AND_KNOCKOUT">Vòng bảng và loại trực tiếp</option><option value="KNOCKOUT">Loại trực tiếp</option>
        </select></label>
        {editCompetitionFormat === "ROUND_ROBIN" ? <label><span>Số lượt vòng tròn</span><select value={editRoundRobinLegs} onChange={(event) => setEditRoundRobinLegs(Number(event.target.value) as 1 | 2)}><option value={1}>1 lượt</option><option value={2}>2 lượt</option></select></label> : null}
        {editCompetitionFormat === "GROUP_AND_KNOCKOUT" ? <>
          <label><span>Số bảng</span><select value={editCompetitionConfig.groupCountMode} onChange={(event) => setEditCompetitionConfig((current) => ({ ...current, groupCountMode: event.target.value as TournamentCompetitionConfig["groupCountMode"] }))}><option value="AUTO_BY_CAPACITY">Tự tính theo sức chứa</option><option value="FIXED">Số bảng cố định</option></select></label>
          <label><span>Số đội tối đa mỗi bảng</span><input type="number" min={3} max={Number(maxTeams) || 256} value={editMaxTeamsPerGroup} onChange={(event) => setEditMaxTeamsPerGroup(Math.max(3, Number(event.target.value) || 3))} /></label>
          {editCompetitionConfig.groupCountMode === "FIXED" ? <label><span>Số bảng cố định</span><input type="number" min={2} max={Math.max(2, Math.floor((Number(maxTeams) || 2) / 2))} value={editCompetitionConfig.groupCount ?? 4} onChange={(event) => setEditCompetitionConfig((current) => ({ ...current, groupCount: Math.max(2, Number(event.target.value) || 2) }))} /></label> : null}
          <label><span>Số lượt vòng bảng</span><select value={editRoundRobinLegs} onChange={(event) => setEditRoundRobinLegs(Number(event.target.value) as 1 | 2)}><option value={1}>1 lượt</option><option value={2}>2 lượt</option></select></label>
          <label><span>Số đội đi tiếp mỗi bảng</span><input type="number" min={1} max={Math.max(1, editMaxTeamsPerGroup - 1)} value={editAdvancingTeams} onChange={(event) => setEditAdvancingTeams(Math.max(1, Number(event.target.value) || 1))} /></label>
          <label><span>Tách đội cùng trường</span><select value={editCompetitionConfig.sameInstitutionPolicy} onChange={(event) => setEditCompetitionConfig((current) => ({ ...current, sameInstitutionPolicy: event.target.value as TournamentCompetitionConfig["sameInstitutionPolicy"] }))}><option value="NONE">Không áp dụng</option><option value="PREFER_SEPARATE">Ưu tiên</option><option value="REQUIRE_SEPARATE">Bắt buộc</option></select></label>
          <label><span>Ghép nhánh playoff</span><select value={editCompetitionConfig.knockoutPairing} onChange={(event) => setEditCompetitionConfig((current) => ({ ...current, knockoutPairing: event.target.value as TournamentCompetitionConfig["knockoutPairing"] }))}><option value="GROUP_RANK">Theo thứ hạng bảng</option><option value="FIXED_CROSSOVER">Ghép chéo cố định</option><option value="REDRAW">Bốc thăm lại</option></select></label>
        </> : null}
        {editCompetitionFormat !== "ROUND_ROBIN" ? <>
          <label><span>Số trận mỗi cặp knockout</span><select value={editCompetitionConfig.knockoutLegs} onChange={(event) => setEditCompetitionConfig((current) => ({ ...current, knockoutLegs: Number(event.target.value) as 1 | 2 }))}><option value={1}>1 trận</option><option value={2}>2 lượt</option></select></label>
          <label><span>Tranh hạng ba</span><select value={editCompetitionConfig.thirdPlaceMatch ? "YES" : "NO"} onChange={(event) => setEditCompetitionConfig((current) => ({ ...current, thirdPlaceMatch: event.target.value === "YES" }))}><option value="NO">Không</option><option value="YES">Có</option></select></label>
          <label><span>Phân định hòa</span><select value={editKnockoutDecision} onChange={(event) => setEditKnockoutDecision(event.target.value as NonNullable<Tournament["rules"]>["knockoutDecisionMethod"])}><option value="PENALTIES_ONLY">Luân lưu trực tiếp</option><option value="EXTRA_TIME_THEN_PENALTIES">Hiệp phụ rồi luân lưu</option></select></label>
        </> : null}
        <label><span>Khung giờ bắt đầu</span><input type="time" value={editCompetitionConfig.schedulingStartTime} onChange={(event) => setEditCompetitionConfig((current) => ({ ...current, schedulingStartTime: event.target.value }))} /></label>
        <label><span>Khung giờ kết thúc</span><input type="time" value={editCompetitionConfig.schedulingEndTime} onChange={(event) => setEditCompetitionConfig((current) => ({ ...current, schedulingEndTime: event.target.value }))} /></label>
        <label className="tournament-edit-wide"><span>Mô tả</span><textarea value={description} rows={3} onChange={(event) => setDescription(event.target.value)} /></label>
        <div className="draw-actions tournament-edit-wide">
          <button className="button button-primary" type="button" disabled={saving} onClick={() => void saveDetails()}>Lưu thông tin</button>
          <button className="button button-secondary" type="button" disabled={saving} onClick={() => { setEditingDetails(false); setName(tournament.name); setDescription(tournament.description ?? ""); setLocation(tournament.location ?? ""); setStartDate(dateInputValue(tournament.startDate)); setEndDate(dateInputValue(tournament.endDate)); setMaxTeams(String(tournament.maxTeams)); }}>Hủy</button>
        </div>
      </div>
      ) : null}
      <div className="tournament-detail-grid">
        <article><span>Trạng thái</span><strong>{tournament.status.replaceAll("_", " ")}</strong></article>
        <article><span>Phạm vi</span><strong>{formatLabels[tournament.scope ?? ""] ?? "Chưa cập nhật"}</strong></article>
        <article><span>Thể thức bóng đá</span><strong>{tournament.footballFormat ? `${tournament.footballFormat} người` : "Chưa cập nhật"}</strong></article>
        <article><span>Thể thức thi đấu</span><strong>{formatLabels[tournament.competitionFormat ?? ""] ?? "Chưa cập nhật"}</strong></article>
        <article><span>Thời gian</span><strong>{dateLabel(tournament.startDate)} – {dateLabel(tournament.endDate)}</strong></article>
        <article><span>Địa điểm</span><strong>{tournament.location || "Chưa cập nhật"}</strong></article>
        <article><span>Số đội</span><strong>{tournament.minTeams ?? "—"} – {tournament.maxTeams} đội</strong></article>
        <article><span>Quy mô đội</span><strong>{tournament.minPlayers ?? "—"} – {tournament.maxPlayersPerTeam ?? "—"} cầu thủ</strong></article>
        <article><span>Ban tổ chức</span><strong>{tournament.organizerName || "Chưa cập nhật"}</strong></article>
        <article><span>Liên hệ</span><strong>{[tournament.organizerContactName, tournament.organizerEmail, tournament.organizerPhone].filter(Boolean).join(" · ") || "Chưa cập nhật"}</strong></article>
      </div>
      {tournament.scope === "INTER_SCHOOL" ? (
        <div className="tournament-detail-section tournament-scope-section">
          <h3>Phạm vi trường tham gia</h3>
          <p>
            <strong>Bậc đào tạo:</strong>{" "}
            {allowedLevels.map((level) => level === "UNIVERSITY" ? "Đại học" : "Cao đẳng").join(" và ")}
          </p>
          <p>
            <strong>Trường:</strong>{" "}
            {tournament.allInstitutionsAllowed
              ? "Tất cả trường thuộc bậc đào tạo đã chọn"
              : allowedSchools.join(", ") || "Chưa cấu hình"}
          </p>
          <p>
            <strong>Giới hạn mỗi trường:</strong>{" "}
            {tournament.defaultMaxTeamsPerInstitution
              ? `${tournament.defaultMaxTeamsPerInstitution} đội (mặc định)`
              : "Không giới hạn mặc định"}
          </p>
          {tournament.institutionTeamLimits?.length ? (
            <ul>
              {tournament.institutionTeamLimits.map((limit) => (
                <li key={limit.institutionId}>
                  {institutions.find((institution) => institution.id === limit.institutionId)?.name ?? "Trường"}
                  {" — "}
                  {limit.maxTeams === null ? "Không giới hạn" : `${limit.maxTeams} đội`}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <div className="tournament-detail-section tournament-scope-section">
          <h3>Phạm vi trường tham gia</h3>
          <div className="tournament-detail-grid">
            <article><span>Hình thức</span><strong>{formatLabels[tournament.scope ?? ""] ?? "Trong phạm vi trường"}</strong></article>
            <article><span>Trường được tham gia</span><strong>{allowedSchools.join(", ") || "Trường tổ chức"}</strong></article>
            <article><span>Giới hạn đội mỗi trường</span><strong>{tournament.defaultMaxTeamsPerInstitution ? `${tournament.defaultMaxTeamsPerInstitution} đội` : "Theo điều lệ giải"}</strong></article>
          </div>
        </div>
      )}

      <div className="tournament-detail-section">
        <h3>Điều kiện và quy định thi đấu</h3>
        {rules ? (
          <>
            <p className="tournament-eligibility-summary">{rules.eligibilityDescription || "Chưa công bố điều kiện tư cách."}</p>
            <div className="tournament-detail-grid">
              <article><span>Điểm thắng / hòa / thua</span><strong>{rules.pointsForWin} / {rules.pointsForDraw} / {rules.pointsForLoss}</strong></article>
              <article><span>Tiêu chí xếp hạng</span><strong>{(tournament.rankingCriteria ?? []).map((item) => item.replaceAll("_", " ")).join(" → ") || "Chưa công bố"}</strong></article>
              <article><span>Thời lượng trận</span><strong>{rules.matchDurationMinutes} phút</strong></article>
              <article><span>Thời gian nghỉ tối thiểu</span><strong>{rules.minimumRestMinutes} phút</strong></article>
              <article><span>Thẻ vàng treo giò</span><strong>{rules.yellowCardsForSuspension} thẻ · nghỉ {rules.suspensionMatches} trận</strong></article>
              <article><span>Thời hạn khiếu nại</span><strong>{rules.complaintWindowHours} giờ</strong></article>
              <article><span>Đội đi tiếp mỗi bảng</span><strong>{rules.advancingTeamsPerGroup}</strong></article>
              <article><span>Xử lý bỏ cuộc</span><strong>{formatLabels[rules.forfeitPolicy] ?? rules.forfeitPolicy} ({rules.forfeitWinnerScore}–{rules.forfeitLoserScore})</strong></article>
            </div>
          </>
        ) : <p>Ban tổ chức chưa công bố bộ quy tắc chi tiết.</p>}
      </div>

      {tournament ? <PublicTournamentCompetitionPanel
        tournament={tournament}
        draw={publishedDraw}
        drawLoading={drawLoading}
        drawError={drawError}
        liveDraw={liveDraw}
        liveConnection={liveConnection}
        fixtures={publicFixtures}
        fixturesLoading={fixturesLoading}
        fixturesError={fixturesError}
        teams={participatingTeams}
        results={publicResults}
        drawTestState={drawTestState.publication || (drawTestState.directSession && typeof drawTestState.directSession.status === "string" && drawTestState.directSession.status !== "WAITING") ? { ...drawTestState, step5: publishedTestSchedule ?? drawTestState.step5 } : null}
      /> : null}
      {drawTestError || testScheduleError ? <p className="form-error" role="alert">Không tải đủ dữ liệu kiểm thử công khai: {[drawTestError, testScheduleError].filter(Boolean).join(" · ")}</p> : null}

      <div className="tournament-detail-section">
        <h3>Đội tham gia đã được duyệt</h3>
        {participatingTeams.length ? <div className="tournament-public-team-grid">
          {participatingTeams.map((team) => <article className="tournament-public-team" key={team.id}>
            {team.logoUrl ? <img src={team.logoUrl} alt="" /> : <span className="tournament-public-team-mark">♧</span>}
            <div><strong>{team.name}</strong><span>{team.institutionName ?? "Chưa xác định trường"}</span>{team.unitName ? <small>{team.unitName}</small> : null}</div>
          </article>)}
        </div> : <p>Chưa có đội nào được duyệt tham gia giải.</p>}
      </div>

      {tournament.competitionFormat !== "KNOCKOUT" && tournament.competitionFormat !== "GROUP_AND_KNOCKOUT" ? <div className="tournament-detail-section">
        <h3>Bảng xếp hạng chính thức</h3>
        {publicStandings.length ? <div className="tournament-public-standings">
          <div className="tournament-public-standing tournament-public-standing-head"><span>Hạng</span><span>Đội</span><span>Đ</span><span>HS</span><span>Điểm</span></div>
          {[...publicStandings].sort((a, b) => b.points - a.points || b.goalDifference - a.goalDifference || b.goalsFor - a.goalsFor).map((standing, index) => <div className="tournament-public-standing" key={standing.id}>
            <strong>{index + 1}</strong><strong>{drawTeamNames.get(standing.teamId) ?? `Đội ${standing.teamId.slice(0, 6)}`}</strong><span>{standing.played}</span><span>{standing.goalDifference > 0 ? "+" : ""}{standing.goalDifference}</span><strong>{standing.points}</strong>
          </div>)}
        </div> : <p>Bảng xếp hạng sẽ hiển thị khi có kết quả được BTC công nhận.</p>}
      </div> : null}

      <div className="tournament-detail-section">
        <h3>Thời gian đăng ký</h3>
        {tournament.registrationPeriods?.length ? (
          <ul className="detail-list">
            {tournament.registrationPeriods.map((period) => (
              <li key={period.id}><strong>{period.name}</strong><span>{dateLabel(period.startDate)} – {dateLabel(period.endDate)}</span></li>
            ))}
          </ul>
        ) : <p>Chưa có đợt đăng ký được công bố.</p>}
      </div>

      <div className="tournament-detail-section">
        <div className="panel-heading panel-heading-wrap">
          <div><span className="eyebrow">QUY ĐỊNH CHÍNH THỨC</span><h3>Điều lệ giải</h3></div>
          <div className="tournament-regulation-actions">
            {versions.length ? <button className="secondary-button" type="button" onClick={() => setHistoryOpen(true)}>Lịch sử chỉnh sửa <span>◷</span></button> : null}
            {canManage && tournament.status === "DRAFT" && !creatingRegulation ? (
              <button className="primary-button" type="button" onClick={() => { setCreatingRegulation(true); setEditingRegulationId(""); setRegulationTitle(""); setRegulationContent(""); }}>Thêm điều lệ <span>＋</span></button>
            ) : null}
          </div>
        </div>
        {canManage && tournament.status !== "DRAFT" ? <p className="muted">Điều lệ chỉ được chỉnh sửa khi giải ở trạng thái bản nháp.</p> : null}
        {creatingRegulation ? (
          <div className="tournament-edit-form">
            <label><span>Tiêu đề *</span><input value={regulationTitle} onChange={(event) => setRegulationTitle(event.target.value)} maxLength={255} /></label>
            <label className="tournament-edit-wide"><span>Nội dung *</span><textarea value={regulationContent} rows={5} onChange={(event) => setRegulationContent(event.target.value)} /></label>
            <div className="draw-actions tournament-edit-wide">
              <button className="button button-primary" type="button" disabled={saving} onClick={() => void saveRegulation()}>Lưu điều lệ</button>
              <button className="button button-secondary" type="button" disabled={saving} onClick={() => setCreatingRegulation(false)}>Hủy</button>
            </div>
          </div>
        ) : null}
        {regulations.length ? regulations.map((regulation) => (
          <article className="regulation-card" key={regulation.id}>
            {editingRegulationId === regulation.id ? (
              <div className="tournament-edit-form">
                <label><span>Tiêu đề *</span><input value={regulationTitle} onChange={(event) => setRegulationTitle(event.target.value)} maxLength={255} /></label>
                <label className="tournament-edit-wide"><span>Nội dung *</span><textarea value={regulationContent} rows={5} onChange={(event) => setRegulationContent(event.target.value)} /></label>
                <div className="draw-actions tournament-edit-wide">
                  <button className="button button-primary" type="button" disabled={saving} onClick={() => void saveRegulation(regulation.id)}>Lưu điều lệ</button>
                  <button className="button button-secondary" type="button" disabled={saving} onClick={() => setEditingRegulationId("")}>Hủy</button>
                </div>
              </div>
            ) : (
              <>
                <h4>{regulation.title}</h4>
                <p>{regulation.content}</p>
              </>
            )}
            <small>Cập nhật {dateLabel(regulation.updatedAt)}</small>
            {canManage && tournament.status === "DRAFT" && editingRegulationId !== regulation.id ? (
              <div className="draw-actions">
                <button className="button button-secondary" type="button" onClick={() => { setEditingRegulationId(regulation.id); setCreatingRegulation(false); setRegulationTitle(regulation.title); setRegulationContent(regulation.content); }}>Sửa điều lệ</button>
                <button className="button button-secondary" type="button" disabled={saving} onClick={() => void removeRegulation(regulation.id)}>Xóa điều lệ</button>
              </div>
            ) : null}
          </article>
        )) : <p>Ban tổ chức chưa đăng tải nội dung điều lệ.</p>}
      </div>

      <MatchOperationRulesSection key={tournament.id} tournament={tournament} canManage={canManage} />
      <Modal open={historyOpen} title="Lịch sử chỉnh sửa điều lệ" description="Chọn một phiên bản để xem nội dung điều lệ tại thời điểm đó." onClose={() => setHistoryOpen(false)} className="regulation-history-modal">
        {versions.length ? <div className="regulation-version-list">
          {[...versions].sort((a, b) => b.version - a.version).map((version) => (
            <button className="regulation-version-item" key={version.id} type="button" onClick={() => { setSelectedVersion(version); setHistoryOpen(false); }}>
              <span className="regulation-version-badge">{version.version}</span>
              <span className="regulation-version-copy"><strong>Lần chỉnh sửa {version.version}</strong><span>{version.title}</span><small>Chỉnh lúc {new Date(version.createdAt).toLocaleString("vi-VN")} · Hiệu lực {dateLabel(version.effectiveDate)}</small></span>
              <span className="regulation-version-arrow" aria-hidden="true">›</span>
            </button>
          ))}
        </div> : <div className="empty-state"><p>Chưa có phiên bản điều lệ được lưu.</p></div>}
      </Modal>
      <Modal open={selectedVersion !== null} title={selectedVersion ? `Điều lệ lần chỉnh sửa ${selectedVersion.version}` : "Chi tiết phiên bản"} description={selectedVersion ? `${selectedVersion.title} · Chỉnh lúc ${new Date(selectedVersion.createdAt).toLocaleString("vi-VN")}` : undefined} onClose={() => setSelectedVersion(null)} className="regulation-version-detail-modal">
        {selectedVersion ? <div className="regulation-version-detail">
          <div className="regulation-version-meta"><span>Phiên bản <strong>{selectedVersion.version}</strong></span><span>Ngày hiệu lực <strong>{dateLabel(selectedVersion.effectiveDate)}</strong></span></div>
          <h3>{selectedVersion.title}</h3>
          <div className="regulation-version-content">{selectedVersion.content}</div>
        </div> : null}
      </Modal>
    </section>
  );
}
