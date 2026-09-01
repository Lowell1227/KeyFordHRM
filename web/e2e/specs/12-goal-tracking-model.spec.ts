import { expect, test } from '@playwright/test';
import type { AssessmentCycle } from '../../src/types/api.types';
import {
  buildTrackingPeople,
  formatGoalTrackingContextLabel,
  formatGoalTrackingCycleName,
  goalTrackingStatus,
  selectGoalTrackingContexts,
  selectTrackingAction,
  parseCollapsedPeopleGroups,
  parseVisibleColumns,
  selectDefaultTrackingCycle,
  selectGoalTrackingCycles,
} from '../../src/views/objectives/goal-tracking';
import { getTaskStageState, TASK_STATUS_STAGE } from '../../src/views/task/task-stage';
import { buildIndicatorVersionHistory } from '../../src/views/objectives/indicator-version-history';

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
    planVersion: 1,
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

test('builds self and the cycle-frozen performance manager instead of the current roster manager', () => {
  const context = {
    id: 'cycle-1',
    name: '2026 Q3',
    type: 'quarterly',
    startDate: '2026-07-01',
    endDate: '2026-09-30',
    openedAt: '2026-06-20T00:00:00.000Z',
    scoringFrequency: 'monthly',
    task: {
      id: 'task-1',
      status: 'self_eval',
      isExempt: false,
      exemptReason: null,
      participantDisposition: 'active',
      manager: { id: 'manager-frozen', name: '冻结上级' },
    },
    periods: [],
  } as const;
  const groups = buildTrackingPeople({
    id: 'employee-1',
    name: '刘伟',
    sysRole: 'employee',
    deptId: 'dept-1',
    isAssessorOnly: false,
    canViewAll: false,
    directManagerId: 'manager-current',
    directManagerName: '当前花名册上级',
  }, [context], 'cycle-1');
  expect(groups.map((group) => [group.key, group.people.map((person) => person.name)]))
    .toEqual([['self', ['刘伟']], ['manager', ['冻结上级']]]);
  expect(groups[1].label).toBe('绩效直属上级');
  expect(buildTrackingPeople({
    id: 'employee-2',
    name: '无上级员工',
    sysRole: 'employee',
    deptId: 'dept-1',
    isAssessorOnly: false,
    canViewAll: false,
  }, [{ ...context, task: { ...context.task, manager: null } }], 'cycle-1')
    .map((group) => group.key)).toEqual(['self']);
});

test('chooses the date-current cycle regardless of lifecycle status', () => {
  const cycle = (
    id: string,
    name: string,
    status: AssessmentCycle['status'],
    startDate: string,
    endDate: string,
  ): AssessmentCycle => ({
    id, planVersion: 1, name, status, startDate, endDate, type: 'quarterly',
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
    cycle('current', '当前周期', 'draft', '2026-08-01', '2026-09-01'),
    cycle('active-old', '进行中一', 'self_eval', '2026-01-01', '2026-03-31'),
    cycle('active-new', '进行中二', 'manager_score', '2026-04-01', '2026-06-30'),
  ], '2026-08-16');
  expect(selected?.id).toBe('current');
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

test('keeps same-name opened cycles distinct and selects the actionable employee period', () => {
  const contexts = selectGoalTrackingContexts([{
    id: 'cycle-exempt', name: '2026年08月绩效考核', type: 'monthly',
    startDate: '2026-08-01', endDate: '2026-08-31', openedAt: '2026-08-20T02:51:00.000Z',
    scoringFrequency: 'cycle',
    task: { id: 'task-exempt', status: 'exempted', isExempt: true, exemptReason: '本周期豁免', participantDisposition: 'cycle_exempt' },
    periods: [],
  }, {
    id: 'cycle-active', name: '2026年08月绩效考核', type: 'monthly',
    startDate: '2026-08-01', endDate: '2026-08-31', openedAt: '2026-08-30T06:35:00.000Z',
    scoringFrequency: 'monthly',
    task: { id: 'task-active', status: 'self_eval', isExempt: false, exemptReason: null, participantDisposition: 'active' },
    periods: [{
      id: 'period-aug', periodKey: '2026-08', periodType: 'month', sequence: 1,
      status: 'self_eval', selfEvalOpenAt: '2026-08-29T10:00:00.000Z', selfEvalDueAt: '2026-08-31T10:00:00.000Z',
      managerDueAt: '2026-09-03T10:00:00.000Z', employeeSubmittedAt: null, managerSubmittedAt: null,
      selfScoreTotal: null, managerScoreTotal: null,
    }],
  }], '2026-08-30');

  expect(contexts.map((context) => context.id)).toEqual(['cycle-active', 'cycle-exempt']);
  expect(formatGoalTrackingContextLabel(contexts[0])).toContain('每月复盘');
  expect(formatGoalTrackingContextLabel(contexts[1])).toContain('已豁免');
  expect(selectTrackingAction(contexts[0])).toMatchObject({ kind: 'review', periodId: 'period-aug' });
  expect(selectTrackingAction(contexts[1])).toMatchObject({ kind: 'exempt' });
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

test('keeps execution updates out of formal indicator versions and shows only changed fields', () => {
  const versions = buildIndicatorVersionHistory([
    {
      id: 'progress', taskId: 'task-1', cycleId: 'cycle-1',
      action: 'progress_update', oldValue: null, newValue: { progress: 60 },
      actorId: 'employee-1', actorName: '刘伟', createdAt: '2026-08-20T08:00:00.000Z',
    },
    {
      id: 'unsupported-delete', taskId: 'task-1', cycleId: 'cycle-1',
      action: 'indicator_deleted', oldValue: { version: 2 }, newValue: { version: 3 },
      actorId: 'manager-1', actorName: '林治', createdAt: '2026-08-19T08:00:00.000Z',
    },
    {
      id: 'v2', taskId: 'task-1', cycleId: 'cycle-1',
      action: 'indicator_updated',
      oldValue: { version: 1, name: '产品上线', description: '完成开发', weight: 0.5 },
      newValue: { version: 2, name: '产品上线', description: '完成开发及验收', weight: 0.5, reason: '增加验收要求' },
      actorId: 'manager-1', actorName: '林治', createdAt: '2026-08-18T08:00:00.000Z',
    },
    {
      id: 'v1', taskId: 'task-1', cycleId: 'cycle-1',
      action: 'indicator_baseline_confirmed', oldValue: null,
      newValue: { version: 1, name: '产品上线', description: '完成开发', weight: 0.5 },
      actorId: 'employee-1', actorName: '刘伟', createdAt: '2026-07-01T08:00:00.000Z',
    },
  ] as any);

  expect(versions.map((version) => [version.id, version.version, version.isCurrent]))
    .toEqual([['v2', 2, true], ['v1', 1, false]]);
  expect(versions[0].changes).toEqual([{
    field: 'description',
    label: '指标描述',
    before: '完成开发',
    after: '完成开发及验收',
  }]);
  expect(versions[0].reason).toBe('增加验收要求');
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
