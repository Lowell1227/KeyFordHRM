import http from './http';
import type { Department, DepartmentQuery, UpdateApproverBody, UpdateLeaderBody } from '@/types/api.types';

function apiGet<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  return http.get(url, { params }) as unknown as Promise<T>;
}

function apiPatch<T>(url: string, data?: unknown): Promise<T> {
  return http.patch(url, data) as unknown as Promise<T>;
}

export const departmentsApi = {
  /** GET /departments — 查询部门列表/树 */
  findAll(query?: DepartmentQuery): Promise<Department[]> {
    return apiGet('/departments', query as Record<string, unknown>);
  },

  /** GET /departments/tree — 部门树（当前后端未实现，预留） */
  getTree(query?: Omit<DepartmentQuery, 'page' | 'pageSize'>): Promise<Department[]> {
    return apiGet('/departments/tree', query as Record<string, unknown>);
  },

  /** PATCH /departments/:id/leader — 更新部门负责人 */
  updateLeader(id: string, body: UpdateLeaderBody): Promise<Department> {
    return apiPatch(`/departments/${id}/leader`, body);
  },

  /** PATCH /departments/:id/approver — 更新部门审批人 */
  updateApprover(id: string, body: UpdateApproverBody): Promise<Department> {
    return apiPatch(`/departments/${id}/approver`, body);
  },
};
