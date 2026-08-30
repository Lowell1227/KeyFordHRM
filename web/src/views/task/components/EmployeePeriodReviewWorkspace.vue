<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { periodReviewsApi } from '@/api/period-reviews.api';
import type {
  EmployeePeriodReviewItemBody,
  GoalTrackingHealthStatus,
  PeriodReviewDetail,
  PeriodReviewIndicator,
  SubmitEmployeePeriodReviewBody,
} from '@/types/api.types';
import PerformanceFormWorkspace from './PerformanceFormWorkspace.vue';
import MonthlyReviewReferencePanel from './MonthlyReviewReferencePanel.vue';

type RequiredField = 'progress' | 'healthStatus' | 'selfScore';

interface ReviewFormItem {
  indicatorVersionItemId: string;
  progress: number | null;
  healthStatus: GoalTrackingHealthStatus | null;
  actualValueText: string;
  employeeComment: string;
  problemReason: string;
  nextMonthPlan: string;
  supportNeeded: string;
  attachments: PeriodReviewIndicator['attachments'];
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

const healthOptions: Array<{ value: GoalTrackingHealthStatus; label: string }> = [
  { value: 'on_track', label: '正常推进' },
  { value: 'at_risk', label: '存在风险' },
  { value: 'blocked', label: '当前受阻' },
  { value: 'completed', label: '已经完成' },
];

const selectedIndicator = computed(() => detail.value?.indicators[selectedIndex.value]);
const canEdit = computed(() => Boolean(detail.value?.permissions.canEditEmployee));
const completedCount = computed(() => formItems.filter((item) => (
  item.progress != null && item.healthStatus != null && item.selfScore != null
)).length);
const periodLabel = computed(() => {
  const period = detail.value?.period;
  if (!period) return '';
  if (period.periodType === 'cycle') return '整周期';
  const key = period.periodKey;
  const [year, month] = key.split('-');
  return `${year}年${Number(month)}月`;
});
const periodNoun = computed(() => detail.value?.period.periodType === 'cycle' ? '本期' : '本月');

function optionalText(value: string): string | null {
  return value.trim() || null;
}

function replaceForm(next: PeriodReviewDetail) {
  detail.value = next;
  draftVersion.value = next.period.draftVersion;
  selectedIndex.value = 0;
  formItems.splice(0, formItems.length, ...next.indicators.map((item) => ({
    indicatorVersionItemId: item.indicatorVersionItemId,
    progress: item.progress,
    healthStatus: item.healthStatus,
    actualValueText: item.actualValueText ?? '',
    employeeComment: item.employeeComment ?? '',
    problemReason: item.problemReason ?? '',
    nextMonthPlan: item.nextMonthPlan ?? '',
    supportNeeded: item.supportNeeded ?? '',
    attachments: [...item.attachments],
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
    error.value = candidate.response?.data?.message || candidate.message || '复盘与自评加载失败';
  } finally {
    loading.value = false;
  }
}

function bodyItems(): EmployeePeriodReviewItemBody[] {
  return formItems.map((item) => ({
    indicatorVersionItemId: item.indicatorVersionItemId,
    progress: item.progress,
    healthStatus: item.healthStatus,
    actualValueText: optionalText(item.actualValueText),
    employeeComment: optionalText(item.employeeComment),
    problemReason: optionalText(item.problemReason),
    nextMonthPlan: optionalText(item.nextMonthPlan),
    supportNeeded: optionalText(item.supportNeeded),
    attachments: item.attachments,
    selfScore: item.selfScore,
  }));
}

function clearItemError(itemId: string, field: RequiredField) {
  if (validationErrors[itemId]) delete validationErrors[itemId][field];
}

function validateForSubmit(): boolean {
  for (const key of Object.keys(validationErrors)) delete validationErrors[key];
  let firstInvalid = -1;
  formItems.forEach((item, index) => {
    const errors: Partial<Record<RequiredField, string>> = {};
    if (item.progress == null) errors.progress = `请填写${periodNoun.value}完成进度`;
    if (!item.healthStatus) errors.healthStatus = `请选择${periodNoun.value}完成状态`;
    if (item.selfScore == null) errors.selfScore = `请填写 0-100 分的${periodNoun.value}自评分`;
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
  return true;
}

async function saveDraft() {
  if (!canEdit.value || saving.value || submitting.value) return;
  saving.value = true;
  try {
    const result = await periodReviewsApi.saveEmployeeDraft(props.periodId, {
      expectedVersion: draftVersion.value,
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
  const indicators = bodyItems().map((item, index) => ({
    ...item,
    progress: formItems[index].progress!,
    healthStatus: formItems[index].healthStatus!,
    selfScore: formItems[index].selfScore!,
  }));
  const body: SubmitEmployeePeriodReviewBody = {
    expectedVersion: draftVersion.value,
    idempotencyKey: newIdempotencyKey(),
    indicators,
  };
  submitting.value = true;
  try {
    const result = await periodReviewsApi.submitEmployeeReview(props.periodId, body);
    draftVersion.value = result.draftVersion;
    if (detail.value) {
      detail.value.period.status = result.status;
      detail.value.permissions.canEditEmployee = false;
    }
    ElMessage.success('复盘与自评已提交');
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
    <el-result v-else-if="error" icon="error" title="复盘与自评加载失败" :sub-title="error">
      <template #extra><el-button @click="loadReview">重新加载</el-button></template>
    </el-result>
    <template v-else-if="detail">
      <div class="monthly-review__period-bar">
        <div>
          <strong>{{ periodLabel }}复盘与评分</strong>
          <span>{{ detail.context.statusLabel }}</span>
        </div>
        <small>员工截止 {{ new Date(detail.period.selfEvalDueAt).toLocaleString('zh-CN', { hour12: false }) }}</small>
      </div>

      <PerformanceFormWorkspace
        reference-title="参考信息"
        reference-test-id="monthly-review-reference"
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

              <div class="monthly-goal-card__core">
                <label class="monthly-field">
                  <span>{{ periodNoun }}完成进度 <b>*</b></span>
                  <el-input-number
                    v-model="formItems[index].progress"
                    :min="0"
                    :max="100"
                    :controls="false"
                    :disabled="!canEdit"
                    :aria-label="`${periodNoun}完成进度`"
                    placeholder="0-100"
                    @change="clearItemError(indicator.indicatorVersionItemId, 'progress')"
                  />
                  <small>%</small>
                  <em v-if="validationErrors[indicator.indicatorVersionItemId]?.progress">
                    {{ validationErrors[indicator.indicatorVersionItemId].progress }}
                  </em>
                </label>

                <div class="monthly-field monthly-field--status">
                  <span>{{ periodNoun }}完成状态 <b>*</b></span>
                  <div class="monthly-health-options">
                    <button
                      v-for="option in healthOptions"
                      :key="option.value"
                      type="button"
                      :class="{ 'is-active': formItems[index].healthStatus === option.value }"
                      :disabled="!canEdit"
                      @click.stop="formItems[index].healthStatus = option.value; clearItemError(indicator.indicatorVersionItemId, 'healthStatus')"
                    >{{ option.label }}</button>
                  </div>
                  <em v-if="validationErrors[indicator.indicatorVersionItemId]?.healthStatus">
                    {{ validationErrors[indicator.indicatorVersionItemId].healthStatus }}
                  </em>
                </div>

                <label class="monthly-field">
                  <span>{{ periodNoun }}自评分 <b>*</b></span>
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
              </div>

              <div class="monthly-goal-card__details">
                <label class="monthly-field is-wide">
                  <span>{{ periodNoun }}完成情况 <i>选填</i></span>
                  <el-input v-model="formItems[index].actualValueText" :disabled="!canEdit" maxlength="200" placeholder="填写关键结果、完成数量或交付结果" />
                </label>
                <label class="monthly-field">
                  <span>问题原因 <i>选填</i></span>
                  <el-input v-model="formItems[index].problemReason" :disabled="!canEdit" type="textarea" :rows="2" placeholder="如有偏差，简要说明原因" />
                </label>
                <label class="monthly-field">
                  <span>下一步计划 <i>选填</i></span>
                  <el-input v-model="formItems[index].nextMonthPlan" :disabled="!canEdit" type="textarea" :rows="2" placeholder="填写下一步重点动作" />
                </label>
                <label class="monthly-field">
                  <span>所需支持 <i>选填</i></span>
                  <el-input v-model="formItems[index].supportNeeded" :disabled="!canEdit" type="textarea" :rows="2" placeholder="需要主管或协同方提供什么支持" />
                </label>
                <label class="monthly-field">
                  <span>补充说明 <i>选填</i></span>
                  <el-input v-model="formItems[index].employeeComment" :disabled="!canEdit" type="textarea" :rows="2" placeholder="其他需要补充的复盘信息" />
                </label>
              </div>
            </article>
          </div>
        </template>
        <template #reference>
          <MonthlyReviewReferencePanel :indicator="selectedIndicator" />
        </template>
      </PerformanceFormWorkspace>

      <footer v-if="canEdit" class="monthly-review-actions" data-testid="monthly-review-actions">
        <div class="monthly-review-actions__progress">
          <strong>本期填写完成 {{ completedCount }}/{{ formItems.length }}</strong>
          <span>进度、状态和自评分为必填，其余说明选填</span>
        </div>
        <div class="monthly-review-actions__buttons">
          <el-button :loading="saving" :disabled="submitting" @click="saveDraft">保存草稿</el-button>
          <el-button type="primary" :loading="submitting" :disabled="saving" @click="submitReview">提交复盘</el-button>
        </div>
      </footer>
    </template>
  </section>
</template>

<style scoped>
.monthly-review { min-width: 0; display: grid; gap: 14px; }
.monthly-review__period-bar { min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 13px 16px; border: 1px solid #e7ebf2; border-radius: 12px; background: #fff; }
.monthly-review__period-bar > div { min-width: 0; display: flex; align-items: center; gap: 9px; }
.monthly-review__period-bar strong { color: #20283a; font-size: 16px; }
.monthly-review__period-bar span { padding: 3px 8px; border-radius: 4px; background: #fff3df; color: #cc8317; font-size: 11px; }
.monthly-review__period-bar small { color: #7a8495; font-size: 12px; }
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
.monthly-review-actions { position: sticky; z-index: 5; bottom: 10px; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 14px; border: 1px solid #dfe5f0; border-radius: 12px; background: rgb(255 255 255 / 96%); box-shadow: 0 8px 24px rgb(31 45 61 / 10%); backdrop-filter: blur(10px); }
.monthly-review-actions__progress { min-width: 0; display: grid; gap: 2px; }
.monthly-review-actions__progress strong { color: #30394a; font-size: 13px; }
.monthly-review-actions__progress span { color: #8a93a3; font-size: 11px; }
.monthly-review-actions__buttons { flex: 0 0 auto; display: flex; gap: 8px; }

@media (max-width: 900px) {
  .monthly-goal-card__core { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .monthly-field--status { grid-column: 1 / -1; order: 3; }
}

@media (max-width: 767px) {
  .monthly-review { padding-bottom: 96px; }
  .monthly-goal-card { scroll-margin-bottom: 112px; }
  .monthly-review__period-bar { align-items: flex-start; padding: 12px; }
  .monthly-review__period-bar > div { align-items: flex-start; flex-direction: column; gap: 5px; }
  .monthly-review__period-bar small { max-width: 135px; text-align: right; }
  .monthly-goal-card__header { grid-template-columns: 28px minmax(0, 1fr); padding: 13px 12px 11px; }
  .monthly-goal-card__weight { grid-column: 2; justify-self: start; }
  .monthly-goal-card__core,
  .monthly-goal-card__details { grid-template-columns: minmax(0, 1fr); padding-right: 12px; padding-left: 12px; }
  .monthly-field.is-wide,
  .monthly-field--status { grid-column: 1; }
  .monthly-health-options { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .monthly-review-actions { position: fixed; z-index: 40; right: 0; bottom: 0; left: 0; min-width: 0; align-items: stretch; padding: 10px 12px calc(10px + env(safe-area-inset-bottom)); border-width: 1px 0 0; border-radius: 0; }
  .monthly-review-actions__progress span { display: none; }
  .monthly-review-actions__buttons { flex: 1; }
  .monthly-review-actions__buttons :deep(.el-button) { min-width: 0; flex: 1; margin-left: 0; }
}
</style>
