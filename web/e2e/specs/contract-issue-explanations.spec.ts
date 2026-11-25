import { expect, test, type Page } from '@playwright/test';

const details = [{ title: '兼职转劳动合同待核对', records: '记录一：兼职协议｜虚构甲公司｜2025-01-01至2027-12-31\n记录二：劳动合同｜虚构甲公司｜2025-09-01至2028-08-31',
  reason: '原兼职协议尚在记录期限内，新劳动合同已经开始，可能是用工身份转换后替代了旧协议。', suggestion: '核对新劳动合同是否替代原协议，确认正常后保留原日期。' },
{ title: '转签主体待补充', records: '记录一：劳动合同｜签订公司未填写｜2025-01-01至2027-12-31', reason: '旧合同公司未填写。', suggestion: '核对历史合同原件的签约公司。' }];
async function setup(page: Page, options: { readOnly?: boolean; failure?: boolean } = {}) {
  const state = { exempt: false, version: 0, bodies: [] as any[] };
  const employee = { id: 'synthetic-employee', name: '虚构合同核对', employeeNo: 'SYN-CHECK', status: 'active', employmentType: 'full_time',
    sysRole: 'employee', deptName: '虚构部门', position: '虚构岗位', hrCapabilities: [], businessIdentities: [], archiveIssueCount: 1, archiveWarnings: [] };
  const issue = { id: 'current:contract-overlap', origin: 'current', requestId: '', employeeId: employee.id, field: 'contracts', kind: 'review',
    message: '合同交叠：请核对替代或并存关系', reason: '交叠不一定填错，请逐组核对。', source: { value: null }, current: { value: '两组合同记录' }, status: 'open', canConfirmCurrent: false,
    canExplain: !options.readOnly, fingerprint: 'a'.repeat(64), contractIds: ['a', 'b', 'c'], details, maintenance: { employeeId: employee.id, requestId: '', draft: false } };
  await page.addInitScript(() => { localStorage.setItem('token', 'synthetic-hr'); localStorage.setItem('expiresAt', String(Date.now() + 600000)); });
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname; let data: any = [];
    if (path.endsWith('/auth/me')) data = { id: 'synthetic-hr', name: '虚构HR', sysRole: 'hr_user', hrCapabilities: [options.readOnly ? 'employee_archive_review' : 'employee_archive_edit'] };
    else if (path.endsWith('/notifications/unread-count')) data = 0;
    else if (path.endsWith('/users')) data = { items: [{ ...employee, archiveIssueCount: state.exempt ? 0 : 1 }], total: 1, page: 1, pageSize: 20 };
    else if (path.includes('/employee-archives/issues/')) {
      if (route.request().method() === 'PATCH') {
        const body = route.request().postDataJSON(); state.bodies.push(body);
        if (options.failure) { await route.fulfill({ status: 409, json: { message: '资料已更新' } }); return; }
        state.exempt = body.isExempt; state.version++;
        data = { isExempt: state.exempt, version: state.version };
      } else data = { items: state.exempt ? [] : [{ ...issue, exemptionVersion: state.version }], exemptions: state.exempt ? [{ issueId: issue.id,
        fingerprint: issue.fingerprint, version: state.version, message: issue.message, field: 'contracts', currentValue: issue.current.value,
        reason: state.bodies.at(-1)?.reason, isExempt: true, noLongerApplies: false }] : [] };
    } else if (path.endsWith('/drafts/list') || path.endsWith('/list')) data = { items: [], total: 0, page: 1, pageSize: 20 };
    await route.fulfill({ json: { code: 0, message: 'success', data } });
  });
  await page.goto('/users');
  await page.getByRole('button', { name: '待完善 1项', exact: true }).filter({ visible: true }).first().click();
  return { state, dialog: page.getByRole('dialog', { name: '档案待完善事项', exact: true }) };
}
test('HR sees grouped reasons and toggles normal immediately without changing contracts', async ({ page }, info) => {
  const { state, dialog } = await setup(page);
  await expect(dialog.getByRole('heading', { name: `1. ${details[0].title}`, exact: true })).toBeVisible();
  await expect(dialog.getByText(details[0].reason, { exact: true })).toBeVisible();
  await expect(dialog.getByText(details[1].suggestion, { exact: true })).toBeVisible();
  await expect(dialog.getByText('本项包含2组交叠记录，请全部核对后再标记正常。', { exact: true })).toBeVisible();
  await expect(dialog).toHaveCSS('opacity', '1');
  await expect(dialog.locator('..')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: info.outputPath('pending-reasons.png'), fullPage: true, animations: 'disabled' });
  await dialog.getByPlaceholder('正常原因或核对说明（选填）').fill('虚构验收：已核对转换关系');
  await dialog.locator('.el-checkbox').filter({ hasText: '已核对正常，取消本项提醒' }).click();
  await expect(dialog.getByText('暂无待完善事项', { exact: true })).toBeVisible();
  await dialog.getByText('已核对正常 / 已豁免 1项', { exact: true }).click();
  await expect(dialog.getByText('虚构验收：已核对转换关系', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('normal-state.png'), fullPage: true, animations: 'disabled' });
  await dialog.locator('.el-checkbox').filter({ hasText: '已核对正常，取消本项提醒' }).click();
  await expect(dialog.getByRole('heading', { name: `1. ${details[0].title}`, exact: true })).toBeVisible();
  expect(state.bodies).toEqual([{ fingerprint: 'a'.repeat(64), isExempt: true, expectedVersion: 0, reason: '虚构验收：已核对转换关系' },
    { fingerprint: 'a'.repeat(64), isExempt: false, expectedVersion: 1, reason: '虚构验收：已核对转换关系' }]);
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
});
test('review-only HR sees reasons but cannot mark normal', async ({ page }) => {
  const { state, dialog } = await setup(page, { readOnly: true });
  await expect(dialog.getByText(details[0].reason, { exact: true })).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: '已核对正常，取消本项提醒', exact: true })).toBeDisabled();
  expect(state.bodies).toHaveLength(0);
});
test('failed save retains pending reasons and does not imply immediate success', async ({ page }) => {
  const { dialog } = await setup(page, { failure: true });
  await dialog.locator('.el-checkbox').filter({ hasText: '已核对正常，取消本项提醒' }).click();
  await expect(dialog.getByRole('alert')).toContainText('已更新');
  await expect(dialog.getByRole('heading', { name: `1. ${details[0].title}`, exact: true })).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: '已核对正常，取消本项提醒', exact: true })).not.toBeChecked();
});
