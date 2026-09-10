import { test, expect, type Page } from '@playwright/test';

const taskId = '11111111-1111-4111-8111-111111111111';
const cycleId = '22222222-2222-4222-8222-222222222222';
const appealId = '33333333-3333-4333-8333-333333333333';
const time = '2026-09-09T08:00:00.000Z';
const wrap = (data: unknown) => JSON.stringify({ code: 0, message: 'success', data });

async function setup(page: Page, role: 'employee' | 'hr' | 'manager', approved = true, published = false) {
  let confirmed = false;
  let appealed = role === 'manager';
  let candidatesRead = 0;
  const writes: Array<{ path: string; body: unknown }> = [];
  const signatureRequests: string[] = [];
  const cycle = { id: cycleId, name: '确认与申诉回归周期', status: 'approval', workflowVersion: 2, publishVisibleFields: { totalScore: true, grade: true, indicatorScores: true, managerComment: true } };
  const records = [{ id: 'appeal-flow', nodeType: 'appeal', action: 'reject', actorName: role === 'hr' ? '虚拟HR' : '虚拟员工', createdAt: time, comment: '员工线下反馈，需核实周期评定依据。', extraData: {type:'prepublication_appeal',source:role === 'hr' ? 'hr' : 'employee'} }];
  const task = () => ({
    id: taskId, cycleId, cycleName: cycle.name, employeeId: 'employee-1', employeeName: '虚拟员工', employeeNo: 'QA_EMP', deptName: '测试部门', position: '专员', managerId: 'manager-1', managerName: '虚拟上级', deptHeadId: 'head-1', approverId: 'approver-1',
    status: appealed ? 'manager_scoring' : confirmed ? 'confirmed' : published ? 'published' : 'approval', isExempt: false, workflowVersion: 2,
    approvedAt: approved && !appealed ? time : null, publishedAt: published ? time : null, employeeConfirmedAt: confirmed && !appealed ? time : null,
    periods: [{ id: 'period-1', periodKey: '2026-09', periodType: 'month', sequence: 1, status: 'completed', employeeSubmittedAt: time, managerSubmittedAt: time, managerScoreTotal: 86, lockedAt: time }],
    gradeResult: { calculatedScore: approved ? 86 : null, rawGrade: approved ? 'B' : null, calibratedGrade: null, isPublished: published, employeeConfirmedAt: confirmed ? time : null },
    performanceInterview: published ? { id: 'interview-1', taskId, status: 'filled', method: 'one_on_one', achievements: '已沟通本周期交付及改进措施', managerSignedAt: null, employeeSignedAt: null } : null,
    managerEvalSummary: { strengths: '稳定完成本周期交付', improvements: '', developmentPlan: '' }, indicatorInstances: [], flowRecords: appealed ? records : [],
    workflowContext: { stage: 'result', statusLabel: appealed ? '待直属上级重新评定' : confirmed ? '已确认，待公示' : approved ? '待员工确认' : '结果审批中', currentHandler: null, canRemind: false },
  });
  const appeal = () => ({ id: appealId, taskId, cycleId, status: 'pending', reason: records[0].comment, workflowType: 'prepublication', taskStatus: 'manager_scoring', approvedAt: null, employeeConfirmedAt: null, publishedAt: null, canResolve: false, finalResult: null, hrResolution: null, createdAt: time, hrResolvedAt: null, appellant: { id: 'employee-1', name: '虚拟员工' }, dept: { id: 'dept-1', name: '测试部门' }, cycle: { id: cycleId, name: cycle.name }, originalResult: { calculatedScore: 86, rawGrade: 'B', calibratedGrade: null }, attachments: [], taskGrade: { calculatedScore: 86, rawGrade: 'B', calibratedGrade: null }, flowRecords: records });
  await page.addInitScript(() => { localStorage.setItem('token', 'isolated-confirmation-contract'); localStorage.setItem('expiresAt', String(Date.now() + 3600_000)); });
  await page.route('**/api/v1/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (path.includes('/signatures') || path.endsWith('-sign')) signatureRequests.push(path);
    let data: unknown = {};
    if (request.method() !== 'GET') writes.push({ path, body: request.postDataJSON() });
    if (path.endsWith('/auth/me')) data = { id: role === 'hr' ? 'hr-1' : role === 'manager' ? 'manager-1' : 'employee-1', name: role === 'hr' ? '虚拟HR' : role === 'manager' ? '虚拟上级' : '虚拟员工', sysRole: role === 'manager' ? 'employee' : role, canViewAll: role === 'hr', hrCanPublish: true, businessCapabilities: { canPublishPerformance: role === 'hr', canManageTeam: role === 'manager' } };
    else if (path.endsWith('/notifications/unread-count')) data = 0;
    else if (path === '/api/v1/cycles') data = { items: [cycle], total: 1, page: 1, pageSize: 20 };
    else if (path === `/api/v1/cycles/${cycleId}`) data = cycle;
    else if (path === '/api/v1/departments') data = [];
    else if (path === '/api/v1/appeals/candidates') { candidatesRead++; data = { items: [task()], total: 1, page: 1, pageSize: 20 }; }
    else if (path === '/api/v1/appeals' && request.method() === 'POST') { appealed = true; data = appeal(); }
    else if (path === '/api/v1/appeals') data = { items: appealed ? [appeal()] : [], total: appealed ? 1 : 0, page: 1, pageSize: 10 };
    else if (path === `/api/v1/appeals/${appealId}`) data = appeal();
    else if (path === `/api/v1/tasks/${taskId}/employee-confirm`) { confirmed = true; data = { id: taskId, status: 'confirmed' }; }
    else if (path === `/api/v1/tasks/${taskId}/employee-disagree`) { appealed = true; data = { id: taskId, status: 'manager_scoring' }; }
    else if (path === `/api/v1/tasks/${taskId}/final-grade`) data = {...task(),canSubmit:true,allPeriodsComplete:true,currentGrade:'B',calculatedScore:86,comment:'原周期评语',latestReject:{nodeType:'appeal',comment:records[0].comment,actorName:'虚拟员工',createdAt:time}};
    else if (path === `/api/v1/tasks/${taskId}`) data = task();
    else if (path.endsWith('/publication-records')) data = { items: [
      { ...task(), taskId, publicationState: 'pending_confirmation', canPublish: false, totalScore: 86, rawGrade: 'B', calibratedGrade: null, resultMasked: false, updatedAt: time },
      { ...task(), taskId: 'ready-1', employeeName: '已确认员工', status: 'confirmed', employeeConfirmedAt: time, publicationState: 'ready_to_publish', canPublish: true, totalScore: 90, rawGrade: 'A', calibratedGrade: null, resultMasked: false, updatedAt: time },
    ], total: 2, page: 1, pageSize: 20 };
    else if (path.endsWith('/tasks/mine')) data = { items: [task()], total: 1 };
    else if (path === '/api/v1/tasks') data = { items: [], total: 0 };
    await route.fulfill({ contentType: 'application/json', body: wrap(data) });
  });
  return { writes, signatureRequests, candidatesRead: () => candidatesRead, task };
}

for (const width of [1440, 390]) {
  test(`结果关键节点按节点、办理信息、意见分行展示 ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    const state = await setup(page, 'employee');
    const opinion = '交付成果已核实。\n后续请按双方沟通的计划推进，并定期记录进展。';
    await page.route(`**/api/v1/tasks/${taskId}`, route => route.fulfill({ contentType: 'application/json', body: wrap({
      ...state.task(), flowRecords: [
        { id: '1', nodeType: 'manager_score', action: 'submit', actorName: '虚拟上级', createdAt: '2026-09-01T08:00:00Z', comment: opinion },
        { id: '2', nodeType: 'dept_review', action: 'approve', actorName: '部门负责人', createdAt: '2026-09-02T08:00:00Z', comment: '复核依据完整。' },
        { id: '3', nodeType: 'hr_calibration', action: 'submit', actorName: '虚拟HR', createdAt: '2026-09-03T08:00:00Z', comment: null },
        { id: '4', nodeType: 'approval', action: 'approve', actorName: '分管负责人', createdAt: '2026-09-04T08:00:00Z', comment: '同意本次评定。' },
      ],
    }) }));
    await page.goto(`/tasks/${taskId}?stage=result`);
    const history = page.getByTestId('review-history');
    await expect(history.locator('li')).toHaveCount(3);
    await expect(history.locator('li').first()).toContainText('结果审批');
    await expect(history).not.toContainText('未填写意见');
    await history.getByRole('button', { name: '查看全部 4 条记录' }).click();
    await expect(history.locator('li')).toHaveCount(4);
    await expect(history.locator('li').last().locator('p')).toHaveText(opinion);
    const boxes = await history.locator('li').first().evaluate(li => {
      const heading = li.querySelector('.review-history__heading')!.getBoundingClientRect();
      const meta = li.querySelector('.review-history__meta')!.getBoundingClientRect();
      const note = li.querySelector('p')!.getBoundingClientRect();
      return { headingBottom: heading.bottom, metaTop: meta.top, metaBottom: meta.bottom, noteTop: note.top };
    });
    expect(boxes.metaTop).toBeGreaterThanOrEqual(boxes.headingBottom);
    expect(boxes.noteTop).toBeGreaterThan(boxes.metaBottom);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await history.screenshot({ path: test.info().outputPath(`readable-history-${width}.png`) });
    await history.getByRole('button', { name: '收起记录' }).click();
    await expect(history.locator('li')).toHaveCount(3);
    expect(state.writes).toEqual([]);
  });

  test(`历史已公示结果仅确认，不展示面谈也不请求签字 ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    const state = await setup(page, 'employee', true, true);
    await page.goto(`/tasks/${taskId}?stage=result`);
    await expect(page.getByRole('button', { name: '确认结果', exact: true })).toBeVisible();
    await expect(page.getByText('已沟通本周期交付及改进措施')).toHaveCount(0);
    await expect(page.getByText('绩效面谈', { exact: true })).toHaveCount(0);
    await expect(page.getByText('考核表三方签字', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /签字|签名/ })).toHaveCount(0);
    expect(state.signatureRequests).toEqual([]);
    await page.getByRole('button', { name: '确认结果', exact: true }).click();
    await expect(page.getByRole('button', { name: '确认结果', exact: true })).toHaveCount(0);
    expect(state.writes.map(write => write.path)).toEqual([`/api/v1/tasks/${taskId}/employee-confirm`]);
    await page.reload();
    await expect(page.getByText('已沟通本周期交付及改进措施')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /签字|签名/ })).toHaveCount(0);
    expect(state.signatureRequests).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`result-without-signatures-${width}.png`), fullPage: true });
  });

  test(`审批后本人可确认或不同意，确认后不能重复操作 ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    const state = await setup(page, 'employee');
    await page.goto(`/tasks/${taskId}?stage=result`);
    await expect(page.getByRole('button', { name: '确认结果', exact: true })).toBeVisible();
    await expect(page.locator('.result-view')).toContainText('86');
    await expect(page.locator('.result-view')).toContainText('稳定完成本周期交付');
    await expect(page.getByRole('button', { name: '不同意', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '确认结果', exact: true }).click();
    await expect(page.getByRole('button', { name: '确认结果', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '不同意', exact: true })).toHaveCount(0);
    await expect(page.locator('.result-view')).toContainText('已确认，待公示');
    expect(state.writes).toHaveLength(1);
    expect(state.writes[0].path).toMatch(/employee-confirm$/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`employee-confirmed-${width}.png`), fullPage: true });
  });

  test(`员工填写异议后直接退回上级，原因必填且刷新不重复提交 ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    const state = await setup(page, 'employee');
    await page.goto(`/tasks/${taskId}?stage=result`);
    await page.getByRole('button', { name: '不同意', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: '提交异议', exact: true }).click();
    await expect(dialog).toContainText('请填写异议原因');
    expect(state.writes).toHaveLength(0);
    await dialog.getByPlaceholder('请说明不同意的原因，供直属上级重新评定时参考').fill('请核实本周期等级依据。');
    await page.screenshot({path:test.info().outputPath(`employee-objection-${width}.png`),fullPage:true,animations:'disabled'});
    await dialog.getByRole('button', { name: '提交异议', exact: true }).click();
    await expect(dialog).toContainText('确认提交异议');
    await expect(dialog).toContainText('重新评定');
    await expect(dialog).toContainText('结果审批');
    expect(state.writes).toHaveLength(0);
    await dialog.getByRole('button', { name: '返回修改', exact: true }).click();
    await expect(dialog.getByRole('textbox')).toHaveValue('请核实本周期等级依据。');
    expect(state.writes).toHaveLength(0);
    await dialog.getByRole('button', { name: '提交异议', exact: true }).click();
    await page.screenshot({path:test.info().outputPath(`employee-objection-confirm-${width}.png`),fullPage:true,animations:'disabled'});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await dialog.getByRole('button', { name: '提交异议并重新评定', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: '确认结果', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '不同意', exact: true })).toHaveCount(0);
    expect(state.writes).toEqual([{path:`/api/v1/tasks/${taskId}/employee-disagree`,body:{reason:'请核实本周期等级依据。'}}]);
    await page.reload();
    await expect(page.getByRole('button', { name: '不同意', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test(`上级可看到员工异议及原月度结果并重新评定 ${width}px`, async ({page}) => {
    await page.setViewportSize({width,height:960});
    await setup(page,'manager');
    await page.goto(`/tasks/${taskId}/final-grade`);
    const workspace = page.getByTestId('manager-period-results');
    await expect(workspace.locator('.reject-alert')).toContainText('结果异议退回');
    await expect(workspace.locator('.reject-alert')).toContainText('需核实周期评定依据');
    await expect(workspace.getByTestId('review-history')).toContainText('员工提出异议');
    await expect(workspace.getByTestId('review-history')).not.toContainText('HR 发起申诉');
    await expect(workspace.getByTestId('cycle-result-score')).toContainText('86.00');
    await expect(workspace.getByRole('button',{name:'整周期最终等级 A',exact:true})).toBeEnabled();
    await expect(workspace.getByRole('textbox',{name:'周期评语',exact:true})).toHaveValue('原周期评语');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test(`HR 代录公示前申诉后查看重评流转，无直接改判 ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    const state = await setup(page, 'hr');
    await page.goto('/appeals');
    await page.getByRole('button', { name: '录入申诉', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect.poll(state.candidatesRead).toBeGreaterThan(0);
    await dialog.locator('.el-select').click();
    await page.getByRole('option').filter({ hasText: '虚拟员工' }).click();
    await dialog.getByPlaceholder('请输入申诉事由').fill('员工线下反馈，需核实周期评定依据。');
    await dialog.getByRole('button', { name: '发起重评', exact: true }).click();
    await expect(dialog).toBeHidden();
    const item = width <= 768 ? page.locator('.mobile-result-card').filter({ hasText: '虚拟员工' }) : page.getByRole('row').filter({ hasText: '虚拟员工' });
    await expect(item).toContainText('上级');
    await item.getByRole('button', { name: '查看详情', exact: true }).click();
    const detail = page.getByRole('dialog');
    await expect(detail.locator('.el-drawer__title')).toHaveText('申诉详情');
    await expect(detail.locator('.el-drawer__title')).toBeVisible();
    await expect(detail).toContainText('员工线下反馈');
    await expect(detail).toContainText('申诉前得分');
    await expect(detail).toContainText('86.00');
    await expect(detail.getByTestId('review-history')).toContainText('HR 发起申诉');
    await expect(detail.getByRole('button', { name: '提交处理', exact: true })).toHaveCount(0);
    await expect(detail.getByText('改判', { exact: true })).toHaveCount(0);
    await detail.evaluate(async element => {
      const animations = element.parentElement?.getAnimations({ subtree: true }) ?? [];
      await Promise.all(animations.filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => undefined)));
    });
    const bounds = await detail.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
    expect(state.writes).toEqual([{ path: '/api/v1/appeals', body: { taskId, reason: '员工线下反馈，需核实周期评定依据。' } }]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`hr-appeal-${width}.png`), fullPage: true, animations: 'disabled' });
  });

  test(`公示列表区分待确认和已确认待公示 ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    await setup(page, 'hr');
    await page.goto(`/publish?cycleId=${cycleId}`);
    const rows = width <= 768 ? page.locator('.mobile-result-card') : page.getByRole('row');
    const pending = rows.filter({ hasText: '虚拟员工' });
    const ready = rows.filter({ hasText: '已确认员工' });
    await expect(pending).toContainText('待员工确认');
    await expect(ready).toContainText('已确认，待公示');
    if (width > 768) {
      await expect(pending.getByRole('checkbox')).toBeDisabled();
      await expect(ready.getByRole('checkbox')).toBeEnabled();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('审批未通过不能查看或确认个人结果', async ({ page }) => {
  await setup(page, 'employee', false);
  await page.goto(`/tasks/${taskId}?stage=result`);
  await expect(page.getByRole('button', { name: '确认结果', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '不同意', exact: true })).toHaveCount(0);
  await expect(page.locator('.result-view')).toHaveCount(0);
});

test('异议提交失败时保留原因并在表单中显示错误', async ({page}) => {
  await setup(page,'employee');
  await page.route(`**/api/v1/tasks/${taskId}/employee-disagree`,route=>route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({code:4009,message:'结果状态已变化，请刷新后重试'})}));
  await page.goto(`/tasks/${taskId}?stage=result`);
  await page.getByRole('button',{name:'不同意',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByRole('textbox').fill('保留这条异议原因');
  await dialog.getByRole('button',{name:'提交异议',exact:true}).click();
  await dialog.getByRole('button',{name:'提交异议并重新评定',exact:true}).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('textbox')).toHaveValue('保留这条异议原因');
  await expect(dialog.locator('.el-form-item__error')).toContainText('结果状态已变化');
});
