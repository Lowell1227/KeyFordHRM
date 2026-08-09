import { defineStore } from 'pinia';
import { notificationsApi } from '@/api/notifications.api';
import type { Notification, NotificationReadResult } from '@/types/api.types';

const pendingReadRequests = new Map<string, Promise<NotificationReadResult>>();

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const useNotificationStore = defineStore('notification', {
  state: () => ({
    sessionUserId: null as string | null,
    generation: 0,
    unreadRequestSerial: 0,
    recentRequestSerial: 0,
    mutationSerial: 0,
    unreadCount: 0,
    unreadError: null as string | null,
    notifications: [] as Notification[],
    loading: false,
  }),

  getters: {
    hasUnread: (state) => state.unreadCount > 0,
    recent: (state) => state.notifications.slice(0, 10),
  },

  actions: {
    setSession(userId: string | null) {
      if (this.sessionUserId === userId) return;

      this.generation += 1;
      this.sessionUserId = userId;
      this.unreadRequestSerial += 1;
      this.recentRequestSerial += 1;
      this.mutationSerial += 1;
      this.unreadCount = 0;
      this.unreadError = null;
      this.notifications = [];
      this.loading = false;
    },

    invalidateQueries() {
      this.unreadRequestSerial += 1;
      this.recentRequestSerial += 1;
      this.loading = false;
    },

    async fetchUnreadCount(): Promise<number> {
      const userId = this.sessionUserId;
      if (!userId) return this.unreadCount;

      const generation = this.generation;
      const requestSerial = ++this.unreadRequestSerial;
      try {
        const res = await notificationsApi.getUnreadCount();
        if (
          this.generation === generation &&
          this.sessionUserId === userId &&
          this.unreadRequestSerial === requestSerial
        ) {
          this.unreadCount = res.count;
          this.unreadError = null;
        }
        return res.count;
      } catch (error) {
        if (
          this.generation === generation &&
          this.sessionUserId === userId &&
          this.unreadRequestSerial === requestSerial
        ) {
          this.unreadError = errorMessage(error);
        }
        throw error;
      }
    },

    async fetchRecent(): Promise<Notification[]> {
      const userId = this.sessionUserId;
      if (!userId) return this.notifications;

      const generation = this.generation;
      const requestSerial = ++this.recentRequestSerial;
      this.loading = true;
      try {
        const res = await notificationsApi.findAll({ page: 1, pageSize: 10 });
        if (
          this.generation === generation &&
          this.sessionUserId === userId &&
          this.recentRequestSerial === requestSerial
        ) {
          this.notifications = res.items;
        }
        return res.items;
      } finally {
        if (
          this.generation === generation &&
          this.sessionUserId === userId &&
          this.recentRequestSerial === requestSerial
        ) {
          this.loading = false;
        }
      }
    },

    async markAsRead(id: string): Promise<NotificationReadResult | undefined> {
      const item = this.notifications.find((notification) => notification.id === id);
      if (item?.isRead) return { ...item, unreadCount: this.unreadCount };

      const userId = this.sessionUserId;
      if (!userId) return undefined;

      const generation = this.generation;
      const pendingKey = `${generation}:${id}`;
      const inFlight = pendingReadRequests.get(pendingKey);
      if (inFlight) return inFlight;

      const mutationSerial = ++this.mutationSerial;
      this.invalidateQueries();
      const request = notificationsApi.markAsRead(id);
      pendingReadRequests.set(pendingKey, request);
      try {
        const updated = await request;
        if (
          this.generation === generation &&
          this.sessionUserId === userId &&
          this.mutationSerial === mutationSerial
        ) {
          this.invalidateQueries();
          const index = this.notifications.findIndex((notification) => notification.id === id);
          if (index >= 0) {
            const { unreadCount: _unreadCount, ...notification } = updated;
            this.notifications.splice(index, 1, notification);
          }
          this.unreadCount = updated.unreadCount;
          this.unreadError = null;
        }
        return updated;
      } finally {
        if (pendingReadRequests.get(pendingKey) === request) {
          pendingReadRequests.delete(pendingKey);
        }
      }
    },

    async markAllAsRead() {
      const userId = this.sessionUserId;
      if (!userId) return undefined;

      const generation = this.generation;
      const mutationSerial = ++this.mutationSerial;
      this.invalidateQueries();
      const result = await notificationsApi.markAllAsRead();
      if (
        this.generation === generation &&
        this.sessionUserId === userId &&
        this.mutationSerial === mutationSerial
      ) {
        this.invalidateQueries();
        this.unreadCount = result.unreadCount;
        this.unreadError = null;
        this.notifications.forEach((notification) => {
          if (!notification.isRead) {
            notification.isRead = true;
            notification.readAt = result.readAt;
          }
        });
      }
      return result;
    },

    increment(count = 1) {
      this.unreadRequestSerial += 1;
      this.unreadCount += count;
    },
  },
});
