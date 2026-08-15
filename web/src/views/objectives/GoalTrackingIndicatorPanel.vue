<script setup lang="ts">
import { ref } from 'vue';
import type { AssessmentCycle, GoalTrackingResult } from '@/types/api.types';
import {
  GOAL_TRACKING_COLUMNS,
  goalTrackingStatus,
  parseVisibleColumns,
  type GoalTrackingColumn,
  type GoalTrackingPerson,
} from './goal-tracking';

const VISIBLE_COLUMNS_KEY = 'kayford.goalTracking.visibleColumns';
const visibleColumns = ref(parseVisibleColumns(localStorage.getItem(VISIBLE_COLUMNS_KEY)));
const columnLabels: Record<GoalTrackingColumn, string> = {
  latestProgress: '最新进展',
  status: '状态',
  progress: '进展',
  weight: '权重',
};

defineProps<{
  person: GoalTrackingPerson | null;
  cycles: AssessmentCycle[];
  selectedCycleId: string;
  result: GoalTrackingResult;
  cyclesLoading: boolean;
  cyclesError: string;
  loading: boolean;
  error: string;
  notice: string;
  highlightedObjectiveId: string;
}>();
const emit = defineEmits<{
  cycleChange: [cycleId: string];
  retryCycles: [];
  retryIndicators: [];
}>();

function setColumn(column: GoalTrackingColumn, visible: boolean) {
  visibleColumns.value = visible
    ? [...new Set([...visibleColumns.value, column])]
    : visibleColumns.value.filter((candidate) => candidate !== column);
  localStorage.setItem(VISIBLE_COLUMNS_KEY, JSON.stringify(visibleColumns.value));
}

function handleCycleChange(event: Event) {
  emit('cycleChange', (event.target as HTMLSelectElement).value);
}
</script>

<template>
  <section class="tracking-indicators" aria-label="人员考核指标">
    <header class="goal-person-summary tracking-indicators__context">
      <span class="goal-person-avatar tracking-indicators__avatar" aria-hidden="true">
        <img v-if="person?.avatarUrl" :src="person.avatarUrl" alt="">
        <span v-else>{{ person?.name.slice(0, 1) || '—' }}</span>
      </span>
      <div>
        <strong>{{ person?.name || '未选择人员' }}</strong>
        <el-skeleton v-if="cyclesLoading" :rows="1" animated class="tracking-indicators__cycle-skeleton" />
        <label v-else class="tracking-indicators__cycle">
          <span>周期：</span>
          <select
            :value="selectedCycleId"
            data-testid="goal-tracking-cycle"
            aria-label="考核周期"
            @change="handleCycleChange"
          >
            <option v-if="cycles.length === 0" value="">暂无考核周期</option>
            <option v-for="cycle in cycles" :key="cycle.id" :value="cycle.id">
              {{ cycle.name }}
            </option>
          </select>
        </label>
      </div>
    </header>

    <p v-if="notice" class="tracking-indicators__notice" role="status">
      {{ notice }}
    </p>

    <div
      class="goal-indicator-surface tracking-indicators__table"
      data-testid="goal-tracking-surface"
      role="table"
      aria-label="考核指标"
    >
      <div class="goal-indicator-header tracking-indicators__title">
        <h2>考核指标</h2>
        <div class="tracking-indicators__actions">
          <el-popover placement="bottom-end" :width="180" trigger="click">
            <div class="tracking-indicators__columns" aria-label="可选指标列">
              <label v-for="column in GOAL_TRACKING_COLUMNS" :key="column">
                <input
                  type="checkbox"
                  :checked="visibleColumns.includes(column)"
                  @change="setColumn(column, ($event.target as HTMLInputElement).checked)"
                >
                <span>{{ columnLabels[column] }}</span>
              </label>
            </div>
            <template #reference>
              <button type="button" class="tracking-indicators__columns-button">自定义列</button>
            </template>
          </el-popover>
          <span>维度权重：{{ result.totalWeight }}%</span>
        </div>
      </div>
      <div
        class="goal-indicator-grid goal-indicator-table-head tracking-indicators__header"
        :class="`has-${visibleColumns.length}-optional`"
        role="row"
      >
        <div role="columnheader">考核指标</div>
        <div v-if="visibleColumns.includes('latestProgress')" role="columnheader">最新进展</div>
        <div v-if="visibleColumns.includes('status')" role="columnheader">状态</div>
        <div v-if="visibleColumns.includes('progress')" role="columnheader">进展</div>
        <div v-if="visibleColumns.includes('weight')" role="columnheader">权重</div>
      </div>

      <div v-if="cyclesLoading" class="tracking-indicators__message" role="row">
        <div role="cell" aria-label="周期加载状态"><el-skeleton :rows="2" animated /></div>
      </div>
      <div v-else-if="cyclesError" class="tracking-indicators__message" role="row">
        <div role="cell" aria-label="周期加载错误">
          {{ cyclesError }}
          <button type="button" @click="emit('retryCycles')">重新加载周期</button>
        </div>
      </div>
      <div v-else-if="cycles.length === 0" class="tracking-indicators__message" role="row">
        <div role="cell" aria-label="周期空状态">暂无可用考核周期</div>
      </div>
      <div v-else-if="loading" class="tracking-indicators__message" role="row">
        <div role="cell" aria-label="指标加载状态"><el-skeleton :rows="2" animated /></div>
      </div>
      <div v-else-if="error" class="tracking-indicators__message" role="row">
        <div role="cell" aria-label="加载错误">
          {{ error }}
          <button type="button" @click="emit('retryIndicators')">重新加载指标</button>
        </div>
      </div>
      <div v-else-if="result.items.length === 0" class="tracking-indicators__message" role="row">
        <div role="cell" aria-label="空状态">暂无考核指标</div>
      </div>
      <template v-else>
        <div
          v-for="(item, index) in result.items"
          :key="item.id"
          class="goal-indicator-grid goal-indicator-row tracking-indicators__row"
          :class="[`has-${visibleColumns.length}-optional`, { 'is-highlighted': item.id === highlightedObjectiveId }]"
          :data-testid="`goal-tracking-row-${item.id}`"
          role="row"
        >
          <div class="goal-indicator-cell" data-label="指标名称" role="cell" aria-label="考核指标">
            <span class="tracking-indicators__objective">
              <span class="goal-indicator-index" aria-hidden="true">{{ index + 1 }}</span>
              <strong>{{ item.title }}</strong>
            </span>
          </div>
          <div
            v-if="visibleColumns.includes('latestProgress')"
            class="goal-indicator-cell"
            data-label="最新进展"
            role="cell"
            aria-label="最新进展"
          >
            <span class="tracking-indicators__latest">
              {{ item.latestProgress
                ? `${item.latestProgress.title} · ${item.latestProgress.progress}%`
                : '暂无进展' }}
            </span>
          </div>
          <div v-if="visibleColumns.includes('status')" class="goal-indicator-cell" data-label="状态" role="cell" aria-label="状态">
            <span>{{ goalTrackingStatus(item) }}</span>
          </div>
          <div v-if="visibleColumns.includes('progress')" class="goal-indicator-cell" data-label="进展" role="cell" aria-label="进展">
            <span>{{ item.progress }}%</span>
          </div>
          <div v-if="visibleColumns.includes('weight')" class="goal-indicator-cell" data-label="权重" role="cell" aria-label="权重">
            <span>{{ item.weight === null ? '--' : `${item.weight}%` }}</span>
          </div>
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.tracking-indicators {
  min-width: 0;
  color: #243047;
}

.tracking-indicators__context {
  min-height: 58px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.tracking-indicators__avatar {
  width: 40px;
  height: 40px;
  flex: 0 0 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 10px;
  color: #fff;
  background: #13afc0;
  font-size: 14px;
}

.tracking-indicators__avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.tracking-indicators__context > div {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tracking-indicators__context strong {
  color: #7e899e;
  font-size: 13px;
  font-weight: 500;
}

.tracking-indicators__cycle {
  display: flex;
  align-items: center;
  color: #253047;
  font-size: 14px;
  font-weight: 600;
}

.tracking-indicators__cycle select {
  max-width: min(240px, 60vw);
  padding: 2px 20px 2px 2px;
  border: 0;
  outline: none;
  color: inherit;
  background: transparent;
  font: inherit;
}

.tracking-indicators__cycle select:focus-visible {
  outline: 2px solid #4d91ff;
  outline-offset: 2px;
}

.tracking-indicators__table {
  overflow: hidden;
  border: 1px solid #eef1f6;
  border-radius: 14px;
  background: #fff;
}

.tracking-indicators__notice {
  margin: 0 0 10px;
  padding: 8px 12px;
  border: 1px solid #f3d39b;
  border-radius: 8px;
  color: #9a6400;
  background: #fff8e8;
  font-size: 13px;
}

.tracking-indicators__title {
  min-height: 54px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 0 18px;
}

.tracking-indicators__title h2 {
  margin: 0;
  font-size: 16px;
}

.tracking-indicators__actions {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
}

.tracking-indicators__actions > span {
  color: #98a2b5;
  font-size: 13px;
}

.tracking-indicators__columns-button {
  padding: 4px 8px;
  border: 0;
  border-radius: 5px;
  color: #39465e;
  background: transparent;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.tracking-indicators__columns-button:hover {
  color: #2f77dc;
  background: #f2f7fc;
}

.tracking-indicators__columns-button:focus-visible {
  outline: 2px solid #4d91ff;
  outline-offset: 2px;
}

.tracking-indicators__columns {
  display: grid;
  gap: 10px;
}

.tracking-indicators__columns label {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #32405d;
  cursor: pointer;
}

.goal-indicator-grid {
  display: grid;
  align-items: center;
  column-gap: 12px;
}

.goal-indicator-grid.has-0-optional {
  grid-template-columns: minmax(0, 1fr);
}

.goal-indicator-grid.has-1-optional {
  grid-template-columns: minmax(180px, 1fr) minmax(80px, .45fr);
}

.goal-indicator-grid.has-2-optional {
  grid-template-columns: minmax(180px, 1fr) repeat(2, minmax(80px, .45fr));
}

.goal-indicator-grid.has-3-optional {
  grid-template-columns: minmax(180px, 1fr) repeat(3, minmax(70px, .4fr));
}

.goal-indicator-grid.has-4-optional {
  grid-template-columns: minmax(180px, 1fr) repeat(4, minmax(60px, .38fr));
}

.tracking-indicators__header {
  min-height: 36px;
  padding: 0 28px;
  color: #a1aabe;
  font-size: 12px;
}

.tracking-indicators__row {
  min-height: 64px;
  padding: 12px 18px;
  border-top: 1px solid #eef1f5;
  color: #59667d;
  font-size: 13px;
}

.tracking-indicators__row.is-highlighted {
  background: #f0f7ff;
  box-shadow: inset 3px 0 #4b96ed;
}

.tracking-indicators__header > :not(:first-child),
.tracking-indicators__row > :not(:first-child) {
  text-align: center;
}

.goal-indicator-cell {
  min-width: 0;
}

.goal-indicator-cell > span {
  display: block;
  min-width: 0;
}

.tracking-indicators__objective {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
}

.tracking-indicators__objective > .goal-indicator-index {
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 7px;
  color: #3f8cff;
  background: #eaf4ff;
  font-size: 12px;
}

.tracking-indicators__objective strong {
  overflow: hidden;
  color: #344056;
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tracking-indicators__latest {
  overflow: hidden;
  color: #8b96aa;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tracking-indicators__message {
  min-height: 94px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 18px;
  color: #8b96aa;
  font-size: 13px;
}

.tracking-indicators__message > div {
  width: min(100%, 520px);
  text-align: center;
}

.tracking-indicators__message button {
  margin-left: 8px;
  padding: 5px 12px;
  border: 1px solid #b9c7db;
  border-radius: 5px;
  color: #256fc9;
  background: #fff;
  font: inherit;
}

@media (min-width: 769px) and (max-width: 1180px) {
  .goal-indicator-grid.goal-indicator-table-head,
  .goal-indicator-grid.goal-indicator-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px 12px;
  }

  .tracking-indicators__header,
  .tracking-indicators__row {
    min-height: auto;
    padding: 12px 18px;
  }

  .tracking-indicators__header > :not(:first-child),
  .tracking-indicators__row > :not(:first-child) {
    text-align: left;
  }

  .tracking-indicators__header > :last-child,
  .tracking-indicators__row > :last-child {
    grid-column: 1 / -1;
  }
}

@media (max-width: 768px) {
  .tracking-indicators__context {
    min-width: 0;
  }

  .tracking-indicators__context > div {
    flex: 1;
  }

  .tracking-indicators__title {
    align-items: center;
    gap: 10px;
    padding: 12px 14px;
  }

  .tracking-indicators__actions {
    flex-wrap: wrap;
    gap: 4px 8px;
  }

  .tracking-indicators__header {
    display: none;
  }

  .goal-indicator-grid.tracking-indicators__row {
    display: grid;
    grid-template-columns: 92px minmax(0, 1fr);
    row-gap: 8px;
    column-gap: 10px;
    padding: 14px;
  }

  .goal-indicator-cell {
    display: contents;
  }

  .goal-indicator-cell::before {
    content: attr(data-label);
    color: #8a94a6;
    font-size: 12px;
  }

  .goal-indicator-cell > span {
    text-align: left;
  }

  .tracking-indicators__objective strong,
  .tracking-indicators__latest {
    white-space: normal;
  }
}
</style>
