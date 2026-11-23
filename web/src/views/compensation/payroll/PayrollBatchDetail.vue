<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router';
import { ElMessageBox } from 'element-plus';
import { Refresh, Download } from '@element-plus/icons-vue';
import { useAuthStore } from '@/stores/auth.store';
import { payrollApi, payrollConflictBatchId, payrollError } from '@/api/payroll.api';
import type { PayrollAccess, PayrollBatch, PayrollEmployee, PayrollNetPaymentInput, PayrollOperator } from '@/types/payroll.types';
import { batchActions, currentVersion, subjectCapabilities, statusLabels, purposeLabels, batchStatus, needsUpdate, itemLabels, isDecimal, payrollPayDateError, payrollDownloadName, cancelledNetEmployeeIds, type BatchAction } from './payroll-state';
import PayrollDeductionsPreview from './PayrollDeductionsPreview.vue';
import PayrollNetResults from './PayrollNetResults.vue';

const props = defineProps<{ access?: PayrollAccess; allowExport?: boolean }>();
const emit = defineEmits<{ changed: []; busy: [boolean]; correct: [batch: PayrollBatch] }>();
const auth = useAuthStore(), route = useRoute(), router = useRouter();
const batch = ref<PayrollBatch>();
const employees = ref<PayrollEmployee[]>([]), operators = ref<PayrollOperator[]>([]);
const error = ref(''), success = ref(''), loading = ref(false), actionBusy = ref(false), deductionsBusy = ref(false);
const busy = computed(() => actionBusy.value || deductionsBusy.value);
const selectedVersion = ref<number>();
const action = ref<BatchAction>();
const note = ref(''), filePassword = ref(''), confirmedUnpaid = ref(false);
const lineId = ref(''), amount = ref(''), reference = ref('');
const calculationMode = ref<'gross' | 'net'>('net'), payDate = ref(''), employeeId = ref('');
const fields = ref<Record<string, string>>({});
const conflictingBatchId = ref('');
const settlementAttempt = ref<{ batchId: string; expectedVersion: number; lineId: string; amount: string; reference: string; requestId: string }>();
const netPaymentAttempt = ref<{batchId: string; body: PayrollNetPaymentInput}>();
const paymentPending = computed(() => !!settlementAttempt.value || !!netPaymentAttempt.value);
let sequence = 0;
onBeforeUnmount(() => { sequence++; });
const capabilities = computed(() => subjectCapabilities(props.access, batch.value?.subjectId ?? ''));
const readable = computed(() => capabilities.value.some(cap => ['payroll_edit', 'payroll_view', 'payroll_review', 'payroll_approve', 'payroll_export', 'payroll_settle'].includes(cap)));
const version = computed(() => batch.value?.versions.find(value => value.version === selectedVersion.value));
const isCurrent = computed(() => selectedVersion.value === (batch.value ? currentVersion(batch.value)?.version : undefined));
const showDeductionsPreview = computed(() => import.meta.env.VITE_PREVIEW_MODE === 'true' && capabilities.value.includes('payroll_edit')
  && batch.value && batch.value.purpose !== 'formal' && isCurrent.value && ['calculated', 'pending', 'approved'].includes(batch.value.status)
  && !needsUpdate(batch.value) && version.value && version.value.gross !== null && !version.value.issues.length
  && !version.value.netSnapshot
  && version.value.lines.length > 0 && version.value.lines.every(line => ['ready', 'not_applicable'].includes(line.status) && (line.status === 'not_applicable' || line.amount !== null)));
const actions = computed(() => batch.value && isCurrent.value && readable.value ? batchActions(batch.value, capabilities.value, auth.user?.id ?? '') : []);
const currentActor = computed(() => version.value?.approvalPath[version.value.approvalStep]);
const candidates = computed(() => (version.value?.lines ?? []).filter(line => line.status === 'ready' && line.amount !== null && line.reservation !== null));
const cancelledNetIds = computed(() => batch.value ? cancelledNetEmployeeIds(batch.value, version.value) : []);
const unpaidNetRows = computed(() => (version.value?.netSnapshot?.rows ?? []).filter(row => !cancelledNetIds.value.includes(row.employeeId)
  && !version.value?.netPayments?.some(payment => payment.employeeId === row.employeeId)));
const netCandidates = computed(() => unpaidNetRows.value.filter(row => row.result.status === 'ready'));
const selectedNetRow = computed(() => version.value?.netSnapshot?.rows.find(row => row.employeeId === employeeId.value));
const employeeName = (id: string) => employees.value.find(person => person.id === id)?.name
  ?? (version.value?.lines.find(line => line.employeeId === id)?.evidence as { employeeName?: string } | undefined)?.employeeName ?? id;
const operatorName = (id: string) => operators.value.find(person => person.id === id)?.name ?? (id === auth.user?.id ? auth.user.name : id);
const lineStatus = (status: string) => status === 'not_applicable' ? '不适用' : status === 'ready' ? '已核算' : status === 'needs_configuration' ? '待配置' : status;
function amountText(value: unknown) { const line = value as { status: string; amount: string | null }; return line.status === 'not_applicable' ? '不适用' : line.amount ?? '待核对 / 待配置'; }
const actionLabels = computed<Record<BatchAction, string>>(() => ({ calculate: calculationMode.value === 'net' ? '核算' : '自动核算', submit: '提交复核', approve: '通过当前环节', return: '退回经办', withdraw: '撤回重算', export: '下载加密工资表', settle: '确认入薪', 'net-payment': '确认实发与扣缴', 'cancel-net-remainder': '撤销未付安排', 'cancel-remainder': '取消剩余支付安排', void: '作废未付款版本', correct: '发起更正 / 补差' }));

watch(busy, value => emit('busy', value), { flush: 'sync' });
async function mayLeave() {
  if (busy.value) return false;
  if (paymentPending.value) {
    try { await ElMessageBox.confirm(`${netPaymentAttempt.value ? '实发与扣缴' : '入薪'}请求结果尚未核实。离开会丢失本次重试标识，请先核对结算记录。仍要离开？`, netPaymentAttempt.value ? '待核实实发与扣缴请求' : '待核实入薪请求', { confirmButtonText: '已核对并离开', cancelButtonText: '继续核对' }); return true; } catch { return false; }
  }
  if (!note.value && !amount.value && !reference.value && !payDate.value && !employeeId.value) return true;
  try { await ElMessageBox.confirm('放弃尚未提交的办理内容？', '离开办理', { confirmButtonText: '放弃修改', cancelButtonText: '继续办理' }); return true; } catch { return false; }
}
onBeforeRouteLeave(mayLeave); onBeforeRouteUpdate(mayLeave);
async function load() {
  const request = ++sequence, id = String(route.params.id ?? '');
  batch.value = undefined; employees.value = []; operators.value = []; error.value = ''; success.value = '';
  if (!id) return;
  loading.value = true;
  try {
    const value = await payrollApi.batch(id);
    if (request !== sequence) return;
    batch.value = value; selectedVersion.value = currentVersion(value)?.version;
    const caps = subjectCapabilities(props.access, value.subjectId);
    const [people, actors, profiles] = await Promise.all([
      caps.some(cap => ['payroll_view', 'payroll_edit'].includes(cap)) ? payrollApi.employees(value.subjectId, value.month) : Promise.resolve([]),
      caps.includes('payroll_edit') ? payrollApi.operators(value.subjectId) : Promise.resolve([]),
      caps.includes('payroll_edit') ? payrollApi.deductionProfiles(value.subjectId) : Promise.resolve([]),
    ]);
    if (request !== sequence) return;
    employees.value = people; operators.value = actors;
    if (!paymentPending.value) calculationMode.value = value.purpose === 'formal' || currentVersion(value)?.netSnapshot
      || profiles.some(profile => profile.status === 'active' && profile.settings.ledger && profile.payDate.slice(0, 7) === value.payMonth) ? 'net' : 'gross';
  } catch (cause) { const message = await payrollError(cause); if (request === sequence) error.value = message; }
  finally { if (request === sequence) loading.value = false; }
}
watch([() => route.params.id, () => props.access], ([id, access], previous) => {
  if (id !== previous?.[0]) clearAction();
  if (access && !busy.value && !action.value && !paymentPending.value) void load();
}, { immediate: true });
function clearAction() { action.value = undefined; note.value = ''; filePassword.value = ''; confirmedUnpaid.value = false; lineId.value = ''; amount.value = ''; reference.value = ''; payDate.value = ''; employeeId.value = ''; settlementAttempt.value = undefined; netPaymentAttempt.value = undefined; fields.value = {}; conflictingBatchId.value = ''; }
async function openConflictingBatch() {
  const id = conflictingBatchId.value;
  if (!id || !await mayLeave()) return;
  clearAction();
  await router.push({ path: `/payroll/batches/${encodeURIComponent(id)}`, query: route.query });
}
async function selectAction(value: BatchAction) {
  if (paymentPending.value || busy.value || loading.value || !actions.value.includes(value)) return;
  if (value === 'correct') { if (batch.value) emit('correct', batch.value); return; }
  if (action.value && !await mayLeave()) return;
  clearAction(); error.value = ''; success.value = '';
  if ((value === 'calculate' && calculationMode.value === 'gross' && batch.value?.purpose !== 'formal') || value === 'submit') { action.value = value; await run(); }
  else action.value = value;
}
async function selectNetPayment(id: string) {
  await selectAction('net-payment');
  if (action.value === 'net-payment' && !paymentPending.value) employeeId.value = id;
}
async function cancelAction() { if (await mayLeave()) clearAction(); }
async function refresh() { if (!paymentPending.value) { if (!await mayLeave()) return; clearAction(); } await load(); }
async function download(id: string, expectedVersion: number, password: string) {
  const response = await payrollApi.export(id, expectedVersion, password);
  if (String(response.headers['content-type']).includes('application/json')) throw { response: { data: response.data } };
  const blob = response.data;
  if (!(blob instanceof Blob) || blob.size === 0) throw new Error('导出文件为空，请重试');
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  try {
    link.href = url;
    link.download = payrollDownloadName(batch.value!);
    document.body.appendChild(link); link.click();
  } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
async function run() {
  const target = batch.value, selectedAction = action.value;
  if (!target || !selectedAction || busy.value || loading.value) return;
  const retryNet = selectedAction === 'net-payment' && netPaymentAttempt.value?.batchId === target.id && capabilities.value.includes('payroll_settle');
  if (!actions.value.includes(selectedAction) && !settlementAttempt.value && !retryNet) { error.value = '当前版本或授权已变化，请刷新核对'; return; }
  fields.value = {}; error.value = ''; success.value = '';
  if (['return', 'withdraw', 'void'].includes(selectedAction) && !note.value.trim()) fields.value.note = '请填写办理原因和依据';
  if (selectedAction === 'void' && !confirmedUnpaid.value) fields.value.confirmedUnpaid = '请先核实该版本未付款';
  if (selectedAction === 'export' && (filePassword.value.length < 4 || filePassword.value.length > 64)) fields.value.filePassword = '请设置 4 至 64 位的独立文件密码';
  if (selectedAction === 'calculate' && (calculationMode.value === 'net' || target.purpose === 'formal')) {
    const message = payrollPayDateError(payDate.value, target.payMonth);
    if (message) fields.value.payDate = message;
  }
  if (selectedAction === 'net-payment' && !netPaymentAttempt.value) {
    if (!netCandidates.value.some(row => row.employeeId === employeeId.value)) fields.value.employeeId = '请选择尚未确认付款的员工';
    if (!reference.value.trim()) fields.value.reference = '请填写财务凭证';
  }
  if (selectedAction === 'cancel-net-remainder') {
    if (!unpaidNetRows.value.some(row => row.employeeId === employeeId.value)) fields.value.employeeId = '请选择本版本尚未付款且未撤销安排的员工';
    if (!reference.value.trim()) fields.value.reference = '请填写财务凭证与撤销原因';
  }
  if (['settle', 'cancel-remainder'].includes(selectedAction) && !settlementAttempt.value) {
    if (!lineId.value) fields.value.lineId = '请选择工资行';
    if (!reference.value.trim()) fields.value.reference = '请填写付款或取消凭证';
    if (selectedAction === 'settle' && !isDecimal(amount.value, true)) fields.value.amount = '请填写明确的入薪金额';
  }
  if (Object.keys(fields.value).length) return;
  if (selectedAction === 'cancel-remainder') {
    try { await ElMessageBox.confirm('取消所选工资行的剩余支付安排？已确认入薪记录将保留。', '取消剩余安排', { confirmButtonText: '取消剩余安排', cancelButtonText: '返回' }); } catch { return; }
  }
  actionBusy.value = true;
  try {
    let updated: PayrollBatch | undefined;
    switch (selectedAction) {
      case 'calculate': updated = await payrollApi.calculate(target.id, target.version, calculationMode.value === 'net' || target.purpose === 'formal' ? payDate.value : undefined); break;
      case 'submit': updated = await payrollApi.submit(target.id, target.version); break;
      case 'approve': updated = await payrollApi.decide(target.id, target.version, 'approve', note.value.trim()); break;
      case 'return': updated = await payrollApi.decide(target.id, target.version, 'return', note.value.trim()); break;
      case 'withdraw': updated = await payrollApi.withdraw(target.id, target.version, note.value.trim()); break;
      case 'void':
        await payrollApi.void(target.id, target.version, note.value.trim(), confirmedUnpaid.value);
        batch.value = undefined;
        break;
      case 'settle': {
        settlementAttempt.value ??= { batchId: target.id, expectedVersion: target.version, lineId: lineId.value, amount: amount.value, reference: reference.value.trim(), requestId: crypto.randomUUID() };
        const attempt = settlementAttempt.value;
        updated = await payrollApi.settle(attempt.batchId, attempt.expectedVersion, { lineId: attempt.lineId, amount: attempt.amount, reference: attempt.reference, requestId: attempt.requestId });
        break;
      }
      case 'net-payment': {
        if (!netPaymentAttempt.value) {
          const row = selectedNetRow.value, approvedDate = version.value?.payDate?.slice(0, 10);
          if (!row || !approvedDate) throw new Error('当前批准实发结果不完整，请刷新核对');
          try { await ElMessageBox.confirm(`已按批准发薪日 ${approvedDate} 向 ${row.employeeName} 实际发放全部实发 ${row.result.net} 元，且社保、公积金及个税的实际扣缴情形与批准一致？`, '确认实发与扣缴', {confirmButtonText:'已实际发放且扣缴一致',cancelButtonText:'返回核对'}); } catch { return; }
          if (!actions.value.includes('net-payment')) throw new Error('当前版本或授权已变化，请刷新核对');
          netPaymentAttempt.value = {batchId: target.id, body: {expectedVersion:target.version, employeeId:row.employeeId, requestId:crypto.randomUUID(), reference:reference.value.trim(), payDate:approvedDate}};
        }
        const attempt = netPaymentAttempt.value;
        updated = await payrollApi.netPayment(attempt.batchId, attempt.body);
        break;
      }
      case 'cancel-net-remainder': {
        const row = unpaidNetRows.value.find(value => value.employeeId === employeeId.value);
        if (!row) throw new Error('该员工的未付安排已变化，请刷新核对');
        try { await ElMessageBox.confirm(`已核实 ${row.employeeName}（${row.employeeNo ?? ''}）尚未实际发放？仅撤销该员工未付的实发、扣缴及税前工资行安排，已付记录保持不变，原整表停止导出。`, '撤销未付安排', {confirmButtonText:'已核实未付，撤销安排',cancelButtonText:'返回核对'}); } catch { return; }
        if (!actions.value.includes('cancel-net-remainder') || !unpaidNetRows.value.some(value => value.employeeId === row.employeeId)) throw new Error('当前版本、人员安排或授权已变化，请刷新核对');
        updated = await payrollApi.cancelNetRemainder(target.id, {expectedVersion:target.version, employeeId:row.employeeId, reference:reference.value.trim()});
        break;
      }
      case 'cancel-remainder': updated = await payrollApi.cancelRemainder(target.id, target.version, lineId.value, reference.value.trim()); break;
      case 'export': await download(target.id, target.version, filePassword.value); break;
    }
    if (updated) { batch.value = updated; selectedVersion.value = currentVersion(updated)?.version; }
    success.value = selectedAction === 'export' ? (version.value?.netSnapshot ? '已下载批准版本；实发与扣缴记录未改变' : '已下载当前批准版本，尚未确认入薪') : `${actionLabels.value[selectedAction]}已完成`;
    clearAction(); emit('changed');
  } catch (cause) {
    error.value = await payrollError(cause);
    conflictingBatchId.value = selectedAction === 'submit' ? payrollConflictBatchId(cause) : '';
  } finally { filePassword.value = ''; actionBusy.value = false; }
}
</script>
<template>
  <div v-loading="loading" class="payroll-detail" :aria-busy="busy">
    <el-alert v-if="error" :title="error" type="error" :closable="false" data-testid="payroll-action-error" />
    <el-button v-if="conflictingBatchId" link type="primary" :disabled="busy" @click="openConflictingBatch">查看冲突批次</el-button>
    <el-alert v-if="success" :title="success" type="success" :closable="false" />
    <div class="detail-toolbar"><el-tooltip content="刷新批次与来源状态"><el-button :icon="Refresh" aria-label="刷新批次" :disabled="busy || loading" @click="refresh" /></el-tooltip><el-select v-if="batch && readable" v-model="selectedVersion" aria-label="计算版本" :disabled="busy || !!action || paymentPending"><el-option v-for="row in batch.versions" :key="row.id" :value="row.version" :label="`第 ${row.version} 版 · ${statusLabels[row.status]}`" /></el-select></div>
    <template v-if="batch && readable">
      <dl class="summary-grid"><div><dt>用工主体</dt><dd>{{ access?.subjects.find(subject => subject.id === batch?.subjectId)?.name || batch.subjectId }}</dd></div><div><dt>工资归属月</dt><dd>{{ batch.month }}</dd></div><div><dt>发放月</dt><dd>{{ batch.payMonth }}</dd></div><div><dt>用途</dt><dd>{{ purposeLabels[batch.purpose] }}</dd></div><div><dt>状态</dt><dd>{{ batchStatus(batch) }}</dd></div><div><dt>税前应发</dt><dd>{{ version?.gross ?? '待核算' }}</dd></div><div v-if="batch.status === 'pending'"><dt>当前办理人</dt><dd>{{ currentActor ? operatorName(currentActor) : '待分配' }}</dd></div></dl>
      <el-alert v-if="needsUpdate(batch)" :title="batch.status === 'approved'
        ? version?.netSnapshot ? '核算来源已变化或存在归属冲突，下载和新增实发与扣缴确认已暂停。请核对来源及实际已发已扣差异，原批准记录保留。' : '考勤来源存在跨月归属冲突，下载和新增入薪已暂停。请核对原月及已入薪差异，原批准记录保留。'
        : '来源已更新，当前审批暂停。经办撤回或当前办理人退回后，重新核算并提交新版。'" type="warning" :closable="false" />
      <el-alert v-if="!isCurrent" title="历史版本，只读" type="info" :closable="false" />
      <ul v-if="version?.issues.length" class="issue-list"><li v-for="(issue, index) in version.issues" :key="index">{{ issue }}</li></ul>
      <el-alert v-if="cancelledNetIds.length" title="部分未付安排已撤销，原整表停止导出，其余未撤销安排保留。" type="warning" :closable="false" />
      <PayrollNetResults v-if="version?.netSnapshot" :snapshot="version.netSnapshot" :payments="version.netPayments ?? []" :cancelled-ids="cancelledNetIds" :can-pay="isCurrent && actions.includes('net-payment')" :disabled="busy || loading || !!action || paymentPending" @pay="selectNetPayment" />
      <details :key="version?.id" :open="!version?.netSnapshot" class="gross-details"><summary>税前工资明细</summary>
      <div class="payroll-lines-desktop"><el-table :data="version?.lines ?? []" row-key="id" empty-text="尚未核算"><el-table-column type="expand"><template #default="{ row }"><h4>入薪记录</h4><div v-for="record in row.settlements ?? []" :key="record.id" class="settlement-record">{{ record.amount }} · {{ record.reference }} · {{ record.createdAt }}</div><h4>计算与调整依据</h4><pre>{{ JSON.stringify(row.evidence, null, 2) }}</pre></template></el-table-column><el-table-column label="员工" min-width="130"><template #default="{ row }">{{ employeeName(row.employeeId) }}</template></el-table-column><el-table-column prop="attributionMonth" label="归属月" width="105" /><el-table-column label="工资项" width="110"><template #default="{ row }">{{ itemLabels[row.itemCode] || row.itemCode }}</template></el-table-column><el-table-column label="状态" min-width="110"><template #default="{ row }">{{ lineStatus(row.status) }}</template></el-table-column><el-table-column prop="entitlement" label="核定应发" min-width="110"><template #default="{ row }">{{ row.entitlement ?? '待配置' }}</template></el-table-column><el-table-column label="已确认入薪" min-width="110"><template #default="{ row }">{{ row.paidBefore ?? '待确认' }}</template></el-table-column><el-table-column label="本批待结" min-width="130"><template #default="{ row }">{{ amountText(row) }}</template></el-table-column></el-table></div>
      <div class="payroll-lines-mobile"><section v-for="line in version?.lines ?? []" :key="line.id" class="mobile-line"><strong>{{ employeeName(line.employeeId) }}</strong><span>{{ line.attributionMonth }} · {{ itemLabels[line.itemCode] || line.itemCode }}</span><span>{{ lineStatus(line.status) }} · 本批 {{ amountText(line) }}</span><span>核定 {{ line.entitlement ?? '待配置' }} · 已入薪 {{ line.paidBefore ?? '待确认' }}</span><div v-for="record in line.settlements ?? []" :key="record.id">已确认入薪 {{ record.amount }} · {{ record.reference }}</div><details><summary>计算与调整依据</summary><pre>{{ JSON.stringify(line.evidence, null, 2) }}</pre></details></section></div>
      </details>
      <el-collapse class="trace-details"><el-collapse-item title="来源快照" name="sources"><div>校验标识：{{ version?.sourceHash }}</div><pre>{{ JSON.stringify(version?.sources, null, 2) }}</pre></el-collapse-item><el-collapse-item title="复核与审批记录" name="decisions"><ol><li v-for="(id, index) in version?.approvalPath ?? []" :key="index">{{ index < (version?.reviewerCount ?? 0) ? '复核' : '审批' }}：{{ operatorName(id) }}</li></ol><pre>{{ JSON.stringify(version?.decisions ?? [], null, 2) }}</pre></el-collapse-item><el-collapse-item title="导出记录（不代表已入薪）" name="exports"><pre>{{ JSON.stringify(version?.exports ?? [], null, 2) }}</pre></el-collapse-item><el-collapse-item title="更正与结算记录" name="events"><pre>{{ JSON.stringify(batch.events ?? [], null, 2) }}</pre></el-collapse-item></el-collapse>
      <PayrollDeductionsPreview v-if="showDeductionsPreview" :batch="batch" :disabled="actionBusy || loading || !!action || paymentPending" @busy="deductionsBusy = $event" />
      <el-radio-group v-if="actions.includes('calculate') && !action && batch.purpose !== 'formal'" v-model="calculationMode" aria-label="核算方式" :disabled="busy || loading"><el-radio-button value="gross">税前</el-radio-button><el-radio-button value="net">含扣缴实发</el-radio-button></el-radio-group>
      <section v-if="action" class="action-form" :data-testid="action === 'net-payment' ? 'payroll-net-payment-form' : action === 'cancel-net-remainder' ? 'payroll-net-cancel-form' : action === 'calculate' ? 'payroll-net-calculation-form' : undefined">
        <h3>{{ actionLabels[action] }}</h3>
        <el-form label-position="top">
          <template v-if="action === 'calculate'">
            <el-form-item label="核算发薪日" :error="fields.payDate"><el-input v-model="payDate" aria-label="核算发薪日" placeholder="YYYY-MM-DD" :disabled="busy" /></el-form-item>
            <p class="form-note">扣缴资料须已审核并设置累计台账；本次结果将随工资一同复核审批。</p>
          </template>
          <el-form-item v-if="['approve','return','withdraw','void'].includes(action)" label="办理意见与依据" :error="fields.note"><el-input v-model="note" type="textarea" :rows="3" maxlength="500" :disabled="busy" /></el-form-item>
          <el-form-item v-if="action === 'void'" :error="fields.confirmedUnpaid"><el-checkbox v-model="confirmedUnpaid" :disabled="busy">已核实此版本尚未付款</el-checkbox></el-form-item>
          <el-form-item v-if="action === 'export'" label="Excel 独立文件密码" :error="fields.filePassword"><el-input v-model="filePassword" type="password" show-password autocomplete="new-password" :disabled="busy" /></el-form-item>
          <template v-if="action === 'settle' || action === 'cancel-remainder'">
            <el-form-item label="工资行" :error="fields.lineId"><el-select v-model="lineId" filterable :disabled="busy || !!settlementAttempt"><el-option v-for="line in candidates" :key="line.id" :value="line.id" :label="`${employeeName(line.employeeId)} · ${line.attributionMonth} · ${itemLabels[line.itemCode] || line.itemCode} · ${line.amount}`" /></el-select></el-form-item>
            <el-form-item v-if="action === 'settle'" label="本次实际税前入薪金额" :error="fields.amount"><el-input v-model="amount" inputmode="decimal" :disabled="busy || !!settlementAttempt" /></el-form-item>
            <el-form-item label="财务凭证" :error="fields.reference"><el-input v-model="reference" maxlength="200" :disabled="busy || !!settlementAttempt" /></el-form-item>
            <el-alert v-if="settlementAttempt" title="本次请求结果待核实。重试将使用同一入薪请求标识与原始金额。" type="warning" :closable="false" />
          </template>
          <template v-if="action === 'net-payment'">
            <el-form-item label="员工" :error="fields.employeeId"><el-select v-if="!netPaymentAttempt" v-model="employeeId" aria-label="实发与扣缴员工" filterable :disabled="busy"><el-option v-for="row in netCandidates" :key="row.employeeId" :value="row.employeeId" :label="`${row.employeeName} ${row.employeeNo ?? ''}`"/></el-select><span v-else>{{ selectedNetRow?.employeeName }} {{ selectedNetRow?.employeeNo }}</span></el-form-item>
            <dl class="summary-grid"><div><dt>批准发薪日</dt><dd>{{ netPaymentAttempt?.body.payDate ?? version?.payDate?.slice(0, 10) }}</dd></div><div><dt>本次全部实发（元）</dt><dd>{{ selectedNetRow?.result.net ?? '请先选择员工' }}</dd></div></dl>
            <el-form-item label="财务凭证" :error="fields.reference"><el-input v-model="reference" maxlength="200" :disabled="busy || paymentPending"/></el-form-item>
            <p class="form-note">审批或导出不代表已发已扣；发薪日变化时，未付款版本须先作废重算，已付款差额走更正。</p>
            <el-alert v-if="netPaymentAttempt" title="实发与扣缴请求结果待核实。请刷新核对；重试保留同一请求标识、批准日期与完整实发金额。" type="warning" :closable="false"/>
          </template>
          <template v-if="action === 'cancel-net-remainder'">
            <el-form-item label="撤销未付员工" :error="fields.employeeId"><el-select v-model="employeeId" aria-label="撤销未付员工" filterable :disabled="busy"><el-option v-for="row in unpaidNetRows" :key="row.employeeId" :value="row.employeeId" :label="`${row.employeeName} ${row.employeeNo ?? ''}`"/></el-select></el-form-item>
            <el-form-item label="财务凭证与撤销原因" :error="fields.reference"><el-input v-model="reference" maxlength="200" :disabled="busy"/></el-form-item>
          </template>
          <div class="form-actions"><el-button :disabled="busy || loading" @click="cancelAction">取消办理</el-button><el-button type="primary" :loading="busy" :disabled="loading" @click="run">{{ netPaymentAttempt ? '重试同一实发与扣缴请求' : settlementAttempt ? '重试同一入薪请求' : actionLabels[action] }}</el-button></div>
        </el-form>
      </section>
      <div v-else class="batch-actions">
        <el-button v-for="item in actions.filter(value => value !== 'export' || allowExport)" :key="item" :type="['calculate','submit','approve'].includes(item) ? 'primary' : 'default'" :icon="item === 'export' ? Download : undefined" :disabled="busy || loading" @click="selectAction(item)">{{ actionLabels[item] }}</el-button>
      </div>
    </template>
    <el-empty v-else-if="!loading && !error" description="当前主体无工资查看权限" />
  </div>
</template>
<style scoped>
.payroll-detail { display: grid; gap: 14px; min-width: 0; }
.detail-toolbar, .batch-actions, .form-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.detail-toolbar :deep(.el-select) { width: 250px; max-width: calc(100% - 50px); }
.batch-actions { position: sticky; bottom: 0; background: var(--el-bg-color); border-top: 1px solid var(--el-border-color-light); padding: 12px 0; z-index: 2; }
.batch-actions :deep(.el-button + .el-button), .form-actions :deep(.el-button + .el-button) { margin-left: 0; }
.summary-grid { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 16px; margin: 0; }
dt { color: var(--el-text-color-secondary); font-size: 12px; } dd { margin: 5px 0 0; overflow-wrap: anywhere; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; background: var(--el-fill-color-light); padding: 12px; border-radius: 4px; }
.issue-list { padding: 12px 12px 12px 30px; color: var(--el-color-warning-dark-2); overflow-wrap: anywhere; margin: 0; }
.payroll-lines-desktop { min-width: 0; } .payroll-lines-mobile { display: none; }
.trace-details { min-width: 0; overflow-wrap: anywhere; }
.action-form { border-top: 1px solid var(--el-border-color-light); padding-top: 12px; }
.gross-details {min-width:0;} .gross-details > summary {cursor:pointer;font-size:13px;margin-bottom:10px;}
.form-note {font-size:13px;color:var(--el-text-color-secondary);line-height:1.6;overflow-wrap:anywhere;}
.action-form :deep(.el-form-item__error) {position:static;line-height:1.5;overflow-wrap:anywhere;}
.form-actions {margin-top:12px;}
h3 { font-size: 16px; margin: 0 0 16px; } h4 { font-size: 14px; margin: 8px 12px; }
@media(max-width:768px) { .summary-grid { grid-template-columns: repeat(2,minmax(0,1fr)); } .payroll-lines-desktop { display: none; } .payroll-lines-mobile { display: grid; gap: 12px; } .mobile-line { display: grid; gap: 6px; border-bottom: 1px solid var(--el-border-color-lighter); padding-bottom: 12px; font-size: 13px; overflow-wrap: anywhere; } .batch-actions :deep(.el-button) { white-space: normal; height: auto; min-height: 32px; } }
</style>
