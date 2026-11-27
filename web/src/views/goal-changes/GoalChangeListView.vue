<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { goalChangesApi, goalChangeError, type GoalChangeContext, type GoalChangeRow } from '@/api/goal-changes.api';
import { useAuthStore } from '@/stores/auth.store';
import { usePagination } from '@/composables/usePagination';
import { formatDateTime } from '@/utils/date';
import PerformanceWorkspace from '@/components/performance/PerformanceWorkspace.vue';
import PerformanceTaskNavigation from '@/components/performance/PerformanceTaskNavigation.vue';
import { canMonitorGoals } from '@/api/goal-plans.api';
import BusinessListPage from '@/components/common/business-list/BusinessListPage.vue';
import QueryFilterPanel from '@/components/common/QueryFilterPanel.vue';
import ListPagination from '@/components/common/ListPagination.vue';
import MobileResultCard from '@/components/common/MobileResultCard.vue';
import { grantLabels, statusLabels } from './goal-change-labels';
import { canViewLifecycleHistory, lifecycleLabel, parseLifecycleFilter, type LifecycleFilter } from '@/api/performance-lifecycle.api';

const route = useRoute(), router = useRouter(), auth = useAuthStore();
const context = ref<GoalChangeContext | null>(null), rows = ref<GoalChangeRow[]>([]);
const pendingRows = ref<GoalChangeRow[]>([]), listTotal = ref(0);
const contextError = ref(''), listError = ref(''), pendingError = ref(''), dialogError = ref('');
const loading = ref(false), contextLoading = ref(false), busy = ref(false);
const requestedScope = route.query.scope;
const scope = ref(typeof requestedScope === 'string' && ['self', 'team', 'all', 'pending', 'review'].includes(requestedScope)
  ? requestedScope : 'self');
const filters = reactive({ keyword: '', status: '' });
const lifecycleStatus = ref<LifecycleFilter | ''>(parseLifecycleFilter(route.query.lifecycleStatus));
const canViewHistory = computed(() => canViewLifecycleHistory(auth.user));
const { page, pageSize, pageSizeOptions } = usePagination({ defaultPageSize: 10 });
const dialog = ref(false);
const createdId = ref('');
const selection = reactive({ taskId: '' });
let contextSession = 0, listSession = 0, pendingSession = 0, dialogSession = 0, alive = true;
let filterTimer: ReturnType<typeof setTimeout> | undefined;
onBeforeUnmount(() => { alive = false; contextSession++; listSession++; pendingSession++; dialogSession++; clearTimeout(filterTimer); });

const tasks = computed(() => context.value?.tasks ?? []);
const selectedTask = computed(() => tasks.value.find(task => task.id === selection.taskId));
const startTasks = computed(() => tasks.value.filter(task => task.canStart && (scope.value === 'self'
  ? task.employeeId === auth.user?.id : scope.value === 'team' ? task.managerId === auth.user?.id : true)));
const queueScope = computed(() => scope.value === 'pending' || scope.value === 'review');
const filteredRows = computed(() => (queueScope.value ? pendingRows.value : rows.value).filter(row => {
  if (!queueScope.value) return true;
  return (scope.value !== 'review' || row.allowedActions.includes('decide'))
    && (!filters.status || row.status === filters.status)
    && `${row.employeeName} ${row.cycleName} ${row.reason} ${row.creatorName}`.includes(filters.keyword.trim());
}));
const pageRows = computed(() => queueScope.value ? filteredRows.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value) : rows.value);
const totalRows = computed(() => queueScope.value ? filteredRows.value.length : listTotal.value);
watch([scope, () => filters.keyword, () => filters.status, lifecycleStatus, pageSize, page], (values, previous) => {
  if (values.slice(0, 5).some((value, index) => value !== previous[index]) && page.value !== 1) { page.value = 1; return; }
  ++listSession;
  clearTimeout(filterTimer);
  if (queueScope.value) { loading.value = false; return; }
  filterTimer = setTimeout(() => void loadList(), values[1] !== previous[1] ? 250 : 0);
});
watch(() => totalRows.value, length => { page.value = Math.min(page.value, Math.max(1, Math.ceil(length / pageSize.value))); });
watch(() => selection.taskId, () => { dialogError.value = ''; });
watch(() => route.fullPath, () => { dialogSession++; dialog.value = false; busy.value = false; });

async function loadContext() {
  const token = ++contextSession;
  contextLoading.value = true; contextError.value = '';
  try {
    const result = await goalChangesApi.context();
    if (alive && token === contextSession) context.value = result;
  } catch (error) {
    if (alive && token === contextSession) { context.value = null; contextError.value = goalChangeError(error, '任务范围读取失败'); }
  } finally { if (alive && token === contextSession) contextLoading.value = false; }
}
async function loadList() {
  if (queueScope.value) { ++listSession; loading.value = false; return; }
  const token = ++listSession;
  loading.value = true; listError.value = '';
  try {
    const result = await goalChangesApi.page({ scope: scope.value as 'self' | 'team' | 'all', page: page.value,
      ...(lifecycleStatus.value ? { lifecycleStatus: lifecycleStatus.value } : {}),
      pageSize: pageSize.value, ...(filters.status ? { status: filters.status } : {}),
      ...(filters.keyword.trim() ? { keyword: filters.keyword.trim() } : {}) });
    if (alive && token === listSession) { rows.value = result.items; listTotal.value = result.total; }
  } catch (error) {
    if (alive && token === listSession) listError.value = goalChangeError(error, '目标变更列表读取失败');
  } finally { if (alive && token === listSession) loading.value = false; }
}
async function loadPending() {
  const token = ++pendingSession;
  pendingError.value = '';
  try {
    const result = await goalChangesApi.myPending();
    if (alive && token === pendingSession) {
      pendingRows.value = result;
      if (result.length && scope.value === 'self') scope.value = 'pending';
    }
  } catch (error) {
    if (alive && token === pendingSession) pendingError.value = goalChangeError(error, '待我处理读取失败');
  }
}
async function refresh() { await Promise.all([loadContext(), loadList(), loadPending()]); }
onMounted(refresh);
function openDetail(id: string) { void router.push({ name: 'GoalChangeDetail', params: { id }, query: route.query }); }
function openDialog() { dialogSession++; dialogError.value = ''; createdId.value = ''; selection.taskId = ''; dialog.value = true; }
async function start() {
  const task = selectedTask.value, token = dialogSession, path = route.fullPath;
  dialogError.value = '';
  if (!createdId.value && (!task || !startTasks.value.some(item => item.id === task.id))) { dialogError.value = '请选择可发起变更的考核任务'; return; }
  if (busy.value) return;
  busy.value = true;
  try {
    if (!createdId.value) createdId.value = (await goalChangesApi.create(task!.id)).id;
    if (!alive || token !== dialogSession || route.fullPath !== path) return;
    await router.push({ name: 'GoalChangeDetail', params: { id: createdId.value }, query: route.query });
    if (route.fullPath === path) throw new Error('变更已创建，但详情未打开；请点击“查看已创建的变更”重试');
    void refresh();
  } catch (error) {
    if (alive && token === dialogSession && route.fullPath === path) dialogError.value = goalChangeError(error, '发起失败，请刷新任务范围核对是否已创建');
  } finally { if (alive && token === dialogSession) busy.value = false; }
}
function closeDialog(done: () => void) { if (!busy.value) { dialogSession++; done(); } }
</script>

<template>
  <div class="performance-task-page">
  <PerformanceTaskNavigation active="changes" :can-monitor="canMonitorGoals(auth.user)" />
  <div class="performance-task-page__body">
  <PerformanceWorkspace title="目标变更" active-section="changes" :show-context="false">
    <template #toolbar>
      <span class="goal-changes-toolbar-label">变更申请与记录</span>
    </template>
    <template #actions>
      <el-button v-if="startTasks.length" type="primary" :disabled="contextLoading" @click="openDialog">发起变更</el-button>
    </template>
    <BusinessListPage variant="workflow" :loading="loading || contextLoading" class="goal-changes-list">
      <template #filters>
        <el-tabs v-model="scope" aria-label="变更范围">
          <el-tab-pane :label="`待我处理（${pendingRows.length}）`" name="pending" />
          <el-tab-pane label="我的变更" name="self" /><el-tab-pane label="团队变更" name="team" />
          <el-tab-pane label="待我审核" name="review" /><el-tab-pane label="相关记录" name="all" />
        </el-tabs>
        <QueryFilterPanel>
          <el-form inline @submit.prevent="page = 1">
            <el-form-item v-if="!queueScope" label="记录范围"><el-select v-model="lifecycleStatus" aria-label="记录范围">
              <el-option label="当前记录" value="" /><el-option label="未终止" value="active" /><el-option label="已终止" value="terminated" />
              <el-option v-if="canViewHistory" label="历史记录（含已删除）" value="all" /><el-option v-if="canViewHistory" label="已删除" value="deleted" />
            </el-select></el-form-item>
            <el-form-item label="状态"><el-select v-model="filters.status" aria-label="状态" clearable placeholder="全部状态">
              <el-option v-for="(label, value) in statusLabels" :key="value" :label="label" :value="value" />
            </el-select></el-form-item>
            <el-form-item label="关键字"><el-input v-model="filters.keyword" aria-label="关键字" clearable placeholder="员工、周期、原因" /></el-form-item>
            <el-form-item><el-button :loading="loading || contextLoading" @click="refresh">刷新</el-button></el-form-item>
          </el-form>
        </QueryFilterPanel>
      </template>
      <template #feedback>
        <div v-if="contextError" class="request-error" role="alert" data-testid="goal-change-context-error">
          {{ contextError }} <el-button link type="primary" @click="loadContext">重试任务范围</el-button>
        </div>
        <div v-if="!queueScope && listError" class="request-error" role="alert" data-testid="goal-change-list-error">
          {{ listError }} <el-button link type="primary" @click="loadList">重试变更列表</el-button>
        </div>
        <div v-if="queueScope && pendingError" class="request-error" role="alert" data-testid="goal-change-pending-error">
          {{ pendingError }} <el-button link type="primary" @click="loadPending">重试待我处理</el-button>
        </div>
        <el-empty v-if="!loading && !contextLoading && !(queueScope ? pendingError : listError) && !contextError && !totalRows" :description="queueScope ? '当前没有待我处理的目标变更' : '暂无目标变更'" />
      </template>
      <template #desktop-list>
        <el-table v-if="!(queueScope ? pendingError : listError)" :data="pageRows" height="100%" class="app-table">
          <el-table-column prop="employeeName" label="员工" min-width="120" />
          <el-table-column prop="cycleName" label="考核周期" min-width="160" />
          <el-table-column label="当前环节" min-width="170"><template #default="{ row }"><el-tag v-if="lifecycleLabel(row)" size="small" type="info">{{ lifecycleLabel(row) }}</el-tag> {{ statusLabels[row.status as keyof typeof statusLabels] || row.status }}</template></el-table-column>
          <el-table-column prop="creatorName" label="发起人" min-width="100" />
          <el-table-column prop="reason" label="变更原因" min-width="180" show-overflow-tooltip />
          <el-table-column label="更新时间" width="165"><template #default="{ row }">{{ formatDateTime(row.updatedAt) }}</template></el-table-column>
          <el-table-column label="操作" width="80" fixed="right"><template #default="{ row }"><el-button link type="primary" @click="openDetail(row.id)">查看</el-button></template></el-table-column>
        </el-table>
      </template>
      <template #mobile-list>
        <div v-if="!(queueScope ? pendingError : listError)" class="mobile-stack">
          <MobileResultCard v-for="row in pageRows" :key="row.id">
            <template #title>{{ row.employeeName }}</template><template #status><el-tag size="small">{{ lifecycleLabel(row) || statusLabels[row.status] }}</el-tag></template>
            <div class="mobile-result-field"><span>考核周期</span><span>{{ row.cycleName }}</span></div>
            <div class="mobile-result-field"><span>发起人</span><span>{{ row.creatorName }}</span></div>
            <div class="mobile-result-field"><span>变更原因</span><span>{{ row.reason || '未填写' }}</span></div>
            <template #actions><el-button link type="primary" @click="openDetail(row.id)">查看</el-button></template>
          </MobileResultCard>
        </div>
      </template>
      <template #pagination><ListPagination v-model:current-page="page" v-model:page-size="pageSize" :page-sizes="pageSizeOptions" :total="totalRows" /></template>
      <template #detail>
        <RouterView v-slot="{ Component }"><component :is="Component" @changed="refresh" /></RouterView>
        <el-dialog :model-value="dialog" title="发起目标变更" width="min(520px, 96vw)"
          :before-close="closeDialog" :close-on-click-modal="false" :show-close="!busy" :close-on-press-escape="!busy"
          @update:model-value="value => { if (!value) dialog = false; }">
          <el-form label-position="top">
            <el-form-item label="考核任务" required><el-select v-model="selection.taskId" aria-label="考核任务" filterable :disabled="busy" placeholder="选择已开放的任务">
              <el-option v-for="task in startTasks" :key="task.id" :value="task.id" :label="`${task.employeeName} · ${task.cycleName}`" />
            </el-select></el-form-item>
            <dl v-if="selectedTask" class="task-summary"><dt>冻结绩效直属上级</dt><dd>{{ selectedTask.managerName || '未配置' }}</dd>
              <dt>变更资格</dt><dd>{{ selectedTask.grant ? grantLabels[selectedTask.grant.state] : '未开放' }}</dd></dl>
            <div v-if="dialogError" class="request-error" role="alert">{{ dialogError }}</div>
          </el-form>
          <template #footer>
            <el-button type="primary" :loading="busy" @click="start">{{ createdId ? '查看已创建的变更' : '开始填写' }}</el-button>
          </template>
        </el-dialog>
      </template>
    </BusinessListPage>
  </PerformanceWorkspace>
  </div>
  </div>
</template>

<style scoped>
.performance-task-page { display:flex; flex-direction:column; width:100%; height:100%; min-width:0; min-height:0; }
.performance-task-page__body { flex:1; min-width:0; min-height:0; overflow:auto; }
.goal-changes-list { padding: 16px; }
.goal-changes-toolbar-label { color: #4d576b; font-size: 13px; white-space: nowrap; }
.goal-changes-list :deep(.el-select) { width: 200px; }
.request-error { padding: 12px; color: var(--el-color-danger); overflow-wrap: anywhere; }
.mobile-stack { display: grid; gap: 10px; }
.mobile-result-field { gap: 12px; }
.mobile-result-field span:last-child { min-width: 0; text-align: right; overflow-wrap: anywhere; }
.task-summary { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 10px; }
.task-summary dd { margin: 0; overflow-wrap: anywhere; }
@media(max-width:768px) { .goal-changes-list { padding: 10px; } .goal-changes-list :deep(.el-form-item), .goal-changes-list :deep(.el-select) { width: 100%; margin-right: 0; } }
</style>
