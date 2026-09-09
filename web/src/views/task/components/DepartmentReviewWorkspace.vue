<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import ChartCard from '@/components/common/ChartCard.vue';
import PerformanceResultEvidence from '@/components/common/PerformanceResultEvidence.vue';
import PerformanceResultSummary from '@/components/common/PerformanceResultSummary.vue';
import { tasksApi } from '@/api/tasks.api';
import type { FinalGradeDetail, TaskDetail } from '@/types/api.types';
import type { PerfGrade } from '@/types/enums';
import { resultStage } from '@/utils/performance-result-presentation';

const props = withDefaults(defineProps<{ task: TaskDetail; canReview: boolean; embedded?: boolean }>(), { embedded: false });
const emit = defineEmits<{ reviewed: []; busy: [value: boolean] }>();
const detail = ref<FinalGradeDetail | null>(null);
const loading = ref(false);
const busy = ref(false);
const comment = ref('');
const validation = ref('');
const error = ref('');
const workspaceContainer = computed(() => props.embedded ? 'div' : ChartCard);
let loadSequence = 0;
const lastReview = computed(() => [...(detail.value?.flowRecords ?? props.task.flowRecords ?? [])]
  .filter(r => r.nodeType === 'dept_review' && ['approve', 'reject'].includes(r.action))
  .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]);
const approvedWaitingPublish = computed(() => (detail.value?.status ?? props.task.status) === 'approval'
  && Boolean(detail.value?.approvedAt ?? props.task.approvedAt));
const outcome = computed(() => {
  if (approvedWaitingPublish.value) return '部门复核已完成，结果审批已通过，等待公示。';
  if (props.task.status === 'hr_calibration') {
    return lastReview.value?.action === 'approve' ? '部门复核已通过，已进入绩效校准。' : '当前已进入绩效校准。';
  }
  if (props.task.status === 'approval') {
    return lastReview.value?.action === 'approve' ? '部门复核已完成，已进入结果审批。' : '当前已进入结果审批。';
  }
  return props.task.status === 'manager_scoring' && lastReview.value?.action === 'reject' ? '已退回直属上级重新评定。' : '';
});
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
  emit('busy', true);
  try {
    await tasksApi.deptReview(props.task.id, { action, ...(reason ? { comment: reason } : {}) });
    ElMessage.success(action === 'approve' ? '部门复核通过' : '已退回直属上级');
    emit('reviewed');
  } finally { busy.value = false; emit('busy', false); }
}
watch(() => [props.task.id, props.task.status], load, { immediate: true });
watch(() => props.task.id, () => { comment.value = ''; validation.value = ''; });
</script>

<template>
  <div v-loading="loading" class="department-review-workspace" data-testid="department-review-workspace">
    <component :is="workspaceContainer" :title="embedded ? undefined : '部门复核'" :padded="embedded ? undefined : true" :class="{ 'department-review-workspace__embedded': embedded }">
      <el-alert v-if="outcome" type="success" :closable="false" :title="outcome" />
      <el-alert v-if="error" type="error" :closable="false" :title="error"><el-button link @click="load">重试</el-button></el-alert>
      <template v-if="detail">
        <PerformanceResultSummary
          score-hint="分数与等级无换算关系"
          :cycle-name="detail.cycleName"
          :employee-name="detail.employeeName"
          :status-label="resultStage(detail.status, detail.approvedAt).label"
          :status-type="resultStage(detail.status, detail.approvedAt).type"
          :department-name="detail.deptName"
          :position="detail.position"
          :manager-name="detail.managerName"
          :score="(detail.calculatedScore) ?? null"
          :raw-grade="(detail.currentGrade) ?? null"
          :calibrated-grade="(task.gradeResult?.calibratedGrade as PerfGrade | null | undefined) ?? null"
        />
        <PerformanceResultEvidence :evidence="detail.resultEvidence" :periods="detail.periods" :records="detail.flowRecords ?? task.flowRecords" />
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
    </component>
  </div>
</template>

<style scoped>
.department-review-workspace { min-width: 0; }
.department-review-workspace__embedded { min-width: 0; }
.review-form { margin-top: 18px; }
.review-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; }
.review-actions .el-button { margin: 0; }
</style>
