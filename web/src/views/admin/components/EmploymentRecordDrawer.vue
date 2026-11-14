<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import dayjs from 'dayjs';
import { ElMessage } from 'element-plus';
import { employeeArchivesApi, type EmployeeArchive, type EmployeeDataReview } from '@/api/employee-archives.api';
import { positionsApi, type PositionRecord } from '@/api/positions.api';
import UserSelect from '@/components/common/UserSelect.vue';
import EmployeeCompanySelect from '@/components/common/EmployeeCompanySelect.vue';
import PersonnelReferenceSelect from '@/components/common/PersonnelReferenceSelect.vue';
import type { Department } from '@/types/api.types';
import { applicationProgress } from '@/utils/employee-lifecycle';

const props = withDefaults(defineProps<{
  modelValue: boolean;
  archive: EmployeeArchive | null;
  departments: Department[];
  mode?: 'default' | 'resignation';
  canEditArchive?: boolean;
  resignationDraft?: { leaveDate: string; reason: string } | null;
  refreshingDepartment?: boolean;
}>(), { mode: 'default' });
const emit = defineEmits<{
  'update:modelValue': [value: boolean]; submitted: [requestId: string]; closed: [];
  'complete-department': [draft: { leaveDate: string; reason: string }];
  'refresh-department': [];
}>();
const positions = ref<PositionRecord[]>([]);
const saving = ref(false);
let generation = 0;
const form = reactive<Record<string, any>>({});
const positionOptions = computed(() => positions.value.filter(position => position.isActive || position.id === form.positionId));
function changePosition(id?: string | null) {
  const position = positions.value.find(item => item.id === id);
  form.positionId = id || null;
  form.position = position?.name ?? null;
  form.jobFamily = position?.jobFamily ?? null;
}
const companyError = ref('');
const submitAttempted = ref(false);
const resignationReview = ref<EmployeeDataReview | null>(null);
const isResignation = computed(() => props.mode === 'resignation');
const isHistoricalEmployment = computed(() => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return Boolean(form.effectiveFrom && form.effectiveTo && form.effectiveFrom <= form.effectiveTo && form.effectiveTo < today);
});
const employmentStatusError = computed(() => {
  if (isResignation.value || isHistoricalEmployment.value) return '';
  if (!['active', 'probation'].includes(props.archive?.status ?? '') || !['active', 'probation'].includes(form.employeeStatus)
    || ['resignation', 'rehire'].includes(form.changeType)) return '入职、再入职和离职请在入离职页面办理；历史状态仅可补录在已结束的任职区间。';
  return '';
});
const drawerTitle = computed(() => isResignation.value ? '办理离职' : '新增任职记录');
const resignationReviewState = computed<'not_submitted' | 'pending' | 'approved' | 'rejected'>(() => {
  const status = resignationReview.value?.profileReviewStatus;
  if (status === 'pending' || status === 'applying') return 'pending';
  if (status === 'approved') return 'approved';
  if (status === 'rejected') return 'rejected';
  return 'not_submitted';
});
const resignationDisableDate = computed(() => {
  const date = String(resignationReview.value?.proposedValue?.employee?.leaveDate || form.leaveDate || '').slice(0, 10);
  return date ? dayjs(date).add(1, 'day').format('YYYY-MM-DD') : '';
});
const resignationEffective = computed(() => Boolean(resignationReview.value?.appliedAt));
const resignationReviewLabel = computed(() => resignationEffective.value ? '已生效'
  : resignationReview.value ? applicationProgress(resignationReview.value) : '待提交');
const resignationReviewLocked = computed(() => ['pending', 'approved'].includes(resignationReviewState.value));
const resignationStepActive = computed(() => ({ not_submitted: 0, pending: 1, rejected: 1, approved: resignationEffective.value ? 3 : 2 })[resignationReviewState.value]);
const resignationProcessStatus = computed(() => resignationReviewState.value === 'rejected' ? 'error' : 'process');
const resignationTagType = computed<'info' | 'warning' | 'success' | 'danger'>(() => ({
  not_submitted: 'info',
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
})[resignationReviewState.value] as 'info' | 'warning' | 'success' | 'danger');
function formatDateTime(value?: string | null): string {
  if (!value) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value));
}
const resignationSubmitDescription = computed(() => {
  const review = resignationReview.value;
  if (!review) return '填写离职信息后提交';
  const creator = review.createdBy?.name || '已提交';
  return `${creator} · ${formatDateTime(review.createdAt)}`;
});
const resignationReviewDescription = computed(() => {
  const review = resignationReview.value;
  if (!review) return '提交后由 HR 管理员审核';
  if (review.profileReviewStatus === 'pending') return '等待 HR 管理员审核';
  const reviewer = review.profileReviewedBy?.name || 'HR 管理员';
  const reviewedAt = formatDateTime(review.profileReviewedAt || review.updatedAt);
  return `${reviewer}${reviewedAt ? ` · ${reviewedAt}` : ''}`;
});
const resignationEffectiveDescription = computed(() => resignationReview.value?.appliedAt
  ? `实际生效：${formatDateTime(resignationReview.value.appliedAt)}（北京时间）`
  : resignationDisableDate.value
  ? `预计 ${resignationDisableDate.value} 00:00（北京时间）停用；实际以生效记录为准`
  : '最后工作日次日零点停用');
const overlapWarning = computed(() => {
  const start = String(isResignation.value ? form.leaveDate ?? '' : form.effectiveFrom ?? '').slice(0, 10);
  if (!start) return '';
  const end = String(isResignation.value ? '' : form.effectiveTo ?? '').slice(0, 10) || '9999-12-31';
  const history = props.archive?.employmentHistory?.length
    ? props.archive.employmentHistory
    : props.archive?.currentEmployment ? [props.archive.currentEmployment] : [];
  const count = history.filter((record) => {
    const recordStart = String(record.effectiveFrom ?? '').slice(0, 10);
    const recordEnd = String(record.effectiveTo ?? '').slice(0, 10) || '9999-12-31';
    return Boolean(recordStart) && start <= recordEnd && recordStart <= end;
  }).length;
  return count > 0
    ? `与 ${count} 条已有任职记录时间重叠，仅作提醒，不影响提交和审核`
    : '';
});
function flatten(items: Department[]): Department[] { return items.flatMap((item) => [item, ...flatten(item.children ?? [])]); }
function reset() {
  companyError.value = '';
  submitAttempted.value = false;
  const archive = props.archive; const current = archive?.currentEmployment ?? archive?.employmentHistory[0];
  resignationReview.value = archive?.latestResignationReview ?? null;
  Object.assign(form, {
    contractSubjectId: current?.contractSubjectId ?? undefined, companyText: current?.companyText ?? null,
    effectiveFrom: '', effectiveTo: null, company: current?.company ?? null,
    deptId: current?.deptId ?? archive?.dept?.id ?? null, positionId: current?.positionId ?? null,
    position: current?.position ?? archive?.position ?? null, jobFamily: current?.jobFamily ?? null,
    directManagerId: archive?.rosterManager?.id ?? null, workLocation: current?.workLocation ?? null,
    employmentType: current?.employmentType ?? 'full_time', employeeStatus: archive?.status ?? 'active',
    entryDate: archive?.entryDate?.slice(0, 10) ?? null, plannedRegularDate: current?.plannedRegularDate?.slice(0, 10) ?? null,
    actualRegularDate: current?.actualRegularDate?.slice(0, 10) ?? null, leaveDate: current?.leaveDate?.slice(0, 10) ?? null,
    probationMonths: current?.probationMonths ?? null, changeType: 'transfer', reason: '',
  });
  if (isResignation.value) {
    const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const proposed = resignationReview.value?.proposedValue?.employee ?? {};
    Object.assign(form, {
      deptId: archive?.dept?.id ?? null,
      effectiveFrom: String(proposed.effectiveFrom || localDate).slice(0, 10),
      leaveDate: String(proposed.leaveDate || localDate).slice(0, 10),
      employeeStatus: 'resigned',
      changeType: 'resignation',
      reason: proposed.reason ?? '',
    });
    if (props.resignationDraft && !resignationReviewLocked.value) Object.assign(form, props.resignationDraft);
  }
}
watch([() => props.modelValue, () => props.mode, () => props.archive?.id], ([open]) => {
  generation++;
  saving.value = false;
  if (open) reset();
}, { flush: 'sync' });
watch(() => props.archive, (archive, previous) => {
  if (!props.modelValue || !isResignation.value || archive?.id !== previous?.id) return;
  const draft = { leaveDate: form.leaveDate, reason: form.reason };
  reset();
  if (!resignationReviewLocked.value) Object.assign(form, draft);
});
async function submit() {
  if (!props.modelValue || saving.value || (isResignation.value && resignationReviewLocked.value)) return;
  submitAttempted.value = true;
  companyError.value = !isResignation.value && !form.company ? '请选择已配置内部公司映射的所属公司' : '';
  if (companyError.value || employmentStatusError.value) return;
  if (!props.archive || !form.deptId) { ElMessage.warning('员工档案缺少当前部门，暂不能提交'); return; }
  if (isResignation.value) {
    if (!form.leaveDate || !form.reason?.trim()) {
      ElMessage.warning('请填写最后工作日和离职原因');
      return;
    }
    form.effectiveFrom = form.leaveDate;
    form.employeeStatus = 'resigned';
    form.changeType = 'resignation';
  } else if (!form.effectiveFrom) {
    ElMessage.warning('请填写生效日期');
    return;
  }
  const session = generation;
  const employeeId = props.archive.id;
  const isCurrentSession = () => session === generation && props.modelValue && props.archive?.id === employeeId;
  saving.value = true;
  try {
    const review = await employeeArchivesApi.createEmployment(employeeId, { ...form, positionId: form.positionId || null });
    if (!isCurrentSession()) return;
    resignationReview.value = review;
    ElMessage.success(isResignation.value
      ? '离职申请已提交审核；审核生效后可由操作员手动归档'
      : '任职变更已提交审核；历史补录和未来生效记录都不会直接覆盖当前档案');
    emit('update:modelValue', false);
    emit('submitted', review.id);
  } catch {
    if (!isCurrentSession()) return;
    // 请求失败保留当前会话的表单，接口给出可执行原因。
  } finally {
    if (isCurrentSession()) saving.value = false;
  }
}
onMounted(async () => { positions.value = await positionsApi.findAll({ includeInactive: true }); });
onBeforeUnmount(() => { generation++; });
</script>

<template>
  <el-drawer :model-value="modelValue" :title="drawerTitle" size="min(720px, 100vw)" destroy-on-close @update:model-value="emit('update:modelValue', $event)" @closed="emit('closed')">
    <el-form v-if="isResignation" label-position="top" class="employment-grid" :disabled="resignationReviewLocked">
      <el-form-item label="员工"><el-input :model-value="archive?.name" disabled /></el-form-item>
      <el-form-item label="当前部门">
        <div class="employment-field">
          <el-input :model-value="archive?.dept?.fullPath || archive?.dept?.name || '未设置'" disabled />
          <template v-if="!form.deptId && !resignationReviewLocked">
            <span class="employment-field__warning">当前档案未设置部门，请先在员工档案中补充并提交，再办理离职。</span>
            <el-button v-if="canEditArchive && !archive?.archivedAt" link type="primary" :disabled="refreshingDepartment" @click="emit('complete-department', { leaveDate: form.leaveDate, reason: form.reason })">补充部门</el-button>
            <span v-else class="employment-help">请联系有档案编辑权限的 HR 补充部门。</span>
            <el-button link type="primary" :loading="refreshingDepartment" @click="emit('refresh-department')">刷新部门</el-button>
          </template>
        </div>
      </el-form-item>
      <el-form-item label="最后工作日">
        <div class="employment-field">
          <el-date-picker v-model="form.leaveDate" type="date" value-format="YYYY-MM-DD" />
          <span v-if="resignationDisableDate" class="employment-help">预计 {{ resignationDisableDate }} 00:00（北京时间）停用，最后工作日仍可使用系统；实际以生效记录为准。</span>
          <span v-if="overlapWarning" class="employment-field__warning">{{ overlapWarning }}</span>
        </div>
      </el-form-item>
      <el-form-item label="离职原因" class="span-2"><el-input v-model="form.reason" type="textarea" :rows="3" /></el-form-item>
    </el-form>
    <el-form v-else label-position="top" class="employment-grid">
      <el-form-item label="所属公司" required :error="companyError"><EmployeeCompanySelect v-model="form.contractSubjectId" v-model:snapshot-name="form.companyText" v-model:company="form.company" @update:company="companyError = ''" /></el-form-item>
      <el-form-item label="变更类型"><el-select v-model="form.changeType"><el-option label="调动" value="transfer" /><el-option label="晋升" value="promotion" /><el-option label="上级变更" value="manager_change" /><el-option label="状态变更" value="status_change" /><el-option v-if="isHistoricalEmployment" label="离职" value="resignation" /><el-option v-if="isHistoricalEmployment" label="返聘" value="rehire" /><el-option label="历史补录" value="data_correction" /></el-select></el-form-item>
      <el-form-item label="生效日期">
        <div class="employment-field">
          <el-date-picker v-model="form.effectiveFrom" type="date" value-format="YYYY-MM-DD" />
          <span v-if="overlapWarning" class="employment-field__warning">{{ overlapWarning }}</span>
        </div>
      </el-form-item>
      <el-form-item label="结束日期"><el-date-picker v-model="form.effectiveTo" type="date" value-format="YYYY-MM-DD" clearable /></el-form-item>
      <el-form-item label="部门"><el-select v-model="form.deptId" filterable><el-option v-for="dept in flatten(departments)" :key="dept.id" :label="dept.fullPath || dept.name" :value="dept.id" /></el-select></el-form-item>
      <el-form-item label="岗位"><el-select v-model="form.positionId" filterable clearable @change="changePosition"><el-option v-for="position in positionOptions" :key="position.id" :label="position.jobFamily ? `${position.name}（${position.jobFamily}）` : position.name" :value="position.id" :disabled="!position.isActive" /></el-select></el-form-item>
      <el-form-item v-if="!form.positionId" label="岗位名称"><el-input v-model="form.position" /></el-form-item>
      <el-form-item label="职系">
        <template v-if="form.positionId"><el-input :model-value="form.jobFamily" readonly placeholder="未设置" /><small class="employment-help">随岗位只读，特殊情况请先维护岗位目录；历史已存值保留。</small></template>
        <PersonnelReferenceSelect v-else v-model="form.jobFamily" kind="job_family" label="职系" />
      </el-form-item>
      <el-form-item label="花名册直属主管"><UserSelect v-model="form.directManagerId" :disabled-ids="archive ? [archive.id] : []" clearable /></el-form-item>
      <el-form-item label="员工状态" :error="submitAttempted ? employmentStatusError : ''"><el-select v-model="form.employeeStatus" :disabled="!isHistoricalEmployment && !['active', 'probation'].includes(archive?.status ?? '')"><el-option label="在职" value="active" /><el-option label="试用期" value="probation" /><el-option v-if="isHistoricalEmployment || form.employeeStatus === 'resigned'" label="已离职" value="resigned" :disabled="!isHistoricalEmployment" /><el-option v-if="form.employeeStatus === 'pending_entry'" label="待入职" value="pending_entry" disabled /></el-select><span class="employment-help">入职、再入职和离职请在入离职页面办理；已结束的任职可补录历史状态。</span></el-form-item>
      <el-form-item label="用工类型"><el-select v-model="form.employmentType"><el-option label="全职" value="full_time" /><el-option label="兼职" value="part_time" /><el-option label="返聘" value="rehire" /><el-option label="外部" value="external" /></el-select></el-form-item>
      <el-form-item label="原因" class="span-2"><el-input v-model="form.reason" type="textarea" :rows="3" /></el-form-item>
    </el-form>
    <section v-if="isResignation" class="approval-flow" aria-labelledby="resignation-approval-title">
      <div class="approval-flow__header">
        <h3 id="resignation-approval-title">审批流程</h3>
        <el-tag :type="resignationTagType" effect="plain">{{ resignationReviewLabel }}</el-tag>
      </div>
      <el-steps :active="resignationStepActive" finish-status="success" :process-status="resignationProcessStatus" align-center>
        <el-step title="提交离职" :description="resignationSubmitDescription" />
        <el-step title="HR 审核" :description="resignationReviewDescription" />
        <el-step title="离职生效" :description="resignationEffectiveDescription" />
      </el-steps>
      <p v-if="resignationReviewState === 'rejected' && resignationReview?.rejectedReason" class="approval-flow__reason">
        退回原因：{{ resignationReview.rejectedReason }}
      </p>
    </section>
    <p class="employment-help">{{ isResignation ? '离职审核生效后停用员工登录，但不会删除档案，也不会自动归档。' : '生效日期早于今天视为历史补录；晚于今天则审核后等待到期自动生效。时间重叠会提醒，但不阻断提交。' }}</p>
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">{{ resignationReviewLocked ? '关闭' : '取消' }}</el-button>
      <el-button v-if="!isResignation || !resignationReviewLocked" type="primary" :loading="saving" @click="submit">
        {{ isResignation && resignationReviewState === 'rejected' ? '重新提交审核' : '提交审核' }}
      </el-button>
    </template>
  </el-drawer>
</template>

<style scoped>
.employment-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 18px; }.employment-grid :deep(.el-select), .employment-grid :deep(.el-date-editor) { width: 100%; }.employment-field { width: 100%; }.employment-field__warning { display: block; margin-top: 6px; color: #d97706; font-size: 12px; line-height: 1.5; }.span-2 { grid-column: span 2; }.approval-flow { margin-top: 8px; padding: 16px 12px 10px; border-top: 1px solid #ebeef5; }.approval-flow__header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }.approval-flow__header h3 { margin: 0; font-size: 16px; }.approval-flow :deep(.el-step__description) { padding: 0 8px; line-height: 1.4; }.approval-flow__reason { margin: 14px 0 0; color: #d14343; font-size: 13px; }.employment-help { color: #667085; font-size: 13px; }
@media (max-width: 640px) { .employment-grid { grid-template-columns: 1fr; }.span-2 { grid-column: auto; } }
</style>
