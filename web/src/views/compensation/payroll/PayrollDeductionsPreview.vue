<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import MobileResultCard from '@/components/common/MobileResultCard.vue';
import { payrollApi, payrollError } from '@/api/payroll.api';
import type { PayrollBatch, PayrollDeductionsAmounts, PayrollDeductionsPreviewMode, PayrollDeductionsPreviewResult, PayrollDeductionsPreviewRow } from '@/types/payroll.types';
import { currentVersion } from './payroll-state';

const props = defineProps<{ batch: PayrollBatch; disabled?: boolean }>();
const emit = defineEmits<{ busy: [boolean] }>();
const payDate = ref(''), mode = ref<PayrollDeductionsPreviewMode>('complete');
const dateError = ref(''), error = ref(''), pending = ref(false);
const result = ref<PayrollDeductionsPreviewResult>();
const fields: Array<{ key: keyof PayrollDeductionsAmounts; label: string }> = [
  { key: 'gross', label: '税前应发' }, { key: 'socialInsurance', label: '个人社保' },
  { key: 'housingFund', label: '个人公积金' }, { key: 'incomeTax', label: '个税' }, { key: 'net', label: '试算实发' },
];
const statusLabels = { ready: '试算完成', needs_configuration: '待配置', needs_review: '待核对' };
let sequence = 0, mounted = true;
function clearResult() { sequence++; result.value = undefined; dateError.value = ''; error.value = ''; }
watch(() => [payDate.value, mode.value, props.batch, props.batch.id, props.batch.version, props.batch.subjectId, props.batch.payMonth,
  props.batch.purpose, props.batch.status, props.batch.needsUpdate, currentVersion(props.batch)?.id,
  currentVersion(props.batch)?.version, currentVersion(props.batch)?.sourceHash, currentVersion(props.batch)?.needsUpdate], clearResult, { flush: 'sync' });
onBeforeUnmount(() => { mounted = false; clearResult(); if (pending.value) emit('busy', false); });

function validateDate() {
  if (!payDate.value) return '请选择试算发薪日';
  const date = new Date(`${payDate.value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payDate.value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== payDate.value) return '请输入有效的日历日期';
  if (payDate.value.slice(0, 7) !== props.batch.payMonth) return `试算发薪日须在本批发放月 ${props.batch.payMonth} 内`;
  return '';
}
function amount(row: PayrollDeductionsPreviewRow, key: keyof PayrollDeductionsAmounts) {
  return row[key] ?? (row.status === 'needs_configuration' ? '待配置' : '待核对');
}
async function calculate() {
  if (props.disabled || pending.value || props.batch.purpose === 'formal' || import.meta.env.VITE_PREVIEW_MODE !== 'true') return;
  result.value = undefined; error.value = ''; dateError.value = validateDate();
  if (dateError.value) return;
  const target = props.batch, version = currentVersion(target), request = ++sequence;
  if (!version) return;
  const body = { expectedVersion: target.version, payDate: payDate.value, mode: mode.value };
  pending.value = true; emit('busy', true);
  try {
    const value = await payrollApi.deductionsPreview(target.id, body);
    if (!mounted || request !== sequence) return;
    if (value.batchId !== target.id || value.batchVersion !== target.version || value.subjectId !== target.subjectId
      || value.calculationVersionId !== version.id || value.calculationVersion !== version.version || value.sourceHash !== version.sourceHash
      || value.payMonth !== target.payMonth || value.payDate !== body.payDate || value.mode !== body.mode
      || value.basis !== 'fictional' || value.approvalStatus !== 'not_submitted') {
      error.value = '批次或试算依据已变化，请刷新后重试'; return;
    }
    result.value = value;
  } catch (cause) {
    const message = await payrollError(cause);
    if (mounted && request === sequence) error.value = message;
  } finally { pending.value = false; if (mounted) emit('busy', false); }
}
</script>

<template>
  <section class="deductions-preview" data-testid="payroll-deductions-preview" :aria-busy="pending">
    <header class="preview-heading"><h3>扣缴与实发试算</h3><span class="preview-status">虚构试算 · 实发未审批</span></header>
    <el-form class="preview-form" label-position="top" @submit.prevent="calculate">
      <el-form-item label="试算发薪日" :error="dateError" class="preview-date">
        <el-input v-model="payDate" aria-label="试算发薪日" placeholder="YYYY-MM-DD" :disabled="disabled" :aria-invalid="!!dateError" @blur="dateError = payDate ? validateDate() : ''" />
      </el-form-item>
      <el-form-item label="试算参数" class="preview-mode">
        <el-radio-group v-model="mode" aria-label="试算参数" :disabled="disabled">
          <el-radio-button value="complete">示例参数</el-radio-button><el-radio-button value="missing">缺项检查</el-radio-button><el-radio-button value="saved">已审核资料</el-radio-button>
        </el-radio-group>
      </el-form-item>
      <el-form-item class="preview-submit"><el-button type="primary" :disabled="disabled || pending" :loading="pending" @click="calculate">试算</el-button></el-form-item>
    </el-form>
    <p v-if="error" role="alert" class="preview-error">{{ error }}</p>
    <template v-if="result">
      <div data-testid="payroll-deductions-preview-rows">
        <div class="preview-desktop">
          <el-table :data="result.rows" row-key="employeeId" empty-text="暂无试算人员">
            <el-table-column label="员工" min-width="150"><template #default="{ row }"><span data-testid="payroll-deductions-preview-row">{{ row.employeeName }}</span></template></el-table-column>
            <el-table-column label="状态" min-width="105"><template #default="{ row }">{{ statusLabels[row.status as PayrollDeductionsPreviewRow['status']] }}</template></el-table-column>
            <el-table-column v-for="field in fields" :key="field.key" :label="`${field.label}（元）`" min-width="120" align="right"><template #default="{ row }">{{ amount(row as PayrollDeductionsPreviewRow, field.key) }}</template></el-table-column>
            <el-table-column label="依据" min-width="150"><template #default="{ row }"><details><summary>虚构计算依据</summary><ul v-if="row.issues.length"><li v-for="(issue, index) in row.issues" :key="index">{{ issue }}</li></ul><pre>{{ JSON.stringify(row.evidence, null, 2) }}</pre></details></template></el-table-column>
          </el-table>
        </div>
        <div class="preview-mobile">
          <MobileResultCard v-for="row in result.rows" :key="row.employeeId" data-testid="payroll-deductions-preview-row">
            <template #title>{{ row.employeeName }}</template><template #status>{{ statusLabels[row.status] }}</template>
            <div v-for="field in fields" :key="field.key" class="mobile-result-field"><span class="mobile-result-field__label">{{ field.label }}</span><span class="mobile-result-field__value">{{ amount(row, field.key) }}</span></div>
            <details><summary>虚构计算依据</summary><ul v-if="row.issues.length"><li v-for="(issue, index) in row.issues" :key="index">{{ issue }}</li></ul><pre>{{ JSON.stringify(row.evidence, null, 2) }}</pre></details>
          </MobileResultCard>
        </div>
      </div>
      <section v-if="result.totals" class="preview-totals" data-testid="payroll-deductions-preview-totals">
        <h4>虚构试算汇总（元）</h4><dl><div v-for="field in fields" :key="field.key"><dt>{{ field.label }}</dt><dd :data-testid="`payroll-deductions-preview-total-${field.key}`">{{ result.totals[field.key] }}</dd></div></dl>
      </section>
      <p v-else class="preview-incomplete" role="status">部分人员待配置或待核对，暂无完整汇总</p>
    </template>
  </section>
</template>

<style scoped>
.deductions-preview { min-width: 0; border-top: 1px solid var(--el-border-color-light); padding-top: 16px; }
.preview-heading { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; margin-bottom: 14px; }
h3 { font-size: 16px; margin: 0; } h4 { font-size: 14px; margin: 0 0 12px; }
.preview-status, .preview-incomplete { font-size: 13px; color: var(--el-color-warning-dark-2); overflow-wrap: anywhere; }
.preview-form { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px 16px; }
.preview-date { width: 240px; max-width: 100%; padding-bottom: 14px; }
.preview-mode { min-width: 0; } .preview-submit { padding-top: 30px; }
.preview-date :deep(.el-form-item__error) { position: static; }
.preview-error { color: var(--el-color-danger); font-size: 13px; margin: 0 0 12px; overflow-wrap: anywhere; }
.preview-desktop { min-width: 0; } .preview-desktop :deep(.cell) { overflow-wrap: anywhere; }
.preview-mobile { display: none; }
.preview-totals { padding-top: 16px; }
.preview-totals dl { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 14px; margin: 0; }
dt { font-size: 12px; color: var(--el-text-color-secondary); } dd { margin: 6px 0 0; font-size: 14px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
summary { cursor: pointer; font-size: 13px; } details, pre, li { overflow-wrap: anywhere; }
pre { white-space: pre-wrap; max-width: 100%; font-size: 12px; background: var(--el-fill-color-light); padding: 8px; }
@media(max-width:768px) {
  .preview-form { display: grid; gap: 0; } .preview-date { width: 100%; }
  .preview-submit { padding-top: 0; } .preview-desktop { display: none; } .preview-mobile { display: grid; gap: 12px; }
  .preview-totals dl { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
