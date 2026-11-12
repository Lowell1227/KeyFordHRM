import { test, expect, type Page } from '@playwright/test';

const candidate = { id: '11111111-1111-4111-8111-111111111111', name: '合成候选人', phone: '17000000000', status: 'new', sourceChannel: 'referral', gender: 'unknown', tags: [], files: [], followUps: [], shares: [], updatedAt: '2026-11-12T00:00:00Z' };
const invitation = { id: '22222222-2222-4222-8222-222222222222', candidateNameSnapshot: candidate.name, startsAt: '2026-12-01T02:00:00Z', endsAt: '2026-12-01T03:00:00Z', invitationText: '<script>plain text only</script>\n' + '长邀请内容'.repeat(80), meetingUrl: 'https://meeting.tencent.com/dm/demo', status: 'scheduled', version: 1, sourceDeleted: true, participantNames: ['合成参与人'] };
const envelope = (data: unknown) => ({ contentType: 'application/json', body: JSON.stringify({ code: 0, message: 'success', data }) });

async function install(page: Page, role: 'hr' | 'hr_user' | 'employee', writes: Array<Record<string, unknown>> = []) {
  await page.addInitScript(() => { localStorage.setItem('token', 'synthetic-ui-only'); localStorage.setItem('expiresAt', String(Date.now() + 600000)); });
  const calls: string[] = [];
  // No request reaches a database or transport; this suite proves UI behavior only.
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url()); calls.push(url.pathname);
    if (url.pathname.endsWith('/auth/me')) return route.fulfill(envelope({ id: 'synthetic-user', name: '合成用户', sysRole: role, hrCapabilities: role === 'hr_user' ? ['employee_archive_review'] : [], businessCapabilities: {} }));
    if (url.pathname.endsWith('/notifications/unread-count')) return route.fulfill(envelope({ count: 0 }));
    if (url.pathname.endsWith('/talents')) return route.fulfill(envelope({ items: [candidate], total: 1, page: 1, pageSize: 20 }));
    if (url.pathname.endsWith(`/talents/${candidate.id}`)) return route.fulfill(envelope(candidate));
    if (url.pathname.endsWith('/follow-ups')) return route.fulfill(envelope([]));
    if (url.pathname.endsWith('/users')) return route.fulfill(envelope({ items: [{ id: url.searchParams.get('status') === 'probation' ? 'probation-user' : 'synthetic-user', name: url.searchParams.get('status') === 'probation' ? '合成试用员工' : '合成参与人', employeeNo: 'SYN001', status: url.searchParams.get('status'), archivedAt: null }], total: 1 }));
    if (url.pathname.includes('/users/')) return route.fulfill(envelope({ id: url.pathname.split('/').pop(), name: url.pathname.endsWith('/probation-user') ? '合成试用员工' : '合成参与人', employeeNo: 'SYN001', status: url.pathname.endsWith('/probation-user') ? 'probation' : 'active', archivedAt: null }));
    if (url.pathname.endsWith('/talent-interviews')) {
      if (route.request().method() === 'POST') { writes.push(route.request().postDataJSON()); return route.fulfill(envelope({ ...invitation, ...route.request().postDataJSON() })); }
      return route.fulfill(envelope([{ ...invitation, sourceDeleted: false, candidateId: candidate.id, note: '内部备注', participants: [{ userId: 'synthetic-user', userNameSnapshot: '合成参与人' }], syncStatus: 'unconfigured', calendarSyncedVersion: 0 }]));
    }
    if (url.pathname.includes('/talent-interviews/')) return route.fulfill(envelope(invitation));
    return route.fulfill(envelope(null));
  });
  return calls;
}

test('review-only talent detail has no write actions', async ({ page }) => {
  await install(page, 'hr_user');
  await page.goto('/talents');
  await expect(page.getByRole('button', { name: '新增人才', exact: true })).toHaveCount(0);
  await page.getByText(candidate.name, { exact: true }).first().click();
  for (const name of ['编辑', '删除', '办理入职', '转发', '记一条', '新增面试']) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
  await expect(page.getByText('面试邀约', { exact: true })).toBeVisible();
});

type DirectoryPerson = { id: string; name: string; employeeNo: string; status: string; archivedAt: string | null };
const person = (id: string, name: string, status = 'active', archivedAt: string | null = null): DirectoryPerson => ({ id, name, employeeNo: id.toUpperCase(), status, archivedAt });

async function installParticipantEditor(page: Page, directory: Map<string, DirectoryPerson>, selected: string[], writes: Array<Record<string, unknown>>) {
  await install(page, 'hr');
  const snapshots = selected.map(id => ({ userId: id, userNameSnapshot: directory.get(id)!.name }));
  let row = { ...invitation, candidateId: candidate.id, participants: snapshots, participantNames: snapshots.map(p => p.userNameSnapshot), syncStatus: 'unconfigured' };
  await page.route(`**/api/v1/talent-interviews/${invitation.id}`, async route => {
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON(); writes.push(body);
      row = { ...row, ...body, version: row.version + 1 };
    }
    return route.fulfill(envelope(row));
  });
  await page.route('**/api/v1/users**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/v1/users') {
      const keyword = url.searchParams.get('keyword') ?? '';
      const items = [...directory.values()].filter(p => p.status === url.searchParams.get('status') && !p.archivedAt && (p.name.includes(keyword) || p.employeeNo.includes(keyword)));
      return route.fulfill(envelope({ items, total: items.length }));
    }
    const value = directory.get(url.pathname.split('/').pop()!);
    return route.fulfill(value ? envelope(value) : { status: 404, ...envelope(null) });
  });
  await page.goto(`/talent-interviews/${invitation.id}`);
}

for (const width of [1440, 390]) {
  test(`F1 historical unavailable participants are explicit but never selectable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const directory = new Map([
      ['valid', person('valid', '正常参与人')], ['resigned', person('resigned', '离职历史姓名', 'resigned')],
      ['archived', person('archived', '归档历史姓名', 'active', '2026-11-12T00:00:00Z')],
    ]);
    const writes: Array<Record<string, unknown>> = [];
    await installParticipantEditor(page, directory, ['valid', 'resigned', 'archived'], writes);
    await expect(page.locator('.interview-content')).toContainText('正常参与人、离职历史姓名、归档历史姓名');
    await page.getByRole('button', { name: '修改邀约', exact: true }).click();
    const form = page.locator('.interview-panel__editor');
    await form.locator('.el-select').getByRole('combobox').press('ArrowDown');
    await expect(page.getByRole('option', { name: /正常参与人/ })).toBeVisible();
    await expect(page.getByRole('option', { name: /离职历史姓名/ })).toHaveCount(0);
    await expect(page.getByRole('option', { name: /归档历史姓名/ })).toHaveCount(0);
    const issues = form.getByRole('region', { name: '待处理参与人' });
    await expect(issues).toContainText('已离职');
    await expect(issues).toContainText('已归档');
    await expect(form.getByRole('button', { name: '保存邀约', exact: true })).toBeDisabled();
    expect(writes).toHaveLength(0);
    await issues.getByRole('button', { name: '移除参与人 离职历史姓名', exact: true }).click();
    await expect(form.getByRole('button', { name: '保存邀约', exact: true })).toBeDisabled();
    await issues.getByRole('button', { name: '移除参与人 归档历史姓名', exact: true }).click();
    await form.getByRole('button', { name: '保存邀约', exact: true }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]?.participantIds).toEqual(['valid']);
  });
}

for (const change of ['resigned', 'archived']) {
  for (const recheck of ['search', 'save']) {
    test(`F1 selected person becoming ${change} is blocked on ${recheck}`, async ({ page }) => {
      const directory = new Map([['valid', person('valid', '原参与人')], ['later', person('later', '新增参与人', 'probation')]]);
      const writes: Array<Record<string, unknown>> = [];
      await installParticipantEditor(page, directory, ['valid'], writes);
      await page.getByRole('button', { name: '修改邀约', exact: true }).click();
      const form = page.locator('.interview-panel__editor'), select = form.locator('.el-select').getByRole('combobox');
      await select.press('ArrowDown');
      await page.getByRole('option', { name: /新增参与人/ }).click();
      await form.getByLabel('安排备注').click();
      directory.set('later', person('later', '新增参与人', change === 'resigned' ? 'resigned' : 'probation', change === 'archived' ? '2026-11-12T00:00:00Z' : null));
      if (recheck === 'search') {
        await select.fill('原参与人');
        await expect(page.getByRole('option', { name: /新增参与人/ })).toHaveCount(0);
      } else await form.getByRole('button', { name: '保存邀约', exact: true }).click();
      const issues = form.getByRole('region', { name: '待处理参与人' });
      await expect(issues).toContainText(change === 'resigned' ? '已离职' : '已归档');
      await expect(issues.getByRole('button', { name: '移除参与人 新增参与人', exact: true })).toBeVisible();
      await expect(form.getByRole('button', { name: '保存邀约', exact: true })).toBeDisabled();
      expect(writes).toHaveLength(0);
    });
  }
}

test('F1 valid selected participants survive unrelated searches without being silently dropped', async ({ page }) => {
  const directory = new Map([['valid', person('valid', '原参与人')], ['other', person('other', '另一个人员', 'probation')]]);
  const writes: Array<Record<string, unknown>> = [];
  await installParticipantEditor(page, directory, ['valid'], writes);
  await page.getByRole('button', { name: '修改邀约', exact: true }).click();
  const form = page.locator('.interview-panel__editor'), select = form.locator('.el-select').getByRole('combobox');
  await select.fill('另一个');
  await expect(page.getByRole('option', { name: /原参与人/ })).toBeVisible();
  await page.getByRole('option', { name: /另一个人员/ }).click();
  await select.fill('没有匹配项');
  await expect(form.locator('.el-select')).toContainText('原参与人');
  await expect(form.locator('.el-select')).toContainText('另一个人员');
  await form.getByLabel('安排备注').click();
  await form.getByRole('button', { name: '保存邀约', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]?.participantIds).toEqual(['valid', 'other']);
});

test('F1 failed status lookup keeps the historical name and blocks saving until explicitly removed', async ({ page }) => {
  const directory = new Map([['missing', person('missing', '不可核验历史姓名')], ['valid', person('valid', '正常参与人')]]);
  const writes: Array<Record<string, unknown>> = [];
  await installParticipantEditor(page, directory, ['missing', 'valid'], writes);
  directory.delete('missing');
  await page.getByRole('button', { name: '修改邀约', exact: true }).click();
  const form = page.locator('.interview-panel__editor');
  await expect(form.getByRole('region', { name: '待处理参与人' })).toContainText('不可核验历史姓名');
  await expect(form.getByRole('button', { name: '保存邀约', exact: true })).toBeDisabled();
  expect(writes).toHaveLength(0);
});

test('F1 late status response cannot overwrite a reopened editor', async ({ page }) => {
  const directory = new Map([['valid', person('valid', '历史姓名')]]);
  const writes: Array<Record<string, unknown>> = [];
  await installParticipantEditor(page, directory, ['valid'], writes);
  let release!: () => void, requested!: () => void, first = true;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { requested = resolve; });
  await page.route('**/api/v1/users/valid', async route => {
    if (!first) return route.fallback();
    first = false; requested(); await held;
    return route.fulfill(envelope(person('valid', '过期离职响应', 'resigned')));
  });
  await page.getByRole('button', { name: '修改邀约', exact: true }).click();
  await started;
  await page.getByRole('button', { name: '取消编辑', exact: true }).click();
  directory.set('valid', person('valid', '重新打开有效姓名'));
  await page.getByRole('button', { name: '修改邀约', exact: true }).click();
  const form = page.locator('.interview-panel__editor');
  await expect(form.locator('.el-select')).toContainText('重新打开有效姓名');
  const oldResponse = page.waitForResponse(res => res.url().endsWith('/api/v1/users/valid'));
  release(); await oldResponse;
  await expect(form.getByRole('region', { name: '待处理参与人' })).toHaveCount(0);
  await expect(form.locator('.el-select')).toContainText('重新打开有效姓名');
  await form.getByRole('button', { name: '保存邀约', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]?.participantIds).toEqual(['valid']);
});

test('F1 late search results cannot populate a reopened editor', async ({ page }) => {
  const directory = new Map([['valid', person('valid', '原参与人')]]);
  const writes: Array<Record<string, unknown>> = [];
  await installParticipantEditor(page, directory, ['valid'], writes);
  let release!: () => void, requested!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { requested = resolve; });
  await page.route('**/api/v1/users?**', async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('keyword') !== '旧查询' || url.searchParams.get('status') !== 'active') return route.fallback();
    requested(); await held;
    return route.fulfill(envelope({ items: [person('old', '过期搜索人员')], total: 1 }));
  });
  await page.getByRole('button', { name: '修改邀约', exact: true }).click();
  const form = page.locator('.interview-panel__editor');
  await form.locator('.el-select').getByRole('combobox').fill('旧查询');
  await started;
  await form.getByRole('button', { name: '取消编辑', exact: true }).click();
  await page.getByRole('button', { name: '修改邀约', exact: true }).click();
  await expect(form.locator('.el-select')).toContainText('原参与人');
  const oldResponse = page.waitForResponse(res => res.url().includes('keyword=') && res.url().includes('status=active'));
  release(); await oldResponse;
  await form.locator('.el-select').getByRole('combobox').press('ArrowDown');
  await expect(page.getByRole('option', { name: /原参与人/ })).toBeVisible();
  await expect(page.getByRole('option', { name: /过期搜索人员/ })).toHaveCount(0);
});

test('HR detail exposes invitation list and source-only onboarding handoff', async ({ page }) => {
  await install(page, 'hr'); await page.goto('/talents');
  await page.getByText(candidate.name, { exact: true }).first().click();
  await expect(page.getByRole('button', { name: '新增面试' })).toBeVisible();
  await expect(page.getByText('日程未配置', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '办理入职', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/entry-exit\\?talentId=${candidate.id}$`));
  expect(page.url()).not.toContain(candidate.phone);
});

for (const width of [1440, 390]) {
test(`pasted invitation extracts one official meeting link into an editable field at ${width}px`, async ({ page }) => {
  const writes: Array<Record<string, unknown>> = [];
  await page.setViewportSize({ width, height: 900 });
  await install(page, 'hr', writes);
  await page.goto('/talents');
  if (width === 390) await page.getByRole('button', { name: '打开详情', exact: true }).click();
  else await page.getByText(candidate.name, { exact: true }).first().click();
  await page.getByRole('button', { name: '新增面试', exact: true }).click();
  const form = page.locator('.interview-panel__editor');
  await form.locator('input').nth(0).fill('2026-12-01 10:00:00'); await form.locator('input').nth(0).press('Tab');
  await form.locator('input').nth(1).fill('2026-12-01 11:00:00'); await form.locator('input').nth(1).press('Tab');
  await form.locator('.el-select').getByRole('combobox').click();
  await page.getByRole('option', { name: '合成参与人 · SYN001', exact: true }).click();
  const text = '合成面试邀请\n点击链接入会：（https://meeting.tencent.com/dm/synthetic-f5）。\n会议号：123-456-789';
  await form.getByLabel('会议邀请内容').fill(text);
  await expect(form.getByLabel('腾讯会议链接')).toHaveValue('https://meeting.tencent.com/dm/synthetic-f5');
  await expect(form.getByLabel('腾讯会议链接')).toBeEditable();
  await expect(form.getByLabel('会议邀请内容')).toHaveValue(text);
  await expect(form.getByRole('status')).toContainText('请核对');
  expect(await form.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await form.screenshot({ path: `e2e-artifacts/talent-task5/extracted-${width}.png`, animations: 'disabled' });
  await page.getByRole('button', { name: '保存邀约', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({ meetingUrl: 'https://meeting.tencent.com/dm/synthetic-f5', invitationText: text,
    startsAt: '2026-12-01T02:00:00.000Z', endsAt: '2026-12-01T03:00:00.000Z' });
});
}

test('ambiguous or malformed invitations prompt inline without choosing a link', async ({ page }) => {
  await install(page, 'hr'); await page.goto('/talents');
  await page.getByText(candidate.name, { exact: true }).first().click();
  await page.getByRole('button', { name: '新增面试', exact: true }).click();
  const form = page.locator('.interview-panel__editor');
  const input = form.getByLabel('会议邀请内容'), link = form.getByLabel('腾讯会议链接');
  for (const text of ['会议号：123-456-789', 'https://meeting.tencent.com.evil.test/dm/f5',
    'https://user@meeting.tencent.com/dm/f5', 'http://meeting.tencent.com/dm/f5', 'https://meeting.tencent.com\\@evil.test/dm/f5']) {
    await input.fill(text);
    await expect(link).toHaveValue('');
    await expect(form.getByRole('status')).toContainText('未识别');
    await expect(form.getByRole('status')).toContainText('手动');
  }
  await input.fill('https://meeting.tencent.com/dm/one\nhttps://meeting.tencent.com/dm/two');
  await expect(link).toHaveValue('');
  await expect(form.getByRole('status')).toContainText('多个');
  await link.fill('https://meeting.tencent.com/dm/manual-choice');
  await input.fill('会议邀请补充说明');
  await expect(link).toHaveValue('https://meeting.tencent.com/dm/manual-choice');
});

test('invitation edits update only automatic links and never overwrite a manual value or manual clearing', async ({ page }) => {
  await install(page, 'hr'); await page.goto('/talents');
  await page.getByText(candidate.name, { exact: true }).first().click();
  await page.getByRole('button', { name: '新增面试', exact: true }).click();
  const form = page.locator('.interview-panel__editor');
  const input = form.getByLabel('会议邀请内容'), link = form.getByLabel('腾讯会议链接');
  await input.fill('https://meeting.tencent.com/dm/one');
  await expect(link).toHaveValue('https://meeting.tencent.com/dm/one');
  await input.fill('https://meeting.tencent.com/dm/two');
  await expect(link).toHaveValue('https://meeting.tencent.com/dm/two');
  await input.fill('https://meeting.tencent.com/dm/one https://meeting.tencent.com/dm/two');
  await expect(link).toHaveValue('');
  await input.fill('https://meeting.tencent.com/dm/three');
  await expect(link).toHaveValue('https://meeting.tencent.com/dm/three');
  await input.fill('只有会议号');
  await expect(link).toHaveValue('');
  await link.fill('https://meeting.tencent.com/dm/manual');
  await input.fill('https://meeting.tencent.com/dm/four');
  await expect(link).toHaveValue('https://meeting.tencent.com/dm/manual');
  await expect(form.getByRole('status')).toContainText('保留');
  await link.fill('');
  await input.fill('https://meeting.tencent.com/dm/five');
  await expect(link).toHaveValue('');
  await page.getByRole('button', { name: '取消编辑', exact: true }).click();
  await page.getByRole('button', { name: '新增面试', exact: true }).click();
  await input.fill('https://meeting.tencent.com/dm/new-editor');
  await expect(link).toHaveValue('https://meeting.tencent.com/dm/new-editor');
});

test('editing a saved invitation preserves its separate meeting link', async ({ page }) => {
  await install(page, 'hr'); await page.goto('/talents');
  await page.getByText(candidate.name, { exact: true }).first().click();
  await page.locator('.interview-panel__summary').click();
  await page.getByRole('button', { name: '修改邀约', exact: true }).click();
  const form = page.locator('.interview-panel__editor');
  await form.getByLabel('会议邀请内容').fill('https://meeting.tencent.com/dm/replacement');
  await expect(form.getByLabel('腾讯会议链接')).toHaveValue(invitation.meetingUrl);
  await expect(form.getByRole('status')).toContainText('保留');
});

for (const width of [1440, 1024, 390]) {
  test(`assigned invitation renders plain text without talent requests at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const calls = await install(page, 'employee');
    await page.goto(`/talent-interviews/${invitation.id}`);
    await expect(page.getByText('来源候选人已删除', { exact: true })).toBeVisible();
    await expect(page.locator('.interview-invitation-text')).toContainText('<script>plain text only</script>');
    await expect(page.getByRole('link', { name: '打开腾讯会议' })).toHaveAttribute('rel', 'noopener noreferrer');
    expect(calls.some((path) => /\/talents(\/|$)/.test(path))).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('.interview-content .el-tag')).toContainText('待面试');
    await page.screenshot({ path: `e2e-artifacts/talent-task5/invitation-${width}.png`, fullPage: true, animations: 'disabled' });
  });
}

test('mobile editor validates fields and submits multiple participants without rendering invitation HTML', async ({ page }) => {
  const writes: Array<Record<string, unknown>> = [];
  await page.setViewportSize({ width: 390, height: 844 }); await install(page, 'hr', writes);
  await page.goto('/talents'); await page.getByRole('button', { name: '打开详情', exact: true }).click();
  await page.getByRole('button', { name: '新增面试', exact: true }).click();
  await page.getByRole('button', { name: '保存邀约', exact: true }).click();
  await expect(page.getByText('请选择开始时间', { exact: true })).toBeVisible();
  await expect(page.getByText('请选择内部参与人', { exact: true })).toBeVisible();
  const form = page.locator('.interview-panel__editor');
  await form.locator('input').nth(0).fill('2026-12-01 10:00:00'); await form.locator('input').nth(0).press('Tab');
  await form.locator('input').nth(1).fill('2026-12-01 11:00:00'); await form.locator('input').nth(1).press('Tab');
  await form.getByRole('combobox', { name: '*内部参与人', exact: true }).click();
  await page.getByRole('option', { name: '合成参与人 · SYN001', exact: true }).click();
  await page.getByRole('option', { name: '合成试用员工 · SYN001', exact: true }).click();
  await form.locator('textarea').first().fill('<b>合成会议邀请</b>');
  await form.getByPlaceholder('https://meeting.tencent.com/...').fill('javascript:alert(1)');
  await page.getByRole('button', { name: '保存邀约', exact: true }).click();
  await expect(page.getByText('仅支持腾讯会议官方 HTTPS 链接', { exact: true })).toBeVisible();
  expect(writes).toHaveLength(0);
  await form.getByPlaceholder('https://meeting.tencent.com/...').fill('https://meeting.tencent.com/dm/demo');
  await form.locator('textarea').last().click();
  await expect(page.getByText('仅支持腾讯会议官方 HTTPS 链接', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'e2e-artifacts/talent-task5/editor-390.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: '保存邀约', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({ candidateId: candidate.id, participantIds: ['synthetic-user', 'probation-user'], invitationText: '<b>合成会议邀请</b>' });
});

test('delete confirmation displays live impact and requires reconfirmation after a conflict', async ({ page }) => {
  await install(page, 'hr');
  const impact = { candidateId: candidate.id, version: 'v1', requiresForce: true, interviews: [{ id: invitation.id, status: 'scheduled', version: 1, startsAt: invitation.startsAt }], requests: [{ id: 'application-1', onboardingStatus: 'pending_entry', recordStatus: 'submitted', requestVersion: 1, updatedAt: invitation.startsAt }] };
  await page.route('**/delete-impact', (route) => route.fulfill(envelope(impact)));
  const deletes: Array<Record<string, unknown>> = [];
  await page.route(`**/talents/${candidate.id}`, async (route) => {
    if (route.request().method() !== 'DELETE') return route.fulfill(envelope(candidate));
    deletes.push(route.request().postDataJSON());
    if (deletes.length === 1) return route.fulfill({ status: 409, ...envelope({ impact: { ...impact, version: 'v2', interviews: [] } }) });
    return route.fulfill(envelope({ id: candidate.id, deleted: true }));
  });
  await page.goto('/talents'); await page.getByText(candidate.name, { exact: true }).first().click();
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await expect(page.getByText('未结束面试 1 条，未结束入职申请 1 条。')).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click(); expect(deletes).toHaveLength(0);
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await page.getByRole('button', { name: '仍然删除', exact: true }).click();
  await expect(page.getByText('关联影响已变化，请重新核对后点击仍然删除')).toBeVisible();
  expect(deletes).toHaveLength(1);
  await page.getByRole('button', { name: '仍然删除', exact: true }).click();
  await expect.poll(() => deletes.length).toBe(2);
  expect(deletes).toEqual([{ impactVersion: 'v1', force: true }, { impactVersion: 'v2', force: true }]);
});

test('HR can cancel retained invitation after candidate soft deletion from the independent URL', async ({ page }) => {
  await install(page, 'hr');
  const writes: Array<Record<string, unknown>> = [];
  await page.route(`**/api/v1/talent-interviews/${invitation.id}`, (route) => route.fulfill(envelope({ ...invitation, candidateId: candidate.id,
    participants: [{ userId: 'synthetic-user', userNameSnapshot: '合成参与人' }], syncStatus: 'unconfigured' })));
  await page.route(`**/api/v1/talent-interviews/${invitation.id}/cancel`, (route) => {
    writes.push(route.request().postDataJSON()); return route.fulfill(envelope({ ...invitation, status: 'cancelled', version: 2 }));
  });
  await page.goto(`/talent-interviews/${invitation.id}`);
  await expect(page.getByText('来源候选人已删除', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '新增面试', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '取消面试', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '取消面试', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toEqual({ version: 1 });
});

test.describe('Beijing interview time across devices', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });
  test('shows and edits Beijing time in a non-Shanghai browser', async ({ page }) => {
    const writes: Array<Record<string, unknown>> = [];
    await install(page, 'hr', writes); await page.goto('/talents');
    await page.getByText(candidate.name, { exact: true }).first().click();
    await page.getByRole('button', { name: '新增面试', exact: true }).click();
    const form = page.locator('.interview-panel__editor');
    await form.locator('input').nth(0).fill('2026-12-01 10:00:00'); await form.locator('input').nth(0).press('Tab');
    await form.locator('input').nth(1).fill('2026-12-01 11:00:00'); await form.locator('input').nth(1).press('Tab');
    await form.locator('.el-select').getByRole('combobox').click();
    await page.getByRole('option', { name: '合成参与人 · SYN001', exact: true }).click();
    await form.locator('textarea').first().fill('合成北京时间邀请');
    await page.getByRole('button', { name: '保存邀约', exact: true }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toMatchObject({ startsAt: '2026-12-01T02:00:00.000Z', endsAt: '2026-12-01T03:00:00.000Z' });
    await page.goto(`/talent-interviews/${invitation.id}`);
    const timeLabel = page.locator('.interview-content dt').filter({ hasText: '面试时间' });
    await expect(timeLabel).toBeVisible();
    await expect(timeLabel.locator('small')).toHaveText('北京时间');
    await expect(timeLabel.locator('+ dd')).toHaveText('2026-12-01 10:00:00 至 2026-12-01 11:00:00');
  });
});
