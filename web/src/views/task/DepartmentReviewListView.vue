<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import ChartCard from '@/components/common/ChartCard.vue';
import GradeTag from '@/components/common/GradeTag.vue';
import { tasksApi } from '@/api/tasks.api';
import type { DepartmentReviewListItem } from '@/types/api.types';
import type { PerfGrade, TaskStatus } from '@/types/enums';
import { TASK_STATUS_META } from '@/types/enums';
import { formatScore } from '@/utils/score';
import { formatDateTime } from '@/utils/date';

const router = useRouter();
const items = ref<DepartmentReviewListItem[]>([]);
const total = ref(0);
const pendingTotal = ref(0);
const page = ref(1);
const status = ref<TaskStatus | ''>('');
const loading = ref(false);
const error = ref('');
let loadSequence = 0;
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
    const result = await tasksApi.findDepartmentReviews({ page: page.value, pageSize: 20, ...(status.value ? { status: status.value } : {}) });
    if (sequence !== loadSequence) return;
    items.value = result.items;
    total.value = result.total;
    pendingTotal.value = result.pendingTotal;
  } catch {
    if (sequence === loadSequence) { error.value = '获取部门复核任务失败，请重试'; items.value = []; total.value = 0; pendingTotal.value = 0; }
  }
  finally { if (sequence === loadSequence) loading.value = false; }
}
function changeStage() {
  page.value = 1;
  void load();
}
function openTask(id: string) {
  router.push({ name: 'TaskDetail', params: { id }, query: { stage: 'result', returnTo: '/department-review' } });
}
onMounted(load);
</script>

<template>
  <div class="page-stack department-review-list">
    <ChartCard>
      <template #title>部门复核</template>
      <template #extra><span data-testid="department-review-pending-total">待复核 {{ pendingTotal }} 项</span></template>
      <div class="review-filters">
        <label for="department-review-stage">当前环节</label>
        <el-select id="department-review-stage" v-model="status" aria-label="当前环节" placeholder="全部环节" @change="changeStage">
          <el-option label="全部环节" value="" />
          <el-option v-for="[value, meta] in stages" :key="value" :label="meta.label" :value="value" />
        </el-select>
        <span class="review-total">共 {{ total }} 条记录</span>
      </div>
      <el-alert v-if="error" type="error" :title="error" :closable="false"><el-button link @click="load">重试</el-button></el-alert>
      <el-table v-loading="loading" :data="items" row-key="id" empty-text="暂无部门复核记录" style="width: 100%">
        <el-table-column prop="employeeName" label="员工" min-width="130" />
        <el-table-column prop="cycleName" label="考核周期" min-width="200" />
        <el-table-column prop="deptName" label="部门" min-width="110" />
        <el-table-column label="复核办理" min-width="170">
          <template #default="{ row }">
            <el-tag :type="reviewState(row as DepartmentReviewListItem).type" size="small" effect="plain">{{ reviewState(row as DepartmentReviewListItem).label }}</el-tag>
            <div v-if="row.departmentReview?.latest" class="review-time">
              <span v-if="canReview(row as DepartmentReviewListItem)">{{ row.departmentReview.latest.action === 'reject' ? '最近退回' : '最近通过' }} · </span>{{ formatDateTime(row.departmentReview.latest.createdAt) }}
            </div>
          </template>
        </el-table-column>
        <el-table-column label="当前环节" min-width="150"><template #default="{ row }">{{ TASK_STATUS_META[row.status as TaskStatus]?.label ?? row.status }}</template></el-table-column>
        <el-table-column label="参考均分" width="110"><template #default="{ row }">{{ formatScore(row.totalScore) }}</template></el-table-column>
        <el-table-column label="最终等级" width="110"><template #default="{ row }"><GradeTag :grade="row.rawGrade as PerfGrade" size="small" /></template></el-table-column>
        <el-table-column label="操作" width="110" fixed="right"><template #default="{ row }"><el-button link type="primary" @click="openTask(row.id)">{{ canReview(row as DepartmentReviewListItem) ? '进入复核' : '查看详情' }}</el-button></template></el-table-column>
      </el-table>
      <el-pagination v-if="total > 20" v-model:current-page="page" :page-size="20" :total="total" layout="prev, pager, next" @current-change="load" />
    </ChartCard>
  </div>
</template>

<style scoped>
.department-review-list { min-width: 0; }
.department-review-list :deep(.chart-card) { min-width: 0; }
.review-filters { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 14px; font-size: 13px; }
.review-filters label { color: var(--el-text-color-regular); }
.review-filters .el-select { width: 180px; }
.review-total { margin-left: auto; color: var(--el-text-color-secondary); }
.review-time { margin-top: 5px; font-size: 12px; line-height: 1.4; color: var(--el-text-color-secondary); white-space: normal; }
@media (max-width: 600px) { .review-total { margin-left: 0; } }
</style>
