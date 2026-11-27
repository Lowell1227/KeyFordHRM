import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma, SysRole } from '@prisma/client';
import { AuthUser } from '@/common/types/auth.types';
import { ObjectivesService } from './objectives.service';

describe('Objectives lifecycle read-only projections', () => {
  const viewer: AuthUser = { id: 'employee', name: 'Fictional employee', sysRole: SysRole.employee,
    deptId: null, isAssessorOnly: false, canViewAll: false };
  const at = new Date('2026-11-26T04:00:00Z');
  function setup(lifecycleStatus = 'active') {
    const period = { id: 'period', periodType: 'month', periodKey: '2026-11', status: 'self_eval',
      periodStart: new Date('2026-11-01'), periodEnd: new Date('2026-11-30'),
      employeeSubmittedAt: null, managerSubmittedAt: null, lockedAt: null, selfScoreTotal: null,
      indicatorReviews: [], indicatorVersion: { items: [{ sourceInstanceId: 'goal' }] } };
    const progress = { id: 'progress', progress: 42, content: 'Previously recorded progress', attachments: [],
      createdAt: at, period: null, creator: { id: viewer.id, name: viewer.name }, healthStatus: null };
    const indicator = { id: 'goal', taskId: 'task', name: 'Fictional goal', targetValue: new Prisma.Decimal(10),
      unit: 'items', weight: new Prisma.Decimal(1), dimensionWeight: new Prisma.Decimal(1), sortOrder: 0,
      indicatorType: 'kpi', visibilityScope: 'supervisors', visibilityRules: [], createdAt: at, updatedAt: at,
      objectiveAlignments: [{ objective: { id: 'objective', title: 'Retained effective alignment', level: 'company', ownerId: viewer.id } }],
      progressUpdates: [progress] };
    const task = { id: 'task', cycleId: 'cycle', employeeId: viewer.id, managerId: 'manager', deptId: null,
      lifecycleStatus, status: 'self_eval', isExempt: false, participantDisposition: 'active',
      indicatorConfirmedAt: at, goalApprovedAt: at, closedAt: null, publishedAt: null,
      employee: { id: viewer.id, name: viewer.name }, manager: { id: 'manager', name: 'Fictional manager', avatarUrl: null },
      cycle: { id: 'cycle', name: 'Fictional cycle', workflowVersion: 2, goalWorkflowVersion: 2,
        monthlyFollowUpRequired: true, openedAt: new Date('2026-11-01'), closedAt: null, publishedAt: null },
      periods: [period], indicatorInstances: [indicator] };
    const prisma: any = {
      assessmentCycle: { findMany: jest.fn().mockResolvedValue([{ id: task.cycleId }]) },
      assessmentTask: { findUnique: jest.fn().mockResolvedValue(task), findMany: jest.fn().mockResolvedValue([task]) },
      indicatorInstance: {
        findUnique: jest.fn().mockResolvedValue({ task: { employeeId: viewer.id, cycleId: task.cycleId } }),
        findFirst: jest.fn().mockResolvedValue({ ...indicator, task }),
        findMany: jest.fn().mockResolvedValue([{ id: 'parent', name: 'Active parent',
          task: { employee: { id: 'manager', name: 'Fictional manager' } } }]),
        count: jest.fn().mockResolvedValue(1),
      },
      auditLog: { findMany: jest.fn().mockResolvedValue([]) },
    };
    return { service: new ObjectivesService(prisma, {} as any), prisma, task };
  }
  beforeEach(() => { jest.useFakeTimers().setSystemTime(at); });
  afterEach(() => { jest.useRealTimers(); });

  it.each(['terminated', 'deleted'])('does not offer alignment selection on a %s task', async (status) => {
    const { service, prisma, task } = setup(status);
    expect(await service.findIndicatorAlignmentCandidates(task.id, viewer)).toMatchObject({
      items: [], owners: [], reason: expect.stringMatching(/终止|历史/),
    });
    expect(prisma.indicatorInstance.findMany).not.toHaveBeenCalled();
    await expect(service.assertIndicatorAlignmentCandidateIds(task, [], viewer)).rejects.toBeInstanceOf(ConflictException);
  });
  it('checks original alignment scope before disclosing the lifecycle reason', async () => {
    const { service, prisma, task } = setup('deleted');
    await expect(service.findIndicatorAlignmentCandidates(task.id, { ...viewer, id: 'stranger' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.indicatorInstance.findMany).not.toHaveBeenCalled();
  });
  it('uses active parent-task scope for both candidate listing and submitted-id validation', async () => {
    const { service, prisma, task } = setup();
    expect((await service.findIndicatorAlignmentCandidates(task.id, viewer)).items.map((item) => item.id)).toEqual(['parent']);
    await service.assertIndicatorAlignmentCandidateIds(task, ['parent'], viewer);
    for (const args of [prisma.indicatorInstance.findMany.mock.calls[0][0],
      prisma.indicatorInstance.count.mock.calls[0][0].where.AND[0]]) {
      const where = args.where ?? args;
      expect(where).toMatchObject({ retiredAt: null, AND: expect.arrayContaining([
        { task: { cycleId: task.cycleId, employeeId: task.managerId, lifecycleStatus: 'active' } },
        { OR: expect.any(Array) },
      ]) });
    }
    expect(prisma.assessmentTask.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ lifecycleStatus: true }),
    }));
  });
  it.each(['terminated', 'deleted'])('keeps %s goal history readable without editable progress periods', async (status) => {
    const { service } = setup(status);
    const detail = await service.findTrackingIndicator('goal', viewer);
    expect(detail).toMatchObject({ lifecycleStatus: status, canEdit: false,
      readOnlyReason: expect.stringMatching(/终止|历史/),
      progressPeriods: [{ id: 'period', canEdit: false, reason: expect.stringMatching(/终止|历史/) }],
      alignedObjectives: [{ id: 'objective', title: 'Retained effective alignment' }],
      progressUpdates: [{ id: 'progress', progress: 42, content: 'Previously recorded progress' }],
    });
    expect(await service.findTracking({ cycleId: 'cycle', ownerId: viewer.id }, viewer)).toMatchObject({
      lifecycleStatus: status, canEdit: false, readOnlyReason: expect.stringMatching(/终止|历史/),
      items: [{ id: 'goal', progress: 42 }],
    });
  });
  it.each(['terminated', 'deleted'])('does not expose %s goals as bot update candidates', async (status) => {
    const { service, prisma } = setup(status);
    expect(await service.findBotGoalAccess(viewer)).toMatchObject({ kind: 'month_locked', message: expect.stringMatching(/终止|历史/) });
    expect(prisma.assessmentTask.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ lifecycleStatus: true }),
    }));
  });
  it('preserves active progress eligibility and bot candidates', async () => {
    const { service } = setup();
    expect(await service.findTrackingIndicator('goal', viewer)).toMatchObject({ canEdit: true, readOnlyReason: null,
      progressPeriods: [{ id: 'period', canEdit: true, reason: null }] });
    expect(await service.findBotGoalAccess(viewer)).toMatchObject({ kind: 'ready', goals: [{ id: 'goal', periodId: 'period' }] });
  });
});
