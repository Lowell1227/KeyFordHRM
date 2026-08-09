import { defineStore } from 'pinia';
import { authApi } from '@/api/auth.api';
import { useNotificationStore } from '@/stores/notification.store';
import type { CurrentUser } from '@/types/api.types';

const TOKEN_KEY = 'token';
const EXPIRES_AT_KEY = 'expiresAt';

function readExpiresAt(): number | null {
  const raw = localStorage.getItem(EXPIRES_AT_KEY);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem(TOKEN_KEY) as string | null,
    user: null as CurrentUser | null,
    expiresAt: readExpiresAt(),
  }),
  getters: {
    isLoggedIn: (s) => !!s.token,
    tokenExpired: (s) => {
      if (!s.token || !s.expiresAt) return false;
      return Date.now() >= s.expiresAt;
    },
    isHR: (s) => ['hr', 'system_admin'].includes(s.user?.sysRole ?? ''),
    isVP: (s) => s.user?.sysRole === 'vp',
    isManager: (s) =>
      ['manager', 'dept_head', 'vp', 'hr', 'system_admin'].includes(s.user?.sysRole ?? ''),
    canAccessAdmin: (s) => ['hr', 'system_admin'].includes(s.user?.sysRole ?? ''),
  },
  actions: {
    async loginWithDingTalk(authCode: string) {
      const res = await authApi.dingtalkLogin(authCode);
      this.setSession(res.token, res.user, res.expiresIn);
    },
    async loginWithPassword(employeeNo: string, password: string) {
      const res = await authApi.localLogin(employeeNo, password);
      this.setSession(res.token, res.user, res.expiresIn);
    },
    setSession(token: string, user: CurrentUser, expiresIn: number) {
      this.token = token;
      this.user = user;
      this.expiresAt = Date.now() + expiresIn * 1000;
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(EXPIRES_AT_KEY, String(this.expiresAt));
      useNotificationStore().setSession(user.id);
    },
    async fetchMe() {
      const user = await authApi.getMe();
      this.user = user;
      useNotificationStore().setSession(user.id);
    },
    /**
     * 启动期 hydration：token 已存在但 user 为空时，拉取当前用户信息。
     * 失败（401/网络）视为登录态失效，执行 logout 并返回 false，不吞异常。
     */
    async ensureLoaded(): Promise<boolean> {
      if (!this.isLoggedIn) return false;
      if (this.user) return true;
      try {
        await this.fetchMe();
        return !!this.user;
      } catch {
        this.logout();
        return false;
      }
    },
    logout() {
      useNotificationStore().setSession(null);
      this.token = null;
      this.user = null;
      this.expiresAt = null;
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(EXPIRES_AT_KEY);
    },
  },
});
