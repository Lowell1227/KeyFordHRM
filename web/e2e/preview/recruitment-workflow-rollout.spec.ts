import { randomUUID } from 'node:crypto';
import { type Locator, type Page } from '@playwright/test';
import {
  test, expect, api, as, approvedDemand, capture, choose, field, json, origin, previewNode, response,
  seedApplication, setupAccepted, type Application, type Demand, type Fixture, type Intake, type Workbench,
} from './recruitment-workflow-rollout.helper';

test.setTimeout(300000);
test.use({ timezoneId: 'Asia/Shanghai', actionTimeout: 20000 });

async function demandPage(page: Page, id: string) {
  await page.goto('/recruitment/demands?demandId=' + id);
  const detail = page.getByRole('dialog', { name: '招聘需求详情', exact: true });
  await expect(detail).toBeVisible(); return detail;
}
async function saveIntake(page: Page, current?: Intake) {
  const saved = response(page, current ? 'PATCH' : 'POST', '/recruitment-intakes' + (current ? '/' + current.id : ''));
  await page.getByRole('dialog').filter({ visible: true }).last().getByRole('button', { name: '保存核对草稿', exact: true }).click();
  const row = await json<Intake>(await saved, current ? 200 : 201);
  await expect(page.getByRole('dialog', { name: '简历收件详情', exact: true }).getByRole('button', { name: '保存核对草稿', exact: true })).toBeEnabled();
  return row;
}
async function dashboardItem(page: Page, group: string, title: string) {
  await page.goto('/dashboard');
  const dashboard = page.getByTestId('dashboard-recruitment');
  const tab = dashboard.getByRole('tab', { name: new RegExp('^' + group + ' \\d+$') });
  await expect(tab).toBeVisible(); await tab.click();
  const item = dashboard.getByRole('tabpanel').filter({ visible: true }).getByRole('button').filter({ hasText: title });
  await expect(item).toHaveCount(1); await item.click();
  await expect(page).toHaveURL(group === '到岗日期已过待确认' ? /\/entry-exit\?/ : /\/recruitment\/intakes\?.*workQueue=/);
}
async function pickDemand(page: Page, select: Locator, demandId: string, keyword: string) {
  await expect(select).toBeEnabled(); await select.fill(keyword);
  const option = page.getByRole('option').filter({ hasText: demandId });
  await expect(option).toBeVisible(); await option.click();
  await expect(select.locator('xpath=ancestor::div[contains(@class,"el-select__wrapper")][1]')).toContainText(demandId);
}
async function applicationAction(page: Page, id: string, action: string, label: string) {
  const panel = page.locator('.application-panel');
  await panel.getByRole('button', { name: label, exact: true }).click();
  const completed = response(page, 'POST', `/talent-recruitment/applications/${id}/actions`, action);
  await panel.locator('.application-panel__command').getByRole('button', { name: label, exact: true }).click();
  return json<Application>(await completed, 201);
}
async function assertCategory(page: Page, demandId: string, category: string, label: string, ids: string[]) {
  const progress = page.getByRole('region', { name: '需求应聘流程' });
  const listed = page.waitForResponse(row => {
    const url = new URL(row.url());
    return row.request().method() === 'GET' && url.pathname === `/api/v1/recruitment-demands/${demandId}/applications`
      && url.searchParams.get('category') === category;
  });
  await progress.getByRole('tab', { name: `${label} ${ids.length}`, exact: true }).click();
  const result = await json<{ items: Array<{ id: string }>; total: number }>(await listed);
  expect(result.total).toBe(ids.length); expect(result.items.map(item => item.id).sort()).toEqual([...ids].sort());
  expect(new URL((await listed).url()).searchParams.get('category')).toBe(category);
  const visible = progress.locator('.el-table__row:visible, .mobile-result-card:visible');
  await expect(visible).toHaveCount(ids.length);
}

test('workbench intake assignment and review lead through original application and independent hiring', async ({ page, owned }, info) => {
  const { f, proof } = owned;
  proof.stage = 'approved_demand_and_existing_person_prerequisites';
  const demand = await approvedDemand(page, f), replacement = await approvedDemand(page, f);
  const otherJob = await approvedDemand(page, f, f.secondPosition);
  const prior = await seedApplication(page, f, '同人另岗位', otherJob.id, f.secondPosition, 'referral');
  const person = await api<{ id: string; name: string; phone: string }>(page, f.actors.operator, 'GET', '/talents/' + prior.candidateId);
  const priorBefore = await api<Application>(page, f.actors.operator, 'GET', '/talent-recruitment/applications/' + prior.id);
  await as(page, f.actors.operator, '/recruitment/intakes');

  proof.stage = 'UI_register_unassigned_intake';
  await page.getByRole('button', { name: '手工收件', exact: true }).click();
  let drawer = page.getByRole('dialog', { name: '手工收件', exact: true });
  await choose(page, drawer.getByRole('combobox', { name: '实际来源', exact: true }), '招聘网站');
  await drawer.getByRole('textbox', { name: '候选人姓名', exact: true }).fill(person.name);
  await drawer.getByRole('textbox', { name: '候选人手机号', exact: true }).fill(person.phone);
  await drawer.getByRole('textbox', { name: '收件意向岗位', exact: true }).fill(f.position.name);
  await field(page, drawer, '学历').locator('.el-select__wrapper').click();
  await page.getByRole('option', { name: f.education.name, exact: true }).click();
  await drawer.getByRole('textbox', { name: '来源线索', exact: true }).fill(`虚构${f.prefix}经许可用于验收的手工资料`);
  let intake = await saveIntake(page); expect(intake.demandId).toBeNull();
  drawer = page.getByRole('dialog', { name: '简历收件详情', exact: true });
  await drawer.getByRole('button', { name: '关闭', exact: true }).click();

  proof.stage = 'UI_dashboard_assignment_click_and_clear_filter';
  await dashboardItem(page, '待归岗位', f.position.name);
  await expect(page).toHaveURL(new RegExp(`intakeId=${intake.id}`));
  expect(new URL(page.url()).searchParams.get('workQueue')).toBe('assignment');
  drawer = page.getByRole('dialog', { name: '简历收件详情', exact: true });
  await expect(drawer.getByRole('textbox', { name: '候选人姓名', exact: true })).toHaveValue(person.name);
  await capture(page, info, proof, '01-dashboard-assignment-opens-owned-intake');
  await drawer.getByRole('button', { name: '关闭', exact: true }).click();
  const cleared = response(page, 'GET', '/recruitment-intakes');
  await page.getByLabel('工作台收件筛选', { exact: true }).locator('.el-tag__close').click();
  await cleared; await expect(page.getByLabel('工作台收件筛选', { exact: true })).toHaveCount(0);
  expect(new URL(page.url()).searchParams.has('workQueue')).toBe(false);
  expect(new URL((await cleared).url()).searchParams.has('workQueue')).toBe(false);
  await page.goto(`/recruitment/intakes?intakeId=${intake.id}`);
  drawer = page.getByRole('dialog', { name: '简历收件详情', exact: true });
  await pickDemand(page, drawer.getByRole('combobox', { name: '内部招聘需求', exact: true }), demand.id, f.prefix);
  await expect(field(page, drawer, '应聘岗位')).toContainText(f.position.name);
  intake = await saveIntake(page, intake);
  expect(intake.demandId).toBe(demand.id);
  await drawer.getByRole('button', { name: '关闭', exact: true }).click();
  await demandPage(page, demand.id);
  const intakeProgress = page.getByRole('region', { name: '简历收件进度' });
  const intakeList = response(page, 'GET', '/recruitment-intakes');
  await intakeProgress.getByRole('button', { name: '待核对简历 1 条', exact: true }).click();
  expect(await json<{ total: number }>(await intakeList)).toMatchObject({ total: 1 });
  expect(new URL(page.url()).searchParams.get('demandId')).toBe(demand.id);
  expect(new URL(page.url()).searchParams.get('state')).toBe('pending_review');
  await expect(page.locator('.el-table__row:visible, .mobile-result-card:visible')).toHaveCount(1);
  proof.cases.push('UI_assignment_original_record_and_clear_queue_then_select_approved_demand');

  proof.stage = 'UI_dashboard_review_deduplicate_and_create_application';
  await dashboardItem(page, '待核对简历', f.position.name);
  expect(new URL(page.url()).searchParams.get('workQueue')).toBe('review');
  drawer = page.getByRole('dialog', { name: '简历收件详情', exact: true });
  await drawer.getByRole('button', { name: '核对手机号已有档案', exact: true }).click();
  await expect(drawer.getByText('该手机号已有档案，不会覆盖原资料或跟进。', { exact: true })).toBeVisible();
  const reuse = drawer.getByRole('checkbox', { name: '已核实为同一人，复用原档案', exact: true });
  await drawer.locator('.el-checkbox').filter({ has: page.getByRole('checkbox', { name: '已核实为同一人，复用原档案', exact: true }) }).click();
  await expect(reuse).toBeChecked();
  const confirmed = response(page, 'POST', `/recruitment-intakes/${intake.id}/confirm`);
  await drawer.getByRole('button', { name: '入库并创建应聘', exact: true }).click();
  intake = await json<Intake>(await confirmed, 201);
  expect(intake).toMatchObject({ state: 'completed', candidateId: person.id }); expect(intake.applicationId).toBeTruthy();
  expect(intake.applicationId).not.toBe(prior.id);
  expect(await api(page, f.actors.operator, 'GET', '/talent-recruitment/applications/' + prior.id)).toEqual(priorBefore);
  await capture(page, info, proof, '02-deduplicated-person-new-application');
  await drawer.getByRole('button', { name: '查看本次应聘', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('applicationId=' + intake.applicationId));
  let application = await api<Application>(page, f.actors.operator, 'GET', '/talent-recruitment/applications/' + intake.applicationId);
  expect(application).toMatchObject({ intentDemandId: demand.id, sourceChannel: 'job_site', recruitmentDemandId: null, recruitmentDemandSnapshot: null });
  await expect(page.locator('.application-panel').getByLabel('当前意向归属')).toContainText('招聘网站');
  const workbench = await api<Workbench>(page, f.actors.operator, 'GET', '/talent-recruitment/workbench');
  for (const key of ['intake_review', 'intake_assignment']) expect(workbench.groups.find(group => group.key === key)?.items.some(item => item.intakeId === intake.id)).toBe(false);
  proof.cases.push('UI_review_same_person_other_job_preserves_prior_application_and_completed_intake_leaves_queues');

  proof.stage = 'UI_front_progress_and_explicit_intent_change';
  await demandPage(page, demand.id);
  const progress = page.getByRole('region', { name: '需求应聘流程' });
  await expect(progress.getByRole('tab', { name: '待筛选 1', exact: true })).toBeVisible();
  const list = await api<{ items: Array<{ id: string }>; total: number }>(page, f.actors.operator, 'GET', `/recruitment-demands/${demand.id}/applications?category=screening`);
  expect(list.total).toBe(1); expect(list.items.map(row => row.id)).toEqual([application.id]);
  await expect(progress.locator('.el-table__row:visible, .mobile-result-card:visible')).toHaveCount(1);
  await progress.getByRole('button', { name: `查看应聘 ${person.name}`, exact: true }).filter({ visible: true }).click();
  const panel = page.locator('.application-panel');
  await panel.getByRole('button', { name: '修改应聘', exact: true }).click();
  await pickDemand(page, panel.getByRole('combobox', { name: '意向招聘需求', exact: true }), replacement.id, f.prefix);
  await panel.getByRole('textbox', { name: '意向需求变更原因', exact: true }).fill(`虚构${f.prefix}经办明确调整意向，不变更录用快照`);
  await choose(page, panel.getByRole('combobox', { name: '本次应聘来源', exact: true }), '内推');
  const changed = response(page, 'PATCH', `/talent-recruitment/applications/${application.id}`);
  await panel.getByRole('button', { name: '保存应聘', exact: true }).click(); application = await json<Application>(await changed);
  expect(application).toMatchObject({ intentDemandId: replacement.id, sourceChannel: 'referral', recruitmentDemandSnapshot: null });
  await expect(panel.getByLabel('当前意向归属')).toContainText('内推');
  await panel.getByRole('button', { name: '应聘时间线', exact: true }).click();
  await expect(panel).toContainText(`虚构${f.prefix}经办明确调整意向，不变更录用快照`);
  await capture(page, info, proof, '03-original-application-intent-source-and-audit');
  application = await applicationAction(page, application.id, 'start_interview', '进入面试阶段');
  await demandPage(page, replacement.id);
  await assertCategory(page, replacement.id, 'interviewing', '面试中', [application.id]);
  proof.cases.push('UI_screening_and_interviewing_counts_match_exact_application_list_and_intent_change_is_audited');

  proof.stage = 'UI_submit_freezes_demand_and_independent_confirmer';
  await page.goto(`/talents?candidateId=${person.id}&applicationId=${application.id}`);
  await panel.getByRole('button', { name: '提交录用', exact: true }).click();
  const command = panel.locator('.application-panel__command');
  await command.locator('textarea').fill(`虚构${f.prefix}录用独立确认回归`);
  await command.getByRole('button', { name: '提交录用', exact: true }).click();
  await expect(field(page, command, '招聘需求单').locator('.el-form-item__error')).toHaveText('请选择已批准且已核对的招聘需求单');
  await pickDemand(page, command.getByRole('combobox', { name: '招聘需求单', exact: true }), replacement.id, f.prefix);
  const submitted = response(page, 'POST', `/talent-recruitment/applications/${application.id}/actions`, 'submit_hiring');
  await command.getByRole('button', { name: '提交录用', exact: true }).click(); application = await json<Application>(await submitted, 201);
  expect(application.recruitmentDemandId).toBe(replacement.id); expect(application.recruitmentDemandSnapshot).toBeTruthy();
  await expect(panel.getByRole('button', { name: '确认录用', exact: true })).toHaveCount(0);
  await demandPage(page, replacement.id);
  await assertCategory(page, replacement.id, 'hiring_review', '待录用确认', [application.id]);
  await as(page, f.actors.confirmer, `/talent-hiring?applicationId=${application.id}`);
  const review = page.locator('.hiring-review__detail'); await expect(review).toContainText(person.name);
  await review.getByRole('button', { name: '确认录用', exact: true }).click();
  const approved = response(page, 'POST', `/talent-recruitment/applications/${application.id}/actions`, 'approve_hiring');
  await review.getByRole('button', { name: '提交录用确认', exact: true }).click(); application = await json<Application>(await approved, 201);
  expect(application.hiringReviewedById).toBe(f.actors.confirmer.id); expect(application.hiringReviewedById).not.toBe(application.hiringRequestedById);
  await capture(page, info, proof, '04-independent-hiring-confirmation-original-route');
  expect((await api<Demand>(page, f.actors.operator, 'GET', '/recruitment-demands/' + replacement.id)).occupiedCount).toBe(0);
  await as(page, f.actors.operator, `/talents?candidateId=${person.id}&applicationId=${application.id}`);
  await applicationAction(page, application.id, 'accept_offer', '候选人接受');
  expect((await api<Demand>(page, f.actors.operator, 'GET', '/recruitment-demands/' + replacement.id)).occupiedCount).toBe(1);
  proof.cases.push('UI_submit_requires_formal_demand_snapshot_independent_confirmation_and_only_acceptance_occupies_seat');
});

test('demand tracking retains people and seats; channel numbers drill down to unique applications', async ({ page, owned }, info) => {
  const { f, proof } = owned;
  proof.stage = 'owned_channel_and_accepted_prerequisites';
  const demand = await approvedDemand(page, f);
  const accepted = await setupAccepted(page, f, demand, '已接受待到岗');
  const interviewing = await seedApplication(page, f, '两次面试同一应聘', demand.id);
  const unknown = await seedApplication(page, f, '来源未确认', demand.id, f.position, null);
  previewNode(`const f=await fixtures.configuration(db,${JSON.stringify(f.prefix)});
    const app=await db.talentApplication.findUniqueOrThrow({where:{id:${JSON.stringify(interviewing.id)}}});
    if(!f.actorIds.includes(app.ownerId))throw new Error('Foreign application');
    await db.talentApplication.update({where:{id:app.id},data:{stage:'interviewing'}});
    const c=await db.talentCandidate.findUniqueOrThrow({where:{id:app.candidateId}});
    for(const hour of [9,11])await db.talentInterview.create({data:{candidateId:c.id,applicationId:app.id,candidateNameSnapshot:c.name,
      startsAt:new Date('2037-01-09T'+hour.toString().padStart(2,'0')+':00:00+08:00'),
      endsAt:new Date('2037-01-09T'+hour.toString().padStart(2,'0')+':30:00+08:00'),
      invitationText:${JSON.stringify('虚构' + f.prefix + '重复面试统计前置，不通知')},createdById:app.ownerId,status:'completed'}});
    console.log(JSON.stringify({interviews:2,applications:1}));`);
  const posting = await api<{ id: string }>(page, f.actors.operator, 'POST', '/recruitment-postings', { requestId: randomUUID(), demandId: demand.id, channel: 'job_site',
    name: `虚构${f.prefix}需人工处理的外部职位`, url: `https://example.invalid/${f.prefix}/position`, externalId: f.prefix + '_position',
    verifiedIdentity: true, active: true, ownerId: f.actors.operator.id, evidence: '虚构外部职位核对依据' }, 201);
  await as(page, f.actors.operator, '/recruitment/demands?demandId=' + demand.id);
  await expect(page.getByRole('region', { name: '需求应聘流程' })).toBeVisible();
  await assertCategory(page, demand.id, 'accepted', '已接受待到岗', [accepted.id]);
  const before = await api<{ summary: unknown }>(page, f.actors.operator, 'GET', `/recruitment-demands/${demand.id}/lifecycle`);

  proof.stage = 'UI_tracking_reason_preflight_and_immutable_people';
  await page.getByRole('button', { name: '招聘结案与外部职位处理', exact: true }).click();
  const lifecycle = page.getByRole('region', { name: '招聘进度留痕' });
  for (const [state, label] of [['filled', '已招满'], ['paused', '暂停招聘'], ['cancelled', '取消招聘']] as const) {
    await lifecycle.getByRole('button', { name: '登记招聘进度', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '登记招聘进度', exact: true });
    await expect(dialog).toContainText('在办应聘'); await expect(dialog).toContainText(`虚构${f.prefix}需人工处理的外部职位`);
    await dialog.locator('.el-select__wrapper').click(); await page.getByRole('option', { name: label, exact: true }).click();
    await dialog.getByRole('button', { name: '保存招聘进度', exact: true }).click();
    await expect(dialog.getByText('请填写变更原因', { exact: true })).toBeVisible();
    const reason = `虚构${f.prefix}${label}：只登记进度，在途继续办理，名额不释放`;
    await dialog.getByRole('textbox', { name: '变更原因', exact: true }).fill(reason);
    await capture(page, info, proof, '05-preflight-' + state);
    const saved = response(page, 'PATCH', `/recruitment-demands/${demand.id}/lifecycle`);
    await dialog.getByRole('button', { name: '保存招聘进度', exact: true }).click();
    const result = await json<{ summary: unknown; trackingState: string; events: Array<{ reason: string; actorName: string | null }> }>(await saved);
    expect(result.trackingState).toBe(state); expect(result.summary).toEqual(before.summary);
    expect(result.events.some(event => event.reason === reason && event.actorName === f.actors.operator.name)).toBe(true);
    await expect(dialog).toBeHidden(); await expect(lifecycle).toContainText(reason);
    expect((await api<Application>(page, f.actors.operator, 'GET', '/talent-recruitment/applications/' + accepted.id)).stage).toBe('accepted');
    expect((await api<Demand>(page, f.actors.operator, 'GET', '/recruitment-demands/' + demand.id)).occupiedCount).toBe(1);
  }
  proof.cases.push('UI_filled_paused_cancelled_require_reason_show_external_and_pending_work_leave_seats_and_history');

  proof.stage = 'UI_record_external_position_manually_handled';
  const externalPosition = page.getByRole('region', { name: '外部职位与收件' }).locator('li').filter({ hasText: `虚构${f.prefix}需人工处理的外部职位` });
  await externalPosition.getByRole('button', { name: '查看 / 修改归属', exact: true }).click();
  const postingDialog = page.getByRole('dialog', { name: '核对外部职位', exact: true });
  await expect(postingDialog.getByRole('switch')).toBeChecked();
  await postingDialog.locator('.el-switch').click(); await expect(postingDialog.getByRole('switch')).not.toBeChecked();
  await postingDialog.getByRole('textbox', { name: '更换归属原因', exact: true }).fill(`虚构${f.prefix}经办已在外部渠道手工停用，仅登记处理结果`);
  const postingSaved = response(page, 'PATCH', '/recruitment-postings/' + posting.id);
  await postingDialog.getByRole('button', { name: '保存职位归属', exact: true }).click();
  expect(await json<{ active: boolean }>(await postingSaved)).toMatchObject({ active: false });
  await expect(postingDialog).toBeHidden(); await expect(externalPosition).toContainText('已停用');
  await capture(page, info, proof, '05b-external-position-handling-is-manually-recorded');
  proof.cases.push('UI_manual_external_position_handled_status_with_reason_no_external_platform_call');

  proof.stage = 'UI_channel_unique_application_drilldown';
  await page.getByRole('button', { name: '本岗位渠道转化', exact: true }).click();
  const analytics = page.getByRole('region', { name: '招聘渠道分析' });
  await expect(analytics).toBeVisible();
  const summary = await api<{ totals: Record<string, number>; items: Array<Record<string, unknown>> }>(page, f.actors.operator, 'GET', `/recruitment-analytics/channels?demandId=${demand.id}`);
  expect(summary.totals).toMatchObject({ applicationCount: 3, interviewedCount: 1, offeredCount: 1, acceptedCount: 1, hiredCount: 0 });
  const metrics = [
    ['application', '应聘', [accepted.id, interviewing.id]], ['interviewed', '进入面试', [interviewing.id]],
    ['offered', '录用确认', [accepted.id]], ['accepted', '当前有效接受', [accepted.id]], ['hired', '实际到岗', []],
  ] as const;
  for (const [source, channelLabel] of [['job_site', '招聘网站'], [null, '待确认来源']] as const) {
    for (const [metric, label, jobIds] of metrics) {
      const expectedIds = source ? [...jobIds] : metric === 'application' ? [unknown.id] : [];
      const number = analytics.getByRole('button', { name: `查看${channelLabel}${label}`, exact: true }).filter({ visible: true });
      await expect(number).toHaveText(String(expectedIds.length));
      const loading = response(page, 'GET', '/recruitment-analytics/applications'); await number.click();
      const cohort = await json<{ total: number; items: Array<{ id: string }> }>(await loading);
      expect(cohort.total).toBe(expectedIds.length); expect(cohort.items.map(row => row.id).sort()).toEqual([...expectedIds].sort());
      const query = new URL((await loading).url()).searchParams;
      expect(query.get('demandId')).toBe(demand.id); expect(query.get('metric')).toBe(metric);
      expect(query.get(source ? 'sourceChannel' : 'unknownSource')).toBe(source || 'true');
      const exactList = analytics.getByRole('region', { name: `${channelLabel} · ${label}`, exact: true });
      await expect(exactList.locator('.el-table__row:visible, .mobile-result-card:visible')).toHaveCount(expectedIds.length);
      await exactList.getByRole('button', { name: '收起明细', exact: true }).click();
    }
  }
  const details = response(page, 'GET', '/recruitment-analytics/applications');
  await analytics.getByRole('button', { name: '查看招聘网站进入面试', exact: true }).filter({ visible: true }).click();
  const interviewed = await json<{ items: Array<{ id: string }>; total: number }>(await details);
  expect(new URL((await details).url()).searchParams.get('metric')).toBe('interviewed');
  expect(new URL((await details).url()).searchParams.get('demandId')).toBe(demand.id);
  expect(interviewed.total).toBe(1); expect(interviewed.items.map(row => row.id)).toEqual([interviewing.id]);
  let listRegion = analytics.getByRole('region', { name: '招聘网站 · 进入面试', exact: true });
  await expect(listRegion).toContainText(`虚构${f.prefix}_两次面试同一应聘`);
  await expect(listRegion.locator('.el-table__row:visible, .mobile-result-card:visible')).toHaveCount(1);
  await capture(page, info, proof, '06-two-interviews-one-application-drilldown');
  await listRegion.getByRole('button', { name: '收起明细', exact: true }).click();
  const unknownDetails = response(page, 'GET', '/recruitment-analytics/applications');
  await analytics.getByRole('button', { name: '查看待确认来源应聘', exact: true }).filter({ visible: true }).click();
  const unknownList = await json<{ items: Array<{ id: string }>; total: number }>(await unknownDetails);
  expect(new URL((await unknownDetails).url()).searchParams.get('unknownSource')).toBe('true');
  expect(unknownList.total).toBe(1); expect(unknownList.items.map(row => row.id)).toEqual([unknown.id]);
  listRegion = analytics.getByRole('region', { name: '待确认来源 · 应聘', exact: true });
  await expect(listRegion).toContainText(`虚构${f.prefix}_来源未确认`);
  await capture(page, info, proof, '07-unknown-source-exact-list');
  await listRegion.getByRole('button', { name: '查看应聘', exact: true }).filter({ visible: true }).click();
  await expect(page).toHaveURL(new RegExp('applicationId=' + unknown.id));
  proof.cases.push('UI_channel_numbers_retain_demand_and_source_exact_ids_two_interviews_count_one_application');
});

test('overdue workbench opens original onboarding; UI date revision removes reminder without releasing seat', async ({ page, owned }, info) => {
  const { f, proof } = owned;
  proof.stage = 'owned_accepted_and_pending_entry_prerequisites';
  const demand = await approvedDemand(page, f), accepted = await setupAccepted(page, f, demand, '逾期入职待改期');
  const request = previewNode<{ id: string }>(`const owner=await fixtures.configuration(db,${JSON.stringify(f.prefix)});
    const actor=await db.user.findUniqueOrThrow({where:{id:${JSON.stringify(f.actors.dual.id)}}});
    if(!owner.actorIds.includes(actor.id))throw new Error('Foreign actor');
    await db.user.update({where:{id:actor.id},data:{sysRole:'hr_user',hrCapabilities:{push:'employee_archive_edit'}}});
    const app=await db.talentApplication.findUniqueOrThrow({where:{id:${JSON.stringify(accepted.id)}}});
    if(!owner.actorIds.includes(app.ownerId))throw new Error('Foreign application');
    const candidate=await db.talentCandidate.findUniqueOrThrow({where:{id:app.candidateId}});
    await db.talentApplication.update({where:{id:app.id},data:{stage:'onboarding',expectedEntryDate:new Date('2020-01-09')}});
    const pending=await db.user.create({data:{name:candidate.name,employeeNo:${JSON.stringify(f.prefix + '_pending')},
      deptId:${JSON.stringify(f.department.id)},accountType:'employee',sysRole:'employee',status:'pending_entry'}});
    const localKey='recruitment_local_fixture_v1:'+${JSON.stringify(f.prefix)};
    const local=(await db.systemConfig.findUniqueOrThrow({where:{key:localKey}})).value;
    local.actorIds.push(pending.id);owner.actorIds.push(pending.id);
    await db.systemConfig.update({where:{key:localKey},data:{value:local}});
    await db.systemConfig.update({where:{key:fixtures.namespace+${JSON.stringify(f.prefix)}},data:{value:owner}});
    const request=await db.employeeDataChangeRequest.create({data:{employeeName:candidate.name,userId:pending.id,sourceType:'manual',
      sourceReference:${JSON.stringify(f.prefix)},intakeType:'new_hire',onboardingStatus:'pending_entry',recordStatus:'submitted',
      profileReviewStatus:'approved',performanceReviewStatus:'not_required',requiresArrivalConfirmation:true,
      talentCandidateId:candidate.id,talentApplicationId:app.id,createdById:actor.id,
      proposedValue:{employee:{name:candidate.name,company:'fuede',deptId:${JSON.stringify(f.department.id)},
        positionId:${JSON.stringify(f.position.id)},position:${JSON.stringify(f.position.name)},employeeStatus:'active',employmentType:'full_time',
        entryDate:'2020-01-09',effectiveFrom:'2020-01-09'},profile:{},performance:{},contracts:[]}}});
    console.log(JSON.stringify({id:request.id}));`);
  proof.prerequisites = { acceptedApplicationId: accepted.id, onboardingId: request.id, setupOnly: true, fakeArrivalDate: '2020-01-09',
    fictionalPersonnelRole: 'hr_user + employee_archive_edit' };
  await as(page, f.actors.dual, '/dashboard');

  proof.stage = 'UI_overdue_dashboard_navigation_and_date_revision';
  await dashboardItem(page, '到岗日期已过待确认', `虚构${f.prefix}_逾期入职待改期`);
  expect(new URL(page.url()).searchParams.get('requestId')).toBe(request.id);
  const detail = page.getByRole('dialog', { name: /办理详情$/ });
  await expect(detail).toContainText(`虚构${f.prefix}_逾期入职待改期`);
  await detail.getByRole('button', { name: '修改到岗日期', exact: true }).click();
  const arrival = detail.locator('.arrival-confirmation');
  const date = field(page, arrival, '变更后到岗日期（北京时间）').locator('input');
  await date.fill('2037-01-15'); await date.press('Tab');
  await capture(page, info, proof, '08-overdue-original-onboarding-revision');
  const revised = response(page, 'PATCH', `/employee-archives/applications/${request.id}/arrival-date`);
  await arrival.getByRole('button', { name: '提交日期变更', exact: true }).click();
  expect(await json<{ onboardingStatus: string }>(await revised)).toMatchObject({ onboardingStatus: 'submitted' });
  await page.goto('/dashboard');
  const dashboard = page.getByTestId('dashboard-recruitment');
  const loaded = await api<Workbench>(page, f.actors.dual, 'GET', '/talent-recruitment/workbench');
  expect(loaded.groups.find(group => group.key === 'entry_overdue')?.items.some(item => item.applicationId === accepted.id || item.id === accepted.id)).toBe(false);
  const tab = dashboard.getByRole('tab', { name: /^到岗日期已过待确认 \d+$/ });
  if (await tab.count()) { await tab.click(); await expect(dashboard.getByRole('tabpanel').filter({ visible: true })).not.toContainText(`虚构${f.prefix}_逾期入职待改期`); }
  await capture(page, info, proof, '09-overdue-reminder-cleared-after-UI-revision');
  expect((await api<Demand>(page, f.actors.operator, 'GET', '/recruitment-demands/' + demand.id)).occupiedCount).toBe(1);
  proof.cases.push('UI_overdue_original_workbench_to_onboarding_date_change_resubmits_review_removes_reminder_and_retains_seat');
});

test('viewer and narrow roles retain original read, intake and analytics boundaries; own hiring cannot self-confirm', async ({ page, owned }, info) => {
  const { f, proof } = owned;
  const demand = await approvedDemand(page, f);
  const intake = await api<Intake>(page, f.actors.operator, 'POST', '/recruitment-intakes', { requestId: randomUUID(), state: 'pending_review',
    transport: 'manual', ownerId: f.actors.operator.id, demandId: demand.id, positionName: f.position.name,
    sourceChannel: 'job_site', sourceNotes: `虚构${f.prefix}权限前置` }, 201);
  proof.stage = 'UI_viewer_readonly_lifecycle';
  await as(page, f.actors.viewer, '/recruitment/demands?demandId=' + demand.id);
  await page.getByRole('button', { name: '招聘结案与外部职位处理', exact: true }).click();
  await expect(page.getByRole('region', { name: '招聘进度留痕' })).toBeVisible();
  await expect(page.getByRole('button', { name: '登记招聘进度', exact: true })).toHaveCount(0);
  const denied = async (actor: Fixture['actors']['viewer'], path: string) => {
    expect((await page.request.get(origin + '/api/v1' + path, { headers: { authorization: 'Bearer ' + actor.token } })).status()).toBe(403);
  };
  await denied(f.actors.viewer, '/recruitment-intakes/' + intake.id);
  for (const role of ['confirmer', 'assessor', 'outsider'] as const) {
    proof.stage = 'UI_narrow_' + role;
    await as(page, f.actors[role], '/dashboard');
    await expect(page.getByRole('heading', { name: f.actors[role].name + '，你好', exact: true })).toBeVisible();
    await expect(page.getByTestId('dashboard-recruitment').getByRole('tab', { name: /待核对简历|待归岗位/ })).toHaveCount(0);
    await denied(f.actors[role], '/recruitment-intakes/' + intake.id);
    await denied(f.actors[role], '/recruitment-analytics/channels?demandId=' + demand.id);
    await denied(f.actors[role], '/recruitment-analytics/applications?demandId=' + demand.id);
    await page.goto('/recruitment/intakes');
    await expect(page).toHaveURL(/\/dashboard(?:\?|$)/);
    await expect(page.getByRole('heading', { name: f.actors[role].name + '，你好', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '手工收件', exact: true })).toHaveCount(0);
    await capture(page, info, proof, '10-narrow-' + role);
  }
  proof.cases.push('UI_viewer_no_lifecycle_mutation_narrow_confirmer_assessor_outsider_no_raw_intakes_or_global_analytics');

  proof.stage = 'UI_dual_capability_self_confirmation_denied';
  previewNode(`const owner=await fixtures.configuration(db,${JSON.stringify(f.prefix)});
    if(!owner.actorIds.includes(${JSON.stringify(f.actors.operator.id)}))throw new Error('Foreign actor');
    await db.user.update({where:{id:${JSON.stringify(f.actors.operator.id)}},data:{hrCapabilities:{push:'talent_hiring_confirm'}}});
    console.log(JSON.stringify({ownedDualCapability:true}));`);
  let app = await seedApplication(page, f, '双能力也不自审', demand.id);
  app = await api<Application>(page, f.actors.operator, 'POST', `/talent-recruitment/applications/${app.id}/actions`, {
    expectedRevision: app.revision, action: 'submit_hiring', note: `虚构${f.prefix}防本人自审`, recruitmentDemandId: demand.id, expectedDemandRevision: demand.revision,
  }, 201);
  await as(page, f.actors.operator, `/talent-hiring?applicationId=${app.id}`);
  await expect(page.getByRole('button', { name: '确认录用', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '提交录用确认', exact: true })).toHaveCount(0);
  const ownApproval = await page.request.post(origin + `/api/v1/talent-recruitment/applications/${app.id}/actions`, {
    headers: { authorization: 'Bearer ' + f.actors.operator.token }, data: { expectedRevision: app.revision, action: 'approve_hiring' },
  });
  expect(ownApproval.status()).toBe(403);
  expect((await api<Application>(page, f.actors.operator, 'GET', '/talent-recruitment/applications/' + app.id)).stage).toBe('hiring_review');
  await capture(page, info, proof, '11-dual-capability-cannot-confirm-own-submission');
  proof.cases.push('UI_and_API_own_submission_cannot_be_confirmed_even_with_both_capabilities');
});

test('same-job revision zero is explicitly reused and first intent association preserves original source and snapshot', async ({ page, owned }, info) => {
  const { f, proof } = owned;
  const demand = await approvedDemand(page, f);
  let application = await seedApplication(page, f, '同岗历史零版本', null, f.position, null);
  previewNode(`const owner=await fixtures.configuration(db,${JSON.stringify(f.prefix)});
    const app=await db.talentApplication.findUniqueOrThrow({where:{id:${JSON.stringify(application.id)}}});
    if(!owner.actorIds.includes(app.ownerId))throw new Error('Foreign application');
    await db.talentApplication.update({where:{id:app.id},data:{revision:0}});console.log(JSON.stringify({legacyRevision:0}));`);
  const person = await api<{ id: string; name: string; phone: string }>(page, f.actors.operator, 'GET', '/talents/' + application.candidateId);
  proof.stage = 'UI_same_job_revision_zero_explicit_reuse';
  await as(page, f.actors.operator, '/recruitment/intakes');
  await page.getByRole('button', { name: '手工收件', exact: true }).click();
  let drawer = page.getByRole('dialog', { name: '手工收件', exact: true });
  await choose(page, drawer.getByRole('combobox', { name: '实际来源', exact: true }), '招聘网站');
  await drawer.getByRole('textbox', { name: '候选人姓名', exact: true }).fill(person.name);
  await drawer.getByRole('textbox', { name: '候选人手机号', exact: true }).fill(person.phone);
  await field(page, drawer, '学历').locator('.el-select__wrapper').click();
  await page.getByRole('option', { name: f.education.name, exact: true }).click();
  await drawer.getByRole('textbox', { name: '来源线索', exact: true }).fill(`虚构${f.prefix}同岗来信，经办核对原应聘`);
  await pickDemand(page, drawer.getByRole('combobox', { name: '内部招聘需求', exact: true }), demand.id, f.prefix);
  let intake = await saveIntake(page); drawer = page.getByRole('dialog', { name: '简历收件详情', exact: true });
  await drawer.getByRole('button', { name: '核对手机号已有档案', exact: true }).click();
  await expect(drawer.getByText('该手机号已有档案，不会覆盖原资料或跟进。', { exact: true })).toBeVisible();
  await drawer.locator('.el-checkbox').filter({ has: page.getByRole('checkbox', { name: '已核实为同一人，复用原档案', exact: true }) }).click();
  await expect(drawer.getByRole('checkbox', { name: '已核实为同一人，复用原档案', exact: true })).toBeChecked();
  const reuse = drawer.getByRole('combobox', { name: '复用已有应聘', exact: true });
  await reuse.press('Enter');
  const option = page.getByRole('option').filter({ hasText: application.id }); await expect(option).toBeVisible(); await option.click();
  await expect(drawer.getByLabel('本次应聘归属核对')).toContainText('待核对');
  await drawer.getByRole('button', { name: '入库并创建应聘', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '确认首次关联意向需求', exact: true });
  await expect(confirmation).toBeVisible();
  const confirmed = response(page, 'POST', `/recruitment-intakes/${intake.id}/confirm`);
  await confirmation.getByRole('button', { name: '关联需求并复用应聘', exact: true }).click();
  intake = await json<Intake>(await confirmed, 201);
  expect(intake).toMatchObject({ state: 'completed', candidateId: person.id, applicationId: application.id });
  await capture(page, info, proof, '12-explicit-reuse-of-revision-zero-existing-application');
  application = await api<Application>(page, f.actors.operator, 'GET', '/talent-recruitment/applications/' + application.id);
  expect(application).toMatchObject({ intentDemandId: demand.id, sourceChannel: null, recruitmentDemandId: null, recruitmentDemandSnapshot: null });
  expect((await api<Application[]>(page, f.actors.operator, 'GET', `/talent-recruitment/candidates/${person.id}/applications`)).map(row => row.id)).toEqual([application.id]);
  await drawer.getByRole('button', { name: '查看本次应聘', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('applicationId=' + application.id));
  await expect(page.locator('.application-panel').getByLabel('当前意向归属')).toContainText('待核对');
  await demandPage(page, demand.id);
  await expect(page.getByRole('region', { name: '需求应聘流程' }).getByRole('tab', { name: '待筛选 1', exact: true })).toBeVisible();
  proof.cases.push('UI_revision_zero_same_job_reuse_explicit_first_intent_association_no_duplicate_or_source_snapshot_overwrite');
});

test('returned hiring changes intent then rejects or withdraws without moving terminal statistics back to the frozen demand', async ({ page, owned }, info) => {
  const { f, proof } = owned;
  const original = await approvedDemand(page, f), next = await approvedDemand(page, f), terminalIds: string[] = [];
  for (const [action, label, stage] of [['reject', '淘汰本次应聘', 'rejected'], ['withdraw', '撤回应聘', 'withdrawn']] as const) {
    let app = await seedApplication(page, f, '先退回再' + stage, original.id);
    proof.stage = 'UI_submit_then_independently_return_' + action;
    await as(page, f.actors.operator, `/talents?candidateId=${app.candidateId}&applicationId=${app.id}`);
    const panel = page.locator('.application-panel');
    await panel.getByRole('button', { name: '提交录用', exact: true }).click();
    let command = panel.locator('.application-panel__command');
    await command.locator('textarea').fill(`虚构${f.prefix}先提交原需求再由独立确认人退回`);
    await pickDemand(page, command.getByRole('combobox', { name: '招聘需求单', exact: true }), original.id, f.prefix);
    const submitted = response(page, 'POST', `/talent-recruitment/applications/${app.id}/actions`, 'submit_hiring');
    await command.getByRole('button', { name: '提交录用', exact: true }).click(); app = await json<Application>(await submitted, 201);
    const frozen = app.recruitmentDemandSnapshot;
    await as(page, f.actors.confirmer, `/talent-hiring?applicationId=${app.id}`);
    const review = page.locator('.hiring-review__detail');
    await review.getByRole('button', { name: '退回经办', exact: true }).click();
    await field(page, review, '退回原因').locator('textarea').fill(`虚构${f.prefix}退回重新核对应聘意向`);
    const returned = response(page, 'POST', `/talent-recruitment/applications/${app.id}/actions`, 'return_hiring');
    await review.getByRole('button', { name: '提交退回', exact: true }).click(); app = await json<Application>(await returned, 201);

    proof.stage = 'UI_returned_intent_change_then_' + action;
    await as(page, f.actors.operator, `/talents?candidateId=${app.candidateId}&applicationId=${app.id}`);
    await panel.getByRole('button', { name: '修改应聘', exact: true }).click();
    await pickDemand(page, panel.getByRole('combobox', { name: '意向招聘需求', exact: true }), next.id, f.prefix);
    await panel.getByRole('textbox', { name: '意向需求变更原因', exact: true }).fill(`虚构${f.prefix}退回后明确转到新意向`);
    const edited = response(page, 'PATCH', `/talent-recruitment/applications/${app.id}`);
    await panel.getByRole('button', { name: '保存应聘', exact: true }).click(); app = await json<Application>(await edited);
    expect(app).toMatchObject({ intentDemandId: next.id, recruitmentDemandId: original.id, recruitmentDemandSnapshot: frozen });
    await panel.getByRole('button', { name: label, exact: true }).click(); command = panel.locator('.application-panel__command');
    await command.locator('textarea').fill(`虚构${f.prefix}经办确认${label}，未接受不占名额`);
    const ended = response(page, 'POST', `/talent-recruitment/applications/${app.id}/actions`, action);
    await command.getByRole('button', { name: label, exact: true }).click(); app = await json<Application>(await ended, 201);
    expect(app).toMatchObject({ stage, intentDemandId: next.id, recruitmentDemandId: original.id, recruitmentDemandSnapshot: frozen });
    terminalIds.push(app.id);
    for (const [demand, expectedIds] of [[original, []], [next, terminalIds]] as Array<[Demand, string[]]>) {
      await demandPage(page, demand.id);
      const progress = page.getByRole('region', { name: '需求应聘流程' });
      const listed = page.waitForResponse(result => {
        const url = new URL(result.url());
        return result.request().method() === 'GET' && url.pathname === `/api/v1/recruitment-demands/${demand.id}/applications` && !url.searchParams.has('category');
      });
      await progress.getByRole('tab', { name: '全部 ' + expectedIds.length, exact: true }).click();
      const result = await json<{ total: number; items: Array<{ id: string }> }>(await listed);
      expect(result.total).toBe(expectedIds.length); expect(result.items.map(row => row.id).sort()).toEqual([...expectedIds].sort());
      await expect(progress.locator('.el-table__row:visible, .mobile-result-card:visible')).toHaveCount(expectedIds.length);
      expect((await api<Demand>(page, f.actors.operator, 'GET', '/recruitment-demands/' + demand.id)).occupiedCount).toBe(0);
    }
    await capture(page, info, proof, '13-returned-new-intent-terminal-' + action);
  }
  proof.cases.push('UI_independent_return_then_intent_B_reject_withdraw_keep_frozen_A_history_but_current_statistics_B_no_seats');
});
