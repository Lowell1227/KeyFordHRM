import { expect, test, type Page } from '@playwright/test';

const draftId = '11111111-1111-4111-8111-111111111111';
const indicatorId = '22222222-2222-4222-8222-222222222222';
const october = '33333333-3333-4333-8333-333333333333';
const november = '44444444-4444-4444-8444-444444444444';
const url = `/ai-progress/confirm/${draftId}`;

// Real page, router and form; synthetic HTTP only. No provider, DingTalk or database writes.
async function setup(page: Page, options: { qualitative?: boolean; uncertain?: boolean; loadStatus?: number;
  saveFails?: boolean; patchFails?: boolean; lostSave?: boolean; authenticated?: boolean } = {}) {
  const state = { kind: 'draft', draftId, state: 'pending', expiresAt: '2099-10-13T00:00:00Z',
    goals: [{ id: indicatorId, title: '完成客户回访并提交完整的业务跟进记录', targetValue: options.qualitative ? null : '10',
      unit: options.qualitative ? null : '次', periodId: options.qualitative ? null : october,
      periodKey: options.qualitative ? null : '2026-10' },
    ...(!options.qualitative ? [{ id: indicatorId, title: '完成客户回访并提交完整的业务跟进记录', targetValue: '20',
      unit: '次', periodId: november, periodKey: '2026-11' }] : [])],
    indicatorId, periodId: options.qualitative ? null : october, content: '已回访十二家客户',
    actualValue: options.qualitative ? null : '12', healthStatus: null,
    uncertain: options.uncertain ?? true, canSave: options.uncertain === false,
    targetValue: options.qualitative ? null : '10', unit: options.qualitative ? null : '次',
    completionPercent: options.qualitative ? null : 120, progress: options.qualitative ? null : 100, saved: null };
  const writes: Array<{ method: string; body: unknown }> = [];
  let reads = 0, failed = false;
  if (options.authenticated !== false) await page.addInitScript(() => {
    localStorage.setItem('token', 'synthetic-employee-session');
    localStorage.setItem('expiresAt', String(Date.now() + 600_000));
  });
  await page.route('**/api/v1/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    const send = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json',
      body: JSON.stringify({ code: status === 200 ? 0 : status, data, message: 'synthetic failure' }) });
    if (path === '/auth/me') return send({ id: 'employee-1', name: '试运行员工', sysRole: 'employee', deptId: null, isAssessorOnly: false });
    if (path.startsWith('/ai-progress/drafts/')) {
      expect(request.headers().authorization).toBe('Bearer synthetic-employee-session');
      if (request.method() === 'GET') { reads++; return send(state, options.loadStatus ?? 200); }
      writes.push({ method: request.method(), body: request.postData() ? request.postDataJSON() : null });
      if (request.method() === 'PATCH') {
        if (options.patchFails && !failed) { failed = true; return send(null, 503); }
        if (state.state === 'saved') return send(null, 409);
        Object.assign(state, request.postDataJSON(), { uncertain: false, canSave: true });
        return send(state);
      }
      if ((options.saveFails || options.lostSave) && !failed) {
        failed = true;
        if (options.lostSave) state.state = 'saved';
        return send(null, 503);
      }
      state.state = 'saved'; return send({ id: 'saved-progress' });
    }
    if (path.endsWith('/unread-count')) return send(0);
    return send([]);
  });
  return { state, writes, reads: () => reads };
}

async function selectGoal(page: Page, month = '2026-10') {
  await page.getByRole('combobox', { name: '目标与考核月份' }).press('ArrowDown');
  await page.getByRole('option', { name: new RegExp(month) }).click();
}

for (const [width, height] of [[1440, 900], [1024, 768], [390, 844]]) {
  test(`${width}px employee must explicitly save corrected draft`, async ({ page }, testInfo) => {
    // Catches automatic save, trusting uncertain preselection, wrong period pair and clamped completion preview.
    const fixture = await setup(page);
    await page.setViewportSize({ width, height });
    await page.goto(url);
    const save = page.getByRole('button', { name: '保存进展', exact: true });
    await expect(save).toBeDisabled();
    expect(fixture.writes).toHaveLength(0);
    await selectGoal(page);
    await expect(page.getByText('120%', { exact: true })).toBeVisible();
    await expect(save).toBeEnabled();
    await page.getByRole('textbox', { name: '进展说明' }).fill('已完成十二次回访，补齐客户记录。');
    await page.getByRole('combobox', { name: '进展状态' }).press('ArrowDown');
    await page.getByRole('option', { name: '正常', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('option', { name: '正常', exact: true })).not.toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`ai-confirm-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    const bounds = await save.boundingBox();
    expect(bounds?.y).toBeGreaterThanOrEqual(0);
    expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeLessThanOrEqual(height);
    expect(fixture.writes).toHaveLength(0);
    await save.click();
    await expect(page.getByText('进展已保存', { exact: true })).toBeVisible();
    expect(fixture.writes).toEqual([{ method: 'PATCH', body: { indicatorId, periodId: october,
      content: '已完成十二次回访，补齐客户记录。', actualValue: '12', healthStatus: 'on_track' } }, { method: 'POST', body: null }]);
    await expect(save).toBeDisabled();
    await page.reload();
    await expect(page.getByText('进展已保存', { exact: true })).toBeVisible();
    expect(fixture.writes).toHaveLength(2);
  });
}

test('same indicator in different months preserves the selected period', async ({ page }) => {
  const fixture = await setup(page);
  await page.goto(url); await selectGoal(page, '2026-11');
  await expect(page.getByText('60%', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '保存进展', exact: true }).click();
  await expect(page.getByText('进展已保存', { exact: true })).toBeVisible();
  expect(fixture.writes[0].body).toMatchObject({ indicatorId, periodId: november });
});

test('qualitative non-monthly progress has no invented actual value or zero percent', async ({ page }) => {
  const fixture = await setup(page, { qualitative: true });
  await page.goto(url); await selectGoal(page, '周期目标');
  await expect(page.getByText('定性目标，无完成率', { exact: true })).toBeVisible();
  await expect(page.getByText('0%', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '实际值', exact: true })).toHaveValue('');
  await page.getByRole('button', { name: '保存进展', exact: true }).click();
  await expect(page.getByText('进展已保存', { exact: true })).toBeVisible();
  expect(fixture.writes[0].body).toMatchObject({ indicatorId, periodId: null, actualValue: null, healthStatus: null });
});

test('invalid description and actual value show field errors without saving', async ({ page }) => {
  const fixture = await setup(page, { uncertain: false });
  await page.goto(url);
  await page.getByRole('textbox', { name: '进展说明' }).fill('   ');
  await page.getByRole('textbox', { name: '实际值', exact: true }).fill('-1');
  await expect(page.getByText('请输入进展说明', { exact: true })).toBeVisible();
  await expect(page.getByText('实际值须为非负数，最多8位整数和2位小数', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '保存进展', exact: true })).toBeDisabled();
  expect(fixture.writes).toHaveLength(0);
});

test('decimal preview rounds a half cent of percent consistently with the server', async ({ page }) => {
  const fixture = await setup(page, { uncertain: false });
  fixture.state.goals[0].targetValue = '1.60';
  await page.goto(url);
  await page.getByRole('textbox', { name: '实际值', exact: true }).fill('0.01');
  await expect(page.getByText('0.63%', { exact: true })).toBeVisible();
});

for (const failure of ['patchFails', 'saveFails', 'lostSave'] as const) {
  test(`${failure} preserves corrections and retry reconciles a saved response`, async ({ page }) => {
    const fixture = await setup(page, { [failure]: true });
    await page.goto(url); await selectGoal(page);
    await page.getByRole('textbox', { name: '进展说明' }).fill('保留我更正的长说明内容');
    await page.getByRole('textbox', { name: '实际值', exact: true }).fill('15');
    await page.getByRole('button', { name: '保存进展', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('输入已保留');
    await expect(page.getByRole('textbox', { name: '进展说明' })).toHaveValue('保留我更正的长说明内容');
    await expect(page.getByRole('textbox', { name: '实际值', exact: true })).toHaveValue('15');
    await expect(page.getByRole('link', { name: '前往 HRM 目标跟进手动更新' })).toHaveAttribute('href', '/action-items');
    if (failure === 'lostSave') await page.getByRole('textbox', { name: '进展说明' }).fill('响应丢失后修改的未保存内容');
    await page.getByRole('button', { name: '保存进展', exact: true }).click();
    await expect(page.getByText('进展已保存', { exact: true })).toBeVisible();
    if (failure === 'lostSave') {
      expect(fixture.writes).toHaveLength(2);
      await expect(page.getByRole('textbox', { name: '进展说明' })).toHaveValue('保留我更正的长说明内容');
    }
  });
}

for (const status of [403, 410, 503]) {
  test(`draft load ${status} exposes no draft fields or save action`, async ({ page }) => {
    const options = { loadStatus: status };
    const fixture = await setup(page, options);
    await page.goto(url);
    await expect(page.getByRole('alert')).toContainText(status === 403 ? '只能查看和保存本人的进展草稿' : status === 410 ? '草稿已过期' : '草稿暂时无法读取');
    await expect(page.getByRole('textbox', { name: '进展说明' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '保存进展', exact: true })).toHaveCount(0);
    expect(fixture.writes).toHaveLength(0);
    if (status === 503) {
      options.loadStatus = 200;
      await page.getByRole('button', { name: '重新读取' }).click();
      await expect(page.getByRole('textbox', { name: '进展说明' })).toHaveValue('已回访十二家客户');
      expect(fixture.writes).toHaveLength(0);
    }
  });
}

test('draft URL alone requires the ordinary HRM login and retains the destination', async ({ page }) => {
  const fixture = await setup(page, { authenticated: false });
  await page.goto(url);
  await expect(page).toHaveURL(location => location.pathname === '/login' && location.searchParams.get('redirect') === url);
  expect(fixture.reads()).toBe(0);
});

test('leaving after only selecting a goal protects the correction and never saves', async ({ page }) => {
  const fixture = await setup(page);
  await page.goto(url); await selectGoal(page);
  await expect(page.getByRole('button', { name: '确认目标进展', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: '前往 HRM 目标跟进', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('更正内容尚未保存');
  await page.getByRole('button', { name: '继续修改', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(url));
  await expect(page.getByText('120%', { exact: true })).toBeVisible();
  expect(fixture.writes).toHaveLength(0);
  await page.getByRole('link', { name: '前往 HRM 目标跟进', exact: true }).click();
  await page.getByRole('button', { name: '离开页面', exact: true }).click();
  await expect(page).toHaveURL(location => location.pathname === '/action-items');
  expect(fixture.writes).toHaveLength(0);
});
