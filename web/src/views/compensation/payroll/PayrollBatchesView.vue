<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessageBox } from 'element-plus';
import { Plus, Delete } from '@element-plus/icons-vue';
import BusinessListPage from '@/components/common/business-list/BusinessListPage.vue';
import BusinessDetailDrawer from '@/components/common/business-list/BusinessDetailDrawer.vue';
import MobileResultCard from '@/components/common/MobileResultCard.vue';
import { payrollApi, payrollError } from '@/api/payroll.api';
import type { PayrollBatch, PayrollBatchInput, PayrollCapability, PayrollEmployee } from '@/types/payroll.types';
import PayrollScope from './PayrollScope.vue';
import PayrollLedger from './PayrollLedger.vue';
import { usePayrollScope } from './usePayrollScope';
import { currentVersion, purposeLabels, statusLabels, batchStatus, needsUpdate } from './payroll-state';

const props = defineProps<{ mode: 'batches' | 'approvals' | 'results' }>();
const previewMode = import.meta.env.VITE_PREVIEW_MODE === 'true';
const route = useRoute(), router = useRouter();
const required: Record<typeof props.mode, PayrollCapability[]> = { batches: ['payroll_edit', 'payroll_view'], approvals: ['payroll_review', 'payroll_approve'], results: ['payroll_view', 'payroll_export', 'payroll_settle'] };
const { access, subjects, subjectId, month, has, error, loading, refreshAccess } = usePayrollScope(computed(() => required[props.mode]));
const batches = ref<PayrollBatch[]>([]), employees = ref<PayrollEmployee[]>([]);
const open = ref(false), busy = ref(false), detailBusy = ref(false), formError = ref('');
const fields = reactive<Record<string, string>>({});
const form = ref<PayrollBatchInput>({ subjectId: '', month: '', payMonth: '', purpose: previewMode ? 'trial' : 'formal' });
const additionalMonths = ref<string[]>([]);
const status = ref('');
let sequence = 0, openedFromList = false;
const detailOpen = computed(() => !!route.params.id);
const listPath = computed(() => `/payroll/${props.mode}`);
const rows = computed(() => batches.value.filter(row => (!month.value || row.month === month.value) && (!status.value || row.status === status.value)
  && (props.mode !== 'approvals' || ['pending', 'returned'].includes(row.status))
  && (props.mode !== 'results' || ['approved', 'closed', 'voided'].includes(row.status))));
async function load() {
  const request = ++sequence; batches.value = []; employees.value = [];
  if (!subjectId.value) return;
  error.value = '';
  loading.value = true;
  try {
    const data = await payrollApi.batches(subjectId.value, month.value);
    if (request !== sequence) return;
    batches.value = data;
    if ((props.mode === 'batches' && has('payroll_edit')) || (props.mode === 'results' && has('payroll_settle'))) {
      const people = await payrollApi.employees(subjectId.value, month.value);
      if (request === sequence) employees.value = people;
    }
  } catch (cause) { if (request === sequence) error.value = await payrollError(cause); }
  finally { if (request === sequence) loading.value = false; }
}
async function refresh() { const before = subjectId.value; await refreshAccess(); if (before === subjectId.value) await load(); }
watch([subjectId, month], () => { void load(); });
watch(() => props.mode, () => { status.value = ''; void refresh(); });
onMounted(refresh);
function create(correction?: PayrollBatch) {
  if (!subjectId.value) return;
  form.value = { subjectId: correction?.subjectId ?? subjectId.value, month: correction?.month ?? month.value, payMonth: '', purpose: correction?.purpose ?? (previewMode ? 'trial' : 'formal'), ...(correction ? { correctionOfId: correction.id } : {}) };
  additionalMonths.value = [...(correction?.additionalMonths ?? [])];
  formError.value = ''; Object.keys(fields).forEach(key => delete fields[key]); open.value = true;
}
async function save() {
  Object.keys(fields).forEach(key => delete fields[key]); formError.value = '';
  if (!form.value.month) fields.month = '请选择工资归属月';
  if (!form.value.payMonth) fields.payMonth = '请选择发放月';
  if (additionalMonths.value.some(value => !value || value >= form.value.month) || new Set(additionalMonths.value).size !== additionalMonths.value.length) fields.additionalMonths = '请选择不重复且早于本次工资月的归属月';
  if (Object.keys(fields).length) return;
  busy.value = true;
  try {
    const batch = await payrollApi.createBatch({ ...form.value, additionalMonths: additionalMonths.value });
    open.value = false; await load(); openedFromList = false;
    await router.push({ path: `/payroll/batches/${batch.id}`, query: { subjectId: batch.subjectId, month: batch.month } });
  } catch (cause) { formError.value = await payrollError(cause); }
  finally { busy.value = false; }
}
function gross(row: unknown) { return currentVersion(row as PayrollBatch)?.gross ?? '待核算'; }
function openDetail(value: unknown) { const row = value as PayrollBatch; openedFromList = true; void router.push({ path: `${listPath.value}/${row.id}`, query: { ...route.query, subjectId: subjectId.value, month: month.value } }); }
function closeDetail(value: boolean) {
  if (value || detailBusy.value) return;
  if (openedFromList) { openedFromList = false; router.back(); }
  else void router.replace({ path: listPath.value, query: route.query });
}
function beforeCloseDetail() { closeDetail(false); }
function beforeCloseCreate() { void closeCreate(false); }
async function closeCreate(value: boolean) {
  if (busy.value) return;
  if (!value && (form.value.payMonth || additionalMonths.value.length)) {
    try { await ElMessageBox.confirm('放弃尚未创建的工资批次？', '离开编辑', { confirmButtonText: '放弃修改', cancelButtonText: '继续编辑' }); } catch { return; }
  }
  open.value = value;
}
</script>
<template>
  <BusinessListPage variant="workflow" :loading="loading">
    <template #filters>
      <PayrollScope v-model:subject="subjectId" v-model:month="month" :subjects="subjects" :disabled="busy || detailOpen || open" @refresh="refresh">
        <el-select v-model="status" clearable placeholder="全部状态" aria-label="批次状态" class="status-select"><el-option v-for="(label, key) in statusLabels" :key="key" :label="label" :value="key" /></el-select>
        <el-button v-if="mode === 'batches' && has('payroll_edit')" type="primary" :icon="Plus" :disabled="loading || detailOpen" @click="create()">新建核算</el-button>
      </PayrollScope>
      <PayrollLedger v-if="mode === 'batches' && has('payroll_edit')" :key="`adjustment-${subjectId}-${month}`" :subject-id="subjectId" :month="month" :employees="employees" kind="adjustment" @changed="load" @busy="busy = $event" />
      <PayrollLedger v-if="mode === 'results' && has('payroll_settle')" :key="`opening-${subjectId}-${month}`" :subject-id="subjectId" :month="month" :employees="employees" kind="opening" @changed="load" @busy="busy = $event" />
    </template>
    <template #feedback><el-alert v-if="error" :title="error" type="error" :closable="false" /></template>
    <template #desktop-list>
      <el-table :data="rows" height="100%" empty-text="暂无工资批次"><el-table-column label="批次" min-width="150"><template #default="{ row }">{{ row.month }} · V{{ row.version }}</template></el-table-column><el-table-column prop="payMonth" label="发放月" width="110" /><el-table-column label="用途" width="110"><template #default="{ row }">{{ purposeLabels[row.purpose as keyof typeof purposeLabels] }}</template></el-table-column><el-table-column label="状态" min-width="180"><template #default="{ row }">{{ batchStatus(row as PayrollBatch) }}<el-tag v-if="needsUpdate(row as PayrollBatch)" type="warning" size="small">来源待更新</el-tag></template></el-table-column><el-table-column label="税前应发" min-width="130"><template #default="{ row }">{{ gross(row) }}</template></el-table-column><el-table-column label="操作" width="100" fixed="right"><template #default="{ row }"><el-button link type="primary" @click="openDetail(row)">查看办理</el-button></template></el-table-column></el-table>
    </template>
    <template #mobile-list>
      <MobileResultCard v-for="row in rows" :key="row.id"><template #title>{{ row.month }} · V{{ row.version }}</template><template #status>{{ purposeLabels[row.purpose] }}</template><div>{{ batchStatus(row) }}{{ needsUpdate(row) ? ' · 来源待更新' : '' }}</div><div>发放月：{{ row.payMonth }}</div><div>税前应发：{{ currentVersion(row)?.gross ?? '待核算' }}</div><template #actions><el-button link type="primary" @click="openDetail(row)">查看办理</el-button></template></MobileResultCard>
      <el-empty v-if="!rows.length" description="暂无工资批次" />
    </template>
    <template #detail>
      <BusinessDetailDrawer :model-value="detailOpen" title="工资批次" variant="workflow" :saving="detailBusy" :before-close="beforeCloseDetail" @update:model-value="closeDetail">
        <RouterView v-slot="{ Component }"><component :is="Component" :access="access" :allow-export="mode === 'results'" @changed="load" @busy="detailBusy = $event" @correct="create" /></RouterView>
      </BusinessDetailDrawer>
      <el-dialog :model-value="open" :title="form.correctionOfId ? '发起更正 / 补差' : '新建工资核算'" width="min(560px, 94vw)" :close-on-click-modal="!busy" :show-close="!busy" :close-on-press-escape="!busy" :before-close="beforeCloseCreate" @update:model-value="closeCreate">
        <el-form label-position="top">
          <el-form-item label="工资归属月" :error="fields.month"><el-date-picker v-model="form.month" type="month" value-format="YYYY-MM" :disabled="!!form.correctionOfId || busy" /></el-form-item>
          <el-form-item label="发放月" :error="fields.payMonth"><el-date-picker v-model="form.payMonth" type="month" value-format="YYYY-MM" :disabled="busy" /></el-form-item>
          <el-form-item label="用途"><el-select v-model="form.purpose" :disabled="busy || !!form.correctionOfId"><template v-if="previewMode"><el-option label="试算" value="trial" /><el-option label="测试环境验收" value="validation" /></template><el-option v-else label="正式" value="formal" /></el-select></el-form-item>
          <el-form-item label="其他归属月" :error="fields.additionalMonths"><div class="additional-months"><div v-for="(_, index) in additionalMonths" :key="index" class="month-row"><el-date-picker v-model="additionalMonths[index]" type="month" value-format="YYYY-MM" :disabled="busy" /><el-button :icon="Delete" aria-label="删除其他归属月" :disabled="busy" @click="additionalMonths.splice(index, 1)" /></div><el-button :icon="Plus" :disabled="additionalMonths.length >= 11 || busy" @click="additionalMonths.push('')">添加归属月</el-button></div></el-form-item>
          <el-alert v-if="formError" :title="formError" type="error" :closable="false" />
        </el-form>
        <template #footer><el-button :disabled="busy" @click="closeCreate(false)">取消</el-button><el-button type="primary" :loading="busy" @click="save">创建核算批次</el-button></template>
      </el-dialog>
    </template>
  </BusinessListPage>
</template>
<style scoped>
.status-select { width: 180px; max-width: 100%; }
.additional-months { display: grid; gap: 8px; max-width: 100%; }
.month-row { display: flex; gap: 8px; max-width: 100%; }
.month-row :deep(.el-date-editor) { width: 190px; max-width: calc(100% - 44px); }
</style>
