import http from './http';
import type { PayrollGrantDraft, PayrollGrantEvent, PayrollGrantOptions, PayrollGrantRow } from '@/types/payroll-grants.types';

const root = '/payroll/grants';
const local = { skipErrorMessage: true };
export const payrollGrantsApi = {
  list: () => http.get<never, PayrollGrantRow[]>(root, local),
  options: () => http.get<never, PayrollGrantOptions>(`${root}/options`, local),
  save: (body: PayrollGrantDraft) => http.post<never, PayrollGrantRow>(root, body, local),
  revoke: (id: string, expectedUpdatedAt: string, reason: string) => http.post<never, PayrollGrantRow>(`${root}/${encodeURIComponent(id)}/revoke`, { expectedUpdatedAt, reason }, local),
  events: (id: string) => http.get<never, PayrollGrantEvent[]>(`${root}/${encodeURIComponent(id)}/events`, local),
};
