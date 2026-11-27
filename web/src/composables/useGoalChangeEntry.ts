import { onScopeDispose, ref, watch } from 'vue';
import { createSharedComposable } from '@vueuse/core';
import { goalChangesApi } from '@/api/goal-changes.api';
import { useAuthStore } from '@/stores/auth.store';
import { useVisibleRefresh } from '@/composables/useVisibleRefresh';

const useSharedGoalChangeEntry = createSharedComposable(() => {
  const auth = useAuthStore();
  const visible = ref(false);
  let generation = 0, lastStarted = -Infinity;
  let pending: Promise<void> | null = null;
  const enabled = () => Boolean(auth.user?.id) && !auth.tokenExpired;
  function refresh(): Promise<void> {
    if (!enabled()) { visible.value = false; return Promise.resolve(); }
    if (pending) return pending;
    if (Date.now() - lastStarted < 750) return Promise.resolve();
    lastStarted = Date.now();
    const started = generation, userId = auth.user?.id, token = auth.token;
    const current = () => started === generation && userId === auth.user?.id && token === auth.token && enabled();
    const read = (async () => {
      try {
        const entry = await goalChangesApi.entry();
        if (current()) visible.value = entry.visible;
      } catch (cause) {
        const status = (cause as { response?: { status?: number } })?.response?.status;
        if (current() && (status === 401 || status === 403)) visible.value = false;
      }
    })().finally(() => { if (pending === read) pending = null; });
    pending = read;
    return read;
  }
  function invalidate() {
    generation++; pending = null; lastStarted = -Infinity; visible.value = false;
  }
  onScopeDispose(invalidate);
  watch(() => [auth.user, auth.token, auth.tokenExpired, auth.user?.sysRole, auth.user?.systemPermission,
    auth.user?.isAssessorOnly, JSON.stringify(auth.user?.hrCapabilities), JSON.stringify(auth.user?.businessCapabilities)],
    () => { invalidate(); void refresh(); }, { immediate: true });
  return { visible, refresh, enabled };
});

export function useGoalChangeEntry() {
  const entry = useSharedGoalChangeEntry();
  // Each consumer owns its listeners; requests and results survive until the last consumer leaves.
  useVisibleRefresh({ intervalMs: 0, enabled: entry.enabled, refresh: entry.refresh });
  return entry.visible;
}
