import { test, expect, type Page } from '@playwright/test';

const candidate = { id: '11111111-1111-4111-8111-111111111111', editVersion: 'v1', name: '办理体验虚构人才', phone: '17000000000', status: 'new', sourceChannel: 'referral', gender: 'unknown', tags: [], files: [], followUps: [], shares: [], updatedAt: '2026-11-18T00:00:00Z' };
const app = { id: 'app-one', candidateId: candidate.id, positionName: '虚构研发岗', recruitmentBatch: '秋招', ownerId: 'hr-one', ownerName: '虚构经办', stage: 'interviewing', revision: 3, allowedActions: ['edit', 'submit_hiring', 'reject', 'reserve', 'withdraw'], events: [], activitySummary: { scheduledCount: 1, unsubmittedFeedbackCount: 1 } };
const second = { ...app, id: 'app-two', positionName: '虚构设计岗' };
const interview = { id: 'interview-one', candidateId: candidate.id, candidateNameSnapshot: candidate.name, applicationId: app.id, application: app, startsAt: '2036-12-01T02:00:00Z', endsAt: '2036-12-01T03:00:00Z', invitationText: '虚构面试邀请', meetingUrl: null, note: '', status: 'scheduled', syncStatus: 'unconfigured', version: 2, participantNames: ['虚构面试官'], participants: [{ userId: 'person-one', userNameSnapshot: '虚构面试官' }] };
const envelope = (data: unknown) => ({ contentType: 'application/json', body: JSON.stringify({ code: 0, data }) });
async function install(page: Page) {
  const writes: Record<string, unknown>[] = [];
  await page.addInitScript(() => { localStorage.setItem('token', 'mock-recruitment'); localStorage.setItem('expiresAt', String(Date.now() + 600000)); });
  await page.route('**/api/v1/**', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    if (path.endsWith('/auth/me')) return route.fulfill(envelope({ id: 'hr-one', name: '虚构经办', sysRole: 'hr', hrCapabilities: [], businessCapabilities: {} }));
    if (path.endsWith('/notifications/unread-count')) return route.fulfill(envelope({ count: 0 }));
    if (path.endsWith('/talents')) return route.fulfill(envelope({ items: [{ ...candidate, latestApplication: app }], total: 1 }));
    if (path.endsWith(`/talents/${candidate.id}`)) return route.fulfill(envelope(candidate));
    if (path.endsWith('/applications') && path.includes('/candidates/')) return route.fulfill(envelope([app, second]));
    if (path.endsWith(`/applications/${app.id}`)) return route.fulfill(envelope(app));
    if (path.endsWith(`/applications/${second.id}`)) return route.fulfill(envelope(second));
    if (path.endsWith('/owners')) return route.fulfill(envelope({ items: [], total: 0 }));
    if (path.endsWith('/users/person-one')) return route.fulfill(envelope({ id: 'person-one', name: '虚构面试官', employeeNo: 'MOCK', status: 'active' }));
    if (path.endsWith('/feedback')) return route.fulfill(envelope({ interviewVersion: 2, own: null, items: [], canEdit: true, canReturn: false }));
    if (path.endsWith('/talent-interviews') && req.method() === 'GET') return route.fulfill(envelope([interview, { ...interview, id: 'interview-two', applicationId: second.id, application: second }, { ...interview, id: 'legacy-one', applicationId: null, application: null }]));
    if (path.endsWith(`/talent-interviews/${interview.id}`) && req.method() === 'GET') return route.fulfill(envelope({ ...interview, version: 3, invitationText: '另一位经办已保存的邀请' }));
    if (req.method() !== 'GET') { writes.push(req.postDataJSON() ?? {}); return route.fulfill(envelope({ ...interview, version: 4 })); }
    return route.fulfill(envelope([]));
  });
  return writes;
}
async function open(page: Page) {
  await page.goto('/talents');
  await page.getByText(candidate.name, { exact: true }).first().click();
  await expect(page.locator('.application-panel__stage')).toHaveText('面试中');
}
test('new invite and close retain input until explicit discard; save never loses its editor', async ({ page }) => {
  await install(page); await open(page);
  const panel = page.locator('.interview-panel');
  await panel.getByRole('button', { name: '新增面试', exact: true }).click();
  await panel.getByLabel('会议邀请内容').fill('未保存的虚构邀请');
  await panel.getByRole('button', { name: '新增面试', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '未保存的内容' })).toBeVisible();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(panel.getByLabel('会议邀请内容')).toHaveValue('未保存的虚构邀请');
  await expect(page.getByRole('dialog', { name: '未保存的内容' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '未保存的内容' })).toBeVisible();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(panel.getByLabel('会议邀请内容')).toHaveValue('未保存的虚构邀请');
});
test('current application filters interviews and disabled calendar has no retry; ending warns without writes', async ({ page }) => {
  const writes = await install(page); await open(page);
  const panel = page.locator('.interview-panel');
  await expect(panel.locator('.interview-panel__list > .el-collapse-item')).toHaveCount(1);
  await expect(panel.getByRole('button', { name: '重试日程同步' })).toHaveCount(0);
  await expect(panel).toContainText('钉钉日程未开通');
  await page.locator('.application-panel').getByRole('button', { name: '淘汰本次应聘', exact: true }).click();
  await page.getByLabel('原因 / 意见').fill('虚构终止原因');
  await page.locator('.application-panel__command').getByRole('button', { name: '淘汰本次应聘', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '本次应聘仍有待处理事项' })).toContainText('未结束面试 1');
  await page.getByRole('button', { name: '返回处理', exact: true }).click();
  expect(writes).toHaveLength(0);
});
test('conflicting interview refresh keeps draft and uses latest version', async ({ page }) => {
  await install(page);
  const writes: Record<string, unknown>[] = [];
  await page.route(`**/api/v1/talent-interviews/${interview.id}`, route => {
    if (route.request().method() === 'GET') return route.fallback();
    writes.push(route.request().postDataJSON());
    return writes.length === 1 ? route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ message: '版本冲突' }) }) : route.fulfill(envelope({ ...interview, version: 4 }));
  });
  await open(page);
  const panel = page.locator('.interview-panel');
  await panel.locator('.el-collapse-item__header').first().click();
  await panel.getByRole('button', { name: '修改邀约' }).first().click();
  await panel.getByLabel('会议邀请内容').fill('冲突后保留的邀请');
  await panel.getByRole('button', { name: '保存邀约' }).click();
  await expect.poll(() => writes.length).toBe(1);
  await panel.getByRole('button', { name: '刷新邀约，保留输入' }).click();
  await expect(panel.getByLabel('会议邀请内容')).toHaveValue('冲突后保留的邀请');
  await panel.getByRole('button', { name: '最新已保存内容（核对后重提）' }).click();
  await expect(panel.locator('.interview-panel__latest')).toContainText('另一位经办已保存的邀请');
  await panel.getByRole('button', { name: '保存邀约' }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes.map(body => body.version)).toEqual([2, 3]);
});

test('switching application or navigating away protects nested feedback and selected context', async ({ page }) => {
  await install(page); await open(page);
  const panel = page.locator('.interview-panel');
  await panel.locator('.el-collapse-item__header').first().click();
  await panel.getByLabel('面试意见', { exact: true }).fill('尚未提交的虚构反馈');
  const selector = page.getByRole('combobox', { name: '选择应聘记录' });
  await selector.press('ArrowDown'); await page.getByRole('option', { name: /虚构设计岗/ }).click();
  await expect(page.getByRole('dialog', { name: '未保存的内容' })).toBeVisible();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '未保存的内容' })).toHaveCount(0);
  await expect(panel.getByLabel('面试意见', { exact: true })).toHaveValue('尚未提交的虚构反馈');
  await panel.getByRole('link', { name: '打开邀约', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '未保存的内容' })).toBeVisible();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(page).toHaveURL(/\/talents$/);
  await expect(page.getByRole('dialog', { name: '未保存的内容' })).toHaveCount(0);
  await selector.press('ArrowDown'); await page.getByRole('option', { name: /虚构设计岗/ }).click();
  await page.getByRole('button', { name: '放弃修改', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '未保存的内容' })).toHaveCount(0);
  await expect(panel.locator('.interview-panel__list')).toContainText('虚构设计岗');
  await expect(panel.locator('.interview-panel__list')).not.toContainText('虚构研发岗');
});

test('saving prevents drawer close, new editor and navigation; one request is sent', async ({ page }) => {
  await install(page);
  let release!: () => void;
  const finished = new Promise<void>(resolve => { release = resolve; });
  let writes = 0;
  await page.route(`**/api/v1/talent-interviews/${interview.id}`, async route => {
    if (route.request().method() === 'GET') return route.fallback();
    writes++; await finished; await route.fulfill(envelope({ ...interview, version: 3 }));
  });
  await open(page);
  const panel = page.locator('.interview-panel');
  await panel.locator('.el-collapse-item__header').first().click();
  await panel.getByRole('button', { name: '修改邀约' }).click();
  await panel.getByLabel('会议邀请内容').fill('保存中的虚构邀请');
  await panel.getByRole('button', { name: '保存邀约' }).click();
  await expect.poll(() => writes).toBe(1);
  await expect(panel.getByRole('button', { name: '新增面试' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(panel.getByLabel('会议邀请内容')).toHaveValue('保存中的虚构邀请');
  await panel.getByRole('link', { name: '打开邀约', exact: true }).click();
  await expect(page).toHaveURL(/\/talents$/);
  expect(writes).toBe(1);
  release(); await expect(panel.getByLabel('会议邀请内容')).toHaveCount(0);
});

for (const width of [1440, 1024, 390]) test(`application detail has no horizontal overflow at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 850 });
  await install(page);
  await page.goto('/talents');
  if (width <= 768) await page.getByRole('button', { name: '打开详情', exact: true }).click();
  else await page.getByText(candidate.name, { exact: true }).first().click();
  const panel = page.locator('.interview-panel');
  await expect(page.locator('.application-panel__stage')).toHaveText('面试中');
  await panel.getByRole('button', { name: '新增面试', exact: true }).click();
  await expect(panel.getByLabel('会议邀请内容')).toHaveValue(new RegExp(candidate.name));
  await expect(panel.getByLabel('会议邀请内容')).toHaveValue(new RegExp(app.positionName));
  await expect(panel.getByLabel('会议邀请内容')).toHaveValue(/北京时间/);
  await expect(panel).not.toContainText('未识别到有效的腾讯会议链接');
  expect(await page.locator('.el-drawer__body').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(`application-${width}.png`), animations: 'disabled' });
});

test('legacy interview stays explicitly unlinked when editing from a selected application', async ({ page }) => {
  const writes = await install(page); await open(page);
  const panel = page.locator('.interview-panel');
  await panel.getByRole('button', { name: /查看其他应聘/ }).click();
  const legacy = panel.locator('.el-collapse-item').filter({ hasText: '未关联应聘记录' });
  await legacy.locator('.el-collapse-item__header').click();
  await legacy.getByRole('button', { name: '修改邀约' }).click();
  await expect(panel.locator('.interview-panel__editor')).toContainText('未关联应聘记录');
  await expect(panel.locator('.interview-panel__editor')).toContainText('保存修改不会自动绑定到当前应聘');
  await panel.getByLabel('会议邀请内容').fill('仅维护历史邀约');
  await panel.getByRole('button', { name: '保存邀约' }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].applicationId).toBeUndefined();
});

test('future interview completion requires explicit actual-completion confirmation', async ({ page }) => {
  const writes = await install(page); await open(page);
  const panel = page.locator('.interview-panel');
  await panel.locator('.el-collapse-item__header').first().click();
  await panel.getByRole('button', { name: '完成面试', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '面试邀约', exact: true })).toContainText('尚未到预约时间');
  await page.getByRole('button', { name: '返回', exact: true }).click();
  expect(writes).toHaveLength(0);
});

test('409 refresh rechecks completed status and keeps invitation without allowing another write', async ({ page }) => {
  await install(page);
  let writes = 0;
  await page.route(`**/api/v1/talent-interviews/${interview.id}`, route => {
    if (route.request().method() === 'GET') return route.fulfill(envelope({ ...interview, version: 3, status: 'completed' }));
    writes++; return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ message: '版本冲突' }) });
  });
  await open(page);
  const panel = page.locator('.interview-panel');
  await panel.locator('.el-collapse-item__header').first().click();
  await panel.getByRole('button', { name: '修改邀约' }).click();
  await panel.getByLabel('会议邀请内容').fill('状态变化后保留的邀请');
  await panel.getByRole('button', { name: '保存邀约' }).click();
  await panel.getByRole('button', { name: '刷新邀约，保留输入' }).click();
  await expect(panel.getByLabel('会议邀请内容')).toHaveValue('状态变化后保留的邀请');
  await expect(panel.getByRole('button', { name: '保存邀约' })).toBeDisabled();
  await expect(panel).toContainText('邀约当前不可修改');
  expect(writes).toBe(1);
});

test('mobile hiring review keeps unsaved note on return and shows queue after explicit discard', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 });
  await install(page);
  const review = { ...app, candidateName: candidate.name, stage: 'hiring_review', allowedActions: ['approve_hiring', 'return_hiring'] };
  await page.route('**/api/v1/talent-recruitment/hiring-reviews', route => route.fulfill(envelope([review, { ...review, id: 'second-review' }])));
  await page.route(`**/api/v1/talent-recruitment/applications/${app.id}`, route => route.fulfill(envelope(review)));
  await page.goto('/talent-hiring');
  await page.getByRole('button', { name: '退回经办', exact: true }).click();
  await page.getByLabel('退回原因').fill('待核对的虚构录用意见');
  await page.getByRole('button', { name: '返回待确认列表', exact: true }).click();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(page.getByLabel('退回原因')).toHaveValue('待核对的虚构录用意见');
  await expect(page.getByRole('dialog', { name: '未保存的内容' })).toHaveCount(0);
  await page.getByRole('button', { name: '返回待确认列表', exact: true }).click();
  await page.getByRole('button', { name: '放弃修改', exact: true }).click();
  await expect(page.locator('.hiring-review__queue')).toBeVisible();
  await expect(page.getByLabel('退回原因')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

async function openFromQueue(page: Page) {
  await page.route('**/api/v1/talent-recruitment/applications?**', route => route.fulfill(envelope({
    items: [{ ...app, candidateName: candidate.name, updatedAt: '2026-11-18T00:00:00Z', nextInterview: interview }], total: 1,
  })));
  await page.goto('/talent-interviews');
  await page.getByRole('button', { name: '办理', exact: true }).click();
  await expect(page.locator('.application-panel__stage')).toHaveText('面试中');
}

test('queue nested interview save preserves open application edit inputs during parent refresh', async ({ page }) => {
  await install(page); await openFromQueue(page);
  const application = page.locator('.application-panel'), interviews = page.locator('.interview-panel');
  await application.getByRole('button', { name: '修改应聘', exact: true }).click();
  await application.getByLabel('岗位名称').fill('尚未保存的虚构岗位调整');
  await interviews.locator('.el-collapse-item__header').first().click();
  await interviews.getByRole('button', { name: '修改邀约', exact: true }).click();
  await interviews.getByLabel('会议邀请内容').fill('已保存的虚构面试调整');
  const refresh = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/talent-recruitment/applications'));
  await interviews.getByRole('button', { name: '保存邀约', exact: true }).click();
  await refresh;
  await expect(interviews.getByLabel('会议邀请内容')).toHaveCount(0);
  await expect(application.getByLabel('岗位名称')).toHaveValue('尚未保存的虚构岗位调整');
  await expect(application.getByRole('button', { name: '保存应聘', exact: true })).toBeEnabled();
});

test('queue nested feedback save preserves open application action note during parent refresh', async ({ page }) => {
  await install(page); await openFromQueue(page);
  const application = page.locator('.application-panel'), interviews = page.locator('.interview-panel');
  await application.getByRole('button', { name: '提交录用', exact: true }).click();
  await application.getByLabel('原因 / 意见').fill('尚未提交的虚构录用意见');
  await interviews.locator('.el-collapse-item__header').first().click();
  await interviews.getByLabel('面试意见', { exact: true }).fill('独立保存的虚构面试草稿');
  const refresh = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/talent-recruitment/applications'));
  await interviews.getByRole('button', { name: '保存草稿', exact: true }).click();
  await refresh;
  await expect(application.getByLabel('原因 / 意见')).toHaveValue('尚未提交的虚构录用意见');
  await expect(application.locator('.application-panel__command')).toBeVisible();
});
