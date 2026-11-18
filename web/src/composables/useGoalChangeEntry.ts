import { onBeforeUnmount, ref, watch } from 'vue';
import { goalChangesApi } from '@/api/goal-changes.api';
import { useAuthStore } from '@/stores/auth.store';

export function useGoalChangeEntry() {
  const auth = useAuthStore();
  const visible = ref(false);
  let request = 0;
  onBeforeUnmount(() => { request++; });
  watch(() => auth.user?.id, async (id) => {
    const token = ++request;
    visible.value = false;
    if (!id) return;
    try {
      const entry = await goalChangesApi.entry();
      if (token === request) visible.value = entry.visible;
    } catch {
      // Keep navigation closed when entitlement cannot be verified.
    }
  }, { immediate: true });
  return visible;
}
