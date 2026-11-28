import { useEffect, useState } from "react";
import { getTournamentRegulations, type Tournament, type TournamentRegulation } from "../api/competition";
import { Modal } from "./Modal";

type Props = {
  open: boolean;
  tournament: Tournament;
  onClose: () => void;
};

const competitionFormatLabels: Record<NonNullable<Tournament["competitionFormat"]>, string> = {
  ROUND_ROBIN: "Vòng tròn",
  KNOCKOUT: "Loại trực tiếp",
  GROUP_AND_KNOCKOUT: "Vòng bảng và loại trực tiếp",
};

function dateLabel(value: string | null | undefined): string {
  if (!value) return "Chưa thiết lập";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
}

function formatLabel(tournament: Tournament): string {
  const format = tournament.footballFormat;
  return format ? `Bóng đá ${format} người` : "Chưa thiết lập";
}

export function TournamentRegulationSummaryModal({ open, tournament, onClose }: Props) {
  const [regulations, setRegulations] = useState<TournamentRegulation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const rules = tournament.rules;

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError("");
    void getTournamentRegulations(tournament.id)
      .then(({ regulations: items }) => { if (active) setRegulations(items); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Không tải được nội dung điều lệ."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, tournament.id]);

  const facts: Array<[string, string]> = [
    ["Thể thức", competitionFormatLabels[tournament.competitionFormat ?? "ROUND_ROBIN"]],
    ["Loại bóng", formatLabel(tournament)],
    ["Thời gian thi đấu", `${dateLabel(tournament.startDate)} – ${dateLabel(tournament.endDate)}`],
    ["Số đội", `Tối thiểu ${tournament.minTeams ?? "—"} · Tối đa ${tournament.maxTeams}`],
    ["Roster mỗi đội", `${tournament.minPlayers ?? "—"}–${tournament.maxPlayersPerTeam ?? "—"} cầu thủ · ${tournament.minGoalkeepers ?? "—"} thủ môn tối thiểu`],
    ["Thời lượng trận", rules?.matchDurationMinutes ? `${rules.matchDurationMinutes} phút` : "Chưa quy định"],
    ["Nghỉ tối thiểu", rules?.minimumRestMinutes ? `${rules.minimumRestMinutes} phút` : "Chưa quy định"],
    ["Điểm số", rules ? `Thắng ${rules.pointsForWin} · Hòa ${rules.pointsForDraw} · Thua ${rules.pointsForLoss}` : "Chưa thiết lập"],
    ["Lượt vòng tròn", `${rules?.roundRobinLegs ?? tournament.roundRobinLegs ?? 1} lượt`],
    ["Đội đi tiếp mỗi bảng", rules?.advancingTeamsPerGroup ? `${rules.advancingTeamsPerGroup} đội` : "Theo cấu hình thể thức"],
    ["Hiệp phụ và luân lưu", rules?.knockoutDecisionMethod === "EXTRA_TIME_THEN_PENALTIES" ? `Hiệp phụ ${rules.extraTimeMinutes} phút, sau đó luân lưu` : rules?.knockoutDecisionMethod === "PENALTIES_ONLY" ? "Luân lưu, không đá hiệp phụ" : "Theo điều lệ"],
    ["Phiên bản điều lệ", rules?.publishedVersion ? `Phiên bản ${rules.publishedVersion}${rules.publishedAt ? ` · hiệu lực ${dateLabel(rules.publishedAt)}` : ""}` : "Chưa công bố phiên bản"],
  ];

  return (
    <Modal
      open={open}
      title="Thông tin & điều lệ giải"
      description="Bản xem chỉ đọc của thông tin đã thiết lập ở Bước 1. Công bố bảng đấu, sơ đồ hay lịch thi đấu không làm mất điều lệ."
      onClose={onClose}
      className="tournament-regulation-summary-modal"
      eyebrow="TRA CỨU GIẢI ĐẤU"
    >
      <div className="tournament-regulation-summary">
        <section className="tournament-regulation-summary-facts" aria-label="Thông tin và thông số điều lệ">
          {facts.map(([label, value]) => <article key={label}><small>{label}</small><strong>{value}</strong></article>)}
        </section>
        {rules?.eligibilityDescription ? <section className="tournament-regulation-summary-section"><h3>Điều kiện tham gia</h3><p>{rules.eligibilityDescription}</p></section> : null}
        <section className="tournament-regulation-summary-section">
          <div className="panel-heading panel-heading-wrap"><div><span className="eyebrow">QUY ĐỊNH CHÍNH THỨC</span><h3>Nội dung điều lệ</h3></div></div>
          {loading ? <p className="loading-state" role="status">Đang tải điều lệ…</p> : error ? <p className="form-error" role="alert">{error}</p> : regulations.length ? regulations.map((item) => <article className="tournament-regulation-summary-document" key={item.id}><h4>{item.title}</h4><p>{item.content}</p><small>Cập nhật {dateLabel(item.updatedAt)}</small></article>) : <div className="empty-state"><p>Giải chưa có nội dung điều lệ dạng văn bản.</p><p>Các thông số và điều kiện cấu trúc ở trên được lấy từ hồ sơ giải hiện tại.</p></div>}
        </section>
        <p className="form-help">Thông tin giải và điều lệ đã khóa sau khi giải rời trạng thái bản nháp. Muốn mở màn hình quản lý đầy đủ, chọn lại Bước 1 trên thanh quy trình.</p>
      </div>
    </Modal>
  );
}
