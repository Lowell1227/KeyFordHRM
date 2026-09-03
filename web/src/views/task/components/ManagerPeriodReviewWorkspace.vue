<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { periodReviewsApi } from '@/api/period-reviews.api';
import type { PeriodReviewDetail } from '@/types/api.types';
import PerformanceFormWorkspace from './PerformanceFormWorkspace.vue';
import MonthlyReviewReferencePanel from './MonthlyReviewReferencePanel.vue';

interface ManagerFormItem {
  indicatorVersionItemId: string;
  managerScore: number | null;
  managerComment: string;
}

const props = defineProps<{ periodId: string }>();
const emit = defineEmits<{ submitted: []; returned: [] }>();
const detail = ref<PeriodReviewDetail>();
const loading = ref(false);
const error = ref('');
const saving = ref(false);
const submitting = ref(false);
const returning = ref(false);
const draftVersion = ref(0);
const selectedIndex = ref(0);
const formItems = reactive<ManagerFormItem[]>([]);
const validationErrors = reactive<Record<string, string>>({});

const canEdit = computed(() => Boolean(detail.value?.permissions.canEditManager));
const employeeSubmitted = computed(() => Boolean(detail.value?.period.employeeSubmittedAt));
const selectedIndicator = computed(() => detail.value?.indicators[selectedIndex.value]);
const periodTitle = computed(() => {
  const period = detail.value?.period;
  if (!period) return '主管评分';
  if (period.periodType === 'cycle') return '整周期主管评分';
  const [year, month] = period.periodKey.split('-');
  return `${year}年${Number(month)}月主管月度评分`;
});
const followUpName = computed(() => detail.value?.period.periodType === 'cycle' ? '整周期自评' : '月度自评');
const scoreRequiredCount = computed(() => detail.value?.indicators.filter((item) => item.isScoreRequired).length ?? 0);
const completedCount = computed(() => formItems.filter((item, index) => (
  detail.value?.indicators[index]?.isScoreRequired && item.managerScore != null
)).length);
const selfScoreTotal = computed(() => {
  if (detail.value?.period.selfScoreTotal != null) return detail.value.period.selfScoreTotal;
  if (!detail.value || detail.value.indicators.some((item) => item.isScoreRequired && item.selfScore == null)) return null;
  return weightedTotal(detail.value.indicators.map((item) => item.selfScore));
});
const managerScoreTotal = computed(() => {
  if (!detail.value || formItems.length !== detail.value.indicators.length) return null;
  if (formItems.some((item, index) => detail.value?.indicators[index]?.isScoreRequired && item.managerScore == null)) return null;
  return weightedTotal(formItems.map((item) => item.managerScore));
});

function weightedTotal(scores: Array<number | null>): number {
  const weighted = scores.reduce<number>((sum, score, index) => {
    const indicator = detail.value?.indicators[index];
    return indicator?.isScoreRequired ? sum + (score ?? 0) * indicator.weight : sum;
  }, 0);
  const weight = detail.value?.indicators.reduce((sum, indicator) => (
    indicator.isScoreRequired ? sum + indicator.weight : sum
  ), 0) ?? 0;
  return weight > 0 ? Math.round((weighted / weight) * 100) / 100 : 0;
}

function replaceForm(next: PeriodReviewDetail) {
  detail.value = next;
  draftVersion.value = next.period.draftVersion;
  selectedIndex.value = 0;
  formItems.splice(0, formItems.length, ...next.indicators.map((item) => ({
    indicatorVersionItemId: item.indicatorVersionItemId,
    managerScore: item.managerScore,
    managerComment: item.managerComment ?? '',
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
    error.value = candidate.response?.data?.message || candidate.message || '主管评分加载失败';
  } finally {
    loading.value = false;
  }
}

function bodyItems() {
  return formItems.map((item, index) => ({
    indicatorVersionItemId: item.indicatorVersionItemId,
    managerScore: detail.value?.indicators[index]?.isScoreRequired ? item.managerScore : null,
    managerComment: item.managerComment.trim() || null,
  }));
}

function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function useSelfScore(index: number) {
  const selfScore = detail.value?.indicators[index]?.selfScore;
  if (selfScore == null) return;
  formItems[index].managerScore = selfScore;
  delete validationErrors[formItems[index].indicatorVersionItemId];
}

function warningFor(index: number): string[] {
  const managerScore = formItems[index]?.managerScore;
  const selfScore = detail.value?.indicators[index]?.selfScore;
  if (managerScore == null) return [];
  return [
    managerScore < 60 ? '主管评分低于60分，请确认评价依据' : '',
    selfScore != null && Math.abs(managerScore - selfScore) >= 10 ? `与员工自评分相差${Math.abs(managerScore - selfScore)}分` : '',
  ].filter(Boolean);
}

function validate(): boolean {
  for (const key of Object.keys(validationErrors)) delete validationErrors[key];
  formItems.forEach((item, index) => {
    if (detail.value?.indicators[index]?.isScoreRequired && item.managerScore == null) {
      validationErrors[item.indicatorVersionItemId] = '请填写0-100分的主管评分';
    }
  });
  const firstInvalid = formItems.findIndex((item) => validationErrors[item.indicatorVersionItemId]);
  if (firstInvalid >= 0) selectedIndex.value = firstInvalid;
  return firstInvalid < 0;
}

async function saveDraft() {
  if (!canEdit.value || saving.value || submitting.value) return;
  saving.value = true;
  try {
    const result = await periodReviewsApi.saveManagerDraft(props.periodId, {
      expectedVersion: draftVersion.value,
      indicators: bodyItems(),
    });
    draftVersion.value = result.draftVersion;
    ElMessage.success('主管评分草稿已保存');
  } finally {
    saving.value = false;
  }
}

async function returnReview() {
  if (!canEdit.value || returning.value || submitting.value) return;
  let reason = '';
  try {
    const result = await ElMessageBox.prompt('可填写需要员工补充的内容；不填写也可退回。', `退回${followUpName.value}`, {
      confirmButtonText: '确认退回', cancelButtonText: '取消', inputType: 'textarea', inputPlaceholder: '选填退回原因',
    });
    reason = result.value;
  } catch {
    return;
  }
  returning.value = true;
  try {
    await periodReviewsApi.returnManagerReview(props.periodId, {
      expectedVersion: draftVersion.value,
      idempotencyKey: newIdempotencyKey(),
      reason: reason.trim() || null,
    });
    ElMessage.success('已退回员工补充');
    emit('returned');
  } finally {
    returning.value = false;
  }
}

async function submitReview() {
  if (!canEdit.value || saving.value || submitting.value || !validate()) return;
  submitting.value = true;
  try {
    const result = await periodReviewsApi.submitManagerReview(props.periodId, {
      expectedVersion: draftVersion.value,
      idempotencyKey: newIdempotencyKey(),
      indicators: bodyItems(),
    });
    draftVersion.value = result.draftVersion;
    if (detail.value) {
      detail.value.period.status = result.status;
      detail.value.permissions.canEditManager = false;
    }
    ElMessage.success('主管评分已提交');
    emit('submitted');
  } finally {
    submitting.value = false;
  }
}

watch(() => props.periodId, loadReview, { immediate: true });
</script>

<template>
  <section class="manager-review" data-testid="manager-period-review-workspace">
    <el-skeleton v-if="loading" animated :rows="10" />
    <el-result v-else-if="error" icon="error" title="主管评分加载失败" :sub-title="error">
      <template #extra><el-button @click="loadReview">重新加载</el-button></template>
    </el-result>
    <template v-else-if="detail">
      <div class="manager-review__period-bar">
        <div><strong>{{ periodTitle }}</strong><span>{{ detail.context.statusLabel }}</span></div>
        <small>主管评分截止 {{ new Date(detail.period.managerDueAt).toLocaleString('zh-CN', { hour12: false }) }}</small>
      </div>

      <div class="manager-review__totals" data-testid="manager-review-totals">
        <div>
          <span>自评总分</span>
          <strong data-testid="manager-review-self-total">{{ selfScoreTotal ?? '--' }}</strong>
          <small>按有效权重自动计算</small>
        </div>
        <div>
          <span>主管总分</span>
          <strong data-testid="manager-review-manager-total">{{ managerScoreTotal ?? '--' }}</strong>
          <small>按有效权重自动计算</small>
        </div>
      </div>

      <el-alert
        v-if="!employeeSubmitted"
        title="员工尚未提交月度自评，主管评分暂未开放"
        type="info"
        :closable="false"
        show-icon
      />

      <PerformanceFormWorkspace
        v-else
        reference-title="参考信息"
        reference-test-id="manager-review-reference"
        workspace-test-id="manager-review-form-workspace"
      >
        <template #main>
          <div class="manager-review__goals">
            <article
              v-for="(indicator, index) in detail.indicators"
              :key="indicator.indicatorVersionItemId"
              class="manager-score-card"
              :class="{ 'is-selected': selectedIndex === index }"
              data-testid="manager-review-goal-card"
              @click="selectedIndex = index"
            >
              <header>
                <span>{{ index + 1 }}</span>
                <div><h3>{{ indicator.name }}</h3><p>{{ indicator.description || '暂无目标说明' }}</p></div>
                <b>权重 {{ Math.round(indicator.weight * 100) }}%</b>
              </header>
              <div class="manager-score-card__employee">
                <div><span>员工完成度</span><strong>{{ indicator.progress ?? '--' }}{{ indicator.progress == null ? '' : '%' }}</strong></div>
                <div><span>员工自评分</span><strong>{{ indicator.selfScore ?? '--' }}{{ indicator.selfScore == null ? '' : '分' }}</strong></div>
                <div><span>状态</span><strong>{{ indicator.healthStatus === 'on_track' ? '正常推进' : indicator.healthStatus === 'at_risk' ? '存在风险' : indicator.healthStatus === 'blocked' ? '当前受阻' : indicator.healthStatus === 'completed' ? '已经完成' : '本月未更新' }}</strong></div>
                <div class="is-wide"><span>描述</span><strong>{{ indicator.employeeComment || '员工未填写描述' }}</strong></div>
              </div>
              <div class="manager-score-card__form">
                <label v-if="indicator.isScoreRequired">
                  <span>主管评分 <b>*</b></span>
                  <el-input-number v-model="formItems[index].managerScore" :min="0" :max="100" :controls="false" :disabled="!canEdit" aria-label="主管评分" placeholder="0-100" @change="delete validationErrors[indicator.indicatorVersionItemId]" />
                  <em v-if="validationErrors[indicator.indicatorVersionItemId]">{{ validationErrors[indicator.indicatorVersionItemId] }}</em>
                </label>
                <div v-else class="manager-score-card__exempt">不参与评分</div>
                <el-button v-if="indicator.isScoreRequired" :disabled="!canEdit || indicator.selfScore == null" @click.stop="useSelfScore(index)">同意自评</el-button>
                <label class="is-comment">
                  <span>主管说明 <i>选填</i></span>
                  <el-input v-model="formItems[index].managerComment" :disabled="!canEdit" type="textarea" :rows="2" placeholder="填写评价依据或反馈建议" />
                </label>
              </div>
              <div v-if="warningFor(index).length" class="manager-score-card__warnings">
                <span v-for="warning in warningFor(index)" :key="warning">{{ warning }}</span>
              </div>
            </article>
          </div>
        </template>
        <template #reference><MonthlyReviewReferencePanel :indicator="selectedIndicator" /></template>
        <template #actions>
          <footer v-if="canEdit" class="manager-review-actions" data-testid="manager-review-actions">
            <div><strong>评分完成 {{ completedCount }}/{{ scoreRequiredCount }}</strong><span>主管说明选填；分差和低分只提醒，不阻止提交</span></div>
            <div>
              <el-button :loading="returning" :disabled="saving || submitting" @mousedown.prevent @click="returnReview">退回员工补充</el-button>
              <el-button :loading="saving" :disabled="returning || submitting" @mousedown.prevent @click="saveDraft">保存草稿</el-button>
              <el-button type="primary" :loading="submitting" :disabled="saving || returning" @mousedown.prevent @click="submitReview">提交主管评分</el-button>
            </div>
          </footer>
        </template>
      </PerformanceFormWorkspace>
    </template>
  </section>
</template>

<style scoped>
.manager-review { min-width: 0; display: grid; gap: 14px; }
.manager-review__period-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 13px 16px; border: 1px solid #e5eaf2; border-radius: 12px; background: #fff; }
.manager-review__period-bar > div { display: flex; align-items: center; gap: 9px; }
.manager-review__period-bar strong { color: #202a3d; font-size: 16px; }
.manager-review__period-bar span { padding: 3px 8px; border-radius: 4px; background: #eef2ff; color: #5068d8; font-size: 11px; }
.manager-review__period-bar small { color: #7c8799; font-size: 12px; }
.manager-review__totals { display: grid; grid-template-columns: repeat(2, minmax(0, 220px)); gap: 12px; }
.manager-review__totals > div { display: grid; grid-template-columns: auto 1fr; align-items: baseline; gap: 3px 12px; padding: 12px 15px; border: 1px solid #e5eaf2; border-radius: 10px; background: #fff; }
.manager-review__totals span { color: #697487; font-size: 12px; }
.manager-review__totals strong { justify-self: end; color: #202a3d; font-size: 22px; }
.manager-review__totals small { grid-column: 1 / -1; color: #9aa3b2; font-size: 11px; }
.manager-review__goals { display: grid; gap: 12px; }
.manager-score-card { overflow: hidden; border: 1px solid #e5eaf2; border-radius: 13px; background: #fff; }
.manager-score-card.is-selected { border-color: #bdc8f8; box-shadow: 0 3px 12px rgb(79 103 216 / 9%); }
.manager-score-card > header { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; gap: 10px; padding: 14px 15px 11px; border-bottom: 1px solid #edf0f5; }
.manager-score-card > header > span { width: 27px; height: 27px; display: grid; place-items: center; border-radius: 7px; background: #eef2ff; color: #5169d8; font-size: 12px; font-weight: 700; }
.manager-score-card h3, .manager-score-card p { margin: 0; }
.manager-score-card h3 { font-size: 15px; }
.manager-score-card p { margin-top: 4px; color: #8993a5; font-size: 11px; }
.manager-score-card > header b { padding: 4px 8px; border-radius: 5px; background: #f4f6f9; color: #6c778a; font-size: 11px; font-weight: 500; }
.manager-score-card__employee { display: grid; grid-template-columns: 150px 150px minmax(0, 1fr); gap: 12px; padding: 12px 15px; background: #f8fafc; }
.manager-score-card__employee > div { min-width: 0; display: grid; gap: 4px; }
.manager-score-card__employee span, .manager-score-card__form label > span { color: #7f899b; font-size: 11px; }
.manager-score-card__employee strong { overflow: hidden; color: #394559; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.manager-score-card__form { display: grid; grid-template-columns: 160px auto minmax(0, 1fr); align-items: end; gap: 10px; padding: 13px 15px 15px; }
.manager-score-card__form label { min-width: 0; display: grid; gap: 6px; }
.manager-score-card__form label > span b { color: #e85353; }
.manager-score-card__form label > span i { color: #a1a8b4; font-style: normal; }
.manager-score-card__form :deep(.el-input-number) { width: 100%; }
.manager-score-card__form :deep(.el-input-number .el-input__inner) { text-align: left; }
.manager-score-card__form em { color: #e64f4f; font-size: 11px; font-style: normal; }
.manager-score-card__warnings { display: flex; gap: 8px; padding: 0 15px 13px; }
.manager-score-card__warnings span { padding: 5px 8px; border-radius: 5px; background: #fff4e5; color: #a56a0a; font-size: 11px; }
.manager-review-actions { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 14px; border: 1px solid #dfe5f0; border-radius: 12px; background: #fff; box-shadow: 0 8px 24px rgb(31 45 61 / 10%); }
.manager-review-actions > div:first-child { display: grid; gap: 2px; }
.manager-review-actions strong { color: #30394a; font-size: 13px; }
.manager-review-actions span { color: #8a93a3; font-size: 11px; }
.manager-review-actions > div:last-child { display: flex; gap: 8px; }
@media (max-width: 767px) {
  .manager-review { padding-bottom: 112px; }
  .manager-review__period-bar { align-items: flex-start; padding: 12px; }
  .manager-review__period-bar > div { align-items: flex-start; flex-direction: column; gap: 5px; }
  .manager-review__totals { grid-template-columns: 1fr 1fr; }
  .manager-score-card > header { grid-template-columns: 27px minmax(0, 1fr); padding: 12px; }
  .manager-score-card > header b { grid-column: 2; justify-self: start; }
  .manager-score-card__employee, .manager-score-card__form { grid-template-columns: minmax(0, 1fr); padding-right: 12px; padding-left: 12px; }
  .manager-score-card__employee .is-wide { grid-column: 1; }
  .manager-score-card__form > .el-button { justify-self: start; }
  .manager-score-card__warnings { flex-direction: column; padding-right: 12px; padding-left: 12px; }
  .manager-review-actions { position: fixed; z-index: 40; right: 0; bottom: 0; left: 0; align-items: stretch; flex-direction: column; gap: 7px; padding: 9px 10px calc(9px + env(safe-area-inset-bottom)); border-width: 1px 0 0; border-radius: 0; }
  .manager-review-actions > div:first-child span { display: none; }
  .manager-review-actions > div:last-child { display: grid; grid-template-columns: 1fr 1fr 1.2fr; }
  .manager-review-actions :deep(.el-button) { min-width: 0; margin-left: 0; padding-right: 6px; padding-left: 6px; font-size: 12px; }
}
</style>
