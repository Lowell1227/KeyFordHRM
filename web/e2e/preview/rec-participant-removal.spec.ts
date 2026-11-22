import { expect, test } from '@playwright/test';
import { createMemoryHistory, createRouter } from 'vue-router';
import { navigateNotificationTarget, resolveNotificationTarget } from '../../src/components/layout/notification-target';

test('removed-participant notice opens the personal queue instead of forbidden detail', async () => {
  const target = resolveNotificationTarget({ taskId: null, cycleId: null, type: 'talent_interview',
    extraData: { invitationId: 'removed-invitation', version: 2, action: 'participant_removed' } }, false);
  expect(target).toEqual({ path: '/talent-interviews' });
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/', component: {} }, { path: '/talent-interviews', component: {} },
    { path: '/talent-interviews/:id', component: {} },
  ] });
  await router.push('/');
  expect(await navigateNotificationTarget(target!, location => router.push(location))).toBe(true);
  expect(router.currentRoute.value.fullPath).toBe('/talent-interviews');
  expect(router.currentRoute.value.params).toEqual({});
});

test('removed-participant notice needs no object ID or role-based detail access', () => {
  for (const canManageTeam of [false, true]) {
    expect(resolveNotificationTarget({ taskId: null, cycleId: null, type: 'talent_interview',
      extraData: { action: 'participant_removed' } }, canManageTeam)).toEqual({ path: '/talent-interviews' });
  }
});

test('ordinary interview updates and whole-interview cancellation keep exact detail links', () => {
  for (const extraData of [{ invitationId: 'current/invitation', version: 2 },
    { invitationId: 'cancelled-invitation', version: 3, action: 'cancel' }]) {
    expect(resolveNotificationTarget({ taskId: null, cycleId: null, type: 'talent_interview', extraData }, false))
      .toEqual({ path: `/talent-interviews/${encodeURIComponent(extraData.invitationId)}` });
  }
});

test('participant removal marker never changes unrelated notification routing', () => {
  expect(resolveNotificationTarget({ taskId: 'task', cycleId: null, type: 'indicator_setting_notice',
    extraData: { action: 'participant_removed' } }, false)).toEqual({ name: 'TaskDetail', params: { id: 'task' } });
  expect(resolveNotificationTarget({ taskId: null, cycleId: null, type: 'talent_interview', extraData: {} }, false)).toBeNull();
});
