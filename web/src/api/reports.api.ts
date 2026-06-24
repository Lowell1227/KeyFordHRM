import http from './http';
import type {
  ReportSummary,
  ReportCycleProgress,
  GradeListResponse,
  EmployeeArchiveItem,
  ReportQueryDto,
  ConsecutiveDWarningItem,
} from '@/types/api.types';

function apiGet<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  return http.get(url, { params }) as unknown as Promise<T>;
}

export const reportsApi = {
  /** GET /reports/cycle/:id/summary — 周期汇总报表。 */
  getCycleSummary(cycleId: string, query?: ReportQueryDto): Promise<ReportSummary> {
    return apiGet(`/reports/cycle/${cycleId}/summary`, query as Record<string, unknown>);
  },

  /** GET /reports/cycle/:id/progress — 周期进度统计。 */
  getCycleProgress(cycleId: string): Promise<ReportCycleProgress> {
    return apiGet(`/reports/cycle/${cycleId}/progress`);
  },

  /** GET /reports/cycle/:id/grade-list — 当期 A/D 级名单。 */
  getCycleGradeList(cycleId: string): Promise<GradeListResponse> {
    return apiGet(`/reports/cycle/${cycleId}/grade-list`);
  },

  /** GET /reports/employee/:id/archive — 员工历史绩效趋势。 */
  getEmployeeArchive(employeeId: string): Promise<EmployeeArchiveItem[]> {
    return apiGet(`/reports/employee/${employeeId}/archive`);
  },

  /** GET /reports/cycle/:id/export — 当期全量 Excel 导出（blob）。 */
  exportCycle(cycleId: string): Promise<Blob> {
    return http
      .get(`/reports/cycle/${cycleId}/export`, { responseType: 'blob' })
      .then((res) => (res as { data: Blob }).data);
  },

  /** GET /reports/consecutive-d-warning — 连续 D 预警名单。 */
  getConsecutiveDWarningList(): Promise<ConsecutiveDWarningItem[]> {
    return apiGet('/reports/consecutive-d-warning');
  },
};
