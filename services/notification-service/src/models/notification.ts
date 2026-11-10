export type NotificationType =
  | "MATCH_SCHEDULED"
  | "MATCH_RESULT"
  | "REGISTRATION_APPROVED"
  | "REGISTRATION_REJECTED"
  | "CARD_ISSUED"
  | "SUSPENSION_ISSUED"
  | "COMPLAINT_RESPONSE"
  | "TEAM_MEMBERSHIP"
  | "SYSTEM";

export type NotificationChannel = "EMAIL" | "IN_APP" | "SMS";
export type DeliveryStatus = "PENDING" | "SENT" | "FAILED";

export interface NotificationRecord {
  id: number;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  isRead: boolean;
  readAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NotificationCreateInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface NotificationUpdateInput {
  isRead?: boolean;
}

export interface DeliveryLogRecord {
  id: number;
  notificationId: number;
  channel: NotificationChannel;
  status: DeliveryStatus;
  errorMessage: string | null;
  sentAt: Date | null;
  createdAt: Date;
}

export interface DeliveryLogCreateInput {
  notificationId: number;
  channel: NotificationChannel;
  status: DeliveryStatus;
  errorMessage?: string;
  sentAt?: Date;
}

export interface ListNotificationsResult {
  items: NotificationRecord[];
  total: number;
}
