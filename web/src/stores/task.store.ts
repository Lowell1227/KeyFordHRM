import { defineStore } from 'pinia';
import { tasksApi } from '@/api/tasks.api';
import type { TaskDetail } from '@/types/api.types';
import type { TaskStatus } from '@/types/enums';

export const useTaskStore = defineStore('task', {
  state: () => ({
    detail: null as TaskDetail | null,
    loading: false,
    error: null as string | null,
  }),

  getters: {
    taskId: (state) => state.detail?.id,
    status: (state): TaskStatus | null => state.detail?.status ?? null,

    /** 当前任务是否已豁免。 */
    isExempt: (state) => state.detail?.isExempt ?? false,

    /** 是否处于员工自评阶段。 */
    canSelfEval: (state) => {
      if (state.detail?.isExempt) return false;
      return state.detail?.status === 'self_eval';
    },

    /** 是否处于主管评分阶段。 */
    canManagerScore: (state) => {
      if (state.detail?.isExempt) return false;
      return state.detail?.status === 'manager_scoring';
    },

    /** 是否可以申诉（公示后且未豁免）。 */
    canAppeal: (state) => {
      if (state.detail?.isExempt) return false;
      return state.detail?.status === 'published';
    },

    /** 是否可以确认结果（公示后员工确认）。 */
    canConfirmResult: (state) => {
      if (state.detail?.isExempt) return false;
      return state.detail?.status === 'published';
    },

    /** 是否可以查看主管评分（公示后或拥有管理权限）。 */
    canViewManagerScore: (state) => {
      if (!state.detail) return false;
      return ['published', 'confirmed', 'appealing', 'closed', 'exempted'].includes(
        state.detail.status,
      );
    },

    /** 是否可以查看总分/等级（公示后）。 */
    canViewScore: (state) => {
      if (!state.detail) return false;
      return ['published', 'confirmed', 'appealing', 'closed'].includes(state.detail.status);
    },
  },

  actions: {
    async fetchDetail(id: string) {
      this.loading = true;
      this.error = null;
      try {
        this.detail = await tasksApi.findOne(id);
      } catch (e) {
        this.error = e instanceof Error ? e.message : '获取任务详情失败';
        this.detail = null;
      } finally {
        this.loading = false;
      }
    },

    setDetail(detail: TaskDetail | null) {
      this.detail = detail;
    },

    clear() {
      this.detail = null;
      this.error = null;
      this.loading = false;
    },
  },
});
