import http from './http';
import type {
  CalibrationCandidate,
  CalibrationCandidateDetail,
  CalibrationSummary,
  ConfirmCalibrationBody,
  RejectCalibrationBody,
  GradeDistributionEntry,
} from '@/types/api.types';
import type { PerfGrade } from '@/types/enums';

function apiGet<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  return http.get(url, { params }) as unknown as Promise<T>;
}

function apiPost<T>(url: string, data?: unknown): Promise<T> {
  return http.post(url, data) as unknown as Promise<T>;
}

export interface CalibrationWorkbench extends CalibrationSummary {
  items: CalibrationCandidate[];
}

export interface CalibrationActionResult {
  updated: number;
  gradeDistribution: Record<PerfGrade, GradeDistributionEntry>;
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

  /** GET /cycles/:id/calibration/tasks/:taskId — 个人详情（校准依据） */
  getCandidateDetail(cycleId: string, taskId: string): Promise<CalibrationCandidateDetail> {
    return apiGet(`/cycles/${cycleId}/calibration/tasks/${taskId}`);
  },

  /** POST /cycles/:id/calibration/confirm — 确认（逐人即时流转到审批） */
  confirm(cycleId: string, body: ConfirmCalibrationBody): Promise<CalibrationActionResult> {
    return apiPost(`/cycles/${cycleId}/calibration/confirm`, body);
  },

  /** POST /cycles/:id/calibration/reject — 驳回（退回直属上级重新评定） */
  reject(cycleId: string, body: RejectCalibrationBody): Promise<CalibrationActionResult> {
    return apiPost(`/cycles/${cycleId}/calibration/reject`, body);
  },
};
