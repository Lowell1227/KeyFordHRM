import { test, expect } from '@playwright/test';

for (const [width, height] of [[1440, 900], [1024, 768], [390, 844]]) {
  test(`local demand draft form works with DingTalk unconfigured at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width: width!, height: height! });
    const writes: Array<Record<string, unknown>> = [];
    const envelope = (data: unknown) => ({ contentType: 'application/json', body: JSON.stringify({ code: 0, data }) });
    const row = { id: 'local-A', sourceKind: 'local', revision: 1, instanceId: null, sourceState: 'draft',
      rawDepartment: null, rawPosition: null, rawHeadcount: null, deptId: 'dept-A', departmentName: '虚构部门',
      positionId: 'job-A', positionName: '虚构岗位', requestedHeadcount: 2, requestReason: '虚构招聘原因',
      approvedHeadcount: null, lastSyncedAt: null, approvedAt: null, usable: false, issues: ['尚未审核通过'],
      allowedActions: ['edit', 'submit', 'withdraw'], events: [] };
    await page.addInitScript(() => { localStorage.setItem('token', 'fictional-local-ui-only'); localStorage.setItem('expiresAt', String(Date.now() + 600000)); });
    await page.route('**/api/v1/**', async route => {
      const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
      if (path === '/auth/me') return route.fulfill(envelope({ id: 'operator', name: '虚构经办', sysRole: 'employee', hrCapabilities: ['recruitment_edit'], businessCapabilities: {} }));
      if (path === '/recruitment-demands/status') return route.fulfill(envelope({ configured: false, missing: ['processCode'], readOnly: true }));
      if (path === '/recruitment-demands/directories') return route.fulfill(envelope({ departments: [{ id: 'dept-A', name: '虚构部门' }], positions: [{ id: 'job-A', code: 'FIC', name: '虚构岗位' }] }));
      if (path === '/recruitment-demands/local') { writes.push(route.request().postDataJSON()); return route.fulfill(envelope(row)); }
      if (path === '/recruitment-demands/local-A') return route.fulfill(envelope(row));
      if (path === '/recruitment-demands') return route.fulfill(envelope({ items: writes.length ? [row] : [], total: writes.length ? 1 : 0 }));
      return route.fulfill(envelope(null));
    });
    await page.goto('/recruitment/demands');
    await page.getByRole('button', { name: '新建招聘需求', exact: true }).click({ timeout: 5000 });
    const dialog = page.getByRole('dialog', { name: '新建招聘需求', exact: true });
    await dialog.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(dialog.getByText('请选择有效的 HRM 部门', { exact: true })).toBeVisible();
    await dialog.getByRole('combobox', { name: '申请部门', exact: true }).press('ArrowDown');
    await page.getByRole('option', { name: '虚构部门', exact: true }).click();
    await dialog.getByRole('combobox', { name: '申请岗位', exact: true }).press('ArrowDown');
    await page.getByRole('option', { name: 'FIC · 虚构岗位', exact: true }).click();
    await dialog.getByRole('spinbutton', { name: '申请人数', exact: true }).fill('2');
    await dialog.getByRole('textbox', { name: '招聘原因', exact: true }).fill('虚构招聘原因');
    await expect(dialog.getByText('请选择有效的 HRM 部门', { exact: true })).toHaveCount(0);
    await expect(page.locator('.el-select__popper:visible')).toHaveCount(0);
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: `test-results/recruitment-demand-web/local-form-${width}.png`, fullPage: true });
    await dialog.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    expect(writes).toHaveLength(1); expect(writes[0]).toMatchObject({ deptId: 'dept-A', positionId: 'job-A', headcount: 2, reason: '虚构招聘原因' });
    await expect(page.getByRole('dialog', { name: '招聘需求详情', exact: true })).toContainText('系统创建');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/recruitment-demand-web/local-draft-${width}.png`, fullPage: true });
  });
}
