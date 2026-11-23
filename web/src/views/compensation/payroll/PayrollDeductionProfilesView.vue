<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRouter, onBeforeRouteLeave } from 'vue-router';
import { ElMessageBox } from 'element-plus';
import { Plus, ArrowLeft, ArrowRight, DocumentCopy } from '@element-plus/icons-vue';
import BusinessListPage from '@/components/common/business-list/BusinessListPage.vue';
import BusinessDetailDrawer from '@/components/common/business-list/BusinessDetailDrawer.vue';
import MobileResultCard from '@/components/common/MobileResultCard.vue';
import PayrollScope from './PayrollScope.vue';
import PayrollDeductionSettingsForm from './PayrollDeductionSettingsForm.vue';
import PayrollDeductionBatchEditor from './PayrollDeductionBatchEditor.vue';
import { usePayrollScope } from './usePayrollScope';
import { emptyDeductionSettings, deductionDraftErrors, deductionErrorStep, copyDeductionForPayDate, canCarryDeductionOpening, applyApprovedDeductionRules, deductionSaveUncertain, type DeductionStep } from './payroll-deduction-form';
import { payrollApi, payrollError } from '@/api/payroll.api';
import type { PayrollDeductionProfile, PayrollDeductionProfileInput, PayrollEmployee } from '@/types/payroll.types';

const {subjects,subjectId,month,error,loading,refreshAccess} = usePayrollScope(['payroll_edit'], { persistQuery: true });
const router = useRouter(), rows = ref<PayrollDeductionProfile[]>([]), employees = ref<PayrollEmployee[]>([]);
const open = ref(false), readonly = ref(false), busy = ref(false), formError = ref(''), fields = ref<Record<string,string>>({});
const bulkOpen = ref(false), bulkBusy = ref(false), unknownSave = ref(false);
const copySource = ref<PayrollDeductionProfile>(), commonSourceId = ref(''), carryReference = ref(''), copyDate = ref('');
const payDateConfirmed = ref(false), step = ref<DeductionStep>('identity'), editorRoot = ref<HTMLElement>();
const viewedEmployee = ref('');
const approvedSources = computed(() => rows.value.filter(row => row.subjectId === subjectId.value && row.status === 'active'));
const mayCarry = computed(() => !!copySource.value && canCarryDeductionOpening(copySource.value, form.value.payDate));
const steps: Array<{ value: DeductionStep; label: string }> = [{ value: 'identity', label: '人员与发薪日' }, { value: 'contributions', label: '个人缴费' }, { value: 'tax', label: '个税与累计' }];
const stepOptions = computed(() => steps.map(item => { const count = Object.keys(fields.value).filter(key => deductionErrorStep(key) === item.value).length; return { value: item.value, label: count ? `${item.label} · ${count}` : item.label }; }));
const blank = (): PayrollDeductionProfileInput => ({subjectId:subjectId.value,employeeId:'',payDate:'',settings:emptyDeductionSettings()});
const form = ref(blank()); let baseline = '', sequence = 0;
const status = (value: string) => ({draft:'草稿',pending:'待主管审核',returned:'已退回',active:'已发布'}[value] ?? value);
async function load() {
  const request = ++sequence; if (!subjectId.value) { rows.value = []; employees.value = []; return; }
  loading.value = true; error.value = '';
  try {
    const values = await Promise.all([payrollApi.deductionProfiles(subjectId.value), payrollApi.employees(subjectId.value,month.value)]);
    if (request === sequence) [rows.value,employees.value] = values;
  } catch (cause) {if(request === sequence) error.value = await payrollError(cause);}
  finally {if(request === sequence) loading.value = false;}
}
async function refresh() {const before=subjectId.value;await refreshAccess();if(before===subjectId.value)await load();}
watch([subjectId,month],()=>{if(!open.value) void load();}); onMounted(refresh);
function edit(value?: unknown, viewOnly=false) {
  const row = value as PayrollDeductionProfile | undefined;
  copySource.value = !viewOnly ? row : undefined;
  viewedEmployee.value = row ? `${row.employee.name} ${row.employee.employeeNo ?? ''}` : '';
  form.value = row ? viewOnly ? {subjectId:row.subjectId,employeeId:row.employeeId,payDate:row.payDate.slice(0,10),settings:JSON.parse(JSON.stringify(row.settings))} : copyDeductionForPayDate(row, '') : blank();
  readonly.value=viewOnly;fields.value={};formError.value='';unknownSave.value=false;step.value='identity';
  commonSourceId.value='';carryReference.value='';copyDate.value='';payDateConfirmed.value=false;
  baseline=JSON.stringify(form.value);open.value=true;
}
async function mayClose() {
  if(busy.value)return false;
  if(!open.value)return true;
  if(unknownSave.value){try{await ElMessageBox.confirm('保存结果待核实。关闭后请先在列表核对该员工和发薪日，不要重复创建。','核对保存结果',{confirmButtonText:'返回列表核对',cancelButtonText:'留在此页'});return true;}catch{return false;}}
  if(!open.value || readonly.value || baseline===JSON.stringify(form.value))return true;
  try {await ElMessageBox.confirm('放弃尚未保存的修改？','离开编辑',{confirmButtonText:'放弃修改',cancelButtonText:'继续编辑'});return true;}catch{return false;}
}
async function close(value:boolean){if(!value&&await mayClose()){open.value=false;if(unknownSave.value)await load();}}
onBeforeRouteLeave(mayClose);
async function focusError(path?: string) {
  const key = path ?? Object.keys(fields.value)[0]; if (key) step.value = deductionErrorStep(key);
  await nextTick();
  const field = editorRoot.value?.querySelector<HTMLElement>('.el-form-item.is-error');
  field?.scrollIntoView({block:'center'}); field?.querySelector<HTMLElement>('input,textarea,button')?.focus();
}
function validate() {
  fields.value=deductionDraftErrors(form.value);
  if(copySource.value && !payDateConfirmed.value)fields.value.payDateConfirmed='请核对目标发薪日';
}
async function advance() {
  validate();
  const own = Object.keys(fields.value).find(key=>deductionErrorStep(key)===step.value);
  if(own){await focusError(own);return;}
  fields.value={};step.value=step.value==='identity'?'contributions':'tax';
}
async function targetDateChanged() {
  if(!copySource.value)return;
  const date=form.value.payDate||'';
  if(copyDate.value && date!==copyDate.value){
    try{await ElMessageBox.confirm('变更发薪日将重新准备本次扣缴资料，尚未保存的个人填写需重新核对。','变更目标发薪日',{confirmButtonText:'重新准备',cancelButtonText:'保留原日期'});}catch{form.value.payDate=copyDate.value;return;}
  }
  form.value=copyDeductionForPayDate(copySource.value,date);copyDate.value=date;payDateConfirmed.value=false;carryReference.value='';fields.value={};
}
function carryOpening() {
  if(!copySource.value || !mayCarry.value || !carryReference.value.trim()){fields.value.carryReference='请填写本次沿用的台账核对依据';return;}
  const copied=copyDeductionForPayDate(copySource.value,form.value.payDate,carryReference.value);
  form.value.settings.tax.opening=copied.settings.tax.opening;form.value.settings.ledger=copied.settings.ledger;
  delete fields.value.carryReference;
}
function applyCommonRules() {
  const source=approvedSources.value.find(row=>row.id===commonSourceId.value);if(!source)return;
  form.value.settings=applyApprovedDeductionRules(form.value.settings,source,subjectId.value);
  formError.value='';fields.value={};
}
async function save() {
  if(busy.value||readonly.value||unknownSave.value)return;
  validate();formError.value='';
  if(copySource.value && form.value.employeeId!==copySource.value.employeeId){fields.value.employeeId='个人复制不能更换员工，请另建资料并套用公共规则';}
  if(Object.keys(fields.value).length){await focusError();return;}
  busy.value=true;
  try {await payrollApi.createDeductionProfile(form.value);open.value=false;await load();}
  catch(cause) {
    formError.value=await payrollError(cause);
    if(deductionSaveUncertain(cause)){unknownSave.value=true;formError.value='保存结果待核实，请先返回列表核对；本页不会重复创建。';}
    const issues=(cause as {response?:{data?:{data?:{issues?:unknown}}}})?.response?.data?.data?.issues;
    if(Array.isArray(issues))for(const issue of issues)if(typeof issue==='string'){
      const key=issue.split(':')[0]!.replace(/\[(\d+)\]/g,'.$1');
      for(const path of key.split('/').map((part,i)=>i===0?part:`${key.slice(0,key.lastIndexOf('.')+1)}${part}`)) fields.value[path]='请核对该项的值、格式或适用日期';
    }
    if(Object.keys(fields.value).length)await focusError();
  } finally {busy.value=false;}
}
async function submit(value:unknown) {
  const row=value as PayrollDeductionProfile;busy.value=true;error.value='';let releaseId='';
  try {releaseId=(await payrollApi.submitParameter('deduction',row.id,row.version)).id;}
  catch(cause){error.value=await payrollError(cause);}finally{busy.value=false;}
  if(releaseId)await router.push({path:'/payroll/parameter-reviews',query:{subjectId:subjectId.value,month:month.value,releaseId}});
}
</script>
<template>
  <BusinessListPage variant="record" :loading="loading">
    <template #filters><PayrollScope v-model:subject="subjectId" v-model:month="month" :subjects="subjects" :disabled="busy||open||bulkOpen" @refresh="refresh"><el-button type="primary" :icon="Plus" :disabled="busy||open||bulkOpen||loading" @click="edit()">新增扣缴资料</el-button><el-button :icon="DocumentCopy" :disabled="busy||open||bulkOpen||loading||!employees.length" @click="bulkOpen=true">批量准备草稿</el-button></PayrollScope></template>
    <template #feedback><el-alert v-if="error" type="error" :title="error" :closable="false"/></template>
    <template #desktop-list><el-table :data="rows" height="100%" empty-text="尚未维护扣缴资料">
      <el-table-column label="员工" min-width="140"><template #default="{row}">{{row.employee.name}}</template></el-table-column>
      <el-table-column label="发薪日" width="120"><template #default="{row}">{{row.payDate.slice(0,10)}}</template></el-table-column>
      <el-table-column prop="version" label="版本" width="70"/><el-table-column label="状态" width="125"><template #default="{row}">{{status(row.status)}}</template></el-table-column>
      <el-table-column label="个税规则" min-width="150"><template #default="{row}">{{row.settings.tax.ruleVersion}}</template></el-table-column>
      <el-table-column label="操作" min-width="260" fixed="right"><template #default="{row}"><el-button link type="primary" :disabled="busy" @click="edit(row,true)">查看</el-button><el-button link type="primary" :disabled="busy" @click="edit(row)">复制草稿</el-button><el-button v-if="['draft','returned'].includes(row.status)" link type="primary" :disabled="busy" @click="submit(row)">提交主管审核</el-button></template></el-table-column>
    </el-table></template>
    <template #mobile-list><MobileResultCard v-for="row in rows" :key="row.id"><template #title>{{row.employee.name}} · V{{row.version}}</template><template #status>{{status(row.status)}}</template><div>发薪日：{{row.payDate.slice(0,10)}}</div><div>个税规则：{{row.settings.tax.ruleVersion}}</div><template #actions><el-button link type="primary" :disabled="busy" @click="edit(row,true)">查看</el-button><el-button link type="primary" :disabled="busy" @click="edit(row)">复制草稿</el-button><el-button v-if="['draft','returned'].includes(row.status)" link type="primary" :disabled="busy" @click="submit(row)">提交主管审核</el-button></template></MobileResultCard><el-empty v-if="!rows.length" description="尚未维护扣缴资料"/></template>
    <template #detail>
      <PayrollDeductionBatchEditor v-model="bulkOpen" :subject-id="subjectId" :month="month" :employees="employees" :profiles="rows" @changed="load" @busy="bulkBusy=$event" />
      <BusinessDetailDrawer :model-value="open" :title="readonly?'扣缴资料':copySource?'复制本员工扣缴草稿':'扣缴资料草稿'" variant="wide" :saving="busy" :before-close="()=>close(false)" @update:model-value="close">
        <div ref="editorRoot" class="deduction-editor">
          <el-segmented v-model="step" :options="stepOptions" :disabled="busy||unknownSave" class="deduction-steps" />
          <el-alert v-if="formError" :title="formError" type="error" :closable="false" />
          <el-form v-if="step==='identity'" label-position="top" :disabled="busy||readonly||unknownSave">
            <el-form-item label="员工" :error="fields.employeeId"><span v-if="copySource||readonly" data-testid="deduction-copy-employee">{{viewedEmployee}}{{copySource?' · 仅复制本员工':''}}</span><el-select v-else v-model="form.employeeId" filterable><el-option v-for="person in employees" :key="person.id" :value="person.id" :label="`${person.name} ${person.employeeNo}`"/></el-select></el-form-item>
            <el-form-item label="目标发薪日" :error="fields.payDate"><el-date-picker v-model="form.payDate" type="date" value-format="YYYY-MM-DD" @change="targetDateChanged" /></el-form-item>
            <template v-if="copySource">
              <p class="deduction-note">复制来源：{{copySource.payDate.slice(0,10)}} · V{{copySource.version}}。本次缴费归属日、月度扣除和累计依据待核对。</p>
              <el-form-item :error="fields.payDateConfirmed"><el-checkbox v-model="payDateConfirmed">已核对本员工的目标发薪日</el-checkbox></el-form-item>
              <div v-if="mayCarry" class="carry-opening"><el-form-item label="沿用本年已审台账的核对依据" :error="fields.carryReference"><el-input v-model="carryReference" maxlength="140" placeholder="不沿用时留空，下一步重新填写期初" /></el-form-item><el-button :disabled="!carryReference.trim()" @click="carryOpening">按此依据沿用期初</el-button></div>
              <p v-else class="deduction-note">未沿用累计期初；跨年或没有已审台账依据时须重新填写，不能默认0。</p>
            </template>
            <template v-if="!readonly">
              <el-form-item label="套用已批准的公共规则"><el-select v-model="commonSourceId" clearable filterable placeholder="可选，仅套用本主体规则"><el-option v-for="source in approvedSources" :key="source.id" :value="source.id" :label="`${source.settings.tax.ruleVersion} · ${source.payDate.slice(0,10)} · V${source.version}`" /></el-select></el-form-item>
              <el-button :disabled="!commonSourceId" @click="applyCommonRules">套用税表与缴费规则</el-button>
              <p class="deduction-note">个人基数、累计、扣除和确认依据仍须核对填写。</p>
            </template>
          </el-form>
          <PayrollDeductionSettingsForm v-else v-model="form.settings" :section="step==='contributions'?'contributions':'tax'" :disabled="busy||readonly||unknownSave" :errors="fields" />
        </div>
        <template #footer><el-button :disabled="busy" @click="close(false)">{{unknownSave?'返回列表核对':'关闭'}}</el-button><el-button v-if="step!=='identity'" :icon="ArrowLeft" :disabled="busy||unknownSave" @click="step=step==='tax'?'contributions':'identity'">上一步</el-button><el-button v-if="step!=='tax'" :icon="ArrowRight" :disabled="busy||unknownSave" @click="readonly?(step=step==='identity'?'contributions':'tax'):advance()">下一步</el-button><el-button v-if="!readonly&&step==='tax'" type="primary" :loading="busy" :disabled="unknownSave" @click="save">保存草稿</el-button></template>
      </BusinessDetailDrawer>
    </template>
  </BusinessListPage>
</template>
<style scoped>
.deduction-editor { display:grid;gap:16px;min-width:0; }
.deduction-steps { max-width:100%; }
.deduction-note { font-size:13px;color:var(--el-text-color-secondary);line-height:1.6;overflow-wrap:anywhere; }
.carry-opening { margin:16px 0; }
:deep(.el-form-item__error) { position:static;line-height:1.5;overflow-wrap:anywhere; }
.deduction-editor :deep(.el-select), .deduction-editor :deep(.el-date-editor) { width:100%; }
@media(max-width:600px){.deduction-steps :deep(.el-segmented__group){flex-wrap:wrap;}.deduction-steps :deep(.el-segmented__item-label){white-space:normal;}.deduction-steps :deep(.el-segmented__item){flex:1;}}
</style>
