import { expect, test, type Page } from '@playwright/test';

test.use({ baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4173' });

const taskId = 'shared-summary-final-grade-task';

async function setup(page: Page, options: { status?: string; approvedAt?: string } = {}) {
  const writes: string[] = [];
  await page.addInitScript(() => {
    localStorage.setItem('token', 'shared-summary-employee');
    localStorage.setItem('expiresAt', String(Date.now() + 600_000));
  });
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== 'GET') {
      writes.push(`${route.request().method()} ${path}`);
      await route.fulfill({ status: 405, contentType: 'application/json', body: JSON.stringify({ code: 405, message: '只读验收禁止写入' }) });
      return;
    }
    let data: unknown = {};
    if (path.endsWith('/auth/me')) data = { id: 'employee-shared', name: '虚拟员工长姓名用于移动端换行验证', sysRole: 'employee', status: 'active', canViewAll: false, businessCapabilities: { identities: [] } };
    else if (path.endsWith('/notifications/unread-count')) data = 0;
    else if (path.endsWith(`/tasks/${taskId}/final-grade`)) data = {
      taskId,
      cycleId: 'shared-summary-cycle',
      cycleName: '2026年度第三季度跨区域业务协同与绩效结果确认周期',
      employeeName: '虚拟员工长姓名用于移动端换行验证',
      deptName: '华东区域事业群客户成功与业务运营中心',
      position: '跨区域绩效运营与复杂项目交付高级专员',
      managerName: '虚拟直属上级长姓名',
      status: options.status ?? 'published',
      approvedAt: options.approvedAt,
      periods: [{ periodKey: '2026-09', periodType: 'month', status: 'completed', selfGrade: 'B', managerGrade: 'A', selfScoreTotal: 84, managerScoreTotal: 88 }],
      calculatedScore: 88,
      currentGrade: 'A',
      comment: '该员工在跨区域协作项目中保持稳定交付。\n后续建议继续沉淀复杂项目的复盘方法，并向团队共享。',
      allPeriodsComplete: true,
      canSubmit: false,
      latestReject: null,
      flowRecords: [{ id: 'publish', nodeType: 'publish', action: 'submit', actorName: '虚拟绩效专员', createdAt: '2026-09-08T08:00:00.000Z', comment: '结果已按审批结论公示。' }],
    };
    else if (path.endsWith('/tasks/mine')) data = { items: [], total: 0 };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 0, data }) });
  });
  return writes;
}

test('整周期结果详情识别结果审批已通过并等待公示', async ({ page }) => {
  await setup(page, { status: 'approval', approvedAt: '2026-09-08T12:00:00.000Z' });
  await page.goto(`/tasks/${taskId}/final-grade`);
  await expect(page.getByTestId('manager-period-results').getByTestId('performance-result-summary')).toContainText('已通过，待公示');
});

for (const width of [1440, 390]) {
  test(`员工已公示结果使用共享摘要并容纳长文本 ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const writes = await setup(page);
    await page.goto(`/tasks/${taskId}/final-grade`);
    const view = page.getByTestId('manager-period-results');
    const summary = view.getByTestId('performance-result-summary');
    await expect(summary).toBeVisible();
    for (const text of ['2026年度第三季度跨区域业务协同与绩效结果确认周期', '虚拟员工长姓名用于移动端换行验证', '已公示', '华东区域事业群客户成功与业务运营中心', '88.00']) {
      await expect(summary).toContainText(text);
    }
    await expect(summary.getByText('A', { exact: true })).toBeVisible();
    await expect(view.getByTestId('cycle-comment-readonly')).toContainText('后续建议继续沉淀复杂项目的复盘方法');
    await expect(view.getByTestId('review-history')).toContainText('结果已按审批结论公示。');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(writes).toEqual([]);
  });
}
