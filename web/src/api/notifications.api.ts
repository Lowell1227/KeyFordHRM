import http from './http';
import type {
  MarkAllNotificationsReadResult,
  Notification,
  NotificationQuery,
  NotificationReadResult,
  Paginated,
  UnreadCount,
} from '@/types/api.types';

function apiGet<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  return http.get(url, { params }) as unknown as Promise<T>;
}

function apiPost<T>(url: string, data?: unknown): Promise<T> {
  return http.post(url, data) as unknown as Promise<T>;
}

function apiPatch<T>(url: string, data?: unknown): Promise<T> {
  return http.patch(url, data) as unknown as Promise<T>;
}

export const notificationsApi = {
  /** GET /notifications — 通知列表 */
  findAll(query?: NotificationQuery): Promise<Paginated<Notification>> {
    return apiGet('/notifications', query as Record<string, unknown>);
  },

  /** GET /notifications/unread-count — 未读数 */
  getUnreadCount(): Promise<UnreadCount> {
    return apiGet('/notifications/unread-count');
  },

  /** PATCH /notifications/:id/read — 标记已读 */
  markAsRead(id: string): Promise<NotificationReadResult> {
    return apiPatch(`/notifications/${id}/read`);
  },

  /** POST /notifications/read-all — 全部已读 */
  markAllAsRead(): Promise<MarkAllNotificationsReadResult> {
    return apiPost('/notifications/read-all');
  },
};
