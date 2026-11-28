import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  createTournamentComplaint,
  getAllMatches,
  getComplaintAppealStatus,
  getTournamentComplaints,
  submitComplaintAppeal,
  type ComplaintAppeal,
  type Match,
  type Team,
  type Tournament,
  type TournamentComplaint,
} from "../api/competition";

type Props = {
  userId: string;
  teams: Team[];
  tournaments: Tournament[];
  onNotice: (message: string) => void;
};

const finalMatchStatuses = new Set(["FINISHED", "VERIFIED", "LOCKED"]);
const complaintStatusLabels: Record<TournamentComplaint["status"], string> = {
  PENDING: "Chờ BTC tiếp nhận",
  UNDER_REVIEW: "Đang xem xét",
  APPROVED: "Đã chấp thuận",
  REJECTED: "Không chấp thuận",
  CLOSED: "Đã đóng",
};

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "medium", timeStyle: "short",
  }).format(date);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function TeamComplaintPanel({ userId, teams, tournaments, onNotice }: Props) {
  const captainTeams = useMemo(() => teams.filter((team) => team.captainId === userId && team.isActive), [teams, userId]);
  const [teamId, setTeamId] = useState("");
  const [tournamentId, setTournamentId] = useState("");
  const [matches, setMatches] = useState<Match[]>([]);
  const [complaints, setComplaints] = useState<TournamentComplaint[]>([]);
  const [appeals, setAppeals] = useState<Record<string, ComplaintAppeal | null>>({});
  const [appealStatusErrors, setAppealStatusErrors] = useState<Record<string, string>>({});
  const [matchId, setMatchId] = useState("");
  const [complaintType, setComplaintType] = useState("RESULT");
  const [description, setDescription] = useState("");
  const [evidence, setEvidence] = useState("");
  const [appealDrafts, setAppealDrafts] = useState<Record<string, { description: string; evidence: string }>>({});
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    setTeamId((current) => captainTeams.some((team) => team.id === current) ? current : captainTeams[0]?.id ?? "");
  }, [captainTeams]);

  useEffect(() => {
    setTournamentId((current) => tournaments.some((item) => item.id === current) ? current : tournaments[0]?.id ?? "");
  }, [tournaments]);

  const refresh = useCallback(async () => {
    if (!teamId || !tournamentId) {
      setMatches([]); setComplaints([]); setAppeals({}); setAppealStatusErrors({}); setMatchId("");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [matchResponse, complaintResponse] = await Promise.all([
        getAllMatches(tournamentId),
        getTournamentComplaints(tournamentId, teamId),
      ]);
      const ownFinalMatches = matchResponse.items
        .filter((match) => finalMatchStatuses.has(match.status) && [match.homeTeamId, match.awayTeamId].includes(teamId))
        .sort((a, b) => (b.matchDate ?? "").localeCompare(a.matchDate ?? ""));
      setMatches(ownFinalMatches);
      setMatchId((current) => ownFinalMatches.some((match) => match.id === current) ? current : ownFinalMatches[0]?.id ?? "");
      setComplaints(complaintResponse.complaints);
      const appealStatuses = await Promise.all(complaintResponse.complaints.map(async (complaint) => {
        try {
          const response = await getComplaintAppealStatus(complaint.id);
          return { complaintId: complaint.id, appeal: response.appeal, error: null };
        } catch (cause) {
          return {
            complaintId: complaint.id,
            appeal: null,
            error: errorMessage(cause, "Không kiểm tra được trạng thái kháng nghị."),
          };
        }
      }));
      setAppeals(Object.fromEntries(appealStatuses.map(({ complaintId, appeal }) => [complaintId, appeal])));
      setAppealStatusErrors(Object.fromEntries(appealStatuses
        .filter((item): item is typeof item & { error: string } => item.error !== null)
        .map(({ complaintId, error: statusError }) => [complaintId, statusError])));
    } catch (cause) {
      setError(errorMessage(cause, "Không tải được khiếu nại của đội. Vui lòng thử lại."));
    } finally {
      setLoading(false);
    }
  }, [teamId, tournamentId, revision]);

  useEffect(() => { void refresh(); }, [refresh]);

  const selectedTeam = captainTeams.find((team) => team.id === teamId);
  const selectedMatch = matches.find((match) => match.id === matchId);

  async function submitComplaint(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedMatch || !teamId || !tournamentId || !description.trim()) return;
    setSubmitting(true); setError(null);
    try {
      await createTournamentComplaint({
        matchId, tournamentId, teamId, complaintType,
        description: description.trim(), evidence: evidence.trim() || undefined,
      });
      setDescription(""); setEvidence(""); setRevision((value) => value + 1);
      onNotice("Đã gửi khiếu nại đến ban tổ chức giải.");
    } catch (cause) {
      setError(errorMessage(cause, "Không gửi được khiếu nại. Hãy kiểm tra thời hạn và quyền của đội."));
    } finally { setSubmitting(false); }
  }

  async function submitAppeal(complaint: TournamentComplaint) {
    const draft = appealDrafts[complaint.id];
    if (!draft?.description.trim()) return;
    setSubmitting(true); setError(null);
    try {
      await submitComplaintAppeal(complaint.id, {
        description: draft.description.trim(), evidence: draft.evidence.trim() || undefined,
      });
      setAppealDrafts((current) => ({ ...current, [complaint.id]: { description: "", evidence: "" } }));
      setRevision((value) => value + 1);
      onNotice("Đã gửi kháng nghị đến ban tổ chức.");
    } catch (cause) {
      setError(errorMessage(cause, "Không gửi được kháng nghị. Hãy kiểm tra thời hạn khiếu nại."));
    } finally { setSubmitting(false); }
  }

  return (
    <section className="panel data-panel team-complaint-panel">
      <div className="panel-heading">
        <div><span className="eyebrow">ĐỘI TRƯỞNG</span><h2>Khiếu nại và kháng nghị</h2>
          <p>Theo dõi quyết định của BTC và gửi khiếu nại trong thời hạn quy định của giải.</p></div>
        <button className="button-secondary" type="button" onClick={() => setRevision((value) => value + 1)} disabled={loading}>Tải lại</button>
      </div>

      {captainTeams.length === 0 ? <div className="empty-state"><h3>Chưa có đội do bạn điều hành</h3><p>Chức năng này chỉ dành cho đội trưởng của đội tham gia giải.</p></div> : (
        <>
          <div className="form-grid team-complaint-filters">
            <label className="field">Đội bóng<select value={teamId} onChange={(event) => setTeamId(event.target.value)}>
              {captainTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select></label>
            <label className="field">Giải đấu<select value={tournamentId} onChange={(event) => setTournamentId(event.target.value)}>
              <option value="">Chọn giải đấu</option>{tournaments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select></label>
          </div>

          {error ? <div className="form-error" role="alert">{error}</div> : null}
          {loading ? <div className="schedule-empty-state"><span>Đang tải khiếu nại và trận đấu…</span></div> : null}

          {!loading && teamId && tournamentId ? <>
            <form className="team-complaint-form" onSubmit={submitComplaint}>
              <h3>Gửi khiếu nại trận đấu</h3>
              <p>Chỉ các trận của đội đã kết thúc mới hiện ở đây. Máy chủ vẫn kiểm tra quyền và thời hạn theo điều lệ.</p>
              <div className="form-grid">
                <label className="field">Trận đấu<select value={matchId} onChange={(event) => setMatchId(event.target.value)} required disabled={!matches.length}>
                  <option value="">{matches.length ? "Chọn trận" : "Chưa có trận đã kết thúc đủ điều kiện"}</option>
                  {matches.map((match) => <option key={match.id} value={match.id}>{match.round ?? "Trận đấu"} · {formatDate(match.matchDate ?? "")} · {match.venue ?? "Chưa có sân"}</option>)}
                </select></label>
                <label className="field">Nội dung khiếu nại<select value={complaintType} onChange={(event) => setComplaintType(event.target.value)}>
                  <option value="RESULT">Kết quả trận đấu</option><option value="REFEREE">Công tác trọng tài</option>
                  <option value="ELIGIBILITY">Tư cách cầu thủ</option><option value="DISCIPLINE">Kỷ luật</option><option value="OTHER">Nội dung khác</option>
                </select></label>
              </div>
              <label className="field">Nội dung<textarea value={description} onChange={(event) => setDescription(event.target.value)} minLength={10} maxLength={4000} rows={3} required placeholder="Mô tả sự việc, thời điểm và căn cứ đề nghị BTC xem xét…" /></label>
              <label className="field">Minh chứng (nếu có)<textarea value={evidence} onChange={(event) => setEvidence(event.target.value)} maxLength={4000} rows={2} placeholder="Liên kết hoặc mô tả tài liệu/video liên quan" /></label>
              <div className="button-row"><span>{selectedTeam?.name} · {description.trim().length}/4000 ký tự</span><button className="primary-button" type="submit" disabled={submitting || !selectedMatch || description.trim().length < 10}>{submitting ? "Đang gửi…" : "Gửi khiếu nại"}</button></div>
            </form>

            <div className="team-complaint-list">
              <div className="section-heading"><div><h3>Hồ sơ đã gửi</h3><p>{complaints.length} khiếu nại của đội trong giải này</p></div></div>
              {complaints.length === 0 ? <div className="schedule-empty-state"><strong>Chưa có khiếu nại</strong><span>Các hồ sơ đội gửi sẽ xuất hiện tại đây cùng quyết định của BTC.</span></div> : complaints.map((complaint) => {
                const appeal = appeals[complaint.id];
                const appealStatusError = appealStatusErrors[complaint.id];
                const canAppeal = ["APPROVED", "REJECTED", "CLOSED"].includes(complaint.status)
                  && complaint.submittedBy === userId && !appeal && !appealStatusError;
                const draft = appealDrafts[complaint.id] ?? { description: "", evidence: "" };
                return <article className="team-complaint-card" key={complaint.id}>
                  <div className="team-complaint-card-heading"><div><span className={`status-badge status-${complaint.status.toLowerCase()}`}>{complaintStatusLabels[complaint.status]}</span>
                    <h4>{complaintTypeLabel(complaint.complaintType)} · {formatDate(complaint.submittedAt)}</h4></div><span>Trận {complaint.matchId.slice(0, 8)}</span></div>
                  <p>{complaint.description}</p>{complaint.evidence ? <p className="team-complaint-evidence"><strong>Minh chứng:</strong> {complaint.evidence}</p> : null}
                  {complaint.decisionReason ? <div className="team-complaint-decision"><strong>Phản hồi của BTC</strong><p>{complaint.decisionReason}</p>{complaint.decision ? <span>{complaint.decision}</span> : null}</div> : null}
                  {appeal ? <div className="team-complaint-decision"><strong>Kháng nghị · {appeal.status === "PENDING" ? "Đang chờ BTC" : appeal.status === "APPROVED" ? "Đã chấp thuận" : "Không chấp thuận"}</strong><p>{appeal.description}</p>{appeal.decisionReason ? <span>{appeal.decisionReason}</span> : null}</div> : null}
                  {appealStatusError ? <div className="message-banner message-error" role="alert">{appealStatusError} Hãy tải lại trước khi gửi kháng nghị.</div> : null}
                  {canAppeal ? <div className="team-complaint-appeal"><label className="field">Lý do kháng nghị<textarea value={draft.description} onChange={(event) => setAppealDrafts((current) => ({ ...current, [complaint.id]: { ...draft, description: event.target.value } }))} rows={2} maxLength={4000} placeholder="Nêu căn cứ đề nghị xem xét lại quyết định…" /></label>
                    <label className="field">Minh chứng bổ sung<textarea value={draft.evidence} onChange={(event) => setAppealDrafts((current) => ({ ...current, [complaint.id]: { ...draft, evidence: event.target.value } }))} rows={2} maxLength={4000} /></label>
                    <button className="button-secondary" type="button" disabled={submitting || !draft.description.trim()} onClick={() => void submitAppeal(complaint)}>Gửi kháng nghị</button></div> : null}
                </article>;
              })}
            </div>
          </> : null}
        </>
      )}
    </section>
  );
}

function complaintTypeLabel(type: string): string {
  const labels: Record<string, string> = { RESULT: "Kết quả", REFEREE: "Trọng tài", ELIGIBILITY: "Tư cách cầu thủ", DISCIPLINE: "Kỷ luật", OTHER: "Khác" };
  return labels[type] ?? type;
}
