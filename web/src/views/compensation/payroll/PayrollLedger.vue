<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { payrollApi, payrollError } from '@/api/payroll.api';
import { payrollRecoveryApi } from '@/api/payroll-recovery.api';
import type { PayrollOpeningHistory } from '@/types/payroll-recovery.types';
import type { PayrollAdjustment, PayrollOpening, PayrollEmployee, PayrollItemCode } from '@/types/payroll.types';
import { isDecimal, itemLabels } from './payroll-state';
import { openingAuditChanges, openingCorrectionErrors } from './payroll-recovery-form';
import { payrollTime } from './payroll-workflow-presentation';
const props = defineProps<{ subjectId: string; month: string; employees: PayrollEmployee[]; kind: 'adjustment' | 'opening' }>();
const emit = defineEmits<{ changed: []; busy: [value: boolean] }>();
const rows = ref<Array<PayrollAdjustment | PayrollOpening>>([]);
const expanded = ref(false), busy = ref(false), error = ref('');
const fields = reactive<Record<string, string>>({});
const form = reactive({ employeeId: '', itemCode: '' as PayrollItemCode | '', amount: '', reason: '', reference: '' });
const historyVisible = ref(false), history = ref<PayrollOpeningHistory | null>(null), historyLoading = ref(false), correctionError = ref('');
const correctionFields = ref<Record<string, string>>({});
const correction = reactive({ amount: '', reference: '', reason: '' });
let historySequence = 0;
let correctionRequest: { content: string; requestId: string } | null = null;
let sequence = 0;
watch(busy, value => emit('busy', value));
const name = (id: string) => props.employees.find(person => person.id === id)?.name ?? id;
const recordedAmount = (row: PayrollAdjustment | PayrollOpening) => props.kind === 'opening' && 'confirmedAt' in row && !row.confirmedAt ? '待确认' : row.amount ?? '待确认';
async function load() {
  const request = ++sequence; rows.value = []; error.value = '';
  if (!props.subjectId || !props.month) return;
  try { const result = props.kind === 'adjustment' ? await payrollApi.adjustments(props.subjectId, props.month) : await payrollApi.openings(props.subjectId, props.month); if (request === sequence) rows.value = result; }
  catch (cause) { if (request === sequence) error.value = await payrollError(cause); }
}
watch(() => [props.subjectId, props.month, props.kind], () => {
  Object.assign(form, { employeeId: '', itemCode: '', amount: '', reason: '', reference: '' });
  historySequence++; historyVisible.value = false; history.value = null; correctionRequest = null; historyLoading.value = false;
  expanded.value = false; void load();
}, { immediate: true });
async function showOpeningHistory(id: string, reset = true) {
  const request = ++historySequence;
  historyVisible.value = true; historyLoading.value = true; correctionError.value = ''; history.value = null;
  if (reset) { correctionFields.value = {}; correctionRequest = null; Object.assign(correction, { amount: '', reference: '', reason: '' }); }
  try {
    const result = await payrollRecoveryApi.openingHistory(id);
    if (request !== historySequence || result.subjectId !== props.subjectId || result.month !== props.month || props.kind !== 'opening') return;
    history.value = result;
    if (reset) Object.assign(correction, { amount: result.current.amount ?? '', reference: result.current.reference ?? '', reason: '' });
  } catch (cause) { if (request === historySequence) correctionError.value = await payrollError(cause); }
  finally { if (request === historySequence) historyLoading.value = false; }
}
async function correctOpening() {
  correctionFields.value = openingCorrectionErrors(correction); correctionError.value = '';
  if (!history.value || Object.keys(correctionFields.value).length || busy.value) return;
  const current = history.value, request = historySequence;
  const body = { expectedHash: current.currentHash, amount: correction.amount, reference: correction.reference.trim(), reason: correction.reason.trim() };
  const content = JSON.stringify({ id: current.openingId, ...body });
  if (correctionRequest?.content !== content) correctionRequest = { content, requestId: crypto.randomUUID() };
  busy.value = true;
  try {
    await payrollRecoveryApi.correctOpening(current.openingId, { ...body, requestId: correctionRequest.requestId });
    if (request !== historySequence) return;
    correctionRequest = null;
    await showOpeningHistory(current.openingId); await load(); emit('changed');
  } catch (cause) { if (request === historySequence) correctionError.value = await payrollError(cause); }
  finally { busy.value = false; }
}
async function save() {
  Object.keys(fields).forEach(key => delete fields[key]); error.value = '';
  if (!form.employeeId) fields.employeeId = '请选择员工';
  if (!form.itemCode) fields.itemCode = '请选择工资项';
  if (!isDecimal(form.amount, true)) fields.amount = '请填写明确的十进制金额';
  if (!form.reference.trim()) fields.reference = '请填写确认凭证';
  if (props.kind === 'adjustment' && !form.reason.trim()) fields.reason = '请填写调整原因';
  if (Object.keys(fields).length || !form.itemCode) return;
  busy.value = true;
  try {
    const value = { subjectId: props.subjectId, month: props.month, employeeId: form.employeeId, itemCode: form.itemCode, amount: form.amount, reference: form.reference.trim() };
    if (props.kind === 'adjustment') await payrollApi.createAdjustment({ ...value, reason: form.reason.trim() }); else await payrollApi.createOpening(value);
    Object.assign(form, { employeeId: '', itemCode: '', amount: '', reason: '', reference: '' });
    await load(); emit('changed');
  } catch (cause) { error.value = await payrollError(cause); }
  finally { busy.value = false; }
}
</script>
<template>
  <section class="ledger">
    <el-button link type="primary" @click="expanded = !expanded">{{ kind === 'adjustment' ? '授权调整' : '历史已付登记' }} · {{ month }}（{{ rows.length }}）</el-button>
    <template v-if="expanded">
      <el-alert v-if="error" :title="error" type="error" :closable="false" />
      <div class="ledger-records"><div v-for="row in rows" :key="row.id" class="ledger-record"><strong>{{ name(row.employeeId) }}</strong><span>{{ itemLabels[row.itemCode] }} · {{ recordedAmount(row) }}</span><span>{{ row.reference }}</span><span v-if="'reason' in row">{{ row.reason }}</span><el-button v-if="kind === 'opening'" link type="primary" :disabled="busy" @click="showOpeningHistory(row.id)">更正 / 历史</el-button></div><el-empty v-if="!rows.length" description="暂无确认记录" :image-size="48" /></div>
      <el-form label-position="top" class="ledger-form">
        <el-form-item label="员工" :error="fields.employeeId"><el-select v-model="form.employeeId" filterable :disabled="busy"><el-option v-for="person in employees" :key="person.id" :value="person.id" :label="`${person.name} ${person.employeeNo}`" /></el-select></el-form-item>
        <el-form-item label="工资项" :error="fields.itemCode"><el-select v-model="form.itemCode" :disabled="busy"><el-option v-for="(label, code) in itemLabels" :key="code" :value="code" :label="label" /></el-select></el-form-item>
        <el-form-item :label="kind === 'adjustment' ? '调整金额（可为负数）' : '该归属月已付税前金额'" :error="fields.amount"><el-input v-model="form.amount" inputmode="decimal" :disabled="busy" placeholder="待确认" /></el-form-item>
        <el-form-item v-if="kind === 'adjustment'" label="调整原因" :error="fields.reason"><el-input v-model="form.reason" :disabled="busy" maxlength="500" /></el-form-item>
        <el-form-item label="确认凭证" :error="fields.reference"><el-input v-model="form.reference" :disabled="busy" maxlength="200" /></el-form-item>
        <el-form-item><el-button type="primary" :loading="busy" @click="save">{{ kind === 'adjustment' ? '登记授权调整' : '登记历史已付' }}</el-button></el-form-item>
      </el-form>
    </template>
    <el-dialog v-model="historyVisible" title="历史已付登记更正" width="min(720px, calc(100vw - 24px))" :close-on-click-modal="!busy" :close-on-press-escape="!busy" :show-close="!busy" @closed="historySequence++">
      <el-alert v-if="correctionError" :title="correctionError" type="error" :closable="false" />
      <div v-loading="historyLoading" class="opening-history">
        <template v-if="history">
          <p class="opening-current"><strong>{{ name(history.employeeId) }} · {{ history.month }}</strong><span>{{ itemLabels[history.itemCode as PayrollItemCode] ?? history.itemCode }}</span><span>当前已付登记：{{ history.current.amount ?? '待确认' }}</span></p>
          <el-alert title="此处只更正历史已付的录入错误；已有审批、预留或付款的项目须走正常更正流程，实际支付记录不变。" type="warning" :closable="false" />
          <el-form v-if="history.current.confirmedAt" label-position="top" class="correction-form" @submit.prevent="correctOpening">
            <el-form-item label="更正后历史已付金额" :error="correctionFields.amount"><el-input v-model="correction.amount" inputmode="decimal" :disabled="busy" placeholder="待确认" /></el-form-item>
            <el-form-item label="更正确认凭证" :error="correctionFields.reference"><el-input v-model="correction.reference" :disabled="busy" maxlength="200" /></el-form-item>
            <el-form-item label="更正原因" :error="correctionFields.reason"><el-input v-model="correction.reason" type="textarea" :disabled="busy" maxlength="500" :rows="2" /></el-form-item>
            <el-button type="primary" :loading="busy" native-type="submit">保存登记更正</el-button>
          </el-form>
          <div v-for="version in history.versions" :key="version.id" class="opening-version">
            <div>{{ payrollTime(version.createdAt) }}</div>
            <dl v-for="change in openingAuditChanges(version.before, version.after)" :key="change.label" class="opening-change"><dt>{{ change.label }}</dt><dd><span>原值：{{ change.before }}</span><span>新值：{{ change.after }}</span></dd></dl>
            <p>更正原因：{{ version.reason }}</p>
          </div>
          <el-empty v-if="!history.versions.length" description="暂无更正记录" :image-size="48" />
        </template>
      </div>
      <template #footer><el-button :disabled="busy" @click="historyVisible = false">关闭</el-button></template>
    </el-dialog>
  </section>
</template>
<style scoped>
.ledger { margin-top: 12px; border-top: 1px solid var(--el-border-color-lighter); padding-top: 10px; }
.ledger-records { max-height: 200px; overflow: auto; margin: 10px 0; }
.ledger-record { display: flex; flex-wrap: wrap; gap: 8px 16px; border-bottom: 1px solid var(--el-border-color-lighter); padding: 8px 0; overflow-wrap: anywhere; }
.ledger-form { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 0 12px; }
.opening-history { min-height: 80px; max-height: 65vh; overflow: auto; overflow-wrap: anywhere; }
.opening-current { display: flex; flex-wrap: wrap; gap: 8px 16px; }
.correction-form { margin-top: 16px; }
.opening-version { padding: 12px 0; border-top: 1px solid var(--el-border-color-lighter); margin-top: 12px; }
.opening-change { margin: 8px 0; display: grid; grid-template-columns: 100px minmax(0,1fr); gap: 8px; }
.opening-change dd { margin: 0; display: flex; flex-direction: column; gap: 4px; }
@media(max-width:768px) { .ledger-form { grid-template-columns: minmax(0,1fr); } }
</style>
