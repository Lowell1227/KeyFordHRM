import http from './http';
import type { PayrollParameterRelease, PayrollDeductionProfile, PayrollDeductionProfileInput, PayrollNetPaymentInput, PayrollCancelNetRemainderInput, PayrollAttendanceSyncJob } from '@/types/payroll.types';
import type { AxiosResponse } from 'axios';
import type { PayrollAccess, PayrollEmployee, PayrollOperator, PayrollCycle, PayrollAttendance, PayrollSourceInput, PayrollStandard, PayrollStandardInput, PayrollRule, PayrollRuleInput, PayrollBatch, PayrollBatchInput, PayrollAdjustment, PayrollAdjustmentInput, PayrollOpening, PayrollOpeningInput, PayrollDeductionsPreviewInput, PayrollDeductionsPreviewResult } from '@/types/payroll.types';

const root = '/payroll';
const localErrors = { skipErrorMessage: true };
const get = <T>(path: string, params?: object) => http.get<never, T>(`${root}${path}`, { ...localErrors, params });
const post = <T>(path: string, body: unknown) => http.post<never, T>(`${root}${path}`, body, localErrors);
const batchWrite = (id: string, action: string, expectedVersion: number, body: object = {}) => post<PayrollBatch>(`/batches/${encodeURIComponent(id)}/${action}`, { ...body, expectedVersion });

export const payrollApi = {
  access: () => get<PayrollAccess>('/access'),
  readiness: (subjectId: string) => get<{ ready: boolean; firstMonth?: string; reason?: string }>('/readiness', { subjectId }),
  parameterReleases: (subjectId: string) => get<PayrollParameterRelease[]>('/parameter-releases', { subjectId }),
  submitParameter: (kind: 'standard' | 'rule' | 'deduction', id: string, expectedVersion: number) => post<PayrollParameterRelease>(`/parameters/${kind}/${encodeURIComponent(id)}/submit`, { expectedVersion }),
  deductionProfiles: (subjectId: string) => get<PayrollDeductionProfile[]>('/deduction-profiles', { subjectId }),
  createDeductionProfile: (input: PayrollDeductionProfileInput) => post<PayrollDeductionProfile>('/deduction-profiles', input),
  decideParameter: (id: string, expectedVersion: number, decision: 'approve' | 'return', note: string) => post<PayrollParameterRelease>(`/parameter-releases/${encodeURIComponent(id)}/decide`, { expectedVersion, decision, note }),
  withdrawParameter: (id: string, expectedVersion: number, note: string) => post<PayrollParameterRelease>(`/parameter-releases/${encodeURIComponent(id)}/withdraw`, { expectedVersion, note }),
  employees: (subjectId: string, month: string) => get<PayrollEmployee[]>('/employees', { subjectId, month }),
  employeeScopeCandidates: (subjectId: string, month: string) => get<PayrollEmployee[]>('/employee-scope-candidates', { subjectId, month }),
  operators: (subjectId: string) => get<PayrollOperator[]>('/operators', { subjectId }),
  cycles: (subjectId: string) => get<PayrollCycle[]>('/performance-cycles', { subjectId }),
  attendance: (subjectId: string, month: string) => get<PayrollAttendance[]>('/attendance', { subjectId, month }),
  fixture: (subjectId: string, month: string, corrected: boolean) => get<PayrollSourceInput>('/attendance/fixture-response', { subjectId, month, corrected }),
  syncAttendance: (subjectId: string, month: string, source: PayrollSourceInput) => post<PayrollAttendance>('/attendance/sync', { subjectId, month, ...source }),
  attendanceJobs: (subjectId: string, month: string) => get<PayrollAttendanceSyncJob[]>('/attendance/dingtalk/jobs', { subjectId, month }),
  startAttendanceJob: (subjectId: string, month: string, requestId: string) => post<PayrollAttendanceSyncJob>('/attendance/dingtalk/jobs', { subjectId, month, requestId }),
  cancelAttendanceJob: (id: string) => post<PayrollAttendanceSyncJob>(`/attendance/dingtalk/jobs/${encodeURIComponent(id)}/cancel`, {}),
  retryAttendanceJob: (id: string, requestId: string) => post<PayrollAttendanceSyncJob>(`/attendance/dingtalk/jobs/${encodeURIComponent(id)}/retry`, { requestId }),
  reviewAttendance: (id: string, body: { note: string; employeeId?: string; workDate?: string }) => post<PayrollAttendance>(`/attendance/${encodeURIComponent(id)}/review`, body),
  sealAttendance: (id: string, expectedVersion: number) => post<PayrollAttendance>(`/attendance/${encodeURIComponent(id)}/seal`, { expectedVersion }),
  standards: (subjectId: string) => get<PayrollStandard[]>('/standards', { subjectId }),
  createStandard: (body: PayrollStandardInput) => post<PayrollStandard>('/standards', body),
  activateStandard: (id: string) => post<PayrollStandard>(`/standards/${encodeURIComponent(id)}/activate`, {}),
  disableStandard: (id: string) => post<PayrollStandard>(`/standards/${encodeURIComponent(id)}/disable`, {}),
  rules: (subjectId: string) => get<PayrollRule[]>('/rules', { subjectId }),
  createRule: (body: PayrollRuleInput) => post<PayrollRule>('/rules', body),
  activateRule: (id: string) => post<PayrollRule>(`/rules/${encodeURIComponent(id)}/activate`, {}),
  disableRule: (id: string) => post<PayrollRule>(`/rules/${encodeURIComponent(id)}/disable`, {}),
  batches: (subjectId: string, month?: string) => get<PayrollBatch[]>('/batches', { subjectId, ...(month ? { month } : {}) }),
  batch: (id: string) => get<PayrollBatch>(`/batches/${encodeURIComponent(id)}`),
  createBatch: (body: PayrollBatchInput) => post<PayrollBatch>('/batches', body),
  calculate: (id: string, version: number, payDate?: string) => batchWrite(id, 'calculate', version, payDate ? { payDate } : {}),
  netPayment: (id: string, body: PayrollNetPaymentInput) => post<PayrollBatch>(`/batches/${encodeURIComponent(id)}/net-payment`, body),
  cancelNetRemainder: (id: string, body: PayrollCancelNetRemainderInput) => post<PayrollBatch>(`/batches/${encodeURIComponent(id)}/cancel-net-remainder`, body),
  deductionsPreview: (id: string, body: PayrollDeductionsPreviewInput) => post<PayrollDeductionsPreviewResult>(`/batches/${encodeURIComponent(id)}/deductions-preview`, body),
  submit: (id: string, version: number) => batchWrite(id, 'submit', version),
  decide: (id: string, version: number, decision: 'approve' | 'return', note: string) => batchWrite(id, 'decide', version, { decision, note }),
  withdraw: (id: string, version: number, note: string) => batchWrite(id, 'withdraw', version, { note }),
  void: (id: string, version: number, note: string, confirmedUnpaid: boolean) => batchWrite(id, 'void', version, { note, confirmedUnpaid }),
  settle: (id: string, version: number, body: { lineId: string; amount: string; reference: string; requestId: string }) => batchWrite(id, 'settlements', version, body),
  cancelRemainder: (id: string, version: number, lineId: string, reference: string) => batchWrite(id, 'cancel-remainder', version, { lineId, reference }),
  adjustments: (subjectId: string, month: string) => get<PayrollAdjustment[]>('/adjustments', { subjectId, month }),
  createAdjustment: (body: PayrollAdjustmentInput) => post<PayrollAdjustment>('/adjustments', body),
  openings: (subjectId: string, month: string) => get<PayrollOpening[]>('/opening-balances', { subjectId, month }),
  createOpening: (body: PayrollOpeningInput) => post<PayrollOpening>('/opening-balances', body),
  export: (id: string, expectedVersion: number, filePassword: string) => http.post<never, AxiosResponse<Blob>>(`${root}/batches/${encodeURIComponent(id)}/export`, { expectedVersion, filePassword }, { ...localErrors, responseType: 'blob', timeout: 60000 }),
};

export function payrollConflictBatchId(error: unknown): string {
  const response = (error as { response?: { status?: number; data?: { data?: { batchId?: unknown } } } })?.response;
  const id = response?.data?.data?.batchId;
  return response?.status === 409 && typeof id === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id) ? id : '';
}

export async function payrollError(error: unknown): Promise<string> {
  const response = (error as { response?: { data?: unknown } })?.response;
  let data = response?.data;
  if (data instanceof Blob) {
    try { data = JSON.parse(await data.text()); } catch { data = null; }
  }
  const message = (data as { message?: unknown })?.message;
  if (Array.isArray(message)) return message.join('；');
  if (typeof message === 'string') return message;
  return error instanceof Error ? error.message : '请求未完成，请刷新核对后重试';
}
