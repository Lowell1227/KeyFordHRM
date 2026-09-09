<script setup lang="ts">
import { onMounted, ref } from 'vue';
import ChartCard from '@/components/common/ChartCard.vue';
import GradeTag from '@/components/common/GradeTag.vue';
import ListPagination from '@/components/common/ListPagination.vue';
import MobileResultCard from '@/components/common/MobileResultCard.vue';
import PerformanceResultDrawer from '@/components/common/PerformanceResultDrawer.vue';
import DepartmentReviewWorkspace from './components/DepartmentReviewWorkspace.vue';
import { tasksApi } from '@/api/tasks.api';
import type { DepartmentReviewListItem, TaskDetail } from '@/types/api.types';
import type { PerfGrade, TaskStatus } from '@/types/enums';
import { TASK_STATUS_META } from '@/types/enums';
import { formatDateTime } from '@/utils/date';
import { formatResultScore, resultStage } from '@/utils/performance-result-presentation';

const items = ref<DepartmentReviewListItem[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(10);
const status = ref<TaskStatus | ''>('');
const loading = ref(false);
const error = ref('');
const detailVisible = ref(false);
const detailLoading = ref(false);
const detailActionBusy = ref(false);
const detailError = ref('');
const selectedTaskId = ref('');
const selectedEmployeeName = ref('');
const selectedTask = ref<TaskDetail | null>(null);
const selectedCanReview = ref(false);
let loadSequence = 0;
let detailSequence = 0;
const stages = Object.entries(TASK_STATUS_META).filter(([value]) => value !== 'exempted');
const beforeReview: TaskStatus[] = ['pending', 'indicator_drafting', 'indicator_reviewing', 'indicator_setting', 'indicator_confirming', 'goal_confirmed', 'self_eval', 'manager_scoring'];
const canReview = (item: DepartmentReviewListItem) => item.departmentReview?.canReview ?? item.status === 'dept_review';
function reviewState(item: DepartmentReviewListItem): { label: string; type: 'warning' | 'success' | 'danger' | 'info' } {
  if (canReview(item)) return { label: '待复核', type: 'warning' };
  const latest = item.departmentReview?.latest;
  if (latest?.action === 'approve') return { label: latest.combined ? '合并复核通过' : '复核通过', type: 'success' };
  if (latest?.action === 'reject') return { label: '已退回', type: 'danger' };
  return { label: beforeReview.includes(item.status) ? '待开始' : '暂无复核记录', type: 'info' };
}
async function load() {
  const sequence = ++loadSequence;
  loading.value = true;
  error.value = '';
  try {
    const result = await tasksApi.findDepartmentReviews({ page: page.value, pageSize: pageSize.value, ...(status.value ? { status: status.value } : {}) });
    if (sequence !== loadSequence) return;
    items.value = result.items;
    total.value = result.total;
  } catch {
    if (sequence === loadSequence) { error.value = '获取部门复核任务失败，请重试'; items.value = []; total.value = 0; }
  }
  finally { if (sequence === loadSequence) loading.value = false; }
}
function changeStage() {
  page.value = 1;
  void load();
}
async function loadTaskDetail(id: string) {
  const sequence = ++detailSequence;
  detailLoading.value = true;
  detailError.value = '';
  try {
    const task = await tasksApi.findOne(id);
    if (sequence === detailSequence && selectedTaskId.value === id) selectedTask.value = task;
  } catch {
    if (sequence === detailSequence && selectedTaskId.value === id) {
      selectedTask.value = null;
      detailError.value = '获取部门复核详情失败，请重试';
    }
  } finally {
    if (sequence === detailSequence && selectedTaskId.value === id) detailLoading.value = false;
  }
}
function openTask(item: DepartmentReviewListItem) {
  selectedTaskId.value = item.id;
  selectedEmployeeName.value = item.employeeName ?? '';
  selectedCanReview.value = canReview(item);
  selectedTask.value = null;
  detailVisible.value = true;
  void loadTaskDetail(item.id);
}
function closeDetail() {
  detailSequence += 1;
  detailVisible.value = false;
  detailLoading.value = false;
  detailActionBusy.value = false;
  detailError.value = '';
  selectedTaskId.value = '';
  selectedEmployeeName.value = '';
  selectedTask.value = null;
  selectedCanReview.value = false;
}
function beforeDetailClose(done: () => void) {
  if (!detailActionBusy.value) done();
}
async function handleReviewed() {
  const id = selectedTaskId.value;
  if (!id) return;
  selectedCanReview.value = false;
  await Promise.all([load(), loadTaskDetail(id)]);
  if (selectedTaskId.value !== id) return;
  const refreshed = items.value.find(item => item.id === id);
  selectedCanReview.value = refreshed ? canReview(refreshed) : false;
}
onMounted(load);
</script>

<template>
  <div class="page-stack department-review-list performance-result-page">
    <ChartCard :padded="true" class="list-result-card">
      <template #title>部门复核</template>
      <div class="review-filters performance-result-toolbar">
        <label for="department-review-stage">当前环节</label>
        <el-select id="department-review-stage" v-model="status" aria-label="当前环节" placeholder="全部环节" @change="changeStage">
          <el-option label="全部环节" value="" />
          <el-option v-for="[value, meta] in stages" :key="value" :label="meta.label" :value="value" />
        </el-select>
      </div>
      <el-alert v-if="error" type="error" :title="error" :closable="false"><el-button link @click="load">重试</el-button></el-alert>
      <div class="desktop-result-table">
      <el-table v-loading="loading" :data="items" row-key="id" class="performance-result-table" empty-text="暂无部门复核记录" style="width: 100%">
        <el-table-column prop="employeeName" label="员工" min-width="150" show-overflow-tooltip>
          <template #default="{ row }"><div class="performance-result-employee"><span>{{ row.employeeName }}</span><span class="performance-result-meta">{{ row.employeeNo || '—' }}</span></div></template>
        </el-table-column>
        <el-table-column prop="deptName" label="部门" min-width="130" show-overflow-tooltip />
        <el-table-column prop="position" label="岗位" min-width="130" show-overflow-tooltip><template #default="{ row }">{{ row.position || '—' }}</template></el-table-column>
        <el-table-column label="周期得分" width="110" align="right"><template #default="{ row }"><span class="performance-result-score">{{ formatResultScore(row.totalScore) }}</span></template></el-table-column>
        <el-table-column label="周期等级" width="100" align="center"><template #default="{ row }"><GradeTag :grade="(row.calibratedGrade ?? row.rawGrade) as PerfGrade" size="small" /></template></el-table-column>
        <el-table-column label="当前环节" min-width="150"><template #default="{ row }"><el-tag :type="resultStage(row.status, row.approvedAt).type" size="small">{{ resultStage(row.status, row.approvedAt).label }}</el-tag></template></el-table-column>
        <el-table-column prop="cycleName" label="考核周期" min-width="200" show-overflow-tooltip />
        <el-table-column label="最近复核" min-width="170">
          <template #default="{ row }">
            <el-tag :type="reviewState(row as DepartmentReviewListItem).type" size="small" effect="plain">{{ reviewState(row as DepartmentReviewListItem).label }}</el-tag>
            <div v-if="row.departmentReview?.latest" class="review-time">
              <span v-if="canReview(row as DepartmentReviewListItem)">{{ row.departmentReview.latest.action === 'reject' ? '最近退回' : '最近通过' }} · </span>{{ formatDateTime(row.departmentReview.latest.createdAt) }}
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="180" fixed="right"><template #default="{ row }"><div class="performance-result-actions"><el-button link type="primary" @click="openTask(row as DepartmentReviewListItem)">{{ canReview(row as DepartmentReviewListItem) ? '进入复核' : '查看详情' }}</el-button></div></template></el-table-column>
      </el-table>
      </div>
      <div v-loading="loading" class="mobile-result-list department-review-mobile-list">
        <MobileResultCard v-for="item in items" :key="item.id">
          <template #title>{{ item.employeeName }} · {{ item.employeeNo || '—' }}</template>
          <template #status><el-tag :type="resultStage(item.status, item.approvedAt).type" size="small">{{ resultStage(item.status, item.approvedAt).label }}</el-tag></template>
          <div class="mobile-result-field"><span class="mobile-result-field__label">部门 / 岗位</span><span class="mobile-result-field__value">{{ item.deptName || '—' }} · {{ item.position || '—' }}</span></div>
          <div class="mobile-result-field"><span class="mobile-result-field__label">周期结果</span><span class="mobile-result-field__value">{{ formatResultScore(item.totalScore) }} · {{ item.calibratedGrade ?? item.rawGrade ?? '—' }}</span></div>
          <div class="mobile-result-field"><span class="mobile-result-field__label">考核周期</span><span class="mobile-result-field__value">{{ item.cycleName || '—' }}</span></div>
          <div class="mobile-result-field"><span class="mobile-result-field__label">最近复核</span><span class="mobile-result-field__value">{{ reviewState(item).label }}<template v-if="item.departmentReview?.latest"> · {{ formatDateTime(item.departmentReview.latest.createdAt) }}</template></span></div>
          <template #actions><el-button link type="primary" @click="openTask(item)">{{ canReview(item) ? '进入复核' : '查看详情' }}</el-button></template>
        </MobileResultCard>
      </div>
      <ListPagination v-model:current-page="page" v-model:page-size="pageSize" :total="total" @change="load" />
    </ChartCard>
    <PerformanceResultDrawer
      v-model="detailVisible"
      :title="selectedEmployeeName ? `${selectedEmployeeName} · 部门复核` : '部门复核详情'"
      data-testid="department-review-detail-drawer"
      :before-close="beforeDetailClose"
      :close-on-click-modal="!detailActionBusy"
      :close-on-press-escape="!detailActionBusy"
      :show-close="!detailActionBusy"
      @close="closeDetail"
    >
      <div v-loading="detailLoading" class="department-review-detail">
        <el-alert v-if="detailError" type="error" :closable="false" :title="detailError"><el-button link @click="loadTaskDetail(selectedTaskId)">重试</el-button></el-alert>
        <DepartmentReviewWorkspace v-if="selectedTask" :task="selectedTask" :can-review="selectedCanReview" embedded @busy="detailActionBusy = $event" @reviewed="handleReviewed" />
      </div>
      <template #footer><el-button :disabled="detailActionBusy" @click="detailVisible = false">关闭</el-button></template>
    </PerformanceResultDrawer>
  </div>
</template>

<style scoped>
.department-review-list { min-width: 0; }
.department-review-list :deep(.chart-card) { min-width: 0; }
.review-filters { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 14px; font-size: 13px; }
.review-filters label { color: var(--el-text-color-regular); }
.review-filters .el-select { width: 180px; }
.review-time { margin-top: 5px; font-size: 12px; line-height: 1.4; color: var(--el-text-color-secondary); white-space: normal; }
.department-review-detail { min-height: 180px; }
</style>
