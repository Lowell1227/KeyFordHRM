import { test, expect, type Page } from '@playwright/test';

const candidate = { id: '11111111-1111-4111-8111-111111111111', editVersion: 'v1', name: '招聘闭环虚构人才', phone: '17000000000', status: 'new', sourceChannel: 'referral', gender: 'unknown', tags: [], files: [], followUps: [], shares: [], ownerName: '虚构经办', updatedAt: '2026-11-18T00:00:00Z' };
const app = { id: 'application-one', candidateId: candidate.id, positionName: '虚构研发工程师', recruitmentBatch: '秋招', ownerId: 'hr-one', ownerName: '虚构经办', stage: 'screening', revision: 3, expectedEntryDate: null, allowedActions: ['edit', 'start_interview', 'submit_hiring', 'reject', 'reserve', 'withdraw'], events: [], onboardingRequest: null };
const interview = { id: 'interview-one', candidateNameSnapshot: candidate.name, startsAt: '2026-12-01T02:00:00Z', endsAt: '2026-12-01T03:00:00Z', invitationText: '虚构面试邀请', meetingUrl: null, status: 'completed', version: 2, sourceDeleted: false, participantNames: ['虚构面试官'] };
const envelope = (data: unknown) => ({ contentType: 'application/json', body: JSON.stringify({ code: 0, data }) });

async function install(page: Page, employee = false) {
  const calls: string[] = [], writes: Array<Record<string, unknown>> = [];
  await page.addInitScript(() => { localStorage.setItem('token', 'mock-recruitment'); localStorage.setItem('expiresAt', String(Date.now() + 600000)); });
  await page.route('**/api/v1/**', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    calls.push(path + url.search);
    if (path.endsWith('/auth/me')) return route.fulfill(envelope({ id: employee ? 'interviewer' : 'hr-one', name: '虚构使用者', sysRole: employee ? 'employee' : 'hr', hrCapabilities: [], businessCapabilities: {} }));
    if (path.endsWith('/notifications/unread-count')) return route.fulfill(envelope({ count: 0 }));
    if (path.endsWith('/talents')) return route.fulfill(envelope({ items: [{ ...candidate, latestApplication: app }], total: 1 }));
    if (path.endsWith(`/talents/${candidate.id}`)) return route.fulfill(envelope(candidate));
    if (path.endsWith('/applications') && path.includes('/candidates/')) return route.fulfill(envelope([app]));
    if (path.endsWith(`/applications/${app.id}`)) return route.fulfill(envelope(app));
    if (path.endsWith('/actions')) { writes.push(req.postDataJSON()); return route.fulfill(envelope({ ...app, stage: 'interviewing', revision: 4, allowedActions: ['submit_hiring'], events: [] })); }
    if (path.endsWith('/owners')) return route.fulfill(envelope({ items: [{ id: 'hr-one', name: '虚构经办', employeeNo: 'MOCK', deptName: '虚构人事部' }], total: 1 }));
    if (path.endsWith('/feedback')) return route.fulfill(envelope({ interviewVersion: interview.version, own: null, items: [], canEdit: true, canReturn: false }));
    if (path.endsWith('/talent-interviews')) return route.fulfill(envelope([]));
    if (path.endsWith(`/talent-interviews/${interview.id}`)) return route.fulfill(envelope(interview));
    if (path.endsWith('/departments') || path.endsWith('/follow-ups')) return route.fulfill(envelope([]));
    return route.fulfill(envelope(null));
  });
  return { calls, writes };
}

test('application actions use server revision and refresh the selected record', async ({ page }) => {
  const { writes, calls } = await install(page);
  await page.goto('/talents');
  await page.getByRole('combobox', { name: '负责范围', exact: true }).press('ArrowDown');
  await page.getByRole('option', { name: '我负责的人才', exact: true }).click();
  await expect.poll(() => calls.some(url => url.includes('responsibilityScope=talent'))).toBe(true);
  await page.getByText(candidate.name, { exact: true }).first().click();
  await expect(page.getByRole('heading', { name: '应聘记录' })).toBeVisible();
  await expect(page.getByRole('button', { name: '确认录用', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '进入面试', exact: true }).click();
  await page.locator('.application-panel__command').getByRole('button', { name: '进入面试', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({ expectedRevision: 3, action: 'start_interview' });
  await expect(page.locator('.application-panel__stage')).toContainText('面试中');
});

test('application create keeps the same request ID on a lost response until a new form is opened', async ({ page }) => {
  await install(page);
  const writes: Array<{ requestId: string; positionName: string }> = [];
  await page.route('**/api/v1/talent-recruitment/candidates/*/applications', route => {
    if (route.request().method() !== 'POST') return route.fallback();
    writes.push(route.request().postDataJSON());
    if (writes.length === 1) return route.abort('failed');
    if (writes.length === 2) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ message: '本次新建请求已用于其他应聘内容，请重新发起' }) });
    return route.fulfill(envelope({ ...app, id: 'new-intent' }));
  });
  await page.goto('/talents');
  await page.getByText(candidate.name, { exact: true }).first().click();
  const panel = page.locator('.application-panel');
  await panel.getByRole('button', { name: '新增应聘' }).click();
  await panel.getByLabel('岗位名称').fill('虚构岗位');
  await panel.getByRole('button', { name: '保存应聘' }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].requestId).toMatch(/^[a-f0-9-]{36}$/i);
  await panel.getByLabel('岗位名称').fill('虚构岗位调整');
  await panel.getByRole('button', { name: '保存应聘' }).click();
  await expect.poll(() => writes[1]?.requestId).toBe(writes[0].requestId);
  await expect(panel).toContainText('核对应聘记录');
  await panel.getByRole('button', { name: '取消编辑' }).click();
  await panel.getByRole('button', { name: '新增应聘' }).click();
  await panel.getByLabel('岗位名称').fill('虚构岗位');
  await panel.getByRole('button', { name: '保存应聘' }).click();
  await expect.poll(() => writes.length).toBe(3);
  expect(writes[2].requestId).toMatch(/^[a-f0-9-]{36}$/i);
  expect(writes[2].requestId).not.toBe(writes[0].requestId);
});

test('invited employee sees own feedback without querying the talent pool', async ({ page }) => {
  const { calls } = await install(page, true);
  await page.goto(`/talent-interviews/${interview.id}`);
  await expect(page.getByRole('heading', { name: '本人反馈' })).toBeVisible();
  await expect(page.getByRole('button', { name: '提交反馈', exact: true })).toBeVisible();
  expect(calls.some(url => url.includes('/talents'))).toBe(false);
  expect(calls.some(url => url.includes('/candidates/'))).toBe(false);
});

for (const width of [1440, 1024, 390]) {
  test(`multiple applications and hiring actions remain compact at ${width}px (mock)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await install(page);
    let current = { ...app, positionName: '工程师'.repeat(24) };
    const history = { ...app, id: 'historic-application', positionName: '历史岗位', stage: 'rejected', allowedActions: ['reopen'] };
    const writes: Array<Record<string, unknown>> = [];
    const stages: Record<string, { stage: string; allowedActions: string[] }> = {
      submit_hiring: { stage: 'hiring_review', allowedActions: ['approve_hiring', 'return_hiring'] },
      approve_hiring: { stage: 'offered', allowedActions: ['accept_offer', 'decline_offer'] },
      accept_offer: { stage: 'accepted', allowedActions: ['withdraw'] },
    };
    await page.route('**/api/v1/talent-recruitment/**', async route => {
      const req = route.request(), path = new URL(req.url()).pathname;
      if (path.endsWith('/applications') && path.includes('/candidates/')) return route.fulfill(envelope([current, history]));
      if (path.endsWith('/actions')) {
        const body = req.postDataJSON(); writes.push(body);
        current = { ...current, ...stages[body.action], revision: current.revision + 1 };
        return route.fulfill(envelope(current));
      }
      if (path.endsWith(`/applications/${current.id}`)) return route.fulfill(envelope(current));
      if (path.endsWith(`/applications/${history.id}`)) return route.fulfill(envelope(history));
      return route.fallback();
    });
    await page.goto('/talents');
    if (width <= 768) await page.getByRole('button', { name: '打开详情', exact: true }).click();
    else await page.getByText(candidate.name, { exact: true }).first().click();
    const panel = page.locator('.application-panel');
    await expect(panel.getByRole('heading', { name: '应聘记录' })).toBeVisible();
    const selector = panel.getByRole('combobox', { name: '选择应聘记录' });
    await selector.press('ArrowDown');
    await page.getByRole('option', { name: /历史岗位/ }).click();
    await expect(panel.getByRole('button', { name: '重开应聘', exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: '提交录用', exact: true })).toHaveCount(0);
    await selector.press('ArrowDown');
    await page.getByRole('option', { name: /工程师/ }).click();
    await panel.getByRole('button', { name: '提交录用', exact: true }).click();
    await panel.locator('.application-panel__command').getByRole('button', { name: '提交录用', exact: true }).click();
    await expect(panel.getByText('请填写原因或录用意见')).toBeVisible();
    expect(writes).toHaveLength(0);
    await panel.getByLabel('原因 / 意见').fill('虚构岗位匹配，申请录用');
    await panel.locator('.application-panel__command').getByRole('button', { name: '提交录用', exact: true }).click();
    await panel.getByRole('button', { name: '确认录用', exact: true }).click();
    await panel.locator('.application-panel__command').getByRole('button', { name: '确认录用', exact: true }).click();
    await panel.getByRole('button', { name: '候选人接受', exact: true }).click();
    await panel.locator('.application-panel__command').getByRole('button', { name: '候选人接受', exact: true }).click();
    await expect(panel.getByRole('button', { name: '办理入职', exact: true })).toBeVisible();
    expect(writes.map(body => body.expectedRevision)).toEqual([3, 4, 5]);
    await expect(panel.locator('.application-panel__stage')).toHaveText('已接受录用');
    expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `../e2e-artifacts/talent-recruitment-${width}.png`, fullPage: true });
    await panel.getByRole('button', { name: '办理入职', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/entry-exit\\?talentId=${candidate.id}&talentApplicationId=${app.id}`));
  });
}

test('application create and edit preserve separate position, batch, owner and entry date', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await install(page);
  const writes: Array<Record<string, unknown>> = [];
  await page.route(`**/api/v1/talent-recruitment/candidates/${candidate.id}/applications`, async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON(); writes.push(body);
    return route.fulfill(envelope({ ...app, ...body, id: 'new-application', revision: 1 }));
  });
  await page.route('**/api/v1/talent-recruitment/applications/new-application', async route => {
    const body = route.request().postDataJSON(); writes.push(body);
    return route.fulfill(envelope({ ...app, ...body, id: 'new-application', revision: 2 }));
  });
  await page.goto('/talents'); await page.getByText(candidate.name, { exact: true }).first().click();
  const panel = page.locator('.application-panel');
  await panel.getByRole('button', { name: '新增应聘', exact: true }).click();
  await panel.getByLabel('岗位名称').fill('另一次应聘岗位');
  await panel.getByLabel('招聘批次').fill('冬季补录');
  await panel.getByLabel('预计到岗').fill('2026-12-15');
  await panel.getByLabel('预计到岗').press('Enter');
  await panel.getByRole('button', { name: '保存应聘', exact: true }).click();
  expect(errors).toEqual([]);
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({ positionName: '另一次应聘岗位', recruitmentBatch: '冬季补录', deptId: null, expectedEntryDate: '2026-12-15' });
  await panel.getByRole('button', { name: '修改应聘', exact: true }).click();
  await panel.getByLabel('岗位名称').fill('另一次应聘岗位修订');
  await panel.getByRole('button', { name: '保存应聘', exact: true }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1]).toMatchObject({ expectedRevision: 1, positionName: '另一次应聘岗位修订' });
  await expect(page.locator('.talent-detail-drawer')).toContainText(candidate.name);
});

test('409 application action keeps note and only explicitly refreshes revisions', async ({ page }) => {
  await install(page);
  let detailReads = 0, attempts = 0;
  await page.route(`**/api/v1/talent-recruitment/applications/${app.id}`, async route => { ++detailReads; return route.fulfill(envelope({ ...app, revision: 4 })); });
  await page.route('**/api/v1/talent-recruitment/applications/*/actions', async route => {
    ++attempts;
    if (attempts === 1) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ message: '版本冲突' }) });
    expect(route.request().postDataJSON()).toMatchObject({ expectedRevision: 4, note: '需要保留的录用意见' });
    return route.fulfill(envelope({ ...app, stage: 'hiring_review', revision: 5, allowedActions: [] }));
  });
  await page.goto('/talents'); await page.getByText(candidate.name, { exact: true }).first().click();
  const panel = page.locator('.application-panel');
  await panel.getByRole('button', { name: '提交录用', exact: true }).click();
  await panel.getByLabel('原因 / 意见').fill('需要保留的录用意见');
  await panel.locator('.application-panel__command').getByRole('button', { name: '提交录用', exact: true }).click();
  await expect(panel).toContainText('输入已保留');
  await expect(panel.getByLabel('原因 / 意见')).toHaveValue('需要保留的录用意见');
  expect(detailReads).toBe(0);
  await panel.getByRole('button', { name: '刷新记录，保留输入' }).click();
  await expect.poll(() => detailReads).toBe(1);
  await expect(panel.getByLabel('原因 / 意见')).toHaveValue('需要保留的录用意见');
  await panel.locator('.application-panel__command').getByRole('button', { name: '提交录用', exact: true }).click();
  await expect(panel.locator('.application-panel__stage')).toHaveText('待录用确认');
});

test('feedback submission uses own revision, keeps conflict input, then becomes read-only', async ({ page }) => {
  await install(page, true);
  let attempts = 0;
  await page.route('**/api/v1/talent-recruitment/interviews/*/feedback', async route => {
    if (route.request().method() !== 'PUT') return route.fulfill(envelope({ interviewVersion: attempts ? 3 : 2, own: null, items: [], canEdit: true, canReturn: false }));
    const body = route.request().postDataJSON(); ++attempts;
    expect(body).toMatchObject({ interviewVersion: attempts === 1 ? 2 : 3, expectedRevision: 0, outcome: 'pass', summary: '虚构面试意见', submit: true });
    if (attempts === 1) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ message: '版本冲突' }) });
    const own = { interviewId: interview.id, userId: 'interviewer', userName: '虚构面试官', status: 'submitted', outcome: body.outcome, summary: body.summary, revision: 1 };
    return route.fulfill(envelope({ interviewVersion: 3, own, items: [own], canEdit: false, canReturn: false }));
  });
  await page.goto(`/talent-interviews/${interview.id}`);
  const panel = page.locator('.interview-feedback');
  await panel.getByRole('radio', { name: '通过', exact: true }).locator('..').click();
  await panel.getByLabel('面试意见').fill('虚构面试意见');
  await panel.getByRole('button', { name: '提交反馈' }).click();
  await expect(panel).toContainText('输入已保留');
  await expect(panel.getByLabel('面试意见')).toHaveValue('虚构面试意见');
  await panel.getByRole('button', { name: '刷新反馈，保留输入' }).click();
  await panel.getByRole('button', { name: '提交反馈' }).click();
  await expect(panel.getByText('虚构面试意见', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: '提交反馈' })).toHaveCount(0);
  await expect(panel.getByRole('textbox')).toHaveCount(0);
});

test('feedback refresh preserves a local draft without offering submission when the stage has closed', async ({ page }) => {
  await install(page, true);
  let writes = 0;
  await page.route('**/api/v1/talent-recruitment/interviews/*/feedback', route => {
    if (route.request().method() === 'GET') return route.fulfill(envelope({ interviewVersion: writes ? 3 : 2, own: null, items: [], canEdit: !writes, canReturn: false }));
    writes++;
    return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ message: '版本冲突' }) });
  });
  await page.goto(`/talent-interviews/${interview.id}`);
  const panel = page.locator('.interview-feedback');
  await panel.getByLabel('面试意见').fill('虚构未提交意见');
  await panel.getByRole('button', { name: '保存草稿' }).click();
  await panel.getByRole('button', { name: '刷新反馈，保留输入' }).click();
  await expect(panel.getByText('虚构未提交意见', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: '提交反馈' })).toHaveCount(0);
  expect(writes).toBe(1);
});

test('HR feedback return requires a reason and targets the selected author revision', async ({ page }) => {
  await install(page);
  const feedback = { interviewId: interview.id, userId: 'author-one', userName: '虚构反馈人', status: 'submitted', outcome: 'pending', summary: '待补充意见', revision: 7 };
  const writes: Array<Record<string, unknown>> = [];
  await page.route('**/api/v1/talent-recruitment/interviews/*/feedback', route => route.fulfill(envelope({ interviewVersion: writes.length ? 3 : 2, own: null, items: [feedback], canEdit: false, canReturn: true })));
  await page.route('**/api/v1/talent-recruitment/interviews/*/feedback/author-one/return', route => {
    writes.push(route.request().postDataJSON());
    if (writes.length === 1) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ message: '版本冲突' }) });
    return route.fulfill(envelope({ interviewVersion: 3, own: null, items: [{ ...feedback, status: 'draft', revision: 8 }], canEdit: false, canReturn: false }));
  });
  await page.goto(`/talent-interviews/${interview.id}`);
  const panel = page.locator('.interview-feedback');
  await panel.getByRole('button', { name: '退回反馈', exact: true }).click();
  await panel.getByRole('button', { name: '退回修改', exact: true }).click();
  await expect(panel.getByText('请填写退回原因')).toBeVisible();
  await panel.getByLabel('退回原因').fill('请补充岗位匹配依据');
  await panel.getByRole('button', { name: '退回修改', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toEqual({ interviewVersion: 2, expectedRevision: 7, note: '请补充岗位匹配依据' });
  await panel.getByRole('button', { name: '刷新反馈，保留输入' }).click();
  await expect(panel.getByLabel('退回原因')).toHaveValue('请补充岗位匹配依据');
  await panel.getByRole('button', { name: '退回修改', exact: true }).click();
  await expect.poll(() => writes[1]).toEqual({ interviewVersion: 3, expectedRevision: 7, note: '请补充岗位匹配依据' });
  await expect(panel.getByRole('button', { name: '退回反馈', exact: true })).toHaveCount(0);
});

test('detail failures show retry and rejecting a talent refreshes the main list', async ({ page }) => {
  await install(page);
  let detailReads = 0, listReads = 0;
  await page.route(`**/api/v1/talents/${candidate.id}`, async route => {
    if (route.request().method() === 'PATCH') return route.fulfill(envelope({ ...candidate, status: 'rejected' }));
    if (++detailReads === 1) return route.fulfill({ status: 503, ...envelope(null) });
    return route.fulfill(envelope(candidate));
  });
  await page.route('**/api/v1/talents?**', route => { ++listReads; return route.fulfill(envelope({ items: [candidate], total: 1 })); });
  await page.goto('/talents'); await page.getByText(candidate.name, { exact: true }).first().click();
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByRole('heading', { name: '应聘记录' })).toBeVisible();
  const before = listReads;
  await page.getByRole('button', { name: '设置人才状态', exact: true }).click();
  await page.locator('.el-message-box').getByRole('button', { name: '设为已淘汰', exact: true }).click();
  await expect.poll(() => listReads).toBeGreaterThan(before);
});

test('late delete impact cannot open a confirmation for another candidate', async ({ page }) => {
  await install(page);
  const second = { ...candidate, id: 'candidate-two', name: '第二位虚构人才' };
  await page.route('**/api/v1/talents?**', route => route.fulfill(envelope({ items: [candidate, second], total: 2 })));
  await page.route(`**/api/v1/talents/${second.id}`, route => route.fulfill(envelope(second)));
  let release!: () => void, requested!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { requested = resolve; });
  await page.route(`**/api/v1/talents/${candidate.id}/delete-impact`, async route => {
    requested(); await held;
    return route.fulfill(envelope({ candidateId: candidate.id, version: 'old-impact', requiresForce: false, interviews: [], requests: [] }));
  });
  await page.goto('/talents'); await page.getByText(candidate.name, { exact: true }).first().click();
  await page.getByRole('button', { name: '删除', exact: true }).click(); await started;
  await page.locator('.talent-detail-drawer .el-drawer__close-btn').click();
  await page.getByText(second.name, { exact: true }).first().click();
  await expect(page.locator('.talent-detail-drawer')).toContainText(second.name);
  const response = page.waitForResponse(res => res.url().endsWith('/delete-impact'));
  release(); await response;
  await expect(page.getByRole('dialog', { name: '删除人才记录' })).not.toBeVisible();
  await expect(page.locator('.talent-detail-drawer')).toContainText(second.name);
});

for (const width of [1440, 390]) {
  test(`capability-only hiring review keeps 409 note and never queries talent records at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const { calls } = await install(page, true);
    await page.route('**/api/v1/auth/me', route => route.fulfill(envelope({ id: 'independent-confirmer', name: '虚构录用确认人', status: 'active', sysRole: 'hr_user', hrCapabilities: ['talent_hiring_confirm'], businessCapabilities: {} })));
    let row = { ...app, candidateName: candidate.name, stage: 'hiring_review', hiringReason: '虚构经办提交的录用依据', allowedActions: ['approve_hiring', 'return_hiring'] };
    let attempts = 0;
    await page.route('**/api/v1/talent-recruitment/**', async route => {
      const path = new URL(route.request().url()).pathname;
      calls.push(path);
      if (path.endsWith('/hiring-reviews')) return route.fulfill(envelope([row]));
      if (path.endsWith('/actions')) {
        const body = route.request().postDataJSON(); ++attempts;
        expect(body).toMatchObject({ expectedRevision: attempts === 1 ? 3 : 4, action: 'return_hiring', note: '请补充本岗位的面试依据' });
        if (attempts === 1) { row = { ...row, revision: 4 }; return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ message: '版本已变化' }) }); }
        return route.fulfill(envelope({ ...row, stage: 'interviewing', revision: 5, allowedActions: [] }));
      }
      return route.fulfill(envelope(row));
    });
    await page.goto('/talent-hiring');
    const detail = page.locator('.hiring-review__detail');
    await expect(detail).toContainText('虚构经办提交的录用依据');
    await detail.getByRole('button', { name: '退回经办', exact: true }).click();
    await detail.getByRole('button', { name: '提交退回', exact: true }).click();
    await expect(detail.getByText('请填写退回原因')).toBeVisible();
    await detail.getByLabel('退回原因').fill('请补充本岗位的面试依据');
    await detail.getByRole('button', { name: '提交退回', exact: true }).click();
    await expect(detail.getByLabel('退回原因')).toHaveValue('请补充本岗位的面试依据');
    await detail.getByRole('button', { name: '刷新记录，保留意见', exact: true }).click();
    await expect(detail.getByLabel('退回原因')).toHaveValue('请补充本岗位的面试依据');
    await detail.getByRole('button', { name: '提交退回', exact: true }).click();
    await expect(detail).toContainText('面试中');
    await expect(page.getByText('待确认 0', { exact: true })).toBeVisible();
    expect(calls.some(url => /\/(talents|users|departments)(\/|\?|$)/.test(url))).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `../e2e-artifacts/talent-hiring-${width}.png`, fullPage: true });
  });
}

test('late hiring detail cannot replace the newly selected application', async ({ page }) => {
  await install(page);
  const first = { ...app, candidateName: '第一位确认候选人', stage: 'hiring_review', allowedActions: ['approve_hiring'] };
  const second = { ...first, id: 'second-review', candidateName: '第二位确认候选人' };
  let release!: () => void, requested!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { requested = resolve; });
  await page.route('**/api/v1/talent-recruitment/hiring-reviews', route => route.fulfill(envelope([first, second])));
  await page.route(`**/api/v1/talent-recruitment/applications/${app.id}`, route => route.fulfill(envelope(first)));
  await page.route(`**/api/v1/talent-recruitment/applications/${second.id}`, async route => { requested(); await held; return route.fulfill(envelope(second)); });
  await page.goto('/talent-hiring');
  const detail = page.locator('.hiring-review__detail');
  await expect(detail).toContainText(first.candidateName);
  await page.getByRole('button', { name: /第二位确认候选人/ }).click(); await started;
  await page.getByRole('button', { name: /第一位确认候选人/ }).click();
  await expect(detail).toContainText(first.candidateName);
  const response = page.waitForResponse(res => res.url().endsWith(`/${second.id}`)); release(); await response;
  await expect(detail).not.toContainText(second.candidateName);
  await expect(detail.getByRole('button', { name: '确认录用', exact: true })).toBeVisible();
});

for (const state of ['active', 'cancelled', 'archived']) {
  test(`accepted application distinguishes ${state} onboarding request`, async ({ page }) => {
    await install(page);
    const request = { id: 'existing-intake', onboardingStatus: 'draft', recordStatus: state === 'archived' ? 'archived' : 'draft', cancelledAt: state === 'cancelled' ? '2026-11-18T00:00:00Z' : null };
    await page.route('**/api/v1/talent-recruitment/candidates/*/applications', route => route.fulfill(envelope([{ ...app, stage: 'accepted', allowedActions: ['withdraw'], onboardingRequest: request }])));
    await page.goto('/talents'); await page.getByText(candidate.name, { exact: true }).first().click();
    const panel = page.locator('.application-panel');
    if (state === 'active') {
      await expect(panel.getByRole('button', { name: '办理入职', exact: true })).toHaveCount(0);
      await panel.getByRole('button', { name: '查看入职申请', exact: true }).click();
    } else {
      await expect(panel.getByRole('button', { name: '办理入职', exact: true })).toBeVisible();
      await panel.getByRole('button', { name: '查看历史入职', exact: true }).click();
    }
    await expect(page).toHaveURL(/\/entry-exit\?applicationId=existing-intake$/);
  });
}

test('feedback submission and return history are expandable and keep their author notes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await install(page, true);
  const own = { interviewId: interview.id, userId: 'interviewer', userName: '虚构面试官', status: 'submitted', outcome: 'pass', summary: '最新提交意见', revision: 3, history: [
    { actorName: '虚构面试官', action: 'submit_feedback', outcome: 'pending', summary: '首次提交的历史意见', note: null, createdAt: '2026-11-18T00:00:00Z', revision: 1 },
    { actorName: '虚构经办', action: 'return_feedback', outcome: 'pending', summary: '首次提交的历史意见', note: '请补充岗位能力证据', createdAt: '2026-11-18T01:00:00Z', revision: 2 },
  ] };
  await page.route('**/api/v1/talent-recruitment/interviews/*/feedback', route => route.fulfill(envelope({ own, items: [own], canEdit: false, canReturn: false })));
  await page.goto(`/talent-interviews/${interview.id}`);
  const panel = page.locator('.interview-feedback');
  await expect(panel.getByText('最新提交意见', { exact: true })).toBeVisible();
  await expect(panel.getByText('退回原因：请补充岗位能力证据')).not.toBeVisible();
  await panel.getByRole('button', { name: /历史反馈（2）/ }).click();
  await expect(panel.getByText('退回原因：请补充岗位能力证据')).toBeVisible();
  await expect(panel).toContainText('虚构经办 · 退回修改');
  expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
});

for (const width of [1440, 390]) {
  test(`frozen resume form queue, busy inputs and inline education at ${width}px (mock)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await install(page);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const savedFile = { id: 'saved-file', candidateId: candidate.id, fileName: 'saved.pdf', fileSize: 1, mimeType: 'application/pdf', objectKey: 'talent-resume/saved.pdf' };
    let patches = 0, uploads = 0, binds = 0, releaseUpload!: () => void;
    const held = new Promise<void>(resolve => { releaseUpload = resolve; });
    await page.route('**/api/v1/talent-resume/status', route => route.fulfill(envelope({ enabled: true, configured: true })));
    await page.route('**/api/v1/talent-resume/parse', route => route.fulfill(envelope({ fields: { expectSalaryMin: 12 }, reviewItems: [] })));
    await page.route('**/api/v1/personnel-reference-data/education?**', route => route.fulfill(envelope([
      { id: 'old-education', name: '原学历', isActive: false }, { id: 'active-education', name: '测试学历', isActive: true },
    ])));
    await page.route(`**/api/v1/talents/${candidate.id}`, async route => {
      if (route.request().method() === 'PATCH' && ++patches === 1) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 1001, message: '请选择有效的学历基础资料', data: { fieldErrors: { educationReferenceDataId: '请选择有效的学历基础资料' } } }) });
      return route.fulfill(envelope({ ...candidate, ownerId: 'hr-one', createdById: 'hr-one', education: '原学历', educationReferenceDataId: 'old-education', files: [savedFile], editVersion: patches ? 'v2' : 'v1' }));
    });
    await page.route('**/api/v1/storage/upload?**', async route => {
      if (++uploads === 1) {
        await held;
        return route.fulfill(envelope({ url: '/api/v1/storage/download?key=talent-resume/queue-one.pdf', size: 1, mimeType: 'application/pdf' }));
      }
      return route.fulfill({ status: 503, ...envelope(null) });
    });
    await page.route(`**/api/v1/talents/${candidate.id}/files`, route => {
      binds++;
      return route.fulfill(envelope({ ...savedFile, id: 'newly-bound', fileName: 'queue-one.pdf' }));
    });
    await page.goto('/talents');
    if (width < 768) await page.getByRole('button', { name: '打开详情', exact: true }).click();
    else await page.getByText(candidate.name, { exact: true }).first().click();
    await page.locator('.talent-detail-drawer').getByRole('button', { name: '编辑', exact: true }).click();
    const drawer = page.locator('.talent-form-drawer');
    await expect(drawer.getByRole('heading', { name: '编辑人才' })).toBeVisible();
    await expect(drawer.locator('#talent-file-input')).toHaveCount(0);
    await expect(drawer.locator('.talent-form__saved-file')).toHaveCount(1);
    await drawer.locator('#talent-form-file-input').setInputFiles([
      { name: 'queue-one.pdf', mimeType: 'application/pdf', buffer: Buffer.from('1') },
      { name: 'queue-two.pdf', mimeType: 'application/pdf', buffer: Buffer.from('2') },
    ]);
    await expect(drawer.locator('.talent-form__parse-conflicts')).toContainText('当前面议');
    await expect(drawer.getByRole('checkbox', { name: '面议', exact: true })).toBeChecked();
    expect(uploads).toBe(0);
    await drawer.getByRole('button', { name: '保存修改', exact: true }).click();
    const education = drawer.locator('.el-form-item').filter({ has: page.locator('.el-form-item__label', { hasText: /^学历$/ }) });
    await expect(education.locator('.el-form-item__error')).toHaveText('请选择有效的学历基础资料');
    await education.getByRole('combobox').click();
    await page.getByRole('option', { name: '测试学历', exact: true }).click();
    await expect(education.locator('.el-form-item__error')).toHaveCount(0);
    await drawer.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect.poll(() => uploads).toBe(1);
    await expect(drawer.locator('#talent-form-file-input')).toBeDisabled();
    await expect(drawer.locator('#talent-form-camera-input')).toBeDisabled();
    releaseUpload();
    await expect(drawer.locator('.talent-form__saved-file')).toHaveCount(2);
    await expect(drawer.locator('.talent-form__pending')).toHaveCount(1);
    await expect(drawer).toContainText('未完成的文件已保留');
    await drawer.locator('#talent-form-file-input').setInputFiles({ name: 'fourth.pdf', mimeType: 'application/pdf', buffer: Buffer.from('4') });
    await expect(page.getByText('简历文件最多 3 个', { exact: true })).toBeVisible();
    await expect(drawer.locator('.talent-form__pending')).toHaveCount(1);
    expect(binds).toBe(1); expect(uploads).toBe(2); expect(errors).toEqual([]);
    await drawer.locator('.el-drawer__body').evaluate(node => { node.scrollTop = 0; });
    const size = await drawer.evaluate(node => ({ width: node.clientWidth, scroll: node.scrollWidth }));
    expect(size.scroll).toBeLessThanOrEqual(size.width + 1);
    await page.screenshot({ path: test.info().outputPath(`talent-resume-form-frozen-${width}.png`), fullPage: true });
  });
}
