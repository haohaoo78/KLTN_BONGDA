import { useCallback, useEffect, useState } from "react";
import {
  createTeamRegistration,
  assignTournamentOrganizer,
  getTournamentOrganizerCandidates,
  getTournamentOrganizers,
  getMyTeamRegistration,
  getMyTeamRegistrations,
  getTournamentRegistrationOptions,
  getTournament,
  getPlayers,
  getTeam,
  getTournamentRegistrations,
  getTournamentRosters,
  createTournamentRoster,
  reviewTournamentRoster,
  updateTournamentRosterEvidence,
  deleteTournamentRoster,
  getMyManagedTeams,
  linkTeamToVerifiedSchool,
  removeTournamentOrganizer,
  updateTeamRegistration,
  type Player,
  type RosterEntry,
  type Team,
  type TeamRegistration,
  type Tournament,
  type TournamentRegistrationOption,
  type TournamentOrganizer,
} from "../api/competition";

type AssignedTournament = { id: string; name: string; status: string };

type Props = {
  mode: "captain" | "btc";
  assignedTournaments: AssignedTournament[];
  onNotice: (message: string) => void;
  initialTeamId?: string;
  initialTournamentId?: string;
};

const registrationStatusLabels: Record<TeamRegistration["status"], string> = {
  PENDING: "Chờ duyệt",
  APPROVED: "Đã duyệt",
  REJECTED: "Bị từ chối",
  WITHDRAWN: "Đã rút",
};

export function TournamentWorkflowPanel({ mode, assignedTournaments, onNotice, initialTeamId, initialTournamentId }: Props) {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [registrations, setRegistrations] = useState<TeamRegistration[]>([]);
  const [registrationReloadRevision, setRegistrationReloadRevision] = useState(0);
  const [schoolCounts, setSchoolCounts] = useState<Array<{
    institutionId: string;
    institutionName: string;
    pending: number;
    approved: number;
    total: number;
  }>>([]);
  const [registrationOptions, setRegistrationOptions] = useState<TournamentRegistrationOption[]>([]);
  const [loadingRegistrationOptions, setLoadingRegistrationOptions] = useState(false);
  const [selectedTournamentId, setSelectedTournamentId] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [registrationStatusFilter, setRegistrationStatusFilter] = useState<TeamRegistration["status"] | "">("");
  const [registrationInstitutionFilter, setRegistrationInstitutionFilter] = useState("");
  const [registrationSearch, setRegistrationSearch] = useState("");
  const [appliedRegistrationSearch, setAppliedRegistrationSearch] = useState("");
  const [selectedRegistrationId, setSelectedRegistrationId] = useState("");
  const [rosters, setRosters] = useState<RosterEntry[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [rosterPlayerId, setRosterPlayerId] = useState("");
  const [rosterEvidenceUrl, setRosterEvidenceUrl] = useState("");
  const [registrationNotes, setRegistrationNotes] = useState("");
  const [submittedLineup, setSubmittedLineup] = useState<Record<string, { role: "STARTER" | "SUBSTITUTE"; goalkeeper: boolean }>>({});
  const [rosterReviewNotes, setRosterReviewNotes] = useState<Record<string, string>>({});
  const [organizerIds, setOrganizerIds] = useState<string[]>([]);
  const [organizerCandidates, setOrganizerCandidates] = useState<TournamentOrganizer[]>([]);
  const [organizerSearch, setOrganizerSearch] = useState("");
  const [selectedOrganizerId, setSelectedOrganizerId] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [linkingSchool, setLinkingSchool] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedTournament = tournaments.find((item) => item.id === selectedTournamentId);
  const selectedTeam = teams.find((item) => item.id === selectedTeamId);
  const selectedTeamRegistration = registrations.find((item) => item.teamId === selectedTeamId && item.tournamentId === selectedTournamentId);
  const selectedRegistrationOption = registrationOptions.find(
    (option) => option.tournament.id === selectedTournamentId,
  );
  const teamById = new Map(teams.map((team) => [team.id, team]));
  const registrationById = new Map(registrations.map((item) => [item.id, item]));

  const handleLinkSelectedTeam = async () => {
    if (!selectedTeam || selectedTeam.institutionId || linkingSchool) return;
    setLinkingSchool(true);
    setError(null);
    try {
      const { team } = await linkTeamToVerifiedSchool(selectedTeam.id);
      setTeams((current) => current.map((item) => item.id === team.id ? team : item));
      onNotice(`Đã liên kết ${team.name} với trường đã xác minh trên hồ sơ đội trưởng.`);
    } catch (linkError) {
      setError(linkError instanceof Error ? linkError.message : "Không thể liên kết đội với trường.");
    } finally {
      setLinkingSchool(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (mode === "captain") {
        const teamResult = await getMyManagedTeams();
        setTeams(teamResult.teams);
        setTournaments([]);
        setRegistrationOptions([]);
        setRegistrations([]);
        setSelectedTournamentId("");
        setSelectedTeamId((current) =>
          teamResult.teams.some((item) => item.id === initialTeamId)
            ? initialTeamId!
            : teamResult.teams.some((item) => item.id === current)
            ? current
            : teamResult.teams[0]?.id ?? "",
        );
      } else {
        const tournamentList = await Promise.all(
          assignedTournaments.map(async (item) => (await getTournament(item.id)).tournament),
        );
        setTournaments(tournamentList);
        setSelectedTournamentId((current) =>
          tournamentList.some((item) => item.id === current)
            ? current
            : tournamentList[0]?.id ?? "",
        );
        // Refreshing the BTC panel must refetch registrations even when the
        // selected tournament did not change. Clearing the rows here used to
        // leave the panel empty because the registration effect only depends
        // on selectedTournamentId and filter values.
        setRegistrationReloadRevision((revision) => revision + 1);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được dữ liệu đăng ký giải.");
    } finally {
      setLoading(false);
    }
  }, [assignedTournaments, initialTeamId, initialTournamentId, mode]);

  useEffect(() => {
    if (mode !== "captain") {
      setRegistrationOptions([]);
      setLoadingRegistrationOptions(false);
      return;
    }
    const team = teams.find((item) => item.id === selectedTeamId);
    if (!team?.institutionId) {
      setRegistrationOptions([]);
      setTournaments([]);
      setSelectedTournamentId("");
      setLoadingRegistrationOptions(false);
      return;
    }
    let active = true;
    setLoadingRegistrationOptions(true);
    setError(null);
    Promise.allSettled([getTournamentRegistrationOptions(team.institutionId), getMyTeamRegistrations(team.id)])
      .then(async ([optionsResult, registrationsResult]) => {
        if (!active) return;
        if (optionsResult.status === "rejected") throw optionsResult.reason;
        const { options } = optionsResult.value;
        // Registration history is useful for showing an existing application, but a
        // failure to load it must not prevent the captain from choosing a tournament.
        const teamRegistrations = registrationsResult.status === "fulfilled"
          ? registrationsResult.value.registrations
          : [];
        setRegistrations(teamRegistrations);
        const existingTournaments = await Promise.all(teamRegistrations.map(async (registration) => {
          try {
            return (await getTournament(registration.tournamentId)).tournament;
          } catch {
            return null;
          }
        }));
        const combined = [...existingTournaments.filter((item): item is Tournament => item !== null), ...options.map((option) => option.tournament)]
          .filter((tournament, index, all) => all.findIndex((item) => item.id === tournament.id) === index);
        setRegistrationOptions(options);
        setTournaments(combined);
        setSelectedTournamentId((current) =>
          combined.some((item) => item.id === initialTournamentId)
            ? initialTournamentId!
            : combined.some((item) => item.id === current)
            ? current
            : combined[0]?.id ?? "",
        );
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Không tải được giải đủ điều kiện.");
      })
      .finally(() => {
        if (active) setLoadingRegistrationOptions(false);
      });
    return () => { active = false; };
  }, [initialTournamentId, mode, selectedTeamId, teams]);

  useEffect(() => {
    if (mode !== "captain" || !selectedTeamId) return;
    let active = true;
    getPlayers(selectedTeamId).then(({ players: teamPlayers }) => {
      if (active) setPlayers(teamPlayers.filter((player) => !player.leftAt));
    }).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : "Không tải được danh sách cầu thủ của đội.");
    });
    return () => { active = false; };
  }, [mode, selectedTeamId]);

  useEffect(() => {
    if (mode !== "btc") {
      setRegistrations([]);
      setSchoolCounts([]);
      return;
    }
    if (!selectedTournamentId) {
      setRegistrations([]);
      setSchoolCounts([]);
      setTeams([]);
      return;
    }
    let active = true;
    setLoading(true);
    getTournamentRegistrations(selectedTournamentId, {
      status: registrationStatusFilter || undefined,
      institutionId: registrationInstitutionFilter || undefined,
      search: appliedRegistrationSearch || undefined,
    })
      .then(async ({ registrations: result, schoolCounts: counts }) => {
        const teamList = await Promise.all(
          [...new Set(result.map((registration) => registration.teamId))].map(async (teamId) =>
            (await getTeam(teamId)).team,
          ),
        );
        if (!active) return;
        setRegistrations(result);
        setSchoolCounts(counts);
        setTeams(teamList);
        setSelectedRegistrationId((current) =>
          result.some((item) => item.id === current) ? current : "",
        );
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Không tải được hồ sơ đăng ký.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [
    appliedRegistrationSearch,
    mode,
    registrationInstitutionFilter,
    registrationReloadRevision,
    registrationStatusFilter,
    selectedTournamentId,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const captainRegistration = selectedTeamRegistration;
    if (mode === "captain" && (!captainRegistration || !selectedTeamId || !selectedTournamentId)) {
      setRosters([]); return;
    }
    if (mode === "btc" && !selectedRegistrationId) {
      setRosters([]);
      setPlayers([]);
      return;
    }
    const registration = mode === "btc" ? registrationById.get(selectedRegistrationId) : captainRegistration;
    if (!registration) return;
    let active = true;
    const loadRoster = getTournamentRosters(registration.tournamentId, registration.teamId);
    const loadPlayers = mode === "btc" ? getPlayers(registration.teamId, true) : null;
    Promise.all([loadRoster, loadPlayers]).then(([rosterResult, playerResult]) => {
      if (!active) return;
      setRosters(rosterResult.rosters);
      if (mode === "captain") {
        setSubmittedLineup(Object.fromEntries(rosterResult.rosters.map((entry) => [entry.playerId, {
          role: entry.lineupRole ?? "SUBSTITUTE",
          goalkeeper: entry.isGoalkeeper ?? false,
        }])));
        const registration = captainRegistration;
        if (registration?.notes) setRegistrationNotes(registration.notes);
      }
      if (playerResult) setPlayers(playerResult.players);
    }).catch((err: unknown) => {
      if (active) setError(err instanceof Error ? err.message : "Không tải được roster.");
    });
    return () => {
      active = false;
    };
  }, [mode, selectedRegistrationId, registrations, selectedTeamId, selectedTeamRegistration, selectedTournamentId]);

  async function refreshRoster() {
    if (!selectedTournamentId || !selectedTeamId) return;
    const [{ rosters: entries }, { players: teamPlayers }] = await Promise.all([
      getTournamentRosters(selectedTournamentId, selectedTeamId), getPlayers(selectedTeamId),
    ]);
    setRosters(entries); setPlayers(teamPlayers);
  }

  async function handleAddRoster() {
    if (!selectedTeamId || !selectedTournamentId || !rosterPlayerId) return;
    setSubmitting(true); setError(null);
    try {
      await createTournamentRoster({ teamId: selectedTeamId, tournamentId: selectedTournamentId, playerId: rosterPlayerId, evidenceUrl: rosterEvidenceUrl.trim() || undefined });
      setRosterPlayerId(""); setRosterEvidenceUrl(""); await refreshRoster(); onNotice("Đã gửi cầu thủ vào danh sách dự giải.");
    } catch (err) { setError(err instanceof Error ? err.message : "Không gửi được cầu thủ."); }
    finally { setSubmitting(false); }
  }

  async function handleRosterReview(rosterId: string, status: "APPROVED" | "REVISION_REQUIRED" | "REJECTED") {
    setSubmitting(true); setError(null);
    try {
      await reviewTournamentRoster(selectedTournamentId, rosterId, status, rosterReviewNotes[rosterId]?.trim());
      await refreshRoster(); onNotice(status === "APPROVED" ? "Đã duyệt cầu thủ." : "Đã gửi yêu cầu cập nhật hồ sơ cầu thủ.");
    } catch (err) { setError(err instanceof Error ? err.message : "Không cập nhật được hồ sơ cầu thủ."); }
    finally { setSubmitting(false); }
  }

  useEffect(() => {
    if (mode !== "btc" || !selectedTournamentId) {
      setOrganizerIds([]);
      setOrganizerCandidates([]);
      return;
    }
    let active = true;
    Promise.all([
      getTournamentOrganizers(selectedTournamentId),
      getTournamentOrganizerCandidates(selectedTournamentId),
    ]).then(([organizerResult, candidateResult]) => {
      if (!active) return;
      setOrganizerIds(organizerResult.userIds);
      setOrganizerCandidates(candidateResult.candidates);
      setSelectedOrganizerId(
        candidateResult.candidates.find((candidate) => !organizerResult.userIds.includes(candidate.userId))?.userId ?? "",
      );
    }).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : "Không tải được danh sách BTC phối hợp.");
    });
    return () => { active = false; };
  }, [mode, selectedTournamentId]);

  useEffect(() => {
    if (mode !== "btc" || !selectedTournamentId) return;
    const timer = window.setTimeout(() => {
      getTournamentOrganizerCandidates(selectedTournamentId, organizerSearch)
        .then(({ candidates }) => {
          setOrganizerCandidates(candidates);
          setSelectedOrganizerId((current) =>
            candidates.some((candidate) => candidate.userId === current && !organizerIds.includes(current))
              ? current
              : candidates.find((candidate) => !organizerIds.includes(candidate.userId))?.userId ?? "",
          );
        })
        .catch((loadError: unknown) => {
          setError(loadError instanceof Error ? loadError.message : "Không tìm được BTC cùng trường.");
        });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [mode, organizerIds, organizerSearch, selectedTournamentId]);

  async function handleRegister() {
    if (!selectedTournamentId || !selectedTeamId) return;
    setSubmitting(true);
    setError(null);
    try {
      const roster = Object.entries(submittedLineup).map(([playerId, selection]) => ({
        playerId,
        lineupRole: selection.role,
        isGoalkeeper: selection.goalkeeper,
        evidenceUrl: players.find((player) => player.id === playerId)?.evidenceUrl ?? undefined,
      }));
      const { registration } = await createTeamRegistration({
        tournamentId: selectedTournamentId,
        teamId: selectedTeamId,
        notes: registrationNotes.trim() || undefined,
        roster,
      });
      onNotice("Đã gửi hồ sơ đăng ký giải. BTC sẽ cập nhật kết quả xét duyệt.");
      setRegistrations((current) => [
        registration,
        ...current.filter((item) => item.id !== registration.id),
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không đăng ký được đội vào giải.");
    } finally {
      setSubmitting(false);
    }
  }

  const formationSize = selectedTournament?.footballFormat ?? 7;
  const selectedRoster = Object.entries(submittedLineup);
  const starterCount = selectedRoster.filter(([, selection]) => selection.role === "STARTER").length;
  const startingGoalkeeperCount = selectedRoster.filter(([, selection]) => selection.role === "STARTER" && selection.goalkeeper).length;
  const rosterReady = starterCount === formationSize && startingGoalkeeperCount === 1 && selectedRoster.every(([playerId]) => {
    const player = players.find((candidate) => candidate.id === playerId);
    return Boolean(player?.fullName?.trim() && player.studentId?.trim());
  });

  async function handleDecision(registration: TeamRegistration, status: "APPROVED" | "REJECTED") {
    setSubmitting(true);
    setError(null);
    try {
      await updateTeamRegistration(registration.id, status);
      onNotice(status === "APPROVED" ? "Đã duyệt đội đăng ký." : "Đã từ chối đội đăng ký.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không cập nhật được hồ sơ đăng ký.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAssignOrganizer() {
    if (!selectedTournamentId || !selectedOrganizerId) return;
    setSubmitting(true);
    setError(null);
    try {
      await assignTournamentOrganizer(selectedTournamentId, selectedOrganizerId);
      const { userIds } = await getTournamentOrganizers(selectedTournamentId);
      setOrganizerIds(userIds);
      onNotice("Đã thêm BTC cùng trường vào nhóm tổ chức giải.");
    } catch (assignError) {
      setError(assignError instanceof Error ? assignError.message : "Không thể thêm BTC phối hợp.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemoveOrganizer(userId: string) {
    if (!selectedTournamentId || !window.confirm("Thu hồi quyền quản lý giải của BTC này? Tài khoản và dữ liệu giải không bị xóa.")) return;
    setSubmitting(true);
    setError(null);
    try {
      await removeTournamentOrganizer(selectedTournamentId, userId);
      const { userIds } = await getTournamentOrganizers(selectedTournamentId);
      setOrganizerIds(userIds);
      onNotice("Đã thu hồi quyền BTC trên giải này.");
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Không thể thu hồi BTC phối hợp.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="panel data-panel tournament-workflow-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{mode === "captain" ? "HỒ SƠ ĐỘI BÓNG" : "CÔNG TÁC GIẢI ĐẤU"}</span>
          <h2>{mode === "captain" ? "Đăng ký đội tham gia giải" : "Xét duyệt đăng ký đội"}</h2>
        </div>
        <button className="text-button" type="button" onClick={() => void load()}>Tải lại</button>
      </div>
      {mode === "captain" ? (
        <div className="form-grid">
          <label className="field">
            Giải đấu
            <select value={selectedTournamentId} onChange={(event) => setSelectedTournamentId(event.target.value)} required disabled={loading || loadingRegistrationOptions || !selectedTeamId}>
              <option value="">Chọn giải đấu</option>
              {tournaments.map((tournament) => (
                <option key={tournament.id} value={tournament.id}>{tournament.name} · {tournament.status}</option>
              ))}
            </select>
            {selectedTeamId && !loadingRegistrationOptions && !tournaments.length ? (
              <small className="form-help">{registrationOptions.length
                ? "Các giải hiện có đều không đủ điều kiện đăng ký. Xem lý do bên dưới."
                : "Không tìm thấy giải đang mở đăng ký cho trường của đội."}</small>
            ) : null}
          </label>
          <label className="field">
            Đội bóng
            <select value={selectedTeamId} onChange={(event) => {
              setSelectedTeamId(event.target.value);
              setSelectedTournamentId("");
            }} required disabled={loading || !teams.length}>
              <option value="">Chọn đội bóng</option>
              {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
          </label>
          {!loading && !teams.length ? (
            <div className="field-wide empty-state">
              <h3>Chưa có đội để đăng ký</h3>
              <p>Chỉ đội do bạn điều hành mới có thể nộp hồ sơ giải đấu.</p>
            </div>
          ) : null}
          {selectedTeam && !selectedTeam.institutionId ? (
            <div className="field-wide message-banner message-warning" role="status">
              <div>
                <strong>Đội này chưa có trường liên kết.</strong>
                <p>Liên kết đội với trường đã xác minh trên hồ sơ đội trưởng để tải các giải đủ điều kiện đăng ký.</p>
              </div>
              <button className="button-secondary" type="button" disabled={linkingSchool || submitting} onClick={() => void handleLinkSelectedTeam()}>
                {linkingSchool ? "Đang liên kết…" : "Liên kết trường của tôi"}
              </button>
            </div>
          ) : null}
          {selectedRegistrationOption ? (
            <p className="field-wide form-help">
              Trường hiện có {selectedRegistrationOption.registeredTeamsForInstitution} đội đã đăng ký
              {selectedRegistrationOption.maxTeamsPerInstitution === null
                ? " · không giới hạn riêng theo trường."
                : ` / ${selectedRegistrationOption.maxTeamsPerInstitution} đội tối đa.`}
            </p>
          ) : null}
          {selectedRegistrationOption && !selectedRegistrationOption.eligible ? (
            <div className="field-wide message-banner message-warning" role="status">
              {selectedRegistrationOption.ineligibilityReason ?? "Đội chưa đủ điều kiện đăng ký giải này."}
            </div>
          ) : null}
          {selectedTournament && selectedTeam ? (
            <section className="field-wide tournament-registration-roster">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">HỒ SƠ GỬI BAN TỔ CHỨC</span>
                  <h3>Đội hình dự kiến · {selectedTournament.footballFormat ?? 7} người</h3>
                  <p>{selectedTeam.name} · {selectedTeam.institutionName ?? "Trường chưa xác định"} · {selectedTeam.unitName ?? "Chưa khai báo khoa/đơn vị"} · Đại diện: {selectedTeam.representativeName ?? "Chưa có đại diện"} · Liên hệ: {selectedTeam.contactEmail ?? "—"} / {selectedTeam.contactPhone ?? "—"}</p>
                </div>
                <strong>{starterCount}/{formationSize} đá chính</strong>
              </div>
              <p className="form-help">Chọn đúng cầu thủ trong danh sách đội. Hồ sơ MSSV và minh chứng đã lưu của từng cầu thủ sẽ được gửi cùng đơn; BTC sẽ kiểm tra trường, đội hình và roster trước khi duyệt.</p>
              {loading ? <p className="form-help">Đang tải danh sách cầu thủ của đội…</p> : players.length ? <div className="tournament-lineup-list">
                {players.map((player) => {
                  const selection = submittedLineup[player.id];
                  return <div className="tournament-lineup-row" key={player.id}>
                    <label className="tournament-lineup-player">
                      <input type="checkbox" checked={Boolean(selection)} onChange={(event) => setSubmittedLineup((current) => {
                        if (!event.target.checked) { const next = { ...current }; delete next[player.id]; return next; }
                        return { ...current, [player.id]: { role: "SUBSTITUTE", goalkeeper: false } };
                      })} />
                      <span><strong>{player.fullName ?? "Chưa có họ tên"}</strong><small>MSSV: {player.studentId ?? "Chưa có MSSV"} · {player.position ?? "Chưa khai báo vị trí"} · Số áo {player.jerseyNumber ?? "—"}</small></span>
                    </label>
                    {selection ? <div className="tournament-lineup-controls">
                      <select aria-label={`Vai trò thi đấu ${player.fullName ?? player.id}`} value={selection.role} onChange={(event) => setSubmittedLineup((current) => ({ ...current, [player.id]: { ...current[player.id], role: event.target.value as "STARTER" | "SUBSTITUTE", goalkeeper: event.target.value === "SUBSTITUTE" ? false : current[player.id].goalkeeper } }))}>
                        <option value="STARTER">Đá chính</option><option value="SUBSTITUTE">Dự bị</option>
                      </select>
                      {selection.role === "STARTER" ? <label><input type="checkbox" checked={selection.goalkeeper} onChange={(event) => setSubmittedLineup((current) => ({ ...current, [player.id]: { ...current[player.id], goalkeeper: event.target.checked } }))} /> Thủ môn</label> : null}
                    </div> : null}
                  </div>;
                })}
              </div> : <div className="empty-state"><h3>Đội chưa có danh sách cầu thủ</h3><p>Hãy thêm và cập nhật hồ sơ cầu thủ trong phần quản lý đội trước khi đăng ký giải.</p></div>}
              <label className="field">Ghi chú gửi BTC
                <textarea value={registrationNotes} onChange={(event) => setRegistrationNotes(event.target.value)} maxLength={2000} rows={3} placeholder="Thông tin bổ sung về đội, đơn vị/khoa, người đại diện hoặc lưu ý hồ sơ…" />
              </label>
              {selectedRoster.some(([playerId]) => {
                const player = players.find((candidate) => candidate.id === playerId);
                return !player?.fullName?.trim() || !player.studentId?.trim();
              }) ? <p className="form-error">Mỗi cầu thủ được chọn cần có họ tên và mã sinh viên trong hồ sơ đội.</p> : null}
              {starterCount === formationSize && startingGoalkeeperCount !== 1 ? <p className="form-error">Đội hình đá chính phải có đúng một thủ môn.</p> : null}
            </section>
          ) : null}
          {!tournaments.length && registrationOptions.length ? (
            <div className="field-wide empty-state">
              <h3>Chưa có giải phù hợp</h3>
              {registrationOptions.map((option) => (
                <p key={option.tournament.id}>
                  {option.tournament.name}: {option.ineligibilityReason ?? "Không đủ điều kiện tham gia."}
                </p>
              ))}
            </div>
          ) : null}
          <p className="field-wide form-help">
            Hồ sơ đăng ký và đội hình sẽ được gửi cùng lúc đến BTC. Máy chủ xác minh trường, bậc đào tạo,
            thời hạn và hạn mức theo trường/toàn giải trước khi tiếp nhận.
          </p>
          <div className="field-wide form-actions">
            <button
              className="primary-button"
              type="button"
              disabled={submitting || loading || loadingRegistrationOptions || !teams.length || selectedRegistrationOption?.eligible !== true || !!selectedTeamRegistration || !rosterReady}
              onClick={() => void handleRegister()}
            >{submitting ? "Đang gửi…" : "Gửi đăng ký"} <span>↗</span></button>
          </div>
        </div>
      ) : (
        <>
          <label className="field">
            Giải được phân công
            <select value={selectedTournamentId} onChange={(event) => setSelectedTournamentId(event.target.value)}>
              <option value="">Chọn giải đấu</option>
              {tournaments.map((tournament) => <option key={tournament.id} value={tournament.id}>{tournament.name}</option>)}
            </select>
          </label>
          {selectedTournamentId ? (
            <div className="form-grid registration-filters">
              <label className="field">Trạng thái hồ sơ
                <select value={registrationStatusFilter} onChange={(event) => setRegistrationStatusFilter(event.target.value as TeamRegistration["status"] | "")}>
                  <option value="">Tất cả trạng thái</option>
                  {Object.entries(registrationStatusLabels).map(([status, label]) => (
                    <option key={status} value={status}>{label}</option>
                  ))}
                </select>
              </label>
              <label className="field">Trường
                <select value={registrationInstitutionFilter} onChange={(event) => setRegistrationInstitutionFilter(event.target.value)}>
                  <option value="">Tất cả trường</option>
                  {schoolCounts.map((school) => (
                    <option key={school.institutionId} value={school.institutionId}>{school.institutionName}</option>
                  ))}
                </select>
              </label>
              <label className="field">Đội / trường
                <input value={registrationSearch} onChange={(event) => setRegistrationSearch(event.target.value)} placeholder="Tìm tên đội hoặc trường" />
              </label>
              <div className="button-row field-wide">
                <button className="primary-button" type="button" onClick={() => setAppliedRegistrationSearch(registrationSearch.trim())}>Lọc hồ sơ</button>
                <button className="text-button" type="button" onClick={() => {
                  setRegistrationSearch("");
                  setAppliedRegistrationSearch("");
                  setRegistrationStatusFilter("");
                  setRegistrationInstitutionFilter("");
                }}>Đặt lại</button>
              </div>
            </div>
          ) : null}
          {selectedTournamentId && schoolCounts.length ? (
            <div className="institution-list registration-school-summary">
              {schoolCounts.map((school) => {
                const override = selectedTournament?.institutionTeamLimits?.find(
                  (limit) => limit.institutionId === school.institutionId,
                );
                const cap = override ? override.maxTeams : selectedTournament?.defaultMaxTeamsPerInstitution ?? null;
                return (
                  <article className="institution-row" key={school.institutionId}>
                    <div>
                      <strong>{school.institutionName}</strong>
                      <p>Đã duyệt {school.approved} · Chờ duyệt {school.pending}</p>
                    </div>
                    <strong>{school.approved} / {cap ?? "∞"} đội đã duyệt</strong>
                  </article>
                );
              })}
            </div>
          ) : null}
        </>
      )}
      {mode === "btc" && selectedTournamentId ? (
        <details className="organizer-management organizer-management-collapsible">
          <summary>
            <span className="eyebrow">CÀI ĐẶT GIẢI ĐẤU</span>
            <strong>Quản lý BTC phối hợp</strong>
            <span className="organizer-management-count">{organizerIds.length} tài khoản được phân công</span>
          </summary>
          <p>Phân công BTC cùng trường để cùng quản lý riêng giải này. Người tạo giải luôn có quyền quản lý.</p>
          <div className="organizer-add-row">
            <label className="field">Tìm BTC cùng trường
              <input value={organizerSearch} onChange={(event) => setOrganizerSearch(event.target.value)} maxLength={100} placeholder="Họ tên hoặc email" />
            </label>
            <label className="field">Tài khoản
              <select value={selectedOrganizerId} onChange={(event) => setSelectedOrganizerId(event.target.value)}>
                <option value="">Chọn BTC</option>
                {organizerCandidates.filter((candidate) => !organizerIds.includes(candidate.userId)).map((candidate) => (
                  <option value={candidate.userId} key={candidate.userId}>{candidate.fullName} · {candidate.email}</option>
                ))}
              </select>
            </label>
            <button className="primary-button" type="button" disabled={submitting || !selectedOrganizerId} onClick={() => void handleAssignOrganizer()}>
              Thêm BTC
            </button>
          </div>
          <div className="organizer-list">
            {organizerIds.map((userId) => {
              const candidate = organizerCandidates.find((item) => item.userId === userId);
              return (
                <div className="organizer-item" key={userId}>
                  <span><strong>{candidate?.fullName ?? `Tài khoản ${userId.slice(0, 8)}`}</strong><small>{candidate?.email ?? userId}</small></span>
                  <button className="text-button danger-text-button" type="button" disabled={submitting || organizerIds.length <= 1} onClick={() => void handleRemoveOrganizer(userId)}>Thu hồi</button>
                </div>
              );
            })}
          </div>
        </details>
      ) : null}
      {error ? <div className="message-banner message-error" role="alert">{error}</div> : null}
      {loading ? <div className="loading-state">Đang tải dữ liệu…</div> : mode === "btc" ? (
        registrations.filter((item) => item.tournamentId === selectedTournamentId).length ? (
          <div className="institution-list">
            {registrations.filter((item) => item.tournamentId === selectedTournamentId).map((registration) => (
              <article className="institution-row" key={registration.id}>
                <div>
                  <span className="eyebrow">{registrationStatusLabels[registration.status]}</span>
                  <h3>{teamById.get(registration.teamId)?.name ?? "Đội bóng"}</h3>
                  <p>{registration.institutionName ?? "Chưa xác định trường"} · {teamById.get(registration.teamId)?.unitName ?? "Chưa khai báo khoa/đơn vị"} · Đại diện: {teamById.get(registration.teamId)?.representativeName ?? "—"} · Liên hệ: {teamById.get(registration.teamId)?.contactEmail ?? "—"} / {teamById.get(registration.teamId)?.contactPhone ?? "—"}</p>
                  <p>{registration.notes || "Đội chưa gửi ghi chú kèm theo."}</p>
                </div>
                <div className="button-row">
                  <button className="text-button" type="button" onClick={() => setSelectedRegistrationId(registration.id)}>Kiểm tra roster</button>
                  {registration.status === "PENDING" ? (
                    <>
                      <button className="primary-button" type="button" disabled={submitting} onClick={() => void handleDecision(registration, "APPROVED")}>Duyệt</button>
                      <button className="text-button" type="button" disabled={submitting} onClick={() => void handleDecision(registration, "REJECTED")}>Từ chối</button>
                    </>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : <div className="empty-state"><h3>Không có hồ sơ chờ duyệt</h3><p>Chỉ các đội đã đăng ký vào giải đang được phân công mới xuất hiện tại đây.</p></div>
      ) : (
        <CaptainRegistrationStatus
          teams={teams}
          tournamentId={selectedTournamentId}
          selectedTeamId={selectedTeamId}
          initialRegistration={registrations.find((item) =>
            item.tournamentId === selectedTournamentId && item.teamId === selectedTeamId,
          ) ?? null}
        />
      )}
      {mode === "captain" && selectedTeamRegistration && ["PENDING", "APPROVED"].includes(selectedTeamRegistration.status) ? (
        <div className="roster-review">
          <h3>Danh sách cầu thủ đăng ký dự giải</h3>
          <p>Gửi hồ sơ cầu thủ cho BTC kiểm tra. Nếu BTC yêu cầu bổ sung, cập nhật đường dẫn minh chứng tại từng dòng.</p>
          {selectedTournament && ["OPEN_REGISTRATION", "REGISTRATION_CLOSED"].includes(selectedTournament.status) ? (
            <div className="form-grid">
              <label className="field">Cầu thủ
                <select value={rosterPlayerId} onChange={(event) => setRosterPlayerId(event.target.value)}>
                  <option value="">Chọn cầu thủ trong đội</option>
                  {players.filter((player) => !player.leftAt && !rosters.some((entry) => entry.playerId === player.id)).map((player) => <option key={player.id} value={player.id}>{player.fullName} · {player.studentId}</option>)}
                </select>
              </label>
              <label className="field">Minh chứng (liên kết, nếu có)
                <input value={rosterEvidenceUrl} onChange={(event) => setRosterEvidenceUrl(event.target.value)} placeholder="https://…" maxLength={500} />
              </label>
              <div className="field-wide form-actions"><button className="primary-button" type="button" disabled={submitting || !rosterPlayerId} onClick={() => void handleAddRoster()}>Thêm cầu thủ vào hồ sơ</button></div>
            </div>
          ) : <p className="form-help">BTC đã khóa thời hạn cập nhật danh sách.</p>}
          {rosters.map((roster) => {
            const player = players.find((item) => item.id === roster.playerId);
            return <article className="institution-row" key={roster.id}>
              <div><strong>{player?.fullName ?? `Cầu thủ ${roster.playerId.slice(0, 8)}`}</strong><p>MSSV: {player?.studentId ?? "—"} · {roster.reviewStatus === "APPROVED" ? "Đã duyệt" : roster.reviewStatus === "REVISION_REQUIRED" ? "Cần bổ sung" : roster.reviewStatus === "REJECTED" ? "Từ chối" : "Đang chờ BTC"}</p>
                {roster.reviewNote ? <p>Phản hồi BTC: {roster.reviewNote}</p> : null}
                {roster.evidenceUrl ? <a href={roster.evidenceUrl} target="_blank" rel="noreferrer">Xem minh chứng</a> : null}
              </div>
              {["OPEN_REGISTRATION", "REGISTRATION_CLOSED"].includes(selectedTournament?.status ?? "") ? <div className="button-row"><button className="text-button" type="button" disabled={submitting} onClick={async () => { const value = window.prompt("Nhập liên kết minh chứng mới", roster.evidenceUrl ?? ""); if (value === null) return; setSubmitting(true); try { await updateTournamentRosterEvidence(selectedTournamentId, roster.id, value.trim()); await refreshRoster(); onNotice("Đã cập nhật hồ sơ và gửi lại BTC."); } catch (err) { setError(err instanceof Error ? err.message : "Không cập nhật được minh chứng."); } finally { setSubmitting(false); } }}>Cập nhật minh chứng</button><button className="text-button danger-text-button" type="button" disabled={submitting} onClick={async () => { if (!window.confirm("Xóa cầu thủ khỏi danh sách đăng ký giải?")) return; setSubmitting(true); try { await deleteTournamentRoster(selectedTournamentId, roster.id); await refreshRoster(); } catch (err) { setError(err instanceof Error ? err.message : "Không xóa được cầu thủ."); } finally { setSubmitting(false); } }}>Xóa</button></div> : null}
            </article>;
          })}
        </div>
      ) : null}
      {mode === "btc" && selectedRegistrationId ? (
        <div className="roster-review">
          <h3>Roster đăng ký</h3>
          {rosters.length ? rosters.map((roster) => {
            const player = players.find((item) => item.id === roster.playerId);
            return (
              <article className="institution-row" key={roster.id}>
                <div><strong>{player?.fullName ?? `Cầu thủ ${roster.playerId.slice(0, 8)}`}</strong><p>MSSV: {player?.studentId ?? "—"} · Số áo {player?.jerseyNumber ?? "—"} · {player?.position ?? "Chưa khai báo vị trí"} · {roster.lineupRole === "STARTER" ? "Đá chính" : "Dự bị"}{roster.isGoalkeeper ? " · Thủ môn" : ""} · {roster.reviewStatus === "APPROVED" ? "Đã duyệt" : roster.reviewStatus === "REVISION_REQUIRED" ? "Cần bổ sung" : roster.reviewStatus === "REJECTED" ? "Từ chối" : "Chờ xét duyệt"}</p>{player?.birthDate ? <p>Ngày sinh: {player.birthDate}</p> : null}{player?.contactEmail ? <p>Email cầu thủ: {player.contactEmail}</p> : null}{roster.evidenceUrl ? <a href={roster.evidenceUrl} target="_blank" rel="noreferrer">Mở minh chứng</a> : <p>Chưa có minh chứng đính kèm.</p>}{roster.reviewNote ? <p>Ghi chú: {roster.reviewNote}</p> : null}</div>
                {selectedTournament && ["OPEN_REGISTRATION", "REGISTRATION_CLOSED"].includes(selectedTournament.status) && roster.reviewStatus !== "APPROVED" ? <div className="roster-review-actions"><label className="field">Ghi chú cho đội<input value={rosterReviewNotes[roster.id] ?? ""} onChange={(event) => setRosterReviewNotes((current) => ({ ...current, [roster.id]: event.target.value }))} placeholder="Bắt buộc nếu yêu cầu bổ sung hoặc từ chối" /></label><div className="button-row"><button className="primary-button" type="button" disabled={submitting} onClick={() => void handleRosterReview(roster.id, "APPROVED")}>Duyệt cầu thủ</button><button className="text-button" type="button" disabled={submitting || !rosterReviewNotes[roster.id]?.trim()} onClick={() => void handleRosterReview(roster.id, "REVISION_REQUIRED")}>Yêu cầu bổ sung</button><button className="text-button danger-text-button" type="button" disabled={submitting || !rosterReviewNotes[roster.id]?.trim()} onClick={() => void handleRosterReview(roster.id, "REJECTED")}>Từ chối</button></div></div> : null}
              </article>
            );
          }) : <p>Đội chưa gửi roster cho giải này.</p>}
        </div>
      ) : null}
    </section>
  );
}

function CaptainRegistrationStatus(props: {
  teams: Team[];
  tournamentId: string;
  selectedTeamId: string;
  initialRegistration: TeamRegistration | null;
}) {
  const [registration, setRegistration] = useState<TeamRegistration | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!props.tournamentId || !props.selectedTeamId) {
      setRegistration(null);
      return;
    }
    if (props.initialRegistration) {
      setRegistration(props.initialRegistration);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    getMyTeamRegistration(props.selectedTeamId, props.tournamentId)
      .then(({ registration: result }) => {
        if (active) setRegistration(result);
      })
      .catch((err: unknown) => {
        if (active && err instanceof Error && "status" in err && err.status === 404) {
          setRegistration(null);
        } else if (active) {
          setError(err instanceof Error ? err.message : "Không tải được trạng thái đăng ký.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [props.initialRegistration, props.selectedTeamId, props.tournamentId]);
  if (loading) return <div className="loading-state">Đang kiểm tra trạng thái đăng ký…</div>;
  if (error) return <div className="message-banner message-error" role="alert">{error}</div>;
  return registration ? (
    <div className="message-banner message-success" role="status">
      {props.teams.find((team) => team.id === registration.teamId)?.name}: {registrationStatusLabels[registration.status]}
    </div>
  ) : null;
}
