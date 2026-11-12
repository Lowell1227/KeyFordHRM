import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { execFileSync } from 'node:child_process';

test.use({ actionTimeout: 10000 });

// Run only with playwright.preview.config.ts, never the normal globalSetup.
test.beforeAll(() => {
  const [container] = JSON.parse(execFileSync('docker', ['inspect', 'hrm-api-1'], { encoding: 'utf8' }));
  const env = Object.fromEntries(container.Config.Env.map((line: string) => {
    const split = line.indexOf('=');
    return [line.slice(0, split), line.slice(split + 1)];
  }));
  expect(container.Config.Labels['com.docker.compose.project']).toBe('hrm');
  expect(env.HRM_PREVIEW).toBe('true');
  expect(env.NODE_ENV).toBe('development');
  const database = new URL(env.DATABASE_URL);
  expect([database.hostname, database.username, database.pathname]).toEqual(['postgres', 'hrm_preview', '/hrm_preview']);
  expect(env.DINGTALK_NOTIFICATION_ENABLED).toBe('false');
  expect(env.DINGTALK_INTERVIEW_CALENDAR_ENABLED).toBe('false');
  expect(Object.keys(container.NetworkSettings.Networks)).toEqual(['hrm_internal']);
});

async function fixture(request: APIRequestContext) {
  const login = await request.post('/api/v1/auth/test-login', { data: { employeeNo: 'HR001' } });
  expect(login.ok()).toBe(true);
  const headers = { authorization: `Bearer ${(await login.json()).data.token}` };
  const name = `F3F4-preview-${Date.now()}`;
  const created = await request.post('/api/v1/talents', {
    headers, data: { name, phone: `100${Date.now().toString().slice(-8)}`, sourceChannel: 'other' },
  });
  expect(created.status()).toBe(201);
  const id = (await created.json()).data.id as string;
  return {
    id, name, headers,
    async clean() {
      const impact = await request.get(`/api/v1/talents/${id}/delete-impact`, { headers });
      expect(impact.ok()).toBe(true);
      const removed = await request.delete(`/api/v1/talents/${id}`, { headers, data: { impactVersion: (await impact.json()).data.version } });
      expect(removed.ok()).toBe(true);
    },
  };
}

async function openFollowUp(page: Page, name: string) {
  await page.goto('/login');
  await page.getByTestId('preview-login').click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto('/talents');
  await page.getByPlaceholder('姓名 / 手机 / 公司 / 职位').fill(name);
  await page.getByPlaceholder('姓名 / 手机 / 公司 / 职位').press('Enter');
  const row = page.locator('.el-table__row:visible, .mobile-result-card:visible').filter({ hasText: name });
  await row.getByRole('button', { name: /^打开(详情)?$/ }).click();
  await page.getByRole('button', { name: '记一条', exact: true }).click();
}

for (const timezoneId of ['Asia/Shanghai', 'America/Los_Angeles']) {
  test.describe(timezoneId, () => {
    test.use({ timezoneId });
    test('F3 Beijing 01:00 default, save and date-only timeline stay on the business day', async ({ page, request }, info) => {
      const candidate = await fixture(request);
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        await page.clock.setFixedTime(new Date('2026-11-12T17:00:00Z'));
        await openFollowUp(page, candidate.name);
        const form = page.locator('.talent-follow-ups__form');
        await expect(form.getByPlaceholder('跟进日期', { exact: true })).toHaveValue('2026-11-13');
        await form.getByPlaceholder('本次沟通要点（必填）').fill('F3 fictional midnight follow-up');
        await form.getByPlaceholder('不设置', { exact: true }).fill('2028-02-29');
        await form.getByPlaceholder('不设置', { exact: true }).press('Tab');
        const saved = page.waitForResponse(r => r.url().endsWith(`/talents/${candidate.id}/follow-ups`) && r.request().method() === 'POST');
        await form.getByRole('button', { name: '保存跟进', exact: true }).click();
        const response = await saved;
        expect(response.status()).toBe(201);
        expect((await response.json()).data).toMatchObject({ occurredAt: '2026-11-13T00:00:00.000Z', nextFollowUpAt: '2028-02-29T00:00:00.000Z' });
        const timeline = page.locator('.talent-follow-ups__timeline');
        await expect(timeline).toContainText('2026-11-13');
        await expect(timeline).toContainText('2028-02-29');
        await expect(page.locator('.el-drawer .el-loading-mask:visible')).toHaveCount(0);
        await timeline.scrollIntoViewIfNeeded();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
        expect(errors).toEqual([]);
        await page.screenshot({ path: info.outputPath('followup-beijing-date.png'), fullPage: true });
        await page.getByRole('button', { name: '记一条', exact: true }).click();
        await expect(form.getByPlaceholder('跟进日期', { exact: true })).toHaveValue('2026-11-13');
      } finally { await candidate.clean(); }
    });
  });
}

test('F4 real HTTP rejects invalid calendars for both fields and preserves valid leap dates', async ({ request }) => {
  const candidate = await fixture(request);
  try {
    for (const field of ['occurredAt', 'nextFollowUpAt']) {
      for (const value of ['2026-02-31', '2026-02-29', '1900-02-29', '0000-01-01', '2026-13-01', '2026-04-31']) {
        const response = await request.post(`/api/v1/talents/${candidate.id}/follow-ups`, {
          headers: candidate.headers, data: { channel: 'phone', summary: 'F4 fictional invalid calendar', [field]: value },
        });
        expect.soft(response.status(), `${field}=${value}`).toBe(400);
      }
    }
    const before = await request.get(`/api/v1/talents/${candidate.id}/follow-ups`, { headers: candidate.headers });
    expect.soft((await before.json()).data).toHaveLength(0);
    const valid = await request.post(`/api/v1/talents/${candidate.id}/follow-ups`, {
      headers: candidate.headers, data: { channel: 'phone', summary: 'F4 valid leap day', occurredAt: '2000-02-29', nextFollowUpAt: '2028-02-29' },
    });
    expect(valid.status()).toBe(201);
    expect((await valid.json()).data).toMatchObject({ occurredAt: '2000-02-29T00:00:00.000Z', nextFollowUpAt: '2028-02-29T00:00:00.000Z' });
  } finally { await candidate.clean(); }
});

test('F4 invalid typing can be corrected by calendar selection without typing again', async ({ page, request }, info) => {
  const candidate = await fixture(request);
  try {
    await page.clock.setFixedTime(new Date('2026-11-12T17:00:00Z'));
    await openFollowUp(page, candidate.name);
    const form = page.locator('.talent-follow-ups__form');
    await form.getByPlaceholder('本次沟通要点（必填）').fill('F4 fictional calendar correction');
    for (const placeholder of ['跟进日期', '不设置']) {
      const date = form.getByPlaceholder(placeholder, { exact: true });
      await date.fill('2026-02-31');
      await date.press('Tab');
      await form.getByRole('button', { name: '保存跟进', exact: true }).click();
      await expect(form.locator('.el-form-item__error')).toContainText(['有效日期']);
      await date.click();
      const calendar = page.locator('.el-picker-panel:visible');
      await calendar.locator('td.available').filter({ hasText: /^15$/ }).click();
      await expect(form.locator('.el-form-item__error')).toHaveCount(0);
      await expect(date).toHaveValue(/^\d{4}-\d{2}-15$/);
    }
    const occurredAt = await form.getByPlaceholder('跟进日期', { exact: true }).inputValue();
    const nextFollowUpAt = await form.getByPlaceholder('不设置', { exact: true }).inputValue();
    const saved = page.waitForResponse(r => r.url().endsWith(`/talents/${candidate.id}/follow-ups`) && r.request().method() === 'POST', { timeout: 10000 });
    await form.getByRole('button', { name: '保存跟进', exact: true }).click();
    const response = await saved;
    expect(response.status()).toBe(201);
    expect((await response.json()).data).toMatchObject({ occurredAt: `${occurredAt}T00:00:00.000Z`, nextFollowUpAt: `${nextFollowUpAt}T00:00:00.000Z` });
    const timeline = page.locator('.talent-follow-ups__timeline');
    await expect(timeline).toContainText('F4 fictional calendar correction');
    await expect(page.locator('.el-drawer .el-loading-mask:visible')).toHaveCount(0);
    await timeline.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('calendar-correction.png'), fullPage: true });
  } finally { await candidate.clean(); }
});

test('F4 invalid typed dates show inline errors and do not save rollover values', async ({ page, request }, info) => {
  const candidate = await fixture(request);
  try {
    await openFollowUp(page, candidate.name);
    const form = page.locator('.talent-follow-ups__form');
    await form.getByPlaceholder('本次沟通要点（必填）').fill('F4 fictional inline validation');
    for (const placeholder of ['跟进日期', '不设置']) {
      const date = form.getByPlaceholder(placeholder, { exact: true });
      await date.fill('2026-02-31');
      await date.press('Tab');
      await form.getByRole('button', { name: '保存跟进', exact: true }).click();
      await expect(form.locator('.el-form-item__error')).toContainText(['有效日期']);
      const list = await request.get(`/api/v1/talents/${candidate.id}/follow-ups`, { headers: candidate.headers });
      expect((await list.json()).data).toHaveLength(0);
      await page.screenshot({ path: info.outputPath(`invalid-${placeholder === '跟进日期' ? 'occurred' : 'next'}.png`), fullPage: true });
      await date.fill('2028-02-29');
      await date.press('Tab');
      await expect(form.locator('.el-form-item__error')).toHaveCount(0);
    }
    const saved = page.waitForResponse(r => r.url().endsWith(`/talents/${candidate.id}/follow-ups`) && r.request().method() === 'POST');
    await form.getByRole('button', { name: '保存跟进', exact: true }).click();
    expect((await saved).status()).toBe(201);
  } finally { await candidate.clean(); }
});
