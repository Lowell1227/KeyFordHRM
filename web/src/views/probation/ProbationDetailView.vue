<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ArrowLeft } from '@element-plus/icons-vue';
import { useAuthStore } from '@/stores/auth.store';
import { probationApi } from '@/api/probation.api';
import SignBlock from '@/components/common/SignBlock.vue';
import ChartCard from '@/components/common/ChartCard.vue';
import {
  PROBATION_STATUS_META,
  PROBATION_INDICATOR_TYPE_LABELS,
} from '@/types/enums';
import { formatDate } from '@/utils/date';
import type {
  ProbationReview,
  ProbationReviewIndicator,
} from '@/types/api.types';
import type {
  ProbationReviewStatus,
  SignatureRole,
  ProbationIndicatorType,
} from '@/types/enums';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const user = computed(() => auth.user);

const reviewId = computed(() => route.params.id as string);
const review = ref<ProbationReview | null>(null);
const loading = ref(false);
const savingSelfEval = ref(false);
const savingManagerScore = ref(false);
const closing = ref(false);

const selfEvalForm = reactive<Record<string, { selfScore?: number; selfComment?: string }>>({});
const managerForm = reactive<{
  indicators: Record<string, { managerScore?: number; managerComment?: string }>;
  strengths?: string;
  improvements?: string;
}>({ indicators: {} });

const isEmployee = computed(() => !!(review.value && user.value && review.value.employeeId === user.value.id));
const isManager = computed(() => !!(review.value && user.value && review.value.managerId === user.value.id));
const isHR = computed(() => !!user.value && ['hr', 'system_admin'].includes(user.value.sysRole));

const signatureRole = computed<SignatureRole | null>(() => {
  if (!user.value || !review.value) return null;
  if (review.value.employeeId === user.value.id) return 'assessee';
  if (review.value.managerId === user.value.id) return 'assessor';
  if (['hr', 'system_admin'].includes(user.value.sysRole)) return 'hr';
  return null;
});

const canSubmitSelfEval = computed(() => isEmployee.value && review.value?.status === 'self_eval');
const canSubmitManagerScore = computed(() => isManager.value && review.value?.status === 'manager_scoring');
const canClose = computed(() => isHR.value && review.value?.status !== 'closed');
const allSigned = computed(() => {
  const roles = new Set(review.value?.signatures.map((s) => s.role) ?? []);
  return roles.has('assessee') && roles.has('assessor') && roles.has('hr');
});

const totalScore = computed(() => {
  if (!review.value) return null;
  let sum = 0;
  for (const ind of review.value.indicators) {
    if (ind.managerScore == null) return null;
    sum += ind.managerScore * ind.weight;
  }
  return Number(sum.toFixed(2));
});

function resetForms(data?: ProbationReview) {
  Object.keys(selfEvalForm).forEach((key) => delete selfEvalForm[key]);
  Object.keys(managerForm.indicators).forEach((key) => delete managerForm.indicators[key]);
  managerForm.strengths = data?.strengths ?? '';
  managerForm.improvements = data?.improvements ?? '';
  if (!data) return;
  for (const ind of data.indicators) {
    selfEvalForm[ind.id] = {
      selfScore: ind.selfScore ?? undefined,
      selfComment: ind.selfComment ?? '',
    };
    managerForm.indicators[ind.id] = {
      managerScore: ind.managerScore ?? undefined,
      managerComment: ind.managerComment ?? '',
    };
  }
}

watch(
  () => review.value,
  (data) => resetForms(data ?? undefined),
  { immediate: true },
);

onMounted(() => {
  loadDetail();
});

async function loadDetail() {
  if (!reviewId.value) return;
  loading.value = true;
  try {
    review.value = await probationApi.findOne(reviewId.value);
  } catch {
    review.value = null;
  } finally {
    loading.value = false;
  }
}

function statusLabel(status: ProbationReviewStatus): string {
  return PROBATION_STATUS_META[status]?.label ?? status;
}

function statusType(status: ProbationReviewStatus): string {
  return PROBATION_STATUS_META[status]?.type ?? 'info';
}

function validateSelfEval(): boolean {
  if (!review.value) return false;
  for (const ind of review.value.indicators) {
    const score = selfEvalForm[ind.id]?.selfScore;
    if (score == null || score < 0 || score > 100) {
      ElMessage.warning(`请为指标「${ind.name}」录入 0-100 的自评分数`);
      return false;
    }
  }
  return true;
}

async function handleSubmitSelfEval() {
  if (!review.value || !validateSelfEval()) return;
  savingSelfEval.value = true;
  try {
    await probationApi.submitSelfEval(review.value.id, {
      indicators: review.value.indicators.map((ind) => ({
        id: ind.id,
        selfScore: selfEvalForm[ind.id].selfScore as number,
        selfComment: selfEvalForm[ind.id].selfComment,
      })),
    });
    ElMessage.success('自评提交成功');
    await loadDetail();
  } finally {
    savingSelfEval.value = false;
  }
}

function validateManagerScore(): boolean {
  if (!review.value) return false;
  for (const ind of review.value.indicators) {
    const score = managerForm.indicators[ind.id]?.managerScore;
    if (score == null || score < 0 || score > 100) {
      ElMessage.warning(`请为指标「${ind.name}」录入 0-100 的评分`);
      return false;
    }
  }
  return true;
}

async function handleSubmitManagerScore() {
  if (!review.value || !validateManagerScore()) return;
  savingManagerScore.value = true;
  try {
    await probationApi.submitManagerScore(review.value.id, {
      indicators: review.value.indicators.map((ind) => ({
        id: ind.id,
        managerScore: managerForm.indicators[ind.id].managerScore as number,
        managerComment: managerForm.indicators[ind.id].managerComment,
      })),
      strengths: managerForm.strengths,
      improvements: managerForm.improvements,
    });
    ElMessage.success('评分提交成功');
    await loadDetail();
  } finally {
    savingManagerScore.value = false;
  }
}

async function handleClose() {
  if (!review.value) return;
  if (!allSigned.value) {
    ElMessage.warning('三方签字尚未齐全，无法结束考核');
    return;
  }
  try {
    await ElMessageBox.confirm('确认结束该试用期考核？结束后将不可修改。', '结束确认', {
      type: 'warning',
    });
  } catch {
    return;
  }
  closing.value = true;
  try {
    await probationApi.close(review.value.id);
    ElMessage.success('考核已结束');
    await loadDetail();
  } finally {
    closing.value = false;
  }
}

function goBack() {
  router.back();
}

function sortIndicators(list: ProbationReviewIndicator[]): ProbationReviewIndicator[] {
  return [...list].sort((a, b) => a.sortOrder - b.sortOrder);
}

function indicatorTypeLabel(type: ProbationIndicatorType): string {
  return PROBATION_INDICATOR_TYPE_LABELS[type];
}
</script>

<template>
  <div v-loading="loading" class="probation-detail page-stack">
    <div class="page-header">
      <el-button link :icon="ArrowLeft" @click="goBack">返回</el-button>
      <h2>试用期考核详情</h2>
    </div>

    <template v-if="review">
      <ChartCard class="info-card">
        <el-descriptions :column="3" border size="small">
          <el-descriptions-item label="员工">{{ review.employee.name }}</el-descriptions-item>
          <el-descriptions-item label="主管">{{ review.manager.name }}</el-descriptions-item>
          <el-descriptions-item label="HR">{{ review.hr.name }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="statusType(review.status) as any" size="small">
              {{ statusLabel(review.status) }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="计划转正日期">
            {{ formatDate(review.plannedRegularDate) }}
          </el-descriptions-item>
          <el-descriptions-item label="创建时间">
            {{ formatDate(review.createdAt) }}
          </el-descriptions-item>
        </el-descriptions>
      </ChartCard>

      <ChartCard class="indicators-card">
        <template #title>考核指标</template>
        <template #extra>
          <el-tag v-if="totalScore != null" type="success" size="small">综合得分：{{ totalScore }}</el-tag>
        </template>

        <el-table :data="sortIndicators(review.indicators)" class="app-table" size="small">
          <el-table-column label="指标名称" prop="name" min-width="160" />
          <el-table-column label="类型" width="100">
            <template #default="{ row }">
              {{ indicatorTypeLabel((row as ProbationReviewIndicator).type) }}
            </template>
          </el-table-column>
          <el-table-column label="权重" width="90">
            <template #default="{ row }">{{ (row.weight * 100).toFixed(0) }}%</template>
          </el-table-column>
          <el-table-column label="目标值/标准" prop="targetValue" min-width="160" show-overflow-tooltip />
          <el-table-column label="自评分数" width="110">
            <template #default="{ row }">
              <span v-if="row.selfScore != null">{{ row.selfScore }}</span>
              <span v-else class="text-placeholder">-</span>
            </template>
          </el-table-column>
          <el-table-column label="主管评分" width="110">
            <template #default="{ row }">
              <span v-if="row.managerScore != null">{{ row.managerScore }}</span>
              <span v-else class="text-placeholder">-</span>
            </template>
          </el-table-column>
          <el-table-column label="主管评语" prop="managerComment" min-width="160" show-overflow-tooltip />
        </el-table>
      </ChartCard>

      <!-- 员工自评 -->
      <ChartCard v-if="canSubmitSelfEval" class="form-card">
        <template #title>员工自评</template>
        <el-form label-position="top">
          <div
            v-for="ind in review.indicators"
            :key="ind.id"
            class="indicator-form-item"
          >
            <div class="indicator-form-header">
              <span class="indicator-name">{{ ind.name }}</span>
              <el-tag size="small">{{ PROBATION_INDICATOR_TYPE_LABELS[ind.type] }}</el-tag>
            </div>
            <el-row :gutter="16">
              <el-col :span="6">
                <el-form-item :label="`自评分数（0-100）`">
                  <el-input-number
                    v-model="selfEvalForm[ind.id].selfScore"
                    :min="0"
                    :max="100"
                    :precision="2"
                    style="width: 100%"
                  />
                </el-form-item>
              </el-col>
              <el-col :span="18">
                <el-form-item label="自评说明">
                  <el-input
                    v-model="selfEvalForm[ind.id].selfComment"
                    type="textarea"
                    :rows="2"
                    maxlength="2000"
                    show-word-limit
                  />
                </el-form-item>
              </el-col>
            </el-row>
          </div>
          <div class="form-actions">
            <el-button type="primary" :loading="savingSelfEval" @click="handleSubmitSelfEval"
              >提交自评</el-button
            >
          </div>
        </el-form>
      </ChartCard>

      <!-- 主管评分 -->
      <ChartCard v-if="canSubmitManagerScore" class="form-card">
        <template #title>主管评分</template>
        <el-form label-position="top">
          <div
            v-for="ind in review.indicators"
            :key="ind.id"
            class="indicator-form-item"
          >
            <div class="indicator-form-header">
              <span class="indicator-name">{{ ind.name }}</span>
              <el-tag size="small">{{ PROBATION_INDICATOR_TYPE_LABELS[ind.type] }}</el-tag>
            </div>
            <el-row :gutter="16">
              <el-col :span="6">
                <el-form-item :label="`评分（0-100）`">
                  <el-input-number
                    v-model="managerForm.indicators[ind.id].managerScore"
                    :min="0"
                    :max="100"
                    :precision="2"
                    style="width: 100%"
                  />
                </el-form-item>
              </el-col>
              <el-col :span="18">
                <el-form-item label="评语">
                  <el-input
                    v-model="managerForm.indicators[ind.id].managerComment"
                    type="textarea"
                    :rows="2"
                    maxlength="2000"
                    show-word-limit
                  />
                </el-form-item>
              </el-col>
            </el-row>
          </div>

          <el-form-item label="优势反馈（strengths）">
            <el-input
              v-model="managerForm.strengths"
              type="textarea"
              :rows="4"
              maxlength="4000"
              show-word-limit
              placeholder="填写员工的优势与亮点"
            />
          </el-form-item>

          <el-form-item label="待改进项（improvements）">
            <el-input
              v-model="managerForm.improvements"
              type="textarea"
              :rows="4"
              maxlength="4000"
              show-word-limit
              placeholder="填写员工待改进的方面"
            />
          </el-form-item>

          <div class="form-actions">
            <el-button type="primary" :loading="savingManagerScore" @click="handleSubmitManagerScore"
              >提交评分</el-button
            >
          </div>
        </el-form>
      </ChartCard>

      <!-- 优势/待改进展示 -->
      <ChartCard
        v-if="review.status === 'manager_scoring' || review.status === 'closed'"
        class="form-card"
      >
        <template #title>综合评价</template>
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="优势反馈">
            <pre class="pre-wrap">{{ review.strengths || '暂无' }}</pre>
          </el-descriptions-item>
          <el-descriptions-item label="待改进项">
            <pre class="pre-wrap">{{ review.improvements || '暂无' }}</pre>
          </el-descriptions-item>
        </el-descriptions>
      </ChartCard>

      <!-- 三方签字 -->
      <SignBlock
        v-if="review"
        business-type="probation_task"
        :business-record-id="review.id"
        :role="signatureRole"
        title="试用期考核三方签字"
        @signed="loadDetail"
      />

      <!-- HR 结束考核 -->
      <ChartCard v-if="canClose" class="form-card">
        <template #title>HR 归档</template>
        <p class="close-tip">
          请确认员工、主管、HR 三方均已签字后再结束考核。
          <span v-if="!allSigned" class="text-danger">当前签字尚未齐全。 </span>
        </p>
        <div class="form-actions">
          <el-button type="success" :loading="closing" :disabled="!allSigned" @click="handleClose"
            >结束考核</el-button
          >
        </div>
      </ChartCard>
    </template>
  </div>
</template>

<style scoped>
.page-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.page-header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.indicator-form-item {
  margin-bottom: 16px;
  padding: 16px;
  background: var(--el-fill-color-light);
  border-radius: 4px;
}

.indicator-form-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.indicator-name {
  font-weight: 500;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}

.text-placeholder {
  color: var(--el-text-color-placeholder);
}

.text-danger {
  color: var(--el-color-danger);
}

.close-tip {
  color: var(--el-text-color-regular);
  margin: 0 0 16px;
}

.pre-wrap {
  white-space: pre-wrap;
  margin: 0;
  font-family: inherit;
  line-height: 1.6;
}
</style>
