import http from './http';
import type { CurrentUser, LoginResult } from '@/types/api.types';

export const authApi = {
  dingtalkLogin(authCode: string): Promise<LoginResult> {
    return http.post('/auth/dingtalk', { authCode }) as unknown as Promise<LoginResult>;
  },
  localLogin(employeeNo: string, password: string): Promise<LoginResult> {
    return http.post('/auth/login', { employeeNo, password }) as unknown as Promise<LoginResult>;
  },
  getMe(): Promise<CurrentUser> {
    return http.get('/auth/me') as unknown as Promise<CurrentUser>;
  },
};
