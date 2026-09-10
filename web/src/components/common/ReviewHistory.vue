<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { ReviewHistoryRecord } from '@/types/api.types';
import { formatDateTime } from '@/utils/date';

const props = defineProps<{ records?: ReviewHistoryRecord[] }>();
const expanded = ref(false);
const nodes: Record<string, string> = { manager_score: '上级周期评定', dept_review: '部门复核', hr_calibration: '绩效校准', approval: '结果审批', employee_confirm: '员工确认', publish: '结果公示', appeal: 'HR 发起申诉' };
const actions: Record<string, string> = { submit: '已提交', approve: '已通过', reject: '已退回', withdraw: '已撤回' };
const entries = computed(() => (props.records ?? []).filter(r => nodes[r.nodeType] && actions[r.action])
  .map(record => {
    const data = record.extraData && typeof record.extraData === 'object' ? record.extraData as Record<string, unknown> : null;
    return { ...record,
      nodeLabel: data?.type === 'prepublication_appeal' && data.source === 'employee' ? '员工提出异议'
        : data?.type === 'manager_period_review_returned' ? `${typeof data.periodKey === 'string' ? data.periodKey + ' ' : ''}月度评价` : nodes[record.nodeType],
      opinion: data?.type === 'final_grade_submitted' ? (typeof data.comment === 'string' ? data.comment : '') : record.comment,
      actionLabel: data?.type === 'prepublication_appeal' ? '已提出'
        : record.nodeType === 'employee_confirm' && record.action === 'approve' ? '已确认'
        : record.nodeType === 'publish' && record.action === 'approve' ? '已公示' : actions[record.action],
      combined: data?.type === 'combined_department_review',
    };
  }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
const visibleEntries = computed(() => expanded.value ? entries.value : entries.value.slice(0, 3));
watch(() => props.records, () => { expanded.value = false; });
</script>

<template>
  <section class="review-history" data-testid="review-history" aria-label="关键节点记录">
    <h3>关键节点记录<span>{{ entries.length }} 条</span></h3>
    <p v-if="!entries.length" class="review-history__empty">暂无关键节点记录</p>
    <ol v-else>
      <li v-for="(record, index) in visibleEntries" :key="record.id ?? index" :class="`review-history__entry--${record.action}`">
        <time :datetime="record.createdAt">{{ formatDateTime(record.createdAt) }}</time>
        <div class="review-history__heading">
          <strong>{{ record.nodeLabel }}</strong>
          <span v-if="record.combined" class="review-history__combined">合并办理</span>
        </div>
        <div class="review-history__meta">
          <span class="review-history__avatar" aria-hidden="true">{{ (record.actorName || '系统').slice(0, 1) }}</span>
          <span>{{ record.actorName || '系统' }}</span>
          <span class="review-history__action">{{ record.actionLabel }}</span>
        </div>
        <p v-if="record.opinion?.trim()">{{ record.opinion }}</p>
      </li>
    </ol>
    <el-button v-if="entries.length > 3" link type="primary" @click="expanded = !expanded">{{ expanded ? '收起记录' : `查看全部 ${entries.length} 条记录` }}</el-button>
  </section>
</template>

<style scoped>
.review-history { min-width: 0; margin-top: 18px; }
h3 { margin: 0 0 12px; font-size: 14px; }
h3 span { margin-left: 8px; font-size: 12px; font-weight: normal; color: var(--el-text-color-secondary); }
ol { margin: 0; padding: 0 0 0 6px; list-style: none; }
li { --node-color: var(--el-color-primary); position: relative; padding: 0 0 22px 22px; border-left: 2px solid var(--el-border-color-lighter); }
li:last-child { border-left-color: transparent; padding-bottom: 8px; }
li::before { content: ''; position: absolute; left: -6px; top: 4px; width: 10px; height: 10px; box-sizing: border-box; border: 2px solid var(--node-color); background: var(--el-bg-color); border-radius: 50%; }
.review-history__entry--approve { --node-color: var(--el-color-success); }
.review-history__entry--reject, .review-history__entry--withdraw { --node-color: var(--el-color-danger); }
time { display: block; margin-bottom: 7px; color: var(--el-text-color-secondary); font-size: 12px; line-height: 18px; }
.review-history__heading { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 8px; }
.review-history__heading strong { font-size: 14px; color: var(--el-text-color-primary); }
.review-history__action { color: var(--node-color); font-weight: 600; }
.review-history__combined { font-size: 12px; color: var(--el-text-color-secondary); }
.review-history__meta { display: flex; flex-wrap: wrap; gap: 4px 7px; align-items: center; font-size: 13px; color: var(--el-text-color-regular); }
.review-history__avatar { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 50%; font-size: 11px; background: var(--el-fill-color); color: var(--el-text-color-secondary); }
li p { margin: 10px 0 0; padding: 9px 12px; border-radius: 5px; background: var(--el-fill-color-light); white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; line-height: 1.75; color: var(--el-text-color-regular); }
.review-history__empty { color: var(--el-text-color-secondary); font-size: 13px; }
</style>
