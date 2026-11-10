import { useEffect, useMemo, useState } from "react";
import {
  confirmTournamentDraw,
  generateTournamentFixtures,
  getDrawManagement,
  previewTournamentDraw,
  publishTournamentDraw,
  saveTournamentDrawDraft,
  type DrawPlanInput,
  type DrawPreview,
  type DrawVersion,
} from "../api/competition";

type Props = {
  tournaments: Array<{ id: string; name: string; status: string }>;
  onNotice: (message: string) => void;
};

const drawStatusLabels: Record<DrawVersion["status"], string> = {
  DRAFT: "Bản nháp",
  CONFIRMED: "Đã xác nhận",
  PUBLISHED: "Đã công bố",
  ARCHIVED: "Đã lưu lịch sử",
};

export function DrawWorkflowPanel({ tournaments, onNotice }: Props) {
  const [tournamentId, setTournamentId] = useState("");
  const [eligibleTeams, setEligibleTeams] = useState<Awaited<ReturnType<typeof getDrawManagement>>["eligibleTeams"]>([]);
  const [ineligibleTeams, setIneligibleTeams] = useState<Awaited<ReturnType<typeof getDrawManagement>>["ineligibleTeams"]>([]);
  const [history, setHistory] = useState<DrawVersion[]>([]);
  const [preview, setPreview] = useState<DrawPreview | null>(null);
  const [groupCount, setGroupCount] = useState(2);
  const [method, setMethod] = useState<DrawPlanInput["method"]>("RANDOM");
  const [noSameInstitution, setNoSameInstitution] = useState(false);
  const [manualGroupByTeam, setManualGroupByTeam] = useState<Record<string, number>>({});
  const [seedGroupByTeam, setSeedGroupByTeam] = useState<Record<string, number>>({});
  const [changeReason, setChangeReason] = useState("");
  const [legs, setLegs] = useState<1 | 2>(1);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedTournament = tournaments.find((tournament) => tournament.id === tournamentId);
  const latestVersion = history[0] ?? null;
  const maxGroupCount = Math.max(1, Math.floor(eligibleTeams.length / 2));
  const seedGroupCount = Math.max(1, Math.ceil(eligibleTeams.length / Math.max(groupCount, 1)));

  useEffect(() => {
    if (!tournaments.some((tournament) => tournament.id === tournamentId)) {
      setTournamentId(tournaments[0]?.id ?? "");
    }
  }, [tournamentId, tournaments]);

  useEffect(() => {
    if (!tournamentId) {
      setEligibleTeams([]);
      setIneligibleTeams([]);
      setHistory([]);
      setPreview(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    getDrawManagement(tournamentId).then((result) => {
      if (!active) return;
      setEligibleTeams(result.eligibleTeams);
      setIneligibleTeams(result.ineligibleTeams);
      setHistory(result.history);
      setGroupCount((current) => Math.min(Math.max(current, 1), Math.max(1, Math.floor(result.eligibleTeams.length / 2))));
      setPreview(result.latestVersion ? {
        eligibleTeams: result.eligibleTeams,
        ineligibleTeams: result.ineligibleTeams,
        groups: result.latestVersion.groups,
        unassignedTeamIds: [],
      } : null);
    }).catch((err: unknown) => {
      if (active) setError(err instanceof Error ? err.message : "Không tải được dữ liệu chia bảng.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [tournamentId]);

  const manualGroups = useMemo(() => {
    return Array.from({ length: groupCount }, (_, index) => ({
      name: `Bảng ${String.fromCharCode(65 + index)}`,
      teamIds: eligibleTeams
        .filter((team, teamIndex) => (manualGroupByTeam[team.teamId] ?? teamIndex % groupCount) === index)
        .map((team) => team.teamId),
    }));
  }, [eligibleTeams, groupCount, manualGroupByTeam]);

  function makePlan(): DrawPlanInput {
    const plan: DrawPlanInput = {
      method,
      groupCount,
      noSameInstitution,
      changeReason: changeReason.trim() || undefined,
    };
    if (method === "MANUAL") {
      plan.groups = manualGroups;
    }
    if (method === "SEEDED") {
      plan.seedings = eligibleTeams.map((team, index) => ({
        teamId: team.teamId,
        seedGroup: seedGroupByTeam[team.teamId] ?? (index % seedGroupCount) + 1,
      }));
    }
    return plan;
  }

  async function handlePreview() {
    if (!tournamentId) return;
    setSubmitting(true);
    setError(null);
    try {
      setPreview(await previewTournamentDraw(tournamentId, makePlan()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tạo được phương án chia bảng.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveDraft() {
    if (!tournamentId) return;
    setSubmitting(true);
    setError(null);
    try {
      const { draw } = await saveTournamentDrawDraft(tournamentId, makePlan());
      setHistory((current) => [draw, ...current.filter((item) => item.id !== draw.id)]);
      setPreview({
        eligibleTeams,
        ineligibleTeams,
        groups: draw.groups,
        unassignedTeamIds: [],
      });
      onNotice(`Đã lưu bản nháp chia bảng phiên bản ${draw.version}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không lưu được bản nháp chia bảng.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirm() {
    if (!tournamentId) return;
    setSubmitting(true);
    setError(null);
    try {
      const { draw } = await confirmTournamentDraw(tournamentId);
      setHistory((current) => [draw, ...current.filter((item) => item.id !== draw.id)]);
      onNotice("Đã xác nhận phương án chia bảng.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không xác nhận được phương án chia bảng.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePublish() {
    if (!tournamentId) return;
    setSubmitting(true);
    setError(null);
    try {
      const { draw } = await publishTournamentDraw(tournamentId);
      setHistory((current) => [
        draw,
        ...current.filter((item) => item.id !== draw.id).map((item) =>
          item.status === "PUBLISHED" ? { ...item, status: "ARCHIVED" as const } : item,
        ),
      ]);
      onNotice("Đã công bố kết quả chia bảng.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không công bố được kết quả chia bảng.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGenerateFixtures() {
    if (!tournamentId) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await generateTournamentFixtures(tournamentId, legs);
      onNotice(
        result.alreadyGenerated
          ? `Lịch đã được tạo trước đó (${result.matches.length} trận); không tạo trùng.`
          : `Đã tạo ${result.matches.length} trận vòng bảng.${result.knockoutStagePending ? " Vòng knock-out cần được lập sau khi chốt đội đi tiếp." : ""}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tạo được lịch vòng bảng.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="panel data-panel draw-workflow-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">QUẢN LÝ GIẢI ĐẤU</p>
          <h2>Chia bảng và công bố</h2>
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
          {loading ? <p className="muted">Đang tải đội và lịch sử chia bảng…</p> : null}
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          {selectedTournament ? (
            <p className="muted">Trạng thái giải: {selectedTournament.status}. Chỉ đội đã duyệt và đủ roster mới được chia bảng.</p>
          ) : null}
          <div className="draw-summary">
            <span>Đủ điều kiện: <strong>{eligibleTeams.length}</strong></span>
            <span>Chưa đủ điều kiện: <strong>{ineligibleTeams.length}</strong></span>
            <span>Phiên bản mới nhất: <strong>{latestVersion ? `#${latestVersion.version} · ${drawStatusLabels[latestVersion.status]}` : "Chưa có"}</strong></span>
          </div>
          <div className="draw-controls">
            <label className="draw-field">
              <span>Phương thức</span>
              <select value={method} onChange={(event) => setMethod(event.target.value as DrawPlanInput["method"])}>
                <option value="RANDOM">Bốc thăm ngẫu nhiên</option>
                <option value="SEEDED">Chia theo nhóm hạt giống</option>
                <option value="MANUAL">Phân bảng thủ công</option>
              </select>
            </label>
            <label className="draw-field">
              <span>Số bảng</span>
              <input
                type="number"
                min={1}
                max={maxGroupCount}
                value={groupCount}
                onChange={(event) => {
                  const next = Math.min(Math.max(Number(event.target.value) || 1, 1), maxGroupCount);
                  setGroupCount(next);
                }}
              />
            </label>
            <label className="draw-check">
              <input
                type="checkbox"
                checked={noSameInstitution}
                onChange={(event) => setNoSameInstitution(event.target.checked)}
              />
              <span>Không xếp đội cùng trường vào một bảng</span>
            </label>
          </div>
          {method === "MANUAL" ? (
            <div className="draw-team-editor">
              {eligibleTeams.map((team, index) => (
                <label key={team.teamId} className="draw-team-row">
                  <span>{team.name} <small>{team.institutionName ?? "Chưa có trường"}</small></span>
                  <select
                    value={manualGroupByTeam[team.teamId] ?? index % groupCount}
                    onChange={(event) => setManualGroupByTeam((current) => ({
                      ...current,
                      [team.teamId]: Number(event.target.value),
                    }))}
                  >
                    {manualGroups.map((group, groupIndex) => (
                      <option key={groupIndex} value={groupIndex}>{group.name}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          ) : null}
          {method === "SEEDED" ? (
            <div className="draw-team-editor">
              {eligibleTeams.map((team, index) => (
                <label key={team.teamId} className="draw-team-row">
                  <span>{team.name} <small>{team.institutionName ?? "Chưa có trường"}</small></span>
                  <select
                    value={seedGroupByTeam[team.teamId] ?? (index % seedGroupCount) + 1}
                    onChange={(event) => setSeedGroupByTeam((current) => ({
                      ...current,
                      [team.teamId]: Number(event.target.value),
                    }))}
                  >
                    {Array.from({ length: seedGroupCount }, (_, seedIndex) => (
                      <option key={seedIndex} value={seedIndex + 1}>Nhóm hạt giống {seedIndex + 1}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          ) : null}
          {(latestVersion?.status === "PUBLISHED" || latestVersion?.status === "CONFIRMED") ? (
            <label className="draw-field draw-change-reason">
              <span>Lý do tạo phiên bản thay đổi *</span>
              <input
                value={changeReason}
                maxLength={500}
                onChange={(event) => setChangeReason(event.target.value)}
                placeholder="Nhập lý do và căn cứ thay đổi"
              />
            </label>
          ) : null}
          <div className="draw-actions">
            <button type="button" className="button button-secondary" disabled={submitting || loading} onClick={() => void handlePreview()}>
              Xem trước
            </button>
            <button type="button" className="button button-primary" disabled={submitting || loading || eligibleTeams.length < 2} onClick={() => void handleSaveDraft()}>
              Lưu bản nháp
            </button>
            {latestVersion?.status === "DRAFT" ? (
              <button type="button" className="button button-secondary" disabled={submitting} onClick={() => void handleConfirm()}>
                Xác nhận chia bảng
              </button>
            ) : null}
            {latestVersion?.status === "CONFIRMED" ? (
              <button type="button" className="button button-primary" disabled={submitting} onClick={() => void handlePublish()}>
                Công bố
              </button>
            ) : null}
            {latestVersion?.status === "PUBLISHED" ? (
              <>
                <label className="draw-field draw-legs-field">
                  <span>Số lượt vòng bảng</span>
                  <select value={legs} onChange={(event) => setLegs(Number(event.target.value) as 1 | 2)}>
                    <option value={1}>Một lượt</option>
                    <option value={2}>Hai lượt (sân nhà/sân khách)</option>
                  </select>
                </label>
                <button type="button" className="button button-secondary" disabled={submitting} onClick={() => void handleGenerateFixtures()}>
                  Tạo trận vòng bảng
                </button>
              </>
            ) : null}
          </div>
          {preview ? (
            <div className="draw-preview">
              <h3>{latestVersion ? `Phiên bản ${latestVersion.version}` : "Phương án xem trước"}</h3>
              <div className="draw-groups">
                {preview.groups.map((group) => (
                  <section key={group.id} className="draw-group">
                    <h4>{group.name} <small>{group.assignments.length}/{group.maxTeams} đội</small></h4>
                    {group.assignments.map((assignment) => {
                      const team = eligibleTeams.find((candidate) => candidate.teamId === assignment.teamId);
                      return <p key={assignment.teamId}>{assignment.position}. {team?.name ?? assignment.teamId}</p>;
                    })}
                    {group.assignments.length === 0 ? <p className="muted">Chưa có đội</p> : null}
                  </section>
                ))}
              </div>
            </div>
          ) : null}
          <div className="draw-history">
            <h3>Lịch sử chia bảng</h3>
            {history.length === 0 ? <p className="muted">Chưa có phiên bản.</p> : history.map((version) => (
              <article key={version.id} className="draw-history-row">
                <strong>#{version.version} · {drawStatusLabels[version.status]}</strong>
                <span>{new Date(version.createdAt).toLocaleString("vi-VN")}</span>
                <span>{version.method}</span>
                {version.changeReason ? <small>{version.changeReason}</small> : null}
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
