import { expect, test } from '@playwright/test';
import type { AssessmentCycle } from '../../src/types/api.types';
import {
  buildTrackingPeople,
  goalTrackingStatus,
  parseCollapsedPeopleGroups,
  parseVisibleColumns,
  selectDefaultTrackingCycle,
} from '../../src/views/objectives/goal-tracking';

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

test('maps objective status from archive and progress semantics', () => {
  expect(goalTrackingStatus({ status: 'active', progress: 0 })).toBe('未开始');
  expect(goalTrackingStatus({ status: 'draft', progress: 60 })).toBe('未开始');
  expect(goalTrackingStatus({ status: 'active', progress: 60 })).toBe('进行中');
  expect(goalTrackingStatus({ status: 'active', progress: 100 })).toBe('已完成');
  expect(goalTrackingStatus({ status: 'archived', progress: 60 })).toBe('已归档');
});

test('validates persisted visible columns and collapse booleans', () => {
  expect(parseVisibleColumns('["status","weight","unknown"]'))
    .toEqual(['status', 'weight']);
  expect(parseVisibleColumns('{broken')).toEqual([
    'latestProgress', 'status', 'progress', 'weight',
  ]);
  expect(parseCollapsedPeopleGroups('{"self":true,"manager":false,"x":"bad"}'))
    .toEqual({ self: true, manager: false });
});
