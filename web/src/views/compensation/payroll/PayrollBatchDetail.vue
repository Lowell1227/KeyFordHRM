<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute } from 'vue-router';
import { ElMessageBox } from 'element-plus';
import { Refresh, Download } from '@element-plus/icons-vue';
import { useAuthStore } from '@/stores/auth.store';
import { payrollApi, payrollError } from '@/api/payroll.api';
import type { PayrollAccess, PayrollBatch, PayrollEmployee, PayrollOperator } from '@/types/payroll.types';
import { batchActions, currentVersion, subjectCapabilities, statusLabels, purposeLabels, batchStatus, needsUpdate, itemLabels, isDecimal, type BatchAction } from './payroll-state';

const props = defineProps<{ access?: PayrollAccess; allowExport?: boolean }>();
const emit = defineEmits<{ changed: []; busy: [boolean]; correct: [batch: PayrollBatch] }>();
const auth = useAuthStore(), route = useRoute();
const batch = ref<PayrollBatch>();
const employees = ref<PayrollEmployee[]>([]), operators = ref<PayrollOperator[]>([]);
const error = ref(''), success = ref(''), loading = ref(false), busy = ref(false);
const selectedVersion = ref<number>();
const action = ref<BatchAction>();
const note = ref(''), filePassword = ref(''), confirmedUnpaid = ref(false);
const lineId = ref(''), amount = ref(''), reference = ref('');
const fields = ref<Record<string, string>>({});
const settlementAttempt = ref<{ batchId: string; expectedVersion: number; lineId: string; amount: string; reference: string; requestId: string }>();
let sequence = 0;
const capabilities = computed(() => subjectCapabilities(props.access, batch.value?.subjectId ?? ''));
const readable = computed(() => capabilities.value.some(cap => ['payroll_edit', 'payroll_view', 'payroll_review', 'payroll_approve', 'payroll_export', 'payroll_settle'].includes(cap)));
const version = computed(() => batch.value?.versions.find(value => value.version === selectedVersion.value));
const isCurrent = computed(() => selectedVersion.value === (batch.value ? currentVersion(batch.value)?.version : undefined));
const actions = computed(() => batch.value && isCurrent.value && readable.value ? batchActions(batch.value, capabilities.value, auth.user?.id ?? '') : []);
const currentActor = computed(() => version.value?.approvalPath[version.value.approvalStep]);
const candidates = computed(() => (version.value?.lines ?? []).filter(line => line.status === 'ready' && line.amount !== null && line.reservation !== null));
const employeeName = (id: string) => employees.value.find(person => person.id === id)?.name
  ?? (version.value?.lines.find(line => line.employeeId === id)?.evidence as { employeeName?: string } | undefined)?.employeeName ?? id;
const operatorName = (id: string) => operators.value.find(person => person.id === id)?.name ?? (id === auth.user?.id ? auth.user.name : id);
const lineStatus = (status: string) => status === 'not_applicable' ? '不适用' : status === 'ready' ? '已核算' : status === 'needs_configuration' ? '待配置' : status;
function amountText(value: unknown) { const line = value as { status: string; amount: string | null }; return line.status === 'not_applicable' ? '不适用' : line.amount ?? '待核对 / 待配置'; }
const actionLabels: Record<BatchAction, string> = { calculate: '自动核算', submit: '提交复核', approve: '通过当前环节', return: '退回经办', withdraw: '撤回重算', export: '下载加密工资表', settle: '确认入薪', 'cancel-remainder': '取消剩余支付安排', void: '作废未付款版本', correct: '发起更正 / 补差' };

watch(busy, value => emit('busy', value));
async function mayLeave() {
  if (busy.value) return false;
  if (settlementAttempt.value) {
    try { await ElMessageBox.confirm('入薪请求结果尚未核实。离开会丢失本次重试标识，请先核对结算记录。仍要离开？', '待核实入薪请求', { confirmButtonText: '已核对并离开', cancelButtonText: '继续核对' }); return true; } catch { return false; }
  }
  if (!note.value && !amount.value && !reference.value) return true;
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
    const [people, actors] = await Promise.all([
      caps.some(cap => ['payroll_view', 'payroll_edit'].includes(cap)) ? payrollApi.employees(value.subjectId, value.month) : Promise.resolve([]),
      caps.includes('payroll_edit') ? payrollApi.operators(value.subjectId) : Promise.resolve([]),
    ]);
    if (request !== sequence) return;
    employees.value = people; operators.value = actors;
  } catch (cause) { if (request === sequence) error.value = await payrollError(cause); }
  finally { if (request === sequence) loading.value = false; }
}
watch(() => route.params.id, () => { clearAction(); void load(); }, { immediate: true });
function clearAction() { action.value = undefined; note.value = ''; filePassword.value = ''; confirmedUnpaid.value = false; lineId.value = ''; amount.value = ''; reference.value = ''; settlementAttempt.value = undefined; fields.value = {}; }
async function selectAction(value: BatchAction) {
  if (settlementAttempt.value) return;
  if (value === 'correct') { if (batch.value) emit('correct', batch.value); return; }
  if (action.value && (note.value || amount.value || reference.value) && !await mayLeave()) return;
  clearAction(); error.value = ''; success.value = '';
  if (value === 'calculate' || value === 'submit') { action.value = value; await run(); }
  else action.value = value;
}
async function cancelAction() { if (await mayLeave()) clearAction(); }
async function refresh() { if (!settlementAttempt.value) { if (!await mayLeave()) return; clearAction(); } await load(); }
async function download(id: string, expectedVersion: number, password: string) {
  const response = await payrollApi.export(id, expectedVersion, password);
  if (String(response.headers['content-type']).includes('application/json')) throw { response: { data: response.data } };
  const blob = response.data;
  if (!(blob instanceof Blob) || blob.size === 0) throw new Error('导出文件为空，请重试');
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  try {
    link.href = url;
    link.download = `${batch.value?.purpose === 'validation' ? '测试环境-' : ''}税前工资-${batch.value?.month}-V${currentVersion(batch.value!)?.version}.xlsx`;
    document.body.appendChild(link); link.click();
  } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
async function run() {
  const target = batch.value, selectedAction = action.value;
  if (!target || !selectedAction || busy.value) return;
  if (!actions.value.includes(selectedAction) && !settlementAttempt.value) { error.value = '当前版本或授权已变化，请刷新核对'; return; }
  fields.value = {}; error.value = ''; success.value = '';
  if (['return', 'withdraw', 'void'].includes(selectedAction) && !note.value.trim()) fields.value.note = '请填写办理原因和依据';
  if (selectedAction === 'void' && !confirmedUnpaid.value) fields.value.confirmedUnpaid = '请先核实该版本未付款';
  if (selectedAction === 'export' && (filePassword.value.length < 4 || filePassword.value.length > 64)) fields.value.filePassword = '请设置 4 至 64 位的独立文件密码';
  if (['settle', 'cancel-remainder'].includes(selectedAction) && !settlementAttempt.value) {
    if (!lineId.value) fields.value.lineId = '请选择工资行';
    if (!reference.value.trim()) fields.value.reference = '请填写付款或取消凭证';
    if (selectedAction === 'settle' && !isDecimal(amount.value, true)) fields.value.amount = '请填写明确的入薪金额';
  }
  if (Object.keys(fields.value).length) return;
  if (selectedAction === 'cancel-remainder') {
    try { await ElMessageBox.confirm('取消所选工资行的剩余支付安排？已确认入薪记录将保留。', '取消剩余安排', { confirmButtonText: '取消剩余安排', cancelButtonText: '返回' }); } catch { return; }
  }
  busy.value = true;
  try {
    let updated: PayrollBatch | undefined;
    switch (selectedAction) {
      case 'calculate': updated = await payrollApi.calculate(target.id, target.version); break;
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
      case 'cancel-remainder': updated = await payrollApi.cancelRemainder(target.id, target.version, lineId.value, reference.value.trim()); break;
      case 'export': await download(target.id, target.version, filePassword.value); break;
    }
    if (updated) { batch.value = updated; selectedVersion.value = currentVersion(updated)?.version; }
    success.value = selectedAction === 'export' ? '已下载当前批准版本，尚未确认入薪' : `${actionLabels[selectedAction]}已完成`;
    clearAction(); emit('changed');
  } catch (cause) {
    error.value = await payrollError(cause);
  } finally { filePassword.value = ''; busy.value = false; }
}
</script>
<template>
  <div v-loading="loading" class="payroll-detail" :aria-busy="busy">
    <el-alert v-if="error" :title="error" type="error" :closable="false" data-testid="payroll-action-error" />
    <el-alert v-if="success" :title="success" type="success" :closable="false" />
    <div class="detail-toolbar"><el-tooltip content="刷新批次与来源状态"><el-button :icon="Refresh" aria-label="刷新批次" :disabled="busy" @click="refresh" /></el-tooltip><el-select v-if="batch && readable" v-model="selectedVersion" aria-label="计算版本" :disabled="busy || !!action || !!settlementAttempt"><el-option v-for="row in batch.versions" :key="row.id" :value="row.version" :label="`第 ${row.version} 版 · ${statusLabels[row.status]}`" /></el-select></div>
    <template v-if="batch && readable">
      <dl class="summary-grid"><div><dt>用工主体</dt><dd>{{ access?.subjects.find(subject => subject.id === batch?.subjectId)?.name || batch.subjectId }}</dd></div><div><dt>工资归属月</dt><dd>{{ batch.month }}</dd></div><div><dt>发放月</dt><dd>{{ batch.payMonth }}</dd></div><div><dt>用途</dt><dd>{{ purposeLabels[batch.purpose] }}</dd></div><div><dt>状态</dt><dd>{{ batchStatus(batch) }}</dd></div><div><dt>税前应发</dt><dd>{{ version?.gross ?? '待核算' }}</dd></div><div v-if="batch.status === 'pending'"><dt>当前办理人</dt><dd>{{ currentActor ? operatorName(currentActor) : '待分配' }}</dd></div></dl>
      <el-alert v-if="needsUpdate(batch)" title="来源已更新，当前审批暂停。经办撤回或当前办理人退回后，重新核算并提交新版。" type="warning" :closable="false" />
      <el-alert v-if="!isCurrent" title="历史版本，只读" type="info" :closable="false" />
      <ul v-if="version?.issues.length" class="issue-list"><li v-for="(issue, index) in version.issues" :key="index">{{ issue }}</li></ul>
      <div class="payroll-lines-desktop"><el-table :data="version?.lines ?? []" row-key="id" empty-text="尚未核算"><el-table-column type="expand"><template #default="{ row }"><h4>入薪记录</h4><div v-for="record in row.settlements ?? []" :key="record.id" class="settlement-record">{{ record.amount }} · {{ record.reference }} · {{ record.createdAt }}</div><h4>计算与调整依据</h4><pre>{{ JSON.stringify(row.evidence, null, 2) }}</pre></template></el-table-column><el-table-column label="员工" min-width="130"><template #default="{ row }">{{ employeeName(row.employeeId) }}</template></el-table-column><el-table-column prop="attributionMonth" label="归属月" width="105" /><el-table-column label="工资项" width="110"><template #default="{ row }">{{ itemLabels[row.itemCode] || row.itemCode }}</template></el-table-column><el-table-column label="状态" min-width="110"><template #default="{ row }">{{ lineStatus(row.status) }}</template></el-table-column><el-table-column prop="entitlement" label="核定应发" min-width="110"><template #default="{ row }">{{ row.entitlement ?? '待配置' }}</template></el-table-column><el-table-column label="已确认入薪" min-width="110"><template #default="{ row }">{{ row.paidBefore ?? '待确认' }}</template></el-table-column><el-table-column label="本批待结" min-width="130"><template #default="{ row }">{{ amountText(row) }}</template></el-table-column></el-table></div>
      <div class="payroll-lines-mobile"><section v-for="line in version?.lines ?? []" :key="line.id" class="mobile-line"><strong>{{ employeeName(line.employeeId) }}</strong><span>{{ line.attributionMonth }} · {{ itemLabels[line.itemCode] || line.itemCode }}</span><span>{{ lineStatus(line.status) }} · 本批 {{ amountText(line) }}</span><span>核定 {{ line.entitlement ?? '待配置' }} · 已入薪 {{ line.paidBefore ?? '待确认' }}</span><div v-for="record in line.settlements ?? []" :key="record.id">已确认入薪 {{ record.amount }} · {{ record.reference }}</div><details><summary>计算与调整依据</summary><pre>{{ JSON.stringify(line.evidence, null, 2) }}</pre></details></section></div>
      <el-collapse class="trace-details"><el-collapse-item title="来源快照" name="sources"><div>校验标识：{{ version?.sourceHash }}</div><pre>{{ JSON.stringify(version?.sources, null, 2) }}</pre></el-collapse-item><el-collapse-item title="复核与审批记录" name="decisions"><ol><li v-for="(id, index) in version?.approvalPath ?? []" :key="index">{{ index < (version?.reviewerCount ?? 0) ? '复核' : '审批' }}：{{ operatorName(id) }}</li></ol><pre>{{ JSON.stringify(version?.decisions ?? [], null, 2) }}</pre></el-collapse-item><el-collapse-item title="导出记录（不代表已入薪）" name="exports"><pre>{{ JSON.stringify(version?.exports ?? [], null, 2) }}</pre></el-collapse-item><el-collapse-item title="更正与结算记录" name="events"><pre>{{ JSON.stringify(batch.events ?? [], null, 2) }}</pre></el-collapse-item></el-collapse>
      <section v-if="action" class="action-form">
        <h3>{{ actionLabels[action] }}</h3>
        <el-form label-position="top">
          <el-form-item v-if="['approve','return','withdraw','void'].includes(action)" label="办理意见与依据" :error="fields.note"><el-input v-model="note" type="textarea" :rows="3" maxlength="500" :disabled="busy" /></el-form-item>
          <el-form-item v-if="action === 'void'" :error="fields.confirmedUnpaid"><el-checkbox v-model="confirmedUnpaid" :disabled="busy">已核实此版本尚未付款</el-checkbox></el-form-item>
          <el-form-item v-if="action === 'export'" label="Excel 独立文件密码" :error="fields.filePassword"><el-input v-model="filePassword" type="password" show-password autocomplete="new-password" :disabled="busy" /></el-form-item>
          <template v-if="action === 'settle' || action === 'cancel-remainder'">
            <el-form-item label="工资行" :error="fields.lineId"><el-select v-model="lineId" filterable :disabled="busy || !!settlementAttempt"><el-option v-for="line in candidates" :key="line.id" :value="line.id" :label="`${employeeName(line.employeeId)} · ${line.attributionMonth} · ${itemLabels[line.itemCode] || line.itemCode} · ${line.amount}`" /></el-select></el-form-item>
            <el-form-item v-if="action === 'settle'" label="本次实际税前入薪金额" :error="fields.amount"><el-input v-model="amount" inputmode="decimal" :disabled="busy || !!settlementAttempt" /></el-form-item>
            <el-form-item label="财务凭证" :error="fields.reference"><el-input v-model="reference" maxlength="200" :disabled="busy || !!settlementAttempt" /></el-form-item>
            <el-alert v-if="settlementAttempt" title="本次请求结果待核实。重试将使用同一入薪请求标识与原始金额。" type="warning" :closable="false" />
          </template>
          <div class="form-actions"><el-button :disabled="busy" @click="cancelAction">取消办理</el-button><el-button type="primary" :loading="busy" @click="run">{{ settlementAttempt ? '重试同一入薪请求' : actionLabels[action] }}</el-button></div>
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
h3 { font-size: 16px; margin: 0 0 16px; } h4 { font-size: 14px; margin: 8px 12px; }
@media(max-width:768px) { .summary-grid { grid-template-columns: repeat(2,minmax(0,1fr)); } .payroll-lines-desktop { display: none; } .payroll-lines-mobile { display: grid; gap: 12px; } .mobile-line { display: grid; gap: 6px; border-bottom: 1px solid var(--el-border-color-lighter); padding-bottom: 12px; font-size: 13px; overflow-wrap: anywhere; } .batch-actions :deep(.el-button) { white-space: normal; height: auto; min-height: 32px; } }
</style>
