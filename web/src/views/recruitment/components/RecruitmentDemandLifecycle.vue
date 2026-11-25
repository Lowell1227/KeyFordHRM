<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Refresh } from '@element-plus/icons-vue';
import { useAuthStore } from '@/stores/auth.store';
import { useTalentPermissions } from '@/views/talent/useTalentPermissions';
import { useRecruitmentLeaveGuard } from '@/views/talent/useRecruitmentLeaveGuard';
import { recruitmentAnalyticsApi, recruitmentLifecycleApi, type RecruitmentAnalyticsApplication, type RecruitmentLifecycleView, type RecruitmentTrackingState } from '@/api/recruitment-lifecycle.api';
import { APPLICATION_STAGE_LABELS, type TalentApplicationStage } from '@/types/talent.types';
import { demandErrorMessage } from '../demand-presentation';
import { safePostingUrl } from '../intake-presentation';
import { formatDate } from '@/utils/date';
import ListPagination from '@/components/common/ListPagination.vue';

const props = defineProps<{ demandId: string; revision?: number }>();
const emit = defineEmits<{ updated: [view: RecruitmentLifecycleView] }>();
const auth = useAuthStore(), router = useRouter(), { canRead, canEdit } = useTalentPermissions();
const labels: Record<RecruitmentTrackingState, string> = { recruiting: '招聘中', filled: '已招满', paused: '暂停招聘', cancelled: '取消招聘' };
const current = ref<RecruitmentLifecycleView | null>(null), loading = ref(false), error = ref('');
const opened = ref(false), saving = ref(false), blocked = ref(false), formError = ref(''), reasonError = ref('');
const state = ref<RecruitmentTrackingState>('filled'), reason = ref('');
const showingApplications = ref(false), applications = ref<RecruitmentAnalyticsApplication[]>([]), applicationError = ref('');
const applicationsLoading = ref(false), applicationPage = ref(1), applicationTotal = ref(0);
let epoch = 0, readSequence = 0, expectedRevision = 0, applicationsSequence = 0;
const leave = useRecruitmentLeaveGuard({ dirty: () => opened.value, busy: () => saving.value, discard: () => { opened.value = false; } });
defineExpose({ prepareToLeave: leave.prepareToLeave });
function stageLabel(stage: string) { return APPLICATION_STAGE_LABELS[stage as TalentApplicationStage] || stage; }

async function load() {
  if (!canRead.value || !props.demandId) return null;
  const token = epoch, request = ++readSequence, id = props.demandId;
  loading.value = true; error.value = '';
  try {
    const result = await recruitmentLifecycleApi.detail(id);
    if (token !== epoch || request !== readSequence || !canRead.value) return null;
    current.value = result; return result;
  } catch (cause) { if (token === epoch && request === readSequence) error.value = demandErrorMessage(cause); return null; }
  finally { if (token === epoch && request === readSequence) loading.value = false; }
}
async function edit() {
  if (!canEdit.value || saving.value) return;
  const result = await load();
  if (!result?.canEdit || !canEdit.value) return;
  expectedRevision = result.revision; state.value = result.trackingState === 'filled' ? 'recruiting' : 'filled';
  reason.value = ''; formError.value = ''; reasonError.value = ''; blocked.value = false; opened.value = true;
}
async function reconfirm() {
  if (saving.value || !canEdit.value) return;
  const result = await load();
  if (!result?.canEdit || !canEdit.value) return;
  expectedRevision = result.revision; blocked.value = false; formError.value = '';
}
async function save() {
  if (!canEdit.value || !current.value?.canEdit || saving.value || blocked.value) return;
  reasonError.value = reason.value.trim() ? '' : '请填写变更原因';
  formError.value = state.value === current.value.trackingState ? '招聘进度未变化，请选择本次办理结果' : '';
  if (reasonError.value || formError.value) return;
  const token = epoch, id = props.demandId;
  saving.value = true;
  try {
    const result = await recruitmentLifecycleApi.change(id, { expectedRevision, trackingState: state.value, reason: reason.value.trim() });
    if (token !== epoch || !canRead.value) return;
    current.value = result; opened.value = false; emit('updated', result);
    if (props.revision !== undefined && props.revision > result.revision) void load();
  } catch (cause) {
    if (token !== epoch) return;
    const status = (cause as { response?: { status?: number } }).response?.status;
    blocked.value = !status || status >= 500 || [403, 404, 409].includes(status);
    formError.value = !status || status >= 500 ? '暂不能确认登记结果，原输入已保留。请先刷新办理依据核对结果。' : demandErrorMessage(cause);
  } finally { if (token === epoch) saving.value = false; }
}
async function close(done?: () => void) {
  if (!saving.value && await leave.prepareToLeave()) { opened.value = false; done?.(); }
}
async function loadApplications() {
  if (!canRead.value || !showingApplications.value) return;
  const token = epoch, request = ++applicationsSequence;
  applicationsLoading.value = true; applicationError.value = '';
  try {
    const result = await recruitmentAnalyticsApi.applications({ demandId: props.demandId, page: applicationPage.value, pageSize: 10 });
    if (token !== epoch || request !== applicationsSequence || !canRead.value) return;
    applications.value = result.items; applicationTotal.value = result.total;
  } catch (cause) { if (token === epoch && request === applicationsSequence) { applications.value = []; applicationTotal.value = 0; applicationError.value = demandErrorMessage(cause); } }
  finally { if (token === epoch && request === applicationsSequence) applicationsLoading.value = false; }
}
function toggleApplications() { showingApplications.value = !showingApplications.value; if (showingApplications.value) void loadApplications(); }
function openApplication(row: RecruitmentAnalyticsApplication) {
  if (canRead.value && !row.candidateUnavailable) void router.push({ path: '/talents', query: { candidateId: row.candidateId, applicationId: row.id } });
}
watch([() => props.demandId, () => auth.user?.id, canRead], () => {
  ++epoch; ++readSequence; ++applicationsSequence; current.value = null; error.value = ''; loading.value = false; opened.value = false; saving.value = false;
  showingApplications.value = false; applications.value = []; applicationTotal.value = 0; applicationPage.value = 1;
  if (canRead.value && props.demandId) void load();
}, { immediate: true });
watch(() => props.revision, (revision, previous) => {
  if (revision === undefined || revision === previous || !canRead.value) return;
  if (opened.value && revision !== expectedRevision) {
    blocked.value = true; formError.value = '招聘需求已更新，原输入已保留。请刷新办理依据并核对后再保存。';
    void load();
  } else if (current.value?.revision !== revision) void load();
});
onBeforeUnmount(() => { ++epoch; ++readSequence; ++applicationsSequence; });
</script>

<template>
  <section class="demand-lifecycle" aria-label="招聘进度留痕">
    <header><h3>招聘进度</h3><div class="actions"><el-button v-if="canEdit && current?.canEdit" :disabled="loading || saving" @click="edit">登记招聘进度</el-button><el-tooltip content="刷新招聘进度"><el-button :icon="Refresh" aria-label="刷新招聘进度" :loading="loading" :disabled="!canRead || saving" @click="load" /></el-tooltip></div></header>
    <el-alert v-if="!canRead" title="当前无权查看招聘进度" type="warning" :closable="false" />
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <template v-if="canRead && current">
      <div class="status-line"><el-tag :type="current.trackingState === 'recruiting' ? 'success' : 'info'">{{ labels[current.trackingState] }}</el-tag><span v-if="current.trackingChangedAt">{{ current.trackingChangedByName || '办理人待核对' }} · {{ formatDate(current.trackingChangedAt) }}</span></div>
      <p v-if="current.trackingReason" class="reason">{{ current.trackingReason }}</p>
      <dl class="summary"><div><dt>批准人数</dt><dd>{{ current.summary.approvedHeadcount ?? '待核对' }}</dd></div><div><dt>已接受待到岗</dt><dd>{{ current.summary.acceptedCount }}</dd></div><div><dt>实际到岗</dt><dd>{{ current.summary.hiredCount }}</dd></div><div><dt>剩余名额</dt><dd>{{ current.summary.remainingCount ?? '待核对' }}</dd></div><div><dt>在办应聘</dt><dd>{{ current.summary.inProgressCount }}</dd></div></dl>
      <p v-if="current.summary.overCount" class="warning">超出批准人数 {{ current.summary.overCount }} 人，待经办核对</p>
      <el-button link type="primary" :aria-expanded="showingApplications" @click="toggleApplications">{{ showingApplications ? '收起关联应聘' : '查看关联应聘' }}</el-button>
      <div v-if="showingApplications" v-loading="applicationsLoading" class="application-list">
        <el-alert v-if="applicationError" :title="applicationError" type="error" :closable="false"><el-button link @click="loadApplications">重试关联应聘</el-button></el-alert>
        <p v-if="!applicationsLoading && !applications.length && !applicationError" class="muted">暂无关联应聘</p>
        <div v-for="row in applications" :key="row.id" class="application-row"><span>{{ row.candidateUnavailable ? '资料已删除' : row.candidateName || '姓名未提供' }} · {{ row.positionName }} · {{ stageLabel(row.stage) }}</span><el-button link type="primary" :disabled="row.candidateUnavailable" @click="openApplication(row)">查看应聘</el-button></div>
        <ListPagination :current-page="applicationPage" :page-size="10" :page-sizes="[10]" :total="applicationTotal" :disabled="applicationsLoading" @update:current-page="applicationPage = $event" @change="loadApplications" />
      </div>
      <el-collapse v-if="current.events.length"><el-collapse-item title="进度办理记录" name="tracking-history"><ol class="history"><li v-for="event in current.events" :key="event.id"><span>{{ formatDate(event.createdAt) }} · {{ event.actorName || '办理人待核对' }} · {{ labels[event.trackingState as RecruitmentTrackingState] || '进度登记' }} · 版本 {{ event.revision }}</span><p>{{ event.reason }}</p></li></ol></el-collapse-item></el-collapse>
    </template>
    <el-dialog v-model="opened" title="登记招聘进度" width="min(620px, 96vw)" :close-on-click-modal="false" :close-on-press-escape="!saving" :show-close="!saving" :before-close="close">
      <template v-if="current">
        <dl class="summary"><div><dt>批准人数</dt><dd>{{ current.summary.approvedHeadcount ?? '待核对' }}</dd></div><div><dt>已接受待到岗</dt><dd>{{ current.summary.acceptedCount }}</dd></div><div><dt>实际到岗</dt><dd>{{ current.summary.hiredCount }}</dd></div><div><dt>剩余名额</dt><dd>{{ current.summary.remainingCount ?? '待核对' }}</dd></div><div><dt>在办应聘</dt><dd>{{ current.summary.inProgressCount }}</dd></div></dl>
        <p class="muted">在办人员仍需按原流程办理；进度登记不结束应聘、不释放名额。外部职位请经办在原渠道处理并更新登记。</p>
        <ul class="postings"><li v-for="posting in current.externalPostings" :key="posting.id"><span>{{ posting.channel }} · {{ posting.name }}</span><span>{{ posting.active ? '使用中' : '已停用' }} · {{ posting.ownerName || '经办待核对' }}</span><a v-if="safePostingUrl(posting.url)" :href="safePostingUrl(posting.url)" target="_blank" rel="noopener noreferrer">查看外部职位</a></li></ul>
        <p v-if="!current.externalPostings.length" class="muted">暂无关联外部职位</p>
        <el-alert v-if="formError" :title="formError" type="error" :closable="false" />
        <el-button v-if="blocked" link type="primary" :disabled="saving || loading" @click="reconfirm">刷新办理依据，保留输入</el-button>
        <el-form label-position="top" :disabled="saving || blocked" @submit.prevent="save">
          <el-form-item label="本次招聘进度" required><el-select v-model="state" aria-label="本次招聘进度" :fit-input-width="true"><el-option v-for="(label, key) in labels" :key="key" :value="key" :label="label" /></el-select></el-form-item>
          <el-form-item label="变更原因" required :error="reasonError"><el-input v-model="reason" type="textarea" :rows="3" maxlength="2000" aria-label="变更原因" /></el-form-item>
        </el-form>
      </template>
      <template #footer><el-button :disabled="saving" @click="close()">取消</el-button><el-button type="primary" :loading="saving" :disabled="blocked || !canEdit || !current?.canEdit" @click="save">保存招聘进度</el-button></template>
    </el-dialog>
  </section>
</template>

<style scoped>
.demand-lifecycle { min-width: 0; padding: 16px 0; border-top: 1px solid var(--el-border-color-lighter); }
header, .actions, .status-line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; } header { justify-content: space-between; margin-bottom: 12px; }
h3 { font-size: 14px; margin: 0; }.status-line, .reason { font-size: 13px; overflow-wrap: anywhere; }
.summary { display: flex; flex-wrap: wrap; gap: 12px 24px; margin: 16px 0; }.summary div { min-width: 70px; }.summary dt { color: var(--el-text-color-secondary); font-size: 12px; }.summary dd { margin: 4px 0 0; font-size: 16px; font-weight: 600; }
.muted, .warning { font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }.muted { color: var(--el-text-color-secondary); }.warning { color: var(--el-color-warning-dark-2); }
.postings, .history { list-style: none; padding: 0; margin: 12px 0; font-size: 13px; }.postings li, .history li { padding: 8px 0; border-bottom: 1px solid var(--el-border-color-lighter); display: grid; gap: 6px; overflow-wrap: anywhere; }.history p { margin: 0; }
.application-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--el-border-color-lighter); font-size: 13px; }.application-row span { overflow-wrap: anywhere; }.application-row .el-button { flex-shrink: 0; }
.demand-lifecycle :deep(.el-select) { width: 100%; min-width: 0; }
@media (max-width: 768px) { .summary { gap: 12px 16px; }.summary div { min-width: 84px; } }
</style>
