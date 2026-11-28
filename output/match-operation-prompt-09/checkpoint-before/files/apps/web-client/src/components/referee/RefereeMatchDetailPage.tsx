import type { ReactNode } from "react";
import type { RefereeMatchContext } from "../../api/refereePortal";
import { dateLabel, timeLabel, EmptyState, RefereeIcon, RefereeLink, StatusBadge, TeamMark, roundDescription } from "./RefereeShared";
import { refereePaths } from "./refereeRoutes";
import { MATCH_LAW_PROFILES, RULE_VALUE_LABELS } from "../../../../../packages/shared/src/matchOperationRules";

export function MatchIdentity({ context, compact = false }: { context: RefereeMatchContext; compact?: boolean }) {
  return <article className={`rf-card rf-identity ${compact ? "is-compact" : ""}`}><div className="rf-match-teams"><div><TeamMark team={context.home} large /><h3>{context.home.name}</h3></div><div className="rf-versus">{context.result ? `${context.result.homeScore+(context.result.homeExtraTimeScore??0)} : ${context.result.awayScore+(context.result.awayExtraTimeScore??0)}` : "VS"}<small>{roundDescription(context)}</small></div><div><TeamMark team={context.away} large /><h3>{context.away.name}</h3></div></div><div className="rf-match-meta"><span><RefereeIcon name="calendar" />{dateLabel(context.schedule.scheduledDate)} · {timeLabel(context.schedule.scheduledDate)}</span><span><RefereeIcon name="pin" />{context.venueName}{context.venueLocation ? ` · ${context.venueLocation}` : ""}</span></div></article>;
}
export function RefereeBreadcrumb({ current, matchId }: { current: string; matchId?: string }) {
  return <nav className="rf-breadcrumb" aria-label="Đường dẫn trang"><RefereeLink href={refereePaths.overview}>Tổng quan</RefereeLink><span>/</span><RefereeLink href={refereePaths.assignments}>Lịch phân công</RefereeLink>{matchId ? <><span>/</span><RefereeLink href={refereePaths.assignment(matchId)}>Chi tiết trận</RefereeLink></> : null}<span>/</span><span aria-current="page">{current}</span></nav>;
}
export function RefereeCrewCard({ context }: { context: RefereeMatchContext }) {
  return <article className="rf-card"><header className="rf-card-header"><h2>Tổ trọng tài</h2><span className="rf-count">{context.crew.length} người</span></header><ul className="rf-crew-list">{context.crew.map((member) => <li key={member.refereeId} className={member.isMe ? "is-me" : ""}><span className="rf-crew-avatar">{member.fullName.split(" ").slice(-1)[0]?.[0] ?? "T"}</span><div><strong>{member.fullName}{member.isMe ? <span className="rf-you">Bạn</span> : null}</strong><small>{member.label}{member.isFinalAuthority ? " · Xác nhận kết quả cuối cùng" : ""}</small></div><RefereeIcon name="whistle" size={18} /></li>)}</ul></article>;
}
export function RefereeLineups({context,actions}:{context:RefereeMatchContext;actions?:(teamId:string)=>ReactNode}) {
 return <div className="rf-two-columns">{[context.home,context.away].map((side,index)=>{
  const players=context.lineups.filter(p=>p.teamId===side.id),squad=context.preparation?.squads.find(s=>s.teamId===side.id);
  const state=!squad||squad.status==="DRAFT"?"Đội trưởng chưa gửi":squad.status==="CHANGES_REQUESTED"?"Đang yêu cầu điều chỉnh":squad.reviewedAt?"✓ Đã gửi · trọng tài đã kiểm tra":"Đã gửi · chờ trọng tài kiểm tra";
  return <article className="rf-card" key={side.id??index}><header className="rf-card-header"><h2 className="rf-team-heading"><TeamMark team={side}/>{side.name}</h2><span className="rf-count">{players.filter(p=>p.isStarting).length} xuất phát · {players.filter(p=>!p.isStarting).length} dự bị</span></header><div className="rf-lineup-status">{state}</div>{squad?.note?<p className="rf-card-padding">Nội dung cần điều chỉnh: {squad.note}</p>:null}{squad?.issues.map((i,n)=><p className="rf-inline-error rf-card-padding" key={n}>{i.playerId?`${context.playerNames[i.playerId]??"Cầu thủ trong hồ sơ"}: `:""}{i.message}</p>)}{players.length?[true,false].map(starting=><section className="rf-lineup-section" key={String(starting)}><h3>{starting?"Đội hình xuất phát":"Cầu thủ dự bị"}</h3><ul>{players.filter(p=>p.isStarting===starting).map(p=><li key={p.id}><span className="rf-shirt">{p.jerseyNumber??"—"}</span><strong>{p.fullName}</strong><small>{p.position==="GK"?"Thủ môn":p.position??"Chưa cập nhật vị trí"}</small></li>)}</ul>{!players.some(p=>p.isStarting===starting)?<p className="rf-muted">Chưa có cầu thủ.</p>:null}</section>):<EmptyState title="Chưa có đội hình">Đội trưởng cần gửi danh sách từ roster chính thức của giải.</EmptyState>}{side.id?actions?.(side.id):null}</article>;
 })}</div>;
}

export function RefereeRulesCard({ context }: { context: RefereeMatchContext }) {
  const rules = context.rules;
  return <article className="rf-card"><header className="rf-card-header"><h2>Điều lệ áp dụng</h2>{rules?.publishedVersion ? <span className="rf-count">Phiên bản {rules.publishedVersion}</span> : null}</header><OperationRulesSource context={context} /><dl className="rf-facts"><div><dt>Loại sân</dt><dd>Bóng đá {context.tournament.footballFormat} người</dd></div><div><dt>Thời lượng trận</dt><dd>{rules?.matchDurationMinutes ? `${rules.matchDurationMinutes} phút` : "Chưa cập nhật"}</dd></div><div><dt>Thẻ vàng treo giò</dt><dd>{rules?.yellowCardsForSuspension ? `${rules.yellowCardsForSuspension} thẻ · nghỉ ${rules.suspensionMatches ?? "—"} trận` : "Chưa cập nhật"}</dd></div>{context.match.stage === "KNOCKOUT" ? <div><dt>Phân định hòa</dt><dd>{rules?.knockoutDecisionMethod === "PENALTIES_ONLY" ? "Luân lưu trực tiếp" : rules?.knockoutDecisionMethod === "EXTRA_TIME_THEN_PENALTIES" ? `Hiệp phụ ${rules.extraTimeMinutes ?? "—"} phút, sau đó luân lưu` : "Chưa cập nhật"}</dd></div> : <div><dt>Tính điểm</dt><dd>{rules?.pointsForWin != null ? `Thắng ${rules.pointsForWin} · Hòa ${rules.pointsForDraw} · Thua ${rules.pointsForLoss}` : "Chưa cập nhật"}</dd></div>}</dl></article>;
}
function OperationRulesSource({ context }: { context: RefereeMatchContext }) {
  const effective = context.operationRules;
  if (!effective) return null;
  const law = MATCH_LAW_PROFILES.find(p => p.code === effective.rules.lawCode);
  return <div className="rf-lineup-status"><strong>{law?.label ?? "Chưa xác định bộ luật áp dụng"}</strong>
    {effective.base.source === "MISSING_DRAW_SNAPSHOT" ? <p>Trận cũ chưa lưu phiên bản điều lệ liên kết. BTC cần xác nhận căn cứ bằng bản bổ sung có lịch sử; hệ thống không tự dùng điều lệ hiện tại thay cho bản gốc.</p> : null}
    <p>Điều lệ v{effective.base.regulationVersion ?? "—"} · {effective.supplement ? `bổ sung ${effective.supplement.revision} · bản áp dụng ${effective.bindingRevision}` : "chưa có bản bổ sung được áp dụng cho trận"}.</p>
    {effective.rules.values.clockMode ? <p>Đồng hồ: {RULE_VALUE_LABELS[String(effective.rules.values.clockMode)]} · {String(effective.rules.values.periodMinutes ?? "—")} phút/hiệp.</p> : null}
    {effective.missing.CLOCK.length ? <p>Cần bổ sung trước khi điều khiển bắt đầu trận: {effective.missing.CLOCK.join("; ")}.</p> : null}
  </div>;
}
export function RefereeMatchDetailPage({ context }: { context: RefereeMatchContext }) {
  const playable = !["CANCELLED", "POSTPONED", "VERIFIED", "LOCKED"].includes(context.match.status);
  return <><RefereeBreadcrumb current="Chi tiết trận" /><header className="rf-page-heading"><div><span className="rf-eyebrow">{context.tournament.name}</span><h1>Chi tiết trận được phân công</h1><p>{roundDescription(context)}</p></div><StatusBadge status={context.match.status} /></header><MatchIdentity context={context} /><div className="rf-duty-banner"><div><RefereeIcon name="whistle" /><div><span>Nhiệm vụ của bạn</span><strong>{context.assignment.label}{context.assignment.isFinalAuthority ? " · Xác nhận kết quả cuối cùng" : ""}</strong></div></div>{playable ? <RefereeLink className="rf-button primary" href={refereePaths.operation(context.match.id)}>{context.match.status === "IN_PROGRESS" ? "Vào trận" : context.match.status === "FINISHED" ? "Hoàn thiện biên bản" : "Vào không gian tác nghiệp"}<RefereeIcon name="arrow" size={16} /></RefereeLink> : <RefereeLink className="rf-button" href={refereePaths.report(context.match.id)}>Xem biên bản</RefereeLink>}</div><div className="rf-two-columns rf-section-gap"><RefereeRulesCard context={context} /><RefereeCrewCard context={context} /></div><section className="rf-section-gap"><h2 className="rf-section-title">Đội hình thi đấu</h2><RefereeLineups context={context} /></section></>;
}
