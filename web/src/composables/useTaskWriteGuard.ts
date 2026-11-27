import { onBeforeUnmount, ref, watch } from 'vue';
import { performanceLifecycleApi } from '@/api/performance-lifecycle.api';
import { useAuthStore } from '@/stores/auth.store';

type WriteContext = { taskId: string; isCurrent: () => boolean };

export function useTaskWriteGuard(taskId: () => string | undefined, scope: () => unknown) {
  const auth = useAuthStore();
  const blocked = ref(false);
  const notice = ref('');
  const ended = ref(false);
  let generation = 0;
  const retained = '未保存输入仍保留在当前页面，已有设备草稿不会清除；未提交内容不会写入已保存记录。';
  watch(() => [taskId(), scope(), auth.user?.id] as const, (next, previous) => {
    generation++;
    ended.value = false;
    blocked.value = !!previous && next[2] !== previous[2];
    notice.value = blocked.value ? `登录身份已变化，不能继续保存或提交。${retained}` : '';
  }, { flush: 'sync' });
  onBeforeUnmount(() => { generation++; });

  function capture(): WriteContext {
    const current = generation;
    const id = taskId() ?? '';
    return { taskId: id, isCurrent: () => current === generation && id === (taskId() ?? '') };
  }

  function unavailable() {
    blocked.value = true;
    ended.value = false;
    notice.value = `当前任务已不可办理或访问权限已失效，不能保存或提交。${retained}请返回工作台核对。`;
  }

  async function handleFailure(error: unknown, context: WriteContext): Promise<boolean> {
    if (!context.isCurrent()) return true;
    const status = (error as { response?: { status?: number } })?.response?.status;
    if ([401, 403, 404].includes(status ?? 0)) { unavailable(); return true; }
    if (status !== 409 || !context.taskId) return false;
    try {
      // Verify only lifecycle metadata; replacing task detail would discard the open editor.
      const state = await performanceLifecycleApi.detail('task', context.taskId);
      if (!context.isCurrent()) return true;
      if (state.lifecycleStatus === 'terminated' || state.lifecycleStatus === 'deleted') {
        blocked.value = true;
        ended.value = true;
        notice.value = `该绩效任务${state.lifecycleStatus === 'terminated' ? '已终止' : '已移入历史'}，不能保存或提交。${retained}`
          + (state.terminationReason ? `终止原因：${state.terminationReason}` : '');
      } else {
        notice.value = `记录版本已变化，本次未提交。${retained}请另页核对已保存记录后再处理。`;
      }
    } catch (verificationError) {
      if (!context.isCurrent()) return true;
      const code = (verificationError as { response?: { status?: number } })?.response?.status;
      if ([401, 403, 404].includes(code ?? 0)) unavailable();
      else {
        blocked.value = true;
        notice.value = `暂时无法核实任务状态，已停止保存和提交。${retained}请稍后另页核对。`;
      }
    }
    return true;
  }

  function preventBlockedInteraction(event: Event) {
    if (!blocked.value) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  return { blocked, notice, ended, capture, handleFailure, preventBlockedInteraction };
}
