<script setup lang="ts">
import { ref, computed, onBeforeUnmount, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { talentPoolApi } from '@/api/talent-pool.api';
import {
  TALENT_STATUS_LABELS,
  TALENT_STATUS_TAG,
  TALENT_EMPLOYMENT_STATUS_LABELS,
  TALENT_SOURCE_LABELS,
  TALENT_TAG_LABELS,
  EDUCATION_LABELS,
  TALENT_GENDER_LABELS,
  type TalentCandidateDetail,
  type TalentTag,
  type TalentDeleteImpact,
  type TalentQuery,
  INTERVIEW_STATUS_LABELS,
} from '@/types/talent.types';
import { formatDate } from '@/utils/date';
import { formatTalentSalary } from '@/utils/talent-salary';
import BusinessDetailDrawer from '@/components/common/business-list/BusinessDetailDrawer.vue';
import TalentFileList from './TalentFileList.vue';
import TalentFollowUpTimeline from './TalentFollowUpTimeline.vue';
import TalentShareDrawer from './TalentShareDrawer.vue';
import TalentInterviewPanel from './TalentInterviewPanel.vue';
import TalentApplicationPanel from './TalentApplicationPanel.vue';
import { useTalentPermissions } from '../useTalentPermissions';
import { formatInterviewTime } from '../interview-time';

const { canEdit } = useTalentPermissions();

/**
 * 候选人详情抽屉（需求 §5.3）。
 * 头部操作：编辑 / 设置人才状态 / 删除（软删除二次确认）；转发与办理入职由父页补充。
 */

const props = defineProps<{
  modelValue: boolean;
  candidateId: string | null;
  applicationMatch?: { id: string } & Pick<TalentQuery, 'applicationPosition' | 'applicationStage'>;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  edit: [candidateId: string];
  removed: [candidateId: string];
  changed: [];
}>();

const router = useRouter();
const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
});

const loading = ref(false);
const loadError = ref(''), actionError = ref(''), rejecting = ref(false), impactLoading = ref(false);
const detail = ref<TalentCandidateDetail | null>(null);
const employmentStatusLabel = computed(() => TALENT_EMPLOYMENT_STATUS_LABELS[detail.value?.employmentStatus ?? 'unknown']);
const interviewPanel = ref<InstanceType<typeof TalentInterviewPanel>>();
const shareVisible = ref(false);
const shareContext = ref<{ candidateId: string; session: number } | null>(null);
const deleteImpact = ref<TalentDeleteImpact | null>(null);
const deleteVisible = ref(false), deleting = ref(false), deleteError = ref('');
let requestId = 0;
let session = 0;

watch(() => [props.modelValue, props.candidateId], () => {
  ++session; ++requestId;
  detail.value = null;
  shareVisible.value = false; shareContext.value = null;
  deleteVisible.value = false; deleteImpact.value = null; impactLoading.value = false;
  deleting.value = false; rejecting.value = false; actionError.value = ''; loadError.value = '';
  if (props.modelValue) void loadDetail();
}, { immediate: true });
onBeforeUnmount(() => { ++requestId; ++session; });
function active(recordId: string, token: number) { return props.modelValue && props.candidateId === recordId && token === session; }

async function loadDetail() {
  if (!props.candidateId) return;
  const id = ++requestId;
  const recordId = props.candidateId, token = session;
  loading.value = true;
  loadError.value = '';
  try {
    const result = await talentPoolApi.detail(recordId);
    if (id !== requestId || !active(recordId, token)) return;
    detail.value = result;
  } catch {
    if (id === requestId && active(recordId, token)) loadError.value = '人才详情读取失败，请重试。';
  } finally {
    if (id === requestId) loading.value = false;
  }
}

function field(value: string | number | null | undefined): string {
  return value == null || value === '' ? '—' : String(value);
}

function salaryText(item: TalentCandidateDetail): string {
  return formatTalentSalary(item);
}

function ageText(item: TalentCandidateDetail): string {
  return item.birthYear ? `${new Date().getFullYear() - item.birthYear} 岁` : '—';
}

function tagLabel(tag: string): string {
  return TALENT_TAG_LABELS[tag as TalentTag] ?? tag;
}

function startEdit() {
  if (!detail.value || !canEdit.value) return;
  emit('edit', detail.value.id);
}

async function markRejected() {
  if (!detail.value || !canEdit.value || rejecting.value) return;
  const target = detail.value;
  const token = session;
  try { await ElMessageBox.confirm(
    `将「${target.name}」的人才库状态设为已淘汰？各条应聘记录分别处理。`,
    '设置人才状态',
    { confirmButtonText: '设为已淘汰', cancelButtonText: '取消', type: 'warning' },
  ); } catch { return; }
  if (!active(target.id, token)) return;
  rejecting.value = true; actionError.value = '';
  try {
    await talentPoolApi.update(target.id, { status: 'rejected', editVersion: target.editVersion });
    if (!active(target.id, token)) return;
    ElMessage.success('人才库状态已设为已淘汰'); emit('changed'); await loadDetail();
  } catch { if (active(target.id, token)) actionError.value = '设置人才状态失败，请核对当前记录后重试。'; }
  finally { if (active(target.id, token)) rejecting.value = false; }
}

async function removeCandidate() {
  if (!detail.value || !canEdit.value || impactLoading.value) return;
  const id = detail.value.id, token = session;
  deleteError.value = ''; actionError.value = ''; impactLoading.value = true;
  try {
    const impact = await talentPoolApi.deleteImpact(id);
    if (!active(id, token)) return;
    deleteImpact.value = impact; deleteVisible.value = true;
  } catch { if (active(id, token)) actionError.value = '删除影响读取失败，请点击删除重试。'; }
  finally { if (active(id, token)) impactLoading.value = false; }
}

async function confirmDelete() {
  if (!detail.value || !deleteImpact.value || !canEdit.value || deleting.value) return;
  const id = detail.value.id, token = session;
  deleting.value = true; deleteError.value = '';
  try {
    await talentPoolApi.remove(id, { impactVersion: deleteImpact.value.version, force: deleteImpact.value.requiresForce });
    if (!active(id, token)) return;
    ElMessage.success('已删除');
    deleteVisible.value = false; visible.value = false; emit('removed', id);
  } catch (error) {
    if (!active(id, token)) return;
    const latest = (error as { response?: { data?: { data?: { impact?: TalentDeleteImpact } } } }).response?.data?.data?.impact;
    if (latest) deleteImpact.value = latest;
    deleteError.value = latest ? '关联影响已变化，请重新核对后点击仍然删除' : '删除失败，请刷新关联影响后重试';
  } finally { if (active(id, token)) deleting.value = false; }
}

function openEmployeeArchive() {
  if (!detail.value?.convertedUserId) return;
  void router.push({ path: '/users', query: { employeeId: detail.value.convertedUserId } });
}

/** Only source ID is handed to onboarding; personal data never enters the URL. */
function goOnboarding() {
  if (!detail.value?.onboardingRequest) return;
  void router.push({
    path: '/entry-exit',
    query: { applicationId: detail.value.onboardingRequest.id },
  });
}

function onFollowUpChanged() {
  emit('changed');
  void loadDetail();
}

/** 分享创建/撤销后刷新详情（历史分享列表与查看次数）。 */
function openShare() { if (detail.value) { shareContext.value = { candidateId: detail.value.id, session }; shareVisible.value = true; } }
function onShareChanged(context: { candidateId: string; session: number }) {
  if (!active(context.candidateId, context.session) || shareContext.value !== context || !shareVisible.value) return;
  emit('changed');
  void loadDetail();
}
</script>

<template>
  <BusinessDetailDrawer v-model="visible" :title="detail?.name ?? '人才详情'" :loading="loading"
    variant="standard" class="talent-detail-drawer">
    <el-alert v-if="loadError" :title="loadError" type="error" :closable="false"><el-button link type="primary" @click="loadDetail">重试</el-button></el-alert>
    <div v-if="detail" class="talent-detail">
      <div class="talent-detail__header">
        <div class="talent-detail__badges">
          <el-tag :type="TALENT_STATUS_TAG[detail.status].type"
            :effect="TALENT_STATUS_TAG[detail.status].effect ?? 'light'" size="small">
            人才库状态：{{ TALENT_STATUS_LABELS[detail.status] }}
          </el-tag>
          <el-tag v-if="detail.employmentStatus" data-testid="talent-current-employment" size="small" effect="plain"
            :type="detail.employmentStatus === 'resigned' || detail.employmentStatus === 'unknown' ? 'warning' : 'info'">
            员工当前：{{ employmentStatusLabel }}
          </el-tag>
          <span class="talent-detail__source">来源：{{ TALENT_SOURCE_LABELS[detail.sourceChannel] }}</span>
          <span class="talent-detail__updated">更新于 {{ formatDate(detail.updatedAt) }}</span>
        </div>
        <div v-if="canEdit" class="talent-detail__actions">
          <el-button v-if="detail.onboardingRequest" size="small" type="primary" plain @click="goOnboarding">查看入职申请</el-button>
          <el-button size="small" plain @click="openShare">转发</el-button>
          <el-button size="small" @click="startEdit">编辑</el-button>
          <el-button v-if="detail.status !== 'rejected' && detail.status !== 'hired'" size="small" type="warning"
            plain :loading="rejecting" @click="markRejected">设置人才状态</el-button>
          <el-button size="small" type="danger" plain :loading="impactLoading" @click="removeCandidate">删除</el-button>
        </div>
      </div>
      <el-alert v-if="actionError" :title="actionError" type="error" :closable="false" />

      <el-alert v-if="detail.status === 'hired'" type="success" :closable="false" class="talent-detail__converted">
        已于 {{ formatDate(detail.convertedAt) }} 办理入职，
        <el-button link type="primary" @click="openEmployeeArchive">查看员工档案：{{ detail.name }}</el-button>
      </el-alert>

      <h4 class="talent-detail__section-title">基本信息</h4>
      <div class="talent-detail__grid">
        <div class="talent-detail__field"><span class="talent-detail__label">手机</span><span>{{ detail.phone }}</span></div>
        <div class="talent-detail__field"><span class="talent-detail__label">邮箱</span><span>{{ field(detail.email) }}</span></div>
        <div class="talent-detail__field"><span class="talent-detail__label">性别</span><span>{{ TALENT_GENDER_LABELS[detail.gender] }}</span></div>
        <div class="talent-detail__field"><span class="talent-detail__label">年龄</span><span>{{ ageText(detail) }}</span></div>
        <div class="talent-detail__field"><span class="talent-detail__label">当前公司</span><span>{{ field(detail.currentCompany) }}</span></div>
        <div class="talent-detail__field"><span class="talent-detail__label">当前职位</span><span>{{ field(detail.currentPosition) }}</span></div>
        <div class="talent-detail__field"><span class="talent-detail__label">工作年限</span><span>{{ detail.yearsOfExperience == null ? '—' : `${detail.yearsOfExperience} 年` }}</span></div>
        <div class="talent-detail__field"><span class="talent-detail__label">来源</span><span>{{ TALENT_SOURCE_LABELS[detail.sourceChannel] }}</span></div>
      </div>

      <h4 class="talent-detail__section-title">求职意向</h4>
      <div class="talent-detail__grid">
        <div class="talent-detail__field"><span class="talent-detail__label">意向岗位</span><span>{{ field(detail.appliedPosition) }}</span></div>
        <div class="talent-detail__field"><span class="talent-detail__label">期望城市</span><span>{{ field(detail.expectCity) }}</span></div>
        <div class="talent-detail__field"><span class="talent-detail__label">期望薪资</span><span>{{ salaryText(detail) }}</span></div>
        <div class="talent-detail__field"><span class="talent-detail__label">学历</span><span>{{ detail.education ? EDUCATION_LABELS[detail.education as keyof typeof EDUCATION_LABELS] ?? detail.education : '—' }}</span></div>
        <div class="talent-detail__field"><span class="talent-detail__label">院校</span><span>{{ field(detail.school) }}</span></div>
        <div class="talent-detail__field"><span class="talent-detail__label">专业</span><span>{{ field(detail.major) }}</span></div>
        <div class="talent-detail__field talent-detail__field--wide">
          <span class="talent-detail__label">标签</span>
          <span v-if="detail.tags.length" class="talent-detail__tags">
            <el-tag v-for="tag in detail.tags" :key="tag" size="small" effect="plain">{{ tagLabel(tag) }}</el-tag>
          </span>
          <span v-else>—</span>
        </div>
      </div>

      <div v-if="detail.note" class="talent-detail__note">
        <h4 class="talent-detail__section-title">备注</h4>
        <p class="talent-detail__note-text">{{ detail.note }}</p>
      </div>

      <h4 class="talent-detail__section-title">简历文件（{{ detail.files.length }}）</h4>
      <TalentFileList :candidate-id="detail.id" :files="detail.files" :editable="canEdit" @changed="loadDetail" />

      <TalentApplicationPanel :key="detail.id" :candidate-id="detail.id" :application-match="applicationMatch" :editable="canEdit" :converted-user-id="detail.convertedUserId" @changed="onFollowUpChanged" @interview="application => interviewPanel?.openForApplication(application)" />
      <TalentInterviewPanel ref="interviewPanel" :key="detail.id" :candidate-id="detail.id" :editable="canEdit" @changed="onFollowUpChanged" />

      <h4 class="talent-detail__section-title">跟进</h4>
      <TalentFollowUpTimeline :key="detail.id" :candidate-id="detail.id" :editable="canEdit" @changed="onFollowUpChanged" />

      <slot name="extra" />
    </div>
    <template v-for="context in shareContext ? [shareContext] : []" :key="`${context.candidateId}:${context.session}`">
      <TalentShareDrawer v-if="detail && canEdit && shareVisible" v-model="shareVisible" :candidate-id="context.candidateId" :candidate-name="detail.name"
        :shares="detail.shares" @changed="onShareChanged(context)" />
    </template>
  </BusinessDetailDrawer>
  <el-dialog v-model="deleteVisible" title="删除人才记录" width="min(560px, 94vw)" append-to-body :close-on-click-modal="false">
    <template v-if="deleteImpact">
      <p>删除后候选人将不再出现在人才库。关联面试、钉钉日程和入职申请不会自动取消，需分别处理。</p>
      <p>未结束面试 {{ deleteImpact.interviews.length }} 条，未结束入职申请 {{ deleteImpact.requests.length }} 条。</p>
      <ul class="talent-delete-impact">
        <li v-for="item in deleteImpact.interviews" :key="item.id">面试：{{ formatInterviewTime(item.startsAt) }}（北京时间） · {{ INTERVIEW_STATUS_LABELS[item.status] }}</li>
        <li v-for="item in deleteImpact.requests" :key="item.id">申请 {{ item.id.slice(0, 8) }}：{{ ({ draft: '草稿', submitted: '审核中', pending_entry: '待到岗' } as Record<string, string>)[item.onboardingStatus] ?? item.recordStatus }}</li>
      </ul>
      <el-alert v-if="deleteError" :title="deleteError" type="error" :closable="false" />
    </template>
    <template #footer><el-button :disabled="deleting" @click="deleteVisible = false">取消</el-button><el-button type="danger" :loading="deleting" @click="confirmDelete">仍然删除</el-button></template>
  </el-dialog>
</template>

<style scoped>
.talent-detail__header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 14px;
}
.talent-detail__badges {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.talent-detail__actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.talent-detail__actions .el-button + .el-button { margin-left: 0; }
.talent-detail__converted { margin-bottom: 12px; }
.talent-detail__section-title {
  margin: 18px 0 8px;
  font-size: 14px;
  color: var(--el-text-color-primary);
}
.talent-detail__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 16px;
}
.talent-detail__field {
  display: flex;
  gap: 8px;
  font-size: 13px;
  line-height: 20px;
  min-width: 0;
  overflow-wrap: anywhere;
}
.talent-delete-impact { max-height: 240px; overflow: auto; padding-left: 20px; }
.talent-detail__field--wide { grid-column: 1 / -1; }
.talent-detail__label {
  flex: 0 0 auto;
  width: 64px;
  color: var(--el-text-color-secondary);
}
.talent-detail__tags {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 6px;
}
.talent-detail__note-text {
  margin: 0;
  font-size: 13px;
  line-height: 20px;
  white-space: pre-wrap;
}
@media (max-width: 768px) {
  .talent-detail__grid { grid-template-columns: 1fr; }
}
</style>
