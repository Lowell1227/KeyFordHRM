<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { ElMessageBox } from 'element-plus';
import { onBeforeRouteLeave, useRouter } from 'vue-router';
import { Plus, Delete } from '@element-plus/icons-vue';
import BusinessListPage from '@/components/common/business-list/BusinessListPage.vue';
import BusinessDetailDrawer from '@/components/common/business-list/BusinessDetailDrawer.vue';
import MobileResultCard from '@/components/common/MobileResultCard.vue';
import { payrollApi, payrollError } from '@/api/payroll.api';
import type { PayrollStandard, PayrollStandardInput, PayrollRule, PayrollRuleInput, PayrollEmployee, PayrollOperator, PayrollCycle, PayrollPerformanceMapping } from '@/types/payroll.types';
import PayrollScope from './PayrollScope.vue';
import PayrollWorkCalendarEditor from './PayrollWorkCalendarEditor.vue';
import PayrollManualPerformanceEditor from './PayrollManualPerformanceEditor.vue';
import PayrollEmployeeScopeEditor from './PayrollEmployeeScopeEditor.vue';
import PayrollAttendanceMappingsEditor from './PayrollAttendanceMappingsEditor.vue';
import { attendanceMappingPayload, type AttendanceMappingDraft } from './payroll-attendance-mappings';
import { employeeScopeErrors } from './payroll-employee-scope-form';
import { isLocalPreview } from '@/utils/preview-mode';
import { newPerformanceMapping, manualPerformanceErrors, performanceMappingsPayload } from './payroll-manual-performance-form';
import { usePayrollScope } from './usePayrollScope';
import { isDecimal } from './payroll-state';

const { subjects, subjectId, month, has, error, loading, refreshAccess } = usePayrollScope(['payroll_edit']);
const tab = ref('standards');
const router = useRouter();
const parameterStatus = (value: string) => ({ active: '已发布', draft: '草稿', pending: '待主管审核', returned: '已退回', disabled: '历史' }[value] ?? value);
const standards = ref<PayrollStandard[]>([]), rules = ref<PayrollRule[]>([]);
const employees = ref<PayrollEmployee[]>([]), operators = ref<PayrollOperator[]>([]), cycles = ref<PayrollCycle[]>([]);
const open = ref(false), busy = ref(false), kind = ref<'standard' | 'rule'>('standard');
const formError = ref('');
const fields = reactive<Record<string, string>>({});
const standard = ref<PayrollStandardInput>(emptyStandard());
const rule = ref<PayrollRuleInput>(emptyRule());
const history = ref<PayrollStandard | PayrollRule>();
const rows = computed<Array<PayrollStandard | PayrollRule>>(() => tab.value === 'standards' ? standards.value : rules.value);
const mappings = ref<Array<PayrollPerformanceMapping & { month: string }>>([]);
const manualPeople = reactive<Record<string, { employees: PayrollEmployee[]; loading: boolean; error: string }>>({});
const scopePeople = ref<PayrollEmployee[]>([]), scopeLoading = ref(false), scopeError = ref('');
const attendanceMappings = ref<AttendanceMappingDraft[]>([]);
const attendanceMappingErrors = computed(() => Object.fromEntries(Object.entries(fields).filter(([key]) => key.startsWith('attendanceMappings.')).map(([key, value]) => [key.slice('attendanceMappings.'.length), value])));
let baseline = '', sequence = 0;
const reviewerOptions = computed(() => operators.value.filter(person => person.capabilities.includes('payroll_review')));
const approverOptions = computed(() => operators.value.filter(person => person.capabilities.includes('payroll_approve')));
const employeeName = (id: string) => employees.value.find(person => person.id === id)?.name ?? id;
function emptyStandard(): PayrollStandardInput { return { subjectId: '', employeeId: '', effectiveFrom: '', fixedMonthly: null, performanceBase: null, performanceMode: null, evidence: '' }; }
function emptyRule(): PayrollRuleInput { return { subjectId: '', effectiveFrom: '', config: { fixedSalaryBasis: 'monthly_workdays', workCalendars: {}, monthlyUnits: {}, rounding: null, normalHourly: null, paidHourly: {}, overtime: { hourlyBase: null, weekday: null, restday: null, holiday: null }, reviewers: [], approvers: [], cutoverMonth: null, performance: {} } }; }
function serialized() { return JSON.stringify({ standard: standard.value, rule: rule.value, mappings: mappings.value, attendanceMappings: attendanceMappings.value }); }
async function mayClose() {
  if (busy.value) return false;
  if (!open.value || serialized() === baseline) return true;
  try { await ElMessageBox.confirm('放弃尚未保存的修改？', '离开编辑', { confirmButtonText: '放弃修改', cancelButtonText: '继续编辑' }); return true; } catch { return false; }
}
async function closeForm(value: boolean) { if (value || await mayClose()) open.value = value; }
function beforeCloseForm() { void closeForm(false); }
onBeforeRouteLeave(mayClose);
async function load() {
  const request = ++sequence;
  standards.value = []; rules.value = []; employees.value = []; operators.value = []; cycles.value = [];
  if (!subjectId.value || !month.value) return;
  error.value = '';
  loading.value = true;
  try {
    const [s, r, people] = await Promise.all([payrollApi.standards(subjectId.value), payrollApi.rules(subjectId.value), payrollApi.employees(subjectId.value, month.value)]);
    if (request !== sequence) return;
    standards.value = s; rules.value = r; employees.value = people;
    if (has('payroll_edit')) {
      const [o, c] = await Promise.all([payrollApi.operators(subjectId.value), payrollApi.cycles(subjectId.value)]);
      if (request !== sequence) return;
      operators.value = o; cycles.value = c;
    }
  } catch (cause) { if (request === sequence) error.value = await payrollError(cause); }
  finally { if (request === sequence) loading.value = false; }
}
async function refresh() { const before = subjectId.value; await refreshAccess(); if (before === subjectId.value) await load(); }
watch([subjectId, month], () => { if (!open.value) void load(); });
onMounted(refresh);
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }
function showHistory(row: unknown) { history.value = row as PayrollStandard | PayrollRule; }
function edit(type: 'standard' | 'rule', row?: unknown) {
  kind.value = type; formError.value = ''; Object.keys(fields).forEach(key => delete fields[key]);
  standard.value = type === 'standard' && row ? clone(row as PayrollStandard) : emptyStandard();
  rule.value = type === 'rule' && row ? clone(row as PayrollRule) : emptyRule();
  standard.value.subjectId = subjectId.value; rule.value.subjectId = subjectId.value;
  for (const value of [standard.value, rule.value]) {
    value.effectiveFrom = value.effectiveFrom.slice(0, 10);
    value.effectiveTo = value.effectiveTo?.slice(0, 10);
  }
  rule.value.config.monthlyUnits ??= {};
  rule.value.config.workCalendars ??= {};
  mappings.value = Object.entries(rule.value.config.performance).map(([key, value]) => ({ ...clone(value), month: key }));
  attendanceMappings.value = Object.entries(rule.value.config.attendanceMappings ?? {}).map(([key, value]) => ({ key, type: value.type, overtimeKind: value.overtimeKind ?? '' }));
  Object.keys(manualPeople).forEach(key => delete manualPeople[key]);
  baseline = serialized(); open.value = true;
  if (type === 'rule' && !isLocalPreview) void loadScopePeople();
}
async function loadScopePeople() {
  scopeLoading.value = true; scopeError.value = ''; scopePeople.value = [];
  const subject = subjectId.value, period = month.value;
  try {
    const people = await payrollApi.employeeScopeCandidates(subject, period);
    if (subject === subjectId.value && period === month.value) scopePeople.value = people;
  } catch (cause) { scopeError.value = await payrollError(cause); }
  finally { scopeLoading.value = false; }
}
function updateEmployeeScope(value: NonNullable<PayrollRuleInput['config']['employeeScope']>) {
  rule.value.config.employeeScope = value;
  delete fields['employeeScope.employeeIds']; delete fields['employeeScope.evidenceRef'];
}
const scopeErrors = computed(() => ({ employeeIds: fields['employeeScope.employeeIds'] ?? '', evidenceRef: fields['employeeScope.evidenceRef'] ?? '' }));
function addMapping() { mappings.value.push(newPerformanceMapping(mappings.value.some(mapping => mapping.month === month.value) ? '' : month.value)); }
function peopleKey(attributionMonth: string) { return `${subjectId.value}:${attributionMonth}`; }
async function loadManualPeople(attributionMonth: string, retry = false) {
  if (!subjectId.value || !/^\d{4}-(0[1-9]|1[0-2])$/.test(attributionMonth)) return;
  const key = peopleKey(attributionMonth);
  if (!retry && manualPeople[key]) return;
  const state = reactive({ employees: [] as PayrollEmployee[], loading: true, error: '' });
  manualPeople[key] = state;
  try { state.employees = await payrollApi.employees(subjectId.value, attributionMonth); }
  catch (cause) { state.error = await payrollError(cause); }
  finally { state.loading = false; }
}
watch(() => [subjectId.value, ...mappings.value.filter(mapping => mapping.sourceKind === 'manual').map(mapping => mapping.month)], () => {
  for (const mapping of mappings.value) if (mapping.sourceKind === 'manual') void loadManualPeople(mapping.month);
});
function mappingErrors(index: number) {
  const prefix = `performance.${index}.`;
  return Object.fromEntries(Object.entries(fields).filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key.slice(prefix.length), value]));
}
function clearMappingErrors(index: number) {
  Object.keys(fields).filter(key => key.startsWith(`performance.${index}.`)).forEach(key => delete fields[key]);
}
function updateMapping(index: number, value: PayrollPerformanceMapping) {
  mappings.value[index] = { ...value, month: mappings.value[index]!.month };
  clearMappingErrors(index);
}
function removeMapping(index: number) {
  mappings.value.splice(index, 1);
  Object.keys(fields).filter(key => key.startsWith('performance.')).forEach(key => delete fields[key]);
}
async function save() {
  Object.keys(fields).forEach(key => delete fields[key]); formError.value = '';
  const value = kind.value === 'standard' ? standard.value : rule.value;
  if (!value.effectiveFrom) fields.effectiveFrom = '请选择生效日期';
  if (value.effectiveTo && value.effectiveTo < value.effectiveFrom) fields.effectiveTo = '结束日期不能早于生效日期';
  if (kind.value === 'standard') {
    if (!standard.value.employeeId) fields.employeeId = '请选择员工';
    if (!standard.value.evidence.trim()) fields.evidence = '请填写确认依据';
    for (const key of ['fixedMonthly', 'performanceBase'] as const) {
      const amount = standard.value[key];
      if (amount && !isDecimal(amount)) fields[key] = '请填写非负十进制金额';
    }
  } else {
    const config = rule.value.config;
    const classification = attendanceMappingPayload(attendanceMappings.value);
    for (const [key, message] of Object.entries(classification.errors)) fields[`attendanceMappings.${key}`] = message;
    config.attendanceMappings = classification.value;
    if (!isLocalPreview) {
      if (scopeLoading.value || scopeError.value) fields['employeeScope.employeeIds'] = '请先完成发薪人员读取与核对';
      else for (const [key, message] of Object.entries(employeeScopeErrors(config.employeeScope, scopePeople.value.map(person => person.id)))) fields[`employeeScope.${key}`] = message;
    }
    if (config.fixedSalaryBasis === 'monthly_workdays') {
      const calendar = config.workCalendars?.[month.value];
      if (!calendar?.sourceVersion.trim() || !calendar.evidenceRef.trim() || !calendar.days.some(day => Number(day.units) > 0)) {
        fields.calendar = '请填写日历版本、确认依据并选择应出勤日期';
      }
    }
    if (config.monthlyUnits[month.value] && !isDecimal(config.monthlyUnits[month.value])) fields.monthlyUnits = '请填写非负十进制计薪单位';
    const values = [config.normalHourly, ...Object.values(config.paidHourly), ...Object.values(config.overtime), ...Object.values(config.monthlyUnits)];
    if (values.some(value => value && !isDecimal(value))) formError.value = '计价参数应为非负十进制数，未确认项请留空';
    const seen = new Set<string>();
    for (const [index, mapping] of mappings.value.entries()) {
      const prefix = `performance.${index}.`;
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mapping.month) || seen.has(mapping.month)) fields[`${prefix}month`] = '请选择不重复的绩效归属月';
      seen.add(mapping.month);
      if (mapping.sourceKind === 'manual') {
        const people = manualPeople[peopleKey(mapping.month)];
        if (!people || people.loading || people.error) fields[`${prefix}people`] = '请先完成本月人员核对，读取失败时可重新读取';
        for (const [key, message] of Object.entries(manualPerformanceErrors(mapping, people?.employees.map(person => person.id) ?? []))) fields[`${prefix}${key}`] = message;
        continue;
      }
      if (Object.values(mapping.coefficients).some(value => value && !isDecimal(value))) fields[`${prefix}coefficients`] = '绩效系数应为非负十进制数';
      if (config.fixedSalaryBasis === 'monthly_workdays') {
        if (!mapping.coefficientVersion?.trim()) fields[`${prefix}coefficientVersion`] = '请填写统一系数表版本';
        if (!mapping.evidenceRef?.trim()) fields[`${prefix}evidenceRef`] = '请填写系数确认依据';
        if (mapping.cycleIds.length !== 1 || !cycles.value.some(cycle => cycle.id === mapping.cycleIds[0] && cycle.type === 'monthly'
          && cycle.startDate?.slice(0, 7) === mapping.month && cycle.endDate?.slice(0, 7) === mapping.month)) fields[`${prefix}cycleIds`] = '请选择该归属月唯一的月度考核周期';
      }
    }
  }
  if (Object.keys(fields).length || formError.value) return;
  busy.value = true;
  try {
    if (kind.value === 'standard') {
      const s = standard.value;
      await payrollApi.createStandard({ subjectId: subjectId.value, employeeId: s.employeeId, effectiveFrom: s.effectiveFrom, effectiveTo: s.effectiveTo || undefined, fixedMonthly: s.fixedMonthly || null, performanceBase: s.performanceBase || null, performanceMode: s.performanceMode || null, evidence: s.evidence.trim() });
    } else {
      const r = rule.value, config = clone(r.config);
      config.normalHourly ||= null; config.cutoverMonth ||= null; config.rounding ||= null;
      config.monthlyUnits = Object.fromEntries(Object.entries(config.monthlyUnits).filter(([, value]) => value !== ''));
      if (config.fixedSalaryBasis === 'monthly_workdays' && config.workCalendars?.[month.value]) {
        config.monthlyUnits[month.value] = String(config.workCalendars[month.value]!.days.reduce((sum, day) => sum + Math.round(Number(day.units) * 10000), 0) / 10000);
      }
      config.paidHourly = Object.fromEntries(Object.entries(config.paidHourly).filter(([, value]) => value !== ''));
      for (const key of ['hourlyBase', 'weekday', 'restday', 'holiday'] as const) config.overtime[key] ||= null;
      config.performance = performanceMappingsPayload(mappings.value);
      await payrollApi.createRule({ subjectId: subjectId.value, effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo || undefined, config });
    }
    open.value = false; await load();
  } catch (cause) { formError.value = await payrollError(cause); }
  finally { busy.value = false; }
}
async function submit(type: 'standard' | 'rule', value: unknown) {
  const row = value as PayrollStandard | PayrollRule;
  busy.value = true; error.value = '';
  let submitted = false;
  try {
    await payrollApi.submitParameter(type, row.id, row.version); submitted = true;
  }
  catch (cause) { error.value = await payrollError(cause); }
  finally { busy.value = false; }
  if (submitted) await router.push({ path: '/payroll/parameter-reviews', query: { subjectId: subjectId.value, month: month.value } });
}
</script>
<template>
  <BusinessListPage variant="record" :loading="loading">
    <template #filters>
      <PayrollScope v-model:subject="subjectId" v-model:month="month" :subjects="subjects" :disabled="busy || open" @refresh="refresh">
        <el-button v-if="has('payroll_edit')" type="primary" :icon="Plus" :disabled="loading || open || busy" @click="edit(tab === 'standards' ? 'standard' : 'rule')">{{ tab === 'standards' ? '新增工资标准' : '新增规则' }}</el-button>
      </PayrollScope>
      <el-tabs v-model="tab"><el-tab-pane label="工资标准" name="standards" /><el-tab-pane label="工资规则" name="rules" /></el-tabs>
    </template>
    <template #feedback><el-alert v-if="error" :title="error" type="error" :closable="false" /></template>
    <template #desktop-list>
      <el-table :data="rows" height="100%" empty-text="尚未配置">
        <el-table-column v-if="tab === 'standards'" label="员工" min-width="140"><template #default="{ row }">{{ employeeName(row.employeeId) }}</template></el-table-column>
        <el-table-column prop="version" label="版本" width="70" /><el-table-column label="状态" width="120"><template #default="{ row }">{{ parameterStatus(row.status) }}</template></el-table-column>
        <el-table-column label="生效日期" min-width="120"><template #default="{ row }">{{ row.effectiveFrom.slice(0, 10) }}</template></el-table-column><el-table-column label="结束日期" min-width="120"><template #default="{ row }">{{ row.effectiveTo?.slice(0, 10) || '长期' }}</template></el-table-column>
        <el-table-column v-if="tab === 'standards'" label="月标准" min-width="120"><template #default="{ row }">{{ row.fixedMonthly ?? '待配置' }}</template></el-table-column>
        <el-table-column label="操作" min-width="250" fixed="right"><template #default="{ row }">
          <el-button link type="primary" @click="showHistory(row)">版本依据</el-button>
          <el-button v-if="has('payroll_edit')" link type="primary" :disabled="busy" @click="edit(tab === 'standards' ? 'standard' : 'rule', row)">复制草稿</el-button>
          <el-button v-if="has('payroll_edit') && ['draft', 'returned'].includes(row.status)" link type="primary" :disabled="busy" @click="submit(tab === 'standards' ? 'standard' : 'rule', row)">提交主管审核</el-button>
        </template></el-table-column>
      </el-table>
    </template>
    <template #mobile-list>
      <MobileResultCard v-for="row in (tab === 'standards' ? standards : rules)" :key="row.id"><template #title>{{ 'employeeId' in row ? employeeName(row.employeeId) : '工资规则' }} · V{{ row.version }}</template><template #status>{{ parameterStatus(row.status) }}</template><div>{{ row.effectiveFrom.slice(0, 10) }} 至 {{ row.effectiveTo?.slice(0, 10) || '长期' }}</div><div v-if="'fixedMonthly' in row">月标准：{{ row.fixedMonthly ?? '待配置' }}</div><template #actions>
        <el-button link type="primary" @click="history = row">版本依据</el-button>
        <el-button v-if="has('payroll_edit')" link type="primary" :disabled="busy" @click="edit(tab === 'standards' ? 'standard' : 'rule', row)">复制草稿</el-button>
        <el-button v-if="has('payroll_edit') && ['draft', 'returned'].includes(row.status)" link type="primary" :disabled="busy" @click="submit(tab === 'standards' ? 'standard' : 'rule', row)">提交主管审核</el-button>
      </template></MobileResultCard>
      <el-empty v-if="!(tab === 'standards' ? standards : rules).length" description="尚未配置" />
    </template>
    <template #detail>
      <BusinessDetailDrawer :model-value="open" :title="kind === 'standard' ? '工资标准草稿' : '工资规则草稿'" variant="wide" :saving="busy" :before-close="beforeCloseForm" @update:model-value="closeForm">
        <el-form label-position="top">
          <div class="form-grid">
            <el-form-item label="生效日期" :error="fields.effectiveFrom"><el-date-picker v-if="kind === 'standard'" v-model="standard.effectiveFrom" type="date" value-format="YYYY-MM-DD" /><el-date-picker v-else v-model="rule.effectiveFrom" type="date" value-format="YYYY-MM-DD" /></el-form-item>
            <el-form-item label="结束日期" :error="fields.effectiveTo"><el-date-picker v-if="kind === 'standard'" v-model="standard.effectiveTo" type="date" value-format="YYYY-MM-DD" clearable /><el-date-picker v-else v-model="rule.effectiveTo" type="date" value-format="YYYY-MM-DD" clearable /></el-form-item>
          </div>
          <template v-if="kind === 'standard'">
            <el-form-item label="员工" :error="fields.employeeId"><el-select v-model="standard.employeeId" filterable><el-option v-for="person in employees" :key="person.id" :value="person.id" :label="`${person.name} ${person.employeeNo}`" /></el-select></el-form-item>
            <div class="form-grid"><el-form-item label="固定月标准" :error="fields.fixedMonthly"><el-input v-model="standard.fixedMonthly" inputmode="decimal" placeholder="未确认" /></el-form-item><el-form-item label="个人绩效基数（自动关联时使用）" :error="fields.performanceBase"><el-input v-model="standard.performanceBase" inputmode="decimal" placeholder="人工填写绩效金额时可留空" /></el-form-item></div>
            <el-form-item label="绩效工资结构"><el-select v-model="standard.performanceMode" clearable><el-option v-if="standard.performanceMode === 'included'" label="含薪（历史配置）" value="included" /><el-option label="另计" value="additional" /><el-option label="不适用" value="none" /></el-select></el-form-item>
            <el-form-item label="确认依据" :error="fields.evidence"><el-input v-model="standard.evidence" type="textarea" :rows="3" maxlength="500" /></el-form-item>
          </template>
          <template v-else>
            <PayrollEmployeeScopeEditor v-if="!isLocalPreview" :model-value="rule.config.employeeScope" :employees="scopePeople" :loading="scopeLoading" :load-error="scopeError" :errors="scopeErrors" @retry="loadScopePeople" @update:model-value="updateEmployeeScope" />
            <h3>计薪参数</h3>
            <el-form-item label="固定工资折算"><el-select v-model="rule.config.fixedSalaryBasis"><el-option label="按当月应出勤工作日" value="monthly_workdays" /></el-select></el-form-item>
            <PayrollWorkCalendarEditor v-if="rule.config.fixedSalaryBasis === 'monthly_workdays'" v-model="rule.config.workCalendars![month]" :month="month" :error="fields.calendar" @update:model-value="fields.calendar = ''" />
            <div class="form-grid"><el-form-item v-if="rule.config.fixedSalaryBasis !== 'monthly_workdays'" :label="`${month} 计薪单位`" :error="fields.monthlyUnits"><el-input v-model="rule.config.monthlyUnits[month]" inputmode="decimal" placeholder="未确认" /></el-form-item><el-form-item label="舍入规则"><el-select v-model="rule.config.rounding" clearable><el-option label="按员工工资项汇总后四舍五入到分" value="item_half_up" /></el-select></el-form-item><el-form-item label="正常计薪小时单价"><el-input v-model="rule.config.normalHourly" inputmode="decimal" placeholder="未确认" /></el-form-item><el-form-item label="正式启用归属月切点"><el-date-picker v-model="rule.config.cutoverMonth" type="month" value-format="YYYY-MM" clearable /></el-form-item></div>
            <h3>假勤小时待遇</h3><div class="form-grid"><el-form-item label="事假"><el-input v-model="rule.config.paidHourly.unpaid_leave" inputmode="decimal" placeholder="未确认" /></el-form-item><el-form-item label="病假"><el-input v-model="rule.config.paidHourly.sick_leave" inputmode="decimal" placeholder="未确认" /></el-form-item><el-form-item label="确认旷工"><el-input v-model="rule.config.paidHourly.absence" inputmode="decimal" placeholder="未确认" /></el-form-item></div>
            <PayrollAttendanceMappingsEditor v-model="attendanceMappings" :errors="attendanceMappingErrors" />
            <h3>加班</h3><div class="form-grid"><el-form-item label="小时基数"><el-input v-model="rule.config.overtime.hourlyBase" inputmode="decimal" placeholder="未确认" /></el-form-item><el-form-item label="工作日倍率"><el-input v-model="rule.config.overtime.weekday" inputmode="decimal" placeholder="未确认" /></el-form-item><el-form-item label="休息日倍率"><el-input v-model="rule.config.overtime.restday" inputmode="decimal" placeholder="未确认" /></el-form-item><el-form-item label="节假日倍率"><el-input v-model="rule.config.overtime.holiday" inputmode="decimal" placeholder="未确认" /></el-form-item></div>
            <h3>复核与审批</h3><div class="form-grid"><el-form-item label="复核人（按选择顺序）"><el-select v-model="rule.config.reviewers" multiple filterable><el-option v-for="person in reviewerOptions" :key="person.id" :value="person.id" :label="person.name" /></el-select></el-form-item><el-form-item label="审批人（按选择顺序）"><el-select v-model="rule.config.approvers" multiple filterable><el-option v-for="person in approverOptions" :key="person.id" :value="person.id" :label="person.name" /></el-select></el-form-item></div>
            <h3>个人绩效归属</h3>
            <section v-for="(mapping, index) in mappings" :key="index" class="mapping-row">
              <div class="form-grid"><el-form-item label="归属月" :error="fields[`performance.${index}.month`]"><el-date-picker v-model="mapping.month" type="month" value-format="YYYY-MM" @update:model-value="clearMappingErrors(index)" /></el-form-item><el-form-item label="来源类型"><el-select v-model="mapping.sourceKind" clearable @update:model-value="clearMappingErrors(index)"><el-option label="HR填写金额" value="manual" /><el-option label="正式公示结果" value="official" /><el-option label="虚构验收来源" value="fictional" /></el-select></el-form-item></div>
              <PayrollManualPerformanceEditor v-if="mapping.sourceKind === 'manual'" :model-value="mapping" :month="mapping.month"
                :employees="manualPeople[peopleKey(mapping.month)]?.employees ?? []" :loading="manualPeople[peopleKey(mapping.month)]?.loading"
                :load-error="manualPeople[peopleKey(mapping.month)]?.error" :errors="mappingErrors(index)"
                @retry="loadManualPeople(mapping.month, true)" @update:model-value="updateMapping(index, $event)" />
              <template v-else>
                <el-form-item label="绩效周期" :error="fields[`performance.${index}.cycleIds`]"><el-select v-model="mapping.cycleIds" multiple filterable><el-option v-for="cycle in cycles" :key="cycle.id" :value="cycle.id" :label="cycle.name" :disabled="rule.config.fixedSalaryBasis === 'monthly_workdays' && (cycle.type !== 'monthly' || cycle.startDate?.slice(0, 7) !== mapping.month || cycle.endDate?.slice(0, 7) !== mapping.month)" /></el-select></el-form-item>
                <div class="form-grid"><el-form-item label="统一系数表版本" :error="fields[`performance.${index}.coefficientVersion`]"><el-input v-model="mapping.coefficientVersion" maxlength="200" /></el-form-item><el-form-item label="系数确认依据" :error="fields[`performance.${index}.evidenceRef`]"><el-input v-model="mapping.evidenceRef" maxlength="200" /></el-form-item></div>
                <div class="coefficient-grid"><el-form-item v-for="grade in (['A','B','C','D'] as const)" :key="grade" :label="`${grade} 等系数`" :error="fields[`performance.${index}.coefficients`]"><el-input v-model="mapping.coefficients[grade]" inputmode="decimal" placeholder="未确认" /></el-form-item></div>
              </template>
              <div class="mapping-actions"><el-tooltip content="删除归属月"><el-button :icon="Delete" aria-label="删除归属月" @click="removeMapping(index)" /></el-tooltip></div>
            </section>
            <el-button :icon="Plus" @click="addMapping">添加绩效归属月</el-button>
          </template>
          <el-alert v-if="formError" :title="formError" type="error" :closable="false" class="form-feedback" />
        </el-form>
        <template #footer><el-button :disabled="busy" @click="closeForm(false)">取消</el-button><el-button type="primary" :loading="busy" @click="save">保存草稿</el-button></template>
      </BusinessDetailDrawer>
      <BusinessDetailDrawer :model-value="!!history" title="版本依据" @update:model-value="history = undefined"><pre>{{ JSON.stringify(history, null, 2) }}</pre></BusinessDetailDrawer>
    </template>
  </BusinessListPage>
</template>
<style scoped>
.form-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 0 16px; }
.coefficient-grid { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 12px; align-items: center; }
.mapping-actions { display: flex; justify-content: flex-end; margin-bottom: 14px; }
.form-grid :deep(.el-date-editor), .form-grid :deep(.el-select) { width: 100%; }
h3 { font-size: 15px; margin: 22px 0 14px; }
.mapping-row { border-top: 1px solid var(--el-border-color-lighter); padding-top: 14px; }
.form-feedback { margin-top: 16px; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; }
@media(max-width:768px) { .form-grid { grid-template-columns: minmax(0,1fr); } .coefficient-grid { grid-template-columns: repeat(2,minmax(0,1fr)); } }
</style>
