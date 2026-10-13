import { ConfigService } from '@nestjs/config';
import { PerformanceCardService } from './performance-card.service';

const viewer = { id: 'owner', name: '合成人员', sysRole: 'hr' };
const sender = { corpId: 'corp', senderStaffId: 'staff', conversationId: 'cid', conversationType: '1', deliveryId: 'message' };
const date = new Date('2026-09-01T00:00:00Z');
const taskFixture = (changes: any = {}) => ({
  id: 'task-1', employeeId: 'owner', employeeName: '合成人员', cycleId: 'cycle-1', cycleName: '九月绩效',
  status: 'indicator_drafting', isExempt: false, workflowVersion: 2, managerId: 'manager',
  approvedAt: null, publishedAt: null, employeeConfirmedAt: null, updatedAt: date,
  managerStageState: 'not_started', indicatorInstances: [{ id: 'indicator-1', name: '目标', weight: 1 }],
  periods: [], flowRecords: [], workflowContext: { currentHandler: { id: 'owner', nodeType: 'employee' },
    statusLabel: '待制定目标', currentDeadline: null, stage: 'goal_setting' }, ...changes,
});
const periodFixture = (changes: any = {}) => ({
  period: { id: 'period-sep', taskId: 'task-1', periodKey: '2026-09', periodType: 'month',
    status: 'self_eval', employeeSubmittedAt: null, managerSubmittedAt: null, selfEvalDueAt: date, managerDueAt: date, ...changes },
  context: { statusLabel: '待员工自评' }, permissions: { canEditEmployee: true, canEditManager: false },
});

describe('performance lifecycle cards (authorized read projection)', () => {
  let service: PerformanceCardService;
  let task: any;
  let eligibility: any;
  let tasks: any;
  let periods: any;
  let prisma: any;
  let improvements: any;
  let env: Record<string, string>;
  beforeEach(() => {
    task = taskFixture();
    eligibility = { resolveIdentity: jest.fn(async () => ({ kind: 'ready', viewer })) };
    tasks = { findMine: jest.fn(async () => ({ items: [task], total: 1 })), findOne: jest.fn(async () => task) };
    periods = { getReview: jest.fn(async () => periodFixture()) };
    prisma = { assessmentTask: { findMany: jest.fn(async () => [{ id: task.id }]) } };
    improvements = { myPending: jest.fn(async () => []) };
    env = { DINGTALK_BOT_HRM_URL: 'https://hrm.example' };
    service = new PerformanceCardService(eligibility, tasks, periods, prisma, improvements,
      { get: (key: string) => env[key] } as ConfigService);
  });
  const cards = (result: any) => {
    expect(result?.kind).toBe('cards');
    return result.cards as any[];
  };
  it('does not consume normal progress messages', async () => {
    expect(await service.query('九月已拜访6家', sender)).toBeNull();
    expect(eligibility.resolveIdentity).not.toHaveBeenCalled();
  });
  it('rejects an unavailable identity before reading HRM data', async () => {
    eligibility.resolveIdentity.mockResolvedValue({ kind: 'reply', text: '功能暂未开放' });
    expect(await service.query('我的目标', sender)).toEqual({ kind: 'reply', text: '功能暂未开放' });
    expect(tasks.findMine).not.toHaveBeenCalled();
    expect(prisma.assessmentTask.findMany).not.toHaveBeenCalled();
  });
  it('keeps an HR personal query owner-only and emits a controlled goal link', async () => {
    const result = cards(await service.query('我的目标', sender));
    expect(tasks.findMine).toHaveBeenCalledWith(expect.anything(), viewer);
    expect(result[0]).toMatchObject({ kind: 'goal', subjectKey: 'task:task-1', params: {
      goalCount: '1', primaryText: '制定目标', primaryUrl: 'https://hrm.example/tasks/task-1?stage=goal-setting',
    } });
    task.employeeId = 'colleague';
    expect((await service.query('我的目标', sender))?.kind).toBe('reply');
  });
  it.each([
    ['indicator_reviewing', '查看已提交目标', 'goal-setting'],
    ['indicator_confirming', '查看并确认目标', 'goal-confirmation'],
    ['goal_confirmed', '查看目标', 'goal-setting'],
  ])('maps goal state %s without a write callback', async (status, primaryText, stage) => {
    task.status = status;
    expect(cards(await service.query('查看目标', sender))[0].params).toMatchObject({
      primaryText, primaryUrl: `https://hrm.example/tasks/task-1?stage=${stage}`,
    });
  });
  it('shows actual returned goal feedback, not an invented rejection', async () => {
    task.flowRecords = [{ nodeType: 'indicator_setting', action: 'reject', comment: '明确目标口径', createdAt: date }];
    expect(cards(await service.query('我的目标', sender))[0].params).toMatchObject({
      primaryText: '根据反馈修改', feedbackSummary: '明确目标口径',
    });
  });
  it('shows no-cycle explicitly instead of creating a fictional card', async () => {
    tasks.findMine.mockResolvedValue({ items: [], total: 0 });
    expect(await service.query('我的目标', sender)).toMatchObject({ kind: 'reply', text: expect.stringContaining('没有') });
  });
  it.each([['month', '2026-09'], ['cycle', '整周期']])('keeps %s period ID and label even outside the current month', async (periodType, label) => {
    task.status = 'self_eval';
    task.periods = [{ id: 'period-sep', status: 'self_eval' }];
    periods.getReview.mockResolvedValue(periodFixture({ periodType }));
    expect(cards(await service.query('我的自评', sender))[0]).toMatchObject({ kind: 'evaluation', params: {
      periodLabel: label, primaryUrl: 'https://hrm.example/tasks/task-1?stage=self-eval&periodId=period-sep',
    } });
  });
  it('enumerates two open periods rather than silently selecting one', async () => {
    task.status = 'self_eval';
    task.periods = [{ id: 'sep', status: 'self_eval' }, { id: 'oct', status: 'self_eval' }];
    periods.getReview.mockImplementation(async (id: string) => periodFixture({ id, periodKey: id === 'sep' ? '2026-09' : '2026-10' }));
    const result = cards(await service.query('我的自评', sender));
    expect(result.map(c => c.params.primaryUrl)).toEqual([
      'https://hrm.example/tasks/task-1?stage=self-eval&periodId=sep',
      'https://hrm.example/tasks/task-1?stage=self-eval&periodId=oct',
    ]);
  });
  it('does not offer employee editing when the existing period service denies it', async () => {
    task.status = 'self_eval';
    task.periods = [{ id: 'period-sep', status: 'manager_scoring' }];
    periods.getReview.mockResolvedValue({ ...periodFixture({ employeeSubmittedAt: date }),
      permissions: { canEditEmployee: false, canEditManager: false } });
    expect(cards(await service.query('我的自评', sender))[0].params.primaryText).toBe('查看本期自评');
    expect(cards(await service.query('我的待办', sender))[0].params.stateLabel).toBe('暂无待办');
  });
  it('fails closed if a period projection no longer belongs to the requested task', async () => {
    task.periods = [{ id: 'period-sep', status: 'self_eval' }];
    periods.getReview.mockResolvedValue(periodFixture({ taskId: 'other-task' }));
    expect((await service.query('我的自评', sender))?.kind).toBe('reply');
  });
  it('uses actual handler for approver work, not HR global visibility', async () => {
    task = taskFixture({ employeeId: 'colleague', status: 'approval',
      workflowContext: { currentHandler: { id: 'different-approver', nodeType: 'approver' }, statusLabel: '待结果审批' } });
    expect(cards(await service.query('我的待办', sender))[0].params.stateLabel).toBe('暂无待办');
    task.workflowContext.currentHandler.id = 'owner';
    expect(cards(await service.query('我的待办', sender))[0].params.primaryText).toBe('审批绩效结果');
  });
  it('still offers the assigned manager final-cycle grade after all period work', async () => {
    task = taskFixture({ employeeId: 'colleague', managerId: 'owner', status: 'manager_scoring', managerStageState: 'pending',
      periods: [{ id: 'period-sep', status: 'completed' }],
      workflowContext: { currentHandler: { id: 'owner', nodeType: 'manager' }, statusLabel: '待主管评估' } });
    periods.getReview.mockResolvedValue({ ...periodFixture({ status: 'completed', employeeSubmittedAt: date, managerSubmittedAt: date }),
      permissions: { canEditEmployee: false, canEditManager: false } });
    expect(cards(await service.query('我的待办', sender))[0]).toMatchObject({ params: {
      primaryText: '提交周期评定', primaryUrl: 'https://hrm.example/tasks/task-1/final-grade',
    } });
  });
  it.each([
    ['approval', null, null, null, null],
    ['approval', date, null, null, '查看并确认结果'],
    ['confirmed', date, date, null, '查看结果'],
    ['published', date, null, date, '查看结果'],
  ])('projects result %s approved=%s confirmed=%s published=%s', async (status, approvedAt, employeeConfirmedAt, publishedAt, primaryText) => {
    Object.assign(task, { status, approvedAt, employeeConfirmedAt, publishedAt, totalScore: 99, rawGrade: 'A',
      gradeResult: { calculatedScore: 99, calibratedGrade: 'A', coefficient: 1.5 } });
    const result = await service.query('我的结果', sender);
    if (!primaryText) expect(result?.kind).toBe('reply');
    else {
      const resultCards = cards(result);
      expect(resultCards[0].params.primaryText).toBe(primaryText);
      expect(JSON.stringify(resultCards)).not.toMatch(/calculatedScore|rawGrade|calibratedGrade|coefficient|99/);
      if (status === 'confirmed') expect(resultCards[0].params.summary).toContain('等待 HR 公示');
    }
  });
  it('requires actual objection history to call manager scoring regrading', async () => {
    task.status = 'manager_scoring';
    expect((await service.query('我的结果', sender))?.kind).toBe('reply');
    task.flowRecords = [{ nodeType: 'employee_confirm', action: 'reject', createdAt: date,
      extraData: { type: 'employee_result_objection' } }];
    expect(cards(await service.query('我的结果', sender))[0].params.primaryText).toBe('查看重评进度');
  });
  it('does not fabricate pending work for exempt tasks', async () => {
    task.isExempt = true;
    expect(cards(await service.query('我的待办', sender))[0].params.stateLabel).toBe('暂无待办');
  });
  it('reuses authorized independent improvement tasks without a cycle requirement', async () => {
    prisma.assessmentTask.findMany.mockResolvedValue([]);
    improvements.myPending.mockResolvedValue([{ id: 'plan-1', employeeName: '合成人员', cycleName: null,
      currentOwnerId: 'owner', allowedActions: ['evaluate'], targetDate: date }]);
    expect(cards(await service.query('我的待办', sender))[0]).toMatchObject({ kind: 'todo', params: {
      title: '绩效改进计划', cycleLabel: '', primaryText: '处理改进计划', primaryUrl: 'https://hrm.example/improvement-plans',
    } });
  });
  it('rejects an unsafe configured origin before returning links', async () => {
    env.DINGTALK_BOT_HRM_URL = 'https://hrm.example/unsafe';
    await expect(service.query('我的目标', sender)).rejects.toThrow();
  });
  it('does not silently drop assigned period managers when the task manager differs', async () => {
    task = taskFixture({ employeeId: 'colleague', managerId: 'other-manager', status: 'manager_scoring',
      periods: [{ id: 'period-sep', status: 'manager_scoring' }],
      workflowContext: { currentHandler: { id: 'other-manager', nodeType: 'manager' }, statusLabel: '待主管评估' } });
    periods.getReview.mockResolvedValue({ ...periodFixture({ status: 'manager_scoring', employeeSubmittedAt: date }),
      permissions: { canEditEmployee: false, canEditManager: true } });
    expect(cards(await service.query('我的待办', sender))[0].params.primaryText).toBe('填写本期评价');
  });
});
