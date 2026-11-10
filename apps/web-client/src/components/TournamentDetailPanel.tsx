import { useEffect, useState } from "react";
import {
  createTournamentRegulation,
  deleteTournamentRegulation,
  getTournament,
  getPublicTeams,
  getPublishedTournamentDraw,
  getPublishedTournamentTeams,
  getMatches,
  getMatchResult,
  getStandings,
  getTournamentRegulations,
  getTournamentRegulationVersions,
  updateTournament,
  updateTournamentRegulation,
  type DrawVersion,
  type RegulationVersion,
  type Tournament,
  type TournamentRegulation,
  type Match,
  type MatchResult,
  type Standing,
  type PublicTournamentTeam,
} from "../api/competition";
import type { Institution } from "../api/institutions";
import { Modal } from "./Modal";

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
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [regulations, setRegulations] = useState<TournamentRegulation[]>([]);
  const [versions, setVersions] = useState<RegulationVersion[]>([]);
  const [publishedDraw, setPublishedDraw] = useState<DrawVersion | null>(null);
  const [drawTeamNames, setDrawTeamNames] = useState<Map<string, string>>(new Map());
  const [participatingTeams, setParticipatingTeams] = useState<PublicTournamentTeam[]>([]);
  const [publicMatches, setPublicMatches] = useState<Match[]>([]);
  const [publicResults, setPublicResults] = useState<Map<string, MatchResult>>(new Map());
  const [publicStandings, setPublicStandings] = useState<Standing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingDetails, setEditingDetails] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [maxTeams, setMaxTeams] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingRegulationId, setEditingRegulationId] = useState("");
  const [regulationTitle, setRegulationTitle] = useState("");
  const [regulationContent, setRegulationContent] = useState("");
  const [creatingRegulation, setCreatingRegulation] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<RegulationVersion | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    Promise.all([
      getTournament(tournamentId),
      getTournamentRegulations(tournamentId),
      getTournamentRegulationVersions(tournamentId),
      getPublishedTournamentDraw(tournamentId),
      getMatches(tournamentId),
      getStandings(tournamentId),
    ])
      .then(async ([detail, regulationResult, versionResult, drawResult, matchResult, standingsResult]) => {
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
        setPublishedDraw(drawResult.draw);
        setPublicMatches(matchResult.items);
        setPublicStandings(standingsResult.standings);
        const [registeredResult, publicTeamResult, results] = await Promise.all([
          detail.tournament.status === "DRAFT"
            ? Promise.resolve({ teams: [] as PublicTournamentTeam[] })
            : getPublishedTournamentTeams(tournamentId),
          getPublicTeams({ limit: 100, offset: 0 }),
          Promise.all(matchResult.items.map(async (match) => {
            const { result } = await getMatchResult(match.id);
            return result ? [match.id, result] as const : null;
          })),
        ]);
        if (!active) return;
        setParticipatingTeams(registeredResult.teams);
        setPublicResults(new Map(results.filter((entry): entry is readonly [string, MatchResult] => entry !== null)));
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
    if (!window.confirm("Xóa điều lệ này khỏi bản nháp?")) return;
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
            <button className="button button-secondary" onClick={() => setEditingDetails(true)} type="button">Chỉnh sửa thông tin</button>
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

      <div className="tournament-detail-section">
        <h3>Kết quả chia bảng</h3>
        {publishedDraw ? (
          <div className="draw-groups">
            {publishedDraw.groups.map((group) => (
              <article className="draw-group" key={group.id}>
                <h4>{group.name}</h4>
                {group.assignments.map((assignment) => (
                  <p key={assignment.teamId}>
                    {assignment.position}. {drawTeamNames.get(assignment.teamId) ?? "Đội bóng"}
                  </p>
                ))}
              </article>
            ))}
          </div>
        ) : <p>Ban tổ chức chưa công bố kết quả chia bảng.</p>}
      </div>

      <div className="tournament-detail-section">
        <h3>Đội tham gia đã được duyệt</h3>
        {participatingTeams.length ? <div className="tournament-public-team-grid">
          {participatingTeams.map((team) => <article className="tournament-public-team" key={team.id}>
            {team.logoUrl ? <img src={team.logoUrl} alt="" /> : <span className="tournament-public-team-mark">♧</span>}
            <div><strong>{team.name}</strong><span>{team.institutionName ?? "Chưa xác định trường"}</span>{team.unitName ? <small>{team.unitName}</small> : null}</div>
          </article>)}
        </div> : <p>Chưa có đội nào được duyệt tham gia giải.</p>}
      </div>

      <div className="tournament-detail-section">
        <h3>Lịch thi đấu và kết quả chính thức</h3>
        {publicMatches.length ? <div className="tournament-public-match-list">
          {publicMatches.map((match) => {
            const result = publicResults.get(match.id);
            return <article className="tournament-public-match" key={match.id}>
              <div><strong>{drawTeamNames.get(match.homeTeamId) ?? `Đội ${match.homeTeamId.slice(0, 6)}`}</strong><span>vs</span><strong>{drawTeamNames.get(match.awayTeamId) ?? `Đội ${match.awayTeamId.slice(0, 6)}`}</strong></div>
              <small>{match.round ?? "Trận đấu"} · {match.matchDate ? new Date(match.matchDate).toLocaleString("vi-VN") : "Chưa xếp lịch"} · {match.venue ?? "Chưa có sân"}</small>
              <span className="status-pill">{result ? `${result.homeScore} – ${result.awayScore} · Đã công nhận` : match.status === "FINISHED" ? "Chờ BTC duyệt kết quả" : match.status.replaceAll("_", " ")}</span>
            </article>;
          })}
        </div> : <p>Ban tổ chức chưa công bố lịch thi đấu.</p>}
      </div>

      <div className="tournament-detail-section">
        <h3>Bảng xếp hạng chính thức</h3>
        {publicStandings.length ? <div className="tournament-public-standings">
          <div className="tournament-public-standing tournament-public-standing-head"><span>Hạng</span><span>Đội</span><span>Đ</span><span>HS</span><span>Điểm</span></div>
          {[...publicStandings].sort((a, b) => b.points - a.points || b.goalDifference - a.goalDifference || b.goalsFor - a.goalsFor).map((standing, index) => <div className="tournament-public-standing" key={standing.id}>
            <strong>{index + 1}</strong><strong>{drawTeamNames.get(standing.teamId) ?? `Đội ${standing.teamId.slice(0, 6)}`}</strong><span>{standing.played}</span><span>{standing.goalDifference > 0 ? "+" : ""}{standing.goalDifference}</span><strong>{standing.points}</strong>
          </div>)}
        </div> : <p>Bảng xếp hạng sẽ hiển thị khi có kết quả được BTC công nhận.</p>}
      </div>

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
