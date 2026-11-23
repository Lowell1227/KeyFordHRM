<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRouter, onBeforeRouteLeave } from 'vue-router';
import { ElMessageBox } from 'element-plus';
import { Plus } from '@element-plus/icons-vue';
import BusinessListPage from '@/components/common/business-list/BusinessListPage.vue';
import BusinessDetailDrawer from '@/components/common/business-list/BusinessDetailDrawer.vue';
import MobileResultCard from '@/components/common/MobileResultCard.vue';
import PayrollScope from './PayrollScope.vue';
import PayrollDeductionSettingsForm from './PayrollDeductionSettingsForm.vue';
import { usePayrollScope } from './usePayrollScope';
import { emptyDeductionSettings, deductionFormErrors } from './payroll-deduction-form';
import { payrollApi, payrollError } from '@/api/payroll.api';
import type { PayrollDeductionProfile, PayrollDeductionProfileInput, PayrollEmployee } from '@/types/payroll.types';

const {subjects,subjectId,month,error,loading,refreshAccess} = usePayrollScope(['payroll_edit']);
const router = useRouter(), rows = ref<PayrollDeductionProfile[]>([]), employees = ref<PayrollEmployee[]>([]);
const open = ref(false), readonly = ref(false), busy = ref(false), formError = ref(''), fields = ref<Record<string,string>>({});
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
  form.value = row ? {subjectId:row.subjectId,employeeId:row.employeeId,payDate:row.payDate.slice(0,10),settings:JSON.parse(JSON.stringify(row.settings))} : blank();
  readonly.value=viewOnly;fields.value={};formError.value='';baseline=JSON.stringify(form.value);open.value=true;
}
async function mayClose() {
  if(busy.value)return false;
  if(!open.value || readonly.value || baseline===JSON.stringify(form.value))return true;
  try {await ElMessageBox.confirm('放弃尚未保存的修改？','离开编辑',{confirmButtonText:'放弃修改',cancelButtonText:'继续编辑'});return true;}catch{return false;}
}
async function close(value:boolean){if(!value&&await mayClose())open.value=false;}
onBeforeRouteLeave(mayClose);
async function save() {
  fields.value=deductionFormErrors(form.value.settings,form.value.payDate);formError.value='';
  if(!form.value.employeeId)fields.value.employeeId='请选择员工';
  const date=new Date(`${form.value.payDate}T00:00:00Z`);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(form.value.payDate)||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==form.value.payDate)fields.value.payDate='请填写有效的发薪日';
  if(Object.keys(fields.value).length)return;
  busy.value=true;
  try {await payrollApi.createDeductionProfile(form.value);open.value=false;await load();}
  catch(cause) {
    formError.value=await payrollError(cause);
    const issues=(cause as {response?:{data?:{data?:{issues?:unknown}}}})?.response?.data?.data?.issues;
    if(Array.isArray(issues))for(const issue of issues)if(typeof issue==='string'){
      const key=issue.split(':')[0]!.replace(/\[(\d+)\]/g,'.$1');
      for(const path of key.split('/').map((part,i)=>i===0?part:`${key.slice(0,key.lastIndexOf('.')+1)}${part}`)) fields.value[path]='请核对该项的值、格式或适用日期';
    }
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
    <template #filters><PayrollScope v-model:subject="subjectId" v-model:month="month" :subjects="subjects" :disabled="busy||open" @refresh="refresh"><el-button type="primary" :icon="Plus" :disabled="busy||open||loading" @click="edit()">新增扣缴资料</el-button></PayrollScope></template>
    <template #feedback><el-alert v-if="error" type="error" :title="error" :closable="false"/></template>
    <template #desktop-list><el-table :data="rows" height="100%" empty-text="尚未维护扣缴资料">
      <el-table-column label="员工" min-width="140"><template #default="{row}">{{row.employee.name}}</template></el-table-column>
      <el-table-column label="发薪日" width="120"><template #default="{row}">{{row.payDate.slice(0,10)}}</template></el-table-column>
      <el-table-column prop="version" label="版本" width="70"/><el-table-column label="状态" width="125"><template #default="{row}">{{status(row.status)}}</template></el-table-column>
      <el-table-column label="个税规则" min-width="150"><template #default="{row}">{{row.settings.tax.ruleVersion}}</template></el-table-column>
      <el-table-column label="操作" min-width="260" fixed="right"><template #default="{row}"><el-button link type="primary" :disabled="busy" @click="edit(row,true)">查看</el-button><el-button link type="primary" :disabled="busy" @click="edit(row)">复制草稿</el-button><el-button v-if="['draft','returned'].includes(row.status)" link type="primary" :disabled="busy" @click="submit(row)">提交主管审核</el-button></template></el-table-column>
    </el-table></template>
    <template #mobile-list><MobileResultCard v-for="row in rows" :key="row.id"><template #title>{{row.employee.name}} · V{{row.version}}</template><template #status>{{status(row.status)}}</template><div>发薪日：{{row.payDate.slice(0,10)}}</div><div>个税规则：{{row.settings.tax.ruleVersion}}</div><template #actions><el-button link type="primary" :disabled="busy" @click="edit(row,true)">查看</el-button><el-button link type="primary" :disabled="busy" @click="edit(row)">复制草稿</el-button><el-button v-if="['draft','returned'].includes(row.status)" link type="primary" :disabled="busy" @click="submit(row)">提交主管审核</el-button></template></MobileResultCard><el-empty v-if="!rows.length" description="尚未维护扣缴资料"/></template>
    <template #detail><BusinessDetailDrawer :model-value="open" :title="readonly?'扣缴资料':'扣缴资料草稿'" variant="wide" :saving="busy" :before-close="()=>close(false)" @update:model-value="close">
      <el-form label-position="top" :disabled="busy||readonly"><el-form-item label="员工" :error="fields.employeeId"><el-select v-model="form.employeeId" filterable><el-option v-for="person in employees" :key="person.id" :value="person.id" :label="`${person.name} ${person.employeeNo}`"/></el-select></el-form-item><el-form-item label="发薪日" :error="fields.payDate"><el-input v-model="form.payDate" placeholder="YYYY-MM-DD"/></el-form-item></el-form>
      <PayrollDeductionSettingsForm v-model="form.settings" :disabled="busy||readonly" :errors="fields"/>
      <el-alert v-if="formError" :title="formError" type="error" :closable="false"/>
      <template #footer><el-button :disabled="busy" @click="close(false)">关闭</el-button><el-button v-if="!readonly" type="primary" :loading="busy" @click="save">保存草稿</el-button></template>
    </BusinessDetailDrawer></template>
  </BusinessListPage>
</template>
