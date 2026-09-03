import { isNavigationFailure, type RouteLocationRaw, type Router } from 'vue-router';
import type { Notification } from '@/types/api.types';

export function resolveNotificationTarget(
  notification: Pick<Notification, 'taskId' | 'cycleId' | 'type' | 'extraData'>,
  canManageTeam: boolean,
): RouteLocationRaw | null {
  const taskId = notification.taskId;
  const cycleId = notification.cycleId || undefined;

  if (notification.type === 'cycle_review_reminder' && cycleId) {
    return { path: '/cycles', query: { group: 'attention', cycleId } };
  }
  if (!taskId) return null;
  const periodId = typeof notification.extraData?.periodId === 'string'
    ? notification.extraData.periodId
    : null;
  const periodAction = notification.extraData?.action;

  if (periodId && periodAction === 'employee_period_review') {
    return {
      name: 'TaskDetail',
      params: { id: taskId },
      query: { stage: 'self-eval', periodId },
    };
  }
  if (periodId && periodAction === 'manager_period_review' && canManageTeam && cycleId) {
    return {
      path: '/tasks',
      query: { scope: 'team', stage: 'manager-eval', cycleId, taskId, periodId },
    };
  }

  if (canManageTeam && cycleId) {
    if (notification.type === 'indicator_setting_notice') {
      return {
        path: '/tasks',
        query: { scope: 'team', stage: 'goal-review', cycleId, taskId },
      };
    }
    if (notification.type === 'self_eval_submitted') {
      return {
        path: '/tasks',
        query: { scope: 'team', stage: 'manager-eval', cycleId, taskId },
      };
    }
  }

  return { name: 'TaskDetail', params: { id: taskId } };
}

export async function navigateNotificationTarget(
  target: RouteLocationRaw,
  push: Router['push'],
): Promise<boolean> {
  try {
    return !isNavigationFailure(await push(target));
  } catch {
    return false;
  }
}
