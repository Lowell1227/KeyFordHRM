<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ArrowLeft } from '@element-plus/icons-vue';
import { tasksApi } from '@/api/tasks.api';
import GradeTag from '@/components/common/GradeTag.vue';
import ChartCard from '@/components/common/ChartCard.vue';
import ReviewHistory from '@/components/common/ReviewHistory.vue';
import type { FinalGradeDetail } from '@/types/api.types';
import type { PerfGrade } from '@/types/enums';
import { FLOW_NODE_LABELS, TASK_STATUS_META } from '@/types/enums';
import { GRADE_LABELS } from '@/utils/grade';

const route = useRoute();
const router = useRouter();
const props = defineProps<{ taskId?: string; embedded?: boolean }>();
const emit = defineEmits<{ submitted: [] }>();

const taskId = computed(() => props.taskId || String(route.params.id));
const detail = ref<FinalGradeDetail | null>(null);
const loading = ref(false);
const submitting = ref(false);
const selectedGrade = ref<PerfGrade | null>(null);
const comment = ref('');
let loadSequence = 0;

const GRADES: PerfGrade[] = ['A', 'B', 'C', 'D'];

const fmtScore = (s: number | null | undefined) => (s == null ? '—' : s.toFixed(2));

const allPeriodsComplete = computed(() => detail.value?.allPeriodsComplete ?? false);
const cycleScoreHint = computed(() => detail.value?.periods.every(period => period.periodType === 'month')
  ? `由${detail.value.periods.length}个月的直属上级评分取平均；周期等级由直属上级独立评定。`
  : '由本周期各期直属上级评分取平均；周期等级由直属上级独立评定。');

async function loadDetail() {
  const sequence = ++loadSequence;
  const requestedTaskId = taskId.value;
  loading.value = true;
  try {
    const result = await tasksApi.getFinalGrade(requestedTaskId);
    if (sequence !== loadSequence || requestedTaskId !== taskId.value) return;
    detail.value = result;
    selectedGrade.value = detail.value.currentGrade;
    comment.value = detail.value.comment ?? '';
  } catch (e) {
    if (sequence !== loadSequence) return;
    ElMessage.error(e instanceof Error ? e.message : '获取评定数据失败');
    detail.value = null;
  } finally {
    if (sequence === loadSequence) loading.value = false;
  }
}

async function handleSubmit() {
  if (loading.value || submitting.value || !detail.value?.canSubmit) return;
  if (!selectedGrade.value) {
    ElMessage.warning('请选择整周期最终等级');
    return;
  }
  const grade = selectedGrade.value;
  const submittedComment = comment.value.trim();
  const current = detail.value;
  const requestedTaskId = taskId.value;
  const departmentReview = current.departmentReview;
  const reviewMessage = departmentReview?.combined
    ? '绩效直属上级与部门负责人为同一人，本次提交将合并完成部门复核，保留两个环节的办理记录，随后进入绩效校准。'
    : departmentReview?.reviewerName
      ? `提交后由 ${departmentReview.reviewerName} 进行部门复核。`
      : departmentReview ? '提交后进入部门复核。' : '提交后按任务流程进入下一环节。';
  try {
    await ElMessageBox.confirm(
      `提交后 ${current.employeeName} 的整周期最终等级为 ${GRADE_LABELS[grade]}。${reviewMessage}提交后不可直接修改，如被退回可重新评定。`,
      '提交整周期结果评定',
      { confirmButtonText: '提交', cancelButtonText: '再想想', type: 'warning' },
    );
  } catch {
    return;
  }
  if (requestedTaskId !== taskId.value || detail.value !== current || !detail.value.canSubmit) return;
  submitting.value = true;
  try {
    const result = await tasksApi.submitFinalGrade(requestedTaskId, { grade, comment: submittedComment });
    const nextStage = result.status === 'dept_review' || result.status === 'hr_calibration'
      ? FLOW_NODE_LABELS[result.status] : null;
    ElMessage.success(nextStage ? `整周期结果评定已提交，已进入${nextStage}。` : '整周期结果评定已提交');
    if (requestedTaskId === taskId.value) { await loadDetail(); emit('submitted'); }
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '提交失败');
  } finally {
    submitting.value = false;
  }
}

function goBack() {
  router.push({ name: 'TaskDetail', params: { id: taskId.value } });
}

watch(taskId, loadDetail, { immediate: true });
</script>

<template>
  <div v-loading="loading" class="final-grade-view page-stack" data-testid="manager-period-results">
    <template v-if="detail">
      <ChartCard :padded="true">
        <template #title>
          <span class="title-row">
            <el-button v-if="!embedded" :icon="ArrowLeft" link aria-label="返回任务详情" @click="goBack" />
            整周期结果评定 · {{ detail.employeeName }}
          </span>
        </template>
        <template #extra>
          <span class="cycle-name">{{ detail.cycleName }}</span>
        </template>

        <el-alert
          v-if="detail.latestReject"
          type="error"
          :closable="false"
          show-icon
          class="reject-alert"
        >
          <template #title>
            评定被{{ detail.latestReject.nodeType === 'hr_calibration' ? 'HR 校准驳回' : '部门复核退回' }}
            （{{ detail.latestReject.actorName ?? '系统' }}）
          </template>
          {{ detail.latestReject.comment }}
        </el-alert>

        <el-descriptions :column="2" size="small" border>
          <el-descriptions-item label="部门">{{ detail.deptName ?? '—' }}</el-descriptions-item>
          <el-descriptions-item label="岗位">{{ detail.position ?? '—' }}</el-descriptions-item>
          <el-descriptions-item label="直属上级">{{ detail.managerName ?? '—' }}</el-descriptions-item>
          <el-descriptions-item v-if="!detail.canSubmit" label="当前环节"><span data-testid="cycle-current-stage">{{ TASK_STATUS_META[detail.status]?.label ?? detail.status }}</span></el-descriptions-item>
        </el-descriptions>
      </ChartCard>

      <ChartCard :padded="true">
        <template #title>月度结果回顾</template>
        <el-table :data="detail.periods" size="small" border class="monthly-results-table">
          <el-table-column prop="periodKey" label="月份" width="90" />
          <el-table-column label="员工自评" min-width="110">
            <template #default="{ row }">
              <div class="period-result-cell"><strong>{{ fmtScore(row.selfScoreTotal) }}</strong><GradeTag v-if="row.selfGrade" :grade="row.selfGrade" size="small" /><span v-else>未评等级</span></div>
            </template>
          </el-table-column>
          <el-table-column label="直属上级评分" min-width="110">
            <template #default="{ row }">
              <div class="period-result-cell"><strong>{{ fmtScore(row.managerScoreTotal) }}</strong><GradeTag v-if="row.managerGrade" :grade="row.managerGrade" size="small" /><span v-else>未评等级</span></div>
            </template>
          </el-table-column>
        </el-table>
      </ChartCard>

      <ChartCard :padded="true">
        <template #title>周期结果</template>
        <div class="cycle-result-score"><span>周期得分</span><strong data-testid="cycle-result-score">{{ allPeriodsComplete ? `${fmtScore(detail.calculatedScore)}分` : '待月度评分完成' }}</strong></div>
        <p class="hint">{{ cycleScoreHint }}</p>
        <h3 class="cycle-grade-title">周期等级</h3>
        <div v-if="detail.canSubmit" class="grade-picker">
          <button
            v-for="grade in GRADES"
            :key="grade"
            type="button"
            :aria-label="`整周期最终等级 ${grade}`"
            class="grade-option"
            :class="{ 'grade-option--active': selectedGrade === grade }"
            @click="selectedGrade = grade"
          >
            <GradeTag :grade="grade" size="large" />
          </button>
        </div>
        <GradeTag v-else-if="detail.currentGrade" :grade="detail.currentGrade" size="large" class="final-grade-readonly" />
        <el-alert
          v-else-if="detail.status !== 'manager_scoring'"
          type="info"
          :closable="false"
          show-icon
          title="当前状态不允许修改整周期结果评定"
        />
        <el-alert
          v-else
          type="warning"
          :closable="false"
          show-icon
          title="全部月度评分完成后才能提交整周期结果评定"
        />
        <div class="cycle-comment">
          <label for="cycle-comment" class="cycle-grade-title">周期评语<span v-if="detail.canSubmit" class="optional">选填</span></label>
          <el-input v-if="detail.canSubmit" id="cycle-comment" v-model="comment" type="textarea" aria-label="周期评语"
            :rows="4" :maxlength="2000" show-word-limit :disabled="submitting"
            placeholder="评价本周期整体表现、主要成果及改进建议" />
          <p v-else class="cycle-comment__readonly" data-testid="cycle-comment-readonly">{{ detail.comment || '暂无评语' }}</p>
        </div>
        <div class="submit-row">
          <el-button
            v-if="detail.canSubmit"
            type="primary"
            size="large"
            :disabled="!selectedGrade"
            :loading="submitting"
            @click="handleSubmit"
          >
            {{ detail.currentGrade ? '重新提交评定' : '提交评定' }}
          </el-button>
        </div>
      </ChartCard>
      <ChartCard v-if="detail.flowRecords?.length"><ReviewHistory :records="detail.flowRecords" /></ChartCard>
    </template>
  </div>
</template>

<style scoped>
.final-grade-view { min-width: 0; }
.final-grade-view :deep(.chart-card) { min-width: 0; }
.monthly-results-table { width: 100%; }
.period-result-cell { display: flex; align-items: flex-start; flex-direction: column; gap: 5px; }
.period-result-cell strong { color: #394559; }
.final-grade-readonly { margin-bottom: 12px; }
.cycle-result-score { display: flex; align-items: baseline; gap: 16px; color: #697487; font-size: 13px; }
.cycle-result-score strong { color: #202a3d; font-size: 24px; }
.cycle-grade-title { margin: 18px 0 10px; color: #394559; font-size: 13px; }
.cycle-comment label { display: block; }
.cycle-comment .optional { margin-left: 6px; color: #929ba8; font-weight: normal; }
.cycle-comment__readonly { white-space: pre-wrap; overflow-wrap: anywhere; color: #394559; }
.title-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.cycle-name {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  overflow-wrap: anywhere;
}

.reject-alert {
  margin-bottom: 12px;
}

.hint {
  margin: 10px 0 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.score-cell {
  font-weight: 600;
  color: #1677ff;
}

.grade-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}

.grade-option {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 18px 26px;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  cursor: pointer;
  background: #fff;
  transition: all 0.15s;
}

.grade-option:hover {
  border-color: var(--el-color-primary);
}

.grade-option--active {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.grade-label {
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.submit-row {
  margin-top: 20px;
}
@media (max-width: 767px) {
  .title-row { font-size: 15px; flex-wrap: wrap; }
  .grade-picker { gap: 8px; }
  .grade-option { flex: 1; padding: 12px 8px; }
  .final-grade-view :deep(.chart-card__head) { flex-wrap: wrap; gap: 8px; }
}
</style>
