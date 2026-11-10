import { useEffect, useState } from "react";
import {
  getMyTeams,
  getMyManagedTeams,
  getMyTeamTournamentRegistrations,
  getPlayers,
  getTournament,
  getTournamentRosters,
  type Player,
  type RosterEntry,
  type Team,
  type TeamRegistration,
  type Tournament,
} from "../api/competition";
import { Modal } from "./Modal";

type Entry = { team: Team; registration: TeamRegistration; tournament: Tournament | null };
type Props = { canManage: boolean; onManage: (teamId: string, tournamentId: string) => void; onViewTournament: (tournamentId: string) => void };

const statusLabels: Record<TeamRegistration["status"], string> = {
  PENDING: "Chờ BTC duyệt", APPROVED: "Đã duyệt", REJECTED: "Bị từ chối", WITHDRAWN: "Đã rút",
};

export function MyTeamTournamentsPanel({ canManage, onManage, onViewTournament }: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [managedTeamIds, setManagedTeamIds] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Entry | null>(null);
  const [rosters, setRosters] = useState<RosterEntry[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([getMyTeams(), getMyTeamTournamentRegistrations(), canManage ? getMyManagedTeams() : Promise.resolve({ teams: [] as Team[] })])
      .then(async ([membership, teamRegistrationResult, management]) => {
        const teamsById = new Map(membership.teams.map((team) => [team.id, team]));
        const allRegistrations = teamRegistrationResult.registrations.flatMap((registration) => {
          const team = teamsById.get(registration.teamId);
          return team ? [{ team, registration }] : [];
        });
        const result = await Promise.all(allRegistrations.map(async (item) => {
          try { return { ...item, tournament: (await getTournament(item.registration.tournamentId)).tournament }; }
          catch { return { ...item, tournament: null }; }
        }));
        if (!active) return;
        setEntries(result.sort((a, b) => b.registration.registeredAt.localeCompare(a.registration.registeredAt)));
        setManagedTeamIds(new Set(management.teams.map((team) => team.id)));
      })
      .catch((loadError: unknown) => { if (active) setError(loadError instanceof Error ? loadError.message : "Không tải được giải đội bạn tham gia."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [canManage]);

  useEffect(() => {
    if (!selected) { setRosters([]); setPlayers([]); return; }
    let active = true;
    setDetailLoading(true);
    Promise.all([getTournamentRosters(selected.registration.tournamentId, selected.team.id), getPlayers(selected.team.id)])
      .then(([rosterResult, playerResult]) => {
        if (!active) return;
        setRosters(rosterResult.rosters);
        setPlayers(playerResult.players);
      })
      .catch((detailError: unknown) => { if (active) setError(detailError instanceof Error ? detailError.message : "Không tải được danh sách cầu thủ giải."); })
      .finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [selected]);

  return (
    <>
      <section className="panel data-panel my-team-tournaments">
        <div className="panel-heading"><div><span className="eyebrow">THEO DÕI ĐỘI BÓNG</span><h2>Giải đấu đội tôi tham gia</h2><p>Xem trạng thái hồ sơ, danh sách cầu thủ dự giải và lịch sử tham gia của các đội bạn.</p></div></div>
        {error ? <div className="message-banner message-error" role="alert">{error}</div> : null}
        {loading ? <div className="loading-state">Đang tải hồ sơ tham gia giải…</div> : entries.length ? (
          <div className="my-tournament-list">
            {entries.map((entry) => (
              <article className="my-tournament-row" key={entry.registration.id}>
                <div className="my-tournament-icon">🏆</div>
                <div className="my-tournament-copy"><span className={`status-pill status-${entry.registration.status.toLowerCase()}`}>{statusLabels[entry.registration.status]}</span><h3>{entry.tournament?.name ?? "Giải đấu"}</h3><p>{entry.team.name} · Gửi lúc {new Date(entry.registration.registeredAt).toLocaleString("vi-VN")}</p></div>
                <div className="button-row">
                  <button className="text-button" type="button" onClick={() => setSelected(entry)}>Hồ sơ & lịch sử</button>
                  {entry.tournament ? <button className="text-button" type="button" onClick={() => onViewTournament(entry.tournament!.id)}>Lịch & kết quả</button> : null}
                  {canManage && managedTeamIds.has(entry.team.id) && ["PENDING", "APPROVED"].includes(entry.registration.status) ? <button className="primary-button" type="button" onClick={() => onManage(entry.team.id, entry.registration.tournamentId)}>Quản lý roster</button> : null}
                </div>
              </article>
            ))}
          </div>
        ) : <div className="empty-state"><h3>Chưa có đội nào đăng ký giải</h3><p>Khi đội do bạn tham gia gửi hồ sơ dự giải, lịch sử và roster sẽ hiện tại đây.</p></div>}
      </section>
      <Modal open={Boolean(selected)} title={selected?.tournament?.name ?? "Hồ sơ tham gia giải"} description={selected ? `${selected.team.name} · ${statusLabels[selected.registration.status]}` : undefined} onClose={() => setSelected(null)} className="modal-wide">
        {selected ? <div className="my-tournament-detail">
          <div className="my-tournament-facts"><div><span>ĐỘI BÓNG</span><strong>{selected.team.name}</strong></div><div><span>TRẠNG THÁI</span><strong>{statusLabels[selected.registration.status]}</strong></div><div><span>NGÀY GỬI</span><strong>{new Date(selected.registration.registeredAt).toLocaleString("vi-VN")}</strong></div><div><span>PHẢN HỒI / GHI CHÚ</span><strong>{selected.registration.notes || "Chưa có ghi chú từ BTC"}</strong></div></div>
          <section><div className="panel-heading"><div><span className="eyebrow">DANH SÁCH CẦU THỦ DỰ GIẢ</span><h3>Roster giải đấu</h3></div><span className="status-pill">{rosters.length} cầu thủ</span></div>
            {detailLoading ? <div className="loading-state">Đang tải roster…</div> : rosters.length ? <div className="my-tournament-roster">{rosters.map((roster) => { const player = players.find((item) => item.id === roster.playerId); return <article className="institution-row" key={roster.id}><div><strong>{player?.fullName ?? "Cầu thủ"}</strong><p>MSSV: {player?.studentId ?? "—"} · {player?.position ?? "Chưa rõ vị trí"}</p></div><span className={`status-pill status-${roster.reviewStatus.toLowerCase()}`}>{roster.reviewStatus === "APPROVED" ? "Đã duyệt" : roster.reviewStatus === "REVISION_REQUIRED" ? "Cần bổ sung" : roster.reviewStatus === "REJECTED" ? "Từ chối" : "Chờ BTC"}</span></article>; })}</div> : <div className="empty-state"><p>Đội chưa gửi danh sách cầu thủ cho giải này.</p></div>}
          </section>
          <div className="form-actions"><button className="text-button" type="button" onClick={() => setSelected(null)}>Đóng</button>{canManage && managedTeamIds.has(selected.team.id) && ["PENDING", "APPROVED"].includes(selected.registration.status) ? <button className="primary-button" type="button" onClick={() => { const { team, registration } = selected; setSelected(null); onManage(team.id, registration.tournamentId); }}>Cập nhật roster</button> : null}</div>
        </div> : null}
      </Modal>
    </>
  );
}
