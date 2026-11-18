<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { goalChangesApi, goalChangeError, type GoalChangeContext, type GoalChangeRow } from '@/api/goal-changes.api';
import { useAuthStore } from '@/stores/auth.store';
import { usePagination } from '@/composables/usePagination';
import { formatDateTime } from '@/utils/date';
import PerformanceWorkspace from '@/components/performance/PerformanceWorkspace.vue';
import BusinessListPage from '@/components/common/business-list/BusinessListPage.vue';
import QueryFilterPanel from '@/components/common/QueryFilterPanel.vue';
import ListPagination from '@/components/common/ListPagination.vue';
import MobileResultCard from '@/components/common/MobileResultCard.vue';
import { grantLabels, statusLabels } from './goal-change-labels';

const route = useRoute(), router = useRouter(), auth = useAuthStore();
const context = ref<GoalChangeContext | null>(null), rows = ref<GoalChangeRow[]>([]);
const contextError = ref(''), listError = ref(''), dialogError = ref('');
const loading = ref(false), contextLoading = ref(false), busy = ref(false);
const scope = ref('self');
const filters = reactive({ keyword: '', status: '' });
const { page, pageSize, pageSizeOptions } = usePagination({ defaultPageSize: 10 });
const dialog = ref(false);
const selection = reactive({ taskId: '' });
let contextSession = 0, listSession = 0, dialogSession = 0, alive = true;
onBeforeUnmount(() => { alive = false; contextSession++; listSession++; dialogSession++; });

const tasks = computed(() => context.value?.tasks ?? []);
const selectedTask = computed(() => tasks.value.find(task => task.id === selection.taskId));
const startTasks = computed(() => tasks.value.filter(task => task.canStart && (scope.value === 'self'
  ? task.employeeId === auth.user?.id : scope.value === 'team' ? task.managerId === auth.user?.id : true)));
const filteredRows = computed(() => rows.value.filter(row => {
  const inScope = scope.value === 'review' ? row.allowedActions.includes('decide')
    : scope.value === 'all' ? true
      : scope.value === 'team' ? row.managerId === auth.user?.id && row.employeeId !== auth.user?.id
        : row.employeeId === auth.user?.id;
  return inScope && (!filters.status || row.status === filters.status)
    && `${row.employeeName} ${row.cycleName} ${row.reason} ${row.creatorName}`.includes(filters.keyword.trim());
}));
const pageRows = computed(() => filteredRows.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value));
watch([scope, () => filters.keyword, () => filters.status, pageSize], () => { page.value = 1; });
watch(() => filteredRows.value.length, length => { page.value = Math.min(page.value, Math.max(1, Math.ceil(length / pageSize.value))); });
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
  const token = ++listSession;
  loading.value = true; listError.value = '';
  try {
    const result = await goalChangesApi.list();
    if (alive && token === listSession) rows.value = result;
  } catch (error) {
    if (alive && token === listSession) listError.value = goalChangeError(error, '目标变更列表读取失败');
  } finally { if (alive && token === listSession) loading.value = false; }
}
async function refresh() { await Promise.all([loadContext(), loadList()]); }
onMounted(refresh);
function openDetail(id: string) { void router.push({ name: 'GoalChangeDetail', params: { id }, query: route.query }); }
function openDialog() { dialogSession++; dialogError.value = ''; selection.taskId = ''; dialog.value = true; }
async function start() {
  const task = selectedTask.value, token = dialogSession, path = route.fullPath;
  dialogError.value = '';
  if (!task || !startTasks.value.some(item => item.id === task.id)) { dialogError.value = '请选择可发起变更的考核任务'; return; }
  if (busy.value) return;
  busy.value = true;
  try {
    const created = await goalChangesApi.create(task.id);
    if (!alive || token !== dialogSession || route.fullPath !== path) return;
    dialog.value = false; openDetail(created.id); void refresh();
  } catch (error) {
    if (alive && token === dialogSession && route.fullPath === path) dialogError.value = goalChangeError(error, '发起失败，请刷新任务范围核对是否已创建');
  } finally { if (alive && token === dialogSession) busy.value = false; }
}
function closeDialog(done: () => void) { if (!busy.value) { dialogSession++; done(); } }
</script>

<template>
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
          <el-tab-pane label="我的变更" name="self" /><el-tab-pane label="团队变更" name="team" />
          <el-tab-pane label="待我审核" name="review" /><el-tab-pane label="相关记录" name="all" />
        </el-tabs>
        <QueryFilterPanel>
          <el-form inline @submit.prevent="page = 1">
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
        <div v-if="listError" class="request-error" role="alert" data-testid="goal-change-list-error">
          {{ listError }} <el-button link type="primary" @click="loadList">重试变更列表</el-button>
        </div>
        <el-empty v-if="!loading && !contextLoading && !listError && !contextError && !filteredRows.length" description="暂无目标变更" />
      </template>
      <template #desktop-list>
        <el-table v-if="!listError" :data="pageRows" height="100%" class="app-table">
          <el-table-column prop="employeeName" label="员工" min-width="120" />
          <el-table-column prop="cycleName" label="考核周期" min-width="160" />
          <el-table-column label="当前环节" min-width="170"><template #default="{ row }">{{ statusLabels[row.status as keyof typeof statusLabels] || row.status }}</template></el-table-column>
          <el-table-column prop="creatorName" label="发起人" min-width="100" />
          <el-table-column prop="reason" label="变更原因" min-width="180" show-overflow-tooltip />
          <el-table-column label="更新时间" width="165"><template #default="{ row }">{{ formatDateTime(row.updatedAt) }}</template></el-table-column>
          <el-table-column label="操作" width="80" fixed="right"><template #default="{ row }"><el-button link type="primary" @click="openDetail(row.id)">查看</el-button></template></el-table-column>
        </el-table>
      </template>
      <template #mobile-list>
        <div v-if="!listError" class="mobile-stack">
          <MobileResultCard v-for="row in pageRows" :key="row.id">
            <template #title>{{ row.employeeName }}</template><template #status><el-tag size="small">{{ statusLabels[row.status] }}</el-tag></template>
            <div class="mobile-result-field"><span>考核周期</span><span>{{ row.cycleName }}</span></div>
            <div class="mobile-result-field"><span>发起人</span><span>{{ row.creatorName }}</span></div>
            <div class="mobile-result-field"><span>变更原因</span><span>{{ row.reason || '未填写' }}</span></div>
            <template #actions><el-button link type="primary" @click="openDetail(row.id)">查看</el-button></template>
          </MobileResultCard>
        </div>
      </template>
      <template #pagination><ListPagination v-model:current-page="page" v-model:page-size="pageSize" :page-sizes="pageSizeOptions" :total="filteredRows.length" /></template>
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
            <el-button type="primary" :loading="busy" @click="start">开始填写</el-button>
          </template>
        </el-dialog>
      </template>
    </BusinessListPage>
  </PerformanceWorkspace>
</template>

<style scoped>
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
