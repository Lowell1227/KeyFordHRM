<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { ElMessageBox } from 'element-plus';
import { useRouter } from 'vue-router';
import BusinessListPage from '@/components/common/business-list/BusinessListPage.vue';
import BusinessDetailDrawer from '@/components/common/business-list/BusinessDetailDrawer.vue';
import MobileResultCard from '@/components/common/MobileResultCard.vue';
import { payrollApi, payrollError } from '@/api/payroll.api';
import type { AttendanceDay, PayrollAttendance, PayrollEmployee, PayrollAttendanceSyncJob } from '@/types/payroll.types';
import { isLocalPreview } from '@/utils/preview-mode';
import { attendanceIssueLabels } from './payroll-state';
import PayrollScope from './PayrollScope.vue';
import { usePayrollScope } from './usePayrollScope';
import PayrollAttendanceSyncPanel from './PayrollAttendanceSyncPanel.vue';

const { subjects, subjectId, month, has, error, loading, refreshAccess } = usePayrollScope(['attendance_edit', 'attendance_seal'], { persistQuery: true });
const router = useRouter();
const snapshots = ref<PayrollAttendance[]>([]);
const employees = ref<PayrollEmployee[]>([]);
const scopePending = computed(() => !isLocalPreview && !!subjectId.value && !loading.value && !error.value && !employees.value.length);
function maintainRule() { void router.push({ path: '/payroll/standards', query: { subjectId: subjectId.value, month: month.value, tab: 'rules' } }); }
const tab = ref('summary');
const selectedId = ref('');
const current = computed(() => snapshots.value.find(row => row.id === selectedId.value) ?? snapshots.value[0]);
const employeeFilter = ref('');
const days = computed(() => (current.value?.payload.days ?? []).filter(day => (!employeeFilter.value || day.employeeId === employeeFilter.value) && (tab.value !== 'issues' || day.issues?.length)));
const detail = ref<AttendanceDay>();
const sourceOpen = ref(false);
const sourceText = ref('');
const sourceKey = ref('');
const sourceComplete = ref(false), partial = ref(false);
const partialEmployees = ref<string[]>([]), partialDates = ref<string[]>([]);
const sourceError = ref('');
const note = ref('');
const noteError = ref('');
const busy = ref(false);
const feedback = ref('');
const syncOpen = ref(false), syncBusy = ref(false), syncError = ref(''), syncJobs = ref<PayrollAttendanceSyncJob[]>([]);
const syncRequests = new Map<string, string>();
let pollTimer: ReturnType<typeof setTimeout> | undefined, jobsSequence = 0, disposed = false;
let sequence = 0;
const employeeName = (id: string) => employees.value.find(person => person.id === id)?.name ?? id;
function issueText(day: AttendanceDay) { return day.issues?.map(issue => typeof issue === 'string' ? attendanceIssueLabels[issue] || issue : attendanceIssueLabels[issue.code] || issue.message || issue.code).join('；'); }
async function load() {
  const request = ++sequence;
  snapshots.value = []; employees.value = []; selectedId.value = ''; detail.value = undefined;
  feedback.value = '';
  if (!subjectId.value || !month.value) return;
  error.value = '';
  loading.value = true;
  try {
    const [rows, people] = await Promise.all([payrollApi.attendance(subjectId.value, month.value), payrollApi.employees(subjectId.value, month.value)]);
    if (request !== sequence) return;
    snapshots.value = [...rows].sort((a, b) => b.version - a.version); employees.value = people;
  } catch (cause) { if (request === sequence) error.value = await payrollError(cause); }
  finally { if (request === sequence) loading.value = false; }
}
async function refresh() { const before = subjectId.value; await refreshAccess(); if (before === subjectId.value) await load(); }
function stopPolling() { if (pollTimer) clearTimeout(pollTimer); pollTimer = undefined; }
async function loadJobs() {
  if (isLocalPreview || !subjectId.value || !month.value) return;
  stopPolling();
  const request = ++jobsSequence, subject = subjectId.value, period = month.value;
  try {
    const rows = await payrollApi.attendanceJobs(subject, period);
    if (disposed || request !== jobsSequence || subject !== subjectId.value || period !== month.value) return;
    const prior = syncJobs.value[0];
    syncJobs.value = rows; syncError.value = '';
    if (prior && ['queued', 'processing'].includes(prior.status) && rows[0] && !['queued', 'processing'].includes(rows[0].status)) await load();
    if (rows.some(row => ['queued', 'processing'].includes(row.status))) pollTimer = setTimeout(() => { void loadJobs(); }, 3000);
  } catch (cause) { if (!disposed && request === jobsSequence) syncError.value = await payrollError(cause); }
}
async function syncDingtalk(retry?: PayrollAttendanceSyncJob) {
  if (isLocalPreview || syncBusy.value) return;
  syncOpen.value = true; syncBusy.value = true; syncError.value = '';
  const subject = subjectId.value, period = month.value, key = `${subject}:${period}:${retry?.id ?? 'start'}`;
  const requestId = syncRequests.get(key) ?? crypto.randomUUID(); syncRequests.set(key, requestId);
  try {
    const job = retry ? await payrollApi.retryAttendanceJob(retry.id, requestId) : await payrollApi.startAttendanceJob(subject, period, requestId);
    if (disposed || subject !== subjectId.value || period !== month.value) return;
    syncJobs.value = [job, ...syncJobs.value.filter(row => row.id !== job.id)]; syncRequests.delete(key);
    await loadJobs();
  } catch (cause) { if (!disposed && subject === subjectId.value && period === month.value) syncError.value = await payrollError(cause); }
  finally { syncBusy.value = false; }
}
async function cancelJob(job: PayrollAttendanceSyncJob) {
  try { await ElMessageBox.confirm('停止本次同步？已接收的考勤版本保留。', '停止同步', { confirmButtonText: '停止同步', cancelButtonText: '继续同步' }); } catch { return; }
  syncBusy.value = true; syncError.value = '';
  try { await payrollApi.cancelAttendanceJob(job.id); await loadJobs(); }
  catch (cause) { syncError.value = await payrollError(cause); }
  finally { syncBusy.value = false; }
}
watch([subjectId, month], () => { sourceOpen.value = false; sourceText.value = ''; sourceKey.value = ''; employeeFilter.value = ''; syncJobs.value = []; syncOpen.value = false; syncError.value = ''; ++jobsSequence; stopPolling(); void load(); void loadJobs(); });
onMounted(refresh);
onMounted(() => { void loadJobs(); });
onUnmounted(() => { disposed = true; ++jobsSequence; stopPolling(); });
function openDay(day: unknown) { detail.value = day as AttendanceDay; note.value = ''; noteError.value = ''; }
async function loadFixture(corrected: boolean) {
  sourceError.value = ''; busy.value = true;
  try { const value = await payrollApi.fixture(subjectId.value, month.value, corrected); sourceKey.value = value.sourceKey; sourceText.value = JSON.stringify(value.input, null, 2); sourceComplete.value = value.complete === true; }
  catch (cause) { sourceError.value = await payrollError(cause); }
  finally { busy.value = false; }
}
async function sync() {
  sourceError.value = '';
  let input: Record<string, unknown>;
  try { input = JSON.parse(sourceText.value); if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error(); }
  catch { sourceError.value = '请输入有效的考勤 JSON 对象'; return; }
  if (!sourceKey.value.trim()) { sourceError.value = '请填写来源标识'; return; }
  let scope: { employeeIds: string[]; from: string; to: string } | undefined;
  if (partial.value) {
    if (!partialEmployees.value.length || partialDates.value?.length !== 2 || partialDates.value.some(date => !date.startsWith(month.value))) {
      sourceError.value = '请选择本月的员工与补同步日期'; return;
    }
    scope = { employeeIds: [...partialEmployees.value].sort(), from: partialDates.value[0]!, to: partialDates.value[1]! };
    const included = (row: unknown) => {
      const value = row as { employeeId?: string; workDate?: string };
      return scope!.employeeIds.includes(value.employeeId ?? '') && !!value.workDate && value.workDate >= scope!.from && value.workDate <= scope!.to;
    };
    for (const key of ['expected', 'records']) if (Array.isArray(input[key])) input[key] = input[key].filter(included);
  }
  busy.value = true;
  try {
    let key = sourceKey.value.trim();
    if (scope) {
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ key, scope })));
      key = `query:${[...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join('')}`;
    }
    await payrollApi.syncAttendance(subjectId.value, month.value, { sourceKey: key, input, complete: sourceComplete.value, scope });
    sourceOpen.value = false; await load(); feedback.value = '考勤已接收，请核对异常后封账';
  }
  catch (cause) { sourceError.value = await payrollError(cause); }
  finally { busy.value = false; }
}
async function review() {
  if (!note.value.trim()) { noteError.value = '请填写核对结论与依据'; return; }
  if (!current.value || !detail.value) return;
  busy.value = true; noteError.value = '';
  try {
    const updated = await payrollApi.reviewAttendance(current.value.id, { note: note.value.trim(), employeeId: detail.value.employeeId, workDate: detail.value.workDate });
    snapshots.value = snapshots.value.map(row => row.id === updated.id ? updated : row);
    note.value = ''; feedback.value = '核对记录已保存';
  } catch (cause) { noteError.value = await payrollError(cause); }
  finally { busy.value = false; }
}
async function seal() {
  const row = current.value; if (!row) return;
  try { await ElMessageBox.confirm(`封账 ${row.month} 第 ${row.version} 版考勤？`, '考勤封账', { confirmButtonText: '封账', cancelButtonText: '取消' }); } catch { return; }
  busy.value = true; error.value = '';
  try { await payrollApi.sealAttendance(row.id, row.version); await load(); feedback.value = '考勤已封账'; }
  catch (cause) { error.value = await payrollError(cause); }
  finally { busy.value = false; }
}
</script>
<template>
  <BusinessListPage variant="record" :loading="loading">
    <template #filters>
      <PayrollScope v-model:subject="subjectId" v-model:month="month" :subjects="subjects" :disabled="busy" @refresh="refresh">
        <el-button v-if="has('attendance_edit') && isLocalPreview" :disabled="loading" @click="sourceOpen = true; sourceError = ''; sourceComplete = false; partial = false">接收考勤</el-button>
        <el-button v-if="has('attendance_edit') && !isLocalPreview" :loading="syncBusy" :disabled="loading || busy || !!error || !employees.length || syncJobs.some(job => ['queued', 'processing'].includes(job.status))" @click="syncDingtalk()">同步钉钉考勤</el-button>
        <el-button v-if="!isLocalPreview && (syncJobs.length || syncError)" :disabled="busy" @click="syncOpen = true; loadJobs()">同步记录</el-button>
        <el-button v-if="has('attendance_seal') && current && current.status !== 'sealed'" type="primary" :loading="busy" @click="seal">封账当前版本</el-button>
      </PayrollScope>
      <el-tabs v-model="tab"><el-tab-pane label="月度汇总" name="summary" /><el-tab-pane label="异常核对" name="issues" /><el-tab-pane label="封账记录" name="history" /></el-tabs>
      <div v-if="tab !== 'history'" class="attendance-filters">
        <el-select v-model="selectedId" aria-label="考勤版本" placeholder="最新版本"><el-option v-for="row in snapshots" :key="row.id" :value="row.id" :label="`第 ${row.version} 版 · ${row.status === 'sealed' ? '已封账' : '待核对'}`" /></el-select>
        <el-select v-model="employeeFilter" aria-label="员工" placeholder="全部员工" filterable clearable><el-option v-for="person in employees" :key="person.id" :label="`${person.name} ${person.employeeNo}`" :value="person.id" /></el-select>
        <span v-if="current">{{ current.payload.days.length }} 人日 · {{ current.payload.issues.length }} 项异常</span>
      </div>
    </template>
    <template #feedback>
      <el-alert v-if="error" :title="error" type="error" :closable="false" />
      <el-alert v-else-if="scopePending" title="本月暂无已审核的发薪人员" type="info" :closable="false">
        <p>请在工资资料中核对人员范围、生效日期和任职记录，提交经办人的直属主管审核后再同步考勤。</p>
        <el-button v-if="has('payroll_edit')" link type="primary" :disabled="busy" @click="maintainRule">维护工资规则</el-button>
      </el-alert>
      <el-alert v-else-if="!isLocalPreview && subjectId && !loading && !snapshots.length" title="本月尚未同步考勤" type="info" :closable="false" />
      <el-alert v-if="feedback" :title="feedback" type="success" :closable="false" />
    </template>
    <template #desktop-list>
      <el-table v-if="tab === 'history'" :data="snapshots" height="100%"><el-table-column prop="month" label="考勤月" /><el-table-column prop="version" label="版本" /><el-table-column label="状态"><template #default="{ row }">{{ row.status === 'sealed' ? '已封账' : '待核对' }}</template></el-table-column><el-table-column prop="sealedAt" label="封账时间" min-width="180" /></el-table>
      <el-table v-else :data="days" height="100%" empty-text="暂无考勤记录"><el-table-column label="员工" min-width="140"><template #default="{ row }">{{ employeeName(row.employeeId) }}</template></el-table-column><el-table-column prop="workDate" label="工作日" width="120" /><el-table-column label="计薪单位" min-width="120"><template #default="{ row }">{{ row.units ?? '待核对' }}</template></el-table-column><el-table-column label="异常" min-width="240"><template #default="{ row }">{{ issueText(row as AttendanceDay) || '无' }}</template></el-table-column><el-table-column label="操作" width="100" fixed="right"><template #default="{ row }"><el-button link type="primary" @click="openDay(row)">日明细</el-button></template></el-table-column></el-table>
    </template>
    <template #mobile-list>
      <template v-if="tab === 'history'"><MobileResultCard v-for="row in snapshots" :key="row.id"><template #title>{{ row.month }} 第 {{ row.version }} 版</template><template #status>{{ row.status === 'sealed' ? '已封账' : '待核对' }}</template><div>{{ row.sealedAt || '尚未封账' }}</div></MobileResultCard></template>
      <template v-else><MobileResultCard v-for="(day, index) in days" :key="index"><template #title>{{ employeeName(day.employeeId) }}</template><template #status>{{ day.workDate }}</template><div>计薪单位：{{ day.units ?? '待核对' }}</div><div>{{ issueText(day) || '无异常' }}</div><template #actions><el-button link type="primary" @click="openDay(day)">日明细</el-button></template></MobileResultCard></template>
      <el-empty v-if="!days.length && tab !== 'history'" description="暂无考勤记录" />
    </template>
    <template #detail>
      <BusinessDetailDrawer :model-value="!!detail" :title="detail ? `${employeeName(detail.employeeId)} · ${detail.workDate}` : '日明细'" :saving="busy" @update:model-value="detail = undefined">
        <template v-if="detail"><pre>{{ JSON.stringify(detail, null, 2) }}</pre><h3>核对记录</h3><pre>{{ JSON.stringify(current?.review ?? [], null, 2) }}</pre><el-form v-if="has('attendance_edit') && current?.status !== 'sealed'" label-position="top"><el-form-item label="核对结论与依据" :error="noteError"><el-input v-model="note" type="textarea" :rows="3" maxlength="500" /></el-form-item><el-button type="primary" :loading="busy" @click="review">保存核对记录</el-button></el-form></template>
      </BusinessDetailDrawer>
      <BusinessDetailDrawer v-if="!isLocalPreview" v-model="syncOpen" title="钉钉考勤同步" :saving="syncBusy"><PayrollAttendanceSyncPanel :jobs="syncJobs" :busy="syncBusy" :error="syncError" @cancel="cancelJob" @retry="syncDingtalk" @refresh="loadJobs" /><template #footer><el-button :disabled="syncBusy" @click="syncOpen = false">关闭</el-button></template></BusinessDetailDrawer>
      <BusinessDetailDrawer v-if="isLocalPreview" v-model="sourceOpen" title="接收考勤" :saving="busy">
        <el-form label-position="top"><el-form-item label="来源标识" :error="!sourceKey ? sourceError : ''"><el-input v-model="sourceKey" /></el-form-item><el-form-item label="考勤来源 JSON" :error="sourceKey ? sourceError : ''"><el-input v-model="sourceText" type="textarea" :rows="14" /></el-form-item></el-form>
        <el-form label-position="top">
          <el-form-item><el-checkbox v-model="partial">按人和日期补同步</el-checkbox></el-form-item>
          <template v-if="partial">
            <el-form-item label="补同步员工"><el-select v-model="partialEmployees" multiple filterable><el-option v-for="person in employees" :key="person.id" :value="person.id" :label="person.name" /></el-select></el-form-item>
            <el-form-item label="补同步日期"><el-date-picker v-model="partialDates" type="daterange" value-format="YYYY-MM-DD" start-placeholder="开始日期" end-placeholder="结束日期" style="max-width: 100%" /></el-form-item>
          </template>
          <el-form-item><el-checkbox v-model="sourceComplete">来源分页已全部完成</el-checkbox></el-form-item>
        </el-form>
        <div v-if="isLocalPreview" class="fixture-actions"><el-button :disabled="busy" @click="loadFixture(false)">载入虚构考勤</el-button><el-button :disabled="busy" @click="loadFixture(true)">载入虚构更正</el-button></div>
        <template #footer><el-button :disabled="busy" @click="sourceOpen = false">取消</el-button><el-button type="primary" :loading="busy" @click="sync">接收并核对</el-button></template>
      </BusinessDetailDrawer>
    </template>
  </BusinessListPage>
</template>
<style scoped>
.attendance-filters, .fixture-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.attendance-filters :deep(.el-select) { width: 220px; max-width: 100%; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; background: var(--el-fill-color-light); padding: 12px; border-radius: 4px; }
</style>
