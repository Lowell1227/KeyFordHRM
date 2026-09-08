<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { ReviewHistoryRecord } from '@/types/api.types';
import { formatDateTime } from '@/utils/date';

const props = defineProps<{ records?: ReviewHistoryRecord[] }>();
const expanded = ref(false);
const nodes: Record<string, string> = { manager_score: '上级周期评定', dept_review: '部门复核', hr_calibration: '绩效校准', approval: '结果审批', publish: '结果公示' };
const actions: Record<string, string> = { submit: '已提交', approve: '已通过', reject: '已退回', withdraw: '已撤回' };
const entries = computed(() => (props.records ?? []).filter(r => nodes[r.nodeType] && actions[r.action])
  .map(record => {
    const data = record.extraData && typeof record.extraData === 'object' ? record.extraData as Record<string, unknown> : null;
    return { ...record,
      nodeLabel: data?.type === 'manager_period_review_returned' ? `${typeof data.periodKey === 'string' ? data.periodKey + ' ' : ''}月度评价` : nodes[record.nodeType],
      opinion: data?.type === 'final_grade_submitted' ? (typeof data.comment === 'string' ? data.comment : '') : record.comment,
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
      <li v-for="(record, index) in visibleEntries" :key="record.id ?? index">
        <div class="review-history__meta">
          <strong>{{ record.nodeLabel }}</strong>
          <span :class="{ 'review-history__returned': record.action === 'reject' }">{{ actions[record.action] }}</span>
          <span v-if="record.combined">合并办理</span>
          <span>{{ record.actorName || '系统' }}</span>
          <time>{{ formatDateTime(record.createdAt) }}</time>
        </div>
        <p>{{ record.opinion || '未填写意见' }}</p>
      </li>
    </ol>
    <el-button v-if="entries.length > 3" link type="primary" @click="expanded = !expanded">{{ expanded ? '收起记录' : `查看全部 ${entries.length} 条记录` }}</el-button>
  </section>
</template>

<style scoped>
.review-history { min-width: 0; margin-top: 18px; }
h3 { margin: 0 0 12px; font-size: 14px; }
h3 span { margin-left: 8px; font-size: 12px; font-weight: normal; color: var(--el-text-color-secondary); }
ol { margin: 0; padding: 0; list-style: none; }
li { padding: 12px 0; border-top: 1px solid var(--el-border-color-lighter); }
.review-history__meta { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: baseline; font-size: 12px; color: var(--el-text-color-secondary); }
.review-history__meta strong { color: var(--el-text-color-regular); font-size: 13px; }
.review-history__returned { color: var(--el-color-danger); }
li p { margin: 8px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; line-height: 1.6; color: var(--el-text-color-regular); }
.review-history__empty { color: var(--el-text-color-secondary); font-size: 13px; }
</style>
