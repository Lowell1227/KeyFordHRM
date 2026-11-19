import { computed, ref } from 'vue';
import { talentResumeApi, type ResumeTask } from '@/api/talent-resume.api';

export function useResumeTask() {
  const task = ref<ResumeTask | null>(null);
  const error = ref('');
  const recovered = ref(false);
  const checking = ref(false);
  const acting = ref(false);
  const now = ref(Date.now());
  let context = '', active = false, generation = 0, request = 0;
  let poll: ReturnType<typeof setTimeout> | undefined;
  let clock: ReturnType<typeof setInterval> | undefined;
  const deadline = computed(() => task.value
    ? Math.min(Date.parse(task.value.deadlineAt), Date.parse(task.value.createdAt) + 150000) : 0);
  const elapsed = computed(() => task.value
    ? Math.max(0, Math.min(150, Math.floor((now.value - Date.parse(task.value.createdAt)) / 1000))) : 0);
  const busy = computed(() => acting.value || (task.value?.status === 'processing' && now.value < deadline.value));

  function stopTimers() {
    if (poll !== undefined) clearTimeout(poll);
    if (clock !== undefined) clearInterval(clock);
    poll = undefined; clock = undefined;
  }
  function stop() {
    active = false; generation++; request++; stopTimers();
    task.value = null; error.value = ''; checking.value = false; acting.value = false; recovered.value = false;
  }
  function current(token: number, sequence: number) {
    return active && token === generation && sequence === request;
  }
  function schedule() {
    if (poll !== undefined) clearTimeout(poll);
    poll = undefined;
    if (active && task.value?.status === 'processing' && now.value < deadline.value) {
      poll = setTimeout(() => { poll = undefined; void refresh(); }, 2000);
    }
  }
  function accept(value: ResumeTask | null) {
    stopTimers();
    now.value = Date.now();
    if (value && value.context !== context) {
      task.value = null; error.value = '解析任务与当前人才不匹配，请重新连接。'; return;
    }
    task.value = value;
    if (value?.status !== 'processing') return;
    if (now.value >= deadline.value) {
      error.value = '已达最长 150 秒，正在确认最终状态；可重新连接查看。'; return;
    }
    let deadlineRead = false;
    clock = setInterval(() => {
      now.value = Date.now();
      if (!deadlineRead && now.value >= deadline.value) {
        deadlineRead = true;
        stopTimers();
        // Deadline reads supersede any older in-flight poll without cancelling server work.
        void refresh();
      }
    }, 1000);
    schedule();
  }
  function connectionError(reason: unknown) {
    const response = (reason as { response?: { status?: number; data?: { message?: string } } })?.response;
    if (response?.status === 403 || response?.status === 404) {
      stopTimers(); task.value = null;
      return '解析任务已过期或无权读取，请重新选择文件；当前输入已保留。';
    }
    return typeof response?.data?.message === 'string' ? response.data.message
      : '连接中断，当前输入和已受理任务已保留，可重新连接查看。';
  }
  async function refresh() {
    if (!active || acting.value) return;
    const token = generation, sequence = ++request, id = task.value?.id;
    checking.value = true;
    if (poll !== undefined) clearTimeout(poll);
    poll = undefined;
    try {
      const value = id ? await talentResumeApi.get(id) : await talentResumeApi.current(context);
      if (!current(token, sequence)) return;
      error.value = '';
      accept(value);
    } catch (reason) {
      if (current(token, sequence)) error.value = connectionError(reason);
    } finally {
      if (current(token, sequence)) {
        checking.value = false;
        schedule();
      }
    }
  }
  async function open(ownerContext: string) {
    stop(); active = true; context = ownerContext; recovered.value = true;
    const token = generation;
    await refresh();
    // An already overdue recovered task needs a definitive ID status read too.
    if (active && token === generation && task.value?.status === 'processing' && now.value >= deadline.value) await refresh();
  }
  async function attempt(file?: File) {
    if (!active || checking.value || busy.value) return;
    const previous = task.value;
    if (!file && (!previous || !['failed', 'timed_out'].includes(previous.status))) return;
    if (!file && Date.parse(previous!.expiresAt) <= Date.now()) {
      error.value = '临时文件已过期，请重新选择文件。'; return;
    }
    const token = generation, sequence = ++request;
    stopTimers(); acting.value = true; error.value = '';
    try {
      const value = file ? await talentResumeApi.start(file, context) : await talentResumeApi.retry(previous!.id);
      if (current(token, sequence)) {
        accept(value);
        if (task.value?.id === value.id) { recovered.value = false; return value; }
      }
    } catch (reason) {
      if (!current(token, sequence)) return;
      error.value = connectionError(reason);
      // A lost POST response is not proof that the server rejected the task.
      try {
        const accepted = await talentResumeApi.current(context);
        if (current(token, sequence) && accepted) {
          recovered.value = true; error.value = ''; accept(accepted);
          return accepted;
        }
      } catch { /* Keep the accepted task ID, if known, for explicit reconnect. */ }
    } finally {
      if (current(token, sequence)) acting.value = false;
    }
  }
  async function clear() {
    if (!active || acting.value) return false;
    if (!task.value) return true;
    const token = generation, sequence = ++request, id = task.value.id;
    stopTimers(); checking.value = false; acting.value = true;
    try {
      await talentResumeApi.clear(id);
      if (!current(token, sequence)) return false;
      task.value = null; error.value = ''; return true;
    } catch {
      if (current(token, sequence)) error.value = '临时解析任务清除失败，请重新连接后重试。';
      return false;
    } finally {
      if (current(token, sequence)) {
        acting.value = false;
        accept(task.value);
      }
    }
  }
  return { task, error, recovered, checking, acting, elapsed, busy, open, stop, refresh,
    start: (file: File) => attempt(file), retry: () => attempt(), clear };
}
