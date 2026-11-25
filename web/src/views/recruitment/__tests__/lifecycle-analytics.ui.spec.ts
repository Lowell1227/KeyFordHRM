import { expect, test, type Page } from '@playwright/test';

const lifecycle = { id: 'fictional-demand', revision: 4, trackingState: 'recruiting', trackingChangedAt: null, trackingChangedByName: null, trackingReason: null, canEdit: true,
  summary: { approvedHeadcount: 2, occupiedCount: 1, acceptedCount: 1, hiredCount: 0, remainingCount: 1, overCount: 0, inProgressCount: 3 },
  externalPostings: [{ id: 'fictional-posting', channel: 'boss', name: '虚构招聘岗位及非常长的外部职位名称用于移动端核对', url: 'https://www.zhipin.com/fictional', active: true, ownerName: '虚构招聘经办' }], events: [] };
const counts = { applicationCount: 3, interviewedCount: 1, offeredCount: 1, acceptedCount: 1, hiredCount: 0 };
const envelope = (data: unknown) => ({ contentType: 'application/json', body: JSON.stringify({ code: 0, data }) });
async function setup(page: Page, options: { component?: 'analysis'; viewer?: boolean; narrow?: boolean; conflict?: boolean; channelFailure?: 403 | 500; detailFailure?: 403 | 500; channelGate?: Promise<void>; detailGate?: Promise<void> } = {}) {
  const writes: Array<Record<string, unknown>> = [];
  const details: URLSearchParams[] = [];
  let revision = 4;
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname.endsWith('/lifecycle')) {
      if (request.method() === 'PATCH') {
        const body = request.postDataJSON(); writes.push(body);
        if (options.conflict) { revision = 5; return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ message: '招聘需求已更新，请重新核对' }) }); }
        revision++;
        return route.fulfill(envelope({ ...lifecycle, revision, trackingState: body.trackingState, trackingReason: body.reason }));
      }
      return route.fulfill(envelope({ ...lifecycle, revision, canEdit: !options.viewer }));
    }
    if (url.pathname.endsWith('/channels')) {
      if (options.channelGate) await options.channelGate;
      if (options.channelFailure) return route.fulfill({ status: options.channelFailure, contentType: 'application/json', body: JSON.stringify({ message: `虚构统计读取失败${options.channelFailure}` }) });
      return route.fulfill(envelope({ items: [{ ...counts, sourceChannel: 'email' }, { sourceChannel: null, applicationCount: 1, interviewedCount: 0, offeredCount: 0, acceptedCount: 0, hiredCount: 0 }], totals: { ...counts, applicationCount: 4 }, periodBasis: 'application_created_at' }));
    }
    if (url.pathname.endsWith('/applications')) {
      details.push(url.searchParams);
      if (options.detailGate) await options.detailGate;
      if (options.detailFailure) return route.fulfill({ status: options.detailFailure, contentType: 'application/json', body: JSON.stringify({ message: `虚构明细读取失败${options.detailFailure}` }) });
      return route.fulfill(envelope({ items: [{ id: 'fictional-application', candidateId: 'fictional-candidate', candidateName: '虚构渠道候选人', candidateUnavailable: false,
        positionName: '虚构测试岗位', sourceChannel: null, demandId: lifecycle.id, stage: 'screening', createdAt: '2037-01-01T00:00:00Z', interviewed: false, offered: false, accepted: false, hired: false }], total: 1, page: 1, pageSize: 10 }));
    }
    return route.fulfill(envelope(null));
  });
  await page.goto(`/src/views/recruitment/__tests__/lifecycle-analytics.harness.html?component=${options.component || 'lifecycle'}&role=${options.narrow ? 'narrow' : options.viewer ? 'viewer' : 'editor'}`);
  return { writes, details, advanceRevision: () => { revision++; } };
}
for (const width of [1440, 1024, 390]) {
  test(`tracking reason, live preflight and evidence fit ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const { writes } = await setup(page);
    await expect(page.getByRole('region', { name: '招聘进度留痕' })).toBeVisible();
    await expect(page.getByText('在办应聘', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '登记招聘进度', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '登记招聘进度' });
    await expect(dialog).toContainText('使用中'); await expect(dialog).toContainText('虚构招聘岗位');
    await dialog.locator('.el-select__wrapper').click();
    await page.getByRole('option', { name: '已招满', exact: true }).click();
    await dialog.getByRole('button', { name: '保存招聘进度', exact: true }).click();
    await expect(dialog.getByText('请填写变更原因', { exact: true })).toBeVisible();
    await dialog.getByRole('textbox', { name: '变更原因' }).fill('虚构录用已核对，继续处理在途人员');
    await dialog.getByRole('button', { name: '保存招聘进度', exact: true }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toEqual({ expectedRevision: 4, trackingState: 'filled', reason: '虚构录用已核对，继续处理在途人员' });
    await expect(dialog).toBeHidden();
    await expect(page.getByText('父页已刷新 1', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/recruitment-lifecycle-components/lifecycle-${width}.png`, fullPage: true });
  });
  test(`channel unknown-source drilldown fits ${width}px and retains its cohort`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const { details } = await setup(page, { component: 'analysis' });
    await expect(page.getByRole('region', { name: '招聘渠道分析' })).toBeVisible();
    await page.getByRole('button', { name: '查看待确认来源应聘', exact: true }).click();
    await expect(page.locator(width <= 768 ? '.details .mobile' : '.details .desktop').getByText('虚构渠道候选人', { exact: true })).toBeVisible();
    expect(details[0]?.get('unknownSource')).toBe('true'); expect(details[0]?.get('demandId')).toBe('fictional-demand');
    expect(details[0]?.get('metric')).toBe('application');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/recruitment-lifecycle-components/analysis-${width}.png`, fullPage: true });
  });
}
test('version conflict preserves reason and requires explicit refreshed evidence before resubmission', async ({ page }) => {
  const { writes } = await setup(page, { conflict: true });
  await page.getByRole('button', { name: '登记招聘进度', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '登记招聘进度' });
  await dialog.locator('.el-select__wrapper').click(); await page.getByRole('option', { name: '暂停招聘', exact: true }).click();
  await dialog.getByRole('textbox', { name: '变更原因' }).fill('应保留的虚构原因');
  await dialog.getByRole('button', { name: '保存招聘进度', exact: true }).click();
  await expect(dialog.getByRole('textbox', { name: '变更原因' })).toHaveValue('应保留的虚构原因');
  await expect(dialog.getByRole('button', { name: '保存招聘进度', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: '刷新办理依据，保留输入', exact: true })).toBeVisible(); expect(writes).toHaveLength(1);
});
test('viewer can read but cannot mutate and narrow confirmer cannot read global channels', async ({ page }) => {
  await setup(page, { viewer: true });
  await expect(page.getByText('招聘中', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: '登记招聘进度', exact: true })).toHaveCount(0);
  const { details } = await setup(page, { component: 'analysis', narrow: true });
  await expect(page.getByText('当前无权查看招聘渠道分析', { exact: true })).toBeVisible(); expect(details).toHaveLength(0);
});
test('parent revision update preserves the active reason and blocks stale submission', async ({ page }) => {
  const { writes, advanceRevision } = await setup(page);
  await page.getByRole('button', { name: '登记招聘进度', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '登记招聘进度' });
  await dialog.getByRole('textbox', { name: '变更原因' }).fill('父页更新后仍须保留的原因');
  advanceRevision(); await page.evaluate(() => dispatchEvent(new Event('test-parent-revision')));
  await expect(dialog.getByRole('textbox', { name: '变更原因' })).toHaveValue('父页更新后仍须保留的原因');
  await expect(dialog.getByRole('button', { name: '保存招聘进度', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '刷新办理依据，保留输入', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '保存招聘进度', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: '保存招聘进度', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1); expect(writes[0]?.expectedRevision).toBe(5);
});
test('summary totals open the same filtered cohort without turning all sources into unknown source', async ({ page }) => {
  const { details } = await setup(page, { component: 'analysis' });
  await page.getByRole('button', { name: '查看汇总当前有效接受', exact: true }).click();
  await expect.poll(() => details.length).toBe(1);
  expect(details[0]?.get('metric')).toBe('accepted'); expect(details[0]?.get('demandId')).toBe('fictional-demand');
  expect(details[0]?.get('unknownSource')).toBeNull(); expect(details[0]?.get('sourceChannel')).toBeNull();
});
for (const width of [1440, 390]) for (const status of [403, 500] as const) {
  test(`channel failure ${status} at ${width}px never masquerades as a zero or an empty cohort`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await setup(page, { component: 'analysis', channelFailure: status });
    await expect(page.getByText(status === 403 ? '当前无权办理这项招聘需求操作，请联系管理员核对权限。' : `虚构统计读取失败${status}`, { exact: true })).toBeVisible();
    await expect(page.locator('.totals')).toHaveCount(0);
    await expect(page.getByText('暂无符合条件的应聘', { exact: true })).toHaveCount(0);
    await expect(page.locator('.channel-analysis .el-table')).toHaveCount(0);
  });
  test(`detail failure ${status} at ${width}px never masquerades as an empty successful page`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await setup(page, { component: 'analysis', detailFailure: status });
    await page.getByRole('button', { name: '查看待确认来源应聘', exact: true }).click();
    const details = page.getByRole('region', { name: '待确认来源 · 应聘' });
    await expect(details.getByText(status === 403 ? '当前无权办理这项招聘需求操作，请联系管理员核对权限。' : `虚构明细读取失败${status}`, { exact: true })).toBeVisible();
    await expect(details.getByText('暂无符合条件的应聘', { exact: true })).toHaveCount(0);
    await expect(details.locator('.el-table')).toHaveCount(0);
    await expect(details.locator('.el-pagination')).toHaveCount(0);
    await expect(details.getByRole('button', { name: '重试应聘明细', exact: true })).toBeVisible();
  });
}
for (const width of [1440, 390]) {
  test(`pending statistics and detail at ${width}px display loading, not a successful empty result`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    let releaseChannel!: () => void, releaseDetail!: () => void;
    const channelGate = new Promise<void>(resolve => { releaseChannel = resolve; });
    const detailGate = new Promise<void>(resolve => { releaseDetail = resolve; });
    try {
      await setup(page, { component: 'analysis', channelGate, detailGate });
      await expect(page.getByText('正在读取渠道统计', { exact: true })).toBeVisible();
      await expect(page.locator('.totals, .channel-analysis .el-table, .channel-analysis .el-empty')).toHaveCount(0);
      releaseChannel();
      await page.getByRole('button', { name: '查看待确认来源应聘', exact: true }).click();
      const details = page.getByRole('region', { name: '待确认来源 · 应聘' });
      await expect(details.getByText('正在读取应聘明细', { exact: true })).toBeVisible();
      await expect(details.locator('.el-table, .el-empty, .el-pagination')).toHaveCount(0);
      releaseDetail();
      await expect(details.locator(width <= 768 ? '.mobile' : '.desktop').getByText('虚构渠道候选人', { exact: true })).toBeVisible();
    } finally { releaseChannel(); releaseDetail(); }
  });
}
