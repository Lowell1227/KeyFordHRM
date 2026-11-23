import http from './http';
import type { PayrollAttendance } from '@/types/payroll.types';
import type { PayrollAbsenceDetail } from '@/types/payroll-absence.types';
const options = { skipErrorMessage: true };
const path = (id: string) => `/payroll/attendance/${encodeURIComponent(id)}/absence`;
export const payrollAbsenceApi = {
  detail: (id: string) => http.get<never, PayrollAbsenceDetail>(path(id), options),
  propose: (id: string, input: { expectedVersion: number; employeeId: string; workDate: string; reference: string; requestId: string }) =>
    http.post<never, PayrollAttendance>(path(id), input, options),
  decide: (id: string, proposalId: string, input: { expectedVersion: number; decision: 'approve' | 'return' | 'revoke'; note: string }) =>
    http.post<never, PayrollAttendance>(`${path(id)}/${encodeURIComponent(proposalId)}/decide`, input, options),
};
