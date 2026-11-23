<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import { ElMessageBox } from 'element-plus';
import { Plus, Refresh } from '@element-plus/icons-vue';
import BusinessListPage from '@/components/common/business-list/BusinessListPage.vue';
import BusinessDetailDrawer from '@/components/common/business-list/BusinessDetailDrawer.vue';
import MobileResultCard from '@/components/common/MobileResultCard.vue';
import ListPagination from '@/components/common/ListPagination.vue';
import { usePagination } from '@/composables/usePagination';
import { useAuthStore } from '@/stores/auth.store';
import { payrollGrantsApi } from '@/api/payroll-grants.api';
import { payrollError } from '@/api/payroll.api';
import type { PayrollGrantDraft, PayrollGrantEvent, PayrollGrantOptions, PayrollGrantRow } from '@/types/payroll-grants.types';
import { payrollGrantLabels } from '@/types/payroll-grants.types';
import { grantDraftErrors } from './payroll-grants-form';

const auth = useAuthStore();
const rows = ref<PayrollGrantRow[]>([]), options = ref<PayrollGrantOptions>({ users: [], subjects: [], capabilities: [] });
const loading = ref(false), busy = ref(false), error = ref(''), formError = ref('');
const optionsReady = ref(false);
const filters = reactive({ keyword: '', subjectId: '', status: 'active' });
const { page, pageSize, total, skip, pageSizeOptions } = usePagination();
const filtered = computed(() => rows.value.filter(row => (!filters.subjectId || row.subjectId === filters.subjectId)
  && (filters.status === 'all' || Boolean(row.revokedAt) === (filters.status === 'revoked'))
  && (!filters.keyword.trim() || `${row.user.name} ${row.user.employeeNo ?? ''} ${row.subject.name}`.toLowerCase().includes(filters.keyword.trim().toLowerCase()))));
const visible = computed(() => filtered.value.slice(skip.value, skip.value + pageSize.value));
watch(filtered, values => { total.value = values.length; if (skip.value >= values.length) page.value = 1; });
watch(filters, () => { page.value = 1; });
const selected = ref<PayrollGrantRow>(), drawer = ref(false), detail = ref(false), events = ref<PayrollGrantEvent[]>([]), eventsLoading = ref(false);
const draft = ref<PayrollGrantDraft>(emptyDraft()), fields = reactive<Record<string, string>>({});
const retainedSubject = ref<PayrollGrantOptions['subjects'][number]>(), retainedUser = ref<PayrollGrantOptions['users'][number]>();
watch(() => draft.value.subjectId, id => {
  delete fields.subjectId;
  retainedSubject.value = options.value.subjects.find(subject => subject.id === id) ?? (selected.value?.subjectId === id ? selected.value.subject : undefined);
}, { flush: 'sync' });
watch(() => draft.value.userId, id => {
  delete fields.userId;
  retainedUser.value = options.value.users.find(person => person.id === id) ?? (selected.value?.userId === id ? selected.value.user : undefined);
}, { flush: 'sync' });
watch(() => draft.value.capabilities.slice(), () => { delete fields.capabilities; });
watch(() => draft.value.reason, () => { delete fields.reason; });
const revokeTarget = ref<PayrollGrantRow>(), revokeReason = ref(''), revokeError = ref('');
let baseline = '', listSequence = 0, historySequence = 0, mounted = true;
const subjectChoices = computed(() => {
  const choices = options.value.subjects.map(subject => ({ ...subject, disabled: false }));
  if (retainedSubject.value && !choices.some(subject => subject.id === retainedSubject.value!.id)) choices.push({ ...retainedSubject.value, disabled: true });
  return choices;
});
const userChoices = computed(() => {
  const choices = options.value.users.filter(person => person.id !== auth.user?.id).map(person => ({ ...person, disabled: false }));
  if (retainedUser.value && !choices.some(person => person.id === retainedUser.value!.id)) choices.push({ ...retainedUser.value, disabled: true });
  return choices;
});
function unavailableReason(subjectId: string, userId: string, row?: PayrollGrantRow) {
  if (!optionsReady.value) return '人员和公司资料尚未核对，暂不能调整授权';
  if ((row && 'isActive' in row.subject && row.subject.isActive === false) || (subjectId && !options.value.subjects.some(subject => subject.id === subjectId))) return '公司主体已停用，不能调整或重新授权';
  if (userId && !options.value.users.some(person => person.id === userId)) return '人员不在当前可授权名单，不能调整或重新授权';
  return '';
}
function rowBlockReason(value: unknown) {
  const row = value as PayrollGrantRow;
  return unavailableReason(row.subjectId, row.userId, row);
}
const draftBlockReason = computed(() => unavailableReason(draft.value.subjectId, draft.value.userId,
  rows.value.find(row => row.id === selected.value?.id) ?? selected.value));
function invalidateHistory() { historySequence++; eventsLoading.value = false; events.value = []; }
watch([() => auth.token, () => auth.user?.id], () => {
  listSequence++; invalidateHistory(); loading.value = false; optionsReady.value = false;
  rows.value = []; options.value = { users: [], subjects: [], capabilities: [] };
  drawer.value = false; selected.value = undefined; retainedUser.value = undefined; retainedSubject.value = undefined; revokeTarget.value = undefined;
}, { flush: 'sync' });
onBeforeUnmount(() => { mounted = false; listSequence++; invalidateHistory(); });
const capabilityText = (values: string[]) => values.map(value => payrollGrantLabels[value] ?? value).join('、') || '无';
const time = (value: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'short', hour12: false }).format(new Date(value));
const actions: Record<string, string> = { grant_created: '新增授权', grant_updated: '调整授权', grant_saved: '保存授权', grant_revoked: '撤销权限', grant_restored: '重新授权' };
function emptyDraft(): PayrollGrantDraft { return { subjectId: '', userId: '', capabilities: [], expectedUpdatedAt: null, reason: '' }; }
function clearErrors() { Object.keys(fields).forEach(key => delete fields[key]); formError.value = ''; }
async function load() {
  const request = ++listSequence, token = auth.token, userId = auth.user?.id;
  const current = () => mounted && request === listSequence && token === auth.token && userId === auth.user?.id;
  loading.value = true; error.value = ''; optionsReady.value = false;
  try {
    const [list, choices] = await Promise.all([payrollGrantsApi.list(), payrollGrantsApi.options()]);
    if (!current()) return;
    rows.value = list; options.value = choices; optionsReady.value = true;
  } catch (cause) {
    if (!current()) return;
    const message = await payrollError(cause);
    if (current()) { rows.value = []; error.value = message; }
  }
  finally { if (current()) loading.value = false; }
}
onMounted(load);
async function edit(row?: PayrollGrantRow) {
  if (busy.value || (drawer.value && !await mayClose())) return;
  invalidateHistory();
  selected.value = row; clearErrors(); detail.value = false;
  retainedSubject.value = row?.subject; retainedUser.value = row?.user;
  draft.value = row ? { subjectId: row.subjectId, userId: row.userId, capabilities: [...row.capabilities], expectedUpdatedAt: row.updatedAt, reason: '' } : emptyDraft();
  baseline = JSON.stringify(draft.value); drawer.value = true;
}
async function mayClose() {
  if (busy.value) return false;
  if (!drawer.value || detail.value || baseline === JSON.stringify(draft.value)) return true;
  try { await ElMessageBox.confirm('放弃尚未保存的修改？', '离开编辑', { confirmButtonText: '放弃修改', cancelButtonText: '继续编辑' }); return true; }
  catch { return false; }
}
async function closeDrawer(value: boolean) {
  if (value) { drawer.value = true; return; }
  if (await mayClose()) { invalidateHistory(); drawer.value = false; }
}
onBeforeRouteLeave(mayClose);
async function save() {
  if (busy.value || detail.value || !drawer.value || draftBlockReason.value) return;
  clearErrors(); Object.assign(fields, grantDraftErrors(draft.value, options.value.capabilities));
  if (Object.keys(fields).length) return;
  busy.value = true;
  try {
    await payrollGrantsApi.save({ ...draft.value, capabilities: [...draft.value.capabilities], reason: draft.value.reason.trim() });
    drawer.value = false; await load();
  } catch (cause) { formError.value = await payrollError(cause); }
  finally { busy.value = false; }
}
async function history(row: PayrollGrantRow) {
  if (busy.value || (drawer.value && !await mayClose())) return;
  const request = ++historySequence, token = auth.token, userId = auth.user?.id;
  const current = () => mounted && request === historySequence && drawer.value && detail.value && selected.value?.id === row.id
    && token === auth.token && userId === auth.user?.id;
  selected.value = row; detail.value = true; drawer.value = true; events.value = []; formError.value = ''; eventsLoading.value = true;
  try { const value = await payrollGrantsApi.events(row.id); if (current()) events.value = value; }
  catch (cause) { if (current()) { const message = await payrollError(cause); if (current()) formError.value = message; } }
  finally { if (current()) eventsLoading.value = false; }
}
function askRevoke(row: PayrollGrantRow) { revokeTarget.value = row; revokeReason.value = ''; revokeError.value = ''; }
async function revoke() {
  if (!revokeTarget.value || busy.value) return;
  if (!revokeReason.value.trim() || revokeReason.value.length > 500) { revokeError.value = '请填写撤销原因，不超过500字'; return; }
  busy.value = true; revokeError.value = '';
  try { await payrollGrantsApi.revoke(revokeTarget.value.id, revokeTarget.value.updatedAt, revokeReason.value.trim()); revokeTarget.value = undefined; await load(); }
  catch (cause) { revokeError.value = await payrollError(cause); }
  finally { busy.value = false; }
}
</script>

<template>
  <BusinessListPage variant="record" :loading="loading">
    <template #primary-action><el-button type="primary" :icon="Plus" :disabled="loading || busy || !optionsReady" @click="edit()">新增授权</el-button></template>
    <template #filters>
      <el-form class="grant-filters" :inline="true" @submit.prevent>
        <el-form-item label="人员"><el-input v-model="filters.keyword" clearable placeholder="姓名 / 工号 / 公司" /></el-form-item>
        <el-form-item label="公司主体"><el-select v-model="filters.subjectId" clearable filterable placeholder="全部公司"><el-option v-for="subject in options.subjects" :key="subject.id" :value="subject.id" :label="subject.name" /></el-select></el-form-item>
        <el-form-item label="状态"><el-select v-model="filters.status" aria-label="授权状态"><el-option label="有效" value="active" /><el-option label="已撤销" value="revoked" /><el-option label="全部" value="all" /></el-select></el-form-item>
        <el-form-item><el-button :icon="Refresh" :loading="loading" :disabled="busy" @click="load">刷新</el-button></el-form-item>
      </el-form>
    </template>
    <template #feedback><el-alert v-if="error" :title="error" type="error" :closable="false" /></template>
    <template #desktop-list>
      <el-table :data="visible" height="100%" empty-text="暂无授权记录">
        <el-table-column label="人员" min-width="150"><template #default="{ row }"><strong>{{ row.user.name }}</strong><span class="grant-secondary">{{ row.user.employeeNo || '工号待维护' }}</span><span v-if="rowBlockReason(row)" class="grant-unavailable">{{ rowBlockReason(row) }}</span></template></el-table-column>
        <el-table-column label="公司主体" min-width="170"><template #default="{ row }">{{ row.subject.name }}</template></el-table-column>
        <el-table-column label="操作权限" min-width="250"><template #default="{ row }">{{ capabilityText(row.capabilities) }}</template></el-table-column>
        <el-table-column label="状态" width="90"><template #default="{ row }"><el-tag :type="row.revokedAt ? 'info' : 'success'" size="small">{{ row.revokedAt ? '已撤销' : '有效' }}</el-tag></template></el-table-column>
        <el-table-column label="更新时间" min-width="145"><template #default="{ row }">{{ time(row.updatedAt) }}</template></el-table-column>
        <el-table-column label="操作" width="210" fixed="right"><template #default="{ row }"><el-button link type="primary" :disabled="busy" @click="history(row as PayrollGrantRow)">记录</el-button><el-button v-if="row.userId !== auth.user?.id" link type="primary" :disabled="busy || loading || !!rowBlockReason(row)" @click="edit(row as PayrollGrantRow)">{{ row.revokedAt ? '重新授权' : '调整' }}</el-button><el-button v-if="!row.revokedAt" link type="danger" :disabled="busy" @click="askRevoke(row as PayrollGrantRow)">撤销</el-button></template></el-table-column>
      </el-table>
    </template>
    <template #mobile-list>
      <el-empty v-if="!visible.length && !loading" description="暂无授权记录" />
      <MobileResultCard v-for="row in visible" :key="row.id"><template #title>{{ row.user.name }} · {{ row.user.employeeNo || '工号待维护' }}</template><template #status>{{ row.revokedAt ? '已撤销' : '有效' }}</template><div>{{ row.subject.name }}</div><div>{{ capabilityText(row.capabilities) }}</div><div class="grant-secondary">{{ time(row.updatedAt) }}</div><p v-if="rowBlockReason(row)" class="grant-unavailable">{{ rowBlockReason(row) }}</p><template #actions><el-button link type="primary" :disabled="busy" @click="history(row)">记录</el-button><el-button v-if="row.userId !== auth.user?.id" link type="primary" :disabled="busy || loading || !!rowBlockReason(row)" @click="edit(row)">{{ row.revokedAt ? '重新授权' : '调整' }}</el-button><el-button v-if="!row.revokedAt" link type="danger" :disabled="busy" @click="askRevoke(row)">撤销</el-button></template></MobileResultCard>
    </template>
    <template #pagination><ListPagination v-model:current-page="page" v-model:page-size="pageSize" :total="total" :page-sizes="pageSizeOptions" :disabled="busy" /></template>
    <template #detail>
      <BusinessDetailDrawer :model-value="drawer" :title="detail ? '授权记录' : selected ? '调整薪酬授权' : '新增薪酬授权'" :saving="busy" :loading="eventsLoading" :before-close="() => closeDrawer(false)" @update:model-value="closeDrawer">
        <el-alert v-if="formError" :title="formError" type="error" :closable="false" />
        <template v-if="detail && selected">
          <p><strong>{{ selected.user.name }}</strong> · {{ selected.subject.name }}</p>
          <el-empty v-if="!eventsLoading && !events.length && !formError" description="暂无办理记录" />
          <el-timeline v-else><el-timeline-item v-for="event in events" :key="event.id" :timestamp="time(event.createdAt)" placement="top"><strong>{{ actions[event.action] || '授权变更' }}</strong><p>{{ event.actor?.name || '操作人待核' }}</p><p>变更前：{{ capabilityText(event.oldCapabilities) }}</p><p>变更后：{{ capabilityText(event.newCapabilities) }}</p><p>{{ event.reason }}</p></el-timeline-item></el-timeline>
        </template>
        <el-form v-else label-position="top" @submit.prevent="save">
          <p v-if="draftBlockReason" class="grant-unavailable" role="status">{{ draftBlockReason }}</p>
          <el-form-item label="公司主体" :error="fields.subjectId"><el-select v-model="draft.subjectId" aria-label="授权公司主体" filterable :disabled="busy || !!selected"><el-option v-for="subject in subjectChoices" :key="subject.id" :value="subject.id" :label="subject.name" :disabled="subject.disabled" /></el-select></el-form-item>
          <el-form-item label="人员" :error="fields.userId"><el-select v-model="draft.userId" aria-label="授权人员" filterable :disabled="busy || !!selected"><el-option v-for="person in userChoices" :key="person.id" :value="person.id" :label="`${person.name} · ${person.employeeNo || '工号待维护'}`" :disabled="person.disabled" /></el-select></el-form-item>
          <el-form-item label="操作权限" :error="fields.capabilities"><el-checkbox-group v-model="draft.capabilities" class="grant-capabilities" :disabled="busy || !!draftBlockReason"><el-checkbox v-for="capability in options.capabilities" :key="capability" :value="capability">{{ payrollGrantLabels[capability] || capability }}</el-checkbox></el-checkbox-group></el-form-item>
          <el-form-item label="授权依据" :error="fields.reason"><el-input v-model="draft.reason" aria-label="授权依据" type="textarea" :rows="3" maxlength="500" show-word-limit :disabled="busy || !!draftBlockReason" /></el-form-item>
        </el-form>
        <template #footer><el-button :disabled="busy" @click="closeDrawer(false)">{{ detail ? '关闭' : '取消' }}</el-button><el-button v-if="!detail" type="primary" :loading="busy" :disabled="loading || !!draftBlockReason" @click="save">保存授权</el-button></template>
      </BusinessDetailDrawer>
      <el-dialog :model-value="!!revokeTarget" title="撤销薪酬权限" width="min(480px, 94vw)" :close-on-click-modal="!busy" :close-on-press-escape="!busy" :show-close="!busy" @update:model-value="value => { if (!value && !busy) revokeTarget = undefined; }">
        <p>{{ revokeTarget?.user.name }} · {{ revokeTarget?.subject.name }}</p><p>撤销该公司主体的薪酬操作权限，历史办理记录保留。</p>
        <el-form label-position="top"><el-form-item label="撤销原因" :error="revokeError"><el-input v-model="revokeReason" aria-label="撤销原因" type="textarea" :rows="3" maxlength="500" :disabled="busy" /></el-form-item></el-form>
        <template #footer><el-button :disabled="busy" @click="revokeTarget = undefined">取消</el-button><el-button type="danger" :loading="busy" @click="revoke">撤销权限</el-button></template>
      </el-dialog>
    </template>
  </BusinessListPage>
</template>

<style scoped>
.grant-filters { display: flex; flex-wrap: wrap; gap: 4px 12px; }
.grant-filters :deep(.el-select) { width: 210px; }
.grant-secondary { display: block; margin-top: 4px; color: var(--el-text-color-secondary); font-size: 12px; }
.grant-unavailable { display: block; margin: 6px 0; color: var(--el-color-warning-dark-2); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.grant-capabilities { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; width: 100%; }
.grant-capabilities :deep(.el-checkbox) { margin-right: 0; height: auto; min-height: 32px; white-space: normal; }
.grant-capabilities :deep(.el-checkbox__label) { white-space: normal; overflow-wrap: anywhere; }
:deep(.el-form-item .el-select) { width: 100%; }
:deep(.el-timeline-item p) { overflow-wrap: anywhere; }
@media (max-width: 768px) { .grant-filters :deep(.el-form-item) { margin-right: 0; width: 100%; } .grant-filters :deep(.el-select) { width: 100%; } }
</style>
