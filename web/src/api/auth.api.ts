import http from './http';
import type { CurrentUser, LoginResult } from '@/types/api.types';

export type DingTalkLoginMode = 'oauth' | 'internal';

export interface TestAccount {
  employeeNo: string;
  name: string;
  sysRole: string;
  roleLabel: string;
}

export interface TestAccountsResult {
  enabled: boolean;
  accounts: TestAccount[];
}

export const authApi = {
  dingtalkLogin(authCode: string, loginMode: DingTalkLoginMode): Promise<LoginResult> {
    return http.post('/auth/dingtalk', { authCode, loginMode }, { skipErrorMessage: true }) as unknown as Promise<LoginResult>;
  },
  localLogin(employeeNo: string, password: string): Promise<LoginResult> {
    return http.post('/auth/login', { employeeNo, password }) as unknown as Promise<LoginResult>;
  },
  getTestAccounts(): Promise<TestAccountsResult> {
    return http.get('/auth/test-accounts') as unknown as Promise<TestAccountsResult>;
  },
  testLogin(employeeNo: string): Promise<LoginResult> {
    return http.post('/auth/test-login', { employeeNo }) as unknown as Promise<LoginResult>;
  },
  getMe(): Promise<CurrentUser> {
    return http.get('/auth/me') as unknown as Promise<CurrentUser>;
  },
};
