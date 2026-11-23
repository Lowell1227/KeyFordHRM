import { test, expect, type Page, type Locator } from '@playwright/test';
import path from 'node:path';

const origin = 'http://127.0.0.1:5175';
async function control(op: string, input = {}) {
  const response = await fetch(`http://127.0.0.1:3011/__usability-ui/${op}`, { method: 'POST',
    headers: { 'x-usability-ui-run': process.env.HRM_USABILITY_UI_RUN!, 'content-type': 'application/json' }, body: JSON.stringify(input) });
  const body = await response.json(); expect(response.status, body.message).toBe(200); return body;
}
async function post(page: Page, endpoint: string, act: () => Promise<unknown>) {
  const pending = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith(endpoint));
  await act(); const response = await pending, value = await response.json();
  expect(response.status(), `${endpoint}: ${value.message ?? ''}`).toBe(201); return value.data;
}
async function login(page: Page, f: any, role: string, target: string) {
  const events: Array<{ path: string; status: number }> = [], reloads: string[] = [];
  const record = (response: import('@playwright/test').Response) => { const url = new URL(response.url()); if (url.pathname.startsWith('/api/')) events.push({ path: url.pathname, status: response.status() }); };
  page.on('response', record);
  page.on('websocket', socket => socket.on('framereceived', event => { try { const value = JSON.parse(String(event.payload)); if (value.type === 'full-reload') reloads.push(value.path ?? '*'); } catch {} }));
  await page.goto('/login'); await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(`/login?redirect=${encodeURIComponent(target)}`); await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('preview-login')).toHaveCount(0);
  await page.getByTestId('password-login-toggle').click();
  await page.getByTestId('login-employee-no').fill(f.credentials[role].employeeNo);
  await page.getByTestId('login-password').fill(f.credentials[role].password);
  const response = page.waitForResponse(row => row.request().method() === 'POST' && new URL(row.url()).pathname === '/api/v1/auth/login');
  await page.getByTestId('login-submit').click(); expect((await response).status()).toBe(200);
  try { await expect(page).toHaveURL(new URL(target, origin).href); }
  catch (error) { console.log(JSON.stringify({ diagnostic: 'usability-login', role, events, reloads, session: await page.evaluate(() => ({ tokenPresent: !!localStorage.getItem('token') })) })); throw error; }
  finally { page.off('response', record); }
}
const field = (root: Page | Locator, label: string) => {
  const owner = 'page' in root ? root.page() : root;
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return root.locator('.el-form-item').filter({ has: owner.locator('.el-form-item__label').filter({ hasText: new RegExp(`^${escaped}(?:（[^）]*）)?$`) }) });
};
async function choose(page: Page, form: Locator, label: string, text: string) {
  const select = field(form, label), combo = select.getByRole('combobox');
  if (['适用', '另计'].includes(text) && (await select.locator('.el-select__selected-item').allTextContents()).some(value => value.trim() === text)) {
    await expect(select.locator('.el-select__selected-item').filter({ hasText: text })).toContainText(text); return;
  }
  await select.locator('.el-select__wrapper').click();
  await expect(combo).toHaveAttribute('aria-expanded', 'true');
  const options = page.locator(`[id="${await combo.getAttribute('aria-controls')}"]`); await expect(options).toBeVisible();
  const exact = options.getByRole('option', { name: text, exact: true });
  await (await exact.count() === 1 ? exact : options.getByRole('option').filter({ hasText: text })).click();
  if (label !== '本月发薪人员') await expect(combo).toHaveAttribute('aria-expanded', 'false');
}
async function date(form: Locator, label: string, value: string) {
  const input = field(form, label).locator('input'); await input.fill(value); await input.press('Tab');
}
async function screenshot(page: Page, info: any, stage: string) {
  expect(new URL(page.url()).pathname).not.toBe('/login');
  await expect(page.locator('.el-message-box:visible')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await expect.poll(() => page.locator('.el-drawer:visible,.el-dialog:visible').evaluateAll(elements => elements.every(element => {
    const rect = element.getBoundingClientRect();
    return rect.x >= -1 && rect.right <= innerWidth + 1 && rect.y >= -1 && rect.bottom <= innerHeight + 1
      && element.scrollWidth <= element.clientWidth + 1 && element.getAnimations().every(animation => animation.playState !== 'running')
      && [...element.querySelectorAll('.el-drawer__body,.el-dialog__body')].every(body => body.scrollWidth <= body.clientWidth + 1);
  }))).toBe(true);
  const dialogs = page.locator('[role="dialog"]:visible');
  for (const dialog of await dialogs.all()) {
    const footer = dialog.locator('.el-drawer__footer button:not(:disabled),.el-dialog__footer button:not(:disabled)').filter({ visible: true });
    if (await footer.count()) await footer.last().click({ trial: true });
  }
  console.log(JSON.stringify({ visual: stage, project: info.project.name, bounds: await dialogs.evaluateAll(elements => elements.map(element => {
    const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
  })) }));
  await page.screenshot({ path: path.resolve(`../test-results/payroll-usability-ui/${info.project.name}-${stage}.png`), fullPage: true, animations: 'disabled' });
}
test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
});

test('UI: HR chooses employee/enters salary, actual direct manager returns it, HR resubmits and manager compares/publishes', async ({ page }, info) => {
  const f = await control('create', { scenario: 'review' }), q = `?subjectId=${f.subjectId}&month=${f.month}`;
  await login(page, f, 'hr', `/payroll/standards${q}&tab=standards`);
  async function makeDraft(amount: string, evidence: string) {
    await page.getByRole('button', { name: '新增工资标准', exact: true }).click();
    const form = page.getByRole('dialog', { name: '工资标准草稿', exact: true });
    await choose(page, form, '员工', f.employeeName);
    await date(form, '生效日期', `${f.month}-01`); await date(form, '结束日期', `${f.month}-31`);
    await field(form, '固定月标准').locator('input').fill(amount);
    await choose(page, form, '绩效工资结构', '另计');
    await field(form, '确认依据').locator('textarea').fill(evidence);
    const draft = await post(page, '/payroll/standards', () => form.getByRole('button', { name: '保存草稿', exact: true }).click());
    await expect(page.getByText('草稿已保存，尚未生效', { exact: true })).toBeVisible();
    const release = await post(page, `/parameters/standard/${draft.id}/submit`, () => page.getByRole('alert').filter({ hasText: '草稿已保存' }).getByRole('button', { name: '提交主管审核', exact: true }).click());
    expect(release.reviewerId).toBe(f.users.manager); return release;
  }
  let release = await makeDraft('12000', 'fictional original signed salary evidence');
  await login(page, f, 'manager', `/payroll/parameter-reviews${q}&releaseId=${release.id}`);
  let review = page.getByRole('dialog', { name: '工资资料审核', exact: true });
  await expect(review.getByTestId('payroll-parameter-comparison')).toContainText('10000');
  await expect(review.getByTestId('payroll-parameter-comparison')).toContainText('12000');
  await review.getByRole('button', { name: '退回修改', exact: true }).click();
  await expect(review).toContainText('请填写办理原因');
  await field(review, '办理意见').locator('textarea').fill('fictional HR must correct salary to signed amount');
  await post(page, `/parameter-releases/${release.id}/decide`, () => review.getByRole('button', { name: '退回修改', exact: true }).click());
  await expect(review).toContainText('已退回'); await screenshot(page, info, 'salary-returned');
  await login(page, f, 'hr', `/payroll/standards${q}&tab=standards`);
  release = await makeDraft('11000', 'fictional corrected signed salary evidence');
  await login(page, f, 'manager', `/payroll/parameter-reviews${q}&releaseId=${release.id}`);
  review = page.getByRole('dialog', { name: '工资资料审核', exact: true });
  await expect(review.getByTestId('payroll-parameter-comparison')).toContainText('11000');
  await post(page, `/parameter-releases/${release.id}/decide`, () => review.getByRole('button', { name: '审核并发布', exact: true }).click());
  await expect(review).toContainText('已发布');
  await expect(review.getByTestId('payroll-parameter-comparison')).toContainText('10000');
  await screenshot(page, info, 'salary-published');
  const state = await control('inspect', { subjectId: f.subjectId }); expect(state.frozenUnchanged).toBe(true);
});

test('UI: personal copy locks employee; approved shared rules clear personal facts and batch preview is explicit', async ({ page }, info) => {
  const f = await control('create', { scenario: 'copy' }), q = `?subjectId=${f.subjectId}&month=${f.month}`;
  await login(page, f, 'hr', `/payroll/deductions${q}`);
  await page.getByRole('button', { name: '复制草稿', exact: true }).filter({ visible: true }).first().click();
  let form = page.getByRole('dialog', { name: '复制本员工扣缴草稿', exact: true });
  await expect(form.getByTestId('deduction-copy-employee')).toContainText(f.employeeName);
  expect(await field(form, '员工').getByRole('combobox').count()).toBe(0);
  await screenshot(page, info, 'personal-copy-locked');
  await form.getByRole('button', { name: '关闭', exact: true }).click();
  const abandon = page.getByRole('dialog', { name: /离开|放弃/ });
  if (await abandon.isVisible()) await abandon.getByRole('button', { name: '放弃修改', exact: true }).click();
  await page.getByRole('button', { name: '新增扣缴资料', exact: true }).click();
  form = page.getByRole('dialog', { name: '扣缴资料草稿', exact: true });
  await choose(page, form, '员工', f.employee2Name); await date(form, '目标发薪日', f.payDate);
  await choose(page, form, '套用已批准的公共规则', 'fictional-preview-tax-v1');
  await form.getByRole('button', { name: '套用税表与缴费规则', exact: true }).click();
  await form.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(field(form, '个人社保规则版本').locator('input')).toHaveValue('fictional-preview-contribution-v1');
  await expect(field(form, '个人基数').locator('input').first()).toHaveValue('');
  await form.locator('.el-segmented__item').filter({ hasText: '个税与累计' }).click();
  await expect(field(form, '累计收入').locator('input')).toHaveValue('');
  await expect(form.getByRole('checkbox', { name: '已核对本员工累计期初及其依据', exact: true })).not.toBeChecked();
  await screenshot(page, info, 'shared-rules-personal-cleared');
  await form.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('dialog', { name: /离开|放弃/ }).getByRole('button', { name: '放弃修改', exact: true }).click();
  await page.getByRole('button', { name: '批量准备草稿', exact: true }).click();
  const bulk = page.getByRole('dialog', { name: '批量准备扣缴草稿', exact: true });
  await bulk.getByRole('button', { name: '准备个人草稿', exact: true }).click();
  await expect(bulk).toContainText('请选择目标发薪日');
  await date(bulk, '目标发薪日', '2025-11-11'); await choose(page, bulk, '本月发薪人员', f.employee2Name);
  await bulk.getByRole('heading', { name: '批量准备扣缴草稿', exact: true }).click();
  await bulk.getByRole('button', { name: '准备个人草稿', exact: true }).click();
  await expect(bulk).toContainText('个人');
  await bulk.getByRole('button', { name: '校验并预览', exact: true }).click();
  await expect(bulk).toContainText('尚未保存'); await expect(bulk.getByRole('button', { name: '逐条保存草稿', exact: true })).toBeDisabled();
  await screenshot(page, info, 'bulk-explicit-incomplete-preview');
  await bulk.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('dialog', { name: '离开批量准备', exact: true }).getByRole('button', { name: '放弃修改', exact: true }).click();
  await page.getByRole('button', { name: '批量准备草稿', exact: true }).click();
  await date(bulk, '目标发薪日', '2025-11-12');
  for (const name of [f.employeeName, f.employee2Name]) { await choose(page, bulk, '本月发薪人员', name); await bulk.getByRole('heading', { name: '批量准备扣缴草稿', exact: true }).click(); }
  await choose(page, bulk, '已批准公共规则（可选）', 'fictional-preview-tax-v1');
  await field(bulk, '本次规则确认依据').locator('input').fill('fictional rule verification for each employee');
  await date(bulk, '社保缴费归属日', `${f.month}-31`); await date(bulk, '公积金缴费归属日', `${f.month}-31`); await date(bulk, '台账基准日', '2025-01-01');
  await bulk.getByRole('button', { name: '准备个人草稿', exact: true }).click();
  for (let index = 0; index < 2; index++) {
    await bulk.getByRole('button', { name: /逐人补齐资料|填写个人资料/ }).filter({ visible: true }).nth(index).click();
    const person = page.getByRole('dialog').filter({ visible: true }).last();
    for (const label of ['个人社保适用性', '个人公积金适用性']) await choose(page, person, label, '适用');
    for (const input of await field(person, '个人基数').locator('input').all()) await input.fill('1000');
    await person.locator('.el-segmented__item').filter({ hasText: '个税与累计' }).click();
    await field(person, '累计来源版本').locator('input').fill(`fictional-person-${index}-opening`);
    await field(person, '累计期初依据').locator('input').fill(`fictional-person-${index}-signed-opening`);
    for (const label of ['累计收入', '累计已扣个税', '累计免税收入', '累计减除费用', '累计专项扣除', '累计专项附加扣除', '累计其他依法扣除', '累计减免税额']) await field(person, label).locator('input').fill('0');
    await person.getByText('已核对本员工累计期初及其依据', { exact: true }).click();
    await person.getByRole('button', { name: '累计台账接管', exact: true }).click();
    for (const label of ['接管前外部已扣个人社保', '接管前外部已扣个人公积金', '基准月既有免税收入', '基准月既有减除费用', '基准月既有专项扣除', '基准月既有专项附加扣除', '基准月既有其他依法扣除', '基准月既有减免税额']) await field(person, label).locator('input').fill('0');
    await person.getByRole('button', { name: '本月累计扣除额度', exact: true }).click();
    for (const label of ['本月累计免税收入', '本月累计减除费用', '本月累计专项扣除', '本月累计专项附加扣除', '本月累计其他依法扣除', '本月累计减免税额']) await field(person, label).locator('input').fill('0');
    await person.getByRole('button', { name: '应用到本次草稿', exact: true }).click();
  }
  await bulk.getByRole('button', { name: '校验并预览', exact: true }).click();
  await expect(bulk).toContainText('2人资料校验通过');
  let saves = 0;
  // Delay only the second real request to make a genuine audited revocation deterministic; do not mock responses.
  await page.route('**/api/v1/payroll/deduction-profiles', async route => {
    if (route.request().method() === 'POST' && ++saves === 2) await control('revoke-editor', { subjectId: f.subjectId });
    await route.continue();
  });
  await bulk.getByRole('button', { name: '逐条保存草稿', exact: true }).click();
  await expect(bulk).toContainText('已保存草稿'); await expect(bulk).toContainText('保存失败');
  await screenshot(page, info, 'bulk-partial-real-response');
  await control('restore-editor', { subjectId: f.subjectId });
  await bulk.getByRole('button', { name: '返回列表核对', exact: true }).click();
  await page.reload();
  await expect(page.getByText(/^(?:发薪日：)?2025-11-12$/).filter({ visible: true })).toBeVisible();
  const saved = await control('inspect', { subjectId: f.subjectId });
  expect(saved.profiles.filter((row: any) => row.payDate.startsWith('2025-11-12') && row.status === 'draft')).toHaveLength(1);
});

test('UI: absence editor proposes evidence, sealer checks and creates a new version', async ({ page }, info) => {
  const f = await control('create', { scenario: 'absence' }), q = `?subjectId=${f.subjectId}&month=${f.month}`;
  await login(page, f, 'hr', `/payroll/attendance${q}`);
  await page.getByRole('button', { name: '日明细', exact: true }).filter({ visible: true }).first().click();
  let day = page.getByRole('dialog').filter({ hasText: '缺勤' }).filter({ visible: true });
  await day.getByRole('button', { name: '提出缺勤核定', exact: true }).click();
  await expect(day).toContainText('请填写已核定缺勤的依据');
  await field(day, '缺勤核定依据').locator('textarea,input').fill('fictional schedule and verified absence evidence');
  await post(page, `/attendance/${f.absenceId}/absence`, () => day.getByRole('button', { name: '提出缺勤核定', exact: true }).click());
  await expect(day).toContainText('待封账'); await screenshot(page, info, 'absence-proposed');
  await login(page, f, 'sealer', `/payroll/attendance${q}`);
  await page.getByRole('button', { name: '日明细', exact: true }).filter({ visible: true }).first().click();
  day = page.getByRole('dialog').filter({ hasText: '缺勤' }).filter({ visible: true });
  const detail = await page.request.get(`/api/v1/payroll/attendance/${f.absenceId}/absence`, { headers: { Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('token'))}` } });
  const proposal = (await detail.json()).data.review.find((row: any) => row.kind === 'absence_proposed');
  await day.getByRole('button', { name: '通过核定', exact: true }).click();
  await post(page, `/absence/${proposal.id}/decide`, () => page.getByRole('dialog', { name: '通过缺勤核定', exact: true }).getByRole('button', { name: '通过核定', exact: true }).click());
  await expect(day).toContainText('已通过缺勤核定'); await screenshot(page, info, 'absence-confirmed');
  let state = await control('inspect', { subjectId: f.subjectId }); expect(state.attendance).toHaveLength(3); expect(state.frozenUnchanged).toBe(true);
  const acceptedId = state.attendance.at(-1).id;
  await field(day, '核对说明').locator('textarea').fill('fictional sealer checked complete attendance');
  await post(page, `/attendance/${acceptedId}/review`, () => day.getByRole('button', { name: '保存核对说明', exact: true }).click());
  await day.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '封账当前版本', exact: true }).click();
  await post(page, `/attendance/${acceptedId}/seal`, () => page.getByRole('dialog', { name: '考勤封账', exact: true }).getByRole('button', { name: '封账', exact: true }).click());
  await screenshot(page, info, 'absence-sealed');
  const resynced = await control('resync-confirmed', { subjectId: f.subjectId });
  await page.reload();
  await page.getByRole('button', { name: '日明细', exact: true }).filter({ visible: true }).first().click();
  day = page.getByRole('dialog', { name: `${f.employeeName} · ${f.workDate}`, exact: true });
  await field(day, '撤销原因').locator('input').fill('fictional later evidence corrected after resync');
  await day.getByRole('button', { name: '撤销核定', exact: true }).click();
  const revoked = await post(page, `/attendance/${resynced.id}/absence/${proposal.id}/decide`, () => page.getByRole('dialog', { name: '撤销缺勤核定', exact: true }).getByRole('button', { name: '撤销核定', exact: true }).click());
  await expect(day).not.toContainText('已通过缺勤核定'); await screenshot(page, info, 'absence-revoked-after-resync');
  await field(day, '缺勤核定依据').locator('textarea').fill('fictional rechecked absence before scope recovery');
  const proposed = await post(page, `/attendance/${revoked.id}/absence`, () => day.getByRole('button', { name: '提出缺勤核定', exact: true }).click());
  const proposal2 = proposed.review.filter((row: any) => row.kind === 'absence_proposed').at(-1);
  await day.getByRole('button', { name: '通过核定', exact: true }).click();
  const approvedAgain = await post(page, `/attendance/${revoked.id}/absence/${proposal2.id}/decide`, () => page.getByRole('dialog', { name: '通过缺勤核定', exact: true }).getByRole('button', { name: '通过核定', exact: true }).click());
  await day.getByRole('button', { name: '关闭', exact: true }).click();
  await control('expand-scope', { subjectId: f.subjectId }); await page.reload();
  await page.getByRole('button', { name: '核对范围变化', exact: true }).click();
  const recovery = page.getByRole('dialog', { name: '核对发薪范围变化', exact: true });
  await field(recovery, '范围变化依据').locator('textarea').fill('fictional retained-day scope recovery');
  const recovered = await post(page, `/attendance/${approvedAgain.id}/recover-scope`, () => recovery.getByRole('button', { name: '确认范围并生成新版本', exact: true }).click());
  const employee = page.getByRole('combobox', { name: '员工', exact: true });
  await employee.focus(); await employee.press('Enter'); await expect(employee).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('option').filter({ hasText: f.employeeName }).click();
  await page.getByRole('button', { name: '日明细', exact: true }).filter({ visible: true }).first().click();
  await expect(day).toContainText('已通过缺勤核定');
  await field(day, '撤销原因').locator('input').fill('fictional revoke retained fact after scope recovery');
  await day.getByRole('button', { name: '撤销核定', exact: true }).click();
  await post(page, `/attendance/${recovered.id}/absence/${proposal2.id}/decide`, () => page.getByRole('dialog', { name: '撤销缺勤核定', exact: true }).getByRole('button', { name: '撤销核定', exact: true }).click());
  await expect(day).not.toContainText('已通过缺勤核定'); await screenshot(page, info, 'absence-revoked-after-scope-recovery');
  state = await control('inspect', { subjectId: f.subjectId }); expect(state.frozenUnchanged).toBe(true);
});

test('UI: scope difference recovery and opening correction display old/new audit', async ({ page }, info) => {
  const f = await control('create', { scenario: 'recovery' }), q = `?subjectId=${f.subjectId}&month=${f.month}`;
  await login(page, f, 'sealer', `/payroll/attendance${q}`);
  await page.getByRole('button', { name: '核对范围变化', exact: true }).click();
  const difference = page.getByRole('dialog').filter({ hasText: f.employee2Name }).filter({ visible: true });
  await expect(difference).toContainText(f.employee2Name);
  await difference.locator('textarea').fill('fictional reviewed scope update evidence');
  await post(page, `/attendance/${f.attendanceId}/recover-scope`, () => difference.getByRole('button', { name: '确认范围并生成新版本', exact: true }).click());
  await screenshot(page, info, 'range-recovered');
  await page.goto(`/payroll/results${q}`);
  await page.getByRole('button', { name: /历史已付|期初确认/ }).click();
  await page.locator('.ledger-record').filter({ hasText: '固定工资' }).getByRole('button', { name: '更正 / 历史', exact: true }).click();
  const correction = page.getByRole('dialog', { name: '历史已付登记更正', exact: true });
  await field(correction, '更正后历史已付金额').locator('input').fill('25');
  await field(correction, '更正确认凭证').locator('input').fill('fictional corrected receipt');
  await field(correction, '更正原因').locator('textarea').fill('fictional data entry correction');
  await post(page, `/openings/${f.openingId}/correct`, () => correction.getByRole('button', { name: '保存登记更正', exact: true }).click());
  await expect(correction).toContainText('原值：0.00'); await expect(correction).toContainText('新值：25.00');
  await expect(correction.getByRole('button', { name: '关闭', exact: true })).toBeEnabled();
  const token = await page.evaluate(() => localStorage.getItem('token'));
  const historyResponse = await page.request.get(`/api/v1/payroll/openings/${f.openingId}/history`, { headers: { Authorization: `Bearer ${token}` } });
  expect(historyResponse.status()).toBe(200);
  const history = (await historyResponse.json()).data;
  const expectedTime = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(history.versions[0].createdAt));
  await expect(correction.locator('.opening-version')).toContainText(expectedTime);
  await screenshot(page, info, 'opening-correction-audit');
  const state = await control('inspect', { subjectId: f.subjectId }); expect(state.frozenUnchanged).toBe(true); expect(state.attendanceHistoryUnchanged).toBe(true);
});
