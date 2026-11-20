import { expect, test, type Page } from '@playwright/test';

// Exercise the actual Vue and Element Plus controls with deterministic API responses.
const candidate = {
  id: 'expert-candidate', name: '虚构评审人才', phone: '17000000000', email: 'fixture@example.com',
  status: 'new', sourceChannel: 'other', gender: 'unknown', tags: [], files: [], followUps: [], shares: [],
  updatedAt: '2026-11-20T00:00:00Z', ownerId: 'hr', editVersion: 'v1', fileCount: 0,
};
const old = { id: 'older-matching', positionName: '虚构旧岗位', stage: 'reserve', recruitmentBatch: '秋季', revision: 4, allowedActions: ['reject', 'reopen'] };
const older = { ...old, id: 'oldest-matching', recruitmentBatch: '春季', revision: 6 };
const latest = { ...old, id: 'latest-other', positionName: '虚构新岗位', stage: 'screening', recruitmentBatch: null, revision: 1, allowedActions: ['reject', 'submit_hiring'] };
const envelope = (data: unknown) => ({ json: { code: 0, data } });

async function install(page: Page, options: { missing?: boolean; withdrawn?: boolean; emailError?: string | string[] } = {}) {
  const writes: Array<{ path: string; body: Record<string, unknown> }> = [];
  let current = { ...candidate };
  const withdrawn = { ...old, stage: 'withdrawn', allowedActions: ['reopen'] };
  let applications = [latest, older, ...(options.missing ? [] : [options.withdrawn ? withdrawn : old])];
  await page.addInitScript(() => localStorage.setItem('token', 'fictional-expert-fixes'));
  await page.route('**/api/v1/**', route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    const result = (data: unknown) => route.fulfill(envelope(data));
    if (path.endsWith('/auth/me')) return result({ id: 'hr', name: '虚构HR', sysRole: 'hr', hrCapabilities: [], businessCapabilities: {} });
    if (path.endsWith('/notifications/unread-count')) return result({ count: 0 });
    if (path.endsWith('/application-positions')) return result([old.positionName, latest.positionName]);
    if (path.endsWith('/check-phone')) return result({ exists: false });
    if (path.endsWith('/owners')) return result({ items: [], total: 0 });
    if (path.endsWith('/talent-resume/status')) return result({ enabled: false, configured: false });
    if (path.endsWith('/tasks/current')) return result(null);
    if (path.endsWith('/talents') && request.method() === 'GET') {
      const stage = url.searchParams.get('applicationStage');
      const match = stage === 'withdrawn' ? withdrawn : stage || url.searchParams.has('applicationPosition') ? old : latest;
      return result({ items: [{ ...current, latestApplication: match }], total: 1 });
    }
    if (path.endsWith('/talents') || path.endsWith('/talents/' + candidate.id)) {
      if (request.method() === 'GET') return result(current);
      const body = request.postDataJSON();
      writes.push({ path, body });
      if (options.emailError) return route.fulfill({ status: 400, json: { message: options.emailError } });
      current = { ...current, ...body, editVersion: 'v2' };
      return route.fulfill({ status: request.method() === 'POST' ? 201 : 200, ...envelope(current) });
    }
    if (path.endsWith('/applications')) return result(applications);
    if (path.endsWith('/actions')) {
      writes.push({ path, body: request.postDataJSON() });
      const saved = { ...old, stage: 'rejected', revision: 5, allowedActions: ['reopen'] };
      applications = applications.map(row => row.id === saved.id ? saved : row);
      return route.fulfill({ status: 201, ...envelope(saved) });
    }
    const application = applications.find(row => path.endsWith('/applications/' + row.id));
    return result(application ?? []);
  });
  return writes;
}

async function openDetail(page: Page, width: number) {
  if (width < 769) await page.getByRole('button', { name: '打开详情', exact: true }).click();
  else await page.locator('.el-table:visible').getByText(candidate.name, { exact: true }).click();
  const drawer = page.locator('.talent-detail-drawer');
  await expect(drawer).toBeVisible();
  return drawer;
}

async function filterByStage(page: Page) {
  await page.getByTestId('talent-filter-application-stage').click();
  await page.getByRole('option', { name: '人才储备', exact: true }).click();
  await expect(page.getByText('虚构旧岗位 · 人才储备', { exact: true }).filter({ visible: true })).toBeVisible();
}

for (const [width, height] of [[1440, 900], [1024, 768], [390, 844]] as const) {
  test(`the displayed application match is the action target at ${width}px`, async ({ page }, info) => {
    const writes = await install(page);
    await page.setViewportSize({ width, height });
    await page.goto('/talents');
    if (width !== 1024) {
      await page.getByTestId('talent-filter-application-position').click();
      await page.getByRole('option', { name: old.positionName, exact: true }).click();
    }
    await filterByStage(page);
    const drawer = await openDetail(page, width), panel = drawer.locator('.application-panel');
    await expect(panel.locator('.el-select').first()).toContainText('虚构旧岗位 · 秋季 · 人才储备');
    await expect(panel.getByText('本次应聘阶段', { exact: true })).toBeVisible();
    await expect(drawer.getByText('人才库状态：新入库', { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: '淘汰本次应聘', exact: true }).click();
    const command = panel.locator('.application-panel__command');
    await command.locator('textarea').fill('虚构应聘淘汰说明');
    await command.getByRole('button', { name: '淘汰本次应聘', exact: true }).click();
    await expect(panel.locator('.application-panel__stage')).toHaveText('已淘汰');
    expect(writes).toEqual([{ path: '/api/v1/talent-recruitment/applications/older-matching/actions',
      body: { expectedRevision: 4, action: 'reject', note: '虚构应聘淘汰说明' } }]);
    await expect(drawer.getByText('人才库状态：新入库', { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: '刷新应聘记录' }).click();
    await expect(panel.locator('.el-select').first()).toContainText('虚构旧岗位 · 秋季 · 已淘汰');
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('application-context.png'), animations: 'disabled' });
    expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  });
}

for (const change of [{ missing: true }, { withdrawn: true }]) {
  test(`a ${change.missing ? 'missing' : 'no longer matching'} result requires an explicit selection`, async ({ page }) => {
    await install(page, change);
    await page.goto('/talents');
    await filterByStage(page);
    const panel = (await openDetail(page, 1440)).locator('.application-panel');
    await expect(panel.getByText(/筛选匹配的应聘记录/)).toBeVisible({ timeout: 2500 });
    await expect(panel.locator('.application-panel__stage')).toHaveCount(0);
    await expect(panel.getByRole('button', { name: '提交录用', exact: true })).toHaveCount(0);
    await panel.locator('.el-select').first().click();
    await page.getByRole('option', { name: '虚构新岗位 · 初筛', exact: true }).click();
    await expect(panel.getByRole('button', { name: '提交录用', exact: true })).toBeVisible();
  });
}

test('the unfiltered drawer defaults to latest and the talent status action stays separate', async ({ page }) => {
  const writes = await install(page);
  await page.goto('/talents');
  const drawer = await openDetail(page, 1440);
  await expect(drawer.locator('.application-panel .el-select').first()).toContainText('虚构新岗位 · 初筛');
  await drawer.getByRole('button', { name: '设置人才状态', exact: true }).click({ timeout: 2500 });
  const dialog = page.getByRole('dialog', { name: '设置人才状态' });
  await dialog.getByRole('button', { name: '设为已淘汰', exact: true }).click();
  await expect(drawer.getByText('人才库状态：已淘汰', { exact: true })).toBeVisible();
  await expect(drawer.locator('.application-panel__stage')).toHaveText('初筛');
  expect(writes).toEqual([{ path: '/api/v1/talents/expert-candidate', body: { status: 'rejected', editVersion: 'v1' } }]);
});

test('a historical application can still be opened from the withdrawn filter', async ({ page }) => {
  await install(page, { withdrawn: true });
  await page.goto('/talents');
  await page.getByTestId('talent-filter-application-stage').click();
  await page.getByRole('option', { name: '已撤回', exact: true }).click();
  await expect(page.locator('.el-table:visible').getByText('虚构旧岗位 · 已撤回', { exact: true })).toBeVisible();
  const panel = (await openDetail(page, 1440)).locator('.application-panel');
  await expect(panel.locator('.el-select').first()).toContainText('虚构旧岗位 · 秋季 · 已撤回');
  await expect(panel.getByRole('button', { name: '重开应聘', exact: true })).toBeVisible();
  await expect(panel.getByText(/筛选匹配的应聘记录/)).toHaveCount(0);
});

async function openForm(page: Page) {
  await page.getByRole('button', { name: '新增人才', exact: true }).click();
  const drawer = page.locator('.talent-form-drawer');
  await expect(drawer.getByPlaceholder('候选人姓名')).toBeEnabled();
  return drawer;
}

for (const close of ['Escape', 'header', 'mask', 'footer'] as const) {
  test(`a changed form prompts before closing via ${close}`, async ({ page }, info) => {
    await install(page);
    if (close === 'Escape') await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/talents');
    const drawer = await openForm(page), name = drawer.getByPlaceholder('候选人姓名');
    await name.fill('虚构未保存修改');
    const closeDrawer = async () => {
      if (close === 'Escape') await page.keyboard.press('Escape');
      else if (close === 'header') await drawer.locator('.el-drawer__close-btn').click();
      else if (close === 'mask') await page.mouse.click(10, 80);
      else await drawer.getByRole('button', { name: '取消', exact: true }).click();
    };
    await closeDrawer();
    const prompt = page.getByRole('dialog', { name: '放弃未保存修改？' });
    await expect(prompt).toBeVisible({ timeout: 2500 });
    if (close === 'Escape') await page.screenshot({ path: info.outputPath('discard-mobile.png'), animations: 'disabled' });
    await prompt.getByRole('button', { name: '继续编辑', exact: true }).click();
    await expect(prompt).not.toBeVisible();
    await expect(name).toHaveValue('虚构未保存修改');
    await closeDrawer();
    await prompt.getByRole('button', { name: '放弃修改', exact: true }).click();
    await expect(drawer).not.toBeVisible();
    await openForm(page);
    await expect(name).toHaveValue('');
  });
}

test('an unchanged loaded form closes, while a pending attachment alone requires confirmation', async ({ page }) => {
  await install(page);
  await page.goto('/talents');
  await page.locator('.el-table:visible').getByRole('button', { name: '编辑', exact: true }).click();
  const drawer = page.locator('.talent-form-drawer');
  await expect(drawer.getByLabel('邮箱', { exact: true })).toHaveValue(candidate.email);
  await drawer.locator('.el-drawer__close-btn').click();
  await expect(drawer).not.toBeVisible({ timeout: 2500 });
  await expect(page.locator('.el-message-box:visible')).toHaveCount(0);
  await page.locator('.el-table:visible').getByRole('button', { name: '编辑', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await drawer.getByText('添加文件', { exact: true }).click();
  await (await chooser).setFiles({ name: 'fictional-resume.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
  await expect(drawer.getByText('fictional-resume.pdf', { exact: true })).toBeVisible();
  await drawer.locator('.el-drawer__close-btn').click();
  const prompt = page.getByRole('dialog', { name: '放弃未保存修改？' });
  await expect(prompt).toBeVisible({ timeout: 2500 });
  await prompt.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(drawer.getByText('fictional-resume.pdf', { exact: true })).toBeVisible();
});

async function enterRequiredFields(page: Page) {
  const drawer = await openForm(page);
  await drawer.getByPlaceholder('候选人姓名').fill('虚构邮箱测试人才');
  await drawer.getByPlaceholder('11 位手机号').fill('17000000000');
  await drawer.getByTestId('talent-form-source').click();
  await page.getByRole('option', { name: '其他', exact: true }).click();
  return drawer;
}

test('invalid email stays next to the field and an empty email saves successfully', async ({ page }, info) => {
  const writes = await install(page);
  await page.goto('/talents');
  const drawer = await enterRequiredFields(page);
  const email = drawer.getByLabel('邮箱', { exact: true });
  await email.fill('invalid-email');
  await drawer.getByRole('button', { name: '加入人才库', exact: true }).click();
  const error = drawer.locator('.el-form-item').filter({ has: page.getByLabel('邮箱', { exact: true }) }).locator('.el-form-item__error');
  await expect(error).toHaveText('邮箱格式不正确', { timeout: 2500 });
  await expect(email).toHaveValue('invalid-email');
  expect(writes).toHaveLength(0);
  await email.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('email-inline.png'), animations: 'disabled' });
  await email.fill('   ');
  await drawer.getByRole('button', { name: '加入人才库', exact: true }).click();
  await expect(drawer).not.toBeVisible();
  expect(writes[0]?.body.email).toBeNull();
  await expect(page.locator('.el-message-box:visible')).toHaveCount(0);
});

for (const emailError of ['邮箱不可用', ['邮箱不可用', '其他资料有误']]) {
  test(`the server's ${typeof emailError === 'string' ? 'string' : 'array'} email error appears beside the email`, async ({ page }) => {
    const writes = await install(page, { emailError });
    await page.goto('/talents');
    const drawer = await enterRequiredFields(page), email = drawer.getByLabel('邮箱', { exact: true });
    await email.fill(' fixture@example.com ');
    await drawer.getByRole('button', { name: '加入人才库', exact: true }).click();
    const error = drawer.locator('.el-form-item').filter({ has: page.getByLabel('邮箱', { exact: true }) }).locator('.el-form-item__error');
    await expect(error).toHaveText('邮箱不可用', { timeout: 2500 });
    expect(writes[0]?.body.email).toBe('fixture@example.com');
    await expect(email).toHaveValue(' fixture@example.com ');
    await email.fill('another@example.com');
    await expect(error).toHaveCount(0);
  });
}
