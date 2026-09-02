<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { GoalTrackingResult, PerformanceCycleContext } from '@/types/api.types';
import {
  formatGoalTrackingContextLabel,
  formatGoalTrackingContextMeta,
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
const completedPeriods = computed(() => props.selectedContext?.periods.filter((period) => (
  ['completed', 'no_result'].includes(period.status)
)).length ?? 0);
const activePeriod = computed(() => props.selectedContext?.periods.find((period) => (
  ['self_eval', 'manager_scoring'].includes(period.status)
)) ?? props.selectedContext?.periods[props.selectedContext.periods.length - 1] ?? null);
const actionHint = computed(() => {
  if (!action.value) return '';
  return {
    exempt: props.selectedContext?.task.exemptReason || '本周期无需制定、跟进或评分',
    'goal-setting': '目标尚未完成制定，先完成目标再进入日常跟进',
    'goal-confirmation': '目标等待本人确认，确认后进入持续跟进',
    review: activePeriod.value?.employeeSubmittedAt ? '已提交，等待主管评分' : '月度跟进已开放，可从这里继续填写',
    waiting: action.value.label,
    complete: '全部评分期次已完成，等待周期结果流转',
    none: '目标已确认，可持续更新进展',
  }[action.value.kind];
});
const actionStateLabel = computed(() => {
  if (!action.value) return '查看目标';
  if (action.value.kind === 'goal-setting') return '目标待制定';
  if (action.value.kind === 'goal-confirmation') return '目标待本人确认';
  if (action.value.kind === 'review') return activePeriod.value?.employeeSubmittedAt ? '待主管评分' : '待填写';
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

function periodName(context: PerformanceCycleContext, period: PerformanceCycleContext['periods'][number]) {
  if (period.periodType === 'cycle') return '整周期';
  const [, month = period.periodKey] = period.periodKey.split('-');
  return `${Number(month)}月`;
}

function periodStatus(period: PerformanceCycleContext['periods'][number]) {
  if (period.status === 'unopened') {
    if (action.value?.kind === 'goal-setting') return '待目标制定';
    if (action.value?.kind === 'goal-confirmation') return '待目标确认';
    return '未开放';
  }
  if (period.status === 'self_eval') return period.employeeSubmittedAt ? '待主管评分' : '待填写';
  if (period.status === 'manager_scoring') return period.employeeSubmittedAt ? '待主管评分' : '月度跟进逾期待补交';
  if (period.status === 'completed') return '已评分';
  return '无结果';
}

function dueDate(value: string) {
  return new Date(value).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
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
        <span>{{ isSelf ? '我的目标跟进' : '目标执行情况' }}</span>
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
          <small v-if="selectedContext">{{ formatGoalTrackingContextMeta(selectedContext) }}</small>
        </template>
      </div>
    </header>

    <p v-if="notice" class="tracking-cycle__notice" role="status">{{ notice }}</p>

    <section v-if="selectedContext" class="tracking-cycle__summary" data-testid="goal-tracking-summary">
      <div>
        <span>评分方式</span>
        <strong>{{ selectedContext.scoringFrequency === 'monthly' ? '月度跟进' : '整周期跟进' }}</strong>
      </div>
      <div>
        <span>期次进度</span>
        <strong>{{ completedPeriods }}/{{ selectedContext.periods.length || 0 }} 已完成</strong>
      </div>
      <div>
        <span>指标权重</span>
        <strong>{{ result.totalWeight }}%</strong>
      </div>
      <div class="tracking-cycle__next">
        <span>当前动作</span>
        <strong>{{ actionStateLabel }}</strong>
        <small>{{ actionHint }}</small>
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
          <div><h2>考核指标</h2><span>持续记录结果、风险与下一步动作</span></div>
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
              <span class="tracking-goal-card__index">{{ index + 1 }}</span>
              <div><h3>{{ item.title }}</h3><p>{{ item.description || item.scoringStandard || '暂无目标说明' }}</p></div>
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
                <small v-if="item.latestProgress">{{ new Date(item.latestProgress.updatedAt).toLocaleString('zh-CN', { hour12: false }) }}</small>
              </div>
              <span class="tracking-goal-card__status">{{ goalTrackingStatus({ status: item.status, progress: item.progress, healthStatus: item.latestProgress?.healthStatus }) }}</span>
              <button type="button" :data-testid="`goal-tracking-indicator-button-${item.id}`" @click="emit('openIndicator', item.id)">
                {{ result.canEdit && isSelf ? '更新进展' : '查看详情' }}
              </button>
            </div>
          </article>
        </div>
      </main>

      <aside v-if="selectedContext && !selectedContext.task.isExempt" class="tracking-cycle__periods" aria-label="评分期次">
        <header><h2>目标跟进</h2><span>{{ selectedContext.scoringFrequency === 'monthly' ? '按月推进' : '整周期一次完成' }}</span></header>
        <ol v-if="selectedContext.periods.length">
          <li v-for="period in selectedContext.periods" :key="period.id" :class="`is-${period.status}`">
            <i aria-hidden="true" />
            <div><strong>{{ periodName(selectedContext, period) }}</strong><span>{{ periodStatus(period) }}</span></div>
            <small>{{ period.status === 'manager_scoring' ? `主管评分截止 ${dueDate(period.managerDueAt)}` : `自评截止 ${dueDate(period.selfEvalDueAt)}` }}</small>
          </li>
        </ol>
        <div v-else class="tracking-cycle__period-empty">目标确认后将生成正式复盘期次</div>
      </aside>
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
.tracking-cycle__summary { min-width: 0; display: grid; grid-template-columns: repeat(3, minmax(95px, .55fr)) minmax(220px, 1.35fr) auto; align-items: center; gap: 1px; overflow: hidden; border: 1px solid #e8ecf3; border-radius: 14px; background: #fff; }
.tracking-cycle__summary > div { min-width: 0; min-height: 76px; display: grid; align-content: center; gap: 4px; padding: 12px 16px; border-right: 1px solid #edf0f5; }
.tracking-cycle__summary span { color: #8b95a6; font-size: 11px; }
.tracking-cycle__summary strong { overflow: hidden; color: #293349; font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }
.tracking-cycle__summary small { overflow: hidden; color: #8892a3; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.tracking-cycle__summary :deep(.el-button) { margin: 0 16px; }
.tracking-cycle__layout { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) 268px; align-items: start; gap: 14px; }
.tracking-cycle__main, .tracking-cycle__periods { overflow: hidden; border: 1px solid #e8ecf3; border-radius: 15px; background: #fff; }
.tracking-cycle__section-title, .tracking-cycle__periods > header { min-height: 58px; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 0 18px; border-bottom: 1px solid #edf0f5; }
.tracking-cycle__section-title > div { min-width: 0; }
.tracking-cycle__section-title h2, .tracking-cycle__periods h2 { margin: 0; color: #222d42; font-size: 16px; }
.tracking-cycle__section-title span, .tracking-cycle__periods header span { color: #919bad; font-size: 11px; }
.tracking-cycle__section-title > span { flex: 0 0 auto; }
.tracking-cycle__state { min-height: 230px; display: grid; place-content: center; justify-items: center; gap: 8px; padding: 28px; text-align: center; color: #8b95a7; }
.tracking-cycle__state strong { color: #39455a; font-size: 17px; }
.tracking-cycle__state span { max-width: 480px; font-size: 12px; line-height: 1.7; }
.tracking-cycle__state.is-exempt { background: #fbfcfe; }
.tracking-cycle__state.is-error strong { color: #cc4e4e; }
.tracking-cycle__cards { display: grid; gap: 11px; padding: 14px; background: #f7f9fc; }
.tracking-goal-card { min-width: 0; overflow: hidden; border: 1px solid #e4e9f1; border-radius: 12px; background: #fff; }
.tracking-goal-card > header { min-width: 0; display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; align-items: start; gap: 10px; padding: 14px 15px 11px; border-bottom: 1px solid #edf0f4; }
.tracking-goal-card__index { width: 27px; height: 27px; display: grid; place-items: center; border-radius: 7px; background: #eaf3ff; color: #3483e8; font-size: 12px; font-weight: 700; }
.tracking-goal-card h3, .tracking-goal-card p { margin: 0; }
.tracking-goal-card h3 { overflow: hidden; font-size: 15px; text-overflow: ellipsis; white-space: nowrap; }
.tracking-goal-card p { margin-top: 4px; overflow: hidden; color: #8a94a6; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.tracking-goal-card__weight { padding: 4px 8px; border-radius: 5px; background: #f3f5f8; color: #69758a; font-size: 11px; }
.tracking-goal-card__body { min-width: 0; display: grid; grid-template-columns: minmax(155px, .7fr) minmax(220px, 1.4fr) auto auto; align-items: center; gap: 18px; padding: 13px 15px; }
.tracking-goal-card__progress, .tracking-goal-card__latest { min-width: 0; display: grid; gap: 5px; }
.tracking-goal-card__progress > div { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.tracking-goal-card__body span, .tracking-goal-card__latest small { color: #929bac; font-size: 11px; }
.tracking-goal-card__body strong { overflow: hidden; color: #39455a; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.tracking-goal-card__status { padding: 4px 8px; border-radius: 999px; background: #eef7f1; color: #398559 !important; white-space: nowrap; }
.tracking-goal-card button { padding: 6px 11px; border: 1px solid #cfd8e7; border-radius: 7px; background: #fff; color: #346fd3; font-size: 12px; cursor: pointer; }
.tracking-cycle__periods ol { position: relative; display: grid; gap: 0; margin: 0; padding: 12px 16px 16px; list-style: none; }
.tracking-cycle__periods li { position: relative; min-height: 58px; display: grid; grid-template-columns: 15px minmax(0, 1fr); gap: 9px; padding: 8px 0 8px; }
.tracking-cycle__periods li:not(:last-child)::after { content: ''; position: absolute; top: 26px; bottom: -16px; left: 5px; width: 1px; background: #dce2ec; }
.tracking-cycle__periods li i { z-index: 1; width: 11px; height: 11px; margin-top: 4px; border: 3px solid #fff; border-radius: 50%; background: #aeb7c6; box-shadow: 0 0 0 1px #cbd2de; }
.tracking-cycle__periods li.is-self_eval i, .tracking-cycle__periods li.is-manager_scoring i { background: #5873df; box-shadow: 0 0 0 1px #5873df; }
.tracking-cycle__periods li.is-completed i { background: #42a66b; box-shadow: 0 0 0 1px #42a66b; }
.tracking-cycle__periods li div { min-width: 0; display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.tracking-cycle__periods li strong { font-size: 13px; }
.tracking-cycle__periods li span, .tracking-cycle__periods li small { color: #8a94a5; font-size: 11px; }
.tracking-cycle__periods li small { grid-column: 2; }
.tracking-cycle__period-empty { padding: 24px 16px; color: #8b95a6; font-size: 12px; text-align: center; }

@media (max-width: 1100px) {
  .tracking-cycle__layout { grid-template-columns: minmax(0, 1fr); }
  .tracking-cycle__periods ol { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; }
  .tracking-cycle__periods li { min-height: auto; padding: 8px; border: 1px solid #e7ebf2; border-radius: 8px; }
  .tracking-cycle__periods li::after { display: none; }
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
  .tracking-goal-card > header { grid-template-columns: 27px minmax(0, 1fr); padding: 12px; }
  .tracking-goal-card__weight { grid-column: 2; justify-self: start; }
  .tracking-goal-card__body { grid-template-columns: minmax(0, 1fr) auto; gap: 12px; padding: 12px; }
  .tracking-goal-card__progress, .tracking-goal-card__latest { grid-column: 1 / -1; }
  .tracking-cycle__periods ol { display: flex; overflow-x: auto; }
  .tracking-cycle__periods li { min-width: 170px; flex: 0 0 170px; }
}
</style>
