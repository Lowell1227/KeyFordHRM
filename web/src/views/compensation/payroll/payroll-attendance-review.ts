import type { PayrollAttendanceReview, PayrollConfirmedAbsence } from '@/types/payroll-absence.types';

const types: Record<string, string> = { normal: '正常出勤', paid_leave: '带薪假', unpaid_leave: '事假', sick_leave: '病假',
  business_trip: '出差', outing: '外出', makeup: '补卡', overtime: '加班', missing_punch: '缺卡', absence: '已核定缺勤', not_required: '无需出勤' };
export function attendanceTime(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return '时间待核对';
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}
export function attendanceRecordRows(records: unknown[]) {
  return records.map(value => {
    const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    return { typeLabel: types[String(row.type)] ?? '来源待核对', range: `${attendanceTime(row.startsAt)} 至 ${attendanceTime(row.endsAt)}`,
      hours: row.resolution === 'usable' && typeof row.effectiveHours === 'string' ? row.effectiveHours : '待核定',
      status: row.resolution === 'usable' ? '可计薪' : row.resolution === 'covered' ? '已由有效记录覆盖'
        : row.state === 'revoked' || row.state === 'cancelled' || row.state === 'superseded' ? '已失效' : '待核对' };
  });
}
export function attendanceDayReviews(reviews: PayrollAttendanceReview[], day: { employeeId: string; workDate: string }) {
  return reviews.filter(row => (!row.employeeId || row.employeeId === day.employeeId) && (!row.workDate || row.workDate === day.workDate));
}
export function pendingAbsenceProposals(reviews: PayrollAttendanceReview[], confirmed: Pick<PayrollConfirmedAbsence, 'id'>[], day: { employeeId: string; workDate: string }) {
  return attendanceDayReviews(reviews, day).filter(row => row.kind === 'absence_proposed' && row.id && !confirmed.some(fact => fact.id === row.id)
    && !reviews.some(decision => decision.proposalId === row.id && ['absence_returned', 'absence_revoked'].includes(decision.kind ?? '')));
}
export const attendanceReviewLabels: Record<string, string> = {
  absence_proposed: '提出缺勤核定', absence_confirmed: '通过缺勤核定', absence_returned: '退回缺勤核定', absence_revoked: '撤销缺勤核定',
};
