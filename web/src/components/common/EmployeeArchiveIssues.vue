<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { isAxiosError } from 'axios';
import { ElMessage } from 'element-plus';
import { employeeArchivesApi, type EmployeeArchiveIssue, type EmployeeArchiveIssueExemption } from '@/api/employee-archives.api';
import { useAuthStore } from '@/stores/auth.store';

const props = defineProps<{ employeeId?: string; requestId?: string; count: number; settings?: boolean; refreshKey?: number }>();
const emit = defineEmits<{
  changed: [];
  maintain: [issue: EmployeeArchiveIssue];
  loaded: [value: { employeeId?: string; items: EmployeeArchiveIssue[]; exemptions: EmployeeArchiveIssueExemption[] }];
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
const exemptions = ref<EmployeeArchiveIssueExemption[]>([]);
const reasons = ref<Record<string, string>>({});
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
    const result: { items: EmployeeArchiveIssue[]; exemptions?: EmployeeArchiveIssueExemption[] } = props.requestId
      ? await employeeArchivesApi.getRequestIssues(props.requestId)
      : await employeeArchivesApi.getEmployeeIssues(props.employeeId!);
    if (version !== requestVersion) return;
    items.value = result.items;
    exemptions.value = result.exemptions ?? [];
    count.value = result.items.length;
    emit('loaded', { employeeId: props.employeeId, items: result.items, exemptions: exemptions.value });
  } catch {
    if (version === requestVersion) loadError.value = '待完善事项读取失败，请重试。';
  } finally {
    if (version === requestVersion) loading.value = false;
  }
}

watch(() => [props.employeeId, props.requestId, props.refreshKey], () => {
  if (props.settings || open.value) void load();
}, { immediate: true });

async function setExemption(issue: EmployeeArchiveIssue | EmployeeArchiveIssueExemption, isExempt: boolean) {
  if (!canWrite.value || !props.employeeId || savingId.value) return;
  const id = 'issueId' in issue ? issue.issueId : issue.id;
  savingId.value = id; actionError.value = '';
  try {
    await employeeArchivesApi.setIssueExemption(props.employeeId, id, { fingerprint: issue.fingerprint, isExempt,
      expectedVersion: 'version' in issue ? issue.version : issue.exemptionVersion ?? 0, reason: reasons.value[id]?.trim() || undefined });
    await load();emit('changed');
  } catch (error) {
    actionError.value = isAxiosError(error) && error.response?.status === 409
      ? '资料或豁免设置已更新，请重新核对。' : '豁免设置未保存，请重试。';
    await load();
  } finally { savingId.value = ''; }
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
  emit('maintain', issue);
}
function sourcePosition(issue: EmployeeArchiveIssue) {
  return [issue.source.sheetName, issue.source.rowNumber ? `第 ${issue.source.rowNumber} 行` : '', issue.source.cell].filter(Boolean).join(' · ');
}
function beforeClose(done: () => void) { if (!savingId.value) done(); }
</script>

<template>
  <span v-if="canView && (count > 0 || open || settings)" class="employee-archive-issues">
    <el-button v-if="count > 0" class="archive-warning-marker" type="warning" plain size="small" @click.stop="show">待完善 {{ count }}项</el-button>
    <el-button v-if="settings" link @click.stop="show">提醒设置</el-button>
    <el-dialog v-model="open" title="档案待完善事项" width="min(680px, calc(100vw - 24px))" append-to-body
      :close-on-click-modal="false" :close-on-press-escape="!savingId" :show-close="!savingId" :before-close="beforeClose" class="employee-archive-issues-dialog">
      <div v-loading="loading" class="employee-archive-issues__body">
        <p v-if="!canWrite" class="employee-archive-issues__source">当前可查看资料，编辑或设置豁免需具备员工档案编辑权限。</p>
        <el-alert v-if="actionError" :title="actionError" type="warning" :closable="false" />
        <div v-if="loadError" class="employee-archive-issues__error" role="alert">
          <span>{{ loadError }}</span><el-button link type="primary" :disabled="!!savingId" @click="load">重试</el-button>
        </div>
        <el-empty v-if="!loading && !loadError && !items.length" description="暂无待完善事项" :image-size="64" />
        <section v-for="issue in items" :key="`${issue.requestId}:${issue.id}`" class="employee-archive-issues__item">
          <h3>{{ issue.message }}</h3>
          <p v-if="issue.origin !== 'current' && sourcePosition(issue)" class="employee-archive-issues__source">{{ sourcePosition(issue) }}</p>
          <dl class="employee-archive-issues__values">
            <div v-if="issue.origin !== 'current'"><dt>原资料值</dt><dd>{{ issue.source.value ?? '未提供' }}</dd></div>
            <div><dt>当前记录</dt><dd>{{ issue.current.value ?? '未提供' }}</dd></div>
            <div><dt>需要核实</dt><dd>{{ issue.reason }}</dd></div>
            <div v-if="issue.confirmBlockedReason"><dt>需要 HR 核实什么</dt><dd>{{ issue.confirmBlockedReason }}</dd></div>
          </dl>
          <div class="employee-archive-issues__actions">
            <el-button :disabled="!!savingId" @click="maintain(issue)">{{ canWrite ? '去补充' : '查看资料' }}</el-button>
            <el-checkbox v-if="issue.origin === 'current'" :model-value="false" :disabled="!canWrite || !!savingId || loading" @change="setExemption(issue, true)">豁免提醒</el-checkbox>
            <el-button v-if="canWrite && issue.canConfirmCurrent" type="primary" :loading="savingId === issue.id" :disabled="!!savingId || loading || !!loadError" @click="confirmCurrent(issue)">确认以当前资料为准</el-button>
          </div>
          <el-input v-if="canWrite && issue.origin === 'current'" v-model="reasons[issue.id]" class="employee-archive-issues__reason" placeholder="豁免说明（选填）" :maxlength="500" :disabled="!!savingId" />
        </section>
        <el-collapse v-if="exemptions.length" class="employee-archive-issues__exemptions">
          <el-collapse-item name="exempted" :title="`已豁免 ${exemptions.length}项`">
            <section v-for="item in exemptions" :key="`${item.issueId}:${item.fingerprint}`" class="employee-archive-issues__item">
              <h3>{{ item.message }}</h3><p v-if="item.reason">{{ item.reason }}</p>
              <p v-if="item.currentValue" class="employee-archive-issues__source">豁免时的记录：{{ item.currentValue }}</p>
              <p v-if="item.noLongerApplies" class="employee-archive-issues__source">原问题已不再存在，取消豁免也不会增加无效提示。</p>
              <el-checkbox :model-value="true" :disabled="!canWrite || !!savingId || loading" @change="setExemption(item, false)">豁免提醒</el-checkbox>
            </section>
          </el-collapse-item>
        </el-collapse>
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
.employee-archive-issues__reason { margin-top: 10px; }
.employee-archive-issues__exemptions { color: var(--el-text-color-secondary); }
.employee-archive-issues__error { display: flex; align-items: baseline; gap: 8px; color: var(--el-color-danger); }
@media (max-width: 480px) { .employee-archive-issues__values > div { grid-template-columns: 1fr; gap: 2px; } }
</style>
