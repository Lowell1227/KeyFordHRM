import { computed, inject, onBeforeUnmount, onMounted, provide, shallowReactive, type InjectionKey } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';

interface EditorState {
  dirty: () => boolean;
  busy: () => boolean;
  discard: () => void;
}
const editorsKey: InjectionKey<Set<EditorState>> = Symbol('recruitment-editors');

/** Nested forms join their drawer/panel so leaving asks once and never drops a saving form. */
export function useRecruitmentLeaveGuard(state: EditorState, includeChildren = false) {
  const parent = inject(editorsKey, null);
  const children = shallowReactive(new Set<EditorState>());
  if (includeChildren) provide(editorsKey, children);
  const entry: EditorState = {
    dirty: () => state.dirty() || [...children].some(child => child.dirty()),
    busy: () => state.busy() || [...children].some(child => child.busy()),
    discard: () => { state.discard(); for (const child of children) child.discard(); },
  };
  parent?.add(entry);
  let pending: Promise<boolean> | undefined;
  async function confirmLeave() {
    if (entry.busy()) { ElMessage.info('正在保存，请完成后再操作。'); return false; }
    if (!entry.dirty()) return true;
    try {
      await ElMessageBox.confirm('当前内容尚未保存。放弃后将无法恢复本次输入。', '未保存的内容', {
        confirmButtonText: '放弃修改', cancelButtonText: '继续编辑', type: 'warning',
        closeOnClickModal: false, closeOnPressEscape: false, distinguishCancelAndClose: true,
      });
    } catch { return false; }
    if (entry.busy()) return false;
    entry.discard();
    return true;
  }
  function prepareToLeave() {
    if (!pending) pending = confirmLeave().finally(() => { pending = undefined; });
    return pending;
  }
  function beforeUnload(event: BeforeUnloadEvent) {
    if (entry.dirty() || entry.busy()) { event.preventDefault(); event.returnValue = ''; }
  }
  if (!parent) {
    onBeforeRouteLeave(prepareToLeave);
    onBeforeRouteUpdate(prepareToLeave);
    onMounted(() => window.addEventListener('beforeunload', beforeUnload));
  }
  onBeforeUnmount(() => { parent?.delete(entry); if (!parent) window.removeEventListener('beforeunload', beforeUnload); });
  return { prepareToLeave, saving: computed(entry.busy) };
}
