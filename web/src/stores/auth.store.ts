import { defineStore } from 'pinia';
import { authApi } from '@/api/auth.api';
import type { DingTalkLoginMode } from '@/api/auth.api';
import { useNotificationStore } from '@/stores/notification.store';
import type { CurrentUser } from '@/types/api.types';
import { payrollApi } from '@/api/payroll.api';

const TOKEN_KEY = 'token';
const EXPIRES_AT_KEY = 'expiresAt';
const PASSWORD_CHANGE_REQUIRED_KEY = 'passwordChangeRequired';

export class PayrollAccessSupersededError extends Error {
  constructor() {
    super('薪酬授权读取已被新的请求或登录身份替代');
    this.name = 'PayrollAccessSupersededError';
  }
}

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
    passwordChangeRequired: localStorage.getItem(PASSWORD_CHANGE_REQUIRED_KEY) === 'true',
    payrollAccessSequence: 0,
  }),
  getters: {
    isLoggedIn: (s) => !!s.token,
    tokenExpired: (s) => {
      if (!s.token || !s.expiresAt) return false;
      return Date.now() >= s.expiresAt;
    },
    isHR: (s) => ['hr_user', 'hr', 'system_admin'].includes(s.user?.sysRole ?? ''),
    isVP: (s) => Boolean(s.user?.businessCapabilities?.canViewPerformanceApproval),
    canAccessPerformanceApproval: (s) => Boolean(s.user?.businessCapabilities?.canViewPerformanceApproval),
    isManager: (s) => Boolean(s.user?.businessCapabilities?.canManageTeam),
    canAccessAdmin: (s) => ['hr_user', 'hr', 'system_admin'].includes(s.user?.sysRole ?? ''),
  },
  actions: {
    async refreshPayrollAccess() {
      const request = ++this.payrollAccessSequence;
      const token = this.token, userId = this.user?.id;
      if (!token || !userId) throw new Error('请先登录');
      const current = () => request === this.payrollAccessSequence && this.token === token && this.user?.id === userId;
      try {
        const access = await payrollApi.access();
        if (!current()) throw new PayrollAccessSupersededError();
        this.user!.payrollAccess = access;
        return access;
      } catch (cause) {
        if (!current()) throw new PayrollAccessSupersededError();
        this.user!.payrollAccess = { enabled: false, subjects: [] };
        throw cause;
      }
    },
    async loginWithDingTalk(authCode: string, loginMode: DingTalkLoginMode) {
      const res = await authApi.dingtalkLogin(authCode, loginMode);
      this.setSession(res.token, res.user, res.expiresIn, res.passwordChangeRequired);
    },
    async loginWithPassword(employeeNo: string, password: string) {
      const res = await authApi.localLogin(employeeNo, password);
      this.setSession(res.token, res.user, res.expiresIn, res.passwordChangeRequired);
      return res.passwordChangeRequired;
    },
    async loginWithTestAccount(employeeNo: string) {
      const res = await authApi.testLogin(employeeNo);
      this.setSession(res.token, res.user, res.expiresIn, res.passwordChangeRequired);
    },
    setSession(token: string, user: CurrentUser, expiresIn: number, passwordChangeRequired = false) {
      this.payrollAccessSequence++;
      this.token = token;
      this.user = user;
      this.expiresAt = Date.now() + expiresIn * 1000;
      this.passwordChangeRequired = passwordChangeRequired;
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(EXPIRES_AT_KEY, String(this.expiresAt));
      localStorage.setItem(PASSWORD_CHANGE_REQUIRED_KEY, String(passwordChangeRequired));
      useNotificationStore().setSession(user.id);
    },
    async fetchMe() {
      const user = await authApi.getMe();
      this.user = user;
      useNotificationStore().setSession(user.id);
    },
    async changePassword(password: string, confirmPassword: string) {
      await authApi.changePassword(password, confirmPassword);
      this.passwordChangeRequired = false;
      localStorage.setItem(PASSWORD_CHANGE_REQUIRED_KEY, 'false');
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
      this.payrollAccessSequence++;
      useNotificationStore().setSession(null);
      this.token = null;
      this.user = null;
      this.expiresAt = null;
      this.passwordChangeRequired = false;
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(EXPIRES_AT_KEY);
      localStorage.removeItem(PASSWORD_CHANGE_REQUIRED_KEY);
    },
  },
});
