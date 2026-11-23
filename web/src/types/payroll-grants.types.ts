export interface PayrollGrantPerson { id: string; name: string; employeeNo: string | null }
export interface PayrollGrantSubject { id: string; name: string }
export interface PayrollGrantRow {
  id: string; userId: string; subjectId: string; capabilities: string[];
  revokedAt: string | null; updatedAt: string; createdAt: string;
  user: PayrollGrantPerson; subject: PayrollGrantSubject;
}
export interface PayrollGrantOptions {
  users: PayrollGrantPerson[]; subjects: PayrollGrantSubject[]; capabilities: string[];
}
export interface PayrollGrantDraft {
  subjectId: string; userId: string; capabilities: string[];
  expectedUpdatedAt: string | null; reason: string;
}
export interface PayrollGrantEvent {
  id: string; action: string; createdAt: string; actor: { id: string; name: string } | null;
  oldCapabilities: string[]; newCapabilities: string[]; reason: string;
}
export const payrollGrantLabels: Record<string, string> = {
  attendance_edit: '考勤核对', attendance_seal: '考勤封账', payroll_view: '工资查看', payroll_edit: '工资核算维护',
  payroll_review: '工资复核', payroll_approve: '工资审批', payroll_export: '结果导出', payroll_settle: '实发登记',
};
