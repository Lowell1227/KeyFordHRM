import 'reflect-metadata';
import { ConflictException, ForbiddenException, ValidationPipe } from '@nestjs/common';
import { SysRole } from '@prisma/client';
import { ObjectivesService } from './objectives.service';
import { UpdateIndicatorProgressDto } from './dto/update-indicator-progress.dto';
import { currentGoalProgress, progressBusinessPeriodKey, progressSource } from './goal-tracking-progress';

const julyId = '71111111-1111-4111-8111-111111111111';
const septemberId = '91111111-1111-4111-8111-111111111111';
const now = new Date('2026-09-08T08:00:00Z');
const viewer = { id: 'employee-1', name: '虚拟员工', sysRole: SysRole.employee, deptId: null, isAssessorOnly: false, canViewAll: false };
const input = { periodId: julyId, progress: 25, healthStatus: 'on_track' as const, content: '补录七月交付', expectedLatestUpdateAt: null };

function period(id = julyId, periodKey = '2026-07') {
  return { id, taskId: 'task-1', periodKey, periodType: 'month', periodStart: new Date(`${periodKey}-01`),
    periodEnd: new Date(`${periodKey}-28`), status: 'self_eval', employeeSubmittedAt: null as Date | null,
    managerSubmittedAt: null as Date | null, lockedAt: null as Date | null,
    indicatorVersion: { items: [{ sourceInstanceId: 'indicator-1' }] } };
}

describe('employee progress business period selection', () => {
  let db: any;
  let service: ObjectivesService;
  let task: any;
  let storedPeriod: any;
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
    storedPeriod = period();
    task = { id: 'task-1', employeeId: viewer.id, status: 'goal_confirmed', isExempt: false,
      participantDisposition: 'active', indicatorConfirmedAt: new Date('2026-07-01'), closedAt: null, publishedAt: null,
      periods: [period(), period(septemberId, '2026-09')],
      cycle: { workflowVersion: 2, openedAt: new Date('2026-07-01'), publishedAt: null, closedAt: null } };
    db = {
      indicatorInstance: { findUnique: jest.fn(async () => ({ id: 'indicator-1', taskId: 'task-1', task })) },
      assessmentPeriod: { findUnique: jest.fn(async () => storedPeriod) },
      indicatorProgressUpdate: {
        findMany: jest.fn(async () => []),
        create: jest.fn(async ({ data }: any) => ({ ...data, id: 'created', createdAt: now,
          period: data.periodId ? { periodKey: storedPeriod.periodKey } : null,
          creator: { id: viewer.id, name: viewer.name } })),
      },
      auditLog: { create: jest.fn() },
      $queryRaw: jest.fn(async () => [{ id: julyId }]),
      $transaction: jest.fn(async (fn: any) => fn(db)),
    };
    service = new ObjectivesService(db, {} as any);
  });
  afterEach(() => jest.useRealTimers());

  it('accepts a UUID business period in the HTTP contract and rejects malformed values', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true });
    const meta = { type: 'body' as const, metatype: UpdateIndicatorProgressDto };
    expect(await pipe.transform(input, meta)).toMatchObject({ periodId: julyId });
    await expect(pipe.transform({ ...input, periodId: 'not-a-period' }, meta)).rejects.toThrow();
  });

  it('stores July ownership with the real September creation time and audited attribution', async () => {
    const result = await service.updateIndicatorProgress('indicator-1', input, viewer);
    expect(result).toMatchObject({ businessPeriodKey: '2026-07', updatedAt: now, source: 'active_progress' });
    const data = db.indicatorProgressUpdate.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ periodId: julyId, progress: 25 });
    expect(data).not.toHaveProperty('createdAt');
    expect(db.auditLog.create.mock.calls[0][0].data.newValue).toMatchObject({ periodId: julyId, businessPeriodKey: '2026-07' });
  });

  it('permits an unsubmitted old month even when the current month was already submitted', async () => {
    task.periods[1].employeeSubmittedAt = now;
    task.periods[1].status = 'manager_scoring';
    await expect(service.updateIndicatorProgress('indicator-1', input, viewer)).resolves.toMatchObject({ businessPeriodKey: '2026-07' });
  });

  it.each(['foreign-task', 'future', 'submitted', 'completed', 'locked', 'missing-indicator'])('rejects %s attribution without appending progress', async kind => {
    if (kind === 'foreign-task') storedPeriod.taskId = 'another-task';
    if (kind === 'future') { storedPeriod.periodKey = '2026-10'; storedPeriod.periodStart = new Date('2026-10-01'); }
    if (kind === 'submitted') storedPeriod.employeeSubmittedAt = now;
    if (kind === 'completed') storedPeriod.status = 'completed';
    if (kind === 'locked') storedPeriod.lockedAt = now;
    if (kind === 'missing-indicator') storedPeriod.indicatorVersion.items = [];
    await expect(service.updateIndicatorProgress('indicator-1', input, viewer)).rejects.toBeInstanceOf(ConflictException);
    expect(db.indicatorProgressUpdate.create).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects a selected period that belongs to another plan', async () => {
    const otherPeriodInput = { ...input, periodId: '81111111-1111-4111-8111-111111111111' };
    await expect(service.updateIndicatorProgress('indicator-1', otherPeriodInput, viewer)).rejects.toBeInstanceOf(ConflictException);
    expect(db.indicatorProgressUpdate.create).not.toHaveBeenCalled();
  });

  it('scopes the concurrent-update comparison to July rather than the newer September record', async () => {
    const julyTime = new Date('2026-09-07T08:00:00Z');
    db.indicatorProgressUpdate.findMany.mockResolvedValue([
      { id: 'sep', createdAt: now, period: { periodKey: '2026-09' }, periodReviewRevisionId: null },
      { id: 'jul', createdAt: julyTime, period: { periodKey: '2026-07' }, periodReviewRevisionId: null },
    ]);
    await expect(service.updateIndicatorProgress('indicator-1', { ...input, expectedLatestUpdateAt: julyTime.toISOString() }, viewer)).resolves.toMatchObject({ businessPeriodKey: '2026-07' });
  });

  it('keeps the owner-only write boundary for historical records', async () => {
    await expect(service.updateIndicatorProgress('indicator-1', input, { ...viewer, id: 'manager-1' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.indicatorProgressUpdate.create).not.toHaveBeenCalled();
  });

  it('preserves ordinary progress during a whole-cycle period', async () => {
    task.periods = [{ ...period(), id: 'cycle-period', periodType: 'cycle', periodKey: 'cycle',
      periodStart: new Date('2026-07-01'), periodEnd: new Date('2026-09-30') }];
    const { periodId, ...dailyInput } = input;
    await expect(service.updateIndicatorProgress('indicator-1', dailyInput, viewer)).resolves.toMatchObject({ businessPeriodKey: '2026-09' });
    expect(db.indicatorProgressUpdate.create.mock.calls[0][0].data).not.toHaveProperty('periodId');
  });

  it('does not let late July progress replace the current September progress', () => {
    const records = [
      { id: 'backfilled-july', createdAt: now, period: { periodKey: '2026-07' }, periodReviewRevisionId: null },
      { id: 'september', createdAt: new Date('2026-09-01'), period: null, periodReviewRevisionId: null },
    ];
    expect(progressBusinessPeriodKey(records[0])).toBe('2026-07');
    expect(progressSource(records[0])).toBe('active_progress');
    expect(currentGoalProgress(records)?.id).toBe('september');
  });
});
