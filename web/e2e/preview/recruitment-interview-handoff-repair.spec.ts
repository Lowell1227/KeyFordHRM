import { randomUUID } from 'node:crypto';
import type { Page, Request } from '@playwright/test';
import {
  test, expect, api, as, approvedDemand, capture, previewNode, seedApplication, setupAccepted,
  type Application,
} from './recruitment-workflow-rollout.helper';

test.setTimeout(240000);
test.use({ timezoneId: 'Asia/Shanghai', actionTimeout: 20000 });

type Interview = { id: string; version: number; status: string };
type DetailedApplication = Application & {
  activitySummary: { completedCount: number; cancelledCount: number; unsubmittedFeedbackCount: number };
  expectedEntryDate: string | null;
};

function watchRecruitmentWrites(page: Page) {
  const writes: string[] = [];
  const listener = (request: Request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() !== 'GET' && /^\/api\/v1\/talent-recruitment\/(applications|interviews)\//.test(path)) writes.push(request.method() + ' ' + path);
  };
  page.on('request', listener);
  return { writes, stop: () => page.removeListener('request', listener) };
}

test('completed and cancelled interview history gives a truthful next step without changing the application stage', async ({ page, owned }, info) => {
  const { f, proof } = owned;
  proof.stage = 'API_setup_completed_cancelled_and_unsubmitted_feedback';
  const demand = await approvedDemand(page, f);
  const completed = await seedApplication(page, f, '已完成待反馈', demand.id);
  const cancelled = await seedApplication(page, f, '已取消面试', demand.id);
  const arrange = async (application: Application, action: 'complete' | 'cancel') => {
    let interview = await api<Interview>(page, f.actors.operator, 'POST', '/talent-interviews', {
      requestId: randomUUID(), candidateId: application.candidateId, applicationId: application.id,
      startsAt: '2026-01-07T02:00:00.000Z', endsAt: '2026-01-07T03:00:00.000Z',
      participantIds: [f.actors.viewer.id], invitationText: `虚构${f.prefix}历史面试前置，仅在隔离HRM内办理`,
    }, 201);
    interview = await api<Interview>(page, f.actors.operator, 'POST', `/talent-interviews/${interview.id}/${action}`, { version: interview.version }, 201);
    return interview;
  };
  const completedInterview = await arrange(completed, 'complete');
  const cancelledInterview = await arrange(cancelled, 'cancel');
  proof.prerequisites = { setupOnly: true, mode: 'real_API', completedInterviewId: completedInterview.id,
    cancelledInterviewId: cancelledInterview.id, feedbackParticipant: 'owned_viewer', feedbackSubmitted: false };

  const tracked = watchRecruitmentWrites(page);
  try {
    proof.stage = 'UI_queue_completed_cancelled_and_next_steps';
    await as(page, f.actors.operator, '/talent-interviews?work=applications&scope=all&keyword=' + encodeURIComponent(f.prefix));
    const completedRow = page.locator('.el-table__row:visible, .mobile-result-card:visible').filter({ hasText: `虚构${f.prefix}_已完成待反馈` });
    const cancelledRow = page.locator('.el-table__row:visible, .mobile-result-card:visible').filter({ hasText: `虚构${f.prefix}_已取消面试` });
    await expect(completedRow).toContainText('已完成'); await expect(completedRow).toContainText('补齐反馈');
    await expect(cancelledRow).toContainText('已取消'); await expect(cancelledRow).not.toContainText('补齐反馈');
    for (const row of [completedRow, cancelledRow]) { await expect(row).toContainText('初筛'); await expect(row).not.toContainText('尚未安排'); }
    await capture(page, info, proof, '01-interview-history-and-queue-next-step');

    proof.stage = 'UI_completed_interview_detail_keeps_explicit_stage_action';
    await completedRow.getByRole('button', { name: '办理', exact: true }).click();
    let panel = page.locator('.application-panel');
    await expect(panel).toContainText('下一步：查看面试结果，补齐反馈');
    await expect(panel.getByRole('button', { name: '进入面试阶段', exact: true })).toBeVisible();
    await expect(page.locator('.interview-panel__summary').filter({ hasText: '已完成' })).toBeVisible();
    await capture(page, info, proof, '02-completed-interview-needs-feedback-without-stage-change');

    proof.stage = 'UI_cancelled_interview_detail_keeps_history_without_feedback_debt';
    await page.goto(`/talent-interviews?candidateId=${cancelled.candidateId}&applicationId=${cancelled.id}`);
    panel = page.locator('.application-panel');
    await expect(panel).toContainText('完成初筛，进入面试阶段或安排面试');
    await expect(panel).not.toContainText('补齐反馈');
    await expect(page.locator('.interview-panel__summary').filter({ hasText: '已取消' })).toBeVisible();
    await capture(page, info, proof, '03-cancelled-history-has-no-false-feedback-debt');
    expect(tracked.writes).toEqual([]);
    proof.cases.push('UI_completed_and_cancelled_history_visible_in_queue_and_detail_no_false_never_arranged_or_automatic_stage');
  } finally { tracked.stop(); }

  proof.stage = 'API_setup_submitted_feedback_then_UI_manual_next_stage';
  await api(page, f.actors.viewer, 'PUT', `/talent-recruitment/interviews/${completedInterview.id}/feedback`, {
    interviewVersion: completedInterview.version, expectedRevision: 0, outcome: 'pass',
    summary: `虚构${f.prefix}仅用API建立已交反馈前置，不代表UI反馈提交验收`, submit: true,
  });
  await page.goto(`/talent-interviews?candidateId=${completed.candidateId}&applicationId=${completed.id}`);
  const panel = page.locator('.application-panel');
  await expect(panel).toContainText('下一步：核对反馈，进入面试阶段');
  await expect(panel.getByRole('button', { name: '进入面试阶段', exact: true })).toBeVisible();
  await capture(page, info, proof, '04-feedback-ready-still-requires-explicit-stage-action');
  const completedState = await api<DetailedApplication>(page, f.actors.operator, 'GET', '/talent-recruitment/applications/' + completed.id);
  const cancelledState = await api<DetailedApplication>(page, f.actors.operator, 'GET', '/talent-recruitment/applications/' + cancelled.id);
  expect(completedState).toMatchObject({ stage: 'screening', hiringRequestedById: null, recruitmentDemandSnapshot: null, activitySummary: { completedCount: 1, unsubmittedFeedbackCount: 0 } });
  expect(cancelledState).toMatchObject({ stage: 'screening', hiringRequestedById: null, recruitmentDemandSnapshot: null, activitySummary: { cancelledCount: 1, unsubmittedFeedbackCount: 0 } });
  proof.cases.push('UI_feedback_ready_next_step_is_manual_stage_action_not_automatic_hiring');
});

test('hiring preflight lists all known gaps and retains the opinion when HR opens and cancels application editing', async ({ page, owned }, info) => {
  const { f, proof } = owned;
  proof.stage = 'API_setup_application_missing_department_and_catalog_job';
  let application = await seedApplication(page, f, '录用缺项一起核对', null);
  application = await api<Application>(page, f.actors.operator, 'PATCH', '/talent-recruitment/applications/' + application.id,
    { expectedRevision: application.revision, deptId: null, positionName: `虚构${f.prefix}目录外意向岗位` });
  proof.prerequisites = { setupOnly: true, mode: 'real_API', applicationId: application.id, department: null, catalogPosition: false };
  await as(page, f.actors.operator, `/talent-interviews?candidateId=${application.candidateId}&applicationId=${application.id}`);
  const panel = page.locator('.application-panel');
  await panel.getByRole('button', { name: '提交录用', exact: true }).click();
  const preflight = panel.getByLabel('录用提交前检查', { exact: true });
  await expect(preflight).toContainText('应聘部门未填写');
  await expect(preflight).toContainText('应聘岗位未匹配启用的岗位目录');
  await expect(preflight).toContainText('请选择已批准的招聘需求');
  await expect(preflight).toContainText('请填写录用意见');
  const opinion = `虚构${f.prefix}待补齐部门岗位后继续提交的录用意见`;
  await panel.locator('.application-panel__command textarea').fill(opinion);
  await expect(preflight).not.toContainText('请填写录用意见');
  await capture(page, info, proof, '05-hiring-gaps-visible-together');

  proof.stage = 'UI_preserve_opinion_across_edit_and_explicit_cancel';
  const tracked = watchRecruitmentWrites(page);
  try {
    await panel.getByRole('button', { name: '修改当前应聘（保留录用意见）', exact: true }).click();
    await expect(panel.locator('.application-panel__form')).toBeVisible();
    await panel.getByRole('button', { name: '取消编辑', exact: true }).click();
    let confirm = page.getByRole('dialog', { name: '取消应聘修改', exact: true });
    await expect(confirm).toBeVisible(); await confirm.getByRole('button', { name: '继续编辑', exact: true }).click();
    await expect(panel.locator('.application-panel__form')).toBeVisible();
    await panel.getByRole('button', { name: '取消编辑', exact: true }).click();
    confirm = page.getByRole('dialog', { name: '取消应聘修改', exact: true });
    await confirm.getByRole('button', { name: '放弃修改', exact: true }).click();
    await expect(panel.locator('.application-panel__command textarea')).toHaveValue(opinion);
    await expect(preflight).toContainText('应聘部门未填写'); await expect(preflight).toContainText('应聘岗位未匹配启用的岗位目录');
    expect(tracked.writes).toEqual([]);
    await capture(page, info, proof, '06-opinion-retained-after-cancelling-application-edit');
  } finally { tracked.stop(); }
  expect(await api<Application>(page, f.actors.operator, 'GET', '/talent-recruitment/applications/' + application.id))
    .toMatchObject({ stage: 'screening', revision: application.revision, hiringRequestedById: null, recruitmentDemandSnapshot: null });
  proof.cases.push('UI_all_hiring_gaps_at_once_and_opinion_retained_after_normal_cancel_flow_no_submission');
});

test('accepted recruitment opens an editable onboarding draft with reliable prefill and an unselected company', async ({ page, owned }, info) => {
  const { f, proof } = owned;
  proof.stage = 'API_accepted_offer_and_owned_personnel_role_prerequisites';
  const demand = await approvedDemand(page, f), application = await setupAccepted(page, f, demand, '已接受录用待核对入职');
  const expectedDate = '2037-02-17';
  previewNode(`const owner=await fixtures.configuration(db,${JSON.stringify(f.prefix)});
    const actor=await db.user.findUniqueOrThrow({where:{id:${JSON.stringify(f.actors.dual.id)}}});
    if(!owner.actorIds.includes(actor.id)||!actor.employeeNo.startsWith(${JSON.stringify(f.prefix + '_')}))throw new Error('Foreign fixture actor');
    const app=await db.talentApplication.findUniqueOrThrow({where:{id:${JSON.stringify(application.id)}}});
    if(!owner.actorIds.includes(app.ownerId)||app.stage!=='accepted'||!app.recruitmentDemandSnapshot)throw new Error('Foreign or incomplete application');
    await db.user.update({where:{id:actor.id},data:{sysRole:'hr_user',hrCapabilities:[...new Set([...actor.hrCapabilities,'employee_archive_edit'])]}});
    await db.talentApplication.update({where:{id:app.id},data:{expectedEntryDate:new Date(${JSON.stringify(expectedDate)})}});
    console.log(JSON.stringify({ownedRolePrepared:true,expectedDatePrepared:true}));`);
  proof.prerequisites = { setupOnly: true, mode: 'accepted_via_real_API_plus_guarded_owned_PG_role_and_date', applicationId: application.id,
    fictionalPersonnelRole: 'owned dual: hr_user + employee_archive_edit', expectedDate, realAccountsChanged: false };
  const formalSubmissions: string[] = [];
  const listener = (request: Request) => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/employee-archives') formalSubmissions.push('submit_employee'); };
  page.on('request', listener);
  try {
    proof.stage = 'UI_accepted_offer_onboarding_prefill';
    await as(page, f.actors.dual, `/talent-interviews?candidateId=${application.candidateId}&applicationId=${application.id}`);
    await page.locator('.application-panel').getByRole('button', { name: '办理入职', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: '办理入职', exact: true });
    await expect(drawer).toBeVisible();
    await expect(drawer.locator('[data-archive-field="employee.name"] input')).toHaveValue(`虚构${f.prefix}_已接受录用待核对入职`);
    await drawer.getByRole('button', { name: '下一步', exact: true }).click();
    await expect(drawer.locator('[data-archive-field="employee.deptId"]')).toContainText(f.department.name);
    await expect(drawer.locator('[data-archive-field="employee.positionId"]')).toContainText(f.position.name);
    const date = drawer.locator('[data-archive-field="employee.entryDate"] input');
    await expect(date).toHaveValue(expectedDate); await expect(date).toBeEditable();
    await expect(drawer.getByText('已带入录用约定的预计到岗日期，请核对本次入职日期。', { exact: true })).toBeVisible();
    await expect(drawer.locator('[data-archive-field="employee.companyText"]')).toContainText('选择所属公司');
    await expect(drawer.locator('[data-archive-field="employee.companyText"] .legacy-company')).toHaveCount(0);
    await capture(page, info, proof, '07-accepted-offer-onboarding-prefill-requires-hr-confirmation');
    await date.fill('2037-02-18'); await date.press('Enter'); await date.blur();
    await expect(date).toHaveValue('2037-02-18');
    await drawer.getByRole('button', { name: '关闭', exact: true }).click(); await expect(drawer).toBeHidden();
    expect(formalSubmissions).toEqual([]);
    // Creating the explicitly requested onboarding draft starts handling, while submission and activation remain separate.
    expect(await api<Application>(page, f.actors.dual, 'GET', '/talent-recruitment/applications/' + application.id))
      .toMatchObject({ stage: 'onboarding', onboardingRequest: { recordStatus: 'draft', onboardingStatus: 'draft' } });
    const drafts = previewNode<Array<{ id: string; recordStatus: string; onboardingStatus: string | null; appliedAt: string | null; arrivalConfirmedAt: string | null; userId: string | null }>>(`
      const owner=await fixtures.configuration(db,${JSON.stringify(f.prefix)});
      if(!owner.actorIds.includes(${JSON.stringify(f.actors.dual.id)}))throw new Error('Foreign actor');
      console.log(JSON.stringify(await db.employeeDataChangeRequest.findMany({where:{createdById:${JSON.stringify(f.actors.dual.id)},
        talentApplicationId:${JSON.stringify(application.id)},employeeName:{startsWith:${JSON.stringify('虚构' + f.prefix)}}},
        select:{id:true,recordStatus:true,onboardingStatus:true,appliedAt:true,arrivalConfirmedAt:true,userId:true}})));`);
    expect(drafts.length).toBeGreaterThan(0);
    for (const draft of drafts) expect(draft).toMatchObject({ recordStatus: 'draft', onboardingStatus: 'draft', appliedAt: null, arrivalConfirmedAt: null, userId: null });
    proof.onboardingDrafts = drafts; proof.formalSubmissions = formalSubmissions;
    proof.cases.push('UI_accepted_snapshot_prefills_active_department_position_and_expected_date_company_unknown_editable_no_auto_submit_or_activation');
  } finally {
    page.removeListener('request', listener);
    proof.ownedPrefillDraftCleanup = previewNode(`const owner=await fixtures.configuration(db,${JSON.stringify(f.prefix)});
      if(!owner.actorIds.includes(${JSON.stringify(f.actors.dual.id)}))throw new Error('Foreign actor');
      const result=await db.employeeDataChangeRequest.updateMany({where:{createdById:${JSON.stringify(f.actors.dual.id)},
        talentApplicationId:${JSON.stringify(application.id)},employeeName:{startsWith:${JSON.stringify('虚构' + f.prefix)}},archivedAt:null},
        data:{archivedAt:new Date(),sourceReference:${JSON.stringify(f.prefix)}}});
      console.log(JSON.stringify({archivedOwnedDrafts:result.count}));`);
  }
});
