import { Prisma } from '@prisma/client';
import type { PayrollWorkCalendar } from './payroll-work-calendar';
import type { PayrollAttendanceType, PayrollOvertimeKind } from './payroll-attendance-normalizer';

export type PayrollDomain = 'validation' | 'formal';
export type PayrollPurpose = 'trial' | 'reconciliation' | PayrollDomain;
export const PAYROLL_ITEM_CODES = ['fixed', 'absence', 'overtime', 'performance', 'adjustment'] as const;
export type PayrollItemCode = typeof PAYROLL_ITEM_CODES[number];
export interface PayrollPolicyConfig {
  employeeScope?: { employeeIds: string[]; evidenceRef: string };
  attendanceMappings?: Record<string, { type: Exclude<PayrollAttendanceType, 'normal' | 'absence' | 'missing_punch' | 'not_required'>; overtimeKind?: PayrollOvertimeKind }>;
  fixedSalaryBasis?: 'monthly_workdays' | null;
  workCalendars?: Record<string, PayrollWorkCalendar>;
  rounding: 'item_half_up' | null;
  monthlyUnits: Record<string, string>;
  normalHourly: string | null;
  paidHourly: Partial<Record<'unpaid_leave' | 'sick_leave' | 'absence', string>>;
  overtime: { hourlyBase: string | null; weekday: string | null; restday: string | null; holiday: string | null };
  reviewers: string[];
  approvers: string[];
  cutoverMonth: string | null;
  performance: Record<string, { cycleIds: string[]; sourceKind?: 'official' | 'fictional' | 'manual' | null;
    manualAmounts?: Record<string, string>;
    coefficientVersion?: string | null; evidenceRef?: string | null;
    coefficients: Partial<Record<'A' | 'B' | 'C' | 'D', string>> }>;
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
