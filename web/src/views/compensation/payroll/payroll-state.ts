import type { PayrollAccess, PayrollBatch, PayrollStatus } from '@/types/payroll.types';

export function subjectCapabilities(access: PayrollAccess | undefined, subjectId: string): string[] {
  return access?.enabled ? access.subjects.find(subject => subject.id === subjectId)?.capabilities ?? [] : [];
}
export function currentVersion(batch: PayrollBatch) { return batch.versions?.reduce<PayrollBatch['versions'][number] | undefined>((latest, value) => !latest || value.version > latest.version ? value : latest, undefined); }
export function needsUpdate(batch: PayrollBatch) { return Boolean(batch.needsUpdate || currentVersion(batch)?.needsUpdate); }
export type BatchAction = 'calculate' | 'submit' | 'approve' | 'return' | 'withdraw' | 'export' | 'settle' | 'cancel-remainder' | 'void' | 'correct';
export function batchActions(batch: PayrollBatch, capabilities: string[], actorId: string): BatchAction[] {
  const actions: BatchAction[] = [];
  const can = (cap: string) => capabilities.includes(cap);
  const version = currentVersion(batch);
  if (can('payroll_edit')) {
    if (['draft', 'calculated', 'blocked', 'returned', 'withdrawn', 'voided'].includes(batch.status)) actions.push('calculate');
    if (batch.status === 'calculated' && batch.purpose !== 'trial' && !needsUpdate(batch)
      && version && version.gross !== null && !version.issues?.length && version.lines?.every(line => ['ready', 'not_applicable'].includes(line.status))) actions.push('submit');
    if (batch.status === 'pending') actions.push('withdraw');
    if (['approved', 'closed', 'voided'].includes(batch.status)) actions.push('correct');
    if (batch.status === 'approved') actions.push('void');
  }
  if (version && version.approvalPath[version.approvalStep] === actorId && version.submittedById !== actorId && batch.status === 'pending'
    && (version.approvalStep < version.reviewerCount ? can('payroll_review') : can('payroll_approve'))) {
    if (!needsUpdate(batch)) actions.push('approve');
    actions.push('return');
  }
  if (version?.status === 'approved' && ['approved', 'closed'].includes(batch.status) && !needsUpdate(batch)) {
    const cancelled = batch.events?.some(event => {
      const value = event as { action?: string; version?: number };
      return value.action === 'remainder_cancelled' && value.version === version.version;
    });
    if (batch.purpose !== 'trial' && !cancelled && can('payroll_export')) actions.push('export');
    if (batch.status === 'approved' && batch.purpose !== 'trial' && can('payroll_settle')) actions.push('settle', 'cancel-remainder');
  }
  return actions;
}
export const statusLabels: Record<PayrollStatus, string> = { draft: '草稿', calculated: '待提交复核', blocked: '待核对 / 待配置', pending: '复核 / 审批中', approved: '已批准', returned: '已退回', withdrawn: '已撤回', voided: '已作废', closed: '已结清' };
export function batchStatus(batch: PayrollBatch): string {
  const version = currentVersion(batch);
  return batch.status === 'pending' && version ? version.approvalStep < version.reviewerCount ? '待复核' : '待审批' : statusLabels[batch.status];
}
export const purposeLabels = { trial: '试算', validation: '测试环境', formal: '正式' };
export const itemLabels: Record<string, string> = { fixed: '固定工资', absence: '假勤差额', overtime: '加班工资', performance: '个人绩效', adjustment: '授权调整' };
export function isDecimal(value: string, signed = false) { return (signed ? /^-?\d+(\.\d+)?$/ : /^\d+(\.\d+)?$/).test(value); }
export const attendanceIssueLabels: Record<string, string> = {
  MISSING_RECORD: '应核日期没有来源记录，请补同步', MISSING_REGULAR_COVERAGE: '只有加班记录，缺少正常出勤依据',
  UNEXPECTED_RECORD: '记录不在本主体应核人员或日期范围', INVALID_WORK_DATE: '工作日无效', OUTSIDE_MONTH: '记录超出本自然月',
  INVALID_SOURCE_VERSION: '来源版本无效', SOURCE_VERSION_CONFLICT: '相同来源版本内容冲突', INVALID_SOURCE_ID: '来源标识缺失',
  INVALID_EMPLOYEE_ID: '员工身份未匹配', INVALID_INTERVAL: '时间段无效', INVALID_HOURS: '时长无效',
  INVALID_EXPECTED_UNITS: '计薪单位无效', EXPECTED_CONFLICT: '应核日期配置冲突', INVALID_REQUIREMENT: '考勤要求尚未确认',
  INVALID_RECORD_TYPE: '考勤类型待核对', INVALID_RECORD_STATE: '来源状态无效', PENDING_APPROVAL: '原考勤审批尚未生效',
  REVOKED_RECORD: '来源已撤销，请核对计薪影响', DAY_CONVERSION_REQUIRED: '天与小时换算未配置', UNKNOWN_UNIT: '时长单位不明',
  OVERTIME_KIND_REQUIRED: '加班类型未确认', MISSING_PUNCH: '缺卡尚未被有效补卡或假勤覆盖', REQUIREMENT_CONFLICT: '无需考勤与来源记录冲突', INTERVAL_CONFLICT: '有效考勤时段重叠',
};
