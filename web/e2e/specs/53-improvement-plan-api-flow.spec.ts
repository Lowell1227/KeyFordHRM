import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { ACCEPTANCE_ACCOUNTS, ACCEPTANCE_PASSWORD } from '../fixtures/acceptance-accounts';

const apiBase = process.env.PLAYWRIGHT_API_BASE_URL || 'http://localhost:3000/api/v1';
type Role = keyof typeof ACCEPTANCE_ACCOUNTS;

test('real organization roles can complete the independent plan and rejection loops', async ({ request }) => {
  const tokens = {} as Record<Role, string>;
  for (const role of ['manager', 'deptHead', 'employee', 'employeeB', 'hr', 'approver'] as Role[]) {
    const response = await request.post(`${apiBase}/auth/login`, {
      data: { employeeNo: ACCEPTANCE_ACCOUNTS[role], password: ACCEPTANCE_PASSWORD },
    });
    expect(response.status(), `login ${role}`).toBe(200);
    tokens[role] = (await response.json()).data.token;
  }
  const call = async (role: Role, method: 'GET' | 'POST' | 'PATCH', endpoint: string,
    data?: unknown, expected = 200) => {
    const response = await request.fetch(`${apiBase}${endpoint}`, {
      method, headers: { Authorization: `Bearer ${tokens[role]}` }, data,
    });
    expect(response.status(), `${role} ${method} ${endpoint}: ${await response.text()}`).toBe(expected);
    return (await response.json()).data;
  };
  const eligible = await call('manager', 'GET', '/improvement-plans/eligible-employees');
  const employee = eligible.find((item: { employeeNo: string }) => item.employeeNo === ACCEPTANCE_ACCOUNTS.employee);
  expect(employee).toBeTruthy();
  const goals = [
    { id: 'delivery', name: '交付质量', description: '减少返工', weight: 40 },
    { id: 'planning', name: '计划管理', description: '及时跟进任务', weight: 60 },
  ];
  let planId = '';
  const detail = (role: Role) => call(role, 'GET', `/improvement-plans/${planId}`);
  const decide = (role: Role, approve: boolean, comment = '') =>
    call(role, 'POST', `/improvement-plans/${planId}/decide-goals`, { approve, comment });
  const evaluate = (role: Role, scores: [number, number]) => call(role, 'POST',
    `/improvement-plans/${planId}/evaluate`, { items: goals.map((goal, index) => ({
      goalId: goal.id, score: scores[index], comment: `${goal.name}已有进展`,
    })), overallComment: '总体评价已完成' });

  try {
    await call('hr', 'POST', '/improvement-plans', { employeeId: employee.id }, 403);
    const created = await call('manager', 'POST', '/improvement-plans', {
      employeeId: employee.id, cycleId: null, improvementNeed: '需要提升交付和计划质量', goals,
    }, 201);
    planId = created.id;
    expect(created.status).toBe('draft');
    expect(created.cycleId).toBeNull();

    expect((await call('employeeB', 'GET', `/improvement-plans/${planId}`, undefined, 403))).toBeNull();
    expect((await detail('hr')).allowedActions).toEqual([]);
    await call('manager', 'POST', `/improvement-plans/${planId}/submit-goals`);
    expect((await detail('deptHead')).status).toBe('goal_dept_review');
    await decide('deptHead', false, '目标描述需要更明确');
    expect((await detail('manager')).status).toBe('goal_revision');
    await call('manager', 'PATCH', `/improvement-plans/${planId}`, { improvementNeed: '聚焦交付和计划质量', goals });
    await call('manager', 'POST', `/improvement-plans/${planId}/submit-goals`);
    await decide('deptHead', true);
    expect((await detail('employee')).status).toBe('goal_employee_confirm');
    await decide('employee', false, '第二项目标需要调整');
    await call('manager', 'PATCH', `/improvement-plans/${planId}`, { goals: [goals[0],
      { ...goals[1], description: '每周跟进任务' }] });
    await call('manager', 'POST', `/improvement-plans/${planId}/submit-goals`);
    await decide('deptHead', true);
    await decide('employee', true);
    expect((await detail('employee')).status).toBe('self_eval');
    await evaluate('employee', [80, 90]);
    expect((await detail('manager')).status).toBe('manager_review');
    await evaluate('manager', [70, 90]);
    expect((await detail('employee')).managerEvaluation).toBeNull();
    await evaluate('deptHead', [90, 100]);
    expect((await detail('approver')).status).toBe('vp_review');
    await call('approver', 'POST', `/improvement-plans/${planId}/decide-final`,
      { approve: false, comment: '请重新核对质量评分' });
    expect((await detail('manager')).status).toBe('manager_review');
    await evaluate('manager', [75, 95]);
    await evaluate('deptHead', [88, 92]);
    await call('approver', 'POST', `/improvement-plans/${planId}/decide-final`, { approve: true });
    const finished = await detail('employee');
    expect(finished.status).toBe('completed');
    expect(finished.finalScore).toBe(90.4);
    expect(finished.records.filter((record: { action: string }) => record.action === 'reject_goals')).toHaveLength(2);
    expect(finished.records.some((record: { action: string }) => record.action === 'reject_final')).toBe(true);
  } finally {
    if (planId) {
      const cleanup = `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{const id=process.env.IMPROVEMENT_TEST_PLAN_ID;await p.notificationLog.deleteMany({where:{extraData:{path:['improvementPlanId'],equals:id}}});await p.auditLog.deleteMany({where:{entityType:'improvement_plan',entityId:id}});await p.improvementPlan.delete({where:{id}});await p.$disconnect()})().catch(async e=>{console.error(e.message);await p.$disconnect();process.exit(1)})`;
      execFileSync('docker', ['compose', 'exec', '-T', '-e', `IMPROVEMENT_TEST_PLAN_ID=${planId}`, 'api',
        'node', '-e', cleanup], { cwd: path.resolve(process.cwd(), '..'), stdio: 'pipe' });
    }
  }
});
