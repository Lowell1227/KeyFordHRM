import { test, expect, request as requestClient } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

test.beforeAll(() => {
  const [api, web] = JSON.parse(execFileSync('docker', ['inspect', 'hrm-api-1', 'hrm-web-1'], { encoding: 'utf8' }));
  const environment = (container: typeof api) => Object.fromEntries(container.Config.Env.map((line: string) => {
    const index = line.indexOf('=');
    return [line.slice(0, index), line.slice(index + 1)];
  }));
  const env = environment(api), webEnv = environment(web);
  expect(api.Config.Labels['com.docker.compose.project']).toBe('hrm');
  expect(web.Config.Labels['com.docker.compose.project']).toBe('hrm');
  expect(env.HRM_PREVIEW).toBe('true');
  expect(env.NODE_ENV).toBe('development');
  const database = new URL(env.DATABASE_URL);
  expect(database.hostname).toBe('postgres');
  expect(database.username).toBe('hrm_preview');
  expect(database.pathname).toBe('/hrm_preview');
  expect(env.DINGTALK_NOTIFICATION_ENABLED).toBe('false');
  expect(env.DINGTALK_INTERVIEW_CALENDAR_ENABLED).toBe('false');
  expect(Object.keys(api.NetworkSettings.Networks)).toEqual(['hrm_internal']);
  expect(webEnv.VITE_PREVIEW_MODE).toBe('true');
  expect(webEnv.VITE_API_BASE_URL).toBe('');
  expect(webEnv.VITE_DEV_PROXY_TARGET).toBe('http://api:3000');
  expect(web.NetworkSettings.Ports['5173/tcp']).toEqual([{ HostIp: '127.0.0.1', HostPort: '5173' }]);
});

test('F1 unavailable history and status changes after selection require explicit removal', async ({ page, request, baseURL }, info) => {
  expect(baseURL).toBe('http://localhost:5173');
  const nonce = randomUUID().slice(0, 8);
  const fixtures = ['A', 'B', 'C', 'D'].map(suffix => ({ id: randomUUID(), employeeNo: `F1_${nonce}${suffix}`, name: `F1 fictional ${nonce}${suffix}` }));
  const fixtureState = (action: 'create' | 'history' | 'selected' | 'cleanup') => {
    execFileSync('docker', ['exec', '-i', 'hrm-api-1', 'node'], { encoding: 'utf8', timeout: 15000, input: `
      require('./prisma/preview-guard.cjs').assertPreviewEnvironment(process.env);
      const { PrismaClient } = require('@prisma/client');
      const prisma = new PrismaClient();
      const fixtures = ${JSON.stringify(fixtures)};
      const action = ${JSON.stringify(action)};
      (async () => {
        if (!await prisma.systemConfig.findUnique({ where: { key: 'local_preview_fixture_v1' } })) throw new Error('Preview not initialized');
        if (action === 'create') {
          const dept = await prisma.department.findFirstOrThrow({ where: { name: '预览业务部' } });
          for (const [index, fixture] of fixtures.entries()) await prisma.user.create({ data: {
            ...fixture, status: index === 1 ? 'probation' : 'active', sysRole: 'employee', deptId: dept.id,
          } });
          return;
        }
        for (const [index, fixture] of fixtures.entries()) {
          if (action === 'history' && index > 1 || action === 'selected' && index !== 2) continue;
          const archived = action === 'cleanup' || index === 1 || (action === 'selected' && ${JSON.stringify(info.project.name === 'mobile')});
          const result = await prisma.user.updateMany({ where: { id: fixture.id, employeeNo: fixture.employeeNo, name: fixture.name },
            data: { status: 'resigned', archivedAt: archived ? new Date() : null } });
          if (action !== 'cleanup' && result.count !== 1) throw new Error('Fictional fixture changed');
        }
      })().finally(() => prisma.$disconnect()).catch(() => process.exitCode = 1);
    ` });
  };
  await page.goto('/login');
  await page.getByTestId('preview-login').click();
  await expect(page).toHaveURL(/\/dashboard$/);
  const headers = { authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('token'))}` };
  const me = await request.get('/api/v1/auth/me', { headers });
  expect(me.ok()).toBeTruthy();
  const hr = (await me.json()).data;
  expect(hr.employeeNo).toBe('HR001');
  let candidateId: string | undefined, interviewId: string | undefined;
  try {
    fixtureState('create');
    const created = await request.post('/api/v1/talents', { headers, data: {
      name: `F1 fictional candidate ${nonce}`, phone: `100${Date.now().toString().slice(-8)}`, sourceChannel: 'other',
    } });
    expect(created.ok()).toBeTruthy(); candidateId = (await created.json()).data.id;
    const createdInterview = await request.post('/api/v1/talent-interviews', { headers, data: {
      requestId: randomUUID(), candidateId, participantIds: [hr.id, fixtures[0]!.id, fixtures[1]!.id],
      startsAt: '2026-12-01T02:00:00Z', endsAt: '2026-12-01T03:00:00Z', invitationText: 'F1 fictional invitation',
    } });
    expect(createdInterview.ok()).toBeTruthy();
    const original = (await createdInterview.json()).data; interviewId = original.id;
    fixtureState('history');
    const strict = await request.patch(`/api/v1/talent-interviews/${interviewId}`, { headers, data: {
      version: original.version, participantIds: [hr.id, fixtures[0]!.id, fixtures[1]!.id],
    } });
    expect(strict.status()).toBe(400);
    const writes: string[] = [];
    page.on('request', req => { if (req.method() === 'PATCH' && req.url().endsWith(`/talent-interviews/${interviewId}`)) writes.push(req.url()); });
    await page.goto(`/talent-interviews/${interviewId}`);
    await expect(page.locator('.interview-content')).toContainText(fixtures[0]!.name);
    await expect(page.locator('.interview-content')).toContainText(fixtures[1]!.name);
    await page.getByRole('button', { name: '修改邀约', exact: true }).click();
    const form = page.locator('.interview-panel__editor'), issues = form.getByRole('region', { name: '待处理参与人' });
    await expect(issues).toContainText('已离职'); await expect(issues).toContainText('已归档');
    await expect(form.getByRole('button', { name: '保存邀约', exact: true })).toBeDisabled();
    await form.locator('.el-select').getByRole('combobox').press('ArrowDown');
    await expect(page.getByRole('option', { name: new RegExp(hr.employeeNo) })).toBeVisible();
    for (const fixture of fixtures.slice(0, 2)) await expect(page.getByRole('option', { name: new RegExp(fixture.employeeNo) })).toHaveCount(0);
    expect(await form.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await form.screenshot({ path: info.outputPath('unavailable-history.png'), animations: 'disabled' });
    const unchanged = await request.get(`/api/v1/talent-interviews/${interviewId}`, { headers });
    expect((await unchanged.json()).data.participants.map((p: { userId: string }) => p.userId).sort())
      .toEqual([hr.id, fixtures[0]!.id, fixtures[1]!.id].sort());
    await form.getByLabel('安排备注').click();
    for (const fixture of fixtures.slice(0, 2)) {
      const remove = issues.getByRole('button', { name: `移除参与人 ${fixture.name}`, exact: true });
      await remove.click();
      await expect(remove).toHaveCount(0);
    }
    await expect(issues).toHaveCount(0);
    const select = form.locator('.el-select').getByRole('combobox');
    await select.fill(fixtures[2]!.employeeNo);
    await page.getByRole('option', { name: new RegExp(fixtures[2]!.employeeNo) }).click();
    await form.getByLabel('安排备注').click();
    await expect(issues).toHaveCount(0);
    fixtureState('selected');
    await form.getByRole('button', { name: '保存邀约', exact: true }).click();
    await expect(issues).toContainText(info.project.name === 'mobile' ? '已归档' : '已离职');
    expect(writes).toHaveLength(0);
    await form.screenshot({ path: info.outputPath('changed-after-selection.png'), animations: 'disabled' });
    await issues.getByRole('button', { name: `移除参与人 ${fixtures[2]!.name}`, exact: true }).click();
    await expect(issues).toHaveCount(0);
    await select.fill(fixtures[3]!.employeeNo);
    await page.getByRole('option', { name: new RegExp(fixtures[3]!.employeeNo) }).click();
    await form.getByLabel('安排备注').click();
    const saved = page.waitForResponse(res => res.url().endsWith(`/talent-interviews/${interviewId}`) && res.request().method() === 'PATCH');
    await form.getByRole('button', { name: '保存邀约', exact: true }).click();
    expect((await saved).ok()).toBeTruthy();
    const persisted = await request.get(`/api/v1/talent-interviews/${interviewId}`, { headers });
    expect((await persisted.json()).data.participants.map((p: { userId: string }) => p.userId).sort()).toEqual([hr.id, fixtures[3]!.id].sort());
    expect(writes).toHaveLength(1);
    const proof = info.outputPath('participant-boundary.json');
    writeFileSync(proof, JSON.stringify({ candidateId, interviewId, fixtureIds: fixtures.map(f => f.id),
      replacementParticipantId: fixtures[3]!.id, backendRejectedStatus: strict.status(), explicitSaveCount: writes.length }, null, 2));
    await info.attach('fictional-participant-boundary', { path: proof, contentType: 'application/json' });
    await page.reload();
    await expect(page.locator('.interview-content')).toContainText(fixtures[3]!.name);
    await page.screenshot({ path: info.outputPath('explicit-replacement-saved.png'), fullPage: true, animations: 'disabled' });
  } finally {
    const cleanup = await requestClient.newContext({ baseURL, extraHTTPHeaders: headers });
    try {
      if (interviewId) {
        const detail = await cleanup.get(`/api/v1/talent-interviews/${interviewId}`);
        const row = (await detail.json()).data;
        if (row.status === 'scheduled') expect((await cleanup.post(`/api/v1/talent-interviews/${interviewId}/cancel`, { data: { version: row.version } })).ok()).toBeTruthy();
      }
      if (candidateId) {
        const impact = await cleanup.get(`/api/v1/talents/${candidateId}/delete-impact`);
        expect((await cleanup.delete(`/api/v1/talents/${candidateId}`, { data: { impactVersion: (await impact.json()).data.version } })).ok()).toBeTruthy();
      }
    } finally { fixtureState('cleanup'); await cleanup.dispose(); }
  }
});

test('HR invitation extraction and manual override persist through the real preview API', async ({ page, request, baseURL, isMobile }, info) => {
  expect(baseURL).toBe('http://localhost:5173');
  const errors: string[] = [], external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', req => {
    if (/^https?:/.test(req.url()) && new URL(req.url()).origin !== baseURL) external.push(new URL(req.url()).hostname);
  });
  await page.goto('/login');
  await page.getByTestId('preview-login').click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByTestId('preview-badge')).toBeVisible();
  const headers = { authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('token'))}` };
  const identity = await request.get('/api/v1/auth/me', { headers });
  expect(identity.ok()).toBeTruthy();
  expect((await identity.json()).data.employeeNo).toBe('HR001');
  const name = `预览邀请F5${Date.now()}${info.project.name}`;
  // Only candidate setup uses the API; interview creation and edits use the actual form.
  const created = await request.post('/api/v1/talents', { headers, data: {
    name, phone: `100${Date.now().toString().slice(-8)}`, sourceChannel: 'other', note: 'F5虚构验收数据',
  } });
  expect(created.ok()).toBeTruthy();
  const candidateId = (await created.json()).data.id;
  try {
    await page.goto('/talents');
    if (isMobile) await page.locator('.mobile-result-card').filter({ hasText: name }).getByRole('button', { name: '打开详情', exact: true }).click();
    else await page.getByText(name, { exact: true }).first().click();
    await page.getByRole('button', { name: '新增面试', exact: true }).click();
    const form = page.locator('.interview-panel__editor');
    await form.getByLabel('开始时间（北京时间）').fill('2026-12-01 10:00:00');
    await form.getByLabel('开始时间（北京时间）').press('Tab');
    await form.getByLabel('结束时间（北京时间）').fill('2026-12-01 11:00:00');
    await form.getByLabel('结束时间（北京时间）').press('Tab');
    await form.locator('.el-select').getByRole('combobox').click();
    await page.getByRole('option').filter({ hasText: /EMP001/ }).click();
    const invitation = form.getByLabel('会议邀请内容'), link = form.getByLabel('腾讯会议链接');
    await invitation.fill('https://meeting.tencent.com.evil.test/dm/f5');
    await expect(link).toHaveValue('');
    await expect(form.getByRole('status')).toContainText('未识别');
    await invitation.fill('https://meeting.tencent.com/dm/one\nhttps://meeting.tencent.com/dm/two');
    await expect(link).toHaveValue('');
    await expect(form.getByRole('status')).toContainText('多个');
    const text = '虚构面试邀请\n点击入会：（https://meeting.tencent.com/dm/synthetic-preview-f5）。';
    await invitation.fill(text);
    await expect(link).toHaveValue('https://meeting.tencent.com/dm/synthetic-preview-f5');
    await expect(link).toBeEditable();
    await expect(form.getByRole('status')).toContainText('请核对');
    expect(await form.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await form.screenshot({ path: info.outputPath('extracted-link.png'), animations: 'disabled' });
    const saved = page.waitForResponse(response => response.url().endsWith('/api/v1/talent-interviews') && response.request().method() === 'POST');
    await page.getByRole('button', { name: '保存邀约', exact: true }).click();
    const response = await saved;
    expect(response.ok()).toBeTruthy();
    const interview = (await response.json()).data;
    expect(interview).toMatchObject({ meetingUrl: 'https://meeting.tencent.com/dm/synthetic-preview-f5', invitationText: text, syncStatus: 'unconfigured' });
    await page.goto(`/talent-interviews/${interview.id}`);
    await expect(page.getByRole('link', { name: '打开腾讯会议' })).toHaveAttribute('href', 'https://meeting.tencent.com/dm/synthetic-preview-f5');
    await expect(page.locator('.interview-content dd').first()).toHaveText('2026-12-01 10:00:00 至 2026-12-01 11:00:00');
    await page.getByRole('button', { name: '修改邀约', exact: true }).click();
    await link.fill('https://meeting.tencent.com/dm/manual-preview-f5');
    await invitation.fill('更改的虚构邀请 https://meeting.tencent.com/dm/other-preview-f5');
    await expect(link).toHaveValue('https://meeting.tencent.com/dm/manual-preview-f5');
    await expect(form.getByRole('status')).toContainText('保留');
    const updated = page.waitForResponse(res => res.url().endsWith(`/api/v1/talent-interviews/${interview.id}`) && res.request().method() === 'PATCH');
    await page.getByRole('button', { name: '保存邀约', exact: true }).click();
    expect((await updated).ok()).toBeTruthy();
    await page.reload();
    await expect(page.getByRole('link', { name: '打开腾讯会议' })).toHaveAttribute('href', 'https://meeting.tencent.com/dm/manual-preview-f5');
    const persisted = await request.get(`/api/v1/talent-interviews/${interview.id}`, { headers });
    expect(persisted.ok()).toBeTruthy();
    expect((await persisted.json()).data).toMatchObject({ meetingUrl: 'https://meeting.tencent.com/dm/manual-preview-f5',
      invitationText: '更改的虚构邀请 https://meeting.tencent.com/dm/other-preview-f5', syncStatus: 'unconfigured' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
    await page.screenshot({ path: info.outputPath('persisted-link.png'), fullPage: true, animations: 'disabled' });
  } finally {
    // Clean up only this test's fictional records; preserve all existing preview work and audit history.
    const list = await request.get(`/api/v1/talent-interviews?candidateId=${candidateId}`, { headers });
    expect(list.ok()).toBeTruthy();
    for (const interview of (await list.json()).data) {
      if (interview.status !== 'scheduled') continue;
      const cancelled = await request.post(`/api/v1/talent-interviews/${interview.id}/cancel`, { headers, data: { version: interview.version } });
      expect(cancelled.ok()).toBeTruthy();
    }
    const impact = await request.get(`/api/v1/talents/${candidateId}/delete-impact`, { headers });
    expect(impact.ok()).toBeTruthy();
    const removed = await request.delete(`/api/v1/talents/${candidateId}`, { headers, data: { impactVersion: (await impact.json()).data.version } });
    expect(removed.ok()).toBeTruthy();
  }
});
