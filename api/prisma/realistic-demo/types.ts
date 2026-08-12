import type { Prisma } from "@prisma/client";

export type DemoEntityKind =
  | "department"
  | "user"
  | "indicator"
  | "template"
  | "dimension"
  | "template-indicator"
  | "cycle"
  | "snapshot"
  | "task"
  | "indicator-instance"
  | "self-eval"
  | "manager-eval"
  | "grade"
  | "flow"
  | "archive"
  | "objective"
  | "action-item"
  | "interview"
  | "appeal"
  | "improvement-plan"
  | "probation-review"
  | "probation-indicator"
  | "confirmation"
  | "signature"
  | "notification"
  | "audit-log";

export interface DemoManifest {
  source: "realistic-demo-v1";
  asOf: Date;
  ownedIds: Record<DemoEntityKind, string[]>;
  acceptanceEmployeeNos: Record<string, string>;
  storyUserIds: Record<string, string>;
  expectedCounts: Record<string, number>;
}

export interface DemoRowSets {
  departments: Prisma.DepartmentCreateManyInput[];
  users: Prisma.UserCreateManyInput[];
  indicators: Prisma.IndicatorCreateManyInput[];
  templates: Prisma.AssessmentTemplateCreateManyInput[];
  dimensions: Prisma.TemplateDimensionCreateManyInput[];
  templateIndicators: Prisma.TemplateIndicatorCreateManyInput[];
  cycles: Prisma.AssessmentCycleCreateManyInput[];
  snapshots: Prisma.AssessmentTemplateSnapshotCreateManyInput[];
  tasks: Prisma.AssessmentTaskCreateManyInput[];
  indicatorInstances: Prisma.IndicatorInstanceCreateManyInput[];
  selfEvaluations: Prisma.SelfEvalSummaryCreateManyInput[];
  managerEvaluations: Prisma.ManagerEvalSummaryCreateManyInput[];
  gradeResults: Prisma.GradeResultCreateManyInput[];
  flowRecords: Prisma.FlowRecordCreateManyInput[];
  archives: Prisma.PerformanceArchiveCreateManyInput[];
  objectives: Prisma.ObjectiveCreateManyInput[];
  actionItems: Prisma.ActionItemCreateManyInput[];
  interviews: Prisma.PerformanceInterviewCreateManyInput[];
  appeals: Prisma.AppealCreateManyInput[];
  improvementPlans: Prisma.ImprovementPlanCreateManyInput[];
  probationReviews: Prisma.ProbationReviewCreateManyInput[];
  probationIndicators: Prisma.ProbationReviewIndicatorCreateManyInput[];
  confirmations: Prisma.ConfirmationApplicationCreateManyInput[];
  signatures: Prisma.SignatureCreateManyInput[];
  notifications: Prisma.NotificationLogCreateManyInput[];
  auditLogs: Prisma.AuditLogCreateManyInput[];
}

export interface PeopleBundle {
  departments: Prisma.DepartmentCreateManyInput[];
  users: Prisma.UserCreateManyInput[];
  baseDepartmentAssertions: Array<{ id: string; expectedName: string }>;
  departmentLeadership: RealisticDemoDataset["departmentLeadership"];
  managerIds: string[];
  managerByUserId: Map<string, string>;
  deptHeadByDepartmentId: Map<string, string>;
  approverByDepartmentId: Map<string, string>;
  storyUserIds: Record<string, string>;
  acceptanceEmployeeNos: Record<string, string>;
}

export interface RealisticDemoDataset {
  rows: DemoRowSets;
  departmentLeadership: Array<{
    id: string;
    leaderId: string | null;
    approverId: string | null;
  }>;
  manifest: DemoManifest;
}
