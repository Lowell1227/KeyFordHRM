<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { isAxiosError } from 'axios';
import { ElMessage } from 'element-plus';
import { improvementPlansApi } from '@/api/improvement-plans.api';
import { departmentsApi } from '@/api/departments.api';
import { usePagination } from '@/composables/usePagination';
import { IMPROVEMENT_PLAN_STATUS_META, type ImprovementPlanStatus } from '@/types/enums';
import { formatDate } from '@/utils/date';
import ChartCard from '@/components/common/ChartCard.vue';
import EmptyState from '@/components/common/EmptyState.vue';
import ListPagination from '@/components/common/ListPagination.vue';
import MobileResultCard from '@/components/common/MobileResultCard.vue';
import PerformanceLifecycleActions from '@/views/task/components/PerformanceLifecycleActions.vue';
import PerformanceRecordFilters from '@/components/common/PerformanceRecordFilters.vue';
import BusinessDetailDrawer from '@/components/common/business-list/BusinessDetailDrawer.vue';
import BusinessListPage from '@/components/common/business-list/BusinessListPage.vue';
import type { Department, ImprovementGoal, ImprovementPlan } from '@/types/api.types';
import { applyLifecycleProjection, canViewLifecycleHistory, lifecycleLabel, parseLifecycleFilter, type LifecycleFilter } from '@/api/performance-lifecycle.api';
import { useAuthStore } from '@/stores/auth.store';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const canViewHistory = computed(() => canViewLifecycleHistory(auth.user));
const lifecycleStatus = ref<LifecycleFilter | ''>(parseLifecycleFilter(route.query.lifecycleStatus));
const list = ref<ImprovementPlan[]>([]);
const cycles = ref<Array<{ id: string; name: string }>>([]);
const departments = ref<Department[]>([]);
const eligibleEmployees = ref<Array<{ id: string; name: string; employeeNo: string | null; deptName: string | null }>>([]);
const loading = ref(false);
const creating = ref(false);
const createOpen = ref(false);
const showCreateWeightErrors = ref(false);
const createError = ref('');
const eligibilityLoaded = ref(false);
const queryKeys = ['cycles', 'departments', 'eligible-employees', 'list'] as const;
type QueryKey = typeof queryKeys[number];
const queryErrors = reactive<Record<QueryKey, string>>({ cycles: '', departments: '', 'eligible-employees': '', list: '' });
const queryLoading = reactive<Record<QueryKey, boolean>>({ cycles: false, departments: false, 'eligible-employees': false, list: false });
const queryGenerations: Record<QueryKey, number> = { cycles: 0, departments: 0, 'eligible-employees': 0, list: 0 };
const queryLabels: Record<QueryKey, string> = { cycles: '关联周期', departments: '部门', 'eligible-employees': '可发起改进计划的员工', list: '改进计划列表' };
let disposed = false;
let createGeneration = 0;
const filters = reactive<{ cycleId: string; deptId: string; status: ImprovementPlanStatus | ''; keyword: string }>({
  cycleId: '', deptId: '', status: '', keyword: '',
});
const draft = reactive<{ employeeId: string; cycleId: string; improvementNeed: string; targetDate: string; goals: ImprovementGoal[] }>({
  employeeId: '', cycleId: '', improvementNeed: '', targetDate: '', goals: [],
});
const { page, pageSize, total, reset: resetPagination, withParams } = usePagination({ defaultPageSize: 10 });
const statuses = Object.keys(IMPROVEMENT_PLAN_STATUS_META) as ImprovementPlanStatus[];
const createWeightTotal = computed(() => draft.goals.reduce((sum, goal) => sum + Number(goal.weight || 0), 0));
const createWeightTotalError = computed(() => showCreateWeightErrors.value && draft.goals.every(isGoalWeightValid)
  && Math.abs(createWeightTotal.value - 100) > 0.001
  ? `当前合计 ${createWeightTotal.value}%，权重合计必须为 100%` : '');
const createEmployeeError = computed(() => showCreateWeightErrors.value && !draft.employeeId ? '请选择员工' : '');
const detailOpen = computed(() => route.name === 'ImprovementPlanDetail');
const detailOpenedFromList = ref(false);

onMounted(() => {
  void loadReference('cycles');
  void loadReference('departments');
  void loadReference('eligible-employees');
  void loadList();
});
onBeforeUnmount(() => { disposed = true; createGeneration += 1; });
watch(createOpen, () => { createGeneration += 1; creating.value = false; }, { flush: 'sync' });
watch(() => route.fullPath, () => { createOpen.value = false; createGeneration += 1; }, { flush: 'sync' });

function queryCurrent(key: QueryKey, generation: number) {
  return !disposed && queryGenerations[key] === generation;
}
function queryFailure(key: QueryKey, error: unknown) {
  return isAxiosError(error) && error.response?.status === 403 ? `无权查询${queryLabels[key]}` : `${queryLabels[key]}加载失败`;
}
async function loadReference(key: Exclude<QueryKey, 'list'>) {
  const generation = ++queryGenerations[key];
  queryLoading[key] = true;
  queryErrors[key] = '';
  try {
    if (key === 'cycles') {
      const result = await improvementPlansApi.cycles();
      if (queryCurrent(key, generation)) cycles.value = result;
    } else if (key === 'departments') {
      const result = await departmentsApi.findAll({ isActive: true, pageSize: 1000 });
      if (queryCurrent(key, generation)) departments.value = result;
    } else {
      const result = await improvementPlansApi.eligibleEmployees();
      if (queryCurrent(key, generation)) { eligibleEmployees.value = result; eligibilityLoaded.value = true; }
    }
  } catch (error) {
    if (queryCurrent(key, generation)) queryErrors[key] = queryFailure(key, error);
  } finally { if (queryCurrent(key, generation)) queryLoading[key] = false; }
}
function retryQuery(key: QueryKey) { return key === 'list' ? loadList() : loadReference(key); }

async function loadList() {
  const generation = ++queryGenerations.list;
  loading.value = true;
  queryLoading.list = true;
  queryErrors.list = '';
  list.value = [];
  total.value = 0;
  try {
    const result = await improvementPlansApi.findAll(withParams({
      cycleId: filters.cycleId || undefined, deptId: filters.deptId || undefined,
      status: filters.status || undefined, keyword: filters.keyword || undefined,
      lifecycleStatus: lifecycleStatus.value || undefined,
    }));
    if (queryCurrent('list', generation)) {
      const lastPage = Math.max(1, Math.ceil(result.total / pageSize.value));
      if (page.value > lastPage) { page.value = lastPage; await loadList(); return; }
      list.value = result.items; total.value = result.total;
    }
  } catch (error) {
    if (queryCurrent('list', generation)) queryErrors.list = queryFailure('list', error);
  } finally { if (queryCurrent('list', generation)) { loading.value = false; queryLoading.list = false; } }
}
function search() { resetPagination(); void loadList(); }
function reset() { lifecycleStatus.value = ''; Object.assign(filters, { cycleId: '', deptId: '', status: '', keyword: '' }); search(); }
function openCreate() {
  if (!eligibilityLoaded.value || queryLoading['eligible-employees'] || queryErrors['eligible-employees'] || !eligibleEmployees.value.length) return;
  Object.assign(draft, { employeeId: '', cycleId: '', improvementNeed: '', targetDate: '', goals: [] });
  showCreateWeightErrors.value = false;
  createError.value = '';
  addGoal();
  createOpen.value = true;
}
function addGoal() { draft.goals.push({ id: crypto.randomUUID(), name: '', description: '', weight: 0 }); }
function removeGoal(index: number) { draft.goals.splice(index, 1); }
function isGoalWeightValid(goal: ImprovementGoal) {
  const weight = Number(goal.weight);
  return Number.isFinite(weight) && weight > 0 && weight <= 100;
}
function goalWeightError(goal: ImprovementGoal) {
  if (!showCreateWeightErrors.value) return '';
  return isGoalWeightValid(goal) ? '' : '权重须大于 0 且不超过 100%';
}
async function saveDraft() {
  if (creating.value || !createOpen.value) return;
  showCreateWeightErrors.value = true;
  if (createEmployeeError.value || draft.goals.some((goal) => goalWeightError(goal)) || createWeightTotalError.value) return;
  creating.value = true;
  createError.value = '';
  const session = { generation: createGeneration, path: route.fullPath };
  const isCurrent = () => !disposed && createOpen.value && session.generation === createGeneration && session.path === route.fullPath;
  try {
    const created = await improvementPlansApi.create({
      employeeId: draft.employeeId, cycleId: draft.cycleId || null,
      improvementNeed: draft.improvementNeed, targetDate: draft.targetDate || null,
      goals: draft.goals.map((goal) => ({ ...goal })),
    });
    if (!isCurrent()) return;
    createOpen.value = false;
    ElMessage.success('草稿已保存，请检查目标后正式提交');
    openDetail(created.id);
  } catch (error) {
    if (isCurrent()) createError.value = isAxiosError(error) && error.response?.status === 403 ? '无权为此员工发起改进计划'
      : '草稿保存失败，输入已保留，请重试';
  } finally { if (isCurrent()) creating.value = false; }
}
function statusLabel(status: ImprovementPlanStatus) { return IMPROVEMENT_PLAN_STATUS_META[status]?.label ?? status; }
function scoreLabel(item: ImprovementPlan) {
  return item.finalScore == null ? '-' : item.workflowVersion === 1
    ? `${item.finalScore} / 10（历史）` : `${item.finalScore} / 100`;
}
function openDetail(id: string) {
  detailOpenedFromList.value = true;
  void router.push({ name: 'ImprovementPlanDetail', params: { id }, query: route.query });
}
function closeDetail() {
  if (detailOpenedFromList.value) {
    detailOpenedFromList.value = false;
    router.back();
    return;
  }
  void router.replace({ name: 'ImprovementPlans', query: route.query });
}
function handleDetailVisibility(value: boolean) {
  if (!value && detailOpen.value) closeDetail();
}
function goDetail(id: string) { openDetail(id); }
</script>

<template>
  <BusinessListPage variant="workflow" :loading="loading" class="improvement-list">
    <template #workspace>
    <ChartCard class="list-page-header-card">
      <template #extra><el-button v-if="eligibilityLoaded && !queryErrors['eligible-employees'] && eligibleEmployees.length" type="primary" :disabled="queryLoading['eligible-employees']" @click="openCreate">新建改进计划</el-button></template>
      <PerformanceRecordFilters v-model:cycle-id="filters.cycleId" v-model:dept-id="filters.deptId"
        v-model:keyword="filters.keyword" :cycles="cycles" :departments="departments" :loading="loading"
        allow-all-cycles @search="search" @reset="reset">
        <div class="performance-record-filter-extra">
          <el-select v-model="lifecycleStatus" aria-label="记录范围" style="width: 200px">
            <el-option label="当前记录" value="" /><el-option label="未终止" value="active" /><el-option label="已终止" value="terminated" />
            <el-option v-if="canViewHistory" label="历史记录（含已删除）" value="all" /><el-option v-if="canViewHistory" label="已删除" value="deleted" />
          </el-select>
          <el-select v-model="filters.status" aria-label="状态" placeholder="全部状态" clearable style="width: 160px">
            <el-option v-for="status in statuses" :key="status" :label="statusLabel(status)" :value="status" />
          </el-select>
        </div>
      </PerformanceRecordFilters>
    </ChartCard>

    <el-alert v-for="key in queryKeys.filter((key) => queryErrors[key])" :key="key" :data-testid="`pip-query-error-${key}`"
      type="error" :closable="false" :title="queryErrors[key]">
      <el-button link type="primary" :loading="queryLoading[key]" @click="retryQuery(key)">重试</el-button>
    </el-alert>
    <el-alert v-if="eligibilityLoaded && !queryLoading['eligible-employees'] && !queryErrors['eligible-employees'] && !eligibleEmployees.length"
      type="info" :closable="false" title="暂无可发起改进计划的员工" />

    <ChartCard :padded="false" class="list-result-card">
      <div class="desktop-result-table">
        <el-table v-loading="loading" :data="list" height="100%" class="app-table" @row-click="(row: ImprovementPlan) => goDetail(row.id)">
          <el-table-column label="员工" min-width="150"><template #default="{ row }">{{ row.employeeName }} <small>{{ row.employeeNo }}</small></template></el-table-column>
          <el-table-column prop="deptName" label="部门" min-width="120" />
          <el-table-column label="关联周期" min-width="160"><template #default="{ row }">{{ row.cycleName || '未关联' }}</template></el-table-column>
          <el-table-column label="状态" min-width="180"><template #default="{ row }"><el-tag v-if="lifecycleLabel(row)" type="info" size="small">{{ lifecycleLabel(row) }}</el-tag> <el-tag :type="IMPROVEMENT_PLAN_STATUS_META[row.status as ImprovementPlanStatus]?.type as any" size="small">{{ statusLabel(row.status) }}</el-tag></template></el-table-column>
          <el-table-column label="预计完成" width="120"><template #default="{ row }">{{ row.targetDate ? formatDate(row.targetDate) : '-' }}</template></el-table-column>
          <el-table-column label="综合分" width="130"><template #default="{ row }">{{ scoreLabel(row as ImprovementPlan) }}</template></el-table-column>
          <el-table-column prop="creatorName" label="发起人" min-width="100" />
          <el-table-column label="操作" width="190" fixed="right"><template #default="{ row }"><el-button link type="primary" @click.stop="goDetail(row.id)">查看</el-button>
            <PerformanceLifecycleActions compact kind="improvement_plan" :record="row as ImprovementPlan" :disabled="loading" @state="value => applyLifecycleProjection(row, value)" @changed="loadList" />
          </template></el-table-column>
        </el-table>
      </div>
      <div v-loading="loading" class="mobile-result-list">
        <MobileResultCard v-for="item in list" :key="item.id" @click="goDetail(item.id)">
          <template #title>{{ item.employeeName }}</template>
          <template #status><el-tag :type="IMPROVEMENT_PLAN_STATUS_META[item.status]?.type as any" size="small">{{ lifecycleLabel(item) || statusLabel(item.status) }}</el-tag></template>
          <div class="mobile-result-field"><span class="mobile-result-field__label">关联周期</span><span>{{ item.cycleName || '未关联' }}</span></div>
          <div class="mobile-result-field"><span class="mobile-result-field__label">预计完成</span><span>{{ item.targetDate ? formatDate(item.targetDate) : '-' }}</span></div>
          <div class="mobile-result-field"><span class="mobile-result-field__label">综合分</span><span>{{ scoreLabel(item) }}</span></div>
          <template #actions><el-button link type="primary" @click.stop="goDetail(item.id)">查看</el-button>
            <PerformanceLifecycleActions compact kind="improvement_plan" :record="item" :disabled="loading" @state="value => applyLifecycleProjection(item, value)" @changed="loadList" />
          </template>
        </MobileResultCard>
      </div>
      <ListPagination v-model:current-page="page" v-model:page-size="pageSize" :total="total" @change="loadList" />
      <EmptyState v-if="!loading && !queryErrors.list && list.length === 0" description="暂无改进计划" />
    </ChartCard>

    <el-dialog v-model="createOpen" title="创建改进计划" width="min(680px, 96vw)" class="improvement-create-dialog"
      :close-on-click-modal="false" destroy-on-close>
      <el-alert v-if="createError" type="error" :closable="false" :title="createError" />
      <div class="form-section-heading"><strong>基本信息</strong></div>
      <el-form label-position="top">
        <el-form-item label="员工" required>
          <el-select v-model="draft.employeeId" aria-label="员工" filterable placeholder="选择管理范围内的员工" style="width: 100%">
            <el-option v-for="employee in eligibleEmployees" :key="employee.id" :value="employee.id"
              :label="`${employee.name} · ${employee.employeeNo || ''} · ${employee.deptName || ''}`" />
          </el-select>
          <small v-if="createEmployeeError" class="field-error">{{ createEmployeeError }}</small>
        </el-form-item>
        <el-form-item label="改进背景"><el-input v-model="draft.improvementNeed" aria-label="改进背景" type="textarea" :rows="3" maxlength="4000" placeholder="说明为什么需要制定这份改进计划" /></el-form-item>
        <div class="create-plan-fields">
          <el-form-item label="关联绩效周期计划（选填）">
            <el-select v-model="draft.cycleId" aria-label="关联绩效周期计划" clearable placeholder="不关联">
              <el-option v-for="cycle in cycles" :key="cycle.id" :label="cycle.name" :value="cycle.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="预计完成日期（选填）"><el-date-picker v-model="draft.targetDate" aria-label="预计完成日期" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" /></el-form-item>
        </div>
      </el-form>
      <div class="goal-heading"><strong>改进目标</strong><div class="goal-heading__actions"><span>权重合计 {{ createWeightTotal }}%</span><el-button type="primary" link @click="addGoal">添加目标</el-button></div></div>
      <small v-if="createWeightTotalError" class="field-error goal-total-error">{{ createWeightTotalError }}</small>
      <div v-for="(goal, index) in draft.goals" :key="goal.id" class="goal-card">
        <div class="goal-card__header"><strong>目标 {{ index + 1 }}</strong><el-button link type="danger" @click="removeGoal(index)">删除</el-button></div>
        <el-input v-model="goal.name" :aria-label="`目标名称 ${index + 1}`" placeholder="目标名称" maxlength="200" />
        <el-input v-model="goal.description" :aria-label="`目标描述 ${index + 1}`" type="textarea" :rows="2" placeholder="目标描述" maxlength="4000" />
        <label class="goal-weight">权重 <input v-model.number="goal.weight" type="number" min="0" max="100" step="0.01"
          :aria-label="`目标权重 ${index + 1}`" :aria-invalid="Boolean(goalWeightError(goal))">%
          <small v-if="goalWeightError(goal)" class="field-error">{{ goalWeightError(goal) }}</small>
        </label>
      </div>
      <template #footer><el-button @click="createOpen = false">取消</el-button><el-button type="primary" :loading="creating" @click="saveDraft">保存草稿</el-button></template>
    </el-dialog>
    <BusinessDetailDrawer
      :model-value="detailOpen"
      title="改进计划详情"
      variant="workflow"
      @update:model-value="handleDetailVisibility"
    >
      <RouterView v-slot="{ Component }">
        <component :is="Component" @changed="loadList" />
      </RouterView>
    </BusinessDetailDrawer>
    </template>
  </BusinessListPage>
</template>

<style scoped>
.goal-heading,.goal-heading__actions,.goal-card__header { display:flex; justify-content:space-between; align-items:center; gap:12px; }
.form-section-heading { margin-bottom:12px; }
.create-plan-fields { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
.create-plan-fields :deep(.el-select),.create-plan-fields :deep(.el-date-editor) { width:100%; }
.goal-heading { margin:18px 0 8px; }
.goal-heading__actions { justify-content:flex-end; color:var(--el-text-color-secondary); font-size:13px; }
.field-error { color:var(--el-color-danger); }
.goal-total-error { display:block; margin:-4px 0 8px; }
.goal-card { display:grid; gap:10px; margin-bottom:10px; padding:12px; border:1px solid var(--el-border-color); border-radius:6px; }
.goal-weight { display:flex; align-items:center; gap:8px; flex-wrap:wrap; font-size:13px; color:var(--el-text-color-regular); }
.goal-weight input { width:100px; height:32px; padding:0 8px; border:1px solid var(--el-border-color); border-radius:4px; }
.field-error { display:block; font-size:12px; line-height:1.5; }
@media(max-width:560px) { .improvement-list :deep(.el-dialog) { margin:10px auto; } .create-plan-fields { grid-template-columns:1fr; gap:0; } .goal-card { padding:10px; } }
</style>
