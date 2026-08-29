import type {
  AssessmentPeriodStatus,
  AssessmentPeriodType,
  IndicatorProgressHealth,
  ObjectiveLevel,
} from '@prisma/client';

export interface PeriodReviewHistoryItem {
  periodKey: string;
  progress: number | null;
  healthStatus: IndicatorProgressHealth | null;
  actualValueText: string | null;
  selfScore: number | null;
  managerScore: number | null;
}

export interface PeriodReviewDetail {
  period: {
    id: string;
    taskId: string;
    periodKey: string;
    periodType: AssessmentPeriodType;
    status: AssessmentPeriodStatus;
    selfEvalOpenAt: Date;
    selfEvalDueAt: Date;
    managerDueAt: Date;
    employeeSubmittedAt: Date | null;
    managerSubmittedAt: Date | null;
    selfScoreTotal: number | null;
    managerScoreTotal: number | null;
    draftVersion: number;
  };
  context: {
    cycleName: string;
    employeeName: string;
    employeeNo: string | null;
    deptName: string | null;
    managerName: string | null;
    statusLabel: string;
  };
  permissions: {
    canEditEmployee: boolean;
    canEditManager: boolean;
  };
  indicators: Array<{
    indicatorVersionItemId: string;
    sourceInstanceId: string | null;
    name: string;
    description: string | null;
    scoringStandard: string | null;
    targetValue: number | null;
    targetValueText: string | null;
    unit: string | null;
    weight: number;
    progress: number | null;
    healthStatus: IndicatorProgressHealth | null;
    actualValueText: string | null;
    employeeComment: string | null;
    problemReason: string | null;
    nextMonthPlan: string | null;
    supportNeeded: string | null;
    attachments: unknown[];
    selfScore: number | null;
    managerScore: number | null;
    managerComment: string | null;
    latestProgress: {
      progress: number;
      healthStatus: IndicatorProgressHealth;
      content: string;
      attachments: unknown[];
      createdAt: Date;
    } | null;
    alignedObjectives: Array<{ id: string; title: string; level: ObjectiveLevel }>;
    history: PeriodReviewHistoryItem[];
  }>;
}

export interface PeriodReviewActionResult {
  periodId: string;
  status: AssessmentPeriodStatus;
  draftVersion: number;
  savedAt: Date;
}
