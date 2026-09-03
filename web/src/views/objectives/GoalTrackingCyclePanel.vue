<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { GoalTrackingResult, PerformanceCycleContext } from '@/types/api.types';
import {
  formatGoalTrackingContextLabel,
  goalTrackingStatus,
  selectTrackingAction,
  type GoalTrackingPerson,
} from './goal-tracking';

const props = defineProps<{
  person: GoalTrackingPerson | null;
  contexts: PerformanceCycleContext[];
  selectedContext: PerformanceCycleContext | null;
  selectedCycleId: string;
  result: GoalTrackingResult;
  isSelf: boolean;
  cyclesLoading: boolean;
  cyclesError: string;
  loading: boolean;
  error: string;
  notice: string;
}>();
const route = useRoute();
const router = useRouter();

const emit = defineEmits<{
  cycleChange: [cycleId: string];
  retryCycles: [];
  retryIndicators: [];
  openIndicator: [indicatorId: string];
}>();

const action = computed(() => props.selectedContext ? selectTrackingAction(props.selectedContext) : null);
const summary = computed(() => props.result.summary);
const activeBusinessPeriodLabel = computed(() => {
  const key = summary.value?.activeBusinessPeriodKey;
  if (key === 'cycle') return '本周期';
  const match = /^(\d{4})-(\d{2})$/.exec(key ?? '');
  return match ? `${Number(match[2])}月` : '';
});
const reviewProgressText = computed(() => {
  if (!summary.value || summary.value.periodCount === 0) return '暂未生成月份';
  if (props.selectedContext?.scoringFrequency !== 'monthly') {
    return summary.value.employeeSubmittedCount > 0 ? '整周期已提交' : '整周期待提交';
  }
  if (summary.value.employeeSubmittedCount === summary.value.periodCount) {
    return `${summary.value.periodCount}个月均已提交`;
  }
  return `已提交 ${summary.value.employeeSubmittedCount}/${summary.value.periodCount}个月`;
});
const activeGoalProgressText = computed(() => (
  summary.value
    ? `${summary.value.activeUpdatedGoalCount}/${summary.value.goalCount}个目标有更新`
    : '暂无统计'
));
const pendingManagerPeriodCount = computed(() => (
  props.selectedContext?.periods.filter((period) => (
    Boolean(period.employeeSubmittedAt) && !period.managerSubmittedAt
  )).length ?? 0
));
const activePeriod = computed(() => {
  const periods = props.selectedContext?.periods ?? [];
  const actionPeriodId = action.value?.kind === 'review' ? action.value.periodId : '';
  return periods.find((period) => period.id === actionPeriodId)
    ?? periods.find((period) => (
      period.status === 'self_eval'
      || (period.status === 'manager_scoring' && Boolean(period.employeeSubmittedAt))
    ))
    ?? periods[periods.length - 1]
    ?? null;
});
const actionHint = computed(() => {
  if (!action.value) return '';
  return {
    exempt: props.selectedContext?.task.exemptReason || '本周期无需制定、跟进或评分',
    'goal-setting': '目标尚未完成制定，先完成目标再进入日常跟进',
    'goal-confirmation': '目标等待本人确认，确认后进入持续跟进',
    review: activePeriod.value?.employeeSubmittedAt ? '已提交，等待直属上级月度评分' : '月度自评已开放，可从这里填写',
    waiting: props.result.canEdit
      ? props.isSelf
        ? `仍可继续更新${activeBusinessPeriodLabel.value}目标进展`
        : `员工仍可继续更新${activeBusinessPeriodLabel.value}目标进展`
      : '月度自评已提交，等待直属上级评分',
    complete: '',
    none: props.result.canEdit ? '目标已确认，可持续更新进展' : '当前暂无可更新的目标进展',
  }[action.value.kind];
});
const actionStateLabel = computed(() => {
  if (!action.value) return '查看目标';
  if (action.value.kind === 'goal-setting') return '目标待制定';
  if (action.value.kind === 'goal-confirmation') return '目标待本人确认';
  if (action.value.kind === 'review') {
    if (activePeriod.value?.employeeSubmittedAt) return '待直属上级月度评分';
    if (activePeriod.value?.periodType === 'cycle') return '待填写整周期自评';
    const periodLabel = activePeriod.value ? periodName(activePeriod.value) : '';
    return periodLabel ? `待填写${periodLabel}月度自评` : '待填写月度自评';
  }
  if (action.value.kind === 'waiting' && pendingManagerPeriodCount.value > 0) {
    return `${pendingManagerPeriodCount.value}个月待直属上级评分`;
  }
  return action.value.label;
});

function handleCycleChange(event: Event) {
  emit('cycleChange', (event.target as HTMLSelectElement).value);
}

async function openAction() {
  const current = action.value;
  if (!current || !('taskId' in current)) return;
  let stage: 'goal-setting' | 'goal-confirmation' | 'self-eval' | null = null;
  let periodId: string | undefined;
  if (current.kind === 'goal-setting') {
    stage = 'goal-setting';
  } else if (current.kind === 'goal-confirmation') {
    stage = 'goal-confirmation';
  } else if (current.kind === 'review') {
    stage = 'self-eval';
    periodId = current.periodId;
  }
  if (!stage) return;
  await router.push({
    name: 'TaskDetail',
    params: { id: current.taskId },
    query: { stage, periodId, returnTo: route.fullPath },
  });
}

function periodName(period: PerformanceCycleContext['periods'][number]) {
  if (period.periodType === 'cycle') return '整周期';
  const [, month = period.periodKey] = period.periodKey.split('-');
  return `${Number(month)}月`;
}
</script>

<template>
  <section class="tracking-cycle" aria-label="人员目标跟进">
    <header class="tracking-cycle__hero">
      <span class="tracking-cycle__avatar" aria-hidden="true">
        <img v-if="person?.avatarUrl" :src="person.avatarUrl" alt="">
        <span v-else>{{ person?.name.slice(0, 1) || '—' }}</span>
      </span>
      <div class="tracking-cycle__identity">
        <strong>{{ person?.name || '未选择人员' }}</strong>
        <span v-if="!isSelf">目标执行情况</span>
      </div>
      <div class="tracking-cycle__selector">
        <label for="goal-tracking-cycle">考核周期</label>
        <el-skeleton v-if="cyclesLoading" :rows="1" animated />
        <template v-else>
          <select
            id="goal-tracking-cycle"
            :value="selectedCycleId"
            data-testid="goal-tracking-cycle"
            @change="handleCycleChange"
          >
            <option v-if="contexts.length === 0" value="">暂无考核周期</option>
            <option v-for="context in contexts" :key="context.id" :value="context.id">
              {{ formatGoalTrackingContextLabel(context) }}
            </option>
          </select>
        </template>
      </div>
    </header>

    <p v-if="notice" class="tracking-cycle__notice" role="status">{{ notice }}</p>

    <section v-if="selectedContext" class="tracking-cycle__summary" data-testid="goal-tracking-summary">
      <div>
        <span>{{ selectedContext.scoringFrequency === 'monthly' ? '月度自评' : '整周期自评' }}</span>
        <strong>{{ reviewProgressText }}</strong>
      </div>
      <div>
        <span>{{ activeBusinessPeriodLabel ? `${activeBusinessPeriodLabel}日常跟进` : '日常跟进' }}</span>
        <strong>{{ activeGoalProgressText }}</strong>
      </div>
      <div class="tracking-cycle__next">
        <span>当前阶段</span>
        <strong>{{ actionStateLabel }}</strong>
        <small v-if="actionHint">{{ actionHint }}</small>
      </div>
      <el-button
        v-if="isSelf && action && ['goal-setting', 'goal-confirmation', 'review'].includes(action.kind)"
        type="primary"
        data-testid="goal-tracking-primary-action"
        @click="openAction"
      >{{ action.label }}</el-button>
    </section>

    <div class="tracking-cycle__layout">
      <main class="tracking-cycle__main" data-testid="goal-tracking-surface">
        <header class="tracking-cycle__section-title">
          <div><h2>考核指标</h2><span>持续记录状态、进度和描述</span></div>
        </header>

        <div v-if="cyclesLoading" class="tracking-cycle__state"><el-skeleton :rows="4" animated /></div>
        <div v-else-if="cyclesError" class="tracking-cycle__state is-error">
          <strong>考核周期加载失败</strong><span>{{ cyclesError }}</span>
          <el-button @click="emit('retryCycles')">重新加载周期</el-button>
        </div>
        <div v-else-if="contexts.length === 0" class="tracking-cycle__state">
          <strong>当前没有已开放的考核周期</strong><span>周期开放且您进入参与范围后，会在这里显示。</span>
        </div>
        <div v-else-if="selectedContext?.task.isExempt" class="tracking-cycle__state is-exempt">
          <strong>本周期已豁免</strong>
          <span>{{ selectedContext.task.exemptReason || '无需制定、跟进或评分' }}</span>
        </div>
        <div v-else-if="loading" class="tracking-cycle__state"><el-skeleton :rows="5" animated /></div>
        <div v-else-if="error" class="tracking-cycle__state is-error">
          <strong>考核指标加载失败</strong><span>{{ error }}</span>
          <el-button @click="emit('retryIndicators')">重新加载指标</el-button>
        </div>
        <div v-else-if="result.items.length === 0" class="tracking-cycle__state">
          <strong>{{ action?.kind === 'goal-setting' ? '目标待制定' : action?.kind === 'goal-confirmation' ? '目标待本人确认' : action?.kind === 'waiting' ? action.label : '正式目标版本尚未生成' }}</strong>
          <span>{{ actionHint }}</span>
        </div>
        <div v-else class="tracking-cycle__cards">
          <article v-for="(item, index) in result.items" :key="item.id" class="tracking-goal-card" :data-testid="`goal-tracking-row-${item.id}`">
            <header>
              <button
                type="button"
                class="tracking-goal-card__summary"
                :data-testid="`goal-tracking-indicator-summary-${item.id}`"
                :aria-label="`查看${item.title}详情`"
                @click="emit('openIndicator', item.id)"
              >
                <span class="tracking-goal-card__index">{{ index + 1 }}</span>
                <span class="tracking-goal-card__copy">
                  <strong>{{ item.title }}</strong>
                  <span>{{ item.description || item.scoringStandard || '暂无目标说明' }}</span>
                </span>
              </button>
              <span class="tracking-goal-card__weight">权重 {{ item.weight === null ? '--' : `${item.weight}%` }}</span>
            </header>
            <div class="tracking-goal-card__body">
              <div class="tracking-goal-card__progress">
                <div><span>当前完成度</span><strong>{{ item.progress }}%</strong></div>
                <el-progress :percentage="item.progress" :stroke-width="8" :show-text="false" />
              </div>
              <div class="tracking-goal-card__latest">
                <span>最新进展</span>
                <strong>{{ item.latestProgress?.content || item.latestProgress?.title || '尚未记录进展' }}</strong>
                <small v-if="item.latestProgress">
                  {{ item.latestProgress.businessPeriodKey }} · {{ item.latestProgress.source === 'monthly_self_evaluation' ? '月度自评结果' : '主动进展' }} ·
                  {{ new Date(item.latestProgress.updatedAt).toLocaleString('zh-CN', { hour12: false }) }}
                </small>
              </div>
              <span class="tracking-goal-card__status">{{ goalTrackingStatus({ status: item.status, progress: item.progress, healthStatus: item.latestProgress?.healthStatus }) }}</span>
              <button type="button" :data-testid="`goal-tracking-indicator-button-${item.id}`" @click="emit('openIndicator', item.id)">
                {{ result.canEdit && isSelf ? `更新${activeBusinessPeriodLabel}进展` : '查看详情' }}
              </button>
            </div>
          </article>
        </div>
      </main>

    </div>
  </section>
</template>

<style scoped>
.tracking-cycle { min-width: 0; display: grid; gap: 14px; color: #263249; }
.tracking-cycle__hero { min-width: 0; display: grid; grid-template-columns: 52px minmax(120px, .55fr) minmax(320px, 1.45fr); align-items: center; gap: 12px; padding: 16px 18px; border: 1px solid #e8ecf3; border-radius: 15px; background: #fff; box-shadow: 0 2px 8px rgb(34 55 88 / 4%); }
.tracking-cycle__avatar { width: 48px; height: 48px; display: grid; place-items: center; overflow: hidden; border-radius: 13px; background: linear-gradient(145deg, #576cdf, #3e59cc); color: #fff; font-size: 20px; font-weight: 700; }
.tracking-cycle__avatar img { width: 100%; height: 100%; object-fit: cover; }
.tracking-cycle__identity { min-width: 0; display: grid; gap: 3px; }
.tracking-cycle__identity strong { font-size: 18px; }
.tracking-cycle__identity span { color: #8a95a8; font-size: 12px; }
.tracking-cycle__selector { min-width: 0; display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 4px 10px; }
.tracking-cycle__selector label { color: #7d889c; font-size: 12px; }
.tracking-cycle__selector select { width: 100%; height: 38px; padding: 0 34px 0 12px; border: 1px solid #dce2ec; border-radius: 8px; outline: none; background: #fff; color: #253047; font-size: 13px; font-weight: 600; }
.tracking-cycle__selector select:focus { border-color: #5873df; box-shadow: 0 0 0 3px rgb(88 115 223 / 12%); }
.tracking-cycle__selector small { grid-column: 2; overflow: hidden; color: #8a94a5; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.tracking-cycle__notice { margin: 0; padding: 9px 12px; border: 1px solid #f0d29a; border-radius: 8px; background: #fff8e8; color: #936200; font-size: 12px; }
.tracking-cycle__summary { min-width: 0; display: grid; grid-template-columns: repeat(2, minmax(145px, .7fr)) minmax(240px, 1.4fr) auto; align-items: center; gap: 1px; overflow: hidden; border: 1px solid #e8ecf3; border-radius: 14px; background: #fff; }
.tracking-cycle__summary > div { min-width: 0; min-height: 76px; display: grid; align-content: center; gap: 4px; padding: 12px 16px; border-right: 1px solid #edf0f5; }
.tracking-cycle__summary span { color: #8b95a6; font-size: 11px; }
.tracking-cycle__summary strong { overflow: hidden; color: #293349; font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }
.tracking-cycle__summary small { overflow: hidden; color: #8892a3; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.tracking-cycle__summary :deep(.el-button) { margin: 0 16px; }
.tracking-cycle__layout { min-width: 0; }
.tracking-cycle__main { overflow: hidden; border: 1px solid #e8ecf3; border-radius: 15px; background: #fff; }
.tracking-cycle__section-title { min-height: 58px; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 0 18px; border-bottom: 1px solid #edf0f5; }
.tracking-cycle__section-title > div { min-width: 0; }
.tracking-cycle__section-title h2 { margin: 0; color: #222d42; font-size: 16px; }
.tracking-cycle__section-title span { color: #919bad; font-size: 11px; }
.tracking-cycle__section-title > span { flex: 0 0 auto; }
.tracking-cycle__state { min-height: 230px; display: grid; place-content: center; justify-items: center; gap: 8px; padding: 28px; text-align: center; color: #8b95a7; }
.tracking-cycle__state strong { color: #39455a; font-size: 17px; }
.tracking-cycle__state span { max-width: 480px; font-size: 12px; line-height: 1.7; }
.tracking-cycle__state.is-exempt { background: #fbfcfe; }
.tracking-cycle__state.is-error strong { color: #cc4e4e; }
.tracking-cycle__cards { display: grid; gap: 11px; padding: 14px; background: #f7f9fc; }
.tracking-goal-card { min-width: 0; overflow: hidden; border: 1px solid #e4e9f1; border-radius: 12px; background: #fff; }
.tracking-goal-card > header { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; gap: 10px; padding: 0 15px 0 0; border-bottom: 1px solid #edf0f4; }
.tracking-goal-card__summary { min-width: 0; display: grid; grid-template-columns: 28px minmax(0, 1fr); align-items: start; gap: 10px; padding: 14px 15px 11px; border: 0; border-radius: 10px; outline: 0; background: transparent; text-align: left; cursor: pointer; transition: background-color .15s ease, box-shadow .15s ease; }
.tracking-goal-card__summary:hover { background: #f7f9fd; }
.tracking-goal-card__summary:focus-visible { box-shadow: inset 0 0 0 2px #6b86e8; }
.tracking-goal-card__index { width: 27px; height: 27px; display: grid; place-items: center; border-radius: 7px; background: #eaf3ff; color: #3483e8; font-size: 12px; font-weight: 700; }
.tracking-goal-card__copy { min-width: 0; display: grid; gap: 4px; }
.tracking-goal-card__copy strong { overflow: hidden; color: #27334a; font-size: 15px; text-overflow: ellipsis; white-space: nowrap; }
.tracking-goal-card__copy > span { overflow: hidden; color: #8a94a6; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.tracking-goal-card__weight { margin-top: 14px; padding: 4px 8px; border-radius: 5px; background: #f3f5f8; color: #69758a; font-size: 11px; }
.tracking-goal-card__body { min-width: 0; display: grid; grid-template-columns: minmax(155px, .7fr) minmax(220px, 1.4fr) auto auto; align-items: center; gap: 18px; padding: 13px 15px; }
.tracking-goal-card__progress, .tracking-goal-card__latest { min-width: 0; display: grid; gap: 5px; }
.tracking-goal-card__progress > div { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.tracking-goal-card__body span, .tracking-goal-card__latest small { color: #929bac; font-size: 11px; }
.tracking-goal-card__body strong { overflow: hidden; color: #39455a; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.tracking-goal-card__status { padding: 4px 8px; border-radius: 999px; background: #eef7f1; color: #398559 !important; white-space: nowrap; }
.tracking-goal-card__body > button { padding: 6px 11px; border: 1px solid #cfd8e7; border-radius: 7px; background: #fff; color: #346fd3; font-size: 12px; cursor: pointer; }
@media (max-width: 1100px) {
  .tracking-cycle__summary { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .tracking-cycle__summary :deep(.el-button) { grid-column: 1 / -1; justify-self: end; margin-bottom: 12px; }
}

@media (max-width: 768px) {
  .tracking-cycle { gap: 10px; }
  .tracking-cycle__hero { grid-template-columns: 44px minmax(0, 1fr); gap: 9px; padding: 12px; border-radius: 12px; }
  .tracking-cycle__avatar { width: 42px; height: 42px; border-radius: 11px; }
  .tracking-cycle__identity strong { font-size: 16px; }
  .tracking-cycle__selector { grid-column: 1 / -1; grid-template-columns: minmax(0, 1fr); margin-top: 4px; }
  .tracking-cycle__selector label { display: none; }
  .tracking-cycle__selector small { grid-column: 1; white-space: normal; line-height: 1.5; }
  .tracking-cycle__summary { grid-template-columns: repeat(2, minmax(0, 1fr)); border-radius: 12px; }
  .tracking-cycle__summary > div { min-height: 64px; padding: 10px 12px; }
  .tracking-cycle__summary > div:nth-child(2n) { border-right: 0; }
  .tracking-cycle__summary .tracking-cycle__next { grid-column: 1 / -1; border-top: 1px solid #edf0f5; border-right: 0; }
  .tracking-cycle__summary :deep(.el-button) { grid-column: 1 / -1; margin: 0 12px 12px; }
  .tracking-cycle__section-title { min-height: 52px; padding: 0 13px; }
  .tracking-cycle__section-title > div > span { display: none; }
  .tracking-cycle__cards { padding: 10px; }
  .tracking-goal-card > header { grid-template-columns: minmax(0, 1fr) auto; padding-right: 12px; }
  .tracking-goal-card__summary { padding: 12px; }
  .tracking-goal-card__weight { margin-top: 12px; }
  .tracking-goal-card__body { grid-template-columns: minmax(0, 1fr) auto; gap: 12px; padding: 12px; }
  .tracking-goal-card__progress, .tracking-goal-card__latest { grid-column: 1 / -1; }
}
</style>
