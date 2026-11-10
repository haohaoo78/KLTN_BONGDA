import { Pool } from "pg";
import type {
  NotificationRecord,
  NotificationCreateInput,
  NotificationUpdateInput,
  DeliveryLogRecord,
  DeliveryLogCreateInput,
  ListNotificationsResult,
} from "../models/notification";

function mapNotification(row: Record<string, unknown>): NotificationRecord {
  return {
    id: Number(row.id),
    userId: String(row.user_id),
    type: String(row.type) as NotificationRecord["type"],
    title: String(row.title),
    body: String(row.body),
    data: (row.data as Record<string, unknown> | null) ?? null,
    isRead: Boolean(row.is_read),
    readAt: row.read_at ? new Date(String(row.read_at)) : null,
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
  };
}

export class NotificationRepository {
  constructor(private pool: Pool) {}

  // Notifications
  async createNotification(
    input: NotificationCreateInput,
  ): Promise<NotificationRecord> {
    const result = await this.pool.query<Record<string, unknown>>(
      `INSERT INTO notifications (user_id, type, title, body, data)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [input.userId, input.type, input.title, input.body, JSON.stringify(input.data || {})],
    );
    return mapNotification(result.rows[0]);
  }

  async findNotificationById(
    id: number,
    userId: string,
  ): Promise<NotificationRecord | null> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT * FROM notifications WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    return result.rows[0] ? mapNotification(result.rows[0]) : null;
  }

  async listUserNotifications(
    userId: string,
    limit: number,
    offset: number,
    filters: { read?: boolean; search?: string; from?: string; to?: string } = {},
  ): Promise<ListNotificationsResult> {
    const values: unknown[] = [userId];
    const conditions = ["user_id = $1"];
    if (filters.read !== undefined) {
      values.push(filters.read);
      conditions.push(`is_read = $${values.length}`);
    }
    if (filters.search) {
      values.push(`%${filters.search}%`);
      conditions.push(`(title ILIKE $${values.length} OR body ILIKE $${values.length})`);
    }
    if (filters.from) {
      values.push(filters.from);
      conditions.push(`created_at >= $${values.length}::date`);
    }
    if (filters.to) {
      values.push(filters.to);
      conditions.push(`created_at < ($${values.length}::date + INTERVAL '1 day')`);
    }
    const whereClause = conditions.join(" AND ");
    const countResult = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM notifications WHERE ${whereClause}`,
      values,
    );
    const total = Number(countResult.rows[0]?.count ?? 0);

    const paginationValues = [...values, limit, offset];
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT * FROM notifications WHERE ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${paginationValues.length - 1} OFFSET $${paginationValues.length}`,
      paginationValues,
    );

    return {
      items: result.rows.map(mapNotification),
      total,
    };
  }

  async updateNotification(
    id: number,
    userId: string,
    input: NotificationUpdateInput,
  ): Promise<NotificationRecord | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (input.isRead !== undefined) {
      sets.push(`is_read = $${idx++}`);
      values.push(input.isRead);
      if (input.isRead) {
        sets.push(`read_at = CURRENT_TIMESTAMP`);
      }
    }

    if (sets.length === 0) {
      return this.findNotificationById(id, userId);
    }

    sets.push("updated_at = CURRENT_TIMESTAMP");
    values.push(id, userId);

    const result = await this.pool.query<Record<string, unknown>>(
      `UPDATE notifications SET ${sets.join(", ")}
       WHERE id = $${idx} AND user_id = $${idx + 1}
       RETURNING *`,
      values,
    );

    return result.rows[0] ? mapNotification(result.rows[0]) : null;
  }

  async markAllAsRead(userId: string): Promise<void> {
    await this.pool.query(
      `UPDATE notifications
       SET is_read = TRUE, read_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1 AND is_read = FALSE`,
      [userId],
    );
  }

  async deleteNotification(id: number, userId: string): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM notifications WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async getUnreadCount(userId: string): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM notifications
       WHERE user_id = $1 AND is_read = FALSE`,
      [userId],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  // Delivery Logs
  async createDeliveryLog(
    input: DeliveryLogCreateInput,
  ): Promise<DeliveryLogRecord> {
    const result = await this.pool.query<DeliveryLogRecord>(
      `INSERT INTO delivery_logs (notification_id, channel, status, error_message, sent_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [input.notificationId, input.channel, input.status, input.errorMessage, input.sentAt],
    );
    return result.rows[0];
  }

  async listDeliveryLogs(
    notificationId: number,
  ): Promise<DeliveryLogRecord[]> {
    const result = await this.pool.query<DeliveryLogRecord>(
      `SELECT * FROM delivery_logs WHERE notification_id = $1 ORDER BY created_at DESC`,
      [notificationId],
    );
    return result.rows;
  }

  async cleanupOldRecords(daysToKeep: number = 90): Promise<void> {
    await this.pool.query(
      `DELETE FROM notifications
       WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '${daysToKeep} days' AND is_read = TRUE`,
    );

    await this.pool.query(
      `DELETE FROM delivery_logs
       WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '${daysToKeep} days'`,
    );
  }
}
