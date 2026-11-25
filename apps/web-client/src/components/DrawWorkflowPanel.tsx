import { useCallback, useEffect, useMemo, useState } from "react";
import { API_BASE } from "../api/client";
import {
  advanceTournamentLiveDraw,
  confirmTournamentDraw,
  getDrawManagement,
  getManagedTournamentLiveDraw,
  previewTournamentDraw,
  publishTournamentDraw,
  saveTournamentDrawDraft,
  startScheduledTournamentLiveDraw,
  startTournamentLiveDraw,
  updateTournamentLiveDrawSchedule,
  controlTournamentLiveDraw,
  type DrawPlanInput,
  type DrawVersion,
  type LiveDrawScheduleInput,
  type LiveDrawSession,
  type Tournament,
} from "../api/competition";
import { DrawDemoAllocationWorkspace } from "./DrawDemoAllocationWorkspace";

type Props = {
  tournaments: Tournament[];
  onNotice: (message: string) => void;
  onContinue?: () => void;
  onLivePublished?: () => Promise<void>;
};

function balancedSizes(teamCount: number, groupCount: number): number[] {
  if (groupCount < 1) return [];
  return Array.from({ length: groupCount }, (_, index) => Math.floor(teamCount / groupCount) + (index < teamCount % groupCount ? 1 : 0));
}

export function DrawWorkflowPanel({ tournaments, onNotice, onContinue, onLivePublished }: Props) {
  const [tournamentId, setTournamentId] = useState(tournaments[0]?.id ?? "");
  const [eligibleTeams, setEligibleTeams] = useState<Awaited<ReturnType<typeof getDrawManagement>>["eligibleTeams"]>([]);
  const [history, setHistory] = useState<DrawVersion[]>([]);
  const [liveSession, setLiveSession] = useState<LiveDrawSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedTournament = tournaments.find((tournament) => tournament.id === tournamentId) ?? tournaments[0];
  const selectedId = selectedTournament?.id ?? "";
  const latestVersion = history.find((item) => item.status === "DRAFT" || item.status === "CONFIRMED")
    ?? history.find((item) => item.status === "PUBLISHED")
    ?? history[0]
    ?? null;

  useEffect(() => {
    if (!tournaments.some((item) => item.id === tournamentId)) setTournamentId(tournaments[0]?.id ?? "");
  }, [tournamentId, tournaments]);

  const loadOfficialData = useCallback(async () => {
    if (!selectedId) return;
    setLoading(true);
    setError(null);
    try {
      const [management, live] = await Promise.all([
        getDrawManagement(selectedId),
        getManagedTournamentLiveDraw(selectedId),
      ]);
      setEligibleTeams(management.eligibleTeams);
      setHistory(management.history);
      setLiveSession(live.session);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không tải được dữ liệu bốc thăm chính thức.");
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    setEligibleTeams([]);
    setHistory([]);
    setLiveSession(null);
    if (selectedId) void loadOfficialData();
  }, [selectedId, loadOfficialData]);

  useEffect(() => {
    if (!selectedId || !liveSession || !["SCHEDULED", "POSTPONED", "LIVE", "PAUSED"].includes(liveSession.status)) return;
    const refresh = () => void getManagedTournamentLiveDraw(selectedId).then(({ session }) => { if (session) setLiveSession(session); }).catch(() => undefined);
    const base = API_BASE.replace(/\/$/, "");
    const stream = new EventSource(`${base}/tournaments/${encodeURIComponent(selectedId)}/live-draw/stream`, { withCredentials: true });
    stream.onopen = refresh;
    stream.onmessage = refresh;
    const fallback = window.setInterval(refresh, 15_000);
    return () => { stream.close(); window.clearInterval(fallback); };
  }, [selectedId, liveSession?.sessionId, liveSession?.status]);

  const configuration = useMemo(() => {
    const tournament = selectedTournament;
    const rules = tournament?.rules;
    const competition = rules?.competitionConfig;
    const format = tournament?.competitionFormat ?? "ROUND_ROBIN";
    const count = eligibleTeams.length;
    const configuredCapacity = rules?.maxTeamsPerGroup ?? tournament?.maxTeamsPerGroup ?? null;
    const isHybrid = format === "GROUP_AND_KNOCKOUT";
    const isKnockout = format === "KNOCKOUT";
    const fixedGroupCount = competition?.groupCountMode === "FIXED" ? competition.groupCount : null;
    const groupCount = isHybrid
      ? fixedGroupCount ?? (configuredCapacity && count ? Math.ceil(count / configuredCapacity) : 1)
      : 1;
    const bracketCapacity = isKnockout ? 2 ** Math.ceil(Math.log2(Math.max(2, count))) : 0;
    const teamsPerGroup = isKnockout
      ? [bracketCapacity]
      : isHybrid && competition?.groupAllocation === "TOP_UP_FIRST" && configuredCapacity
        ? Array.from({ length: groupCount }, (_, index) => Math.min(configuredCapacity, Math.max(0, count - index * configuredCapacity)))
        : balancedSizes(count, groupCount);
    const sourceVersion = latestVersion ?? history[0];
    const currentLive = liveSession && !["CANCELLED"].includes(liveSession.status);
    const savedSeededTeamIds = Array.isArray(sourceVersion?.config.seededTeamIds)
      ? sourceVersion.config.seededTeamIds.filter((teamId): teamId is string => typeof teamId === "string")
      : [];
    const method = currentLive
      ? "DIRECT"
      : sourceVersion
        ? sourceVersion.method === "MANUAL" ? "MANUAL" : "RANDOM"
        : null;
    return {
      format,
      teamIds: eligibleTeams.map((team) => team.teamId),
      groupCount,
      teamsPerGroup,
      roundRobinLegs: rules?.roundRobinLegs ?? tournament?.roundRobinLegs ?? 1,
      qualifiersPerGroup: rules?.advancingTeamsPerGroup ?? 0,
      extraQualificationSlots: 0,
      knockoutPairing: competition?.knockoutPairing ?? "GROUP_RANK",
      thirdPlaceMatch: competition?.thirdPlaceMatch ?? false,
      seededTeamIds: currentLive ? liveSession?.seededTeamIds ?? savedSeededTeamIds : savedSeededTeamIds,
      separateSameInstitution: format !== "KNOCKOUT" && competition?.sameInstitutionPolicy === "REQUIRE_SEPARATE",
      sameInstitutionPolicy: competition?.sameInstitutionPolicy ?? "NONE",
      byePolicy: competition?.byePolicy ?? "AUTOMATIC",
      method,
      rulesPublished: Boolean(rules?.publishedVersion && rules.publishedVersion > 0 && rules.publishedAt),
    } as const;
  }, [selectedTournament, eligibleTeams, latestVersion, history, liveSession]);

  const canEdit = selectedTournament?.status === "ROSTER_LOCKED";

  function recordVersion(version: DrawVersion) {
    setHistory((current) => [version, ...current.filter((item) => item.id !== version.id).map((item) =>
      version.status === "PUBLISHED" && (item.status === "PUBLISHED" || item.status === "DRAFT" || item.status === "CONFIRMED")
        ? { ...item, status: "ARCHIVED" as const }
        : item,
    )]);
  }

  async function preview(plan: DrawPlanInput) {
    if (!selectedId) throw new Error("Chưa chọn giải đấu.");
    return previewTournamentDraw(selectedId, plan);
  }

  async function saveDraft(plan: DrawPlanInput) {
    if (!selectedId) throw new Error("Chưa chọn giải đấu.");
    const { draw } = await saveTournamentDrawDraft(selectedId, plan);
    recordVersion(draw);
    return draw;
  }

  async function confirmDraw(method: DrawVersion["method"]) {
    if (!selectedId) throw new Error("Chưa chọn giải đấu.");
    const { draw } = await confirmTournamentDraw(selectedId, method);
    recordVersion(draw);
    return draw;
  }

  async function publishDraw(method: DrawVersion["method"]) {
    if (!selectedId) throw new Error("Chưa chọn giải đấu.");
    const { draw } = await publishTournamentDraw(selectedId, method);
    recordVersion(draw);
    return draw;
  }

  async function startLiveDraw(plan: DrawPlanInput, schedule: LiveDrawScheduleInput) {
    if (!selectedId) throw new Error("Chưa chọn giải đấu.");
    const { session } = await startTournamentLiveDraw(selectedId, plan, schedule);
    setLiveSession(session);
    return session;
  }

  async function startScheduledLiveDraw() {
    if (!selectedId) throw new Error("Chưa chọn giải đấu.");
    const { session } = await startScheduledTournamentLiveDraw(selectedId);
    setLiveSession(session);
    return session;
  }

  async function updateLiveSchedule(status: "SCHEDULED" | "POSTPONED" | "CANCELLED", schedule?: LiveDrawScheduleInput, reason?: string) {
    if (!selectedId) throw new Error("Chưa chọn giải đấu.");
    const { session } = await updateTournamentLiveDrawSchedule(selectedId, status, schedule, reason);
    setLiveSession(session);
    return session;
  }

  async function advanceLiveDraw(expectedSequence: number, requestKey: string) {
    if (!selectedId) throw new Error("Chưa chọn giải đấu.");
    const result = await advanceTournamentLiveDraw(selectedId, expectedSequence, requestKey);
    setLiveSession(result.session);
    if (result.draw) recordVersion(result.draw);
    if (result.draw?.status === "PUBLISHED") void onLivePublished?.();
    return result;
  }

  async function controlLiveDraw(status: "PAUSED" | "LIVE") {
    if (!selectedId) throw new Error("Chưa chọn giải đấu.");
    const { session } = await controlTournamentLiveDraw(selectedId, status);
    setLiveSession(session);
    return session;
  }

  if (tournaments.length === 0) return <section className="panel data-panel draw-workflow-panel"><p className="muted">Bạn chưa được phân công quản lý giải đấu nào.</p></section>;

  return <section className="panel data-panel draw-workflow-panel draw-official-draw-workspace">
    {loading ? <p className="loading-state" role="status">Đang tải điều lệ, roster và lịch sử phân bổ từ hệ thống giải đấu…</p> : null}
    {error ? <div className="form-error" role="alert">Không tải được dữ liệu chính thức: {error}</div> : null}
    {!loading && selectedTournament ? <DrawDemoAllocationWorkspace
      key={selectedId}
      tournamentId={selectedId}
      configuration={configuration}
      teams={eligibleTeams}
      history={history}
      latestVersion={latestVersion}
      liveSession={liveSession}
      canEdit={canEdit}
      onPreview={preview}
      onSaveDraft={saveDraft}
      onConfirm={confirmDraw}
      onPublish={publishDraw}
      onStartLiveDraw={startLiveDraw}
      onStartScheduledLiveDraw={startScheduledLiveDraw}
      onUpdateLiveSchedule={updateLiveSchedule}
      onAdvanceLiveDraw={advanceLiveDraw}
      onControlLiveDraw={controlLiveDraw}
      onContinue={() => onContinue?.()}
      onNotice={onNotice}
    /> : null}
    {!loading && !selectedTournament ? <p className="muted">Không tìm thấy giải đấu được phân công.</p> : null}
  </section>;
}
