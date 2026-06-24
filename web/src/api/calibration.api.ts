import http from './http';
import type {
  CalibrationCandidate,
  CalibrationSummary,
  SubmitCalibrationBody,
  GradeDistributionEntry,
} from '@/types/api.types';
import type { PerfGrade } from '@/types/enums';

function apiGet<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  return http.get(url, { params }) as unknown as Promise<T>;
}

function apiPost<T>(url: string, data?: unknown): Promise<T> {
  return http.post(url, data) as unknown as Promise<T>;
}

export interface CalibrationWorkbench {
  gradeDistribution: Record<PerfGrade, GradeDistributionEntry>;
  totalActive: number;
  pendingCalibration: number;
  items: CalibrationCandidate[];
}

export interface CalibrationSubmitResult {
  submit: boolean;
  updated: number;
  transitioned: number;
  gradeDistribution: Record<PerfGrade, GradeDistributionEntry>;
  warnings: string[];
}

export const calibrationApi = {
  /** GET /cycles/:id/calibration — 校准工作台 */
  getWorkbench(cycleId: string): Promise<CalibrationWorkbench> {
    return apiGet(`/cycles/${cycleId}/calibration`);
  },

  /** GET /cycles/:id/grade-distribution — 等级分布 */
  getGradeDistribution(cycleId: string): Promise<Record<PerfGrade, GradeDistributionEntry>> {
    return apiGet(`/cycles/${cycleId}/grade-distribution`);
  },

  /** POST /cycles/:id/calibration — 提交校准结果 */
  submit(cycleId: string, body: SubmitCalibrationBody): Promise<CalibrationSubmitResult> {
    return apiPost(`/cycles/${cycleId}/calibration`, body);
  },
};
