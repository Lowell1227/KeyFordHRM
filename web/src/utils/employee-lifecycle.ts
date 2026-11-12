import type { EmployeeDataReview } from '@/api/employee-archives.api';

function isResignationRequest(request: EmployeeDataReview): boolean {
  const employee = request.proposedValue?.employee;
  return employee?.changeType === 'resignation'
    || (employee?.employeeStatus === 'resigned' && request.baseValue?.employee?.employeeStatus !== 'resigned');
}

export function isPersonnelLifecycleRequest(request: EmployeeDataReview): boolean {
  return Boolean(request.intakeType || request.sourceType === 'manual_employee_create'
    || request.sourceType === 'manual_reentry' || isResignationRequest(request));
}

export function isPendingArrival(request: EmployeeDataReview): boolean {
  return Boolean(request.intakeType && request.requiresArrivalConfirmation
    && request.onboardingStatus === 'pending_entry' && request.recordStatus !== 'draft'
    && request.recordStatus !== 'archived' && !request.archivedAt && !request.cancelledAt
    && !request.arrivalConfirmedAt && request.profileReviewStatus === 'approved');
}

export function canReviseArrivalDate(request: EmployeeDataReview): boolean {
  if (isCancelledNewHireArrival(request)) return true;
  return Boolean(request.userId && ['new_hire', 'reentry'].includes(request.intakeType ?? '')
    && request.requiresArrivalConfirmation && request.recordStatus === 'submitted'
    && ['submitted', 'pending_entry'].includes(request.onboardingStatus ?? '')
    && !request.archivedAt && !request.cancelledAt && !request.arrivalConfirmedAt
    && (request.profileReviewStatus === 'approved'
      || (request.intakeType === 'new_hire' && request.profileReviewStatus === 'rejected')));
}

export function isCancelledNewHireArrival(request: EmployeeDataReview): boolean {
  return Boolean(request.userId && request.intakeType === 'new_hire' && request.requiresArrivalConfirmation
    && request.onboardingStatus === 'cancelled' && String(request.recordStatus) === 'cancelled'
    && request.cancelledAt && !request.archivedAt && !request.arrivalConfirmedAt
    && !request.arrivalDate && !request.arrivalConfirmedById);
}

export function reviewedArrivalDate(request: EmployeeDataReview): string {
  const employee = request.proposedValue?.employee ?? {};
  const date = request.intakeType === 'reentry' ? employee.effectiveDate : employee.effectiveFrom || employee.entryDate;
  return typeof date === 'string' ? date.slice(0, 10) : '';
}

export function arrivalConfirmationError(request: EmployeeDataReview, date: string, now = new Date()): string {
  if (!isPendingArrival(request)) return '申请状态已变化，请刷新后核对。';
  if (!Number.isInteger(request.requestVersion) || request.requestVersion! < 1) return '缺少申请版本，请刷新后重试。';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date !== reviewedArrivalDate(request)) return '到岗日期须与已审核日期一致；日期变更请先修改申请并重新审核。';
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return '已审核日期无效，请先核对申请。';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return date > today ? '到岗日期不能是未来日期，请到岗后再办理。' : '';
}

export function archiveSubmissionMessage(result: { directApplied?: string[]; request: EmployeeDataReview | null }): string {
  const applied = result.directApplied ?? [];
  const pending = result.request && [result.request.profileReviewStatus, result.request.performanceReviewStatus]
    .some(status => status === 'pending' || status === 'applying' || status === 'rejected');
  if (applied.length) return `${applied.join('、')}已生效${pending ? '；其余变更已提交审核，审核通过后生效' : ''}`;
  if (pending) return '档案变更已提交审核，审核通过后生效';
  return result.request?.appliedAt ? '档案变更已生效' : result.request ? '申请已提交，请查看办理进度' : '未检测到需提交的变更';
}

export function applicationType(request: EmployeeDataReview): string {
  if (request.intakeType === 'reentry') return '再入职';
  if (request.sourceType === 'manual_employee_create') return '新增员工';
  if (isResignationRequest(request)) return '离职';
  if (request.profileReviewStatus === 'not_required') return '绩效关系';
  return '档案修改';
}

export function applicationProgress(request: EmployeeDataReview): string {
  const approved = [request.profileReviewStatus, request.performanceReviewStatus].includes('approved');
  const rejected = [request.profileReviewStatus, request.performanceReviewStatus].includes('rejected');
  const pending = [request.profileReviewStatus, request.performanceReviewStatus]
    .some((status) => status === 'pending' || status === 'applying');
  const cancelled = request.onboardingStatus === 'cancelled' || request.cancelledAt
    || [request.profileReviewStatus, request.performanceReviewStatus].includes('cancelled');
  if (request.onboardingStatus === 'cancelled') return '已取消';
  if (isPendingArrival(request)) {
    if (rejected) return '待确认到岗，绩效关系已退回';
    if (pending) return '待确认到岗，绩效关系待审核';
    return '待确认到岗';
  }
  if (cancelled) {
    if (!approved) return '已取消';
    if (request.onboardingStatus === 'pending_entry') return '部分已通过，其余已取消，待入职生效';
    return '部分已生效，其余已取消';
  }
  if (request.recordStatus === 'archived') return '已归档';
  if (request.recordStatus === 'draft') return rejected ? '已退回，待修改' : '草稿';
  if (rejected) return approved ? '部分已通过，其余已退回' : '已退回，待修改';
  if (pending) return approved ? '部分已通过，其余待审核' : '待审核';
  if (request.onboardingStatus === 'pending_entry') return '已通过，待入职生效';
  if (request.onboardingStatus === 'effective') return '已生效';
  const date = request.proposedValue?.employee?.effectiveFrom || request.proposedValue?.employee?.effectiveDate;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  if (date && String(date).slice(0, 10) > today) return '已通过，待生效';
  if (request.profileReviewStatus === 'approved' && !request.appliedAt && !request.intakeType) return '已通过，待生效';
  return request.appliedAt ? '已生效' : approved ? '已通过' : '待办理';
}
