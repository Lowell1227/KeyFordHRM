<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Plus, Refresh, Upload, Download } from '@element-plus/icons-vue';
import BusinessListPage from '@/components/common/business-list/BusinessListPage.vue';
import BusinessDetailDrawer from '@/components/common/business-list/BusinessDetailDrawer.vue';
import QueryFilterPanel from '@/components/common/QueryFilterPanel.vue';
import ListPagination from '@/components/common/ListPagination.vue';
import MobileResultCard from '@/components/common/MobileResultCard.vue';
import RecruitmentIntakeDraftForm from './components/RecruitmentIntakeDraftForm.vue';
import { usePagination } from '@/composables/usePagination';
import { useAuthStore } from '@/stores/auth.store';
import { useTalentPermissions } from '@/views/talent/useTalentPermissions';
import { useRecruitmentLeaveGuard } from '@/views/talent/useRecruitmentLeaveGuard';
import { useRecruitmentIntake } from './useRecruitmentIntake';
import { recruitmentIntakesApi } from '@/api/recruitment-intakes.api';
import { recruitmentPostingsApi } from '@/api/recruitment-postings.api';
import { recruitmentDemandsApi } from '@/api/recruitment-demands.api';
import { talentRecruitmentApi } from '@/api/talent-recruitment.api';
import { TALENT_SOURCE_CHANNELS, TALENT_SOURCE_LABELS, APPLICATION_STAGE_LABELS, type TalentRecruitmentOwner } from '@/types/talent.types';
import type { IntakeState, RecruitmentIntake, RecruitmentPosting } from '@/types/recruitment-intake.types';
import type { RecruitmentDemandDirectories, RecruitmentDemandView } from '@/types/recruitment-demand.types';
import { INTAKE_FIELD_LABELS, INTAKE_PARSE_LABELS, INTAKE_STATE_LABELS, intakeError, intakeEventLabel, intakeIssueLabel, intakeMappingHistory, intakeResultTarget } from './intake-presentation';
import { demandOriginLabel, demandReference } from './demand-presentation';
import { formatDate } from '@/utils/date';

const auth = useAuthStore(), route = useRoute(), router = useRouter(), { canEdit } = useTalentPermissions();
const rows = ref<RecruitmentIntake[]>([]), loading = ref(false), listError = ref(''), referenceError = ref('');
const { page, pageSize, total, pageSizeOptions } = usePagination();
const filters = reactive({ state: '' as IntakeState | '', keyword: '', ownerId: '', sourceChannel: '' });
const mailboxConfigured = ref(false), mailboxError = ref(''), syncing = ref(false), mailMessage = ref('');
const owners = ref<TalentRecruitmentOwner[]>([]), postings = ref<RecruitmentPosting[]>([]), demands = ref<RecruitmentDemandView[]>([]);
const directories = ref<RecruitmentDemandDirectories>({ departments: [], positions: [] });
let listEpoch = 0, refsEpoch = 0;
let selectionEpoch = 0, ownerQuery = 0, postingQuery = 0, demandQuery = 0, awaitingQuery = 0;
async function loadList() {
  if (!canEdit.value) return;
  const token = ++listEpoch; loading.value = true; listError.value = '';
  try {
    const result = await recruitmentIntakesApi.list({ page: page.value, pageSize: pageSize.value, state: filters.state || undefined,
      keyword: filters.keyword.trim() || undefined, ownerId: filters.ownerId || undefined, sourceChannel: filters.sourceChannel || undefined,
      ...(typeof route.query.demandId === 'string' ? { demandId: route.query.demandId } : {}), ...(typeof route.query.postingId === 'string' ? { postingId: route.query.postingId } : {}) });
    if (token !== listEpoch || !canEdit.value) return; rows.value = result.items; total.value = result.total;
  } catch (cause) { if (token === listEpoch) { rows.value = []; total.value = 0; listError.value = intakeError(cause); } }
  finally { if (token === listEpoch) loading.value = false; }
}
const review = useRecruitmentIntake(loadList);
const { current, opened, loading: detailLoading, busy, editable, error, result, blocked, unknown, draft, form, application,
  fieldErrors, phone, reuseExisting, existingProfile, existingApplications, existingApplicationId, existingLoading, existingError,
  chosenSuggestions, closeReason } = review;
const leave = useRecruitmentLeaveGuard({ dirty: () => (opened.value && review.dirty.value) || unknown.value, busy: () => busy.value || syncing.value,
  discard: () => { if (!unknown.value) review.reset(); } });
const completedTarget = computed(() => intakeResultTarget(current.value));
const existingTarget = computed(() => intakeResultTarget({ candidateId: existingProfile.value?.id }));
const matchingApplications = computed(() => existingApplications.value.filter(row => row.deptId === application.deptId && row.positionName === application.positionName));
const terminal = computed(() => !!current.value && (!editable.value || current.value.state === 'completed' || current.value.state === 'closed'));
const suggestions = computed(() => Object.entries(current.value?.parseResult?.fields || {}).filter(([field]) => Object.prototype.hasOwnProperty.call(INTAKE_FIELD_LABELS, field)));
const uploadedFileId = ref(''), fileBusy = ref(false), fileError = ref('');
const awaitingRows = ref<RecruitmentIntake[]>([]), awaitingId = ref(''), awaitingError = ref(''), associating = ref(false);
const closing = ref(false);

async function references(keyword = '') {
  if (!canEdit.value) return;
  const token = ++refsEpoch, peopleToken = ++ownerQuery, jobsToken = ++postingQuery; referenceError.value = '';
  try {
    const [people, catalog, jobs] = await Promise.all([talentRecruitmentApi.owners({ keyword, pageSize: 50 }), recruitmentDemandsApi.directories(), recruitmentPostingsApi.list({ page: 1, pageSize: 20 })]);
    if (token !== refsEpoch || !canEdit.value) return;
    if (peopleToken === ownerQuery) owners.value = people.items;
    directories.value = catalog;
    if (jobsToken === postingQuery) postings.value = jobs.items;
  } catch (cause) { if (token === refsEpoch) referenceError.value = intakeError(cause); }
}
async function searchOwners(keyword: string) {
  const token = ++ownerQuery, context = refsEpoch;
  try { const result = await talentRecruitmentApi.owners({ keyword, pageSize: 50 }); if (token === ownerQuery && context === refsEpoch && canEdit.value) owners.value = result.items; }
  catch (cause) { if (token === ownerQuery && context === refsEpoch) referenceError.value = intakeError(cause); }
}
async function searchPostings(keyword = '') {
  const token = ++postingQuery, context = refsEpoch;
  try { const result = await recruitmentPostingsApi.list({ keyword: keyword || undefined, page: 1, pageSize: 20 }); if (token === postingQuery && context === refsEpoch && canEdit.value) postings.value = result.items; }
  catch (cause) { if (token === postingQuery && context === refsEpoch) referenceError.value = intakeError(cause); }
}
async function searchDemands(keyword = '') {
  const token = ++demandQuery, context = refsEpoch;
  try { const result = await recruitmentDemandsApi.list({ keyword: keyword || undefined, status: 'approved', page: 1, pageSize: 20 }); if (token === demandQuery && context === refsEpoch && canEdit.value) demands.value = result.items.filter(row => row.usable); }
  catch (cause) { if (token === demandQuery && context === refsEpoch) referenceError.value = intakeError(cause); }
}
async function useDemand(id: string) {
  const token = ++selectionEpoch; form.demandId = id || '';
  if (id) await resolveDemand(id, token);
}
async function resolveDemand(id: string, token: number) {
  try { const row = await recruitmentDemandsApi.detail(id); if (token !== selectionEpoch || !canEdit.value || !opened.value) return;
    if (!row.usable || row.sourceState !== 'approved') { referenceError.value = '该需求当前不可用，请重新核对。'; form.demandId = ''; return; }
    demands.value = [row, ...demands.value.filter(item => item.id !== row.id)]; form.demandId = row.id;
    form.positionName = row.positionName || ''; application.positionName = row.positionName || ''; application.deptId = row.deptId || '';
  } catch (cause) { if (token === selectionEpoch) referenceError.value = intakeError(cause); }
}
async function choosePosting(id: string) {
  const token = ++selectionEpoch; form.postingId = id;
  if (!id) return;
  try { const row = await recruitmentPostingsApi.detail(id); if (token !== selectionEpoch || !canEdit.value || !opened.value || form.postingId !== id) return;
    postings.value = [row, ...postings.value.filter(item => item.id !== row.id)];
    if (row.active && row.verifiedIdentity) { form.ownerId = row.ownerId; application.ownerId = row.ownerId; await resolveDemand(row.demandId, token); }
    else referenceError.value = '外部职位身份尚未核实，仅保留来源线索；岗位和需求请经办确认。';
  } catch (cause) { if (token === selectionEpoch) referenceError.value = intakeError(cause); }
}
async function start(state: 'awaiting_resume' | 'pending_review') {
  if (!canEdit.value || busy.value) return;
  if (unknown.value) { opened.value = true; return; }
  if (!await leave.prepareToLeave()) return;
  ++selectionEpoch;
  review.start(state); uploadedFileId.value = ''; closing.value = false; awaitingId.value = ''; referenceError.value = '';
  await references();
  if (typeof route.query.postingId === 'string') await choosePosting(route.query.postingId);
  else if (typeof route.query.demandId === 'string') await useDemand(route.query.demandId);
}
async function open(id: string) {
  if (unknown.value) { opened.value = true; return; }
  if (!await leave.prepareToLeave()) return;
  ++selectionEpoch;
  closing.value = false; awaitingId.value = ''; uploadedFileId.value = ''; await review.open(id);
}
async function closeDrawer(done?: () => void) {
  if (busy.value) return;
  if (unknown.value) { ++selectionEpoch; opened.value = false; done?.(); return; }
  if (await leave.prepareToLeave()) { opened.value = false; done?.(); }
}
async function readMailboxStatus() {
  mailboxError.value = '';
  try { const status = await recruitmentIntakesApi.mailStatus(); if (canEdit.value) mailboxConfigured.value = status.configured; }
  catch (cause) { if (canEdit.value) { mailboxConfigured.value = false; mailboxError.value = intakeError(cause); } }
}
async function syncMailbox() {
  if (!canEdit.value || !mailboxConfigured.value || syncing.value) return;
  syncing.value = true; mailboxError.value = ''; mailMessage.value = '';
  try { const response = await recruitmentIntakesApi.syncMail(10); if (!canEdit.value) return;
    mailMessage.value = `本次收到 ${response.synced} 条，跳过 ${response.skipped} 条，失败 ${response.failed} 条。${response.complete && !response.hasMore && response.failed === 0 ? '本批读取完成。' : '尚未读完，请核对后继续读取。'}`;
    await loadList();
  } catch (cause) { if (canEdit.value) mailboxError.value = intakeError(cause); }
  finally { syncing.value = false; }
}
async function selectedFile(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = '';
  if (file) await review.upload(file);
}
async function download(fileId: string, fileName: string) {
  const id = current.value?.id; if (!canEdit.value || !id || fileBusy.value) return;
  fileBusy.value = true; fileError.value = '';
  try { const blob = await recruitmentIntakesApi.file(id, fileId); if (!canEdit.value || current.value?.id !== id) return;
    const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = fileName; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (cause) { if (canEdit.value) fileError.value = intakeError(cause); }
  finally { fileBusy.value = false; }
}
async function findAwaiting(keyword = '') {
  const token = ++awaitingQuery, context = selectionEpoch;
  try { const response = await recruitmentIntakesApi.list({ state: 'awaiting_resume', keyword: keyword || undefined, page: 1, pageSize: 20 }); if (token === awaitingQuery && context === selectionEpoch && canEdit.value) awaitingRows.value = response.items.filter(row => row.id !== current.value?.id); }
  catch (cause) { if (token === awaitingQuery && context === selectionEpoch) awaitingError.value = intakeError(cause); }
}
async function associate() {
  const row = awaitingRows.value.find(item => item.id === awaitingId.value);
  if (!row) { awaitingError.value = '请选择原待收简历记录'; return; }
  associating.value = true; try { await review.associate(row); } finally { associating.value = false; }
}
watch([canEdit, () => auth.user?.id], () => {
  ++listEpoch; ++refsEpoch; ++selectionEpoch; ++ownerQuery; ++postingQuery; ++demandQuery; ++awaitingQuery; rows.value = []; total.value = 0; owners.value = []; postings.value = []; demands.value = []; awaitingRows.value = [];
  page.value = 1; mailboxConfigured.value = false;
  if (canEdit.value) { void loadList(); void references(); void readMailboxStatus(); }
}, { immediate: true });
watch(() => route.query, () => { ++selectionEpoch; page.value = 1; if (canEdit.value) void loadList(); });
watch(opened, value => { if (!value) ++selectionEpoch; });
onBeforeUnmount(() => { ++listEpoch; ++refsEpoch; ++selectionEpoch; });
</script>

<template>
  <BusinessListPage variant="record" :loading="loading" class="intake-page">
    <template #primary-action>
      <template v-if="canEdit"><el-button type="primary" :icon="Plus" :disabled="busy" @click="start('awaiting_resume')">{{ unknown ? '恢复本次收件' : '登记待收简历' }}</el-button><el-button :icon="Upload" :disabled="busy || unknown" @click="start('pending_review')">手工收件</el-button><el-button :disabled="!mailboxConfigured || syncing" :loading="syncing" @click="syncMailbox">读取招聘邮箱</el-button></template>
      <el-tooltip content="刷新收件列表"><el-button :icon="Refresh" aria-label="刷新收件列表" :disabled="!canEdit" @click="loadList" /></el-tooltip>
    </template>
    <template #filters><QueryFilterPanel><el-form inline @submit.prevent="page = 1; loadList()">
      <el-form-item label="状态"><el-select :fit-input-width="true" v-model="filters.state" clearable aria-label="收件状态"><el-option v-for="(label, state) in INTAKE_STATE_LABELS" :key="state" :value="state" :label="label" /></el-select></el-form-item>
      <el-form-item label="岗位 / 来源线索"><el-input v-model="filters.keyword" clearable maxlength="100" aria-label="岗位或来源线索" /></el-form-item>
      <el-form-item label="负责人"><el-select :fit-input-width="true" v-model="filters.ownerId" clearable filterable remote :remote-method="searchOwners" aria-label="筛选负责人"><el-option v-for="owner in owners" :key="owner.id" :value="owner.id" :label="`${owner.name}${owner.employeeNo ? ` · ${owner.employeeNo}` : ''}`" /></el-select></el-form-item>
      <el-form-item label="来源"><el-select :fit-input-width="true" v-model="filters.sourceChannel" clearable aria-label="筛选来源"><el-option v-for="source in TALENT_SOURCE_CHANNELS" :key="source" :value="source" :label="TALENT_SOURCE_LABELS[source]" /></el-select></el-form-item>
      <el-form-item><el-button type="primary" @click="page = 1; loadList()">查询</el-button><el-button @click="Object.assign(filters, { state: '', keyword: '', ownerId: '', sourceChannel: '' }); page = 1; loadList()">重置</el-button></el-form-item>
    </el-form></QueryFilterPanel></template>
    <template #feedback>
      <el-alert v-if="!canEdit" title="简历收件仅供招聘经办办理" type="error" :closable="false" />
      <el-alert v-else-if="!mailboxConfigured" title="招聘邮箱未配置，手工收件可继续办理。" type="info" :closable="false" />
      <el-alert v-if="mailboxError" :title="mailboxError" type="warning" :closable="false"><el-button link @click="readMailboxStatus">重试邮箱检查</el-button></el-alert>
      <el-alert v-if="mailMessage" :title="mailMessage" type="info" :closable="false" />
      <el-alert v-if="listError" :title="listError" type="error" :closable="false"><el-button link @click="loadList">重试列表</el-button></el-alert>
    </template>
    <template #desktop-list><el-table :data="rows" height="100%" class="app-table" :empty-text="listError ? '列表读取失败' : '暂无收件'">
      <el-table-column label="候选人 / 岗位" min-width="220"><template #default="{ row }"><strong>{{ row.candidateDraft?.name || '姓名待核对' }}</strong><div>{{ row.positionName || '岗位待确认' }}</div></template></el-table-column>
      <el-table-column label="状态" width="110"><template #default="{ row }">{{ INTAKE_STATE_LABELS[row.state as IntakeState] }}</template></el-table-column>
      <el-table-column label="来源 / 收件方式" min-width="160"><template #default="{ row }">{{ TALENT_SOURCE_LABELS[row.sourceChannel as keyof typeof TALENT_SOURCE_LABELS] || '来源待核实' }} · {{ row.transport === 'email' ? '邮件' : '手工' }}</template></el-table-column>
      <el-table-column prop="ownerName" label="负责人" min-width="120" />
      <el-table-column label="下次跟进" min-width="150"><template #default="{ row }">{{ row.nextFollowUpAt ? formatDate(row.nextFollowUpAt) : '未安排' }}</template></el-table-column>
      <el-table-column label="操作" width="90" fixed="right"><template #default="{ row }"><el-button link type="primary" @click="open(row.id)">办理</el-button></template></el-table-column>
    </el-table></template>
    <template #mobile-list><div class="intake-mobile"><el-empty v-if="!loading && !rows.length" :description="listError ? '列表读取失败' : '暂无收件'" /><MobileResultCard v-for="row in rows" :key="row.id"><template #title>{{ row.candidateDraft?.name || '姓名待核对' }}</template><template #status>{{ INTAKE_STATE_LABELS[row.state] }}</template><dl><dt>岗位</dt><dd>{{ row.positionName || '待确认' }}</dd><dt>负责人</dt><dd>{{ row.ownerName || '未指定' }}</dd><dt>来源</dt><dd>{{ TALENT_SOURCE_LABELS[row.sourceChannel as keyof typeof TALENT_SOURCE_LABELS] || '待核实' }} · {{ row.transport === 'email' ? '邮件' : '手工' }}</dd><dt>下次跟进</dt><dd>{{ row.nextFollowUpAt ? formatDate(row.nextFollowUpAt) : '未安排' }}</dd></dl><template #actions><el-button link type="primary" @click="open(row.id)">办理</el-button></template></MobileResultCard></div></template>
    <template #pagination><ListPagination v-model:current-page="page" v-model:page-size="pageSize" :page-sizes="pageSizeOptions" :total="total" @change="loadList" /></template>
    <template #detail><BusinessDetailDrawer v-model="opened" :title="current ? '简历收件详情' : form.state === 'awaiting_resume' ? '登记待收简历' : '手工收件'" variant="wide" :loading="detailLoading" :saving="busy" :before-close="closeDrawer">
      <el-alert v-if="error" :title="error" type="error" :closable="false" />
      <el-alert v-if="result" :title="result" type="success" :closable="false" />
      <div v-if="blocked" class="inline-actions"><el-button :disabled="busy" @click="review.refresh">刷新记录，保留输入</el-button><el-button :disabled="busy || unknown" @click="review.reconfirm">核对新版本并保留输入</el-button></div>
      <el-alert v-if="referenceError" :title="referenceError" type="error" :closable="false"><el-button link @click="references()">重试目录</el-button></el-alert>
      <template v-if="current"><dl><dt>当前状态</dt><dd>{{ INTAKE_STATE_LABELS[current.state] }} · 版本 {{ current.revision }}</dd><dt>收件方式</dt><dd>{{ current.transport === 'email' ? '邮件' : '手工' }}</dd><dt>收到时间</dt><dd>{{ formatDate(current.mail?.receivedAt || current.createdAt) }}</dd></dl>
        <el-alert v-for="issue in current.issues" :key="issue" :title="intakeIssueLabel(issue)" type="warning" :closable="false" />
        <el-collapse v-if="current.mail || current.sourceNotes || current.associatedFromIds?.length"><el-collapse-item title="原始来源与关联记录" name="source"><p v-if="current.mail"><strong>{{ current.mail.subject || '无邮件主题' }}</strong></p><p v-if="current.mail" class="source-text">{{ current.mail.bodyText || '无可用正文' }}</p><p class="source-text">{{ current.sourceNotes }}</p><el-button v-for="id in current.associatedFromIds" :key="id" link type="primary" @click="open(id)">查看关联收件 {{ id }}</el-button><el-button v-if="current.associatedToId" link type="primary" @click="open(current.associatedToId)">查看原待收简历</el-button></el-collapse-item></el-collapse>
      </template>
      <el-form label-position="top" :disabled="busy || terminal || unknown || blocked" class="source-form" @submit.prevent="review.save">
        <div class="form-grid"><el-form-item label="收件状态"><el-select :fit-input-width="true" v-model="form.state" aria-label="办理收件状态"><el-option v-for="state in (['awaiting_resume', 'pending_review', 'needs_material'] as const)" :key="state" :value="state" :label="INTAKE_STATE_LABELS[state]" /></el-select></el-form-item>
          <el-form-item label="负责人" required><el-select :fit-input-width="true" v-model="form.ownerId" filterable remote :remote-method="searchOwners" aria-label="收件负责人"><el-option v-if="auth.user" :value="auth.user.id" :label="auth.user.name" /><el-option v-for="owner in owners.filter(item => item.id !== auth.user?.id)" :key="owner.id" :value="owner.id" :label="`${owner.name}${owner.employeeNo ? ` · ${owner.employeeNo}` : ''}`" /></el-select></el-form-item>
          <el-form-item label="实际来源" :error="fieldErrors.sourceChannel"><el-select :fit-input-width="true" v-model="form.sourceChannel" clearable aria-label="实际来源"><el-option v-for="source in TALENT_SOURCE_CHANNELS" :key="source" :value="source" :label="TALENT_SOURCE_LABELS[source]" /></el-select></el-form-item>
          <el-form-item label="下次跟进"><el-date-picker v-model="form.nextFollowUpAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ssZ" clearable aria-label="下次跟进时间" /></el-form-item>
          <el-form-item label="外部职位"><el-select :fit-input-width="true" :model-value="form.postingId" clearable filterable remote :remote-method="searchPostings" aria-label="外部职位" @change="choosePosting"><el-option v-for="posting in postings" :key="posting.id" :value="posting.id" :label="`${posting.channel} · ${posting.name} · ${posting.verifiedIdentity ? '身份已核实' : '线索待核实'} · ${posting.id}`" /></el-select></el-form-item>
          <el-form-item label="内部需求"><el-select :fit-input-width="true" :model-value="form.demandId" clearable filterable remote :remote-method="searchDemands" aria-label="内部招聘需求" @visible-change="value => value && searchDemands()" @change="useDemand"><el-option v-for="demand in demands" :key="demand.id" :value="demand.id" :label="`${demandOriginLabel(demand)} · ${demandReference(demand)} · ${demand.positionName}`" /></el-select></el-form-item>
        </div><el-form-item label="意向岗位"><el-input v-model="form.positionName" maxlength="100" aria-label="收件意向岗位" /></el-form-item><el-form-item label="来源线索 / 使用依据"><el-input v-model="form.sourceNotes" type="textarea" :rows="2" maxlength="2000" show-word-limit aria-label="来源线索" /></el-form-item>
      </el-form>
      <section v-if="current" aria-label="原简历资料"><h3>原简历资料</h3><ul class="files"><li v-for="file in current.files" :key="file.id"><span>{{ file.fileName }}</span><el-button :icon="Download" link :disabled="fileBusy || !canEdit" @click="download(file.id, file.fileName)">下载</el-button></li></ul><el-alert v-if="fileError" :title="fileError" type="error" :closable="false" />
        <label v-if="editable" class="file-control"><span>补传简历</span><input type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" :disabled="busy || blocked || unknown || current.parseStatus === 'processing'" aria-label="上传简历" @change="selectedFile" /></label>
        <div class="inline-actions"><span>{{ INTAKE_PARSE_LABELS[current.parseStatus] || current.parseStatus }}</span><el-select :fit-input-width="true" v-if="current.files.length > 1" v-model="uploadedFileId" clearable aria-label="选择解析附件"><el-option v-for="file in current.files" :key="file.id" :value="file.id" :label="file.fileName" /></el-select><el-button v-if="editable" :disabled="busy || blocked || unknown || current.parseStatus === 'processing' || (!current.files.length && !current.mail?.bodyText && !current.associatedFromIds.length)" @click="review.parse(uploadedFileId || undefined)">{{ current.parseStatus === 'failed' ? '重试解析' : '解析简历' }}</el-button><el-button v-if="current.parseStatus === 'processing'" link @click="review.refresh">刷新解析状态</el-button></div>
        <el-alert v-if="current.parseMessage" :title="current.parseMessage" type="warning" :closable="false" />
        <el-collapse v-if="suggestions.length"><el-collapse-item title="解析建议（逐项核对）" name="suggestions"><el-checkbox-group v-model="chosenSuggestions" :disabled="busy || terminal || unknown || blocked"><label v-for="[field, value] in suggestions" :key="field" class="suggestion"><el-checkbox :value="field">{{ INTAKE_FIELD_LABELS[field] }}</el-checkbox><span>{{ value }}</span></label></el-checkbox-group><p v-for="(item, index) in current.parseResult?.reviewItems" :key="index" class="muted">{{ INTAKE_FIELD_LABELS[item.field] || item.field }}：{{ item.reason }}</p><el-button :disabled="!chosenSuggestions.length || terminal || unknown || blocked" @click="review.applySuggestions">采用选中的建议</el-button></el-collapse-item></el-collapse>
      </section>
      <section aria-label="候选人资料核对"><h3>候选人资料核对</h3><RecruitmentIntakeDraftForm v-model="draft" :disabled="busy || terminal || unknown || blocked || reuseExisting" :errors="fieldErrors" @check-phone="review.checkPhone" />
        <el-button v-if="editable" link type="primary" :loading="review.checkingPhone.value" :disabled="busy || unknown" @click="review.checkPhone">核对手机号已有档案</el-button>
        <el-alert v-if="phone?.exists" title="该手机号已有档案，不会覆盖原资料或跟进。" type="warning" :closable="false"><p>{{ phone.candidate?.name }} · {{ phone.candidate?.statusLabel }}</p><el-checkbox v-model="reuseExisting" :disabled="busy || terminal || unknown">已核实为同一人，复用原档案</el-checkbox><el-button v-if="existingTarget" link type="primary" @click="router.push(existingTarget)">查看已有档案及应聘</el-button></el-alert>
        <el-skeleton v-if="existingLoading" :rows="2" animated /><el-alert v-if="existingError" :title="existingError" type="error" :closable="false"><el-button link @click="review.loadExisting">重试已有档案</el-button></el-alert>
        <p v-if="existingProfile" class="muted">原人才来源：{{ TALENT_SOURCE_LABELS[existingProfile.sourceChannel] }}；已有跟进 {{ existingProfile.followUps.length }} 条，保持不变。</p>
      </section>
      <section aria-label="本次应聘"><h3>本次应聘</h3><el-form label-position="top" :disabled="busy || terminal || unknown || blocked" class="form-grid"><el-form-item label="应聘部门"><el-select :fit-input-width="true" v-model="application.deptId" filterable clearable aria-label="应聘部门"><el-option v-for="dept in directories.departments" :key="dept.id" :value="dept.id" :label="dept.fullPath || dept.name" /></el-select></el-form-item><el-form-item label="应聘岗位"><el-select :fit-input-width="true" v-model="application.positionName" filterable clearable aria-label="应聘岗位"><el-option v-for="position in directories.positions" :key="position.id" :value="position.name" :label="`${position.code} · ${position.name}`" /></el-select></el-form-item><el-form-item label="应聘负责人"><el-select :fit-input-width="true" v-model="application.ownerId" filterable remote :remote-method="searchOwners" aria-label="应聘负责人"><el-option v-if="auth.user" :value="auth.user.id" :label="auth.user.name" /><el-option v-for="owner in owners.filter(item => item.id !== auth.user?.id)" :key="owner.id" :value="owner.id" :label="owner.name" /></el-select></el-form-item><el-form-item v-if="reuseExisting" label="同岗位已有应聘"><el-select :fit-input-width="true" v-model="existingApplicationId" clearable aria-label="复用已有应聘" placeholder="不选则建立本次应聘"><el-option v-for="item in matchingApplications" :key="item.id" :value="item.id" :label="`${item.positionName} · ${APPLICATION_STAGE_LABELS[item.stage]} · ${item.id}`" /></el-select></el-form-item></el-form></section>
      <section v-if="current?.transport === 'email' && editable" aria-label="关联原待收简历"><h3>关联原待收简历</h3><el-alert v-if="awaitingError" :title="awaitingError" type="error" :closable="false" /><div class="inline-actions"><el-select :fit-input-width="true" v-model="awaitingId" filterable remote :remote-method="findAwaiting" aria-label="原待收简历" @visible-change="value => value && findAwaiting()"><el-option v-for="item in awaitingRows" :key="item.id" :value="item.id" :label="`${item.candidateDraft?.name || '姓名待核对'} · ${item.positionName || '岗位待确认'} · ${item.ownerName || '经办待核'} · ${item.id}`" /></el-select><el-button :loading="associating" :disabled="busy || blocked || unknown" @click="associate">关联并保留原跟进</el-button></div></section>
      <section v-if="current?.events?.length" aria-label="收件时间线"><h3>收件时间线</h3><el-timeline><el-timeline-item v-for="event in current.events" :key="event.id" :timestamp="formatDate(event.createdAt)">{{ event.actorName || '系统' }} · {{ intakeEventLabel(event.action) }} · 版本 {{ event.revision }}<p class="source-text">{{ event.reason }}</p><div v-for="mapping in intakeMappingHistory(event)" :key="mapping.label" class="mapping-history"><span>{{ mapping.label }}：</span><el-button v-if="mapping.target" link type="primary" @click="mapping.target && router.push(mapping.target)">{{ mapping.reference }}</el-button><span v-else>{{ mapping.reference }}</span><span v-if="mapping.postingRevision"> · 职位版本 {{ mapping.postingRevision }}</span></div></el-timeline-item></el-timeline></section>
      <el-form v-if="closing && editable" label-position="top" @submit.prevent="review.close"><el-form-item label="关闭原因" required :error="!closeReason.trim() ? '请填写关闭原因' : ''"><el-input v-model="closeReason" type="textarea" :rows="2" maxlength="2000" aria-label="关闭原因" /></el-form-item><el-button :loading="busy" @click="review.close">记录原因并关闭收件</el-button></el-form>
      <template #footer><el-button :disabled="busy" @click="closeDrawer()">{{ unknown ? '关闭，保留本次' : '关闭' }}</el-button><el-button v-if="current" :disabled="busy" @click="review.refresh">刷新记录</el-button><el-button v-if="editable" :loading="busy" :disabled="blocked || (unknown && !!review.confirmIntent.value) || current?.parseStatus === 'processing'" @click="review.save">{{ unknown && !current ? '核对本次保存结果' : '保存核对草稿' }}</el-button><template v-if="current && editable"><el-button type="primary" :loading="busy" :disabled="blocked || (unknown && review.confirmIntent.value?.mode !== 'candidate_only') || current.parseStatus === 'processing'" @click="review.confirm('candidate_only')">仅入库</el-button><el-button type="primary" :loading="busy" :disabled="blocked || (unknown && review.confirmIntent.value?.mode !== 'candidate_application') || current.parseStatus === 'processing'" @click="review.confirm('candidate_application')">入库并创建应聘</el-button><el-button :disabled="busy || blocked || unknown" @click="closing = !closing">关闭收件</el-button></template><el-button v-if="completedTarget" type="primary" @click="router.push(completedTarget)">{{ current?.applicationId ? '查看本次应聘' : '查看人才档案' }}</el-button></template>
    </BusinessDetailDrawer></template>
  </BusinessListPage>
</template>

<style scoped>
.intake-page { min-width: 0; }
.intake-page :deep(.el-alert) { margin-bottom: 10px; }
.intake-page :deep(.cell), .source-text { overflow-wrap: anywhere; white-space: pre-wrap; }
.intake-mobile { display: grid; gap: 10px; }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 16px; }
.form-grid :deep(.el-select), .source-form :deep(.el-select), .source-form :deep(.el-date-editor) { width: 100%; min-width: 0; }
dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 8px 12px; font-size: 13px; }
dt, .muted { color: var(--el-text-color-secondary); } dd { margin: 0; overflow-wrap: anywhere; }
section { margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--el-border-color-lighter); }
h3 { margin: 0 0 12px; font-size: 14px; }
.inline-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin: 10px 0; }
.files { list-style: none; padding: 0; }.files li { display: flex; align-items: center; justify-content: space-between; gap: 8px; overflow-wrap: anywhere; }
.file-control { display: flex; flex-wrap: wrap; gap: 8px; font-size: 13px; }.file-control input { max-width: 100%; }
.suggestion { display: grid; grid-template-columns: minmax(180px, 1fr) minmax(0, 1fr); gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--el-border-color-lighter); overflow-wrap: anywhere; }
@media (max-width: 768px) { .form-grid, .suggestion { grid-template-columns: minmax(0, 1fr); }.intake-page :deep(.el-form--inline .el-form-item) { display: flex; margin-right: 0; }.intake-page :deep(.el-select) { width: 100%; min-width: 0; } }
</style>
