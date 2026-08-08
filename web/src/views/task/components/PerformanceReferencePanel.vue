<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue';
import { Aim, Clock, Search } from '@element-plus/icons-vue';
import { tasksApi } from '@/api/tasks.api';
import { FLOW_NODE_LABELS, OBJECTIVE_LEVEL_LABELS } from '@/types/enums';
import type { FlowRecord, IndicatorInstance, IndicatorReferenceItem } from '@/types/api.types';

const props = withDefaults(
  defineProps<{
    cycleId?: string;
    employeeId?: string;
    indicators?: IndicatorInstance[];
    flowRecords?: FlowRecord[];
  }>(),
  {
    cycleId: undefined,
    employeeId: undefined,
    indicators: () => [],
    flowRecords: () => [],
  },
);

type ReferenceTab = 'objectives' | 'history';

const activeTab = ref<ReferenceTab>('objectives');
const tabIdPrefix = useId();
const objectiveTabRef = ref<HTMLButtonElement>();
const historyTabRef = ref<HTMLButtonElement>();
const references = ref<IndicatorReferenceItem[]>([]);
const selectedReferenceId = ref('');
const referenceLoading = ref(false);
let referenceRequestSerial = 0;
const tabOrder: ReferenceTab[] = ['objectives', 'history'];

function tabId(tab: ReferenceTab): string {
  return `${tabIdPrefix}-reference-tab-${tab}`;
}

function panelId(tab: ReferenceTab): string {
  return `${tabIdPrefix}-reference-panel-${tab}`;
}

function tabElement(tab: ReferenceTab): HTMLButtonElement | undefined {
  return tab === 'objectives' ? objectiveTabRef.value : historyTabRef.value;
}

function activateTab(tab: ReferenceTab, focus = false) {
  activeTab.value = tab;
  if (focus) void nextTick(() => tabElement(tab)?.focus());
}

function ariaSelected(tab: ReferenceTab): 'true' | 'false' {
  return activeTab.value === tab ? 'true' : 'false';
}

function handleTabKeydown(event: KeyboardEvent, currentTab: ReferenceTab) {
  const currentIndex = tabOrder.indexOf(currentTab);
  let nextTab: ReferenceTab | undefined;
  if (event.key === 'ArrowRight') nextTab = tabOrder[(currentIndex + 1) % tabOrder.length];
  if (event.key === 'ArrowLeft') nextTab = tabOrder[(currentIndex - 1 + tabOrder.length) % tabOrder.length];
  if (event.key === 'Home') nextTab = tabOrder[0];
  if (event.key === 'End') nextTab = tabOrder[tabOrder.length - 1];
  if (!nextTab) return;
  event.preventDefault();
  activateTab(nextTab, true);
}

const alignedObjectives = computed(() => {
  const byId = new Map<string, IndicatorInstance['alignedObjectives'][number]>();
  for (const indicator of props.indicators) {
    for (const objective of indicator.alignedObjectives) byId.set(objective.id, objective);
  }
  return [...byId.values()];
});

const sortedFlowRecords = computed(() => [...props.flowRecords].sort(
  (left, right) => right.createdAt.localeCompare(left.createdAt),
));

function formatReferenceWeight(weight: number): string {
  const percent = weight <= 1 ? weight * 100 : weight;
  return `${Number(percent.toFixed(2))}%`;
}

function formatFlowAction(record: FlowRecord): string {
  const type = String(record.extraData?.type ?? '');
  const typeLabels: Record<string, string> = {
    indicator_draft_saved: '保存草稿',
    indicator_employee_submitted: '提交主管审核',
    indicator_review_saved: '保存审核调整',
    indicator_review_approved: '审核通过',
    indicator_review_rejected: '驳回指标',
  };
  if (typeLabels[type]) return typeLabels[type];
  const actionLabels: Record<FlowRecord['action'], string> = {
    submit: '提交',
    approve: '通过',
    reject: '驳回',
    transfer: '转交',
    comment: '记录',
  };
  return actionLabels[record.action];
}

async function loadReferences(keyword = '') {
  if (!props.cycleId || !props.employeeId) {
    references.value = [];
    selectedReferenceId.value = '';
    return;
  }
  const requestId = ++referenceRequestSerial;
  referenceLoading.value = true;
  try {
    const response = await tasksApi.findReferenceIndicators({
      page: 1,
      pageSize: 20,
      cycleId: props.cycleId,
      ownerId: props.employeeId,
      keyword: keyword.trim() || undefined,
    });
    if (requestId !== referenceRequestSerial) return;
    references.value = response.items ?? [];
    if (!references.value.some((item) => item.id === selectedReferenceId.value)) {
      selectedReferenceId.value = references.value[0]?.id ?? '';
    }
  } catch {
    if (requestId === referenceRequestSerial) {
      references.value = [];
      selectedReferenceId.value = '';
    }
  } finally {
    if (requestId === referenceRequestSerial) referenceLoading.value = false;
  }
}

watch(
  () => [props.cycleId, props.employeeId],
  () => {
    void loadReferences();
  },
  { immediate: true },
);
</script>

<template>
  <aside class="performance-reference" data-testid="performance-reference-panel">
    <div class="performance-reference__tabs" role="tablist" aria-label="参考信息">
      <button
        :id="tabId('objectives')"
        ref="objectiveTabRef"
        type="button"
        role="tab"
        :aria-selected="ariaSelected('objectives')"
        :aria-controls="panelId('objectives')"
        :tabindex="activeTab === 'objectives' ? 0 : -1"
        :class="{ 'is-active': activeTab === 'objectives' }"
        @click="activateTab('objectives')"
        @keydown="handleTabKeydown($event, 'objectives')"
      >
        <el-icon><Aim /></el-icon>
        <span>对齐目标</span>
      </button>
      <button
        :id="tabId('history')"
        ref="historyTabRef"
        type="button"
        role="tab"
        data-testid="reference-flow-tab"
        :aria-selected="ariaSelected('history')"
        :aria-controls="panelId('history')"
        :tabindex="activeTab === 'history' ? 0 : -1"
        :class="{ 'is-active': activeTab === 'history' }"
        @click="activateTab('history')"
        @keydown="handleTabKeydown($event, 'history')"
      >
        <el-icon><Clock /></el-icon>
        <span>流程历史</span>
      </button>
    </div>

    <section
      :id="panelId('objectives')"
      v-show="activeTab === 'objectives'"
      class="performance-reference__body"
      data-testid="reference-aligned-objectives"
      role="tabpanel"
      :aria-labelledby="tabId('objectives')"
      tabindex="0"
    >
      <div class="reference-picker" data-testid="reference-indicator-picker">
        <label for="reference-indicator-select">员工目标</label>
        <el-select
          id="reference-indicator-select"
          v-model="selectedReferenceId"
          filterable
          remote
          :remote-method="loadReferences"
          :loading="referenceLoading"
          placeholder="搜索可见目标"
        >
          <template #prefix><el-icon><Search /></el-icon></template>
          <el-option
            v-for="reference in references"
            :key="reference.id"
            :value="reference.id"
            :label="reference.name"
          >
            <span>{{ reference.name }}</span>
            <small>{{ reference.employeeName }} · {{ formatReferenceWeight(reference.weight) }}</small>
          </el-option>
        </el-select>
        <span v-if="references.length" class="reference-picker__selection">
          {{ references.find((item) => item.id === selectedReferenceId)?.name || references[0].name }}
        </span>
      </div>

      <div class="reference-section">
        <h3>已对齐目标</h3>
        <ul v-if="alignedObjectives.length" class="reference-list">
          <li v-for="objective in alignedObjectives" :key="objective.id">
            <span>{{ objective.title }}</span>
            <small>{{ OBJECTIVE_LEVEL_LABELS[objective.level] }}</small>
          </li>
        </ul>
        <el-empty v-else :image-size="46" description="暂无对齐目标" />
      </div>
    </section>

    <section
      :id="panelId('history')"
      v-show="activeTab === 'history'"
      class="performance-reference__body"
      data-testid="reference-flow-history"
      role="tabpanel"
      :aria-labelledby="tabId('history')"
      tabindex="0"
    >
      <ol v-if="sortedFlowRecords.length" class="flow-history">
        <li v-for="record in sortedFlowRecords" :key="record.id">
          <span class="flow-history__dot" aria-hidden="true" />
          <div>
            <strong>{{ formatFlowAction(record) }}</strong>
            <span>{{ record.actorName || '系统' }} · {{ FLOW_NODE_LABELS[record.nodeType] }}</span>
            <p v-if="record.comment">{{ record.comment }}</p>
            <time :datetime="record.createdAt">{{ new Date(record.createdAt).toLocaleString() }}</time>
          </div>
        </li>
      </ol>
      <el-empty v-else :image-size="46" description="暂无流程记录" />
    </section>
  </aside>
</template>

<style scoped>
.performance-reference {
  min-width: 0;
  border-left: 1px solid #e2e6ec;
  background: #fff;
}

.performance-reference__tabs {
  min-height: 42px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  border-bottom: 1px solid #e2e6ec;
}

.performance-reference__tabs button {
  min-width: 0;
  min-height: 42px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 8px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: #667287;
  font-size: 12px;
  cursor: pointer;
}

.performance-reference__tabs button.is-active {
  border-bottom-color: #2468b5;
  color: #155aa8;
  font-weight: 600;
}

.performance-reference__body {
  padding: 14px;
}

.reference-picker {
  display: grid;
  gap: 6px;
  padding-bottom: 14px;
  border-bottom: 1px solid #e8ebf0;
}

.reference-picker label,
.reference-section h3 {
  margin: 0;
  color: #4e5a6d;
  font-size: 12px;
  font-weight: 600;
}

.reference-picker :deep(.el-select) {
  width: 100%;
}

.reference-picker__selection {
  color: #344054;
  font-size: 12px;
  overflow-wrap: anywhere;
}

.reference-section {
  padding-top: 14px;
}

.reference-list,
.flow-history {
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
}

.reference-list li {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  padding: 9px 0;
  border-bottom: 1px solid #edf0f4;
  color: #303a4c;
  font-size: 12px;
}

.reference-list small,
.flow-history span,
.flow-history time,
.el-select-dropdown__item small {
  color: #7a8495;
  font-size: 11px;
}

.el-select-dropdown__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.flow-history li {
  position: relative;
  display: grid;
  grid-template-columns: 12px minmax(0, 1fr);
  gap: 8px;
  padding-bottom: 16px;
}

.flow-history li:not(:last-child)::before {
  position: absolute;
  top: 10px;
  bottom: 0;
  left: 5px;
  width: 1px;
  background: #d8dee8;
  content: '';
}

.flow-history__dot {
  position: relative;
  z-index: 1;
  width: 10px;
  height: 10px;
  margin-top: 3px;
  border: 2px solid #fff;
  border-radius: 50%;
  background: #4479b7;
  box-shadow: 0 0 0 1px #9bb7d8;
}

.flow-history div {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.flow-history strong {
  color: #2d3748;
  font-size: 12px;
}

.flow-history p {
  margin: 2px 0;
  color: #4e596b;
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

@media (max-width: 960px) {
  .performance-reference {
    border-top: 1px solid #e2e6ec;
    border-left: 0;
  }
}
</style>
