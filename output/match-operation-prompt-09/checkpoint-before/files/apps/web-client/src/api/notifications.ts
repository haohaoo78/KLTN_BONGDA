import { apiFetch } from "./client";

export type AppNotification = {
  id: number;
  userId: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
};

export type NotificationFilters = {
  search?: string;
  read?: "all" | "read" | "unread";
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
};

export function getMyNotifications(filters: NotificationFilters = {}): Promise<{
  notifications: AppNotification[];
  pagination: { limit: number; offset: number; total: number };
}> {
  const params = new URLSearchParams({
    limit: String(filters.limit ?? 10),
    offset: String(filters.offset ?? 0),
  });
  if (filters.search?.trim()) params.set("search", filters.search.trim());
  if (filters.read && filters.read !== "all") params.set("read", String(filters.read === "read"));
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  return apiFetch(`/notifications?${params.toString()}`);
}

export function getMyNotification(id: number): Promise<{ notification: AppNotification }> {
  return apiFetch(`/notifications/${id}`);
}

export function markNotificationRead(id: number): Promise<{ notification: AppNotification }> {
  return apiFetch(`/notifications/${id}/read`, { method: "POST" });
}

export function markAllNotificationsRead(): Promise<{ message: string }> {
  return apiFetch("/notifications/mark-all-read", { method: "POST" });
}

export function getUnreadNotificationCount(): Promise<{ count: number }> {
  return apiFetch("/notifications/unread-count");
}
