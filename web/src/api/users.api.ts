import http from './http';
import type {
  Paginated,
  DirectReport,
  User,
  UserQuery,
  UpdateUserSettingsBody,
  UpdateRoleBody,
  SetPasswordBody,
} from '@/types/api.types';

export interface RosterExportModule {
  key: string;
  label: string;
  fields: { key: string; label: string; defaultSelected: boolean }[];
}

function apiGet<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  return http.get(url, { params }) as unknown as Promise<T>;
}

function apiPatch<T>(url: string, data?: unknown): Promise<T> {
  return http.patch(url, data) as unknown as Promise<T>;
}

export const usersApi = {
  /** 当前操作人可导出的模块和字段。 */
  rosterExportFields(): Promise<RosterExportModule[]> {
    return apiGet('/users/export-fields');
  },
  /** GET /users — 查询用户列表（HR / system_admin） */
  findAll(query: UserQuery): Promise<Paginated<User>> {
    return apiGet('/users', query as Record<string, unknown>);
  },

  /** GET /users/:id — 查询用户详情 */
  findOne(id: string): Promise<User> {
    return apiGet(`/users/${id}`);
  },

  /** PATCH /users/:id/settings — 更新系统权限 */
  updateSettings(id: string, body: UpdateUserSettingsBody): Promise<User> {
    return apiPatch(`/users/${id}/settings`, body);
  },

  /** PATCH /users/:id/role — 更新系统权限（旧路径保留兼容） */
  updateRole(id: string, body: UpdateRoleBody): Promise<User> {
    return apiPatch(`/users/${id}/role`, body);
  },

  /** PATCH /users/:id/password — 设置密码 */
  setPassword(id: string, body: SetPasswordBody): Promise<User> {
    return apiPatch(`/users/${id}/password`, body);
  },

  /** GET /users/export — 按当前筛选导出花名册 Excel（blob） */
  exportRoster(query: UserQuery & { columns?: string }): Promise<Blob> {
    return http
      .get('/users/export', { params: query as Record<string, unknown>, responseType: 'blob' })
      .then((res) => (res as { data: Blob }).data)
      .catch(async (error) => {
        // Axios keeps JSON error bodies as Blob when requesting a spreadsheet.
        let message = error?.response?.status === 403
          ? '没有导出员工档案的权限，请联系管理员。'
          : '导出失败，请检查网络后重试。';
        try {
          const body = error?.response?.data instanceof Blob
            ? JSON.parse(await error.response.data.text())
            : error?.response?.data;
          if (typeof body?.message === 'string') message = body.message;
          else if (Array.isArray(body?.message)) message = body.message.join('；');
        } catch { /* Keep the readable fallback for non-JSON gateway responses. */ }
        throw new Error(message);
      });
  },

  /** GET /users/:id/subordinates — 获取下属列表 */
  getSubordinates(id: string): Promise<DirectReport[]> {
    return apiGet(`/users/${id}/subordinates`);
  },
};
