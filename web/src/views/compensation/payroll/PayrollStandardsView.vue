<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { ElMessageBox } from 'element-plus';
import { onBeforeRouteLeave } from 'vue-router';
import { Plus, Delete } from '@element-plus/icons-vue';
import BusinessListPage from '@/components/common/business-list/BusinessListPage.vue';
import BusinessDetailDrawer from '@/components/common/business-list/BusinessDetailDrawer.vue';
import MobileResultCard from '@/components/common/MobileResultCard.vue';
import { payrollApi, payrollError } from '@/api/payroll.api';
import type { PayrollStandard, PayrollStandardInput, PayrollRule, PayrollRuleInput, PayrollEmployee, PayrollOperator, PayrollCycle, PayrollPerformanceMapping } from '@/types/payroll.types';
import PayrollScope from './PayrollScope.vue';
import { usePayrollScope } from './usePayrollScope';
import { isDecimal } from './payroll-state';

const { subjects, subjectId, month, has, error, loading, refreshAccess } = usePayrollScope(['payroll_edit']);
const tab = ref('standards');
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
let baseline = '', sequence = 0;
const reviewerOptions = computed(() => operators.value.filter(person => person.capabilities.includes('payroll_review')));
const approverOptions = computed(() => operators.value.filter(person => person.capabilities.includes('payroll_approve')));
const employeeName = (id: string) => employees.value.find(person => person.id === id)?.name ?? id;
function emptyStandard(): PayrollStandardInput { return { subjectId: '', employeeId: '', effectiveFrom: '', fixedMonthly: null, performanceBase: null, performanceMode: null, evidence: '' }; }
function emptyRule(): PayrollRuleInput { return { subjectId: '', effectiveFrom: '', config: { monthlyUnits: {}, rounding: null, normalHourly: null, paidHourly: {}, overtime: { hourlyBase: null, weekday: null, restday: null, holiday: null }, reviewers: [], approvers: [], cutoverMonth: null, performance: {} } }; }
function serialized() { return JSON.stringify({ standard: standard.value, rule: rule.value, mappings: mappings.value }); }
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
  mappings.value = Object.entries(rule.value.config.performance).map(([key, value]) => ({ ...clone(value), month: key }));
  baseline = serialized(); open.value = true;
}
function addMapping() { mappings.value.push({ month: '', cycleIds: [], coefficients: {}, sourceKind: null }); }
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
    if (config.monthlyUnits[month.value] && !isDecimal(config.monthlyUnits[month.value])) fields.monthlyUnits = '请填写非负十进制计薪单位';
    const values = [config.normalHourly, ...Object.values(config.paidHourly), ...Object.values(config.overtime), ...Object.values(config.monthlyUnits)];
    if (values.some(value => value && !isDecimal(value))) formError.value = '计价参数应为非负十进制数，未确认项请留空';
    const seen = new Set<string>();
    for (const mapping of mappings.value) {
      if (!mapping.month || seen.has(mapping.month)) { formError.value = '绩效归属月不能为空或重复'; break; }
      seen.add(mapping.month);
      if (Object.values(mapping.coefficients).some(value => value && !isDecimal(value))) formError.value = '绩效系数应为非负十进制数';
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
      config.paidHourly = Object.fromEntries(Object.entries(config.paidHourly).filter(([, value]) => value !== ''));
      for (const key of ['hourlyBase', 'weekday', 'restday', 'holiday'] as const) config.overtime[key] ||= null;
      config.performance = Object.fromEntries(mappings.value.map(({ month: key, ...mapping }) => [key, { ...mapping, coefficients: Object.fromEntries(Object.entries(mapping.coefficients).filter(([, value]) => value !== '')) }]));
      await payrollApi.createRule({ subjectId: subjectId.value, effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo || undefined, config });
    }
    open.value = false; await load();
  } catch (cause) { formError.value = await payrollError(cause); }
  finally { busy.value = false; }
}
async function activate(type: 'standard' | 'rule', id: string) {
  try { await ElMessageBox.confirm('启用此版本并保留历史依据？', '启用版本', { confirmButtonText: '启用版本', cancelButtonText: '取消' }); } catch { return; }
  busy.value = true; error.value = '';
  try { if (type === 'standard') await payrollApi.activateStandard(id); else await payrollApi.activateRule(id); await load(); }
  catch (cause) { error.value = await payrollError(cause); }
  finally { busy.value = false; }
}
async function disable(type: 'standard' | 'rule', id: string) {
  try { await ElMessageBox.confirm('停用后，待审工资需重新核对来源；已批准版本不变。', '停用版本', { confirmButtonText: '停用', cancelButtonText: '取消' }); } catch { return; }
  busy.value = true; error.value = '';
  try { if (type === 'standard') await payrollApi.disableStandard(id); else await payrollApi.disableRule(id); await load(); }
  catch (cause) { error.value = await payrollError(cause); }
  finally { busy.value = false; }
}
</script>
<template>
  <BusinessListPage variant="record" :loading="loading">
    <template #filters>
      <PayrollScope v-model:subject="subjectId" v-model:month="month" :subjects="subjects" :disabled="busy || open" @refresh="refresh">
        <el-button v-if="has('payroll_edit')" type="primary" :icon="Plus" :disabled="loading || open" @click="edit(tab === 'standards' ? 'standard' : 'rule')">{{ tab === 'standards' ? '新增工资标准' : '新增规则' }}</el-button>
      </PayrollScope>
      <el-tabs v-model="tab"><el-tab-pane label="工资标准" name="standards" /><el-tab-pane label="工资规则" name="rules" /></el-tabs>
    </template>
    <template #feedback><el-alert v-if="error" :title="error" type="error" :closable="false" /></template>
    <template #desktop-list>
      <el-table :data="rows" height="100%" empty-text="尚未配置">
        <el-table-column v-if="tab === 'standards'" label="员工" min-width="140"><template #default="{ row }">{{ employeeName(row.employeeId) }}</template></el-table-column>
        <el-table-column prop="version" label="版本" width="70" /><el-table-column label="状态" width="100"><template #default="{ row }">{{ row.status === 'active' ? '已启用' : row.status === 'draft' ? '草稿' : '历史' }}</template></el-table-column>
        <el-table-column prop="effectiveFrom" label="生效日期" min-width="120" /><el-table-column prop="effectiveTo" label="结束日期" min-width="120" />
        <el-table-column v-if="tab === 'standards'" label="月标准" min-width="120"><template #default="{ row }">{{ row.fixedMonthly ?? '待配置' }}</template></el-table-column>
        <el-table-column label="操作" min-width="250" fixed="right"><template #default="{ row }">
          <el-button link type="primary" @click="showHistory(row)">版本依据</el-button>
          <el-button v-if="has('payroll_edit')" link type="primary" :disabled="busy" @click="edit(tab === 'standards' ? 'standard' : 'rule', row)">复制草稿</el-button>
          <el-button v-if="has('payroll_edit') && row.status === 'draft'" link type="primary" :disabled="busy" @click="activate(tab === 'standards' ? 'standard' : 'rule', row.id)">启用</el-button>
          <el-button v-if="has('payroll_edit') && row.status === 'active'" link type="danger" :disabled="busy" @click="disable(tab === 'standards' ? 'standard' : 'rule', row.id)">停用</el-button>
        </template></el-table-column>
      </el-table>
    </template>
    <template #mobile-list>
      <MobileResultCard v-for="row in (tab === 'standards' ? standards : rules)" :key="row.id"><template #title>{{ 'employeeId' in row ? employeeName(row.employeeId) : '工资规则' }} · V{{ row.version }}</template><template #status>{{ row.status === 'active' ? '已启用' : row.status === 'draft' ? '草稿' : '历史' }}</template><div>{{ row.effectiveFrom }} 至 {{ row.effectiveTo || '长期' }}</div><div v-if="'fixedMonthly' in row">月标准：{{ row.fixedMonthly ?? '待配置' }}</div><template #actions>
        <el-button link type="primary" @click="history = row">版本依据</el-button>
        <el-button v-if="has('payroll_edit')" link type="primary" :disabled="busy" @click="edit(tab === 'standards' ? 'standard' : 'rule', row)">复制草稿</el-button>
        <el-button v-if="has('payroll_edit') && row.status === 'draft'" link type="primary" :disabled="busy" @click="activate(tab === 'standards' ? 'standard' : 'rule', row.id)">启用</el-button>
        <el-button v-if="has('payroll_edit') && row.status === 'active'" link type="danger" :disabled="busy" @click="disable(tab === 'standards' ? 'standard' : 'rule', row.id)">停用</el-button>
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
            <div class="form-grid"><el-form-item label="固定月标准" :error="fields.fixedMonthly"><el-input v-model="standard.fixedMonthly" inputmode="decimal" placeholder="未确认" /></el-form-item><el-form-item label="个人绩效基数" :error="fields.performanceBase"><el-input v-model="standard.performanceBase" inputmode="decimal" placeholder="未确认" /></el-form-item></div>
            <el-form-item label="绩效工资结构"><el-select v-model="standard.performanceMode" clearable><el-option label="含薪" value="included" /><el-option label="另计" value="additional" /><el-option label="不适用" value="none" /></el-select></el-form-item>
            <el-form-item label="确认依据" :error="fields.evidence"><el-input v-model="standard.evidence" type="textarea" :rows="3" maxlength="500" /></el-form-item>
          </template>
          <template v-else>
            <h3>计薪参数</h3>
            <div class="form-grid"><el-form-item :label="`${month} 计薪单位`" :error="fields.monthlyUnits"><el-input v-model="rule.config.monthlyUnits[month]" inputmode="decimal" placeholder="未确认" /></el-form-item><el-form-item label="舍入规则"><el-select v-model="rule.config.rounding" clearable><el-option label="按员工工资项汇总后四舍五入到分" value="item_half_up" /></el-select></el-form-item><el-form-item label="正常计薪小时单价"><el-input v-model="rule.config.normalHourly" inputmode="decimal" placeholder="未确认" /></el-form-item><el-form-item label="正式启用归属月切点"><el-date-picker v-model="rule.config.cutoverMonth" type="month" value-format="YYYY-MM" clearable /></el-form-item></div>
            <h3>假勤小时待遇</h3><div class="form-grid"><el-form-item label="事假"><el-input v-model="rule.config.paidHourly.unpaid_leave" inputmode="decimal" placeholder="未确认" /></el-form-item><el-form-item label="病假"><el-input v-model="rule.config.paidHourly.sick_leave" inputmode="decimal" placeholder="未确认" /></el-form-item><el-form-item label="确认旷工"><el-input v-model="rule.config.paidHourly.absence" inputmode="decimal" placeholder="未确认" /></el-form-item></div>
            <h3>加班</h3><div class="form-grid"><el-form-item label="小时基数"><el-input v-model="rule.config.overtime.hourlyBase" inputmode="decimal" placeholder="未确认" /></el-form-item><el-form-item label="工作日倍率"><el-input v-model="rule.config.overtime.weekday" inputmode="decimal" placeholder="未确认" /></el-form-item><el-form-item label="休息日倍率"><el-input v-model="rule.config.overtime.restday" inputmode="decimal" placeholder="未确认" /></el-form-item><el-form-item label="节假日倍率"><el-input v-model="rule.config.overtime.holiday" inputmode="decimal" placeholder="未确认" /></el-form-item></div>
            <h3>复核与审批</h3><div class="form-grid"><el-form-item label="复核人（按选择顺序）"><el-select v-model="rule.config.reviewers" multiple filterable><el-option v-for="person in reviewerOptions" :key="person.id" :value="person.id" :label="person.name" /></el-select></el-form-item><el-form-item label="审批人（按选择顺序）"><el-select v-model="rule.config.approvers" multiple filterable><el-option v-for="person in approverOptions" :key="person.id" :value="person.id" :label="person.name" /></el-select></el-form-item></div>
            <h3>个人绩效归属</h3>
            <section v-for="(mapping, index) in mappings" :key="index" class="mapping-row">
              <div class="form-grid"><el-form-item label="归属月"><el-date-picker v-model="mapping.month" type="month" value-format="YYYY-MM" /></el-form-item><el-form-item label="来源类型"><el-select v-model="mapping.sourceKind" clearable><el-option label="正式公示结果" value="official" /><el-option label="虚构验收来源" value="fictional" /></el-select></el-form-item></div>
              <el-form-item label="绩效周期"><el-select v-model="mapping.cycleIds" multiple filterable><el-option v-for="cycle in cycles" :key="cycle.id" :value="cycle.id" :label="cycle.name" /></el-select></el-form-item>
              <div class="coefficient-grid"><el-form-item v-for="grade in (['A','B','C','D'] as const)" :key="grade" :label="`${grade} 等系数`"><el-input v-model="mapping.coefficients[grade]" inputmode="decimal" placeholder="未确认" /></el-form-item><el-tooltip content="删除归属月"><el-button :icon="Delete" aria-label="删除归属月" @click="mappings.splice(index, 1)" /></el-tooltip></div>
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
.coefficient-grid { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)) 32px; gap: 12px; align-items: center; }
.form-grid :deep(.el-date-editor), .form-grid :deep(.el-select) { width: 100%; }
h3 { font-size: 15px; margin: 22px 0 14px; }
.mapping-row { border-top: 1px solid var(--el-border-color-lighter); padding-top: 14px; }
.form-feedback { margin-top: 16px; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; }
@media(max-width:768px) { .form-grid { grid-template-columns: minmax(0,1fr); } .coefficient-grid { grid-template-columns: repeat(2,minmax(0,1fr)); } }
</style>
