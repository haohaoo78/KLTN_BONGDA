import { useEffect, useMemo, useState } from "react";
import { getDrawTestConfiguration, type DrawCandidate, type DrawTestConfiguration } from "../api/competition";
import { ApiError } from "../api/client";
import { readDrawTestState, resetDrawTestRun, writeDrawTestState } from "../utils/drawTestStorage";
import { useDialog } from "./DialogProvider";

type Props = {
  tournamentId: string;
  teams: DrawCandidate[];
  onConfiguration: (configuration: DrawTestConfiguration | null) => void;
  onReset: (configuration: DrawTestConfiguration) => void;
};

function balancedSizes(teamCount: number, groupCount: number): number[] {
  if (groupCount < 1) return [];
  return Array.from({ length: groupCount }, (_, index) => Math.floor(teamCount / groupCount) + (index < teamCount % groupCount ? 1 : 0));
}

function withOfficialTeams(configuration: DrawTestConfiguration, teams: DrawCandidate[]): DrawTestConfiguration {
  const teamIds = teams.map((team) => team.teamId);
  const groupCount = configuration.format === "KNOCKOUT"
    ? 1
    : Math.max(1, Math.min(configuration.groupCount || 1, teamIds.length || 1));
  const existingCapacityIsValid = configuration.teamsPerGroup.length === groupCount
    && configuration.teamsPerGroup.reduce((sum, size) => sum + size, 0) === teamIds.length
    && configuration.teamsPerGroup.every((size) => Number.isInteger(size) && size >= 1);
  return {
    ...configuration,
    teamIds,
    groupCount,
    teamsPerGroup: configuration.format === "KNOCKOUT"
      ? [teamIds.length]
      : existingCapacityIsValid ? configuration.teamsPerGroup : balancedSizes(teamIds.length, groupCount),
    seedGroups: Object.fromEntries(Object.entries(configuration.seedGroups ?? {}).filter(([teamId]) => teamIds.includes(teamId))),
  };
}

export function DrawTestConfigurationPanel({ tournamentId, teams, onConfiguration, onReset }: Props) {
  const { confirm } = useDialog();
  const [enabled, setEnabled] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [saved, setSaved] = useState<DrawTestConfiguration | null>(null);
  const [draft, setDraft] = useState<DrawTestConfiguration | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const teamListKey = teams.map((team) => team.teamId).join("|");

  useEffect(() => {
    if (!tournamentId) {
      setEnabled(false); setSaved(null); setDraft(null); onConfiguration(null);
      return;
    }
    let active = true;
    setError("");
    void getDrawTestConfiguration(tournamentId).then((result) => {
      if (!active) return;
      setError("");
      setEnabled(result.enabled);
      const localConfig = readDrawTestState(tournamentId).configuration;
      const serverConfig = localConfig ?? result.defaults;
      const normalized = serverConfig ? withOfficialTeams(serverConfig, teams) : null;
      // Test defaults come from the server; allocation drafts are persisted in
      // the isolated server snapshot, with localStorage acting only as cache.
      const appliedConfig = localConfig ? withOfficialTeams(localConfig, teams) : normalized;
      if (!localConfig && appliedConfig && teams.length > 0) {
        writeDrawTestState(tournamentId, { configuration: appliedConfig });
      }
      setSaved(appliedConfig);
      setDraft(appliedConfig);
      onConfiguration(appliedConfig);
    }).catch((loadError: unknown) => {
      if (!active) return;
      setEnabled(false);
      if (!(loadError instanceof ApiError && loadError.status === 404)) {
        setError(loadError instanceof Error ? loadError.message : "Không tải được cấu hình kiểm thử từ máy chủ.");
      }
    });
    return () => { active = false; };
  }, [tournamentId, teamListKey, onConfiguration]);

  const officialTeamIds = useMemo(() => teams.map((team) => team.teamId), [teams]);
  const normalizedDraft = useMemo(() => draft ? withOfficialTeams(draft, teams) : null, [draft, teams]);
  const dirty = useMemo(() => JSON.stringify(saved) !== JSON.stringify(normalizedDraft), [saved, normalizedDraft]);
  const isHybrid = normalizedDraft?.format === "GROUP_AND_KNOCKOUT";
  const hasGroups = normalizedDraft?.format !== "KNOCKOUT";
  const teamCount = officialTeamIds.length;
  const capacitiesTotal = normalizedDraft?.teamsPerGroup.reduce((sum, size) => sum + size, 0) ?? 0;

  if (!enabled || !normalizedDraft) return error ? <p className="form-error" role="alert">Không tải được cấu hình kiểm thử: {error}</p> : null;

  function update(next: DrawTestConfiguration) {
    setDraft(next);
    setMessage(""); setError("");
  }

  function currentConfig(): DrawTestConfiguration {
    if (!normalizedDraft) throw new Error("Cấu hình kiểm thử chưa sẵn sàng.");
    return normalizedDraft;
  }

  function updateFormat(format: DrawTestConfiguration["format"]) {
    const current = currentConfig();
    const groupCount = format === "KNOCKOUT" ? 1 : Math.max(1, Math.min(current.groupCount || 1, teamCount || 1));
    update({ ...current, format, groupCount, teamsPerGroup: format === "KNOCKOUT" ? [teamCount] : balancedSizes(teamCount, groupCount) });
  }

  function updateGroupCount(value: number) {
    const current = currentConfig();
    const groupCount = Math.max(1, Math.min(Number.isFinite(value) ? value : 1, Math.max(1, teamCount)));
    update({ ...current, groupCount, teamsPerGroup: balancedSizes(teamCount, groupCount) });
  }

  function updateCapacity(index: number, value: number) {
    const current = currentConfig();
    const next = [...current.teamsPerGroup];
    next[index] = Math.max(1, Math.min(Number.isFinite(value) ? value : 1, Math.max(1, teamCount)));
    update({ ...current, teamsPerGroup: next });
  }

  async function apply() {
    const current = currentConfig();
    if (capacitiesTotal !== teamCount) { setError(`Tổng sức chứa phải bằng đúng ${teamCount} đội chính thức.`); return; }
    if (current.teamsPerGroup.some((size) => size < 1) && hasGroups) { setError("Mỗi bảng phải có ít nhất một vị trí."); return; }
    const testState = readDrawTestState(tournamentId);
    if ((testState.publication || testState.directSession || testState.fixtures.length > 0 || testState.fixturesPublishedAt) && !await confirm({ title: "Thay cấu hình kiểm thử?", description: "Đổi thể thức sẽ xóa kết quả thử nghiệm, bản nháp, lượt bốc và sơ đồ Bước 4 của kịch bản này. Cấu hình mới và danh sách đội chính thức sẽ được giữ; dữ liệu database không thay đổi.", confirmLabel: "Xóa kết quả và áp dụng" })) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const next = withOfficialTeams(current, teams);
      if (testState.publication || testState.directSession || testState.fixtures.length > 0 || testState.fixturesPublishedAt) resetDrawTestRun(tournamentId);
      writeDrawTestState(tournamentId, { configuration: next });
      setSaved(next); setDraft(next); onConfiguration(next);
      setMessage("Đã áp dụng cấu hình kiểm thử cục bộ cho toàn bộ đội chính thức. Không ghi cấu hình xuống database.");
    } catch (e) { setError(e instanceof Error ? e.message : "Không thể lưu cấu hình kiểm thử."); }
    finally { setBusy(false); }
  }

  return <section className="draw-test-config draw-test-config-compact">
    <header className="draw-test-config-head">
      <div><span className="draw-dev-badge">DEV · DỮ LIỆU CỤC BỘ</span><h3>Cấu hình thể thức kiểm thử</h3>
        <p>{teamCount} đội chính thức của giải · toàn bộ danh sách được dùng khi phân bổ.</p></div>
      <button className="button button-secondary" type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? "Thu gọn" : "Cấu hình"}</button>
    </header>
    {expanded ? <>
      <div className="draw-test-config-grid draw-test-config-grid-compact">
        <label>Thể thức thi đấu<select value={normalizedDraft.format} onChange={(event) => updateFormat(event.target.value as DrawTestConfiguration["format"])}><option value="ROUND_ROBIN">Vòng tròn</option><option value="KNOCKOUT">Loại trực tiếp</option><option value="GROUP_AND_KNOCKOUT">Kết hợp: vòng bảng + loại trực tiếp</option></select></label>
        {hasGroups ? <label>Số bảng<input type="number" min={1} max={Math.max(1, teamCount)} value={normalizedDraft.groupCount} onChange={(event) => updateGroupCount(Number(event.target.value))} /></label> : null}
        {hasGroups ? <label>Số lượt vòng bảng<select value={normalizedDraft.roundRobinLegs} onChange={(event) => update({ ...normalizedDraft, roundRobinLegs: Number(event.target.value) as 1 | 2 })}><option value={1}>Một lượt</option><option value={2}>Hai lượt</option></select></label> : null}
        {isHybrid ? <>
          <label>Đội đi tiếp mỗi bảng<input type="number" min={0} max={Math.max(1, ...normalizedDraft.teamsPerGroup)} value={normalizedDraft.qualifiersPerGroup} onChange={(event) => update({ ...normalizedDraft, qualifiersPerGroup: Math.max(0, Number(event.target.value) || 0) })} /></label>
          <label>Suất đi tiếp bổ sung<input type="number" min={0} max={teamCount} value={normalizedDraft.extraQualificationSlots} onChange={(event) => update({ ...normalizedDraft, extraQualificationSlots: Math.max(0, Number(event.target.value) || 0) })} /></label>
        </> : null}
      </div>
      {hasGroups ? <div className="draw-test-groupsizes draw-test-groupsizes-compact"><strong>Sức chứa từng bảng</strong><div>{normalizedDraft.teamsPerGroup.map((size, index) => <label key={index}>Bảng {String.fromCharCode(65 + index)}<input type="number" min={1} max={Math.max(1, teamCount)} value={size} onChange={(event) => updateCapacity(index, Number(event.target.value))} /></label>)}</div><span className={capacitiesTotal === teamCount ? "valid" : "invalid"}>{capacitiesTotal} / {teamCount} đội</span></div> : <p className="draw-test-readonly-count"><strong>{teamCount}</strong> đội · sức chứa cây đấu và BYE được tính tại giao diện phân bổ.</p>}
      {error ? <p className="inline-error" role="alert">{error}</p> : null}{message ? <p className="inline-success" role="status">{message}</p> : null}
      <div className="draw-test-config-actions"><button className="button button-primary" type="button" disabled={busy || !dirty || teamCount < 2 || (hasGroups && capacitiesTotal !== teamCount)} onClick={() => void apply()}>{busy ? "Đang áp dụng…" : "Áp dụng cấu hình"}</button><button className="button button-secondary" type="button" disabled={busy} onClick={() => onReset(normalizedDraft)}>Reset dữ liệu kiểm thử</button></div>
    </> : null}
  </section>;
}
