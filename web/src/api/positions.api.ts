import http from './http';

export interface PositionRecord {
  id: string;
  code: string;
  name: string;
  jobFamily: string | null;
  isActive: boolean;
  activeEmployeeCount: number;
}

export interface PositionChangeRequest {
  id: string;
  positionId: string | null;
  positionName: string;
  action: 'create' | 'update' | 'deactivate';
  status: 'pending' | 'approved' | 'rejected';
  baseValue: Record<string, unknown>;
  proposedValue: Record<string, unknown>;
  warnings: string[];
  createdBy: { id: string; name: string };
  createdAt: string;
}

export const positionsApi = {
  findAll(params: { keyword?: string; includeInactive?: boolean } = {}): Promise<PositionRecord[]> {
    return http.get('/positions', { params }) as unknown as Promise<PositionRecord[]>;
  },
  create(body: { code: string; name: string; jobFamily?: string | null }): Promise<PositionChangeRequest> {
    return http.post('/positions', body) as unknown as Promise<PositionChangeRequest>;
  },
  update(id: string, body: { code?: string; name?: string; jobFamily?: string | null }): Promise<PositionChangeRequest> {
    return http.patch(`/positions/${id}`, body) as unknown as Promise<PositionChangeRequest>;
  },
  deactivate(id: string): Promise<PositionChangeRequest> {
    return http.delete(`/positions/${id}`) as unknown as Promise<PositionChangeRequest>;
  },
  listChangeRequests(params: { status?: string; page?: number; pageSize?: number } = {}): Promise<{ items: PositionChangeRequest[]; total: number }> {
    return http.get('/positions/change-requests', { params }) as unknown as Promise<{ items: PositionChangeRequest[]; total: number }>;
  },
  approve(requestId: string): Promise<PositionChangeRequest> {
    return http.post(`/positions/change-requests/${requestId}/approve`) as unknown as Promise<PositionChangeRequest>;
  },
  reject(requestId: string, reason: string): Promise<PositionChangeRequest> {
    return http.post(`/positions/change-requests/${requestId}/reject`, { reason }) as unknown as Promise<PositionChangeRequest>;
  },
};
