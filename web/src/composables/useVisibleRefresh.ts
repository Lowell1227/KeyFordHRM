import { onMounted, onUnmounted, watch } from 'vue';

interface VisibleRefreshOptions {
  refresh: (canApply: () => boolean) => Promise<unknown>;
  enabled?: () => boolean;
  blocked?: () => boolean;
  intervalMs?: number;
}

export function useVisibleRefresh(options: VisibleRefreshOptions) {
  const interval = options.intervalMs ?? 10000;
  let active = false, running = false, pending = false, generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastStarted = -Infinity;
  const available = () => active && typeof document !== 'undefined' && !document.hidden
    && (options.enabled?.() ?? true) && !(options.blocked?.() ?? false);
  function clearTimer() { if (timer !== undefined) clearTimeout(timer); timer = undefined; }
  function schedule() {
    clearTimer();
    if (interval > 0 && available() && !running) timer = setTimeout(() => { timer = undefined; void refresh(); }, interval);
  }
  async function refresh() {
    if (!active || !(options.enabled?.() ?? true)) return;
    if (!available()) { pending = true; clearTimer(); return; }
    if (running) { if (Date.now() - lastStarted >= 750) pending = true; return; }
    const delay = 750 - (Date.now() - lastStarted);
    if (delay > 0) {
      if (pending) { clearTimer(); timer = setTimeout(() => { timer = undefined; void refresh(); }, delay); }
      return;
    }
    clearTimer(); running = true; pending = false; lastStarted = Date.now();
    const started = generation;
    try { await options.refresh(() => started === generation && available()); }
    catch { /* The caller owns the visible error state; a failed refresh must not stop future attempts. */ }
    finally {
      running = false;
      if (pending && available()) void refresh(); else schedule();
    }
  }
  const onFocus = () => { void refresh(); };
  const onVisibility = () => {
    generation++;
    if (document.hidden) { pending = true; clearTimer(); }
    else void refresh();
  };
  watch(() => [options.enabled?.() ?? true, options.blocked?.() ?? false], () => {
    generation++;
    if (!available()) { if (running) pending = true; clearTimer(); }
    else if (pending) void refresh(); else schedule();
  }, { flush: 'sync' });
  onMounted(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    active = true;
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    schedule();
  });
  onUnmounted(() => {
    active = false; generation++; clearTimer();
    if (typeof window !== 'undefined') window.removeEventListener('focus', onFocus);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
  });
}
