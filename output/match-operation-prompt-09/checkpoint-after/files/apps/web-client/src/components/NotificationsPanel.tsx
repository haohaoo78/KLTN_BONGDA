import { useEffect, useId, useRef, useState } from "react";
import { API_BASE, NOTIFICATION_REALTIME_EVENT } from "../api/client";
import {
  getMyNotification,
  getMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  getUnreadNotificationCount,
  type AppNotification,
  type NotificationFilters,
} from "../api/notifications";

type Props = {
  userId: string;
  section: string;
  onViewAll: () => void;
  onOpenInvitation: (invitationId: string) => void;
};

function notificationTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("vi-VN");
}

export function NotificationBell({ userId, section, onViewAll, onOpenInvitation }: Props) {
  const dropdownId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [list, count] = await Promise.all([
        getMyNotifications({ limit: 10, offset: 0 }),
        getUnreadNotificationCount(),
      ]);
      setItems(list.notifications);
      setUnreadCount(count.count);
      setError("");
    } catch (reason) {
      setError("Không tải được thông báo. Vui lòng kiểm tra kết nối rồi thử lại.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    const stream = new EventSource(`${API_BASE.replace(/\/$/, "")}/notifications/events`, { withCredentials: true });
    const refreshFromEvent = (event: Event) => {
      void load();
      window.dispatchEvent(new CustomEvent(NOTIFICATION_REALTIME_EVENT, { detail: (event as MessageEvent).data }));
    };
    stream.addEventListener("notification", refreshFromEvent);
    // Polling has no MessageEvent payload. Keep it separate so it cannot
    // dispatch an event with undefined data every 30 seconds.
    const fallback = window.setInterval(() => { void load(); }, 30_000);
    return () => { stream.close(); window.clearInterval(fallback); };
  }, [userId]);

  useEffect(() => {
    setOpen(false);
  }, [section, userId]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function openNotification(notification: AppNotification) {
    try {
      const { notification: detail } = await getMyNotification(notification.id);
      if (!detail.isRead) await markNotificationRead(detail.id);
      setItems((current) => current.map((item) => item.id === detail.id ? { ...detail, isRead: true } : item));
      setUnreadCount((count) => Math.max(0, count - (detail.isRead ? 0 : 1)));
      const invitationId = detail.type === "TOURNAMENT_INVITATION" && detail.data?.status === undefined && typeof detail.data?.invitationId === "string"
        ? detail.data.invitationId
        : null;
      if (invitationId) {
        setOpen(false);
        onOpenInvitation(invitationId);
      } else {
        setOpen(false);
      }
    } catch (reason) {
      setError("Không mở được thông báo. Vui lòng thử lại.");
    }
  }

  async function markAll() {
    if (markingAll || !unreadCount) return;
    setMarkingAll(true);
    try {
      await markAllNotificationsRead();
      setItems((current) => current.map((item) => ({ ...item, isRead: true })));
      setUnreadCount(0);
    } catch (reason) {
      setError("Không thể cập nhật trạng thái đã đọc. Vui lòng thử lại.");
    } finally {
      setMarkingAll(false);
    }
  }

  return (
    <div className="notification-bell" ref={containerRef}>
      <button ref={triggerRef} className="icon-button notification-bell-button" type="button" aria-label={`Thông báo${unreadCount ? `, ${unreadCount} chưa đọc` : ""}`} aria-expanded={open} aria-controls={dropdownId} aria-haspopup="dialog" onClick={() => { if (open) setOpen(false); else { setOpen(true); void load(); } }}>
        <svg viewBox="0 0 24 24" width="19" height="19" fill="none" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        {unreadCount > 0 ? <span className="notification-badge">{unreadCount > 99 ? "99+" : unreadCount}</span> : null}
      </button>
      {open ? (
        <section id={dropdownId} className="notification-dropdown" aria-label="Thông báo mới nhất" role="dialog">
          <div className="notification-dropdown-heading"><strong>Thông báo</strong><button className="text-button" type="button" onClick={() => void markAll()} disabled={!unreadCount || markingAll}>{markingAll ? "Đang cập nhật…" : "Đánh dấu tất cả đã đọc"}</button></div>
          {loading && items.length ? <p className="notification-loading" role="status">Đang đồng bộ thông báo…</p> : null}
          {error ? <div className="notification-error" role="alert"><span>{error}</span><button type="button" onClick={() => void load()}>Thử lại</button></div> : null}
          {loading && !items.length ? <p className="notification-empty" role="status">Đang tải thông báo…</p> : items.length ? items.slice(0, 10).map((item) => (
            <button className={`notification-item ${item.isRead ? "" : "is-unread"}`} type="button" key={item.id} onClick={() => void openNotification(item)}>
              <span className="notification-item-icon" aria-hidden="true">{item.type === "TOURNAMENT_INVITATION" ? "⚽" : "•"}</span><strong>{item.title}</strong><span>{item.body}</span><small>{notificationTime(item.createdAt)}</small>
            </button>
          )) : !loading ? <p className="notification-empty">Chưa có thông báo.</p> : null}
          <button className="notification-view-all" type="button" onClick={() => { setOpen(false); onViewAll(); }}>Xem tất cả thông báo</button>
        </section>
      ) : null}
    </div>
  );
}

export function NotificationsPanel({ onOpenInvitation }: { onOpenInvitation: (invitationId: string) => void }) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [read, setRead] = useState<NonNullable<NotificationFilters["read"]>>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [applied, setApplied] = useState<NotificationFilters>({ limit: 10, offset: 0 });
  const [detail, setDetail] = useState<AppNotification | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getMyNotifications(applied)
      .then(({ notifications, pagination }) => {
        if (active) {
          setItems(notifications);
          setTotal(pagination.total);
          setError("");
        }
      })
      .catch(() => setError("Không tải được thông báo. Vui lòng thử lại."))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [applied]);

  useEffect(() => {
    const stream = new EventSource(`${API_BASE.replace(/\/$/, "")}/notifications/events`, { withCredentials: true });
    const refresh = () => setApplied((current) => ({ ...current }));
    stream.addEventListener("notification", refresh);
    const fallback = window.setInterval(refresh, 30_000);
    return () => { stream.close(); window.clearInterval(fallback); };
  }, []);

  async function selectNotification(item: AppNotification) {
    try {
      const { notification } = await getMyNotification(item.id);
      if (!notification.isRead) {
        const { notification: updated } = await markNotificationRead(item.id);
        setItems((current) => current.map((entry) => entry.id === item.id ? updated : entry));
        setDetail(updated);
      } else {
        setDetail(notification);
      }
    } catch (reason) {
      setError("Không mở được thông báo. Vui lòng thử lại.");
    }
  }

  function applyFilters() {
    setApplied({ search, read, from, to, limit: 10, offset: 0 });
  }

  const currentPage = Math.floor((applied.offset ?? 0) / 10) + 1;
  const pageCount = Math.max(1, Math.ceil(total / 10));

  return (
    <section className="panel data-panel notifications-page">
      <div className="panel-heading"><div><span className="eyebrow">HỘP THƯ CÁ NHÂN</span><h2>Tất cả thông báo</h2></div></div>
      <div className="notification-filters">
        <label className="field">Từ khóa<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm tiêu đề hoặc nội dung" /></label>
        <label className="field">Trạng thái<select value={read} onChange={(event) => setRead(event.target.value as typeof read)}><option value="all">Tất cả</option><option value="unread">Chưa đọc</option><option value="read">Đã đọc</option></select></label>
        <label className="field">Từ ngày<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label className="field">Đến ngày<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        <div className="notification-filter-actions"><button className="primary-button" type="button" onClick={applyFilters}>Áp dụng</button><button className="text-button" type="button" onClick={() => { setSearch(""); setRead("all"); setFrom(""); setTo(""); setApplied({ limit: 10, offset: 0 }); }}>Xóa bộ lọc</button></div>
      </div>
      {error ? <p className="notification-error" role="alert">{error}</p> : null}
      {loading ? <div className="loading-state">Đang tải thông báo…</div> : items.length ? (
        <div className="notification-list">
          {items.map((item) => <button className={`notification-item ${item.isRead ? "" : "is-unread"}`} type="button" key={item.id} onClick={() => void selectNotification(item)}>
            <strong>{item.title}</strong><span>{item.body}</span><small>{notificationTime(item.createdAt)} · {item.isRead ? "Đã đọc" : "Chưa đọc"}</small>
          </button>)}
        </div>
      ) : <div className="notification-empty">Không có thông báo phù hợp.</div>}
      <div className="notification-pagination"><span>{total} thông báo · Trang {currentPage}/{pageCount}</span><div><button className="text-button" type="button" disabled={currentPage <= 1} onClick={() => setApplied((current) => ({ ...current, offset: Math.max(0, (current.offset ?? 0) - 10) }))}>Trước</button><button className="text-button" type="button" disabled={currentPage >= pageCount} onClick={() => setApplied((current) => ({ ...current, offset: (current.offset ?? 0) + 10 }))}>Sau</button></div></div>
      {detail ? <div className="notification-detail" role="dialog" aria-modal="true" aria-label="Chi tiết thông báo"><div className="panel-heading"><h3>{detail.title}</h3><button className="text-button" type="button" onClick={() => setDetail(null)}>Đóng</button></div><p>{detail.body}</p><small>{notificationTime(detail.createdAt)}</small>{detail.type === "TOURNAMENT_INVITATION" && detail.data?.status === undefined && typeof detail.data?.invitationId === "string" ? <div className="form-actions"><button className="primary-button" type="button" onClick={() => { const id = String(detail.data?.invitationId); setDetail(null); onOpenInvitation(id); }}>Mở lời mời và phản hồi ↗</button></div> : null}</div> : null}
    </section>
  );
}
