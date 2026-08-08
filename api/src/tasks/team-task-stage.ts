import { TaskStatus } from '@prisma/client';

export type TeamTaskStage = 'goal-review' | 'manager-eval';
export type TeamStageState = 'not_started' | 'pending' | 'completed' | 'exempted';

export const TEAM_STAGE_STATUSES = {
  'goal-review': {
    not_started: ['pending', 'indicator_drafting', 'indicator_setting'],
    pending: ['indicator_reviewing'],
    completed: [
      'indicator_confirming',
      'self_eval',
      'manager_scoring',
      'dept_review',
      'hr_calibration',
      'approval',
      'published',
      'confirmed',
      'appealing',
      'closed',
    ],
  },
  'manager-eval': {
    not_started: [
      'pending',
      'indicator_drafting',
      'indicator_setting',
      'indicator_reviewing',
      'indicator_confirming',
      'self_eval',
    ],
    pending: ['manager_scoring'],
    completed: [
      'dept_review',
      'hr_calibration',
      'approval',
      'published',
      'confirmed',
      'appealing',
      'closed',
    ],
  },
} as const;

export function getTeamStageState(status: TaskStatus, stage: TeamTaskStage): TeamStageState {
  if (status === 'exempted') {
    return 'exempted';
  }

  const statuses = TEAM_STAGE_STATUSES[stage];
  if ((statuses.not_started as readonly TaskStatus[]).includes(status)) {
    return 'not_started';
  }
  if ((statuses.pending as readonly TaskStatus[]).includes(status)) {
    return 'pending';
  }
  return 'completed';
}
