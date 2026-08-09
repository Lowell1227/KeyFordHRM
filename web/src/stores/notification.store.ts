import { defineStore } from 'pinia';
import { notificationsApi } from '@/api/notifications.api';
import type { Notification } from '@/types/api.types';

const pendingReadRequests = new Map<string, Promise<Notification>>();

export const useNotificationStore = defineStore('notification', {
  state: () => ({
    unreadCount: 0,
    notifications: [] as Notification[],
    loading: false,
  }),

  getters: {
    hasUnread: (state) => state.unreadCount > 0,
    recent: (state) => state.notifications.slice(0, 10),
  },

  actions: {
    async fetchUnreadCount() {
      try {
        const res = await notificationsApi.getUnreadCount();
        this.unreadCount = res.count;
      } catch {
        this.unreadCount = 0;
      }
    },

    async fetchRecent() {
      this.loading = true;
      try {
        const res = await notificationsApi.findAll({ page: 1, pageSize: 10 });
        this.notifications = res.items;
      } finally {
        this.loading = false;
      }
    },

    async markAsRead(id: string): Promise<Notification | undefined> {
      const item = this.notifications.find((notification) => notification.id === id);
      if (item?.isRead) return item;

      const inFlight = pendingReadRequests.get(id);
      if (inFlight) return inFlight;

      const request = notificationsApi.markAsRead(id);
      pendingReadRequests.set(id, request);
      try {
        const updated = await request;
        const current = this.notifications.find((notification) => notification.id === id);
        const transitionedToRead = Boolean(current && !current.isRead && updated.isRead);
        if (current) {
          current.isRead = updated.isRead;
          current.readAt = updated.readAt;
        }
        if (transitionedToRead) {
          this.unreadCount = Math.max(0, this.unreadCount - 1);
        }
        return updated;
      } finally {
        if (pendingReadRequests.get(id) === request) {
          pendingReadRequests.delete(id);
        }
      }
    },

    async markAllAsRead() {
      const result = await notificationsApi.markAllAsRead();
      const readAt = new Date().toISOString();
      this.unreadCount = 0;
      this.notifications.forEach((n) => {
        if (!n.isRead) {
          n.isRead = true;
          n.readAt = readAt;
        }
      });
      return result;
    },

    increment(count = 1) {
      this.unreadCount += count;
    },
  },
});
