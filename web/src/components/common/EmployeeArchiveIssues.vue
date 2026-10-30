<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { isAxiosError } from 'axios';
import { ElMessage } from 'element-plus';
import { employeeArchivesApi, type EmployeeArchiveIssue } from '@/api/employee-archives.api';
import { useAuthStore } from '@/stores/auth.store';

const props = defineProps<{ employeeId?: string; requestId?: string; count: number }>();
const emit = defineEmits<{
  changed: [];
  maintain: [target: EmployeeArchiveIssue['maintenance']];
}>();
const auth = useAuthStore();
const canView = computed(() => ['hr', 'system_admin'].includes(auth.user?.sysRole ?? '')
  || (auth.user?.sysRole === 'hr_user' && auth.user.hrCapabilities?.some(cap => ['employee_archive_edit', 'employee_archive_review'].includes(cap))));
const canWrite = computed(() => ['hr', 'system_admin'].includes(auth.user?.sysRole ?? '')
  || (auth.user?.sysRole === 'hr_user' && auth.user.hrCapabilities?.includes('employee_archive_edit')));
const count = ref(props.count);
const open = ref(false);
const loading = ref(false);
const savingId = ref('');
const items = ref<EmployeeArchiveIssue[]>([]);
const loadError = ref('');
const actionError = ref('');
let requestVersion = 0;
watch(() => props.count, value => { if (!open.value) count.value = value; });

async function load() {
  if (!canView.value) return;
  const version = ++requestVersion;
  loading.value = true;
  loadError.value = '';
  try {
    const result = props.requestId
      ? await employeeArchivesApi.getRequestIssues(props.requestId)
      : await employeeArchivesApi.getEmployeeIssues(props.employeeId!);
    if (version !== requestVersion) return;
    items.value = result.items;
    count.value = result.items.length;
  } catch {
    if (version === requestVersion) loadError.value = '待确认事项读取失败，请重试。';
  } finally {
    if (version === requestVersion) loading.value = false;
  }
}

function show() {
  if (!canView.value) return;
  open.value = true;
  items.value = [];
  actionError.value = '';
  void load();
}

async function confirmCurrent(issue: EmployeeArchiveIssue) {
  if (!canWrite.value || !issue.canConfirmCurrent || savingId.value || loading.value || loadError.value) return;
  savingId.value = issue.id;
  actionError.value = '';
  try {
    await employeeArchivesApi.confirmIssueCurrent(issue.requestId, issue.id, issue.fingerprint);
    ElMessage.success('已确认以当前资料为准，档案内容未改动');
    await load();
    emit('changed');
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 409) {
      actionError.value = '资料已更新，请重新核对来源值和当前值后再确认。';
      await load();
    } else actionError.value = '确认未完成，待确认事项已保留，请稍后重试。';
  } finally {
    savingId.value = '';
  }
}

function maintain(issue: EmployeeArchiveIssue) {
  if (savingId.value) return;
  open.value = false;
  emit('maintain', issue.maintenance);
}
function sourcePosition(issue: EmployeeArchiveIssue) {
  return [issue.source.sheetName, issue.source.rowNumber ? `第 ${issue.source.rowNumber} 行` : '', issue.source.cell].filter(Boolean).join(' · ');
}
function beforeClose(done: () => void) { if (!savingId.value) done(); }
</script>

<template>
  <span v-if="canView && (count > 0 || open)" class="employee-archive-issues">
    <el-button v-if="count > 0" class="archive-warning-marker" type="warning" plain size="small" @click.stop="show">待确认 {{ count }}项</el-button>
    <el-dialog v-model="open" title="档案待确认事项" width="min(680px, calc(100vw - 24px))" append-to-body
      :close-on-click-modal="false" :close-on-press-escape="!savingId" :show-close="!savingId" :before-close="beforeClose" class="employee-archive-issues-dialog">
      <div v-loading="loading" class="employee-archive-issues__body">
        <el-alert v-if="!canWrite" title="当前可查看资料，确认需具备员工档案编辑权限。" type="info" :closable="false" />
        <el-alert v-if="actionError" :title="actionError" type="warning" :closable="false" />
        <div v-if="loadError" class="employee-archive-issues__error" role="alert">
          <span>{{ loadError }}</span><el-button link type="primary" :disabled="!!savingId" @click="load">重试</el-button>
        </div>
        <el-empty v-if="!loading && !loadError && !items.length" description="暂无待确认事项" :image-size="64" />
        <section v-for="issue in items" :key="`${issue.requestId}:${issue.id}`" class="employee-archive-issues__item">
          <h3>{{ issue.message }}</h3>
          <p v-if="sourcePosition(issue)" class="employee-archive-issues__source">{{ sourcePosition(issue) }}</p>
          <dl class="employee-archive-issues__values">
            <div><dt>原资料值</dt><dd>{{ issue.source.value ?? '未提供' }}</dd></div>
            <div><dt>系统当前值</dt><dd>{{ issue.current.value ?? '未提供' }}</dd></div>
            <div><dt>为什么待确认</dt><dd>{{ issue.reason }}</dd></div>
            <div v-if="issue.confirmBlockedReason"><dt>需要 HR 核实什么</dt><dd>{{ issue.confirmBlockedReason }}</dd></div>
          </dl>
          <div class="employee-archive-issues__actions">
            <el-button :disabled="!!savingId" @click="maintain(issue)">{{ canWrite ? '去核实资料' : '查看资料' }}</el-button>
            <el-button v-if="canWrite && issue.canConfirmCurrent" type="primary" :loading="savingId === issue.id" :disabled="!!savingId || loading || !!loadError" @click="confirmCurrent(issue)">确认以当前资料为准</el-button>
          </div>
        </section>
      </div>
      <template #footer><el-button :disabled="!!savingId" @click="open = false">关闭</el-button></template>
    </el-dialog>
  </span>
</template>

<style scoped>
.employee-archive-issues { display: inline-flex; max-width: 100%; }
.employee-archive-issues__body { display: grid; gap: 12px; min-height: 80px; max-height: min(65dvh, 640px); overflow-y: auto; }
.employee-archive-issues__item { border: 1px solid var(--el-border-color-lighter); border-radius: 6px; padding: 14px; min-width: 0; }
.employee-archive-issues__item h3 { margin: 0 0 8px; font-size: 14px; line-height: 1.5; overflow-wrap: anywhere; }
.employee-archive-issues__source { margin: 0 0 10px; font-size: 12px; color: var(--el-text-color-secondary); overflow-wrap: anywhere; }
.employee-archive-issues__values { margin: 0; display: grid; gap: 10px; font-size: 13px; line-height: 1.6; }
.employee-archive-issues__values > div { display: grid; grid-template-columns: 112px minmax(0, 1fr); gap: 10px; }
.employee-archive-issues__values dt { color: var(--el-text-color-secondary); }
.employee-archive-issues__values dd { min-width: 0; margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.employee-archive-issues__actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
.employee-archive-issues__actions :deep(.el-button + .el-button) { margin-left: 0; }
.employee-archive-issues__error { display: flex; align-items: baseline; gap: 8px; color: var(--el-color-danger); }
@media (max-width: 480px) { .employee-archive-issues__values > div { grid-template-columns: 1fr; gap: 2px; } }
</style>
