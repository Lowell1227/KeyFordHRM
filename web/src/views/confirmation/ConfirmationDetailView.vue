<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { ArrowLeft, QuestionFilled } from '@element-plus/icons-vue';
import { useAuthStore } from '@/stores/auth.store';
import { confirmationApi } from '@/api/confirmation.api';
import { tasksApi } from '@/api/tasks.api';
import ChartCard from '@/components/common/ChartCard.vue';
import { CONFIRMATION_STATUS_META, TASK_STATUS_META, VOTE_RESULT_LABELS } from '@/types/enums';
import { formatDate, formatDateTime } from '@/utils/date';
import type { ConfirmationApplication, ApprovalStep, TaskListItem } from '@/types/api.types';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const user = computed(() => auth.user);
const companyLabels: Record<string, string> = { fuede: '孚德', beijing_fuede: '北京孚德', fuede_sports: '孚德体育文化', fansibao: '凡思堡' };

const appId = computed(() => route.params.id as string);
const app = ref<ConfirmationApplication | null>(null);
const loading = ref(false);
const performanceItems = ref<TaskListItem[]>([]);
const performanceLoading = ref(false);
const performanceUnavailable = ref(false);
const approving = ref(false);
const approvalDialogVisible = ref(false);
const managerRecommendation = ref<boolean | undefined>(undefined);
const managerComment = ref('');
const managerError = ref('');
const hrResult = ref<'pass' | 'extend' | 'fail' | ''>('');
const hrBasis = ref('');
const hrMeetingDate = ref('');
const hrProposedDate = ref('');
const hrComment = ref('');
const hrError = ref('');
const uploading = ref(false);
const backfillDate = ref('');
const backfillError = ref('');
const backfilling = ref(false);
const companyReason = ref('');
const companyError = ref('');
const declining = ref(false);
const returning = ref(false);
const isInternalViewer = computed(() => Boolean(app.value?.canViewInternalMeeting));
const approvalDialogTitle = computed(() => {
  if (app.value?.pendingRole === 'manager') return '直属主管评价';
  if (app.value?.pendingRole === 'hr') return 'HR 线下评议';
  return '公司最终决定';
});

onMounted(() => {
  loadDetail();
});

async function loadDetail() {
  if (!appId.value) return;
  loading.value = true;
  try {
    app.value = await confirmationApi.findOne(appId.value);
    void loadPerformanceReference(app.value.employeeId);
  } catch {
    app.value = null;
  } finally {
    loading.value = false;
  }
}

function statusLabel(status: string): string {
  return CONFIRMATION_STATUS_META[status as keyof typeof CONFIRMATION_STATUS_META]?.label ?? status;
}

function statusType(status: string): string {
  return CONFIRMATION_STATUS_META[status as keyof typeof CONFIRMATION_STATUS_META]?.type ?? 'info';
}

function stepStatusLabel(status: string): string {
  if (status === 'approved') return '已通过';
  if (status === 'rejected') return '已驳回';
  return '待审批';
}

function roleLabel(role: string): string {
  if (role === 'manager') return '直属主管';
  if (role === 'hr') return 'HR';
  if (role === 'company') return '公司审批';
  return role;
}

function voteLabel(result?: string | null): string {
  if (!result) return '-';
  return VOTE_RESULT_LABELS[result as keyof typeof VOTE_RESULT_LABELS]?.label ?? result;
}

function voteType(result?: string | null): string {
  if (!result) return 'info';
  return VOTE_RESULT_LABELS[result as keyof typeof VOTE_RESULT_LABELS]?.type ?? 'info';
}

async function handleApprove() {
  if (!app.value) return;
  managerError.value = managerRecommendation.value === undefined || !managerComment.value.trim()
    ? '请选择是否建议转正并填写评价原因' : '';
  if (managerError.value) return;
  approving.value = true;
  try {
    await confirmationApi.submitManagerEvaluation(app.value.id, managerRecommendation.value!, managerComment.value.trim());
    approvalDialogVisible.value = false;
    ElMessage.success('评价已提交，下一步由 HR 办理');
    await loadDetail();
  } catch (error) {
    managerError.value = error instanceof Error ? error.message : '提交失败，请稍后重试';
  } finally {
    approving.value = false;
  }
}

async function loadPerformanceReference(employeeId: string) {
  performanceLoading.value = true;
  performanceUnavailable.value = false;
  try {
    const result = user.value?.id === employeeId
      ? await tasksApi.findMine({ page: 1, pageSize: 50 })
      : await tasksApi.findAll({ employeeId, page: 1, pageSize: 50 });
    performanceItems.value = result.items.filter((item) => item.employeeId === employeeId);
  } catch {
    performanceItems.value = [];
    performanceUnavailable.value = true;
  } finally {
    performanceLoading.value = false;
  }
}

async function handleHrSubmit() {
  if (!app.value) return;
  hrError.value = !hrResult.value || !hrProposedDate.value
    ? '请填写评议结论和拟生效日期'
    : !hrBasis.value.trim() && !app.value.meetingAttachments?.length
      ? '请填写结论依据或上传内部附件' : '';
  if (hrError.value) return;
  approving.value = true;
  try {
    await confirmationApi.submitHrConclusion(app.value.id, {
      voteResult: hrResult.value as 'pass' | 'extend' | 'fail',
      voteComment: hrBasis.value.trim() || undefined,
      meetingDate: hrMeetingDate.value || undefined,
      proposedRegularDate: hrProposedDate.value,
      comment: hrComment.value.trim() || undefined,
    });
    approvalDialogVisible.value = false;
    ElMessage.success('评议结论已提交，下一步由公司审批人决定');
    await loadDetail();
  } catch (error) {
    hrError.value = error instanceof Error ? error.message : '提交失败，请稍后重试';
  } finally {
    approving.value = false;
  }
}

async function handleAttachmentUpload(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file || !app.value) return;
  uploading.value = true;
  hrError.value = '';
  try {
    await confirmationApi.uploadMeetingAttachment(app.value.id, file);
    ElMessage.success('内部附件已上传');
    await loadDetail();
  } catch (error) {
    hrError.value = error instanceof Error ? error.message : '附件上传失败';
  } finally {
    uploading.value = false;
    input.value = '';
  }
}

async function downloadAttachment(attachment: { id: string; name: string }) {
  if (!app.value) return;
  const blob = await confirmationApi.downloadMeetingAttachment(app.value.id, attachment.id);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = attachment.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function handleMeetingDateBackfill() {
  if (!app.value) return;
  backfillError.value = backfillDate.value ? '' : '请选择会议日期';
  if (backfillError.value) return;
  backfilling.value = true;
  try {
    await confirmationApi.backfillMeetingDate(app.value.id, backfillDate.value);
    ElMessage.success('会议日期已补录');
    await loadDetail();
  } catch (error) {
    backfillError.value = error instanceof Error ? error.message : '补录失败，请稍后重试';
  } finally {
    backfilling.value = false;
  }
}

async function handleCompanyApprove() {
  if (!app.value) return;
  companyError.value = !app.value.proposedRegularDate ? '拟生效日期缺失，请联系 HR 补充' : '';
  if (companyError.value) return;
  approving.value = true;
  try {
    await confirmationApi.approveCompany(app.value.id, app.value.proposedRegularDate!, companyReason.value.trim() || undefined);
    approvalDialogVisible.value = false;
    ElMessage.success('已同意转正，员工状态和实际转正日期已更新');
    await loadDetail();
  } catch (error) {
    companyError.value = error instanceof Error ? error.message : '审批失败，请稍后重试';
  } finally {
    approving.value = false;
  }
}

async function handleCompanyDecline() {
  if (!app.value) return;
  companyError.value = '';
  declining.value = true;
  try {
    await confirmationApi.declineCompany(app.value.id, companyReason.value.trim() || undefined);
    approvalDialogVisible.value = false;
    ElMessage.success('已记录不同意转正，后续人事安排由 HR 另行办理');
    await loadDetail();
  } catch (error) {
    companyError.value = error instanceof Error ? error.message : '办理失败，请稍后重试';
  } finally {
    declining.value = false;
  }
}

async function handleReturn(reason: string, role: 'manager' | 'hr') {
  if (!app.value) return;
  const trimmedReason = reason.trim();
  if (!trimmedReason) {
    if (role === 'manager') managerError.value = '请填写退回员工的原因';
    else hrError.value = '请填写退回员工的原因';
    return;
  }
  returning.value = true;
  try {
    await confirmationApi.returnForSupplement(app.value.id, trimmedReason);
    approvalDialogVisible.value = false;
    ElMessage.success('已退回员工补充；重新提交后将从直属主管重新流转');
    await loadDetail();
  } catch (error) {
    const message = error instanceof Error ? error.message : '退回失败，请稍后重试';
    if (role === 'manager') managerError.value = message;
    else hrError.value = message;
  } finally {
    returning.value = false;
  }
}

function goBack() {
  router.back();
}

function salaryVisible(): boolean {
  if (!app.value || !user.value || app.value.workflowVersion === 2) return false;
  return (
    app.value.managerId === user.value.id ||
    app.value.hrId === user.value.id ||
    app.value.companyApproverId === user.value.id ||
    ['hr', 'system_admin'].includes(user.value.sysRole)
  );
}

function sortedSteps(steps?: ApprovalStep[]): ApprovalStep[] {
  if (!steps) return [];
  const order = ['manager', 'hr', 'company'];
  return [...steps].sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
}

type TimelineTone = 'success' | 'danger' | 'current' | 'waiting' | 'neutral';

interface TimelineItem {
  key: string;
  title: string;
  actorName: string;
  action: string;
  time: string;
  tone: TimelineTone;
  note: string | null;
  submissionVersion: number | null;
  snapshot: NonNullable<NonNullable<ConfirmationApplication['history']>[number]['snapshot']> | null;
  current: boolean;
}

function historyRole(label: string): ApprovalStep['role'] | null {
  if (label.includes('直属主管')) return 'manager';
  if (label.startsWith('HR')) return 'hr';
  if (label.startsWith('公司')) return 'company';
  return null;
}

function historyTitle(label: string): string {
  const role = historyRole(label);
  return role ? roleLabel(role) : label;
}

function historyAction(label: string): string {
  if (label === '员工提交申请') return '提交送审';
  if (label === '直属主管提交评价') return '已提交评价';
  if (label === 'HR 记录线下评议') return '已记录评议';
  if (label === '公司同意转正') return '审批同意';
  if (label === '公司不同意转正') return '不同意转正';
  if (label === '退回员工补充') return '已退回';
  if (label === '分管审批人已更正') return '已更正';
  if (label.includes('附件')) return '已上传';
  if (label.includes('补录')) return '已补录';
  return '已记录';
}

function historyTone(label: string): TimelineTone {
  if (label.includes('不同意') || label.includes('退回')) return 'danger';
  if (label.includes('同意') || label.includes('提交评价') || label.includes('记录线下评议')) return 'success';
  return 'neutral';
}

function currentStepComment(role: ApprovalStep['role'], submissionVersion: number | null): string | null {
  if (!app.value || submissionVersion !== app.value.submissionVersion) return null;
  return app.value.steps?.find((step) => step.role === role)?.comment ?? null;
}

const approvalTimeline = computed<TimelineItem[]>(() => {
  if (!app.value) return [];
  const items: TimelineItem[] = (app.value.history ?? []).map((event) => {
    const role = historyRole(event.label);
    return {
      key: `history-${event.id}`,
      title: historyTitle(event.label),
      actorName: event.actorName || '系统',
      action: historyAction(event.label),
      time: formatDateTime(event.occurredAt),
      tone: historyTone(event.label),
      note: event.note || (role ? currentStepComment(role, event.submissionVersion) : null),
      submissionVersion: event.submissionVersion,
      snapshot: event.snapshot ?? null,
      current: false,
    };
  });

  const currentVersion = app.value.submissionVersion ?? null;
  const completedRoles = new Set(
    (app.value.history ?? [])
      .filter((event) => event.submissionVersion === currentVersion)
      .map((event) => historyRole(event.label))
      .filter((role): role is ApprovalStep['role'] => role !== null),
  );
  const flowActive = ['submitted', 'manager_approved', 'hr_approved'].includes(app.value.status);
  if (!flowActive && app.value.workflowVersion === 2) return items;

  for (const step of sortedSteps(app.value.steps)) {
    if (app.value.workflowVersion === 2 && completedRoles.has(step.role)) continue;
    const current = app.value.pendingRole === step.role;
    const handled = Boolean(step.actedAt);
    items.push({
      key: `step-${step.role}`,
      title: roleLabel(step.role),
      actorName: step.approver?.name || (step.role === 'hr' ? '授权 HR 办理' : '待确定'),
      action: handled ? stepStatusLabel(step.status) : current ? '待办理' : '待前序完成',
      time: step.actedAt ? formatDateTime(step.actedAt) : current ? '当前节点' : '后续节点',
      tone: handled ? (step.status === 'rejected' ? 'danger' : 'success') : current ? 'current' : 'waiting',
      note: step.comment,
      submissionVersion: currentVersion,
      snapshot: null,
      current,
    });
  }
  return items;
});

function actorInitial(name: string): string {
  return name.trim().slice(0, 1) || '系';
}
</script>

<template>
  <div v-loading="loading" class="confirmation-detail page-stack">
    <div class="page-header">
      <el-button link :icon="ArrowLeft" @click="goBack">返回</el-button>
      <h2>转正申请详情</h2>
    </div>

    <template v-if="app">
      <ChartCard class="info-card">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="员工">{{ app.employee.name }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="statusType(app.status) as any" size="small">{{ app.status === 'draft' && app.returnReason ? '退回补充' : statusLabel(app.status) }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="主管">{{ app.manager?.name || '待 HR 核实' }}</el-descriptions-item>
          <el-descriptions-item label="所属公司">{{ companyLabels[app.roster?.company ?? ''] || '待核实' }}</el-descriptions-item>
          <el-descriptions-item label="部门">{{ app.roster?.deptName || '待核实' }}</el-descriptions-item>
          <el-descriptions-item label="岗位">{{ app.roster?.position || '待核实' }}</el-descriptions-item>
          <el-descriptions-item label="入职日期">{{ formatDate(app.roster?.entryDate) }}</el-descriptions-item>
          <el-descriptions-item label="计划转正日期">{{ formatDate(app.roster?.plannedRegularDate) }}</el-descriptions-item>
          <el-descriptions-item label="HR 实际经办">{{ app.hr?.name || '尚未办理' }}</el-descriptions-item>
          <el-descriptions-item label="公司审批人">{{ app.companyApprover?.name || '提交时确定' }}</el-descriptions-item>
          <el-descriptions-item label="实际转正日期">
            {{ formatDate(app.actualRegularDate) }}
          </el-descriptions-item>
        </el-descriptions>
      </ChartCard>

      <ChartCard class="section-card">
        <template #title>试用期小结</template>
        <pre class="pre-wrap">{{ app.summary || '暂无' }}</pre>
      </ChartCard>

      <ChartCard class="section-card">
        <template #title>
          <span class="section-title-with-help">
            绩效参考
            <el-tooltip content="仅展示您按绩效模块原有权限可见的记录；绩效等级以已发布的正式结果为准。" placement="top">
              <el-icon class="section-help" tabindex="0" aria-label="绩效参考说明"><QuestionFilled /></el-icon>
            </el-tooltip>
          </span>
        </template>
        <p v-if="performanceLoading" class="text-placeholder">正在读取绩效记录…</p>
        <p v-else-if="performanceUnavailable" class="text-placeholder">暂无法读取绩效记录，请到绩效页面查看。</p>
        <p v-else-if="!performanceItems.length" class="text-placeholder">暂无可引用的绩效记录，不影响转正办理。</p>
        <el-collapse v-else>
          <el-collapse-item :title="`查看可见的绩效记录（最近 ${performanceItems.length} 条）`" name="performance">
            <div v-for="item in performanceItems" :key="item.id" class="reference-row">
              <div class="reference-row__main">
                <strong>{{ item.cycleName || '未命名周期' }}</strong>
                <span>{{ TASK_STATUS_META[item.status]?.label ?? item.status }}</span>
              </div>
              <el-button link type="primary" @click="router.push(`/tasks/${item.id}`)">查看目标与月度记录</el-button>
              <el-button v-if="item.publishedAt || ['published', 'appealing', 'closed'].includes(item.status)" link type="primary" @click="router.push(`/tasks/${item.id}/final-grade`)">查看已发布等级</el-button>
            </div>
          </el-collapse-item>
        </el-collapse>
      </ChartCard>

      <ChartCard v-if="salaryVisible()" class="section-card">
        <template #title>转正后薪资</template>
        <p class="salary-text">{{ app.salary != null ? `¥ ${app.salary.toFixed(2)}` : '未填写' }}</p>
        <p class="salary-tip">该字段仅 HR 与审批链可见</p>
      </ChartCard>

      <ChartCard v-if="app.workflowVersion !== 2" class="section-card">
        <template #title>述职表决</template>
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="表决结果">
            <el-tag v-if="app.voteResult" :type="voteType(app.voteResult) as any" size="small">
              {{ voteLabel(app.voteResult) }}
            </el-tag>
            <span v-else class="text-placeholder">未录入</span>
          </el-descriptions-item>
          <el-descriptions-item label="会议时间">
            {{ formatDateTime(app.voteMeetingTime) }}
          </el-descriptions-item>
          <el-descriptions-item label="参与人" :span="2">
            <span v-if="app.voteParticipants?.length">{{ app.voteParticipants.join('、') }}</span>
            <span v-else class="text-placeholder">未填写</span>
          </el-descriptions-item>
          <el-descriptions-item label="表决意见" :span="2">
            <pre class="pre-wrap">{{ app.voteComment || '暂无' }}</pre>
          </el-descriptions-item>
        </el-descriptions>
      </ChartCard>

      <p v-if="app.status === 'draft' && app.returnReason" class="return-reason">退回原因：{{ app.returnReason }}</p>

      <ChartCard v-if="app.workflowVersion === 2 && isInternalViewer && (app.voteResult || app.meetingAttachments?.length)" class="section-card">
        <template #title>线下评议记录（内部）</template>
        <div class="internal-record">
          <span>评议结论：{{ app.voteResult ? ({ pass: '建议转正', extend: '建议延长试用', fail: '不建议转正' } as const)[app.voteResult] : '待记录' }}</span>
          <span>会议日期：{{ formatDate(app.meetingDate) }}</span>
          <span>录入时间：{{ formatDateTime(app.voteRecordedAt) }}</span>
          <pre v-if="app.voteComment" class="pre-wrap">{{ app.voteComment }}</pre>
          <div v-for="attachment in app.meetingAttachments" :key="attachment.id">
            <el-button link type="primary" @click="downloadAttachment(attachment)">下载 {{ attachment.name }}</el-button>
          </div>
          <div v-if="app.voteResult && !app.meetingDate && app.hrId === user?.id" class="meeting-date-backfill">
            <el-date-picker v-model="backfillDate" type="date" value-format="YYYY-MM-DD" placeholder="补录会议日期" style="width: 100%" @change="backfillError = ''" />
            <el-button :loading="backfilling" @click="handleMeetingDateBackfill">保存会议日期</el-button>
            <p v-if="backfillError" class="field-error">{{ backfillError }}</p>
          </div>
        </div>
      </ChartCard>

      <div v-if="app.canApprove" class="detail-actions">
        <el-button type="primary" @click="approvalDialogVisible = true">办理</el-button>
      </div>

      <el-dialog
        v-model="approvalDialogVisible"
        :title="approvalDialogTitle"
        width="min(640px, calc(100vw - 32px))"
        :close-on-click-modal="false"
        class="approval-dialog"
      >
        <div class="approval-form">
          <div v-if="app.pendingRole === 'manager'" class="manager-evaluation">
            <el-radio-group v-model="managerRecommendation">
              <el-radio :value="true">建议转正</el-radio>
              <el-radio :value="false">暂不建议转正</el-radio>
            </el-radio-group>
            <el-input v-model="managerComment" type="textarea" :rows="4" maxlength="1000" show-word-limit placeholder="请说明工作表现和评价原因" @input="managerError = ''" />
            <p v-if="managerError" class="field-error">{{ managerError }}</p>
            <div class="approval-actions">
              <el-button type="primary" :loading="approving" :disabled="returning" @click="handleApprove">提交评价</el-button>
              <el-button v-if="app.canReturn" type="danger" plain :loading="returning" :disabled="approving" @click="handleReturn(managerComment, 'manager')">退回员工</el-button>
            </div>
          </div>
          <div v-else-if="app.pendingRole === 'hr'" class="hr-evaluation">
            <el-select v-model="hrResult" placeholder="选择评议结论" @change="hrError = ''">
              <el-option label="建议转正" value="pass" />
              <el-option label="建议延长试用" value="extend" />
              <el-option label="不建议转正" value="fail" />
            </el-select>
            <el-date-picker v-model="hrMeetingDate" type="date" value-format="YYYY-MM-DD" placeholder="会议日期（可后补）" style="width: 100%" />
            <el-input v-model="hrBasis" type="textarea" :rows="4" maxlength="4000" show-word-limit placeholder="简述结论依据；也可只上传附件" @input="hrError = ''" />
            <label class="attachment-upload">内部评议附件（仅授权 HR 和公司审批人可见）
              <input type="file" :disabled="uploading" @change="handleAttachmentUpload" />
            </label>
            <span v-if="app.meetingAttachments?.length">已上传 {{ app.meetingAttachments.length }} 个附件</span>
            <el-date-picker v-model="hrProposedDate" type="date" value-format="YYYY-MM-DD" placeholder="拟生效日期（必填）" style="width: 100%" @change="hrError = ''" />
            <el-input v-model="hrComment" type="textarea" :rows="3" maxlength="1000" placeholder="办理说明（选填；退回时请填写原因）" @input="hrError = ''" />
            <p v-if="hrError" class="field-error">{{ hrError }}</p>
            <div class="approval-actions">
              <el-button type="primary" :loading="approving" :disabled="returning" @click="handleHrSubmit">提交公司审批</el-button>
              <el-button v-if="app.canReturn" type="danger" plain :loading="returning" :disabled="approving || uploading" @click="handleReturn(hrComment, 'hr')">退回员工</el-button>
            </div>
          </div>
          <div v-else-if="app.pendingRole === 'company'" class="company-decision">
            <p>HR 拟生效日期：<b>{{ formatDate(app.proposedRegularDate) }}</b></p>
            <label class="company-reason">
              <span>理由（选填）</span>
              <el-input v-model="companyReason" type="textarea" :rows="3" maxlength="1000" show-word-limit placeholder="请输入理由（选填）" @input="companyError = ''" />
            </label>
            <p v-if="companyError" class="field-error">{{ companyError }}</p>
            <div class="company-actions">
              <el-button type="primary" :loading="approving" :disabled="declining" @click="handleCompanyApprove">同意</el-button>
              <el-button v-if="app.canReject" type="danger" plain :loading="declining" :disabled="approving" @click="handleCompanyDecline">不同意</el-button>
            </div>
          </div>
        </div>
      </el-dialog>

      <ChartCard class="section-card">
        <template #title>审批流程</template>
        <ol class="approval-timeline" data-testid="confirmation-approval-timeline">
          <li
            v-for="item in approvalTimeline"
            :key="item.key"
            class="approval-timeline__item"
            :class="`is-${item.tone}`"
            :aria-current="item.current ? 'step' : undefined"
          >
            <span class="approval-timeline__dot" aria-hidden="true" />
            <time>{{ item.time }}</time>
            <div class="approval-timeline__title">
              {{ item.title }}
              <span v-if="item.submissionVersion" class="approval-timeline__version">第 {{ item.submissionVersion }} 次提交</span>
            </div>
            <div class="approval-timeline__actor">
              <span class="approval-timeline__avatar">{{ actorInitial(item.actorName) }}</span>
              <span>{{ item.actorName }}</span>
              <strong>{{ item.action }}</strong>
            </div>
            <div v-if="item.note" class="approval-timeline__note">{{ item.note }}</div>
            <div v-if="item.snapshot && Object.keys(item.snapshot).length" class="approval-timeline__note approval-timeline__snapshot">
              <div v-if="item.snapshot.summary">原工作小结：{{ item.snapshot.summary }}</div>
              <div v-if="item.snapshot.managerRecommendation !== undefined">原主管建议：{{ item.snapshot.managerRecommendation ? '建议转正' : '暂不建议转正' }}</div>
              <div v-if="item.snapshot.managerComment">原主管评价：{{ item.snapshot.managerComment }}</div>
              <div v-if="item.snapshot.voteResult">原 HR 评议结论：{{ VOTE_RESULT_LABELS[item.snapshot.voteResult] }}</div>
              <div v-if="item.snapshot.voteComment">原结论依据：{{ item.snapshot.voteComment }}</div>
              <div v-if="item.snapshot.hrComment">原 HR 办理意见：{{ item.snapshot.hrComment }}</div>
              <div v-if="item.snapshot.proposedRegularDate">原拟生效日期：{{ formatDate(item.snapshot.proposedRegularDate) }}</div>
            </div>
          </li>
        </ol>

        <div v-if="app.status === 'rejected' && app.rejectReason" class="reject-section">
          <div class="reject-title">驳回原因</div>
          <pre class="pre-wrap">{{ app.rejectReason }}</pre>
          <div v-if="app.rejectedAt" class="reject-meta">
            驳回时间：{{ formatDateTime(app.rejectedAt) }}
          </div>
        </div>
      </ChartCard>
    </template>

  </div>
</template>

<style scoped>
.page-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.page-header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.pre-wrap {
  white-space: pre-wrap;
  margin: 0;
  font-family: inherit;
  line-height: 1.6;
}
.manager-evaluation { display: grid; gap: 10px; width: min(100%, 560px); }
.hr-evaluation { display: grid; gap: 10px; width: min(100%, 600px); }
.company-decision { display: grid; gap: 16px; width: min(100%, 480px); }
.company-decision p { margin: 0; }
.company-reason { display: grid; gap: 8px; color: var(--el-text-color-regular); font-size: 14px; }
.company-actions, .approval-actions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
.return-reason { margin: 0; padding: 10px 12px; background: var(--el-color-warning-light-9); border-radius: 4px; overflow-wrap: anywhere; }
.internal-record { display: grid; gap: 8px; overflow-wrap: anywhere; }
.meeting-date-backfill { display: grid; gap: 8px; width: min(100%, 320px); }
.attachment-upload { display: grid; gap: 6px; font-size: 13px; }
.attachment-upload input { max-width: 100%; }
.field-error { color: var(--el-color-danger); font-size: 12px; margin: 0; }
.approval-dialog :deep(.el-dialog__body) { max-height: calc(100vh - 160px); overflow-y: auto; }

.salary-text {
  font-size: 18px;
  font-weight: 600;
  color: var(--el-color-danger);
  margin: 0 0 8px;
}

.salary-tip {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  margin: 0;
}

.text-placeholder {
  color: var(--el-text-color-placeholder);
}

.section-title-with-help { display: inline-flex; align-items: center; gap: 6px; }
.section-help { color: var(--el-text-color-secondary); cursor: help; }
.reference-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 9px 0; border-bottom: 1px solid var(--el-border-color-lighter); }
.reference-row__main { display: flex; gap: 10px; align-items: baseline; flex: 1 1 220px; min-width: 0; overflow-wrap: anywhere; }
.reference-row__main span { color: var(--el-text-color-secondary); font-size: 12px; }
.approval-timeline {
  width: min(100%, 720px);
  margin: 0;
  padding: 2px 0 0;
  list-style: none;
}

.approval-timeline__item {
  position: relative;
  padding: 0 0 26px 28px;
  overflow-wrap: anywhere;
}

.approval-timeline__item:not(:last-child)::before {
  content: '';
  position: absolute;
  top: 15px;
  bottom: -3px;
  left: 6px;
  width: 2px;
  background: var(--el-border-color-lighter);
}

.approval-timeline__item:last-child { padding-bottom: 4px; }

.approval-timeline__dot {
  position: absolute;
  top: 4px;
  left: 0;
  width: 12px;
  height: 12px;
  border: 3px solid var(--el-border-color);
  border-radius: 50%;
  background: var(--el-bg-color);
  box-sizing: border-box;
}

.approval-timeline__item.is-success .approval-timeline__dot { border-color: var(--el-color-success); }
.approval-timeline__item.is-danger .approval-timeline__dot { border-color: var(--el-color-danger); }
.approval-timeline__item.is-current .approval-timeline__dot { border-color: var(--el-color-primary); }

.approval-timeline time {
  display: block;
  margin-bottom: 8px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 20px;
}

.approval-timeline__title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  color: var(--el-text-color-primary);
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
}

.approval-timeline__version {
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
  font-size: 11px;
  font-weight: 400;
  line-height: 18px;
}

.approval-timeline__actor {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 26px;
  color: var(--el-text-color-regular);
  font-size: 14px;
}

.approval-timeline__avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--el-fill-color-dark);
  color: var(--el-text-color-regular);
  font-size: 12px;
}

.approval-timeline__actor strong { color: var(--el-color-success); font-weight: 600; }
.approval-timeline__item.is-danger .approval-timeline__actor strong { color: var(--el-color-danger); }
.approval-timeline__item.is-current .approval-timeline__actor strong { color: var(--el-color-primary); }
.approval-timeline__item.is-waiting .approval-timeline__actor strong,
.approval-timeline__item.is-neutral .approval-timeline__actor strong { color: var(--el-text-color-secondary); }

.approval-timeline__note {
  margin-top: 10px;
  padding: 9px 12px;
  border-radius: 5px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-regular);
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
}

.approval-timeline__snapshot { display: grid; gap: 4px; }

.detail-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.reject-section {
  margin-top: 16px;
  padding: 12px 16px;
  background: var(--el-color-danger-light-9);
  border-radius: 4px;
}

.reject-title {
  font-weight: 600;
  color: var(--el-color-danger);
  margin-bottom: 8px;
}

.reject-meta {
  margin-top: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
</style>
