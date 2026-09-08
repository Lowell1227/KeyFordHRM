<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import ChartCard from '@/components/common/ChartCard.vue';
import ReviewHistory from '@/components/common/ReviewHistory.vue';
import GradeTag from '@/components/common/GradeTag.vue';
import { tasksApi } from '@/api/tasks.api';
import type { FinalGradeDetail, TaskDetail } from '@/types/api.types';

const props = defineProps<{ task: TaskDetail; canReview: boolean }>();
const emit = defineEmits<{ reviewed: [] }>();
const detail = ref<FinalGradeDetail | null>(null);
const loading = ref(false);
const busy = ref(false);
const comment = ref('');
const validation = ref('');
const error = ref('');
let loadSequence = 0;
const lastReview = computed(() => [...(detail.value?.flowRecords ?? props.task.flowRecords ?? [])]
  .filter(r => r.nodeType === 'dept_review' && ['approve', 'reject'].includes(r.action))
  .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]);
const outcome = computed(() => props.task.status === 'hr_calibration'
  ? lastReview.value?.action === 'approve' ? '部门复核已通过，已进入绩效校准。' : '当前已进入绩效校准。'
  : props.task.status === 'approval'
    ? lastReview.value?.action === 'approve' ? '部门复核已完成，已进入结果审批。' : '当前已进入结果审批。'
    : props.task.status === 'manager_scoring' && lastReview.value?.action === 'reject' ? '已退回直属上级重新评定。' : '');
const score = (value: number | null | undefined) => value == null ? '—' : value.toFixed(2);
async function load() {
  const sequence = ++loadSequence;
  loading.value = true; error.value = ''; detail.value = null;
  try { const result = await tasksApi.getFinalGrade(props.task.id); if (sequence === loadSequence) detail.value = result; }
  catch { if (sequence === loadSequence) error.value = '获取复核依据失败，请重试'; }
  finally { if (sequence === loadSequence) loading.value = false; }
}
async function review(action: 'approve' | 'reject') {
  if (!props.canReview || busy.value || !detail.value) return;
  validation.value = '';
  const reason = comment.value.trim();
  if (action === 'reject' && !reason) { validation.value = '请填写退回原因'; return; }
  busy.value = true;
  try {
    await tasksApi.deptReview(props.task.id, { action, ...(reason ? { comment: reason } : {}) });
    ElMessage.success(action === 'approve' ? '部门复核通过' : '已退回直属上级');
    emit('reviewed');
  } finally { busy.value = false; }
}
watch(() => [props.task.id, props.task.status], load, { immediate: true });
watch(() => props.task.id, () => { comment.value = ''; validation.value = ''; });
</script>

<template>
  <div v-loading="loading" class="department-review-workspace" data-testid="department-review-workspace">
    <ChartCard>
      <template #title>部门复核</template>
      <el-alert v-if="outcome" type="success" :closable="false" :title="outcome" />
      <el-alert v-if="error" type="error" :closable="false" :title="error"><el-button link @click="load">重试</el-button></el-alert>
      <template v-if="detail">
        <dl class="review-summary">
          <div><dt>绩效直属上级</dt><dd>{{ detail.managerName || '—' }}</dd></div>
          <div><dt>参考均分</dt><dd>{{ score(detail.calculatedScore) }}</dd></div>
          <div><dt>上级评定等级</dt><dd><GradeTag :grade="detail.currentGrade" /></dd></div>
        </dl>
        <h3>月度结果回顾</h3>
        <div class="review-periods">
          <article v-for="period in detail.periods" :key="period.periodKey">
            <strong>{{ period.periodKey }}</strong>
            <span>员工自评 {{ score(period.selfScoreTotal) }} <GradeTag :grade="period.selfGrade" size="small" /></span>
            <span>上级评价 {{ score(period.managerScoreTotal) }} <GradeTag :grade="period.managerGrade" size="small" /></span>
          </article>
        </div>
        <ReviewHistory :records="detail.flowRecords ?? task.flowRecords" />
        <el-form v-if="canReview" label-position="top" class="review-form">
          <el-form-item label="复核意见" :error="validation">
            <el-input v-model="comment" type="textarea" :rows="3" maxlength="2000" aria-label="复核意见" placeholder="通过时选填，退回时请说明原因" />
          </el-form-item>
          <div class="review-actions">
            <el-button :loading="busy" @click="review('reject')">退回上级重评</el-button>
            <el-button type="primary" :loading="busy" @click="review('approve')">复核通过</el-button>
          </div>
        </el-form>
      </template>
    </ChartCard>
  </div>
</template>

<style scoped>
.department-review-workspace { min-width: 0; }
.review-summary { display: flex; flex-wrap: wrap; gap: 20px 36px; margin: 18px 0; }
.review-summary dt { color: var(--el-text-color-secondary); font-size: 12px; }
.review-summary dd { margin: 6px 0 0; }
h3 { margin: 16px 0 8px; font-size: 14px; }
.review-periods article { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 24px; padding: 12px 0; border-bottom: 1px solid var(--el-border-color-lighter); }
.review-periods span { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; }
.review-form { margin-top: 18px; }
.review-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; }
.review-actions .el-button { margin: 0; }
@media (max-width: 600px) { .review-periods article { align-items: flex-start; flex-direction: column; } }
</style>
