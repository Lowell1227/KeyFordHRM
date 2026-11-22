<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ElMessageBox } from 'element-plus';
import BusinessListPage from '@/components/common/business-list/BusinessListPage.vue';
import BusinessDetailDrawer from '@/components/common/business-list/BusinessDetailDrawer.vue';
import MobileResultCard from '@/components/common/MobileResultCard.vue';
import { payrollApi, payrollError } from '@/api/payroll.api';
import type { AttendanceDay, PayrollAttendance, PayrollEmployee } from '@/types/payroll.types';
import { isLocalPreview } from '@/utils/preview-mode';
import { attendanceIssueLabels } from './payroll-state';
import PayrollScope from './PayrollScope.vue';
import { usePayrollScope } from './usePayrollScope';

const { subjects, subjectId, month, has, error, loading, refreshAccess } = usePayrollScope(['attendance_edit', 'attendance_seal']);
const snapshots = ref<PayrollAttendance[]>([]);
const employees = ref<PayrollEmployee[]>([]);
const tab = ref('summary');
const selectedId = ref('');
const current = computed(() => snapshots.value.find(row => row.id === selectedId.value) ?? snapshots.value[0]);
const employeeFilter = ref('');
const days = computed(() => (current.value?.payload.days ?? []).filter(day => (!employeeFilter.value || day.employeeId === employeeFilter.value) && (tab.value !== 'issues' || day.issues?.length)));
const detail = ref<AttendanceDay>();
const sourceOpen = ref(false);
const sourceText = ref('');
const sourceKey = ref('');
const sourceError = ref('');
const note = ref('');
const noteError = ref('');
const busy = ref(false);
const feedback = ref('');
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
watch([subjectId, month], () => { sourceOpen.value = false; sourceText.value = ''; sourceKey.value = ''; employeeFilter.value = ''; void load(); });
onMounted(refresh);
function openDay(day: unknown) { detail.value = day as AttendanceDay; note.value = ''; noteError.value = ''; }
async function loadFixture(corrected: boolean) {
  sourceError.value = ''; busy.value = true;
  try { const value = await payrollApi.fixture(subjectId.value, month.value, corrected); sourceKey.value = value.sourceKey; sourceText.value = JSON.stringify(value.input, null, 2); }
  catch (cause) { sourceError.value = await payrollError(cause); }
  finally { busy.value = false; }
}
async function sync() {
  sourceError.value = '';
  let input: Record<string, unknown>;
  try { input = JSON.parse(sourceText.value); if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error(); }
  catch { sourceError.value = '请输入有效的考勤 JSON 对象'; return; }
  if (!sourceKey.value.trim()) { sourceError.value = '请填写来源标识'; return; }
  busy.value = true;
  try { await payrollApi.syncAttendance(subjectId.value, month.value, { sourceKey: sourceKey.value.trim(), input }); sourceOpen.value = false; await load(); feedback.value = '考勤已接收，请核对异常后封账'; }
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
        <el-button v-if="has('attendance_edit')" :disabled="loading" @click="sourceOpen = true; sourceError = ''">接收考勤</el-button>
        <el-button v-if="has('attendance_seal') && current && current.status !== 'sealed'" type="primary" :loading="busy" @click="seal">封账当前版本</el-button>
      </PayrollScope>
      <el-tabs v-model="tab"><el-tab-pane label="月度汇总" name="summary" /><el-tab-pane label="异常核对" name="issues" /><el-tab-pane label="封账记录" name="history" /></el-tabs>
      <div v-if="tab !== 'history'" class="attendance-filters">
        <el-select v-model="selectedId" aria-label="考勤版本" placeholder="最新版本"><el-option v-for="row in snapshots" :key="row.id" :value="row.id" :label="`第 ${row.version} 版 · ${row.status === 'sealed' ? '已封账' : '待核对'}`" /></el-select>
        <el-select v-model="employeeFilter" aria-label="员工" placeholder="全部员工" filterable clearable><el-option v-for="person in employees" :key="person.id" :label="`${person.name} ${person.employeeNo}`" :value="person.id" /></el-select>
        <span v-if="current">{{ current.payload.days.length }} 人日 · {{ current.payload.issues.length }} 项异常</span>
      </div>
    </template>
    <template #feedback><el-alert v-if="error" :title="error" type="error" :closable="false" /><el-alert v-if="feedback" :title="feedback" type="success" :closable="false" /></template>
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
      <BusinessDetailDrawer v-model="sourceOpen" title="接收考勤" :saving="busy">
        <el-form label-position="top"><el-form-item label="来源标识" :error="!sourceKey ? sourceError : ''"><el-input v-model="sourceKey" /></el-form-item><el-form-item label="考勤来源 JSON" :error="sourceKey ? sourceError : ''"><el-input v-model="sourceText" type="textarea" :rows="14" /></el-form-item></el-form>
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
