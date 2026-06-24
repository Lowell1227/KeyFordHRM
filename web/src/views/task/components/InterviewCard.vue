<script setup lang="ts">
import { computed } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useAuthStore } from '@/stores/auth.store';
import { usePermission } from '@/composables/usePermission';
import { interviewsApi } from '@/api/interviews.api';
import { INTERVIEW_METHOD_LABELS, INTERVIEW_STATUS_LABELS } from '@/types/enums';
import { formatDate, formatDateTime, isOverdue, daysUntilDeadline } from '@/utils/date';
import ScoreMask from './ScoreMask.vue';
import InterviewSignPanel from './InterviewSignPanel.vue';
import ChartCard from '@/components/common/ChartCard.vue';
import type { PerformanceInterview, TaskDetail } from '@/types/api.types';

const props = defineProps<{
  task: TaskDetail;
  interview: PerformanceInterview | null | undefined;
}>();

const emit = defineEmits<{
  (e: 'refresh'): void;
}>();

const auth = useAuthStore();
const permission = usePermission({ task: computed(() => props.task) });

const isEmployee = computed(() => permission.isTaskSelf.value);
const canViewScore = computed(() => permission.canViewTotalScore.value);

const statusMeta = computed(() => {
  if (!props.interview) return null;
  return INTERVIEW_STATUS_LABELS[props.interview.status];
});

const canEmployeeSign = computed(() => {
  if (!props.interview) return false;
  if (!isEmployee.value) return false;
  if (props.interview.status === 'pending') return false;
  if (props.interview.employeeSignedAt) return false;
  return true;
});

async function handleEmployeeSign() {
  if (!props.interview) return;
  try {
    await ElMessageBox.confirm('确认签字？签字后面谈记录将锁定。', '签字确认', { type: 'warning' });
  } catch {
    return;
  }
  try {
    await interviewsApi.employeeSign(props.interview.id);
    ElMessage.success('签字成功');
    emit('refresh');
  } catch {
    // error handled by interceptor
  }
}
</script>

<template>
  <ChartCard class="interview-card">
    <template #title>绩效面谈记录</template>
    <template #extra>
      <el-tag v-if="statusMeta" :type="statusMeta.type as any" size="small">{{ statusMeta.label }}</el-tag>
      <el-tag v-else type="info" size="small">暂无记录</el-tag>
    </template>

    <template v-if="interview">
      <el-descriptions :column="2" border size="small">
        <el-descriptions-item label="面谈时间">
          {{ interview.interviewTime ? formatDateTime(interview.interviewTime) : '-' }}
        </el-descriptions-item>
        <el-descriptions-item label="面谈地点">{{ interview.location || '-' }}</el-descriptions-item>
        <el-descriptions-item label="面谈方式">
          {{ interview.method ? INTERVIEW_METHOD_LABELS[interview.method] : '-' }}
        </el-descriptions-item>
        <el-descriptions-item label="面谈截止日">
          <span :class="{ 'text-danger': interview.deadline && isOverdue(interview.deadline) }">
            {{ interview.deadline ? formatDate(interview.deadline) : '-' }}
            <el-tag
              v-if="interview.deadline && daysUntilDeadline(interview.deadline) !== null"
              size="small"
              :type="isOverdue(interview.deadline) ? 'danger' : 'warning'"
              class="deadline-tag"
            >
              {{ isOverdue(interview.deadline) ? '已逾期' : `剩余 ${daysUntilDeadline(interview.deadline)} 天` }}
            </el-tag>
          </span>
        </el-descriptions-item>
        <el-descriptions-item label="是否已告知绩效分数">
          <span v-if="canViewScore">{{ interview.scoreInformed ? '是' : '否' }}</span>
          <ScoreMask v-else :message="permission.maskMessage.value || undefined" />
        </el-descriptions-item>
      </el-descriptions>

      <div class="content-section">
        <div class="content-item">
          <div class="content-label">① 突出业绩</div>
          <div class="content-body">{{ interview.achievements || '未填写' }}</div>
        </div>
        <div class="content-item">
          <div class="content-label">② 不足与待提升</div>
          <div class="content-body">{{ interview.weaknesses || '未填写' }}</div>
        </div>
        <div class="content-item">
          <div class="content-label">③ 下周期目标计划</div>
          <div class="content-body">{{ interview.nextGoals || '未填写' }}</div>
        </div>
        <div class="content-item">
          <div class="content-label">④ 弥补改进行动</div>
          <div class="content-body">{{ interview.remediation || '未填写' }}</div>
        </div>
        <div class="content-item">
          <div class="content-label">⑤ 需协调的困难/资源</div>
          <div class="content-body">{{ interview.supportNeeded || '未填写' }}</div>
        </div>
        <div class="content-item">
          <div class="content-label">⑥ 其他沟通事项</div>
          <div class="content-body">{{ interview.otherMatters || '未填写' }}</div>
        </div>
      </div>

      <div class="sign-section">
        <InterviewSignPanel
          role="manager"
          :signed-at="interview.managerSignedAt"
          :disabled="true"
        />
        <InterviewSignPanel
          role="employee"
          :signed-at="interview.employeeSignedAt"
          :disabled="!canEmployeeSign"
          @sign="handleEmployeeSign"
        />
      </div>
    </template>

    <el-empty v-else description="暂无面谈记录" :image-size="80" />
  </ChartCard>
</template>

<style scoped>
.deadline-tag {
  margin-left: 8px;
}

.text-danger {
  color: var(--el-color-danger);
}

.content-section {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.content-item {
  padding: 12px 16px;
  background: #f7f8fa;
  border-radius: 4px;
}

.content-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin-bottom: 8px;
}

.content-body {
  font-size: 14px;
  line-height: 1.6;
  color: var(--el-text-color-regular);
  white-space: pre-wrap;
}

.sign-section {
  margin-top: 24px;
  display: flex;
  gap: 32px;
  padding: 16px;
  background: #fafafa;
  border-radius: 4px;
}
</style>
