import { expect, test } from '@playwright/test';

for (const width of [1440, 1024, 390]) {
  test(`${width}px history compares business dates and keeps genuine changes`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const person = { id: 'synthetic-history-person', name: '合成历史员工', employeeNo: 'SYN074',
      sysRole: 'employee', deptId: 'synthetic-dept', deptName: '合成部门', status: 'active',
      employmentType: 'full_time', hrCapabilities: [], businessIdentities: [], archivedAt: null };
    const contract = { id: 'synthetic-contract', contractType: 'contract', sequence: 0, name: '合成劳动合同',
      signedAt: '2026-02-01T00:00:00.000Z', effectiveFrom: '2026-02-01T00:00:00.000Z', expiresAt: '2026-10-25T00:00:00.000Z' };
    const request = { id: 'synthetic-history-request', userId: person.id, employeeName: person.name,
      sourceType: 'manual_archive_change', recordStatus: 'submitted', profileReviewStatus: 'approved',
      performanceReviewStatus: 'not_required', appliedAt: '2026-11-02T00:00:00Z',
      createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-02T00:00:00Z', validationErrors: [],
      createdBy: { name: '合成人事' }, events: [],
      baseValue: { employee: { workLocation: '合成原办公地', entryDate: '2026-02-01T00:00:00.000Z', plannedRegularDate: null },
        profile: { birthDate: '2000-01-01T00:00:00.000Z', socialSecurityStartDate: '2026-02-01T00:00:00.000Z' }, contracts: [contract] },
      proposedValue: { employee: { workLocation: '合成新办公地', entryDate: '2026-02-01', plannedRegularDate: '' },
        profile: { birthDate: '2000-01-01', socialSecurityStartDate: '2026-03-01' },
        contracts: [{ ...contract, signedAt: '2026-02-01', effectiveFrom: '2026-02-01', expiresAt: '2026-11-25' }] } };
    const writes: string[] = [];
    await page.addInitScript(() => {
      localStorage.setItem('token', 'SYNTHETIC-HISTORY-ONLY');
      localStorage.setItem('expiresAt', String(Date.now() + 600_000));
    });
    await page.route('**/api/v1/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (route.request().method() !== 'GET') writes.push(path);
      let data: unknown = [];
      if (path.endsWith('/auth/me')) data = { id: 'synthetic-hr', name: '合成人事', sysRole: 'hr_user', hrCapabilities: ['employee_archive_edit'] };
      else if (path.endsWith('/notifications/unread-count')) data = 0;
      else if (path.endsWith('/users')) data = { items: [person], total: 1, page: 1, pageSize: 20 };
      else if (path.endsWith(`/employee-archives/${person.id}`)) data = { ...person,
        currentEmployment: { company: 'fuede', employeeStatus: 'active', deptId: person.deptId, effectiveFrom: '2026-02-01', entryDate: '2026-02-01' },
        employeeProfile: null, employeeContracts: [], employmentHistory: [], changeHistory: [request] };
      else if (path.endsWith('/departments')) data = [{ id: person.deptId, name: person.deptName, children: [] }];
      else if (path.endsWith('/list')) data = { items: [], total: 0, page: 1, pageSize: 20 };
      await route.fulfill({ json: { code: 0, message: 'success', data } });
    });
    await page.goto('/users');
    await page.getByRole('button', { name: '查看档案', exact: true }).click();
    const archive = page.getByRole('dialog', { name: '员工档案', exact: true });
    await archive.getByRole('tab', { name: '变更记录', exact: true }).click();
    const history = archive.locator('.change-history');
    await history.locator('.el-collapse-item__header').click();
    const changes = history.locator('.history-diff');
    await expect(changes).toHaveCount(3);
    await expect(changes.filter({ hasText: '工作地点' })).toContainText('合成原办公地 → 合成新办公地');
    await expect(changes.filter({ hasText: '社保起始日期' })).toContainText('2026-02-01 → 2026-03-01');
    await expect(changes.filter({ hasText: '到期日期' })).toContainText('2026-10-25 → 2026-11-25');
    await expect(changes).not.toContainText(['T00:00:00']);
    await expect(changes.filter({ hasText: /入职日期|出生日期|预计转正日期|签订日期|生效日期/ })).toHaveCount(0);
    expect(writes).toEqual([]);
    expect(await archive.evaluate(element => element.scrollWidth <= element.clientWidth)).toBeTruthy();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.screenshot({ path: testInfo.outputPath(`change-history-${width}.png`), fullPage: true });
  });
}
