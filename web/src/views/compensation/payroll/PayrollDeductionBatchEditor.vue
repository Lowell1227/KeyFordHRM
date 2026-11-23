<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import { ElMessageBox } from 'element-plus';
import { ArrowLeft, ArrowRight, Check, DocumentCopy } from '@element-plus/icons-vue';
import BusinessDetailDrawer from '@/components/common/business-list/BusinessDetailDrawer.vue';
import MobileResultCard from '@/components/common/MobileResultCard.vue';
import PayrollDeductionSettingsForm from './PayrollDeductionSettingsForm.vue';
import { payrollApi, payrollError } from '@/api/payroll.api';
import type { PayrollDeductionProfile, PayrollDeductionProfileInput, PayrollEmployee } from '@/types/payroll.types';
import { emptyDeductionSettings, applyApprovedDeductionRules, deductionDraftErrors, deductionErrorStep, deductionAmountColumns, deductionAmountValue, withDeductionAmount, pasteDeductionAmounts, saveDeductionDrafts, validDeductionDate, type DeductionAmountGroup, type DeductionSaveResult } from './payroll-deduction-form';

const props = defineProps<{ modelValue: boolean; subjectId: string; month: string; employees: PayrollEmployee[]; profiles: PayrollDeductionProfile[] }>();
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; changed: []; busy: [value: boolean] }>();
const phase = ref<'people' | 'entry' | 'preview' | 'result'>('people'), busy = ref(false), error = ref('');
const chosen = ref<string[]>([]), drafts = ref<PayrollDeductionProfileInput[]>([]), results = ref<DeductionSaveResult[]>([]);
const preparation = reactive({ payDate: '', socialDate: '', housingDate: '', ledgerDate: '', sourceId: '', ruleEvidence: '' });
const preparationErrors = ref<Record<string, string>>({}), rowErrors = ref<Record<string, string>[]>([]);
const group = ref<DeductionAmountGroup>('contributions'), paste = ref(''), pasteOpen = ref(false), pasteErrors = ref<string[]>([]);
const activeIndex = ref(-1), activeDraft = ref<PayrollDeductionProfileInput>(), rowSection = ref<'contributions' | 'tax'>('contributions'), rowRoot = ref<HTMLElement>();
let rowBaseline = '';
const sources = computed(() => props.profiles.filter(row => row.subjectId === props.subjectId && row.status === 'active'));
const columns = computed(() => deductionAmountColumns(drafts.value, group.value));
const columnHelp = computed(() => ['工号', ...columns.value.map(column => column.label)].join('\t'));
const activeErrors = computed(() => rowErrors.value[activeIndex.value] ?? {});
const rowReadonly = computed(() => phase.value === 'preview' || phase.value === 'result');
const issueCount = computed(() => rowErrors.value.reduce((total, fields) => total + Object.keys(fields).length, 0));
const outcomeLabels = { not_sent: '未发送', saving: '正在保存', saved: '已保存草稿', failed: '保存失败', unknown: '结果待核实' };
const groupOptions = [{ value: 'contributions', label: '个人缴费基数' }, { value: 'opening', label: '累计期初' }, { value: 'ledger', label: '接管前已扣' }, { value: 'current', label: '本月扣除' }];
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const employee = (id: string) => props.employees.find(person => person.id === id);
const name = (id: string) => { const person = employee(id); return person ? `${person.name} ${person.employeeNo}` : '本月人员信息已变化'; };
function issueSummary(index: number) {
  const keys = Object.keys(rowErrors.value[index] ?? {});
  return [{ value: 'identity', label: '人员与日期' }, { value: 'contributions', label: '个人缴费' }, { value: 'tax', label: '个税与累计' }]
    .map(group => ({ ...group, count: keys.filter(key => deductionErrorStep(key) === group.value).length }))
    .filter(group => group.count).map(group => `${group.label}${group.count}项`).join('，');
}
watch(busy, value => emit('busy', value), { flush: 'sync' });
watch(() => props.modelValue, value => {
  if (!value) return;
  phase.value = 'people'; chosen.value = []; drafts.value = []; results.value = []; rowErrors.value = []; error.value = ''; paste.value = ''; pasteErrors.value = []; activeDraft.value = undefined; activeIndex.value = -1;
  preparationErrors.value = {}; Object.assign(preparation, { payDate: '', socialDate: '', housingDate: '', ledgerDate: '', sourceId: '', ruleEvidence: '' });
});
async function mayClose() {
  if (!props.modelValue) return true;
  if (busy.value) return false;
  if (phase.value === 'result') {
    if (!results.value.some(row => row.status === 'unknown')) return true;
    try { await ElMessageBox.confirm('有保存结果待核实的人员。关闭后先按员工和发薪日核对列表，不要重复创建。', '核对保存结果', { confirmButtonText: '返回列表核对', cancelButtonText: '留在此页' }); return true; } catch { return false; }
  }
  if (!drafts.value.length && !chosen.value.length && !Object.values(preparation).some(Boolean)) return true;
  try { await ElMessageBox.confirm('放弃尚未保存的扣缴草稿？', '离开批量准备', { confirmButtonText: '放弃修改', cancelButtonText: '继续填写' }); return true; } catch { return false; }
}
onBeforeRouteLeave(mayClose); onBeforeRouteUpdate(mayClose);
async function close(value: boolean) { if (!value && await mayClose()) { activeDraft.value = undefined; if (phase.value === 'result') emit('changed'); emit('update:modelValue', false); } }
function prepare() {
  preparationErrors.value = {};
  if (!chosen.value.length) preparationErrors.value.people = '请选择本主体本月已核定的人员';
  if (!validDeductionDate(preparation.payDate)) preparationErrors.value.payDate = '请选择目标发薪日';
  for (const key of ['socialDate', 'housingDate', 'ledgerDate'] as const) if (preparation[key] && !validDeductionDate(preparation[key])) preparationErrors.value[key] = '请选择有效日期';
  if (chosen.value.some(id => !employee(id))) preparationErrors.value.people = '人员范围已变化，请重新选择';
  if (Object.keys(preparationErrors.value).length) return;
  const source = sources.value.find(row => row.id === preparation.sourceId);
  drafts.value = chosen.value.map(employeeId => {
    let settings = emptyDeductionSettings();
    if (source) settings = applyApprovedDeductionRules(settings, source, props.subjectId);
    settings.socialInsurance.contributionDate = preparation.socialDate;
    settings.housingFund.contributionDate = preparation.housingDate;
    settings.ledger!.startDate = preparation.ledgerDate;
    if (preparation.ruleEvidence.trim()) {
      settings.socialInsurance.evidenceRef = preparation.ruleEvidence.trim(); settings.housingFund.evidenceRef = preparation.ruleEvidence.trim(); settings.tax.evidenceRef = preparation.ruleEvidence.trim();
    }
    return { subjectId: props.subjectId, employeeId, payDate: preparation.payDate, settings };
  });
  rowErrors.value = drafts.value.map(() => ({})); phase.value = 'entry';
}
function cell(index: number, key: string, value: string) {
  try { drafts.value[index]!.settings = withDeductionAmount(drafts.value[index]!.settings, key, value); rowErrors.value[index] = {}; }
  catch (cause) { error.value = (cause as Error).message; }
}
function applyPaste() {
  const parsed = pasteDeductionAmounts(drafts.value, props.employees, paste.value);
  pasteErrors.value = parsed.errors;
  if (!parsed.errors.length) { drafts.value = parsed.drafts; rowErrors.value = drafts.value.map(() => ({})); pasteOpen.value = false; paste.value = ''; }
}
async function editRow(index: number) {
  activeIndex.value = index; activeDraft.value = clone(drafts.value[index]!); rowBaseline = JSON.stringify(activeDraft.value);
  const first = Object.keys(rowErrors.value[index] ?? {})[0];
  rowSection.value = first && deductionErrorStep(first) === 'tax' ? 'tax' : 'contributions';
  await nextTick(); rowRoot.value?.querySelector<HTMLElement>('.el-form-item.is-error')?.scrollIntoView({ block: 'center' });
}
async function closeRow(value: boolean) {
  if (value) return;
  if (!rowReadonly.value && activeDraft.value && JSON.stringify(activeDraft.value) !== rowBaseline) {
    try { await ElMessageBox.confirm('放弃该员工尚未应用的填写？', '离开员工资料', { confirmButtonText: '放弃修改', cancelButtonText: '继续填写' }); } catch { return; }
  }
  activeDraft.value = undefined; activeIndex.value = -1;
}
function keepRow() {
  if (!activeDraft.value || rowReadonly.value) return;
  drafts.value[activeIndex.value] = clone(activeDraft.value);
  rowErrors.value[activeIndex.value] = deductionDraftErrors(activeDraft.value);
  activeDraft.value = undefined; activeIndex.value = -1;
}
function validate(existing = props.profiles) {
  rowErrors.value = drafts.value.map(input => {
    const errors = deductionDraftErrors(input);
    if (!employee(input.employeeId)) errors.employeeId = '本月人员范围已变化，请重新核对';
    if (existing.some(row => row.subjectId === input.subjectId && row.employeeId === input.employeeId && row.payDate.slice(0, 10) === input.payDate)) errors.payDate = '该员工在此发薪日已有资料，请回列表核对原版本';
    return errors;
  });
}
function preview() { validate(); phase.value = 'preview'; error.value = ''; }
async function saveAll() {
  if (busy.value || phase.value !== 'preview' || !drafts.value.length) return;
  busy.value = true; error.value = '';
  try {
    const latest = await payrollApi.deductionProfiles(props.subjectId);
    validate(latest); if (issueCount.value) return;
    phase.value = 'result';
    results.value = await saveDeductionDrafts(clone(drafts.value), input => payrollApi.createDeductionProfile(input), rows => { results.value = rows; });
    emit('changed');
  } catch (cause) { error.value = await payrollError(cause); }
  finally { busy.value = false; }
}
</script>
<template>
  <BusinessDetailDrawer :model-value="modelValue" title="批量准备扣缴草稿" variant="wide" :saving="busy" :before-close="() => close(false)" @update:model-value="close">
    <div class="batch-editor">
      <h3>{{ month }} · {{ { people: '准备人员与日期', entry: '填写个人金额', preview: '保存前核对', result: '保存结果' }[phase] }}</h3>
      <el-alert v-if="error" :title="error" type="error" :closable="false" />
      <el-form v-if="phase === 'people'" label-position="top">
        <el-form-item label="目标发薪日" :error="preparationErrors.payDate"><el-date-picker v-model="preparation.payDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
        <el-form-item label="本月发薪人员" :error="preparationErrors.people"><el-select v-model="chosen" multiple filterable fit-input-width><el-option v-for="person in employees" :key="person.id" :value="person.id" :label="`${person.name} ${person.employeeNo}`" /></el-select></el-form-item>
        <el-form-item><el-checkbox :model-value="!!employees.length && chosen.length === employees.length" @update:model-value="chosen = $event ? employees.map(person => person.id) : []">选择本月全部已核定人员</el-checkbox></el-form-item>
        <el-form-item label="已批准公共规则（可选）"><el-select v-model="preparation.sourceId" filterable clearable><el-option v-for="source in sources" :key="source.id" :value="source.id" :label="`${source.settings.tax.ruleVersion} · ${source.payDate.slice(0, 10)} · V${source.version}`" /></el-select></el-form-item>
        <el-form-item label="本次规则确认依据（可选，同一依据适用于所选人员）"><el-input v-model="preparation.ruleEvidence" maxlength="200" /></el-form-item>
        <div class="date-grid"><el-form-item label="社保缴费归属日（可选）" :error="preparationErrors.socialDate"><el-date-picker v-model="preparation.socialDate" type="date" value-format="YYYY-MM-DD" /></el-form-item><el-form-item label="公积金缴费归属日（可选）" :error="preparationErrors.housingDate"><el-date-picker v-model="preparation.housingDate" type="date" value-format="YYYY-MM-DD" /></el-form-item><el-form-item label="台账基准日（可选，须逐人核对）" :error="preparationErrors.ledgerDate"><el-date-picker v-model="preparation.ledgerDate" type="date" value-format="YYYY-MM-DD" /></el-form-item></div>
      </el-form>
      <template v-else-if="phase === 'entry'">
        <div class="entry-toolbar"><el-select v-model="group" aria-label="金额分组"><el-option v-for="item in groupOptions" :key="item.value" :value="item.value" :label="item.label" /></el-select><el-button :icon="DocumentCopy" @click="pasteOpen = !pasteOpen">从表格粘贴金额</el-button></div>
        <section v-if="pasteOpen" class="paste-panel"><label for="deduction-paste">工号及金额</label><pre>{{ columnHelp }}</pre><el-input id="deduction-paste" v-model="paste" type="textarea" :rows="5" /><ul v-if="pasteErrors.length" role="alert"><li v-for="message in pasteErrors" :key="message">{{ message }}</li></ul><el-button @click="applyPaste">校验并填入</el-button></section>
        <div class="batch-desktop"><el-table :data="drafts" row-key="employeeId" max-height="480"><el-table-column label="员工" width="180" fixed><template #default="{ row }">{{ name(row.employeeId) }}</template></el-table-column><el-table-column v-for="column in columns" :key="column.key" :label="column.label" min-width="160"><template #default="{ row, $index }"><el-input :model-value="deductionAmountValue(row.settings, column.key)" inputmode="decimal" :aria-label="`${name(row.employeeId)} ${column.label}`" placeholder="待核对" @update:model-value="cell($index, column.key, $event)" /></template></el-table-column><el-table-column label="其他资料" width="130" fixed="right"><template #default="{ $index }"><el-button link type="primary" @click="editRow($index)">逐人补齐资料</el-button></template></el-table-column></el-table></div>
        <div class="batch-mobile"><MobileResultCard v-for="(draft, index) in drafts" :key="draft.employeeId"><template #title>{{ name(draft.employeeId) }}</template><div>发薪日：{{ draft.payDate }}</div><div>累计期初：{{ draft.settings.tax.opening.confirmed ? '已核对' : '待逐人核对' }}</div><template #actions><el-button link type="primary" @click="editRow(index)">填写个人资料</el-button></template></MobileResultCard></div>
        <p class="batch-note">{{ drafts.length }}人 · 金额留空为待核对。个人适用性、期初依据和确认须逐人补齐。</p>
      </template>
      <template v-else>
        <el-alert v-if="phase === 'preview'" :type="issueCount ? 'warning' : 'info'" :title="issueCount ? `仍有${issueCount}项待核对，尚未保存` : `${drafts.length}人资料校验通过，保存后仍须提交主管审核`" :closable="false" />
        <el-alert v-if="phase === 'result' && results.some(row => row.status === 'unknown')" title="部分保存结果待核实；后续人员未再发送，请先回列表核对。" type="warning" :closable="false" />
        <div class="preview-rows"><section v-for="(draft, index) in drafts" :key="draft.employeeId" class="preview-row"><strong>{{ name(draft.employeeId) }}</strong><span>发薪日：{{ draft.payDate }}</span><span>个税规则：{{ draft.settings.tax.ruleVersion || '待配置' }}</span><span>累计收入：{{ draft.settings.tax.opening.income || '待核对' }} · 已扣个税：{{ draft.settings.tax.opening.taxPaid || '待核对' }}</span><template v-if="phase === 'result'"><strong>{{ outcomeLabels[results[index]?.status ?? 'not_sent'] }}</strong><span>{{ results[index]?.message ?? '尚未发送' }}</span></template><template v-else><span>{{ issueSummary(index) || '资料已校验' }}</span></template><el-button link type="primary" @click="editRow(index)">查看本次资料</el-button></section></div>
      </template>
    </div>
    <template #footer><el-button :disabled="busy" @click="close(false)">{{ phase === 'result' ? '返回列表核对' : '关闭' }}</el-button><el-button v-if="phase === 'preview'" :icon="ArrowLeft" :disabled="busy" @click="phase = 'entry'">返回修改</el-button><el-button v-if="phase === 'people'" type="primary" :icon="ArrowRight" @click="prepare">准备个人草稿</el-button><el-button v-if="phase === 'entry'" type="primary" :icon="Check" @click="preview">校验并预览</el-button><el-button v-if="phase === 'preview'" type="primary" :disabled="!!issueCount" :loading="busy" @click="saveAll">逐条保存草稿</el-button></template>
    <BusinessDetailDrawer :model-value="!!activeDraft" :title="activeDraft ? name(activeDraft.employeeId) : '个人资料'" variant="wide" :before-close="() => closeRow(false)" @update:model-value="closeRow">
      <div v-if="activeDraft" ref="rowRoot" class="row-editor"><el-form label-position="top" :disabled="rowReadonly"><el-form-item label="目标发薪日" :error="activeErrors.payDate"><el-date-picker v-model="activeDraft.payDate" type="date" value-format="YYYY-MM-DD" /></el-form-item></el-form><el-segmented v-model="rowSection" :options="[{ value: 'contributions', label: '个人缴费' }, { value: 'tax', label: '个税与累计' }]" /><PayrollDeductionSettingsForm v-model="activeDraft.settings" :section="rowSection" :disabled="rowReadonly" :errors="activeErrors" /></div>
      <template #footer><el-button @click="closeRow(false)">关闭</el-button><el-button v-if="!rowReadonly" type="primary" @click="keepRow">应用到本次草稿</el-button></template>
    </BusinessDetailDrawer>
  </BusinessDetailDrawer>
</template>
<style scoped>
.batch-editor, .row-editor { display:grid;gap:14px;min-width:0; }
h3 { font-size:16px;margin:0; }
.date-grid { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 16px; }
.entry-toolbar { display:flex;gap:10px;flex-wrap:wrap; }.entry-toolbar :deep(.el-select) { width:200px; }
.batch-editor :deep(.el-date-editor), .batch-editor :deep(.el-select), .row-editor :deep(.el-date-editor) { max-width:100%; }
.date-grid :deep(.el-date-editor), .batch-editor > .el-form :deep(.el-select) { width:100%; }
.batch-mobile { display:none; }.batch-note { font-size:13px;line-height:1.6;color:var(--el-text-color-secondary); }
.paste-panel { display:grid;gap:10px;min-width:0; }.paste-panel pre { white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;margin:0; }
.paste-panel ul { color:var(--el-color-danger); }
.preview-rows { display:grid;gap:0; }.preview-row { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;padding:16px 0;border-bottom:1px solid var(--el-border-color-light);font-size:14px;overflow-wrap:anywhere; }
.preview-row ul { grid-column:1/-1;margin:0;font-size:13px;color:var(--el-color-danger); }.preview-row .el-button { justify-self:start; }
:deep(.el-form-item__error) { position:static;line-height:1.5;overflow-wrap:anywhere; }
@media(max-width:768px){.batch-desktop{display:none;}.batch-mobile{display:grid;gap:10px;}.date-grid,.preview-row{grid-template-columns:minmax(0,1fr);}}
</style>
