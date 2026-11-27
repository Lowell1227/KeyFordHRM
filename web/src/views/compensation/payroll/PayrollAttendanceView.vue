<script setup lang="ts">
import ConfigurationLink from '@/components/common/ConfigurationLink.vue';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { ElMessageBox } from 'element-plus';
import { onBeforeRouteLeave } from 'vue-router';
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
import { payrollAbsenceApi } from '@/api/payroll-absence.api';
import { payrollRecoveryApi } from '@/api/payroll-recovery.api';
import type { PayrollAbsenceDetail, PayrollAttendanceReview } from '@/types/payroll-absence.types';
import type { PayrollScopeDiff } from '@/types/payroll-recovery.types';
import { attendanceDayReviews, attendanceRecordRows, attendanceReviewLabels, attendanceTime, pendingAbsenceProposals } from './payroll-attendance-review';

const { subjects, subjectId, month, has, error, loading, refreshAccess } = usePayrollScope(['attendance_edit', 'attendance_seal'], { persistQuery: true });
const snapshots = ref<PayrollAttendance[]>([]);
const employees = ref<PayrollEmployee[]>([]);
const scopePending = computed(() => !isLocalPreview && !!subjectId.value && !loading.value && !error.value && !employees.value.length);
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
const absenceState = ref<PayrollAbsenceDetail>(), absenceLoading = ref(false), absenceError = ref('');
const absenceReference = ref(''), absenceNote = ref(''), absenceReferenceError = ref('');
const scopeDiff = ref<PayrollScopeDiff>(), scopeOpen = ref(false), scopeReason = ref(''), scopeError = ref('');
let absenceSequence = 0, absenceRequest = '', scopeRequest = '';
const absenceCandidate = computed(() => detail.value && absenceState.value?.candidates.find(row => row.employeeId === detail.value!.employeeId && row.workDate === detail.value!.workDate));
const absenceProposals = computed(() => detail.value && absenceState.value ? pendingAbsenceProposals(absenceState.value.review, absenceState.value.confirmed, detail.value) : []);
const approvedAbsences = computed(() => absenceState.value?.confirmed.filter(row => row.employeeId === detail.value?.employeeId && row.workDate === detail.value?.workDate) ?? []);
const dayReviews = computed(() => detail.value ? attendanceDayReviews(absenceState.value?.review ?? (current.value?.review ?? []) as PayrollAttendanceReview[], detail.value) : []);
const recordRows = computed(() => attendanceRecordRows(detail.value?.records ?? []));
const scopeChanged = computed(() => !!scopeDiff.value && !!(scopeDiff.value.added.length || scopeDiff.value.removed.length));
const reviewerName = (id: string) => absenceState.value?.actors.find(row => row.id === id)?.name ?? '办理人记录不可用';
let pollTimer: ReturnType<typeof setTimeout> | undefined, jobsSequence = 0, disposed = false;
let sequence = 0;
const employeeName = (id: string) => employees.value.find(person => person.id === id)?.name ?? id;
function issueText(day: AttendanceDay) { return day.issues?.map(issue => typeof issue === 'string' ? attendanceIssueLabels[issue] || issue : attendanceIssueLabels[issue.code] || issue.message || issue.code).join('；'); }
const needsAttendanceRule = computed(() => detail.value?.issues?.some(issue => {
  const code = typeof issue === 'string' ? issue : issue.code;
  return code === 'DAY_CONVERSION_REQUIRED' || code === 'APPROVAL_TYPE_UNMAPPED';
}));
async function load() {
  const request = ++sequence;
  snapshots.value = []; employees.value = []; selectedId.value = ''; detail.value = undefined;
  scopeDiff.value = undefined; absenceState.value = undefined; ++absenceSequence;
  feedback.value = '';
  if (!subjectId.value || !month.value) return;
  error.value = '';
  loading.value = true;
  try {
    const [rows, people] = await Promise.all([payrollApi.attendance(subjectId.value, month.value), payrollApi.employees(subjectId.value, month.value)]);
    if (request !== sequence) return;
    snapshots.value = [...rows].sort((a, b) => b.version - a.version); employees.value = people;
    if (rows.length && has('attendance_edit') && has('attendance_seal')) {
      const difference = await payrollRecoveryApi.scopeDiff(snapshots.value[0]!.id);
      if (request === sequence) scopeDiff.value = difference;
    }
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
onUnmounted(() => { disposed = true; ++jobsSequence; ++absenceSequence; stopPolling(); });
async function loadAbsence() {
  const row = current.value, selected = detail.value, request = ++absenceSequence;
  absenceState.value = undefined; absenceError.value = '';
  if (!row || !selected) return;
  absenceLoading.value = true;
  try {
    const data = await payrollAbsenceApi.detail(row.id);
    if (!disposed && request === absenceSequence && current.value?.id === row.id && detail.value === selected) absenceState.value = data;
  } catch (cause) { if (request === absenceSequence && !disposed) absenceError.value = await payrollError(cause); }
  finally { if (request === absenceSequence) absenceLoading.value = false; }
}
function openDay(day: unknown) {
  detail.value = day as AttendanceDay; note.value = ''; noteError.value = ''; absenceReference.value = ''; absenceNote.value = ''; absenceReferenceError.value = ''; absenceRequest = '';
  void loadAbsence();
}
async function mayLeaveDetail() {
  if (busy.value) return false;
  if (!note.value.trim() && !absenceReference.value.trim() && !absenceNote.value.trim() && !scopeReason.value.trim()) return true;
  try { await ElMessageBox.confirm('放弃尚未保存的核对内容？', '离开核对', { confirmButtonText: '放弃修改', cancelButtonText: '继续核对' }); return true; } catch { return false; }
}
async function closeDay() { if (await mayLeaveDetail()) { detail.value = undefined; ++absenceSequence; note.value = ''; absenceReference.value = ''; absenceNote.value = ''; } }
onBeforeRouteLeave(mayLeaveDetail);
async function refreshDay(message: string) {
  const selected = detail.value;
  note.value = ''; absenceReference.value = ''; absenceNote.value = ''; absenceRequest = '';
  await load();
  if (selected) { detail.value = current.value?.payload.days.find(row => row.employeeId === selected.employeeId && row.workDate === selected.workDate); await loadAbsence(); }
  feedback.value = message;
}
async function proposeAbsence() {
  const row = current.value, day = detail.value;
  absenceReferenceError.value = ''; absenceError.value = '';
  if (!absenceReference.value.trim()) { absenceReferenceError.value = '请填写已核定缺勤的依据'; return; }
  if (!row || !day || !absenceCandidate.value || busy.value) return;
  busy.value = true; absenceRequest ||= crypto.randomUUID();
  try {
    await payrollAbsenceApi.propose(row.id, { expectedVersion: row.version, employeeId: day.employeeId, workDate: day.workDate, reference: absenceReference.value.trim(), requestId: absenceRequest });
    absenceReference.value = ''; absenceRequest = ''; await loadAbsence(); feedback.value = '核定已提出，待封账人员核对；尚未计入缺勤';
  } catch (cause) { absenceError.value = await payrollError(cause); }
  finally { busy.value = false; }
}
async function decideAbsence(id: string, decision: 'approve' | 'return' | 'revoke') {
  const row = current.value; if (!row || busy.value) return;
  absenceError.value = '';
  if (decision !== 'approve' && !absenceNote.value.trim()) { absenceError.value = '请填写退回或撤销原因'; return; }
  if (decision !== 'return') {
    try { await ElMessageBox.confirm(decision === 'approve' ? '已核对排班区间、缺勤事实和依据，将生成新考勤版本？' : '撤销后该人日重新待核，将保留原核定记录。继续？',
      decision === 'approve' ? '通过缺勤核定' : '撤销缺勤核定', { confirmButtonText: decision === 'approve' ? '通过核定' : '撤销核定', cancelButtonText: '取消', type: 'warning' }); } catch { return; }
  }
  busy.value = true;
  try {
    await payrollAbsenceApi.decide(row.id, id, { expectedVersion: row.version, decision, note: absenceNote.value.trim() });
    await refreshDay(decision === 'approve' ? '核定已通过；查询覆盖未齐时请重新同步，再核对封账' : decision === 'return' ? '核定已退回经办' : '核定已撤销，请重新核对原始来源');
  } catch (cause) { absenceError.value = await payrollError(cause); }
  finally { busy.value = false; }
}
function openScopeRecovery() { scopeOpen.value = true; scopeReason.value = ''; scopeError.value = ''; scopeRequest = crypto.randomUUID(); }
async function closeScopeRecovery() { if (await mayLeaveDetail()) { scopeOpen.value = false; scopeReason.value = ''; } }
async function recoverScope() {
  const value = scopeDiff.value; if (!value || busy.value) return;
  if (!scopeReason.value.trim()) { scopeError.value = '请填写人员或日期范围调整的依据'; return; }
  busy.value = true; scopeError.value = '';
  try {
    await payrollRecoveryApi.recoverScope(value.snapshotId, { snapshotVersion: value.snapshotVersion, snapshotHash: value.snapshotHash,
      scopeHash: value.scopeHash, reason: scopeReason.value.trim(), requestId: scopeRequest });
    scopeReason.value = ''; scopeOpen.value = false; await load(); feedback.value = '已生成范围调整后的考勤版本，新增人员或日期需同步后再封账';
  } catch (cause) { scopeError.value = await payrollError(cause); }
  finally { busy.value = false; }
}
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
      <PayrollScope v-model:subject="subjectId" v-model:month="month" :subjects="subjects" :disabled="busy || !!detail || scopeOpen" @refresh="refresh">
        <el-button v-if="has('attendance_edit') && isLocalPreview" :disabled="loading" @click="sourceOpen = true; sourceError = ''; sourceComplete = false; partial = false">接收考勤</el-button>
        <el-button v-if="has('attendance_edit') && !isLocalPreview" :loading="syncBusy" :disabled="loading || busy || !!error || !employees.length || syncJobs.some(job => ['queued', 'processing'].includes(job.status))" @click="syncDingtalk()">同步钉钉考勤</el-button>
        <el-button v-if="!isLocalPreview && (syncJobs.length || syncError)" :disabled="busy" @click="syncOpen = true; loadJobs()">同步记录</el-button>
        <el-button v-if="has('attendance_seal') && current && current.status !== 'sealed'" type="primary" :loading="busy" @click="seal">封账当前版本</el-button>
      </PayrollScope>
      <el-tabs v-model="tab"><el-tab-pane label="月度汇总" name="summary" /><el-tab-pane label="异常核对" name="issues" /><el-tab-pane label="封账记录" name="history" /></el-tabs>
      <div v-if="tab !== 'history'" class="attendance-filters">
        <el-select v-model="selectedId" aria-label="考勤版本" placeholder="最新版本" :disabled="busy || !!detail"><el-option v-for="row in snapshots" :key="row.id" :value="row.id" :label="`第 ${row.version} 版 · ${row.status === 'sealed' ? '已封账' : '待核对'}`" /></el-select>
        <el-select v-model="employeeFilter" aria-label="员工" placeholder="全部员工" filterable clearable><el-option v-for="person in employees" :key="person.id" :label="`${person.name} ${person.employeeNo}`" :value="person.id" /></el-select>
        <span v-if="current">{{ current.payload.days.length }} 人日 · {{ current.payload.issues.length }} 项异常</span>
      </div>
    </template>
    <template #feedback>
      <el-alert v-if="error" :title="error" type="error" :closable="false" />
      <el-alert v-else-if="scopePending" title="本月暂无已审核的发薪人员" type="info" :closable="false">
        <p>请在工资资料中核对人员范围、生效日期和任职记录，提交经办人的直属主管审核后再同步考勤。</p>
        <ConfigurationLink setting="payroll-standards" :subject-id="subjectId || undefined" :month="month" label="前往工资资料" />
        <ConfigurationLink v-if="has('payroll_edit')" setting="payroll-rules" :subject-id="subjectId || undefined" :month="month" label="维护工资规则" />
      </el-alert>
      <el-alert v-else-if="!isLocalPreview && subjectId && !loading && !snapshots.length" title="本月尚未同步考勤" type="info" :closable="false" />
      <el-alert v-if="feedback" :title="feedback" type="success" :closable="false" />
      <el-alert v-if="scopeChanged" title="已审核发薪范围与当前考勤不一致" type="warning" :closable="false">
        <span>新增 {{ scopeDiff?.added.length }} 人日，移出 {{ scopeDiff?.removed.length }} 人日。</span>
        <el-button link type="primary" :disabled="busy" @click="openScopeRecovery">核对范围变化</el-button>
      </el-alert>
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
      <BusinessDetailDrawer :model-value="!!detail" :title="detail ? `${employeeName(detail.employeeId)} · ${detail.workDate}` : '考勤核对'" :saving="busy" :before-close="() => { void closeDay(); }" @update:model-value="value => { if (!value) void closeDay(); }">
        <template v-if="detail">
          <dl class="day-summary"><div><dt>应出勤天数</dt><dd>{{ detail.units ?? '待核对' }}</dd></div><div><dt>考勤要求</dt><dd>{{ detail.required === true ? '应出勤' : detail.required === false ? '无需正常出勤' : '待核对' }}</dd></div></dl>
          <el-alert v-if="issueText(detail)" :title="issueText(detail)" type="warning" :closable="false">
            <ConfigurationLink v-if="needsAttendanceRule" setting="payroll-rules" :subject-id="subjectId || undefined" :month="month" label="维护工资规则" />
          </el-alert>
          <el-table class="records-desktop" :data="recordRows" empty-text="尚无有效出勤记录">
            <el-table-column prop="typeLabel" label="类型" min-width="110" /><el-table-column prop="range" label="北京时间" min-width="220" />
            <el-table-column prop="hours" label="有效小时" min-width="90" /><el-table-column prop="status" label="状态" min-width="100" />
          </el-table>
          <div class="records-mobile"><MobileResultCard v-for="(row, index) in recordRows" :key="index"><template #title>{{ row.typeLabel }}</template><template #status>{{ row.status }}</template><div>{{ row.range }}</div><div>有效小时：{{ row.hours }}</div></MobileResultCard></div>
          <el-alert v-if="absenceError" :title="absenceError" type="error" :closable="false" />
          <div v-if="absenceLoading" role="status">正在读取核定记录…</div>
          <section v-if="absenceCandidate && !absenceProposals.length && !approvedAbsences.length && has('attendance_edit') && current?.status !== 'sealed'" class="review-action">
            <h3>已核定缺勤</h3><p>排班待核区间共 {{ absenceCandidate.hours }} 小时，提出申请后由封账人员核对。</p>
            <p v-for="(interval, index) in absenceCandidate.intervals" :key="index">{{ attendanceTime(interval.startsAt) }} 至 {{ attendanceTime(interval.endsAt) }}</p>
            <el-form label-position="top"><el-form-item label="缺勤核定依据" :error="absenceReferenceError"><el-input v-model="absenceReference" type="textarea" :rows="3" maxlength="500" :disabled="busy" /></el-form-item></el-form>
            <el-button type="primary" :loading="busy" @click="proposeAbsence">提出缺勤核定</el-button>
          </section>
          <section v-for="proposal in absenceProposals" :key="proposal.id" class="review-action">
            <h3>待封账人员核对</h3><p>提出人：{{ reviewerName(proposal.actorId) }} · {{ proposal.hours }} 小时</p><p>依据：{{ proposal.reference }}</p>
            <template v-if="has('attendance_seal') && current?.status !== 'sealed'">
              <el-form label-position="top"><el-form-item label="核对意见（退回时必填）"><el-input v-model="absenceNote" type="textarea" :rows="2" :disabled="busy" maxlength="500" /></el-form-item></el-form>
              <el-button :disabled="busy" @click="decideAbsence(proposal.id!, 'return')">退回核定</el-button><el-button type="primary" :loading="busy" @click="decideAbsence(proposal.id!, 'approve')">通过核定</el-button>
            </template>
          </section>
          <section v-for="fact in approvedAbsences" :key="fact.id" class="review-action">
            <h3>已通过缺勤核定 · {{ fact.hours }} 小时</h3><p>{{ fact.reference }}</p><p>核对人：{{ reviewerName(fact.approvedById) }} · {{ attendanceTime(fact.approvedAt) }}</p>
            <template v-if="has('attendance_seal') && current?.status !== 'sealed'"><el-form label-position="top"><el-form-item label="撤销原因"><el-input v-model="absenceNote" :disabled="busy" maxlength="500" /></el-form-item></el-form><el-button :disabled="busy" @click="decideAbsence(fact.id, 'revoke')">撤销核定</el-button></template>
          </section>
          <h3>核对记录</h3>
          <el-timeline><el-timeline-item v-for="(entry, index) in dayReviews" :key="index" :timestamp="attendanceTime(entry.at)">
            <strong>{{ reviewerName(entry.actorId) }} · {{ attendanceReviewLabels[entry.kind ?? ''] ?? '记录核对' }}</strong><p>{{ entry.reference || entry.note }}</p>
          </el-timeline-item></el-timeline><el-empty v-if="!dayReviews.length" description="暂无核对记录" :image-size="48" />
          <el-form v-if="has('attendance_edit') && current?.status !== 'sealed'" label-position="top" class="review-action">
            <el-form-item label="核对说明" :error="noteError"><el-input v-model="note" type="textarea" :rows="3" maxlength="500" /></el-form-item>
            <p class="muted">记录说明不会消除异常；补卡、假勤或排班更正后需重新同步。</p><el-button :loading="busy" @click="review">保存核对说明</el-button>
          </el-form>
          <el-collapse class="source-details"><el-collapse-item title="原始依据" name="source"><pre>{{ JSON.stringify(detail, null, 2) }}</pre></el-collapse-item></el-collapse>
        </template>
        <template #footer><el-button :disabled="busy" @click="closeDay">关闭</el-button></template>
      </BusinessDetailDrawer>
      <BusinessDetailDrawer :model-value="scopeOpen" title="核对发薪范围变化" :saving="busy" :before-close="() => { void closeScopeRecovery(); }" @update:model-value="value => { if (!value) void closeScopeRecovery(); }">
        <template v-if="scopeDiff">
          <el-alert v-if="scopeDiff.blockedReason" :title="scopeDiff.blockedReason" type="warning" :closable="false" />
          <h3>移出的人员或日期 · {{ scopeDiff.removed.length }} 人日</h3><p v-for="row in scopeDiff.removed" :key="`${row.employeeId}:${row.workDate}`">{{ row.name }} · {{ row.workDate }}</p>
          <h3>新增的人员或日期 · {{ scopeDiff.added.length }} 人日</h3><p v-for="row in scopeDiff.added" :key="`${row.employeeId}:${row.workDate}`">{{ row.name }} · {{ row.workDate }} · 待同步</p>
          <p>原考勤版本保留；只为已审核的新范围生成待核版本。</p>
          <el-form label-position="top"><el-form-item label="范围变化依据" :error="scopeError"><el-input v-model="scopeReason" type="textarea" :rows="3" maxlength="500" :disabled="busy" /></el-form-item></el-form>
        </template>
        <template #footer><el-button :disabled="busy" @click="closeScopeRecovery">取消</el-button><el-button type="primary" :loading="busy" :disabled="!!scopeDiff?.blockedReason" @click="recoverScope">确认范围并生成新版本</el-button></template>
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
.day-summary { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:0 0 16px; }
.day-summary dt,.muted {color:var(--el-text-color-secondary);font-size:13px;} .day-summary dd {margin:5px 0 0;}
.review-action {border-top:1px solid var(--el-border-color-lighter);margin-top:20px;padding-top:14px;}
h3 {font-size:15px;margin:8px 0 12px;} p {font-size:13px;line-height:1.7;overflow-wrap:anywhere;}
.source-details {margin-top:20px;} .records-mobile {display:none;} .records-desktop {margin:16px 0;}
@media(max-width:768px){.records-desktop{display:none;}.records-mobile{display:grid;gap:10px;margin:16px 0;}}
pre { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; background: var(--el-fill-color-light); padding: 12px; border-radius: 4px; }
</style>
