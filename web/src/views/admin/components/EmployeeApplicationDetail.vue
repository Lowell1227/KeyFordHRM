<script setup lang="ts">
import { computed } from 'vue';
import type { EmployeeDataReview, EmployeeReviewStatus } from '@/api/employee-archives.api';
import { formatDate, formatDateTime } from '@/utils/date';
import { isDirectArchiveApplication, isPendingArrival } from '@/utils/employee-lifecycle';
import { employeeReviewDifferences, employeeReviewValuesEqual } from './employee-review-differences';
import PersonnelProcessTimeline from './PersonnelProcessTimeline.vue';
import type { PersonnelProcessStep, PersonnelProcessTone } from './personnel-process-timeline';

const props = defineProps<{ request: EmployeeDataReview }>();

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
  companyText: '所属公司', contractSubjectId: '合同主体关联',
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
const isDirectApplication = computed(() => isDirectArchiveApplication(props.request));
function hasValue(value: unknown) {
  return value !== null && value !== undefined && value !== '';
}

function displayValue(key: string, value: unknown, source: Record<string, any>) {
  if (!hasValue(value)) return '—';
  if (key === 'contractSubjectId') return `${source.companyText || source.signingCompany || '合同主体'} · 已关联`;
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
  const keys = ['companyText', 'company', 'deptId', 'position', 'jobGrade', 'jobFamily', 'workLocation', 'employeeStatus', 'status', 'employmentType', 'entryDate', 'effectiveDate', 'effectiveFrom', 'effectiveTo', 'leaveDate', 'managerId', 'probationMonths', 'plannedRegularDate', 'actualRegularDate'];
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
    const label = section === 'performance' && key === 'managerId' ? '绩效直属上级' : key === 'company' ? '内部公司映射' : fieldLabels[key];
    return [{
      key: `${section}.${key}`,
      label,
      before: key === 'contractSubjectId' ? (before[key] ? '原主体关联' : '尚未关联') : displayValue(key, before[key], before),
      after: key === 'contractSubjectId' ? (after[key] ? '新主体关联' : '尚未关联') : displayValue(key, after[key], after),
    }];
  });
}));

const contractChangeItems = computed(() => {
  return employeeReviewDifferences(props.request).filter(group => group.kind).flatMap(group => {
    const fields = group.fields.filter(field => field.key !== 'sequence').flatMap(field => {
      const key = `contract-${group.key}-${field.key}`, label = `${group.title} · ${field.label}`;
      if (group.kind === '修改' && ['images', 'attachments'].includes(field.key)) {
        const before = props.request.baseValue.contracts?.find((item: Record<string, any>) => item.id === group.key);
        const after = props.request.proposedValue.contracts?.find((item: Record<string, any>) => item.id === group.key);
        if (before && after) {
          const oldFiles: Record<string, unknown>[] = before[field.key] ?? [], newFiles: Record<string, unknown>[] = after[field.key] ?? [];
          const same = (left: Record<string, unknown>, right: Record<string, unknown>) => employeeReviewValuesEqual(field.key, [left], [right]);
          return [
            ...oldFiles.filter(item => !newFiles.some(next => same(item, next))).map((item, index) => ({
              key: `${key}-removed-${index}`, label: `${label} · 移除`, before: String(item.name || '未命名材料'), after: '已移除',
            })),
            ...newFiles.filter(item => !oldFiles.some(previous => same(item, previous))).map((item, index) => ({
              key: `${key}-added-${index}`, label: `${label} · 新增`, before: '无', after: String(item.name || '未命名材料'),
            })),
          ];
        }
      }
      return [{ key, label, before: field.before, after: field.after }];
    });
    return group.kind === '修改' ? fields : [{
      key: `contract-${group.key}`, label: `${group.kind}合同`,
      before: group.kind === '移除' ? group.title : '无', after: group.kind === '移除' ? '已移除' : group.title,
    }, ...fields];
  });
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
].filter((scope) => !(isOnboarding.value && scope.key === 'performance' && props.request.performanceReviewStatus === 'not_required')));

const reviewStatuses = computed(() => [props.request.profileReviewStatus, props.request.performanceReviewStatus]);
const hasApprovedReview = computed(() => reviewStatuses.value.includes('approved'));
const hasRejected = computed(() => reviewStatuses.value.includes('rejected'));
const hasPending = computed(() => reviewStatuses.value.some((status) => status === 'pending' || status === 'applying'));
const hasCancelledReview = computed(() => reviewStatuses.value.includes('cancelled'));
const reviewsComplete = computed(() => [props.request.profileReviewStatus, props.request.performanceReviewStatus]
  .every((status) => status === 'approved' || status === 'not_required'));
const reviewsResolved = computed(() => reviewStatuses.value
  .every((status) => status === 'approved' || status === 'not_required' || status === 'cancelled'));
const isEffective = computed(() => props.request.intakeType
  ? props.request.onboardingStatus === 'effective'
  : Boolean(props.request.appliedAt));
const pendingArrival = computed(() => isPendingArrival(props.request));
const isOnboardingCancelled = computed(() => props.request.onboardingStatus === 'cancelled');
const hasCancellation = computed(() => props.request.onboardingStatus === 'cancelled' || Boolean(props.request.cancelledAt) || hasCancelledReview.value);
const isPartiallyCancelled = computed(() => hasCancellation.value && hasApprovedReview.value && !isOnboardingCancelled.value);
const isFullyCancelled = computed(() => isOnboardingCancelled.value || (hasCancellation.value && !hasApprovedReview.value));

const submittedEvent = computed(() => props.request.events?.find((event) => /submit_employee|submit_.*change/.test(event.action)));
const activatedEvent = computed(() => props.request.events?.find((event) => event.action === 'apply_employee_archive_change' || /activate|effective|confirm_employee_arrival/.test(event.action)));
const arrivalActionStep = computed(() => isOnboardingCancelled.value ? 'closed' : hasRejected.value && !pendingArrival.value ? 'review' : 'waiting-effective');

const processSteps = computed<PersonnelProcessStep[]>(() => {
  if (isDirectApplication.value) {
    const event = activatedEvent.value;
    return [
      {
        key: 'submitted', title: '提交', tone: 'success', current: false,
        time: formatDateTime(event?.createdAt ?? submittedEvent.value?.createdAt ?? props.request.createdAt),
        occurredAt: event?.createdAt ?? submittedEvent.value?.createdAt ?? props.request.createdAt,
        actor: event?.user?.name ?? submittedEvent.value?.user?.name ?? props.request.createdBy?.name ?? '系统', status: '已提交',
      },
      {
        key: 'effective', title: '变更生效', tone: 'success', current: false,
        time: formatDateTime(props.request.appliedAt!),
        occurredAt: props.request.appliedAt,
        actor: event?.user?.name ?? props.request.createdBy?.name ?? '系统', status: '已生效',
      },
    ];
  }
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
      occurredAt: submittedEvent.value?.createdAt ?? props.request.createdAt,
      actor: submittedEvent.value?.user?.name ?? props.request.createdBy?.name ?? '系统', status: '已提交',
    },
    {
      key: 'review', title: '档案审核', tone: reviewTone, current: !hasCancellation.value && (hasPending.value || hasRejected.value),
      time: props.request.performanceReviewedAt || props.request.profileReviewedAt ? formatDateTime(props.request.performanceReviewedAt || props.request.profileReviewedAt!) : '',
      occurredAt: props.request.performanceReviewedAt || props.request.profileReviewedAt,
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
      occurredAt: props.request.cancelledAt,
      actor: '', status: '已取消，不再生效',
    }];
  }
  if (isPartiallyCancelled.value && !isOnboarding.value) {
    return [...nodes, {
      key: 'closed', title: '办理结束', tone: 'danger' as const, current: false,
      time: props.request.cancelledAt ? formatDateTime(props.request.cancelledAt) : '',
      occurredAt: props.request.cancelledAt,
      actor: '', status: '部分内容已生效，其余已取消',
    }];
  }
  const waitingCurrent = pendingArrival.value || (reviewsResolved.value && !isEffective.value);
  return [...nodes,
    {
      key: 'waiting-effective', title: isOnboarding.value ? (props.request.requiresArrivalConfirmation ? '确认到岗' : '待入职') : '待变更生效',
      tone: isEffective.value ? 'success' : waitingCurrent ? 'current' : 'waiting',
      current: waitingCurrent,
      time: props.request.arrivalConfirmedAt ? formatDateTime(props.request.arrivalConfirmedAt) : '',
      occurredAt: props.request.arrivalConfirmedAt,
      actor: '', status: isEffective.value ? '已完成' : waitingCurrent ? (isOnboarding.value ? (props.request.requiresArrivalConfirmation ? '待 HR 确认到岗' : '等待入职日期') : '等待生效日期') : '等待处理',
    },
    {
      key: 'effective', title: isOnboarding.value ? '入职生效' : '变更生效', tone: isEffective.value ? 'success' : 'waiting', current: false,
      time: isEffective.value && props.request.appliedAt ? formatDateTime(props.request.appliedAt) : '',
      occurredAt: isEffective.value ? props.request.appliedAt : null,
      actor: activatedEvent.value?.user?.name ?? (isEffective.value ? '系统' : ''),
      status: isEffective.value ? '已生效' : '等待处理',
    },
  ];
});

const timeline = computed<PersonnelProcessStep[]>(() => {
  const history: Array<PersonnelProcessStep & { stage?: string }> = [];
  const seen = new Set<string>();
  for (const event of props.request.events ?? []) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    const action = event.action;
    let title = '', status = '已提交', tone: PersonnelProcessTone = 'success', stage: string | undefined;
    if (/^reopen_/.test(action)) title = '恢复入职并重新提交';
    else if (action === 'revise_employee_arrival_date') title = '修改到岗日期并重新提交';
    else if (/^revise_/.test(action)) title = '修改并重新提交';
    else if (/^reject_/.test(action)) { title = '退回申请'; status = '已退回'; tone = 'danger'; stage = 'review'; }
    else if (/^(cancel|withdraw)_/.test(action)) { title = '取消申请'; status = event.newValue?.partial ? '部分已取消' : '已取消'; tone = 'danger'; stage = 'closed'; }
    else if (/^approve_/.test(action)) { title = '档案审核'; status = '已通过'; stage = 'review'; }
    else if (/^submit_/.test(action)) { title = isDirectApplication.value ? '提交' : isOnboarding.value ? '提交审核' : '提交申请'; stage = 'submitted'; }
    else if (action === 'confirm_employee_arrival') { title = '确认到岗'; status = '已完成'; stage = 'waiting-effective'; }
    else if (action === 'activate_employee_onboarding' || action === 'apply_employee_archive_change') {
      title = isOnboarding.value ? '入职生效' : '变更生效'; status = '已生效'; stage = 'effective';
    } else continue;
    const occurredAt = stage === 'waiting-effective' ? props.request.arrivalConfirmedAt || event.createdAt
      : stage === 'effective' ? props.request.appliedAt || event.createdAt : event.createdAt;
    const actor = event.user?.name || '系统';
    const time = formatDateTime(occurredAt);
    const scopes = Array.isArray(event.newValue?.scopes) ? event.newValue.scopes as string[] : [];
    history.push({
      key: `event-${event.id}`, eventId: event.id, eventAction: action, stage,
      title, status, tone, actor, time, occurredAt,
      note: typeof event.newValue?.reason === 'string' ? event.newValue.reason : undefined,
      details: /^approve_/.test(action) ? scopes.filter(scope => ['profile', 'performance'].includes(scope)).map(scope => ({
        key: scope, title: scope === 'profile' ? '基础档案' : '绩效关系', status, tone, actor, time,
      })) : undefined,
    });
  }
  // Audit entries retain earlier rounds; current state supplies only missing or pending stages.
  const pending: PersonnelProcessStep[] = [];
  const completed: PersonnelProcessStep[] = [...history];
  for (const step of processSteps.value) {
    const records = history.filter(event => event.stage === step.key);
    if (step.current || step.tone === 'waiting') {
      pending.push({ ...step, occurredAt: null, time: '', actor: '' });
    } else if (records.length) {
      records[records.length - 1]!.key = step.key;
    } else if (step.occurredAt) {
      completed.push(step);
    } else {
      pending.push(step);
    }
  }
  completed.sort((a, b) => {
    const elapsed = Date.parse(a.occurredAt!) - Date.parse(b.occurredAt!);
    if (elapsed) return elapsed;
    // Arrival and activation share one transaction timestamp; retain their business order.
    if (a.key === 'waiting-effective' && b.key === 'effective') return -1;
    if (a.key === 'effective' && b.key === 'waiting-effective') return 1;
    return 0;
  });
  return [...completed, ...pending];
});
</script>

<template>
  <section class="application-detail">
    <section v-if="request.talentCandidateId" class="application-detail__section">
      <h3>来源人才</h3>
      <span>{{ request.talentCandidate?.name || '已关联人才' }}</span>
      <el-tag v-if="request.talentCandidate?.deletedAt" size="small" type="info">来源候选人已删除</el-tag>
    </section>
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
      <PersonnelProcessTimeline :items="timeline" label="办理流程" data-testid="personnel-application-timeline">
        <template #step-action="{ item }">
          <slot v-if="item.key === arrivalActionStep" name="arrival-action" />
        </template>
      </PersonnelProcessTimeline>
    </section>
  </section>
</template>

<style scoped>
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
.application-detail__changes strong { min-width: 0; overflow-wrap: anywhere; }
@media (max-width: 640px) {
  .application-detail__facts { grid-template-columns: 1fr; }
  .application-detail__facts > div { border-right: 0; }
  .application-detail__facts > div:nth-last-child(-n + 2) { border-bottom: 1px solid var(--el-border-color-lighter); }
  .application-detail__facts > div:last-child { border-bottom: 0; }
  .application-detail__changes > div { grid-template-columns: 1fr; gap: 4px; }
}
</style>
