<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { isAxiosError } from 'axios';
import { ElMessage } from 'element-plus';
import { employeeArchivesApi, type EmployeeDataReview, type EmployeeOnboardingResult } from '@/api/employee-archives.api';
import { arrivalConfirmationError, canReviseArrivalDate, isCancelledNewHireArrival, isPendingArrival, reviewedArrivalDate } from '@/utils/employee-lifecycle';

const props = defineProps<{ request: EmployeeDataReview; canConfirm: boolean; canEdit: boolean; busy?: boolean }>();
const emit = defineEmits<{ confirmed: [request: EmployeeOnboardingResult]; busy: [value: boolean]; refresh: [] }>();
const saving = ref(false);
const error = ref('');
const editingDate = ref(false);
const proposedDate = ref('');
const pendingArrival = computed(() => isPendingArrival(props.request));
const reopening = computed(() => isCancelledNewHireArrival(props.request));
const title = computed(() => reopening.value ? '重新办理入职' : pendingArrival.value ? '确认到岗' : '修订到岗日期');
const canReviseDate = computed(() => props.canEdit && canReviseArrivalDate(props.request));
const visible = computed(() => (props.canConfirm && pendingArrival.value) || canReviseDate.value);
const date = computed(() => reviewedArrivalDate(props.request));
watch(() => [props.request.id, props.request.requestVersion], () => { error.value = ''; editingDate.value = false; });

function editDate() {
  if (!canReviseDate.value || saving.value || props.busy) return;
  proposedDate.value = date.value;
  editingDate.value = true;
  error.value = '';
}

async function submitDate() {
  if (!canReviseDate.value || saving.value || props.busy) return;
  if (!proposedDate.value || (!reopening.value && proposedDate.value === date.value)) {
    error.value = reopening.value ? '请选择到岗日期。' : '请选择变更后的到岗日期。';
    return;
  }
  if (!Number.isInteger(props.request.requestVersion)) { error.value = '缺少申请版本，请刷新后重试。'; return; }
  const request = props.request;
  const restoring = reopening.value;
  saving.value = true;
  emit('busy', true);
  try {
    const updated = await employeeArchivesApi.reviseArrivalDate(request.id, { arrivalDate: proposedDate.value, requestVersion: request.requestVersion! });
    if (props.request.id !== request.id) return;
    emit('confirmed', updated);
    editingDate.value = false;
    ElMessage.success(restoring ? '原入职申请已重新提交审核，审核通过后再确认到岗' : '到岗日期变更已提交审核，审核通过后再确认到岗');
  } catch (cause) {
    if (props.request.id !== request.id) return;
    error.value = isAxiosError(cause) && typeof cause.response?.data?.message === 'string'
      ? cause.response.data.message : '日期变更未提交，填写内容仍保留，请重试。';
  } finally {
    saving.value = false;
    emit('busy', false);
  }
}

async function confirmArrival() {
  if (!pendingArrival.value || !props.canConfirm || saving.value || props.busy) return;
  const request = props.request;
  error.value = arrivalConfirmationError(request, date.value);
  if (error.value) return;
  saving.value = true;
  emit('busy', true);
  try {
    const updated = await employeeArchivesApi.confirmArrival(request.id, {
      arrivalDate: date.value, requestVersion: request.requestVersion!,
    });
    if (props.request.id !== request.id) return;
    emit('confirmed', updated);
    ElMessage.success(updated.onboardingStatus === 'effective' ? '到岗已确认，任职已生效' : '到岗确认已记录，请核对办理进度');
  } catch (cause) {
    if (props.request.id !== request.id) return;
    const message = isAxiosError(cause) ? cause.response?.data?.message : undefined;
    error.value = isAxiosError(cause) && cause.response?.status === 409
      ? '申请已更新，请刷新详情核对后重试。'
      : typeof message === 'string' ? message : '到岗确认未完成，申请仍保留，请核对后重试。';
  } finally {
    saving.value = false;
    emit('busy', false);
  }
}
</script>

<template>
  <section v-if="visible" class="arrival-confirmation" :aria-label="title">
    <h3>{{ title }}</h3>
    <el-form label-position="top" @submit.prevent="editingDate ? submitDate() : confirmArrival()">
      <el-form-item v-if="!editingDate" :label="pendingArrival ? '已审核到岗日期（北京时间）' : '申请到岗日期（北京时间）'" :error="error">
        <el-input :model-value="date" readonly :aria-label="pendingArrival ? '已审核到岗日期' : '申请到岗日期'" />
      </el-form-item>
      <el-form-item v-else :label="reopening ? '到岗日期（北京时间）' : '变更后到岗日期（北京时间）'" :error="error">
        <el-date-picker v-model="proposedDate" type="date" value-format="YYYY-MM-DD" :disabled="saving || busy" />
      </el-form-item>
      <p>{{ reopening ? '恢复原入职申请需重新审核，可沿用原到岗日期。' : '日期变更需先修改申请并重新审核。' }}确认到岗前，不启用本次任职和登录权限。</p>
      <div class="arrival-actions">
        <template v-if="editingDate">
          <el-button :disabled="saving || busy" @click="editingDate = false; error = ''">返回</el-button>
          <el-button type="primary" :loading="saving" :disabled="busy && !saving" @click="submitDate">{{ reopening ? '重新提交审核' : '提交日期变更' }}</el-button>
        </template>
        <template v-else>
          <el-button v-if="canConfirm && pendingArrival" type="primary" :loading="saving" :disabled="busy && !saving" @click="confirmArrival">确认到岗</el-button>
          <el-button v-if="canReviseDate" :disabled="saving || busy" @click="editDate">{{ reopening ? '重新办理入职' : '修改到岗日期' }}</el-button>
        </template>
        <el-button v-if="error" :disabled="saving || busy" @click="emit('refresh')">刷新详情</el-button>
      </div>
    </el-form>
  </section>
</template>

<style scoped>
.arrival-confirmation { padding: 16px 0; border-top: 1px solid var(--el-border-color-lighter); }
.arrival-confirmation h3 { margin: 0 0 12px; font-size: 15px; }
.arrival-confirmation p { margin: 12px 0; color: var(--el-text-color-secondary); line-height: 1.6; }
.arrival-confirmation :deep(.el-form-item__error) { position: static; line-height: 1.5; }
.arrival-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.arrival-actions :deep(.el-button) { margin-left: 0; }
</style>
