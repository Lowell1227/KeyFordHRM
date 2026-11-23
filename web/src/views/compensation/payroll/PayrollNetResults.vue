<script setup lang="ts">
import { computed } from 'vue';
import MobileResultCard from '@/components/common/MobileResultCard.vue';
import type { PayrollDeductionsAmounts, PayrollNetPayment, PayrollNetRow, PayrollNetSnapshot, PayrollPurpose } from '@/types/payroll.types';
import PayrollCalculationEvidence from './PayrollCalculationEvidence.vue';
import { payrollTime } from './payroll-workflow-presentation';

const props = defineProps<{snapshot: PayrollNetSnapshot; payments: PayrollNetPayment[]; cancelledIds?: string[]; canPay: boolean; disabled?: boolean; purpose?: PayrollPurpose}>();
const reconciliation = computed(() => props.purpose === 'reconciliation');
const emit = defineEmits<{pay: [employeeId: string]}>();
const fields: Array<{key: keyof PayrollDeductionsAmounts; label: string}> = [
  {key:'gross',label:'税前应发'}, {key:'socialInsurance',label:'个人社保'}, {key:'housingFund',label:'个人公积金'},
  {key:'incomeTax',label:'个税'}, {key:'net',label:'实发'},
];
const statusLabels = {ready:'已核算',needs_configuration:'待配置',needs_review:'待核对'};
const payment = (id: string) => props.payments.find(row => row.employeeId === id);
const cancelled = (id: string) => props.cancelledIds?.includes(id) ?? false;
const rowStatus = (row: PayrollNetRow) => payment(row.employeeId) ? '已确认实发与扣缴' : cancelled(row.employeeId) ? '已撤销未付安排' : statusLabels[row.result.status];
const canPayRow = (row: PayrollNetRow) => props.canPay && !reconciliation.value && props.purpose !== 'trial' && !payment(row.employeeId) && !cancelled(row.employeeId) && row.result.status === 'ready';
</script>
<template>
  <section class="net-results" data-testid="payroll-net-results">
    <header><h3>{{ reconciliation ? '历史全额扣缴与实发对账' : '本批扣缴与实发' }}</h3><span>{{ reconciliation ? '历史实际发薪日' : '核算发薪日' }}：{{ snapshot.payDate }}</span></header>
    <p v-if="reconciliation" role="status">以下为历史全额对账值，不是本次待付余额，不生成付款或扣缴累计事实。</p>
    <div class="net-desktop">
      <el-table :data="snapshot.rows" row-key="employeeId" empty-text="暂无实发结果">
        <el-table-column type="expand"><template #default="{row}">
          <ul v-if="row.result.issues.length"><li v-for="(issue,index) in row.result.issues" :key="index">{{ issue }}</li></ul>
          <h4>累计台账依据</h4><dl v-if="row.ledger" class="ledger-fields"><div><dt>基准日</dt><dd>{{ row.ledger.openingDate }}</dd></div><div><dt>社保归属月</dt><dd>{{ row.ledger.socialMonth }}</dd></div><div><dt>公积金归属月</dt><dd>{{ row.ledger.housingMonth }}</dd></div></dl>
          <h4>扣缴计算依据</h4><PayrollCalculationEvidence :evidence="row.result.evidence" />
          <details><summary>高级追溯 · 累计台账</summary><pre>{{ JSON.stringify(row.ledger ?? {}, null, 2) }}</pre></details>
          <p v-if="payment(row.employeeId)">财务凭证：{{ payment(row.employeeId)?.reference }} · {{ payrollTime(payment(row.employeeId)?.createdAt) }}</p>
        </template></el-table-column>
        <el-table-column label="员工" min-width="130"><template #default="{row}"><div data-testid="payroll-net-row">{{ row.employeeName }}</div><small>{{ row.employeeNo }}</small></template></el-table-column>
        <el-table-column v-for="field in fields" :key="field.key" :label="`${field.label}（元）`" min-width="110" align="right"><template #default="{row}">{{ row.result[field.key] ?? statusLabels[row.result.status as keyof typeof statusLabels] }}</template></el-table-column>
        <el-table-column label="实发与扣缴" min-width="150"><template #default="{row}">
          <el-button v-if="canPayRow(row as PayrollNetRow)" link type="primary" :disabled="disabled" @click="emit('pay', row.employeeId)">确认实发与扣缴</el-button>
          <span v-else>{{ rowStatus(row as PayrollNetRow) }}</span>
        </template></el-table-column>
      </el-table>
    </div>
    <div class="net-mobile">
      <MobileResultCard v-for="row in snapshot.rows" :key="row.employeeId" data-testid="payroll-net-row">
        <template #title>{{ row.employeeName }} <small>{{ row.employeeNo }}</small></template>
        <template #status>{{ rowStatus(row) }}</template>
        <div v-for="field in fields" :key="field.key" class="amount-field"><span>{{ field.label }}</span><strong>{{ row.result[field.key] ?? statusLabels[row.result.status] }}</strong></div>
        <details><summary>累计台账与扣缴依据</summary><ul v-if="row.result.issues.length"><li v-for="(issue,index) in row.result.issues" :key="index">{{ issue }}</li></ul><dl v-if="row.ledger" class="ledger-fields"><div><dt>累计基准日</dt><dd>{{ row.ledger.openingDate }}</dd></div><div><dt>社保归属月</dt><dd>{{ row.ledger.socialMonth }}</dd></div><div><dt>公积金归属月</dt><dd>{{ row.ledger.housingMonth }}</dd></div></dl><PayrollCalculationEvidence :evidence="row.result.evidence" /><details><summary>高级追溯 · 累计台账</summary><pre>{{ JSON.stringify(row.ledger ?? {}, null, 2) }}</pre></details><p v-if="payment(row.employeeId)">财务凭证：{{ payment(row.employeeId)?.reference }} · {{ payrollTime(payment(row.employeeId)?.createdAt) }}</p></details>
        <template #actions><el-button v-if="canPayRow(row)" link type="primary" :disabled="disabled" @click="emit('pay', row.employeeId)">确认实发与扣缴</el-button></template>
      </MobileResultCard>
    </div>
    <dl v-if="snapshot.totals" class="net-totals" data-testid="payroll-net-totals"><div v-for="field in fields" :key="field.key"><dt>{{ field.label }}合计</dt><dd :data-testid="`payroll-net-total-${field.key}`">{{ snapshot.totals[field.key] }}</dd></div></dl>
    <p v-else role="status">部分人员待配置或待核对，暂无完整实发汇总</p>
  </section>
</template>
<style scoped>
.net-results {min-width:0;border-top:1px solid var(--el-border-color-light);padding-top:14px;}
header {display:flex;align-items:center;flex-wrap:wrap;gap:8px 16px;margin-bottom:12px;}
h3 {font-size:16px;margin:0;} h4 {font-size:14px;margin:8px 0;}
header span,small,dt {font-size:12px;color:var(--el-text-color-secondary);}
.net-desktop {min-width:0;} .net-desktop :deep(.cell) {overflow-wrap:anywhere;}
.net-mobile {display:none;} .net-totals,.ledger-fields {display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin:16px 0 0;}
.ledger-fields {grid-template-columns:repeat(3,minmax(0,1fr));}
dd {margin:5px 0 0;font-variant-numeric:tabular-nums;overflow-wrap:anywhere;}
pre {white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;background:var(--el-fill-color-light);padding:10px;}
p,li,details {overflow-wrap:anywhere;font-size:13px;} summary {cursor:pointer;}
.amount-field {display:flex;justify-content:space-between;gap:12px;font-size:13px;}.amount-field strong {font-weight:500;font-variant-numeric:tabular-nums;overflow-wrap:anywhere;}
@media(max-width:768px){.net-desktop{display:none;}.net-mobile{display:grid;gap:12px;}.net-totals{grid-template-columns:repeat(2,minmax(0,1fr));}}
</style>
