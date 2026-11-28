import { useState, type AnchorHTMLAttributes, type ReactNode } from "react";
import type { RefereeAssignment, RefereeTeamSide } from "../../api/refereePortal";
import { refereePaths } from "./refereeRoutes";

export function RefereeLink({ children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props}>{children}</a>;
}
export function RefereeIcon({ name, size = 20 }: { name: "calendar" | "whistle" | "clock" | "check" | "arrow" | "pin" | "file" | "bell"; size?: number }) {
  const paths = { calendar: "M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z", whistle: "M8 11a6 6 0 1 0 6 6v-4h7V7h-7l-3 4H8Zm0 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM3 6l2 2m5-6v4m8-4-2 3", clock: "M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z", check: "m7 12 3 3 7-7M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z", arrow: "M5 12h14m-6-6 6 6-6 6", pin: "M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Zm-5 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z", file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm0 0v6h6M8 13h8m-8 4h6", bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
export const matchStatusLabels: Record<string, string> = { UNSCHEDULED: "Chưa xếp lịch", SCHEDULED: "Sắp diễn ra", LINEUP_CONFIRMED: "Đã sẵn sàng", IN_PROGRESS: "Đang thi đấu", FINISHED: "Đã kết thúc", VERIFIED: "Đã xác nhận", LOCKED: "Đã khóa kết quả", POSTPONED: "Tạm hoãn", CANCELLED: "Đã hủy" };
export const reportStatusLabels: Record<string, string> = { DRAFT:"Bản nháp", PENDING: "Chờ xác nhận", APPROVED: "Đã xác nhận", REJECTED: "Đã từ chối", REVISION_REQUIRED: "Cần bổ sung" };
export const eventLabels: Record<string, string> = { GOAL: "Bàn thắng", OWN_GOAL: "Phản lưới nhà", PENALTY_GOAL: "Bàn thắng phạt đền", YELLOW_CARD: "Thẻ vàng", RED_CARD: "Thẻ đỏ", SUBSTITUTION_IN: "Vào sân", SUBSTITUTION_OUT: "Thay người", SECOND_YELLOW_CARD:"Thẻ vàng thứ hai · truất quyền",INJURY:"Chấn thương",PLAYER_LEAVE:"Rời sân tạm thời",PLAYER_RETURN:"Trở lại sân",REPLACEMENT_IN:"Bổ sung người sau truất quyền",INCIDENT:"Sự cố" };
export const phaseLabels: Record<string, string> = { NOT_STARTED: "Chưa bắt đầu", FIRST_HALF: "Hiệp một", HALF_TIME: "Nghỉ giữa hiệp", SECOND_HALF: "Hiệp hai", REGULATION_COMPLETE: "Hết giờ chính thức", EXTRA_TIME_FIRST_HALF: "Hiệp phụ một", EXTRA_TIME_HALF_TIME: "Nghỉ hiệp phụ", EXTRA_TIME_SECOND_HALF: "Hiệp phụ hai", EXTRA_TIME_COMPLETE: "Hết hiệp phụ", PENALTIES: "Luân lưu", ENDED: "Kết thúc trận" };
export const dateLabel = (value: string, options?: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("vi-VN", { ...(options ?? { day: "2-digit", month: "2-digit", year: "numeric" }), timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(value));
export const timeLabel = (value: string) => dateLabel(value, { hour: "2-digit", minute: "2-digit" });
export function roundDescription(item: Pick<RefereeAssignment, "groupName" | "roundLabel">): string {
  return !item.groupName || item.roundLabel === item.groupName || item.roundLabel.startsWith(`${item.groupName} · `)
    ? item.roundLabel : `${item.groupName} · ${item.roundLabel}`;
}
export function StatusBadge({ status, report = false }: { status: string; report?: boolean }) {
  return <span className={`rf-badge rf-status-${status.toLowerCase()}`}><i aria-hidden="true" />{(report ? reportStatusLabels : matchStatusLabels)[status] ?? "Chưa cập nhật"}</span>;
}
export function TeamMark({ team, large = false }: { team: RefereeTeamSide; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  return <span className={`rf-team-mark ${large ? "is-large" : ""}`}>{team.logoUrl && !failed ? <img src={team.logoUrl} alt={`Logo ${team.name}`} onError={() => setFailed(true)} /> : <span aria-hidden="true">{team.name.split(" ").filter(Boolean).slice(0, 2).map((word) => word[0]).join("")}</span>}</span>;
}
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="rf-empty"><RefereeIcon name="calendar" size={32} /><h3>{title}</h3>{children ? <p>{children}</p> : null}</div>;
}
export function MetricCards({ items }: { items: Array<{ label: string; value: number | string; icon: "calendar" | "whistle" | "clock" | "check" }> }) {
  return <div className="rf-metrics">{items.map((item) => <article className="rf-metric" key={item.label}><span className={`rf-metric-icon rf-icon-${item.icon}`}><RefereeIcon name={item.icon} /></span><div><span>{item.label}</span><strong>{item.value}</strong></div></article>)}</div>;
}
export function MatchSummaryCard({ item }: { item: RefereeAssignment }) {
  const live = item.match.status === "IN_PROGRESS";
  return <article className="rf-card rf-match-card"><header className="rf-card-header"><div><span className="rf-eyebrow">{live ? "TRẬN ĐANG DIỄN RA" : "TRẬN ĐẤU SẮP DIỄN RA"}</span><h2>{item.tournament.name}</h2></div><StatusBadge status={item.match.status} /></header><div className="rf-match-teams"><div><TeamMark team={item.home} large /><h3>{item.home.name}</h3></div><div className="rf-versus">{item.result ? `${item.result.homeScore} : ${item.result.awayScore}` : "VS"}<small>{roundDescription(item)}</small></div><div><TeamMark team={item.away} large /><h3>{item.away.name}</h3></div></div><div className="rf-match-meta"><span><RefereeIcon name="calendar" />{dateLabel(item.schedule.scheduledDate)} · {timeLabel(item.schedule.scheduledDate)}</span><span><RefereeIcon name="pin" />{item.venueName}</span></div><footer className="rf-match-footer"><div><span>Nhiệm vụ của bạn</span><strong>{item.assignment.label}{item.assignment.isFinalAuthority ? " · Xác nhận kết quả" : ""}</strong></div><RefereeLink className="rf-button primary" href={live ? refereePaths.operation(item.match.id) : refereePaths.assignment(item.match.id)}>{live ? "Vào trận" : "Xem chi tiết"}<RefereeIcon name="arrow" size={16} /></RefereeLink></footer></article>;
}
