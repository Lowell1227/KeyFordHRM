import { expect, test } from '@playwright/test';
import { buildNavigation, canAccessRoute } from '../../src/router/navigation';
import { routes } from '../../src/router/routes';
import { formatBusinessIdentityLabel } from '../../src/components/layout/business-identity';
import {
  canOperatePerformanceApproval,
  canOperatePerformanceApprovalTask,
} from '../../src/utils/business-permissions';

const emptyCapabilities = {
  canManageTeam: false,
  canReviewDepartment: false,
  canViewPerformanceApproval: false,
  canOperatePerformanceApproval: false,
  canHandleHrCycle: false,
  identities: [],
};

test('dynamic approval identity exposes the approval entry to an employee', () => {
  const modules = buildNavigation(routes, {
    sysRole: 'employee',
    canViewAll: false,
    businessCapabilities: {
      ...emptyCapabilities,
      canViewPerformanceApproval: true,
      canOperatePerformanceApproval: true,
    },
  });

  expect(JSON.stringify(modules)).toContain('结果审批');
});

test('explicit capabilities replace legacy VP entry while missing payload keeps fallback', () => {
  const explicit = buildNavigation(routes, {
    sysRole: 'vp',
    canViewAll: false,
    businessCapabilities: emptyCapabilities,
  });
  const legacy = buildNavigation(routes, {
    sysRole: 'vp',
    canViewAll: false,
  });

  expect(JSON.stringify(explicit)).not.toContain('结果审批');
  expect(JSON.stringify(legacy)).toContain('结果审批');
});

test('team capability opens the team route without changing base role', () => {
  const managerRoute = routes.find((route) => route.path === '/manager/scoring');
  expect(managerRoute).toBeTruthy();
  expect(canAccessRoute(managerRoute!, {
    sysRole: 'employee',
    canViewAll: false,
    businessCapabilities: { ...emptyCapabilities, canManageTeam: true },
  })).toBe(true);
  expect(canAccessRoute(managerRoute!, {
    sysRole: 'employee',
    canViewAll: false,
    businessCapabilities: emptyCapabilities,
  })).toBe(false);
});

test('multiple business identities retain clear labels and counts', () => {
  expect([
    { type: 'performance_manager' as const, label: '绩效直属上级', count: 3 },
    { type: 'performance_approver' as const, label: '最终业务审批人', count: 1 },
  ].map(formatBusinessIdentityLabel)).toEqual([
    '绩效直属上级 · 3 项',
    '最终业务审批人 · 1 项',
  ]);
});

test('read-all capability does not expose approval actions', () => {
  expect(canOperatePerformanceApproval({
    sysRole: 'chairman',
    businessCapabilities: {
      ...emptyCapabilities,
      canViewPerformanceApproval: true,
    },
  })).toBe(false);
  expect(canOperatePerformanceApproval({
    sysRole: 'employee',
    businessCapabilities: {
      ...emptyCapabilities,
      canViewPerformanceApproval: true,
      canOperatePerformanceApproval: true,
    },
  })).toBe(true);
});

test('mixed read-all lists expose actions only on rows assigned to the current approver', () => {
  const user = {
    id: 'approver-1',
    sysRole: 'employee' as const,
    businessCapabilities: {
      ...emptyCapabilities,
      canViewPerformanceApproval: true,
      canOperatePerformanceApproval: true,
    },
  };

  expect(canOperatePerformanceApprovalTask(user, 'approver-1')).toBe(true);
  expect(canOperatePerformanceApprovalTask(user, 'approver-2')).toBe(false);
  expect(canOperatePerformanceApprovalTask(user, null)).toBe(false);
});
