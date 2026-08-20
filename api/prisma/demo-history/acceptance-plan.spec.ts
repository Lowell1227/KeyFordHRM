import { ACCEPTANCE_TASK_PLAN, TEST_ACCEPTANCE_CYCLE_NAME } from './acceptance-plan';

describe('demo acceptance cycle plan', () => {
  it('使用独立且明确标识的当前测试周期', () => {
    expect(TEST_ACCEPTANCE_CYCLE_NAME).toBe('测试·2026 Q3 绩效验收周期');
  });

  it('为除管理员外的 7 个测试身份各生成一个任务', () => {
    expect(ACCEPTANCE_TASK_PLAN).toHaveLength(7);
    expect(new Set(ACCEPTANCE_TASK_PLAN.map((item) => item.employeeNo)).size).toBe(7);
    expect(ACCEPTANCE_TASK_PLAN.map((item) => item.employeeNo)).not.toContain('ADMIN');
  });

  it('覆盖目标审核、自评、主管评分和结果查看状态', () => {
    const statuses = new Set(ACCEPTANCE_TASK_PLAN.map((item) => item.status));
    expect(statuses).toEqual(expect.objectContaining({}));
    expect(statuses.has('indicator_reviewing')).toBe(true);
    expect(statuses.has('indicator_confirming')).toBe(true);
    expect(statuses.has('self_eval')).toBe(true);
    expect(statuses.has('manager_scoring')).toBe(true);
    expect(statuses.has('published')).toBe(true);
  });

  it('主管账号拥有 4 个直属员工团队任务', () => {
    expect(ACCEPTANCE_TASK_PLAN.filter((item) => item.managerNo === 'MGR001')).toHaveLength(4);
  });
});
