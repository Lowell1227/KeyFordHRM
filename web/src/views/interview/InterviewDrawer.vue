<script setup lang="ts">
import { ref, reactive, watch, computed } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { interviewsApi } from '@/api/interviews.api';
import { INTERVIEW_METHOD_LABELS, INTERVIEW_STATUS_LABELS } from '@/types/enums';
import { formatDateTime, formatDate, isOverdue, daysUntilDeadline } from '@/utils/date';
import type { PerformanceInterview, UpdateInterviewBody } from '@/types/api.types';
import type { InterviewMethod } from '@/types/enums';

const props = defineProps<{
  interviewId: string;
  readonly?: boolean;
}>();

const emit = defineEmits<{
  (e: 'saved'): void;
  (e: 'signed'): void;
}>();

const loading = ref(false);
const saving = ref(false);
const signing = ref(false);
const interview = ref<PerformanceInterview | null>(null);

const form = reactive<UpdateInterviewBody>({
  interviewTime: undefined,
  location: undefined,
  method: undefined,
  scoreInformed: false,
  achievements: undefined,
  weaknesses: undefined,
  nextGoals: undefined,
  remediation: undefined,
  supportNeeded: undefined,
  otherMatters: undefined,
});

const canEdit = computed(() => !props.readonly && !interview.value?.employeeSignedAt);
const isFilled = computed(() => !!interview.value && interview.value.status !== 'pending');
const canManagerSign = computed(
  () =>
    !props.readonly &&
    isFilled.value &&
    !interview.value?.managerSignedAt &&
    !interview.value?.employeeSignedAt,
);

const methodOptions: InterviewMethod[] = ['one_on_one', 'phone', 'performance_meeting'];

watch(
  () => props.interviewId,
  () => {
    if (props.interviewId) loadDetail();
  },
  { immediate: true },
);

function resetForm() {
  form.interviewTime = undefined;
  form.location = undefined;
  form.method = undefined;
  form.scoreInformed = false;
  form.achievements = undefined;
  form.weaknesses = undefined;
  form.nextGoals = undefined;
  form.remediation = undefined;
  form.supportNeeded = undefined;
  form.otherMatters = undefined;
}

function initForm(data: PerformanceInterview) {
  form.interviewTime = data.interviewTime ?? undefined;
  form.location = data.location ?? undefined;
  form.method = data.method ?? undefined;
  form.scoreInformed = data.scoreInformed ?? false;
  form.achievements = data.achievements ?? undefined;
  form.weaknesses = data.weaknesses ?? undefined;
  form.nextGoals = data.nextGoals ?? undefined;
  form.remediation = data.remediation ?? undefined;
  form.supportNeeded = data.supportNeeded ?? undefined;
  form.otherMatters = data.otherMatters ?? undefined;
}

async function loadDetail() {
  loading.value = true;
  try {
    const data = await interviewsApi.findOne(props.interviewId);
    interview.value = data;
    initForm(data);
  } catch {
    interview.value = null;
    resetForm();
  } finally {
    loading.value = false;
  }
}

async function handleSave() {
  if (!interview.value) return;
  saving.value = true;
  try {
    await interviewsApi.update(interview.value.id, { ...form });
    ElMessage.success('保存成功');
    emit('saved');
    await loadDetail();
  } finally {
    saving.value = false;
  }
}

async function handleManagerSign() {
  if (!interview.value) return;
  try {
    await ElMessageBox.confirm('确认以主管身份签字？', '签字确认', { type: 'warning' });
  } catch {
    return;
  }
  signing.value = true;
  try {
    await interviewsApi.managerSign(interview.value.id);
    ElMessage.success('签字成功');
    emit('signed');
    await loadDetail();
  } finally {
    signing.value = false;
  }
}
</script>

<template>
  <div v-loading="loading" class="interview-drawer">
    <template v-if="interview">
      <el-descriptions :column="2" border size="small" class="info-section">
        <el-descriptions-item label="员工">{{ interview.employeeName || '-' }}</el-descriptions-item>
        <el-descriptions-item label="部门">{{ interview.deptName || '-' }}</el-descriptions-item>
        <el-descriptions-item label="考核周期">{{ interview.cycleId || '-' }}</el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag
            :type="(INTERVIEW_STATUS_LABELS[interview.status]?.type || 'info') as any"
            size="small"
          >
            {{ INTERVIEW_STATUS_LABELS[interview.status]?.label || interview.status }}
          </el-tag>
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
      </el-descriptions>

      <el-form label-position="top" class="interview-form">
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="面谈时间">
              <el-date-picker
                v-model="form.interviewTime"
                type="datetime"
                placeholder="选择面谈时间"
                style="width: 100%"
                value-format="YYYY-MM-DDTHH:mm:ss"
                :disabled="!canEdit"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="面谈地点">
              <el-input
                v-model="form.location"
                placeholder="填写地点"
                maxlength="200"
                show-word-limit
                :disabled="!canEdit"
              />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="面谈方式">
              <el-select v-model="form.method" placeholder="选择面谈方式" style="width: 100%" :disabled="!canEdit">
                <el-option
                  v-for="m in methodOptions"
                  :key="m"
                  :label="INTERVIEW_METHOD_LABELS[m]"
                  :value="m"
                />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item>
              <el-checkbox v-model="form.scoreInformed" :disabled="!canEdit">
                已告知绩效分数
              </el-checkbox>
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="① 突出业绩">
          <el-input
            v-model="form.achievements"
            type="textarea"
            :rows="3"
            placeholder="填写员工本周期突出业绩"
            maxlength="4000"
            show-word-limit
            :disabled="!canEdit"
          />
        </el-form-item>

        <el-form-item label="② 不足与待提升">
          <el-input
            v-model="form.weaknesses"
            type="textarea"
            :rows="3"
            placeholder="填写不足与待提升项"
            maxlength="4000"
            show-word-limit
            :disabled="!canEdit"
          />
        </el-form-item>

        <el-form-item label="③ 下周期目标计划">
          <el-input
            v-model="form.nextGoals"
            type="textarea"
            :rows="3"
            placeholder="填写下周期目标计划"
            maxlength="4000"
            show-word-limit
            :disabled="!canEdit"
          />
        </el-form-item>

        <el-form-item label="④ 弥补改进行动">
          <el-input
            v-model="form.remediation"
            type="textarea"
            :rows="3"
            placeholder="填写弥补改进行动"
            maxlength="4000"
            show-word-limit
            :disabled="!canEdit"
          />
        </el-form-item>

        <el-form-item label="⑤ 需协调的困难/资源">
          <el-input
            v-model="form.supportNeeded"
            type="textarea"
            :rows="3"
            placeholder="填写需协调的困难或资源"
            maxlength="4000"
            show-word-limit
            :disabled="!canEdit"
          />
        </el-form-item>

        <el-form-item label="⑥ 其他沟通事项">
          <el-input
            v-model="form.otherMatters"
            type="textarea"
            :rows="3"
            placeholder="填写其他沟通事项"
            maxlength="4000"
            show-word-limit
            :disabled="!canEdit"
          />
        </el-form-item>
      </el-form>

      <div class="sign-section">
        <div class="sign-block">
          <span class="sign-label">面谈人签字</span>
          <span v-if="interview.managerSignedAt" class="signed-at">
            已签 {{ formatDateTime(interview.managerSignedAt) }}
          </span>
          <el-button
            v-else-if="canManagerSign"
            type="primary"
            size="small"
            :loading="signing"
            @click="handleManagerSign"
          >
            主管签字
          </el-button>
          <span v-else class="unsigned">待签字</span>
        </div>
        <div class="sign-block">
          <span class="sign-label">员工签字</span>
          <span v-if="interview.employeeSignedAt" class="signed-at">
            已签 {{ formatDateTime(interview.employeeSignedAt) }}
          </span>
          <span v-else class="unsigned">待员工在「我的绩效」中确认</span>
        </div>
      </div>

      <div class="drawer-footer">
        <el-button v-if="canEdit" type="primary" :loading="saving" @click="handleSave">保存面谈记录</el-button>
        <el-tag v-else-if="interview.employeeSignedAt" type="success">员工已签字，记录已锁定</el-tag>
      </div>
    </template>
  </div>
</template>

<style scoped>
.interview-drawer {
  padding-bottom: 24px;
}

.info-section {
  margin-bottom: 16px;
}

.interview-form {
  margin-top: 16px;
}

.deadline-tag {
  margin-left: 8px;
}

.text-danger {
  color: var(--el-color-danger);
}

.sign-section {
  display: flex;
  gap: 24px;
  margin: 24px 0;
  padding: 16px;
  background: #f7f8fa;
  border-radius: 4px;
}

.sign-block {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 14px;
}

.sign-label {
  color: var(--el-text-color-regular);
}

.signed-at {
  color: var(--el-color-success);
}

.unsigned {
  color: var(--el-text-color-placeholder);
}

.drawer-footer {
  display: flex;
  justify-content: flex-end;
  margin-top: 24px;
}
</style>
