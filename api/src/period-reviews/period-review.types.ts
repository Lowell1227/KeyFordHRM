import type {
  AssessmentPeriodStatus,
  AssessmentPeriodType,
  IndicatorProgressHealth,
  ObjectiveLevel,
} from '@prisma/client';
import type { PeriodMonitoringStatus } from './dto/query-period-monitoring.dto';

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
    isScoreRequired: boolean;
    monthlyProgressSource: 'draft_or_result' | 'active_progress' | 'none';
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

export interface PeriodMonitoringRow {
  id: string;
  taskId: string;
  periodKey: string;
  sequence: number;
  status: AssessmentPeriodStatus;
  derivedStatus: PeriodMonitoringStatus;
  draftVersion: number;
  employeeId: string;
  employeeNo: string | null;
  employeeName: string;
  deptName: string | null;
  managerName: string | null;
  selfEvalOpenAt: Date;
  selfEvalDueAt: Date;
  managerDueAt: Date;
  employeeSubmittedAt: Date | null;
  managerSubmittedAt: Date | null;
  lockedAt: Date | null;
  selfScoreTotal: number | null;
  managerScoreTotal: number | null;
  canReopen: boolean;
  reopenBlockedReason: string | null;
}

export interface PeriodMonitoringResult {
  cycle: { id: string; name: string };
  summary: {
    employeePending: number;
    employeeOverdue: number;
    managerPending: number;
    managerCompleted: number;
    total: number;
  };
  total: number;
  page: number;
  pageSize: number;
  items: PeriodMonitoringRow[];
}
