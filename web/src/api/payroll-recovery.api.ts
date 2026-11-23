import http from './http';
import type { PayrollAttendance } from '@/types/payroll.types';
import type { PayrollCorrectOpeningInput, PayrollCorrectOpeningResult, PayrollOpeningHistory, PayrollRecoverScopeInput, PayrollScopeDiff } from '@/types/payroll-recovery.types';

const options = { skipErrorMessage: true };
export const payrollRecoveryApi = {
  scopeDiff: (id: string) => http.get<never, PayrollScopeDiff>(`/payroll/attendance/${encodeURIComponent(id)}/scope-diff`, options),
  recoverScope: (id: string, input: PayrollRecoverScopeInput) => http.post<never, PayrollAttendance>(`/payroll/attendance/${encodeURIComponent(id)}/recover-scope`, input, options),
  openingHistory: (id: string) => http.get<never, PayrollOpeningHistory>(`/payroll/openings/${encodeURIComponent(id)}/history`, options),
  correctOpening: (id: string, input: PayrollCorrectOpeningInput) => http.post<never, PayrollCorrectOpeningResult>(`/payroll/openings/${encodeURIComponent(id)}/correct`, input, options),
};
