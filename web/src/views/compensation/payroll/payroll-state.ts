import type { PayrollAccess, PayrollBatch, PayrollStatus, PayrollVersion } from '@/types/payroll.types';

export function payrollBusinessMonth(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' }).formatToParts(now);
  return `${parts.find(part => part.type === 'year')!.value}-${parts.find(part => part.type === 'month')!.value}`;
}

export function subjectCapabilities(access: PayrollAccess | undefined, subjectId: string): string[] {
  return access?.enabled ? access.subjects.find(subject => subject.id === subjectId)?.capabilities ?? [] : [];
}
export function currentVersion(batch: PayrollBatch) { return batch.versions?.reduce<PayrollBatch['versions'][number] | undefined>((latest, value) => !latest || value.version > latest.version ? value : latest, undefined); }
export function needsUpdate(batch: PayrollBatch) { return Boolean(batch.needsUpdate || currentVersion(batch)?.needsUpdate); }
export function payrollPayDateError(value: string, payMonth: string): string {
  if (!value) return '请选择核算发薪日';
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return '请输入有效的日历日期';
  return value.slice(0, 7) === payMonth ? '' : `核算发薪日须在本批发放月 ${payMonth} 内`;
}
export function completeNetVersion(batch: PayrollBatch): boolean {
  const version = currentVersion(batch), net = version?.netSnapshot;
  return Boolean(net && net.schema === 1 && version?.payDate?.slice(0, 10) === net.payDate && !payrollPayDateError(net.payDate, batch.payMonth)
    && net.totals && net.rows.length && net.rows.every(row => row.result.status === 'ready' && !row.result.issues.length
      && ['gross', 'socialInsurance', 'housingFund', 'incomeTax', 'net'].every(key => row.result[key as keyof typeof row.result] != null)));
}
export function payrollDownloadName(batch: PayrollBatch): string {
  return `${batch.purpose === 'formal' ? '' : '测试环境-'}${currentVersion(batch)?.netSnapshot ? '实发工资' : '税前工资'}-${batch.month}-V${currentVersion(batch)?.version}.xlsx`;
}
export function cancelledNetEmployeeIds(batch: PayrollBatch, version: PayrollVersion | undefined = currentVersion(batch)): string[] {
  if (!version?.netSnapshot) return [];
  const ids = new Set<string>();
  for (const event of batch.events ?? []) {
    if (!event || typeof event !== 'object') continue;
    const value = event as {action?: string; version?: number; metadata?: {employeeId?: unknown; versionId?: unknown}};
    const id = value.metadata?.employeeId;
    if (value.action === 'remainder_cancelled' && value.version === version.version && value.metadata?.versionId === version.id
      && typeof id === 'string' && version.netSnapshot.rows.some(row => row.employeeId === id)) ids.add(id);
  }
  return Array.from(ids);
}
export type BatchAction = 'calculate' | 'submit' | 'approve' | 'return' | 'withdraw' | 'export' | 'settle' | 'net-payment' | 'cancel-net-remainder' | 'cancel-remainder' | 'void' | 'correct';
export function batchActions(batch: PayrollBatch, capabilities: string[], actorId: string): BatchAction[] {
  const actions: BatchAction[] = [];
  const can = (cap: string) => capabilities.includes(cap);
  const version = currentVersion(batch);
  const net = version?.netSnapshot;
  const cancelledIds = cancelledNetEmployeeIds(batch, version);
  const hasUnpaidNet = net?.rows.some(row => !cancelledIds.includes(row.employeeId)
    && !version?.netPayments?.some(payment => payment.employeeId === row.employeeId));
  const validNet = completeNetVersion(batch);
  const eligible = (!net && batch.purpose !== 'formal') || validNet;
  if (can('payroll_edit')) {
    if (['draft', 'calculated', 'blocked', 'returned', 'withdrawn', 'voided'].includes(batch.status)) actions.push('calculate');
    if (batch.status === 'calculated' && batch.purpose !== 'trial' && !needsUpdate(batch)
      && eligible && version && version.gross !== null && !version.issues?.length && version.lines?.every(line => ['ready', 'not_applicable'].includes(line.status))) actions.push('submit');
    if (batch.status === 'pending') actions.push('withdraw');
    if (['approved', 'closed', 'voided'].includes(batch.status)) actions.push('correct');
  }
  if (batch.status === 'approved' && can('payroll_settle') && !version?.netPayments?.length && !version?.lines?.some(line => line.settlements?.length)) actions.push('void');
  if (version && version.approvalPath[version.approvalStep] === actorId && version.submittedById !== actorId && batch.status === 'pending'
    && (version.approvalStep < version.reviewerCount ? can('payroll_review') : can('payroll_approve'))) {
    if (!needsUpdate(batch) && eligible) actions.push('approve');
    actions.push('return');
  }
  if (version?.status === 'approved' && ['approved', 'closed'].includes(batch.status) && !needsUpdate(batch) && eligible
    && (!net || version.approvalStep >= version.approvalPath.length)) {
    const cancelled = batch.events?.some(event => {
      const value = event as { action?: string; version?: number };
      return value.action === 'remainder_cancelled' && value.version === version.version;
    });
    if (batch.purpose !== 'trial' && !cancelled && can('payroll_export')) actions.push('export');
    if (batch.status === 'approved' && batch.purpose !== 'trial' && can('payroll_settle')) {
      if (!net) actions.push('settle');
      else if (hasUnpaidNet) actions.push('net-payment');
    }
  }
  if (version?.status === 'approved' && batch.status === 'approved' && batch.purpose !== 'trial' && can('payroll_settle')
    && !net && version.lines?.some(line => line.status === 'ready' && line.reservation)) actions.push('cancel-remainder');
  if (version?.status === 'approved' && batch.status === 'approved' && batch.purpose !== 'trial' && can('payroll_settle')
    && net && version.approvalStep >= version.approvalPath.length && hasUnpaidNet) actions.push('cancel-net-remainder');
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
  CROSS_MONTH_SOURCE_CONFLICT: '同一来源存在跨月归属冲突，请先核对原月及已入薪差异',
  MISSING_RECORD: '应核日期没有来源记录，请补同步', MISSING_REGULAR_COVERAGE: '只有加班记录，缺少正常出勤依据',
  UNEXPECTED_RECORD: '记录不在本主体应核人员或日期范围', INVALID_WORK_DATE: '工作日无效', OUTSIDE_MONTH: '记录超出本自然月',
  INVALID_SOURCE_VERSION: '来源版本无效', SOURCE_VERSION_CONFLICT: '相同来源版本内容冲突', INVALID_SOURCE_ID: '来源标识缺失',
  INVALID_EMPLOYEE_ID: '员工身份未匹配', INVALID_INTERVAL: '时间段无效', INVALID_HOURS: '时长无效',
  INVALID_EXPECTED_UNITS: '计薪单位无效', EXPECTED_CONFLICT: '应核日期配置冲突', INVALID_REQUIREMENT: '考勤要求尚未确认',
  INVALID_RECORD_TYPE: '考勤类型待核对', INVALID_RECORD_STATE: '来源状态无效', PENDING_APPROVAL: '原考勤审批尚未生效',
  HOURS_EXCEED_INTERVAL: '计价时长超过来源时间区间，请核对原始时长',
  REVOKED_RECORD: '来源已撤销，请核对计薪影响', DAY_CONVERSION_REQUIRED: '天与小时换算未配置', UNKNOWN_UNIT: '时长单位不明',
  OVERTIME_KIND_REQUIRED: '加班类型未确认', MISSING_PUNCH: '缺卡尚未被有效补卡或假勤覆盖', REQUIREMENT_CONFLICT: '无需考勤与来源记录冲突', INTERVAL_CONFLICT: '有效考勤时段重叠',
};
