import { useEffect, useState } from "react";
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
  onViewAll: () => void;
};

function notificationTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("vi-VN");
}

export function NotificationBell({ userId, onViewAll }: Props) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState("");

  async function load() {
    try {
      const [list, count] = await Promise.all([
        getMyNotifications({ limit: 10, offset: 0 }),
        getUnreadNotificationCount(),
      ]);
      setItems(list.notifications);
      setUnreadCount(count.count);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tải được thông báo.");
    }
  }

  useEffect(() => {
    void load();
  }, [userId]);

  async function openNotification(notification: AppNotification) {
    try {
      const { notification: detail } = await getMyNotification(notification.id);
      if (!detail.isRead) await markNotificationRead(detail.id);
      setItems((current) => current.map((item) => item.id === detail.id ? { ...detail, isRead: true } : item));
      setUnreadCount((count) => Math.max(0, count - (detail.isRead ? 0 : 1)));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không mở được thông báo.");
    }
  }

  async function markAll() {
    try {
      await markAllNotificationsRead();
      setItems((current) => current.map((item) => ({ ...item, isRead: true })));
      setUnreadCount(0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thể đánh dấu đã đọc.");
    }
  }

  return (
    <div className="notification-bell">
      <button className="icon-button notification-bell-button" type="button" aria-label="Thông báo" aria-expanded={open} onClick={() => { setOpen((value) => !value); if (!open) void load(); }}>
        <svg viewBox="0 0 24 24" width="19" height="19" fill="none" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        {unreadCount > 0 ? <span className="notification-badge">{unreadCount > 99 ? "99+" : unreadCount}</span> : null}
      </button>
      {open ? (
        <section className="notification-dropdown" aria-label="Thông báo mới nhất">
          <div className="notification-dropdown-heading"><strong>Thông báo</strong><button className="text-button" type="button" onClick={() => void markAll()} disabled={!unreadCount}>Đánh dấu tất cả đã đọc</button></div>
          {error ? <p className="notification-error" role="alert">{error}</p> : null}
          {items.length ? items.map((item) => (
            <button className={`notification-item ${item.isRead ? "" : "is-unread"}`} type="button" key={item.id} onClick={() => void openNotification(item)}>
              <strong>{item.title}</strong><span>{item.body}</span><small>{notificationTime(item.createdAt)}</small>
            </button>
          )) : <p className="notification-empty">Chưa có thông báo.</p>}
          <button className="notification-view-all" type="button" onClick={() => { setOpen(false); onViewAll(); }}>Xem tất cả thông báo</button>
        </section>
      ) : null}
    </div>
  );
}

export function NotificationsPanel() {
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
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Không tải được thông báo."))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [applied]);

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
      setError(reason instanceof Error ? reason.message : "Không mở được thông báo.");
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
      {detail ? <div className="notification-detail" role="dialog" aria-modal="true" aria-label="Chi tiết thông báo"><div className="panel-heading"><h3>{detail.title}</h3><button className="text-button" type="button" onClick={() => setDetail(null)}>Đóng</button></div><p>{detail.body}</p><small>{notificationTime(detail.createdAt)}</small></div> : null}
    </section>
  );
}
