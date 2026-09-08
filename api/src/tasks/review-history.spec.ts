import { CalibrationService } from '@/calibration/calibration.service';
import { FinalGradeService } from '@/final-grade/final-grade.service';
import { mapReviewHistory } from './review-history';

describe('key review history', () => {
  const records = [
    { id: 'manager', nodeType: 'manager_score', action: 'submit', actor: { name: '直属上级' }, comment: '系统评分摘要', extraData: { type: 'final_grade_submitted', comment: '周期整体稳定' }, createdAt: new Date('2026-09-01') },
    { id: 'return', nodeType: 'dept_review', action: 'reject', actor: { name: '部门负责人' }, comment: '请补充依据', extraData: null, createdAt: new Date('2026-09-02') },
    { id: 'review', nodeType: 'dept_review', action: 'approve', actor: { name: '部门负责人' }, comment: '已核实业务成果', extraData: null, createdAt: new Date('2026-09-03') },
    { id: 'combined', nodeType: 'dept_review', action: 'approve', actor: { name: '部门负责人' }, comment: '合并完成部门复核', extraData: { type: 'combined_department_review' }, createdAt: new Date('2026-09-04') },
  ];
  function setup() {
    const task = { id: 'task', cycleId: 'cycle', employeeId: 'employee', managerId: 'manager', deptHeadId: 'head', status: 'hr_calibration', employee: { name: '虚拟员工' }, cycle: { name: '虚拟周期' }, gradeResult: null, periods: [], indicatorInstances: [], flowRecords: records };
    const prisma = {
      assessmentCycle: { findUnique: jest.fn().mockResolvedValue({ id: 'cycle', hrOwnerId: 'owner' }) },
      assessmentTask: { findFirst: jest.fn().mockImplementation(async ({ include }) => ({ ...task, flowRecords: include.flowRecords.where.action ? records.filter(r => r.action === include.flowRecords.where.action) : records })), findUnique: jest.fn().mockResolvedValue(task) },
      assessmentPeriodIndicatorReview: { findMany: jest.fn().mockResolvedValue([]) },
      flowRecord: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    return { prisma, calibration: new CalibrationService(prisma as any, {} as any, {} as any), finalGrade: new FinalGradeService(prisma as any, {} as any, {} as any) };
  }
  it('calibration retains approvals, returns, period comments and combined review evidence', async () => {
    const { calibration } = setup();
    const detail = await calibration.getCandidateDetail('cycle', 'task', { id: 'owner', sysRole: 'employee' } as any);
    expect((detail as any).flowRecords).toEqual(records.map(({ actor, ...r }) => ({ ...r, actorName: actor.name })));
    expect(detail.rejectHistory).toHaveLength(1);
  });
  it('department reviewer can read prior key records through existing final-grade detail', async () => {
    const { finalGrade, prisma } = setup();
    const detail = await finalGrade.getFinalGrade('task', { id: 'head', sysRole: 'employee' } as any);
    expect((detail as any).flowRecords).toHaveLength(4);
    expect(prisma.assessmentTask.findUnique.mock.calls[0][0].include.flowRecords).toBeDefined();
  });
  it('does not disclose key opinions to the employee or unrelated viewer', async () => {
    const { calibration, finalGrade } = setup();
    await expect(calibration.getCandidateDetail('cycle', 'task', { id: 'employee', sysRole: 'hr' } as any)).rejects.toThrow();
    await expect(finalGrade.getFinalGrade('task', { id: 'other', sysRole: 'employee' } as any)).rejects.toThrow();
  });
  it('preserves the month of a returned monthly review without unrelated workflow payloads', () => {
    const history = mapReviewHistory([{ ...records[0], action: 'reject', extraData: { type: 'manager_period_review_returned', periodKey: '2026-07', periodId: 'internal-period-id' } }]);
    expect(history[0].extraData).toEqual({ type: 'manager_period_review_returned', periodKey: '2026-07' });
  });
});
