<script setup lang="ts">
import { computed, nextTick, ref, useSlots, watch } from 'vue';
import { normalizeDisplayedWeightTotal } from '../indicator-weight';
import type { PerformanceIndicatorRow } from './PerformanceIndicatorList.vue';

export interface PerformanceReviewColumn {
  key: 'indicator' | 'weight' | 'description' | 'primary' | 'secondary';
  label: string;
  width: string;
}

const props = withDefaults(defineProps<{
  rows: PerformanceIndicatorRow[];
  columns: PerformanceReviewColumn[];
  invalidIndicatorIds?: string[];
  weightTotal?: number;
  showWeightTotal?: boolean;
}>(), {
  invalidIndicatorIds: () => [],
  weightTotal: undefined,
  showWeightTotal: true,
});

const slots = useSlots();
const rootRef = ref<HTMLElement>();
const gridColumns = computed(() => props.columns.map((column) => column.width).join(' '));
const totalWeight = computed(() => props.weightTotal ?? props.rows.reduce(
  (sum, row) => sum + Number(row.weight || 0),
  0,
));
const displayedWeightTotal = computed(() => normalizeDisplayedWeightTotal(totalWeight.value));
const hasValidWeight = computed(() => displayedWeightTotal.value.isExactlyOneHundredPercent);

watch(
  () => JSON.stringify([props.invalidIndicatorIds, props.rows.map((row) => row.id)]),
  async () => {
    const firstId = props.invalidIndicatorIds.find((id) => props.rows.some((row) => row.id === id));
    if (!firstId) return;
    await nextTick();
    const row = rootRef.value?.querySelector<HTMLElement>(
      `[data-indicator-row-id="${CSS.escape(firstId)}"]`,
    );
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  },
  { immediate: true, flush: 'post' },
);
</script>

<template>
  <section
    ref="rootRef"
    class="performance-review-table"
    data-testid="performance-review-table"
    role="table"
  >
    <div
      class="performance-review-table__head"
      :style="{ gridTemplateColumns: gridColumns }"
      role="row"
    >
      <span v-for="column in columns" :key="column.key" role="columnheader">
        {{ column.label }}
      </span>
    </div>

    <div class="performance-review-table__body">
      <article
        v-for="(row, index) in rows"
        :key="row.id"
        class="performance-review-table__row"
        :class="{ 'is-invalid': invalidIndicatorIds.includes(row.id) }"
        :data-testid="`indicator-row-${row.id}`"
        :data-indicator-row-id="row.id"
        tabindex="-1"
      >
        <div :data-testid="`indicator-details-${row.id}`">
          <div
            class="performance-review-table__cells"
            :style="{ gridTemplateColumns: gridColumns }"
            role="row"
          >
            <div
              v-for="column in columns"
              :key="column.key"
              class="performance-review-table__cell"
              :data-column="column.key"
              :data-label="column.label"
              role="cell"
            >
              <slot :name="`cell-${column.key}`" :row="row" :index="index" />
            </div>
          </div>

          <div
            v-if="row.rejectionReason || slots['row-extra']"
            class="performance-review-table__extra"
          >
            <div v-if="row.rejectionReason" class="performance-review-table__rejection" role="status">
              <strong>退回原因</strong>
              <span>{{ row.rejectionReason }}</span>
            </div>
            <slot name="row-extra" :row="row" :index="index" />
          </div>
        </div>
      </article>
    </div>

    <footer
      v-if="showWeightTotal"
      class="performance-review-table__total"
      :class="{ 'is-invalid': !hasValidWeight }"
      data-testid="indicator-weight-total"
      :aria-invalid="!hasValidWeight"
    >
      <span>权重</span>
      <strong>{{ displayedWeightTotal.percentText }}%</strong>
      <span>/100%</span>
    </footer>
  </section>
</template>

<style scoped>
.performance-review-table {
  min-width: 0;
  color: #30384b;
  container: performance-review-table / inline-size;
}

.performance-review-table__head,
.performance-review-table__cells {
  min-width: 0;
  display: grid;
  column-gap: 20px;
}

.performance-review-table__head {
  min-height: 38px;
  align-items: center;
  padding: 0 14px;
  color: #8a94a6;
  font-size: 12px;
}

.performance-review-table__body {
  border-top: 1px solid #edf0f5;
}

.performance-review-table__row {
  min-width: 0;
  padding: 0 14px;
  outline: none;
}

.performance-review-table__row + .performance-review-table__row {
  border-top: 1px solid #edf0f5;
}

.performance-review-table__row.is-invalid {
  box-shadow: inset 3px 0 #e34d59;
  background: #fff8f7;
}

.performance-review-table__row:focus-visible {
  box-shadow: inset 0 0 0 2px #7bb6ff;
}

.performance-review-table__cells {
  min-height: 76px;
  align-items: start;
  padding: 16px 0;
}

.performance-review-table__cell {
  min-width: 0;
  color: #354056;
  font-size: 13px;
  line-height: 1.65;
  overflow-wrap: anywhere;
}

.performance-review-table__extra {
  padding: 0 0 14px;
}

.performance-review-table__rejection {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 10px;
  border-left: 3px solid #d9363e;
  color: #8c1d24;
  background: #fff1f0;
  font-size: 12px;
}

.performance-review-table__total {
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 5px;
  padding: 0 14px;
  border-top: 1px solid #edf0f5;
  color: #7d8798;
  font-size: 12px;
}

.performance-review-table__total strong {
  color: #273247;
  font-size: 18px;
}

.performance-review-table__total.is-invalid,
.performance-review-table__total.is-invalid strong {
  color: #c0363e;
}

@container performance-review-table (max-width: 980px) {
  .performance-review-table__head {
    display: none;
  }

  .performance-review-table__body {
    border-top: 0;
  }

  .performance-review-table__row {
    padding: 0 12px;
    border-top: 1px solid #edf0f5;
  }

  .performance-review-table__cells {
    min-height: 0;
    display: block;
    padding: 14px 0;
  }

  .performance-review-table__cell {
    display: grid;
    grid-template-columns: 82px minmax(0, 1fr);
    gap: 8px;
  }

  .performance-review-table__cell + .performance-review-table__cell {
    margin-top: 10px;
  }

  .performance-review-table__cell::before {
    content: attr(data-label);
    color: #8a94a6;
    font-size: 12px;
  }
}
</style>
