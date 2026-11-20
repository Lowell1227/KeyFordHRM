import { test, expect } from '@playwright/test';

test.setTimeout(210000);
test.use({ actionTimeout: 15000 });

test('real DeepSeek single parse survives close/reload and explicitly applies recovered result', async ({ page }, info) => {
  test.skip(process.env.HRM_FICTIONAL_RESUME_PAGE_CHECK !== '1' || info.project.name !== 'desktop',
    'One explicitly authorized fictional-only DeepSeek parse, desktop project captures both widths');
  expect(info.config.globalSetup).toBeNull();
  expect(info.project.use.baseURL).toBe('http://localhost:5173');
  const errors: string[] = [];
  const writes: string[] = [];
  let starts = 0;
  page.on('pageerror', error => errors.push(error.name));
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path === '/api/v1/talent-resume/tasks' && request.method() === 'POST') starts++;
    if (/^\/api\/v1\/talents(?:\/|$)/.test(path) && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method())) {
      writes.push(`${request.method()} ${path}`);
    }
  });

  await page.setContent('<html><meta charset="utf-8"><body style="font:24px Arial;line-height:1.8;padding:32px;color:#111;background:white"><h1>Fictional Resume</h1><p>Name: Synthetic Example</p><p>Phone: 17000001001</p><p>Email: synthetic@example.com</p><p>Education: Bachelor</p><p>School: Fictional University</p></body></html>');
  const buffer = await page.pdf({ format: 'A4' });
  await page.goto('/login');
  await page.getByTestId('preview-login').click();
  await expect(page).toHaveURL('/dashboard');
  await page.goto('/talents');
  const statusResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/talent-resume/status');
  await page.getByRole('button', { name: '新增人才', exact: true }).click();
  const status = await statusResponse;
  expect(status.status()).toBe(200);
  expect((await status.json()).data).toMatchObject({ enabled: true, configured: true, provider: 'deepseek' });
  const drawer = page.locator('.talent-form-drawer');
  await expect(drawer.getByText(/由 DeepSeek 解析/)).toBeVisible();
  const response = page.waitForResponse(result => new URL(result.url()).pathname === '/api/v1/talent-resume/tasks'
    && result.request().method() === 'POST');
  await drawer.locator('#talent-form-file-input').setInputFiles({ name: 'synthetic-ui.pdf', mimeType: 'application/pdf', buffer });
  const accepted = await response;
  expect(accepted.status()).toBe(202);
  const task = (await accepted.json()).data;
  expect(task.context).toBe('new');
  expect(accepted.request().headers()['x-resume-context']).toBe('new');
  await drawer.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('dialog', { name: '放弃未保存修改？' }).getByRole('button', { name: '放弃修改', exact: true }).click();
  await expect(drawer).not.toBeVisible();
  await page.reload();
  const recoveredResponse = page.waitForResponse(async result => {
    const path = new URL(result.url()).pathname;
    if (result.request().method() !== 'GET' || ![`/api/v1/talent-resume/tasks/${task.id}`, '/api/v1/talent-resume/tasks/current'].includes(path)) return false;
    const body = await result.json();
    return body.data?.id === task.id && body.data.status === 'succeeded';
  }, { timeout: 155000 });
  await page.getByRole('button', { name: '新增人才', exact: true }).click();
  await drawer.getByPlaceholder('候选人姓名').fill('人工重新填写姓名');
  const recovered = (await (await recoveredResponse).json()).data;
  const result = recovered.result;
  expect(result.fields).toMatchObject({ name: 'Synthetic Example', phone: '17000001001' });
  await expect(drawer.getByText('解析完成', { exact: true })).toBeVisible();
  await expect(drawer.getByTestId('resume-task')).not.toContainText('已用');
  await expect(drawer.getByPlaceholder('11 位手机号')).toHaveValue('');
  await expect(drawer.locator('.talent-form__pending-name')).toHaveText('synthetic-ui.pdf');
  await drawer.getByRole('button', { name: '填入解析结果', exact: true }).click();
  await expect(drawer.getByPlaceholder('11 位手机号')).toHaveValue('17000001001');
  await expect(drawer.getByPlaceholder('候选人姓名')).toHaveValue('人工重新填写姓名');
  const conflicts = drawer.locator('.talent-form__parse-conflicts');
  const nameChoice = conflicts.getByRole('checkbox', { name: '姓名：Synthetic Example', exact: true });
  await expect(nameChoice).not.toBeChecked();
  await expect(conflicts.getByRole('button', { name: '替换所选字段', exact: true })).toBeDisabled();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(drawer.getByPlaceholder('候选人姓名')).toHaveValue('人工重新填写姓名');
    expect(await drawer.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`real-ai-recovered-conflict-${width}.png`), fullPage: true, animations: 'disabled' });
  }
  await conflicts.locator('.el-checkbox').filter({ hasText: '姓名：Synthetic Example' }).click();
  await expect(nameChoice).toBeChecked();
  await conflicts.getByRole('button', { name: '替换所选字段', exact: true }).click();
  await expect(drawer.getByPlaceholder('候选人姓名')).toHaveValue('Synthetic Example');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(drawer.getByPlaceholder('候选人姓名')).toHaveValue('Synthetic Example');
    expect(await drawer.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`real-ai-filled-${width}.png`), fullPage: true, animations: 'disabled' });
  }
  await drawer.getByRole('button', { name: '清除解析任务', exact: true }).click();
  await page.getByRole('dialog', { name: '清除解析任务', exact: true }).getByRole('button', { name: '清除解析任务', exact: true }).click();
  await expect(drawer.getByTestId('resume-task')).toHaveCount(0);
  expect(writes).toEqual([]);
  expect(starts).toBe(1);
  await expect(page.locator('.el-progress')).toHaveCount(0);
  expect(errors).toEqual([]);
});

async function openMockedForm(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByTestId('preview-login').click();
  await expect(page).toHaveURL('/dashboard');
  await page.goto('/talents');
  await page.getByRole('button', { name: '新增人才', exact: true }).click();
  return page.locator('.talent-form-drawer');
}

test('mocked task API: double network failure cannot apply old identity to a different same-named file', async ({ page }) => {
  let currentReads = 0;
  const now = Date.now(), old = { id: 'old-task', context: 'new', status: 'succeeded', stage: 'extracting', fileName: 'same.pdf',
    createdAt: new Date(now).toISOString(), deadlineAt: new Date(now + 150000).toISOString(), expiresAt: new Date(now + 1800000).toISOString(),
    result: { fields: { name: 'Candidate A', school: 'School A' }, reviewItems: [] } };
  await page.route('**/api/v1/talent-resume/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/status')) return route.fulfill({ json: { code: 0, data: { enabled: true, configured: true } } });
    if (path.endsWith('/file')) return route.fulfill({ contentType: 'application/octet-stream', body: '%PDF-1.4 fictional retained A source' });
    if (path.endsWith('/current') && ++currentReads === 1) return route.fulfill({ json: { code: 0, data: old } });
    return route.abort('failed');
  });
  const drawer = await openMockedForm(page);
  await expect(drawer.locator('.talent-form__pending-name')).toHaveText('same.pdf');
  await drawer.locator('#talent-form-file-input').setInputFiles({ name: 'same.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 different B') });
  await expect(drawer.getByText(/连接中断/)).toBeVisible();
  await expect(drawer.getByPlaceholder('候选人姓名')).toHaveValue('');
  await expect(drawer.locator('.talent-form__pending-name')).toHaveCount(2);
  await drawer.getByRole('button', { name: '填入解析结果', exact: true }).click();
  await expect(drawer.getByPlaceholder('候选人姓名')).toHaveValue('Candidate A');
  await expect(drawer.getByTestId('resume-task')).toContainText('same.pdf');
});

test('mocked task API: disabled start still recovers, connection failures reconnect without losing human input', async ({ page }) => {
  let online = false, statusReads = 0, taskStarts = 0;
  const now = Date.now();
  const task = { id: 'mock-connection', context: 'new', status: 'processing', stage: 'recognizing', fileName: 'mock-recovery.pdf',
    createdAt: new Date(now).toISOString(), deadlineAt: new Date(now + 150000).toISOString(), expiresAt: new Date(now + 1800000).toISOString() };
  await page.route('**/api/v1/talent-resume/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'POST') taskStarts++;
    if (path.endsWith('/file')) return route.fulfill({ contentType: 'application/octet-stream', body: '%PDF-1.4 fictional validated source' });
    if (path.endsWith('/status')) return route.fulfill({ json: { code: 0, data: { enabled: false, configured: true } } });
    if (path.endsWith('/current')) return route.fulfill({ json: { code: 0, data: task } });
    statusReads++;
    if (!online) return route.abort('failed');
    return route.fulfill({ json: { code: 0, data: { ...task, status: 'succeeded', stage: 'extracting',
      result: { fields: { name: 'Mock parsed name', school: 'Mock school' }, reviewItems: [] } } } });
  });
  const drawer = await openMockedForm(page);
  await drawer.getByPlaceholder('候选人姓名').fill('Human input');
  await expect(drawer.getByText('正在识别原文', { exact: true })).toBeVisible();
  await expect(drawer.getByText(/连接中断/)).toBeVisible({ timeout: 10000 });
  await expect(drawer.getByPlaceholder('候选人姓名')).toHaveValue('Human input');
  online = true;
  await drawer.getByRole('button', { name: '重新连接', exact: true }).click();
  await expect(drawer.getByText('解析完成', { exact: true })).toBeVisible();
  await expect(drawer.getByTestId('resume-task')).not.toContainText('已用');
  await expect(drawer.locator('.talent-form__pending-name')).toHaveText('mock-recovery.pdf');
  await drawer.getByRole('button', { name: '填入解析结果', exact: true }).click();
  await expect(drawer.getByPlaceholder('候选人姓名')).toHaveValue('Human input');
  await expect(drawer.locator('.talent-form__parse-conflicts')).toContainText('Mock parsed name');
  expect(taskStarts).toBe(0); expect(statusReads).toBeGreaterThanOrEqual(2);
});

test('mocked task API: deadline ends busy, reads definitive timeout, and retries only on explicit action', async ({ page }, info) => {
  await page.clock.install({ time: new Date() });
  let retries = 0, reads = 0;
  let finishDeadlineRead!: () => void;
  const deadlineRead = new Promise<void>(resolve => { finishDeadlineRead = resolve; });
  const now = Date.now();
  const task = { id: 'mock-timeout', context: 'new', status: 'processing', stage: 'extracting', fileName: 'mock-timeout.pdf',
    createdAt: new Date(now - 149000).toISOString(), deadlineAt: new Date(now + 1000).toISOString(), expiresAt: new Date(now + 1651000).toISOString() };
  await page.route('**/api/v1/talent-resume/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/file')) return route.fulfill({ contentType: 'application/octet-stream', body: '%PDF-1.4 fictional source' });
    if (path.endsWith('/status')) return route.fulfill({ json: { code: 0, data: { enabled: true, configured: true } } });
    if (path.endsWith('/current')) return route.fulfill({ json: { code: 0, data: task } });
    if (path.endsWith('/retry')) {
      retries++;
      return route.fulfill({ status: 202, json: { code: 0, data: { ...task, id: 'mock-retry', status: 'succeeded',
        createdAt: new Date().toISOString(), deadlineAt: new Date(Date.now() + 150000).toISOString(),
        result: { fields: { school: 'Mock retry school' }, reviewItems: [] } } } });
    }
    reads++;
    await deadlineRead;
    return route.fulfill({ json: { code: 0, data: { ...task, status: 'timed_out', message: '解析超时，原文件已保留，可重新解析。' } } });
  });
  const drawer = await openMockedForm(page);
  await expect(drawer.locator('.talent-form__pending-name')).toHaveText('mock-timeout.pdf');
  await page.clock.fastForward(2000);
  await expect(drawer.getByText(/已用 150 秒 \/ 最长 150 秒/)).toBeVisible();
  finishDeadlineRead();
  await expect(drawer.getByText('解析超时，原文件已保留，可重新解析。', { exact: true })).toBeVisible();
  await expect(drawer.getByTestId('resume-task')).not.toContainText('已用');
  await expect(drawer.getByRole('button', { name: '加入人才库', exact: true })).toBeEnabled();
  expect(retries).toBe(0); expect(reads).toBeGreaterThanOrEqual(1);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(async () => {
      const bounds = await drawer.boundingBox();
      return Boolean(bounds && bounds.x >= -1 && bounds.x + bounds.width <= width + 1);
    }).toBe(true);
    expect(await drawer.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    const bounds = await drawer.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(-1);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
    await page.screenshot({ path: info.outputPath(`mocked-timeout-${width}.png`), fullPage: true, animations: 'disabled' });
  }
  await drawer.getByRole('button', { name: '重新解析', exact: true }).click();
  await expect(drawer.getByText('解析完成', { exact: true })).toBeVisible();
  expect(retries).toBe(1);
  await expect(drawer.locator('.talent-form__pending-name')).toHaveCount(1);
});
