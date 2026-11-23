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
import PayrollReadinessPanel from './PayrollReadinessPanel.vue';
import { usePayrollScope } from './usePayrollScope';
import { currentVersion, purposeLabels, statusLabels, batchStatus, needsUpdate } from './payroll-state';

const props = defineProps<{ mode: 'batches' | 'approvals' | 'results' }>();
const previewMode = import.meta.env.VITE_PREVIEW_MODE === 'true';
const route = useRoute(), router = useRouter();
const required: Record<typeof props.mode, PayrollCapability[]> = { batches: ['payroll_edit', 'payroll_view'], approvals: ['payroll_review', 'payroll_approve'], results: ['payroll_view', 'payroll_export', 'payroll_settle'] };
const { access, subjects, subjectId, month, has, error, loading, refreshAccess } = usePayrollScope(computed(() => required[props.mode]), { syncQuery: true, persistQuery: true });
const batches = ref<PayrollBatch[]>([]), employees = ref<PayrollEmployee[]>([]);
const readiness = ref<{ ready: boolean; firstMonth?: string; reason?: string }>({ ready: false });
const formalReady = computed(() => readiness.value.ready && !!readiness.value.firstMonth && month.value >= readiness.value.firstMonth);
const open = ref(false), busy = ref(false), detailBusy = ref(false), formError = ref('');
const fields = reactive<Record<string, string>>({});
const form = ref<PayrollBatchInput>({ subjectId: '', month: '', payMonth: '', purpose: previewMode ? 'trial' : 'reconciliation' });
const additionalMonths = ref<string[]>([]);
const status = ref('');
let sequence = 0, openedFromList = false;
const detailOpen = computed(() => !!route.params.id);
const readinessOpen = computed(() => route.query.readiness === 'list' || typeof route.query.readiness === 'string' && /^[a-f0-9-]{36}$/i.test(route.query.readiness));
const readinessId = computed(() => readinessOpen.value && route.query.readiness !== 'list' ? String(route.query.readiness) : '');
function selectReadiness(id: string) { void router.push({ path: listPath.value, query: { ...route.query, subjectId: subjectId.value, month: month.value, readiness: id || 'list' } }); }
function closeReadiness(value: boolean) { if (!value) { const query = { ...route.query }; delete query.readiness; void router.replace({ path: listPath.value, query }); } }
const listPath = computed(() => `/payroll/${props.mode}`);
const rows = computed(() => batches.value.filter(row => (!month.value || row.month === month.value) && (!status.value || row.status === status.value)
  && (props.mode === 'batches' || row.purpose !== 'reconciliation')
  && (props.mode !== 'approvals' || ['pending', 'returned'].includes(row.status))
  && (props.mode !== 'results' || ['approved', 'closed', 'voided'].includes(row.status))));
async function load() {
  const request = ++sequence; batches.value = []; employees.value = [];
  readiness.value = { ready: false };
  if (!subjectId.value) return;
  error.value = '';
  loading.value = true;
  try {
    const data = await payrollApi.batches(subjectId.value, month.value);
    if (request !== sequence) return;
    batches.value = data;
    if (!previewMode && props.mode === 'batches' && has('payroll_edit')) {
      const receipt = await payrollApi.readiness(subjectId.value);
      if (request !== sequence) return;
      readiness.value = receipt;
    }
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
  if (!subjectId.value || correction?.purpose === 'reconciliation') return;
  form.value = { subjectId: correction?.subjectId ?? subjectId.value, month: correction?.month ?? month.value, payMonth: '', purpose: correction?.purpose ?? (previewMode ? 'trial' : formalReady.value ? 'formal' : 'reconciliation'), ...(correction ? { correctionOfId: correction.id } : {}) };
  additionalMonths.value = [...(correction?.additionalMonths ?? [])];
  formError.value = ''; Object.keys(fields).forEach(key => delete fields[key]); open.value = true;
}
async function save() {
  Object.keys(fields).forEach(key => delete fields[key]); formError.value = '';
  if (!form.value.month) fields.month = '请选择工资归属月';
  if (!form.value.payMonth) fields.payMonth = '请选择发放月';
  if (!previewMode && form.value.purpose === 'formal' && !formalReady.value) fields.purpose = readiness.value.reason ?? '正式发薪待首月签收';
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
const monthQuery = computed(() => ({ subjectId: subjectId.value, month: month.value }));
const monthState = computed(() => !rows.value.length ? '本月尚无核算批次，先核对已审核工资资料及已封账考勤。' : rows.value.some(row => row.purpose === 'reconciliation')
  ? '真实资料对账核对历史全额；正式工资仅办理待结余额。对账须核到税后实发，再办理首月签收。'
  : '打开本月批次查看待办；复核审批通过后，再到工资结果办理下载或实发登记。');
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
      <PayrollScope v-model:subject="subjectId" v-model:month="month" :subjects="subjects" :disabled="busy || detailOpen || open || readinessOpen" @refresh="refresh">
        <el-select v-model="status" clearable placeholder="全部状态" aria-label="批次状态" class="status-select"><el-option v-for="(label, key) in statusLabels" :key="key" :label="label" :value="key" /></el-select>
        <el-button v-if="mode === 'batches' && has('payroll_edit')" type="primary" :icon="Plus" :disabled="loading || detailOpen" @click="create()">新建核算</el-button>
        <el-button v-if="!previewMode && mode !== 'results' && subjectId" :disabled="loading || detailOpen || open" @click="selectReadiness('')">首月签收</el-button>
      </PayrollScope>
      <PayrollLedger v-if="mode === 'batches' && has('payroll_edit')" :key="`adjustment-${subjectId}-${month}`" :subject-id="subjectId" :month="month" :employees="employees" kind="adjustment" @changed="load" @busy="busy = $event" />
      <PayrollLedger v-if="mode === 'results' && has('payroll_settle')" :key="`opening-${subjectId}-${month}`" :subject-id="subjectId" :month="month" :employees="employees" kind="opening" @changed="load" @busy="busy = $event" />
    </template>
    <template #feedback>
      <el-alert v-if="error" :title="error" type="error" :closable="false" />
      <el-alert v-else-if="!previewMode && subjectId && !loading && mode === 'batches' && !formalReady" title="正式工资待首月签收" type="info" :closable="false" description="先用已审核资料核对税后实发，再提交首月签收，由指定工资复核人、审批人依次办理。资料本身由经办人的直属主管审核。" />
      <el-alert v-else-if="!previewMode && subjectId && !loading && mode === 'results' && !rows.length" title="暂无已审批的工资结果" type="info" :closable="false" description="工资全部审批通过后，才能下载最终结果和登记实际发放。" />
      <div v-if="mode === 'batches' && subjectId && !loading && has('payroll_edit')" class="month-next" role="status"><span>{{ month }} · {{ monthState }}</span><nav aria-label="本月下一步"><RouterLink :to="{ path: '/payroll/standards', query: monthQuery }">工资资料</RouterLink><RouterLink :to="{ path: '/payroll/deductions', query: monthQuery }">扣缴资料</RouterLink><RouterLink v-if="has('attendance_edit') || has('attendance_seal')" :to="{ path: '/payroll/attendance', query: monthQuery }">考勤核对与封账</RouterLink></nav></div>
    </template>
    <template #desktop-list>
      <el-table :data="rows" height="100%" empty-text="暂无工资批次"><el-table-column label="批次" min-width="150"><template #default="{ row }">{{ row.month }} · V{{ row.version }}</template></el-table-column><el-table-column prop="payMonth" label="发放月" width="110" /><el-table-column label="用途" width="130"><template #default="{ row }">{{ purposeLabels[row.purpose as keyof typeof purposeLabels] }}</template></el-table-column><el-table-column label="状态" min-width="180"><template #default="{ row }">{{ batchStatus(row as PayrollBatch) }}<el-tag v-if="needsUpdate(row as PayrollBatch)" type="warning" size="small">来源待更新</el-tag></template></el-table-column><el-table-column label="税前核算金额" min-width="150"><template #default="{ row }">{{ gross(row) }}<small class="amount-basis">{{ row.purpose === 'reconciliation' ? '历史全额对账 · 非待付' : '本批待结余额' }}</small></template></el-table-column><el-table-column label="操作" width="100" fixed="right"><template #default="{ row }"><el-button link type="primary" @click="openDetail(row)">查看办理</el-button></template></el-table-column></el-table>
    </template>
    <template #mobile-list>
      <MobileResultCard v-for="row in rows" :key="row.id"><template #title>{{ row.month }} · V{{ row.version }}</template><template #status>{{ purposeLabels[row.purpose] }}</template><div>{{ batchStatus(row) }}{{ needsUpdate(row) ? ' · 来源待更新' : '' }}</div><div>发放月：{{ row.payMonth }}</div><div>{{ row.purpose === 'reconciliation' ? '税前全额对账（非待付）' : '本批税前待结余额' }}：{{ currentVersion(row)?.gross ?? '待核算' }}</div><template #actions><el-button link type="primary" @click="openDetail(row)">查看办理</el-button></template></MobileResultCard>
      <el-empty v-if="!rows.length" description="暂无工资批次" />
    </template>
    <template #detail>
      <PayrollReadinessPanel v-if="!previewMode && mode !== 'results'" :model-value="readinessOpen" :subject-id="subjectId" :request-id="readinessId" :batches="batches" :can-submit="has('payroll_edit')" @update:model-value="closeReadiness" @select="selectReadiness" @changed="load" />
      <BusinessDetailDrawer :model-value="detailOpen" title="工资批次" variant="workflow" :saving="detailBusy" :before-close="beforeCloseDetail" @update:model-value="closeDetail">
        <RouterView v-slot="{ Component }"><component :is="Component" :access="access" :allow-export="mode === 'results'" @changed="load" @busy="detailBusy = $event" @correct="create" /></RouterView>
      </BusinessDetailDrawer>
      <el-dialog :model-value="open" :title="form.correctionOfId ? '发起更正 / 补差' : '新建工资核算'" width="min(560px, 94vw)" :close-on-click-modal="!busy" :show-close="!busy" :close-on-press-escape="!busy" :before-close="beforeCloseCreate" @update:model-value="closeCreate">
        <el-form label-position="top">
          <el-form-item label="工资归属月" :error="fields.month"><el-date-picker v-model="form.month" type="month" value-format="YYYY-MM" :disabled="!!form.correctionOfId || busy" /></el-form-item>
          <el-form-item label="发放月" :error="fields.payMonth"><el-date-picker v-model="form.payMonth" type="month" value-format="YYYY-MM" :disabled="busy" /></el-form-item>
          <el-form-item label="用途" :error="fields.purpose"><el-select v-model="form.purpose" :disabled="busy || !!form.correctionOfId"><template v-if="previewMode"><el-option label="试算" value="trial" /><el-option label="测试环境验收" value="validation" /></template><template v-else><el-option label="真实资料对账" value="reconciliation" /><el-option :label="formalReady ? '正式工资' : '正式工资（待首月签收）'" value="formal" :disabled="!formalReady" /></template></el-select></el-form-item>
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
.amount-basis {display:block;font-size:12px;color:var(--el-text-color-secondary);line-height:1.6;}
.month-next {display:grid;gap:6px;font-size:13px;line-height:1.6;overflow-wrap:anywhere;}
.month-next nav {display:flex;flex-wrap:wrap;gap:8px 16px;}.month-next a {color:var(--el-color-primary);}
</style>
