import { expect, test } from '@playwright/test';
import type { Router } from 'vue-router';
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

test('employees cannot normalize unknown scope or stage values', () => {
  expect(parseTaskWorkspaceQuery({ scope: 'bad', stage: 'bad' })).toEqual(
    expect.objectContaining({ scope: 'mine', stage: 'goal-review' }),
  );
});

test('serializes a patched workspace query in stable order and removes empty values', async () => {
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
      stage: 'manager-eval',
      scope: 'team',
      ignored: 'value',
    },
    { keyword: '', cycleId: 'cycle-1' },
  );

  expect(replacement).toEqual({
    query: {
      scope: 'team',
      stage: 'manager-eval',
      cycleId: 'cycle-1',
      taskId: 'task-1',
    },
  });
});
