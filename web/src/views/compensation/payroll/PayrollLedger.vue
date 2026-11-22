<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { payrollApi, payrollError } from '@/api/payroll.api';
import type { PayrollAdjustment, PayrollOpening, PayrollEmployee, PayrollItemCode } from '@/types/payroll.types';
import { isDecimal, itemLabels } from './payroll-state';
const props = defineProps<{ subjectId: string; month: string; employees: PayrollEmployee[]; kind: 'adjustment' | 'opening' }>();
const emit = defineEmits<{ changed: []; busy: [value: boolean] }>();
const rows = ref<Array<PayrollAdjustment | PayrollOpening>>([]);
const expanded = ref(false), busy = ref(false), error = ref('');
const fields = reactive<Record<string, string>>({});
const form = reactive({ employeeId: '', itemCode: '' as PayrollItemCode | '', amount: '', reason: '', reference: '' });
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
watch(() => [props.subjectId, props.month, props.kind], () => { Object.assign(form, { employeeId: '', itemCode: '', amount: '', reason: '', reference: '' }); expanded.value = false; void load(); }, { immediate: true });
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
    <el-button link type="primary" @click="expanded = !expanded">{{ kind === 'adjustment' ? '授权调整' : '期初入薪确认' }} · {{ month }}（{{ rows.length }}）</el-button>
    <template v-if="expanded">
      <el-alert v-if="error" :title="error" type="error" :closable="false" />
      <div class="ledger-records"><div v-for="row in rows" :key="row.id" class="ledger-record"><strong>{{ name(row.employeeId) }}</strong><span>{{ itemLabels[row.itemCode] }} · {{ recordedAmount(row) }}</span><span>{{ row.reference }}</span><span v-if="'reason' in row">{{ row.reason }}</span></div><el-empty v-if="!rows.length" description="暂无确认记录" :image-size="48" /></div>
      <el-form label-position="top" class="ledger-form">
        <el-form-item label="员工" :error="fields.employeeId"><el-select v-model="form.employeeId" filterable :disabled="busy"><el-option v-for="person in employees" :key="person.id" :value="person.id" :label="`${person.name} ${person.employeeNo}`" /></el-select></el-form-item>
        <el-form-item label="工资项" :error="fields.itemCode"><el-select v-model="form.itemCode" :disabled="busy"><el-option v-for="(label, code) in itemLabels" :key="code" :value="code" :label="label" /></el-select></el-form-item>
        <el-form-item :label="kind === 'adjustment' ? '调整金额（可为负数）' : '已确认税前累计金额'" :error="fields.amount"><el-input v-model="form.amount" inputmode="decimal" :disabled="busy" placeholder="待确认" /></el-form-item>
        <el-form-item v-if="kind === 'adjustment'" label="调整原因" :error="fields.reason"><el-input v-model="form.reason" :disabled="busy" maxlength="500" /></el-form-item>
        <el-form-item label="确认凭证" :error="fields.reference"><el-input v-model="form.reference" :disabled="busy" maxlength="200" /></el-form-item>
        <el-form-item><el-button type="primary" :loading="busy" @click="save">{{ kind === 'adjustment' ? '登记授权调整' : '确认期初金额' }}</el-button></el-form-item>
      </el-form>
    </template>
  </section>
</template>
<style scoped>
.ledger { margin-top: 12px; border-top: 1px solid var(--el-border-color-lighter); padding-top: 10px; }
.ledger-records { max-height: 200px; overflow: auto; margin: 10px 0; }
.ledger-record { display: flex; flex-wrap: wrap; gap: 8px 16px; border-bottom: 1px solid var(--el-border-color-lighter); padding: 8px 0; overflow-wrap: anywhere; }
.ledger-form { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 0 12px; }
@media(max-width:768px) { .ledger-form { grid-template-columns: minmax(0,1fr); } }
</style>
