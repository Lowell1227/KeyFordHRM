import { test, expect, type Page } from '@playwright/test';

type Kind = 'work_location' | 'job_family';
type Row = { id: string; kind: Kind; name: string; isActive: boolean; createdAt: string; updatedAt: string };
const row = (id: string, name: string, isActive = true, kind: Kind = 'work_location'): Row => ({
  id, kind, name, isActive, createdAt: '2026-10-30T00:00:00Z', updatedAt: '2026-10-30T00:00:00Z',
});
const response = (data: unknown) => ({ code: 0, data, message: 'success', timestamp: Date.now() });

async function setup(page: Page, options: {
  panel?: boolean; kind?: Kind; value?: string; disabled?: boolean;
  sysRole?: string; capabilities?: string[]; rows?: Row[]; failGet?: boolean;
} = {}) {
  const state = {
    rows: options.rows ?? [row('hz', '杭州'), row('old', '停用地点', false)],
    gets: 0, writes: [] as { method: string; body: Record<string, unknown> }[],
    failGet: options.failGet ?? false, failSave: false, saveDelay: 0,
  };
  await page.route('**/api/v1/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.pathname.includes('/personnel-reference-data/')) {
      await route.fulfill({ json: response([]) });
      return;
    }
    const kind = url.pathname.split('/personnel-reference-data/')[1]!.split('/')[0] as Kind;
    if (request.method() === 'GET') {
      state.gets++;
      expect(url.searchParams.get('includeInactive')).toBe('true');
      await route.fulfill(state.failGet ? { status: 503, json: { message: '暂时无法读取' } }
        : { json: response(state.rows.filter(item => item.kind === kind)) });
      return;
    }
    const body = request.postDataJSON();
    state.writes.push({ method: request.method(), body });
    if (state.saveDelay) await new Promise(resolve => setTimeout(resolve, state.saveDelay));
    if (state.failSave) {
      await route.fulfill({ status: 503, json: { message: '暂时无法保存，请重试' } });
      return;
    }
    let result: Row;
    if (request.method() === 'POST') {
      const existing = state.rows.find(item => item.kind === kind && item.name === body.name);
      if (existing) { await route.fulfill({ status: 409, json: { message: '该名称已存在' } }); return; }
      result = row(`new-${state.writes.length}`, body.name, true, kind);
      state.rows.push(result);
    } else {
      const id = url.pathname.split('/').at(-1);
      const index = state.rows.findIndex(item => item.id === id);
      result = { ...state.rows[index]!, ...body };
      state.rows[index] = result;
    }
    await route.fulfill({ json: response(result) });
  });
  const harness = { kind: 'work_location', value: '', sysRole: 'hr_user', capabilities: ['employee_archive_edit'], ...options };
  await page.route('**/__personnel-reference-test', route => route.fulfill({ contentType: 'text/html', body: `
    <!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
    <body><div id="app"></div><script type="module">
    import { createApp, h, ref } from '/node_modules/.vite/deps/vue.js';
    import { createPinia } from '/node_modules/.vite/deps/pinia.js';
    import ElementPlus from '/node_modules/.vite/deps/element-plus.js';
    import '/node_modules/element-plus/dist/index.css';
    import '/src/styles/theme.css';
    import { useAuthStore } from '/src/stores/auth.store.ts';
    const options = ${JSON.stringify(harness)};
    const pinia = createPinia();
    useAuthStore(pinia).user = { id: 'synthetic-user', sysRole: options.sysRole, hrCapabilities: options.capabilities };
    window.__changes = [];
    try {
      const { default: Component } = await import(options.panel
        ? '/src/views/admin/PersonnelReferenceManageView.vue'
        : '/src/components/common/PersonnelReferenceSelect.vue');
      createApp({ setup() {
        const value = ref(options.value);
        return () => h('main', { style: options.panel ? 'height:calc(100dvh - 32px);padding:16px;box-sizing:border-box' : 'max-width:520px;padding:16px' }, [
          !options.panel && h('textarea', { 'aria-label': '备注草稿', value: '尚未提交的备注' }),
          h(Component, { kind: options.kind, compact: true, modelValue: value.value, disabled: options.disabled,
            'onUpdate:modelValue': next => { value.value = next; window.__changes.push(next); } }),
          !options.panel && h('output', { 'data-testid': 'selected-value' }, value.value),
        ]);
      } }).use(pinia).use(ElementPlus).mount('#app');
    } catch { document.querySelector('#app').textContent = '人员基础资料组件尚未实现'; }
    </script></body></html>` }));
  await page.goto('/__personnel-reference-test');
  return state;
}

for (const width of [1440, 1024, 390, 320]) {
  test(`directory create rename and disable preserves filters at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width <= 390 ? 844 : width === 1024 ? 768 : 900 });
    const state = await setup(page, { panel: true });
    await page.getByRole('button', { name: '新增工作地点', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: '工作地点名称', exact: true }).fill('  上海项目服务与运营管理中心（跨区域业务办公地点长名称验收）  ');
    await dialog.getByRole('button', { name: '保存工作地点', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await page.getByRole('textbox', { name: '搜索工作地点名称' }).fill('上海');
    const record = page.locator(width <= 390 ? '.mobile-result-card' : '.el-table__row').filter({ hasText: '上海项目' });
    await expect(record).toBeVisible();
    await record.getByRole('button', { name: '修改名称', exact: true }).click();
    await dialog.getByRole('textbox', { name: '工作地点名称', exact: true }).fill('上海长名称更新后的项目服务中心');
    await dialog.getByRole('button', { name: '保存工作地点', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '搜索工作地点名称' })).toHaveValue('上海');
    const renamed = page.locator(width <= 390 ? '.mobile-result-card' : '.el-table__row').filter({ hasText: '上海长名称更新后的项目服务中心' });
    await renamed.getByRole('button', { name: '停用', exact: true }).click();
    await expect(page.getByText('已有任职和岗位的原值仍保留', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: '停用工作地点', exact: true }).click();
    await expect(renamed.getByText('停用', { exact: true }).first()).toBeVisible();
    expect(state.writes).toHaveLength(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await expect(page.getByTestId('business-list-page')).toHaveCount(1);
    await expect(page.locator('.el-message-box')).not.toBeVisible();
    await expect(page.locator('.el-message')).toHaveCount(0);
    await page.screenshot({ path: `../tmp/personnel-basic-data-20261030/directory-${width}.png`, fullPage: true });
  });
}

test('selector preserves a legacy value and creates nearby without losing the form', async ({ page }) => {
  const state = await setup(page, { value: '原始地点（未维护）' });
  await expect(page.getByTestId('selected-value')).toHaveText('原始地点（未维护）');
  await page.getByRole('combobox').click();
  await expect(page.getByRole('option', { name: '原始地点（未维护）', exact: false })).toBeVisible();
  await page.getByRole('button', { name: '新增工作地点', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '保存并选用', exact: true }).click();
  await expect(dialog.locator('.el-form-item__error')).toContainText('1–100');
  await dialog.getByRole('textbox', { name: '工作地点名称', exact: true }).fill('  苏州  ');
  await dialog.getByRole('button', { name: '保存并选用', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByTestId('selected-value')).toHaveText('苏州');
  await expect(page.getByRole('textbox', { name: '备注草稿' })).toHaveValue('尚未提交的备注');
  expect(state.writes[0]!.body).toEqual({ name: '苏州' });
  await page.getByRole('combobox').click();
  await expect(page.getByRole('link', { name: '管理工作地点' })).toHaveAttribute('href', '/basic-data?tab=work-locations');
  await expect(page.getByRole('link', { name: '管理工作地点' })).toHaveAttribute('target', '_blank');
});

test('same active name selects without a write; inactive name remains an inline error', async ({ page }) => {
  const state = await setup(page);
  await page.getByRole('combobox').click();
  await page.getByRole('button', { name: '新增工作地点', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: '工作地点名称', exact: true }).fill(' 杭州 ');
  await dialog.getByRole('button', { name: '保存并选用', exact: true }).click();
  await expect(page.getByTestId('selected-value')).toHaveText('杭州');
  expect(state.writes).toHaveLength(0);
  await page.getByRole('combobox').click();
  await page.getByRole('button', { name: '新增工作地点', exact: true }).click();
  await dialog.getByRole('textbox', { name: '工作地点名称', exact: true }).fill('停用地点');
  await dialog.getByRole('button', { name: '保存并选用', exact: true }).click();
  await expect(dialog.locator('.el-form-item__error')).toContainText('已停用');
  await expect(dialog.getByRole('textbox', { name: '工作地点名称', exact: true })).toHaveValue('停用地点');
  expect(state.writes).toHaveLength(0);
});

test('save failure retains input for retry and saving prevents close and duplicate writes', async ({ page }) => {
  const state = await setup(page);
  await page.getByRole('combobox').click();
  await page.getByRole('button', { name: '新增工作地点', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: '工作地点名称', exact: true }).fill('南京');
  state.failSave = true;
  await dialog.getByRole('button', { name: '保存并选用', exact: true }).click();
  await expect(dialog.locator('.el-form-item__error')).toContainText('重试');
  await expect(dialog.getByRole('textbox', { name: '工作地点名称', exact: true })).toHaveValue('南京');
  state.failSave = false; state.saveDelay = 500;
  await dialog.getByRole('button', { name: '保存并选用', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('selected-value')).toHaveText('南京');
  expect(state.writes).toHaveLength(2);
});

test('opening and returning refresh options without emitting a value change', async ({ page }) => {
  const state = await setup(page, { value: '停用地点' });
  await expect.poll(() => state.gets).toBeGreaterThan(0);
  state.rows.push(row('new-external', '从管理页新增的地点'));
  await page.getByRole('combobox').click();
  await expect(page.getByRole('option', { name: '从管理页新增的地点', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: '停用地点', exact: false })).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Escape');
  const before = state.gets;
  state.rows = state.rows.map(item => item.id === 'hz' ? { ...item, name: '改名后的杭州' } : item);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => state.gets).toBeGreaterThan(before);
  await expect(page.getByTestId('selected-value')).toHaveText('停用地点');
  expect(await page.evaluate(() => (window as any).__changes)).toEqual([]);
});

test('failed loading keeps the legacy value and provides retry', async ({ page }) => {
  const state = await setup(page, { value: '保留原值' });
  await expect.poll(() => state.gets).toBeGreaterThan(0);
  state.failGet = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('alert')).toContainText('加载失败');
  await expect(page.getByTestId('selected-value')).toHaveText('保留原值');
  state.failGet = false;
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByRole('alert')).not.toBeVisible();
});

for (const role of [
  { name: 'review HR', sysRole: 'hr_user', capabilities: ['employee_archive_review'], readable: true },
  { name: 'organization HR for job families', sysRole: 'hr_user', capabilities: ['organization_edit'], kind: 'job_family' as Kind, readable: true },
  { name: 'organization HR for locations', sysRole: 'hr_user', capabilities: ['organization_edit'], readable: false },
  { name: 'employee with forged capabilities', sysRole: 'employee', capabilities: ['employee_archive_edit', 'organization_edit'], readable: false },
]) {
  test(`${role.name} does not receive directory writes`, async ({ page }) => {
    const state = await setup(page, { panel: true, ...role });
    await expect(page.getByRole('button', { name: /新增工作地点|新增职系/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '修改名称', exact: true })).toHaveCount(0);
    if (role.readable) await expect.poll(() => state.gets).toBeGreaterThan(0);
    else { await expect(page.getByText('暂无查看此资料的权限')).toBeVisible(); expect(state.gets).toBe(0); }
  });
}

test('disabled selector has no write or management entry', async ({ page }) => {
  await setup(page, { value: '杭州', disabled: true });
  await expect(page.getByRole('combobox')).toBeDisabled();
  await expect(page.getByRole('button', { name: '新增工作地点', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '管理工作地点' })).toHaveCount(0);
});

test('job family uses the same nearby flow and keeps a 100 character name', async ({ page }) => {
  const state = await setup(page, { kind: 'job_family', rows: [] });
  await page.getByRole('combobox').click();
  await expect(page.getByText('暂无启用职系', { exact: false }).first()).toBeVisible();
  await page.getByRole('button', { name: '新增职系', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const name = '跨'.repeat(100);
  await dialog.getByRole('textbox', { name: '职系名称', exact: true }).fill(name);
  await dialog.getByRole('button', { name: '保存并选用', exact: true }).click();
  await expect(page.getByTestId('selected-value')).toHaveText(name);
  expect(state.rows[0]?.kind).toBe('job_family');
});

test('concurrent same-name create reuses the active result', async ({ page }) => {
  const state = await setup(page);
  await page.getByRole('combobox').click();
  await page.getByRole('button', { name: '新增工作地点', exact: true }).click();
  state.rows.push(row('concurrent', '并发新增地点'));
  await page.getByRole('dialog').getByRole('textbox', { name: '工作地点名称', exact: true }).fill('并发新增地点');
  await page.getByRole('button', { name: '保存并选用', exact: true }).click();
  await expect(page.getByTestId('selected-value')).toHaveText('并发新增地点');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(state.writes).toHaveLength(1);
  expect(state.rows.filter(item => item.name === '并发新增地点')).toHaveLength(1);
});

test('keyboard selection and clearing emit string snapshots', async ({ page }) => {
  await setup(page);
  const select = page.getByRole('combobox');
  await select.click();
  await select.press('ArrowDown');
  await select.press('Enter');
  await expect(page.getByTestId('selected-value')).toHaveText('杭州');
  await page.locator('.el-select').hover();
  await page.locator('.el-select__clear').click();
  await expect(page.getByTestId('selected-value')).toHaveText('');
  expect(await page.evaluate(() => (window as any).__changes)).toEqual(['杭州', '']);
});

test('directory status and pagination filter the same data; failures keep edited text', async ({ page }) => {
  const state = await setup(page, { panel: true, rows: Array.from({ length: 25 }, (_, index) => row(`r-${index}`, `地点${String(index).padStart(2, '0')}`, index !== 24)) });
  await expect(page.locator('.el-table__row')).toHaveCount(20);
  await page.getByRole('button', { name: 'Go to next page', exact: true }).click();
  await expect(page.locator('.el-table__row')).toHaveCount(5);
  await page.locator('.personnel-reference-panel__status').click();
  await page.getByRole('option', { name: '停用', exact: true }).click();
  await expect(page.locator('.el-table__row')).toHaveCount(1);
  await expect(page.locator('.el-table__row')).toContainText('地点24');
  await page.getByRole('button', { name: '重置', exact: true }).click();
  await page.locator('.el-table__row').filter({ hasText: '地点00' }).getByRole('button', { name: '修改名称', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: '工作地点名称', exact: true }).fill('地点01');
  await dialog.getByRole('button', { name: '保存工作地点', exact: true }).click();
  await expect(dialog.locator('.el-form-item__error')).toContainText('已存在');
  expect(state.writes).toHaveLength(0);
  await dialog.getByRole('textbox', { name: '工作地点名称', exact: true }).fill('修改输入保留');
  state.failSave = true;
  await dialog.getByRole('button', { name: '保存工作地点', exact: true }).click();
  await expect(dialog.locator('.el-form-item__error')).toContainText('输入已保留');
  await expect(dialog.getByRole('textbox', { name: '工作地点名称', exact: true })).toHaveValue('修改输入保留');
});

test('mobile nearby dialog and long selected value remain inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  const legacy = '原有的超长工作地点名称'.repeat(8);
  await setup(page, { value: legacy });
  await page.getByRole('combobox').click();
  const option = page.getByRole('option', { name: legacy, exact: false });
  await expect(option).toBeVisible();
  await expect.poll(async () => {
    const box = await option.boundingBox();
    return box && box.height > 34 && box.x >= 0 && box.x + box.width <= 320;
  }).toBeTruthy();
  await page.getByRole('button', { name: '新增工作地点', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '保存并选用', exact: true }).click();
  await expect(dialog.locator('.el-form-item__error')).toBeVisible();
  await expect.poll(async () => {
    const box = await dialog.boundingBox();
    return box && box.x >= 0 && box.x + box.width <= 320;
  }).toBeTruthy();
  await page.screenshot({ path: '../tmp/personnel-basic-data-20261030/selector-320.png', fullPage: true });
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '备注草稿' })).toHaveValue('尚未提交的备注');
});

test('directory failed read retries with the current search retained', async ({ page }) => {
  const state = await setup(page, { panel: true, failGet: true });
  await expect(page.getByRole('alert')).toContainText('加载失败');
  await page.getByRole('textbox', { name: '搜索工作地点名称' }).fill('杭州');
  state.failGet = false;
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByRole('alert')).not.toBeVisible();
  await expect(page.getByRole('textbox', { name: '搜索工作地点名称' })).toHaveValue('杭州');
  await expect(page.locator('.el-table__row')).toHaveCount(1);
  await expect(page.locator('.el-table__row')).toContainText('杭州');
});
