<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { talentPoolApi } from '@/api/talent-pool.api';
import {
  TALENT_STATUS_LABELS,
  TALENT_STATUS_TAG,
  TALENT_SOURCE_LABELS,
  TALENT_TAG_LABELS,
  EDUCATION_LABELS,
  TALENT_GENDER_LABELS,
  type TalentCandidateDetail,
  type TalentTag,
  type TalentDeleteImpact,
  INTERVIEW_STATUS_LABELS,
} from '@/types/talent.types';
import { formatDate } from '@/utils/date';
import BusinessDetailDrawer from '@/components/common/business-list/BusinessDetailDrawer.vue';
import TalentFileList from './TalentFileList.vue';
import TalentFollowUpTimeline from './TalentFollowUpTimeline.vue';
import TalentShareDrawer from './TalentShareDrawer.vue';
import TalentInterviewPanel from './TalentInterviewPanel.vue';
import { useTalentPermissions } from '../useTalentPermissions';
import { formatInterviewTime } from '../interview-time';

const { canEdit } = useTalentPermissions();

/**
 * 候选人详情抽屉（需求 §5.3）。
 * 头部操作：编辑 / 标记淘汰 / 删除（软删除二次确认）；转发与办理入职由父页补充。
 */

const props = defineProps<{
  modelValue: boolean;
  candidateId: string | null;
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
const detail = ref<TalentCandidateDetail | null>(null);
const shareVisible = ref(false);
const deleteImpact = ref<TalentDeleteImpact | null>(null);
const deleteVisible = ref(false), deleting = ref(false), deleteError = ref('');
let requestId = 0;

watch(() => [props.modelValue, props.candidateId], () => {
  detail.value = null;
  deleteVisible.value = false;
  if (props.modelValue) void loadDetail();
  else requestId++;
});

async function loadDetail() {
  if (!props.candidateId) return;
  const id = ++requestId;
  loading.value = true;
  try {
    const result = await talentPoolApi.detail(props.candidateId);
    if (id !== requestId) return;
    detail.value = result;
  } finally {
    if (id === requestId) loading.value = false;
  }
}

function field(value: string | number | null | undefined): string {
  return value == null || value === '' ? '—' : String(value);
}

function salaryText(item: TalentCandidateDetail): string {
  const min = item.expectSalaryMin;
  const max = item.expectSalaryMax;
  if (min == null && max == null) return '面议';
  if (min != null && max != null) return `${min}–${max}K`;
  if (min != null) return `${min}K以上`;
  return `${max}K以下`;
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
  if (!detail.value || !canEdit.value) return;
  await ElMessageBox.confirm(
    `把「${detail.value.name}」标记为已淘汰？如需说明原因，建议先在编辑页写好备注。`,
    '标记淘汰',
    { confirmButtonText: '标记淘汰', cancelButtonText: '取消', type: 'warning' },
  );
  await talentPoolApi.update(detail.value.id, { status: 'rejected' });
  ElMessage.success('已标记为已淘汰');
  await loadDetail();
}

async function removeCandidate() {
  if (!detail.value || !canEdit.value) return;
  deleteError.value = '';
  deleteImpact.value = await talentPoolApi.deleteImpact(detail.value.id);
  deleteVisible.value = true;
}

async function confirmDelete() {
  if (!detail.value || !deleteImpact.value || !canEdit.value) return;
  const id = detail.value.id;
  deleting.value = true; deleteError.value = '';
  try {
    await talentPoolApi.remove(id, { impactVersion: deleteImpact.value.version, force: deleteImpact.value.requiresForce });
    ElMessage.success('已删除');
    deleteVisible.value = false; visible.value = false; emit('removed', id);
  } catch (error) {
    const latest = (error as { response?: { data?: { data?: { impact?: TalentDeleteImpact } } } }).response?.data?.data?.impact;
    if (latest) deleteImpact.value = latest;
    deleteError.value = latest ? '关联影响已变化，请重新核对后点击仍然删除' : '删除失败，请刷新关联影响后重试';
  } finally { deleting.value = false; }
}

function openEmployeeArchive() {
  if (!detail.value?.convertedUserId) return;
  void router.push({ path: '/users', query: { keyword: detail.value.name } });
}

/** Only source ID is handed to onboarding; personal data never enters the URL. */
function goOnboarding() {
  if (!detail.value || detail.value.status === 'hired' || !canEdit.value) return;
  void router.push({
    path: '/entry-exit',
    query: { talentId: detail.value.id },
  });
}

function onFollowUpChanged() {
  emit('changed');
  void loadDetail();
}

/** 分享创建/撤销后刷新详情（历史分享列表与查看次数）。 */
function onShareChanged() {
  emit('changed');
  void loadDetail();
}
</script>

<template>
  <BusinessDetailDrawer v-model="visible" :title="detail?.name ?? '人才详情'" :loading="loading"
    variant="standard" class="talent-detail-drawer">
    <div v-if="detail" class="talent-detail">
      <div class="talent-detail__header">
        <div class="talent-detail__badges">
          <el-tag :type="TALENT_STATUS_TAG[detail.status].type"
            :effect="TALENT_STATUS_TAG[detail.status].effect ?? 'light'" size="small">
            {{ TALENT_STATUS_LABELS[detail.status] }}
          </el-tag>
          <span class="talent-detail__source">来源：{{ TALENT_SOURCE_LABELS[detail.sourceChannel] }}</span>
          <span class="talent-detail__updated">更新于 {{ formatDate(detail.updatedAt) }}</span>
        </div>
        <div v-if="canEdit" class="talent-detail__actions">
          <el-button v-if="detail.status !== 'hired'" size="small" type="primary" plain @click="goOnboarding">办理入职</el-button>
          <el-button size="small" plain @click="shareVisible = true">转发</el-button>
          <el-button size="small" @click="startEdit">编辑</el-button>
          <el-button v-if="detail.status !== 'rejected' && detail.status !== 'hired'" size="small" type="warning"
            plain @click="markRejected">标记淘汰</el-button>
          <el-button size="small" type="danger" plain @click="removeCandidate">删除</el-button>
        </div>
      </div>

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
        <div class="talent-detail__field"><span class="talent-detail__label">学历</span><span>{{ detail.education ? EDUCATION_LABELS[detail.education] : '—' }}</span></div>
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

      <TalentInterviewPanel :key="detail.id" :candidate-id="detail.id" :editable="canEdit" />

      <h4 class="talent-detail__section-title">跟进</h4>
      <TalentFollowUpTimeline :key="detail.id" :candidate-id="detail.id" :editable="canEdit" @changed="onFollowUpChanged" />

      <slot name="extra" />
    </div>
    <TalentShareDrawer v-if="detail && canEdit" v-model="shareVisible" :candidate-id="detail.id" :candidate-name="detail.name"
      :shares="detail.shares" @changed="onShareChanged" />
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
