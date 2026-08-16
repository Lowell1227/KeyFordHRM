import { expect, test } from '@playwright/test';
import type { AssessmentCycle } from '../../src/types/api.types';
import {
  buildTrackingPeople,
  formatGoalTrackingCycleName,
  goalTrackingStatus,
  parseCollapsedPeopleGroups,
  parseVisibleColumns,
  selectDefaultTrackingCycle,
  selectGoalTrackingCycles,
} from '../../src/views/objectives/goal-tracking';
import { getTaskStageState, TASK_STATUS_STAGE } from '../../src/views/task/task-stage';

test('目标确认后该环节显示已完成，但不提前开放自评', () => {
  expect(TASK_STATUS_STAGE.goal_confirmed).toBe('goal-confirmation');
  expect(getTaskStageState(['goal_confirmed'])).toBe('completed');
  expect(TASK_STATUS_STAGE.goal_confirmed).not.toBe('self-eval');
});

function makeCycle(
  id: string,
  name: string,
  startDate: string,
  type: AssessmentCycle['type'] = 'quarterly',
): AssessmentCycle {
  return {
    id,
    name,
    type,
    startDate,
    endDate: startDate,
    status: 'closed',
    publishVisibleFields: {
      totalScore: true,
      grade: true,
      indicatorScores: true,
      managerComment: true,
      coefficient: false,
    },
    gradeAMaxRatio: 0.2,
    gradeBMaxRatio: 0.4,
    gradeCMaxRatio: 0.3,
    gradeDMaxRatio: 0.1,
  };
}

test('builds only self and direct-manager people groups', () => {
  const groups = buildTrackingPeople({
    id: 'employee-1',
    name: '刘伟',
    sysRole: 'employee',
    deptId: 'dept-1',
    isAssessorOnly: false,
    canViewAll: false,
    directManagerId: 'manager-1',
    directManagerName: '林治',
  });
  expect(groups.map((group) => [group.key, group.people.map((person) => person.name)]))
    .toEqual([['self', ['刘伟']], ['manager', ['林治']]]);
  expect(buildTrackingPeople({
    id: 'employee-2',
    name: '无上级员工',
    sysRole: 'employee',
    deptId: 'dept-1',
    isAssessorOnly: false,
    canViewAll: false,
  }).map((group) => group.key)).toEqual(['self']);
});

test('chooses the newest in-flight cycle before drafts and closed cycles', () => {
  const cycle = (
    id: string,
    name: string,
    status: AssessmentCycle['status'],
    startDate: string,
    endDate: string,
  ): AssessmentCycle => ({
    id, name, status, startDate, endDate, type: 'quarterly',
    publishVisibleFields: {
      totalScore: true,
      grade: true,
      indicatorScores: true,
      managerComment: true,
      coefficient: false,
    },
    gradeAMaxRatio: 0.2,
    gradeBMaxRatio: 0.4,
    gradeCMaxRatio: 0.3,
    gradeDMaxRatio: 0.1,
  });
  const selected = selectDefaultTrackingCycle([
    cycle('draft', '草稿', 'draft', '2026-08-01', '2026-09-01'),
    cycle('active-old', '进行中一', 'self_eval', '2026-01-01', '2026-03-31'),
    cycle('active-new', '进行中二', 'manager_score', '2026-04-01', '2026-06-30'),
  ]);
  expect(selected?.id).toBe('active-new');
});

test('curates formal goal-tracking quarters and formats reference labels', () => {
  const selected = selectGoalTrackingCycles([
    makeCycle('validation', '2026年二季度绩效考核（全流程验证 20260620-1037-15）', '2026-04-01'),
    makeCycle('history-q3', '2025 Q3 绩效考核（历史）', '2025-07-01'),
    makeCycle('canonical-q1', '2026-Q1', '2026-01-01'),
    makeCycle('annual', '2026年度绩效考核', '2026-01-01', 'annual'),
    makeCycle('canonical-q3', '2026-Q3', '2026-07-01'),
    makeCycle('demo-q1', '2026 Q1 绩效考核（演示）', '2026-01-01'),
    makeCycle('history-q4', '2025 Q4 绩效考核（历史）', '2025-10-01'),
    makeCycle('canonical-q2', '2026-Q2', '2026-04-01'),
  ]);

  expect(selected.map((cycle) => cycle.id)).toEqual([
    'canonical-q3',
    'canonical-q2',
    'canonical-q1',
    'history-q4',
    'history-q3',
  ]);
  expect(selected.map(formatGoalTrackingCycleName)).toEqual([
    '2026 第三季度',
    '2026 第二季度',
    '2026 第一季度',
    '2025 第四季度',
    '2025 第三季度',
  ]);
});

test('maps objective status from archive and progress semantics', () => {
  expect(goalTrackingStatus({ status: 'active', progress: 0 })).toBe('未开始');
  expect(goalTrackingStatus({ status: 'draft', progress: 60 })).toBe('未开始');
  expect(goalTrackingStatus({ status: 'active', progress: 60 })).toBe('进行中');
  expect(goalTrackingStatus({ status: 'active', progress: 100 })).toBe('已完成');
  expect(goalTrackingStatus({ status: 'archived', progress: 60 })).toBe('已归档');
});

test('maps indicator progress health independently from assessment lifecycle state', () => {
  expect(goalTrackingStatus({ progress: 0, healthStatus: null } as any)).toBe('未开始');
  expect(goalTrackingStatus({ progress: 35, healthStatus: 'on_track' } as any)).toBe('正常');
  expect(goalTrackingStatus({ progress: 60, healthStatus: 'at_risk' } as any)).toBe('存在风险');
  expect(goalTrackingStatus({ progress: 70, healthStatus: 'blocked' } as any)).toBe('已阻塞');
  expect(goalTrackingStatus({ progress: 100, healthStatus: 'completed' } as any)).toBe('已完成');
});

test('validates persisted visible columns and collapse booleans', () => {
  expect(parseVisibleColumns('["status","weight","unknown"]'))
    .toEqual(['status', 'weight']);
  expect(parseVisibleColumns('["status","status","weight"]'))
    .toEqual(['status', 'weight']);
  expect(parseVisibleColumns('["weight","unknown","status"]'))
    .toEqual(['status', 'weight']);
  expect(parseVisibleColumns('{broken')).toEqual([
    'latestProgress', 'status', 'progress', 'weight',
  ]);
  expect(parseCollapsedPeopleGroups('{"self":true,"manager":false,"x":"bad"}'))
    .toEqual({ self: true, manager: false });
});
