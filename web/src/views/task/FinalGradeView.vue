<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ArrowLeft } from '@element-plus/icons-vue';
import { tasksApi } from '@/api/tasks.api';
import GradeTag from '@/components/common/GradeTag.vue';
import ChartCard from '@/components/common/ChartCard.vue';
import type { FinalGradeDetail } from '@/types/api.types';
import type { PerfGrade } from '@/types/enums';
import { GRADE_LABELS } from '@/utils/grade';

const route = useRoute();
const router = useRouter();

const taskId = computed(() => String(route.params.id));
const detail = ref<FinalGradeDetail | null>(null);
const loading = ref(false);
const submitting = ref(false);
const selectedGrade = ref<PerfGrade | null>(null);

const GRADES: PerfGrade[] = ['A', 'B', 'C', 'D'];

const fmtScore = (s: number | null | undefined) => (s == null ? '—' : s.toFixed(2));

const allPeriodsComplete = computed(() => detail.value?.allPeriodsComplete ?? false);

async function loadDetail() {
  loading.value = true;
  try {
    detail.value = await tasksApi.getFinalGrade(taskId.value);
    selectedGrade.value = detail.value.currentGrade;
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '获取评定数据失败');
    detail.value = null;
  } finally {
    loading.value = false;
  }
}

async function handleSubmit() {
  if (!detail.value || !selectedGrade.value) {
    ElMessage.warning('请选择整周期最终等级');
    return;
  }
  const grade = selectedGrade.value;
  try {
    await ElMessageBox.confirm(
      `提交后 ${detail.value.employeeName} 的整周期最终等级为 ${GRADE_LABELS[grade]}，进入部门复核。提交后不可直接修改，如被退回可重新评定。`,
      '提交整周期结果评定',
      { confirmButtonText: '提交', cancelButtonText: '再想想', type: 'warning' },
    );
  } catch {
    return;
  }
  submitting.value = true;
  try {
    await tasksApi.submitFinalGrade(taskId.value, { grade });
    ElMessage.success('整周期结果评定已提交');
    await loadDetail();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '提交失败');
  } finally {
    submitting.value = false;
  }
}

function goBack() {
  router.push({ name: 'TaskDetail', params: { id: taskId.value } });
}

onMounted(loadDetail);
</script>

<template>
  <div v-loading="loading" class="final-grade-view page-stack">
    <template v-if="detail">
      <ChartCard>
        <template #title>
          <span class="title-row">
            <el-button :icon="ArrowLeft" link aria-label="返回任务详情" @click="goBack" />
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

        <el-descriptions :column="4" size="small" border>
          <el-descriptions-item label="部门">{{ detail.deptName ?? '—' }}</el-descriptions-item>
          <el-descriptions-item label="岗位">{{ detail.position ?? '—' }}</el-descriptions-item>
          <el-descriptions-item label="直属上级">{{ detail.managerName ?? '—' }}</el-descriptions-item>
          <el-descriptions-item label="参考均分">
            <span class="score-cell">{{ fmtScore(detail.calculatedScore) }}</span>
          </el-descriptions-item>
        </el-descriptions>
        <p class="hint">参考均分为各月直属上级评分自动平均，仅作参考，<b>分数与等级无换算关系</b>；最终等级由你独立评定。</p>
      </ChartCard>

      <ChartCard>
        <template #title>月度结果回顾</template>
        <el-table :data="detail.periods" size="small" border>
          <el-table-column prop="periodKey" label="月份" width="100" />
          <el-table-column label="自评等级" width="100">
            <template #default="{ row }">
              <GradeTag v-if="row.selfGrade" :grade="row.selfGrade" size="small" />
              <span v-else>—</span>
            </template>
          </el-table-column>
          <el-table-column label="上级等级" width="100">
            <template #default="{ row }">
              <GradeTag v-if="row.managerGrade" :grade="row.managerGrade" size="small" />
              <span v-else>—</span>
            </template>
          </el-table-column>
          <el-table-column label="自评分" width="100">
            <template #default="{ row }">{{ fmtScore(row.selfScoreTotal) }}</template>
          </el-table-column>
          <el-table-column label="上级评分">
            <template #default="{ row }">{{ fmtScore(row.managerScoreTotal) }}</template>
          </el-table-column>
        </el-table>
      </ChartCard>

      <ChartCard>
        <template #title>整周期最终等级</template>
        <div v-if="detail.canSubmit" class="grade-picker">
          <div
            v-for="grade in GRADES"
            :key="grade"
            class="grade-option"
            :class="{ 'grade-option--active': selectedGrade === grade }"
            @click="selectedGrade = grade"
          >
            <GradeTag :grade="grade" size="large" />
            <span class="grade-label">{{ GRADE_LABELS[grade] }}</span>
          </div>
        </div>
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
    </template>
  </div>
</template>

<style scoped>
.title-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.cycle-name {
  font-size: 13px;
  color: var(--el-text-color-secondary);
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
</style>
