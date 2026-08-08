import axios, { type AxiosInstance, type AxiosResponse } from 'axios';
import { ElMessage } from 'element-plus';
import type { ApiResponse } from '@/types/api.types';

declare module 'axios' {
  export interface AxiosRequestConfig {
    skipErrorMessage?: boolean;
  }
}

/**
 * 统一 HTTP 客户端。
 *
 * 错误提示约定：业务码 code≠0、网络错误、403 等统一由本拦截层 toast，
 * 业务页面 catch 仅用于本地状态（如关闭 loading），不要重复 ElMessage，
 * 避免双重报错弹窗。
 */

const http: AxiosInstance = axios.create({
  baseURL: (import.meta.env?.VITE_API_BASE_URL ?? '') + '/api/v1',
  timeout: 15000,
});

// 请求拦截：注入 token
http.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

function currentFullPath(): string {
  return location.pathname + location.search + location.hash;
}

function redirectToLogin() {
  // 避免循环依赖（router → auth.store → api → http），直接 location 跳转。
  if (location.pathname === '/login') return;
  const redirect = encodeURIComponent(currentFullPath());
  location.assign(`/login?redirect=${redirect}`);
}

// 响应拦截：拆包 + 统一错误处理
http.interceptors.response.use(
  ((response: AxiosResponse) => {
    // 文件流（导出）直接返回原始响应
    if (response.config.responseType === 'blob') return response;

    const body = response.data as ApiResponse<unknown>;
    if (body.code !== 0) {
      ElMessage.error(body.message || '操作失败');
      return Promise.reject(new Error(body.message));
    }
    return body.data;
  }) as any,
  (error) => {
    const status = error.response?.status;
    const skipErrorMessage = Boolean(error.config?.skipErrorMessage);
    // 读请求（GET）：页面会以空态自行兜底，失败时不弹全局 toast，
    // 避免页面初始化并发拉取「可选/越权」参考数据时刷屏。
    // 写请求（POST/PUT/PATCH/DELETE）：失败必须让用户看到。
    const isRead = (error.config?.method ?? 'get').toLowerCase() === 'get';
    if (status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('expiresAt');
      redirectToLogin();
    } else if (status === 403) {
      if (!isRead && !skipErrorMessage) ElMessage.error('无权限执行此操作');
    } else if (!isRead && !skipErrorMessage) {
      ElMessage.error(error.response?.data?.message || '网络错误，请稍后重试');
    }
    return Promise.reject(error);
  },
);

export default http;
