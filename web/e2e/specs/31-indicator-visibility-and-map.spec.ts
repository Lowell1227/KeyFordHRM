import { expect, test, type Page, type Request } from '@playwright/test';

const apiResponse = (data: unknown) => ({ code: 0, message: 'success', data, timestamp: Date.now() });
const cycleId = '11111111-1111-4111-8111-111111111111';
const taskId = '22222222-2222-4222-8222-222222222222';
const parentIndicatorId = '33333333-3333-4333-8333-333333333333';

function taskDetail() {
  return {
    id: taskId,
    cycleId,
    cycleName: '2026 Q3 季度考核',
    workflowVersion: 2,
    employeeId: 'employee-1',
    employeeName: '方园',
    employeeNo: 'KF001',
    deptId: 'dept-1',
    deptName: '人事组',
    managerId: 'manager-1',
    managerName: '姚瑶',
    status: 'indicator_setting',
    isExempt: false,
    updatedAt: '2026-09-01T08:00:00.000Z',
    periods: [],
    indicatorInstances: [{
      id: 'indicator-1', taskId, name: '重点岗位招聘交付', description: '', scoringStandard: '',
      weight: 1, dimensionWeight: 1, indicatorType: 'kpi', sortOrder: 0,
      visibilityScope: 'supervisors', visibilityScopes: ['supervisors'],
      visibleDepartmentIds: [], visibleUserIds: [], alignedObjectives: [], alignedParentIndicators: [],
    }],
    flowRecords: [],
    workflowContext: {
      stage: 'goal_setting', statusLabel: '目标制定中',
      currentHandler: { id: 'employee-1', name: '方园', nodeType: 'employee' },
      currentDeadline: null, canRemind: false, reminderNodeType: 'employee', reminderAvailableAt: null,
    },
  };
}

async function mockGoalSetting(page: Page, requests: Request[]) {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'indicator-visibility-contract');
    localStorage.setItem('expiresAt', String(Date.now() + 60_000));
  });
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(apiResponse(0)),
  }));
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({
      id: 'employee-1', name: '方园', deptId: 'dept-1', deptName: '人事组', sysRole: 'employee',
      isAssessorOnly: false, canViewAll: false,
    })),
  }));
  await page.route(`**/api/v1/cycles/${cycleId}`, (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({
      id: cycleId, name: '2026 Q3 季度考核', type: 'quarterly', startDate: '2026-07-01',
      endDate: '2026-09-30', status: 'indicator_setting', publishVisibleFields: {},
      gradeAMaxRatio: .2, gradeBMaxRatio: .4, gradeCMaxRatio: .3, gradeDMaxRatio: .1,
    })),
  }));
  await page.route('**/api/v1/tasks/reference-indicators**', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(apiResponse({ page: 1, pageSize: 20, total: 0, items: [] })),
  }));
  await page.route('**/api/v1/objectives**', (route) => {
    const data = route.request().url().includes('/alignment-candidates')
      ? {
          items: [{ id: parentIndicatorId, name: '人力成本优化', owner: { id: 'manager-1', name: '姚瑶' } }],
          reason: null,
        }
      : [];
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(apiResponse(data)) });
  });
  await page.route('**/api/v1/departments**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse([{ id: 'dept-1', name: '人事组', isActive: true, children: [] }])),
  }));
  await page.route(`**/api/v1/tasks/${taskId}/indicators`, (route) => {
    requests.push(route.request());
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(apiResponse(taskDetail())) });
  });
  await page.route(`**/api/v1/tasks/${taskId}`, (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(apiResponse(taskDetail())),
  }));
}

test('goal setting persists grouped multi-scope permissions and frozen-manager indicator alignment', async ({ page }) => {
  const requests: Request[] = [];
  await mockGoalSetting(page, requests);
  await page.goto(`/tasks/${taskId}?stage=goal-setting`);

  const visibility = page.getByTestId('indicator-visibility-indicator-1');
  await expect(visibility).toContainText('绩效直属上级可见');
  await visibility.locator('.el-select__caret').click();
  await expect(page.getByText('汇报关系', { exact: true })).toBeVisible();
  await expect(page.getByText('组织范围', { exact: true })).toBeVisible();
  await expect(page.getByText('指定范围', { exact: true })).toBeVisible();
  await page.getByRole('option', { name: '本部门可见' }).click();
  await page.keyboard.press('Escape');
  await expect(visibility).toContainText('绩效直属上级可见');
  await expect(visibility).toContainText('本部门可见');

  await page.getByTestId('goal-parent-align-open-0').click();
  await page.getByTestId('goal-parent-align-select-0').click();
  await page.getByRole('option', { name: '人力成本优化（姚瑶）' }).click();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].postDataJSON()).toMatchObject({
    action: 'save',
    instances: [{
      visibilityScopes: ['supervisors', 'department'],
      alignedParentIndicatorIds: [parentIndicatorId],
    }],
  });
});

test('company visibility is exclusive and at least one permission always remains', async ({ page }) => {
  await mockGoalSetting(page, []);
  await page.goto(`/tasks/${taskId}?stage=goal-setting`);
  const visibility = page.getByTestId('indicator-visibility-indicator-1');
  await visibility.locator('.el-select__caret').click();
  await page.getByRole('option', { name: '全公司可见' }).click();
  await page.keyboard.press('Escape');
  await expect(visibility).toContainText('全公司可见');
  await expect(visibility).not.toContainText('绩效直属上级可见');
});

async function mockIndicatorMap(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'indicator-map-contract');
    localStorage.setItem('expiresAt', String(Date.now() + 60_000));
  });
  await page.route('**/api/v1/notifications/unread-count', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(apiResponse(0)),
  }));
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({
      id: 'employee-1', name: '方园', deptId: 'dept-1', deptName: '人事组', sysRole: 'employee',
      isAssessorOnly: false, canViewAll: false,
    })),
  }));
  await page.route('**/api/v1/cycles?**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse({
      page: 1, pageSize: 100, total: 1,
      items: [{
        id: cycleId, name: '2026 Q3 季度考核', type: 'quarterly', startDate: '2026-07-01',
        endDate: '2026-09-30', status: 'indicator_setting', publishVisibleFields: {},
        gradeAMaxRatio: .2, gradeBMaxRatio: .4, gradeCMaxRatio: .3, gradeDMaxRatio: .1,
      }],
    })),
  }));
  await page.route('**/api/v1/cycles/mine', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(apiResponse([{
      id: cycleId, name: '2026 Q3 季度考核', type: 'quarterly', startDate: '2026-07-01',
      endDate: '2026-09-30', status: 'indicator_setting', publishVisibleFields: {},
      gradeAMaxRatio: .2, gradeBMaxRatio: .4, gradeCMaxRatio: .3, gradeDMaxRatio: .1,
    }])),
  }));
  await page.route('**/api/v1/objectives**', (route) => {
    if (!route.request().url().includes('/indicator-map')) {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(apiResponse([])) });
    }
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(apiResponse({
        cycle: { id: cycleId, name: '2026 Q3 季度考核', startDate: '2026-07-01', endDate: '2026-09-30' },
        roots: ['manager-indicator'],
        nodes: [{
          id: 'manager-indicator', name: '提升组织效能', description: '绩效直属上级指标', weight: 100,
          progress: 40, sortOrder: 0, visibilityScopes: ['direct_reports'],
          owner: { id: 'manager-1', name: '姚瑶', deptId: 'dept-1', deptName: '人事组' },
        }, {
          id: 'employee-indicator', name: '完成重点岗位招聘', description: '我的指标', weight: 100,
          progress: 60, sortOrder: 0, visibilityScopes: ['supervisors'],
          owner: { id: 'employee-1', name: '方园', deptId: 'dept-1', deptName: '人事组' },
        }],
        edges: [{ id: 'manager-indicator:employee-indicator', source: 'manager-indicator', target: 'employee-indicator' }],
        sameDepartmentUnaligned: [{
          id: 'peer-indicator', name: '推动培训落地', description: '同部门可见指标', weight: 50,
          progress: 20, sortOrder: 0, visibilityScopes: ['department'],
          owner: { id: 'peer-1', name: '同事甲', deptId: 'dept-1', deptName: '人事组' },
        }],
        permissions: { viewerTaskId: taskId, viewerId: 'employee-1', managerId: 'manager-1', canViewSameDepartment: true },
      })),
    });
  });
}

test('indicator map renders explicit alignment and keeps visible peer indicators outside the graph', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await mockIndicatorMap(page);
  await page.goto(`/objectives?cycleId=${cycleId}`);

  await expect(page.getByTestId('objective-map-card-manager-indicator')).toContainText('提升组织效能');
  await expect(page.getByTestId('objective-map-card-employee-indicator')).toContainText('完成重点岗位招聘');
  await expect(page.getByTestId('objective-map-edges').locator('path')).toHaveCount(1);
  const unaligned = page.getByTestId('indicator-map-unaligned');
  await expect(unaligned).toContainText('同部门可见 · 未对齐');
  await expect(unaligned).toContainText('推动培训落地');
  await expect(page.locator('body')).not.toContainText('hidden-parent');
});

test('mobile indicator map stacks the unaligned panel below the graph without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockIndicatorMap(page);
  await page.goto(`/objectives?cycleId=${cycleId}`);

  const canvas = page.getByTestId('objective-map-canvas');
  const unaligned = page.getByTestId('indicator-map-unaligned');
  await expect(canvas).toBeVisible();
  await expect(unaligned).toBeVisible();
  const canvasBox = await canvas.boundingBox();
  const unalignedBox = await unaligned.boundingBox();
  expect(canvasBox).not.toBeNull();
  expect(unalignedBox).not.toBeNull();
  expect(unalignedBox!.y).toBeGreaterThanOrEqual(canvasBox!.y + canvasBox!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
