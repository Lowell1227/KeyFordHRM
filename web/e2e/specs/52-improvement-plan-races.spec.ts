import { expect, test, type Page } from '@playwright/test';

const envelope = (data: unknown) => ({ code: 0, message: 'success', data, timestamp: Date.now() });
const plan = (id: string, overrides: Record<string, unknown> = {}) => ({
  id, revision: 4, workflowIssue: null, workflowVersion: 3,
  employeeId: `employee-${id}`, employeeName: `虚构员工 ${id}`, employeeNo: `TEST-${id}`, deptName: '测试部',
  cycleId: null, cycleName: null, taskId: null, creatorId: 'manager', creatorName: '虚构上级',
  improvementNeed: `背景 ${id}`, importance: null, improvementGoal: null, targetDate: null, measures: [],
  goals: [{ id: 'g1', name: `目标 ${id}`, description: '每周核对交付', weight: 100 }],
  selfEvaluation: null, managerEvaluation: null, departmentEvaluation: null, finalScore: null,
  status: 'draft', startedAt: null, completedAt: null, currentOwnerId: 'manager',
  allowedActions: ['edit', 'submit_goals'], records: [],
  createdAt: '2026-11-17T00:00:00Z', updatedAt: '2026-11-17T00:00:00Z', ...overrides,
});

function gate() {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  return { pending, release };
}

async function navigate(page: Page, id: string) {
  await page.evaluate(async (destination) => {
    const root = document.getElementById('app') as HTMLElement & {
      __vue_app__: { config: { globalProperties: { $router: { push: (path: string) => Promise<unknown> } } } };
    };
    await root.__vue_app__.config.globalProperties.$router.push(destination);
  }, `/improvement-plans/${id}`);
}

async function settled(page: Page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function setup(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'pip-synthetic-test');
    localStorage.setItem('expiresAt', String(Date.now() + 600_000));
  });
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/me')) return route.fulfill({ json: envelope({ id: 'manager', name: '虚构上级',
      sysRole: 'employee', status: 'active', canViewAll: false, businessCapabilities: { canManageTeam: true } }) });
    if (path.endsWith('/notifications/unread-count')) return route.fulfill({ json: envelope({ count: 0 }) });
    if (path.endsWith('/improvement-plans/eligible-employees')) return route.fulfill({ json: envelope([
      { id: 'test-employee', name: '虚构员工', employeeNo: 'TEST001', deptName: '测试部' },
    ]) });
    if (path.endsWith('/improvement-plans/cycles') || path.endsWith('/departments')) return route.fulfill({ json: envelope([]) });
    if (path.endsWith('/improvement-plans')) return route.fulfill({ json: envelope({ items: [], total: 0 }) });
    if (path.endsWith('/improvement-plans/A')) return route.fulfill({ json: envelope(plan('A')) });
    if (path.endsWith('/improvement-plans/B')) return route.fulfill({ json: envelope(plan('B', { revision: 12 })) });
    return route.fulfill({ json: envelope({}) });
  });
}

for (const status of [200, 403, 503]) {
  test(`late detail A ${status} cannot replace or block B`, async ({ page }) => {
    await setup(page);
    const started = gate();
    const response = gate();
    await page.route('**/api/v1/improvement-plans/A', async (route) => {
      started.release();
      await response.pending;
      await route.fulfill({ status, json: status === 200 ? envelope(plan('A')) : { message: 'A 读取失败' } });
    });
    await page.goto('/improvement-plans/A');
    await started.pending;
    await navigate(page, 'B');
    await expect(page.getByRole('textbox', { name: '改进背景' })).toHaveValue('背景 B');
    const received = page.waitForResponse((item) => item.url().endsWith('/improvement-plans/A'));
    response.release();
    await (await received).finished();
    await settled(page);
    await expect(page.getByRole('textbox', { name: '改进背景' })).toHaveValue('背景 B');
    await expect(page.getByRole('button', { name: '提交目标', exact: true })).toBeEnabled();
    await expect(page.getByTestId('pip-detail-error')).toHaveCount(0);
  });
}

test('B 403 clears loaded A and offers a record-bound retry', async ({ page }) => {
  await setup(page);
  let attempts = 0;
  await page.route('**/api/v1/improvement-plans/B', (route) => {
    attempts += 1;
    return route.fulfill(attempts === 1 ? { status: 403, json: { message: 'forbidden' } }
      : { json: envelope(plan('B')) });
  });
  await page.goto('/improvement-plans/A');
  await expect(page.getByRole('textbox', { name: '改进背景' })).toHaveValue('背景 A');
  await navigate(page, 'B');
  await expect(page.getByRole('textbox', { name: '改进背景' })).toHaveCount(0);
  const error = page.getByTestId('pip-detail-error');
  await expect(error).toContainText('无权查看');
  await error.getByRole('button', { name: '重试' }).click();
  await expect(page.getByRole('textbox', { name: '改进背景' })).toHaveValue('背景 B');
});

for (const returnToA of [false, true]) {
  test(`late target save cannot submit or overwrite ${returnToA ? 'a newer A session' : 'B'}`, async ({ page }) => {
    await setup(page);
    const started = gate();
    const response = gate();
    const submissions: string[] = [];
    let reads = 0;
    await page.route('**/api/v1/improvement-plans/A', async (route) => {
      if (route.request().method() === 'PATCH') {
        started.release();
        await response.pending;
        return route.fulfill({ json: envelope(plan('A', { revision: 5, improvementNeed: '迟到的旧保存' })) });
      }
      reads += 1;
      return route.fulfill({ json: envelope(plan('A', reads > 1 ? { revision: 9, improvementNeed: '重新打开的 A' } : {})) });
    });
    await page.route('**/api/v1/improvement-plans/*/submit-goals', (route) => {
      submissions.push(route.request().url());
      return route.fulfill({ json: envelope(plan('A', { revision: 6 })) });
    });
    await page.goto('/improvement-plans/A');
    await page.getByRole('button', { name: '提交目标', exact: true }).click();
    await started.pending;
    await navigate(page, 'B');
    await expect(page.getByRole('textbox', { name: '改进背景' })).toHaveValue('背景 B');
    if (returnToA) await navigate(page, 'A');
    const expected = returnToA ? '重新打开的 A' : '背景 B';
    await expect(page.getByRole('textbox', { name: '改进背景' })).toHaveValue(expected);
    const received = page.waitForResponse((item) => item.request().method() === 'PATCH');
    response.release();
    await (await received).finished();
    await settled(page);
    expect(submissions).toEqual([]);
    await expect(page.getByRole('textbox', { name: '改进背景' })).toHaveValue(expected);
    await expect(page.getByRole('button', { name: '提交目标', exact: true })).toBeEnabled();
  });
}

test('target submission uses the saved revision and captured record', async ({ page }) => {
  await setup(page);
  const writes: Array<{ method: string; body: unknown }> = [];
  await page.route('**/api/v1/improvement-plans/A**', (route) => {
    const method = route.request().method();
    if (method !== 'GET') writes.push({ method, body: route.request().postDataJSON() });
    return route.fulfill({ json: envelope(plan('A', method === 'GET' ? {} : {
      revision: method === 'PATCH' ? 5 : 6, status: method === 'PATCH' ? 'draft' : 'goal_employee_confirm',
      allowedActions: method === 'PATCH' ? ['edit', 'submit_goals'] : [],
    })) });
  });
  await page.goto('/improvement-plans/A');
  await page.getByRole('button', { name: '提交目标', exact: true }).click();
  await expect(page.getByTestId('business-detail-drawer').getByText('待员工确认目标', { exact: true })).toBeVisible();
  expect(writes).toEqual([
    { method: 'PATCH', body: { improvementNeed: '背景 A', cycleId: null, targetDate: null,
      goals: [{ id: 'g1', name: '目标 A', description: '每周核对交付', weight: 100 }], expectedRevision: 4 } },
    { method: 'POST', body: { expectedRevision: 5 } },
  ]);
});

const mutationCases = [
  { action: 'decide-goals', status: 'goal_hr_review', allowedActions: ['decide_goals'], button: '确认目标' },
  { action: 'save-evaluation', status: 'self_eval', allowedActions: ['evaluate'], button: '保存草稿' },
  { action: 'evaluate', status: 'self_eval', allowedActions: ['evaluate'], button: '提交员工自评' },
  { action: 'decide-final', status: 'vp_review', allowedActions: ['decide_final'], button: '确认结果' },
];

for (const responseStatus of [200, 403]) for (const item of mutationCases) {
  test(`late ${item.action} ${responseStatus} response stays in A and carries expectedRevision`, async ({ page }) => {
    await setup(page);
    const started = gate();
    const response = gate();
    let body: Record<string, unknown> | undefined;
    await page.route('**/api/v1/improvement-plans/A', (route) => route.fulfill({ json: envelope(plan('A', item)) }));
    await page.route(`**/api/v1/improvement-plans/A/${item.action}`, async (route) => {
      body = route.request().postDataJSON();
      started.release();
      await response.pending;
      return route.fulfill(responseStatus === 403 ? { status: 403, json: { message: '无权办理A' } }
        : { json: envelope(plan('A', { revision: 5, status: 'completed', allowedActions: [] })) });
    });
    await page.goto('/improvement-plans/A');
    if (item.status === 'self_eval') {
      await page.getByRole('spinbutton', { name: '目标评分 1' }).fill('80');
      await page.getByRole('textbox', { name: '目标评价 1' }).fill('测试评价');
      await page.getByRole('textbox', { name: '总体评价内容' }).fill('测试总体评价');
    }
    await page.getByRole('button', { name: item.button, exact: true }).click();
    if (item.action.startsWith('decide')) {
      await page.getByRole('dialog', { name: item.button }).getByRole('button', {
        name: item.action === 'decide-goals' ? '确认目标' : '确认结果', exact: true,
      }).click();
    }
    await started.pending;
    await navigate(page, 'B');
    await expect(page.getByRole('textbox', { name: '改进背景' })).toHaveValue('背景 B');
    const received = page.waitForResponse((value) => value.url().endsWith(`/${item.action}`));
    response.release();
    await (await received).finished();
    await settled(page);
    expect(body?.expectedRevision).toBe(4);
    await expect(page.getByRole('textbox', { name: '改进背景' })).toHaveValue('背景 B');
    await expect(page.getByRole('button', { name: '提交目标', exact: true })).toBeEnabled();
    await expect(page.getByTestId('pip-mutation-error')).toHaveCount(0);
    await expect(page.getByText('无权办理A', { exact: true })).toHaveCount(0);
  });
}

test('late goal-decision timeout cannot replace or block B', async ({ page }) => {
  await setup(page);
  const started = gate();
  const response = gate();
  await page.route('**/api/v1/improvement-plans/A', (route) => route.fulfill({ json: envelope(plan('A', {
    workflowVersion: 2, status: 'goal_dept_review', allowedActions: ['decide_goals'],
  })) }));
  await page.route('**/api/v1/improvement-plans/A/decide-goals', async (route) => {
    started.release();
    await response.pending;
    await route.abort('timedout');
  });
  await page.goto('/improvement-plans/A');
  await page.getByRole('button', { name: '确认目标', exact: true }).click();
  await page.getByRole('dialog', { name: '确认目标' }).getByRole('button', { name: '确认目标', exact: true }).click();
  await started.pending;
  await navigate(page, 'B');
  await expect(page.getByRole('textbox', { name: '改进背景' })).toHaveValue('背景 B');
  const failed = page.waitForEvent('requestfailed', (request) => request.url().endsWith('/decide-goals'));
  response.release();
  await failed;
  await settled(page);
  await expect(page.getByRole('textbox', { name: '改进背景' })).toHaveValue('背景 B');
  await expect(page.getByRole('button', { name: '提交目标', exact: true })).toBeEnabled();
  await expect(page.getByTestId('pip-mutation-error')).toHaveCount(0);
});

for (const kind of ['goals', 'evaluation']) {
  test(`another tab revision cannot prove an aborted ${kind} save or overwrite the local draft`, async ({ page, context }) => {
    await setup(page);
    const otherTab = await context.newPage();
    await setup(otherTab);
    const evaluating = kind === 'evaluation';
    let serverPlan = plan('A', evaluating ? { status: 'self_eval', allowedActions: ['evaluate'] } : {});
    let abortedWrites = 0;
    await page.route('**/api/v1/improvement-plans/A**', (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: envelope(serverPlan) });
      abortedWrites += 1;
      expect(route.request().postDataJSON().expectedRevision).toBe(4);
      return route.abort('timedout');
    });
    await otherTab.route('**/api/v1/improvement-plans/A**', (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: envelope(serverPlan) });
      const body = route.request().postDataJSON();
      expect(body.expectedRevision).toBe(4);
      serverPlan = plan('A', evaluating ? {
        status: 'self_eval', revision: 5, allowedActions: ['evaluate'],
        selfEvaluation: { items: body.items, overallComment: body.overallComment, weightedScore: 90, draft: true },
      } : { revision: 5, improvementNeed: body.improvementNeed, goals: body.goals });
      return route.fulfill({ json: envelope(serverPlan) });
    });
    await page.goto('/improvement-plans/A');
    await otherTab.goto('/improvement-plans/A');
    if (evaluating) {
      await page.getByRole('spinbutton', { name: '目标评分 1' }).fill('73');
      await page.getByRole('textbox', { name: '目标评价 1' }).fill('本标签页逐项评价草稿');
      await page.getByRole('textbox', { name: '总体评价内容' }).fill('本标签页总体评价草稿');
      await otherTab.getByRole('spinbutton', { name: '目标评分 1' }).fill('90');
      await otherTab.getByRole('textbox', { name: '目标评价 1' }).fill('另一标签页已保存的逐项评价');
      await otherTab.getByRole('textbox', { name: '总体评价内容' }).fill('另一标签页已保存的总体评价');
    } else {
      await page.getByRole('textbox', { name: '改进背景' }).fill('本标签页改进背景草稿');
      await page.getByRole('textbox', { name: '目标名称 1' }).fill('本标签页目标草稿');
      await page.getByRole('textbox', { name: '目标描述 1' }).fill('本标签页目标描述草稿');
      await otherTab.getByRole('textbox', { name: '改进背景' }).fill('另一标签页已保存的背景');
      await otherTab.getByRole('textbox', { name: '目标名称 1' }).fill('另一标签页已保存的目标');
      await otherTab.getByRole('textbox', { name: '目标描述 1' }).fill('另一标签页已保存的目标描述');
    }
    await otherTab.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(otherTab.getByText(evaluating ? '评价草稿已保存' : '草稿已保存', { exact: true })).toBeVisible();
    expect(serverPlan.revision).toBe(5);
    const save = page.getByRole('button', { name: '保存草稿', exact: true });
    await save.click();
    await expect.poll(() => abortedWrites).toBe(1);
    await expect(save).not.toHaveClass(/is-loading/);
    if (evaluating) {
      await expect(page.getByRole('spinbutton', { name: '目标评分 1' })).toHaveValue('73');
      await expect(page.getByRole('textbox', { name: '目标评价 1' })).toHaveValue('本标签页逐项评价草稿');
      await expect(page.getByRole('textbox', { name: '总体评价内容' })).toHaveValue('本标签页总体评价草稿');
    } else {
      await expect(page.getByRole('textbox', { name: '改进背景' })).toHaveValue('本标签页改进背景草稿');
      await expect(page.getByRole('textbox', { name: '目标名称 1' })).toHaveValue('本标签页目标草稿');
      await expect(page.getByRole('textbox', { name: '目标描述 1' })).toHaveValue('本标签页目标描述草稿');
    }
    const unknown = page.getByTestId('pip-mutation-error');
    await expect(unknown).toContainText('处理结果暂未确认');
    await expect(unknown).toContainText('当前输入已保留');
    await expect(unknown).toHaveClass(/el-alert--warning/);
    await expect(save).toBeDisabled();
    await expect(page.getByRole('button', { name: evaluating ? '提交员工自评' : '提交目标', exact: true })).toBeDisabled();
    await expect(page.locator('.el-message--success')).toHaveCount(0);
    await unknown.getByRole('button', { name: '重新加载' }).click();
    await expect(page.getByRole(evaluating ? 'spinbutton' : 'textbox', { name: evaluating ? '目标评分 1' : '目标名称 1' }))
      .toHaveValue(evaluating ? '90' : '另一标签页已保存的目标');
    await expect(save).toBeEnabled();
    expect(abortedWrites).toBe(1);
    await otherTab.close();
  });
}

test('409 preserves target input and requires explicit reload without overwrite or submission', async ({ page }) => {
  await setup(page);
  let reads = 0;
  let writes = 0;
  await page.route('**/api/v1/improvement-plans/A', (route) => {
    if (route.request().method() === 'PATCH') {
      writes += 1;
      return route.fulfill({ status: 409, json: { message: '改进计划已更新，请重新加载' } });
    }
    reads += 1;
    return route.fulfill({ json: envelope(plan('A', reads > 1 ? { revision: 5, improvementNeed: '他人保存的新版' } : {})) });
  });
  await page.goto('/improvement-plans/A');
  await page.getByRole('textbox', { name: '改进背景' }).fill('不能丢失的本地输入');
  await page.getByRole('button', { name: '提交目标', exact: true }).click();
  const conflict = page.getByTestId('pip-mutation-error');
  await expect(conflict).toContainText('已更新');
  await expect(page.getByRole('textbox', { name: '改进背景' })).toHaveValue('不能丢失的本地输入');
  expect(reads).toBe(1);
  expect(writes).toBe(1);
  await expect(page.getByRole('button', { name: '提交目标', exact: true })).toBeDisabled();
  await conflict.getByRole('button', { name: '重新加载' }).click();
  await expect(page.getByRole('textbox', { name: '改进背景' })).toHaveValue('他人保存的新版');
});

for (const query of ['eligible-employees', 'cycles', 'departments', 'list']) {
  test(`${query} query failure is retryable and not an empty result`, async ({ page }) => {
    await setup(page);
    let attempts = 0;
    const path = query === 'departments' ? 'departments' : query === 'list' ? 'improvement-plans' : `improvement-plans/${query}`;
    await page.route((url) => url.pathname === `/api/v1/${path}`, (route) => {
      attempts += 1;
      return route.fulfill(attempts === 1 ? { status: 503, json: { message: '测试读取失败' } }
        : { json: envelope(query === 'list' ? { items: [], total: 0 } : []) });
    });
    await page.goto('/improvement-plans');
    const error = page.getByTestId(`pip-query-error-${query}`);
    await expect(error).toContainText('失败');
    await expect(page.getByText('暂无可发起改进计划的员工', { exact: true })).toHaveCount(0);
    if (query === 'list') await expect(page.getByText('暂无改进计划', { exact: true })).toHaveCount(0);
    const retried = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/v1/${path}`);
    await error.getByRole('button', { name: '重试' }).click();
    await (await retried).finished();
    await settled(page);
    await expect(error).toHaveCount(0);
    expect(attempts).toBe(2);
    if (query === 'eligible-employees') await expect(page.getByText('暂无可发起改进计划的员工', { exact: true })).toBeVisible();
  });
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
  test(`V3 HR shared owner and stage progression at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await setup(page);
    let approved = false;
    await page.route('**/api/v1/improvement-plans/A**', (route) => {
      if (route.request().method() === 'POST') approved = true;
      return route.fulfill({ json: envelope(plan('A', { status: approved ? 'goal_vp_review' : 'goal_hr_review',
        revision: approved ? 5 : 4, currentOwnerId: null, allowedActions: approved ? [] : ['decide_goals'] })) });
    });
    await page.goto('/improvement-plans/A');
    await expect(page.getByText('当前环节 · HR确认目标', { exact: true })).toBeVisible();
    await expect(page.getByText('HR共享待办', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '确认目标', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '确认目标' });
    await expect(dialog).toContainText('分管领导确认目标');
    await dialog.getByRole('button', { name: '确认目标', exact: true }).click();
    await expect(page.getByText('当前环节 · 分管领导确认目标', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '确认目标', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: test.info().outputPath(`pip-v3-${viewport.width}.png`) });
  });
}

test('mobile PIP overview keeps labels readable at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  let reads = 0;
  await page.route('**/api/v1/improvement-plans/A', (route) => {
    reads += 1;
    return route.fulfill({ json: envelope(plan('A', {
      status: 'goal_hr_review', allowedActions: [], currentOwnerId: null,
      employeeName: '虚构员工（手机布局验证）', employeeNo: 'PIP-MOBILE-001',
      deptName: '虚构交付质量改进部门', creatorName: '虚构直属上级',
      cycleName: '虚构年度绩效改进周期（手机布局验证）', targetDate: '2026-12-31',
    })) });
  });
  await page.goto('/improvement-plans/A');
  const drawer = page.getByTestId('business-detail-drawer');
  await expect.poll(async () => Math.round((await drawer.boundingBox())?.x ?? -1)).toBe(0);
  await page.evaluate(async () => { await document.fonts.ready; });
  const overview = drawer.locator('.plan-info');
  const labels = overview.locator('.el-descriptions__label');
  await expect(labels).toHaveCount(7);
  const metrics = await labels.evaluateAll((items) => items.map((label) => {
    const range = document.createRange();
    range.selectNodeContents(label);
    const lines = new Set(Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => Math.round(rect.top)));
    return { text: label.textContent?.trim(), width: label.getBoundingClientRect().width, lines: lines.size };
  }));
  for (const label of metrics) {
    expect(label.width, `${label.text} label width`).toBeGreaterThanOrEqual(80);
    expect(label.lines, `${label.text} stays on one line`).toBe(1);
  }
  await expect(overview.locator('tbody tr').first().locator('.el-descriptions__label')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: test.info().outputPath('pip-mobile-overview-390.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(overview.locator('tbody tr').first().locator('.el-descriptions__label')).toHaveCount(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(overview.locator('tbody tr').first().locator('.el-descriptions__label')).toHaveCount(1);
  expect(reads).toBe(1);
});

test('V3 workflow issue is explicit and status or system role grants no actions', async ({ page }) => {
  await setup(page);
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: envelope({
    id: 'manager', name: '虚构管理员', sysRole: 'system_admin', status: 'active', canViewAll: true,
  }) }));
  await page.route('**/api/v1/improvement-plans/A', (route) => route.fulfill({ json: envelope(plan('A', {
    status: 'goal_hr_review', currentOwnerId: null, allowedActions: [], workflowIssue: '审批人员缺失，请联系HR核对',
  })) }));
  await page.goto('/improvement-plans/A');
  await expect(page.getByText('审批人员缺失，请联系HR核对', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '确认目标', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '提交目标', exact: true })).toHaveCount(0);
});

test('workflow-issue 409 shows the server reason and retains the decision input', async ({ page }) => {
  await setup(page);
  let reads = 0;
  await page.route('**/api/v1/improvement-plans/A', (route) => {
    reads += 1;
    return route.fulfill({ json: envelope(plan('A', { status: 'goal_hr_review', allowedActions: ['decide_goals'] })) });
  });
  await page.route('**/api/v1/improvement-plans/A/decide-goals', (route) => route.fulfill({
    status: 409, json: { message: '员工已离职，暂不能办理此改进计划' },
  }));
  await page.goto('/improvement-plans/A');
  await page.getByRole('button', { name: '退回修改', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '退回修改' });
  await dialog.getByRole('textbox', { name: '目标退回原因' }).fill('保留这条处理意见');
  await dialog.getByRole('button', { name: '确认退回' }).click();
  await expect(dialog.getByTestId('pip-mutation-error')).toContainText('员工已离职，暂不能办理此改进计划');
  await expect(dialog.getByTestId('pip-mutation-error')).toContainText('当前输入已保留');
  await expect(dialog.getByTestId('pip-mutation-error')).not.toContainText('已更新');
  await expect(dialog.getByRole('textbox', { name: '目标退回原因' })).toHaveValue('保留这条处理意见');
  await expect(dialog.getByRole('button', { name: '确认退回' })).toBeDisabled();
  expect(reads).toBe(1);
});

test('eligible employee permission denial is distinct from an empty eligible list', async ({ page }) => {
  await setup(page);
  let attempts = 0;
  await page.route('**/api/v1/improvement-plans/eligible-employees', (route) => {
    attempts += 1;
    return route.fulfill(attempts === 1 ? { status: 403, json: { message: 'forbidden' } } : { json: envelope([]) });
  });
  await page.goto('/improvement-plans');
  const error = page.getByTestId('pip-query-error-eligible-employees');
  await expect(error).toContainText('无权查询');
  await expect(page.getByText('暂无可发起改进计划的员工', { exact: true })).toHaveCount(0);
  await error.getByRole('button', { name: '重试' }).click();
  await expect(page.getByText('暂无可发起改进计划的员工', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '新建改进计划' })).toHaveCount(0);
});

for (const item of [
  { version: 3, status: 'goal_employee_confirm', next: '部门负责人确认目标' },
  { version: 3, status: 'goal_dept_review', next: 'HR确认目标' },
  { version: 3, status: 'goal_vp_review', next: '员工自评' },
  { version: 2, status: 'goal_dept_review', next: '员工确认' },
  { version: 2, status: 'goal_employee_confirm', next: '员工自评' },
]) {
  test(`V${item.version} ${item.status} describes its own next stage`, async ({ page }) => {
    await setup(page);
    await page.route('**/api/v1/improvement-plans/A', (route) => route.fulfill({ json: envelope(plan('A', {
      workflowVersion: item.version, status: item.status, allowedActions: ['decide_goals'],
    })) }));
    await page.goto('/improvement-plans/A');
    await page.getByRole('button', { name: '确认目标', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '确认目标' })).toContainText(item.next);
  });
}

test('edit permission alone does not grant target submission', async ({ page }) => {
  await setup(page);
  await page.route('**/api/v1/improvement-plans/A', (route) => route.fulfill({ json: envelope(plan('A', { allowedActions: ['edit'] })) }));
  await page.goto('/improvement-plans/A');
  await expect(page.getByRole('button', { name: '保存草稿', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '提交目标', exact: true })).toHaveCount(0);
});
