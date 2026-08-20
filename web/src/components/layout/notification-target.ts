import { isNavigationFailure, type RouteLocationRaw, type Router } from 'vue-router';
import type { Notification } from '@/types/api.types';
import type { SysRole } from '@/types/enums';

const DIRECT_MANAGER_ROLES = new Set<SysRole>(['manager', 'dept_head']);

export function resolveNotificationTarget(
  notification: Pick<Notification, 'taskId' | 'cycleId' | 'type'>,
  role: SysRole,
): RouteLocationRaw | null {
  const taskId = notification.taskId;
  if (!taskId) return null;
  const cycleId = notification.cycleId || undefined;

  if (DIRECT_MANAGER_ROLES.has(role) && cycleId) {
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
