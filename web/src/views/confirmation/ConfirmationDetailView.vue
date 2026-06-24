<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ArrowLeft } from '@element-plus/icons-vue';
import { useAuthStore } from '@/stores/auth.store';
import { confirmationApi } from '@/api/confirmation.api';
import ChartCard from '@/components/common/ChartCard.vue';
import { CONFIRMATION_STATUS_META, VOTE_RESULT_LABELS } from '@/types/enums';
import { formatDate, formatDateTime } from '@/utils/date';
import type { ConfirmationApplication, ApprovalStep } from '@/types/api.types';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const user = computed(() => auth.user);

const appId = computed(() => route.params.id as string);
const app = ref<ConfirmationApplication | null>(null);
const loading = ref(false);
const approving = ref(false);
const rejecting = ref(false);

const rejectReason = ref('');
const rejectDialogVisible = ref(false);

onMounted(() => {
  loadDetail();
});

async function loadDetail() {
  if (!appId.value) return;
  loading.value = true;
  try {
    app.value = await confirmationApi.findOne(appId.value);
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
  try {
    await ElMessageBox.confirm('确认审批通过该转正申请？', '审批确认', { type: 'info' });
  } catch {
    return;
  }
  approving.value = true;
  try {
    await confirmationApi.approve(app.value.id);
    ElMessage.success('审批通过');
    await loadDetail();
  } finally {
    approving.value = false;
  }
}

function openReject() {
  rejectReason.value = '';
  rejectDialogVisible.value = true;
}

async function handleReject() {
  if (!app.value || !rejectReason.value.trim()) {
    ElMessage.warning('请填写驳回原因');
    return;
  }
  rejecting.value = true;
  try {
    await confirmationApi.reject(app.value.id, rejectReason.value.trim());
    ElMessage.success('已驳回');
    rejectDialogVisible.value = false;
    await loadDetail();
  } finally {
    rejecting.value = false;
  }
}

function goBack() {
  router.back();
}

function salaryVisible(): boolean {
  if (!app.value || !user.value) return false;
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
            <el-tag :type="statusType(app.status) as any" size="small">{{ statusLabel(app.status) }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="主管">{{ app.manager.name }}</el-descriptions-item>
          <el-descriptions-item label="HR">{{ app.hr.name }}</el-descriptions-item>
          <el-descriptions-item label="公司审批人">{{ app.companyApprover.name }}</el-descriptions-item>
          <el-descriptions-item label="实际转正日期">
            {{ formatDate(app.actualRegularDate) }}
          </el-descriptions-item>
        </el-descriptions>
      </ChartCard>

      <ChartCard class="section-card">
        <template #title>试用期小结</template>
        <pre class="pre-wrap">{{ app.summary || '暂无' }}</pre>
      </ChartCard>

      <ChartCard v-if="salaryVisible()" class="section-card">
        <template #title>转正后薪资</template>
        <p class="salary-text">{{ app.salary != null ? `¥ ${app.salary.toFixed(2)}` : '未填写' }}</p>
        <p class="salary-tip">该字段仅 HR 与审批链可见</p>
      </ChartCard>

      <ChartCard class="section-card">
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

        <div v-if="app.canApprove" class="detail-actions">
          <el-button type="primary" :loading="approving" @click="handleApprove">通过</el-button>
          <el-button type="danger" :loading="rejecting" @click="openReject">驳回</el-button>
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

    <el-dialog v-model="rejectDialogVisible" title="驳回转正申请" width="500">
      <el-form label-position="top">
        <el-form-item label="驳回原因" required>
          <el-input
            v-model="rejectReason"
            type="textarea"
            :rows="4"
            maxlength="1000"
            show-word-limit
            placeholder="请填写驳回原因"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="rejectDialogVisible = false">取消</el-button>
          <el-button type="danger" :loading="rejecting" @click="handleReject">确认驳回</el-button>
        </div>
      </template>
    </el-dialog>
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
