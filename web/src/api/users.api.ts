import http from './http';
import type {
  Paginated,
  User,
  UserQuery,
  UpdateManagerBody,
  UpdateRoleBody,
  SetPasswordBody,
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

export const usersApi = {
  /** GET /users — 查询用户列表（HR / system_admin） */
  findAll(query: UserQuery): Promise<Paginated<User>> {
    return apiGet('/users', query as Record<string, unknown>);
  },

  /** GET /users/:id — 查询用户详情 */
  findOne(id: string): Promise<User> {
    return apiGet(`/users/${id}`);
  },

  /** PATCH /users/:id/manager — 更新直属主管 */
  updateManager(id: string, body: UpdateManagerBody): Promise<User> {
    return apiPatch(`/users/${id}/manager`, body);
  },

  /** PATCH /users/:id/role — 更新系统角色 */
  updateRole(id: string, body: UpdateRoleBody): Promise<User> {
    return apiPatch(`/users/${id}/role`, body);
  },

  /** PATCH /users/:id/password — 设置密码 */
  setPassword(id: string, body: SetPasswordBody): Promise<User> {
    return apiPatch(`/users/${id}/password`, body);
  },

  /** GET /users/:id/subordinates — 获取下属列表 */
  getSubordinates(id: string): Promise<User[]> {
    return apiGet(`/users/${id}/subordinates`);
  },
};
