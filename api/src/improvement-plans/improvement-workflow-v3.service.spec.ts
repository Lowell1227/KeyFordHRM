import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { ImprovementWorkflowService } from './improvement-workflow.service';
import { ImprovementPlansController } from './improvement-plans.controller';
import { PaginationDto } from '@/common/dto/pagination.dto';

const viewer = (id: string, sysRole = 'employee', hrCapabilities: string[] = []) => ({
  id, name: id, sysRole, hrCapabilities, deptId: 'dept', isAssessorOnly: false, canViewAll: false,
}) as any;
const user = (id: string, extra = {}) => ({ id, name: id, employeeNo: id, deptId: 'dept',
  directManagerId: null, status: 'active', deletedAt: null, archivedAt: null,
  sysRole: 'employee', hrCapabilities: [], isAssessorOnly: false, ...extra });
const goals = [{ id: 'g1', name: 'Quality', description: 'Reduce rework', weight: 100 }];
const evaluation = { items: [{ goalId: 'g1', score: 80, comment: 'Improved' }], overallComment: 'Good' };
const specialist = viewer('specialist', 'hr_user', ['cycle_plan_edit', 'performance_publish']);

describe('Improvement workflow V3', () => {
  let service: ImprovementWorkflowService;
  let prisma: any;
  let state: any;
  let users: any[];
  let departments: any[];
  let records: any[];
  let notifications: any;

  beforeEach(() => {
    users = [user('emp', { directManagerId: 'manager' }), user('manager'), user('head'), user('vp'),
      user('hr', { sysRole: 'hr' }), user('specialist', { sysRole: 'hr_user',
        hrCapabilities: ['cycle_plan_edit', 'performance_publish'] })];
    departments = [{ id: 'dept', name: 'Department', parentId: null, leaderId: 'head', approverId: 'vp',
      leader: { name: 'Head', directManagerId: null, directManager: null }, approver: { name: 'VP' } }];
    state = { id: 'plan', employeeId: 'emp', creatorId: 'manager', cycleId: null, taskId: null,
      lifecycleStatus: 'active', lifecycleVersion: 0, employmentRecordId: null,
      workflowVersion: 3, revision: 0, status: 'draft', improvementNeed: 'Improve quality', goals,
      importance: null, improvementGoal: null, targetDate: null, measures: [], selfEvaluation: null,
      managerEvaluation: null, departmentEvaluation: null, finalScore: null, startedAt: null,
      completedAt: null, createdAt: new Date(), updatedAt: new Date() };
    const included = () => ({ ...state, employee: { ...users[0], dept: { name: 'Department' } },
      creator: { id: 'manager', name: 'Manager' }, cycle: null });
    records = [];
    prisma = {
      $queryRaw: jest.fn(async (query: TemplateStringsArray, id: unknown) => {
        const sql = query.join('');
        if (sql.includes('FROM users')) return users.some((item) => item.id === id) ? [{ id }] : [];
        if (sql.includes('FROM improvement_plans')) return id === state.id ? [{ id }] : [];
        throw new Error(`Unexpected improvement V3 lock query: ${sql}`);
      }),
      user: { findUnique: jest.fn(async ({ where }: any) => {
        const found = users.find((item) => item.id === where.id);
        return found ? { ...found } : null;
      }), findMany: jest.fn(async ({ where }: any = {}) => {
        if (!where?.OR) return users;
        return users.filter((item) => where.OR.some((clause: any) => clause.id?.in.includes(item.id)
          || (clause.sysRole === item.sysRole && (clause.isAssessorOnly === undefined || clause.isAssessorOnly === item.isAssessorOnly) && (!clause.hrCapabilities
            || clause.hrCapabilities.hasEvery.every((capability: string) => item.hrCapabilities.includes(capability))))));
      }) },
      department: { findMany: jest.fn(async () => departments) },
      improvementPlan: {
        findUnique: jest.fn(async () => included()), findMany: jest.fn(async () => [included()]),
        create: jest.fn(async ({ data }: any) => { Object.assign(state, data); return included(); }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          expect(where.lifecycleStatus).toBe('active');
          if (Object.entries(where).some(([key, value]) => state[key] !== value)) return { count: 0 };
          Object.assign(state, data, { revision: data.revision?.increment ? state.revision + data.revision.increment : state.revision });
          return { count: 1 };
        }),
      },
      assessmentCycle: { findUnique: jest.fn(async () => ({ id: 'cycle' })) },
      employmentRecord: { findMany: jest.fn(async () => [{ id: 'employment', userId: 'emp', employeeStatus: 'active',
        effectiveFrom: new Date('2000-01-01'), effectiveTo: null }]) },
      auditLog: { create: jest.fn(async ({ data }: any) => records.push(data)), findMany: jest.fn(async () => []) },
    };
    prisma.$transaction = jest.fn(async (callback: any) => callback(prisma));
    notifications = { create: jest.fn() };
    service = new ImprovementWorkflowService(prisma,
      { getManagerChainIds: jest.fn(async () => ['manager', 'director']) } as any, notifications);
  });

  it('creates V3 only for the exact direct manager and exposes the initial revision', async () => {
    const result = await service.create({ employeeId: 'emp', goals }, viewer('manager'));
    expect(result).toMatchObject({ workflowVersion: 3, revision: 0 });
  });

  it('passes the submit request body revision through the HTTP controller', async () => {
    const controller = new ImprovementPlansController(service);
    const result = await controller.submitGoals('plan', { expectedRevision: 0 }, viewer('manager'));
    expect(result).toMatchObject({ status: 'goal_employee_confirm', revision: 1 });
  });

  it.each(['director', 'head', 'hr', 'emp', 'admin'])('does not let %s initiate outside the direct relationship', async (id) => {
    await expect(service.create({ employeeId: 'emp' }, viewer(id, id === 'hr' ? 'hr' : 'system_admin')))
      .rejects.toThrow(ForbiddenException);
    expect(prisma.improvementPlan.create).not.toHaveBeenCalled();
  });

  it('does not let an assessor-only direct manager create a plan', async () => {
    await expect(service.create({ employeeId: 'emp' }, { ...viewer('manager'), isAssessorOnly: true }))
      .rejects.toThrow(ForbiddenException);
  });

  it('lists only active, unarchived direct reports without broadening probation eligibility', async () => {
    users.push(user('lower', { directManagerId: 'emp' }), user('probation', { directManagerId: 'manager', status: 'probation' }),
      user('archived', { directManagerId: 'manager', archivedAt: new Date() }),
      user('deleted', { directManagerId: 'manager', deletedAt: new Date() }));
    expect((await service.eligibleEmployees(viewer('manager'))).map((item: any) => item.id)).toEqual(['emp']);
  });

  it('runs employee, department, shared HR, VP goals, then the original evaluation chain', async () => {
    await service.submitGoals('plan', viewer('manager'), 0);
    expect(state.status).toBe('goal_employee_confirm');
    await service.decideGoals('plan', { approve: true, expectedRevision: 1 }, viewer('emp'));
    expect(state.status).toBe('goal_dept_review');
    await service.decideGoals('plan', { approve: true, expectedRevision: 2 }, viewer('head'));
    expect(state.status).toBe('goal_hr_review');
    expect(state.startedAt).toBeNull();
    await service.decideGoals('plan', { approve: true, expectedRevision: 3 }, viewer('hr', 'hr'));
    expect(state.status).toBe('goal_vp_review');
    await service.decideGoals('plan', { approve: true, expectedRevision: 4 }, viewer('vp'));
    expect(state.status).toBe('self_eval');
    expect(state.startedAt).toBeInstanceOf(Date);
    await service.evaluate('plan', { ...evaluation, expectedRevision: 5 }, viewer('emp'));
    expect(state.status).toBe('manager_review');
    await service.evaluate('plan', { ...evaluation, expectedRevision: 6 }, viewer('manager'));
    expect(state.status).toBe('dept_review');
    await service.evaluate('plan', { ...evaluation, expectedRevision: 7 }, viewer('head'));
    expect(state.status).toBe('vp_review');
    await service.decideFinal('plan', { approve: true, expectedRevision: 8 }, viewer('vp'));
    expect(state).toMatchObject({ status: 'completed', revision: 9, finalScore: 80 });
  });

  it('shows the HR pool in actions and pending, and accepts one competing reviewer only', async () => {
    state.status = 'goal_hr_review';
    expect((await service.findOne('plan', specialist)).allowedActions).toEqual(['decide_goals']);
    expect(await service.myPending(viewer('hr', 'hr'))).toHaveLength(1);
    expect(await service.myPending(specialist)).toHaveLength(1);
    const results = await Promise.allSettled([
      service.decideGoals('plan', { approve: true, expectedRevision: 0 }, viewer('hr', 'hr')),
      service.decideGoals('plan', { approve: true, expectedRevision: 0 }, specialist),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(state).toMatchObject({ status: 'goal_vp_review', revision: 1 });
    expect(records.filter((record) => record.action === 'confirm_goals')).toHaveLength(1);
    expect(await service.myPending(specialist)).toEqual([]);
  });

  it.each([
    viewer('admin', 'system_admin'), { ...viewer('global'), canViewAll: true },
    viewer('partial', 'hr_user', ['cycle_plan_edit']), viewer('partial', 'hr_user', ['performance_publish']),
    viewer('employee', 'employee', ['cycle_plan_edit', 'performance_publish']),
  ])('does not grant HR review via admin/global or partial capabilities ($id)', async (actor) => {
    users.push(user(actor.id, actor));
    state.status = 'goal_hr_review';
    await expect(service.decideGoals('plan', { approve: true, expectedRevision: 0 }, actor)).rejects.toThrow(ForbiddenException);
    expect(await service.myPending(actor)).toEqual([]);
    expect(prisma.improvementPlan.updateMany).not.toHaveBeenCalled();
  });

  it('does not treat an HR employee as their own HR reviewer or skip the HR node', async () => {
    users[0].sysRole = 'hr';
    state.status = 'goal_dept_review';
    await service.decideGoals('plan', { approve: true, expectedRevision: 0 }, viewer('head'));
    expect(state.status).toBe('goal_hr_review');
    expect((await service.findOne('plan', viewer('emp', 'hr'))).allowedActions).toEqual(['lifecycle_terminate']);
    expect(await service.myPending(viewer('emp', 'hr'))).toEqual([]);
    await expect(service.decideGoals('plan', { approve: true, expectedRevision: 1 }, viewer('emp', 'hr')))
      .rejects.toThrow(ForbiddenException);
  });

  it.each(['viewer', 'database'])('excludes assessor-only HR from %s actions and the shared queue', async (source) => {
    state.status = 'goal_hr_review';
    const actor = { ...specialist, isAssessorOnly: source === 'viewer' };
    users.find((item) => item.id === 'specialist').isAssessorOnly = source === 'database';
    expect((await service.findOne('plan', actor)).allowedActions).toEqual([]);
    expect(await service.myPending(actor)).toEqual([]);
    await expect(service.decideGoals('plan', { approve: true, expectedRevision: 0 }, actor)).rejects.toThrow(ForbiddenException);
    expect(prisma.improvementPlan.updateMany).not.toHaveBeenCalled();
  });

  it('rechecks assessor-only HR inside the claiming transaction', async () => {
    state.status = 'goal_hr_review';
    prisma.$transaction.mockImplementationOnce(async (callback: any) => {
      users.find((item) => item.id === 'specialist').isAssessorOnly = true;
      return callback(prisma);
    });
    await expect(service.decideGoals('plan', { approve: true, expectedRevision: 0 }, specialist)).rejects.toThrow(ForbiddenException);
    expect(prisma.improvementPlan.updateMany).not.toHaveBeenCalled();
  });

  it('skips only department nodes for manager=head and audits both skips', async () => {
    departments[0].leaderId = 'manager';
    await service.submitGoals('plan', viewer('manager'), 0);
    expect(state.status).toBe('goal_employee_confirm');
    await service.decideGoals('plan', { approve: true, expectedRevision: 1 }, viewer('emp'));
    expect(state.status).toBe('goal_hr_review');
    expect(records.at(-1).newValue).toMatchObject({ autoDepartmentConfirm: true });
    state.status = 'manager_review';
    await service.evaluate('plan', { ...evaluation, expectedRevision: 2 }, viewer('manager'));
    expect(state.status).toBe('vp_review');
    expect(records.at(-1).newValue).toMatchObject({ autoDepartmentEvaluation: true });
    expect(state.departmentEvaluation.weightedScore).toBe(80);
  });

  it('requires the new department head to confirm after the direct manager changes', async () => {
    await service.submitGoals('plan', viewer('manager'), 0);
    users[0].directManagerId = 'head';
    await service.decideGoals('plan', { approve: true, expectedRevision: 1 }, viewer('emp'));
    expect(state.status).toBe('goal_dept_review');
    expect(records.at(-1).newValue.autoDepartmentConfirm).toBeUndefined();
    expect((await service.findOne('plan', viewer('head'))).allowedActions).toEqual(['decide_goals']);
    await service.decideGoals('plan', { approve: true, expectedRevision: 2 }, viewer('head'));
    expect(state.status).toBe('goal_hr_review');
  });

  it.each(['goal_employee_confirm', 'goal_dept_review', 'goal_hr_review', 'goal_vp_review'])(
    'returns %s rejection to the initiator', async (status) => {
      state.status = status;
      const actor = ({ goal_employee_confirm: viewer('emp'), goal_dept_review: viewer('head'),
        goal_hr_review: specialist, goal_vp_review: viewer('vp') } as any)[status];
      await service.decideGoals('plan', { approve: false, comment: 'Revise goals', expectedRevision: 0 }, actor);
      expect(state.status).toBe('goal_revision');
    });

  it('returns final rejection to manager review, retaining self evaluation', async () => {
    state.status = 'vp_review';
    state.selfEvaluation = { ...evaluation, weightedScore: 80 };
    state.departmentEvaluation = { ...evaluation, weightedScore: 80 };
    await service.decideFinal('plan', { approve: false, comment: 'Reevaluate', expectedRevision: 0 }, viewer('vp'));
    expect(state).toMatchObject({ status: 'manager_review', revision: 1, selfEvaluation: { weightedScore: 80 } });
  });

  it('rejects stale goal drafts and uses id/status/workflow/revision in the CAS', async () => {
    await service.updateDraft('plan', { improvementNeed: 'Latest draft', expectedRevision: 0 }, viewer('manager'));
    await expect(service.updateDraft('plan', { improvementNeed: 'Stale draft', expectedRevision: 0 }, viewer('manager')))
      .rejects.toThrow(ConflictException);
    expect(state).toMatchObject({ improvementNeed: 'Latest draft', revision: 1 });
    expect(prisma.improvementPlan.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'plan', lifecycleStatus: 'active', status: 'draft', workflowVersion: 3, revision: 0 },
      data: expect.objectContaining({ revision: { increment: 1 } }),
    }));
    expect(records).toHaveLength(1);
  });

  it('rejects stale evaluation drafts without overwriting later content', async () => {
    state.status = 'self_eval';
    await service.saveEvaluation('plan', { ...evaluation, expectedRevision: 0 }, viewer('emp'));
    await expect(service.saveEvaluation('plan', { ...evaluation, overallComment: 'Old', expectedRevision: 0 }, viewer('emp')))
      .rejects.toThrow(ConflictException);
    expect(state.selfEvaluation.overallComment).toBe('Good');
    expect(state.revision).toBe(1);
  });

  it.each([undefined, null, -1, 0.1, '0'])('refuses invalid expectedRevision %s before draft mutation', async (expectedRevision) => {
    await expect(service.updateDraft('plan', { improvementNeed: 'Invalid', expectedRevision: expectedRevision as number }, viewer('manager')))
      .rejects.toThrow(BadRequestException);
    expect(prisma.improvementPlan.updateMany).not.toHaveBeenCalled();
  });

  it.each(['resigned', 'archived', 'deleted', 'missing-manager', 'missing-head', 'missing-vp', 'no-hr', 'inactive-vp', 'self-manager', 'self-vp', 'missing-creator'])(
    'reports %s as a workflowIssue and refuses writes without closing the plan', async (issue) => {
      state.status = 'goal_hr_review';
      if (issue === 'resigned') users[0].status = 'resigned';
      if (issue === 'archived') users[0].archivedAt = new Date();
      if (issue === 'deleted') users[0].deletedAt = new Date();
      if (issue === 'missing-manager') users = users.filter((item) => item.id !== 'manager');
      if (issue === 'missing-head') departments[0].leaderId = null;
      if (issue === 'missing-vp') departments[0].approverId = null;
      if (issue === 'no-hr') users = users.filter((item) => !['hr', 'specialist'].includes(item.id));
      if (issue === 'inactive-vp') users.find((item) => item.id === 'vp').status = 'resigned';
      if (issue === 'self-manager') users[0].directManagerId = 'emp';
      if (issue === 'self-vp') departments[0].approverId = 'emp';
      if (issue === 'missing-creator') state.creatorId = null;
      const detail = await service.findOne('plan', viewer('emp'));
      expect(detail.workflowIssue).toEqual(expect.any(String));
      expect(detail.allowedActions).toEqual([]);
      await expect(service.decideGoals('plan', { approve: true, expectedRevision: 0 }, specialist)).rejects.toThrow();
      expect(prisma.improvementPlan.updateMany).not.toHaveBeenCalled();
      expect(state.status).toBe('goal_hr_review');
    });

  it.each(['resigned', 'probation', 'archived', 'deleted'])('does not create for a %s employee', async (issue) => {
    if (issue === 'archived') users[0].archivedAt = new Date();
    else if (issue === 'deleted') users[0].deletedAt = new Date();
    else users[0].status = issue;
    await expect(service.create({ employeeId: 'emp' }, viewer('manager'))).rejects.toThrow(BadRequestException);
    expect(prisma.improvementPlan.create).not.toHaveBeenCalled();
  });

  it('keeps V2 department-before-employee and never adds HR/VP goal nodes', async () => {
    state.workflowVersion = 2;
    await service.submitGoals('plan', viewer('manager'), 0);
    expect(state.status).toBe('goal_dept_review');
    await service.decideGoals('plan', { approve: true, expectedRevision: 1 }, viewer('head'));
    expect(state.status).toBe('goal_employee_confirm');
    await service.decideGoals('plan', { approve: true, expectedRevision: 2 }, viewer('emp'));
    expect(state.status).toBe('self_eval');
  });

  it('retains V2 initiator edits and ancestor read scope while denying unrelated viewers', async () => {
    state.workflowVersion = 2;
    state.creatorId = 'director';
    users.push(user('director'));
    await service.updateDraft('plan', { improvementNeed: 'Legacy edit', expectedRevision: 0 }, viewer('director'));
    expect(state.improvementNeed).toBe('Legacy edit');
    expect((await service.findOne('plan', viewer('head'))).id).toBe('plan');
    await expect(service.findOne('plan', viewer('unrelated'))).rejects.toThrow(ForbiddenException);
  });

  it('does not reuse another initiator actor context for the same employee in the list', async () => {
    users.push(user('director'));
    const first = await prisma.improvementPlan.findUnique();
    prisma.improvementPlan.findMany.mockResolvedValue([first, { ...first, id: 'older', creatorId: 'director', workflowVersion: 2 }]);
    const result = await service.findAll({}, new PaginationDto(), viewer('hr', 'hr'));
    expect(result.items.map((item) => item.workflowIssue)).toEqual([null, null]);
  });

  it.each([
    ['draft', 'manager', 'updateDraft'], ['draft', 'manager', 'submitGoals'],
    ['goal_employee_confirm', 'emp', 'decideGoals'], ['goal_hr_review', 'specialist', 'decideGoals'],
    ['self_eval', 'emp', 'evaluate'], ['self_eval', 'emp', 'saveEvaluation'], ['vp_review', 'vp', 'decideFinal'],
  ])('blocks %s/%s/%s after employee departure', async (status, actorId, method) => {
    state.status = status;
    state.departmentEvaluation = { ...evaluation, weightedScore: 80 };
    users[0].status = 'resigned';
    const actor = actorId === 'specialist' ? specialist : viewer(actorId);
    const payload = { ...evaluation, expectedRevision: 0, approve: true, improvementNeed: 'Draft' };
    const operation = method === 'submitGoals' ? service.submitGoals('plan', actor, 0)
      : service[method as 'updateDraft']('plan', payload, actor);
    await expect(operation).rejects.toThrow(ConflictException);
    expect(prisma.improvementPlan.updateMany).not.toHaveBeenCalled();
    expect(records).toEqual([]);
  });

  it('rechecks departure inside the transaction, not only before validating evaluation input', async () => {
    state.status = 'self_eval';
    prisma.$transaction.mockImplementationOnce(async (callback: any) => {
      users[0].archivedAt = new Date();
      return callback(prisma);
    });
    await expect(service.evaluate('plan', { ...evaluation, expectedRevision: 0 }, viewer('emp'))).rejects.toThrow(ConflictException);
    expect(prisma.improvementPlan.updateMany).not.toHaveBeenCalled();
  });

  it('rechecks the locked plan lifecycle before applying a stale draft save', async () => {
    prisma.$transaction.mockImplementationOnce(async (callback: any) => {
      state.lifecycleStatus = 'terminated';
      return callback(prisma);
    });
    await expect(service.updateDraft('plan', { expectedRevision: 0, improvementNeed: 'Stale draft' }, viewer('manager')))
      .rejects.toThrow(ConflictException);
    expect(prisma.$queryRaw.mock.calls[0][0].join('')).toContain('FROM improvement_plans');
    expect(prisma.improvementPlan.updateMany).not.toHaveBeenCalled();
    expect(records).toEqual([]);
    expect(state.improvementNeed).toBe('Improve quality');
  });

  it('rejects an organization transfer during a write instead of using old skip routing', async () => {
    state.status = 'manager_review';
    prisma.$transaction.mockImplementationOnce(async (callback: any) => {
      departments[0].leaderId = 'manager';
      return callback(prisma);
    });
    await expect(service.evaluate('plan', { ...evaluation, expectedRevision: 0 }, viewer('manager'))).rejects.toThrow(ConflictException);
    expect(prisma.improvementPlan.updateMany).not.toHaveBeenCalled();
  });

  it('allows only one simultaneous goal draft save even when the status is unchanged', async () => {
    const result = await Promise.allSettled([
      service.updateDraft('plan', { expectedRevision: 0, improvementNeed: 'First' }, viewer('manager')),
      service.updateDraft('plan', { expectedRevision: 0, improvementNeed: 'Second' }, viewer('manager')),
    ]);
    expect(result.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(result.filter((item) => item.status === 'rejected')).toHaveLength(1);
    expect(state).toMatchObject({ revision: 1, improvementNeed: 'First' });
    expect(records).toHaveLength(1);
  });

  it('keeps legacy V1 plans read-only', async () => {
    state.workflowVersion = 1;
    expect((await service.findOne('plan', viewer('manager'))).allowedActions).toEqual([]);
    await expect(service.updateDraft('plan', { expectedRevision: 0 }, viewer('manager'))).rejects.toThrow(ConflictException);
  });
});
