import { AppealStatus, CycleType, ParticipantDisposition, PerfGrade, TaskStatus, UserStatus } from '@prisma/client';
import type { PrismaService } from '@/prisma/prisma.service';
import { readPayrollPerformance } from './payroll-performance-source';

const input = { employeeId: 'fictional-employee', cycleId: 'registered-cycle', registeredCycleIds: ['registered-cycle'] };
const publishedAt = new Date('2026-11-20T08:00:00.000Z');

function publishedTask() {
  return {
    id: 'fictional-task', employeeId: input.employeeId, cycleId: input.cycleId,
    status: TaskStatus.published as TaskStatus, isExempt: false, participantDisposition: ParticipantDisposition.active as ParticipantDisposition,
    publishedAt: new Date(publishedAt) as Date | null,
    cycle: { type: CycleType.quarterly as CycleType, status: 'approval', publishedAt: null as Date | null, name: 'Demo test cycle' },
    employee: { status: UserStatus.active as UserStatus, archivedAt: null as Date | null, deletedAt: null as Date | null },
    gradeResult: {
      id: 'fictional-grade', calibratedGrade: PerfGrade.A as PerfGrade | null, rawGrade: PerfGrade.B as PerfGrade | null,
      isPublished: true, publishedAt: new Date(publishedAt) as Date | null, updatedAt: new Date(publishedAt),
      hrCalibratedAt: new Date('2026-11-18T08:00:00.000Z') as Date | null,
      approvedAt: new Date('2026-11-19T08:00:00.000Z') as Date | null,
      employeeConfirmedAt: null as Date | null,
    },
    appeals: [] as Array<{ id: string; status: AppealStatus; finalResult: 'maintained' | 'modified' | null; updatedAt: Date }>,
  };
}

function fixture(task: unknown = publishedTask()) {
  const findUnique = jest.fn().mockResolvedValue(task);
  // Unexpected database operations fail, including writes and reads outside this source boundary.
  const assessmentTask = new Proxy({ findUnique }, { get(target, key) {
    if (key === 'findUnique') return target.findUnique;
    throw new Error(`Unexpected assessmentTask operation: ${String(key)}`);
  } });
  const prisma = new Proxy({ assessmentTask }, { get(target, key) {
    if (key === 'assessmentTask') return target.assessmentTask;
    throw new Error(`Unexpected Prisma operation: ${String(key)}`);
  } }) as unknown as Pick<PrismaService, 'assessmentTask'>;
  return { prisma, findUnique };
}

describe('readPayrollPerformance', () => {
  it('requires a formal monthly cycle for an explicit payroll month, not quarterly process scores', async () => {
    expect(await readPayrollPerformance(fixture().prisma, { ...input, requiredMonth: '2026-11' })).toEqual({ status: 'unsupported_cycle' });
  });
  it('checks both cycle boundaries against the attribution month and fingerprints the period', async () => {
    const task = { ...publishedTask(), cycle: { ...publishedTask().cycle, type: CycleType.monthly,
      startDate: new Date('2026-11-01'), endDate: new Date('2026-11-30') } };
    const strict = { ...input, requiredMonth: '2026-11' };
    const first = await readPayrollPerformance(fixture(task).prisma, strict);
    expect(first).toMatchObject({ status: 'ready', snapshot: { attributionMonth: '2026-11' } });
    task.cycle.startDate = new Date('2026-11-02');
    const second = await readPayrollPerformance(fixture(task).prisma, strict);
    expect(second.status).toBe('ready');
    if (first.status === 'ready' && second.status === 'ready') expect(second.snapshot.version).not.toBe(first.snapshot.version);
    task.cycle.endDate = new Date('2026-12-01');
    expect(await readPayrollPerformance(fixture(task).prisma, strict)).toEqual({ status: 'wrong_period' });
    task.cycle.startDate = new Date('2026-10-01'); task.cycle.endDate = new Date('2026-10-31');
    expect(await readPayrollPerformance(fixture(task).prisma, strict)).toEqual({ status: 'wrong_period' });
  });
  it('does not infer missing or malformed monthly period evidence', async () => {
    const task = publishedTask(); task.cycle.type = CycleType.monthly;
    const { prisma, findUnique } = fixture(task);
    expect(await readPayrollPerformance(prisma, { ...input, requiredMonth: '2026-13' })).toEqual({ status: 'wrong_period' });
    expect(findUnique).not.toHaveBeenCalled();
    expect(await readPayrollPerformance(prisma, { ...input, requiredMonth: '2026-11' })).toEqual({ status: 'wrong_period' });
  });
  it('reads an individually published result before the rest of the cycle is published', async () => {
    const { prisma } = fixture();
    const result = await readPayrollPerformance(prisma, input);
    expect(result).toEqual({ status: 'ready', snapshot: {
      employeeId: 'fictional-employee', taskId: 'fictional-task', cycleId: 'registered-cycle',
      grade: 'A', publishedAt: '2026-11-20T08:00:00.000Z', version: expect.stringMatching(/^[a-f0-9]{64}$/),
    } });
  });

  it('requires explicit registration and does not query unregistered cycles', async () => {
    const { prisma, findUnique } = fixture();
    expect(await readPayrollPerformance(prisma, { ...input, registeredCycleIds: [] })).toEqual({ status: 'unregistered' });
    expect(await readPayrollPerformance(prisma, { ...input, registeredCycleIds: ['other-cycle'] })).toEqual({ status: 'unregistered' });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('does not infer registration or exclude a registered cycle by its display name', async () => {
    const task = publishedTask();
    task.cycle.name = '演示 测试 试用 Demo test';
    expect(await readPayrollPerformance(fixture(task).prisma, input)).toMatchObject({ status: 'ready' });
  });

  it('returns not_found for a registered employee/cycle without a task', async () => {
    expect(await readPayrollPerformance(fixture(null).prisma, input)).toEqual({ status: 'not_found' });
  });

  it('does not pay an unpublished individual merely because the cycle was published', async () => {
    const task = publishedTask();
    task.cycle.status = 'published'; task.cycle.publishedAt = publishedAt;
    task.status = TaskStatus.confirmed; task.publishedAt = null;
    task.gradeResult.isPublished = false; task.gradeResult.publishedAt = null;
    expect(await readPayrollPerformance(fixture(task).prisma, input)).toEqual({ status: 'pending_publication' });
  });

  it.each([TaskStatus.confirmed, TaskStatus.closed])('accepts consistent legacy %s individual publication facts', async status => {
    const task = publishedTask(); task.status = status;
    expect(await readPayrollPerformance(fixture(task).prisma, input)).toMatchObject({ status: 'ready' });
  });

  it.each([
    ['flag false with both timestamps', (t: ReturnType<typeof publishedTask>) => { t.gradeResult.isPublished = false; }],
    ['missing task timestamp', (t: ReturnType<typeof publishedTask>) => { t.publishedAt = null; }],
    ['missing grade timestamp', (t: ReturnType<typeof publishedTask>) => { t.gradeResult.publishedAt = null; }],
    ['mismatched publication timestamps', (t: ReturnType<typeof publishedTask>) => { t.gradeResult.publishedAt = new Date('2026-11-19'); }],
    ['approval status retaining published evidence', (t: ReturnType<typeof publishedTask>) => { t.status = TaskStatus.approval; }],
    ['regrading status retaining published evidence', (t: ReturnType<typeof publishedTask>) => { t.status = TaskStatus.manager_scoring; }],
    ['status alone', (t: ReturnType<typeof publishedTask>) => { t.publishedAt = null; t.gradeResult.publishedAt = null; t.gradeResult.isPublished = false; }],
    ['flag alone', (t: ReturnType<typeof publishedTask>) => { t.status = TaskStatus.confirmed; t.publishedAt = null; t.gradeResult.publishedAt = null; }],
    ['missing final grade', (t: ReturnType<typeof publishedTask>) => { t.gradeResult.calibratedGrade = null; t.gradeResult.rawGrade = null; }],
  ])('blocks contradictory facts: %s', async (_name, change) => {
    const task = publishedTask(); change(task);
    expect(await readPayrollPerformance(fixture(task).prisma, input)).toEqual({ status: 'fact_conflict' });
  });

  it('blocks a published task without a GradeResult', async () => {
    const task = { ...publishedTask(), gradeResult: null };
    expect(await readPayrollPerformance(fixture(task).prisma, input)).toEqual({ status: 'fact_conflict' });
  });

  it.each([AppealStatus.pending, AppealStatus.dept_processing, AppealStatus.hr_processing])('blocks an unresolved %s appeal even on a published task', async status => {
    const task = publishedTask();
    task.appeals = [{ id: 'appeal-1', status, finalResult: null, updatedAt: publishedAt }];
    expect(await readPayrollPerformance(fixture(task).prisma, input)).toEqual({ status: 'in_review' });
  });

  it('blocks appealing status even if no appeal row is present', async () => {
    const task = publishedTask(); task.status = TaskStatus.appealing;
    expect(await readPayrollPerformance(fixture(task).prisma, input)).toEqual({ status: 'in_review' });
  });

  it.each([TaskStatus.manager_scoring, TaskStatus.dept_review, TaskStatus.hr_calibration, TaskStatus.approval])('blocks a %s review without publication facts', async status => {
    const task = publishedTask(); task.status = status; task.publishedAt = null;
    task.gradeResult.isPublished = false; task.gradeResult.publishedAt = null;
    expect(await readPayrollPerformance(fixture(task).prisma, input)).toEqual({ status: 'in_review' });
  });

  it.each([
    ['probation cycle', (t: ReturnType<typeof publishedTask>) => { t.cycle.type = CycleType.probation; }],
    ['explicit exemption', (t: ReturnType<typeof publishedTask>) => { t.isExempt = true; }],
    ['exempted status', (t: ReturnType<typeof publishedTask>) => { t.status = TaskStatus.exempted; }],
    ['cycle exemption disposition', (t: ReturnType<typeof publishedTask>) => { t.participantDisposition = ParticipantDisposition.cycle_exempt; }],
    ['leader exemption disposition', (t: ReturnType<typeof publishedTask>) => { t.participantDisposition = ParticipantDisposition.top_leader_exempt; }],
  ])('returns not_applicable for %s', async (_name, change) => {
    const task = publishedTask(); change(task);
    expect(await readPayrollPerformance(fixture(task).prisma, input)).toEqual({ status: 'not_applicable' });
  });

  it.each([
    ['resigned employee', (t: ReturnType<typeof publishedTask>) => { t.employee.status = UserStatus.resigned; }],
    ['archived resigned employee', (t: ReturnType<typeof publishedTask>) => { t.employee.status = UserStatus.resigned; t.employee.archivedAt = new Date('2026-11-21'); }],
    ['soft-deleted employee', (t: ReturnType<typeof publishedTask>) => { t.employee.deletedAt = new Date('2026-11-21'); }],
  ])('keeps the historical published source ready after later %s lifecycle changes', async (_name, change) => {
    const task = publishedTask(); const before = await readPayrollPerformance(fixture(task).prisma, input);
    change(task);
    const after = await readPayrollPerformance(fixture(task).prisma, input);
    expect(before.status).toBe('ready'); expect(after).toEqual(before);
    expect(after).not.toHaveProperty('salary');
    expect(await readPayrollPerformance(fixture(task).prisma, { ...input, registeredCycleIds: [] })).toEqual({ status: 'unregistered' });
  });

  it('uses the officially accepted rawGrade fallback, never a coefficient default', async () => {
    const task = publishedTask(); task.gradeResult.calibratedGrade = null;
    const result = await readPayrollPerformance(fixture(task).prisma, input);
    expect(result).toMatchObject({ status: 'ready', snapshot: { grade: 'B' } });
    expect(result).not.toHaveProperty('coefficient');
    if (result.status === 'ready') expect(result.snapshot).not.toHaveProperty('coefficient');
  });

  it('queries only this unique employee/cycle and necessary source fields, without writes', async () => {
    const task = publishedTask(); const before = JSON.stringify(task);
    const { prisma, findUnique } = fixture(task);
    await readPayrollPerformance(prisma, input);
    expect(findUnique).toHaveBeenCalledTimes(1);
    const [query] = findUnique.mock.calls[0];
    expect(query.where).toEqual({ cycleId_employeeId: { employeeId: 'fictional-employee', cycleId: 'registered-cycle' } });
    expect(query.include).toBeUndefined();
    expect(Object.keys(query.select).sort()).toEqual([
      'appeals', 'cycle', 'cycleId', 'employeeId', 'gradeResult', 'id', 'isExempt', 'participantDisposition', 'publishedAt', 'status',
    ].sort());
    expect(query.select.cycle).toEqual({ select: { type: true, startDate: true, endDate: true } });
    expect(query.select).not.toHaveProperty('employee');
    expect(query.where).not.toHaveProperty('employee');
    expect(query.select.gradeResult.select).not.toHaveProperty('coefficient');
    expect(query.select.appeals).not.toHaveProperty('where');
    expect(JSON.stringify(task)).toBe(before);
  });

  it('returns a detached immutable JSON snapshot', async () => {
    const task = publishedTask(); const result = await readPayrollPerformance(fixture(task).prisma, input);
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('Expected a published source');
    expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.snapshot)).toBe(true);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(() => Object.assign(result.snapshot, { grade: 'D' })).toThrow(TypeError);
    task.gradeResult.calibratedGrade = PerfGrade.D; task.publishedAt!.setUTCFullYear(2025);
    expect(result.snapshot).toMatchObject({ grade: 'A', publishedAt: '2026-11-20T08:00:00.000Z' });
  });

  it.each([
    ['calibrated grade', (t: ReturnType<typeof publishedTask>) => { t.gradeResult.calibratedGrade = PerfGrade.C; }],
    ['raw grade evidence', (t: ReturnType<typeof publishedTask>) => { t.gradeResult.rawGrade = PerfGrade.D; }],
    ['publication time', (t: ReturnType<typeof publishedTask>) => { t.publishedAt = new Date('2026-11-21'); t.gradeResult.publishedAt = new Date(t.publishedAt); }],
    ['recalibration', (t: ReturnType<typeof publishedTask>) => { t.gradeResult.hrCalibratedAt = new Date('2026-11-21'); }],
    ['result reapproval', (t: ReturnType<typeof publishedTask>) => { t.gradeResult.approvedAt = new Date('2026-11-21'); }],
    ['resolved appeal', (t: ReturnType<typeof publishedTask>) => { t.appeals = [{ id: 'appeal-1', status: AppealStatus.resolved, finalResult: 'maintained', updatedAt: publishedAt }]; }],
  ])('changes the source version when %s changes', async (_name, change) => {
    const task = publishedTask(); const first = await readPayrollPerformance(fixture(task).prisma, input);
    change(task); const second = await readPayrollPerformance(fixture(task).prisma, input);
    expect(first.status).toBe('ready'); expect(second.status).toBe('ready');
    if (first.status !== 'ready' || second.status !== 'ready') throw new Error('Expected two published sources');
    expect(second.snapshot.version).not.toBe(first.snapshot.version);
  });

  it.each([TaskStatus.confirmed, TaskStatus.closed])('keeps the ready semantic fingerprint stable when only the label becomes %s', async status => {
    const task = publishedTask(); const before = await readPayrollPerformance(fixture(task).prisma, input);
    task.status = status;
    if (status === TaskStatus.confirmed) {
      task.gradeResult.employeeConfirmedAt = new Date('2026-11-21');
      task.gradeResult.updatedAt = new Date('2026-11-21');
    }
    const after = await readPayrollPerformance(fixture(task).prisma, input);
    expect(before.status).toBe('ready'); expect(after).toEqual(before);
  });

  it('invalidates the ready source during review and fingerprints a genuine same-grade reapproval', async () => {
    const task = publishedTask(); const before = await readPayrollPerformance(fixture(task).prisma, input);
    task.status = TaskStatus.appealing;
    expect(await readPayrollPerformance(fixture(task).prisma, input)).toEqual({ status: 'in_review' });
    task.status = TaskStatus.published;
    task.gradeResult.approvedAt = new Date('2026-11-21');
    const after = await readPayrollPerformance(fixture(task).prisma, input);
    expect(before.status).toBe('ready'); expect(after.status).toBe('ready');
    if (before.status !== 'ready' || after.status !== 'ready') throw new Error('Expected two published sources');
    expect(after.snapshot.grade).toBe(before.snapshot.grade);
    expect(after.snapshot.publishedAt).toBe(before.snapshot.publishedAt);
    expect(after.snapshot.version).not.toBe(before.snapshot.version);
  });

  it('uses stable appeal ordering and ignores other employees advancing the cycle', async () => {
    const task = publishedTask();
    task.appeals = ['appeal-2', 'appeal-1'].map(id => ({ id, status: AppealStatus.resolved, finalResult: 'maintained', updatedAt: publishedAt }));
    const first = await readPayrollPerformance(fixture(task).prisma, input);
    task.appeals.reverse(); task.cycle.status = 'published'; task.cycle.publishedAt = new Date('2026-11-21');
    const second = await readPayrollPerformance(fixture(task).prisma, input);
    expect(first.status).toBe('ready'); expect(second).toEqual(first);
  });

  it('propagates read failures instead of treating them as a payable result or missing task', async () => {
    const { prisma, findUnique } = fixture(); findUnique.mockRejectedValue(new Error('Source unavailable'));
    await expect(readPayrollPerformance(prisma, input)).rejects.toThrow('Source unavailable');
  });
});
