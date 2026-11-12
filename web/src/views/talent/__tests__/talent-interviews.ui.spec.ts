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
    if (url.pathname.endsWith('/users')) return route.fulfill(envelope({ items: [{ id: url.searchParams.get('status') === 'probation' ? 'probation-user' : 'synthetic-user', name: url.searchParams.get('status') === 'probation' ? '合成试用员工' : '合成参与人', employeeNo: 'SYN001' }], total: 1 }));
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

test('HR detail exposes invitation list and source-only onboarding handoff', async ({ page }) => {
  await install(page, 'hr'); await page.goto('/talents');
  await page.getByText(candidate.name, { exact: true }).first().click();
  await expect(page.getByRole('button', { name: '新增面试' })).toBeVisible();
  await expect(page.getByText('日程未配置', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '办理入职', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/entry-exit\\?talentId=${candidate.id}$`));
  expect(page.url()).not.toContain(candidate.phone);
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
  await page.route(`**/talent-interviews/${invitation.id}`, (route) => route.fulfill(envelope({ ...invitation, candidateId: candidate.id,
    participants: [{ userId: 'synthetic-user', userNameSnapshot: '合成参与人' }], syncStatus: 'unconfigured' })));
  await page.route(`**/talent-interviews/${invitation.id}/cancel`, (route) => {
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
    await expect(page.getByText('面试时间（北京时间）', { exact: true })).toBeVisible();
    await expect(page.locator('.interview-content dd').first()).toContainText('2026-12-01 10:00:00');
  });
});
