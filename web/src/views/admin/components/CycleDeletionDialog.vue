<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ElMessageBox } from 'element-plus';
import { cyclesApi } from '@/api/cycles.api';
import type { AssessmentCycle, CycleDeletionPreview, CycleDeletionResult } from '@/types/api.types';
import { TASK_STATUS_META, type TaskStatus } from '@/types/enums';
import ListPagination from '@/components/common/ListPagination.vue';

const props = defineProps<{ visible: boolean; cycle: AssessmentCycle | null }>();
const emit = defineEmits<{ 'update:visible': [value: boolean]; completed: [result: CycleDeletionResult] }>();
const preview = ref<CycleDeletionPreview | null>(null);
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
const maySubmit = computed(() => Boolean(props.visible && props.cycle?.canDelete === true
  && !props.cycle.deletedAt && preview.value?.canDelete && !preview.value.cycle.deletedAt
  && preview.value.previewHash && !loading.value && !forbidden.value));
const labels = { delete: '将删除', blocked: '未办结，阻止删除', already_deleted: '此前已删除' };
function statusOf(error: unknown) { return (error as { response?: { status?: number } })?.response?.status; }
function messageOf(error: unknown, fallback: string) {
  const message = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  return typeof message === 'string' ? message : fallback;
}
async function loadPreview() {
  if (!props.visible || !props.cycle || forbidden.value || loading.value) return;
  const current = ++generation;
  loading.value = true; preview.value = null; previewError.value = ''; page.value = 1;
  try {
    const result = await cyclesApi.deletionPreview(props.cycle.id);
    if (current !== generation) return;
    preview.value = result;
    if (!result.canDelete) actionError.value = '仍有未办结事项，请按清单先处理；本次不会删除任何记录。';
  } catch (error) {
    if (current !== generation) return;
    forbidden.value = statusOf(error) === 403;
    previewError.value = forbidden.value ? '没有删除该周期的权限，不能继续提交。' : messageOf(error, '影响清单加载失败，请重新读取；已填原因保留。');
  } finally { if (current === generation) loading.value = false; }
}
async function submit() {
  if (busy.value || !maySubmit.value) return;
  reasonError.value = !reason.value.trim() ? '请填写删除原因' : reason.value.length > 1000 ? '删除原因不能超过1000字' : '';
  if (reasonError.value) return;
  busy.value = true; actionError.value = '';
  const current = generation;
  const impact = preview.value!;
  const submittedReason = reason.value.trim();
  try {
    try {
      await ElMessageBox.confirm(`删除「${impact.cycle.name}」及所属 ${impact.summary.deletable} 条任务、${impact.summary.goalChanges} 条目标变更。仅逻辑删除，原内容、结果和审计保留；当前不提供恢复入口。`,
        '再次确认删除周期', { type: 'warning', confirmButtonText: '删除周期及所属任务', confirmButtonClass: 'el-button--danger', cancelButtonText: '返回核对', closeOnClickModal: false });
    } catch { return; }
    if (current !== generation || !maySubmit.value) return;
    const result = await cyclesApi.logicalDelete(impact.cycle.id, { reason: submittedReason, expectedPreviewHash: impact.previewHash });
    if (current !== generation) return;
    emit('completed', result); emit('update:visible', false);
  } catch (error) {
    if (current !== generation) return;
    if (statusOf(error) === 403) {
      forbidden.value = true; preview.value = null;
      actionError.value = '删除权限已失效，不能继续提交；请联系授权管理员。已填原因保留。';
    } else if (statusOf(error) === 409) {
      actionError.value = '影响范围或状态已变化，请重新核对清单并再次确认；已填原因保留。';
      busy.value = false; await loadPreview();
    } else {
      preview.value = null;
      actionError.value = messageOf(error, '删除结果尚未确认，请重新读取清单后核对；已填原因保留。');
    }
  } finally { if (current === generation) busy.value = false; }
}
function close() { if (!busy.value) emit('update:visible', false); }
watch(() => [props.visible, props.cycle?.id] as const, () => {
  generation++; preview.value = null; loading.value = false; busy.value = false;
  if (!props.visible) return;
  reason.value = ''; reasonError.value = ''; actionError.value = ''; forbidden.value = false;
  void loadPreview();
}, { immediate: true });
onBeforeUnmount(() => { generation++; });
</script>

<template>
  <el-dialog :model-value="visible" title="删除周期" width="min(940px, calc(100vw - 24px))"
    class="cycle-deletion-dialog" data-testid="cycle-deletion-dialog" destroy-on-close
    :close-on-click-modal="false" :close-on-press-escape="!busy" :show-close="!busy" :before-close="close">
    <h3>{{ cycle?.name }}</h3>
    <p>周期及所属任务将从正常列表删除，原内容、结果和审计保留。不删除独立的改进计划、转正或薪酬记录。</p>
    <div v-loading="loading" aria-label="删除影响清单">
      <el-alert v-if="previewError" :title="previewError" type="error" :closable="false" show-icon />
      <template v-if="preview">
        <dl class="deletion-summary" data-testid="cycle-deletion-summary">
          <div><dt>所属任务</dt><dd>{{ preview.summary.total }}</dd></div>
          <div><dt>将删除任务</dt><dd>{{ preview.summary.deletable }}</dd></div>
          <div><dt>未办结事项</dt><dd>{{ preview.summary.blocked }}</dd></div>
          <div><dt>此前已删除</dt><dd>{{ preview.summary.alreadyDeleted }}</dd></div>
          <div><dt>所属目标变更</dt><dd>{{ preview.summary.goalChanges }}</dd></div>
        </dl>
        <el-table :data="pageTasks" row-key="id" max-height="310" data-testid="cycle-deletion-tasks">
          <el-table-column label="员工" min-width="130"><template #default="{ row }">{{ row.employeeName }}<small>{{ row.employeeNo || '无工号' }}</small></template></el-table-column>
          <el-table-column label="原任务状态" min-width="130"><template #default="{ row }">{{ TASK_STATUS_META[row.status as TaskStatus]?.label || row.status }}</template></el-table-column>
          <el-table-column label="处理结果" min-width="160"><template #default="{ row }">{{ labels[row.disposition as keyof typeof labels] }}</template></el-table-column>
          <el-table-column prop="reason" label="依据" min-width="230" />
        </el-table>
        <ListPagination v-model:current-page="page" :page-size="pageSize" :total="preview.tasks.length" :show-page-size="false" :disabled="busy" />
      </template>
    </div>
    <el-button v-if="!forbidden" :loading="loading" :disabled="busy || loading" data-testid="cycle-deletion-refresh" @click="loadPreview">重新读取影响清单</el-button>
    <el-form label-position="top" @submit.prevent="submit">
      <el-form-item label="删除原因" required :error="reasonError">
        <el-input v-model="reason" data-testid="cycle-deletion-reason" type="textarea" :rows="3" maxlength="1000" show-word-limit :disabled="busy" @input="reasonError = ''" />
      </el-form-item>
    </el-form>
    <el-alert v-if="actionError" data-testid="cycle-deletion-error" :title="actionError" type="error" :closable="false" show-icon />
    <template #footer>
      <el-button :disabled="busy" @click="close">取消</el-button>
      <el-button data-testid="cycle-deletion-submit" type="danger" :loading="busy" :disabled="!maySubmit || busy" @click="submit">继续删除</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
:global(.cycle-deletion-dialog.el-dialog) { margin: 24px auto !important; max-height: calc(100dvh - 48px); }
h3 { margin: 0 0 12px; font-size: 16px; overflow-wrap: anywhere; }
p { line-height: 1.6; color: var(--el-text-color-secondary); }
.deletion-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.deletion-summary div { border-bottom: 1px solid var(--el-border-color-lighter); padding-bottom: 8px; }
dt, small { color: var(--el-text-color-secondary); font-size: 13px; }
dd { margin: 6px 0 0; font-size: 20px; font-weight: 600; }
small { display: block; }
.el-form { margin-top: 16px; }
@media (max-width: 767px) { .deletion-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
