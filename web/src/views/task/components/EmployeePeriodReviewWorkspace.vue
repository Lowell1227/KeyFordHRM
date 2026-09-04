<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { periodReviewsApi } from '@/api/period-reviews.api';
import type {
  EmployeePeriodReviewItemBody,
  GoalTrackingHealthStatus,
  PeriodReviewDetail,
  SubmitEmployeePeriodReviewBody,
} from '@/types/api.types';
import type { PerfGrade } from '@/types/enums';
import PerformanceFormWorkspace from './PerformanceFormWorkspace.vue';
import PeriodReviewIndicatorContext from './PeriodReviewIndicatorContext.vue';
import PeriodReviewToolbar from './PeriodReviewToolbar.vue';

type RequiredField = 'selfScore';

interface ReviewFormItem {
  indicatorVersionItemId: string;
  progress: number | null;
  healthStatus: GoalTrackingHealthStatus | null;
  employeeComment: string;
  selfScore: number | null;
}

const props = defineProps<{ periodId: string }>();
const emit = defineEmits<{ submitted: [] }>();

const detail = ref<PeriodReviewDetail>();
const loading = ref(false);
const error = ref('');
const saving = ref(false);
const submitting = ref(false);
const draftVersion = ref(0);
const selectedIndex = ref(0);
const formItems = reactive<ReviewFormItem[]>([]);
const validationErrors = reactive<Record<string, Partial<Record<RequiredField, string>>>>({});
const overallGrade = ref<PerfGrade | null>(null);
const overallGradeError = ref('');
const gradeOptions: PerfGrade[] = ['A', 'B', 'C', 'D'];

const healthOptions: Array<{ value: GoalTrackingHealthStatus; label: string }> = [
  { value: 'on_track', label: '正常推进' },
  { value: 'at_risk', label: '存在风险' },
  { value: 'blocked', label: '当前受阻' },
  { value: 'completed', label: '已经完成' },
];

const canEdit = computed(() => Boolean(detail.value?.permissions.canEditEmployee));
const scoreRequiredCount = computed(() => detail.value?.indicators.filter((item) => item.isScoreRequired).length ?? 0);
const scoreExcludedCount = computed(() => (detail.value?.indicators.length ?? 0) - scoreRequiredCount.value);
const completedCount = computed(() => formItems.filter((item, index) => (
  detail.value?.indicators[index]?.isScoreRequired && item.selfScore != null
)).length);
const selfScoreTotal = computed(() => {
  if (!detail.value || formItems.length !== detail.value.indicators.length) return null;
  if (formItems.some((item, index) => detail.value?.indicators[index]?.isScoreRequired && item.selfScore == null)) return null;
  const weighted = formItems.reduce((sum, item, index) => {
    const indicator = detail.value?.indicators[index];
    return indicator?.isScoreRequired ? sum + (item.selfScore ?? 0) * indicator.weight : sum;
  }, 0);
  const weight = detail.value.indicators.reduce((sum, indicator) => (
    indicator.isScoreRequired ? sum + indicator.weight : sum
  ), 0);
  return weight > 0 ? Math.round((weighted / weight) * 100) / 100 : 0;
});
const scoreProgressText = computed(() => (
  `自评分已填写 ${completedCount.value}/${scoreRequiredCount.value}${scoreExcludedCount.value > 0 ? ` · 不参与评分 ${scoreExcludedCount.value}项` : ''}`
));
const scoreProgressHint = computed(() => (
  scoreExcludedCount.value > 0
    ? `共${detail.value?.indicators.length ?? 0}项；${scoreRequiredCount.value}项参与评分，${scoreExcludedCount.value}项零权重不参与评分。是否评分与正常/受阻状态无关。`
    : '状态、进度和描述可留空；有效权重指标的自评分必填'
));
const periodLabel = computed(() => {
  const period = detail.value?.period;
  if (!period) return '';
  if (period.periodType === 'cycle') return '整周期';
  const key = period.periodKey;
  const [year, month] = key.split('-');
  return `${year}年${Number(month)}月`;
});
const periodNoun = computed(() => detail.value?.period.periodType === 'cycle' ? '本期' : '本月');
const followUpName = computed(() => detail.value?.period.periodType === 'cycle' ? '整周期自评' : '月度自评');
const reviewTitle = computed(() => detail.value?.period.periodType === 'cycle'
  ? '整周期自评'
  : `${periodLabel.value}月度自评`);
const SHANGHAI_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const isEarlySubmission = computed(() => {
  const periodEnd = detail.value?.period.periodEnd;
  if (!periodEnd) return false;
  const parts = SHANGHAI_DATE_FORMATTER.formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) return false;
  return `${year}-${month}-${day}` < periodEnd.slice(0, 10);
});
const submitActionLabel = computed(() => (
  `${isEarlySubmission.value ? '提前提交' : '提交'}${followUpName.value}`
));

function optionalText(value: string): string | null {
  return value.trim() || null;
}

function replaceForm(next: PeriodReviewDetail) {
  detail.value = next;
  draftVersion.value = next.period.draftVersion;
  overallGrade.value = next.period.selfGrade;
  overallGradeError.value = '';
  selectedIndex.value = 0;
  formItems.splice(0, formItems.length, ...next.indicators.map((item) => ({
    indicatorVersionItemId: item.indicatorVersionItemId,
    progress: item.progress,
    healthStatus: item.healthStatus,
    employeeComment: item.employeeComment ?? '',
    selfScore: item.selfScore,
  })));
  for (const key of Object.keys(validationErrors)) delete validationErrors[key];
}

async function loadReview() {
  loading.value = true;
  error.value = '';
  try {
    replaceForm(await periodReviewsApi.findOne(props.periodId));
  } catch (loadError) {
    const candidate = loadError as { message?: string; response?: { data?: { message?: string } } };
    error.value = candidate.response?.data?.message || candidate.message || `${followUpName.value}加载失败`;
  } finally {
    loading.value = false;
  }
}

function bodyItems(): EmployeePeriodReviewItemBody[] {
  return formItems.map((item) => ({
    indicatorVersionItemId: item.indicatorVersionItemId,
    progress: item.progress,
    healthStatus: item.healthStatus,
    employeeComment: optionalText(item.employeeComment),
    selfScore: item.selfScore,
  }));
}

function clearItemError(itemId: string, field: RequiredField) {
  if (validationErrors[itemId]) delete validationErrors[itemId][field];
}

function validateForSubmit(): boolean {
  for (const key of Object.keys(validationErrors)) delete validationErrors[key];
  let firstInvalid = -1;
  if (!overallGrade.value) overallGradeError.value = '请选择本月自评等级';
  formItems.forEach((item, index) => {
    const errors: Partial<Record<RequiredField, string>> = {};
    if (detail.value?.indicators[index]?.isScoreRequired && item.selfScore == null) {
      errors.selfScore = `请填写 0-100 分的${periodNoun.value}自评分`;
    }
    if (Object.keys(errors).length) {
      validationErrors[item.indicatorVersionItemId] = errors;
      if (firstInvalid < 0) firstInvalid = index;
    }
  });
  if (firstInvalid >= 0) {
    selectedIndex.value = firstInvalid;
    void nextTick(() => {
      document.querySelector<HTMLElement>(`[data-goal-index="${firstInvalid}"]`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    });
    return false;
  }
  if (overallGradeError.value) {
    document.querySelector<HTMLElement>('[data-testid="monthly-review-overall-grade"]')?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
    return false;
  }
  return true;
}

async function saveDraft() {
  if (!canEdit.value || saving.value || submitting.value) return;
  saving.value = true;
  try {
    const result = await periodReviewsApi.saveEmployeeDraft(props.periodId, {
      expectedVersion: draftVersion.value,
      selfGrade: overallGrade.value,
      indicators: bodyItems(),
    });
    draftVersion.value = result.draftVersion;
    ElMessage.success('草稿已保存');
  } finally {
    saving.value = false;
  }
}

function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

async function submitReview() {
  if (!canEdit.value || saving.value || submitting.value || !validateForSubmit()) return;
  const selfGrade = overallGrade.value;
  if (!selfGrade) return;
  if (isEarlySubmission.value) {
    try {
      await ElMessageBox.confirm(
        `当前考核期尚未结束。提交后，本期${followUpName.value}结果将锁定，不能再更新本期进展。`,
        `提前提交${followUpName.value}`,
        {
          type: 'warning',
          confirmButtonText: '确认提前提交',
          cancelButtonText: '继续填写',
        },
      );
    } catch {
      return;
    }
  }
  const body: SubmitEmployeePeriodReviewBody = {
    expectedVersion: draftVersion.value,
    idempotencyKey: newIdempotencyKey(),
    selfGrade,
    indicators: bodyItems(),
  };
  submitting.value = true;
  try {
    const result = await periodReviewsApi.submitEmployeeReview(props.periodId, body);
    draftVersion.value = result.draftVersion;
    if (detail.value) {
      detail.value.period.status = result.status;
      detail.value.period.selfGrade = selfGrade;
      detail.value.period.selfScoreTotal = selfScoreTotal.value;
      detail.value.permissions.canEditEmployee = false;
    }
    ElMessage.success(`${followUpName.value}已提交`);
    emit('submitted');
  } finally {
    submitting.value = false;
  }
}

watch(() => props.periodId, loadReview, { immediate: true });
</script>

<template>
  <section class="monthly-review" data-testid="monthly-review-workspace">
    <el-skeleton v-if="loading" animated :rows="10" />
    <el-result v-else-if="error" icon="error" :title="`${followUpName}加载失败`" :sub-title="error">
      <template #extra><el-button @click="loadReview">重新加载</el-button></template>
    </el-result>
    <template v-else-if="detail">
      <PeriodReviewToolbar
        :title="reviewTitle"
        :status-label="detail.context.statusLabel"
        :due-text="`自评截止 ${new Date(detail.period.selfEvalDueAt).toLocaleString('zh-CN', { hour12: false })}`"
        :progress-text="scoreProgressText"
        :progress-hint="scoreProgressHint"
        :show-actions="canEdit"
        toolbar-test-id="monthly-review-period-bar"
        actions-test-id="monthly-review-actions"
      >
        <template #actions>
          <el-button :loading="saving" :disabled="submitting" @mousedown.prevent @click="saveDraft">保存草稿</el-button>
          <el-button type="primary" :loading="submitting" :disabled="saving" @mousedown.prevent @click="submitReview">
            {{ submitActionLabel }}
          </el-button>
        </template>
      </PeriodReviewToolbar>

      <div class="monthly-review__summary" data-testid="monthly-review-overall-grade">
        <div class="monthly-review__total">
          <span>自评总分</span>
          <strong>{{ selfScoreTotal ?? '--' }}</strong>
          <small>按有效权重自动计算</small>
        </div>
        <div class="monthly-review__grade">
          <div>
            <span>本月自评等级 <b>*</b></span>
            <small>等级与分数分别填写，不自动换算</small>
          </div>
          <div v-if="canEdit" class="monthly-review__grade-options">
            <button
              v-for="grade in gradeOptions"
              :key="grade"
              type="button"
              :aria-label="`自评等级 ${grade}`"
              :class="{ 'is-active': overallGrade === grade }"
              :disabled="!canEdit"
              @click="overallGrade = grade; overallGradeError = ''"
            >{{ grade }}</button>
          </div>
          <strong v-else class="monthly-review__grade-result">{{ overallGrade ?? '--' }}</strong>
          <em v-if="overallGradeError" data-testid="monthly-review-grade-error">{{ overallGradeError }}</em>
        </div>
      </div>

      <PerformanceFormWorkspace
        :show-reference="false"
        workspace-test-id="monthly-review-form-workspace"
      >
        <template #main>
          <div class="monthly-review__goals">
            <article
              v-for="(indicator, index) in detail.indicators"
              :key="indicator.indicatorVersionItemId"
              class="monthly-goal-card"
              :class="{ 'is-selected': selectedIndex === index }"
              :data-goal-index="index"
              data-testid="monthly-review-goal-card"
              @click="selectedIndex = index"
            >
              <header class="monthly-goal-card__header">
                <div class="monthly-goal-card__number">{{ index + 1 }}</div>
                <div>
                  <h3>{{ indicator.name }}</h3>
                  <p>{{ indicator.description || '暂无目标说明' }}</p>
                </div>
                <span class="monthly-goal-card__weight">权重 {{ Math.round(indicator.weight * 100) }}%</span>
              </header>

              <PeriodReviewIndicatorContext :indicator="indicator" />

              <div class="monthly-goal-card__core">
                <label class="monthly-field">
                  <span>进度 <i>选填</i></span>
                  <el-input-number
                    v-model="formItems[index].progress"
                    :min="0"
                    :max="100"
                    :controls="false"
                    :disabled="!canEdit"
                    :aria-label="`${periodNoun}完成进度`"
                    placeholder="0-100"
                  />
                  <small>%</small>
                </label>

                <div class="monthly-field monthly-field--status">
                  <span>状态 <i>选填</i></span>
                  <div class="monthly-health-options">
                    <button
                      v-for="option in healthOptions"
                      :key="option.value"
                      type="button"
                      :class="{ 'is-active': formItems[index].healthStatus === option.value }"
                      :disabled="!canEdit"
                      @click.stop="formItems[index].healthStatus = option.value"
                    >{{ option.label }}</button>
                  </div>
                </div>

                <label v-if="indicator.isScoreRequired" class="monthly-field">
                  <span>自评分 <b>*</b></span>
                  <el-input-number
                    v-model="formItems[index].selfScore"
                    :min="0"
                    :max="100"
                    :controls="false"
                    :disabled="!canEdit"
                    :aria-label="`${periodNoun}自评分`"
                    placeholder="0-100"
                    @change="clearItemError(indicator.indicatorVersionItemId, 'selfScore')"
                  />
                  <small>分</small>
                  <em v-if="validationErrors[indicator.indicatorVersionItemId]?.selfScore">
                    {{ validationErrors[indicator.indicatorVersionItemId].selfScore }}
                  </em>
                </label>
                <div v-else class="monthly-field monthly-field--score-exempt">
                  <span>自评分</span>
                  <strong>不参与评分</strong>
                </div>
              </div>

              <div class="monthly-goal-card__details">
                <label class="monthly-field is-wide">
                  <span>描述 <i>选填</i></span>
                  <el-input v-model="formItems[index].employeeComment" :disabled="!canEdit" type="textarea" :rows="2" placeholder="简要说明本月进展和结果" />
                </label>
                <p v-if="indicator.monthlyProgressSource === 'none'" class="monthly-goal-card__empty-progress">
                  本月未更新，可只填写自评分后提交
                </p>
              </div>
            </article>
          </div>
        </template>
      </PerformanceFormWorkspace>
    </template>
  </section>
</template>

<style scoped>
.monthly-review { min-width: 0; display: grid; gap: 14px; }
.monthly-review__summary { display: grid; grid-template-columns: minmax(180px, 220px) minmax(360px, 1fr); gap: 12px; }
.monthly-review__summary > div { min-width: 0; padding: 12px 15px; border: 1px solid #e5eaf2; border-radius: 10px; background: #fff; }
.monthly-review__total { display: grid; grid-template-columns: auto 1fr; align-items: baseline; gap: 3px 12px; }
.monthly-review__total span,
.monthly-review__grade span { color: #697487; font-size: 12px; }
.monthly-review__total strong { justify-self: end; color: #202a3d; font-size: 22px; }
.monthly-review__total small { grid-column: 1 / -1; color: #9aa3b2; font-size: 11px; }
.monthly-review__grade { display: grid; grid-template-columns: minmax(190px, 1fr) auto; align-items: center; gap: 7px 16px; }
.monthly-review__grade > div:first-child { display: grid; gap: 3px; }
.monthly-review__grade span b { color: #e85353; }
.monthly-review__grade small { color: #9aa3b2; font-size: 11px; }
.monthly-review__grade em { grid-column: 1 / -1; color: #e64f4f; font-size: 11px; font-style: normal; }
.monthly-review__grade-options { display: grid; grid-template-columns: repeat(4, 42px); gap: 6px; }
.monthly-review__grade-options button { height: 32px; border: 1px solid #dfe4ec; border-radius: 7px; background: #fff; color: #596579; font-weight: 700; cursor: pointer; }
.monthly-review__grade-options button.is-active { border-color: #6076db; background: #eef2ff; color: #4f67d8; }
.monthly-review__grade-options button:disabled { cursor: default; opacity: .75; }
.monthly-review__grade-result { min-width: 42px; padding: 5px 12px; border-radius: 7px; background: #eef2ff; color: #4f67d8; font-size: 15px; text-align: center; }
.monthly-review__goals { min-width: 0; display: grid; gap: 12px; }
.monthly-goal-card { min-width: 0; overflow: hidden; border: 1px solid #e7ebf2; border-radius: 14px; background: #fff; box-shadow: 0 1px 2px rgb(31 45 61 / 4%); transition: border-color .15s ease, box-shadow .15s ease; }
.monthly-goal-card.is-selected { border-color: #bdc8f8; box-shadow: 0 3px 12px rgb(79 103 216 / 9%); }
.monthly-goal-card__header { min-width: 0; display: grid; grid-template-columns: 30px minmax(0, 1fr) auto; align-items: start; gap: 10px; padding: 15px 16px 12px; border-bottom: 1px solid #edf0f5; }
.monthly-goal-card__number { width: 28px; height: 28px; display: grid; place-items: center; border-radius: 7px; background: #eef2ff; color: #4f67d8; font-size: 12px; font-weight: 700; }
.monthly-goal-card__header h3,
.monthly-goal-card__header p { margin: 0; }
.monthly-goal-card__header h3 { overflow: hidden; color: #20283a; font-size: 15px; text-overflow: ellipsis; white-space: nowrap; }
.monthly-goal-card__header p { margin-top: 4px; overflow: hidden; color: #8891a1; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.monthly-goal-card__weight { padding: 4px 8px; border-radius: 5px; background: #f5f7fa; color: #697488; font-size: 11px; }
.monthly-goal-card__core { display: grid; grid-template-columns: minmax(140px, .7fr) minmax(290px, 1.5fr) minmax(140px, .7fr); gap: 12px; padding: 13px 16px; background: #fbfcfe; }
.monthly-goal-card__details { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 11px 12px; padding: 13px 16px 16px; }
.monthly-field { min-width: 0; position: relative; display: grid; align-content: start; gap: 6px; }
.monthly-field.is-wide { grid-column: 1 / -1; }
.monthly-field > span { color: #566174; font-size: 12px; font-weight: 600; }
.monthly-field > span b { color: #ef5a5a; }
.monthly-field > span i { color: #9ba3b0; font-size: 11px; font-style: normal; font-weight: 400; }
.monthly-field > small { position: absolute; right: 10px; top: 31px; color: #8993a3; font-size: 12px; }
.monthly-field > em { color: #e44f4f; font-size: 11px; font-style: normal; line-height: 1.3; }
.monthly-field :deep(.el-input-number) { width: 100%; }
.monthly-field :deep(.el-input-number .el-input__inner) { padding-right: 30px; text-align: left; }
.monthly-health-options { min-width: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 5px; }
.monthly-health-options button { min-width: 0; height: 32px; overflow: hidden; padding: 0 5px; border: 1px solid #dfe4ec; border-radius: 6px; background: #fff; color: #687386; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.monthly-health-options button.is-active { border-color: #6076db; background: #eef2ff; color: #4f67d8; font-weight: 600; }
.monthly-health-options button:disabled { cursor: default; opacity: .72; }
@media (max-width: 900px) {
  .monthly-goal-card__core { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .monthly-field--status { grid-column: 1 / -1; order: 3; }
}

@media (max-width: 767px) {
  .monthly-review { padding-bottom: 96px; }
  .monthly-review__summary { grid-template-columns: minmax(0, 1fr); }
  .monthly-review__grade { grid-template-columns: minmax(0, 1fr); }
  .monthly-review__grade-options { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .monthly-goal-card { scroll-margin-bottom: 112px; }
  .monthly-goal-card__header { grid-template-columns: 28px minmax(0, 1fr); padding: 13px 12px 11px; }
  .monthly-goal-card__weight { grid-column: 2; justify-self: start; }
  .monthly-goal-card__core,
  .monthly-goal-card__details { grid-template-columns: minmax(0, 1fr); padding-right: 12px; padding-left: 12px; }
  .monthly-field.is-wide,
  .monthly-field--status { grid-column: 1; }
  .monthly-health-options { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
