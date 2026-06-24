import { defineStore } from 'pinia';
import { notificationsApi } from '@/api/notifications.api';
import type { Notification, UnreadCount } from '@/types/api.types';

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
        const res = await notificationsApi.findAll({ unreadOnly: true, pageSize: 10 });
        this.notifications = res.items;
        this.unreadCount = res.items.filter((n) => n.status !== 'sent').length;
      } finally {
        this.loading = false;
      }
    },

    async markAsRead(id: string) {
      await notificationsApi.markAsRead(id);
      this.unreadCount = Math.max(0, this.unreadCount - 1);
      const item = this.notifications.find((n) => n.id === id);
      if (item) item.status = 'sent';
    },

    async markAllAsRead() {
      await notificationsApi.markAllAsRead();
      this.unreadCount = 0;
      this.notifications.forEach((n) => {
        n.status = 'sent';
      });
    },

    increment(count = 1) {
      this.unreadCount += count;
    },
  },
});
