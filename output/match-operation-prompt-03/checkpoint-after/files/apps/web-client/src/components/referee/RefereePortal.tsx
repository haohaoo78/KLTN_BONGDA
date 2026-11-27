import { useCallback, useEffect, useState } from "react";
import { getRefereeAssignments, type RefereeAssignment } from "../../api/refereePortal";
import { NOTIFICATION_REALTIME_EVENT } from "../../api/client";
import { useRefereeRefresh } from "./useRefereeRefresh";
import { RefereeOverviewPage } from "./RefereeOverviewPage";
import { RefereeAssignmentsPage } from "./RefereeAssignmentsPage";
import { RefereeMatchDetailPage } from "./RefereeMatchDetailPage";
import { RefereeOperationPage } from "./RefereeOperationPage";
import { RefereeReportsPage, RefereeReportDetailPage } from "./RefereeReportsPage";
import { EmptyState, RefereeLink } from "./RefereeShared";
import { useRefereeContext } from "./useRefereeContext";
import { parseRefereeRoute } from "./refereeRoutes";
import "./referee-portal.css";

export function RefereePortal({ path, fullName, revision }: { path: string; fullName: string; revision: number }) {
  const [items, setItems] = useState<RefereeAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((value) => value + 1), []);
  useRefereeRefresh(refresh);
  useEffect(() => { window.addEventListener(NOTIFICATION_REALTIME_EVENT, refresh); return () => window.removeEventListener(NOTIFICATION_REALTIME_EVENT, refresh); }, [refresh]);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    void getRefereeAssignments().then(({ items: rows }) => { if (active) { setItems(rows); setLoaded(true); } }).catch((err: unknown) => { if (active) { setItems([]); setLoaded(false); setError(err instanceof Error ? err.message : "Không tải được lịch phân công."); } }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision, tick]);
  const route = parseRefereeRoute(path);
  const detail = useRefereeContext(route.matchId, revision + tick);
  const failure = route.matchId ? detail.error : error;
  const pending = route.matchId ? !detail.context && (detail.loading || !failure) : loading && !loaded;
  let page;
  if (failure) page = <div className="rf-error" role="alert"><strong>{route.matchId && detail.accessDenied ? "Không còn quyền truy cập trận đấu" : "Không tải được dữ liệu"}</strong><p>{failure}</p><div className="rf-card-actions"><button className="rf-button" type="button" onClick={route.matchId ? detail.refresh : refresh}>Thử lại</button>{route.matchId ? <RefereeLink className="rf-button" href="/referee/assignments">Quay lại lịch phân công</RefereeLink> : null}</div></div>;
  else if (pending) page = <div className="rf-card rf-loading" role="status">Đang tải phân công chính thức…</div>;
  else if (route.page === "overview") page = <RefereeOverviewPage items={items} fullName={fullName} />;
  else if (route.page === "assignments") page = <RefereeAssignmentsPage items={items} />;
  else if (route.page === "reports") page = <RefereeReportsPage items={items} />;
  else if (route.page === "assignment" && detail.context) page = <RefereeMatchDetailPage context={detail.context} />;
  else if (route.page === "operation" && detail.context) page = <RefereeOperationPage key={route.matchId} context={detail.context} refresh={detail.refresh} refreshing={detail.loading} />;
  else if (route.page === "report" && detail.context) page = <RefereeReportDetailPage context={detail.context} />;
  else page = <div className="rf-card"><EmptyState title="Không tìm thấy trang"><RefereeLink href="/referee">Quay lại Tổng quan</RefereeLink></EmptyState></div>;
  return <div className="referee-portal">{page}</div>;
}
