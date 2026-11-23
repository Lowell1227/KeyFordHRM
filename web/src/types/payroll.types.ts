export type PayrollCapability = 'attendance_edit' | 'attendance_seal' | 'payroll_view' | 'payroll_edit' | 'payroll_review' | 'payroll_approve' | 'payroll_export' | 'payroll_settle' | 'payroll_parameter_review';
export interface PayrollSubject { id: string; name: string; capabilities: string[] }
export interface PayrollAccess { enabled: boolean; subjects: PayrollSubject[] }
export interface PayrollEmployee { id: string; name: string; employeeNo: string }
export interface PayrollOperator { id: string; name: string; capabilities: string[] }
export interface PayrollCycle { id: string; name: string; type?: string; startDate?: string; endDate?: string }
export interface AttendanceIssue { employeeId?: string; workDate?: string; code: string; message: string }
export interface AttendanceDay { employeeId: string; workDate: string; units: unknown; required: unknown; records: unknown[]; issues: Array<AttendanceIssue | string> }
export interface PayrollAttendance { id: string; month: string; version: number; status: string; payload: { month: string; days: AttendanceDay[]; issues: AttendanceIssue[]; version: string }; review: unknown[]; sealedAt: string | null }
export interface PayrollSourceInput { sourceKey: string; input: Record<string, unknown>; complete?: boolean; scope?: { employeeIds: string[]; from: string; to: string } }
export interface PayrollStandardInput { subjectId: string; employeeId: string; effectiveFrom: string; effectiveTo?: string; fixedMonthly: string | null; performanceBase: string | null; performanceMode: 'included' | 'additional' | 'none' | null; evidence: string }
export interface PayrollStandard extends PayrollStandardInput { id: string; version: number; status: string }
export interface PayrollPerformanceMapping { cycleIds: string[]; coefficients: Partial<Record<'A' | 'B' | 'C' | 'D', string>>; sourceKind?: 'official' | 'fictional' | null; coefficientVersion?: string | null; evidenceRef?: string | null }
export interface PayrollWorkCalendar { sourceVersion: string; evidenceRef: string; days: Array<{ workDate: string; units: string }> }
export interface PayrollRuleConfig {
  fixedSalaryBasis?: 'monthly_workdays' | null;
  workCalendars?: Record<string, PayrollWorkCalendar>;
  monthlyUnits: Record<string, string>;
  rounding: 'item_half_up' | null;
  normalHourly: string | null;
  paidHourly: { unpaid_leave?: string; sick_leave?: string; absence?: string };
  overtime: { hourlyBase: string | null; weekday: string | null; restday: string | null; holiday: string | null };
  reviewers: string[]; approvers: string[]; cutoverMonth: string | null;
  performance: Record<string, PayrollPerformanceMapping>;
}
export interface PayrollRuleInput { subjectId: string; effectiveFrom: string; effectiveTo?: string; config: PayrollRuleConfig }
export interface PayrollRule extends PayrollRuleInput { id: string; version: number; status: string }
export interface PayrollParameterRelease {
  id: string; subjectId: string; kind: 'standard' | 'rule'; standardId: string | null; ruleId: string | null;
  attempt: number; parameterVersion: number; previousParameterId: string | null;
  status: 'pending' | 'approved' | 'returned' | 'withdrawn'; submittedById: string; reviewerId: string;
  submittedBy: { id: string; name: string }; reviewer: { id: string; name: string };
  standard?: { employee: { name: string; employeeNo: string | null } } | null;
  snapshot: { effectiveFrom: string; effectiveTo: string | null; fixedMonthly?: string | null; performanceBase?: string | null;
    performanceMode?: string | null; evidence?: string; config?: PayrollRuleConfig };
  submittedAt: string; decidedAt: string | null; note: string;
}
export type PayrollPurpose = 'trial' | 'validation' | 'formal';
export type PayrollStatus = 'draft' | 'calculated' | 'blocked' | 'pending' | 'approved' | 'returned' | 'withdrawn' | 'voided' | 'closed';
export type PayrollItemCode = 'fixed' | 'absence' | 'overtime' | 'performance' | 'adjustment';
export interface PayrollLine { id: string; employeeId: string; attributionMonth: string; itemCode: string; status: string; entitlement: string | null; paidBefore: string | null; amount: string | null; evidence: unknown; reservation?: object | null; settlements?: Array<{ id: string; amount: string; reference: string; createdAt?: string }> }
export interface PayrollVersion { id: string; version: number; status: PayrollStatus; needsUpdate?: boolean; submittedById?: string | null; sourceHash: string; sources: unknown; issues: string[]; approvalPath: string[]; reviewerCount: number; approvalStep: number; gross: string | null; lines: PayrollLine[]; decisions: unknown[]; exports: unknown[] }
export interface PayrollBatch { id: string; subjectId: string; month: string; payMonth: string; purpose: PayrollPurpose; status: PayrollStatus; version: number; needsUpdate?: boolean; versions: PayrollVersion[]; events?: unknown[]; correctionOfId?: string | null; additionalMonths?: string[] }
export interface PayrollBatchInput { subjectId: string; month: string; payMonth: string; purpose: PayrollPurpose; correctionOfId?: string; additionalMonths?: string[] }
export type PayrollDeductionsPreviewMode = 'complete' | 'missing';
export interface PayrollDeductionsPreviewInput { expectedVersion: number; payDate: string; mode: PayrollDeductionsPreviewMode }
export interface PayrollDeductionsAmounts { gross: string; socialInsurance: string; housingFund: string; incomeTax: string; net: string }
export interface PayrollDeductionsPreviewRow {
  employeeId: string; employeeName: string; status: 'ready' | 'needs_configuration' | 'needs_review'; issues: string[];
  gross: string | null; socialInsurance: string | null; housingFund: string | null; incomeTax: string | null; net: string | null;
  evidence: { sourceHash: string | null; input: unknown; [key: string]: unknown };
}
export interface PayrollDeductionsPreviewResult {
  batchId: string; batchVersion: number; calculationVersion: number; calculationVersionId: string; subjectId: string; sourceHash: string;
  payDate: string; payMonth: string; mode: PayrollDeductionsPreviewMode; basis: 'fictional'; approvalStatus: 'not_submitted';
  rows: PayrollDeductionsPreviewRow[]; totals: PayrollDeductionsAmounts | null;
}
export interface PayrollAdjustmentInput { subjectId: string; employeeId: string; month: string; itemCode: PayrollItemCode; amount: string; reason: string; reference: string }
export interface PayrollAdjustment extends PayrollAdjustmentInput { id: string; createdAt?: string }
export interface PayrollOpeningInput { subjectId: string; employeeId: string; month: string; itemCode: PayrollItemCode; amount: string; reference: string }
export interface PayrollOpening extends Omit<PayrollOpeningInput, 'amount' | 'month'> { id: string; month?: string; attributionMonth?: string; amount: string | null; confirmedAt?: string | null; createdAt?: string }
