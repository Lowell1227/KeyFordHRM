<script setup lang="ts">
import { computed } from 'vue';
import ConfigurationLink from '@/components/common/ConfigurationLink.vue';
import type { ConfigurationTarget } from '@/router/configuration-targets';
import type { PayrollAttendanceSyncJob } from '@/types/payroll.types';
const props = defineProps<{ jobs: PayrollAttendanceSyncJob[]; busy: boolean; error: string }>();
const emit = defineEmits<{ cancel: [PayrollAttendanceSyncJob]; retry: [PayrollAttendanceSyncJob]; refresh: [] }>();
const current = computed(() => props.jobs[0]);
const labels: Record<PayrollAttendanceSyncJob['status'], string> = { queued: '等待同步', processing: '正在同步', completed: '同步完成', blocked: '待核对', failed: '同步未完成', cancelled: '已停止' };
const time = (date: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'short', hour12: false }).format(new Date(date));
const progress = computed(() => current.value?.totalCells ? Math.min(100, Math.floor(current.value.completedCells * 100 / current.value.totalCells)) : 0);
const issueSettings = new Map<string, ConfigurationTarget>([
  ['ACCESS_BLOCKED', 'payroll-access'], ['SCOPE_REQUIRED', 'payroll-standards'],
  ['CALENDAR_REQUIRED', 'payroll-rules'], ['MAPPINGS_REQUIRED', 'payroll-rules'],
  ['APPROVAL_TYPE_UNMAPPED', 'payroll-rules'], ['DAY_CONVERSION_REQUIRED', 'payroll-rules'],
  ['CONFIGURATION_REQUIRED', 'payroll-attendance'], ['IDENTITY_REQUIRED', 'payroll-attendance'],
  ['IDENTITY_UNVERIFIED', 'payroll-attendance'], ['WORKFLOW_PERMISSION_UNCONFIRMED', 'payroll-attendance'],
]);
const configurationIssues = computed(() => current.value?.issues.map(item => ({ ...item, setting: issueSettings.get(item.code) })) ?? []);
</script>
<template>
  <el-alert v-if="error" :title="error" type="error" :closable="false">
    <ConfigurationLink v-if="error === '真实钉钉考勤同步尚未开放，预览仅使用虚构数据'" setting="payroll-attendance" />
  </el-alert>
  <template v-if="current">
    <div class="sync-status"><strong>{{ labels[current.status] }}</strong><span>{{ current.completedCells }} / {{ current.totalCells }} 人日</span></div>
    <el-progress :percentage="progress" :status="current.status === 'completed' ? 'success' : ['blocked', 'failed'].includes(current.status) ? 'warning' : undefined" />
    <p class="sync-updated">更新于 {{ time(current.updatedAt) }}<span v-if="current.pendingCells"> · {{ current.pendingCells }} 人日待核</span></p>
    <ul v-if="configurationIssues.length" class="sync-issues">
      <li v-for="(issue, index) in configurationIssues" :key="`${issue.code}:${index}`">
        {{ issue.message }} <ConfigurationLink v-if="issue.setting" :setting="issue.setting" :subject-id="current.subjectId" :month="current.month" />
        <code v-if="issue.mappingKey">{{ issue.mappingKey }}</code>
      </li>
    </ul>
    <div class="sync-actions"><el-button v-if="current.canCancel" :disabled="busy" @click="emit('cancel', current)">停止同步</el-button><el-button v-if="current.canRetry" type="primary" :disabled="busy" @click="emit('retry', current)">重新同步</el-button><el-button :disabled="busy" @click="emit('refresh')">刷新状态</el-button></div>
    <el-collapse v-if="jobs.length > 1"><el-collapse-item title="历史同步"><div v-for="job in jobs.slice(1)" :key="job.id" class="sync-history"><span>{{ time(job.createdAt) }}</span><span>{{ labels[job.status] }}</span><span>{{ job.completedCells }} / {{ job.totalCells }} 人日</span></div></el-collapse-item></el-collapse>
  </template>
  <el-empty v-else-if="!error" :description="busy ? '正在读取同步状态' : '尚无同步记录'" />
</template>
<style scoped>
.sync-status, .sync-actions, .sync-history { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
.sync-status { justify-content: space-between; margin: 16px 0; }
.sync-updated { color: var(--el-text-color-secondary); font-size: 12px; }
.sync-actions { margin: 18px 0; }
.sync-actions .el-button { margin: 0; }
.sync-issues { padding-left: 20px; overflow-wrap: anywhere; }
.sync-issues li { margin: 8px 0; }
code { display: block; padding: 4px 0; font-size: 12px; }
.sync-history { padding: 8px 0; border-bottom: 1px solid var(--el-border-color-lighter); font-size: 12px; }
</style>
