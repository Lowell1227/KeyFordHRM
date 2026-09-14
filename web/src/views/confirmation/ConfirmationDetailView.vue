<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { ArrowLeft } from '@element-plus/icons-vue';
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

const appId = computed(() => route.params.id as string);
const app = ref<ConfirmationApplication | null>(null);
const loading = ref(false);
const performanceItems = ref<TaskListItem[]>([]);
const performanceLoading = ref(false);
const performanceUnavailable = ref(false);
const approving = ref(false);
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
const companyDateConfirmed = ref(false);
const companyComment = ref('');
const companyError = ref('');
const declineMode = ref(false);
const declineReason = ref('');
const declining = ref(false);
const returnMode = ref(false);
const returnReason = ref('');
const returnError = ref('');
const returning = ref(false);
const isInternalViewer = computed(() => Boolean(app.value && user.value
  && (app.value.hrId === user.value.id || app.value.companyApproverId === user.value.id)));

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

function stepStatusType(status: string): string {
  if (status === 'approved') return 'success';
  if (status === 'rejected') return 'danger';
  return 'info';
}

function stepStatusLabel(status: string): string {
  if (status === 'approved') return '已通过';
  if (status === 'rejected') return '已驳回';
  return '待审批';
}

function roleLabel(role: string): string {
  if (role === 'manager') return '主管';
  if (role === 'hr') return 'HR';
  if (role === 'company') return '公司';
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
  companyError.value = !app.value.proposedRegularDate || !companyDateConfirmed.value
    ? '请核对并确认 HR 填写的拟生效日期' : '';
  if (companyError.value) return;
  approving.value = true;
  try {
    await confirmationApi.approveCompany(app.value.id, app.value.proposedRegularDate!, companyComment.value.trim() || undefined);
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
  companyError.value = declineReason.value.trim() ? '' : '请填写不同意转正的原因';
  if (companyError.value) return;
  declining.value = true;
  try {
    await confirmationApi.declineCompany(app.value.id, declineReason.value.trim());
    ElMessage.success('已记录不同意转正，后续人事安排由 HR 另行办理');
    await loadDetail();
  } catch (error) {
    companyError.value = error instanceof Error ? error.message : '办理失败，请稍后重试';
  } finally {
    declining.value = false;
  }
}

async function handleReturn() {
  if (!app.value) return;
  returnError.value = returnReason.value.trim() ? '' : '请填写退回补充原因';
  if (returnError.value) return;
  returning.value = true;
  try {
    await confirmationApi.returnForSupplement(app.value.id, returnReason.value.trim());
    ElMessage.success('已退回员工补充；重新提交后将从直属主管重新流转');
    returnMode.value = false;
    await loadDetail();
  } catch (error) {
    returnError.value = error instanceof Error ? error.message : '退回失败，请稍后重试';
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
          <el-descriptions-item label="HR">{{ app.hr?.name || '待 HR 配置' }}</el-descriptions-item>
          <el-descriptions-item label="公司审批人">{{ app.companyApprover?.name || '待 HR 配置' }}</el-descriptions-item>
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
        <template #title>绩效参考</template>
        <p class="reference-note">仅展示您按绩效模块原有权限可见的记录；绩效等级以已发布的正式结果为准。</p>
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

      <ChartCard class="section-card">
        <template #title>审批轨迹</template>
        <div class="steps">
          <div
            v-for="step in sortedSteps(app.steps)"
            :key="step.role"
            class="step-row"
            :class="{ 'step-row--current': step.status === 'pending' && app.status !== 'rejected' }"
          >
            <div class="step-role">
              <span class="step-role-label">{{ roleLabel(step.role) }}</span>
              <el-tag :type="stepStatusType(step.status) as any" size="small">
                {{ stepStatusLabel(step.status) }}
              </el-tag>
            </div>
            <div class="step-info">
              <div v-if="step.approver">审批人：{{ step.approver.name }}</div>
              <div v-if="step.actedAt">时间：{{ formatDateTime(step.actedAt) }}</div>
              <div v-if="step.comment">意见：{{ step.comment }}</div>
            </div>
          </div>
        </div>

        <el-collapse v-if="app.workflowVersion === 2 && app.history?.length" class="history-collapse">
          <el-collapse-item :title="`办理记录（${app.history.length}）`" name="history">
            <div v-for="event in app.history" :key="event.id" class="history-row">
              <span>{{ event.submissionVersion ? `第 ${event.submissionVersion} 次提交 · ` : '' }}{{ event.label }}</span>
              <span>{{ event.actorName || '系统' }} · {{ formatDateTime(event.occurredAt) }}</span>
              <p v-if="event.note">{{ event.note }}</p>
            </div>
          </el-collapse-item>
        </el-collapse>

        <div v-if="app.canApprove" class="detail-actions">
          <div v-if="app.pendingRole === 'manager'" class="manager-evaluation">
            <strong>直属主管评价</strong>
            <el-radio-group v-model="managerRecommendation">
              <el-radio :value="true">建议转正</el-radio>
              <el-radio :value="false">暂不建议转正</el-radio>
            </el-radio-group>
            <el-input v-model="managerComment" type="textarea" :rows="4" maxlength="1000" show-word-limit placeholder="请说明工作表现和评价原因" @input="managerError = ''" />
            <p v-if="managerError" class="field-error">{{ managerError }}</p>
            <el-button type="primary" :loading="approving" @click="handleApprove">提交评价</el-button>
          </div>
          <div v-else-if="app.pendingRole === 'hr'" class="hr-evaluation">
            <strong>HR 线下评议结论</strong>
            <el-select v-model="hrResult" placeholder="选择评议结论" @change="hrError = ''">
              <el-option label="建议转正" value="pass" />
              <el-option label="建议延长试用" value="extend" />
              <el-option label="不建议转正" value="fail" />
            </el-select>
            <el-date-picker v-model="hrMeetingDate" type="date" value-format="YYYY-MM-DD" placeholder="会议日期（可后补）" style="width: 100%" />
            <el-input v-model="hrBasis" type="textarea" :rows="4" maxlength="4000" show-word-limit placeholder="简述结论依据；也可只上传附件" @input="hrError = ''" />
            <label class="attachment-upload">内部评议附件（仅指定 HR 和公司审批人可见）
              <input type="file" :disabled="uploading" @change="handleAttachmentUpload" />
            </label>
            <span v-if="app.meetingAttachments?.length">已上传 {{ app.meetingAttachments.length }} 个附件</span>
            <el-date-picker v-model="hrProposedDate" type="date" value-format="YYYY-MM-DD" placeholder="拟生效日期（必填）" style="width: 100%" @change="hrError = ''" />
            <el-input v-model="hrComment" type="textarea" :rows="3" maxlength="1000" placeholder="HR 办理意见（选填）" />
            <p v-if="hrError" class="field-error">{{ hrError }}</p>
            <el-button type="primary" :loading="approving" @click="handleHrSubmit">提交公司审批</el-button>
          </div>
          <div v-else-if="app.pendingRole === 'company'" class="company-decision">
            <strong>公司最终决定</strong>
            <p>HR 拟生效日期：<b>{{ formatDate(app.proposedRegularDate) }}</b></p>
            <el-checkbox v-model="companyDateConfirmed">已核对并确认上述生效日期</el-checkbox>
            <el-input v-model="companyComment" type="textarea" :rows="3" maxlength="1000" placeholder="同意意见（选填）" />
            <p v-if="companyError" class="field-error">{{ companyError }}</p>
            <div class="company-actions">
              <el-button type="primary" :loading="approving" @click="handleCompanyApprove">同意转正</el-button>
              <el-button v-if="app.canReject" @click="declineMode = !declineMode">不同意转正</el-button>
            </div>
            <div v-if="declineMode" class="company-decline">
              <el-input v-model="declineReason" type="textarea" :rows="3" maxlength="1000" placeholder="请说明不同意转正的原因" @input="companyError = ''" />
              <el-button type="danger" :loading="declining" @click="handleCompanyDecline">提交不同意决定</el-button>
            </div>
          </div>
          <div v-if="app.canReturn" class="return-action">
            <el-button @click="returnMode = !returnMode">退回员工补充</el-button>
            <div v-if="returnMode" class="return-form">
              <el-input v-model="returnReason" type="textarea" :rows="3" maxlength="1000" placeholder="请说明需要员工补充的内容" @input="returnError = ''" />
              <p v-if="returnError" class="field-error">{{ returnError }}</p>
              <el-button :loading="returning" @click="handleReturn">提交退回补充</el-button>
            </div>
          </div>
        </div>

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
.company-decision, .company-decline { display: grid; gap: 10px; width: min(100%, 560px); }
.company-decision p { margin: 0; }
.company-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.return-action, .return-form { display: grid; gap: 8px; width: min(100%, 560px); }
.return-reason { margin: 0; padding: 10px 12px; background: var(--el-color-warning-light-9); border-radius: 4px; overflow-wrap: anywhere; }
.internal-record { display: grid; gap: 8px; overflow-wrap: anywhere; }
.meeting-date-backfill { display: grid; gap: 8px; width: min(100%, 320px); }
.attachment-upload { display: grid; gap: 6px; font-size: 13px; }
.attachment-upload input { max-width: 100%; }
.field-error { color: var(--el-color-danger); font-size: 12px; margin: 0; }

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

.reference-note { margin: 0 0 10px; color: var(--el-text-color-secondary); font-size: 13px; }
.reference-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 9px 0; border-bottom: 1px solid var(--el-border-color-lighter); }
.reference-row__main { display: flex; gap: 10px; align-items: baseline; flex: 1 1 220px; min-width: 0; overflow-wrap: anywhere; }
.reference-row__main span { color: var(--el-text-color-secondary); font-size: 12px; }
.history-collapse { margin-top: 12px; }
.history-row { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 12px; padding: 8px 0; border-bottom: 1px solid var(--el-border-color-lighter); overflow-wrap: anywhere; }
.history-row span:last-of-type { color: var(--el-text-color-secondary); font-size: 12px; }
.history-row p { flex-basis: 100%; margin: 0; white-space: pre-wrap; }

.steps {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.step-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 12px 16px;
  background: var(--el-fill-color-light);
  border-radius: 4px;
}

.step-row--current {
  background: var(--el-color-primary-light-9);
}

.step-role {
  display: flex;
  align-items: center;
  gap: 8px;
}

.step-role-label {
  font-weight: 500;
}

.step-info {
  text-align: right;
  font-size: 13px;
  color: var(--el-text-color-regular);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.detail-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 16px;
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
