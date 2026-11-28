import { expect, test } from '@playwright/test';
import { buildNavigation, canAccessRoute, type NavigationUser } from '../../src/router/navigation';
import { routes } from '../../src/router/routes';

test.describe('线上一级菜单业务域基线', () => {
  test('系统管理员看到完整业务域，招聘可用且薪酬仍为规划模块', () => {
    const navigation = buildNavigation(routes, {
      sysRole: 'system_admin',
      canViewAll: true,
    });

    expect(navigation.map(({ key, label, status }) => ({ key, label, status }))).toEqual([
      { key: 'workbench', label: '工作台', status: undefined },
      { key: 'performance', label: '绩效', status: undefined },
      { key: 'people', label: '人员', status: undefined },
      { key: 'recruitment', label: '招聘', status: undefined },
      { key: 'compensation', label: '薪酬', status: 'paused' },
      { key: 'system', label: '系统管理', status: undefined },
    ]);
  });

  test('HR 看到人员、招聘和系统管理，但看不到薪酬规划模块', () => {
    const navigation = buildNavigation(routes, {
      sysRole: 'hr',
      canViewAll: true,
    });

    expect(navigation.map(({ key, label }) => ({ key, label }))).toEqual([
      { key: 'workbench', label: '工作台' },
      { key: 'performance', label: '绩效' },
      { key: 'people', label: '人员' },
      { key: 'recruitment', label: '招聘' },
      { key: 'system', label: '系统管理' },
    ]);
  });

  test('员工只看到工作台、绩效和人员', () => {
    const navigation = buildNavigation(routes, {
      sysRole: 'employee',
      canViewAll: false,
    });

    expect(navigation.map(({ key, label }) => ({ key, label }))).toEqual([
      { key: 'workbench', label: '工作台' },
      { key: 'performance', label: '绩效' },
      { key: 'people', label: '人员' },
    ]);
  });

  for (const capability of ['employee_archive_edit', 'employee_archive_review'] as const) {
    test(`${capability} 沿用现有共享招聘能力，不获得录用确认或规划权限`, () => {
      const user: NavigationUser = { sysRole: 'hr_user', canViewAll: false, hrCapabilities: [capability] };
      const recruitment = buildNavigation(routes, user).find(({ key }) => key === 'recruitment');

      expect(recruitment?.defaultPath).toBe('/recruitment/demands');
      expect(recruitment?.groups.flatMap(({ items }) => items.map(({ path }) => path))).toEqual([
        '/recruitment/demands', ...(capability === 'employee_archive_edit' ? ['/recruitment/intakes'] : []),
        '/talents', '/talent-interviews',
      ]);
      for (const path of ['/talent-hiring', '/recruitment/planning', '/compensation']) {
        expect(canAccessRoute(routes.find((route) => route.path === path)!, user)).toBe(false);
      }
    });
  }

  test('普通面试官没有招聘菜单，但仍能通过原链接进入本人面试队列', () => {
    const user: NavigationUser = { sysRole: 'employee', canViewAll: false };
    expect(buildNavigation(routes, user).some(({ key }) => key === 'recruitment')).toBe(false);
    for (const path of ['/talent-interviews', '/talent-interviews/:id']) {
      expect(canAccessRoute(routes.find((route) => route.path === path)!, user)).toBe(true);
    }
    for (const path of ['/recruitment', '/talents', '/talent-hiring', '/recruitment/planning', '/compensation']) {
      expect(canAccessRoute(routes.find((route) => route.path === path)!, user)).toBe(false);
    }
  });

  test('仅录用确认能力的用户只看到确认页，系统管理员不默认获得该能力', () => {
    const user: NavigationUser = { sysRole: 'employee', canViewAll: false, hrCapabilities: ['talent_hiring_confirm'] };
    const recruitment = buildNavigation(routes, user).find(({ key }) => key === 'recruitment');
    expect(recruitment?.defaultPath).toBe('/talent-hiring');
    expect(recruitment?.groups.flatMap(({ items }) => items.map(({ path }) => path))).toEqual(['/talent-hiring']);
    const hiring = routes.find((route) => route.path === '/talent-hiring')!;
    expect(canAccessRoute(hiring, user)).toBe(true);
    expect(canAccessRoute(hiring, { sysRole: 'system_admin', canViewAll: true })).toBe(false);
    for (const path of ['/talents', '/recruitment/planning', '/compensation']) {
      expect(canAccessRoute(routes.find((route) => route.path === path)!, user)).toBe(false);
    }
  });
});
