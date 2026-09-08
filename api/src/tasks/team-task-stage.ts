import { AssessmentPeriod, TaskStatus } from "@prisma/client";

type ManagerPeriod = Pick<AssessmentPeriod, 'status' | 'employeeSubmittedAt' | 'managerSubmittedAt' | 'managerScoreTotal' | 'lockedAt'>;

export function isManagerPeriodComplete(period: ManagerPeriod): boolean {
  return period.status === 'completed' && period.employeeSubmittedAt != null
    && period.managerSubmittedAt != null && period.managerScoreTotal != null && period.lockedAt != null;
}

export function pickManagerPeriod<T extends Pick<AssessmentPeriod, 'status'>>(periods: T[]): T | null {
  return periods.find(period => period.status === 'manager_scoring')
    ?? periods.find(period => period.status === 'self_eval')
    ?? periods.find(period => period.status === 'unopened')
    ?? periods.at(-1) ?? null;
}

export function getManagerStageState(task: { status: TaskStatus; isExempt?: boolean; periods?: ManagerPeriod[] }): TeamStageState {
  if (task.isExempt || task.status === 'exempted') return 'exempted';
  const periods = task.periods ?? [];
  const period = pickManagerPeriod(periods);
  if (!period) return getTeamStageState(task.status, 'manager-eval');
  if (period.status === 'manager_scoring') {
    if (period.employeeSubmittedAt == null) return 'not_started';
    if (period.managerSubmittedAt == null) return 'pending';
  }
  if (period.status === 'unopened' || period.status === 'self_eval') return 'not_started';
  // Monthly results are only the basis; a returned cycle grade also needs resubmission.
  if (task.status === 'manager_scoring' && periods.every(isManagerPeriodComplete)) return 'pending';
  return 'completed';
}

export type TeamTaskStage = "goal-review" | "manager-eval";
export type TeamStageState =
  | "not_started"
  | "pending"
  | "completed"
  | "exempted";
type ActiveTeamStageState = Exclude<TeamStageState, "exempted">;

export const TEAM_STAGE_STATUSES = {
  "goal-review": {
    not_started: ["pending", "indicator_drafting", "indicator_setting"],
    pending: ["indicator_reviewing"],
    completed: [
      "indicator_confirming",
      "self_eval",
      "manager_scoring",
      "dept_review",
      "hr_calibration",
      "approval",
      "published",
      "confirmed",
      "appealing",
      "closed",
    ],
  },
  "manager-eval": {
    not_started: [
      "pending",
      "indicator_drafting",
      "indicator_setting",
      "indicator_reviewing",
      "indicator_confirming",
      "self_eval",
    ],
    pending: ["manager_scoring"],
    completed: [
      "dept_review",
      "hr_calibration",
      "approval",
      "published",
      "confirmed",
      "appealing",
      "closed",
    ],
  },
} as const;

export function getTeamStageStatuses(
  stage: TeamTaskStage,
  stageState: TeamStageState,
): readonly TaskStatus[] {
  if (stageState === "exempted") {
    return ["exempted"];
  }

  return TEAM_STAGE_STATUSES[stage][stageState as ActiveTeamStageState];
}

export function getTeamStageState(
  status: TaskStatus,
  stage: TeamTaskStage,
): TeamStageState {
  if (status === "exempted") {
    return "exempted";
  }

  const statuses = TEAM_STAGE_STATUSES[stage];
  if ((statuses.not_started as readonly TaskStatus[]).includes(status)) {
    return "not_started";
  }
  if ((statuses.pending as readonly TaskStatus[]).includes(status)) {
    return "pending";
  }
  return "completed";
}
