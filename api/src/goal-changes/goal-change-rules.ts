import { BadRequestException } from '@nestjs/common';
import { IndicatorType, TaskStatus } from '@prisma/client';
import { AuthUser } from '@/common/types/auth.types';
import { nextGoalStep } from '@/tasks/goal-workflow';

export interface ChangeGoal {
  sourceInstanceId: string | null;
  name: string;
  description: string | null;
  scoringStandard: string | null;
  targetValue: number | null;
  targetValueText: string | null;
  unit: string | null;
  weight: number;
  indicatorType: IndicatorType;
  dimensionName: string | null;
  dimensionWeight: number;
  sortOrder: number;
}
export type ChangeActors = { employeeId: string; managerId: string | null; deptHeadId: string | null; approverId: string | null };

export function canGrantChanges(viewer: AuthUser, cycle: { hrOwnerId?: string | null }): boolean {
  return !viewer.isAssessorOnly && (viewer.sysRole === 'hr' || (viewer.sysRole === 'hr_user'
    && Boolean(viewer.hrCapabilities?.includes('cycle_plan_edit')) && cycle.hrOwnerId === viewer.id));
}

export function nextChangeStage(task: ChangeActors, completed: string, version: number) {
  if (version >= 2) {
    const next = nextGoalStep(task, completed as TaskStatus);
    return { ...next, status: next.status === 'goal_confirmed' ? 'active' : next.status };
  }
  if (completed === 'indicator_confirming') return { status: 'active', skipped: [] };
  if (completed === 'indicator_reviewing') return { status: 'indicator_confirming', skipped: [] };
  if (!task.managerId) throw new BadRequestException('绩效直属上级未配置');
  return { status: task.managerId === task.employeeId ? 'indicator_confirming' : 'indicator_reviewing', skipped: [] };
}

export function changeOwner(task: ChangeActors, status: string): string | null {
  return status === 'indicator_reviewing' ? task.managerId : status === 'indicator_dept_reviewing' ? task.deptHeadId
    : status === 'indicator_confirming' ? task.employeeId : status === 'indicator_approving' ? task.approverId : null;
}

export function validateChangeGoals(goals: ChangeGoal[], baseline: ChangeGoal[]): ChangeGoal[] {
  if (!Array.isArray(goals) || !goals.length || goals.length > 100) throw new BadRequestException('请保留有效目标');
  const sources = new Set(baseline.map((goal) => goal.sourceInstanceId));
  const names = new Set<string>();
  const seen = new Set<string>();
  const normalized = goals.map((goal) => {
    if (goal.sourceInstanceId && (!sources.has(goal.sourceInstanceId) || seen.has(goal.sourceInstanceId))) {
      throw new BadRequestException('目标关联与原目标不一致，请刷新');
    }
    if (goal.sourceInstanceId) seen.add(goal.sourceInstanceId);
    const original = baseline.find((item) => item.sourceInstanceId === goal.sourceInstanceId);
    const sameDimension = (item: ChangeGoal) => item.indicatorType === goal.indicatorType
      && item.dimensionName === goal.dimensionName && item.dimensionWeight === goal.dimensionWeight;
    if (goal.sourceInstanceId ? !original || !sameDimension(original) : !baseline.some(sameDimension)) {
      throw new BadRequestException('目标须沿用原考核维度、指标类型和维度权重');
    }
    const name = goal.name?.trim();
    if (!name || name.length > 200 || names.has(name.toLocaleLowerCase())) throw new BadRequestException('目标名称不能为空或重复');
    names.add(name.toLocaleLowerCase());
    if (!Number.isFinite(goal.weight) || goal.weight < 0 || goal.weight > 1
      || !Number.isFinite(goal.dimensionWeight) || goal.dimensionWeight < 0 || goal.dimensionWeight > 1
      || !Number.isInteger(goal.sortOrder) || goal.sortOrder < 0
      || (goal.targetValue !== null && (!Number.isFinite(goal.targetValue) || Math.abs(goal.targetValue) > 99999999.99))) {
      throw new BadRequestException('目标值、权重或排序不合法');
    }
    if (!Object.values(IndicatorType).includes(goal.indicatorType)) throw new BadRequestException('目标指标类型不合法');
    for (const [field, max] of [['description', 10000], ['scoringStandard', 10000], ['targetValueText', 100], ['unit', 30], ['dimensionName', 100]] as const) {
      if (goal[field] !== null && (typeof goal[field] !== 'string' || goal[field]!.length > max)) {
        throw new BadRequestException('目标内容格式或长度不合法');
      }
    }
    return { ...goal, name };
  });
  if (Math.abs(normalized.reduce((sum, goal) => sum + goal.weight, 0) - 1) > .000001) {
    throw new BadRequestException('目标权重合计必须为100%');
  }
  if (baseline.some((item) => ['kpi', 'attitude'].includes(item.indicatorType) && !normalized.some((goal) =>
    goal.indicatorType === item.indicatorType && goal.dimensionName === item.dimensionName))) {
    throw new BadRequestException('每个原考核维度需保留至少一项目标，可新增同维度目标替换');
  }
  return normalized;
}
