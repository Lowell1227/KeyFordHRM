<script setup lang="ts">
import { computed, ref } from 'vue';
import type { EmployeeArchiveEvent, EmployeeDataReview } from '@/api/employee-archives.api';
import { applicationProgress, applicationType } from '@/utils/employee-lifecycle';
import { formatDate, formatDateTime } from '@/utils/date';
import { employeeReviewDifferences } from './employee-review-differences';
import { personnelEventSteps } from './personnel-process-timeline';
import PersonnelProcessTimeline from './PersonnelProcessTimeline.vue';

const props = defineProps<{ requests: EmployeeDataReview[]; events?: EmployeeArchiveEvent[] }>();
const filter = ref('all');
function linkedRequest(event: EmployeeArchiveEvent) {
  return props.requests.find(request => request.id === event.entityId || request.id === event.newValue?.requestId
    || request.events?.some(item => item.id === event.id));
}
function eventType(event: EmployeeArchiveEvent) {
  return event.action === 'employee_profile_direct_update' ? '档案修改' : '归档记录';
}
const types = computed(() => [...new Set([...props.requests.map(applicationType), ...(props.events ?? []).filter(event => !linkedRequest(event)).map(eventType)])]);
const items = computed(() => props.requests.filter(item => filter.value === 'all' || applicationType(item) === filter.value)
  .slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)));
const standaloneEvents = computed(() => personnelEventSteps((props.events ?? []).filter(event => !linkedRequest(event)
  && (filter.value === 'all' || eventType(event) === filter.value))));
function changes(request: EmployeeDataReview) {
  return employeeReviewDifferences(request).flatMap(group => group.fields.map(field => ({ ...field,
    key: `${group.key}.${field.key}`, label: group.kind ? `${group.title} · ${field.label}` : field.label,
  })));
}
function requestEvents(request: EmployeeDataReview) {
  return personnelEventSteps([...(request.events ?? []), ...(props.events ?? []).filter(event => linkedRequest(event)?.id === request.id)], request);
}
</script>

<template>
  <section class="change-history">
    <el-select v-model="filter" aria-label="变更类型" class="history-filter"><el-option label="全部变更" value="all" /><el-option v-for="type in types" :key="type" :label="type" :value="type" /></el-select>
    <el-empty v-if="!items.length && !standaloneEvents.length" description="暂无变更记录" :image-size="64" />
    <el-collapse v-if="items.length">
      <el-collapse-item v-for="request in items" :key="request.id" :name="request.id">
        <template #title><div class="history-title"><strong>{{ applicationType(request) }}</strong><span>{{ formatDate(request.proposedValue?.employee?.effectiveDate || request.proposedValue?.employee?.effectiveFrom || request.proposedValue?.employee?.leaveDate || request.createdAt) }}</span><el-tag size="small" effect="plain">{{ applicationProgress(request) }}</el-tag></div></template>
        <p>{{ request.createdBy?.name || '未记录' }} · {{ formatDateTime(request.createdAt) }}</p>
        <el-alert v-if="request.rejectedReason && !requestEvents(request).some(event => event.note === request.rejectedReason)" :title="`退回原因：${request.rejectedReason}`" type="warning" :closable="false" />
        <div v-for="change in changes(request)" :key="change.key" class="history-diff"><strong>{{ change.label }}</strong><span>{{ change.before }} → {{ change.after }}</span></div>
        <PersonnelProcessTimeline v-if="requestEvents(request).length" class="history-events" :items="requestEvents(request)" label="变更日志" />
        <p v-else class="history-events">历史审计事件未记录</p>
      </el-collapse-item>
    </el-collapse>
    <section v-if="standaloneEvents.length" class="history-events">
      <h3>独立操作记录</h3>
      <PersonnelProcessTimeline :items="standaloneEvents" label="独立操作记录" />
    </section>
  </section>
</template>

<style scoped>
.history-filter { max-width: 220px; margin-bottom: 16px; }
.history-title { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; line-height: 1.6; padding: 10px 0; }
.history-title span, p { color: #667085; }
.history-diff { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 12px; border-bottom: 1px solid #eef1f6; padding: 8px 0; overflow-wrap: anywhere; }
.history-events { margin-top: 18px; }
.history-events h3 { font-size: 14px; margin: 0 0 16px; }
.change-history :deep(.el-collapse-item__header) { height: auto; min-height: 48px; }
@media(max-width: 640px) { .history-diff { grid-template-columns: 90px minmax(0, 1fr); } }
</style>
