<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { goalChangesApi, goalChangeError, type GoalChangeTask } from '@/api/goal-changes.api';
import { usePagination } from '@/composables/usePagination';
import BusinessListPage from '@/components/common/business-list/BusinessListPage.vue';
import QueryFilterPanel from '@/components/common/QueryFilterPanel.vue';
import ListPagination from '@/components/common/ListPagination.vue';
import MobileResultCard from '@/components/common/MobileResultCard.vue';
import { grantLabels } from './goal-change-labels';

const tasks = ref<GoalChangeTask[]>([]);
const loading = ref(false), busyId = ref(''), error = ref('');
const filters = reactive({ cycleId: '', keyword: '' });
const { page, pageSize, pageSizeOptions } = usePagination({ defaultPageSize: 10 });
const cycles = computed(() => [...new Map(tasks.value.map(task => [task.cycleId, task.cycleName])).entries()]);
const filtered = computed(() => tasks.value.filter(task => (!filters.cycleId || task.cycleId === filters.cycleId)
  && `${task.employeeName} ${task.employeeNo || ''} ${task.cycleName}`.includes(filters.keyword.trim())));
const pageRows = computed(() => filtered.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value));
watch([() => filters.cycleId, () => filters.keyword, pageSize], () => { page.value = 1; });
watch(() => filtered.value.length, length => { page.value = Math.min(page.value, Math.max(1, Math.ceil(length / pageSize.value))); });

async function load() {
  loading.value = true; error.value = '';
  try {
    const result = await goalChangesApi.context();
    tasks.value = result.tasks.filter(task => task.canGrant);
  } catch (cause) { tasks.value = []; error.value = goalChangeError(cause, '授权范围读取失败'); }
  finally { loading.value = false; }
}
onMounted(load);
async function apply(task: GoalChangeTask, revoke = false) {
  if (busyId.value || !task.canGrant) return;
  if (revoke) {
    try {
      await ElMessageBox.confirm('撤销授权会同时撤销办理中的变更申请，原目标继续生效。', '撤销变更授权',
        { confirmButtonText: '撤销授权', cancelButtonText: '保留授权', type: 'warning' });
    } catch { return; }
  }
  busyId.value = task.id; error.value = '';
  try {
    if (revoke) await goalChangesApi.revokeGrant(task.id, task.grant!.revision);
    else await goalChangesApi.grant(task.id, task.grant?.revision);
    ElMessage.success(revoke ? '变更授权已撤销' : '变更授权已开放');
    await load();
  } catch (cause) { error.value = goalChangeError(cause, '授权操作失败，请刷新后核对'); }
  finally { busyId.value = ''; }
}
</script>

<template>
  <BusinessListPage variant="record" :loading="loading" class="goal-change-grants">
    <template #subtitle>按考核周期为员工开放目标变更。开放后，员工本人和该周期冻结的绩效直属上级可发起申请。</template>
    <template #filters>
      <QueryFilterPanel>
        <el-form inline @submit.prevent>
          <el-form-item label="考核周期"><el-select v-model="filters.cycleId" aria-label="考核周期" clearable placeholder="全部周期">
            <el-option v-for="[id, name] in cycles" :key="id" :label="name" :value="id" />
          </el-select></el-form-item>
          <el-form-item label="员工"><el-input v-model="filters.keyword" aria-label="搜索员工" clearable placeholder="姓名或工号" /></el-form-item>
          <el-form-item><el-button :loading="loading" @click="load">刷新</el-button></el-form-item>
        </el-form>
      </QueryFilterPanel>
    </template>
    <template #feedback>
      <div v-if="error" class="request-error" role="alert">{{ error }} <el-button link type="primary" @click="load">重新加载</el-button></div>
      <el-empty v-if="!loading && !error && !filtered.length" description="暂无可授权的考核任务" />
    </template>
    <template #desktop-list>
      <el-table :data="pageRows" class="app-table" height="100%">
        <el-table-column prop="employeeName" label="员工" min-width="120" />
        <el-table-column prop="employeeNo" label="工号" min-width="90" />
        <el-table-column prop="cycleName" label="考核周期" min-width="160" />
        <el-table-column prop="managerName" label="绩效直属上级" min-width="130" />
        <el-table-column label="授权状态" min-width="100"><template #default="{ row }">{{ row.grant ? grantLabels[row.grant.state as keyof typeof grantLabels] : '未开放' }}</template></el-table-column>
        <el-table-column label="操作" width="120" fixed="right"><template #default="{ row }">
          <el-button v-if="row.grant?.state === 'open'" link type="danger" :loading="busyId === row.id" @click="apply(row as GoalChangeTask, true)">撤销授权</el-button>
          <el-button v-else link type="primary" :loading="busyId === row.id" :disabled="Boolean(row.requestId)" @click="apply(row as GoalChangeTask)">开放变更</el-button>
        </template></el-table-column>
      </el-table>
    </template>
    <template #mobile-list><div class="mobile-stack">
      <MobileResultCard v-for="task in pageRows" :key="task.id">
        <template #title>{{ task.employeeName }} · {{ task.employeeNo || '无工号' }}</template>
        <template #status><el-tag size="small">{{ task.grant ? grantLabels[task.grant.state] : '未开放' }}</el-tag></template>
        <div>{{ task.cycleName }}</div><div>绩效直属上级：{{ task.managerName || '未配置' }}</div>
        <template #actions>
          <el-button v-if="task.grant?.state === 'open'" link type="danger" :loading="busyId === task.id" @click="apply(task, true)">撤销授权</el-button>
          <el-button v-else link type="primary" :loading="busyId === task.id" :disabled="Boolean(task.requestId)" @click="apply(task)">开放变更</el-button>
        </template>
      </MobileResultCard>
    </div></template>
    <template #pagination><ListPagination v-model:current-page="page" v-model:page-size="pageSize" :page-sizes="pageSizeOptions" :total="filtered.length" /></template>
  </BusinessListPage>
</template>

<style scoped>
.goal-change-grants { padding: 16px; }
.goal-change-grants :deep(.el-select) { width: 230px; }
.request-error { padding: 12px; color: var(--el-color-danger); overflow-wrap: anywhere; }
.mobile-stack { display: grid; gap: 10px; }
@media (max-width: 768px) {
  .goal-change-grants { padding: 10px; }
  .goal-change-grants :deep(.el-select), .goal-change-grants :deep(.el-form-item) { width: 100%; margin-right: 0; }
}
</style>
