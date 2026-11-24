<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Refresh } from '@element-plus/icons-vue';
import { ElMessageBox } from 'element-plus';
import BusinessListPage from '@/components/common/business-list/BusinessListPage.vue';
import BusinessDetailDrawer from '@/components/common/business-list/BusinessDetailDrawer.vue';
import QueryFilterPanel from '@/components/common/QueryFilterPanel.vue';
import ListPagination from '@/components/common/ListPagination.vue';
import MobileResultCard from '@/components/common/MobileResultCard.vue';
import RecruitmentDemandSeats from './components/RecruitmentDemandSeats.vue';
import RecruitmentDemandApplications from './components/RecruitmentDemandApplications.vue';
import { describeDemandSeats } from './demand-seat-presentation';
import { usePagination } from '@/composables/usePagination';
import { recruitmentDemandsApi } from '@/api/recruitment-demands.api';
import { useAuthStore } from '@/stores/auth.store';
import { useTalentPermissions } from '../talent/useTalentPermissions';
import { useRecruitmentLeaveGuard } from '../talent/useRecruitmentLeaveGuard';
import type { RecruitmentDemandDirectories, RecruitmentDemandSourceState, RecruitmentDemandStatus, RecruitmentDemandView } from '@/types/recruitment-demand.types';
import { DEMAND_SOURCE_LABELS, demandErrorMessage, safeDemandSourceLink } from './demand-presentation';
import { formatDate } from '@/utils/date';

const route = useRoute(), router = useRouter();
const auth = useAuthStore();
const { canRead, canEdit } = useTalentPermissions();
const rows = ref<RecruitmentDemandView[]>([]), current = ref<RecruitmentDemandView | null>(null);
const loading = ref(false), detailLoading = ref(false), saving = ref(false);
const loadError = ref(''), detailError = ref(''), statusError = ref(''), resultMessage = ref('');
const connection = ref<RecruitmentDemandStatus | null>(null);
const filters = reactive({ keyword: '', status: '' as RecruitmentDemandSourceState | '' });
const { page, pageSize, total, pageSizeOptions, reset } = usePagination();
const drawerOpen = ref(false), mappingOpen = ref(false), mappingConflict = ref(false);
const selectedId = ref('');
const directories = ref<RecruitmentDemandDirectories>({ departments: [], positions: [] });
const directoryLoading = ref(false), directoryError = ref('');
const mapping = reactive({ deptId: '', positionId: '', approvedHeadcount: undefined as number | undefined, reason: '' });
const mappingErrors = reactive({ deptId: '', positionId: '', approvedHeadcount: '', reason: '' });
const syncOpen = ref(false), syncDates = ref<[string, string] | null>(null), syncError = ref('');
interface SyncIntent { requestId: string; from: string; to: string; cursor: string | null }
const syncIntent = ref<SyncIntent | null>(null), syncRecovering = ref(false), syncStorageError = ref(''), syncBusy = ref(false);
const syncActionLabel = computed(() => !syncIntent.value ? '开始同步' : syncRecovering.value || !syncIntent.value.cursor ? '恢复本次' : '继续同步');
let listSession = 0, detailSession = 0, connectionSession = 0, syncSession = 0;
const sourceLink = computed(() => safeDemandSourceLink(current.value?.sourceLink));
const returnTarget = computed(() => {
  const candidateId = route.query.candidateId, applicationId = route.query.applicationId;
  return typeof candidateId === 'string' && candidateId && typeof applicationId === 'string' && applicationId
    ? { path: '/talents', query: { candidateId, applicationId } } : null;
});
const leave = useRecruitmentLeaveGuard({
  dirty: () => mappingOpen.value || (syncOpen.value && !syncIntent.value && !!syncDates.value),
  busy: () => saving.value,
  discard: () => { mappingOpen.value = false; syncOpen.value = false; },
});

async function loadList() {
  if (!canRead.value) return;
  const token = ++listSession;
  loading.value = true; loadError.value = '';
  try {
    const result = await recruitmentDemandsApi.list({ keyword: filters.keyword.trim() || undefined,
      status: filters.status || undefined, page: page.value, pageSize: pageSize.value });
    if (token !== listSession) return;
    rows.value = result.items; total.value = result.total;
  } catch (cause) { if (token === listSession) { rows.value = []; total.value = 0; loadError.value = demandErrorMessage(cause); } }
  finally { if (token === listSession) loading.value = false; }
}
async function loadConnection() {
  if (!canRead.value) return;
  const token = ++connectionSession;
  statusError.value = '';
  try { const result = await recruitmentDemandsApi.status(); if (token === connectionSession) connection.value = result; }
  catch (cause) { if (token === connectionSession) { connection.value = null; statusError.value = demandErrorMessage(cause); } }
}
function search() { page.value = 1; void loadList(); }
function resetFilters() { filters.keyword = ''; filters.status = ''; reset(); void loadList(); }
async function openDetail(row: RecruitmentDemandView) {
  if (!canRead.value || !await leave.prepareToLeave()) return;
  const token = ++detailSession;
  drawerOpen.value = true; selectedId.value = row.id; current.value = null; detailError.value = ''; mappingConflict.value = false; detailLoading.value = true;
  try { const result = await recruitmentDemandsApi.detail(row.id); if (token === detailSession) current.value = result; }
  catch (cause) { if (token === detailSession) detailError.value = demandErrorMessage(cause); }
  finally { if (token === detailSession) detailLoading.value = false; }
}
async function closeDetail(done?: () => void) {
  if (!await leave.prepareToLeave()) return;
  ++detailSession; drawerOpen.value = false; detailLoading.value = false; done?.();
}
async function reloadDetail() {
  const id = selectedId.value;
  if (!canRead.value || !id || saving.value) return;
  const token = ++detailSession;
  detailLoading.value = true; detailError.value = '';
  try {
    const result = await recruitmentDemandsApi.detail(id);
    if (token !== detailSession) return;
    current.value = result; mappingConflict.value = false;
  } catch (cause) { if (token === detailSession) detailError.value = demandErrorMessage(cause); }
  finally { if (token === detailSession) detailLoading.value = false; }
}
async function beginMapping() {
  if (!canEdit.value || !current.value || saving.value || detailLoading.value) return;
  mappingOpen.value = true; mappingConflict.value = false; directoryError.value = ''; detailError.value = '';
  Object.assign(mapping, { deptId: current.value.deptId || '', positionId: current.value.positionId || '', approvedHeadcount: current.value.approvedHeadcount ?? undefined, reason: '' });
  Object.keys(mappingErrors).forEach(key => { mappingErrors[key as keyof typeof mappingErrors] = ''; });
  await loadDirectories();
}
async function loadDirectories() {
  if (!canEdit.value) return;
  const token = detailSession;
  directoryLoading.value = true; directoryError.value = '';
  try { const result = await recruitmentDemandsApi.directories(); if (token === detailSession) directories.value = result; }
  catch (cause) { if (token === detailSession) directoryError.value = demandErrorMessage(cause); }
  finally { if (token === detailSession) directoryLoading.value = false; }
}
async function saveMapping() {
  const row = current.value;
  if (!canEdit.value || !row || !mappingOpen.value || saving.value || detailLoading.value || directoryLoading.value || directoryError.value || mappingConflict.value) return;
  mappingErrors.deptId = directories.value.departments.some(item => item.id === mapping.deptId) ? '' : '请选择有效的 HRM 部门';
  mappingErrors.positionId = directories.value.positions.some(item => item.id === mapping.positionId) ? '' : '请选择有效的 HRM 岗位';
  mappingErrors.approvedHeadcount = Number.isSafeInteger(mapping.approvedHeadcount) && mapping.approvedHeadcount! > 0 ? '' : '请核对并填写批准人数（正整数）';
  mappingErrors.reason = mapping.reason.trim() ? '' : '请填写核对依据';
  if (Object.values(mappingErrors).some(Boolean)) return;
  const token = detailSession;
  saving.value = true; detailError.value = ''; resultMessage.value = '';
  try {
    const result = await recruitmentDemandsApi.mapping(row.id, { expectedRevision: row.revision, deptId: mapping.deptId,
      positionId: mapping.positionId, approvedHeadcount: mapping.approvedHeadcount!, reason: mapping.reason.trim() });
    if (token !== detailSession) return;
    current.value = result; mappingOpen.value = false; resultMessage.value = '部门、岗位和人数已核对。';
    try {
      const detail = await recruitmentDemandsApi.detail(row.id);
      if (token !== detailSession) return;
      current.value = detail;
    } catch {
      if (token === detailSession) detailError.value = '核对结果已保存，但时间线读取失败，请刷新详情。';
    }
    await loadList();
  } catch (cause) {
    if (token === detailSession) { detailError.value = demandErrorMessage(cause); mappingConflict.value = (cause as { response?: { status?: number } }).response?.status === 409; }
  } finally { if (token === detailSession) saving.value = false; }
}
async function refreshSource() {
  const row = current.value;
  if (!canEdit.value || !row || saving.value || detailLoading.value || mappingOpen.value || !connection.value?.configured) return;
  const token = detailSession;
  saving.value = true; detailError.value = ''; resultMessage.value = '';
  try {
    await recruitmentDemandsApi.refresh(row.id);
    const result = await recruitmentDemandsApi.detail(row.id);
    if (token !== detailSession) return;
    current.value = result; resultMessage.value = '已读取最新原单，请核对审批状态、部门、岗位和人数。'; await loadList();
  } catch (cause) { if (token === detailSession) detailError.value = demandErrorMessage(cause); }
  finally { if (token === detailSession) saving.value = false; }
}
function syncStorageKey(actorId: string) { return `recruitment-demand-sync:${actorId}`; }
function persistSyncIntent(actorId: string, intent: SyncIntent | null) {
  try {
    if (intent) localStorage.setItem(syncStorageKey(actorId), JSON.stringify({ requestId: intent.requestId, from: intent.from, to: intent.to, cursor: intent.cursor }));
    else localStorage.removeItem(syncStorageKey(actorId));
    syncStorageError.value = '';
  } catch { syncStorageError.value = '浏览器无法保存或清理本次恢复记录。请勿刷新或关闭页面，先在当前页面核对本次同步。'; }
}
function businessDate(value: string) { return new Date(Date.parse(value) + 8 * 60 * 60 * 1000).toISOString().slice(0, 10); }
function restoreSyncIntent(actorId: string) {
  try {
    const raw = localStorage.getItem(syncStorageKey(actorId));
    if (!raw) return;
    const value = JSON.parse(raw) as Partial<SyncIntent>;
    if (!value || typeof value.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.requestId)
      || typeof value.from !== 'string' || typeof value.to !== 'string' || !Number.isFinite(Date.parse(value.from)) || !Number.isFinite(Date.parse(value.to))
      || Date.parse(value.from) > Date.parse(value.to) || !(value.cursor === null || (typeof value.cursor === 'string' && value.cursor.length > 0))) {
      syncStorageError.value = '本次同步恢复记录不可用，请核对已有同步结果，再显式另开一批。'; return;
    }
    syncIntent.value = { requestId: value.requestId, from: value.from, to: value.to, cursor: value.cursor };
    syncDates.value = [businessDate(value.from), businessDate(value.to)]; syncRecovering.value = true;
  } catch { syncStorageError.value = '无法读取本次同步恢复记录，请先核对已有同步结果。'; }
}
async function startNewSync() {
  const actorId = auth.user?.id, previousId = syncIntent.value?.requestId;
  if (!canEdit.value || !actorId || saving.value) return;
  if (syncIntent.value) {
    try { await ElMessageBox.confirm('另开一批将替换本机的恢复入口，不撤销已经同步的结果。要更换日期并另开一批吗？', '另开一批同步', { confirmButtonText: '另开一批', cancelButtonText: '保留本次', type: 'warning' }); }
    catch { return; }
  }
  if (auth.user?.id !== actorId || syncIntent.value?.requestId !== previousId || saving.value || !canEdit.value) return;
  persistSyncIntent(actorId, null); syncIntent.value = null; syncRecovering.value = false; syncDates.value = null; syncError.value = '';
}
async function syncSource() {
  const actorId = auth.user?.id;
  if (!canEdit.value || !actorId || saving.value || !connection.value?.configured) return;
  const dates = syncDates.value;
  syncError.value = dates?.length === 2 ? '' : '请选择原单创建时间范围';
  if (!dates || syncError.value) return;
  const from = new Date(`${dates[0]}T00:00:00+08:00`), to = new Date(`${dates[1]}T23:59:59.999+08:00`);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to) { syncError.value = '请选择有效的同步日期范围'; return; }
  if (syncIntent.value && (syncIntent.value.from !== from.toISOString() || syncIntent.value.to !== to.toISOString())) {
    syncError.value = '本批日期已固定，请先选择“另开一批同步”，不要沿用原批次。'; return;
  }
  const intent = syncIntent.value || { requestId: crypto.randomUUID(), from: from.toISOString(), to: to.toISOString(), cursor: null };
  syncIntent.value = intent; persistSyncIntent(actorId, intent);
  const token = ++syncSession;
  saving.value = true; syncBusy.value = true; resultMessage.value = '';
  try {
    const result = await recruitmentDemandsApi.sync({ requestId: intent.requestId, from: intent.from, to: intent.to, ...(intent.cursor ? { cursor: intent.cursor } : {}) });
    if (token !== syncSession || auth.user?.id !== actorId) return;
    if (result?.complete && result.failed === 0 && result.remaining === 0 && result.cursor === null) {
      syncOpen.value = false; syncIntent.value = null; syncRecovering.value = false; persistSyncIntent(actorId, null);
      resultMessage.value = `同步已完成，共 ${result.synced} 单，请核对审批状态、部门、岗位和人数。`;
    } else {
      syncIntent.value = { ...intent, cursor: typeof result?.cursor === 'string' && result.cursor ? result.cursor : result?.cursor === null ? null : intent.cursor };
      persistSyncIntent(actorId, syncIntent.value); syncRecovering.value = !syncIntent.value.cursor;
      syncError.value = result ? `同步未完成：已读取 ${result.synced} 单，失败 ${result.failed} 单，尚有 ${result.remaining} 单未处理。请核对后点击“${syncActionLabel.value}”。` : '未取得完整同步回执，请点击“恢复本次”核对并继续。';
    }
    await loadList();
  } catch (cause) {
    if (token === syncSession && auth.user?.id === actorId) { syncRecovering.value = true; syncError.value = `${demandErrorMessage(cause)} 本次批次已保留，请点击“恢复本次”，不要重复新建。`; }
  }
  finally { if (token === syncSession) { saving.value = false; syncBusy.value = false; } }
}
watch(() => auth.user?.id, actorId => {
  ++syncSession;
  if (syncBusy.value) { saving.value = false; syncBusy.value = false; }
  syncOpen.value = false; syncIntent.value = null; syncDates.value = null; syncRecovering.value = false; syncError.value = ''; syncStorageError.value = '';
  if (actorId) restoreSyncIntent(actorId);
}, { immediate: true });
watch(canRead, allowed => {
  if (allowed) { void loadList(); void loadConnection(); }
  else { ++listSession; ++detailSession; ++connectionSession; rows.value = []; total.value = 0; current.value = null; drawerOpen.value = false; mappingOpen.value = false; syncOpen.value = false; connection.value = null; }
}, { immediate: true });
onBeforeUnmount(() => { ++listSession; ++detailSession; ++connectionSession; ++syncSession; });
</script>

<template>
  <BusinessListPage variant="record" :loading="loading" class="recruitment-demands">
    <template #primary-action>
      <el-button v-if="returnTarget" @click="router.push(returnTarget)">返回当前应聘</el-button>
      <el-button v-if="canEdit" type="primary" :disabled="!connection?.configured || saving" @click="syncOpen = true">{{ syncIntent ? '恢复本次同步' : '同步钉钉需求' }}</el-button>
      <el-tooltip content="刷新招聘需求"><el-button :icon="Refresh" aria-label="刷新招聘需求" :loading="loading" @click="loadList(); loadConnection()" /></el-tooltip>
    </template>
    <template #filters>
      <QueryFilterPanel>
        <el-form :inline="true" @submit.prevent="search">
          <el-form-item label="关键字"><el-input v-model="filters.keyword" clearable placeholder="部门、岗位或单号" /></el-form-item>
          <el-form-item label="钉钉审批"><el-select v-model="filters.status" clearable placeholder="全部状态" aria-label="钉钉审批状态"><el-option v-for="(label, key) in DEMAND_SOURCE_LABELS" :key="key" :value="key" :label="label" /></el-select></el-form-item>
          <el-form-item><el-button type="primary" @click="search">查询</el-button><el-button @click="resetFilters">重置</el-button></el-form-item>
        </el-form>
      </QueryFilterPanel>
    </template>
    <template #feedback>
      <el-alert v-if="!canRead" title="当前无招聘查看权限" type="error" :closable="false" />
      <el-alert v-if="connection && !connection.configured" title="钉钉招聘需求接入未就绪" type="warning" :closable="false">
        <p>请由应用维护人员核对正式表单及只读接入配置。缺项：{{ connection.missing.join('、') || '接入配置待核实' }}。不能据空列表判断没有招聘需求。</p>
      </el-alert>
      <el-alert v-if="statusError" :title="statusError" type="error" :closable="false"><el-button link type="primary" @click="loadConnection">重试接入检查</el-button></el-alert>
      <el-alert v-if="loadError" :title="loadError" type="error" :closable="false"><el-button link type="primary" @click="loadList">重试列表</el-button></el-alert>
      <el-alert v-if="canEdit && syncIntent && !syncOpen" title="有一批招聘需求同步尚未完成或未取得回执，请恢复本次核对后继续。" type="warning" :closable="false" />
      <el-alert v-if="canEdit && syncStorageError" :title="syncStorageError" type="warning" :closable="false" />
      <el-alert v-if="resultMessage" :title="resultMessage" type="success" :closable="false" />
    </template>
    <template #desktop-list>
      <el-table v-loading="loading" :data="rows" height="100%" class="app-table" :empty-text="loadError ? '列表读取失败' : '暂无已同步招聘需求'">
        <el-table-column label="需求单 / 岗位" min-width="240"><template #default="{ row }"><strong>{{ row.positionName || row.rawPosition || '岗位待核对' }}</strong><div class="muted">{{ row.instanceId }}</div></template></el-table-column>
        <el-table-column label="部门" min-width="180"><template #default="{ row }">{{ row.departmentName || row.rawDepartment || '待核对' }}</template></el-table-column>
        <el-table-column label="批准人数" width="100"><template #default="{ row }">{{ row.approvedHeadcount === null ? '待核对' : row.approvedHeadcount ?? '—' }}</template></el-table-column>
        <el-table-column label="剩余名额" width="100"><template #default="{ row }">{{ describeDemandSeats(row).remaining }}</template></el-table-column>
        <el-table-column label="钉钉审批" width="120"><template #default="{ row }"><el-tag :type="row.sourceState === 'approved' ? 'success' : 'info'" size="small">{{ DEMAND_SOURCE_LABELS[row.sourceState as RecruitmentDemandSourceState] }}</el-tag></template></el-table-column>
        <el-table-column label="HRM 核对" min-width="170"><template #default="{ row }">{{ row.usable ? '已核对，可供选用' : '待核对或不可使用' }}</template></el-table-column>
        <el-table-column label="最近同步" width="170"><template #default="{ row }">{{ formatDate(row.lastSyncedAt) }}</template></el-table-column>
        <el-table-column label="操作" width="90" fixed="right"><template #default="{ row }"><el-button link type="primary" @click="openDetail(row as RecruitmentDemandView)">查看</el-button></template></el-table-column>
      </el-table>
    </template>
    <template #mobile-list>
      <div v-loading="loading" class="mobile-result-list-stack">
        <el-empty v-if="!loading && !rows.length && !loadError" description="暂无已同步招聘需求" />
        <MobileResultCard v-for="row in rows" :key="row.id">
          <template #title>{{ row.positionName || row.rawPosition || '岗位待核对' }}</template>
          <template #status><el-tag size="small">{{ DEMAND_SOURCE_LABELS[row.sourceState] }}</el-tag></template>
          <dl><dt>单号</dt><dd>{{ row.instanceId }}</dd><dt>部门</dt><dd>{{ row.departmentName || row.rawDepartment || '待核对' }}</dd><dt>批准人数</dt><dd>{{ row.approvedHeadcount === null ? '待核对' : row.approvedHeadcount ?? '—' }}</dd><dt>剩余名额</dt><dd>{{ describeDemandSeats(row).remaining }}</dd><dt>HRM 核对</dt><dd>{{ row.usable ? '已核对，可供选用' : '待核对或不可使用' }}</dd></dl>
          <template #actions><el-button link type="primary" @click="openDetail(row)">查看需求</el-button></template>
        </MobileResultCard>
      </div>
    </template>
    <template #pagination><ListPagination v-model:current-page="page" v-model:page-size="pageSize" :page-sizes="pageSizeOptions" :total="total" @change="loadList" /></template>
    <template #detail>
      <BusinessDetailDrawer v-model="drawerOpen" title="招聘需求详情" variant="standard" :loading="detailLoading" :saving="saving" :before-close="closeDetail">
        <el-alert v-if="detailError" :title="detailError" type="error" :closable="false"><el-button v-if="selectedId" link type="primary" :disabled="saving" @click="reloadDetail">刷新详情，保留核对输入</el-button></el-alert>
        <template v-if="current">
          <dl><dt>原单号</dt><dd>{{ current.instanceId }}</dd><dt>钉钉审批</dt><dd>{{ DEMAND_SOURCE_LABELS[current.sourceState] }}</dd><dt>批准时间</dt><dd>{{ current.approvedAt ? formatDate(current.approvedAt) : '未取得批准时间' }}</dd><dt>来源部门</dt><dd>{{ current.rawDepartment || '未取得' }}</dd><dt>来源岗位</dt><dd>{{ current.rawPosition || '未取得' }}</dd><dt>来源人数</dt><dd>{{ current.rawHeadcount || '未取得' }}</dd><dt>最近同步</dt><dd>{{ formatDate(current.lastSyncedAt) }} · 版本 {{ current.revision }}</dd><dt>钉钉原单</dt><dd><a v-if="sourceLink" :href="sourceLink" target="_blank" rel="noopener noreferrer">查看钉钉原单</a><span v-else>未提供可用的钉钉链接</span></dd></dl>
          <section class="mapping-section" aria-label="部门、岗位和人数核对">
            <h3>部门、岗位和人数核对</h3>
            <dl><dt>HRM 部门</dt><dd>{{ current.departmentName || '待核对' }}</dd><dt>HRM 岗位</dt><dd>{{ current.positionName || '待核对' }}</dd><dt>批准人数</dt><dd>{{ current.approvedHeadcount === null ? '待核对' : current.approvedHeadcount ?? '—' }}</dd><dt>可用状态</dt><dd>{{ current.usable ? '已核对，可供选用' : '待核对或不可使用' }}</dd></dl>
            <ul v-if="current.issues.length" class="issues"><li v-for="issue in current.issues" :key="issue">{{ issue }}</li></ul>
            <el-button v-if="canEdit && !mappingOpen" :disabled="saving || detailLoading" @click="beginMapping">核对部门、岗位和人数</el-button>
            <el-skeleton v-if="mappingOpen && canEdit && directoryLoading" :rows="3" animated aria-label="正在读取部门和岗位目录" />
            <el-form v-else-if="mappingOpen && canEdit" label-position="top" :disabled="saving || detailLoading" @submit.prevent="saveMapping">
              <el-alert v-if="directoryError" :title="directoryError" type="error" :closable="false"><el-button link type="primary" @click="loadDirectories">重试目录</el-button></el-alert>
              <el-form-item label="HRM 部门" required :error="mappingErrors.deptId"><el-select v-model="mapping.deptId" filterable aria-label="HRM 部门"><el-option v-for="dept in directories.departments" :key="dept.id" :value="dept.id" :label="dept.fullPath || dept.name" /></el-select></el-form-item>
              <el-form-item label="HRM 岗位" required :error="mappingErrors.positionId"><el-select v-model="mapping.positionId" filterable aria-label="HRM 岗位"><el-option v-for="job in directories.positions" :key="job.id" :value="job.id" :label="[job.code, job.name].filter(Boolean).join(' · ')" /></el-select></el-form-item>
              <el-form-item label="批准人数" required :error="mappingErrors.approvedHeadcount"><el-input-number v-model="mapping.approvedHeadcount" :min="1" :precision="0" :max="2147483647" aria-label="批准人数" /></el-form-item>
              <el-form-item label="核对依据" required :error="mappingErrors.reason"><el-input v-model="mapping.reason" type="textarea" :rows="3" maxlength="1000" show-word-limit /></el-form-item>
            </el-form>
          </section>
          <RecruitmentDemandSeats :value="current" />
          <RecruitmentDemandApplications :demand-id="current.id" />
          <section aria-label="需求时间线"><h3>需求时间线</h3><el-timeline v-if="current.events?.length"><el-timeline-item v-for="event in current.events" :key="event.id" :timestamp="formatDate(event.createdAt)"><div>{{ event.actorName || '系统' }} · {{ ({ map: '核对部门、岗位和人数', sync: '同步原单', sync_failed: '同步未完成', superseded: '被更正单替代' } as Record<string, string>)[event.action] || '需求更新' }} · 版本 {{ event.revision }}</div><p v-if="event.reason" class="event-reason">{{ event.reason }}</p></el-timeline-item></el-timeline><p v-else class="muted">暂无变更记录</p></section>
        </template>
        <template #footer><el-button :disabled="saving" @click="closeDetail()">关闭</el-button><el-button v-if="canEdit && current && !mappingOpen" :loading="saving" :disabled="!connection?.configured || detailLoading" @click="refreshSource">刷新钉钉原单</el-button><el-button v-if="canEdit && mappingOpen" type="primary" :loading="saving" :disabled="mappingConflict || detailLoading || directoryLoading || !!directoryError" @click="saveMapping">保存核对结果</el-button></template>
      </BusinessDetailDrawer>
      <el-dialog v-model="syncOpen" title="同步钉钉招聘需求" width="min(480px, 96vw)" :close-on-click-modal="false" :close-on-press-escape="!saving" :show-close="!saving" :before-close="async (done: () => void) => { if (await leave.prepareToLeave()) done(); }">
        <el-form label-position="top" :disabled="saving" @submit.prevent="syncSource"><el-form-item label="原单创建日期范围" required :error="syncError"><el-date-picker v-model="syncDates" :disabled="!!syncIntent" type="daterange" value-format="YYYY-MM-DD" start-placeholder="开始日期" end-placeholder="结束日期" /></el-form-item></el-form>
        <el-button v-if="syncIntent || syncStorageError" link type="primary" :disabled="saving" @click="startNewSync">另开一批同步</el-button>
        <el-alert v-if="syncStorageError" :title="syncStorageError" type="warning" :closable="false" />
        <template #footer><el-button :disabled="saving" @click="async () => { if (await leave.prepareToLeave()) syncOpen = false; }">{{ syncIntent ? '关闭，保留本次' : '取消' }}</el-button><el-button type="primary" :loading="saving" :disabled="!canEdit || !connection?.configured" @click="syncSource">{{ syncActionLabel }}</el-button></template>
      </el-dialog>
    </template>
  </BusinessListPage>
</template>

<style scoped>
.recruitment-demands { min-width: 0; }
.recruitment-demands :deep(.el-alert) { margin-bottom: 10px; }
.recruitment-demands :deep(.el-select) { min-width: 170px; max-width: 100%; }
.recruitment-demands :deep(.el-alert p) { margin: 6px 0; overflow-wrap: anywhere; }
.muted { font-size: 12px; color: var(--el-text-color-secondary); overflow-wrap: anywhere; }
.mobile-result-list-stack { display: grid; gap: 10px; }
dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 10px 12px; font-size: 13px; overflow-wrap: anywhere; }
dt { color: var(--el-text-color-secondary); } dd { margin: 0; }
h3 { font-size: 14px; margin: 0 0 12px; }
section { border-top: 1px solid var(--el-border-color-lighter); margin-top: 18px; padding-top: 16px; }
.issues { padding-left: 18px; font-size: 13px; color: var(--el-color-warning-dark-2); overflow-wrap: anywhere; }
.mapping-section :deep(.el-select) { width: 100%; }
.event-reason { white-space: pre-wrap; overflow-wrap: anywhere; }
@media (max-width: 768px) {
  .recruitment-demands :deep(.el-form--inline .el-form-item) { display: flex; margin-right: 0; }
  .recruitment-demands :deep(.el-select), .recruitment-demands :deep(.el-date-editor) { width: 100%; min-width: 0; }
}
</style>
