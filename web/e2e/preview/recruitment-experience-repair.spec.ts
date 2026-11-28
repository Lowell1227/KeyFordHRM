import { randomInt, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { type Page } from '@playwright/test';
import { test, expect, api, as, capture, json, response, previewNode, approvedDemand, type Demand, type Intake } from './recruitment-workflow-rollout.helper';

test.setTimeout(300000);
test.use({ timezoneId: 'Asia/Shanghai', actionTimeout: 20000 });

type ReviewDemand = Demand & { usable: boolean; createdById: string; submittedById: string | null; approvedById: string | null };
type FollowUpSnapshot = { lastFollowUpAt: string | null; followUps: Array<{ id: string; recordType: string; planStatus: string;
  sourceIntakeId: string | null; sourceFollowUpAt: string | null }> };
const { resumePdf } = createRequire(import.meta.url)('../../../api/test/talent-core/recruitment-intake-fixtures.cjs') as {
  resumePdf: (marker: string) => Buffer;
};

async function openDemand(page: Page, id: string) {
  await page.goto('/recruitment/demands?demandId=' + id);
  const detail = page.getByRole('dialog', { name: '招聘需求详情', exact: true });
  await expect(detail).toBeVisible(); return detail;
}

test('demand summary and explicit combined approval preserve the separate review path', async ({ page, owned }, info) => {
  const { f, proof } = owned;
  const fields = { requestId: randomUUID(), deptId: f.department.id, positionId: f.position.id,
    headcount: 2, reason: `虚构${f.prefix}明确审核人与下一步` };
  proof.stage = 'self_created_draft_is_not_approved';
  let self = await api<ReviewDemand>(page, f.actors.dual, 'POST', '/recruitment-demands/local', fields, 201);
  expect(self.sourceState).toBe('draft'); expect(self.usable).toBe(false);
  await as(page, f.actors.dual, '/recruitment/demands?demandId=' + self.id);
  let detail = page.getByRole('dialog', { name: '招聘需求详情', exact: true });
  const summary = page.getByTestId('demand-summary');
  await expect(summary).toContainText(f.position.name);
  await expect(summary).toContainText(f.department.name);
  await expect(summary).toContainText('草稿');
  await expect(summary).not.toContainText(self.id);
  await expect(detail.getByRole('button', { name: '提交并通过', exact: true })).toBeVisible();
  await capture(page, info, proof, '01-demand-draft-summary');

  proof.stage = 'explicit_combined_submit_and_approval';
  await detail.getByRole('button', { name: '提交并通过', exact: true }).click();
  let command = page.getByRole('dialog', { name: '提交并通过', exact: true });
  await expect(command).toBeVisible();
  const combined = response(page, 'POST', `/recruitment-demands/${self.id}/local-actions`, 'submit_approve');
  await command.getByRole('button', { name: '提交并通过', exact: true }).click();
  self = await json<ReviewDemand>(await combined, 201);
  await expect(command).toBeHidden();
  expect(self).toMatchObject({ sourceState: 'approved', usable: true, createdById: f.actors.dual.id,
    submittedById: f.actors.dual.id, approvedById: f.actors.dual.id });
  await expect(page.getByTestId('demand-summary')).toContainText('已审核通过');
  await capture(page, info, proof, '02-combined-approval-result');
  proof.cases.push('saved_draft_remains_inactive_then_authorized_creator_explicitly_submits_and_approves');

  proof.stage = 'other_creator_submits_for_review';
  let ordinary = await api<ReviewDemand>(page, f.actors.operator, 'POST', '/recruitment-demands/local',
    { ...fields, requestId: randomUUID(), reason: `虚构${f.prefix}其他经办提交审核` }, 201);
  await as(page, f.actors.operator, '/recruitment/demands?demandId=' + ordinary.id);
  detail = page.getByRole('dialog', { name: '招聘需求详情', exact: true });
  await expect(detail.getByRole('button', { name: '提交并通过', exact: true })).toHaveCount(0);
  await detail.getByRole('button', { name: '提交审核', exact: true }).click();
  command = page.getByRole('dialog', { name: '提交审核', exact: true });
  const submitted = response(page, 'POST', `/recruitment-demands/${ordinary.id}/local-actions`, 'submit');
  await command.getByRole('button', { name: '提交审核', exact: true }).click();
  ordinary = await json<ReviewDemand>(await submitted, 201);
  await expect(command).toBeHidden();
  expect(ordinary.sourceState).toBe('pending'); expect(ordinary.usable).toBe(false);
  await expect(page.getByTestId('demand-summary')).toContainText('待审核');
  await capture(page, info, proof, '03-pending-review-summary');

  proof.stage = 'designated_capability_actor_uses_review_page';
  await as(page, f.actors.reviewer, '/recruitment/demands?demandId=' + ordinary.id);
  detail = await openDemand(page, ordinary.id);
  await detail.getByRole('button', { name: '审核通过', exact: true }).click();
  command = page.getByRole('dialog', { name: '审核通过', exact: true });
  const approved = response(page, 'POST', `/recruitment-demands/${ordinary.id}/local-actions`, 'approve');
  await command.getByRole('button', { name: '审核通过', exact: true }).click();
  ordinary = await json<ReviewDemand>(await approved, 201);
  await expect(command).toBeHidden();
  expect(ordinary.usable).toBe(true);
  expect(ordinary.approvedById).toBe(f.actors.reviewer.id);
  expect(ordinary.submittedById).toBe(f.actors.operator.id);
  expect(ordinary.approvedById).not.toBe(ordinary.submittedById);
  await capture(page, info, proof, '04-independent-demand-review-result');
  proof.cases.push('ordinary_creator_stays_pending_until_reviewed_by_explicitly_authorized_actor');
});

test('first upload and intake arrangements transfer without fabricating communication', async ({ page, owned }, info) => {
  const { f, proof } = owned;
  const name = `虚构${f.prefix}跟进承接`, phone = `170${randomInt(10000000, 100000000)}`;
  const demand = await approvedDemand(page, f);
  proof.stage = 'visible_context_can_be_exited';
  await as(page, f.actors.operator, '/recruitment/intakes?demandId=' + demand.id);
  await expect(page.getByTestId('intake-context-scope')).toContainText(f.position.name);
  await page.getByRole('button', { name: '重置条件', exact: true }).click();
  await expect(page.getByTestId('intake-context-scope')).toBeVisible();
  await page.getByRole('button', { name: '查看全部收件', exact: true }).click();
  await expect(page.getByTestId('intake-context-scope')).toHaveCount(0);
  expect(new URL(page.url()).searchParams.has('demandId')).toBe(false);
  proof.cases.push('context_is_visible_reset_retains_context_and_view_all_exits_it');

  async function manualReceipt(letter: string, time: string, reuse: boolean, replace = false) {
    await page.goto('/recruitment/intakes');
    await page.getByRole('button', { name: '手工收件', exact: true }).click();
    let drawer = page.getByRole('dialog', { name: '手工收件', exact: true });
    await expect(drawer.getByLabel('上传简历', { exact: true })).toBeEnabled();
    const created = response(page, 'POST', '/recruitment-intakes');
    const uploaded = page.waitForResponse(result => result.request().method() === 'POST'
      && /^\/api\/v1\/recruitment-intakes\/[^/]+\/files$/.test(new URL(result.url()).pathname));
    const marker = f.prefix + '_repair_' + letter;
    await drawer.getByLabel('上传简历', { exact: true }).setInputFiles({ name: marker + '.pdf', mimeType: 'application/pdf', buffer: resumePdf(marker) });
    const initial = await json<Intake>(await created, 201);
    const receipt = await json<Intake>(await uploaded, 201);
    expect(receipt.id).toBe(initial.id); expect(receipt.state).toBe('pending_review');
    drawer = page.getByRole('dialog', { name: '简历收件详情', exact: true });
    await drawer.getByRole('textbox', { name: '候选人姓名', exact: true }).fill(name);
    await drawer.getByRole('textbox', { name: '候选人手机号', exact: true }).fill(phone);
    await drawer.getByRole('textbox', { name: '候选人手机号', exact: true }).press('Tab');
    await drawer.getByRole('combobox', { name: '实际来源', exact: true }).press('Enter');
    await page.getByRole('option', { name: '其他', exact: true }).click();
    const follow = drawer.getByRole('combobox', { name: '下次跟进时间', exact: true });
    await follow.fill(time); await follow.press('Tab');
    if (reuse) {
      const checkbox = drawer.getByRole('checkbox', { name: '已核实为同一人，复用原档案', exact: true });
      const reuseLabel = drawer.locator('label.el-checkbox').filter({ hasText: '已核实为同一人，复用原档案' });
      await expect(reuseLabel).toBeVisible(); await reuseLabel.click();
      await expect(checkbox).toBeChecked();
      const choices = drawer.getByRole('radiogroup', { name: '已有跟进安排处理', exact: true });
      await expect(choices).toBeVisible();
      await expect(choices.getByRole('radio', { name: '保留人才库现有安排', exact: true })).toBeChecked();
      if (replace) await choices.getByText('改用本次收件安排', { exact: true }).click();
    }
    const confirmed = response(page, 'POST', `/recruitment-intakes/${receipt.id}/confirm`);
    await drawer.getByRole('button', { name: '仅入库', exact: true }).click();
    const result = await json<Intake>(await confirmed, 201);
    expect(result.state).toBe('completed'); expect(result.candidateId).toBeTruthy();
    await expect(page.getByTestId('intake-terminal-result')).toContainText('已完成入库');
    await expect(drawer.getByRole('textbox', { name: '候选人姓名', exact: true })).toHaveCount(0);
    return result;
  }
  const snapshot = (id: string) => previewNode<FollowUpSnapshot>(`const person=await db.talentCandidate.findUniqueOrThrow({where:{id:${JSON.stringify(id)}},select:{lastFollowUpAt:true,followUps:{select:{id:true,recordType:true,planStatus:true,sourceIntakeId:true,sourceFollowUpAt:true}}}});console.log(JSON.stringify(person));`);

  proof.stage = 'upload_before_save_and_transfer_new_person_plan';
  const first = await manualReceipt('one', '2037-01-10 09:30:00', false);
  let state = snapshot(first.candidateId!);
  expect(state.lastFollowUpAt).toBeNull(); expect(state.followUps).toHaveLength(1);
  expect(state.followUps[0]).toMatchObject({ recordType: 'plan', planStatus: 'pending', sourceIntakeId: first.id,
    sourceFollowUpAt: '2037-01-10T01:30:00.000Z' });
  const originalPlanId = state.followUps[0]!.id;
  await capture(page, info, proof, '05-completed-intake-result');
  proof.cases.push('UI_first_file_upload_does_not_require_manual_save_and_plan_is_not_a_communication');

  proof.stage = 'reuse_defaults_to_preserve_current_plan';
  const second = await manualReceipt('two', '2037-01-11 10:00:00', true);
  expect(second.candidateId).toBe(first.candidateId);
  state = snapshot(first.candidateId!);
  expect(state.lastFollowUpAt).toBeNull(); expect(state.followUps).toHaveLength(2);
  expect(state.followUps.find(item => item.planStatus === 'pending')?.id).toBe(originalPlanId);
  expect(state.followUps.find(item => item.sourceIntakeId === second.id)?.planStatus).toBe('superseded');
  proof.cases.push('explicit_same_person_reuse_preserves_existing_arrangement_by_default');

  proof.stage = 'explicit_replacement_preserves_original_history';
  const third = await manualReceipt('three', '2037-01-12 11:45:00', true, true);
  state = snapshot(first.candidateId!);
  expect(state.lastFollowUpAt).toBeNull(); expect(state.followUps.filter(item => item.recordType === 'communication')).toHaveLength(0);
  expect(state.followUps.find(item => item.id === originalPlanId)?.planStatus).toBe('superseded');
  const active = state.followUps.filter(item => item.planStatus === 'pending');
  expect(active).toHaveLength(1); expect(active[0]).toMatchObject({ sourceIntakeId: third.id, sourceFollowUpAt: '2037-01-12T03:45:00.000Z' });
  await page.getByTestId('intake-terminal-result').getByRole('button', { name: '查看人才档案', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('candidateId=' + first.candidateId));
  await page.getByRole('button', { name: '人才跟进与历史', exact: true }).click();
  const arrangement = page.getByRole('region', { name: '当前跟进安排', exact: true });
  await expect(arrangement).toContainText('2037-01-12'); await expect(arrangement).toContainText('11:45');
  await capture(page, info, proof, '06-transferred-precise-plan-and-history');
  proof.cases.push('explicit_replace_keeps_history_and_shows_original_agreed_beijing_time');

  proof.stage = 'cancel_plan_does_not_turn_uncontacted_person_into_contacted';
  await arrangement.getByRole('button', { name: '取消安排', exact: true }).click();
  const cancellation = page.getByRole('dialog', { name: '取消跟进安排', exact: true });
  const cancelled = response(page, 'POST', `/talents/${first.candidateId}/follow-ups/${active[0]!.id}/cancel`);
  await cancellation.getByRole('button', { name: '取消安排', exact: true }).click();
  await json(await cancelled, 201);
  await expect(arrangement).toHaveCount(0);
  const pending = await api<{ items: Array<{ id: string }> }>(page, f.actors.operator, 'GET', '/talents?dueOnly=true&page=1&pageSize=20&keyword=' + encodeURIComponent(name));
  expect(pending.items.some(item => item.id === first.candidateId)).toBe(true);
  expect(snapshot(first.candidateId!).lastFollowUpAt).toBeNull();
  proof.cases.push('UI_cancel_is_explicit_and_zero_communication_candidate_stays_in_pending_follow_up');
});
