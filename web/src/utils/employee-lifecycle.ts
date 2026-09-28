import type { EmployeeDataReview } from '@/api/employee-archives.api';

export function applicationType(request: EmployeeDataReview): string {
  if (request.intakeType === 'reentry') return '再入职';
  if (request.sourceType === 'manual_employee_create') return '新增员工';
  if (request.proposedValue?.employee?.employeeStatus === 'resigned'
    || request.proposedValue?.employee?.changeType === 'resignation') return '离职';
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
