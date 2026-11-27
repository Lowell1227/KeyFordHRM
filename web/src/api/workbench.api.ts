import http from './http';

export interface OperationItem {
  id: string; kind: string; title: string; status: string; nextAction: string; path: string; dueAt: string | null;
  subjectId?: string; month?: string; requestId?: string; batchId?: string; taskId?: string; cycleId?: string;
}
export interface OperationPage {
  total: number | null; page: number; pageSize: number; hasMore: boolean; items: OperationItem[];
}
export interface OperationGroup {
  visible?: boolean;
  status: 'ready' | 'error'; actionable: OperationPage; attention: OperationPage;
  error?: { code: string; message: string };
  counts?: Record<string, { actionable: number; attention: number }> | null;
}
export interface OperationsSummary {
  generatedAt: string;
  groups: { performance?: OperationGroup; personnel: OperationGroup; payroll: OperationGroup };
}
export const workbenchApi = {
  operations(page = 1): Promise<OperationsSummary> {
    return http.get('/workbench/operations', { params: { page, pageSize: 5 }, skipErrorMessage: true }) as unknown as Promise<OperationsSummary>;
  },
};
