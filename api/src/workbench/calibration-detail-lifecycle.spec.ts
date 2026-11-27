import { ForbiddenException } from '@nestjs/common';
import { Prisma, SysRole } from '@prisma/client';
import type { AuthUser } from '@/common/types/auth.types';
import { CalibrationService } from '@/calibration/calibration.service';

jest.mock('@/tasks/flow.service', () => ({ FlowService: class {} }));
jest.mock('@/notifications/notifications.service', () => ({ NotificationsService: class {} }));

const viewer: AuthUser = { id: 'owner', name: 'Fictional owner', sysRole: SysRole.employee, deptId: null,
  isAssessorOnly: false, canViewAll: false, hrCapabilities: [] };
const at = new Date('2037-01-31T01:00:00Z');
function fixture() {
  let row: Record<string, any> = { id: 'task', cycleId: 'cycle', employeeId: 'employee', status: 'hr_calibration',
    isExempt: false, employee: { name: 'Fictional employee', employeeNo: null, position: null }, dept: null, manager: null,
    lifecycleStatus: 'active', lifecycleVersion: 0, updatedAt: at, terminatedAt: null, terminatedById: null, terminationReason: null,
    deletedAt: null, deletedById: null, deletionReason: null, approvedAt: null, employeeConfirmedAt: null, publishedAt: null,
    periods: [], flowRecords: [], gradeResult: { calculatedScore: null, rawGrade: null, calibratedGrade: null,
      approvedAt: null, employeeConfirmedAt: null, publishedAt: null, isPublished: false } };
  const prisma = {
    assessmentCycle: { findUnique: jest.fn().mockResolvedValue({ id: 'cycle', hrOwnerId: 'owner',
      gradeAMaxRatio: new Prisma.Decimal('0.2'), gradeBMaxRatio: new Prisma.Decimal('0.4'),
      gradeCMaxRatio: new Prisma.Decimal('0.3'), gradeDMaxRatio: new Prisma.Decimal('0.1') }) },
    assessmentTask: {
      findMany: jest.fn(async () => row.lifecycleStatus === 'active' ? [row] : []),
      findFirst: jest.fn(async (query: any) => ({ ...row, gradeResult: Object.fromEntries(
        Object.keys(query.include.gradeResult.select).map(key => [key, row.gradeResult[key]])) })),
    },
  };
  const notifications = { create: jest.fn() }, flow = { transitionTx: jest.fn() };
  const service = new CalibrationService(prisma as never, flow as never, notifications as never);
  return { prisma, service, notifications, flow, change: (values: Record<string, unknown>) => { row = { ...row, ...values }; },
    grade: (values: Record<string, unknown>) => { row.gradeResult = { ...row.gradeResult, ...values }; } };
}

describe('calibration detail lifecycle race contract (new pure cases)', () => {
  it('returns actual termination metadata after an active list read even when business status is unchanged', async () => {
    const f = fixture();
    const before = await f.service.getWorkbench('cycle', viewer);
    expect(before.items[0]).toMatchObject({ taskId: 'task', status: 'hr_calibration', canCalibrate: true });
    f.change({ lifecycleStatus: 'terminated', lifecycleVersion: 1, terminatedAt: at,
      terminatedById: 'hr', terminationReason: 'Fictional authorized termination' });
    const detail = await f.service.getCandidateDetail('cycle', 'task', viewer);
    expect(detail).toMatchObject({ taskId: 'task', status: 'hr_calibration', lifecycleStatus: 'terminated', lifecycleVersion: 1,
      terminatedAt: at, terminatedById: 'hr', terminationReason: 'Fictional authorized termination', allowedActions: [] });
    expect(f.prisma.assessmentTask.findFirst.mock.calls[0][0].include.gradeResult.select).toMatchObject({
      approvedAt: true, employeeConfirmedAt: true, publishedAt: true, isPublished: true,
    });
    expect(f.flow.transitionTx).not.toHaveBeenCalled();
    expect(f.notifications.create).not.toHaveBeenCalled();
  });

  it.each(['approvedAt', 'employeeConfirmedAt', 'publishedAt', 'isPublished'] as const)(
    'preserves grade-result-only %s evidence when projecting lifecycle protections', async field => {
      const f = fixture(); f.grade({ [field]: field === 'isPublished' ? true : at });
      const detail = await f.service.getCandidateDetail('cycle', 'task', { ...viewer, sysRole: SysRole.hr });
      expect(detail.allowedActions).not.toContain('lifecycle_terminate');
      expect(detail.status).toBe('hr_calibration');
      expect(detail.lifecycleStatus).toBe('active');
    });

  it('retains deletion metadata for the original authorized read-only detail path', async () => {
    const f = fixture(); f.change({ lifecycleStatus: 'deleted', lifecycleVersion: 2, terminatedAt: at,
      deletedAt: at, deletedById: 'hr', deletionReason: 'Fictional authorized history action' });
    expect(await f.service.getCandidateDetail('cycle', 'task', viewer)).toMatchObject({
      status: 'hr_calibration', lifecycleStatus: 'deleted', lifecycleVersion: 2, deletedAt: at, allowedActions: [],
    });
  });

  it('keeps original cycle and self-view restrictions before exposing lifecycle detail', async () => {
    const f = fixture();
    await expect(f.service.getCandidateDetail('cycle', 'task', { ...viewer, id: 'unrelated' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.prisma.assessmentTask.findFirst).not.toHaveBeenCalled();
    f.change({ employeeId: 'owner' });
    await expect(f.service.getCandidateDetail('cycle', 'task', viewer)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
