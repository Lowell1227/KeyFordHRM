<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ArrowLeft } from '@element-plus/icons-vue';
import dayjs from 'dayjs';
import type { AssessmentCycle, CycleParticipantRecord, LaunchPreflightResult } from '@/types/api.types';
import type { CycleStatus } from '@/types/enums';
import { formatDate } from '@/utils/date';
import { cycleNextStep, cycleStageIndex } from '../cycle-management';

const props = withDefaults(defineProps<{
  cycle?: AssessmentCycle | null;
  loading?: boolean;
  error?: string;
  preflight?: LaunchPreflightResult | null;
  preflightLoading?: boolean;
  preflightError?: string;
  participantRecord?: CycleParticipantRecord | null;
  participantRecordLoading?: boolean;
  participantRecordError?: string;
  launchAction?: 'launch' | 'schedule' | null;
  canEdit?: boolean;
}>(), {
  cycle: null,
  loading: false,
  error: '',
  preflight: null,
  preflightLoading: false,
  preflightError: '',
  participantRecord: null,
  participantRecordLoading: false,
  participantRecordError: '',
  launchAction: null,
  canEdit: false,
});

const emit = defineEmits<{
  back: [];
  retry: [];
  launch: [];
  schedule: [];
  edit: [];
  'resolve-blocker': [code: string];
}>();

const stages = ['规划配置', '目标制定', '绩效评价', '校准与审批', '公示归档'];
const participantFilterOptions = [
  { key: 'all', label: '全部' },
  { key: 'active', label: '正常参与' },
  { key: 'exempted', label: '已豁免' },
] as const;
const currentStage = computed(() => props.cycle ? cycleStageIndex(props.cycle.status) : 0);
const nextStep = computed(() => props.cycle ? cycleNextStep(props.cycle) : null);
const participantFilter = ref<'all' | 'active' | 'exempted'>('all');
const participantKeyword = ref('');
const isPrelaunch = computed(() => Boolean(
  props.cycle
  && !props.cycle.openedAt
  && ['draft', 'scheduled', 'launch_blocked'].includes(props.cycle.status),
));
const canRunLaunchAction = computed(() => Boolean(
  props.cycle && ['draft', 'launch_blocked'].includes(props.cycle.status),
));
const activeTaskCount = computed(() => {
  const stats = props.cycle?.taskStats;
  return stats ? Math.max(0, stats.total - stats.exempted) : 0;
});

const STATUS_LABEL: Record<CycleStatus, string> = {
  draft: '草稿',
  scheduled: '待发起',
  launch_blocked: '发起受阻',
  indicator_setting: '目标制定中',
  self_eval: '员工自评中',
  manager_score: '主管评分中',
  hr_calibration: 'HR校准中',
  approval: '审批中',
  published: '已公示',
  appeal: '申诉中',
  closed: '已关闭',
};

function formatDateTime(value?: string): string {
  if (!value) return '未设置';
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format('YYYY-MM-DD HH:mm') : '未设置';
}

function blockerActionLabel(code: string): string {
  if (code.startsWith('TEMPLATE_') || code === 'NO_ACTIVE_TEMPLATES') return '去配置考核模板';
  if (code === 'ORGANIZATION_RELATION_INVALID') return '去完善人员关系';
  return '';
}

function scoringSummary(cycle: AssessmentCycle): string {
  if (cycle.workflowVersion !== 2) return '历史流程';
  return cycle.scoringFrequency === 'monthly'
    ? `月度跟进 · ${cycle.periodSchedules?.length ?? 0}期`
    : '周期结束统一评分';
}

function scheduleExceptionCount(cycle: AssessmentCycle): number {
  return cycle.periodSchedules?.filter((schedule) => schedule.isException).length ?? 0;
}

type V2PreflightParticipant = LaunchPreflightResult['participants'][number] & {
  participantDisposition?: 'active' | 'cycle_exempt' | 'top_leader_exempt';
};

type V2PreflightExclusion = {
  employeeId: string;
  employeeName: string;
  reasonCode: 'PROBATION_NOT_IN_PLAN';
  reason: string;
};

function preflightParticipants(result: LaunchPreflightResult): V2PreflightParticipant[] {
  return result.participants as V2PreflightParticipant[];
}

function preflightExclusions(result: LaunchPreflightResult): V2PreflightExclusion[] {
  return (result as LaunchPreflightResult & { exclusions?: V2PreflightExclusion[] }).exclusions ?? [];
}

function probationExclusionCount(result: LaunchPreflightResult): number {
  return preflightExclusions(result).filter((item) => item.reasonCode === 'PROBATION_NOT_IN_PLAN').length;
}

type PreflightIssue = LaunchPreflightResult['warnings'][number];
type GroupedPreflightIssue = PreflightIssue & { count: number };

function groupPreflightIssues(issues: PreflightIssue[]): GroupedPreflightIssue[] {
  const grouped = new Map<string, GroupedPreflightIssue>();
  issues.forEach((issue) => {
    const key = issue.message.trim();
    const existing = grouped.get(key);
    if (existing) {
      existing.count += 1;
      return;
    }
    grouped.set(key, { ...issue, count: 1 });
  });
  return Array.from(grouped.values());
}

const groupedPreflightBlockers = computed(() => groupPreflightIssues(props.preflight?.blockers ?? []));
const groupedPreflightWarnings = computed(() => groupPreflightIssues(props.preflight?.warnings ?? []));

const planCheckSummary = computed(() => {
  const blockerCount = groupedPreflightBlockers.value.length;
  const warningCount = groupedPreflightWarnings.value.length;
  if (!blockerCount && !warningCount) return '检查通过，可以发起考核。';
  const parts = [];
  if (blockerCount) parts.push(`${blockerCount}项需处理`);
  if (warningCount) parts.push(`${warningCount}项时间提醒`);
  return `${parts.join('，')}。${warningCount ? '时间提醒不影响发起。' : ''}`;
});

const cycleTimeNodes = computed(() => {
  if (!props.cycle) return [];
  return [
    { label: '目标制定截止', value: props.cycle.deadlineIndicatorSetting },
    { label: '目标确认截止', value: props.cycle.deadlineIndicatorConfirm },
    { label: '员工自评开放', value: props.cycle.selfEvalOpenAt },
    { label: '员工自评截止', value: props.cycle.deadlineSelfEval },
    { label: '主管评分截止', value: props.cycle.deadlineManagerScore },
    { label: 'HR校准截止', value: props.cycle.deadlineHrCalibration },
    { label: '结果审批截止', value: props.cycle.deadlineApproval },
    { label: '结果公示截止', value: props.cycle.deadlinePublish },
  ];
});

function participantDispositionLabel(participant: {
  participantDisposition?: 'active' | 'cycle_exempt' | 'top_leader_exempt';
  isExempt: boolean;
}): string {
  if (participant.participantDisposition === 'top_leader_exempt') return '最高负责人豁免';
  if (participant.participantDisposition === 'cycle_exempt' || participant.isExempt) return '已豁免';
  return '正常参与';
}

type ParticipantRow = V2PreflightParticipant | CycleParticipantRecord['participants'][number];

const participantRows = computed<ParticipantRow[]>(() => (
  isPrelaunch.value
    ? (props.preflight ? preflightParticipants(props.preflight) : [])
    : (props.participantRecord?.participants ?? [])
));

const filteredParticipantRows = computed(() => {
  const keyword = participantKeyword.value.trim().toLocaleLowerCase();
  return participantRows.value.filter((participant) => {
    if (participantFilter.value === 'active' && participant.isExempt) return false;
    if (participantFilter.value === 'exempted' && !participant.isExempt) return false;
    if (!keyword) return true;
    return [participant.employeeName, participant.deptName, participant.managerName]
      .filter(Boolean)
      .some((value) => String(value).toLocaleLowerCase().includes(keyword));
  });
});

const preflightExemptedCount = computed(() => (
  props.preflight ? preflightParticipants(props.preflight).filter((participant) => participant.isExempt).length : 0
));

const preflightActiveCount = computed(() => (
  props.preflight ? preflightParticipants(props.preflight).filter((participant) => !participant.isExempt).length : 0
));

function participantReason(participant: ParticipantRow): string {
  return participant.exemptReason || (participant.isExempt ? '本周期豁免' : '—');
}

function recordSourceLabel(record: CycleParticipantRecord): string {
  return record.source === 'scheduled' ? '预约发起' : '手动发起';
}

function reviewSummary(cycle: AssessmentCycle): string {
  const status = cycle.reviewStatus === 'approved' ? '已通过' : cycle.reviewStatus === 'rejected' ? '已退回' : '待审核';
  return `审核：${status} · ${cycle.reviewer?.name || 'HR 管理员审核池'}`;
}

watch(() => props.cycle?.id, () => {
  participantFilter.value = 'all';
  participantKeyword.value = '';
});

</script>

<template>
  <section class="cycle-workspace" data-testid="cycle-workspace">
    <header class="cycle-workspace__header">
      <div class="cycle-workspace__identity">
        <el-button
          text
          :icon="ArrowLeft"
          data-testid="cycle-workspace-back"
          aria-label="返回周期列表"
          @click="emit('back')"
        />
        <div>
          <div class="cycle-workspace__title-row">
            <h1>{{ cycle?.name || '周期详情' }}</h1>
            <el-tag v-if="cycle" size="small" effect="light">{{ STATUS_LABEL[cycle.status] }}</el-tag>
          </div>
          <p v-if="cycle">{{ formatDate(cycle.startDate) }}–{{ formatDate(cycle.endDate) }}</p>
          <div v-if="cycle" class="cycle-workspace__meta">
            <span>创建人：{{ cycle.creator?.name || '—' }}</span>
            <span>{{ reviewSummary(cycle) }}</span>
            <span v-if="cycle.workflowVersion !== 2 && cycle.monthlyFollowUpRequired">需按月跟进</span>
          </div>
          <div v-if="cycle" class="cycle-workspace__scoring" data-testid="cycle-workspace-scoring-summary">
            <span>{{ scoringSummary(cycle) }}</span>
            <span v-if="cycle.workflowVersion === 2">结果审核：按周期审核</span>
            <span v-if="cycle.workflowVersion === 2">已调整月份：{{ scheduleExceptionCount(cycle) }}个</span>
            <span v-if="cycle.workflowVersion === 2">公司最终审定人：{{ cycle.companyFinalApprover?.name || '未配置' }}</span>
          </div>
        </div>
      </div>
      <div
        v-if="cycle?.status === 'draft' && canEdit"
        class="cycle-workspace__header-actions"
      >
        <el-button
          data-testid="cycle-workspace-edit"
          @click="emit('edit')"
        >编辑</el-button>
      </div>
    </header>

    <el-skeleton v-if="loading" class="cycle-workspace__surface" animated :rows="8" />
    <el-result
      v-else-if="error"
      class="cycle-workspace__surface"
      icon="error"
      title="周期详情加载失败"
      :sub-title="error"
    >
      <template #extra><el-button type="primary" @click="emit('retry')">重试</el-button></template>
    </el-result>

    <template v-else-if="cycle">
      <nav class="cycle-stage-strip" aria-label="周期流程阶段">
        <div
          v-for="(stage, index) in stages"
          :key="stage"
          :data-testid="`cycle-stage-${index}`"
          class="cycle-stage-strip__item"
          :class="{
            'is-completed': index < currentStage,
            'is-current': index === currentStage,
            'is-blocked': index === currentStage && cycle.status === 'launch_blocked',
          }"
          :aria-current="index === currentStage ? 'step' : undefined"
        >
          <span>{{ index + 1 }}</span>
          <strong>{{ stage }}</strong>
        </div>
      </nav>

      <main class="cycle-workspace__main">
        <section class="cycle-current-action" data-testid="cycle-current-action">
          <div class="cycle-current-action__heading">
            <div>
              <span>当前要做</span>
              <h2>{{ nextStep?.label }}</h2>
              <p v-if="nextStep?.time">计划时间：{{ formatDateTime(nextStep.time) }}</p>
            </div>
            <div
              v-if="canRunLaunchAction"
              class="cycle-preflight-primary-action"
              data-testid="cycle-preflight-primary-action"
            >
              <el-button
                type="primary"
                :loading="launchAction === 'launch'"
                :disabled="launchAction === 'schedule'"
                @click="emit('launch')"
              >
                发起考核
              </el-button>
              <el-button
                :loading="launchAction === 'schedule'"
                :disabled="launchAction === 'launch'"
                @click="emit('schedule')"
              >
                预约发起
              </el-button>
            </div>
          </div>

          <div v-if="cycle.taskStats && cycle.status === 'indicator_setting'" class="cycle-stat-grid cycle-stat-grid--progress">
            <div><span>目标完成</span><strong>{{ cycle.taskStats.goalCompleted }}/{{ activeTaskCount }}</strong></div>
            <div><span>待主管审核</span><strong>{{ cycle.taskStats.pendingManagerReview }}人</strong></div>
            <div><span>逾期未完成</span><strong :class="{ 'is-danger': cycle.taskStats.overdue > 0 }">{{ cycle.taskStats.overdue }}人</strong></div>
          </div>
        </section>

        <section
          v-if="isPrelaunch"
          class="cycle-preflight-reminder"
          :class="{
            'has-blockers': groupedPreflightBlockers.length,
            'has-warnings': !groupedPreflightBlockers.length && groupedPreflightWarnings.length,
          }"
          data-testid="cycle-preflight-reminder"
        >
          <header class="cycle-preflight-reminder__heading">
            <div class="cycle-preflight-reminder__icon" aria-hidden="true">✓</div>
            <div>
              <h2>计划检查提醒</h2>
              <p v-if="preflight">{{ planCheckSummary }}</p>
              <p v-else-if="preflightLoading">正在检查考核周期、参与人员、直属上级和时间节点。</p>
              <p v-else>发起前将检查考核周期、参与人员、直属上级和时间节点。</p>
            </div>
          </header>

          <el-skeleton v-if="preflightLoading" animated :rows="3" />
          <el-alert
            v-else-if="preflightError"
            type="error"
            :closable="false"
            show-icon
            title="发起检查失败"
            :description="preflightError"
          />
          <template v-else-if="preflight">
            <div
              v-if="groupedPreflightBlockers.length || groupedPreflightWarnings.length"
              class="cycle-preflight-issues"
            >
              <div v-if="groupedPreflightBlockers.length" class="cycle-preflight-issue-group" data-testid="cycle-preflight-blockers">
                <article
                  v-for="blocker in groupedPreflightBlockers"
                  :key="blocker.message"
                  class="cycle-preflight-issue is-blocker"
                  data-testid="cycle-preflight-blocker"
                >
                  <div><i aria-hidden="true" /><strong>{{ blocker.message }}</strong><span v-if="blocker.count > 1">涉及{{ blocker.count }}项</span></div>
                  <el-button
                    v-if="blockerActionLabel(blocker.code)"
                    type="primary"
                    plain
                    size="small"
                    @click="emit('resolve-blocker', blocker.code)"
                  >
                    {{ blockerActionLabel(blocker.code) }}
                  </el-button>
                </article>
              </div>
              <div v-if="groupedPreflightWarnings.length" class="cycle-preflight-issue-group" data-testid="cycle-preflight-warnings">
                <article
                  v-for="warning in groupedPreflightWarnings"
                  :key="warning.message"
                  class="cycle-preflight-issue is-warning"
                  data-testid="cycle-preflight-warning"
                >
                  <div><i aria-hidden="true" /><strong>{{ warning.message }}</strong><span v-if="warning.count > 1">涉及{{ warning.count }}项</span></div>
                </article>
              </div>
            </div>

            <details class="cycle-time-nodes" data-testid="cycle-time-nodes">
              <summary>
                <strong>计划时间节点</strong>
                <span>目标制定开放：{{ formatDateTime(preflight.cycle.goalSettingOpenAt) }}</span>
                <em>展开全部时间节点</em>
              </summary>
              <div class="cycle-time-nodes__grid">
                <div v-for="node in cycleTimeNodes" :key="node.label">
                  <span>{{ node.label }}</span>
                  <strong>{{ formatDateTime(node.value) }}</strong>
                </div>
              </div>
            </details>
          </template>
        </section>

        <section
          v-if="isPrelaunch || cycle.openedAt"
          class="cycle-participant-panel"
          :data-testid="isPrelaunch ? 'cycle-preflight-panel' : 'cycle-participant-record'"
        >
          <header class="cycle-participant-panel__heading">
            <div>
              <h2>考核范围</h2>
              <p v-if="participantRecord">
                发起时已锁定 · {{ recordSourceLabel(participantRecord) }} ·
                {{ formatDateTime(participantRecord.recordedAt) }}
                <template v-if="participantRecord.operator?.name"> · {{ participantRecord.operator.name }}</template>
              </p>
              <p v-else-if="isPrelaunch">检查结果用于确认本次将为哪些员工创建任务，不会修改人员资料。</p>
            </div>
          </header>

          <el-skeleton v-if="!isPrelaunch && participantRecordLoading" animated :rows="5" />
          <el-alert
            v-else-if="!isPrelaunch && participantRecordError"
            type="error"
            :closable="false"
            show-icon
            title="发起记录加载失败"
            :description="participantRecordError"
          />
          <details
            v-if="participantRows.length"
            class="cycle-participant-details"
            open
            data-testid="cycle-preflight-details"
          >
            <summary>
              <span>{{ isPrelaunch ? '查看人员明细' : '人员明细' }}（{{ participantRows.length }}）</span>
              <span v-if="isPrelaunch && preflight" class="cycle-preflight-summary" data-testid="cycle-preflight-summary">
                <span>范围人数<strong>{{ preflight.participantCount }}</strong>人</span>
                <span>参与人员<strong>{{ preflightActiveCount }}</strong>人</span>
                <span>豁免人员<strong>{{ preflightExemptedCount }}</strong>人</span>
                <span v-if="cycle.workflowVersion === 2 && probationExclusionCount(preflight) > 0">未进入范围<strong>{{ probationExclusionCount(preflight) }}</strong>人</span>
              </span>
              <span v-else-if="participantRecord" class="cycle-participant-summary" data-testid="cycle-participant-summary">
                <span>范围人数<strong>{{ participantRecord.summary.total }}</strong>人</span>
                <span>参与人员<strong>{{ participantRecord.summary.active }}</strong>人</span>
                <span>豁免人员<strong>{{ participantRecord.summary.exempted }}</strong>人</span>
              </span>
            </summary>
            <div class="cycle-participant-toolbar">
              <div class="cycle-participant-filters" aria-label="参与结果筛选">
                <button
                  v-for="item in participantFilterOptions"
                  :key="item.key"
                  type="button"
                  :data-testid="`participant-filter-${item.key}`"
                  :class="{ 'is-active': participantFilter === item.key }"
                  :aria-pressed="participantFilter === item.key"
                  @click="participantFilter = item.key"
                >
                  {{ item.label }}
                </button>
              </div>
              <el-input
                v-model="participantKeyword"
                data-testid="participant-search"
                clearable
                placeholder="搜索姓名、部门或直属主管"
                style="width: 260px"
              />
            </div>
            <el-table
              v-if="filteredParticipantRows.length"
              :data="filteredParticipantRows"
              size="small"
              max-height="360"
            >
              <el-table-column prop="employeeName" label="员工" min-width="100" />
              <el-table-column prop="deptName" label="部门" min-width="130" />
              <el-table-column prop="managerName" label="直属主管" min-width="110" />
              <el-table-column label="参与结果" min-width="120">
                <template #default="{ row }">
                  <el-tag :type="row.isExempt ? 'info' : 'success'" effect="light" size="small">
                    {{ participantDispositionLabel(row as ParticipantRow) }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="说明" min-width="230">
                <template #default="{ row }">{{ participantReason(row as ParticipantRow) }}</template>
              </el-table-column>
            </el-table>
            <div
              v-else
              class="cycle-participant-empty"
              data-testid="participant-search-empty"
              role="status"
            >
              没有符合条件的人员
            </div>
          </details>
        </section>
      </main>
    </template>
  </section>
</template>

<style scoped>
.cycle-workspace {
  min-width: 0;
  min-height: 100%;
  padding: 0 0 24px;
  background: #f4f6fa;
}

.cycle-workspace__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 22px;
  background: #fff;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.cycle-workspace__identity,
.cycle-workspace__header-actions,
.cycle-workspace__title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.cycle-workspace__identity h1 {
  margin: 0;
  font-size: 21px;
}

.cycle-workspace__identity p {
  margin: 5px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.cycle-workspace__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  margin-top: 7px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.cycle-workspace__scoring {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  margin-top: 6px;
  color: var(--el-color-primary-dark-2);
  font-size: 12px;
}

.cycle-stage-strip {
  display: grid;
  grid-template-columns: repeat(5, minmax(130px, 1fr));
  gap: 0;
  margin: 16px 20px;
  padding: 16px 18px;
  overflow-x: auto;
  background: #fff;
  border-radius: 10px;
}

.cycle-stage-strip__item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 9px;
  color: var(--el-text-color-secondary);
}

.cycle-stage-strip__item:not(:last-child)::after {
  position: absolute;
  right: 12px;
  width: calc(100% - 118px);
  height: 2px;
  content: '';
  background: var(--el-border-color-light);
}

.cycle-stage-strip__item > span {
  display: grid;
  width: 26px;
  height: 26px;
  place-items: center;
  font-size: 12px;
  background: var(--el-fill-color);
  border-radius: 50%;
}

.cycle-stage-strip__item.is-completed,
.cycle-stage-strip__item.is-current {
  color: var(--el-color-primary);
}

.cycle-stage-strip__item.is-completed > span,
.cycle-stage-strip__item.is-current > span {
  color: #fff;
  background: var(--el-color-primary);
}

.cycle-stage-strip__item.is-blocked,
.cycle-stage-strip__item.is-blocked > span {
  color: var(--el-color-danger);
}

.cycle-stage-strip__item.is-blocked > span {
  color: #fff;
  background: var(--el-color-danger);
}

.cycle-workspace__main,
.cycle-workspace__surface {
  margin: 0 20px;
}

.cycle-current-action {
  padding: 22px;
  background: #fff;
  border-radius: 10px;
}

.cycle-current-action__heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.cycle-current-action__heading span,
.cycle-current-action__heading p,
.cycle-stat-grid span {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.cycle-current-action__heading h2 {
  margin: 5px 0;
  font-size: 20px;
}

.cycle-current-action__heading p {
  margin: 0;
}

.cycle-stat-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-top: 20px;
}

.cycle-stat-grid--progress {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.cycle-stat-grid > div {
  display: grid;
  gap: 7px;
  padding: 14px;
  background: var(--el-fill-color-lighter);
  border-radius: 8px;
}

.cycle-stat-grid strong {
  font-size: 22px;
}

.cycle-stat-grid strong.is-danger {
  color: var(--el-color-danger);
}

.cycle-preflight-reminder {
  display: grid;
  gap: 16px;
  margin-top: 12px;
  padding: 20px 22px;
  background: #f7f8ff;
  border: 1px solid #dfe5ff;
  border-left: 4px solid var(--el-color-primary);
  border-radius: 10px;
  box-shadow: 0 6px 20px rgb(67 86 170 / 6%);
}

.cycle-preflight-reminder.has-blockers {
  border-left-color: var(--el-color-danger);
}

.cycle-preflight-reminder.has-warnings {
  border-left-color: var(--el-color-warning);
}

.cycle-preflight-reminder__heading {
  display: flex;
  align-items: center;
  gap: 11px;
}

.cycle-preflight-reminder__icon {
  display: grid;
  flex: 0 0 34px;
  width: 34px;
  height: 34px;
  place-items: center;
  color: var(--el-color-primary);
  font-weight: 700;
  background: #e9edff;
  border-radius: 9px;
}

.cycle-preflight-reminder__heading h2 {
  margin: 0;
  font-size: 18px;
}

.cycle-preflight-reminder__heading p {
  margin: 4px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.cycle-preflight-issues {
  overflow: hidden;
  background: #fff;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
}

.cycle-preflight-issue-group {
  display: contents;
}

.cycle-preflight-issue {
  display: flex;
  min-height: 46px;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.cycle-preflight-issue:last-child {
  border-bottom: 0;
}

.cycle-preflight-issue > div {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 9px;
}

.cycle-preflight-issue i {
  display: block;
  flex: 0 0 7px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

.cycle-preflight-issue strong {
  font-size: 14px;
  font-weight: 600;
}

.cycle-preflight-issue span {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  white-space: nowrap;
}

.cycle-preflight-issue.is-blocker {
  color: var(--el-color-danger);
  background: var(--el-color-danger-light-9);
}

.cycle-preflight-issue.is-blocker i {
  background: var(--el-color-danger);
}

.cycle-preflight-issue.is-warning {
  color: var(--el-color-warning-dark-2);
}

.cycle-preflight-issue.is-warning i {
  background: var(--el-color-warning);
}

.cycle-time-nodes {
  padding: 13px 15px;
  background: #fff;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
}

.cycle-time-nodes summary {
  display: flex;
  align-items: center;
  gap: 18px;
  color: var(--el-text-color-primary);
  cursor: pointer;
}

.cycle-time-nodes summary span {
  color: var(--el-text-color-regular);
  font-size: 13px;
}

.cycle-time-nodes summary em {
  margin-left: auto;
  color: var(--el-color-primary);
  font-size: 13px;
  font-style: normal;
}

.cycle-time-nodes__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px 20px;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px dashed var(--el-border-color-light);
}

.cycle-time-nodes__grid > div {
  display: grid;
  gap: 4px;
}

.cycle-time-nodes__grid span {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.cycle-time-nodes__grid strong {
  color: var(--el-text-color-regular);
  font-size: 13px;
  font-weight: 600;
}

.cycle-participant-panel {
  display: grid;
  gap: 16px;
  margin-top: 12px;
  padding: 22px;
  background: #fff;
  border-radius: 10px;
}

.cycle-participant-panel__heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.cycle-participant-panel__heading h2 {
  margin: 0 0 5px;
  font-size: 20px;
}

.cycle-participant-panel__heading p {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.cycle-preflight-summary,
.cycle-participant-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
}

.cycle-preflight-primary-action {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: 8px;
  min-height: 40px;
  align-items: center;
  justify-content: flex-end;
}

.cycle-preflight-primary-action .el-button {
  min-width: 112px;
  margin-left: 0;
}

.cycle-preflight-summary span,
.cycle-participant-summary span {
  color: var(--el-text-color-secondary);
}

.cycle-preflight-summary strong,
.cycle-participant-summary strong {
  margin-left: 4px;
  color: var(--el-text-color-primary);
}

.cycle-participant-details summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px 18px;
  padding: 8px 0;
  color: var(--el-color-primary);
  cursor: pointer;
}

.cycle-participant-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 6px 0 12px;
}

.cycle-participant-filters {
  display: flex;
  gap: 6px;
  padding: 3px;
  background: var(--el-fill-color-lighter);
  border-radius: 8px;
}

.cycle-participant-filters button {
  padding: 7px 14px;
  color: var(--el-text-color-secondary);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 6px;
}

.cycle-participant-filters button.is-active {
  color: var(--el-color-primary);
  background: #fff;
  box-shadow: var(--el-box-shadow-lighter);
}

.cycle-participant-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 72px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  background: var(--el-fill-color-blank);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
}

@media (max-width: 767px) {
  .cycle-workspace__header {
    align-items: flex-start;
    flex-wrap: wrap;
    padding: 14px 12px;
  }

  .cycle-workspace__identity {
    align-items: flex-start;
  }

  .cycle-workspace__identity h1 {
    font-size: 18px;
  }

  .cycle-workspace__header-actions {
    display: flex;
    justify-content: flex-end;
    width: 100%;
  }

  .cycle-stage-strip {
    margin: 12px;
    padding: 14px;
  }

  .cycle-workspace__main,
  .cycle-workspace__surface {
    margin: 0 12px;
  }

  .cycle-current-action {
    padding: 16px;
  }

  .cycle-current-action__heading,
  .cycle-participant-panel__heading,
  .cycle-participant-toolbar,
  .cycle-preflight-issue {
    align-items: stretch;
    flex-direction: column;
  }

  .cycle-current-action__heading > .el-button,
  .cycle-preflight-issue .el-button,
  .cycle-preflight-primary-action .el-button {
    width: 100%;
  }

  .cycle-preflight-primary-action {
    display: grid;
    grid-template-columns: 1fr 1fr;
    flex-basis: auto;
    width: 100%;
  }

  .cycle-preflight-primary-action .el-button {
    min-width: 0;
  }

  .cycle-stat-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .cycle-stat-grid--progress {
    grid-template-columns: 1fr;
  }

  .cycle-preflight-reminder,
  .cycle-participant-panel {
    padding: 16px;
  }

  .cycle-time-nodes summary {
    align-items: flex-start;
    flex-direction: column;
    gap: 6px;
  }

  .cycle-time-nodes summary em {
    margin-left: 0;
  }

  .cycle-time-nodes__grid {
    grid-template-columns: 1fr;
  }

  .cycle-participant-details summary {
    align-items: flex-start;
    flex-direction: column;
  }

  .cycle-participant-toolbar .el-input {
    width: 100% !important;
  }
}
</style>
