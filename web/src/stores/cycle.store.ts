import { defineStore } from 'pinia';
import { cyclesApi } from '@/api/cycles.api';
import type { AssessmentCycle } from '@/types/api.types';

export const useCycleStore = defineStore('cycle', {
  state: () => ({
    current: null as AssessmentCycle | null,
    loading: false,
    error: null as string | null,
  }),

  getters: {
    isActive: (state) => {
      if (!state.current) return false;
      return ['indicator_setting', 'self_eval', 'manager_score', 'hr_calibration', 'approval', 'published', 'appeal'].includes(
        state.current.status,
      );
    },
    cycleName: (state) => state.current?.name ?? '未选择周期',
  },

  actions: {
    async fetchCurrent() {
      this.loading = true;
      this.error = null;
      try {
        // 后端已无 /cycles/current，取最新的非草稿/非关闭周期作为「当前周期」。
        const res = await cyclesApi.findAll({ page: 1, pageSize: 1 });
        const active = res.items.find((c) => !['draft', 'closed'].includes(c.status));
        this.current = active ?? res.items[0] ?? null;
      } catch (e) {
        this.error = e instanceof Error ? e.message : '获取当前周期失败';
        this.current = null;
      } finally {
        this.loading = false;
      }
    },

    setCurrent(cycle: AssessmentCycle | null) {
      this.current = cycle;
    },

    clear() {
      this.current = null;
      this.error = null;
      this.loading = false;
    },
  },
});
