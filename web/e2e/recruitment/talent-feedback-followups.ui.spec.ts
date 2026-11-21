import { test, expect, type Page } from '@playwright/test';

const candidate = {
  id: '11111111-1111-4111-8111-111111111111', editVersion: 'v1', name: '跟进验证虚构人才', phone: '17000000000',
  email: null, birthYear: null, gender: 'unknown', currentCompany: null, currentPosition: null,
  yearsOfExperience: null, education: null, school: null, major: null, expectCity: null,
  expectSalaryMin: null, expectSalaryMax: null, sourceChannel: 'referral', appliedPosition: null,
  status: 'new', tags: [], note: null, lastFollowUpAt: null, convertedUserId: null, convertedAt: null,
  createdAt: '2026-11-18T00:00:00Z', updatedAt: '2026-11-18T00:00:00Z', ownerId: 'hr-one', ownerName: '虚构经办',
  nextFollowUpAt: '2026-12-01T00:00:00.000Z', fileCount: 0, latestApplication: null, onboardingRequest: null,
  deletedAt: null, createdById: 'hr-one', updatedById: null, files: [], followUps: [], shares: [],
};
const second = { ...candidate, id: '22222222-2222-4222-8222-222222222222', name: '第二位虚构人才', nextFollowUpAt: null };
const history = {
  id: 'follow-up-one', candidateId: candidate.id, occurredAt: '2026-11-18T00:00:00.000Z', channel: 'phone',
  summary: '已经读取的历史沟通', nextFollowUpAt: '2026-12-01T00:00:00.000Z',
  createdById: 'hr-one', createdByName: '虚构经办', createdAt: '2026-11-18T01:00:00Z',
  planStatus: 'pending', planClosedAt: null, planClosedById: null,
};
const envelope = (data: unknown) => ({ contentType: 'application/json', body: JSON.stringify({ code: 0, data }) });

async function install(page: Page, initial = [history]) {
  const state = { history: initial, reads: 0, failReads: 0, writes: [] as Array<Record<string, unknown>>, calls: [] as string[] };
  await page.addInitScript(() => localStorage.setItem('token', 'mock-followups'));
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    state.calls.push(path + url.search);
    if (path.endsWith('/auth/me')) return route.fulfill(envelope({ id: 'hr-one', name: '虚构经办', sysRole: 'hr', hrCapabilities: [], businessCapabilities: {} }));
    if (path.endsWith('/notifications/unread-count')) return route.fulfill(envelope({ count: 0 }));
    if (path.endsWith('/talents')) return route.fulfill(envelope({ items: [candidate, second], total: 2 }));
    if (path.endsWith(`/talents/${candidate.id}`)) return route.fulfill(envelope({ ...candidate, followUps: state.history }));
    if (path.endsWith(`/talents/${second.id}`)) return route.fulfill(envelope(second));
    if (path.endsWith(`/talents/${candidate.id}/follow-ups`)) {
      if (request.method() === 'POST') {
        const body = request.postDataJSON(); state.writes.push(body);
        const record = { ...history, ...body, id: `saved-follow-up-${state.writes.length}`, occurredAt: `${body.occurredAt}T00:00:00.000Z`, nextFollowUpAt: body.nextFollowUpAt ? `${body.nextFollowUpAt}T00:00:00.000Z` : null, planStatus: body.nextFollowUpAt ? 'pending' : 'none' };
        state.history = state.history.map(item => item.id === body.completePlanId ? { ...item, planStatus: 'completed' } : item);
        state.history = [record, ...state.history];
        return route.fulfill({ status: 201, ...envelope(record) });
      }
      ++state.reads;
      if (state.failReads > 0) { --state.failReads; return route.fulfill({ status: 503, ...envelope(null) }); }
      return route.fulfill(envelope(state.history));
    }
    if (path.endsWith('/cancel')) {
      state.calls.push(request.method() + ' ' + path);
      const planId = path.split('/').at(-2);
      state.history = state.history.map(item => item.id === planId ? { ...item, planStatus: 'cancelled' } : item);
      return route.fulfill(envelope(state.history.find(item => item.id === planId)));
    }
    if (path.endsWith(`/talents/${second.id}/follow-ups`)) return route.fulfill(envelope([{ ...history, id: 'second-history', candidateId: second.id, summary: '第二位的沟通记录' }]));
    if (path.endsWith('/owners')) return route.fulfill(envelope({ items: [], total: 0 }));
    if (path.endsWith('/applications') || path.endsWith('/talent-interviews') || path.endsWith('/departments')) return route.fulfill(envelope([]));
    return route.fulfill(envelope(null));
  });
  return state;
}

async function openDetail(page: Page, width: number, index = 0) {
  if (width <= 768) await page.getByRole('button', { name: '打开详情', exact: true }).nth(index).click();
  else await page.getByText(index ? second.name : candidate.name, { exact: true }).first().click();
  await expect(page.locator('.talent-follow-ups')).toBeVisible();
  return page.locator('.talent-follow-ups');
}

for (const timezoneId of ['Asia/Shanghai', 'America/Los_Angeles']) {
  test.describe(timezoneId, () => {
    test.use({ timezoneId });
    test('mobile next-follow-up calendar date does not move across timezones (mock)', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 900 });
      await install(page); await page.goto('/talents');
      const firstCard = page.locator('.mobile-result-card').filter({ hasText: candidate.name });
      await expect(firstCard.locator('.mobile-result-field').filter({ hasText: '下次跟进' })).toHaveText('下次跟进2026-12-01');
      await expect(page.locator('.mobile-result-card').filter({ hasText: second.name }).locator('.mobile-result-field').filter({ hasText: '下次跟进' })).toHaveText('下次跟进未跟进');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    });
  });
}

for (const width of [1440, 390]) {
  test(`distinguishes no contact from a contact with no arrangement at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await install(page);
    await page.route('**/api/v1/talents?*', route => route.fulfill(envelope({ items: [
      { ...candidate, lastFollowUpAt: '2026-11-20', nextFollowUpAt: null }, second,
    ], total: 2 })));
    await page.goto('/talents');
    const rows = page.locator(width === 390 ? '.mobile-result-card:visible' : '.el-table:visible .el-table__row');
    await expect(rows.filter({ hasText: candidate.name })).toContainText('暂无安排');
    await expect(rows.filter({ hasText: second.name })).toContainText('未跟进');
  });

  test(`failed history reads offer local retry without claiming no records at ${width}px (mock)`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const state = await install(page); state.failReads = 1;
    await page.goto('/talents'); const timeline = await openDetail(page, width);
    await expect(timeline.getByRole('alert')).toContainText('跟进记录读取失败');
    await expect(timeline.getByText('还没有跟进记录')).toHaveCount(0);
    await timeline.getByRole('button', { name: '重试', exact: true }).click();
    await expect(timeline).toContainText('已经读取的历史沟通');
    await expect(timeline.getByRole('alert')).toHaveCount(0);
    expect(state.reads).toBe(2); expect(errors).toEqual([]);
    await timeline.scrollIntoViewIfNeeded();
    expect(await timeline.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`history-retry-${width}.png`), fullPage: true });
  });

  test(`saved follow-up survives failed refresh, retry and reopening at ${width}px (mock)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const state = await install(page, [{ ...history, nextFollowUpAt: null, planStatus: 'none' }]); await page.goto('/talents');
    const timeline = await openDetail(page, width);
    await expect(timeline).toContainText('已经读取的历史沟通');
    await timeline.getByRole('button', { name: '补充记录', exact: true }).click();
    const form = timeline.locator('form');
    await form.getByPlaceholder('本次沟通要点（必填）').fill('保存成功但读取暂时失败的沟通');
    await form.getByPlaceholder('跟进日期', { exact: true }).fill('2026-11-20');
    await form.getByPlaceholder('跟进日期', { exact: true }).press('Tab');
    await form.getByPlaceholder('不设置', { exact: true }).fill('2028-02-29');
    await form.getByPlaceholder('不设置', { exact: true }).press('Tab');
    state.failReads = 1;
    await form.getByRole('button', { name: '保存跟进', exact: true }).click();
    await expect(timeline.getByRole('alert')).toContainText('跟进记录读取失败');
    await expect(form).toHaveCount(0);
    await expect(timeline).toContainText('已经读取的历史沟通');
    expect(state.writes).toEqual([{ occurredAt: '2026-11-20', channel: 'phone', summary: '保存成功但读取暂时失败的沟通', nextFollowUpAt: '2028-02-29', expectedPlanId: null }]);
    await timeline.getByRole('button', { name: '重试', exact: true }).click();
    await expect(timeline).toContainText('保存成功但读取暂时失败的沟通');
    await expect(timeline).toContainText('2028-02-29');
    await page.locator('.talent-detail-drawer .el-drawer__close-btn').click();
    await openDetail(page, width);
    await expect(timeline).toContainText('保存成功但读取暂时失败的沟通');
    expect(state.writes).toHaveLength(1);
  });
}

test('an uncertain write that did not commit requires a successful history check and an explicit decision before resubmission', async ({ page }) => {
  const state = await install(page, []);
  let attempts = 0;
  await page.route(`**/api/v1/talents/${candidate.id}/follow-ups`, async route => {
    if (route.request().method() !== 'POST' || ++attempts > 1) return route.fallback();
    return route.fulfill({ status: 503, json: { message: 'Synthetic unavailable' } });
  });
  await page.goto('/talents');
  const timeline = await openDetail(page, 1440);
  await timeline.getByRole('button', { name: '补充记录', exact: true }).click();
  const form = timeline.locator('form'), summary = form.getByPlaceholder('本次沟通要点（必填）');
  const save = form.getByRole('button', { name: '保存跟进', exact: true });
  await summary.fill('断网前的记录草稿');
  await save.click();
  await expect(timeline).toContainText('保存结果待核对');
  await expect(summary).toHaveValue('断网前的记录草稿');
  await expect(save).toBeDisabled();
  await expect(form.getByRole('button', { name: '取消编辑', exact: true })).toBeDisabled();
  await form.evaluate(element => (element as HTMLFormElement).requestSubmit());
  expect(attempts).toBe(1);
  state.failReads = 1;
  const refresh = timeline.getByRole('button', { name: '读取最新记录', exact: true });
  await refresh.click();
  await expect(timeline).toContainText('跟进记录读取失败');
  const resume = timeline.getByRole('button', { name: '未保存，继续编辑', exact: true });
  await expect(resume).toHaveCount(0);
  await refresh.click();
  await expect(resume).toBeEnabled();
  await expect(save).toBeDisabled();
  await form.evaluate(element => (element as HTMLFormElement).requestSubmit());
  expect(attempts).toBe(1);
  await resume.click();
  await expect(summary).toHaveValue('断网前的记录草稿');
  await save.click();
  await expect(form).toHaveCount(0);
  expect(attempts).toBe(2);
  expect(state.writes).toHaveLength(1);
});

test('an uncertain cancellation offers a read-only plan refresh and no draft recovery form', async ({ page }) => {
  const state = await install(page);
  await page.route('**/follow-ups/*/cancel', route => route.abort('failed'));
  await page.goto('/talents');
  const timeline = await openDetail(page, 1440);
  await timeline.getByRole('button', { name: '取消安排', exact: true }).click();
  await page.getByRole('dialog', { name: '取消跟进安排' }).getByRole('button', { name: '取消安排', exact: true }).click();
  await expect(timeline).toContainText('取消结果未确认');
  await expect(timeline.getByText('保存结果待核对')).toHaveCount(0);
  await timeline.getByRole('button', { name: '刷新安排', exact: true }).click();
  await expect(timeline.getByRole('button', { name: '取消安排', exact: true })).toBeEnabled();
  expect(state.reads).toBe(2);
});

// Mount the real component without its parent's candidate key to exercise its own lifetime contract.
async function mountSwitchableTimeline(page: Page) {
  await page.goto('/talents');
  await page.evaluate(async firstId => {
    const vuePath = '/node_modules/.vite/deps/vue.js', elementPath = '/node_modules/.vite/deps/element-plus.js';
    const componentPath = '/src/views/talent/components/TalentFollowUpTimeline.vue';
    const [vue, element, component] = await Promise.all([import(vuePath), import(elementPath), import(componentPath)]);
    const oldRoot = document.querySelector('#app') as HTMLElement & { __vue_app__?: { unmount(): void } };
    oldRoot.__vue_app__?.unmount();
    const root = document.createElement('div'); root.style.cssText = 'max-width:600px;padding:16px'; document.body.append(root);
    vue.createApp({ setup() {
      const id = vue.ref(firstId), shown = vue.ref(true), changed = vue.ref(0);
      return () => vue.h('div', [
        vue.h('button', { onClick: () => { id.value = '22222222-2222-4222-8222-222222222222'; } }, '切换候选人'),
        vue.h('button', { onClick: () => { shown.value = false; } }, '关闭跟进'),
        vue.h('output', { 'aria-label': '刷新次数' }, String(changed.value)),
        shown.value ? vue.h(component.default, { candidateId: id.value, editable: true, onChanged: () => { ++changed.value; } }) : null,
      ]);
    } }).use(element.default).mount(root);
  }, candidate.id);
}

for (const lateStatus of [200, 503]) {
  test(`candidate changes discard late ${lateStatus} history responses (mock component)`, async ({ page }) => {
    await install(page);
    let release!: () => void, requested!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { requested = resolve; });
    await page.route(`**/api/v1/talents/${candidate.id}/follow-ups`, async route => {
      requested(); await held; return route.fulfill({ status: lateStatus, ...envelope([history]) });
    });
    await mountSwitchableTimeline(page); await started;
    await page.getByRole('button', { name: '切换候选人', exact: true }).click();
    const timeline = page.locator('.talent-follow-ups');
    await expect(timeline).toContainText('第二位的沟通记录');
    const response = page.waitForResponse(res => res.url().endsWith(`/talents/${candidate.id}/follow-ups`));
    release(); await response;
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(timeline).toContainText('第二位的沟通记录');
    await expect(timeline).not.toContainText('已经读取的历史沟通');
    await expect(timeline.getByRole('alert')).toHaveCount(0);
  });
}

test('closing a pending follow-up save cannot refresh or notify a different candidate (mock component)', async ({ page }) => {
  const state = await install(page);
  let release!: () => void, requested!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { requested = resolve; });
  await page.route(`**/api/v1/talents/${candidate.id}/follow-ups`, async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    requested(); await held; return route.fulfill({ status: 201, ...envelope(history) });
  });
  await mountSwitchableTimeline(page);
  const timeline = page.locator('.talent-follow-ups');
  await expect(timeline).toContainText('已经读取的历史沟通');
  await timeline.getByRole('button', { name: '补充记录', exact: true }).click();
  await timeline.getByPlaceholder('本次沟通要点（必填）').fill('尚未返回的保存');
  await timeline.getByRole('button', { name: '保存跟进', exact: true }).click(); await started;
  await page.getByRole('button', { name: '切换候选人', exact: true }).click();
  await expect(timeline).toContainText('第二位的沟通记录');
  await page.getByRole('button', { name: '关闭跟进', exact: true }).click();
  const readsBefore = state.reads;
  const response = page.waitForResponse(res => res.url().endsWith('/follow-ups') && res.request().method() === 'POST');
  release(); await response;
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByLabel('刷新次数')).toHaveText('0');
  await expect(page.locator('.el-message--success')).toHaveCount(0);
  expect(state.reads).toBe(readsBefore);
});

test('completing the selected arrangement requires a result and leaves only historical dates', async ({ page }) => {
  const previous = { ...history, id: 'older', planStatus: 'superseded', nextFollowUpAt: '2026-11-30T00:00:00.000Z' };
  const state = await install(page, [history, previous]);
  await page.clock.setFixedTime(new Date('2026-12-01T02:00:00Z'));
  await page.goto('/talents');
  const timeline = await openDetail(page, 1440);
  const current = timeline.getByLabel('当前跟进安排', { exact: true });
  await expect(current).toContainText('2026-12-01');
  await expect(current).toContainText('今天');
  await current.getByRole('button', { name: '完成并记录', exact: true }).click();
  const form = timeline.locator('form');
  const save = form.getByRole('button', { name: '完成并保存', exact: true });
  await save.click();
  await expect(form).toContainText('请填写跟进内容');
  expect(state.writes).toHaveLength(0);
  await form.getByPlaceholder('本次沟通要点（必填）').fill('已与候选人沟通');
  await save.click();
  await expect(current).toHaveCount(0);
  expect(state.writes[0]).toMatchObject({ expectedPlanId: history.id, completePlanId: history.id, nextFollowUpAt: null });
  await expect(timeline).toContainText('已完成 2026-12-01');
  await expect(timeline).toContainText('已替换 2026-11-30');
});

test('a mounted arrangement follows Beijing midnight and refreshes when the page becomes visible', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-30T15:59:00Z') });
  const state = await install(page);
  await page.goto('/talents');
  const timeline = await openDetail(page, 1440);
  const current = timeline.getByLabel('当前跟进安排', { exact: true });
  await expect(current).toContainText('未来');
  await page.clock.fastForward(60_000);
  await expect(current).toContainText('今天');

  // The wall clock has moved while the scheduled callback did not run.
  await page.clock.setSystemTime(new Date('2026-12-01T16:01:00Z'));
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(current).toContainText('逾期');
  await expect(current).toContainText('2026-12-01');
  expect(state.reads).toBe(1);
});

test('supplementing history preserves the pending arrangement, and cancelling creates no record', async ({ page }) => {
  const state = await install(page);
  await page.clock.setFixedTime(new Date('2026-12-02T02:00:00Z'));
  await page.goto('/talents');
  const timeline = await openDetail(page, 1440);
  const current = timeline.getByLabel('当前跟进安排', { exact: true });
  await expect(current).toContainText('逾期');
  await timeline.getByRole('button', { name: '补充记录', exact: true }).click();
  const form = timeline.locator('form');
  await expect(form.getByPlaceholder('不设置', { exact: true })).toHaveCount(0);
  await form.getByPlaceholder('本次沟通要点（必填）').fill('补录旧沟通');
  await form.getByRole('button', { name: '保存跟进', exact: true }).click();
  await expect(timeline).toContainText('补录旧沟通');
  expect(state.writes[0]).toMatchObject({ expectedPlanId: history.id, nextFollowUpAt: null });
  expect(state.writes[0]).not.toHaveProperty('completePlanId');
  await expect(current).toContainText('2026-12-01');
  await current.getByRole('button', { name: '取消安排', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '取消跟进安排' });
  await expect(dialog).toContainText('2026-12-01');
  await dialog.getByRole('button', { name: '取消安排', exact: true }).click();
  await expect(current).toHaveCount(0);
  await expect(timeline).toContainText('已取消 2026-12-01');
  expect(state.writes).toHaveLength(1);
  expect(state.calls).toContain(`POST /api/v1/talents/${candidate.id}/follow-ups/${history.id}/cancel`);
});

test('a conflict preserves the draft and a refresh cannot silently retarget completion', async ({ page }) => {
  const state = await install(page);
  const conflictingPlan = { ...history, id: 'new-plan', nextFollowUpAt: '2028-12-01T00:00:00.000Z' };
  const rejected: unknown[] = [];
  await page.route(`**/api/v1/talents/${candidate.id}/follow-ups`, route => {
    if (route.request().method() !== 'POST' || rejected.length) return route.fallback();
    rejected.push(route.request().postDataJSON());
    state.history = [conflictingPlan, { ...history, planStatus: 'superseded' }];
    return route.fulfill({ status: 409, json: { message: '当前跟进安排已变化' } });
  });
  await page.goto('/talents');
  const timeline = await openDetail(page, 1440);
  const current = timeline.getByLabel('当前跟进安排', { exact: true });
  await expect(current).toBeVisible();
  await current.getByRole('button', { name: '完成并记录', exact: true }).click();
  const form = timeline.locator('form');
  const summary = form.getByPlaceholder('本次沟通要点（必填）');
  const next = form.getByPlaceholder('不设置', { exact: true });
  await summary.fill('冲突后保留的沟通记录');
  await next.fill('2029-01-10');
  await next.press('Tab');
  const save = form.getByRole('button', { name: '完成并保存', exact: true });
  await save.click();
  await expect(save).toBeDisabled();
  await timeline.getByRole('button', { name: '刷新安排，保留输入', exact: true }).click();
  await expect(current).toContainText('2028-12-01');
  await expect(summary).toHaveValue('冲突后保留的沟通记录');
  await expect(next).toHaveValue('2029-01-10');
  await expect(save).toBeDisabled();
  expect(rejected).toEqual([expect.objectContaining({ expectedPlanId: history.id, completePlanId: history.id })]);
  expect(state.writes).toHaveLength(0);
  await current.getByRole('button', { name: '完成并记录', exact: true }).click();
  await save.click();
  await expect(current).toContainText('2029-01-10');
  expect(state.writes[0]).toMatchObject({ expectedPlanId: conflictingPlan.id, completePlanId: conflictingPlan.id, nextFollowUpAt: '2029-01-10', summary: '冲突后保留的沟通记录' });
});
