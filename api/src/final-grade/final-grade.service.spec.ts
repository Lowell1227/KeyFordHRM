import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FinalGradeService } from './final-grade.service';
import { AuthUser } from '@/common/types/auth.types';

describe('FinalGradeService department review access', () => {
  const task = {
    id: 'task-1', cycleId: 'cycle-1', employeeId: 'employee-1', managerId: 'manager-1', deptHeadId: 'head-1', status: 'manager_scoring',
    cycle: { name: '虚拟周期' }, employee: { name: '虚拟员工', position: null }, dept: { name: '人事组' }, manager: { name: '虚拟上级' },
    gradeResult: { calculatedScore: new Prisma.Decimal(92.4), rawGrade: 'B' },
    periods: [{ periodKey: '2026-09', periodType: 'month', status: 'completed', selfGrade: 'A', managerGrade: 'A', selfScoreTotal: new Prisma.Decimal(92.4), managerScoreTotal: new Prisma.Decimal(92.4), employeeSubmittedAt: new Date(), managerSubmittedAt: new Date(), lockedAt: new Date() }],
  };
  const viewer = (id: string) => ({ id, sysRole: 'employee', canViewAll: false } as AuthUser);
  const makeService = (overrides = {}) => new FinalGradeService({ assessmentTask: { findUnique: jest.fn().mockResolvedValue({ ...task, ...overrides }) }, flowRecord: { findFirst: jest.fn().mockResolvedValue(null) } } as any, {} as any, {} as any);

  it('lets the frozen department reviewer read monthly basis without final-grade write capability', async () => {
    const detail = await makeService().getFinalGrade(task.id, viewer('head-1'));
    expect(detail.calculatedScore).toBe(92.4);
    expect(detail.periods[0].managerGrade).toBe('A');
    expect(detail.canSubmit).toBe(false);
  });
  it('keeps employees and unrelated department leaders out of unpublished grade basis', async () => {
    for (const id of ['employee-1', 'other-head']) await expect(makeService().getFinalGrade(task.id, viewer(id))).rejects.toThrow(ForbiddenException);
  });
  it('does not allow the department reviewer to change the manager final grade', async () => {
    await expect(makeService().submitFinalGrade(task.id, { grade: 'C' }, viewer('head-1'))).rejects.toThrow(ForbiddenException);
  });
  it('does not reveal an unpublished result to its employee who is also the frozen department head', async () => {
    await expect(makeService({ deptHeadId: task.employeeId }).getFinalGrade(task.id, viewer(task.employeeId))).rejects.toThrow(ForbiddenException);
  });
});
