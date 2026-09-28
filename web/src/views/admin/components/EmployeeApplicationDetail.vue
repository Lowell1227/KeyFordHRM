<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { EmployeeDataReview, EmployeeReviewStatus } from '@/api/employee-archives.api';
import { applicationProgress, applicationType } from '@/utils/employee-lifecycle';
import { formatDate, formatDateTime } from '@/utils/date';
import PersonnelProcessTimeline from './PersonnelProcessTimeline.vue';
import type { PersonnelProcessStep, PersonnelProcessTone } from './personnel-process-timeline';

const props = defineProps<{ request: EmployeeDataReview }>();
const expanded = ref<string[]>([]);

watch(() => props.request.id, () => { expanded.value = []; });

const companyLabels: Record<string, string> = {
  fuede: '孚德',
  fuede_sports: '孚德体育文化',
  beijing_fuede: '北京孚德',
  fansibao: '凡思堡',
};
const employeeStatusLabels: Record<string, string> = {
  active: '在职',
  probation: '试用期',
  pending_entry: '待入职',
  resigned: '已离职',
};
const employmentTypeLabels: Record<string, string> = {
  full_time: '全职',
  part_time: '兼职',
  rehire: '返聘',
  external: '外部',
};
const fieldLabels: Record<string, string> = {
  name: '姓名',
  phone: '手机号',
  company: '所属公司',
  deptId: '部门',
  position: '岗位',
  jobGrade: '职级',
  jobFamily: '职系',
  workLocation: '工作地点',
  employeeStatus: '任职状态',
  status: '任职状态',
  employmentType: '用工类型',
  entryDate: '入职日期',
  effectiveFrom: '生效日期',
  effectiveDate: '生效日期',
  effectiveTo: '结束日期',
  leaveDate: '最后工作日',
  managerId: '直属上级',
  probationMonths: '试用期（月）',
  plannedRegularDate: '预计转正日期',
  actualRegularDate: '实际转正日期',
  gender: '性别',
  birthDate: '出生日期',
  ethnicity: '民族',
  education: '学历',
  professionalTitle: '职称',
  school: '毕业院校',
  graduationDate: '毕业日期',
  major: '专业',
  maritalStatus: '婚姻状况',
  childrenStatus: '子女状况',
  childrenCount: '子女数量',
  politicalStatus: '政治面貌',
  nativePlace: '籍贯',
  householdType: '户籍类型',
  idAddress: '身份证地址',
  currentAddress: '现住址',
  emergencyContactName: '紧急联系人',
  emergencyContactRelation: '与联系人关系',
  emergencyContactPhone: '紧急联系电话',
  socialSecurityStatus: '社保状态',
  socialSecurityStartDate: '社保起始日期',
  housingFundStatus: '公积金状态',
  housingFundStartDate: '公积金起始日期',
  bankName: '开户行',
  bankBranch: '开户支行',
  idNumberConfigured: '身份证',
  bankAccountConfigured: '银行卡',
};
const dateFields = new Set(['entryDate', 'effectiveFrom', 'effectiveDate', 'effectiveTo', 'leaveDate', 'plannedRegularDate', 'actualRegularDate', 'birthDate', 'graduationDate', 'socialSecurityStartDate', 'housingFundStartDate']);

const employee = computed<Record<string, any>>(() => props.request.proposedValue?.employee ?? {});
const profile = computed<Record<string, any>>(() => props.request.proposedValue?.profile ?? {});
const performance = computed<Record<string, any>>(() => props.request.proposedValue?.performance ?? {});
const isOnboarding = computed(() => Boolean(props.request.intakeType || props.request.sourceType === 'manual_employee_create'));
const effectiveDate = computed(() => employee.value.effectiveDate || employee.value.effectiveFrom || employee.value.entryDate || employee.value.leaveDate || null);

function hasValue(value: unknown) {
  return value !== null && value !== undefined && value !== '';
}

function displayValue(key: string, value: unknown, source: Record<string, any>) {
  if (!hasValue(value)) return '—';
  if (key === 'company') return companyLabels[String(value)] ?? String(value);
  if (key === 'employeeStatus' || key === 'status') return employeeStatusLabels[String(value)] ?? String(value);
  if (key === 'employmentType') return employmentTypeLabels[String(value)] ?? String(value);
  if (key === 'deptId') return source.departmentName || source.deptName || '已设置';
  if (key === 'managerId') return source.managerName || '已设置';
  if (dateFields.has(key)) return formatDate(String(value));
  if (key === 'phone' || key === 'emergencyContactPhone') return '已保存';
  if (key.endsWith('Configured')) return value ? '已保存' : '—';
  return String(value);
}

const employmentItems = computed(() => {
  const keys = ['company', 'deptId', 'position', 'jobGrade', 'jobFamily', 'workLocation', 'employeeStatus', 'status', 'employmentType', 'entryDate', 'effectiveDate', 'effectiveFrom', 'effectiveTo', 'leaveDate', 'managerId', 'probationMonths', 'plannedRegularDate', 'actualRegularDate'];
  const seenLabels = new Set<string>();
  const items = keys.flatMap((key) => {
    const value = employee.value[key];
    const label = fieldLabels[key];
    if (!label || !hasValue(value) || seenLabels.has(label)) return [];
    seenLabels.add(label);
    return [{ key, label: key === 'managerId' ? '花名册直属上级' : label, value: displayValue(key, value, employee.value) }];
  });
  if (hasValue(performance.value.managerId)) {
    items.push({ key: 'performance.managerId', label: '绩效直属上级', value: displayValue('managerId', performance.value.managerId, performance.value) });
  }
  return items;
});

const profileItems = computed(() => Object.keys(fieldLabels).flatMap((key) => {
  const value = profile.value[key];
  if (!hasValue(value) || (key.endsWith('Configured') && !value)) return [];
  return [{ key, label: fieldLabels[key], value: displayValue(key, value, profile.value) }];
}));

const changeItems = computed(() => ['employee', 'profile', 'performance'].flatMap((section) => {
  const before = props.request.baseValue?.[section] ?? {};
  const after = props.request.proposedValue?.[section] ?? {};
  return Object.keys(fieldLabels).flatMap((key) => {
    if (!(key in after) || JSON.stringify(before[key] ?? null) === JSON.stringify(after[key] ?? null)) return [];
    const label = section === 'performance' && key === 'managerId' ? '绩效直属上级' : fieldLabels[key];
    return [{
      key: `${section}.${key}`,
      label,
      before: displayValue(key, before[key], before),
      after: displayValue(key, after[key], after),
    }];
  });
}));

const contractChangeItems = computed(() => {
  const before = Array.isArray(props.request.baseValue?.contracts) ? props.request.baseValue.contracts as Record<string, any>[] : [];
  const after = Array.isArray(props.request.proposedValue?.contracts) ? props.request.proposedValue.contracts as Record<string, any>[] : [];
  const labels: Record<string, string> = {
    name: '名称', contractType: '类型', signingCompany: '签约公司', signedAt: '签订日期',
    effectiveFrom: '生效日期', expiresAt: '到期日期', termType: '期限', originalCompany: '原公司',
    newCompany: '新公司', confidentialityAgreement: '保密协议', nonCompeteAgreement: '竞业协议', portraitAgreement: '肖像协议',
  };
  const result: Array<{ key: string; label: string; before: string; after: string }> = [];
  after.forEach((contract, index) => {
    const old = contract.id ? before.find((item) => item.id === contract.id) : undefined;
    const kind = ({ contract: '合同', attachment: '附件' } as Record<string, string>)[String(contract.kind)]
      ?? (hasValue(contract.kind) ? String(contract.kind) : '');
    const title = String(contract.name || [kind, contract.reference].filter(hasValue).join(' · ') || `合同材料 ${index + 1}`);
    if (!old) {
      result.push({ key: `contract-${index}`, label: '新增合同', before: '无', after: title });
      return;
    }
    Object.entries(labels).forEach(([key, label]) => {
      if (JSON.stringify(old[key] ?? null) === JSON.stringify(contract[key] ?? null)) return;
      result.push({ key: `contract-${index}-${key}`, label: `${title} · ${label}`, before: hasValue(old[key]) ? String(old[key]) : '—', after: hasValue(contract[key]) ? String(contract[key]) : '—' });
    });
    for (const key of ['images', 'attachments']) {
      if (JSON.stringify(old[key] ?? []) === JSON.stringify(contract[key] ?? [])) continue;
      result.push({ key: `contract-${index}-${key}`, label: `${title} · ${key === 'images' ? '图片' : '附件'}`, before: `${old[key]?.length ?? 0} 份`, after: `${contract[key]?.length ?? 0} 份` });
    }
  });
  before.filter((old) => !after.some((item) => item.id === old.id)).forEach((old, index) => {
    result.push({ key: `removed-contract-${index}`, label: '移除合同', before: String(old.name || '未命名合同'), after: '已移除' });
  });
  return result;
});

const allChangeItems = computed(() => [...changeItems.value, ...contractChangeItems.value]);

function reviewStatus(status: EmployeeReviewStatus) {
  return ({
    approved: { label: '已通过', tone: 'success' },
    rejected: { label: '已退回', tone: 'danger' },
    pending: { label: '待审核', tone: 'current' },
    applying: { label: '审核中', tone: 'current' },
    cancelled: { label: '已取消', tone: 'danger' },
    not_required: { label: '无需审核', tone: 'neutral' },
  } as const)[status] ?? { label: status, tone: 'neutral' as const };
}

const reviewScopes = computed(() => [
  {
    key: 'profile', label: '基础档案', status: reviewStatus(props.request.profileReviewStatus),
    actor: props.request.profileReviewedBy?.name, time: props.request.profileReviewedAt,
  },
  {
    key: 'performance', label: '绩效关系', status: reviewStatus(props.request.performanceReviewStatus),
    actor: props.request.performanceReviewedBy?.name, time: props.request.performanceReviewedAt,
  },
]);

const reviewStatuses = computed(() => [props.request.profileReviewStatus, props.request.performanceReviewStatus]);
const hasApprovedReview = computed(() => reviewStatuses.value.includes('approved'));
const hasRejected = computed(() => reviewStatuses.value.includes('rejected'));
const hasPending = computed(() => reviewStatuses.value.some((status) => status === 'pending' || status === 'applying'));
const hasCancelledReview = computed(() => reviewStatuses.value.includes('cancelled'));
const reviewsComplete = computed(() => [props.request.profileReviewStatus, props.request.performanceReviewStatus]
  .every((status) => status === 'approved' || status === 'not_required'));
const reviewsResolved = computed(() => reviewStatuses.value
  .every((status) => status === 'approved' || status === 'not_required' || status === 'cancelled'));
const isEffective = computed(() => props.request.onboardingStatus === 'effective' || Boolean(props.request.appliedAt));
const isOnboardingCancelled = computed(() => props.request.onboardingStatus === 'cancelled');
const hasCancellation = computed(() => props.request.onboardingStatus === 'cancelled' || Boolean(props.request.cancelledAt) || hasCancelledReview.value);
const isPartiallyCancelled = computed(() => hasCancellation.value && hasApprovedReview.value && !isOnboardingCancelled.value);
const isFullyCancelled = computed(() => isOnboardingCancelled.value || (hasCancellation.value && !hasApprovedReview.value));

const submittedEvent = computed(() => props.request.events?.find((event) => /submit_employee|submit_.*change/.test(event.action)));
const activatedEvent = computed(() => props.request.events?.find((event) => /activate|effective/.test(event.action)));
const revisionEvents = computed(() => (props.request.events ?? []).filter((event) => /revise|reject|cancel|withdraw/.test(event.action)));

const timeline = computed<PersonnelProcessStep[]>(() => {
  const reviewTone: PersonnelProcessTone = isFullyCancelled.value || hasRejected.value || hasCancelledReview.value ? 'danger' : hasPending.value ? 'current' : reviewsComplete.value ? 'success' : 'waiting';
  const reviewAction = isFullyCancelled.value
    ? '申请已取消'
    : hasRejected.value
    ? '已退回'
    : isPartiallyCancelled.value
      ? '部分通过，其余已取消'
      : hasCancelledReview.value
        ? '已取消'
        : hasPending.value
          ? '待审核'
          : reviewsComplete.value
            ? '已完成'
            : '待办理';
  const nodes = [
    {
      key: 'submitted', title: isOnboarding.value ? '提交审核' : '提交申请', tone: 'success' as const, current: false,
      time: formatDateTime(submittedEvent.value?.createdAt ?? props.request.createdAt),
      actor: submittedEvent.value?.user?.name ?? props.request.createdBy?.name ?? '系统', status: '已提交',
    },
    {
      key: 'review', title: '档案审核', tone: reviewTone, current: !hasCancellation.value && (hasPending.value || hasRejected.value),
      time: props.request.performanceReviewedAt || props.request.profileReviewedAt ? formatDateTime(props.request.performanceReviewedAt || props.request.profileReviewedAt!) : '',
      actor: props.request.performanceReviewedBy?.name ?? props.request.profileReviewedBy?.name ?? '',
      status: reviewAction,
      note: props.request.rejectedReason ? `退回原因：${props.request.rejectedReason}` : '',
      details: reviewScopes.value.map((scope) => ({
        key: scope.key,
        title: scope.label,
        status: scope.status.label,
        tone: scope.status.tone,
        actor: scope.actor,
        time: scope.time ? formatDateTime(scope.time) : '',
      })),
    },
  ];
  if (isFullyCancelled.value) {
    return [...nodes, {
      key: 'closed', title: '办理结束', tone: 'danger' as const, current: false,
      time: props.request.cancelledAt ? formatDateTime(props.request.cancelledAt) : '',
      actor: '', status: '已取消，不再生效',
    }];
  }
  if (isPartiallyCancelled.value && !isOnboarding.value) {
    return [...nodes, {
      key: 'closed', title: '办理结束', tone: 'danger' as const, current: false,
      time: props.request.cancelledAt ? formatDateTime(props.request.cancelledAt) : '',
      actor: '', status: '部分内容已生效，其余已取消',
    }];
  }
  const waitingCurrent = reviewsResolved.value && !isEffective.value;
  return [...nodes,
    {
      key: 'waiting-effective', title: isOnboarding.value ? '待入职' : '待变更生效',
      tone: isEffective.value ? 'success' : waitingCurrent ? 'current' : 'waiting',
      current: waitingCurrent,
      time: '',
      actor: '', status: isEffective.value ? '已完成' : waitingCurrent ? (isOnboarding.value ? '等待入职日期' : '等待生效日期') : '等待处理',
    },
    {
      key: 'effective', title: isOnboarding.value ? '入职生效' : '变更生效', tone: isEffective.value ? 'success' : 'waiting', current: false,
      time: props.request.appliedAt ? formatDateTime(props.request.appliedAt) : '',
      actor: activatedEvent.value?.user?.name ?? (isEffective.value ? '系统' : ''),
      status: isEffective.value ? '已生效' : '等待处理',
    },
  ];
});

function eventLabel(action: string) {
  if (/reject/.test(action)) return '退回申请';
  if (/cancel|withdraw/.test(action)) return '取消申请';
  if (/revise/.test(action)) return '修改并重新提交';
  return '更新申请';
}
</script>

<template>
  <section class="application-detail">
    <el-collapse v-model="expanded">
      <el-collapse-item :name="request.id">
        <template #title>
          <div class="application-detail__title">
            <strong>{{ applicationType(request) }}</strong>
            <span v-if="effectiveDate">{{ formatDate(effectiveDate) }}</span>
            <el-tag size="small" effect="plain">{{ applicationProgress(request) }}</el-tag>
          </div>
        </template>

        <section class="application-detail__section">
          <h3>{{ isOnboarding ? '本次任职信息' : '本次变更内容' }}</h3>
          <dl v-if="isOnboarding && employmentItems.length" class="application-detail__facts">
            <div v-for="item in employmentItems" :key="item.key"><dt>{{ item.label }}</dt><dd>{{ item.value }}</dd></div>
          </dl>
          <div v-else-if="allChangeItems.length" class="application-detail__changes">
            <div v-for="item in allChangeItems" :key="item.key"><strong>{{ item.label }}</strong><span>{{ item.before }} → {{ item.after }}</span></div>
          </div>
          <el-empty v-else description="暂无可展示的变更内容" :image-size="56" />
        </section>

        <section v-if="isOnboarding && profileItems.length" class="application-detail__section">
          <h3>补充资料</h3>
          <dl class="application-detail__facts">
            <div v-for="item in profileItems" :key="item.key"><dt>{{ item.label }}</dt><dd>{{ item.value }}</dd></div>
          </dl>
        </section>

        <section v-if="isOnboarding && contractChangeItems.length" class="application-detail__section">
          <h3>合同材料</h3>
          <div class="application-detail__changes">
            <div v-for="item in contractChangeItems" :key="item.key"><strong>{{ item.label }}</strong><span>{{ item.before }} → {{ item.after }}</span></div>
          </div>
        </section>

        <section class="application-detail__section">
          <h3>办理流程</h3>
          <PersonnelProcessTimeline :items="timeline" label="办理流程" data-testid="personnel-application-timeline" />
        </section>

        <section v-if="revisionEvents.length" class="application-detail__section">
          <h3>补充办理记录</h3>
          <ul class="application-detail__events">
            <li v-for="event in revisionEvents" :key="event.id"><strong>{{ eventLabel(event.action) }}</strong><span>{{ event.user?.name || '系统' }} · {{ formatDateTime(event.createdAt) }}</span></li>
          </ul>
        </section>
      </el-collapse-item>
    </el-collapse>
  </section>
</template>

<style scoped>
.application-detail__title { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; min-width: 0; padding: 8px 0; }
.application-detail__title span { color: var(--el-text-color-secondary); }
.application-detail :deep(.el-collapse-item__header) { height: auto; min-height: 52px; }
.application-detail__section { padding: 18px 0; border-bottom: 1px solid var(--el-border-color-lighter); }
.application-detail__section:last-child { border-bottom: 0; }
.application-detail__section h3 { margin: 0 0 14px; font-size: 15px; }
.application-detail__facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); margin: 0; border: 1px solid var(--el-border-color-lighter); border-radius: 8px; overflow: hidden; }
.application-detail__facts > div { min-width: 0; padding: 11px 14px; border-right: 1px solid var(--el-border-color-lighter); border-bottom: 1px solid var(--el-border-color-lighter); }
.application-detail__facts > div:nth-child(2n) { border-right: 0; }
.application-detail__facts > div:nth-last-child(-n + 2) { border-bottom: 0; }
.application-detail__facts dt { margin-bottom: 4px; color: var(--el-text-color-secondary); font-size: 12px; }
.application-detail__facts dd { margin: 0; overflow-wrap: anywhere; color: var(--el-text-color-primary); font-weight: 600; line-height: 20px; }
.application-detail__changes > div { display: grid; grid-template-columns: 140px minmax(0, 1fr); gap: 12px; padding: 9px 0; border-bottom: 1px solid var(--el-border-color-lighter); }
.application-detail__changes span { overflow-wrap: anywhere; color: var(--el-text-color-regular); }
.application-detail__events { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.application-detail__events li { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; padding: 9px 12px; border-radius: 6px; background: var(--el-fill-color-extra-light); }
.application-detail__events span { color: var(--el-text-color-secondary); }
@media (max-width: 640px) {
  .application-detail__facts { grid-template-columns: 1fr; }
  .application-detail__facts > div { border-right: 0; }
  .application-detail__facts > div:nth-last-child(-n + 2) { border-bottom: 1px solid var(--el-border-color-lighter); }
  .application-detail__facts > div:last-child { border-bottom: 0; }
  .application-detail__changes > div { grid-template-columns: 1fr; gap: 4px; }
}
</style>
