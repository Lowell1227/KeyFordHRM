import type { PayrollOpening } from './payroll.types';

export interface PayrollScopeDiff {
  snapshotId: string; subjectId: string; month: string; snapshotVersion: number; snapshotHash: string; scopeHash: string;
  current: Array<{ employeeId: string; name: string; workDates: string[] }>;
  added: Array<{ employeeId: string; name: string; workDate: string }>;
  removed: Array<{ employeeId: string; name: string; workDate: string }>;
  retainedDays: number; blockedReason: string | null;
}
export interface PayrollRecoverScopeInput { snapshotVersion: number; snapshotHash: string; scopeHash: string; reason: string; requestId: string }
export interface PayrollOpeningValue {
  id: string; subjectId: string; employeeId: string; domain: string; attributionMonth: string; itemCode: string;
  amount: string | null; reference: string | null; confirmedAt: string | null; confirmedById: string | null;
}
export interface PayrollOpeningHistory {
  openingId: string; subjectId: string; employeeId: string; month: string; itemCode: string;
  current: PayrollOpeningValue; currentHash: string;
  versions: Array<{ id: string; actorId: string; createdAt: string; reason: string; before: PayrollOpeningValue; after: PayrollOpeningValue; beforeHash: string; afterHash: string }>;
}
export interface PayrollCorrectOpeningInput { expectedHash: string; amount: string; reference: string; reason: string; requestId: string }
export interface PayrollCorrectOpeningResult { opening: PayrollOpening; currentHash: string }
