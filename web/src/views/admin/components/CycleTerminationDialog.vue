<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ElMessageBox } from 'element-plus';
import { cyclesApi } from '@/api/cycles.api';
import type { AssessmentCycle, CycleTerminationPreview, CycleTerminationResult } from '@/types/api.types';
import { TASK_STATUS_META, type TaskStatus } from '@/types/enums';
import ListPagination from '@/components/common/ListPagination.vue';

const props = defineProps<{ visible: boolean; cycle: AssessmentCycle | null }>();
const emit = defineEmits<{
  'update:visible': [value: boolean];
  completed: [result: CycleTerminationResult, reason: string];
}>();
const preview = ref<CycleTerminationPreview | null>(null);
const reason = ref('');
const reasonError = ref('');
const actionError = ref('');
const previewError = ref('');
const loading = ref(false);
const busy = ref(false);
const forbidden = ref(false);
const page = ref(1);
const pageSize = 10;
let generation = 0;
const pageTasks = computed(() => preview.value?.tasks.slice((page.value - 1) * pageSize, page.value * pageSize) ?? []);
const maySubmit = computed(() => Boolean(props.visible && props.cycle?.canTerminate === true
  && !props.cycle.terminatedAt && preview.value?.canTerminate && !preview.value.cycle.terminatedAt
  && preview.value.previewHash && !loading.value && !forbidden.value));
const dispositionLabels = { terminate: '将终止', protected: '保留结果及原流程', already_ended: '已结束，保持不变' };

function statusOf(error: unknown): number | undefined {
  return (error as { response?: { status?: number } })?.response?.status;
}
function errorMessage(error: unknown, fallback: string): string {
  const message = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  return typeof message === 'string' ? message : fallback;
}

async function loadPreview() {
  if (!props.visible || !props.cycle || forbidden.value || loading.value) return;
  const current = ++generation;
  const id = props.cycle.id;
  loading.value = true;
  preview.value = null;
  previewError.value = '';
  page.value = 1;
  try {
    const result = await cyclesApi.terminationPreview(id);
    if (current !== generation) return;
    preview.value = result;
    if (!result.canTerminate || result.cycle.terminatedAt) {
      actionError.value = result.cycle.terminatedAt ? '该周期已终止，请关闭后刷新查看记录。' : '当前不可终止该周期，请关闭后核对权限及周期状态。';
    }
  } catch (error) {
    if (current !== generation) return;
    forbidden.value = statusOf(error) === 403;
    previewError.value = forbidden.value ? '没有终止该周期的权限，不能继续提交。' : errorMessage(error, '影响清单加载失败，请重新读取；已填原因保留。');
  } finally {
    if (current === generation) loading.value = false;
  }
}

async function submit() {
  if (busy.value || !maySubmit.value) return;
  reasonError.value = !reason.value.trim() ? '请填写终止原因' : reason.value.length > 1000 ? '终止原因不能超过1000字' : '';
  if (reasonError.value) return;
  busy.value = true;
  actionError.value = '';
  const current = generation;
  const impact = preview.value!;
  const submittedReason = reason.value.trim();
  try {
    try {
      await ElMessageBox.confirm(
        `将终止「${impact.cycle.name}」中 ${impact.summary.terminable} 人的未完结任务，保留 ${impact.summary.protected} 人的受保护结果及原流程。此操作不删除历史，不能自动恢复。`,
        '再次确认终止周期',
        { type: 'warning', confirmButtonText: '终止周期并保留记录', confirmButtonClass: 'el-button--danger', cancelButtonText: '返回核对', closeOnClickModal: false },
      );
    } catch { return; }
    if (current !== generation || !maySubmit.value) return;
    const result = await cyclesApi.terminate(impact.cycle.id, { reason: submittedReason, expectedPreviewHash: impact.previewHash });
    if (current !== generation) return;
    emit('completed', result, submittedReason);
    emit('update:visible', false);
  } catch (error) {
    if (current !== generation) return;
    if (statusOf(error) === 403) {
      forbidden.value = true;
      preview.value = null;
      actionError.value = '终止权限已失效，不能重试提交；请关闭后联系授权管理员。已填原因保留。';
    } else if (statusOf(error) === 409) {
      actionError.value = '影响范围或周期状态已变化，请重新核对影响清单并再次确认；已填原因保留。';
      // Reloading advances generation; release this submission before the new read.
      busy.value = false;
      await loadPreview();
    } else {
      preview.value = null;
      actionError.value = errorMessage(error, '终止未能确认成功，请重新读取清单核对当前状态后再办理；已填原因保留。');
    }
  } finally {
    if (current === generation) busy.value = false;
  }
}

function close() {
  if (!busy.value) emit('update:visible', false);
}
watch(() => [props.visible, props.cycle?.id] as const, () => {
  generation += 1;
  preview.value = null;
  loading.value = false;
  busy.value = false;
  if (!props.visible) return;
  reason.value = '';
  reasonError.value = '';
  actionError.value = '';
  forbidden.value = false;
  void loadPreview();
}, { immediate: true });
onBeforeUnmount(() => { generation += 1; });
</script>

<template>
  <el-dialog :model-value="visible" title="终止周期" width="min(940px, calc(100vw - 24px))"
    class="cycle-termination-dialog" data-testid="cycle-termination-dialog" destroy-on-close
    :close-on-click-modal="false" :close-on-press-escape="!busy" :show-close="!busy" :before-close="close">
    <h3 class="termination-name">{{ cycle?.name }}</h3>
    <p class="termination-boundary">仅终止本周期内可终止的未完结任务；已审批结果及其公示、申诉流程保留。已保存、已提交数据和历史记录不删除，不联动转正、改进计划或薪酬。</p>
    <div v-loading="loading" class="termination-impact" aria-label="终止影响清单">
      <el-alert v-if="previewError" :title="previewError" type="error" :closable="false" show-icon />
      <template v-if="preview">
        <dl class="termination-summary" data-testid="cycle-termination-summary">
          <div><dt>任务总人数</dt><dd>{{ preview.summary.total }}</dd></div>
          <div><dt>将终止</dt><dd>{{ preview.summary.terminable }}</dd></div>
          <div><dt>保留结果及原流程</dt><dd>{{ preview.summary.protected }}</dd></div>
          <div><dt>已经结束</dt><dd>{{ preview.summary.alreadyEnded }}</dd></div>
          <div><dt>将取消的目标变更</dt><dd>{{ preview.summary.goalChanges }}</dd></div>
          <div><dt>将取消的待发提醒</dt><dd>{{ preview.summary.reminders }}</dd></div>
        </dl>
        <el-table :data="pageTasks" row-key="id" data-testid="cycle-termination-tasks" max-height="310">
          <el-table-column label="员工" min-width="130"><template #default="{ row }">{{ row.employeeName }}<small class="termination-employee-no">{{ row.employeeNo || '无工号' }}</small></template></el-table-column>
          <el-table-column label="当前任务" min-width="130"><template #default="{ row }">{{ TASK_STATUS_META[row.status as TaskStatus]?.label || row.status }}</template></el-table-column>
          <el-table-column label="处理结果" min-width="160"><template #default="{ row }">{{ dispositionLabels[row.disposition as keyof typeof dispositionLabels] }}</template></el-table-column>
          <el-table-column prop="reason" label="依据" min-width="230" />
        </el-table>
        <ListPagination v-model:current-page="page" :page-size="pageSize" :total="preview.tasks.length" :show-page-size="false" :disabled="busy" />
      </template>
    </div>
    <el-button v-if="!forbidden" data-testid="cycle-termination-refresh" :loading="loading" :disabled="busy || loading" @click="loadPreview">重新读取影响清单</el-button>
    <el-form label-position="top" @submit.prevent="submit">
      <el-form-item label="终止原因" required :error="reasonError">
        <el-input v-model="reason" data-testid="cycle-termination-reason" type="textarea" :rows="3" maxlength="1000" show-word-limit :disabled="busy" @input="reasonError = ''" />
      </el-form-item>
    </el-form>
    <el-alert v-if="actionError" data-testid="cycle-termination-error" :title="actionError" type="error" :closable="false" show-icon />
    <template #footer>
      <el-button :disabled="busy" @click="close">取消</el-button>
      <el-button data-testid="cycle-termination-submit" type="danger" :loading="busy" :disabled="!maySubmit || busy" @click="submit">继续终止</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
:global(.cycle-termination-dialog.el-dialog) { margin: 24px auto !important; max-height: calc(100dvh - 48px); }
.termination-name { margin: 0 0 12px; font-size: 16px; overflow-wrap: anywhere; }
.termination-boundary { margin: 0 0 16px; line-height: 1.6; color: var(--el-text-color-secondary); }
.termination-impact { min-height: 90px; margin-bottom: 12px; }
.termination-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 0 0 16px; }
.termination-summary div { border-bottom: 1px solid var(--el-border-color-lighter); padding-bottom: 8px; }
.termination-summary dt { color: var(--el-text-color-secondary); font-size: 13px; }
.termination-summary dd { margin: 6px 0 0; font-size: 20px; font-weight: 600; }
.termination-employee-no { display: block; color: var(--el-text-color-secondary); }
.el-form { margin-top: 16px; }
@media (max-width: 767px) {
  .termination-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
