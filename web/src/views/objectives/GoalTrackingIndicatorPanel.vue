<script setup lang="ts">
import type { AssessmentCycle, GoalTrackingResult } from '@/types/api.types';
import { goalTrackingStatus, type GoalTrackingPerson } from './goal-tracking';

defineProps<{
  person: GoalTrackingPerson | null;
  cycles: AssessmentCycle[];
  selectedCycleId: string;
  result: GoalTrackingResult;
  loading: boolean;
  error: string;
  notice: string;
  highlightedObjectiveId: string;
}>();
const emit = defineEmits<{
  cycleChange: [cycleId: string];
  retry: [];
}>();

function handleCycleChange(event: Event) {
  emit('cycleChange', (event.target as HTMLSelectElement).value);
}
</script>

<template>
  <section class="tracking-indicators" aria-label="人员考核指标">
    <header class="tracking-indicators__context">
      <span class="tracking-indicators__avatar" aria-hidden="true">
        <img v-if="person?.avatarUrl" :src="person.avatarUrl" alt="">
        <span v-else>{{ person?.name.slice(0, 1) || '—' }}</span>
      </span>
      <div>
        <strong>{{ person?.name || '未选择人员' }}</strong>
        <label class="tracking-indicators__cycle">
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
      class="tracking-indicators__table"
      data-testid="goal-tracking-surface"
      role="table"
      aria-label="考核指标"
    >
      <div class="tracking-indicators__title">
        <h2>考核指标</h2>
        <span>维度权重：{{ result.totalWeight }}%</span>
      </div>
      <div class="goal-indicator-grid tracking-indicators__header" role="row">
        <div role="columnheader">考核指标</div>
        <div role="columnheader">最新进展</div>
        <div role="columnheader">状态</div>
        <div role="columnheader">进展</div>
        <div role="columnheader">权重</div>
      </div>

      <div v-if="loading" class="tracking-indicators__message" role="row">
        <div role="cell" aria-label="加载状态">正在加载考核指标…</div>
      </div>
      <div v-else-if="error" class="tracking-indicators__message" role="row">
        <div role="cell" aria-label="加载错误">
          {{ error }}
          <button type="button" @click="emit('retry')">重试</button>
        </div>
      </div>
      <div v-else-if="result.items.length === 0" class="tracking-indicators__message" role="row">
        <div role="cell" aria-label="空状态">暂无考核指标</div>
      </div>
      <template v-else>
        <div
          v-for="(item, index) in result.items"
          :key="item.id"
          class="goal-indicator-grid tracking-indicators__row"
          :class="{ 'is-highlighted': item.id === highlightedObjectiveId }"
          :data-testid="`goal-tracking-row-${item.id}`"
          role="row"
        >
          <div class="tracking-indicators__objective" role="cell" aria-label="考核指标">
            <span aria-hidden="true">{{ index + 1 }}</span>
            <strong>{{ item.title }}</strong>
          </div>
          <div class="tracking-indicators__latest" role="cell" aria-label="最新进展">
            {{ item.latestProgress?.title ?? '暂无进展' }}
          </div>
          <div role="cell" aria-label="状态">{{ goalTrackingStatus(item) }}</div>
          <div role="cell" aria-label="进展">{{ item.progress }}%</div>
          <div role="cell" aria-label="权重">{{ item.weight === null ? '--' : `${item.weight}%` }}</div>
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
  min-height: 76px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 0;
}

.tracking-indicators__avatar {
  width: 42px;
  height: 42px;
  flex: 0 0 42px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 9px;
  color: #fff;
  background: #1fb4c2;
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
  max-width: 240px;
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
  border-radius: 16px;
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
  min-height: 50px;
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

.tracking-indicators__title span {
  color: #98a2b5;
  font-size: 13px;
}

.goal-indicator-grid {
  display: grid;
  grid-template-columns: minmax(280px, 1fr) minmax(180px, .7fr) 120px 120px 80px;
  align-items: center;
  column-gap: 20px;
}

.tracking-indicators__header {
  min-height: 36px;
  padding: 0 28px;
  color: #a1aabe;
  font-size: 12px;
}

.tracking-indicators__row {
  min-height: 62px;
  padding: 0 28px;
  color: #59667d;
  font-size: 13px;
}

.tracking-indicators__row.is-highlighted {
  background: #eef7ff;
  box-shadow: inset 3px 0 #4b96ed;
}

.tracking-indicators__row + .tracking-indicators__row {
  border-top: 1px solid #f3f5f8;
}

.tracking-indicators__header > :not(:first-child),
.tracking-indicators__row > :not(:first-child) {
  text-align: center;
}

.tracking-indicators__objective {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
}

.tracking-indicators__objective > span {
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 7px;
  color: #4b96ed;
  background: #e4f2ff;
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

.tracking-indicators__message button {
  margin-left: 8px;
  padding: 5px 12px;
  border: 1px solid #b9c7db;
  border-radius: 5px;
  color: #256fc9;
  background: #fff;
  font: inherit;
}

@media (max-width: 1600px) {
  .goal-indicator-grid {
    grid-template-columns: minmax(160px, 1fr) minmax(100px, .7fr) 70px 60px 50px;
    column-gap: 8px;
  }
}

@media (min-width: 769px) and (max-width: 1180px) {
  .goal-indicator-grid {
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
  .tracking-indicators__title {
    align-items: flex-start;
    flex-direction: column;
    gap: 4px;
    padding: 12px 14px;
  }

  .tracking-indicators__header {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
  }

  .goal-indicator-grid.tracking-indicators__row {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px 12px;
    padding: 14px;
  }

  .tracking-indicators__row > :not(:first-child) {
    text-align: left;
  }

  .tracking-indicators__objective,
  .tracking-indicators__latest {
    grid-column: 1 / -1;
  }
}
</style>
