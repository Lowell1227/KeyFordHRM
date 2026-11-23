<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import { ElMessageBox } from 'element-plus';
import { ArrowLeft, Plus, Refresh } from '@element-plus/icons-vue';
import BusinessDetailDrawer from '@/components/common/business-list/BusinessDetailDrawer.vue';
import MobileResultCard from '@/components/common/MobileResultCard.vue';
import { payrollApi, payrollError } from '@/api/payroll.api';
import type { PayrollBatch } from '@/types/payroll.types';
import type { PayrollReadinessDetail, PayrollReadinessRequest } from '@/types/payroll-readiness.types';
import PayrollNetResults from './PayrollNetResults.vue';
import { readinessBatchEligible, readinessDraftErrors } from './payroll-readiness-form';

const props = defineProps<{ modelValue: boolean; subjectId: string; batches: PayrollBatch[]; canSubmit: boolean; requestId?: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; select: [id: string]; changed: [] }>();
const rows = ref<PayrollReadinessRequest[]>([]), detail = ref<PayrollReadinessDetail>();
const creating = ref(false), loading = ref(false), busy = ref(false), confirming = ref(false), error = ref(''), note = ref(''), noteError = ref('');
const fields = ref<Record<string, string>>({});
const draft = reactive({ batchId: '', firstMonth: '', reference: '', requestId: '' });
const eligible = computed(() => props.batches.filter(readinessBatchEligible));
const labels = { pending: '待签收', returned: '已退回', withdrawn: '已撤回', approved: '已签收', revoked: '签收已撤销' };
const dirty = computed(() => !!note.value || (creating.value && !!(draft.batchId || draft.firstMonth || draft.reference)));
let sequence = 0, mounted = true, acceptedDiscard = '';
const valid = (n: number) => mounted && n === sequence && props.modelValue;
const editContext = () => JSON.stringify([props.subjectId, props.requestId, creating.value, draft, note.value]);
const actor = (id: string) => detail.value?.actors.find(row => row.id === id)?.name ?? '人员信息不可用';
const date = (value: string | null) => value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '';

async function load() {
  const n = ++sequence;
  acceptedDiscard = '';
  rows.value = []; detail.value = undefined; note.value = ''; noteError.value = ''; error.value = ''; creating.value = false;
  if (!props.modelValue || !props.subjectId) return;
  loading.value = true;
  try {
    if (props.requestId) {
      const data = await payrollApi.readinessRequest(props.requestId);
      if (valid(n)) {
        if (data.request.subjectId !== props.subjectId) throw new Error('签收记录不属于当前发薪主体');
        detail.value = data;
      }
    } else {
      const data = await payrollApi.readinessRequests(props.subjectId);
      if (valid(n)) rows.value = data;
    }
  } catch (cause) { const message = await payrollError(cause); if (valid(n)) error.value = message; }
  finally { if (valid(n)) loading.value = false; }
}
watch(() => [props.modelValue, props.subjectId, props.requestId], () => { void load(); }, { immediate: true });
onBeforeUnmount(() => { mounted = false; sequence++; });
async function discard() {
  if (!dirty.value) return true;
  const context = editContext(), n = sequence;
  if (context === acceptedDiscard) return true;
  try {
    await ElMessageBox.confirm('放弃尚未提交的内容？', '离开编辑', { confirmButtonText: '放弃修改', cancelButtonText: '继续编辑' });
    if (!valid(n) || context !== editContext()) return false;
    acceptedDiscard = context; return true;
  } catch { return false; }
}
async function mayNavigate() { return !props.modelValue || !busy.value && !confirming.value && await discard(); }
onBeforeRouteUpdate(mayNavigate);
onBeforeRouteLeave(mayNavigate);
async function close(value = false) {
  if (busy.value || (!value && !await discard())) return;
  emit('update:modelValue', value);
}
async function back() {
  if (busy.value || !await discard()) return;
  creating.value = false; note.value = ''; emit('select', '');
  if (!props.requestId) await load();
}
function create() {
  Object.assign(draft, { batchId: '', firstMonth: '', reference: '', requestId: crypto.randomUUID() });
  fields.value = {}; error.value = ''; creating.value = true;
}
async function submit() {
  fields.value = readinessDraftErrors(draft, props.batches); error.value = '';
  if (Object.keys(fields.value).length || busy.value) return;
  const batch = eligible.value.find(row => row.id === draft.batchId)!;
  const n = ++sequence; busy.value = true;
  try {
    const data = await payrollApi.submitReadiness({ ...draft, reference: draft.reference.trim(), expectedVersion: batch.version });
    if (!valid(n)) return;
    creating.value = false; emit('changed'); emit('select', data.request.id);
  } catch (cause) { const message = await payrollError(cause); if (valid(n)) error.value = message; }
  finally { busy.value = false; }
}
async function act(action: 'approve' | 'return' | 'withdraw' | 'revoke') {
  if (!detail.value || busy.value || confirming.value) return;
  const context = sequence;
  const target = detail.value.request;
  noteError.value = action !== 'approve' && !note.value.trim() ? '请填写原因' : note.value.length > 500 ? '请控制在500字以内' : '';
  if (noteError.value) return;
  if (action === 'approve' || action === 'revoke') {
    confirming.value = true;
    try { await ElMessageBox.confirm(action === 'approve' ? '按当前冻结的税后实发对账版本签收？' : '撤销后暂停新的正式工资办理，保留原签收及已付历史。继续？', action === 'approve' ? '签收对账结果' : '撤销首月签收', { confirmButtonText: action === 'approve' ? '签收' : '撤销签收', cancelButtonText: '取消', type: 'warning' }); } catch { return; }
    finally { confirming.value = false; }
    if (!valid(context) || detail.value?.request.id !== target.id || detail.value.request.version !== target.version) return;
  }
  const n = ++sequence; busy.value = true; error.value = '';
  try {
    const data = action === 'withdraw' ? await payrollApi.withdrawReadiness(target.id, target.version, note.value.trim())
      : action === 'revoke' ? await payrollApi.revokeReadiness(target.id, target.version, note.value.trim())
      : await payrollApi.decideReadiness(target.id, target.version, action, note.value.trim());
    if (!valid(n)) return;
    detail.value = data; note.value = ''; emit('changed');
  } catch (cause) { const message = await payrollError(cause); if (valid(n)) error.value = message; }
  finally { busy.value = false; }
}
</script>
<template>
  <BusinessDetailDrawer :model-value="modelValue" title="首月签收" variant="workflow" :saving="busy" :loading="loading" :before-close="() => close(false)" @update:model-value="close">
    <div class="readiness-toolbar">
      <el-button v-if="creating || requestId" :icon="ArrowLeft" :disabled="busy" @click="back">返回记录</el-button>
      <template v-else><el-button v-if="canSubmit" type="primary" :icon="Plus" :disabled="busy || loading" @click="create">提交对账签收</el-button><el-button :icon="Refresh" aria-label="刷新签收记录" :disabled="busy || loading" @click="load" /></template>
    </div>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <el-form v-if="creating" label-position="top" class="readiness-form">
      <el-form-item label="已核对的税后实发版本" :error="fields.batchId"><el-select v-model="draft.batchId" aria-label="签收对账版本" :disabled="busy" placeholder="请选择对账版本"><el-option v-for="batch in eligible" :key="batch.id" :value="batch.id" :label="`${batch.month} · 核算V${Math.max(...batch.versions.map(v => v.version))}`" /></el-select></el-form-item>
      <el-form-item label="首个正式工资月" :error="fields.firstMonth"><el-date-picker v-model="draft.firstMonth" type="month" value-format="YYYY-MM" :disabled="busy" /></el-form-item>
      <el-form-item label="核对依据" :error="fields.reference"><el-input v-model="draft.reference" type="textarea" :rows="3" maxlength="200" :disabled="busy" /></el-form-item>
    </el-form>
    <section v-else-if="detail" class="readiness-detail">
      <dl class="readiness-summary"><div><dt>对账工资月</dt><dd>{{ detail.request.month }} · V{{ detail.request.calculationVersion }}</dd></div><div><dt>首个正式工资月</dt><dd>{{ detail.request.firstMonth }}</dd></div><div><dt>状态</dt><dd>{{ labels[detail.request.status] }}</dd></div><div><dt>核对依据</dt><dd>{{ detail.request.reference }}</dd></div></dl>
      <PayrollNetResults :snapshot="detail.netSnapshot" :payments="[]" :can-pay="false" />
      <section class="readiness-history"><h3>签收记录</h3><el-timeline><el-timeline-item :timestamp="date(detail.request.submittedAt)">{{ actor(detail.request.submittedById) }} · 提交对账签收</el-timeline-item><el-timeline-item v-for="(item, index) in detail.request.decisions" :key="index" :timestamp="date(item.decidedAt)">{{ actor(item.actorId) }} · {{ item.decision === 'approve' ? '签收' : '退回' }}<p v-if="item.note">{{ item.note }}</p></el-timeline-item><el-timeline-item v-if="detail.request.closedAt" :timestamp="date(detail.request.closedAt)">{{ actor(detail.request.closedById ?? '') }} · {{ labels[detail.request.status] }}<p>{{ detail.request.closeNote }}</p></el-timeline-item></el-timeline></section>
      <section v-if="detail.canDecide || detail.canWithdraw || detail.canRevoke" class="readiness-action"><h3>{{ detail.canDecide ? (detail.request.approvalStep < detail.request.reviewerCount ? '当前环节：复核签收' : '当前环节：审批签收') : detail.canRevoke ? '撤销签收' : '申请操作' }}</h3><el-form-item :label="detail.canDecide ? '意见（签收选填，退回必填）' : '原因'" :error="noteError"><el-input v-model="note" type="textarea" :rows="2" maxlength="500" :disabled="busy" /></el-form-item></section>
    </section>
    <template v-else-if="!loading">
      <div class="readiness-desktop"><el-table :data="rows" empty-text="暂无首月签收记录"><el-table-column label="对账月 / 版本" min-width="145"><template #default="{row}">{{ row.month }} · V{{ row.calculationVersion }}</template></el-table-column><el-table-column prop="firstMonth" label="正式起始月" min-width="120" /><el-table-column label="状态" min-width="110"><template #default="{row}">{{ labels[row.status as keyof typeof labels] }}</template></el-table-column><el-table-column label="操作" width="90"><template #default="{row}"><el-button link type="primary" @click="emit('select', row.id)">查看签收</el-button></template></el-table-column></el-table></div>
      <div class="readiness-mobile"><MobileResultCard v-for="row in rows" :key="row.id"><template #title>{{ row.month }} · V{{ row.calculationVersion }}</template><template #status>{{ labels[row.status] }}</template><div>正式起始月：{{ row.firstMonth }}</div><template #actions><el-button link type="primary" @click="emit('select', row.id)">查看签收</el-button></template></MobileResultCard><el-empty v-if="!rows.length" description="暂无首月签收记录" /></div>
    </template>
    <template #footer>
      <el-button :disabled="busy" @click="close(false)">关闭</el-button>
      <el-button v-if="creating" type="primary" :loading="busy" @click="submit">提交签收</el-button>
      <template v-else-if="detail"><el-button v-if="detail.canWithdraw" :disabled="busy" @click="act('withdraw')">撤回</el-button><el-button v-if="detail.canDecide" :disabled="busy" @click="act('return')">退回</el-button><el-button v-if="detail.canDecide" type="primary" :loading="busy" @click="act('approve')">签收</el-button><el-button v-if="detail.canRevoke" type="danger" :loading="busy" @click="act('revoke')">撤销签收</el-button></template>
    </template>
  </BusinessDetailDrawer>
</template>
<style scoped>
.readiness-toolbar {display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;}
.readiness-form {margin-top:16px;max-width:640px;}
.readiness-form :deep(.el-select),.readiness-form :deep(.el-date-editor) {width:100%;}
.readiness-summary {display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin:16px 0;}
.readiness-summary div:last-child {grid-column:1/-1;} dt {font-size:12px;color:var(--el-text-color-secondary);} dd {margin:4px 0 0;overflow-wrap:anywhere;}
.readiness-history {margin-top:24px;} h3 {font-size:15px;margin:0 0 14px;}
.readiness-action {border-left:3px solid var(--el-color-primary);background:var(--el-fill-color-light);padding:16px;margin-top:16px;}
.readiness-history p {margin:6px 0 0;overflow-wrap:anywhere;}
.readiness-mobile {display:none;}
@media(max-width:768px){.readiness-desktop{display:none;}.readiness-mobile{display:grid;gap:10px;}.readiness-summary{grid-template-columns:repeat(2,minmax(0,1fr));}}
</style>
