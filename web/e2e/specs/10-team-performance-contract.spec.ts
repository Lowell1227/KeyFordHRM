import { expect, test } from '@playwright/test';
import type { Router } from 'vue-router';
import { createTasksApi } from '../../src/api/tasks.api';
import type {
  BatchReviewResult,
  IndicatorInstance,
  IndicatorReferenceItem,
  Paginated,
  TeamTaskPage,
} from '../../src/types/api.types';
import {
  parseTaskWorkspaceQuery,
  updateTaskWorkspaceQuery,
} from '../../src/views/task/use-task-workspace-query';

test('normalizes team workspace query', () => {
  expect(
    parseTaskWorkspaceQuery({
      scope: 'team',
      stage: 'manager-eval',
      cycleId: 'cycle-1',
      taskId: 'task-1',
    }),
  ).toEqual(
    expect.objectContaining({
      scope: 'team',
      stage: 'manager-eval',
      cycleId: 'cycle-1',
      taskId: 'task-1',
    }),
  );
});

test('validates stage state and drops unknown query keys', () => {
  expect(
    parseTaskWorkspaceQuery({
      scope: 'bad',
      stage: 'bad',
      stageState: 'not-a-stage-state',
      unknown: 'discard-me',
    }),
  ).toEqual(
    expect.objectContaining({
      scope: 'mine',
      stage: 'goal-review',
      stageState: undefined,
    }),
  );
});

test('serializes a patched workspace query in stable order, removes unknown keys, and resets page for filters', async () => {
  let replacement: unknown;
  const replace = async (location: unknown) => {
    replacement = location;
  };
  const router = { replace } as unknown as Router;

  await updateTaskWorkspaceQuery(
    router,
    {
      keyword: 'Ada',
      taskId: 'task-1',
      page: '3',
      stage: 'manager-eval',
      scope: 'team',
      ignored: 'value',
    },
    { keyword: '', cycleId: 'cycle-1' },
  );

  const query = (replacement as { query: Record<string, string> }).query;
  expect(query).toEqual({
    scope: 'team',
    stage: 'manager-eval',
    cycleId: 'cycle-1',
    taskId: 'task-1',
  });
  expect(Object.keys(query)).toEqual(['scope', 'stage', 'cycleId', 'taskId']);
});

test('does not replace the route when its canonical query is unchanged', async () => {
  let calls = 0;
  const router = {
    replace: async () => {
      calls += 1;
    },
  } as unknown as Router;

  await updateTaskWorkspaceQuery(
    router,
    {
      scope: 'team',
      stage: 'manager-eval',
      cycleId: 'cycle-1',
      taskId: 'task-1',
      stageState: 'pending',
      keyword: 'Ada',
      page: '2',
    },
    {},
  );

  expect(calls).toBe(0);
});

test('preserves a valid page for task selection while resetting it for filters', async () => {
  let replacement: unknown;
  const router = {
    replace: async (location: unknown) => {
      replacement = location;
    },
  } as unknown as Router;

  await updateTaskWorkspaceQuery(
    router,
    { scope: 'team', stage: 'manager-eval', page: '2' },
    { taskId: 'task-1' },
  );

  expect(replacement).toEqual({
    query: {
      scope: 'team',
      stage: 'manager-eval',
      taskId: 'task-1',
      page: '2',
    },
  });
});

test('uses the six team workspace API contracts without a server or login', async () => {
  const teamPage: TeamTaskPage = {
    total: 1,
    page: 1,
    pageSize: 20,
    items: [
      {
        id: 'task-1',
        cycleId: 'cycle-1',
        cycleName: '2026 H1',
        employeeId: 'employee-1',
        employeeName: 'Ada',
        deptId: null,
        deptName: null,
        managerId: 'manager-1',
        status: 'self_evaluation',
        totalScore: null,
        rawGrade: null,
        updatedAt: '2026-08-09T00:00:00.000Z',
        employeeNo: null,
        avatarUrl: null,
        position: null,
        stageState: 'pending',
      },
    ],
    counts: { all: 1, notStarted: 0, pending: 1, completed: 0, exempted: 0 },
    facets: {
      departments: [{ id: 'dept-1', name: 'Engineering' }],
      employees: [{ id: 'employee-1', name: 'Ada', employeeNo: null, deptId: null }],
    },
  };
  const referencePage: Paginated<IndicatorReferenceItem> = {
    total: 1,
    page: 1,
    pageSize: 20,
    items: [
      {
        id: 'indicator-1',
        taskId: 'task-1',
        cycleId: 'cycle-1',
        employeeId: 'employee-1',
        employeeName: 'Ada',
        name: 'Delivery',
        weight: 100,
        visibilityScope: 'public',
      },
    ],
  };
  const reviewResult: BatchReviewResult = {
    succeeded: [{ taskId: 'task-1', status: 'indicator_setting' }],
    failed: [],
  };
  const alignedObjective: Pick<IndicatorInstance, 'alignedObjectives'> = {
    alignedObjectives: [{ id: 'objective-1', title: 'Ship', level: 'company', ownerId: null }],
  };
  const calls: Array<{ method: string; url: string; body?: unknown; params?: unknown }> = [];
  const responses = [teamPage, referencePage, reviewResult, reviewResult, { id: 'task-1', status: 'manager_scoring' }, { id: 'task-1', status: 'self_evaluation' }];
  const client = {
    get: async (url: string, config?: { params?: unknown }) => {
      calls.push({ method: 'GET', url, params: config?.params });
      return responses.shift();
    },
    post: async (url: string, body?: unknown) => {
      calls.push({ method: 'POST', url, body });
      return responses.shift();
    },
    put: async (url: string, body?: unknown) => {
      calls.push({ method: 'PUT', url, body });
      return responses.shift();
    },
  };
  const api = createTasksApi(client);

  const team = await api.findTeam({ stage: 'manager-eval', stageState: 'pending' });
  const references = await api.findReferenceIndicators({ cycleId: 'cycle-1' });
  const approved = await api.batchApproveIndicators({
    tasks: [{ taskId: 'task-1', updatedAt: '2026-08-09T00:00:00.000Z' }],
  });
  const rejected = await api.batchRejectIndicators({
    tasks: [{ taskId: 'task-1', updatedAt: '2026-08-09T00:00:00.000Z' }],
    reason: 'Needs evidence',
  });
  const draft = await api.saveManagerEvaluationDraft('task-1', {
    expectedUpdatedAt: '2026-08-09T00:00:00.000Z',
    indicators: [{ id: 'indicator-1', managerScore: 95, managerComment: 'Strong delivery' }],
    evalSummary: { strengths: 'Execution' },
  });
  const withdrawn = await api.withdrawManagerScore('task-1', {
    expectedUpdatedAt: '2026-08-09T00:00:01.000Z',
  });

  expect(team.items[0].employeeNo).toBeNull();
  expect(team.items[0].deptId).toBeNull();
  expect(references.items[0].visibilityScope).toBe('public');
  expect(approved.succeeded[0].status).toBe('indicator_setting');
  expect(rejected.failed).toEqual([]);
  expect(draft).toEqual({ id: 'task-1', status: 'manager_scoring' });
  expect(withdrawn).toEqual({ id: 'task-1', status: 'self_evaluation' });
  expect(alignedObjective.alignedObjectives[0].ownerId).toBeNull();
  expect(calls).toEqual([
    { method: 'GET', url: '/tasks/team', params: { stage: 'manager-eval', stageState: 'pending' } },
    { method: 'GET', url: '/tasks/reference-indicators', params: { cycleId: 'cycle-1' } },
    { method: 'POST', url: '/tasks/team/indicator-review/batch-approve', body: { tasks: [{ taskId: 'task-1', updatedAt: '2026-08-09T00:00:00.000Z' }] } },
    { method: 'POST', url: '/tasks/team/indicator-review/batch-reject', body: { tasks: [{ taskId: 'task-1', updatedAt: '2026-08-09T00:00:00.000Z' }], reason: 'Needs evidence' } },
    { method: 'PUT', url: '/tasks/task-1/manager-evaluation-draft', body: { expectedUpdatedAt: '2026-08-09T00:00:00.000Z', indicators: [{ id: 'indicator-1', managerScore: 95, managerComment: 'Strong delivery' }], evalSummary: { strengths: 'Execution' } } },
    { method: 'POST', url: '/tasks/task-1/manager-score/withdraw', body: { expectedUpdatedAt: '2026-08-09T00:00:01.000Z' } },
  ]);
});
