<script setup lang="ts">
import { computed, ref } from 'vue';
import dayjs from 'dayjs';
import type { FlowRecord } from '@/types/api.types';

type OperationTone = 'neutral' | 'primary' | 'success' | 'danger';

interface OperationRecordView {
  id: string;
  actorName: string;
  actorInitial: string;
  summary: string;
  note: string;
  noteLabel: string;
  createdAt: string;
  timeText: string;
  tone: OperationTone;
}

const props = withDefaults(defineProps<{
  records?: FlowRecord[];
  initialVisibleCount?: number;
  showHeader?: boolean;
}>(), {
  records: () => [],
  initialVisibleCount: 5,
  showHeader: true,
});

const expanded = ref(false);
const indicatorOperationNodeTypes = ['indicator_setting', 'indicator_confirm'];

const operationRecords = computed<OperationRecordView[]>(() => props.records
  .filter((record) => indicatorOperationNodeTypes.includes(String(record.nodeType)))
  .map((record) => {
    const actorName = record.actorName?.trim() || '系统';
    const rejected = record.action === 'reject' || String(record.extraData?.type ?? '') === 'indicator_review_rejected';
    return {
      id: record.id,
      actorName,
      actorInitial: actorName.slice(0, 1),
      summary: formatOperationRecord(record),
      note: record.comment?.trim() || '',
      noteLabel: rejected ? '退回原因' : '补充说明',
      createdAt: record.createdAt,
      timeText: formatOperationTime(record.createdAt),
      tone: operationTone(record),
    };
  })
  .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()));

const visibleRecords = computed(() => (
  expanded.value
    ? operationRecords.value
    : operationRecords.value.slice(0, props.initialVisibleCount)
));
const hasOlderRecords = computed(() => operationRecords.value.length > props.initialVisibleCount);

function formatOperationRecord(record: FlowRecord): string {
  const type = String(record.extraData?.type ?? '');
  const count = Number(record.extraData?.count ?? 0);
  const countText = count > 0 ? `了 ${count} 条指标` : '';

  if (type === 'indicator_formal_submitted') {
    return record.extraData?.employeeConfirmedBeforeReview
      ? `保存并审核${countText}，目标确认完成`
      : `保存并审核${countText}`;
  }
  if (type === 'indicator_employee_submitted') return `提交主管审核${countText}`;
  if (type === 'indicator_review_saved') return `保存审核调整${countText}`;
  if (type === 'indicator_review_approved') return `审核通过${countText}`;
  if (type === 'indicator_draft_saved') return `保存草稿${countText}`;
  if (type === 'indicator_employee_confirmed') return `确认目标${countText}`;
  if (record.action === 'reject') return '退回指标';
  if (record.action === 'submit' && record.nodeType === 'indicator_confirm') return '确认目标';
  if (record.action === 'submit') return `提交指标${countText}`;
  return `记录操作${countText}`;
}

function operationTone(record: FlowRecord): OperationTone {
  const type = String(record.extraData?.type ?? '');
  if (record.action === 'reject' || type === 'indicator_review_rejected') return 'danger';
  if (['indicator_review_approved', 'indicator_formal_submitted', 'indicator_employee_confirmed'].includes(type)) {
    return 'success';
  }
  if (record.action === 'submit' || type === 'indicator_employee_submitted') return 'primary';
  return 'neutral';
}

function formatOperationTime(value: string): string {
  const time = dayjs(value);
  return time.isValid() ? time.format('YYYY-MM-DD HH:mm') : '时间未知';
}
</script>

<template>
  <section
    v-if="operationRecords.length"
    class="operation-timeline"
    data-testid="indicator-operation-timeline"
    aria-labelledby="indicator-operation-title"
  >
    <header v-if="showHeader" class="operation-timeline__header">
      <div>
        <h3 id="indicator-operation-title">操作记录</h3>
        <span>共 {{ operationRecords.length }} 条</span>
      </div>
      <small>最新记录在前</small>
    </header>

    <ol class="operation-timeline__list">
      <li
        v-for="record in visibleRecords"
        :key="record.id"
        class="operation-timeline__item"
        :class="`is-${record.tone}`"
        data-testid="indicator-operation-record"
      >
        <span class="operation-timeline__marker" aria-hidden="true">{{ record.actorInitial }}</span>
        <article class="operation-timeline__content">
          <div class="operation-timeline__main">
            <div class="operation-timeline__event">
              <strong>{{ record.actorName }}</strong>
              <span>{{ record.summary }}</span>
            </div>
            <time :datetime="record.createdAt">{{ record.timeText }}</time>
          </div>
          <div v-if="record.note" class="operation-timeline__note">
            <b>{{ record.noteLabel }}</b>
            <span>{{ record.note }}</span>
          </div>
        </article>
      </li>
    </ol>

    <div v-if="hasOlderRecords" class="operation-timeline__footer">
      <button
        type="button"
        class="operation-timeline__toggle"
        :aria-expanded="expanded"
        @click="expanded = !expanded"
      >
        {{ expanded ? '收起较早记录' : `查看全部 ${operationRecords.length} 条` }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.operation-timeline {
  margin-top: 20px;
  padding-top: 18px;
  border-top: 1px solid var(--el-border-color-lighter);
}

.operation-timeline__header,
.operation-timeline__header > div,
.operation-timeline__main,
.operation-timeline__event {
  display: flex;
  align-items: center;
}

.operation-timeline__header {
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.operation-timeline__header > div {
  gap: 9px;
}

.operation-timeline__header h3 {
  margin: 0;
  color: #1f2937;
  font-size: 16px;
  line-height: 24px;
}

.operation-timeline__header span {
  padding: 1px 7px;
  border-radius: 999px;
  background: #f2f4f7;
  color: #667085;
  font-size: 12px;
  line-height: 20px;
}

.operation-timeline__header small {
  color: #98a2b3;
  font-size: 12px;
}

.operation-timeline__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.operation-timeline__item {
  position: relative;
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  gap: 10px;
  padding-bottom: 12px;
}

.operation-timeline__item:not(:last-child)::before {
  position: absolute;
  top: 30px;
  bottom: -2px;
  left: 15px;
  width: 1px;
  background: #e4e7ec;
  content: '';
}

.operation-timeline__marker {
  position: relative;
  z-index: 1;
  display: inline-flex;
  width: 30px;
  height: 30px;
  align-items: center;
  justify-content: center;
  border: 1px solid #e4e7ec;
  border-radius: 50%;
  background: #f8fafc;
  color: #667085;
  font-size: 12px;
  font-weight: 700;
}

.operation-timeline__content {
  min-width: 0;
  padding: 11px 13px;
  border: 1px solid #eaecf0;
  border-radius: 10px;
  background: #fff;
}

.operation-timeline__main {
  justify-content: space-between;
  gap: 16px;
}

.operation-timeline__event {
  min-width: 0;
  flex-wrap: wrap;
  gap: 6px;
  color: #475467;
  font-size: 13px;
  line-height: 20px;
}

.operation-timeline__event strong {
  color: #1d2939;
  font-size: 14px;
}

.operation-timeline__main time {
  flex: none;
  color: #98a2b3;
  font-size: 12px;
  line-height: 20px;
}

.operation-timeline__note {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px;
  margin-top: 9px;
  padding: 8px 10px;
  border-left: 3px solid #d0d5dd;
  border-radius: 4px;
  background: #f8fafc;
  color: #475467;
  font-size: 13px;
  line-height: 20px;
  white-space: pre-wrap;
  word-break: break-word;
}

.operation-timeline__note b {
  white-space: nowrap;
  color: #344054;
}

.operation-timeline__item.is-primary .operation-timeline__marker {
  border-color: #bfdbfe;
  background: #eff6ff;
  color: #2563eb;
}

.operation-timeline__item.is-success .operation-timeline__marker {
  border-color: #bbf7d0;
  background: #f0fdf4;
  color: #16a34a;
}

.operation-timeline__item.is-danger .operation-timeline__marker {
  border-color: #fecaca;
  background: #fff1f0;
  color: #d92d20;
}

.operation-timeline__item.is-danger .operation-timeline__content {
  border-color: #fee4e2;
}

.operation-timeline__item.is-danger .operation-timeline__note {
  border-left-color: #f04438;
  background: #fff5f4;
  color: #b42318;
}

.operation-timeline__item.is-danger .operation-timeline__note b {
  color: #b42318;
}

.operation-timeline__footer {
  display: flex;
  justify-content: center;
  padding-top: 2px;
}

.operation-timeline__toggle {
  padding: 5px 10px;
  border: 0;
  background: transparent;
  color: var(--el-color-primary);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.operation-timeline__toggle:hover,
.operation-timeline__toggle:focus-visible {
  text-decoration: underline;
}

@media (max-width: 768px) {
  .operation-timeline {
    margin-top: 16px;
    padding-top: 16px;
  }

  .operation-timeline__header small {
    display: none;
  }

  .operation-timeline__item {
    grid-template-columns: 28px minmax(0, 1fr);
    gap: 8px;
  }

  .operation-timeline__item:not(:last-child)::before {
    left: 13px;
  }

  .operation-timeline__marker {
    width: 27px;
    height: 27px;
  }

  .operation-timeline__content {
    padding: 10px 11px;
  }

  .operation-timeline__main {
    display: grid;
    gap: 3px;
  }

  .operation-timeline__main time {
    justify-self: start;
  }

  .operation-timeline__note {
    grid-template-columns: minmax(0, 1fr);
    gap: 2px;
  }
}
</style>
