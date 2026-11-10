import { NotificationRepository } from "../repositories/notificationRepository";
import type {
  NotificationCreateInput,
  NotificationUpdateInput,
  DeliveryLogCreateInput,
} from "../models/notification";

export class NotificationService {
  constructor(private notificationRepository: NotificationRepository) {}

  async createNotification(input: NotificationCreateInput) {
    const notification = await this.notificationRepository.createNotification(input);

    // In production, this would trigger actual delivery (email, SMS, etc.)
    // For now, we'll just log delivery attempts
    await this.notificationRepository.createDeliveryLog({
      notificationId: notification.id,
      channel: "IN_APP",
      status: "SENT",
      sentAt: new Date(),
    });

    return notification;
  }

  async getNotification(id: number, userId: string) {
    return this.notificationRepository.findNotificationById(id, userId);
  }

  async listUserNotifications(
    userId: string,
    limit: number,
    offset: number,
    filters: { read?: boolean; search?: string; from?: string; to?: string } = {},
  ) {
    return this.notificationRepository.listUserNotifications(
      userId,
      limit,
      offset,
      filters,
    );
  }

  async markAsRead(id: number, userId: string) {
    return this.notificationRepository.updateNotification(id, userId, { isRead: true });
  }

  async markAllAsRead(userId: string) {
    await this.notificationRepository.markAllAsRead(userId);
  }

  async deleteNotification(id: number, userId: string) {
    return this.notificationRepository.deleteNotification(id, userId);
  }

  async getUnreadCount(userId: string) {
    return this.notificationRepository.getUnreadCount(userId);
  }

  async sendNotification(input: NotificationCreateInput) {
    return this.createNotification(input);
  }

  async cleanupOldRecords() {
    await this.notificationRepository.cleanupOldRecords(90);
  }
}
