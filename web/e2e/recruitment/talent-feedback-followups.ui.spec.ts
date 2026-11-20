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
};
const envelope = (data: unknown) => ({ contentType: 'application/json', body: JSON.stringify({ code: 0, data }) });

async function install(page: Page) {
  const state = { history: [history], reads: 0, failReads: 0, writes: [] as Array<Record<string, unknown>>, calls: [] as string[] };
  await page.addInitScript(() => {
    localStorage.setItem('token', 'mock-followups'); localStorage.setItem('expiresAt', String(Date.now() + 600000));
  });
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
        const record = { ...history, ...body, id: 'saved-follow-up', occurredAt: `${body.occurredAt}T00:00:00.000Z`, nextFollowUpAt: body.nextFollowUpAt ? `${body.nextFollowUpAt}T00:00:00.000Z` : null };
        state.history = [record, ...state.history];
        return route.fulfill({ status: 201, ...envelope(record) });
      }
      ++state.reads;
      if (state.failReads > 0) { --state.failReads; return route.fulfill({ status: 503, ...envelope(null) }); }
      return route.fulfill(envelope(state.history));
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
      await expect(page.locator('.mobile-result-card').filter({ hasText: second.name }).locator('.mobile-result-field').filter({ hasText: '下次跟进' })).toHaveText('下次跟进-');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    });
  });
}

for (const width of [1440, 390]) {
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
    const state = await install(page); await page.goto('/talents');
    const timeline = await openDetail(page, width);
    await expect(timeline).toContainText('已经读取的历史沟通');
    await timeline.getByRole('button', { name: '记一条', exact: true }).click();
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
    expect(state.writes).toEqual([{ occurredAt: '2026-11-20', channel: 'phone', summary: '保存成功但读取暂时失败的沟通', nextFollowUpAt: '2028-02-29' }]);
    await timeline.getByRole('button', { name: '重试', exact: true }).click();
    await expect(timeline).toContainText('保存成功但读取暂时失败的沟通');
    await expect(timeline).toContainText('2028-02-29');
    await page.locator('.talent-detail-drawer .el-drawer__close-btn').click();
    await openDetail(page, width);
    await expect(timeline).toContainText('保存成功但读取暂时失败的沟通');
    expect(state.writes).toHaveLength(1);
  });
}

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
  await timeline.getByRole('button', { name: '记一条', exact: true }).click();
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
