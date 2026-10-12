import { expect, test, type Page } from '@playwright/test';

// These browser tests exercise the real page/router. Only HTTP is replaced: no
// provider call, real credentials, employee data or DingTalk message is needed.
async function setup(page: Page, role = 'system_admin', options: { stale?: boolean | 'old-success'; saveFails?: boolean; loadFails?: boolean; encryptionReady?: boolean } = {}) {
  const state = {
    encryptionReady: options.encryptionReady ?? true, activeProvider: null as string | null,
    botEnabled: false, allowlist: [] as string[],
    providers: ['kimi', 'deepseek', 'qwen'].map((provider) => ({ provider, configured: false,
      modelId: null as string | null, region: null as string | null, workspaceId: null as string | null,
      configVersion: null as number | null, testedVersion: null as number | null,
      testedAt: null as string | null, tested: false, active: false })),
  };
  const writes: Array<{ path: string; body: Record<string, unknown> }> = [];
  let configReads = 0;
  await page.addInitScript(() => {
    localStorage.setItem('token', 'synthetic-ai-page-session');
    localStorage.setItem('expiresAt', String(Date.now() + 600_000));
  });
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    const send = (data: unknown, status = 200, message = 'success') => route.fulfill({ status,
      contentType: 'application/json', body: JSON.stringify({ code: status === 200 ? 0 : status, data, message }) });
    if (path === '/auth/me') return send({ id: 'admin-1', name: '测试账号', sysRole: role,
      canViewAll: role === 'system_admin', deptId: null, isAssessorOnly: false });
    if (path.startsWith('/ai-progress/config')) {
      if (request.method() === 'GET') {
        configReads++;
        return options.loadFails ? send(null, 503, 'AI 配置暂时不可用') : send(state);
      }
      const body = request.postData() ? request.postDataJSON() : {};
      writes.push({ path, body });
      const provider = state.providers.find((item) => path.includes(`/providers/${item.provider}`));
      if (provider && request.method() === 'PUT') {
        if (options.saveFails) return send(null, 503, 'AI 配置暂时不可用，请稍后重试');
        Object.assign(provider, { configured: true, modelId: body.modelId, region: body.region ?? null,
          workspaceId: body.workspaceId ?? null, configVersion: (provider.configVersion ?? 0) + 1,
          testedVersion: null, testedAt: null, tested: false, active: false });
        state.activeProvider = null; state.botEnabled = false;
      } else if (provider && path.endsWith('/test')) {
        if (options.stale === 'old-success') {
          const oldVersion = provider.configVersion;
          Object.assign(provider, { configVersion: (oldVersion ?? 0) + 1, testedVersion: (oldVersion ?? 0) + 1, tested: true });
          return send({ success: true, errorCode: null, configVersion: oldVersion });
        }
        if (options.stale) return send({ success: false, errorCode: 'config_changed', configVersion: provider.configVersion });
        Object.assign(provider, { tested: true, testedVersion: provider.configVersion, testedAt: '2026-10-12T00:00:00Z' });
        return send({ success: true, errorCode: null, configVersion: provider.configVersion });
      } else if (provider && path.endsWith('/activate')) {
        if (!provider.tested) return send(null, 400, '请先测试当前配置，测试成功后再启用');
        state.providers.forEach((item) => { item.active = item === provider; });
        state.activeProvider = provider.provider;
      } else if (path.endsWith('/bot')) state.botEnabled = body.enabled;
      else if (path.endsWith('/allowlist')) state.allowlist = body.userIds;
      return send(state);
    }
    if (path === '/users' && new URL(request.url()).searchParams.get('status') === 'probation')
      return send({ items: [{ id: '22222222-2222-4222-8222-222222222222', name: '试用期员工', employeeNo: 'TEST002', status: 'probation' }], total: 1 });
    if (path === '/users') return send({ items: [{ id: '11111111-1111-4111-8111-111111111111',
      name: '试运行员工的长姓名', employeeNo: 'TEST001', deptName: '长部门名称用于窄屏验证', status: 'active' }], total: 1, page: 1, pageSize: 100 });
    if (path.endsWith('/unread-count')) return send(0);
    return send([]);
  });
  return { state, writes, reads: () => configReads };
}

test('eligible probation employee can be selected for the pilot', async ({ page }) => {
  const { writes } = await setup(page);
  await page.goto('/system/ai-services');
  await page.getByRole('combobox', { name: '试运行人员', exact: true }).fill('试用期');
  await page.getByRole('option', { name: /试用期员工/ }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '保存试运行名单' }).click();
  await expect(page.getByText('试运行名单已保存', { exact: true })).toBeVisible();
  expect(writes.find(write => write.path.endsWith('/allowlist'))?.body).toEqual({ userIds: ['22222222-2222-4222-8222-222222222222'] });
});

for (const [width, height] of [[1440, 900], [1024, 768], [390, 844]]) {
  test(`${width}px admin configures but cannot read stored key`, async ({ page }, testInfo) => {
    // Catches key echo/storage, missing validation, invalidation and wrong request payloads.
    const { writes } = await setup(page);
    await page.setViewportSize({ width, height });
    await page.goto('/system/ai-services');
    await expect(page.getByRole('button', { name: '保存服务商配置', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '保存服务商配置', exact: true }).click();
    await expect(page.getByText('请填写模型标识', { exact: true })).toBeVisible();
    await expect(page.getByText('请填写 API Key', { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`ai-config-errors-${width}.png`), fullPage: true });
    await page.getByRole('textbox', { name: '模型标识', exact: true }).fill('kimi-k2');
    await page.getByLabel('API Key', { exact: true }).fill('synthetic-test-credential');
    await expect(page.getByText('请填写模型标识', { exact: true })).toHaveCount(0);
    await expect(page.getByText('请填写 API Key', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`ai-config-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.getByRole('button', { name: '保存服务商配置', exact: true }).click();
    await expect(page.getByText('已配置', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '启用此服务商', exact: true })).toBeDisabled();
    expect(writes[0]).toEqual({ path: '/ai-progress/config/providers/kimi', body: { modelId: 'kimi-k2', apiKey: 'synthetic-test-credential' } });
    await page.reload();
    await expect(page.getByText('已配置', { exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'API Key', exact: true })).toHaveValue('');
    await page.getByRole('button', { name: '测试连接', exact: true }).click();
    await expect(page.getByText('当前配置测试通过', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '启用此服务商', exact: true }).click();
    await expect(page.getByText('当前使用：Kimi', { exact: true })).toBeVisible();
    await page.getByRole('region', { name: '机器人试运行' }).locator('.el-switch').click();
    await expect(page.getByText('机器人已开启', { exact: true })).toBeVisible();
    await page.getByRole('combobox', { name: '试运行人员', exact: true }).fill('试运行');
    await page.getByRole('option', { name: /试运行员工的长姓名/ }).click();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '保存试运行名单' }).click();
    await expect(page.getByText('试运行名单已保存', { exact: true })).toBeVisible();
    expect(writes.find((write) => write.path.endsWith('/allowlist'))?.body).toEqual({ userIds: ['11111111-1111-4111-8111-111111111111'] });
    await page.getByRole('textbox', { name: '模型标识', exact: true }).fill('kimi-k2-new');
    await expect(page.getByRole('button', { name: '测试连接', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '保存服务商配置', exact: true }).click();
    expect(writes.at(-1)?.body).toEqual({ modelId: 'kimi-k2-new' });
    await expect(page.getByText('机器人已关闭', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  });
}

for (const role of ['hr', 'hr_user', 'employee', 'manager']) {
  test(`${role} cannot enter or discover AI configuration`, async ({ page }) => {
    // Catches a route/nav role expansion even if the backend still denies requests.
    const fixture = await setup(page, role);
    await page.goto('/system/ai-services');
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('button', { name: '保存服务商配置' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'AI 服务配置', exact: true })).toHaveCount(0);
    expect(fixture.reads()).toBe(0);
  });
}

test('failed save retains model and key inputs', async ({ page }) => {
  await setup(page, 'system_admin', { saveFails: true });
  await page.goto('/system/ai-services');
  await page.getByRole('textbox', { name: '模型标识', exact: true }).fill('kimi-k2');
  await page.getByLabel('API Key', { exact: true }).fill('synthetic-test-credential');
  await page.getByRole('button', { name: '保存服务商配置', exact: true }).click();
  await expect(page.getByText('服务商配置保存失败，输入已保留，请重试。', { exact: true })).toBeVisible();
  await expect(page.getByLabel('API Key', { exact: true })).toHaveValue('synthetic-test-credential');
  await expect(page.getByRole('textbox', { name: '模型标识', exact: true })).toHaveValue('kimi-k2');
});

test('stale test requires a new test and qwen validates workspace', async ({ page }) => {
  await setup(page, 'system_admin', { stale: true });
  await page.goto('/system/ai-services');
  await page.getByRole('radiogroup', { name: 'AI 服务商' }).getByText('千问', { exact: true }).click();
  await page.getByRole('textbox', { name: '模型标识', exact: true }).fill('qwen-plus');
  await page.getByLabel('API Key', { exact: true }).fill('synthetic-test-credential');
  await page.getByRole('combobox', { name: '地域', exact: true }).press('ArrowDown');
  await page.getByRole('option', { name: /德国/ }).click();
  await page.getByRole('button', { name: '保存服务商配置', exact: true }).click();
  await expect(page.getByText('该地域需要填写工作空间标识', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '工作空间标识', exact: true }).fill('workspace-test');
  await page.getByRole('button', { name: '保存服务商配置', exact: true }).click();
  await page.getByRole('button', { name: '测试连接', exact: true }).click();
  await expect(page.getByText('配置已变更，请重新测试当前配置。', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '启用此服务商', exact: true })).toBeDisabled();
});

test('unavailable encryption blocks configuration', async ({ page }) => {
  await setup(page, 'system_admin', { encryptionReady: false });
  await page.goto('/system/ai-services');
  await expect(page.getByText('凭据加密尚未就绪，请联系部署管理员配置后重试。', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '保存服务商配置', exact: true })).toBeDisabled();
});

test('read failure offers retry without editable empty configuration', async ({ page }) => {
  await setup(page, 'system_admin', { loadFails: true });
  await page.goto('/system/ai-services');
  await expect(page.getByText('AI 服务配置读取失败，请重试。', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '重新读取' })).toBeVisible();
  await expect(page.getByRole('button', { name: '保存服务商配置' })).toHaveCount(0);
});

test('an older successful test cannot activate a concurrently changed configuration', async ({ page }) => {
  // Catches trusting success=true without comparing the response version to the refreshed summary.
  const { state } = await setup(page, 'system_admin', { stale: 'old-success' });
  Object.assign(state.providers[0], { configured: true, modelId: 'kimi-k2', configVersion: 1 });
  await page.goto('/system/ai-services');
  await page.getByRole('button', { name: '测试连接', exact: true }).click();
  await expect(page.getByText('配置已变更，请重新测试当前配置。', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '启用此服务商', exact: true })).toBeDisabled();
});

test('DeepSeek replaces a stored key only after explicit opt in', async ({ page }) => {
  // Catches posting an empty key or silently replacing a stored credential.
  const { state, writes } = await setup(page);
  Object.assign(state.providers[1], { configured: true, modelId: 'deepseek-chat', configVersion: 1 });
  await page.goto('/system/ai-services');
  await page.getByRole('radiogroup', { name: 'AI 服务商' }).getByText('DeepSeek', { exact: true }).click();
  const key = page.getByRole('textbox', { name: 'API Key', exact: true });
  await expect(key).toBeDisabled();
  await page.getByText('替换 API Key', { exact: true }).click();
  await page.getByRole('button', { name: '保存服务商配置', exact: true }).click();
  await expect(page.getByText('请填写 API Key', { exact: true })).toBeVisible();
  expect(writes).toHaveLength(0);
  await key.fill('synthetic-replacement-credential');
  await page.getByRole('button', { name: '保存服务商配置', exact: true }).click();
  await expect(page.getByText('服务商配置已保存，请测试连接后再启用。', { exact: true })).toBeVisible();
  expect(writes[0]).toEqual({ path: '/ai-progress/config/providers/deepseek', body: {
    modelId: 'deepseek-chat', apiKey: 'synthetic-replacement-credential' } });
  await expect(key).toHaveValue('');
  await expect(key).toBeDisabled();
});
