import http from './http';
import type { Department, DepartmentQuery, UpdateApproverBody, UpdateDepartmentStructureBody, UpdateLeaderBody } from '@/types/api.types';

export type DepartmentChangeAction = 'create' | 'update_structure' | 'update_leader' | 'merge' | 'delete';
export type DepartmentChangeStatus = 'pending' | 'approved' | 'rejected';

export interface DepartmentChangeRequest {
  id: string;
  departmentId: string | null;
  departmentName: string;
  action: DepartmentChangeAction;
  status: DepartmentChangeStatus;
  baseValue: Record<string, any>;
  proposedValue: Record<string, any>;
  createdBy: { id: string; name: string; sysRole: string };
  reviewedBy?: { id: string; name: string } | null;
  reviewedAt?: string | null;
  rejectedReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DepartmentChangeRequestPage {
  total: number;
  page: number;
  pageSize: number;
  items: DepartmentChangeRequest[];
}

function apiGet<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  return http.get(url, { params }) as unknown as Promise<T>;
}

function apiPatch<T>(url: string, data?: unknown): Promise<T> {
  return http.patch(url, data) as unknown as Promise<T>;
}

function apiPost<T>(url: string, data?: unknown): Promise<T> {
  return http.post(url, data) as unknown as Promise<T>;
}

function apiDelete<T>(url: string): Promise<T> {
  return http.delete(url) as unknown as Promise<T>;
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

  /** PATCH /departments/:id/structure — 更新名称或父级。 */
  updateStructure(id: string, body: UpdateDepartmentStructureBody): Promise<DepartmentChangeRequest> {
    return apiPatch(`/departments/${id}/structure`, body);
  },

  remove(id: string): Promise<DepartmentChangeRequest> {
    return apiDelete(`/departments/${id}`);
  },

  listChangeRequests(params: {
    status?: 'pending' | 'approved' | 'rejected' | 'all';
    page?: number;
    pageSize?: number;
  } = {}): Promise<DepartmentChangeRequestPage> {
    return apiGet('/departments/change-requests', params);
  },

  approveChange(requestId: string): Promise<DepartmentChangeRequest> {
    return apiPost(`/departments/change-requests/${requestId}/approve`);
  },

  rejectChange(requestId: string, reason: string): Promise<DepartmentChangeRequest> {
    return apiPost(`/departments/change-requests/${requestId}/reject`, { reason });
  },
};
