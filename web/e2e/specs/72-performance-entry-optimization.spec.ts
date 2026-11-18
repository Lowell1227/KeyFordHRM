import { expect, test } from '@playwright/test';
import { resolveNotificationTarget } from '../../src/components/layout/notification-target';
import { resolveEmployeeTaskEntry } from '../../src/views/task/task-stage';

test('goal change and improvement notices open their own authorized detail route', () => {
  expect(resolveNotificationTarget({ taskId: null, cycleId: null, type: 'goal_change',
    extraData: { path: '/goal-changes/change-1' } }, false)).toEqual({ path: '/goal-changes/change-1' });
  expect(resolveNotificationTarget({ taskId: null, cycleId: null, type: 'improvement_plan',
    extraData: { path: '/improvement-plans/plan-1' } }, false)).toEqual({ path: '/improvement-plans/plan-1' });
  expect(resolveNotificationTarget({ taskId: null, cycleId: null, type: 'goal_change',
    extraData: { path: '//evil.example' } }, false)).toBeNull();
});

test('a manager receiving their own goal confirmation notice opens their personal task', () => {
  expect(resolveNotificationTarget({ taskId: 'task-1', cycleId: 'cycle-1', type: 'indicator_setting_notice',
    extraData: { action: 'employee_goal' } }, true)).toEqual({ name: 'TaskDetail', params: { id: 'task-1' } });
});

test('an unopened monthly period does not preempt an unfinished goal plan', () => {
  const result = resolveEmployeeTaskEntry({ status: 'indicator_drafting', workflowVersion: 2, periods: [{
    id: 'period-1', periodKey: '2026-11', periodType: 'month', sequence: 1, status: 'unopened',
    employeeSubmittedAt: null, managerSubmittedAt: null,
  } as never] });
  expect(result).toMatchObject({ stage: 'goal-setting', actionLabel: '继续制定目标' });
});
