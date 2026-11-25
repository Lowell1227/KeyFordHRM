<script setup lang="ts">
import { onBeforeUnmount, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Plus, Refresh } from '@element-plus/icons-vue';
import { ElMessageBox } from 'element-plus';
import { useAuthStore } from '@/stores/auth.store';
import { useTalentPermissions } from '@/views/talent/useTalentPermissions';
import { useRecruitmentLeaveGuard } from '@/views/talent/useRecruitmentLeaveGuard';
import { recruitmentPostingsApi } from '@/api/recruitment-postings.api';
import { recruitmentDemandsApi } from '@/api/recruitment-demands.api';
import { talentRecruitmentApi } from '@/api/talent-recruitment.api';
import type { PostingFields, RecruitmentPosting } from '@/types/recruitment-intake.types';
import type { RecruitmentDemandView } from '@/types/recruitment-demand.types';
import type { TalentRecruitmentOwner } from '@/types/talent.types';
import { intakeError, intakeEventLabel, intakeMappingHistory, safePostingUrl, validatePosting } from '../intake-presentation';
import { demandOriginLabel, demandReference } from '../demand-presentation';
import { formatDate } from '@/utils/date';
import ListPagination from '@/components/common/ListPagination.vue';
import { usePagination } from '@/composables/usePagination';

const props = defineProps<{ demand: RecruitmentDemandView }>();
const router = useRouter(), auth = useAuthStore(), { canEdit } = useTalentPermissions();
const rows = ref<RecruitmentPosting[]>([]), loading = ref(false), error = ref(''), opened = ref(false), saving = ref(false);
const current = ref<RecruitmentPosting | null>(null), demands = ref<RecruitmentDemandView[]>([]), owners = ref<TalentRecruitmentOwner[]>([]);
const form = reactive<PostingFields>({ demandId: '', ownerId: '', channel: '', name: '', url: '', externalId: '', verifiedIdentity: false, evidence: '', active: true });
const errors = ref<Record<string, string>>({}), reason = ref(''), conflict = ref(false), unknown = ref(false);
const intent = ref<(PostingFields & { requestId: string }) | null>(null);
const { page, pageSize, total, pageSizeOptions } = usePagination({ defaultPageSize: 10 });
let epoch = 0, formEpoch = 0, expectedRevision = 0;
const leave = useRecruitmentLeaveGuard({ dirty: () => opened.value || unknown.value, busy: () => saving.value, discard: () => { if (!unknown.value) opened.value = false; } });
async function list() {
  if (!canEdit.value) return;
  const token = ++epoch; loading.value = true; error.value = '';
  try { const result = await recruitmentPostingsApi.list({ demandId: props.demand.id, page: page.value, pageSize: pageSize.value }); if (token !== epoch || !canEdit.value) return; rows.value = result.items; total.value = result.total; }
  catch (cause) { if (token === epoch) error.value = intakeError(cause); }
  finally { if (token === epoch) loading.value = false; }
}
async function loadOwners(keyword = '') {
  const token = formEpoch;
  try { const result = await talentRecruitmentApi.owners({ keyword, pageSize: 50 }); if (token === formEpoch && canEdit.value) owners.value = result.items; }
  catch (cause) { if (token === formEpoch) error.value = intakeError(cause); }
}
async function loadDemands(keyword = '') {
  const token = formEpoch;
  try { const result = await recruitmentDemandsApi.list({ status: 'approved', keyword: keyword || undefined, page: 1, pageSize: 20 }); if (token === formEpoch && canEdit.value) demands.value = result.items.filter(row => row.usable); }
  catch (cause) { if (token === formEpoch) error.value = intakeError(cause); }
}
async function edit(row?: RecruitmentPosting) {
  if (!canEdit.value || saving.value) return;
  if (unknown.value && intent.value) { opened.value = true; return; }
  if (!row && !props.demand.usable) return;
  if (!await leave.prepareToLeave()) return;
  ++formEpoch; current.value = row || null; expectedRevision = row?.revision || 0;
  Object.assign(form, { demandId: row?.demandId || props.demand.id, ownerId: row?.ownerId || auth.user?.id || '', channel: row?.channel || '', name: row?.name || '', url: row?.url || '',
    externalId: row?.externalId || '', verifiedIdentity: row?.verifiedIdentity || false, evidence: row?.evidence || '', active: row?.active ?? true });
  reason.value = ''; errors.value = {}; error.value = ''; conflict.value = false; unknown.value = false; intent.value = null; opened.value = true;
  await Promise.all([loadOwners(), loadDemands()]);
  if (row) {
    const token = formEpoch;
    try { const result = await recruitmentPostingsApi.detail(row.id); if (token === formEpoch && canEdit.value) current.value = result; }
    catch (cause) { if (token === formEpoch) { conflict.value = true; error.value = intakeError(cause); } }
  }
}
async function save() {
  if (!canEdit.value || saving.value || conflict.value || !opened.value) return;
  errors.value = validatePosting(form); if (current.value && !reason.value.trim()) errors.value.reason = '请填写修改或更换归属的原因';
  if (Object.keys(errors.value).length) return;
  const token = formEpoch, previous = current.value;
  if (!previous && !intent.value) intent.value = { ...form, requestId: crypto.randomUUID() };
  if (previous && previous.demandId !== form.demandId) {
    try { await ElMessageBox.confirm('更换后新收件使用新需求归属；已关联应聘、录用快照和名额记录不变。是否按当前核对结果更换？', '更换职位归属', { confirmButtonText: '已核对，更换归属', cancelButtonText: '保留原归属', type: 'warning' }); }
    catch { return; }
    if (token !== formEpoch || !canEdit.value || saving.value) return;
  }
  saving.value = true; error.value = '';
  try {
    const saved = previous ? await recruitmentPostingsApi.update(previous.id, { ...form, expectedRevision, reason: reason.value.trim() }) : await recruitmentPostingsApi.create({ ...intent.value! });
    if (token !== formEpoch || !canEdit.value) return;
    unknown.value = false; intent.value = null; opened.value = false; current.value = saved; await list();
  } catch (cause) {
    if (token !== formEpoch) return;
    const status = (cause as { response?: { status?: number } }).response?.status;
    unknown.value = !status || status >= 500; conflict.value = [403, 404, 409].includes(status || 0) || (unknown.value && !!previous);
    error.value = unknown.value ? '暂不能确认保存结果，原输入及本次请求已保留。请核对本次结果，不要重复登记。' : intakeError(cause);
    if (!unknown.value && !previous && status !== 409) intent.value = null;
  } finally { if (token === formEpoch) saving.value = false; }
}
async function reconfirm() {
  const row = current.value; if (!row || !canEdit.value || saving.value) return;
  const token = formEpoch;
  try {
    const latest = await recruitmentPostingsApi.detail(row.id);
    if (token !== formEpoch || !canEdit.value) return;
    await ElMessageBox.confirm(`已读取版本 ${latest.revision}。请核对原归属和输入，保留当前输入继续修改吗？`, '核对职位新版本', { confirmButtonText: '已核对，保留输入', cancelButtonText: '暂不继续', type: 'warning' });
    if (token !== formEpoch || !canEdit.value) return;
    current.value = latest; expectedRevision = latest.revision; conflict.value = false; unknown.value = false; error.value = '';
  } catch (cause) { if (token === formEpoch) { conflict.value = true; error.value = intakeError(cause); } }
}
async function close(done?: () => void) {
  if (saving.value) return;
  if (unknown.value) { opened.value = false; done?.(); return; }
  if (await leave.prepareToLeave()) { opened.value = false; done?.(); }
}
function intake(posting?: RecruitmentPosting) { if (canEdit.value) void router.push({ path: '/recruitment/intakes', query: { demandId: props.demand.id, ...(posting ? { postingId: posting.id } : {}) } }); }
watch([() => props.demand.id, () => auth.user?.id, canEdit], () => { ++epoch; ++formEpoch; rows.value = []; total.value = 0; page.value = 1; opened.value = false; current.value = null; intent.value = null; unknown.value = false; saving.value = false; if (canEdit.value) void list(); }, { immediate: true });
onBeforeUnmount(() => { ++epoch; ++formEpoch; });
</script>

<template>
  <section v-if="canEdit" class="posting-panel" aria-label="外部职位与收件"><header><h3>外部职位与收件</h3><div class="actions"><el-button :icon="Plus" :disabled="!demand.usable || saving" @click="edit()">{{ unknown ? '恢复本次登记' : '登记外部职位' }}</el-button><el-button :disabled="!demand.usable" @click="intake()">查看对应简历收件</el-button><el-tooltip content="刷新外部职位"><el-button :icon="Refresh" aria-label="刷新外部职位" :loading="loading" @click="list" /></el-tooltip></div></header>
    <el-alert v-if="error && !opened" :title="error" type="error" :closable="false" />
    <p v-if="!loading && !rows.length" class="muted">暂无关联外部职位</p>
    <ul class="posting-list"><li v-for="row in rows" :key="row.id"><strong>{{ row.channel }} · {{ row.name }}</strong><span>{{ row.active ? '使用中' : '已停用' }} · {{ row.verifiedIdentity ? '身份已核实' : '身份待核实，仅作线索' }} · {{ row.ownerName || '经办待核对' }}</span><a v-if="safePostingUrl(row.url)" :href="safePostingUrl(row.url)" target="_blank" rel="noopener noreferrer">查看外部职位</a><div class="actions"><el-button link type="primary" @click="edit(row)">查看 / 修改归属</el-button><el-button link type="primary" @click="intake(row)">登记该职位收件</el-button></div></li></ul>
    <ListPagination v-if="total" v-model:current-page="page" v-model:page-size="pageSize" :page-sizes="pageSizeOptions" :total="total" @change="list" />
    <el-dialog v-model="opened" :title="current ? '核对外部职位' : '登记外部职位'" width="min(620px, 96vw)" :close-on-click-modal="false" :close-on-press-escape="!saving" :show-close="!saving" :before-close="close" class="posting-dialog">
      <el-alert v-if="error" :title="error" type="error" :closable="false" /><el-button v-if="conflict && current" link type="primary" :disabled="saving" @click="reconfirm">读取新版本并保留输入</el-button>
      <p v-if="current" class="muted">当前归属：{{ current.demandId }} · 版本 {{ current.revision }}</p>
      <el-form label-position="top" :disabled="saving || conflict || unknown" @submit.prevent="save">
        <el-form-item label="内部招聘需求" required :error="errors.demandId"><el-select :fit-input-width="true" v-model="form.demandId" filterable remote :remote-method="loadDemands" aria-label="外部职位所属需求"><el-option v-for="item in demands" :key="item.id" :value="item.id" :label="`${demandOriginLabel(item)} · ${demandReference(item)} · ${item.departmentName} / ${item.positionName}`" /></el-select></el-form-item>
        <div class="form-grid"><el-form-item label="渠道" required :error="errors.channel"><el-input v-model="form.channel" maxlength="80" aria-label="外部职位渠道" /></el-form-item><el-form-item label="外部职位名称" required :error="errors.name"><el-input v-model="form.name" maxlength="200" aria-label="外部职位名称" /></el-form-item></div>
        <el-form-item label="职位链接" required :error="errors.url"><el-input v-model="form.url" maxlength="2000" aria-label="外部职位链接" /></el-form-item><el-form-item label="稳定外部职位ID（如已核实）" :error="errors.externalId"><el-input v-model="form.externalId" maxlength="200" aria-label="稳定外部职位ID" /></el-form-item>
        <el-form-item label="经办负责人" required :error="errors.ownerId"><el-select :fit-input-width="true" v-model="form.ownerId" filterable remote :remote-method="loadOwners" aria-label="外部职位负责人"><el-option v-if="auth.user" :value="auth.user.id" :label="auth.user.name" /><el-option v-for="owner in owners.filter(item => item.id !== auth.user?.id)" :key="owner.id" :value="owner.id" :label="owner.name" /></el-select></el-form-item>
        <el-form-item><el-checkbox v-model="form.verifiedIdentity">已核对该渠道职位ID或唯一链接，确认职位身份及归属</el-checkbox></el-form-item><el-form-item label="身份核实依据" :required="form.verifiedIdentity" :error="errors.evidence"><el-input v-model="form.evidence" type="textarea" :rows="2" maxlength="2000" aria-label="身份核实依据" /></el-form-item>
        <el-form-item><el-switch v-model="form.active" active-text="用于新收件" /></el-form-item><el-form-item v-if="current" label="修改 / 更换归属原因" required :error="errors.reason"><el-input v-model="reason" type="textarea" :rows="2" maxlength="2000" aria-label="更换归属原因" /></el-form-item>
      </el-form>
      <el-collapse v-if="current?.events?.length"><el-collapse-item title="职位归属历史" name="history"><el-timeline><el-timeline-item v-for="(event, index) in current.events" :key="event.id" :timestamp="formatDate(event.createdAt)">{{ event.actorName || '系统' }} · {{ intakeEventLabel(event.action) }} · 版本 {{ event.revision }}<p>{{ event.reason }}</p><div v-for="mapping in intakeMappingHistory(event, current.events[index - 1])" :key="mapping.label"><span>{{ mapping.label }}：</span><el-button v-if="mapping.target" link type="primary" @click="mapping.target && router.push(mapping.target)">{{ mapping.reference }}</el-button><span v-else>{{ mapping.reference }}</span></div></el-timeline-item></el-timeline></el-collapse-item></el-collapse>
      <template #footer><el-button :disabled="saving" @click="close()">{{ unknown ? '关闭，保留本次' : '取消' }}</el-button><el-button type="primary" :loading="saving" :disabled="conflict || !canEdit" @click="save">{{ unknown && !current ? '核对本次登记结果' : '保存职位归属' }}</el-button></template>
    </el-dialog>
  </section>
</template>

<style scoped>
.posting-panel { min-width: 0; }.posting-panel header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
h3 { font-size: 14px; margin: 0; }.muted { font-size: 12px; color: var(--el-text-color-secondary); overflow-wrap: anywhere; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; }.posting-list { padding: 0; margin: 12px 0; list-style: none; }.posting-list li { padding: 12px 0; border-bottom: 1px solid var(--el-border-color-lighter); display: grid; gap: 8px; font-size: 13px; overflow-wrap: anywhere; }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 16px; }.posting-dialog :deep(.el-select) { width: 100%; min-width: 0; }
@media (max-width: 768px) { .form-grid { grid-template-columns: minmax(0, 1fr); }.posting-panel header { align-items: flex-start; } }
</style>
