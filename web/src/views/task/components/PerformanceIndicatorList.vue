<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { ArrowDown, ArrowUp } from '@element-plus/icons-vue';
import type { IndicatorVisibilityScope, ObjectiveLevel } from '@/types/enums';
import { normalizeDisplayedWeightTotal } from '../indicator-weight';

export interface PerformanceIndicatorRow {
  id: string;
  name: string;
  weight: number;
  visibilityScope: IndicatorVisibilityScope;
  statusLabel?: string;
  description?: string;
  scoringStandard?: string;
  dataSource?: string;
  dataCaliber?: string;
  targetValue?: number;
  targetValueText?: string;
  unit?: string;
  rejectionReason?: string;
  alignedObjectives?: Array<{
    id: string;
    title: string;
    level: ObjectiveLevel;
    ownerId: string | null;
  }>;
}

const props = withDefaults(
  defineProps<{
    rows: PerformanceIndicatorRow[];
    invalidIndicatorIds?: string[];
    weightTotal?: number;
  }>(),
  {
    invalidIndicatorIds: () => [],
    weightTotal: undefined,
  },
);

const expandedIds = ref(new Set<string>());
const lastRevealKey = ref('');
const rootRef = ref<HTMLElement>();

const totalWeight = computed(() => props.weightTotal ?? props.rows.reduce(
  (sum, row) => sum + Number(row.weight || 0),
  0,
));
const displayedWeightTotal = computed(() => normalizeDisplayedWeightTotal(totalWeight.value));
const hasValidWeight = computed(() => displayedWeightTotal.value.isExactlyOneHundredPercent);
const allExpanded = computed(() => (
  props.rows.length > 0 && props.rows.every((row) => expandedIds.value.has(row.id))
));

const visibilityLabels: Record<IndicatorVisibilityScope, string> = {
  company: '全公司可见',
  department: '部门内可见',
  department_tree: '部门及下级可见',
  direct_reports: '直接下级可见',
  all_reports: '所有下级可见',
  supervisors: '仅上级可见',
  custom: '自定义范围',
};

function visibilityScopeLabel(scope: IndicatorVisibilityScope): string {
  return visibilityLabels[scope];
}

function safeDisclosureId(id: string): string {
  return encodeURIComponent(id);
}

function disclosureNameId(id: string): string {
  return `indicator-name-${safeDisclosureId(id)}`;
}

function disclosureRegionId(id: string): string {
  return `indicator-details-${safeDisclosureId(id)}`;
}

function isExpanded(id: string): boolean {
  return expandedIds.value.has(id);
}

function ariaExpanded(id: string): 'true' | 'false' {
  return isExpanded(id) ? 'true' : 'false';
}

function setExpanded(next: Set<string>) {
  expandedIds.value = next;
}

function toggleIndicator(id: string) {
  const next = new Set(expandedIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  setExpanded(next);
}

function expandAll() {
  setExpanded(new Set(props.rows.map((row) => row.id)));
}

function collapseAll() {
  setExpanded(new Set());
  lastRevealKey.value = '';
}

async function revealFirstInvalid() {
  const firstId = props.invalidIndicatorIds.find((id) => props.rows.some((row) => row.id === id));
  if (!firstId) return;
  const revealKey = `${firstId}:${props.invalidIndicatorIds.join(',')}`;
  if (revealKey === lastRevealKey.value && expandedIds.value.has(firstId)) return;
  lastRevealKey.value = revealKey;
  const next = new Set(expandedIds.value);
  next.add(firstId);
  setExpanded(next);
  await nextTick();
  const row = rootRef.value?.querySelector<HTMLElement>(
    `[data-indicator-row-id="${CSS.escape(firstId)}"]`,
  );
  row?.focus({ preventScroll: true });
  row?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
}

watch(
  () => JSON.stringify([
    props.invalidIndicatorIds,
    props.rows.map((row) => row.id),
  ]),
  () => {
    void revealFirstInvalid();
  },
  { immediate: true, flush: 'post' },
);

defineExpose({ expandAll, collapseAll, toggleIndicator });
</script>

<template>
  <section ref="rootRef" class="performance-indicators" data-testid="performance-indicator-list">
    <header class="performance-indicators__toolbar">
      <span>{{ rows.length }} 项指标</span>
      <div class="performance-indicators__commands">
        <el-tooltip content="全部展开" placement="top">
          <el-button
            text
            circle
            :icon="ArrowDown"
            data-testid="indicator-expand-all"
            aria-label="全部展开"
            :disabled="allExpanded || rows.length === 0"
            @click="expandAll"
          />
        </el-tooltip>
        <el-tooltip content="全部收起" placement="top">
          <el-button
            text
            circle
            :icon="ArrowUp"
            data-testid="indicator-collapse-all"
            aria-label="全部收起"
            :disabled="expandedIds.size === 0"
            @click="collapseAll"
          />
        </el-tooltip>
      </div>
    </header>

    <div class="indicator-grid indicator-grid--header" aria-hidden="true">
      <span>指标</span>
      <span>权重</span>
      <span>可见范围</span>
      <span>状态</span>
      <span />
    </div>

    <div class="performance-indicators__rows">
      <article
        v-for="(row, index) in rows"
        :key="row.id"
        class="indicator-item"
        :class="{
          'is-expanded': isExpanded(row.id),
          'is-invalid': invalidIndicatorIds.includes(row.id),
        }"
      >
        <div
          class="indicator-grid indicator-row"
          :data-testid="`indicator-row-${row.id}`"
          :data-indicator-row-id="row.id"
          tabindex="-1"
        >
          <button
            :id="disclosureNameId(row.id)"
            class="indicator-row__name"
            type="button"
            :data-testid="`indicator-name-${row.id}`"
            :aria-expanded="ariaExpanded(row.id)"
            :aria-controls="disclosureRegionId(row.id)"
            @click="toggleIndicator(row.id)"
          >
            <span class="indicator-row__index">{{ index + 1 }}</span>
            <span>{{ row.name || '未命名指标' }}</span>
          </button>
          <span class="indicator-row__weight">{{ Number((row.weight * 100).toFixed(2)) }}%</span>
          <div class="indicator-row__visibility" @click.stop>
            <slot name="visibility" :row="row" :index="index">
              <span>{{ visibilityScopeLabel(row.visibilityScope) }}</span>
            </slot>
          </div>
          <span class="indicator-row__status">{{ row.statusLabel || '-' }}</span>
          <el-tooltip :content="isExpanded(row.id) ? '收起指标' : '展开指标'" placement="top">
            <span class="indicator-row__toggle-wrap">
              <button
                type="button"
                class="indicator-row__toggle"
                :data-testid="`indicator-toggle-${row.id}`"
                :aria-label="`${isExpanded(row.id) ? '收起' : '展开'}指标 ${row.name}`"
                :aria-expanded="ariaExpanded(row.id)"
                :aria-controls="disclosureRegionId(row.id)"
                @click="toggleIndicator(row.id)"
              >
                <el-icon>
                  <ArrowUp v-if="isExpanded(row.id)" />
                  <ArrowDown v-else />
                </el-icon>
              </button>
            </span>
          </el-tooltip>
        </div>

        <div
          :id="disclosureRegionId(row.id)"
          v-show="isExpanded(row.id)"
          class="indicator-details"
          :data-testid="`indicator-details-${row.id}`"
          role="region"
          :aria-labelledby="disclosureNameId(row.id)"
        >
          <div v-if="row.rejectionReason" class="indicator-details__rejection" role="status">
            <strong>驳回原因</strong>
            <span>{{ row.rejectionReason }}</span>
          </div>
          <slot name="details" :row="row" :index="index">
            <dl class="indicator-details__facts">
              <div>
                <dt>指标描述</dt>
                <dd>{{ row.description || '-' }}</dd>
              </div>
              <div>
                <dt>目标值</dt>
                <dd>{{ row.targetValueText || (row.targetValue != null ? `${row.targetValue}${row.unit || ''}` : '-') }}</dd>
              </div>
              <div>
                <dt>评分标准</dt>
                <dd>{{ row.scoringStandard || '-' }}</dd>
              </div>
              <div>
                <dt>数据来源</dt>
                <dd>{{ row.dataSource || '-' }}</dd>
              </div>
              <div>
                <dt>完成口径</dt>
                <dd>{{ row.dataCaliber || '-' }}</dd>
              </div>
              <div>
                <dt>对齐目标</dt>
                <dd>{{ row.alignedObjectives?.map((objective) => objective.title).join('、') || '-' }}</dd>
              </div>
            </dl>
          </slot>
        </div>
      </article>
    </div>

    <footer
      class="performance-indicators__total"
      :class="{ 'is-invalid': !hasValidWeight }"
      data-testid="indicator-weight-total"
      :aria-invalid="!hasValidWeight"
    >
      <span>权重合计</span>
      <strong>{{ displayedWeightTotal.percentText }}%</strong>
      <span>/ 100%</span>
    </footer>
  </section>
</template>

<style scoped>
.performance-indicators {
  min-width: 0;
  container: indicator-list / inline-size;
}

.performance-indicators__toolbar {
  min-height: 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: #5d687a;
  font-size: 12px;
}

.performance-indicators__commands {
  display: flex;
  align-items: center;
  gap: 2px;
}

.indicator-grid {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) 70px minmax(140px, 180px) 82px 38px;
  align-items: center;
  gap: 10px;
}

.indicator-grid--header {
  min-height: 32px;
  padding: 0 10px;
  border: 1px solid #dfe4ec;
  border-bottom: 0;
  border-radius: 6px 6px 0 0;
  background: #f5f7fa;
  color: #697487;
  font-size: 11px;
  font-weight: 600;
}

.performance-indicators__rows {
  border: 1px solid #dfe4ec;
  border-radius: 0 0 6px 6px;
  overflow: hidden;
}

.indicator-item + .indicator-item {
  border-top: 1px solid #e5e9ef;
}

.indicator-item.is-invalid {
  box-shadow: inset 3px 0 0 #d9363e;
}

.indicator-row {
  min-height: 46px;
  padding: 5px 8px 5px 10px;
  background: #fff;
  outline: none;
}

.indicator-row:focus-visible,
.indicator-item.is-invalid .indicator-row {
  background: #fff7f6;
}

.indicator-item:nth-child(even) .indicator-row:not(:focus-visible) {
  background: #fafbfc;
}

.indicator-row__name {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0;
  border: 0;
  background: transparent;
  color: #263247;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}

.indicator-row__name span:last-child {
  min-width: 0;
  overflow-wrap: anywhere;
}

.indicator-row__index {
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #d8dee8;
  border-radius: 5px;
  color: #667287;
  background: #fff;
  font-size: 11px;
}

.indicator-row__toggle-wrap,
.indicator-row__toggle {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.indicator-row__toggle {
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #606b7d;
  cursor: pointer;
}

.indicator-row__toggle:hover,
.indicator-row__toggle:focus-visible {
  background: #eef2f6;
  color: #245f9e;
  outline: none;
}

.indicator-row__weight,
.indicator-row__status,
.indicator-row__visibility {
  min-width: 0;
  color: #596579;
  font-size: 12px;
}

.indicator-row__visibility > span,
.indicator-row__status {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.indicator-details {
  padding: 14px 16px 16px 43px;
  border-top: 1px solid #e9edf2;
  background: #fbfcfd;
}

.indicator-details__rejection {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 12px;
  padding: 8px 10px;
  border-left: 3px solid #d9363e;
  color: #8c1d24;
  background: #fff1f0;
  font-size: 12px;
}

.indicator-details__facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 20px;
  margin: 0;
}

.indicator-details__facts div {
  min-width: 0;
}

.indicator-details__facts dt {
  margin-bottom: 4px;
  color: #7a8597;
  font-size: 11px;
}

.indicator-details__facts dd {
  margin: 0;
  color: #344054;
  font-size: 12px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.performance-indicators__total {
  min-height: 38px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 5px;
  padding: 0 10px;
  color: #4d596c;
  font-size: 12px;
}

.performance-indicators__total strong {
  color: #1f6b42;
  font-size: 14px;
}

.performance-indicators__total.is-invalid,
.performance-indicators__total.is-invalid strong {
  color: #c0363e;
}

@container indicator-list (max-width: 620px) {
  .indicator-grid {
    grid-template-columns: minmax(0, 1fr) 58px 36px;
    grid-template-areas:
      "name weight command"
      "visibility visibility status";
    gap: 5px 8px;
  }

  .indicator-grid--header {
    display: none;
  }

  .indicator-row {
    min-height: 70px;
    padding: 7px 6px 7px 9px;
  }

  .indicator-row__name {
    grid-area: name;
  }

  .indicator-row__weight {
    grid-area: weight;
    text-align: right;
  }

  .indicator-row__visibility {
    grid-area: visibility;
    padding-left: 33px;
  }

  .indicator-row__status {
    grid-area: status;
    text-align: right;
  }

  .indicator-row > :last-child {
    grid-area: command;
  }

  .indicator-details {
    padding: 12px;
  }

  .indicator-details__facts {
    grid-template-columns: minmax(0, 1fr);
    gap: 10px;
  }
}
</style>
