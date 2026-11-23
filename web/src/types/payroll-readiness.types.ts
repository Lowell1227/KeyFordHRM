import type { PayrollNetSnapshot } from './payroll.types';

export interface PayrollReadinessRequest {
  id: string; subjectId: string; batchId: string; versionId: string;
  calculationVersion: number; version: number; month: string; firstMonth: string;
  sourceHash: string; netHash: string; reference: string;
  status: 'pending' | 'returned' | 'withdrawn' | 'approved' | 'revoked';
  approvalStep: number; approvalPath: string[]; reviewerCount: number;
  submittedById: string; submittedAt: string; approvedAt: string | null;
  closedAt: string | null; closedById: string | null; closeNote: string | null;
  decisions: Array<{ step: number; actorId: string; decision: 'approve' | 'return'; note: string; decidedAt: string }>;
}
export interface PayrollReadinessDetail {
  request: PayrollReadinessRequest;
  netSnapshot: PayrollNetSnapshot;
  lines: Array<{ id: string; employeeId: string; attributionMonth: string; itemCode: string; status: string; entitlement: string | null; paidBefore: string | null; amount: string | null; evidence: unknown }>;
  actors: Array<{ id: string; name: string }>;
  canDecide: boolean; canWithdraw: boolean; canRevoke: boolean;
}
export interface PayrollReadinessInput {
  batchId: string; expectedVersion: number; firstMonth: string; reference: string; requestId: string;
}
