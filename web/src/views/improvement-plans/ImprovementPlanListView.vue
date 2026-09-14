<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
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
import PerformanceRecordFilters from '@/components/common/PerformanceRecordFilters.vue';
import type { Department, ImprovementGoal, ImprovementPlan } from '@/types/api.types';

const router = useRouter();
const list = ref<ImprovementPlan[]>([]);
const cycles = ref<Array<{ id: string; name: string }>>([]);
const departments = ref<Department[]>([]);
const eligibleEmployees = ref<Array<{ id: string; name: string; employeeNo: string | null; deptName: string | null }>>([]);
const loading = ref(false);
const creating = ref(false);
const createOpen = ref(false);
const filters = reactive<{ cycleId: string; deptId: string; status: ImprovementPlanStatus | ''; keyword: string }>({
  cycleId: '', deptId: '', status: '', keyword: '',
});
const draft = reactive<{ employeeId: string; cycleId: string; improvementNeed: string; targetDate: string; goals: ImprovementGoal[] }>({
  employeeId: '', cycleId: '', improvementNeed: '', targetDate: '', goals: [],
});
const { page, pageSize, total, reset: resetPagination, withParams } = usePagination({ defaultPageSize: 10 });
const statuses = Object.keys(IMPROVEMENT_PLAN_STATUS_META) as ImprovementPlanStatus[];

onMounted(async () => {
  const [cycleItems, departmentItems, employeeItems] = await Promise.all([
    improvementPlansApi.cycles().catch(() => []),
    departmentsApi.findAll({ isActive: true, pageSize: 1000 }).catch(() => [] as Department[]),
    improvementPlansApi.eligibleEmployees().catch(() => []),
  ]);
  cycles.value = cycleItems;
  departments.value = departmentItems;
  eligibleEmployees.value = employeeItems;
  await loadList();
});

async function loadList() {
  loading.value = true;
  try {
    const result = await improvementPlansApi.findAll(withParams({
      cycleId: filters.cycleId || undefined, deptId: filters.deptId || undefined,
      status: filters.status || undefined, keyword: filters.keyword || undefined,
    }));
    list.value = result.items;
    total.value = result.total;
  } finally { loading.value = false; }
}
function search() { resetPagination(); void loadList(); }
function reset() { Object.assign(filters, { cycleId: '', deptId: '', status: '', keyword: '' }); search(); }
function openCreate() {
  Object.assign(draft, { employeeId: '', cycleId: '', improvementNeed: '', targetDate: '', goals: [] });
  addGoal();
  createOpen.value = true;
}
function addGoal() { draft.goals.push({ id: crypto.randomUUID(), name: '', description: '', weight: 0 }); }
function removeGoal(index: number) { draft.goals.splice(index, 1); }
async function saveDraft() {
  if (!draft.employeeId) { ElMessage.warning('请选择员工'); return; }
  creating.value = true;
  try {
    const created = await improvementPlansApi.create({
      employeeId: draft.employeeId, cycleId: draft.cycleId || null,
      improvementNeed: draft.improvementNeed, targetDate: draft.targetDate || null,
      goals: draft.goals,
    });
    createOpen.value = false;
    ElMessage.success('草稿已保存，请检查目标后正式提交');
    await router.push(`/improvement-plans/${created.id}`);
  } finally { creating.value = false; }
}
function statusLabel(status: ImprovementPlanStatus) { return IMPROVEMENT_PLAN_STATUS_META[status]?.label ?? status; }
function scoreLabel(item: ImprovementPlan) {
  return item.finalScore == null ? '-' : item.workflowVersion === 1
    ? `${item.finalScore} / 10（历史）` : `${item.finalScore} / 100`;
}
function goDetail(id: string) { void router.push(`/improvement-plans/${id}`); }
</script>

<template>
  <div class="improvement-list page-stack app-list-page">
    <ChartCard class="list-page-header-card">
      <template #title>绩效改进计划</template>
      <template #extra><el-button v-if="eligibleEmployees.length" type="primary" @click="openCreate">新建改进计划</el-button></template>
      <PerformanceRecordFilters v-model:cycle-id="filters.cycleId" v-model:dept-id="filters.deptId"
        v-model:keyword="filters.keyword" :cycles="cycles" :departments="departments" :loading="loading"
        allow-all-cycles @search="search" @reset="reset">
        <div class="performance-record-filter-extra">
          <el-select v-model="filters.status" aria-label="状态" placeholder="全部状态" clearable style="width: 160px">
            <el-option v-for="status in statuses" :key="status" :label="statusLabel(status)" :value="status" />
          </el-select>
        </div>
      </PerformanceRecordFilters>
    </ChartCard>

    <ChartCard :padded="false" class="list-result-card">
      <div class="desktop-result-table">
        <el-table v-loading="loading" :data="list" height="100%" class="app-table" @row-click="(row: ImprovementPlan) => goDetail(row.id)">
          <el-table-column label="员工" min-width="150"><template #default="{ row }">{{ row.employeeName }} <small>{{ row.employeeNo }}</small></template></el-table-column>
          <el-table-column prop="deptName" label="部门" min-width="120" />
          <el-table-column label="关联周期" min-width="160"><template #default="{ row }">{{ row.cycleName || '未关联' }}</template></el-table-column>
          <el-table-column label="状态" min-width="180"><template #default="{ row }"><el-tag :type="IMPROVEMENT_PLAN_STATUS_META[row.status as ImprovementPlanStatus]?.type as any" size="small">{{ statusLabel(row.status) }}</el-tag></template></el-table-column>
          <el-table-column label="预计完成" width="120"><template #default="{ row }">{{ row.targetDate ? formatDate(row.targetDate) : '-' }}</template></el-table-column>
          <el-table-column label="综合分" width="130"><template #default="{ row }">{{ scoreLabel(row as ImprovementPlan) }}</template></el-table-column>
          <el-table-column prop="creatorName" label="发起人" min-width="100" />
          <el-table-column label="操作" width="80" fixed="right"><template #default="{ row }"><el-button link type="primary" @click.stop="goDetail(row.id)">查看</el-button></template></el-table-column>
        </el-table>
      </div>
      <div v-loading="loading" class="mobile-result-list">
        <MobileResultCard v-for="item in list" :key="item.id" @click="goDetail(item.id)">
          <template #title>{{ item.employeeName }}</template>
          <template #status><el-tag :type="IMPROVEMENT_PLAN_STATUS_META[item.status]?.type as any" size="small">{{ statusLabel(item.status) }}</el-tag></template>
          <div class="mobile-result-field"><span class="mobile-result-field__label">关联周期</span><span>{{ item.cycleName || '未关联' }}</span></div>
          <div class="mobile-result-field"><span class="mobile-result-field__label">预计完成</span><span>{{ item.targetDate ? formatDate(item.targetDate) : '-' }}</span></div>
          <div class="mobile-result-field"><span class="mobile-result-field__label">综合分</span><span>{{ scoreLabel(item) }}</span></div>
          <template #actions><el-button link type="primary" @click.stop="goDetail(item.id)">查看</el-button></template>
        </MobileResultCard>
      </div>
      <ListPagination v-model:current-page="page" v-model:page-size="pageSize" :total="total" @change="loadList" />
      <EmptyState v-if="!loading && list.length === 0" description="暂无改进计划" />
    </ChartCard>

    <el-dialog v-model="createOpen" title="创建改进计划" width="min(680px, 96vw)" class="improvement-create-dialog">
      <el-form label-position="top">
        <el-form-item label="员工" required>
          <el-select v-model="draft.employeeId" aria-label="员工" filterable placeholder="选择管理范围内的员工" style="width: 100%">
            <el-option v-for="employee in eligibleEmployees" :key="employee.id" :value="employee.id"
              :label="`${employee.name} · ${employee.employeeNo || ''} · ${employee.deptName || ''}`" />
          </el-select>
        </el-form-item>
        <el-form-item label="关联绩效周期计划（选填）">
          <el-select v-model="draft.cycleId" aria-label="关联绩效周期计划" clearable placeholder="不关联" style="width: 100%">
            <el-option v-for="cycle in cycles" :key="cycle.id" :label="cycle.name" :value="cycle.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="改进背景"><el-input v-model="draft.improvementNeed" aria-label="改进背景" type="textarea" :rows="3" maxlength="4000" placeholder="说明为什么需要制定这份改进计划" /></el-form-item>
        <el-form-item label="预计完成日期（选填）"><el-date-picker v-model="draft.targetDate" aria-label="预计完成日期" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" /></el-form-item>
      </el-form>
      <div class="goal-heading"><strong>改进目标</strong><el-button type="primary" link @click="addGoal">添加目标</el-button></div>
      <div v-for="(goal, index) in draft.goals" :key="goal.id" class="goal-card">
        <div class="goal-card__header"><strong>目标 {{ index + 1 }}</strong><el-button link type="danger" @click="removeGoal(index)">删除</el-button></div>
        <el-input v-model="goal.name" :aria-label="`目标名称 ${index + 1}`" placeholder="目标名称" maxlength="200" />
        <el-input v-model="goal.description" :aria-label="`目标描述 ${index + 1}`" type="textarea" :rows="2" placeholder="目标描述" maxlength="4000" />
        <label class="goal-weight">权重 <input v-model.number="goal.weight" type="number" min="0" max="100" step="0.01" :aria-label="`目标权重 ${index + 1}`">%</label>
      </div>
      <template #footer><el-button @click="createOpen = false">取消</el-button><el-button type="primary" :loading="creating" @click="saveDraft">保存草稿</el-button></template>
    </el-dialog>
  </div>
</template>

<style scoped>
.goal-heading,.goal-card__header { display:flex; justify-content:space-between; align-items:center; gap:12px; }
.goal-heading { margin:18px 0 8px; }
.goal-card { display:grid; gap:10px; margin-bottom:10px; padding:12px; border:1px solid var(--el-border-color); border-radius:6px; }
.goal-weight { display:flex; align-items:center; gap:8px; font-size:13px; color:var(--el-text-color-regular); }
.goal-weight input { width:100px; height:32px; padding:0 8px; border:1px solid var(--el-border-color); border-radius:4px; }
@media(max-width:560px) { .improvement-list :deep(.el-dialog) { margin:10px auto; } .goal-card { padding:10px; } }
</style>
