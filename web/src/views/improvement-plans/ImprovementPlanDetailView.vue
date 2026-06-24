<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Plus, Delete, Back } from '@element-plus/icons-vue';
import { useAuthStore } from '@/stores/auth.store';
import { improvementPlansApi } from '@/api/improvement-plans.api';
import { IMPROVEMENT_PLAN_STATUS_META } from '@/types/enums';
import { formatDate } from '@/utils/date';
import EmptyState from '@/components/common/EmptyState.vue';
import ChartCard from '@/components/common/ChartCard.vue';
import type {
  ImprovementPlan,
  ImprovementMeasure,
  FillImprovementPlanBody,
  CompleteImprovementPlanBody,
  ConsecutiveDWarning,
} from '@/types/api.types';
import type { ImprovementPlanStatus } from '@/types/enums';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const plan = ref<ImprovementPlan | null>(null);
const warning = ref<ConsecutiveDWarning | null>(null);
const loading = ref(false);
const saving = ref(false);
const completing = ref(false);

const isManagerOrHR = computed(() =>
  ['hr', 'system_admin', 'manager', 'dept_head'].includes(auth.user?.sysRole ?? ''),
);

const canEdit = computed(() => {
  if (!plan.value || !isManagerOrHR.value) return false;
  return plan.value.status === 'draft';
});

const canComplete = computed(() => {
  if (!plan.value || !isManagerOrHR.value) return false;
  return plan.value.status === 'in_progress';
});

const form = reactive<FillImprovementPlanBody>({
  improvementNeed: '',
  importance: '',
  improvementGoal: '',
  targetDate: '',
  measures: [],
});

const completeForm = reactive<CompleteImprovementPlanBody>({
  finalScore: 5,
});

onMounted(async () => {
  const id = route.params.id as string;
  if (!id) return;
  await loadPlan(id);
});

async function loadPlan(id: string) {
  loading.value = true;
  try {
    plan.value = await improvementPlansApi.getDetail(id);
    if (plan.value) {
      syncForm(plan.value);
      loadWarning(plan.value.employeeId);
    }
  } finally {
    loading.value = false;
  }
}

function syncForm(value: ImprovementPlan) {
  form.improvementNeed = value.improvementNeed ?? '';
  form.importance = value.importance ?? '';
  form.improvementGoal = value.improvementGoal ?? '';
  form.targetDate = value.targetDate ?? '';
  form.measures = Array.isArray(value.measures) ? [...value.measures] : [];
}

async function loadWarning(employeeId: string) {
  try {
    warning.value = await improvementPlansApi.getConsecutiveDWarning(employeeId);
  } catch {
    warning.value = null;
  }
}

function statusType(status: ImprovementPlanStatus): string {
  return IMPROVEMENT_PLAN_STATUS_META[status]?.type ?? 'info';
}

function statusLabel(status: ImprovementPlanStatus): string {
  return IMPROVEMENT_PLAN_STATUS_META[status]?.label ?? status;
}

function addMeasure() {
  form.measures.push({ description: '', responsible: '', deadline: '' });
}

function removeMeasure(index: number) {
  form.measures.splice(index, 1);
}

async function handleSave() {
  if (!plan.value) return;
  if (!form.improvementNeed.trim() || !form.importance.trim() || !form.improvementGoal.trim()) {
    ElMessage.warning('请填写改进需求、重要性、改进目标');
    return;
  }
  if (!form.targetDate) {
    ElMessage.warning('请选择达成时间点');
    return;
  }
  saving.value = true;
  try {
    plan.value = await improvementPlansApi.fill(plan.value.id, { ...form });
    ElMessage.success('保存成功');
  } finally {
    saving.value = false;
  }
}

async function handleComplete() {
  if (!plan.value) return;
  if (completeForm.finalScore < 1 || completeForm.finalScore > 10) {
    ElMessage.warning('最终评分需在 1-10 之间');
    return;
  }
  completing.value = true;
  try {
    plan.value = await improvementPlansApi.complete(plan.value.id, { ...completeForm });
    ElMessage.success('已完成改进计划');
  } finally {
    completing.value = false;
  }
}

function goBack() {
  router.push('/improvement-plans');
}
</script>

<template>
  <div v-loading="loading" class="improvement-plan-detail page-stack">
    <ChartCard v-if="plan">
      <template #title>
        <span class="header-left">
          <el-button :icon="Back" link size="small" @click="goBack">返回</el-button>
          <span class="title">改进计划详情</span>
        </span>
      </template>
      <template #extra>
        <el-tag :type="statusType(plan.status) as any" size="small">{{ statusLabel(plan.status) }}</el-tag>
      </template>

      <el-alert
        v-if="warning?.hasWarning"
        title="末尾淘汰预警"
        :description="`该员工最近 ${warning.consecutiveCount} 次有效考核均为 D 等级，请关注。`"
        type="error"
        :closable="false"
        show-icon
        class="warning-alert"
      />

      <el-descriptions :column="2" border size="small" class="info-section">
        <el-descriptions-item label="员工">{{ plan.employeeName || '-' }}（{{ plan.employeeNo || '-' }}）</el-descriptions-item>
        <el-descriptions-item label="部门">{{ plan.deptName || '-' }}</el-descriptions-item>
        <el-descriptions-item label="考核周期">{{ plan.cycleName || '-' }}</el-descriptions-item>
        <el-descriptions-item label="制定人">{{ plan.creatorName || '-' }}</el-descriptions-item>
      </el-descriptions>

      <div class="form-section">
        <h4 class="section-title">改进需求与重要性</h4>
        <el-form label-position="top">
          <el-form-item label="改进需求">
            <el-input
              v-model="form.improvementNeed"
              type="textarea"
              :rows="3"
              placeholder="请描述需要改进的具体方面"
              :disabled="!canEdit"
              maxlength="2000"
              show-word-limit
            />
          </el-form-item>
          <el-form-item label="重要性">
            <el-input
              v-model="form.importance"
              type="textarea"
              :rows="2"
              placeholder="请说明改进的重要性与紧迫性"
              :disabled="!canEdit"
              maxlength="1000"
              show-word-limit
            />
          </el-form-item>
        </el-form>

        <h4 class="section-title">改进目标与达成时间</h4>
        <el-form label-position="top">
          <el-form-item label="改进目标">
            <el-input
              v-model="form.improvementGoal"
              type="textarea"
              :rows="3"
              placeholder="请描述期望达成的具体目标"
              :disabled="!canEdit"
              maxlength="2000"
              show-word-limit
            />
          </el-form-item>
          <el-form-item label="达成时间点">
            <el-date-picker
              v-model="form.targetDate"
              type="date"
              placeholder="选择达成时间点"
              value-format="YYYY-MM-DD"
              :disabled="!canEdit"
            />
          </el-form-item>
        </el-form>

        <h4 class="section-title">具体措施 / 步骤</h4>
        <el-table :data="form.measures" border size="small" class="measures-table">
          <el-table-column label="措施/步骤" min-width="240">
            <template #default="{ row }">
              <el-input v-model="row.description" placeholder="请填写具体措施" :disabled="!canEdit" />
            </template>
          </el-table-column>
          <el-table-column label="责任人" width="160">
            <template #default="{ row }">
              <el-input v-model="row.responsible" placeholder="责任人" :disabled="!canEdit" />
            </template>
          </el-table-column>
          <el-table-column label="时间节点" width="180">
            <template #default="{ row }">
              <el-date-picker
                v-model="row.deadline"
                type="date"
                placeholder="选择时间节点"
                value-format="YYYY-MM-DD"
                :disabled="!canEdit"
              />
            </template>
          </el-table-column>
          <el-table-column v-if="canEdit" label="操作" width="80">
            <template #default="{ $index }">
              <el-button :icon="Delete" link type="danger" size="small" @click="removeMeasure($index)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-button
          v-if="canEdit"
          type="primary"
          :icon="Plus"
          size="small"
          class="add-measure-btn"
          @click="addMeasure"
        >添加措施</el-button>

        <template v-if="plan.status === 'completed'">
          <h4 class="section-title">最终评分</h4>
          <el-form label-position="top">
            <el-form-item label="评分（1-10）">
              <el-input-number v-model="completeForm.finalScore" :min="1" :max="10" disabled />
            </el-form-item>
          </el-form>
        </template>
      </div>

      <div class="actions">
        <el-button v-if="canEdit" type="primary" :loading="saving" @click="handleSave">保存并转为进行中</el-button>

        <template v-if="canComplete">
          <el-divider />
          <el-form :inline="true" class="complete-form">
            <el-form-item label="最终评分（1-10）">
              <el-input-number v-model="completeForm.finalScore" :min="1" :max="10" />
            </el-form-item>
            <el-form-item>
              <el-button type="success" :loading="completing" @click="handleComplete">标记已完成</el-button>
            </el-form-item>
          </el-form>
        </template>
      </div>
    </ChartCard>

    <EmptyState v-else description="改进计划不存在或无权查看" />
  </div>
</template>

<style scoped>
.header-left {
  display: inline-flex;
  align-items: center;
  gap: 12px;
}

.title {
  font-size: 16px;
  font-weight: 600;
}

.warning-alert {
  margin-bottom: 16px;
}

.info-section {
  margin-bottom: 24px;
}

.form-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.section-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: #333;
}

.measures-table {
  margin-top: 8px;
}

.add-measure-btn {
  align-self: flex-start;
  margin-top: 8px;
}

.actions {
  margin-top: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.complete-form {
  display: flex;
  align-items: center;
  gap: 12px;
}
</style>
