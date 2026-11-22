import { Prisma } from '@prisma/client';

export type PayrollDomain = 'validation' | 'formal';
export type PayrollPurpose = 'trial' | PayrollDomain;
export const PAYROLL_ITEM_CODES = ['fixed', 'absence', 'overtime', 'performance', 'adjustment'] as const;
export type PayrollItemCode = typeof PAYROLL_ITEM_CODES[number];
export interface PayrollPolicyConfig {
  rounding: 'item_half_up' | null;
  normalHourly: string | null;
  paidHourly: Partial<Record<'unpaid_leave' | 'sick_leave' | 'absence', string>>;
  overtime: { hourlyBase: string | null; weekday: string | null; restday: string | null; holiday: string | null };
  reviewers: string[];
  approvers: string[];
  cutoverMonth: string | null;
  performance: Record<string, { cycleIds: string[]; coefficients: Partial<Record<'A' | 'B' | 'C' | 'D', string>> }>;
}
export interface PayrollCapturedLine {
  employeeId: string;
  attributionMonth: string;
  itemCode: PayrollItemCode;
  status: string;
  entitlement: string | null;
  paidBefore: string | null;
  amount: string | null;
  evidence: Prisma.InputJsonValue;
}
export interface PayrollCapture {
  sourceHash: string;
  sources: Prisma.InputJsonValue;
  issues: string[];
  lines: PayrollCapturedLine[];
  approvalPath: string[];
  reviewerCount: number;
  gross: string | null;
}
export interface PayrollSourceReader {
  capture(tx: Prisma.TransactionClient, subjectId: string, month: string, domain: PayrollDomain): Promise<PayrollCapture>;
}
