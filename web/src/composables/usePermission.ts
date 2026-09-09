import { computed, unref } from 'vue';
import { useAuthStore } from '@/stores/auth.store';
import type { TaskDetail, CurrentUser, AssessmentCycle, PublishVisibleFields } from '@/types/api.types';
import type { TaskStatus } from '@/types/enums';
import type { MaybeRef } from 'vue';
import { isResultPublished, isApprovedResultAvailable, needsEmployeeResultConfirmation } from '@/utils/result-confirmation';

const DEFAULT_VISIBLE_FIELDS: PublishVisibleFields = {
  totalScore: true,
  grade: true,
  indicatorScores: true,
  managerComment: true,
  coefficient: true,
};

export interface PermissionContext {
  task?: MaybeRef<TaskDetail | null | undefined>;
  cycle?: MaybeRef<AssessmentCycle | null | undefined>;
  currentUser?: MaybeRef<CurrentUser | null | undefined>;
}

/** 当前用户是否是任务员工本人。 */
function isSelf(task: TaskDetail, user: CurrentUser): boolean {
  return task.employeeId === user.id;
}

/** 当前用户是否是任务主管（或被代理的主管）。 */
function isManager(task: TaskDetail, user: CurrentUser): boolean {
  return task.managerId === user.id;
}

/** 当前用户是否是部门负责人。 */
function isDeptHead(task: TaskDetail, user: CurrentUser): boolean {
  return task.deptHeadId === user.id;
}

/** 当前用户是否是HR/系统管理员（含全量只读董事长）。 */
function isHrOrAdmin(user: CurrentUser): boolean {
  return ['hr', 'system_admin'].includes(user.sysRole) || user.canViewAll;
}

/**
 * 任务相关权限判断。
 *
 * 核心规则（对应 04 前端设计文档 5.3）：
 * - 员工在审批通过后可查看本人结果，仍受结果字段配置限制。
 * - 主管/HR/审批人在评分阶段开始后即可查看主管评分。
 */
export function usePermission(ctx?: PermissionContext) {
  const auth = useAuthStore();

  const task = computed(() => unref(ctx?.task) ?? null);
  const cycle = computed(() => unref(ctx?.cycle) ?? null);
  const user = computed(() => unref(ctx?.currentUser) ?? auth.user);

  const isTaskSelf = computed(() => !!(task.value && user.value && isSelf(task.value, user.value)));
  const isTaskManager = computed(() => !!(task.value && user.value && isManager(task.value, user.value)));
  const isTaskDeptHead = computed(() => !!(task.value && user.value && isDeptHead(task.value, user.value)));
  const isAdminLike = computed(() => !!(user.value && isHrOrAdmin(user.value)));

  const status = computed<TaskStatus | null>(() => task.value?.status ?? null);
  const isExempt = computed(() => task.value?.isExempt ?? false);

  /** 员工视角：任务是否已实际公示。 */
  const isPublished = computed(() => Boolean(task.value && isResultPublished(task.value)));
  const isResultAvailable = computed(() => Boolean(task.value && isApprovedResultAvailable(task.value)));

  const publishVisibleFields = computed(() => cycle.value?.publishVisibleFields ?? DEFAULT_VISIBLE_FIELDS);

  const maskMessage = computed(() => {
    if (!isTaskSelf.value) return null;
    if (!isResultAvailable.value) {
      return '绩效结果尚未审批通过，审批后可查看并确认。';
    }
    return '该字段未在结果可见范围内展示。';
  });

  /** 员工是否可以编辑自评。 */
  const canEditSelfEval = computed(() => {
    if (!task.value || !user.value || isExempt.value) return false;
    return status.value === 'self_eval' && isTaskSelf.value;
  });

  /** 主管是否可以编辑主管评分。 */
  const canEditManagerScore = computed(() => {
    if (!task.value || !user.value || isExempt.value) return false;
    return status.value === 'manager_scoring' && isTaskManager.value;
  });

  /**
   * 是否可以查看主管评分（含指标得分、主管评语等）。
   * 关键约束：员工在审批通过后可查看主管评分，按 publishVisibleFields.indicatorScores 控制。
   */
  const canViewManagerScore = computed(() => {
    if (!task.value || !user.value) return false;
    const s = status.value;
    if (!s) return false;

    // 员工本人：审批通过后可见，且受字段配置控制
    if (isTaskSelf.value) {
      if (!isResultAvailable.value) return false;
      return publishVisibleFields.value.indicatorScores ?? true;
    }

    // 主管/部门负责人/HR/管理员：评分阶段开始后即可见。业务身份以任务快照为准。
    return (
      isTaskManager.value ||
      isTaskDeptHead.value ||
      isAdminLike.value
    );
  });

  /** 是否可以查看主管评语（审批后按 managerComment 配置）。 */
  const canViewManagerComment = computed(() => {
    if (!task.value || !user.value) return false;
    if (!isTaskSelf.value) return true;
    if (!isResultAvailable.value) return false;
    return publishVisibleFields.value.managerComment ?? true;
  });

  /** 是否可以查看总分（审批后按 totalScore 配置）。 */
  const canViewTotalScore = computed(() => {
    if (!task.value || !user.value) return false;
    if (!isTaskSelf.value) return true;
    if (!isResultAvailable.value) return false;
    return publishVisibleFields.value.totalScore ?? true;
  });

  /** 是否可以查看系数（审批后按 coefficient 配置）。 */
  const canViewCoefficient = computed(() => {
    if (!task.value || !user.value) return false;
    if (!isTaskSelf.value) return true;
    if (!isResultAvailable.value) return false;
    return publishVisibleFields.value.coefficient ?? true;
  });

  /** 是否可以申诉。 */
  const canAppeal = computed(() => {
    if (!task.value || !user.value || isExempt.value) return false;
    return false;
  });

  /** 是否可以确认结果。 */
  const canConfirmResult = computed(() => {
    if (!task.value || !user.value || isExempt.value) return false;
    return needsEmployeeResultConfirmation(task.value) && isTaskSelf.value;
  });

  /** 是否可以查看绩效校准结果/等级（审批后按 grade 配置）。 */
  const canViewCalibration = computed(() => {
    if (!task.value || !user.value) return false;
    if (isTaskSelf.value) {
      if (!isResultAvailable.value) return false;
      return publishVisibleFields.value.grade ?? true;
    }
    return isTaskManager.value || isTaskDeptHead.value || isAdminLike.value;
  });

  return {
    isTaskSelf,
    isTaskManager,
    isTaskDeptHead,
    isAdminLike,
    isPublished,
    isResultAvailable,
    canEditSelfEval,
    canEditManagerScore,
    canViewManagerScore,
    canViewManagerComment,
    canViewTotalScore,
    canViewCoefficient,
    canAppeal,
    canConfirmResult,
    canViewCalibration,
    maskMessage,
  };
}
