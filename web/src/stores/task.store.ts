import { defineStore } from 'pinia';
import { isApprovedResultAvailable, needsEmployeeResultConfirmation } from '@/utils/result-confirmation';
import { tasksApi } from '@/api/tasks.api';
import type { TaskDetail } from '@/types/api.types';
import type { TaskStatus } from '@/types/enums';

export const useTaskStore = defineStore('task', {
  state: () => ({
    detail: null as TaskDetail | null,
    loading: false,
    error: null as string | null,
    detailRequestGeneration: 0,
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

    /** 员工在线不发起申诉，由 HR 代录。 */
    canAppeal: () => false,

    /** 是否可以确认结果（审批通过后员工确认）。 */
    canConfirmResult: (state) => {
      if (state.detail?.isExempt) return false;
      return Boolean(state.detail && needsEmployeeResultConfirmation(state.detail));
    },

    /** 是否可以查看主管评分（公示后或拥有管理权限）。 */
    canViewManagerScore: (state) => {
      if (!state.detail) return false;
      return isApprovedResultAvailable(state.detail);
    },

    /** 是否可以查看总分/等级（公示后）。 */
    canViewScore: (state) => {
      if (!state.detail) return false;
      return isApprovedResultAvailable(state.detail);
    },
  },

  actions: {
    async fetchDetail(id: string) {
      const generation = ++this.detailRequestGeneration;
      this.detail = null;
      this.loading = true;
      this.error = null;
      try {
        const detail = await tasksApi.findOne(id);
        if (generation !== this.detailRequestGeneration) return null;
        if (detail.id !== id) throw new Error('获取任务详情不匹配，请重新加载');
        this.detail = detail;
        return this.detail;
      } catch (e) {
        if (generation !== this.detailRequestGeneration) return null;
        this.error = e instanceof Error ? e.message : '获取任务详情失败';
        this.detail = null;
        return null;
      } finally {
        if (generation === this.detailRequestGeneration) this.loading = false;
      }
    },

    setDetail(detail: TaskDetail | null) {
      this.clear();
      this.detail = detail;
    },

    clear() {
      this.detailRequestGeneration += 1;
      this.detail = null;
      this.error = null;
      this.loading = false;
    },
  },
});
