import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FinalGradeService } from './final-grade.service';
import { AuthUser } from '@/common/types/auth.types';
import { validate } from 'class-validator';
import { SubmitFinalGradeDto } from './dto/submit-final-grade.dto';
import { FlowService } from '@/tasks/flow.service';

describe('FinalGradeService department review access', () => {
  const task = {
    id: 'task-1', cycleId: 'cycle-1', employeeId: 'employee-1', managerId: 'manager-1', deptHeadId: 'head-1', status: 'manager_scoring',
    cycle: { name: '虚拟周期' }, employee: { name: '虚拟员工', position: null }, dept: { name: '人事组' }, manager: { name: '虚拟上级' }, deptHead: { name: '虚拟复核人' },
    gradeResult: { calculatedScore: new Prisma.Decimal(92.4), rawGrade: 'B' },
    periods: [{ periodKey: '2026-09', periodType: 'month', status: 'completed', selfGrade: 'A', managerGrade: 'A', selfScoreTotal: new Prisma.Decimal(92.4), managerScoreTotal: new Prisma.Decimal(92.4), employeeSubmittedAt: new Date(), managerSubmittedAt: new Date(), lockedAt: new Date() }],
  };
  const viewer = (id: string) => ({ id, sysRole: 'employee', canViewAll: false } as AuthUser);
  const makeService = (overrides = {}) => new FinalGradeService({ assessmentTask: { findUnique: jest.fn().mockResolvedValue({ ...task, ...overrides }) }, flowRecord: { findFirst: jest.fn().mockResolvedValue(null) } } as any, {} as any, {} as any);

  it('lets the frozen department reviewer read monthly basis without final-grade write capability', async () => {
    const detail = await makeService().getFinalGrade(task.id, viewer('head-1'));
    expect(detail.calculatedScore).toBe(92.4);
    expect(detail.periods[0].managerGrade).toBe('A');
    expect(detail.resultEvidence?.periods[0]).toMatchObject({ periodKey: '2026-09', selfScoreTotal: 92.4, managerScoreTotal: 92.4, managerGrade: 'A' });
    expect(detail.canSubmit).toBe(false);
  });
  it('returns the task approval time so detail views can distinguish approved results waiting for publication', async () => {
    const approvedAt = new Date('2026-09-08T12:00:00.000Z');
    const detail = await makeService({ status: 'approval', approvedAt }).getFinalGrade(task.id, viewer('head-1'));
    expect(detail.approvedAt).toEqual(approvedAt);
  });
  it.each([
    { managerId: 'manager-1', deptHeadId: 'manager-1', deptHead: { name: '虚拟上级' }, expected: { combined: true, reviewerName: '虚拟上级' } },
    { managerId: 'manager-1', deptHeadId: 'head-1', deptHead: { name: '虚拟复核人' }, expected: { combined: false, reviewerName: '虚拟复核人' } },
    { managerId: 'manager-1', deptHeadId: null, deptHead: null, expected: { combined: false, reviewerName: null } },
    { managerId: null, deptHeadId: null, deptHead: null, expected: { combined: false, reviewerName: null } },
  ])('describes department review from frozen relationships: $managerId / $deptHeadId', async ({ expected, ...relations }) => {
    const detail = await makeService(relations).getFinalGrade(task.id, { ...viewer('admin-1'), sysRole: 'system_admin' });
    expect(detail).toMatchObject({ departmentReview: expected });
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

  it('does not let system-admin or self-manager identity reveal or grade the employee own cycle result', async () => {
    for (const sysRole of ['employee', 'system_admin'] as const) {
      const service = makeService({ managerId: task.employeeId, deptHeadId: task.employeeId });
      const employee = { ...viewer(task.employeeId), sysRole };
      await expect(service.getFinalGrade(task.id, employee)).rejects.toThrow(ForbiddenException);
      await expect(service.submitFinalGrade(task.id, { grade: 'A' }, employee)).rejects.toThrow(ForbiddenException);
    }
  });

  it('saves the cycle comment with the grade and reads it back after submission or return', async () => {
    let submittedRecord: any = null;
    const prisma: any = {
      assessmentTask: { findUnique: jest.fn().mockResolvedValue({ ...task, updatedAt: new Date() }), updateMany: jest.fn().mockResolvedValue({count:1}) },
      gradeResult: { upsert: jest.fn() },
      flowRecord: { findFirst: jest.fn().mockImplementation(async ({where}) => where.action === 'submit' ? submittedRecord : null) },
      $transaction: (work: any) => work(prisma),
    };
    const flow = { transitionTx: jest.fn().mockImplementation(async (_tx, input) => { submittedRecord = {extraData: input.extraData}; }) };
    const service = new FinalGradeService(prisma, flow as any, {create: jest.fn()} as any);
    await service.submitFinalGrade(task.id, {grade:'B', comment:'  持续推进交付。\n下周期加强风险预警。  '} as any, viewer('manager-1'));
    expect(await service.getFinalGrade(task.id, viewer('manager-1'))).toMatchObject({comment:'持续推进交付。\n下周期加强风险预警。'});
    await service.submitFinalGrade(task.id, {grade:'A', comment:''} as any, viewer('manager-1'));
    expect(await service.getFinalGrade(task.id, viewer('head-1'))).toMatchObject({comment:null});
  });

  it.each([42, '字'.repeat(2001)])('rejects invalid cycle comments instead of saving them', async (comment) => {
    const errors = await validate(Object.assign(new SubmitFinalGradeDto(), {grade:'B', comment}));
    expect(errors.some(error => error.property === 'comment')).toBe(true);
  });
});

describe('FinalGradeService combined department review', () => {
  const viewer = (id = 'manager-1', sysRole: AuthUser['sysRole'] = 'employee') => ({ id, sysRole, canViewAll: false } as AuthUser);

  function setup(options: { managerId?: string | null; deptHeadId?: string | null; stale?: boolean; failReview?: boolean; incomplete?: boolean } = {}) {
    const updatedAt = new Date('2026-09-08T00:00:00.000Z');
    const periods = [80, 85, 88].map((score, index) => ({
      periodKey: `2026-0${index + 7}`, periodType: 'month', status: 'completed',
      selfGrade: 'A', managerGrade: 'B', selfScoreTotal: new Prisma.Decimal(90), managerScoreTotal: new Prisma.Decimal(score),
      employeeSubmittedAt: updatedAt, managerSubmittedAt: updatedAt, lockedAt: options.incomplete && index === 2 ? null : updatedAt,
    }));
    let state: any = {
      task: {
        id: 'task-1', cycleId: 'cycle-1', employeeId: 'employee-1', managerId: options.managerId === undefined ? 'manager-1' : options.managerId,
        deptHeadId: options.deptHeadId === undefined ? 'manager-1' : options.deptHeadId, approverId: 'approver-1',
        status: 'manager_scoring', updatedAt, managerScoredAt: null, deptReviewedAt: null,
        employee: { name: '虚拟员工' }, cycle: { name: '虚拟周期' }, periods,
      },
      grade: null,
      records: [],
    };
    const prisma: any = {
      assessmentTask: { findUnique: jest.fn(async () => ({ ...state.task })) },
      assessmentCycle: { findUnique: jest.fn(async () => ({ hrOwnerId: 'hr-1' })) },
      $transaction: async (work: any) => {
        const draft = { task: { ...state.task }, grade: state.grade && { ...state.grade }, records: [...state.records] };
        const tx: any = {
          assessmentTask: {
            updateMany: async ({ where, data }) => {
              if (options.stale || where.id !== draft.task.id || where.status !== draft.task.status || where.updatedAt.getTime() !== draft.task.updatedAt.getTime()) return { count: 0 };
              Object.assign(draft.task, data);
              return { count: 1 };
            },
            update: async ({ data }) => Object.assign(draft.task, data),
            groupBy: async () => [{ status: draft.task.status, _count: { _all: 1 } }],
          },
          gradeResult: { upsert: async ({ create, update }) => { draft.grade = draft.grade ? { ...draft.grade, ...update } : create; } },
          flowRecord: { create: async ({ data }) => {
            if (options.failReview && data.nodeType === 'dept_review') throw new Error('review record unavailable');
            draft.records.push(data);
          } },
          assessmentCycle: { updateMany: async () => ({ count: 1 }) },
          $queryRaw: async () => [{ status: 'manager_score' }],
        };
        const result = await work(tx);
        state = draft;
        return result;
      },
    };
    const notifications: any[] = [];
    const service = new FinalGradeService(prisma, new FlowService(prisma), { create: async (notification) => { notifications.push(notification); } } as any);
    return { service, state: () => state, notifications, periodsSnapshot: JSON.stringify(periods), updatedAt };
  }

  it.each([viewer(), viewer('admin-1', 'system_admin')])('persists both real flow records attributed to the actual submitter $id', async (actor) => {
    const fixture = setup();
    const result = await fixture.service.submitFinalGrade('task-1', { grade: 'C', comment: '  下周期加强交付。  ' }, actor);
    expect(result).toEqual({ id: 'task-1', status: 'hr_calibration', grade: 'C' });
    const saved = fixture.state();
    expect(saved.records).toHaveLength(2);
    expect(saved.records[0]).toMatchObject({ nodeType: 'manager_score', action: 'submit', actorId: actor.id, extraData: { type: 'final_grade_submitted', grade: 'C', calculatedScore: 84.33, comment: '下周期加强交付。' } });
    expect(saved.records[1]).toMatchObject({ nodeType: 'dept_review', action: 'approve', actorId: actor.id, extraData: { type: 'combined_department_review', managerId: 'manager-1', deptHeadId: 'manager-1' } });
    expect(saved.records[1].comment).toContain('合并');
    expect(saved.task.status).toBe('hr_calibration');
    expect(saved.task.managerScoredAt).toBeInstanceOf(Date);
    expect(saved.task.deptReviewedAt).toBeInstanceOf(Date);
    expect(saved.task.updatedAt.getTime()).toBeGreaterThan(fixture.updatedAt.getTime());
    expect(saved.grade).toMatchObject({ calculatedScore: 84.33, rawGrade: 'C' });
    expect(JSON.stringify(saved.task.periods)).toBe(fixture.periodsSnapshot);
    expect(saved.task.periods.map(period => period.managerScoreTotal.toNumber())).toEqual([80, 85, 88]);
    expect(saved.task.periods.map(period => period.managerGrade)).toEqual(['B', 'B', 'B']);
  });

  it.each([
    { managerId: 'manager-1', deptHeadId: 'head-1' },
    { managerId: 'manager-1', deptHeadId: null },
    { managerId: null, deptHeadId: null },
  ])('keeps separate or missing frozen reviewers at department review: $managerId / $deptHeadId', async (relations) => {
    const fixture = setup(relations);
    expect(await fixture.service.submitFinalGrade('task-1', { grade: 'B' }, viewer('admin-1', 'system_admin'))).toMatchObject({ status: 'dept_review' });
    expect(fixture.state().records).toHaveLength(1);
    expect(fixture.state().records[0]).toMatchObject({ nodeType: 'manager_score', action: 'submit' });
    expect(fixture.state().task.deptReviewedAt).toBeNull();
  });

  it('rejects incomplete months before persisting a grade or either flow record', async () => {
    const fixture = setup({ incomplete: true });
    await expect(fixture.service.submitFinalGrade('task-1', { grade: 'B' }, viewer())).rejects.toThrow(BadRequestException);
    expect(fixture.state()).toMatchObject({ grade: null, records: [], task: { status: 'manager_scoring' } });
  });

  it('does not send a calibration notice for a legacy task still awaiting a department reviewer', async () => {
    const fixture = setup({ deptHeadId: null });
    await fixture.service.submitFinalGrade('task-1', { grade: 'B' }, viewer());
    expect(fixture.state().task.status).toBe('dept_review');
    expect(fixture.notifications).toEqual([]);
  });

  it('rejects a stale task before persisting a grade or either flow record', async () => {
    const fixture = setup({ stale: true });
    await expect(fixture.service.submitFinalGrade('task-1', { grade: 'B' }, viewer())).rejects.toThrow(ConflictException);
    expect(fixture.state()).toMatchObject({ grade: null, records: [], task: { status: 'manager_scoring', updatedAt: fixture.updatedAt } });
  });

  it('rolls the grade and manager submission back when the combined review record fails', async () => {
    const fixture = setup({ failReview: true });
    await expect(fixture.service.submitFinalGrade('task-1', { grade: 'B' }, viewer())).rejects.toThrow('review record unavailable');
    expect(fixture.state()).toMatchObject({ grade: null, records: [], task: { status: 'manager_scoring', updatedAt: fixture.updatedAt, managerScoredAt: null, deptReviewedAt: null } });
  });

  it('rejects repeat submission without appending duplicate records', async () => {
    const fixture = setup();
    await fixture.service.submitFinalGrade('task-1', { grade: 'B' }, viewer());
    await expect(fixture.service.submitFinalGrade('task-1', { grade: 'A' }, viewer())).rejects.toThrow(BadRequestException);
    expect(fixture.state().records).toHaveLength(2);
    expect(fixture.state().grade.rawGrade).toBe('B');
  });
});
