import { ForbiddenException } from '@nestjs/common';
import { ImprovementWorkflowService } from './improvement-workflow.service';

const viewer = (id: string, role = 'employee') => ({
  id, name: id, sysRole: role, deptId: 'dept', isAssessorOnly: false, canViewAll: false, hrCapabilities: [],
}) as any;

const employee = { id: 'emp', name: '员工', employeeNo: 'E01', deptId: 'dept', directManagerId: 'manager', status: 'active', deletedAt: null,
  dept: { id: 'dept', name: '业务部' } };
const departments = [{ id: 'dept', name: '业务部', parentId: null, leaderId: 'head', approverId: 'vp',
  leader: { name: '部门负责人', directManagerId: null, directManager: null }, approver: { name: '分管总' } }];
const plan = (overrides: Record<string, unknown> = {}) => ({
  id: 'plan', employeeId: 'emp', cycleId: null, taskId: null, creatorId: 'manager', workflowVersion: 2,
  improvementNeed: '需要提升交付质量', importance: null, improvementGoal: null, targetDate: null, measures: [],
  goals: [{ id: 'g1', name: '质量', description: '降低返工', weight: 100 }],
  selfEvaluation: null, managerEvaluation: null, departmentEvaluation: null, finalScore: null,
  startedAt: null, completedAt: null, status: 'draft', createdAt: new Date(), updatedAt: new Date(),
  employee, creator: { id: 'manager', name: '主管' }, cycle: null, ...overrides,
});

describe('ImprovementWorkflowService', () => {
  let prisma: any;
  let service: ImprovementWorkflowService;
  let scope: any;
  let notifications: any;

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(employee), findMany: jest.fn().mockResolvedValue([]) },
      department: { findMany: jest.fn().mockResolvedValue(departments) },
      assessmentCycle: { findUnique: jest.fn() },
      improvementPlan: { create: jest.fn().mockResolvedValue(plan()), findUnique: jest.fn().mockResolvedValue(plan()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }), findMany: jest.fn().mockResolvedValue([]) },
      auditLog: { create: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    };
    prisma.$transaction = jest.fn(async (callback: (tx: any) => Promise<unknown>) => callback(prisma));
    scope = { getManagerChainIds: jest.fn().mockResolvedValue(['manager', 'director']), getSubDeptIds: jest.fn() };
    notifications = { create: jest.fn().mockResolvedValue(null) };
    service = new ImprovementWorkflowService(prisma, scope, notifications);
  });

  it('allows an upper manager to create a plan without cycle or task', async () => {
    await service.create({ employeeId: 'emp', improvementNeed: '需要提升交付质量', goals: plan().goals }, viewer('director'));
    expect(prisma.improvementPlan.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      employeeId: 'emp', cycleId: null, taskId: null, creatorId: 'director', workflowVersion: 2,
    }) }));
  });

  it('does not let HR initiate merely because HR can see every plan', async () => {
    await expect(service.create({ employeeId: 'emp' }, viewer('hr', 'hr'))).rejects.toThrow(ForbiddenException);
    expect(prisma.improvementPlan.create).not.toHaveBeenCalled();
  });

  it('bypasses department goal confirmation when the creator is department head', async () => {
    prisma.improvementPlan.findUnique.mockResolvedValue(plan({ creatorId: 'head' }));
    await service.submitGoals('plan', viewer('head'));
    expect(prisma.improvementPlan.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'goal_employee_confirm' }),
    }));
  });

  it('returns a rejected final review to the current direct manager without changing the score', async () => {
    prisma.improvementPlan.findUnique.mockResolvedValue(plan({ status: 'vp_review', departmentEvaluation: {
      items: [{ goalId: 'g1', score: 88, comment: '已改进' }], overallComment: '达到要求', weightedScore: 88,
    } }));
    await service.decideFinal('plan', { approve: false, comment: '请再核实' }, viewer('vp'));
    expect(prisma.improvementPlan.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'manager_review', finalScore: null }),
    }));
  });

  it('does not reveal supervisor scores to the employee through the operation log before final approval', async () => {
    prisma.improvementPlan.findUnique.mockResolvedValue(plan({ status: 'manager_review', managerEvaluation: {
      items: [{ goalId: 'g1', score: 91, comment: '内部意见' }], overallComment: '内部总结', weightedScore: 91,
    } }));
    prisma.auditLog.findMany.mockResolvedValue([{ id: 'audit', action: 'submit_managerEvaluation',
      createdAt: new Date(), user: { name: '主管' }, oldValue: null,
      newValue: { evaluation: { items: [{ goalId: 'g1', score: 91, comment: '内部意见' }] } } }]);
    const detail = await service.findOne('plan', viewer('emp'));
    expect(detail.managerEvaluation).toBeNull();
    expect(JSON.stringify(detail.records)).not.toContain('内部意见');
  });

  it('also hides an unfinished supervisor evaluation draft from the employee', async () => {
    prisma.improvementPlan.findUnique.mockResolvedValue(plan({ status: 'manager_review', managerEvaluation: {
      items: [{ goalId: 'g1', score: 72, comment: '主管草稿' }], overallComment: '', draft: true,
    } }));
    prisma.auditLog.findMany.mockResolvedValue([{ id: 'draft-audit', action: 'save_evaluation_draft',
      createdAt: new Date(), user: { name: '主管' }, oldValue: { status: 'manager_review' },
      newValue: { evaluation: { items: [{ goalId: 'g1', score: 72, comment: '主管草稿' }] } } }]);
    const detail = await service.findOne('plan', viewer('emp'));
    expect(JSON.stringify(detail)).not.toContain('主管草稿');
  });

  it('routes manager evaluation to the current manager after an employee transfer', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...employee, directManagerId: 'new-manager' });
    scope.getManagerChainIds.mockResolvedValue(['new-manager', 'director']);
    prisma.improvementPlan.findUnique.mockResolvedValue(plan({ status: 'manager_review' }));
    await expect(service.evaluate('plan', { items: [{ goalId: 'g1', score: 82, comment: '进步' }],
      overallComment: '继续保持' }, viewer('manager'))).rejects.toThrow(ForbiddenException);
    await service.evaluate('plan', { items: [{ goalId: 'g1', score: 82, comment: '进步' }],
      overallComment: '继续保持' }, viewer('new-manager'));
    expect(prisma.improvementPlan.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'dept_review' }),
    }));
  });

  it('does not send a second new-plan copy when goals are resubmitted', async () => {
    prisma.improvementPlan.findUnique.mockResolvedValue(plan({ status: 'goal_revision' }));
    prisma.user.findMany.mockResolvedValue([{ id: 'specialist' }]);
    await service.submitGoals('plan', viewer('manager'));
    expect(notifications.create).not.toHaveBeenCalledWith(expect.objectContaining({ userId: 'specialist' }));
  });

  it('keeps a partial employee evaluation as draft without advancing the plan', async () => {
    prisma.improvementPlan.findUnique.mockResolvedValue(plan({ status: 'self_eval' }));
    await service.saveEvaluation('plan', { items: [{ goalId: 'g1', score: null, comment: '正在收集材料' }],
      overallComment: '' }, viewer('emp'));
    expect(prisma.improvementPlan.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'self_eval', selfEvaluation: expect.objectContaining({ draft: true }) }),
    }));
  });

  it('uses the parent department leader when the employee leads their own department', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...employee, id: 'head' });
    prisma.department.findMany.mockResolvedValue([
      { ...departments[0], parentId: 'parent' },
      { id: 'parent', name: '事业部', parentId: null, leaderId: 'upper-head', approverId: 'vp',
        leader: { name: '事业部负责人', directManagerId: null, directManager: null }, approver: { name: '分管总' } },
    ]);
    prisma.improvementPlan.findMany.mockResolvedValue([plan({ employeeId: 'head', status: 'goal_dept_review' })]);
    const pending = await service.myPending(viewer('upper-head'));
    expect(pending).toHaveLength(1);
  });

  it('shows only current and lower management scope in the creation employee picker', async () => {
    prisma.user.findMany.mockResolvedValue([
      { id: 'manager', name: '主管', employeeNo: 'M', deptId: 'child', directManagerId: 'director', dept: { name: '团队' } },
      { id: 'direct', name: '直属员工', employeeNo: 'E1', deptId: 'child', directManagerId: 'manager', dept: { name: '团队' } },
      { id: 'lower', name: '下级员工', employeeNo: 'E2', deptId: 'grandchild', directManagerId: 'direct', dept: { name: '下级部门' } },
      { id: 'other', name: '无关员工', employeeNo: 'E3', deptId: 'other', directManagerId: null, dept: { name: '其他部门' } },
    ].map((user) => ({ ...user, status: 'active', deletedAt: null })));
    prisma.department.findMany.mockResolvedValue([
      { id: 'child', parentId: 'root', leaderId: 'manager' },
      { id: 'grandchild', parentId: 'child', leaderId: null },
      { id: 'root', parentId: null, leaderId: 'director' },
      { id: 'other', parentId: null, leaderId: 'other-leader' },
    ]);
    const choices = await service.eligibleEmployees(viewer('manager'));
    expect(choices.map((choice) => choice.id)).toEqual(['direct', 'lower']);
  });
});
