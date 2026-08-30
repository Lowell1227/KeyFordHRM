import type {
  AssessmentPeriodStatus,
  AssessmentPeriodType,
  CycleType,
  ParticipantDisposition,
  ScoringFrequency,
  TaskStatus,
} from '@prisma/client';

export interface PerformancePeriodContext {
  id: string;
  periodKey: string;
  periodType: AssessmentPeriodType;
  sequence: number;
  status: AssessmentPeriodStatus;
  selfEvalOpenAt: Date;
  selfEvalDueAt: Date;
  managerDueAt: Date;
  employeeSubmittedAt: Date | null;
  managerSubmittedAt: Date | null;
  selfScoreTotal: number | null;
  managerScoreTotal: number | null;
}

export interface PerformanceCycleContext {
  id: string;
  name: string;
  type: CycleType;
  startDate: Date;
  endDate: Date;
  openedAt: Date;
  scoringFrequency: ScoringFrequency;
  task: {
    id: string;
    status: TaskStatus;
    isExempt: boolean;
    exemptReason: string | null;
    participantDisposition: ParticipantDisposition;
  };
  periods: PerformancePeriodContext[];
}
