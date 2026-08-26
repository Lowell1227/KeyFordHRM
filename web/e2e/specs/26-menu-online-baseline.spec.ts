import { expect, test } from '@playwright/test';
import { buildNavigation } from '../../src/router/navigation';
import { routes } from '../../src/router/routes';

test.describe('线上一级菜单业务域基线', () => {
  test('系统管理员看到完整业务域及两个规划中模块', () => {
    const navigation = buildNavigation(routes, {
      sysRole: 'system_admin',
      canViewAll: true,
    });

    expect(navigation.map(({ key, label, status }) => ({ key, label, status }))).toEqual([
      { key: 'workbench', label: '工作台', status: undefined },
      { key: 'performance', label: '绩效', status: undefined },
      { key: 'people', label: '人员', status: undefined },
      { key: 'recruitment', label: '招聘', status: 'paused' },
      { key: 'compensation', label: '薪酬', status: 'paused' },
      { key: 'system', label: '系统管理', status: undefined },
    ]);
  });

  test('HR 看到人员和系统管理，但看不到招聘与薪酬规划模块', () => {
    const navigation = buildNavigation(routes, {
      sysRole: 'hr',
      canViewAll: true,
    });

    expect(navigation.map(({ key, label }) => ({ key, label }))).toEqual([
      { key: 'workbench', label: '工作台' },
      { key: 'performance', label: '绩效' },
      { key: 'people', label: '人员' },
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
});
